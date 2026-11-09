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
async function assertLeader(caller, teamId) {
  if (caller.isService) return;
  const { data } = await admin.from("team_members").select("role,status").eq("team_id", teamId).eq("user_id", caller.userId).maybeSingle();
  if (!data || data.role !== "leader" || data.status !== "active") throw new HttpError(403, "forbidden");
}

// functions/_shared/mail.ts
var MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN") ?? "leada.team";
var esc = (v) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function sendMail(m) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return "NO_KEY";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, ...m.text ? { text: m.text } : {}, ...m.replyTo ? { reply_to: m.replyTo } : {} })
    });
    return r.ok ? "" : `${r.status} ${(await r.text()).slice(0, 300)}`;
  } catch (e) {
    return String(e).slice(0, 300);
  }
}
function plainMail(o) {
  const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px 16px;background:#ffffff;word-break:keep-all;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:15px;line-height:1.7;color:#1f2937">
<div style="max-width:560px">
${o.paras.map(p).join("\n")}
${p(`<a href="${o.link.url}" style="color:#4f46e5;font-weight:600">${o.link.label}</a><br><span style="font-size:13px;color:#6b7280">${o.link.url}</span>`)}
${(o.after ?? []).map(p).join("\n")}
${p(o.sign ?? "Steve \uB4DC\uB9BC<br>ATEAM")}
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">ATEAM \xB7 leada.team</p>
</div></body></html>`;
  const strip = (t) => t.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [...o.paras, `${o.link.label}
${o.link.url}`, ...o.after ?? [], o.sign ?? "Steve \uB4DC\uB9BC<br>ATEAM"].map(strip).join("\n\n") + "\n\n-- \nATEAM \xB7 leada.team\n";
  return { html, text };
}

// functions/invite-mail/index.ts
var APP_URL = (Deno.env.get("APP_URL") ?? "https://app.leada.team").replace(/\/$/, "");
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var fmt = (d) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(new Date(d));
serve(async (req) => {
  const caller = await getCaller(req);
  const { token } = await readJson(req);
  if (!token || !UUID.test(token)) throw new HttpError(400, "MISSING_PARAMS");
  const { data: inv } = await admin.from("invitations").select("id, team_id, email, job_title, invited_by, accepted_at, expires_at, mailed_at, mail_count, teams(name, is_demo)").eq("token", token).maybeSingle();
  if (!inv) throw new HttpError(404, "NOT_FOUND", "\uCD08\uB300\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4");
  await assertLeader(caller, inv.team_id);
  const team = inv.teams;
  if (team?.is_demo) throw new HttpError(403, "DEMO_READONLY", "\uB370\uBAA8 \uD300\uC5D0\uC11C\uB294 \uCD08\uB300 \uBA54\uC77C\uC744 \uBCF4\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4");
  if (inv.accepted_at) throw new HttpError(409, "ACCEPTED", "\uC774\uBBF8 \uD569\uB958\uD55C \uCD08\uB300\uC785\uB2C8\uB2E4");
  if (new Date(inv.expires_at) < /* @__PURE__ */ new Date()) throw new HttpError(410, "EXPIRED", "\uB9CC\uB8CC\uB41C \uCD08\uB300\uC785\uB2C8\uB2E4. \uC0C8\uB85C \uCD08\uB300\uD574 \uC8FC\uC138\uC694");
  const recent = inv.mailed_at && Date.now() - new Date(inv.mailed_at).getTime() < 864e5;
  if (recent && (inv.mail_count ?? 0) >= 5) throw new HttpError(429, "TOO_MANY", "\uAC19\uC740 \uCD08\uB300 \uBA54\uC77C\uC740 \uD558\uB8E8 5\uBC88\uAE4C\uC9C0 \uBCF4\uB0BC \uC218 \uC788\uC2B5\uB2C8\uB2E4");
  const inviterId = caller.userId ?? inv.invited_by;
  const [{ data: prof }, { data: au }] = await Promise.all([
    admin.from("profiles").select("full_name").eq("id", inviterId).maybeSingle(),
    admin.auth.admin.getUserById(inviterId)
  ]);
  const inviter = (prof?.full_name || "\uD300\uC7A5").trim();
  const teamName = (team?.name ?? "").trim() || "\uC6B0\uB9AC \uD300";
  const link = `${APP_URL}/invite/${token}`;
  const m = plainMail({
    paras: [`\uC548\uB155\uD558\uC138\uC694.`, `<b>${esc(teamName)}</b>\uC758 ${esc(inviter)} \uD300\uC7A5\uB2D8\uC774 ATEAM\uC5D0\uC11C \uD568\uAED8 \uC77C\uD558\uC790\uACE0 \uCD08\uB300\uD588\uC2B5\uB2C8\uB2E4${inv.job_title ? ` (\uC9C1\uBB34: ${esc(inv.job_title)})` : ""}. \uC544\uB798 \uB9C1\uD06C\uB85C \uB4E4\uC5B4\uC640 <b>${esc(inv.email)}</b> \uC8FC\uC18C\uB85C \uAC00\uC785\uD558\uAC70\uB098 \uB85C\uADF8\uC778\uD558\uBA74 \uBC14\uB85C \uD300\uC5D0 \uD569\uB958\uD569\uB2C8\uB2E4.`],
    link: { label: "\uCD08\uB300 \uC218\uB77D\uD558\uACE0 \uD569\uB958\uD558\uAE30", url: link },
    after: [`\uB9C1\uD06C\uB294 ${fmt(inv.expires_at)}\uAE4C\uC9C0 \uC720\uD6A8\uD558\uACE0, \uB2E4\uB978 \uBA54\uC77C \uC8FC\uC18C\uB85C\uB294 \uD569\uB958\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uCD08\uB300\uB97C \uBC1B\uC740 \uC801\uC774 \uC5C6\uB2E4\uBA74 \uC774 \uBA54\uC77C\uC740 \uBB34\uC2DC\uD558\uC154\uB3C4 \uB429\uB2C8\uB2E4.`],
    sign: `${esc(inviter)} \uD300\uC7A5\uB2D8\uC744 \uB300\uC2E0\uD574 ATEAM\uC774 \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4.<br>\uC774 \uBA54\uC77C\uC5D0 \uB2F5\uC7A5\uD558\uBA74 ${esc(inviter)} \uD300\uC7A5\uB2D8\uAED8 \uAC11\uB2C8\uB2E4.`
  });
  const err = await sendMail({
    from: `${inviter.replace(/[<>"]/g, "")} (ATEAM) <invite@${MAIL_DOMAIN}>`,
    to: inv.email,
    replyTo: au?.user?.email ?? void 0,
    subject: `${inviter} \uD300\uC7A5\uB2D8\uC774 ATEAM\uC758 ${teamName}\uC73C\uB85C \uCD08\uB300\uD588\uC2B5\uB2C8\uB2E4`,
    html: m.html,
    text: m.text
  });
  if (err) {
    console.error("invite-mail", err);
    throw new HttpError(502, "MAIL_FAILED", err === "NO_KEY" ? "\uBA54\uC77C \uBC1C\uC1A1\uC774 \uC544\uC9C1 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uB9C1\uD06C\uB97C \uBCF5\uC0AC\uD574 \uBCF4\uB0B4 \uC8FC\uC138\uC694" : "\uBA54\uC77C\uC744 \uBCF4\uB0B4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uB9C1\uD06C\uB97C \uBCF5\uC0AC\uD574 \uBCF4\uB0B4 \uC8FC\uC138\uC694");
  }
  const { data } = await admin.from("invitations").update({ mailed_at: (/* @__PURE__ */ new Date()).toISOString(), mail_count: recent ? (inv.mail_count ?? 0) + 1 : 1 }).eq("id", inv.id).select("mailed_at").single();
  return json({ ok: true, mailed_at: data?.mailed_at });
});
