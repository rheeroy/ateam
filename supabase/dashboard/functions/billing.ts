// functions/_shared/http.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var HttpError = class extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}
function serve(handler) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      const known = msg.match(/(INSUFFICIENT_CREDITS|CORE_LIMIT|PLAN_FEATURE|PLAN_LIMIT_\w+|forbidden)/);
      if (known) return json({ error: known[1], message: msg }, known[1] === "forbidden" ? 403 : 402);
      console.error(e);
      return json({ error: "INTERNAL", message: msg }, 500);
    }
  });
}
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "BAD_JSON");
  }
}

// functions/_shared/supabase.ts
import { createClient } from "npm:@supabase/supabase-js@2";
var URL = Deno.env.get("SUPABASE_URL");
var ANON = Deno.env.get("SUPABASE_ANON_KEY");
var SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
var admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false }
});
async function getCaller(req) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "UNAUTHENTICATED");
  if (token === SERVICE) return { userId: null, isService: true, client: admin };
  const client = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false }
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "UNAUTHENTICATED");
  return { userId: data.user.id, isService: false, client };
}

// functions/billing/index.ts
var TOSS = "https://api.tosspayments.com/v1";
var VAT = 0.1;
var TOPUP_PACKS = {
  "100": { credits: 100, price: 6900 },
  "300": { credits: 300, price: 19900 }
};
function tossAuth() {
  const key = Deno.env.get("TOSS_SECRET_KEY");
  if (!key) throw new HttpError(500, "BILLING_NOT_CONFIGURED", "TOSS_SECRET_KEY \uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4");
  return "Basic " + btoa(key + ":");
}
async function toss(path, body) {
  const res = await fetch(TOSS + path, {
    method: "POST",
    headers: { Authorization: tossAuth(), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(402, "PAYMENT_FAILED", data?.message ?? `toss ${res.status}`);
  return data;
}
var withVat = (n) => Math.round(n * (1 + VAT));
var addPeriod = (from, cycle) => {
  const d = new Date(from);
  if (cycle === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
};
async function charge(sub, billingKey, kind, amount, orderName) {
  const orderId = `fs-${kind}-${crypto.randomUUID()}`;
  const { data: pay } = await admin.from("payments").insert({
    subscription_id: sub.id,
    owner_id: sub.owner_id,
    kind,
    order_id: orderId,
    order_name: orderName,
    amount_krw: amount
  }).select().single();
  try {
    const r = await toss(`/billing/${billingKey}`, { customerKey: sub.customer_key, amount, orderId, orderName });
    await admin.from("payments").update({
      status: "done",
      paid_at: r.approvedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      receipt_url: r.receipt?.url ?? null,
      raw: r
    }).eq("id", pay.id);
    return true;
  } catch (e) {
    await admin.from("payments").update({ status: "failed", failure_reason: e.message }).eq("id", pay.id);
    throw e;
  }
}
async function getSub(ownerId) {
  const { data } = await admin.from("subscriptions").select("*").eq("owner_id", ownerId).maybeSingle();
  if (data) return data;
  const { data: created, error } = await admin.from("subscriptions").insert({
    owner_id: ownerId,
    plan_id: "free",
    status: "active",
    current_period_end: new Date(Date.now() + 3650 * 864e5).toISOString()
  }).select().single();
  if (error) throw error;
  return created;
}
serve(async (req) => {
  const b = await readJson(req);
  const caller = await getCaller(req);
  if (b.action === "renew_due") {
    if (!caller.isService) throw new HttpError(403, "forbidden");
    const { data: due } = await admin.from("subscriptions").select("*, plans(*)").in("status", ["active", "past_due"]).neq("plan_id", "free").lte("current_period_end", (/* @__PURE__ */ new Date()).toISOString());
    const out = {};
    for (const s of due ?? []) {
      if (s.cancel_at_period_end) {
        await admin.from("subscriptions").update({ status: "canceled" }).eq("id", s.id);
        out[s.id] = "canceled";
        continue;
      }
      const { data: sec } = await admin.from("billing_secrets").select("billing_key").eq("subscription_id", s.id).maybeSingle();
      if (!sec) {
        await admin.from("subscriptions").update({ status: "past_due" }).eq("id", s.id);
        out[s.id] = "no_key";
        continue;
      }
      const plan = s.plans;
      const price = s.billing_cycle === "year" ? plan.price_year_krw : plan.price_month_krw;
      try {
        await charge(s, sec.billing_key, "subscription", withVat(price), `ATEAM ${plan.name} ${s.billing_cycle === "year" ? "\uC5F0\uAC04" : "\uC6D4\uAC04"}`);
        await admin.from("subscriptions").update({
          status: "active",
          current_period_start: s.current_period_end,
          current_period_end: addPeriod(new Date(s.current_period_end), s.billing_cycle)
        }).eq("id", s.id);
        out[s.id] = "renewed";
      } catch (e) {
        await admin.from("subscriptions").update({ status: "past_due" }).eq("id", s.id);
        out[s.id] = "failed: " + e.message;
      }
    }
    return json(out);
  }
  if (caller.isService || !caller.userId) throw new HttpError(403, "forbidden");
  const sub = await getSub(caller.userId);
  if (b.action === "customer_key") return json({ customerKey: sub.customer_key });
  if (b.action === "subscribe") {
    if (!b.authKey || !b.plan_id) throw new HttpError(400, "MISSING_PARAMS");
    const { data: plan } = await admin.from("plans").select("*").eq("id", b.plan_id).eq("active", true).maybeSingle();
    if (!plan || plan.id === "free") throw new HttpError(400, "BAD_PLAN");
    const cycle = b.cycle === "year" ? "year" : "month";
    const issued = await toss("/billing/authorizations/issue", { authKey: b.authKey, customerKey: sub.customer_key });
    const billingKey = issued.billingKey;
    await admin.from("billing_secrets").upsert({ subscription_id: sub.id, billing_key: billingKey, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    const price = cycle === "year" ? plan.price_year_krw : plan.price_month_krw;
    await charge(sub, billingKey, "subscription", withVat(price), `ATEAM ${plan.name} ${cycle === "year" ? "\uC5F0\uAC04" : "\uC6D4\uAC04"}`);
    const now = /* @__PURE__ */ new Date();
    const cardNo = issued.cardNumber ?? issued.card?.number ?? "";
    const { data: updated } = await admin.from("subscriptions").update({
      plan_id: plan.id,
      status: "active",
      billing_cycle: cycle,
      trial_ends_at: null,
      cancel_at_period_end: false,
      current_period_start: now.toISOString(),
      current_period_end: addPeriod(now, cycle),
      card_company: issued.cardCompany ?? issued.card?.issuerCode ?? null,
      card_last4: cardNo.replace(/\D/g, "").slice(-4) || null
    }).eq("id", sub.id).select().single();
    await admin.from("credit_balances").delete().eq("owner_id", caller.userId);
    return json(updated);
  }
  if (b.action === "topup") {
    const pack = TOPUP_PACKS[b.pack ?? ""];
    if (!pack) throw new HttpError(400, "BAD_PACK");
    const { data: sec } = await admin.from("billing_secrets").select("billing_key").eq("subscription_id", sub.id).maybeSingle();
    if (!sec) throw new HttpError(400, "NO_CARD", "\uB4F1\uB85D\uB41C \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
    await charge(sub, sec.billing_key, "topup", withVat(pack.price), `ATEAM \uCD94\uAC00 \uD06C\uB808\uB527 ${pack.credits}`);
    await admin.rpc("grant_topup", { p_owner: caller.userId, p_credits: pack.credits });
    return json({ ok: true, credits: pack.credits });
  }
  if (b.action === "cancel" || b.action === "resume") {
    const { data } = await admin.from("subscriptions").update({ cancel_at_period_end: b.action === "cancel" }).eq("id", sub.id).select().single();
    return json(data);
  }
  throw new HttpError(400, "UNKNOWN_ACTION");
});
export {
  TOPUP_PACKS
};
