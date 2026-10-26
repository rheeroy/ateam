// 결제 — 토스페이먼츠 자동결제(빌링). 팀장 개인 구독 + 추가 크레딧.
// 토스페이먼츠 'API 개별 연동 키'(test_ck_/test_sk_)를 쓴다 — 결제위젯 연동 키(gck/gsk)로는 자동결제가 안 된다
//   빌링키 발급  POST /v1/billing/authorizations/issue  { authKey, customerKey }
//   자동결제 승인 POST /v1/billing/{billingKey}          { customerKey, amount, orderId, orderName }
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';

const TOSS = 'https://api.tosspayments.com/v1';
const VAT = 0.1;
export const TOPUP_PACKS: Record<string, { credits: number; price: number }> = {
  '100': { credits: 100, price: 6900 },
  '300': { credits: 300, price: 19900 },
};

function tossAuth() {
  const key = Deno.env.get('TOSS_SECRET_KEY');
  if (!key) throw new HttpError(500, 'BILLING_NOT_CONFIGURED', 'TOSS_SECRET_KEY 가 설정되지 않았습니다');
  return 'Basic ' + btoa(key + ':');
}

async function toss(path: string, body: unknown) {
  const res = await fetch(TOSS + path, {
    method: 'POST',
    headers: { Authorization: tossAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(402, 'PAYMENT_FAILED', data?.message ?? `toss ${res.status}`);
  return data;
}

const withVat = (n: number) => Math.round(n * (1 + VAT));
const addPeriod = (from: Date, cycle: string) => {
  const d = new Date(from);
  if (cycle === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
};

async function charge(sub: { id: string; owner_id: string; customer_key: string }, billingKey: string,
                      kind: 'subscription' | 'topup', amount: number, orderName: string) {
  const orderId = `ateam-${kind}-${crypto.randomUUID()}`;
  const { data: pay } = await admin.from('payments').insert({
    subscription_id: sub.id, owner_id: sub.owner_id, kind, order_id: orderId, order_name: orderName, amount_krw: amount,
  }).select().single();
  try {
    const r = await toss(`/billing/${billingKey}`, { customerKey: sub.customer_key, amount, orderId, orderName });
    await admin.from('payments').update({
      status: 'done', paid_at: r.approvedAt ?? new Date().toISOString(), receipt_url: r.receipt?.url ?? null, raw: r,
    }).eq('id', pay!.id);
    return true;
  } catch (e) {
    await admin.from('payments').update({ status: 'failed', failure_reason: (e as Error).message }).eq('id', pay!.id);
    throw e;
  }
}

async function getSub(ownerId: string) {
  const { data } = await admin.from('subscriptions').select('*').eq('owner_id', ownerId).maybeSingle();
  if (data) return data;
  const { data: created, error } = await admin.from('subscriptions').insert({
    owner_id: ownerId, plan_id: 'free', status: 'active',
    current_period_end: new Date(Date.now() + 3650 * 86400000).toISOString(),
  }).select().single();
  if (error) throw error;
  return created;
}

serve(async (req) => {
  const b = await readJson<{ action: string; authKey?: string; plan_id?: string; cycle?: 'month' | 'year'; pack?: string }>(req);
  const caller = await getCaller(req);

  // ---------- cron: 갱신 결제 ----------
  if (b.action === 'renew_due') {
    if (!caller.isService) throw new HttpError(403, 'forbidden');
    const { data: due } = await admin.from('subscriptions').select('*, plans(*)')
      .in('status', ['active', 'past_due']).neq('plan_id', 'free').lte('current_period_end', new Date().toISOString());
    const out: Record<string, string> = {};
    for (const s of due ?? []) {
      if (s.cancel_at_period_end) {
        await admin.from('subscriptions').update({ status: 'canceled' }).eq('id', s.id);
        out[s.id] = 'canceled'; continue;
      }
      const { data: sec } = await admin.from('billing_secrets').select('billing_key').eq('subscription_id', s.id).maybeSingle();
      if (!sec) { await admin.from('subscriptions').update({ status: 'past_due' }).eq('id', s.id); out[s.id] = 'no_key'; continue; }
      const plan = s.plans as { name: string; price_month_krw: number; price_year_krw: number };
      const price = s.billing_cycle === 'year' ? plan.price_year_krw : plan.price_month_krw;
      try {
        await charge(s, sec.billing_key, 'subscription', withVat(price), `ATEAM ${plan.name} ${s.billing_cycle === 'year' ? '연간' : '월간'}`);
        await admin.from('subscriptions').update({
          status: 'active', current_period_start: s.current_period_end, current_period_end: addPeriod(new Date(s.current_period_end), s.billing_cycle),
        }).eq('id', s.id);
        out[s.id] = 'renewed';
      } catch (e) {
        await admin.from('subscriptions').update({ status: 'past_due' }).eq('id', s.id);
        out[s.id] = 'failed: ' + (e as Error).message;
      }
    }
    return json(out);
  }

  if (caller.isService || !caller.userId) throw new HttpError(403, 'forbidden');
  const sub = await getSub(caller.userId);

  // ---------- 고객 키 (결제창 호출용) ----------
  if (b.action === 'customer_key') return json({ customerKey: sub.customer_key });

  // ---------- 요금제 가입 · 변경 ----------
  //   subscribe: 결제창에서 카드 등록(authKey) → 빌링키 발급 → 첫 결제
  //   change:    이미 등록된 카드(빌링키)로 바로 결제 — 요금제·주기만 바꿀 때 결제창을 다시 띄우지 않는다
  if (b.action === 'subscribe' || b.action === 'change') {
    if (!b.plan_id || (b.action === 'subscribe' && !b.authKey)) throw new HttpError(400, 'MISSING_PARAMS');
    const { data: plan } = await admin.from('plans').select('*').eq('id', b.plan_id).eq('active', true).maybeSingle();
    if (!plan || plan.id === 'free') throw new HttpError(400, 'BAD_PLAN');
    // 지금 팀원 수보다 작은 요금제는 고를 수 없다
    const { data: owned } = await admin.from('teams').select('id').eq('owner_id', caller.userId).eq('is_demo', false);
    const ids = (owned ?? []).map((t) => t.id);
    if (ids.length) {
      const { count } = await admin.from('team_members').select('user_id', { count: 'exact', head: true }).in('team_id', ids).eq('role', 'member').eq('status', 'active');
      if ((count ?? 0) > plan.max_members) throw new HttpError(400, 'PLAN_TOO_SMALL', `지금 팀원이 ${count}명이라 팀원 ${plan.max_members}명까지인 ${plan.name}은(는) 고를 수 없습니다`);
    }
    const cycle = b.cycle === 'year' ? 'year' : 'month';
    let billingKey: string;
    let card: { company: string | null; last4: string | null } | null = null;
    if (b.action === 'subscribe') {
      const issued = await toss('/billing/authorizations/issue', { authKey: b.authKey, customerKey: sub.customer_key });
      billingKey = issued.billingKey;
      await admin.from('billing_secrets').upsert({ subscription_id: sub.id, billing_key: billingKey, updated_at: new Date().toISOString() });
      const cardNo: string = issued.cardNumber ?? issued.card?.number ?? '';
      card = { company: issued.cardCompany ?? issued.card?.issuerCode ?? null, last4: cardNo.replace(/\D/g, '').slice(-4) || null };
    } else {
      const { data: sec } = await admin.from('billing_secrets').select('billing_key').eq('subscription_id', sub.id).maybeSingle();
      if (!sec) throw new HttpError(400, 'NO_CARD', '등록된 카드가 없습니다. 카드를 먼저 등록해 주세요.');
      billingKey = sec.billing_key;
    }
    const price = cycle === 'year' ? plan.price_year_krw : plan.price_month_krw;
    await charge(sub, billingKey, 'subscription', withVat(price), `ATEAM ${plan.name} ${cycle === 'year' ? '연간' : '월간'}`);
    const now = new Date();
    const { data: updated } = await admin.from('subscriptions').update({
      plan_id: plan.id, status: 'active', billing_cycle: cycle, trial_ends_at: null, cancel_at_period_end: false,
      current_period_start: now.toISOString(), current_period_end: addPeriod(now, cycle),
      ...(card ? { card_company: card.company, card_last4: card.last4 } : {}),
    }).eq('id', sub.id).select().single();
    // 새 주기 기준으로 월 크레딧을 다시 지급 — 추가 구매분(topup)은 그대로 둔다
    await admin.from('credit_balances').update({ period_start: '1970-01-01T00:00:00Z', updated_at: now.toISOString() }).eq('owner_id', caller.userId);
    return json(updated);
  }

  // ---------- 추가 크레딧 ----------
  if (b.action === 'topup') {
    const pack = TOPUP_PACKS[b.pack ?? ''];
    if (!pack) throw new HttpError(400, 'BAD_PACK');
    const { data: sec } = await admin.from('billing_secrets').select('billing_key').eq('subscription_id', sub.id).maybeSingle();
    if (!sec) throw new HttpError(400, 'NO_CARD', '등록된 카드가 없습니다');
    await charge(sub, sec.billing_key, 'topup', withVat(pack.price), `ATEAM 추가 크레딧 ${pack.credits}`);
    await admin.rpc('grant_topup', { p_owner: caller.userId, p_credits: pack.credits });
    return json({ ok: true, credits: pack.credits });
  }

  if (b.action === 'cancel' || b.action === 'resume') {
    const { data } = await admin.from('subscriptions').update({ cancel_at_period_end: b.action === 'cancel' })
      .eq('id', sub.id).select().single();
    return json(data);
  }

  throw new HttpError(400, 'UNKNOWN_ACTION');
});
