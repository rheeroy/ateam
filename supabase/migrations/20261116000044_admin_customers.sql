-- =====================================================================
-- 관리자 '고객' 화면 — 팀장(구독 주인)별 요금제 상태 · 팀 · 팀원 수 · 최근 활동 · 이번 달 AI 원가
--   · admin_customers(): 고객 목록 + 맨 위 합계 (app_admins 만)
--   · admin_customer_action(): 체험 7일 연장 · 내부 계정 지정(결제 없이 Pro+) · 내부 계정 해제
--   데모 팀 주인은 is_demo 로 표시만 하고 합계에서 뺀다
-- 다시 Run 해도 안전합니다.
-- =====================================================================

create or replace function public.admin_customers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_sum jsonb;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  with subs as (
    select s.*, p.name plan_name, p.max_members,
           coalesce((select b.period_start from credit_balances b where b.owner_id = s.owner_id), date_trunc('month', now())) period_from
      from subscriptions s join plans p on p.id = s.plan_id
  ), teams_of as (
    select t.owner_id,
           jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'is_demo', t.is_demo,
             'members', (select count(*) from team_members m where m.team_id = t.id and m.role = 'member' and m.status = 'active'))
             order by t.created_at) teams,
           bool_or(t.is_demo) is_demo,
           sum((select count(*) from team_members m where m.team_id = t.id and m.role = 'member' and m.status = 'active')) members,
           max((select max(e.created_at) from events e where e.team_id = t.id and e.created_at > now() - interval '90 days')) last_activity
      from teams t group by t.owner_id
  ), rows as (
    select s.owner_id, u.email::text email, coalesce(pr.full_name, '') name, u.created_at signed_up_at, u.last_sign_in_at,
           s.plan_id, s.plan_name, s.status::text status, s.trial_ends_at, s.current_period_end, s.billing_cycle, s.cancel_at_period_end,
           s.card_last4 is not null has_card,
           (s.current_period_end > '2090-01-01'::timestamptz) internal,
           (s.status = 'trialing' and s.trial_ends_at < now()) trial_expired,
           coalesce(tf.teams, '[]'::jsonb) teams, coalesce(tf.members, 0) members, s.max_members, coalesce(tf.is_demo, false) is_demo,
           tf.last_activity,
           (select coalesce(sum(l.cost_usd), 0) from credit_ledger l where l.owner_id = s.owner_id
              and l.reason in ('core_usage', 'ai_error', 'simbox') and l.created_at >= s.period_from) cost_usd,
           public.ai_cost_cap(s.owner_id) cap_usd
      from subs s
      join auth.users u on u.id = s.owner_id
      left join profiles pr on pr.id = s.owner_id
      left join teams_of tf on tf.owner_id = s.owner_id
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.is_demo, r.signed_up_at desc), '[]'::jsonb) into v_rows from rows r;

  select jsonb_build_object(
    'customers', count(*) filter (where not (r->>'is_demo')::boolean and not (r->>'internal')::boolean),
    'trialing',  count(*) filter (where not (r->>'is_demo')::boolean and r->>'status' = 'trialing' and not (r->>'trial_expired')::boolean),
    'paying',    count(*) filter (where not (r->>'is_demo')::boolean and r->>'status' in ('active', 'past_due') and not (r->>'internal')::boolean),
    'expired',   count(*) filter (where not (r->>'is_demo')::boolean and ((r->>'trial_expired')::boolean or r->>'status' in ('canceled', 'expired'))),
    'cost_usd',  coalesce(sum((r->>'cost_usd')::numeric) filter (where not (r->>'is_demo')::boolean), 0),
    'demo_cost_usd', coalesce(sum((r->>'cost_usd')::numeric) filter (where (r->>'is_demo')::boolean), 0),
    'by_plan', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
        select r2->>'plan_id' k, jsonb_build_object('n', count(*), 'avg_cost', round(avg((r2->>'cost_usd')::numeric), 2)) v
          from jsonb_array_elements(v_rows) r2
         where not (r2->>'is_demo')::boolean and not (r2->>'internal')::boolean
         group by r2->>'plan_id') x)
  ) into v_sum
  from jsonb_array_elements(v_rows) r;

  return jsonb_build_object('rows', v_rows, 'summary', v_sum);
end $$;
grant execute on function public.admin_customers() to authenticated;

create or replace function public.admin_customer_action(p_owner uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v subscriptions;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from subscriptions where owner_id = p_owner for update;
  if not found then raise exception 'NO_SUBSCRIPTION'; end if;
  if p_action = 'extend_trial' then
    if v.status <> 'trialing' then raise exception 'NOT_TRIAL' using errcode = 'P0001', hint = '체험 중인 고객만 연장할 수 있습니다'; end if;
    update subscriptions set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + interval '7 days',
           current_period_end = greatest(coalesce(trial_ends_at, now()), now()) + interval '7 days', updated_at = now()
     where owner_id = p_owner;
  elsif p_action = 'internal' then
    update subscriptions set plan_id = 'pro_plus', status = 'active', current_period_start = now(), current_period_end = '2099-12-31',
           trial_ends_at = null, cancel_at_period_end = false, updated_at = now()
     where owner_id = p_owner;
  elsif p_action = 'uninternal' then
    -- 내부 계정 해제: 체험 종료 상태로 (요금제를 골라야 다시 쓴다)
    update subscriptions set plan_id = 'pro_plus', status = 'trialing', trial_ends_at = now(), current_period_end = now(), updated_at = now()
     where owner_id = p_owner and current_period_end > '2090-01-01';
  else raise exception 'BAD_ACTION';
  end if;
  return (select to_jsonb(s) from subscriptions s where owner_id = p_owner);
end $$;
grant execute on function public.admin_customer_action(uuid, text) to authenticated;
