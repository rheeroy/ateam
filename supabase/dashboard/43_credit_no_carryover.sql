-- ATEAM 프리미엄 크레딧 이월 금지 (추가 구매분도 결제 주기가 끝나면 소멸) — 42_member_activity 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 프리미엄 크레딧 이월 금지 (토스페이먼츠 빌링 심사 조건: 충전한 크레딧은 다음 달로 이월 불가)
--   결제 주기가 넘어가면 월 제공분은 새로 채우고, 추가 구매분(topup)도 남은 만큼 소멸시킨다
--   요금제를 바꾼 날(billing 함수가 period_start를 1970으로 표시)은 같은 결제 안의 재지급이라 추가 구매분을 남긴다
-- =====================================================================
create or replace function public._ensure_credit_period(p_owner uuid) returns public.credit_balances
language plpgsql security definer set search_path = public as $$
declare
  v_plan  plans := public.effective_plan_for_owner(p_owner);
  v_start timestamptz; v_sub subscriptions; v_bal credit_balances; v_amount int; v_expire int;
begin
  select * into v_sub from subscriptions where owner_id = p_owner;
  v_start := coalesce(v_sub.current_period_start, date_trunc('month', now()));
  while v_start + interval '1 month' <= now() loop v_start := v_start + interval '1 month'; end loop;
  while v_start > now() loop v_start := v_start - interval '1 month'; end loop;
  v_amount := case when v_sub.status = 'trialing' and v_plan.id <> 'free' then least(v_plan.monthly_credits, 30) else v_plan.monthly_credits end;

  select * into v_bal from credit_balances where owner_id = p_owner for update;
  if not found then
    insert into credit_balances (owner_id, period_start, monthly_remaining) values (p_owner, v_start, v_amount) returning * into v_bal;
    insert into credit_ledger (owner_id, delta, reason) values (p_owner, v_amount, 'monthly_grant');
  elsif v_bal.period_start < v_start then
    v_expire := case when v_bal.period_start > timestamptz '1971-01-01' then v_bal.topup_remaining else 0 end;
    update credit_balances set period_start = v_start, monthly_remaining = v_amount,
           topup_remaining = topup_remaining - v_expire, updated_at = now()
      where owner_id = p_owner returning * into v_bal;
    if v_expire > 0 then
      insert into credit_ledger (owner_id, delta, reason) values (p_owner, -v_expire, 'adjust');
    end if;
    insert into credit_ledger (owner_id, delta, reason) values (p_owner, v_amount, 'monthly_grant');
  end if;
  return v_bal;
end $$;
