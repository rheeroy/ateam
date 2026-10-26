-- =====================================================================
-- 요금제 v3 — 팀원 수로 나눈 세 단계, 모두 팀 1개 (여러 팀은 계정을 따로 결제)
--   Starter 팀원 4명까지 ₩29,000 · Pro 10명까지 ₩49,000 · Pro+ 20명까지 ₩79,000 (월, VAT 별도 / 연간은 10개월 값)
--   · Free 없음 — 체험(14일, Pro+ 전체 · 원가 상한 $5 · 크레딧 30)이 끝나고 결제하지 않으면 '체험 종료'(잠금, 기록은 보관)
--   · Starter 는 평가 시뮬레이션 · 컨설팅 기준 DB(내 노하우의 기본 카드) 제외
--   · 원가 상한은 팀원을 한도까지 채운 팀도 한 달 내내 자동 1차 검토가 돌도록 (자동 검토는 상한의 75%까지)
--   · 기본 AI는 횟수로 막지 않는다 — 월 횟수 상한은 오작동 대비 안전선(보통의 10배)만, 실제 한도는 월 AI 원가 상한 + 하루·시간당 상한
--     팀장 화면에는 숫자 대신 '구독에 포함'과, 원가 상한에 가까워질 때만 안내 (credit_status.ai_usage_pct)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
insert into public.plans (id, name, price_month_krw, price_year_krw, max_members, max_teams, monthly_credits, features, sort, active)
values ('starter', 'Starter', 29000, 290000, 4, 1, 30, array[]::text[], 1, true) on conflict (id) do nothing;

update public.plans set name = 'Starter', price_month_krw = 29000, price_year_krw = 290000, max_members = 4, max_teams = 1,
  monthly_credits = 30, core_monthly_cap = 3000, ai_hourly_cap = 20, ai_daily_cap = 60, ai_cost_cap_usd = 8, sort = 1, active = true,
  features = array['checkin','one_on_one','review_room','goals','requests','knowhow','signals_basic','signals','ai_core','ai_premium','perf_map','forecast','strategy','simulation','insight','care_radar'] where id = 'starter';
update public.plans set name = 'Pro', price_month_krw = 49000, price_year_krw = 490000, max_members = 10, max_teams = 1,
  monthly_credits = 100, core_monthly_cap = 4000, ai_hourly_cap = 30, ai_daily_cap = 80, ai_cost_cap_usd = 14, sort = 2, active = true,
  features = array['checkin','one_on_one','review_room','goals','requests','knowhow','signals_basic','signals','ai_core','ai_premium','perf_map','forecast','strategy','simulation','insight','care_radar','evaluation','consulting_knowhow','history'] where id = 'pro';
update public.plans set name = 'Pro+', price_month_krw = 79000, price_year_krw = 790000, max_members = 20, max_teams = 1,
  monthly_credits = 200, core_monthly_cap = 6000, ai_hourly_cap = 45, ai_daily_cap = 120, ai_cost_cap_usd = 28, sort = 3, active = true,
  features = array['checkin','one_on_one','review_room','goals','requests','knowhow','signals_basic','signals','ai_core','ai_premium','perf_map','forecast','strategy','simulation','insight','care_radar','evaluation','consulting_knowhow','history'] where id = 'pro_plus';
-- 'free' 행은 '체험 종료' 상태로만 쓴다 (요금제 목록에 안 보임 · 모든 기능 잠금 · 초대 불가)
update public.plans set name = '체험 종료', price_month_krw = 0, price_year_krw = 0, max_members = 0, max_teams = 1,
  monthly_credits = 0, core_monthly_cap = 0, ai_hourly_cap = 0, ai_daily_cap = 0, ai_cost_cap_usd = 0, sort = 9, active = false,
  features = array[]::text[] where id = 'free';

-- 진행 중인 체험은 Pro+ 로 (체험은 가장 큰 요금제 전체)
update public.subscriptions set plan_id = 'pro_plus' where status = 'trialing' and plan_id in ('pro', 'free');

-- 이번 달 AI 원가 상한 — 체험은 5달러
create or replace function public.ai_cost_cap(p_owner uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when s.status = 'trialing' then least((public.effective_plan_for_owner(p_owner)).ai_cost_cap_usd, 5)
              else (public.effective_plan_for_owner(p_owner)).ai_cost_cap_usd end
    from (select (select status from subscriptions where owner_id = p_owner) as status) s;
$$;
revoke all on function public.ai_cost_cap(uuid) from public, anon, authenticated;

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

  -- 월 원가 상한 (체험 중이면 5달러 ≈ 7,250원)
  v_cap := public.ai_cost_cap(v_owner);
  select coalesce(sum(cost_usd), 0) into v_cost from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'ai_error') and created_at >= v_bal.period_start;
  if v_cost >= v_cap then
    raise exception 'AI_COST_CAP' using errcode = 'P0001';
  end if;

  -- 같은 대상 다시 만들기: 24시간에 3번까지
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
   where owner_id = v_owner and reason in ('core_usage', 'ai_error') and created_at >= v_bal.period_start;
  return jsonb_build_object('cost_usd', v_cost, 'cap_usd', v_cap);
end $$;
revoke all on function public.ai_budget(uuid) from public, anon, authenticated;

-- 새 팀: 체험은 14일, Pro+ 전체
create or replace function public.create_team(p_name text, p_mission text default '', p_job_title text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_plan plans; v_owned int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from subscriptions where owner_id = auth.uid()) then
    insert into subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (auth.uid(), 'pro_plus', 'trialing', now() + interval '14 days', now(), now() + interval '14 days');
  end if;
  v_plan := public.effective_plan_for_owner(auth.uid());
  select count(*) into v_owned from teams where owner_id = auth.uid() and not is_demo;
  if v_owned >= v_plan.max_teams then
    raise exception 'PLAN_LIMIT_TEAMS' using errcode = 'P0001', hint = v_plan.max_teams::text;
  end if;
  insert into teams (name, mission, owner_id, settings) values (p_name, coalesce(p_mission, ''), auth.uid(),
    jsonb_build_object('level_names', '["목표","과제","할 일"]'::jsonb, 'member_free_edit', false)) returning id into v_team;
  insert into team_members (team_id, user_id, role, job_title) values (v_team, auth.uid(), 'leader', coalesce(p_job_title, ''));
  perform log_event(v_team, 'team.created', 'teams', v_team);
  return v_team;
end $$;


-- 요금제 정보에 '체험 종료' 여부
create or replace function public.credit_status(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_bal credit_balances; v_plan plans; v_sub subscriptions; v_core int;
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select owner_id into v_owner from teams where id = p_team;
  v_bal := public._ensure_credit_period(v_owner);
  v_plan := public.effective_plan_for_owner(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  select count(*) into v_core from credit_ledger where owner_id = v_owner and reason = 'core_usage' and created_at >= v_bal.period_start;
  return jsonb_build_object(
    'plan_id', v_plan.id, 'plan_name', v_plan.name, 'features', to_jsonb(v_plan.features),
    'max_members', v_plan.max_members, 'monthly_credits', v_plan.monthly_credits,
    'monthly_remaining', v_bal.monthly_remaining, 'topup_remaining', v_bal.topup_remaining,
    'core_used', v_core, 'core_cap', v_plan.core_monthly_cap,
    'ai_usage_pct', case when public.ai_cost_cap(v_owner) > 0 then round(100 * (select coalesce(sum(cost_usd), 0) from credit_ledger
       where owner_id = v_owner and reason in ('core_usage', 'ai_error') and created_at >= v_bal.period_start) / public.ai_cost_cap(v_owner)) else 0 end,
    'period_start', v_bal.period_start, 'period_end', v_bal.period_start + interval '1 month',
    'status', case when v_plan.id = 'free' then 'expired' else coalesce(v_sub.status::text, 'expired') end,
    'expired', v_plan.id = 'free',
    'was_trial', v_sub.status = 'trialing' or v_sub.status is null,
    'trial_ends_at', v_sub.trial_ends_at,
    'trial_expired', v_sub.status = 'trialing' and v_sub.trial_ends_at < now(),
    'is_owner', v_owner = auth.uid());
end $$;

-- ---------- 컨설팅 기준 DB 는 Pro 부터 ----------
--   요금제에 consulting_knowhow 가 없으면 컨설팅 기준 카드를 끈다(AI가 읽지 않음). 끄기 전 상태는 locked_active 에 두었다가
--   Pro 이상으로 바뀌면 그대로 되돌린다. 팀장이 고친 카드 내용은 그대로 남는다.
alter table public.knowhow_cards add column if not exists source text not null default 'team';  -- 16_consulting_knowhow 와 같음 (먼저 안 돌렸어도 되게)
alter table public.knowhow_cards add column if not exists locked_active boolean;

-- 잠긴 동안에는 컨설팅 카드를 켤 수 없다 (켜려 하면 '되돌릴 때 켜기'로만 기억)
create or replace function public.trg_consulting_card_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'consulting' and new.active and not public.team_has_feature(new.team_id, 'consulting_knowhow') then
    new.locked_active := true;
    new.active := false;
  end if;
  return new;
end $$;
drop trigger if exists t_consulting_card_lock on public.knowhow_cards;
create trigger t_consulting_card_lock before insert or update on public.knowhow_cards for each row execute function public.trg_consulting_card_lock();

create or replace function public._sync_consulting_lock(p_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from teams where owner_id = p_owner loop
    if public.team_has_feature(r.id, 'consulting_knowhow') then
      update knowhow_cards set active = locked_active, locked_active = null where team_id = r.id and source = 'consulting' and locked_active is not null;
    else
      update knowhow_cards set locked_active = active, active = false where team_id = r.id and source = 'consulting' and locked_active is null;
    end if;
  end loop;
end $$;
revoke all on function public._sync_consulting_lock(uuid) from public, anon, authenticated;

-- 요금제가 바뀔 때마다 (가입 · 변경 · 체험 시작)
create or replace function public.trg_sub_consulting_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._sync_consulting_lock(new.owner_id);
  return new;
end $$;
drop trigger if exists t_sub_consulting_lock on public.subscriptions;
create trigger t_sub_consulting_lock after insert or update of plan_id, status on public.subscriptions
  for each row execute function public.trg_sub_consulting_lock();

-- '컨설팅 기준 다시 받기'는 Pro 부터
create or replace function public.restore_consulting_cards(p_team uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden'; end if;
  if not public.team_has_feature(p_team, 'consulting_knowhow') then raise exception 'PLAN_FEATURE' using errcode = 'P0001'; end if;
  return public._install_consulting_cards(p_team);
end $$;
grant execute on function public.restore_consulting_cards(uuid) to authenticated;

-- 지금 있는 팀장 전부 맞추기
do $$ declare r record; begin
  for r in select distinct owner_id from public.teams loop perform public._sync_consulting_lock(r.owner_id); end loop;
end $$;

