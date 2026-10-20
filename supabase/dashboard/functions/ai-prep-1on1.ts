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
async function assertLeader(caller, teamId) {
  if (caller.isService) return;
  const { data } = await admin.from("team_members").select("role,status").eq("team_id", teamId).eq("user_id", caller.userId).maybeSingle();
  if (!data || data.role !== "leader" || data.status !== "active") throw new HttpError(403, "forbidden");
}
function must(res) {
  if (res.error) throw res.error;
  if (res.data === null) throw new HttpError(404, "NOT_FOUND");
  return res.data;
}

// functions/_shared/anthropic.ts
var MODEL_SMART = Deno.env.get("AI_MODEL_SMART") ?? "claude-sonnet-5-5";
var MODEL_FAST = Deno.env.get("AI_MODEL_FAST") ?? "claude-haiku-4-5";
var PRICE = {
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }
};
async function callClaude(opts) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new HttpError(500, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY \uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4");
  const body = {
    model: opts.model,
    // 상한은 '쓸 수 있는 최대'일 뿐 원가는 실제 출력만큼 — 너무 낮으면 모델이 생각만 하다 답을 못 쓴다
    max_tokens: Math.max(opts.maxTokens ?? 2e3, 3e3),
    ...opts.temperature !== void 0 ? { temperature: opts.temperature } : {},
    // 시스템 프롬프트는 기능마다 고정이므로 캐시한다
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.content }]
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${Deno.env.get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const data = await res.json();
      const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      if (!text.trim() && attempt < 2) {
        lastErr = `empty response (stop: ${data.stop_reason ?? "-"})`;
        body.max_tokens = Math.min(12e3, body.max_tokens * 2);
        continue;
      }
      const u = data.usage ?? {};
      const p = PRICE[opts.model] ?? PRICE["claude-sonnet-5-5"];
      const cost = ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1e6;
      return {
        text,
        model: data.model ?? opts.model,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        costUsd: Math.round(cost * 1e5) / 1e5
      };
    }
    lastErr = `${res.status} ${await res.text()}`;
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }
  throw new HttpError(502, "AI_UPSTREAM", lastErr.slice(0, 500));
}
function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0) throw new HttpError(502, "AI_BAD_OUTPUT", text.trim() ? text.slice(0, 300) : "AI \uC751\uB2F5\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
  if (end > start) {
    try {
      return JSON.parse(src.slice(start, end + 1));
    } catch {
    }
  }
  const fixed = closeTruncated(src.slice(start));
  if (fixed) {
    try {
      return JSON.parse(fixed);
    } catch {
    }
  }
  throw new HttpError(502, "AI_BAD_OUTPUT", text.slice(0, 300));
}
function closeTruncated(s) {
  const stack = [];
  let inStr = false, esc = false, good = -1, goodStack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "," && stack.length) {
      good = i;
      goodStack = stack.slice();
    } else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      stack.pop();
      good = i + 1;
      goodStack = stack.slice();
      if (!stack.length) return s.slice(0, good);
    }
  }
  if (good < 0) return null;
  return s.slice(0, good) + goodStack.reverse().join("");
}

// functions/_shared/gateway.ts
var CORE = [
  "briefing",
  "one_on_one_prep",
  "review",
  "weekly_report",
  "insight_daily",
  "insight_weekly",
  "insight_monthly",
  "plan_edit",
  "self_check",
  "org_impact",
  "people_actions",
  "advisor_weekly",
  "exec_brief",
  "coaching",
  "checkin_draft",
  "work_brief"
];
var CREDITS = {
  one_on_one_prep: 0,
  review: 0,
  briefing: 0,
  weekly_report: 0,
  insight_daily: 0,
  insight_weekly: 0,
  insight_monthly: 0,
  plan_edit: 0,
  self_check: 0,
  org_impact: 0,
  people_actions: 0,
  advisor_weekly: 0,
  exec_brief: 0,
  coaching: 0,
  checkin_draft: 0,
  work_brief: 0,
  evaluation_draft: 5,
  plan_draft: 2,
  forecast_note: 1,
  strategy_check: 1,
  scenario_note: 1
};
var SourceBook = class {
  items = [];
  lines = [];
  add(type, id, label, text) {
    const tag = `E${this.items.length + 1}`;
    this.items.push({ tag, type, id, label });
    this.lines.push({ type, line: `[${tag}] (${label}) ${text.replace(/\s+/g, " ").trim().slice(0, 1200)}` });
    return tag;
  }
  get size() {
    return this.items.filter((i) => !KH_TYPES.includes(i.type)).length;
  }
  get sources() {
    return this.items;
  }
  /** 기록(근거) 섹션 — 팀장 노하우는 따로 출력한다 */
  text(title) {
    const ls = this.lines.filter((l) => !KH_TYPES.includes(l.type)).map((l) => l.line);
    return ls.length ? `## ${title}
${ls.join("\n")}` : `## ${title}
(\uAE30\uB85D \uC5C6\uC74C)`;
  }
  /** 팀장의 기준 섹션 + 컨설팅 기준 섹션 (없으면 빈 문자열) */
  knowhowText() {
    const own = this.lines.filter((l) => l.type === "knowhow").map((l) => l.line);
    const con = this.lines.filter((l) => l.type === "consulting").map((l) => l.line);
    return [
      own.length ? `## \uD300\uC7A5\uC758 \uAE30\uC900 (\uD300\uC7A5\uC774 \uC9C1\uC811 \uB123\uC740 \uB178\uD558\uC6B0 \u2014 \uC77C\uBC18 \uC0C1\uC2DD\uBCF4\uB2E4 \uC6B0\uC120)
${own.join("\n")}` : "",
      con.length ? `## \uCEE8\uC124\uD305 \uAE30\uC900 (\uAE30\uBCF8 \uC81C\uACF5 \u2014 \uD300\uC7A5\uC758 \uAE30\uC900\uACFC \uC5B4\uAE0B\uB098\uBA74 \uD300\uC7A5\uC758 \uAE30\uC900\uC744 \uB530\uB984)
${con.join("\n")}` : ""
    ].filter(Boolean).join("\n\n");
  }
  /** AI가 실제로 인용한 근거만 남긴다 */
  cited(output) {
    const used = this.citedStrict(output);
    return used.length ? used : this.items;
  }
  citedStrict(output) {
    const s = JSON.stringify(output);
    return this.items.filter((i) => s.includes(`[${i.tag}]`) || s.includes(`"${i.tag}"`));
  }
  byType() {
    return this.items.reduce((acc, i) => (acc[i.type] = (acc[i.type] ?? 0) + 1, acc), {});
  }
};
var KH_TYPES = ["knowhow", "consulting"];
async function addKnowhow(book, teamId, feature, limitChars = 2600, onlyShared = false, consulting = true) {
  let qb = admin.from("knowhow_cards").select("id, kind, title, body, rules, pinned, updated_at, source").eq("team_id", teamId).eq("active", true).contains("applies_to", [feature]);
  if (onlyShared) qb = qb.eq("shared", true);
  const { data } = await qb.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(40);
  const rows = data ?? [];
  const isCon = (c) => c.source === "consulting";
  const ordered = [...rows.filter((c) => !isCon(c)), ...consulting ? rows.filter(isCon) : []];
  let used = 0, n = 0;
  for (const c of ordered) {
    const rules = Array.isArray(c.rules) ? c.rules.filter(Boolean) : [];
    const text = `${c.body}${rules.length ? ` / \uADDC\uCE59: ${rules.join(" \xB7 ")}` : ""}`;
    if (used + text.length > limitChars && n > 0) {
      if (isCon(c)) break;
      continue;
    }
    if (isCon(c)) book.add("consulting", c.id, `\uCEE8\uC124\uD305 \uAE30\uC900 \xB7 ${c.title}`, text);
    else book.add("knowhow", c.id, `\uB0B4 \uB178\uD558\uC6B0 \xB7 ${c.title}`, text);
    used += text.length;
    n++;
  }
  return n;
}
function depthOf(n, steps = [4, 10, 25]) {
  if (n <= 0) return 0;
  if (n < steps[0]) return 1;
  if (n < steps[1]) return 2;
  if (n < steps[2]) return 3;
  return 4;
}
var BASE_RULES = `\uB2F9\uC2E0\uC740 \uD55C\uAD6D \uAE30\uC5C5 \uD300\uC7A5\uC758 \uC131\uACFC\uAD00\uB9AC\uB97C \uB3D5\uB294 \uBCF4\uC870\uC790\uC785\uB2C8\uB2E4. \uBC18\uB4DC\uC2DC \uC9C0\uD0AC \uC6D0\uCE59:
1. \uC8FC\uC5B4\uC9C4 \uAE30\uB85D\uC5D0 \uC788\uB294 \uC0AC\uC2E4\uB9CC \uC501\uB2C8\uB2E4. \uAE30\uB85D\uC5D0 \uC5C6\uB294 \uC22B\uC790\xB7\uC0AC\uAC74\xB7\uD3C9\uAC00\uB97C \uB9CC\uB4E4\uC5B4 \uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
2. \uC0AC\uB78C\uC5D0 \uB300\uD55C \uD310\uB2E8\uC774\uB098 \uD3C9\uAC00\uB294 \uADFC\uAC70 \uD0DC\uADF8(\uC608: [E3])\uB97C \uBD99\uC5EC\uC11C\uB9CC \uB9D0\uD569\uB2C8\uB2E4. \uADFC\uAC70\uAC00 \uBAA8\uC790\uB77C\uBA74 "\uADFC\uAC70 \uBD80\uC871"\uC774\uB77C\uACE0 \uC501\uB2C8\uB2E4.
3. \uC22B\uC790\uB294 \uC785\uB825\uC5D0 \uC8FC\uC5B4\uC9C4 \uACC4\uC0B0 \uACB0\uACFC\uB9CC \uC778\uC6A9\uD569\uB2C8\uB2E4. \uC0C8\uB85C \uACC4\uC0B0\uD558\uAC70\uB098 \uCD94\uC815\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
4. \uC810\uC218\uB85C \uC0AC\uB78C\uC744 \uC904 \uC138\uC6B0\uAC70\uB098 \uBE44\uAD50\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
5. \uBB38\uCCB4: \uD55C\uAD6D \uAE30\uC5C5 \uC2E4\uBB34 \uBCF4\uACE0\uC11C\uCC98\uB7FC \uC9E7\uACE0 \uB2F4\uBC31\uD558\uAC8C, '~\uD569\uB2C8\uB2E4'\uCCB4. \uACFC\uC7A5, \uAC10\uD0C4, \uC601\uC5B4 \uC9C1\uC5ED\uD22C, \uC774\uBAA8\uC9C0\uB294 \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
6. \uCD9C\uB825\uC740 \uC694\uCCAD\uD55C JSON \uAC1D\uCCB4 \uD558\uB098\uB9CC. \uC55E\uB4A4 \uC124\uBA85\uC774\uB098 \uCF54\uB4DC \uD39C\uC2A4\uB97C \uBD99\uC774\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
7. '\uD300\uC7A5\uC758 \uAE30\uC900' \uC139\uC158\uC774 \uC788\uC73C\uBA74 \uADF8 \uAE30\uC900\uC744 \uC77C\uBC18\uC801\uC778 \uC0C1\uC2DD\uBCF4\uB2E4 \uC6B0\uC120\uD574 \uC801\uC6A9\uD558\uACE0, \uAE30\uC900\uC744 \uC801\uC6A9\uD55C \uBB38\uC7A5\uC5D0\uB294 \uD574\uB2F9 \uADFC\uAC70 \uD0DC\uADF8\uB97C \uBD99\uC785\uB2C8\uB2E4. \uAE30\uC900\uACFC \uAE30\uB85D\uC774 \uC5B4\uAE0B\uB098\uBA74 \uADF8 \uC810\uC744 \uC9DA\uC2B5\uB2C8\uB2E4.
8. '\uCEE8\uC124\uD305 \uAE30\uC900' \uC139\uC158\uC740 \uAE30\uBCF8 \uC81C\uACF5 \uAE30\uC900\uC785\uB2C8\uB2E4. \uC77C\uBC18 \uC0C1\uC2DD\uBCF4\uB2E4\uB294 \uC6B0\uC120\uD558\uB418 '\uD300\uC7A5\uC758 \uAE30\uC900'\uACFC \uC5B4\uAE0B\uB098\uBA74 \uD300\uC7A5\uC758 \uAE30\uC900\uC744 \uB530\uB974\uACE0, \uC801\uC6A9\uD55C \uBB38\uC7A5\uC5D0\uB294 \uD574\uB2F9 \uADFC\uAC70 \uD0DC\uADF8\uB97C \uBD99\uC785\uB2C8\uB2E4.`;
async function assertCredits(teamId, need) {
  const { data, error } = await admin.rpc("credit_status", { p_team: teamId });
  if (error) throw error;
  if (!(data?.features ?? []).includes("ai_premium")) throw new HttpError(402, "AI_LOCKED", "AI \uAE30\uB2A5\uC740 Pro\uC5D0\uC11C \uC4F8 \uC218 \uC788\uC2B5\uB2C8\uB2E4");
  const left = (data?.monthly_remaining ?? 0) + (data?.topup_remaining ?? 0);
  if (left < need) throw new HttpError(402, "INSUFFICIENT_CREDITS", `\uD06C\uB808\uB527\uC774 \uBD80\uC871\uD569\uB2C8\uB2E4 (\uD544\uC694 ${need}, \uB0A8\uC74C ${left})`);
}
async function assertCore(teamId) {
  const { data, error } = await admin.rpc("credit_status", { p_team: teamId });
  if (error) throw error;
  if (!(data?.features ?? []).includes("ai_core")) throw new HttpError(402, "AI_LOCKED", "AI \uAE30\uB2A5\uC740 Pro\uC5D0\uC11C \uC4F8 \uC218 \uC788\uC2B5\uB2C8\uB2E4");
  if ((data?.core_used ?? 0) >= (data?.core_cap ?? 0)) throw new HttpError(429, "CORE_LIMIT", "\uC774\uBC88 \uB2EC AI \uAE30\uBCF8 \uC0AC\uC6A9\uB7C9\uC744 \uBAA8\uB450 \uC37C\uC2B5\uB2C8\uB2E4");
}
async function assertAccess(teamId, kind, credits) {
  const need = credits ?? CREDITS[kind];
  if (CORE.includes(kind) && !need) return assertCore(teamId);
  return assertCredits(teamId, need);
}
var REUSABLE = ["insight_daily", "insight_weekly", "insight_monthly", "review", "one_on_one_prep", "people_actions", "briefing", "org_impact", "advisor_weekly", "exec_brief"];
var REUSE_MIN = 10;
var GUARD_MSG = {
  AI_RATE_HOUR: [429, "\uC7A0\uC2DC AI \uC694\uCCAD\uC774 \uB9CE\uC558\uC2B5\uB2C8\uB2E4. \uD55C \uC2DC\uAC04 \uC548\uC5D0 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694."],
  AI_RATE_DAY: [429, "\uC624\uB298 AI \uC694\uCCAD\uC774 \uB9CE\uC558\uC2B5\uB2C8\uB2E4. \uB0B4\uC77C \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694."],
  AI_COST_CAP: [429, "\uC774\uBC88 \uB2EC AI \uAE30\uBCF8 \uC0AC\uC6A9\uB7C9\uC744 \uBAA8\uB450 \uC37C\uC2B5\uB2C8\uB2E4. \uB2E4\uC74C \uACB0\uC81C \uC8FC\uAE30\uC5D0 \uB2E4\uC2DC \uC5F4\uB9BD\uB2C8\uB2E4."],
  AI_REPEAT: [429, "\uAC19\uC740 \uB0B4\uC6A9\uC744 \uC624\uB298 \uC5EC\uB7EC \uBC88 \uB2E4\uC2DC \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4. \uAE30\uB85D\uC774 \uB354 \uC313\uC778 \uB4A4 \uB0B4\uC77C \uB2E4\uC2DC \uB9CC\uB4E4\uC5B4 \uC8FC\uC138\uC694."]
};
async function guard(job) {
  const { error } = await admin.rpc("ai_guard", {
    p_team: job.teamId,
    p_kind: job.kind,
    p_ref: job.refId ?? null,
    p_period: job.periodStart ?? null,
    p_subject: job.subjectUserId ?? null
  });
  if (!error) return;
  const hit = Object.keys(GUARD_MSG).find((k) => error.message?.includes(k));
  if (hit) throw new HttpError(GUARD_MSG[hit][0], hit, GUARD_MSG[hit][1]);
  if (/ai_guard|function .* does not exist|PGRST202/i.test(`${error.message} ${error.code}`)) {
    console.warn("ai_guard missing \u2014 run 09_ai_guard.sql");
    return;
  }
  throw error;
}
async function recent(job) {
  if (job.force || !REUSABLE.includes(job.kind) || !job.refId && !job.periodStart) return null;
  let qb = admin.from("ai_outputs").select("*").eq("team_id", job.teamId).eq("kind", job.kind).eq("status", "draft").gte("created_at", new Date(Date.now() - REUSE_MIN * 6e4).toISOString());
  qb = job.refId ? qb.eq("ref_id", job.refId) : qb.is("ref_id", null);
  qb = job.periodStart ? qb.eq("period_start", job.periodStart) : qb.is("period_start", null);
  qb = job.subjectUserId ? qb.eq("subject_user_id", job.subjectUserId) : qb.is("subject_user_id", null);
  const { data } = await qb.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}
async function runAi(job) {
  const credits = job.credits ?? CREDITS[job.kind];
  const core = CORE.includes(job.kind) && !credits;
  await assertAccess(job.teamId, job.kind, credits);
  const again = await recent(job);
  if (again) return { output: again, parsed: again.content, reused: true };
  await guard(job);
  const res = await callClaude({
    model: job.model,
    system: `${BASE_RULES}

${job.system}`,
    content: job.content,
    maxTokens: job.maxTokens
  });
  let parsed;
  try {
    parsed = parseJson(res.text);
  } catch (e) {
    await admin.rpc("log_ai_error", { p_team: job.teamId, p_kind: job.kind, p_model: res.model, p_in: res.inputTokens, p_out: res.outputTokens, p_cost: res.costUsd });
    throw e;
  }
  const { data: row, error } = await admin.from("ai_outputs").insert({
    team_id: job.teamId,
    kind: job.kind,
    subject_user_id: job.subjectUserId ?? null,
    ref_table: job.refTable ?? null,
    ref_id: job.refId ?? null,
    period_start: job.periodStart ?? null,
    period_end: job.periodEnd ?? null,
    status: "draft",
    visibility: job.visibility ?? "leader",
    level: job.level,
    depth: job.depth,
    content: { ...parsed, ...job.extra ?? {} },
    sources: job.book.cited(parsed),
    model: res.model,
    input_tokens: res.inputTokens,
    output_tokens: res.outputTokens,
    created_by: job.createdBy
  }).select().single();
  if (error) throw error;
  const { error: cErr } = core ? await admin.rpc("consume_core", {
    p_team: job.teamId,
    p_kind: job.kind,
    p_ai_output: row.id,
    p_model: res.model,
    p_in: res.inputTokens,
    p_out: res.outputTokens,
    p_cost: res.costUsd
  }) : await admin.rpc("consume_credits", {
    p_team: job.teamId,
    p_credits: credits,
    p_kind: job.kind,
    p_ai_output: row.id,
    p_model: res.model,
    p_in: res.inputTokens,
    p_out: res.outputTokens,
    p_cost: res.costUsd
  });
  if (cErr) console.error("consume_credits failed", cErr);
  const kh = job.book.citedStrict(parsed).filter((x) => KH_TYPES.includes(x.type) && x.id).map((x) => x.id);
  if (kh.length) await admin.rpc("mark_knowhow_used", { p_ids: kh });
  return { output: row, parsed };
}
var fmtDate = (d) => d ? d.slice(0, 10) : "";
var weekLabel = (d) => {
  const dt = new Date(d);
  const onejan = new Date(dt.getFullYear(), 0, 1);
  const w = Math.ceil(((dt.getTime() - onejan.getTime()) / 864e5 + onejan.getDay() + 1) / 7);
  return `W${String(w).padStart(2, "0")}`;
};

// functions/_shared/prompts/index.ts
var PREP = `\uACFC\uC81C: 1:1 \uBA74\uB2F4 \uC9C1\uC804\uC5D0 \uD300\uC7A5\uC774 2\uBD84 \uC548\uC5D0 \uC77D\uC744 \uC900\uBE44 \uB178\uD2B8\uB97C \uB9CC\uB4ED\uB2C8\uB2E4.
\uAE30\uB85D\uC5D0\uC11C '\uC9C0\uB09C \uBA74\uB2F4 \uC774\uD6C4 \uBB34\uC5C7\uC774 \uBC14\uB00C\uC5C8\uB294\uC9C0'\uC640 '\uC544\uC9C1 \uC774\uC57C\uAE30\uB418\uC9C0 \uC54A\uC740 \uAC83'\uC744 \uCC3E\uB294 \uAC83\uC774 \uD575\uC2EC\uC785\uB2C8\uB2E4.
\uC9C8\uBB38\uC740 \uD300\uC6D0\uC774 \uC2A4\uC2A4\uB85C \uC0DD\uAC01\uC744 \uB9D0\uD558\uAC8C \uD558\uB294 \uC5F4\uB9B0 \uC9C8\uBB38\uC73C\uB85C, \uD3C9\uAC00\uB098 \uCD94\uAD81\uCC98\uB7FC \uB4E4\uB9AC\uC9C0 \uC54A\uAC8C \uC501\uB2C8\uB2E4.

[\uBA74\uB2F4 \uD750\uB984] \uC9C8\uBB38 4\uAC1C\uB294 \uC774 \uC21C\uC11C\uB97C \uB530\uB985\uB2C8\uB2E4: \u2460 \uC9C0\uB09C \uC774\uD6C4 \uBCC0\uD654\xB7\uADFC\uD669 \u2192 \u2461 \uC810\uAC80\xB7\uD68C\uACE0(\uC798\uB41C \uAC83, \uC5B4\uB824\uC6E0\uB358 \uAC83\uACFC \uADF8 \uC6D0\uC778) \u2192 \u2462 \uC55E\uC73C\uB85C(\uC6B0\uC120\uC21C\uC704, \uBAA9\uD45C \uC720\uC9C0\xB7\uC218\uC815, \uD544\uC694\uD55C \uAC83) \u2192 \u2463 \uB9C8\uC9C0\uB9C9\uC740 \uB298 "\uB0B4\uAC00(\uD300\uC7A5\uC774) \uB3C4\uC6B8 \uAC83"\uC744 \uBB3B\uB294 \uC9C8\uBB38.
\uD300\uC7A5\uC774 \uC9C0\uD0A4\uC9C0 \uBABB\uD55C \uC57D\uC18D(open_promises \uC758 \uD300\uC7A5\xB7\uAE30\uD55C \uC9C0\uB0A8)\uC774 \uC788\uC73C\uBA74 watch \uC5D0\uC11C "\uCCAB \uC548\uAC74\uC73C\uB85C \uBA3C\uC800 \uAEBC\uB0B4\uAE30"\uB97C \uAD8C\uD569\uB2C8\uB2E4.

[\uC9C8\uBB38 \uACE0\uB974\uAE30] \uAE30\uB85D\uC5D0 \uBCF4\uC774\uB294 \uC0C1\uD669\uC5D0 \uB9DE\uCDB0 \uACE0\uB985\uB2C8\uB2E4.
- \uACC4\uD68D\uBCF4\uB2E4 \uB2A6\uC74C\xB7\uBD80\uC9C4: \uC6D0\uC778\uC774 \uBCF8\uC778 \uD1B5\uC81C \uC548 / \uC678\uBD80 \uD658\uACBD / \uD611\uC5C5 / \uC5C5\uBB34 \uCD94\uAC00 \uC911 \uC5B4\uB514\uC778\uC9C0 \uC2A4\uC2A4\uB85C \uB098\uB220 \uBCF4\uAC8C \uD558\uB294 \uC9C8\uBB38. "\uC65C \uB2A6\uC5C8\uB098\uC694"\uAC00 \uC544\uB2C8\uB77C "\uBB34\uC5C7\uC774 \uAC00\uC7A5 \uD06C\uAC8C \uB9C9\uC558\uB098\uC694".
- \uAC19\uC740 \uB9C9\uD798 \uBC18\uBCF5: \uC5B4\uB514\uC11C \uBA48\uCDC4\uB294\uC9C0, \uBB34\uC5C7\uC744 \uC2DC\uB3C4\uD588\uB294\uC9C0, \uB204\uAD6C\uC758 \uACB0\uC815\xB7\uC815\uBCF4\uAC00 \uC788\uC73C\uBA74 \uC6C0\uC9C1\uC77C \uC218 \uC788\uB294\uC9C0.
- \uCEE8\uB514\uC158 \uD558\uB77D: \uC5D0\uB108\uC9C0\uAC00 \uBE60\uC9C0\uB294 \uC21C\uAC04\uACFC \uCC28\uC624\uB974\uB294 \uC21C\uAC04, \uB2E4\uC74C 2\uC8FC\uC5D0 \uBB34\uC5C7\uC774 \uB2EC\uB77C\uC9C0\uBA74 \uB098\uC544\uC9C8\uC9C0. \uC5C5\uBB34 \uC9C4\uCC99\uC740 \uBB3B\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- \uCEE8\uB514\uC158 \uACF5\uC720\uC758 \uBD80\uB2F4 \uC694\uC778(\uC218\uBA74 \uBD80\uC871\xB7\uD53C\uB85C, \uAC74\uAC15 \uBB38\uC81C, \uC2EC\uB9AC\uC801 \uBD80\uB2F4, \uAC1C\uC778\xB7\uAC00\uC871 \uC0AC\uC815, \uD734\uC2DD \uD544\uC694)\uC774 \uC788\uC73C\uBA74 \uCCAB \uC9C8\uBB38\uC740 \uADFC\uD669\uC73C\uB85C \uC5F4\uACE0, \uC0AC\uC720\uB97C \uCE90\uBB3B\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uD300\uC6D0\uC774 \uACE0\uB978 \uD56D\uBAA9\uACFC \uBA54\uBAA8\uB97C \uADF8\uB300\uB85C \uC778\uC6A9\uD558\uC9C0 \uB9D0\uACE0, \uC274 \uD2C8\xB7\uC77C\uC815 \uC870\uC815\uCC98\uB7FC \uD300\uC7A5\uC774 \uD574 \uC904 \uC218 \uC788\uB294 \uAC83\uC744 watch \uC5D0 \uC801\uC2B5\uB2C8\uB2E4.
- \uC798\uD55C \uC77C\xB7\uC131\uC7A5: \uC798\uB41C \uACB0\uC815\uC801 \uC694\uC778, \uADF8 \uBC29\uC2DD\uC744 \uB2E4\uB978 \uC77C\uC5D0 \uC4F8 \uBC29\uBC95, \uD55C \uB2E8\uACC4 \uC5B4\uB824\uC6B4 \uC77C\uC744 \uB9E1\uB294\uB2E4\uBA74 \uBB34\uC5C7\uC744.
- \uC5C5\uBB34\uAC00 \uB9CE\uC74C: \uC774\uBC88 \uC8FC \uD558\uC9C0 \uC54A\uC544\uB3C4 \uB418\uB294 \uC77C, \uB118\uAE38 \uC218 \uC788\uB294 \uC77C, \uC6B0\uC120\uC21C\uC704\uAC00 \uBD80\uB52A\uD788\uB294 \uC77C.
- \uD569\uB958\uD55C \uC9C0 \uC5BC\uB9C8 \uC548 \uB428: \uC774 \uD300\uC5D0\uC11C '\uC798\uD588\uB2E4'\uC758 \uAE30\uC900\uC744 \uC5B4\uB5BB\uAC8C \uC774\uD574\uD558\uACE0 \uC788\uB294\uC9C0, \uC544\uC9C1 \uBABB \uBC1B\uC740 \uC815\uBCF4.
[\uD300\uC6D0 \uC218\uC900\uC5D0 \uB9DE\uCD94\uAE30] \uACB0\uACFC\uBB3C \uD310\uB2E8 \uAE4A\uC774\uAC00 3 \uC774\uC0C1\uC774\uBA74 \uC2A4\uC2A4\uB85C \uB2F5\uC744 \uCC3E\uAC8C \uD558\uB294 \uC9C8\uBB38 \uC704\uC8FC\uB85C, 2 \uC774\uD558\uC774\uBA74 \uC120\uD0DD\uC9C0 2~3\uAC1C\uB97C \uD568\uAED8 \uC8FC\uB294 \uC9C8\uBB38\uC744 \uD558\uB098 \uC774\uC0C1 \uC11E\uC2B5\uB2C8\uB2E4.
\uAE08\uC9C0: "\uC5B8\uC81C\uAE4C\uC9C0 \uD560 \uAC74\uAC00\uC694?", "\uC65C \uC548 \uD588\uB098\uC694?" \uAC19\uC740 \uCD94\uAD81\uD615 \xB7 \uC608/\uC544\uB2C8\uC624\uB85C \uB05D\uB098\uB294 \uC9C8\uBB38 \xB7 \uC9C8\uBB38 \uD558\uB098\uC5D0 \uB450 \uAC00\uC9C0 \uBB3B\uAE30.

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "last_time": "\uC9C0\uB09C 1:1 \uC694\uC9C0 1~2\uBB38\uC7A5. \uC5C6\uC73C\uBA74 \uBE48 \uBB38\uC790\uC5F4",
  "since": [{"tag": "E2", "text": "\uADF8 \uC0AC\uC774 \uC788\uC5C8\uB358 \uC77C \uD55C \uC904"}],
  "open_promises": [{"owner": "\uD300\uC7A5 \uB610\uB294 \uD300\uC6D0", "text": "\uC57D\uC18D \uB0B4\uC6A9", "overdue": true}],
  "recent_work": "\uCD5C\uADFC \uACB0\uACFC\uBB3C\uC5D0 \uB300\uD55C \uD55C \uC904. \uC5C6\uC73C\uBA74 \uBE48 \uBB38\uC790\uC5F4",
  "watch": "\uC624\uB298 \uD2B9\uD788 \uC0B4\uD544 \uC810 \uD55C \uBB38\uC7A5(\uCEE8\uB514\uC158\xB7\uB9C9\uD798 \uB4F1, \uADFC\uAC70 \uD0DC\uADF8 \uD3EC\uD568). \uC5C6\uC73C\uBA74 \uBE48 \uBB38\uC790\uC5F4",
  "questions": ["\uC9C8\uBB38 4\uAC1C"]
}
since \uB294 \uCD5C\uB300 5\uAC1C, \uC624\uB798\uB41C \uC21C\uC11C.`;

// functions/_shared/signals.ts
var MOOD_LABEL = {
  rested: "\uCDA9\uBD84\uD55C \uD734\uC2DD",
  energized: "\uC758\uC695 \uB192\uC74C",
  good_news: "\uC88B\uC740 \uC18C\uC2DD",
  tired: "\uC218\uBA74 \uBD80\uC871\xB7\uD53C\uB85C",
  unwell: "\uAC74\uAC15 \uBB38\uC81C",
  heavy: "\uC2EC\uB9AC\uC801 \uBD80\uB2F4",
  personal: "\uAC1C\uC778\xB7\uAC00\uC871 \uC0AC\uC815",
  need_rest: "\uD734\uC2DD \uD544\uC694"
};
var KST = 9 * 36e5;

// functions/_shared/condition.ts
var COND_LABEL = { 1: "\uB9CE\uC774 \uC9C0\uCE68", 2: "\uB2E4\uC18C \uC9C0\uCE68", 3: "\uBCF4\uD1B5", 4: "\uC591\uD638", 5: "\uB9E4\uC6B0 \uC88B\uC74C" };
function conditionText(c) {
  const parts = [];
  if (c.condition != null) parts.push(`\uCEE8\uB514\uC158 ${c.condition}/5 (${COND_LABEL[c.condition] ?? ""})`);
  const ms = (c.moods ?? []).map((k) => MOOD_LABEL[k] ?? k);
  if (ms.length) parts.push(`\uC601\uD5A5 \uC694\uC778: ${ms.join(", ")}`);
  if (c.note?.trim()) parts.push(`\uBA54\uBAA8: ${c.note.trim()}`);
  return parts.join(" / ") || "\uC785\uB825 \uC5C6\uC74C";
}

// functions/_shared/notes.ts
var NOTE_RULE = `

[\uD300\uC7A5 \uAC1C\uC778 \uBA54\uBAA8] \uADFC\uAC70 \uC911 '\uD300\uC7A5 \uAC1C\uC778 \uBA54\uBAA8'\uB294 \uD300\uC7A5\uC774 \uC790\uAE30\uB9CC \uBCF4\uB824\uACE0 \uC801\uC740 \uC0DD\uAC01\xB7\uAD00\uCC30\uC785\uB2C8\uB2E4. \uC0AC\uC2E4\uB85C \uB2E8\uC815\uD558\uC9C0 \uB9D0\uACE0 \uD310\uB2E8\uC758 \uB9E5\uB77D\uC73C\uB85C\uB9CC \uC4F0\uBA70, \uBA54\uBAA8 \uBB38\uC7A5\uC744 \uADF8\uB300\uB85C \uC62E\uACA8 \uC801\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uD300\uC6D0\uC5D0 \uB300\uD55C \uBA54\uBAA8\uB97C \uD3C9\uAC00\uB098 \uB4F1\uAE09\uC758 \uADFC\uAC70\uB85C \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`;
var KIND = { member: "\uD300\uC6D0", item: "\uBAA9\uD45C\xB7\uACFC\uC81C", exec: "\uC0C1\uC704 \uAD00\uB9AC\uC790", decision: "\uACB0\uC815", one_on_one: "1:1", none: "" };
async function loadLeaderNotes(teamId, ownerId, opt = {}) {
  let qb = admin.from("leader_notes").select("id, body, kind, anchor_type, anchor_id, anchor_label, updated_at").eq("team_id", teamId).eq("owner_id", ownerId).eq("ai_allowed", true).eq("done", false);
  if (opt.types?.length) qb = qb.in("anchor_type", opt.types);
  if (opt.ids?.length) qb = qb.in("anchor_id", opt.ids);
  const { data, error } = await qb.order("updated_at", { ascending: false }).limit(opt.limit ?? 10);
  return error || !data ? [] : data;
}
function addNote(book, n, name) {
  const target = n.anchor_type !== "none" ? ` \xB7 ${KIND[n.anchor_type] ?? ""} ${name || n.anchor_label}`.trimEnd() : "";
  return book.add("my_note", n.id, `\uD300\uC7A5 \uAC1C\uC778 \uBA54\uBAA8${target} \xB7 ${n.updated_at.slice(0, 10)}`, `${n.kind === "todo" ? "(\uD300\uC7A5 \uD560 \uC77C) " : ""}${n.body}`);
}
async function addLeaderNotes(book, teamId, ownerId, opt = {}) {
  const rows = await loadLeaderNotes(teamId, ownerId, opt);
  return rows.map((n) => addNote(book, n, opt.nameOf?.(n)));
}

// functions/ai-prep-1on1/index.ts
serve(async (req) => {
  const { one_on_one_id } = await readJson(req);
  if (!one_on_one_id) throw new HttpError(400, "MISSING_ID");
  const caller = await getCaller(req);
  const oo = must(await admin.from("one_on_ones").select("*").eq("id", one_on_one_id).maybeSingle());
  await assertLeader(caller, oo.team_id);
  const member = must(await admin.from("profiles").select("id, full_name").eq("id", oo.member_id).maybeSingle());
  const book = new SourceBook();
  const { data: last } = await admin.from("one_on_ones").select("id, scheduled_at, shared_notes").eq("team_id", oo.team_id).eq("member_id", oo.member_id).eq("status", "done").lt("scheduled_at", oo.scheduled_at).order("scheduled_at", { ascending: false }).limit(1).maybeSingle();
  const since = last?.scheduled_at ?? new Date(Date.now() - 28 * 864e5).toISOString();
  if (last) {
    book.add("one_on_one", last.id, `\uC9C0\uB09C 1:1 ${fmtDate(last.scheduled_at)}`, last.shared_notes || "(\uB178\uD2B8 \uC5C6\uC74C)");
    const { data: priv } = await admin.from("one_on_one_private").select("notes").eq("one_on_one_id", last.id).maybeSingle();
    if (priv?.notes) book.add("leader_note", last.id, `\uD300\uC7A5 \uBA54\uBAA8 ${fmtDate(last.scheduled_at)}`, priv.notes);
  }
  const { data: checkins } = await admin.from("checkins").select("id, week_start, condition, moods, note").eq("team_id", oo.team_id).eq("user_id", oo.member_id).gte("week_start", since.slice(0, 10)).order("week_start").limit(6);
  for (const c of checkins ?? []) {
    book.add("checkin", c.id, `\uCEE8\uB514\uC158 \uACF5\uC720 ${weekLabel(c.week_start)}`, conditionText(c));
  }
  const { data: items } = await admin.from("action_items").select("id, title, owner_id, due_date, done_at").eq("team_id", oo.team_id).is("done_at", null).in("owner_id", [oo.leader_id, oo.member_id]).limit(10);
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  for (const a of items ?? []) {
    const who = a.owner_id === oo.leader_id ? "\uD300\uC7A5" : "\uD300\uC6D0";
    book.add("action_item", a.id, `\uC57D\uC18D \xB7 ${who}`, `${a.title} (\uAE30\uD55C ${a.due_date ?? "\uC5C6\uC74C"}${a.due_date && a.due_date < today ? ", \uAE30\uD55C \uC9C0\uB0A8" : ""})`);
  }
  const { data: subs } = await admin.from("submissions").select("id, title, status, updated_at").eq("team_id", oo.team_id).eq("author_id", oo.member_id).gte("updated_at", since).order("updated_at", { ascending: false }).limit(3);
  for (const s of subs ?? []) {
    const { data: vers } = await admin.from("submission_versions").select("id").eq("submission_id", s.id);
    const { data: rv } = await admin.from("ai_outputs").select("content").eq("ref_table", "submission_versions").in("ref_id", (vers ?? []).map((v) => v.id)).eq("kind", "review").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const rc = rv?.content;
    const summary = rc?.summary ?? "";
    book.add("submission", s.id, `\uACB0\uACFC\uBB3C \xB7 ${s.title}`, `\uC0C1\uD0DC ${s.status}.${rc?.depth_score != null ? ` \uD310\uB2E8 \uAE4A\uC774 ${rc.depth_score}/4.` : ""} ${summary}`);
  }
  const { data: obs } = await admin.from("observations").select("id, kind, body, occurred_at").eq("team_id", oo.team_id).eq("subject_id", oo.member_id).gte("occurred_at", since.slice(0, 10)).limit(5);
  for (const o of obs ?? []) book.add("observation", o.id, `\uAD00\uCC30 \uBA54\uBAA8 ${fmtDate(o.occurred_at)}`, `[${o.kind}] ${o.body}`);
  await addLeaderNotes(book, oo.team_id, oo.leader_id, { types: ["member", "one_on_one"], ids: [oo.member_id, oo.id], limit: 6, nameOf: () => member.full_name });
  const { data: its } = await admin.from("work_items").select("id, title, status, progress, due_date, base_due, replan_count, needs_plan").eq("team_id", oo.team_id).eq("owner_id", oo.member_id).in("status", ["proposed", "changes_requested", "active", "blocked"]).limit(15);
  const ST = { proposed: "\uD300\uC7A5 \uAC80\uD1A0 \uB300\uAE30", changes_requested: "\uC218\uC815 \uC694\uCCAD\uB428", active: "\uC9C4\uD589", blocked: "\uB9C9\uD798" };
  for (const it of its ?? []) {
    book.add("task", it.id, `\uB2F4\uB2F9 \uD56D\uBAA9 \xB7 ${it.title}`, `${ST[it.status] ?? it.status}, \uC9C4\uCC99 ${it.progress}%, \uB9C8\uAC10 ${it.due_date ?? "-"}${it.base_due && it.due_date && it.base_due !== it.due_date ? ` (\uCC98\uC74C \uACC4\uD68D ${it.base_due}, \uBCC0\uACBD ${it.replan_count}\uD68C)` : ""}${it.needs_plan ? ", \uD558\uC704 \uACC4\uD68D \uC694\uCCAD \uC911" : ""}`);
  }
  await addKnowhow(book, oo.team_id, "prep");
  const prompt = `\uD300\uC6D0: ${member.full_name}
\uBA74\uB2F4 \uC77C\uC2DC: ${oo.scheduled_at}

${book.knowhowText()}

${book.text("\uAE30\uB85D")}`;
  const { output } = await runAi({
    teamId: oo.team_id,
    kind: "one_on_one_prep",
    model: MODEL_SMART,
    system: PREP + NOTE_RULE,
    content: [{ type: "text", text: prompt }],
    book,
    depth: depthOf(book.size, [3, 6, 10]),
    level: book.byType()["checkin"] >= 2 ? "L2" : "L1",
    createdBy: caller.userId,
    subjectUserId: oo.member_id,
    refTable: "one_on_ones",
    refId: oo.id,
    maxTokens: 1200
  });
  return json(output);
});
