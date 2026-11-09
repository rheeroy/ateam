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
  const o = origin !== void 0 ? origin : reqCtx.getStore()?.origin ?? null;
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
function serve(handler) {
  Deno.serve((req) => reqCtx.run({ demoToken: req.headers.get("x-demo-token"), auth: req.headers.get("Authorization") ?? "", origin: req.headers.get("Origin") }, async () => {
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

// functions/guide-request/index.ts
var s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
var GUIDE_URL = Deno.env.get("GUIDE_URL") ?? "https://leada.team/guide/ATEAM_guidebook.pdf";
var FROM = Deno.env.get("GUIDE_FROM") ?? `ATEAM <guide@${MAIL_DOMAIN}>`;
var REPLY_TO = Deno.env.get("GUIDE_REPLY_TO") ?? "steve@starthalf.com";
var SITE = "https://leada.team";
var guideMail = (name) => mailLayout({
  eyebrow: "\uD300\uC7A5\uB2D8\uC744 \uC704\uD55C \uAC1C\uC778\uC6A9 AI Solution",
  title: "\uC694\uCCAD\uD558\uC2E0 ATEAM \uAC00\uC774\uB4DC\uBD81\uC744<br>\uBCF4\uB0B4 \uB4DC\uB9BD\uB2C8\uB2E4",
  body: `${esc(name)} \uB2D8, ATEAM \uAC00\uC774\uB4DC\uBD81\uC744 \uC2E0\uCCAD\uD574 \uC8FC\uC154\uC11C \uAC10\uC0AC\uD569\uB2C8\uB2E4.<br><br>\uAC00\uC774\uB4DC\uBD81\uC5D0\uB294 <b>\uD300\uC7A5 \uC6B4\uC601 \uC720\uD615 TEST</b>, \uC288\uD37C\uC5D0\uC774\uC804\uD2B8\uAC00 \uD300\uC7A5\uB2D8\uC758 \uD55C \uC8FC\uB97C \uBC14\uAFB8\uB294 \uBC29\uC2DD, \uC2E4\uC81C \uD654\uBA74\uC73C\uB85C \uBCF4\uB294 \uAE30\uB2A5 \uAC00\uC774\uB4DC, <b>\uB0B4\uC77C \uBC14\uB85C \uC4F0\uB294 \uD300\uC7A5 \uC2E4\uC804 \uCCB4\uD06C\uB9AC\uC2A4\uD2B8 10</b>\uC744 \uB2F4\uC558\uC2B5\uB2C8\uB2E4.`,
  button: { label: "\uAC00\uC774\uB4DC\uBD81 \uBC1B\uAE30 (PDF)", url: GUIDE_URL },
  after: `\uC9C1\uC811 \uC368 \uBCF4\uC2DC\uB824\uBA74 \uCE74\uB4DC \uB4F1\uB85D \uC5C6\uC774 14\uC77C \uB3D9\uC548 \uBAA8\uB4E0 \uAE30\uB2A5\uC744 \uBB34\uB8CC\uB85C \uC4F8 \uC218 \uC788\uC2B5\uB2C8\uB2E4.<br><a href="${SITE}/?utm_source=guidebook_mail" style="color:#4f46e5;font-weight:700">ATEAM \uB458\uB7EC\uBCF4\uAE30 \u2192</a>`,
  foot: "\uAD81\uAE08\uD55C \uC810\uC740 \uC774 \uBA54\uC77C\uC5D0 \uBC14\uB85C \uB2F5\uC7A5\uD574 \uC8FC\uC138\uC694."
});
serve(async (req) => {
  const b = await readJson(req);
  if (b.website) return json({ ok: true, url: GUIDE_URL, emailed: false });
  const email = s(b.email, 160).toLowerCase();
  const name = s(b.name, 60), company = s(b.company, 100);
  if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, "INVALID", "\uC774\uB984 \xB7 \uD68C\uC0AC \xB7 \uC774\uBA54\uC77C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  if (!b.consent) throw new HttpError(422, "CONSENT", "\uAC1C\uC778\uC815\uBCF4 \uC218\uC9D1 \xB7 \uC774\uC6A9\uC5D0 \uB3D9\uC758\uD574 \uC8FC\uC138\uC694.");
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await admin.from("guide_requests").select("id", { count: "exact", head: true }).ilike("email", email).gte("created_at", since);
  if ((count ?? 0) >= 3) return json({ ok: true, url: GUIDE_URL, emailed: false, repeat: true });
  const { data, error } = await admin.from("guide_requests").insert({
    name,
    email,
    company,
    job_title: s(b.job_title, 60),
    team_size: s(b.team_size, 20),
    phone: s(b.phone, 30),
    consent: true,
    marketing: !!b.marketing,
    source: s(b.source, 120)
  }).select("id").single();
  if (error) throw error;
  const err = await sendMail({ from: FROM, to: email, replyTo: REPLY_TO, subject: `[ATEAM] ${name} \uB2D8, \uC694\uCCAD\uD558\uC2E0 \uAC00\uC774\uB4DC\uBD81\uC785\uB2C8\uB2E4`, html: guideMail(name) });
  await admin.from("guide_requests").update(err ? { email_error: err } : { emailed_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", data.id);
  return json({ ok: true, url: GUIDE_URL, emailed: !err });
});
