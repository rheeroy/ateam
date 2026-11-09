// functions/_shared/http.ts
import { AsyncLocalStorage } from "node:async_hooks";
var reqCtx = new AsyncLocalStorage();
var ORIGINS = (Deno.env.get("APP_ORIGIN") ?? "*").split(",").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean);
function allowOrigin(origin) {
  if (!ORIGINS.length || ORIGINS.includes("*")) return "*";
  if (origin && ORIGINS.includes(origin.replace(/\/$/, ""))) return origin;
  return ORIGINS[0];
}
var BASE_CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-demo-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function cors(origin) {
  const store = reqCtx.getStore();
  if (store?.anyOrigin) return { ...BASE_CORS, "Access-Control-Allow-Origin": "*" };
  const o = origin !== void 0 ? origin : store?.origin ?? null;
  return { ...BASE_CORS, "Access-Control-Allow-Origin": allowOrigin(o), Vary: "Origin" };
}
var corsHeaders = { ...BASE_CORS, "Access-Control-Allow-Origin": allowOrigin(null) };
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
    headers: { ...cors(), "Content-Type": "application/json; charset=utf-8" }
  });
}
function serve(handler, opts = {}) {
  Deno.serve((req) => reqCtx.run({ demoToken: req.headers.get("x-demo-token"), auth: req.headers.get("Authorization") ?? "", origin: req.headers.get("Origin"), anyOrigin: opts.anyOrigin }, async () => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req.headers.get("Origin")) });
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      const known = msg.match(/(INSUFFICIENT_CREDITS|CORE_LIMIT|PLAN_FEATURE|PLAN_LIMIT_\w+|DEMO_READONLY|forbidden)/);
      if (known) return json({ error: known[1], message: known[1] === "DEMO_READONLY" ? "\uB370\uBAA8\uC5D0\uC11C\uB294 \uD560 \uC218 \uC5C6\uB294 \uC791\uC5C5\uC785\uB2C8\uB2E4" : msg }, known[1] === "forbidden" || known[1] === "DEMO_READONLY" ? 403 : 402);
      console.error(e);
      return json({ error: "INTERNAL", message: msg }, 500);
    }
  }));
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

// functions/_shared/mail.ts
var MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN") ?? "leada.team";
var COMPANY_LINE = "\uAC13\uC0DD\uB9F5(STARTHALF) \xB7 \uB300\uD45C \uC774\uACBD\uD6C8 \xB7 \uC0AC\uC5C5\uC790\uB4F1\uB85D\uBC88\uD638 553-65-00667 \xB7 \uC11C\uC6B8\uD2B9\uBCC4\uC2DC \uAD11\uC9C4\uAD6C \uBA74\uBAA9\uB85C 57 (\uC911\uACE1\uB3D9)";
var esc = (v) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function sendMail(m) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return "NO_KEY";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, ...m.replyTo ? { reply_to: m.replyTo } : {} })
    });
    return r.ok ? "" : `${r.status} ${(await r.text()).slice(0, 300)}`;
  } catch (e) {
    return String(e).slice(0, 300);
  }
}
function mailLayout(o) {
  return `<!doctype html><html><body style="margin:0;word-break:keep-all;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0B0F1E;padding:32px 32px 28px">
  <div style="font-size:18px;font-weight:800;color:#ffffff">ATEAM</div>
  <div style="margin-top:22px;font-size:14px;color:#c4b5fd;font-weight:700">${o.eyebrow}</div>
  <div style="margin-top:8px;font-size:24px;line-height:1.35;font-weight:800;color:#ffffff">${o.title}</div>
</td></tr>
<tr><td style="padding:28px 32px 8px;font-size:15px;line-height:1.75;color:#334155">${o.body}</td></tr>
${o.button ? `<tr><td align="center" style="padding:20px 32px 8px"><a href="${o.button.url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 28px;border-radius:12px">${o.button.label}</a></td></tr>` : ""}
${o.after ? `<tr><td style="padding:20px 32px 28px;font-size:14px;line-height:1.75;color:#475569">${o.after}</td></tr>` : '<tr><td style="padding:12px"></td></tr>'}
<tr><td style="padding:18px 32px;background:#f8fafc;font-size:12px;line-height:1.7;color:#94a3b8">${o.foot ? `${o.foot}<br>` : ""}${COMPANY_LINE}</td></tr>
</table></td></tr></table></body></html>`;
}

// functions/demo-mail/index.ts
var APP_URL = (Deno.env.get("APP_URL") ?? "https://app.leada.team").replace(/\/$/, "");
var REPLY_TO = Deno.env.get("DEMO_REPLY_TO") ?? "steve@starthalf.com";
var fmt = (d) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(new Date(d));
serve(async (req) => {
  const caller = await getCaller(req);
  if (!caller.isService) {
    const { data: data2 } = await admin.from("app_admins").select("user_id").eq("user_id", caller.userId).maybeSingle();
    if (!data2) throw new HttpError(403, "forbidden");
  }
  const { id } = await readJson(req);
  if (!id) throw new HttpError(400, "MISSING_PARAMS");
  const { data: r } = await admin.from("demo_requests").select("id, name, email, status, token, expires_at, mailed_at, mail_count").eq("id", id).maybeSingle();
  if (!r) throw new HttpError(404, "NOT_FOUND", "\uC2E0\uCCAD\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4");
  if (r.status !== "approved" || !r.token) throw new HttpError(409, "NOT_APPROVED", "\uC2B9\uC778\uB41C \uC2E0\uCCAD\uB9CC \uBCF4\uB0BC \uC218 \uC788\uC2B5\uB2C8\uB2E4");
  if (r.expires_at && Date.parse(r.expires_at) < Date.now()) throw new HttpError(410, "EXPIRED", "\uB9C1\uD06C\uAC00 \uB9CC\uB8CC\uB410\uC2B5\uB2C8\uB2E4. 7\uC77C \uC5F0\uC7A5 \uD6C4 \uBCF4\uB0B4 \uC8FC\uC138\uC694");
  const recent = r.mailed_at && Date.now() - Date.parse(r.mailed_at) < 864e5;
  if (recent && (r.mail_count ?? 0) >= 5) throw new HttpError(429, "TOO_MANY", "\uAC19\uC740 \uC2E0\uCCAD\uC5D0\uB294 \uD558\uB8E8 5\uBC88\uAE4C\uC9C0 \uBCF4\uB0BC \uC218 \uC788\uC2B5\uB2C8\uB2E4");
  const link = `${APP_URL}/demo?t=${r.token}`;
  const until = r.expires_at ? fmt(r.expires_at) : "7\uC77C \uB4A4";
  const html = mailLayout({
    eyebrow: "\uD300\uC7A5\uB2D8\uC744 \uC704\uD55C \uAC1C\uC778\uC6A9 AI Solution",
    title: "ATEAM \uB370\uBAA8\uAC00<br>\uC900\uBE44\uB410\uC2B5\uB2C8\uB2E4",
    body: `${esc(r.name)} \uB2D8, \uB370\uBAA8\uB97C \uC2E0\uCCAD\uD574 \uC8FC\uC154\uC11C \uAC10\uC0AC\uD569\uB2C8\uB2E4.<br><br>
\uC544\uB798 \uBC84\uD2BC\uC744 \uB204\uB974\uBA74 <b>6\uAC1C\uC6D4\uCE58 \uAE30\uB85D\uC774 \uC313\uC778 \uB370\uBAA8 \uD300</b>\uC73C\uB85C \uBC14\uB85C \uB4E4\uC5B4\uAC11\uB2C8\uB2E4. \uC704\uCABD \uB760\uC5D0\uC11C \uD300\uC7A5 \uD654\uBA74\uACFC \uD300\uC6D0 \uD654\uBA74\uC744 \uC624\uAC00\uBA70 \uB458\uB7EC\uBCF4\uC2E4 \uC218 \uC788\uC5B4\uC694.`,
    button: { label: "\uB370\uBAA8 \uD300 \uB4E4\uC5B4\uAC00\uAE30", url: link },
    after: `\xB7 \uB9C1\uD06C\uB294 <b>${until}</b>\uAE4C\uC9C0 \uC4F8 \uC218 \uC788\uC2B5\uB2C8\uB2E4.<br>
\xB7 AI \uAE30\uB2A5\uC740 \uAE30\uB2A5\uB9C8\uB2E4 \uD55C \uBC88\uC529 \uC9C1\uC811 \uC2E4\uD589\uD574 \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4.<br>
\xB7 \uB0B4 \uD300\uC73C\uB85C \uBC14\uB85C \uC2DC\uC791\uD558\uC2DC\uBA74 14\uC77C \uB3D9\uC548 \uBAA8\uB4E0 \uAE30\uB2A5\uC744 \uBB34\uB8CC\uB85C \uC4F0\uC2E4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.<br><br>
<span style="font-size:12px;color:#94a3b8">\uBC84\uD2BC\uC774 \uC5F4\uB9AC\uC9C0 \uC54A\uC73C\uBA74 \uC774 \uC8FC\uC18C\uB97C \uBCF5\uC0AC\uD574 \uBE0C\uB77C\uC6B0\uC800\uC5D0 \uBD99\uC5EC \uB123\uC73C\uC138\uC694.<br>${link}</span>`,
    foot: "\uAD81\uAE08\uD55C \uC810\uC740 \uC774 \uBA54\uC77C\uC5D0 \uBC14\uB85C \uB2F5\uC7A5\uD574 \uC8FC\uC138\uC694."
  });
  const err = await sendMail({ from: `ATEAM <demo@${MAIL_DOMAIN}>`, to: r.email, replyTo: REPLY_TO, subject: `[ATEAM] ${r.name} \uB2D8, \uB370\uBAA8 \uB9C1\uD06C\uB97C \uBCF4\uB0B4 \uB4DC\uB9BD\uB2C8\uB2E4`, html });
  if (err) {
    console.error("demo-mail", err);
    throw new HttpError(502, "MAIL_FAILED", err === "NO_KEY" ? "\uBA54\uC77C \uBC1C\uC1A1\uC774 \uC544\uC9C1 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4" : "\uBA54\uC77C\uC744 \uBCF4\uB0B4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4");
  }
  const { data } = await admin.from("demo_requests").update({ mailed_at: (/* @__PURE__ */ new Date()).toISOString(), mail_count: recent ? (r.mail_count ?? 0) + 1 : 1 }).eq("id", r.id).select("mailed_at").single();
  return json({ ok: true, mailed_at: data?.mailed_at });
});
