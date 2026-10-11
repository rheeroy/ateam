-- =====================================================================
-- ATEAM · 0003 billing (팀장 개인 구독 + AI 크레딧)
-- - 결제 주체는 팀장 1인. 팀원은 무료로 초대된다.
-- - 팀의 요금제 = 팀 소유자(owner_id)의 구독.
-- - AI 사용은 크레딧으로 차감: 월 기본 제공분 → 소진 후 추가 구매분 순서.
-- =====================================================================

create table public.plans (
  id               text primary key,                 -- free / pro / pro_plus
  name             text not null,
  price_month_krw  int not null,                     -- VAT 별도
  price_year_krw   int not null,
  max_members      int not null,                     -- 팀장 제외 팀원 수
  max_teams        int not null,                     -- 겸직 팀장
  monthly_credits  int not null,
  features         text[] not null,
  sort             int not null default 0,
  active           boolean not null default true
);

insert into public.plans values
  ('free',     'Free',  0,      0,       4,  1,  30,
   array['checkin','one_on_one','review_room','weekly_report','briefing','prep','ai_review'], 1, true),
  ('pro',      'Pro',   29000,  290000,  12, 1,  300,
   array['checkin','one_on_one','review_room','weekly_report','briefing','prep','ai_review',
         'perf_map','forecast','strategy','simulation','evaluation','insight','care_radar'], 2, true),
  ('pro_plus', 'Pro+',  59000,  590000,  30, 3,  800,
   array['checkin','one_on_one','review_room','weekly_report','briefing','prep','ai_review',
         'perf_map','forecast','strategy','simulation','evaluation','insight','care_radar',
         'integrations','multi_team','priority_model'], 3, true);

create type public.sub_status as enum ('trialing', 'active', 'past_due', 'canceled');

create table public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null unique references public.profiles(id) on delete cascade,
  plan_id               text not null references public.plans(id),
  status                public.sub_status not null default 'trialing',
  billing_cycle         text not null default 'month' check (billing_cycle in ('month','year')),
  trial_ends_at         timestamptz,
  current_period_start  timestamptz not null default now(),
  current_period_end    timestamptz not null default now() + interval '1 month',
  cancel_at_period_end  boolean not null default false,
  provider              text not null default 'tosspayments',
  customer_key          uuid not null default gen_random_uuid(),   -- 토스 customerKey
  card_company          text,
  card_last4            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 빌링키는 클라이언트에 절대 노출하지 않는다 (정책 없음 = service_role 전용)
create table public.billing_secrets (
  subscription_id uuid primary key references public.subscriptions(id) on delete cascade,
  billing_key     text not null,
  updated_at      timestamptz not null default now()
);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions(id) on delete set null,
  owner_id        uuid not null references public.profiles(id),
  kind            text not null check (kind in ('subscription','topup')),
  order_id        text not null unique,
  order_name      text not null,
  amount_krw      int not null,                       -- VAT 포함 결제 금액
  status          text not null default 'pending',    -- pending / done / failed / canceled
  paid_at         timestamptz,
  receipt_url     text,
  failure_reason  text,
  raw             jsonb,
  created_at      timestamptz not null default now()
);
create index on public.payments (owner_id, created_at desc);

create table public.credit_balances (
  owner_id           uuid primary key references public.profiles(id) on delete cascade,
  period_start       timestamptz not null,
  monthly_remaining  int not null,
  topup_remaining    int not null default 0,
  updated_at         timestamptz not null default now()
);

create table public.credit_ledger (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  team_id        uuid references public.teams(id) on delete set null,
  delta          int not null,
  reason         text not null check (reason in ('monthly_grant','topup','usage','refund','adjust')),
  ai_kind        text,
  ai_output_id   uuid,
  model          text,
  input_tokens   int,
  output_tokens  int,
  cost_usd       numeric(10,5),
  created_at     timestamptz not null default now()
);
create index on public.credit_ledger (owner_id, created_at desc);

alter table public.plans           enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.billing_secrets enable row level security;
alter table public.payments        enable row level security;
alter table public.credit_balances enable row level security;
alter table public.credit_ledger   enable row level security;

create policy plans_read on public.plans for select to anon, authenticated using (active);
create policy subs_own   on public.subscriptions for select to authenticated using (owner_id = auth.uid());
create policy pay_own    on public.payments for select to authenticated using (owner_id = auth.uid());
create policy cb_own     on public.credit_balances for select to authenticated using (owner_id = auth.uid());
create policy cl_own     on public.credit_ledger for select to authenticated using (owner_id = auth.uid());

create trigger t_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

-- ---------- 유효 요금제 ----------
create or replace function public.effective_plan_for_owner(p_owner uuid) returns public.plans
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p from subscriptions s join plans p on p.id = s.plan_id
      where s.owner_id = p_owner
        and s.status in ('trialing','active','past_due')
        and now() < s.current_period_end + case when s.status = 'past_due' then interval '7 days' else interval '0' end),
    (select p from plans p where p.id = 'free'));
$$;

create or replace function public.team_plan(p_team uuid) returns public.plans
language sql stable security definer set search_path = public as $$
  select public.effective_plan_for_owner((select owner_id from teams where id = p_team));
$$;

create or replace function public.team_has_feature(p_team uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_feature = any((public.team_plan(p_team)).features);
$$;

-- 월 크레딧 리셋(구독 주기 기준, 연간 결제도 월 단위로 지급)
create or replace function public._ensure_credit_period(p_owner uuid) returns public.credit_balances
language plpgsql security definer set search_path = public as $$
declare
  v_plan  plans := public.effective_plan_for_owner(p_owner);
  v_start timestamptz;
  v_sub   subscriptions;
  v_bal   credit_balances;
  v_amount int;
begin
  select * into v_sub from subscriptions where owner_id = p_owner;
  -- 구독 시작 시각을 기준으로 한 이번 달 주기의 시작
  v_start := coalesce(v_sub.current_period_start, date_trunc('month', now()));
  while v_start + interval '1 month' <= now() loop v_start := v_start + interval '1 month'; end loop;
  while v_start > now() loop v_start := v_start - interval '1 month'; end loop;

  -- 체험 기간에는 월 제공량 대신 100 크레딧만 (남용 방지)
  v_amount := case when v_sub.status = 'trialing' then least(v_plan.monthly_credits, 100) else v_plan.monthly_credits end;

  select * into v_bal from credit_balances where owner_id = p_owner for update;
  if not found then
    insert into credit_balances (owner_id, period_start, monthly_remaining)
      values (p_owner, v_start, v_amount) returning * into v_bal;
    insert into credit_ledger (owner_id, delta, reason) values (p_owner, v_amount, 'monthly_grant');
  elsif v_bal.period_start < v_start then
    update credit_balances set period_start = v_start, monthly_remaining = v_amount, updated_at = now()
      where owner_id = p_owner returning * into v_bal;
    insert into credit_ledger (owner_id, delta, reason) values (p_owner, v_amount, 'monthly_grant');
  end if;
  return v_bal;
end $$;

create or replace function public.credit_status(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_bal credit_balances; v_plan plans; v_sub subscriptions;
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select owner_id into v_owner from teams where id = p_team;
  v_bal := public._ensure_credit_period(v_owner);
  v_plan := public.effective_plan_for_owner(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  return jsonb_build_object(
    'plan_id', v_plan.id, 'plan_name', v_plan.name, 'features', to_jsonb(v_plan.features),
    'max_members', v_plan.max_members, 'monthly_credits', v_plan.monthly_credits,
    'monthly_remaining', v_bal.monthly_remaining, 'topup_remaining', v_bal.topup_remaining,
    'period_start', v_bal.period_start, 'period_end', v_bal.period_start + interval '1 month',
    'status', coalesce(v_sub.status::text, 'free'), 'trial_ends_at', v_sub.trial_ends_at,
    'is_owner', v_owner = auth.uid());
end $$;

-- AI 호출 1건의 크레딧 차감 (Edge Function이 service_role로 호출)
create or replace function public.consume_credits(
  p_team uuid, p_credits int, p_kind text, p_ai_output uuid default null,
  p_model text default null, p_in int default null, p_out int default null, p_cost numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_bal credit_balances; v_from_month int; v_from_topup int;
begin
  select owner_id into v_owner from teams where id = p_team;
  v_bal := public._ensure_credit_period(v_owner);
  select * into v_bal from credit_balances where owner_id = v_owner for update;
  if v_bal.monthly_remaining + v_bal.topup_remaining < p_credits then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;
  v_from_month := least(v_bal.monthly_remaining, p_credits);
  v_from_topup := p_credits - v_from_month;
  update credit_balances
     set monthly_remaining = monthly_remaining - v_from_month,
         topup_remaining   = topup_remaining - v_from_topup, updated_at = now()
   where owner_id = v_owner;
  insert into credit_ledger (owner_id, team_id, delta, reason, ai_kind, ai_output_id, model, input_tokens, output_tokens, cost_usd)
    values (v_owner, p_team, -p_credits, 'usage', p_kind, p_ai_output, p_model, p_in, p_out, p_cost);
  return jsonb_build_object('monthly_remaining', v_bal.monthly_remaining - v_from_month,
                            'topup_remaining', v_bal.topup_remaining - v_from_topup);
end $$;

-- 추가 크레딧 지급 (결제 완료 후 service_role)
create or replace function public.grant_topup(p_owner uuid, p_credits int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._ensure_credit_period(p_owner);
  update credit_balances set topup_remaining = topup_remaining + p_credits, updated_at = now() where owner_id = p_owner;
  insert into credit_ledger (owner_id, delta, reason) values (p_owner, p_credits, 'topup');
end $$;

revoke all on function public.consume_credits(uuid,int,text,uuid,text,int,int,numeric) from public, anon, authenticated;
revoke all on function public.grant_topup(uuid,int) from public, anon, authenticated;
revoke all on function public._ensure_credit_period(uuid) from public, anon, authenticated;
grant execute on function public.credit_status(uuid), public.team_has_feature(uuid,text), public.team_plan(uuid) to authenticated;
