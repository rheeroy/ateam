-- ATEAM 의사결정 보드 '팀원 요청' (대화 · 스레드에서 팀원이 물은 결정) — 38_admin_customers 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 팀원이 대화에서 물은 결정 — 의사결정 보드에 '팀원 요청' 카드로
--   · 업무스페이스 대화 · 스레드(space_messages)와 업무 카드 스레드 댓글(review_comments)에서
--     팀원이 쓴 글 중 '결정 · 정해 · 컨펌 · 골라 · 어느 쪽 · A안/B안 · 어떻게 할까요' 같은 표현이 있는 것만 후보로 표시한다 (DB, 무료)
--   · 후보는 의사결정 화면을 열 때 ai-decision-asks 가 모아서 진짜 결정 요청인지 판별한다 (무엇을 정할지 · 선택지 · 기한)
--   · 팀장이 그 스레드나 대화에 답하면 '답함'으로 보드에서 내려간다
--   · 빼는 것: 팀장이 쓴 글 · 컨펌 요청 중인 업무 카드의 댓글(업무플랫폼 '결론 대기'에서 처리) · 14일 지난 것
--   · 팀장만 읽는다 (팀원 화면에는 나오지 않음)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'decision_asks';

create table if not exists public.decision_asks (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  src_table     text not null check (src_table in ('space_messages', 'review_comments')),
  src_id        uuid not null unique,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  space_user    uuid,                 -- 개인 스페이스 주인 (대화)
  group_id      uuid,                 -- 그룹 스페이스 (대화)
  root_id       uuid,                 -- 스레드 답글이면 그 스레드의 첫 글
  submission_id uuid,                 -- 업무 카드 댓글이면 그 카드
  item_id       uuid,                 -- 걸린 과제
  body          text not null,
  status        text not null default 'candidate' check (status in ('candidate', 'ask', 'not', 'answered')),
  ai            jsonb,                -- { title, options:[], due }
  classified_at timestamptz,
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists decision_asks_team_idx on public.decision_asks (team_id, status, created_at desc);
alter table public.decision_asks enable row level security;
drop policy if exists decision_asks_leader on public.decision_asks;
create policy decision_asks_leader on public.decision_asks for select to authenticated using (public.is_team_leader(team_id));

-- 결정을 묻는 표현 (넓게 잡고, 진짜인지는 AI가 가린다)
create or replace function public._looks_like_ask(p_body text) returns boolean
language sql immutable as $$
  select coalesce(p_body, '') ~ '(결정|정해|정하면|정할까|골라|고르면|선택해|컨펌|승인해|재가|판단해|어느\s?쪽|어떤\s?(안|걸|게|방향)|[A-Da-d1-3]\s?안|할까요|갈까요|해도\s?될까|해도\s?되나|해도\s?괜찮|진행할까|진행해도|어떻게\s?할까|어떻게\s?하면\s?좋|의견\s?(주세요|부탁)|방향\s?(주세요|잡아))'
     and length(trim(coalesce(p_body, ''))) >= 8;
$$;

-- 후보 표시 + 팀장 답이면 '답함'
create or replace function public.trg_decision_ask_msg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead uuid := public._team_leader(new.team_id);
begin
  if new.author_id = v_lead then
    update decision_asks set status = 'answered', answered_at = now()
     where team_id = new.team_id and src_table = 'space_messages' and status in ('candidate', 'ask') and created_at <= new.created_at
       and ((new.parent_id is not null and (src_id = new.parent_id or root_id = new.parent_id))
         or (new.parent_id is null and root_id is null and space_user is not distinct from new.space_user and group_id is not distinct from new.group_id));
  elsif public._looks_like_ask(new.body) then
    insert into decision_asks (team_id, src_table, src_id, author_id, space_user, group_id, root_id, item_id, body, created_at)
    values (new.team_id, 'space_messages', new.id, new.author_id, new.space_user, new.group_id, new.parent_id, new.item_id, left(new.body, 1500), new.created_at)
    on conflict (src_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists t_decision_ask_msg on public.space_messages;
create trigger t_decision_ask_msg after insert on public.space_messages for each row execute function public.trg_decision_ask_msg();

create or replace function public.trg_decision_ask_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead uuid := public._team_leader(new.team_id); v_sub submissions;
begin
  select * into v_sub from submissions where id = new.submission_id;
  if v_sub.id is null then return new; end if;
  if new.author_id = v_lead then
    update decision_asks set status = 'answered', answered_at = now()
     where team_id = new.team_id and src_table = 'review_comments' and submission_id = new.submission_id
       and status in ('candidate', 'ask') and created_at <= new.created_at;
  elsif coalesce(new.via_autopilot, false) = false and public._looks_like_ask(new.body)
        -- 컨펌 요청 중인 카드는 '결론 대기'에서 처리되니 빼고
        and not (v_sub.request_type = 'approval' and v_sub.status = 'in_review') then
    insert into decision_asks (team_id, src_table, src_id, author_id, root_id, submission_id, item_id, body, created_at)
    values (new.team_id, 'review_comments', new.id, new.author_id, new.parent_id, new.submission_id, v_sub.item_id, left(new.body, 1500), new.created_at)
    on conflict (src_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists t_decision_ask_comment on public.review_comments;
create trigger t_decision_ask_comment after insert on public.review_comments for each row execute function public.trg_decision_ask_comment();

-- 판별 대기 수 (팀장 화면이 AI를 부를지 정할 때)
create or replace function public.decision_ask_pending(p_team uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when public.is_team_leader(p_team)
    then (select count(*)::int from decision_asks where team_id = p_team and status = 'candidate' and created_at > now() - interval '14 days')
    else 0 end;
$$;
grant execute on function public.decision_ask_pending(uuid) to authenticated;
