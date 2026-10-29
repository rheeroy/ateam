-- =====================================================================
-- 업무플랫폼 확장 — 팀 방향 · Sim.Box · 파일 실적 추출
--   · 팀 방향(team_directions): 팀장이 쓰지 않는다. ATEAM이 팀 목표 · 팀장 요청 · 결과물 피드백 · 공유한 위·조직 소식 ·
--     공유 노하우에서 '팀 전체에 해당하는 것'만 정리한다 (사람 이름 · 개인 사정 없음). 일주일마다 새로 정리
--   · 위에서 온 것(org_notes)은 share_team 을 켠 것만 팀원에게 쓰인다 (팀 방향 · Sim.Box 근거)
--   · Sim.Box: 팀원 혼자 쓰는 시뮬레이션 · 메모 공간 — 본인만 읽는다(팀장 포함 누구도 못 읽음) · 30일 지나면 지운다
--     팀장에게는 정해진 분류의 '팀 전체 합계'만 (팀원 5명 이상 · 3명 이상이 쓴 분류만 · 민감한 대화는 집계 제외)
--     횟수: 팀원 1인당 체험 월 5 / Starter 20 / Pro 20 / Pro+ 30 (하루 3 / 5 / 5 / 8) · 데모 팀 60 (하루 15)
--     원가는 팀의 월 AI 원가 상한에 함께 센다 (credit_ledger.reason = 'simbox')
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'team_direction';
alter type public.ai_kind add value if not exists 'perf_extract';

-- ---------- 팀 방향 ----------
create table if not exists public.team_directions (
  team_id     uuid primary key references public.teams(id) on delete cascade,
  content     jsonb not null default '{}'::jsonb,   -- { title, sections:[{ key, title, sub, items:[{ text, why, source, date, repeat, new }] }] }
  status      text not null default 'ready' check (status in ('ready', 'running', 'failed')),
  started_at  timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.team_directions enable row level security;
drop policy if exists team_directions_read on public.team_directions;
create policy team_directions_read on public.team_directions for select using (public.is_team_member(team_id));

-- 정리 시작 (서비스 전용) — 팀 단위 잠금: 진행 중이면 기다리고, 새로 정리할 때가 아니면 그대로
create or replace function public.team_direction_claim(p_team uuid, p_force boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
declare r team_directions;
begin
  if auth.uid() is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('direction:' || p_team::text));
  select * into r from team_directions where team_id = p_team;
  if r.team_id is not null and r.status = 'running' and r.started_at > now() - interval '5 minutes' then return false; end if;
  -- 실패했으면 한 시간 뒤에 다시 (열 때마다 다시 부르지 않게)
  if r.team_id is not null and r.status = 'failed' and r.started_at > now() - interval '1 hour' then return false; end if;
  if r.team_id is not null and r.status = 'ready' and r.content <> '{}'::jsonb
     and r.updated_at > now() - (case when p_force then interval '1 hour' else interval '7 days' end) then return false; end if;
  insert into team_directions (team_id, status, started_at) values (p_team, 'running', now())
    on conflict (team_id) do update set status = 'running', started_at = now();
  return true;
end $$;
revoke all on function public.team_direction_claim(uuid, boolean) from public, anon, authenticated;

-- ---------- 위에서 온 것: 팀원에게 공유 ----------
alter table public.org_notes add column if not exists share_team boolean not null default false;

-- ---------- Sim.Box ----------
alter table public.plans add column if not exists simbox_monthly int not null default 0;
alter table public.plans add column if not exists simbox_daily int not null default 0;
update public.plans set simbox_monthly = 20, simbox_daily = 5 where id = 'starter';
update public.plans set simbox_monthly = 20, simbox_daily = 5 where id = 'pro';
update public.plans set simbox_monthly = 30, simbox_daily = 8 where id = 'pro_plus';
update public.plans set simbox_monthly = 0,  simbox_daily = 0 where id = 'free';

create table if not exists public.simbox_messages (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  body        text not null default '',
  attachment  jsonb,          -- { name, kind, text?(본문 일부), digest?(AI가 정리한 요지) }
  meta        jsonb,          -- 답: { panel:{ title, questions[], fixes[], good[] }, chips[] }
  created_at  timestamptz not null default now()
);
create index if not exists simbox_messages_user_idx on public.simbox_messages (user_id, team_id, created_at);
alter table public.simbox_messages enable row level security;
-- 본인만 읽고 지운다 (팀장 · 다른 팀원 · 관리자 화면 모두 못 읽음). 쓰기는 서버(ai-simbox)만
drop policy if exists simbox_messages_own_read on public.simbox_messages;
create policy simbox_messages_own_read on public.simbox_messages for select using (user_id = auth.uid());
drop policy if exists simbox_messages_own_delete on public.simbox_messages;
create policy simbox_messages_own_delete on public.simbox_messages for delete using (user_id = auth.uid());

-- 횟수 기록 (대화 내용 없음)
create table if not exists public.simbox_usage (
  id          bigserial primary key,
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  cost_usd    numeric not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists simbox_usage_user_idx on public.simbox_usage (user_id, team_id, created_at desc);
alter table public.simbox_usage enable row level security;   -- 정책 없음 = 서버 · 아래 함수로만

-- 팀장용 가공: 정해진 분류만 (문장 · 단어 없음)
create table if not exists public.simbox_tags (
  id          bigserial primary key,
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  category    text not null check (category in ('evidence', 'structure', 'clarity', 'priority', 'reporting', 'stakeholder', 'planning', 'idea', 'data')),
  created_at  timestamptz not null default now()
);
create index if not exists simbox_tags_team_idx on public.simbox_tags (team_id, created_at desc);
alter table public.simbox_tags enable row level security;    -- 정책 없음 = 서버 · simbox_trends 로만

-- 내 남은 횟수
create or replace function public.simbox_quota(p_team uuid, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user);
  v_owner uuid; v_plan plans; v_sub subscriptions; v_trial boolean;
  v_limit int; v_daily int; v_from timestamptz; v_used int; v_day int;
begin
  if auth.uid() is not null and not public.is_team_member(p_team) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_user is null then return null; end if;
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then return null; end if;
  v_plan := public.effective_plan_for_owner(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  v_trial := v_sub.status = 'trialing' and coalesce(v_sub.trial_ends_at, now() + interval '1 day') > now();
  if v_trial then v_limit := 5; v_daily := 3;
  else v_limit := coalesce(v_plan.simbox_monthly, 0); v_daily := coalesce(v_plan.simbox_daily, 0); end if;
  -- 데모 팀: 여러 사람이 같은 계정으로 체험하므로 넉넉하게 (원가는 팀 월 AI 원가 상한이 따로 막는다)
  if exists (select 1 from teams where id = p_team and is_demo) then v_limit := 60; v_daily := 15; v_trial := false; end if;
  v_from := (date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul';
  select count(*) filter (where created_at >= v_from),
         count(*) filter (where created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul')
    into v_used, v_day
    from simbox_usage where user_id = v_user and team_id = p_team and created_at >= least(v_from, now() - interval '1 day');
  return jsonb_build_object('limit', v_limit, 'used', v_used, 'remaining', greatest(0, v_limit - v_used),
    'daily_limit', v_daily, 'day_used', v_day, 'day_remaining', greatest(0, v_daily - v_day), 'trial', v_trial);
end $$;
revoke all on function public.simbox_quota(uuid, uuid) from public, anon;
grant execute on function public.simbox_quota(uuid, uuid) to authenticated;

-- 한 번 쓰기 (서비스 전용) — 잠금 안에서 횟수 확인 후 기록. 남은 게 없으면 SIMBOX_LIMIT
create or replace function public.simbox_take(p_team uuid, p_user uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_q jsonb; v_id bigint;
begin
  if auth.uid() is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('simbox:' || p_user::text));
  v_q := public.simbox_quota(p_team, p_user);
  if coalesce((v_q ->> 'remaining')::int, 0) <= 0 then raise exception 'SIMBOX_LIMIT' using errcode = 'P0001', hint = 'month'; end if;
  if coalesce((v_q ->> 'day_remaining')::int, 0) <= 0 then raise exception 'SIMBOX_LIMIT' using errcode = 'P0001', hint = 'day'; end if;
  insert into simbox_usage (team_id, user_id) values (p_team, p_user) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.simbox_take(uuid, uuid) from public, anon, authenticated;

-- 실패하면 횟수를 돌려준다 (서비스 전용)
create or replace function public.simbox_refund(p_id bigint) returns void
language sql security definer set search_path = public as $$ delete from simbox_usage where id = p_id and auth.uid() is null $$;
revoke all on function public.simbox_refund(bigint) from public, anon, authenticated;

-- 원가 기록 (서비스 전용) — 팀 소유자의 월 AI 원가 상한에 함께 센다
create or replace function public.simbox_cost(p_id bigint, p_model text, p_in int, p_out int, p_cost numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_owner uuid;
begin
  if auth.uid() is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  update simbox_usage set cost_usd = coalesce(p_cost, 0) where id = p_id returning team_id into v_team;
  select owner_id into v_owner from teams where id = v_team;
  if v_owner is null then return; end if;
  insert into credit_ledger (owner_id, team_id, delta, reason, ai_kind, model, input_tokens, output_tokens, cost_usd)
    values (v_owner, v_team, 0, 'simbox', 'simbox', p_model, p_in, p_out, p_cost);
end $$;
revoke all on function public.simbox_cost(bigint, text, int, int, numeric) from public, anon, authenticated;

-- 팀장용: 이름 없이 팀 전체 합계만. 팀원 5명 이상 팀에서, 3명 이상이 쓴 분류만
create or replace function public.simbox_trends(p_team uuid, p_days int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_members int; v_users int; v_total int; v_rows jsonb;
begin
  if auth.uid() is not null and not public.is_team_leader(p_team) then raise exception 'forbidden' using errcode = '42501'; end if;
  select count(*) into v_members from team_members where team_id = p_team and status = 'active' and role = 'member';
  if v_members < 5 then return jsonb_build_object('available', false, 'reason', 'small_team', 'members', v_members); end if;
  select count(distinct user_id), count(*) into v_users, v_total from simbox_tags
   where team_id = p_team and created_at > now() - make_interval(days => greatest(7, least(p_days, 120)));
  if v_users < 3 then return jsonb_build_object('available', false, 'reason', 'few_users'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'share', round(100.0 * n / v_total)) order by n desc), '[]'::jsonb)
    into v_rows
    from (select category, count(*) n, count(distinct user_id) u from simbox_tags
           where team_id = p_team and created_at > now() - make_interval(days => greatest(7, least(p_days, 120)))
           group by category) t
   where u >= 3;
  return jsonb_build_object('available', true, 'days', p_days, 'users_band', case when v_users >= 10 then '10명 이상' else '여러 명' end, 'rows', v_rows);
end $$;
revoke all on function public.simbox_trends(uuid, int) from public, anon;
grant execute on function public.simbox_trends(uuid, int) to authenticated;

-- 30일 지난 대화 지우기 (예약 작업 · 서버에서도 부른다)
create or replace function public.simbox_purge() returns void
language sql security definer set search_path = public as $$
  delete from simbox_messages where created_at < now() - interval '30 days';
  delete from simbox_tags where created_at < now() - interval '180 days';
  delete from simbox_usage where created_at < now() - interval '400 days';
$$;
revoke all on function public.simbox_purge() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule('simbox-purge') where exists (select 1 from cron.job where jobname = 'simbox-purge');
    perform cron.schedule('simbox-purge', '30 18 * * *', 'select public.simbox_purge()');
  end if;
exception when others then raise notice 'simbox-purge 예약을 건너뜁니다: %', sqlerrm;
end $$;

-- ---------- AI 원가: Sim.Box 도 월 원가 상한에 센다 (시간당 · 하루 횟수 한도에는 넣지 않는다 — 팀원 사용이 팀장 AI를 막지 않게) ----------
alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('monthly_grant','topup','usage','refund','adjust','core_usage','ai_error','simbox'));

create or replace function public.ai_guard(p_team uuid, p_kind text, p_ref uuid default null,
  p_period date default null, p_subject uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_plan plans; v_bal credit_balances; v_sub subscriptions;
  v_hour int; v_day int; v_cost numeric; v_cap numeric; v_same int;
begin
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then raise exception 'TEAM_NOT_FOUND' using errcode = 'P0001'; end if;
  v_plan := public.effective_plan_for_owner(v_owner);
  v_bal := public._ensure_credit_period(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '24 hours')
    into v_hour, v_day
    from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'usage', 'ai_error') and created_at > now() - interval '24 hours';
  if v_hour >= v_plan.ai_hourly_cap then
    raise exception 'AI_RATE_HOUR' using errcode = 'P0001', hint = v_plan.ai_hourly_cap::text;
  end if;
  if v_day >= v_plan.ai_daily_cap then
    raise exception 'AI_RATE_DAY' using errcode = 'P0001', hint = v_plan.ai_daily_cap::text;
  end if;

  v_cap := public.ai_cost_cap(v_owner);
  select coalesce(sum(cost_usd), 0) into v_cost from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'ai_error', 'simbox') and created_at >= v_bal.period_start;
  if v_cost >= v_cap then
    raise exception 'AI_COST_CAP' using errcode = 'P0001';
  end if;

  if p_ref is not null or p_period is not null then
    select count(*) into v_same from ai_outputs
     where team_id = p_team and kind::text = p_kind
       and ref_id is not distinct from p_ref and period_start is not distinct from p_period
       and subject_user_id is not distinct from p_subject
       and created_at > now() - interval '24 hours';
    if v_same >= 3 then raise exception 'AI_REPEAT' using errcode = 'P0001'; end if;
  end if;

  return jsonb_build_object('hour', v_hour, 'day', v_day, 'cost_usd', v_cost, 'cost_cap_usd', v_cap);
end $$;
revoke all on function public.ai_guard(uuid, text, uuid, date, uuid) from public, anon, authenticated;

create or replace function public.ai_budget(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_plan plans; v_bal credit_balances; v_sub subscriptions; v_cost numeric; v_cap numeric;
begin
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then return null; end if;
  v_plan := public.effective_plan_for_owner(v_owner);
  v_bal := public._ensure_credit_period(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  v_cap := public.ai_cost_cap(v_owner);
  select coalesce(sum(cost_usd), 0) into v_cost from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'ai_error', 'simbox') and created_at >= v_bal.period_start;
  return jsonb_build_object('cost_usd', v_cost, 'cap_usd', v_cap);
end $$;
revoke all on function public.ai_budget(uuid) from public, anon, authenticated;
