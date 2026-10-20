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
async function assertFeature(teamId, feature) {
  const { data, error } = await admin.rpc("team_has_feature", { p_team: teamId, p_feature: feature });
  if (error) throw error;
  if (!data) throw new HttpError(402, "PLAN_FEATURE", `\uC694\uAE08\uC81C\uC5D0 '${feature}' \uAE30\uB2A5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4`);
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
async function withhold(job, reason, needed) {
  const { data, error } = await admin.from("ai_outputs").insert({
    team_id: job.teamId,
    kind: job.kind,
    subject_user_id: job.subjectUserId ?? null,
    ref_table: job.refTable ?? null,
    ref_id: job.refId ?? null,
    period_start: job.periodStart ?? null,
    period_end: job.periodEnd ?? null,
    status: "withheld",
    visibility: "leader",
    level: job.level,
    depth: job.depth,
    content: { reason, needed },
    sources: job.book.sources,
    created_by: job.createdBy
  }).select().single();
  if (error) throw error;
  return data;
}
var fmtDate = (d) => d ? d.slice(0, 10) : "";

// functions/_shared/prompts/index.ts
var EVALUATION = `\uACFC\uC81C: \uD3C9\uAC00 \uAE30\uAC04 \uB3D9\uC548 \uC313\uC778 \uADFC\uAC70\uB85C \uD300\uC6D0 \uD3C9\uAC00 \uC758\uACAC \uCD08\uC548\uACFC '\uC608\uC0C1 \uB4F1\uAE09(\uC2DC\uBBAC\uB808\uC774\uC158)'\uC744 \uC501\uB2C8\uB2E4.
\uC608\uC0C1 \uB4F1\uAE09\uC740 \uD655\uC815\uC774 \uC544\uB2C8\uB77C, \uC9C0\uAE08\uAE4C\uC9C0\uC758 \uADFC\uAC70\uB85C \uBCF4\uBA74 \uC5B4\uB514\uCBE4\uC778\uC9C0 \uBBF8\uB9AC \uAC00\uB2A0\uD574 \uBCF4\uB294 \uC2DC\uBBAC\uB808\uC774\uC158\uC785\uB2C8\uB2E4. \uCD5C\uC885 \uB4F1\uAE09\uC740 \uD300\uC7A5\uC774 \uC815\uD569\uB2C8\uB2E4.
\uBAA8\uB4E0 \uD310\uB2E8 \uBB38\uC7A5\uC5D0\uB294 \uADFC\uAC70 \uD0DC\uADF8\uB97C \uB2F5\uB2C8\uB2E4. \uD55C \uBC88 \uC788\uC5C8\uB358 \uC77C\uC744 \uC77C\uBC18\uD654\uD558\uC9C0 \uB9D0\uACE0, \uBC18\uBCF5\uB41C \uD328\uD134\uACFC \uB2E8\uBC1C\uC131 \uC0AC\uB840\uB97C \uAD6C\uBD84\uD574\uC11C \uC501\uB2C8\uB2E4.
\uADFC\uAC70\uAC00 2\uAC74 \uBBF8\uB9CC\uC778 \uC5ED\uB7C9\uC740 signal \uC744 "\uADFC\uAC70 \uBD80\uC871"\uC73C\uB85C \uB461\uB2C8\uB2E4.

\uC608\uC0C1 \uB4F1\uAE09 \u2014 5\uB4F1\uAE09:
  S \uD0C1\uC6D4: \uBAA9\uD45C\uB97C \uD06C\uAC8C \uB118\uC5C8\uAC70\uB098 \uD300\xB7\uC870\uC9C1\uC5D0 \uB69C\uB837\uD55C \uD30C\uAE09, \uBC18\uBCF5\uC801\uC73C\uB85C \uAE30\uB300 \uC774\uC0C1
  A \uC6B0\uC218: \uBAA9\uD45C\uB97C \uB118\uC5C8\uAC70\uB098 \uD575\uC2EC \uACFC\uC81C\uB97C \uB192\uC740 \uD488\uC9C8\uB85C \uD574\uB0C4, \uC131\uC7A5\uC774 \uBD84\uBA85\uD568
  B \uAE30\uB300 \uCDA9\uC871: \uB9E1\uC740 \uBAA9\uD45C\xB7\uACFC\uC81C\uB97C \uB300\uCCB4\uB85C \uD574\uB0C4 (\uAE30\uBCF8\uAC12 \u2014 \uADFC\uAC70\uAC00 \uC5C6\uC73C\uBA74 \uC5EC\uAE30\uC11C \uCD9C\uBC1C)
  C \uC77C\uBD80 \uBBF8\uD761: \uD575\uC2EC \uACFC\uC81C \uC77C\uBD80\uAC00 \uACC4\uD68D\uC5D0 \uBABB \uBBF8\uCE58\uAC70\uB098 \uAC19\uC740 \uBCF4\uC644\uC810\uC774 \uBC18\uBCF5\uB428
  D \uBBF8\uD761: \uBAA9\uD45C\xB7\uAE30\uB300\uC5D0 \uD06C\uAC8C \uBABB \uBBF8\uCE58\uACE0 \uAC1C\uC120 \uC2E0\uD638\uAC00 \uC57D\uD568
\uC6D0\uCE59:
- B \uC5D0\uC11C \uCD9C\uBC1C\uD574, \uBC18\uBCF5\uB41C \uADFC\uAC70\uAC00 \uC788\uC744 \uB54C\uB9CC \uC704\xB7\uC544\uB798\uB85C \uC62E\uAE41\uB2C8\uB2E4. \uB2E8\uBC1C\uC131 \uC0AC\uB840\uB85C \uB4F1\uAE09\uC744 \uC6C0\uC9C1\uC774\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- \uC678\uBD80 \uC694\uC778(\uB2E4\uB978 \uD300\xB7\uACE0\uAC1D \uB370\uC774\uD130 \uC9C0\uC5F0 \uB4F1)\uC73C\uB85C \uB2A6\uC5B4\uC9C4 \uAC83\uC740 \uBCF8\uC778 \uCC45\uC784\uACFC \uAD6C\uBD84\uD574\uC11C \uBC18\uC601\uD569\uB2C8\uB2E4.
- \uADFC\uAC70\uAC00 \uC801\uAC70\uB098 \uC5C7\uAC08\uB9AC\uBA74 confidence \uB97C low \uB85C \uB450\uACE0 range \uB97C \uB113\uAC8C(\uC608: B~A) \uC7A1\uC2B5\uB2C8\uB2E4. range \uB294 \uB0AE\uC740 \uB4F1\uAE09 \u2192 \uB192\uC740 \uB4F1\uAE09 \uC21C\uC11C.
- up(\uC62C\uB9AC\uB294 \uADFC\uAC70)\xB7down(\uB0B4\uB9AC\uB294 \uADFC\uAC70)\uC740 \uAC01 1~3\uAC1C, \uADFC\uAC70 \uD0DC\uADF8\uB97C \uB2F5\uB2C8\uB2E4. missing \uC5D0\uB294 \uB4F1\uAE09\uC744 \uD655\uC815\uD558\uAE30 \uC5B4\uB824\uC6B4 \uC774\uC720\uB098 \uB354 \uBCF4\uBA74 \uC88B\uC744 \uAE30\uB85D\uC744 \uC501\uB2C8\uB2E4.
- \uB2E4\uB978 \uD300\uC6D0\uACFC \uBE44\uAD50\uD558\uAC70\uB098 \uC21C\uC704\uB97C \uB9E4\uAE30\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uBCF4\uC0C1\xB7\uC778\uC0AC \uC870\uCE58\uB97C \uC5B8\uAE09\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "grade": {"expected": "A", "range": ["B", "A"], "confidence": "low | medium | high",
            "rationale": "\uC65C \uC774 \uB4F1\uAE09\uC778\uC9C0 \uD55C\uB450 \uBB38\uC7A5 [E1][E4]",
            "up": [{"text": "\uC62C\uB9AC\uB294 \uADFC\uAC70", "evidence": ["E1"]}], "down": [{"text": "\uB0B4\uB9AC\uB294 \uADFC\uAC70", "evidence": ["E6"]}],
            "missing": "\uD655\uC815\uD558\uAE30 \uC5B4\uB824\uC6B4 \uBD80\uBD84 \uD55C \uBB38\uC7A5"},
  "overall": "\uC885\uD569 \uC758\uACAC 3~4\uBB38\uC7A5, \uADFC\uAC70 \uD0DC\uADF8 \uD3EC\uD568",
  "strengths": [{"title": "\uC9E7\uC740 \uC81C\uBAA9", "detail": "\uD55C \uBB38\uC7A5", "evidence": ["E3", "E7"]}],
  "growth": [{"title": "\uC9E7\uC740 \uC81C\uBAA9", "detail": "\uD55C \uBB38\uC7A5", "evidence": ["E5"]}],
  "competencies": [{"name": "\uBB38\uC81C \uC815\uC758", "signal": "\uAC15\uD568 | \uBCF4\uD1B5 | \uC57D\uD568 | \uADFC\uAC70 \uBD80\uC871", "evidence": ["E1"]}],
  "coaching": "\uB2E4\uC74C \uAE30\uAC04 \uCF54\uCE6D \uC81C\uC548 \uD55C\uB450 \uBB38\uC7A5"
}
grade \uB97C \uAC00\uC7A5 \uBA3C\uC800 \uC501\uB2C8\uB2E4. strengths 2~3\uAC1C, growth 1~3\uAC1C. competencies \uB294 \uC8FC\uC5B4\uC9C4 \uC5ED\uB7C9 \uBAA9\uB85D\uC744 \uBAA8\uB450 \uD3EC\uD568.`;

// functions/ai-evaluation-draft/index.ts
var LABEL = {
  checkin: "\uCEE8\uB514\uC158 \uACF5\uC720",
  one_on_one: "1on1",
  submission: "\uACB0\uACFC\uBB3C",
  review_comment: "\uB9AC\uBDF0 \uCF54\uBA58\uD2B8",
  observation: "\uAD00\uCC30 \uBA54\uBAA8",
  leader_note: "\uD300\uC7A5 \uBA54\uBAA8",
  task: "\uACFC\uC81C",
  metric: "\uC2E4\uC801",
  decision: "\uC758\uC0AC\uACB0\uC815",
  ai: "AI \uAC80\uD1A0 \uC2E0\uD638"
};
var JUDGMENT = ["submission", "observation", "review_comment", "leader_note", "task"];
serve(async (req) => {
  const b = await readJson(req);
  if (!b.team_id || !b.member_id || !b.period_start || !b.period_end) throw new HttpError(400, "MISSING_PARAMS");
  const caller = await getCaller(req);
  await assertLeader(caller, b.team_id);
  await assertFeature(b.team_id, "evaluation");
  const member = must(await admin.from("team_members").select("job_title, profiles(full_name)").eq("team_id", b.team_id).eq("user_id", b.member_id).maybeSingle());
  const name = member.profiles?.full_name ?? "";
  const { data: team } = await admin.from("teams").select("settings").eq("id", b.team_id).single();
  const minEvidence = Number(team?.settings?.min_judgment_evidence ?? 8);
  const { data: ev } = await admin.from("evidence").select("id, source, competency, polarity, summary, occurred_at, provenance").eq("team_id", b.team_id).eq("subject_user_id", b.member_id).neq("source", "checkin").gte("occurred_at", b.period_start).lte("occurred_at", `${b.period_end}T23:59:59Z`).order("occurred_at").limit(160);
  const book = new SourceBook();
  const judg = (ev ?? []).filter((e) => JUDGMENT.includes(e.source));
  const ctx = (ev ?? []).filter((e) => !JUDGMENT.includes(e.source)).slice(-40);
  for (const e of [...judg, ...ctx]) {
    book.add(
      e.source,
      e.id,
      `${LABEL[e.source] ?? e.source} ${fmtDate(e.occurred_at)}`,
      `${e.polarity !== "neutral" ? `[${e.polarity}] ` : ""}${e.competency ? `(${e.competency}) ` : ""}${e.summary}${e.provenance === "ai" ? " \u2014 AI \uC2E0\uD638" : ""}`
    );
  }
  const common = {
    teamId: b.team_id,
    kind: "evaluation_draft",
    book,
    depth: depthOf(judg.length, [4, 8, 16]),
    level: "L3",
    createdBy: caller.userId,
    subjectUserId: b.member_id,
    refTable: "profiles",
    refId: b.member_id,
    periodStart: b.period_start,
    periodEnd: b.period_end
  };
  if (judg.length < minEvidence) {
    const out = await withhold(common, `\uD310\uB2E8 \uADFC\uAC70\uAC00 ${judg.length}\uAC74\uC73C\uB85C \uAE30\uC900(${minEvidence}\uAC74)\uC5D0 \uBABB \uBBF8\uCE69\uB2C8\uB2E4.`, {
      current: judg.length,
      required: minEvidence,
      suggestion: "\uACB0\uACFC\uBB3C \uB9AC\uBDF0\uB098 \uAD00\uCC30 \uBA54\uBAA8\uB97C \uB0A8\uAE30\uBA74 \uADFC\uAC70\uAC00 \uC313\uC785\uB2C8\uB2E4."
    });
    return json(out);
  }
  const { data: scores } = await admin.from("judgment_scores").select("score, scored_at").eq("team_id", b.team_id).eq("user_id", b.member_id).gte("scored_at", b.period_start).order("scored_at");
  const { data: comps } = await admin.from("competencies").select("name").or(`team_id.is.null,team_id.eq.${b.team_id}`).order("sort");
  await addKnowhow(book, b.team_id, "evaluation");
  const trend = (scores ?? []).map((s) => `${fmtDate(s.scored_at)}:${s.score}`).join(", ");
  const { output } = await runAi({
    ...common,
    model: MODEL_SMART,
    system: EVALUATION,
    content: [{ type: "text", text: [
      `\uD300\uC6D0: ${name} (${member.job_title})`,
      `\uD3C9\uAC00 \uAE30\uAC04: ${b.period_start} ~ ${b.period_end}`,
      `\uC5ED\uB7C9 \uBAA9\uB85D: ${(comps ?? []).map((c) => c.name).join(", ")}`,
      `\uD310\uB2E8 \uAE4A\uC774 \uCD94\uC774(\uBAA8\uB378 \uAE30\uB85D): ${trend || "\uC5C6\uC74C"}`,
      book.knowhowText(),
      book.text("\uADFC\uAC70")
    ].join("\n") }],
    maxTokens: 2200,
    extra: { evidence_counts: book.byType(), judgment_evidence: judg.length }
  });
  return json(output);
});
