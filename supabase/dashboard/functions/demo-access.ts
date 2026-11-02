// functions/_shared/http.ts
import { AsyncLocalStorage } from "node:async_hooks";
var reqCtx = new AsyncLocalStorage();
var corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-demo-token",
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
  Deno.serve((req) => reqCtx.run({ demoToken: req.headers.get("x-demo-token"), auth: req.headers.get("Authorization") ?? "" }, async () => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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

// functions/demo-access/index.ts
var s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var MEMBER_NAME = "\uCD5C\uB2E4\uC740";
serve(async (req) => {
  const b = await readJson(req);
  if (b.action === "request") {
    if (b.website) return json({ ok: true });
    const email = s(b.email, 160).toLowerCase();
    const name = s(b.name, 60), company = s(b.company, 100);
    if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, "INVALID", "\uC774\uB984 \xB7 \uD68C\uC0AC \xB7 \uC5C5\uBB34 \uC774\uBA54\uC77C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
    if (!b.consent) throw new HttpError(422, "CONSENT", "\uAC1C\uC778\uC815\uBCF4 \uC218\uC9D1 \xB7 \uC774\uC6A9\uC5D0 \uB3D9\uC758\uD574 \uC8FC\uC138\uC694.");
    const since = new Date(Date.now() - 864e5).toISOString();
    const { count } = await admin.from("demo_requests").select("id", { count: "exact", head: true }).ilike("email", email).gte("created_at", since);
    if ((count ?? 0) >= 3) throw new HttpError(429, "TOO_MANY", "\uC774\uBBF8 \uC2E0\uCCAD\uC774 \uC811\uC218\uB410\uC2B5\uB2C8\uB2E4. \uD655\uC778 \uD6C4 \uBA54\uC77C\uB85C \uC5F0\uB77D\uB4DC\uB9B4\uAC8C\uC694.");
    const { error } = await admin.from("demo_requests").insert({
      name,
      company,
      email,
      job_title: s(b.job_title, 60),
      team_size: s(b.team_size, 20),
      phone: s(b.phone, 30),
      note: s(b.note, 1e3),
      consent: true
    });
    if (error) throw error;
    return json({ ok: true });
  }
  if (b.action === "enter" || b.action === "check") {
    const token = s(b.token, 40);
    if (!UUID.test(token)) throw new HttpError(404, "DEMO_LINK", "\uB370\uBAA8 \uB9C1\uD06C\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    const { data: row, error } = await admin.rpc("demo_token_use", { p_token: token });
    if (error) throw error;
    const r = row;
    if (!r?.id) throw new HttpError(410, "DEMO_EXPIRED", "\uB370\uBAA8 \uAE30\uAC04\uC774 \uB05D\uB0AC\uAC70\uB098 \uC544\uC9C1 \uC2B9\uC778\uB418\uC9C0 \uC54A\uC740 \uB9C1\uD06C\uC785\uB2C8\uB2E4.");
    if (b.action === "check") return json({ ok: true, expires_at: r.expires_at });
    const { data: team } = await admin.from("teams").select("id").eq("is_demo", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!team) throw new HttpError(503, "NO_DEMO", "\uB370\uBAA8 \uD300\uC774 \uC900\uBE44\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
    const { data: mem } = await admin.from("team_members").select("user_id, role, profiles(full_name)").eq("team_id", team.id).eq("status", "active");
    const list = mem ?? [];
    const pick = b.as === "member" ? list.find((m) => m.role === "member" && m.profiles?.full_name === MEMBER_NAME) ?? list.find((m) => m.role === "member") : list.find((m) => m.role === "leader");
    if (!pick) throw new HttpError(503, "NO_DEMO", "\uB370\uBAA8 \uACC4\uC815\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    const { data: u } = await admin.auth.admin.getUserById(pick.user_id);
    const email = u?.user?.email;
    if (!email) throw new HttpError(503, "NO_DEMO", "\uB370\uBAA8 \uACC4\uC815\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (le || !link?.properties?.hashed_token) throw le ?? new HttpError(500, "LINK", "\uB370\uBAA8 \uC785\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    return json({ token_hash: link.properties.hashed_token, expires_at: r.expires_at, as: b.as === "member" ? "member" : "leader", name: pick.profiles?.full_name ?? "" });
  }
  throw new HttpError(400, "BAD_ACTION");
});
