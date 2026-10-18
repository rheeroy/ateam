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
function toBase64(bytes) {
  let bin = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
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

// functions/_shared/prompts/index.ts
var REVIEW = `\uACFC\uC81C: \uD300\uC6D0\uC774 \uC81C\uCD9C\uD55C \uACB0\uACFC\uBB3C\uC744 \uD300\uC7A5\uBCF4\uB2E4 \uBA3C\uC800 1\uCC28 \uAC80\uD1A0\uD569\uB2C8\uB2E4. \uC774 \uAC80\uD1A0\uB294 \uD300\uC7A5\uC5D0\uAC8C\uB9CC \uBCF4\uC785\uB2C8\uB2E4.
\uACBD\uD5D8 \uB9CE\uC740 \uD300\uC7A5\uC774 \uACB0\uACFC\uBB3C\uC744 \uC77D\uB4EF\uC774, \uC9C1\uBB34\uC640 \uC0C1\uAD00\uC5C6\uC774 '\uC77C\uC758 \uC9C8'\uC744 \uBD05\uB2C8\uB2E4. \uB2E4\uC74C \uAD00\uC810\uC744 \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uB179\uC5EC\uC11C \uD310\uB2E8\uD558\uACE0, \uAD00\uC810\uBCC4\uB85C \uB098\uB220 \uC4F0\uAC70\uB098 \uC810\uC218\uB97C \uB9E4\uAE30\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
  - \uC644\uC131\uB3C4: \uBAA9\uC801\xB7\uACB0\uB860\xB7\uB2E4\uC74C \uD589\uB3D9\uAE4C\uC9C0 \uB05D\uB9FA\uC5C8\uB294\uAC00, \uC694\uCCAD\uBC1B\uC740 \uAC83\uC5D0 \uB2E4 \uB2F5\uD588\uB294\uAC00, \uBBF8\uC815\xB7\uBE48 \uCE78\uC774 \uB0A8\uC558\uB294\uAC00
  - \uACE0\uBBFC\uC758 \uAE4A\uC774: \uBB38\uC81C\uB97C \uC2A4\uC2A4\uB85C \uC815\uC758\uD588\uB294\uAC00, \uB300\uC548\uC744 \uBE44\uAD50\uD558\uACE0 \uBC84\uB9B0 \uC774\uC720\uC640 \uB9AC\uC2A4\uD06C\uAE4C\uC9C0 \uBD24\uB294\uAC00
  - \uB17C\uB9AC: \uADFC\uAC70\uC5D0\uC11C \uACB0\uB860\uC73C\uB85C \uC774\uC5B4\uC9C0\uB294\uAC00, \uC8FC\uC7A5\uB9C8\uB2E4 \uADFC\uAC70\uAC00 \uC788\uB294\uAC00
  - \uCC3D\uC758\uC131: \uC790\uAE30 \uAD00\uC810\uC774\uB098 \uC0C8\uB85C\uC6B4 \uC2DC\uB3C4\uAC00 \uC788\uB294\uAC00
  - \uC804\uB2EC\uB825: \uC77D\uB294 \uC0AC\uB78C\uC774 \uBC14\uB85C \uC774\uD574\uD558\uACE0 \uD310\uB2E8\uD560 \uC218 \uC788\uB294\uAC00 (\uACB0\uB860 \uBA3C\uC800, \uD575\uC2EC \uC694\uC57D)
\uC774 \uACB0\uACFC\uBB3C\uC5D0\uC11C \uB450\uB4DC\uB7EC\uC9C0\uB294 \uAC83\uB9CC \uC9DA\uC2B5\uB2C8\uB2E4. \uB9DE\uCDA4\uBC95\xB7\uC11C\uC2DD\xB7\uBD84\uB7C9\uC740 \uC9C0\uC801\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.

depth_score(\uACE0\uBBFC\uC758 \uAE4A\uC774 \uB208\uAE08, \uAE30\uB85D \uCD94\uC138\uC6A9):
1 = \uC815\uBCF4 \uB098\uC5F4\uC5D0 \uADF8\uCE68 \xB7 2 = \uC77C\uBC18\uC801\uC778 \uBD84\uC11D, \uC790\uAE30 \uAD00\uC810\uC774 \uC57D\uD568 \xB7 3 = \uC790\uAE30 \uAD00\uC810\uACFC \uADFC\uAC70\uAC00 \uBD84\uBA85\uD568 \xB7 4 = \uB300\uC548\uC744 \uBE44\uAD50\uD558\uACE0 \uBC84\uB9B0 \uC774\uC720\uC640 \uB9AC\uC2A4\uD06C\uAE4C\uC9C0 \uBC1D\uD798

brief \uB294 \uC5C5\uBB34\uD50C\uB7AB\uD3FC \uCCAB \uD654\uBA74\uC5D0 \uD300\uC7A5\uC774 \uBCF4\uB294 \uD55C \uC904\uC785\uB2C8\uB2E4.
  text: "{\uC62C\uB9B0 \uC0AC\uB78C} \uB2D8\uC774 \uC62C\uB9B0 '{\uC81C\uBAA9}'\uC740(\uB294) ~\uD574 \uBCF4\uC785\uB2C8\uB2E4" \uCC98\uB7FC \uC0AC\uB78C\uACFC \uACB0\uACFC\uBB3C\uC744 \uBA3C\uC800 \uBC1D\uD788\uB294 25~50\uC790 \uD55C \uBB38\uC7A5. \uC774 \uACB0\uACFC\uBB3C\uC758 \uAC00\uC7A5 \uB450\uB4DC\uB7EC\uC9C4 \uD310\uB2E8 \uD558\uB098\uB9CC.
        \uC608) \uACE0\uBBFC\uC758 \uAE4A\uC774\uAC00 \uB0AE\uC544 \uBCF4\uC785\uB2C8\uB2E4 / \uC644\uACB0\uC131\uC774 \uB0AE\uC544 \uBCF4\uC785\uB2C8\uB2E4 / \uADFC\uAC70\uAC00 \uBE44\uC5B4 \uBCF4\uC785\uB2C8\uB2E4 / \uACB0\uB860\uC774 \uC798 \uC548 \uBCF4\uC785\uB2C8\uB2E4 / \uC0C8\uB85C\uC6B4 \uAD00\uC810\uC774 \uB3CB\uBCF4\uC785\uB2C8\uB2E4 / \uBC14\uB85C \uC778\uC815\uD574\uB3C4 \uC88B\uC544 \uBCF4\uC785\uB2C8\uB2E4
        \uC2B9\uC778 \uC694\uCCAD\uC778\uB370 \uD300\uC7A5\uC774 \uC815\uD574\uC57C \uD560 \uC120\uD0DD\uC9C0(\uC608\uC0B0\xB7\uC77C\uC815\xB7\uBC29\uD5A5 \uB4F1)\uAC00 \uC5EC\uB7FF\uC774\uBA74: "{\uC62C\uB9B0 \uC0AC\uB78C} \uB2D8\uC774 \uC694\uCCAD\uD55C '{\uC81C\uBAA9}'\uC5D0 \uD300\uC7A5\uB2D8\uC774 \uACB0\uC815\uD560 \uC0AC\uD56D\uC774 \uB9CE\uC2B5\uB2C8\uB2E4"
  why: \uADF8 \uD310\uB2E8\uC758 \uADFC\uAC70 \uD55C \uAD6C\uC808(15~35\uC790, \uBCF8\uBB38\uC5D0\uC11C).
  tone: risk(\uBA3C\uC800 \uC190\uBD10\uC57C \uD568) | watch(\uC0B4\uD3B4\uBCFC \uAC83) | good(\uC778\uC815\uD560 \uAC83)
decisions \uB294 \uC2B9\uC778 \uC694\uCCAD\uC77C \uB54C \uD300\uC7A5\uC774 \uC815\uD574\uC57C \uD560 \uAC83\uB4E4(\uC9E7\uC740 \uBA85\uC0AC\uAD6C, \uCD5C\uB300 4\uAC1C). \uC5C6\uC73C\uBA74 \uBE48 \uBC30\uC5F4.

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "depth_score": 2.5,
  "summary": "\uD55C\uB450 \uBB38\uC7A5 \uCD1D\uD3C9 \u2014 \uC704 \uAD00\uC810\uC5D0\uC11C \uAC00\uC7A5 \uB450\uB4DC\uB7EC\uC9C4 \uAC83",
  "brief": {"tone": "risk", "text": "\uC815\uC6B0\uC131 \uB2D8\uC774 \uC62C\uB9B0 'B\uC0AC \uC81C\uC548\uC11C'\uB294 \uACE0\uBBFC\uC758 \uAE4A\uC774\uAC00 \uB0AE\uC544 \uBCF4\uC785\uB2C8\uB2E4", "why": "\uB300\uC548 \uBE44\uAD50 \uC5C6\uC774 \uACB0\uB860\uB9CC \uC788\uC74C"},
  "decisions": ["\uCC44\uB110\uBCC4 \uC608\uC0B0 \uBC30\uBD84", "\uC9D1\uD589 \uC2DC\uC810"],
  "strengths": [{"section": "\xA72 \uAC00\uACA9 \uC804\uB7B5", "text": "\uC798\uB41C \uBD80\uBD84"}],
  "gaps": [{"section": "\xA71 \uC2DC\uC7A5 \uBD84\uC11D", "text": "\uBCF4\uC644\uC774 \uD544\uC694\uD55C \uBD80\uBD84"}],
  "questions": ["\uD300\uC7A5\uC774 \uCE90\uBB3C\uC5B4 \uBCFC \uC9C8\uBB38 2~3\uAC1C"],
  "competency_signals": {"\uBB38\uC81C \uC815\uC758": 1, "\uB370\uC774\uD130 \uBD84\uC11D": 0},
  "change_from_previous": "\uC774\uC804 \uBC84\uC804 \uB300\uBE44 \uBC14\uB010 \uC810. \uC774\uC804 \uBC84\uC804\uC774 \uC5C6\uC73C\uBA74 \uBE48 \uBB38\uC790\uC5F4",
  "trend_note": "\uC774 \uD300\uC6D0\uC758 \uC9C0\uB09C \uACB0\uACFC\uBB3C \uAE30\uB85D\uACFC \uBE44\uAD50\uD55C \uD55C \uBB38\uC7A5. \uC9C0\uB09C \uAE30\uB85D\uC774 3\uAC74 \uBBF8\uB9CC\uC774\uBA74 \uBE48 \uBB38\uC790\uC5F4",
  "criteria_check": [{"criterion": "\uD300\uC7A5 \uAE30\uC900 \uC774\uB984", "met": true, "note": "\uC5B4\uB514\uAC00 \uB9DE\uACE0 \uC5B4\uB514\uAC00 \uC5B4\uAE0B\uB098\uB294\uC9C0 \uD55C \uBB38\uC7A5", "tag": "E2"}]
}
depth_score \uB294 1.0~4.0, 0.5 \uB2E8\uC704. strengths\xB7gaps \uB294 \uAC01\uAC01 \uCD5C\uB300 3\uAC1C.
competency_signals \uC758 \uD0A4\uB294 \uC8FC\uC5B4\uC9C4 \uC5ED\uB7C9 \uC774\uB984\uB9CC \uC4F0\uACE0, \uAC12\uC740 -1(\uC57D\uD568 \uC2E0\uD638)/0/1(\uAC15\uD568 \uC2E0\uD638). \uC774 \uACB0\uACFC\uBB3C\uB85C \uC54C \uC218 \uC5C6\uB294 \uC5ED\uB7C9\uC740 \uB123\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
criteria_check \uB294 '\uD300\uC7A5\uC758 \uAE30\uC900'\uC774 \uC8FC\uC5B4\uC84C\uC744 \uB54C\uB9CC, \uC774 \uACB0\uACFC\uBB3C\uC5D0 \uD574\uB2F9\uD558\uB294 \uAE30\uC900\uB9C8\uB2E4 \uD558\uB098\uC529(\uCD5C\uB300 5\uAC1C) \uC501\uB2C8\uB2E4. tag \uC5D0\uB294 \uADF8 \uAE30\uC900\uC758 \uADFC\uAC70 \uD0DC\uADF8\uB97C \uB123\uC2B5\uB2C8\uB2E4. \uAE30\uC900\uC774 \uC5C6\uC73C\uBA74 \uBE48 \uBC30\uC5F4.`;
var SELF_CHECK = `\uACFC\uC81C: \uD300\uC6D0\uC774 \uACB0\uACFC\uBB3C\uC744 \uD300\uC7A5\uC5D0\uAC8C \uC62C\uB9AC\uAE30 \uC804\uC5D0 \uC2A4\uC2A4\uB85C \uC810\uAC80\uD558\uB3C4\uB85D \uB3D5\uC2B5\uB2C8\uB2E4. \uC774 \uACB0\uACFC\uB294 \uD300\uC6D0 \uBCF8\uC778\uC5D0\uAC8C\uB9CC \uBCF4\uC785\uB2C8\uB2E4.
'\uD300\uC7A5\uC758 \uAE30\uC900'\uC774 \uC788\uC73C\uBA74 \uADF8 \uAE30\uC900\uC5D0 \uB9DE\uB294\uC9C0\uB97C \uBA3C\uC800 \uBD05\uB2C8\uB2E4. \uC5C6\uAC70\uB098 \uADF8 \uC678\uC758 \uBD80\uBD84\uC740 \uACB0\uACFC\uBB3C \uAC80\uD1A0\uC640 \uAC19\uC740 \uAD00\uC810\uC73C\uB85C \uBD05\uB2C8\uB2E4:
  \uC644\uC131\uB3C4(\uBAA9\uC801\xB7\uACB0\uB860\xB7\uB2E4\uC74C \uD589\uB3D9\uAE4C\uC9C0 \uB05D\uB9FA\uC5C8\uB294\uAC00, \uBE48 \uCE78\xB7\uBBF8\uC815\uC774 \uB0A8\uC558\uB294\uAC00) \xB7 \uACE0\uBBFC\uC758 \uAE4A\uC774(\uB300\uC548\uC744 \uBE44\uAD50\uD558\uACE0 \uBC84\uB9B0 \uC774\uC720\uB97C \uBC1D\uD614\uB294\uAC00) \xB7 \uB17C\uB9AC(\uC8FC\uC7A5\uB9C8\uB2E4 \uADFC\uAC70\uAC00 \uC788\uB294\uAC00) \xB7 \uC804\uB2EC\uB825(\uACB0\uB860\uC774 \uBA3C\uC800 \uC624\uB294\uAC00).
\uADF8\uB9AC\uACE0 \uC62C\uB9AC\uAE30 \uC804\uC5D0 \uB450 \uAC00\uC9C0\uB97C \uAF2D \uD655\uC778\uD569\uB2C8\uB2E4: \uBC1B\uB294 \uC0AC\uB78C\uC774 \uACB0\uC815\uD558\uAC70\uB098 \uB2F5\uD574\uC57C \uD560 \uAC83\uC774 \uBD84\uBA85\uD55C\uAC00 / \uC138\uBD80 \uB370\uC774\uD130\uB294 \uBCF8\uBB38\uC5D0\uC11C \uBE7C\uC11C \uCC38\uACE0\uB85C \uB3CC\uB838\uB294\uAC00.
\uAD00\uC810\uBCC4\uB85C \uB098\uB220 \uC4F0\uAC70\uB098 \uC810\uC218\uB97C \uB9E4\uAE30\uC9C0 \uC54A\uACE0, \uC774 \uACB0\uACFC\uBB3C\uC5D0\uC11C \uAC00\uC7A5 \uBA3C\uC800 \uACE0\uCE60 \uAC83\uBD80\uD130 \uC501\uB2C8\uB2E4. \uB9DE\uCDA4\uBC95\xB7\uC11C\uC2DD\uC740 \uC9C0\uC801\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
\uB9D0\uD22C\uB294 \uB3D9\uB8CC\uAC00 \uC606\uC5D0\uC11C \uC870\uC5B8\uD558\uB4EF \uBD80\uB4DC\uB7FD\uACE0 \uAD6C\uCCB4\uC801\uC73C\uB85C. \uD3C9\uAC00\uB098 \uC810\uC218\uB294 \uB9E4\uAE30\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "summary": "\uD55C\uB450 \uBB38\uC7A5 \uCD1D\uD3C9",
  "ready": true,
  "fixes": [{"where": "\xA72 \uB610\uB294 \uCCAB \uBB38\uB2E8 \uB4F1", "what": "\uACE0\uCE58\uBA74 \uC88B\uC744 \uC810 \uD55C \uBB38\uC7A5", "tag": "E1"}],
  "good": ["\uC798 \uB41C \uC810 1~2\uAC1C"],
  "criteria_check": [{"criterion": "\uD300\uC7A5 \uAE30\uC900 \uC774\uB984", "met": true, "note": "\uD55C \uBB38\uC7A5", "tag": "E2"}]
}
fixes \uB294 \uCD5C\uB300 4\uAC1C, \uC911\uC694\uD55C \uAC83\uBD80\uD130. \uD300\uC7A5 \uAE30\uC900\uC744 \uADFC\uAC70\uB85C \uD55C \uD56D\uBAA9\uC5D0\uB294 tag \uB97C \uB123\uACE0, \uC544\uB2C8\uBA74 \uBE48 \uBB38\uC790\uC5F4.
ready \uB294 \uD070 \uBCF4\uC644 \uC5C6\uC774 \uC62C\uB824\uB3C4 \uB418\uBA74 true.`;

// functions/ai-review-submission/index.ts
var IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
async function selfCheck(caller, body) {
  const { data: m } = await admin.from("team_members").select("role").eq("team_id", body.team_id).eq("user_id", caller.userId).eq("status", "active").maybeSingle();
  if (!m) throw new HttpError(403, "forbidden");
  const content = [];
  if (!body.text?.trim()) throw new HttpError(422, "NO_TEXT", "\uC810\uAC80\uD560 \uBCF8\uBB38\uC774 \uC5C6\uC2B5\uB2C8\uB2E4");
  const book = new SourceBook();
  const n = await addKnowhow(book, body.team_id, "review", 2600, true);
  content.push({ type: "text", text: [
    `\uACB0\uACFC\uBB3C \uC81C\uBAA9: ${body.title}`,
    n ? book.knowhowText() : "## \uD300\uC7A5\uC758 \uAE30\uC900\n(\uD300\uC7A5\uC774 \uACF5\uAC1C\uD55C \uAE30\uC900 \uC5C6\uC74C \u2014 \uC77C\uBC18\uC801\uC778 \uBCF4\uACE0\uC11C \uAE30\uC900\uC73C\uB85C \uC810\uAC80)",
    `## \uBCF8\uBB38
${body.text.slice(0, 4e4)}`
  ].join("\n\n") });
  const { output } = await runAi({
    teamId: body.team_id,
    kind: "self_check",
    model: MODEL_SMART,
    system: SELF_CHECK,
    content,
    book,
    depth: 1,
    level: "L1",
    createdBy: caller.userId,
    subjectUserId: caller.userId,
    visibility: "subject",
    maxTokens: 1e3
  });
  return output;
}
serve(async (req) => {
  const body = await readJson(req);
  const caller = await getCaller(req);
  if (body.mode === "self") {
    if (!body.team_id || !body.title) throw new HttpError(400, "MISSING_FIELDS");
    return json(await selfCheck(caller, body));
  }
  const version_id = body.version_id;
  if (!version_id) throw new HttpError(400, "MISSING_ID");
  const ver = must(await admin.from("submission_versions").select("*").eq("id", version_id).maybeSingle());
  const sub = must(await admin.from("submissions").select("*").eq("id", ver.submission_id).maybeSingle());
  if (!caller.isService && caller.userId !== sub.author_id) {
    const { data: m } = await admin.from("team_members").select("role").eq("team_id", sub.team_id).eq("user_id", caller.userId).maybeSingle();
    if (m?.role !== "leader") throw new HttpError(403, "forbidden");
  }
  const { data: existing } = await admin.from("ai_outputs").select("*").eq("kind", "review").eq("ref_table", "submission_versions").eq("ref_id", ver.id).maybeSingle();
  if (existing) return json(existing);
  const book = new SourceBook();
  const content = [];
  if (sub.request_type === "share" || sub.kind === "number") throw new HttpError(422, "NO_REVIEW", "\uACF5\uC720\xB7\uC22B\uC790 \uC5C5\uB370\uC774\uD2B8\uB294 AI \uAC80\uD1A0 \uB300\uC0C1\uC774 \uC544\uB2D9\uB2C8\uB2E4");
  if ((ver.mime_type === "application/pdf" || IMAGE_TYPES.includes(ver.mime_type ?? "")) && ver.file_path) {
    const { data: file, error } = await admin.storage.from("submissions").download(ver.file_path);
    if (error) throw error;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, "FILE_TOO_LARGE");
    content.push(ver.mime_type === "application/pdf" ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) }, title: sub.title } : { type: "image", source: { type: "base64", media_type: ver.mime_type, data: toBase64(bytes) } });
  } else if (!ver.extracted_text?.trim() && !sub.link_url) {
    throw new HttpError(422, "NO_TEXT", "\uBCF8\uBB38 \uD14D\uC2A4\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uD30C\uC77C\uC744 \uC62C\uB9AC\uAC70\uB098 \uB0B4\uC6A9\uC744 \uBD99\uC5EC \uB123\uC5B4 \uC8FC\uC138\uC694.");
  }
  const { data: prev } = await admin.from("submission_versions").select("id, version, note, extracted_text").eq("submission_id", sub.id).lt("version", ver.version).order("version", { ascending: false }).limit(1).maybeSingle();
  if (prev) book.add("submission", prev.id, `\uC774\uC804 \uBC84\uC804 v${prev.version}`, `\uBCC0\uACBD \uBA54\uBAA8: ${prev.note || "\uC5C6\uC74C"} / \uBCF8\uBB38 \uC55E\uBD80\uBD84: ${prev.extracted_text.slice(0, 1500)}`);
  const { data: history } = await admin.from("judgment_scores").select("id, score, scored_at, submission_id").eq("team_id", sub.team_id).eq("user_id", sub.author_id).order("scored_at", { ascending: false }).limit(8);
  for (const h of history ?? []) book.add("judgment", h.id, `\uC9C0\uB09C \uAC80\uD1A0 ${fmtDate(h.scored_at)}`, `\uD310\uB2E8 \uAE4A\uC774 ${h.score}`);
  const { data: comments } = await admin.from("review_comments").select("id, section_ref, body, author_id").eq("submission_id", sub.id).neq("author_id", sub.author_id).order("created_at").limit(10);
  for (const c of comments ?? []) book.add("review_comment", c.id, `\uD300\uC7A5 \uCF54\uBA58\uD2B8 ${c.section_ref ?? ""}`, c.body);
  const { data: comps } = await admin.from("competencies").select("name").or(`team_id.is.null,team_id.eq.${sub.team_id}`).order("sort");
  await addKnowhow(book, sub.team_id, "review");
  const { data: author } = await admin.from("profiles").select("full_name").eq("id", sub.author_id).maybeSingle();
  const text = [
    `\uACB0\uACFC\uBB3C \uC81C\uBAA9: ${sub.title} (v${ver.version})`,
    `\uC62C\uB9B0 \uC0AC\uB78C: ${author?.full_name ?? "\uD300\uC6D0"} / \uC694\uCCAD \uC885\uB958: ${{ approval: "\uC2B9\uC778 \uC694\uCCAD", feedback: "\uD53C\uB4DC\uBC31 \uC694\uCCAD", share: "\uACF5\uC720" }[sub.request_type] ?? sub.request_type}`,
    ver.note ? `\uC774\uBC88 \uBC84\uC804 \uBCC0\uACBD \uBA54\uBAA8: ${ver.note}` : "",
    `\uC5ED\uB7C9 \uBAA9\uB85D: ${(comps ?? []).map((c) => c.name).join(", ")}`,
    `\uC9C0\uB09C \uAC80\uD1A0 \uAE30\uB85D \uC218: ${history?.length ?? 0}`,
    book.knowhowText(),
    book.text("\uCC38\uACE0 \uAE30\uB85D"),
    sub.link_url ? `\uB9C1\uD06C (AI\uB294 \uC5F4\uC5B4 \uBCF4\uC9C0 \uC54A\uC74C, \uC124\uBA85\uB9CC \uC77D\uC74C): ${sub.link_url}` : "",
    ver.extracted_text?.trim() ? `## \uBCF8\uBB38
${ver.extracted_text.slice(0, 6e4)}` : "## \uBCF8\uBB38\n(\uCCA8\uBD80 \uD30C\uC77C)"
  ].filter(Boolean).join("\n\n");
  content.push({ type: "text", text });
  const { output, parsed } = await runAi({
    teamId: sub.team_id,
    kind: "review",
    model: MODEL_SMART,
    system: REVIEW,
    content,
    book,
    depth: depthOf((history?.length ?? 0) + 1, [2, 4, 8]),
    level: (history?.length ?? 0) >= 3 ? "L3" : "L1",
    createdBy: caller.userId,
    subjectUserId: sub.author_id,
    refTable: "submission_versions",
    refId: ver.id,
    maxTokens: 2200
  });
  const score = Math.max(1, Math.min(4, Math.round((Number(parsed.depth_score) || 2) * 2) / 2));
  await admin.from("judgment_scores").insert({
    team_id: sub.team_id,
    user_id: sub.author_id,
    submission_id: sub.id,
    version_id: ver.id,
    score,
    competencies: parsed.competency_signals ?? {},
    ai_output_id: output.id
  });
  for (const [name, sig] of Object.entries(parsed.competency_signals ?? {})) {
    if (!sig) continue;
    await admin.from("evidence").insert({
      team_id: sub.team_id,
      subject_user_id: sub.author_id,
      source: "ai",
      source_id: null,
      competency: name,
      polarity: sig > 0 ? "positive" : "concern",
      provenance: "ai",
      summary: `${sub.title} v${ver.version} \u2014 ${name} ${sig > 0 ? "\uAC15\uD568" : "\uC57D\uD568"} \uC2E0\uD638 (AI 1\uCC28 \uAC80\uD1A0)`
    });
  }
  return json(output);
});
