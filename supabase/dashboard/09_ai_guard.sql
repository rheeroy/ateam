-- ATEAM AI 남용·원가 방어 (시간당·하루 상한, 월 원가 상한, 같은 대상 반복 제한, 실패 호출 원가 기록) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- AI 남용·원가 방어 (과금 v2.1)
--   기존: 기본 AI 월 횟수 한도(Pro 400 · Pro+ 1,000)만 있음 → 하루에 몰아 쓰거나, 같은 걸 계속 다시 만들거나,
--         실패한 호출(파싱 오류)의 비용은 기록되지 않는 구멍이 있었다.
--   추가:
--     ① 시간당 · 하루 호출 상한 (요금제별)
--     ② 같은 대상(같은 결과물 버전 · 같은 기간 인사이트 · 같은 1on1) 다시 만들기는 하루 3번까지
--     ③ 월 AI 원가 상한(USD) — 횟수와 별개로 실제 원가 합계가 넘으면 기본 AI를 멈춤 (체험은 더 낮게)
--     ④ 실패한 호출도 원가를 남김 (reason = 'ai_error', 횟수 한도엔 안 셈)
--   10분 안에 같은 대상을 다시 누르면 AI를 다시 부르지 않고 방금 결과를 돌려준다 (Edge Function 쪽)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter table public.plans add column if not exists ai_hourly_cap int not null default 0;
alter table public.plans add column if not exists ai_daily_cap int not null default 0;
alter table public.plans add column if not exists ai_cost_cap_usd numeric not null default 0;

update public.plans set ai_hourly_cap = 0,  ai_daily_cap = 0,   ai_cost_cap_usd = 0  where id = 'free';
update public.plans set ai_hourly_cap = 30, ai_daily_cap = 80,  ai_cost_cap_usd = 10 where id = 'pro';
update public.plans set ai_hourly_cap = 60, ai_daily_cap = 200, ai_cost_cap_usd = 20 where id = 'pro_plus';

alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('monthly_grant','topup','usage','refund','adjust','core_usage','ai_error'));

create index if not exists ai_outputs_target_idx on public.ai_outputs (team_id, kind, ref_id, period_start, created_at desc);

-- AI를 부르기 직전에 확인 (Edge Function 의 service role 만 호출)
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

  -- 월 원가 상한 (체험 중이면 4달러 ≈ 5,800원)
  v_cap := case when v_sub.status = 'trialing' then least(v_plan.ai_cost_cap_usd, 4) else v_plan.ai_cost_cap_usd end;
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

-- 실패한 호출의 원가 기록 (횟수 한도엔 안 셈, 원가·속도 한도엔 셈)
create or replace function public.log_ai_error(p_team uuid, p_kind text, p_model text, p_in int, p_out int, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from teams where id = p_team;
  insert into credit_ledger (owner_id, team_id, delta, reason, ai_kind, model, input_tokens, output_tokens, cost_usd)
    values (v_owner, p_team, 0, 'ai_error', p_kind, p_model, p_in, p_out, p_cost);
end $$;
revoke all on function public.log_ai_error(uuid, text, text, int, int, numeric) from public, anon, authenticated;

-- 운영용: 팀장별 이번 달 AI 원가 (SQL Editor 에서 확인)
create or replace view public.ai_cost_by_owner as
select l.owner_id, p.full_name,
       count(*) filter (where l.reason = 'core_usage') as core_calls,
       count(*) filter (where l.reason = 'usage') as premium_calls,
       count(*) filter (where l.reason = 'ai_error') as failed_calls,
       round(coalesce(sum(l.cost_usd), 0), 3) as cost_usd,
       round(coalesce(sum(l.cost_usd), 0) * 1450) as cost_krw
  from credit_ledger l left join profiles p on p.id = l.owner_id
 where l.created_at >= date_trunc('month', now()) and l.reason in ('core_usage', 'usage', 'ai_error')
 group by l.owner_id, p.full_name
 order by cost_usd desc;
revoke all on public.ai_cost_by_owner from public, anon, authenticated;
