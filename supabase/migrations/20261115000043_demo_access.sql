-- =====================================================================
-- 데모 신청 · 승인 — 랜딩의 '데모 신청하기' → 관리자 승인 → 7일짜리 개인 데모 링크
--   · demo_requests: 신청서 + 승인 링크(token) + 링크별 AI 체험 기록 (데모 초기화와 무관하게 남는다)
--   · app_admins: 승인할 수 있는 사람 (아래 맨 끝에서 내 이메일로 한 번 등록)
--   · 데모 링크마다 AI 기능은 종류별로 한 번씩 (demo_ai_take, ai 함수가 부른다)
--   · 데모 팀에서는 초대 · 팀원 내보내기 · 역할 변경을 막는다 (여러 사람이 같은 계정을 쓰므로)
-- 다시 Run 해도 안전합니다.
-- =====================================================================

-- ---------- 관리자 ----------
create table if not exists public.app_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;   -- 정책 없음 = 아래 함수로만

create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;
grant execute on function public.is_app_admin() to authenticated;

-- ---------- 데모 신청 ----------
create table if not exists public.demo_requests (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  company      text not null,
  job_title    text not null default '',
  team_size    text not null default '',
  email        text not null,
  phone        text not null default '',
  note         text not null default '',
  consent      boolean not null default false,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  token        uuid unique,
  approved_at  timestamptz,
  expires_at   timestamptz,
  first_used_at timestamptz,
  last_used_at  timestamptz,
  ai_used      jsonb not null default '{}'::jsonb,     -- { "<kind>": "<사용 시각>" }
  created_at   timestamptz not null default now()
);
create index if not exists demo_requests_created_idx on public.demo_requests (created_at desc);
create index if not exists demo_requests_email_idx on public.demo_requests (lower(email));
alter table public.demo_requests enable row level security;   -- 정책 없음 = 서버(demo-access) · 관리자 함수로만

-- 관리자: 목록
create or replace function public.admin_demo_list() returns setof public.demo_requests
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select * from demo_requests order by (status = 'pending') desc, created_at desc limit 300;
end $$;
grant execute on function public.admin_demo_list() to authenticated;

-- 관리자: 승인(7일 링크) · 거절 · 연장
create or replace function public.admin_demo_decide(p_id uuid, p_action text) returns public.demo_requests
language plpgsql security definer set search_path = public as $$
declare r demo_requests;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action = 'approve' then
    update demo_requests set status = 'approved', token = coalesce(token, gen_random_uuid()), approved_at = coalesce(approved_at, now()),
      expires_at = case when expires_at > now() then expires_at else now() + interval '7 days' end
      where id = p_id returning * into r;
  elsif p_action = 'extend' then
    update demo_requests set expires_at = greatest(coalesce(expires_at, now()), now()) + interval '7 days', status = 'approved',
      token = coalesce(token, gen_random_uuid()) where id = p_id returning * into r;
  elsif p_action = 'reject' then
    update demo_requests set status = 'rejected', expires_at = least(coalesce(expires_at, now()), now()) where id = p_id returning * into r;
  else raise exception 'BAD_ACTION';
  end if;
  return r;
end $$;
grant execute on function public.admin_demo_decide(uuid, text) to authenticated;

-- 링크 확인 (서비스 전용) — 유효하면 행을 돌려주고 사용 시각을 남긴다
create or replace function public.demo_token_use(p_token uuid) returns public.demo_requests
language plpgsql security definer set search_path = public as $$
declare r demo_requests;
begin
  if auth.uid() is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  update demo_requests set first_used_at = coalesce(first_used_at, now()), last_used_at = now()
   where token = p_token and status = 'approved' and expires_at > now() returning * into r;
  return r;
end $$;
revoke all on function public.demo_token_use(uuid) from public, anon, authenticated;

-- AI 한 번 쓰기 (서비스 전용) — 링크마다 기능 종류별 한 번. 쓸 수 있으면 true
create or replace function public.demo_ai_take(p_token uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if auth.uid() is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  update demo_requests set ai_used = ai_used || jsonb_build_object(p_kind, now())
   where token = p_token and status = 'approved' and expires_at > now() and not (ai_used ? p_kind)
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.demo_ai_take(uuid, text) from public, anon, authenticated;

-- AI 호출이 실패하면 그 기능 기록을 되돌린다 (서비스 전용)
create or replace function public.demo_ai_refund(p_token uuid, p_kind text) returns void
language sql security definer set search_path = public as $$
  update demo_requests set ai_used = ai_used - p_kind where token = p_token and auth.uid() is null;
$$;
revoke all on function public.demo_ai_refund(uuid, text) from public, anon, authenticated;

-- ---------- 데모 팀 보호: 초대 · 팀원 내보내기 · 역할 변경 막기 (앱 사용자만, 시드 SQL은 통과) ----------
create or replace function public.trg_demo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_team uuid := coalesce(new.team_id, old.team_id);
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if not exists (select 1 from teams where id = v_team and is_demo) then return coalesce(new, old); end if;
  if tg_table_name = 'invitations' then
    raise exception 'DEMO_READONLY' using errcode = 'P0001', hint = '데모에서는 팀원을 초대할 수 없습니다';
  end if;
  if tg_table_name = 'team_members' and (tg_op = 'DELETE' or new.status is distinct from old.status or new.role is distinct from old.role) then
    raise exception 'DEMO_READONLY' using errcode = 'P0001', hint = '데모에서는 팀 구성을 바꿀 수 없습니다';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists t_demo_guard on public.invitations;
create trigger t_demo_guard before insert on public.invitations for each row execute function public.trg_demo_guard();
drop trigger if exists t_demo_guard on public.team_members;
create trigger t_demo_guard before update or delete on public.team_members for each row execute function public.trg_demo_guard();

-- ---------- 관리자 등록 (한 번) — 내 로그인 이메일로 바꿔서 Run ----------
do $$
declare v_email text := 'hcgkhlee@gmail.com';   -- ← 승인할 계정의 이메일
begin
  insert into public.app_admins (user_id)
  select id from auth.users where lower(email) = lower(v_email)
  on conflict do nothing;
  if not exists (select 1 from auth.users where lower(email) = lower(v_email)) then raise notice '관리자 이메일 % 로 가입된 계정이 없습니다 — 가입 후 이 블록만 다시 Run 하세요', v_email; end if;
end $$;
