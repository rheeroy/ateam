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
    try {
      return JSON.parse(escapeControls(src.slice(start, end + 1)));
    } catch {
    }
  }
  const fixed = closeTruncated(escapeControls(src.slice(start)));
  if (fixed) {
    try {
      return JSON.parse(fixed);
    } catch {
    }
  }
  throw new HttpError(502, "AI_BAD_OUTPUT", text.slice(0, 300));
}
function escapeControls(s) {
  let out = "", inStr = false, esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) {
        esc = false;
        out += c;
        continue;
      }
      if (c === "\\") {
        esc = true;
        out += c;
        continue;
      }
      if (c === '"') {
        inStr = false;
        out += c;
        continue;
      }
      out += c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "	" ? "\\t" : c;
      continue;
    }
    if (c === '"') inStr = true;
    out += c;
  }
  return out;
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
  "work_brief",
  "task_history"
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
  task_history: 0,
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
  /** 지금까지 실은 기록 본문 (노하우 제외) — 플레이북 카드를 상황에 맞게 고를 때 쓴다 */
  evidenceText() {
    return this.lines.filter((l) => !KH_TYPES.includes(l.type)).map((l) => l.line).join("\n");
  }
  /** 팀장의 기준 섹션 + ATEAM Method™ 섹션 (없으면 빈 문자열) */
  knowhowText() {
    const own = this.lines.filter((l) => l.type === "knowhow").map((l) => l.line);
    const con = this.lines.filter((l) => l.type === "consulting").map((l) => l.line);
    return [
      own.length ? `## \uD300\uC7A5\uC758 \uAE30\uC900 (\uD300\uC7A5\uC774 \uC9C1\uC811 \uB123\uC740 \uB178\uD558\uC6B0 \u2014 \uC77C\uBC18 \uC0C1\uC2DD\uBCF4\uB2E4 \uC6B0\uC120)
${own.join("\n")}` : "",
      con.length ? `## ATEAM Method\u2122 (\uAC80\uC99D\uB41C \uC5C5\uBB34 \uBC29\uBC95\uB860 \uC911 \uC774 \uC0C1\uD669\uC5D0 \uB9DE\uB294 \uAC83 \u2014 \uD300\uC7A5\uC758 \uAE30\uC900\uACFC \uC5B4\uAE0B\uB098\uBA74 \uD300\uC7A5\uC758 \uAE30\uC900\uC744 \uB530\uB984)
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
8. 'ATEAM Method\u2122' \uC139\uC158\uC740 \uC774 \uC0C1\uD669\uC5D0 \uB9DE\uCDB0 \uACE0\uB978 \uAC80\uC99D\uB41C \uC5C5\uBB34 \uBC29\uBC95\uB860\uC785\uB2C8\uB2E4. \uC77C\uBC18 \uC0C1\uC2DD\uBCF4\uB2E4\uB294 \uC6B0\uC120\uD558\uB418 '\uD300\uC7A5\uC758 \uAE30\uC900'\uACFC \uC5B4\uAE0B\uB098\uBA74 \uD300\uC7A5\uC758 \uAE30\uC900\uC744 \uB530\uB985\uB2C8\uB2E4. \uC2E4\uC81C\uB85C \uC774 \uAE30\uB85D\uC5D0 \uB4E4\uC5B4\uB9DE\uB294 \uBC29\uBC95\uB860\uB9CC \uC4F0\uACE0, \uC801\uC6A9\uD55C \uBB38\uC7A5\uC5D0\uB294 \uD574\uB2F9 \uADFC\uAC70 \uD0DC\uADF8\uB97C \uBD99\uC785\uB2C8\uB2E4. \uBC29\uBC95\uB860 \uC774\uB984\uC744 \uB298\uC5B4\uB193\uAC70\uB098 \uC774\uB860\uC744 \uC124\uBA85\uD558\uC9C0 \uB9D0\uACE0, \uAE30\uB85D\uC5D0 \uBE44\uCD98 \uAD6C\uCCB4\uC801\uC778 \uD310\uB2E8\uACFC \uD589\uB3D9\uC73C\uB85C \uC501\uB2C8\uB2E4.`;
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

// functions/ai-task-history/index.ts
var DAY = 864e5;
var WEEKLY_MAX = 10;
var PARALLEL = 4;
var SYSTEM = `## \uD560 \uC77C
\uACFC\uC81C \uD558\uB098\uC758 '\uD788\uC2A4\uD1A0\uB9AC'\uB97C \uAD00\uB9AC\uD569\uB2C8\uB2E4. \uC774 \uD788\uC2A4\uD1A0\uB9AC\uB294 \uACFC\uC81C\uB97C \uB118\uACA8\uBC1B\uB294 \uC0AC\uB78C\uC774 \uB9E5\uB77D(\uC65C \xB7 \uBB34\uC5C7\uC774 \uC815\uD574\uC84C\uACE0 \xB7 \uBB34\uC5C7\uC744 \uD574 \uBD24\uACE0 \xB7 \uB204\uAC00 \uC5EE\uC5EC \uC788\uACE0 \xB7 \uBB34\uC5C7\uC774 \uB0A8\uC558\uB294\uC9C0)\uC744 \uD55C \uBC88\uC5D0 \uD30C\uC545\uD558\uAC8C \uD558\uB294 \uBB38\uC11C\uC785\uB2C8\uB2E4.
'\uAE30\uC874 \uD788\uC2A4\uD1A0\uB9AC'(JSON)\uAC00 \uC788\uC73C\uBA74 '\uC0C8 \uAE30\uB85D'\uC744 \uD569\uCCD0 \uACE0\uCCD0 \uC4F0\uACE0, \uC5C6\uC73C\uBA74 \uAE30\uB85D \uC804\uCCB4\uB85C \uCC98\uC74C \uB9CC\uB4ED\uB2C8\uB2E4.

## \uC6D0\uCE59
- \uB0B1\uAC1C \uAE30\uB85D\uC744 \uB098\uC5F4\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uD750\uB984\uC740 \uD558\uB098\uC758 \uC904\uAE30(lanes)\uB85C \uBB36\uACE0, \uC6D0\uC778\uACFC \uACB0\uACFC\uB294 links\uB85C \uC787\uC2B5\uB2C8\uB2E4.
- \uAE30\uC874 \uD56D\uBAA9\uC758 id\uB294 \uADF8\uB300\uB85C \uC720\uC9C0\uD569\uB2C8\uB2E4. \uC0C8 \uD56D\uBAA9\uC740 \uAC19\uC740 \uC811\uB450\uC5B4\uC758 \uB2E4\uC74C \uBC88\uD638\uB97C \uC501\uB2C8\uB2E4 (L\xB7V\xB7P\xB7F\xB7O\xB7T\xB7K\xB7G).
- '\uACE0\uC815' \uD45C\uC2DC\uB41C \uD56D\uBAA9\uC740 \uBB38\uC7A5\uACFC id\uB97C \uBC14\uAFB8\uC9C0 \uB9D0\uACE0 \uADF8\uB300\uB85C \uB461\uB2C8\uB2E4.
- \uC624\uB798\uB418\uACE0 \uC0AC\uC18C\uD55C \uC0AC\uAC74\uC740 \uD569\uCE58\uAC70\uB098 \uBE8D\uB2C8\uB2E4. events \uCD5C\uB300 24\uAC1C, lanes \uCD5C\uB300 6\uAC1C, people \uCD5C\uB300 10\uBA85, \uAC01 \uBAA9\uB85D \uCD5C\uB300 8\uAC1C.
- \uADFC\uAC70\uB294 src \uBC30\uC5F4\uC5D0 \uAE30\uB85D\uC758 \uD0DC\uADF8\uB97C \uADF8\uB300\uB85C \uB123\uC2B5\uB2C8\uB2E4 (\uC608: ["E3"]). \uAE30\uC874 \uD56D\uBAA9\uC744 \uADF8\uB300\uB85C \uB450\uBA74 src\uB294 \uBE44\uC6CC\uB3C4 \uB429\uB2C8\uB2E4.
- \uC0AC\uB78C\xB7\uBD80\uC11C\xB7\uD68C\uC0AC\uB294 \uAE30\uB85D\uC5D0 \uC774\uB984\uC774 \uB098\uC628 \uACBD\uC6B0\uB9CC \uC501\uB2C8\uB2E4. \uCD94\uCE21\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. '\uD300\uC6D0 \uBAA9\uB85D'\uC5D0 \uC788\uC73C\uBA74 scope "team", \uAC19\uC740 \uD68C\uC0AC \uB2E4\uB978 \uBD80\uC11C\uB294 "dept", \uD68C\uC0AC \uBC16\uC740 "external". \uD655\uC778\uC774 \uD544\uC694\uD55C \uAD00\uACC4\uB294 check true.
- gaps(\uD655\uC778 \uD544\uC694)\uC5D0\uB294 \uB118\uACA8\uBC1B\uB294 \uC0AC\uB78C\uC774 \uAF2D \uC54C\uC544\uC57C \uD558\uB294\uB370 \uAE30\uB85D\uC5D0 \uC5C6\uB294 \uAC83\uC744 "\uBB34\uC5C7 \u2014 \uAE30\uB85D \uC5C6\uC74C \u2192 \uB204\uAD6C\uC5D0\uAC8C \uD655\uC778" \uD615\uD0DC\uB85C \uC501\uB2C8\uB2E4. \uC5C6\uC73C\uBA74 \uBE48 \uBC30\uC5F4.
- fixed(\uD655\uC815 \uC0AC\uD56D)\uB294 \uACB0\uC815\xB7\uC2B9\uC778\xB7\uD300\uC7A5 \uAE30\uC900\uCC98\uB7FC \uB2E4\uC2DC \uBB3B\uC9C0 \uC54A\uC544\uB3C4 \uB418\uB294 \uAC83, open(\uBBF8\uACB0 \uC0AC\uD56D)\uC740 \uC544\uC9C1 \uC815\uD574\uC9C0\uC9C0 \uC54A\uC740 \uAC83, tried(\uC774\uC804 \uC2DC\uB3C4)\uB294 \uD574 \uBD24\uB358 \uBC29\uBC95\uACFC \uACB0\uACFC, risks(\uB9AC\uC2A4\uD06C)\uB294 \uC77C\uC815\xB7\uBAA9\uD45C\uB97C \uD754\uB4E4 \uC218 \uC788\uB294 \uAC83.
- \uBB38\uCCB4: \uAC1C\uC870\uC2DD, \uBA85\uC0AC\uD615 \uC885\uACB0 (\uC608: "A\xB7C 2\uAC1C\uC0AC \uCD95\uC18C\uC548 \uAC80\uD1A0 \uC911"). text\uB294 60\uC790 \uC548\uD30E, detail\uC740 \uBC30\uACBD\xB7\uC774\uC720\uB97C 2~3\uBB38\uC7A5.
- \uB0A0\uC9DC\uB294 \uAE30\uB85D\uC5D0 \uC788\uB294 \uB0A0\uC9DC\uB9CC \uC501\uB2C8\uB2E4(YYYY-MM-DD). \uC55E\uC73C\uB85C \uC608\uC815\uB41C \uC77C\uC740 \uAE30\uB85D\uC5D0 \uC608\uC815\uC77C\uC774 \uC788\uC744 \uB54C\uB9CC future true\uB85C \uB123\uC2B5\uB2C8\uB2E4.
- related(\uAD00\uB828 \uACFC\uC81C)\uB294 '\uD300\uC758 \uB2E4\uB978 \uACFC\uC81C' \uBAA9\uB85D\uC5D0\uC11C \uAE30\uB85D\uC0C1 \uC2E4\uC81C\uB85C \uC5EE\uC778 \uAC83\uB9CC ref\uB85C \uACE0\uB985\uB2C8\uB2E4.

## \uCD9C\uB825 (JSON \uAC1D\uCCB4 \uD558\uB098)
{"summary":"\uC9C0\uAE08 \uD604\uD669 \uD55C\uB450 \uBB38\uC7A5 (90\uC790 \uC774\uB0B4)",
 "lanes":[{"id":"L1","title":"\uC904\uAE30 \uC774\uB984 (8\uC790 \uC548\uD30E)"}],
 "events":[{"id":"V1","lane":"L1","date":"YYYY-MM-DD","title":"12\uC790 \uC548\uD30E","kind":"doc|decision|issue|feedback|plan|change","detail":"","future":false,"src":["E1"]}],
 "links":[{"from":"V2","to":"V5","label":"\uC9E7\uAC8C"}],
 "people":[{"id":"P1","name":"\uC774\uB984 \uB610\uB294 \uC870\uC9C1","org":"\uBD80\uC11C\xB7\uD68C\uC0AC","scope":"team|dept|external","role":"\uC774 \uACFC\uC81C\uC5D0\uC11C\uC758 \uC5ED\uD560 (20\uC790)","check":false,"src":[]}],
 "fixed":[{"id":"F1","text":"","detail":"","since":"YYYY-MM-DD","src":[]}],
 "open":[{"id":"O1","text":"","detail":"","src":[]}],
 "tried":[{"id":"T1","text":"","detail":"","src":[]}],
 "risks":[{"id":"K1","text":"","detail":"","src":[]}],
 "gaps":[{"id":"G1","text":"","detail":"","src":[]}],
 "related":[{"ref":"R2","why":"20\uC790"}]}`;
var LISTS = ["fixed", "open", "tried", "risks", "gaps"];
var day = (s) => (s ?? "").slice(0, 10);
var clip = (s, n) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}\u2026` : t;
};
var EVENT_TEXT = { created: "\uACFC\uC81C \uC0DD\uC131", replan: "\uC77C\uC815\xB7\uBAA9\uD45C \uBCC0\uACBD", status: "\uC0C1\uD0DC \uBCC0\uACBD", owner: "\uB2F4\uB2F9 \uBCC0\uACBD", target: "\uBAA9\uD45C \uBCC0\uACBD", approved: "\uACC4\uD68D \uC2B9\uC778", changes_requested: "\uACC4\uD68D \uC218\uC815 \uC694\uCCAD" };
var STATUS_KO = { proposed: "\uC81C\uC548", changes_requested: "\uC218\uC815 \uC694\uCCAD", active: "\uC9C4\uD589", blocked: "\uB9C9\uD798", done: "\uC644\uB8CC", dropped: "\uC911\uB2E8" };
async function teamItems(teamId, ids) {
  let qb = admin.from("work_items").select("id, team_id, title, note, owner_id, parent_id, status, measure, progress, num_current, num_target, unit, start_date, due_date, created_at, role, stages, done_at").eq("team_id", teamId).not("parent_id", "is", null).neq("measure", "check").in("status", ["active", "blocked", "done"]);
  if (ids?.length) qb = qb.in("id", ids);
  const { data, error } = await qb.order("updated_at", { ascending: false }).limit(ids?.length ? 500 : 300);
  if (error) throw error;
  const cut = Date.now() - 60 * DAY;
  return (data ?? []).filter((i) => i.role !== "metric" && i.role !== "goal" && !(i.status === "done" && i.done_at && Date.parse(i.done_at) < cut));
}
function must(r, what) {
  if (r.error) throw new HttpError(500, "HISTORY_SOURCE", `${what}: ${r.error.message}`);
  return r.data ?? [];
}
async function byChunks(ids, fn, what) {
  const out = [];
  for (let i = 0; i < ids.length; i += 60) out.push(...must(await fn(ids.slice(i, i + 60)), what));
  return out;
}
var LIMIT = 1e3;
async function collect(teamId, items, since, nameOf, initial) {
  const { data: lead } = await admin.from("team_members").select("user_id").eq("team_id", teamId).eq("role", "leader").eq("status", "active");
  const leaderIds = (lead ?? []).map((l) => l.user_id);
  const ids = items.map((i) => i.id);
  const recs = [];
  const push = (r) => recs.push(r);
  const recent2 = (rows) => rows.reverse();
  const [ev, logs, cm, subs, rq, ln, sh] = await Promise.all([
    byChunks(ids, (x) => admin.from("work_item_events").select("id, item_id, kind, old, new, reason, actor_id, created_at").in("item_id", x).gt("created_at", since).order("created_at", { ascending: false }).limit(LIMIT), "\uBCC0\uACBD \uC774\uB825"),
    byChunks(ids, (x) => admin.from("work_item_logs").select("id, item_id, kind, period, value, done, note, created_at").in("item_id", x).gt("created_at", since).order("created_at", { ascending: false }).limit(LIMIT), "\uC9C4\uCC99 \uAE30\uB85D"),
    byChunks(ids, (x) => admin.from("work_item_comments").select("id, item_id, kind, body, author_id, created_at").in("item_id", x).gt("created_at", since).order("created_at", { ascending: false }).limit(LIMIT), "\uACFC\uC81C \uCF54\uBA58\uD2B8"),
    byChunks(ids, (x) => admin.from("submissions").select("id, item_id, title, request_type, kind, status, author_id, created_at").eq("team_id", teamId).in("item_id", x).limit(LIMIT), "\uACB0\uACFC\uBB3C"),
    byChunks(ids, (x) => admin.from("team_requests").select("id, item_id, kind, title, body, status, response, from_id, to_id, created_at, responded_at").eq("team_id", teamId).in("item_id", x).or(`created_at.gt.${since},responded_at.gt.${since}`).limit(LIMIT), "\uC694\uCCAD"),
    byChunks(ids, (x) => admin.from("leader_notes").select("id, anchor_id, body, created_at").eq("team_id", teamId).eq("anchor_type", "item").eq("ai_allowed", true).in("owner_id", leaderIds.length ? leaderIds : ["00000000-0000-0000-0000-000000000000"]).in("anchor_id", x).gt("created_at", since).limit(LIMIT), "\uD300\uC7A5 \uBA54\uBAA8"),
    byChunks(ids, (x) => admin.from("history_shares").select("id, item_id, note, from_id, to_id, sent_at, created_at, status").eq("team_id", teamId).in("item_id", x).limit(LIMIT), "\uC804\uB2EC")
  ]);
  for (const e of recent2(ev)) {
    let t = EVENT_TEXT[e.kind] ?? e.kind;
    if (e.kind === "owner") t = `\uB2F4\uB2F9 \uBCC0\uACBD ${nameOf(e.old) || "\uC5C6\uC74C"} \u2192 ${nameOf(e.new) || "\uC5C6\uC74C"}`;
    else if (e.kind === "status" || e.kind === "approved" || e.kind === "changes_requested") t = `${t} (${STATUS_KO[String(e.old)] ?? e.old ?? ""} \u2192 ${STATUS_KO[String(e.new)] ?? e.new ?? ""})`;
    else if (e.kind === "created") t = "\uACFC\uC81C \uC0DD\uC131";
    else if (e.kind === "replan" || e.kind === "target") t = `${t}: ${JSON.stringify(e.old).slice(0, 120)} \u2192 ${JSON.stringify(e.new).slice(0, 120)}`;
    push({ item: e.item_id, at: e.created_at, type: "task", id: e.item_id, label: "\uBCC0\uACBD \uC774\uB825", text: `${t}${e.reason ? ` (\uC0AC\uC720: ${clip(e.reason, 200)})` : ""} \u2014 ${nameOf(e.actor_id)}` });
  }
  for (const l of recent2(logs)) {
    const v = l.kind === "recurring" ? l.done ? "\uC644\uB8CC" : "\uBBF8\uC644\uB8CC" : l.value != null ? String(l.value) : "";
    push({ item: l.item_id, at: l.created_at, type: "task", id: l.item_id, label: "\uC9C4\uCC99 \uAE30\uB85D", text: `${l.kind === "progress" ? "\uC9C4\uCC99" : l.kind === "number" ? "\uC2E4\uC801 \uAC12" : l.kind === "recurring" ? "\uC815\uAE30 \uC5C5\uBB34" : "\uBA54\uBAA8"} ${v} (${l.period})${l.note ? ` ${clip(l.note, 200)}` : ""}` });
  }
  for (const c of recent2(cm)) {
    const k = c.kind === "feedback" ? "\uD300\uC7A5 \uD53C\uB4DC\uBC31" : c.kind === "approve" ? "\uACC4\uD68D \uC2B9\uC778" : c.kind === "changes" ? "\uACC4\uD68D \uC218\uC815 \uC694\uCCAD" : "\uACFC\uC81C \uCF54\uBA58\uD2B8";
    push({ item: c.item_id, at: c.created_at, type: "task", id: c.item_id, label: k, text: `${nameOf(c.author_id)}: ${clip(c.body, 400)}` });
  }
  if (subs.length) {
    const sIds = subs.map((s) => s.id);
    const subOf = new Map(subs.map((s) => [s.id, s]));
    const [vers, rcs] = await Promise.all([
      byChunks(sIds, (x) => admin.from("submission_versions").select("id, submission_id, version, note, extracted_text, created_at").in("submission_id", x).gt("created_at", since).order("created_at", { ascending: false }).limit(LIMIT), "\uACB0\uACFC\uBB3C \uBC84\uC804"),
      byChunks(sIds, (x) => admin.from("review_comments").select("id, submission_id, author_id, body, created_at").in("submission_id", x).gt("created_at", since).order("created_at", { ascending: false }).limit(LIMIT), "\uACB0\uACFC\uBB3C \uB300\uD654")
    ]);
    const ais = await byChunks(vers.map((v) => v.id), (x) => admin.from("ai_outputs").select("ref_id, content, edited_content").eq("kind", "review").eq("ref_table", "submission_versions").in("ref_id", x), "AI \uAC80\uD1A0");
    const aiOf = new Map(ais.map((a) => [a.ref_id, a.edited_content ?? a.content]));
    const REQ = { approval: "\uCEE8\uD38C \uC694\uCCAD", feedback: "\uC758\uACAC \uC694\uCCAD", share: "\uACF5\uC720" };
    for (const v of recent2(vers)) {
      const s = subOf.get(v.submission_id);
      const ai = aiOf.get(v.id);
      push({
        item: s.item_id,
        at: v.created_at,
        type: "submission",
        id: s.id,
        label: `\uACB0\uACFC\uBB3C '${clip(s.title, 40)}' v${v.version}`,
        text: `${nameOf(s.author_id)} \xB7 ${s.kind === "checkin" ? "\uC131\uACFC\uC785\uB825" : REQ[s.request_type] ?? ""} \xB7 \uC0C1\uD0DC ${s.status}${v.note ? ` \xB7 \uBA54\uBAA8 ${clip(v.note, 150)}` : ""}${ai?.brief?.text || ai?.summary ? ` \xB7 AI \uAC80\uD1A0 ${clip(ai?.brief?.text || ai?.summary, 160)}` : ""}${v.extracted_text ? ` \xB7 \uBCF8\uBB38 ${clip(v.extracted_text, initial ? 500 : 350)}` : ""}`
      });
    }
    for (const c of recent2(rcs)) {
      const s = subOf.get(c.submission_id);
      push({ item: s.item_id, at: c.created_at, type: "submission", id: s.id, label: `'${clip(s.title, 30)}' \uB300\uD654`, text: `${nameOf(c.author_id)}: ${clip(c.body, 300)}` });
    }
  }
  const roots = await byChunks(ids, (x) => admin.from("space_messages").select("id, item_id, body, author_id, created_at").eq("team_id", teamId).in("item_id", x).is("parent_id", null).gt("created_at", new Date(Math.min(Date.parse(since), Date.now() - 180 * DAY)).toISOString()).order("created_at", { ascending: false }).limit(LIMIT), "\uC5C5\uBB34 \uB300\uD654");
  const itemOfRoot = new Map(roots.map((r) => [r.id, r.item_id]));
  for (const m of recent2(roots.filter((r) => r.created_at > since))) push({ item: m.item_id, at: m.created_at, type: "space_message", id: m.id, label: "\uC5C5\uBB34 \uB300\uD654", text: `${nameOf(m.author_id)}: ${clip(m.body, 300)}` });
  const reps = await byChunks(roots.map((r) => r.id), (x) => admin.from("space_messages").select("id, parent_id, body, author_id, created_at").in("parent_id", x).gt("created_at", since).order("created_at", { ascending: false }).limit(LIMIT), "\uC5C5\uBB34 \uB300\uD654 \uB2F5\uAE00");
  for (const m of recent2(reps)) {
    const it = itemOfRoot.get(m.parent_id);
    if (it) push({ item: it, at: m.created_at, type: "space_message", id: m.parent_id, label: "\uC5C5\uBB34 \uB300\uD654 \uB2F5\uAE00", text: `${nameOf(m.author_id)}: ${clip(m.body, 300)}` });
  }
  for (const r of rq) {
    const at = r.responded_at && r.responded_at > since ? r.responded_at : r.created_at;
    push({ item: r.item_id, at, type: "request", id: r.id, label: "\uC694\uCCAD", text: `${nameOf(r.from_id)} \u2192 ${nameOf(r.to_id)}: ${clip(r.title, 120)}${r.body ? ` (${clip(r.body, 160)})` : ""} \xB7 ${r.status === "done" ? `\uC644\uB8CC${r.response ? ` \u2014 ${clip(r.response, 160)}` : ""}` : "\uC5F4\uB9BC"}` });
  }
  for (const n of ln) push({ item: n.anchor_id, at: n.created_at, type: "leader_note", id: n.id, label: "\uD300\uC7A5 \uBA54\uBAA8", text: clip(n.body, 400) });
  const sent = sh.filter((s) => s.status !== "requested");
  for (const s of sent) {
    const at = s.sent_at ?? s.created_at;
    if (s.note?.trim() && at > since) push({ item: s.item_id, at, type: "history_share", id: s.id, label: "\uC804\uB2EC \uB54C \uD300\uC7A5 \uD55C\uB9C8\uB514", text: `\u2192 ${nameOf(s.to_id)}: ${clip(s.note, 300)}` });
  }
  if (sent.length) {
    const itemOf = new Map(sent.map((s) => [s.id, s.item_id]));
    const msgs = await byChunks(sent.map((s) => s.id), (x) => admin.from("history_messages").select("id, share_id, author_id, body, created_at").in("share_id", x).gt("created_at", since).order("created_at", { ascending: false }).limit(LIMIT), "\uC9C8\uBB38\xB7\uB2F5");
    for (const m of recent2(msgs)) push({ item: itemOf.get(m.share_id), at: m.created_at, type: "history_share", id: m.share_id, label: "\uD788\uC2A4\uD1A0\uB9AC \uC9C8\uBB38\xB7\uB2F5", text: `${nameOf(m.author_id)}: ${clip(m.body, 300)}` });
  }
  return recs;
}
async function progressOf(it) {
  const kind = it.measure === "number" ? "number" : "progress";
  const { data } = await admin.from("work_item_logs").select("period, value").eq("item_id", it.id).eq("kind", kind).not("value", "is", null).order("period").limit(60);
  const points = (data ?? []).map((l) => ({ date: day(l.period), value: Number(l.value) }));
  const now = kind === "number" ? it.num_current : it.progress;
  if (now != null) {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (!points.length || points[points.length - 1].date !== today) points.push({ date: today, value: Number(now) });
  }
  return { measure: it.measure, unit: kind === "number" ? it.unit || "" : "%", target: kind === "number" ? it.num_target : 100, points };
}
function finalize(out, prev, edits, tags, rel) {
  const resolve = (src, old) => {
    const r = (Array.isArray(src) ? src : []).map((t) => typeof t === "string" ? tags.get(t.replace(/[[\]]/g, "")) : t).filter((x) => !!x).map((s) => ({ type: s.type, id: s.id, label: s.label }));
    const uniq = [...new Map(r.map((x) => [`${x.type}:${x.id}:${x.label}`, x])).values()].slice(0, 6);
    return uniq.length ? uniq : (old ?? []).filter((x) => typeof x !== "string");
  };
  const pinned = new Set(edits.pinned ?? []);
  const str = (v) => typeof v === "string" && v.trim().length > 0;
  const fix = (list, old, ok, max) => {
    const prevById = new Map((old ?? []).map((x) => [x.id, x]));
    const keep = [...pinned].map((id) => prevById.get(id)).filter((x) => !!x);
    const keepIds = new Set(keep.map((x) => x.id));
    const now = (Array.isArray(list) ? list : []).filter((x) => x && str(x.id) && ok(x) && !keepIds.has(x.id)).map((x) => ({ ...x, src: resolve(x.src, prevById.get(x.id)?.src) }));
    return [...keep, ...now].slice(0, Math.max(max, keep.length));
  };
  const events = fix(out.events, prev?.events, (e) => str(e.title) && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date ?? "")) && str(e.lane), 30);
  const lanes = (Array.isArray(out.lanes) ? out.lanes : []).filter((l) => l && str(l.id) && str(l.title)).slice(0, 6);
  for (const e of events) if (pinned.has(e.id) && !lanes.some((l) => l.id === e.lane)) {
    const pl = prev?.lanes?.find((l) => l.id === e.lane);
    if (pl) lanes.push(pl);
  }
  const laneIds = new Set(lanes.map((l) => l.id));
  const c = {
    summary: clip(out.summary, 160),
    lanes,
    events: events.filter((e) => laneIds.has(e.lane)),
    people: fix(out.people, prev?.people, (p) => str(p.name), 12),
    related: (Array.isArray(out.related) ? out.related : []).map((r) => {
      const t = r?.ref ? rel.get(r.ref) : null;
      return t ? { item_id: t.id, title: t.title, why: clip(r.why, 40) } : null;
    }).filter(Boolean)
  };
  for (const k of LISTS) c[k] = fix(out[k], prev?.[k], (l) => str(l.text), 12);
  const evIds = new Set((c.events ?? []).map((e) => e.id));
  c.links = (Array.isArray(out.links) ? out.links : []).filter((l) => l && evIds.has(l.from) && evIds.has(l.to)).slice(0, 16);
  return c;
}
async function updateOne(it, recs, ctx) {
  const { data: row } = await admin.from("task_histories").select("*").eq("item_id", it.id).maybeSingle();
  const prev = row?.content ?? null;
  const edits = row?.edits ?? {};
  const initial = !row || !prev?.summary;
  if (!initial && !recs.length && !ctx.force) return { item_id: it.id, skipped: "no_new_records" };
  const book = new SourceBook();
  const tags = /* @__PURE__ */ new Map();
  const lines = [];
  for (const r of recs.sort((a, b) => a.at.localeCompare(b.at))) {
    const tag = book.add(r.type, r.id, r.label, `[${day(r.at)}] ${r.text}`);
    tags.set(tag, book.sources[book.sources.length - 1]);
    lines.push(tag);
  }
  const { data: owners } = await admin.from("work_item_events").select("old, new").eq("item_id", it.id).eq("kind", "owner").order("created_at");
  const previous = [...new Set((owners ?? []).map((o) => ctx.nameOf(o.old)).filter((n) => n && n !== ctx.nameOf(it.owner_id)))];
  const { data: parent } = it.parent_id ? await admin.from("work_items").select("title").eq("id", it.parent_id).maybeSingle() : { data: null };
  const rel = /* @__PURE__ */ new Map();
  ctx.others.filter((o) => o.id !== it.id).slice(0, 30).forEach((o, i) => rel.set(`R${i + 1}`, { id: o.id, title: o.title }));
  const pinned = new Set(edits.pinned ?? []);
  const prevForAi = prev ? JSON.stringify({ ...prev, progress: void 0, owner: void 0, meta: void 0 }, (k, v) => k === "src" ? void 0 : v) : "";
  const input = [
    `## \uACFC\uC81C
${it.title} / \uC0C1\uC704 \uBAA9\uD45C ${parent?.title ?? "-"} / \uB2F4\uB2F9 ${ctx.nameOf(it.owner_id) || "\uC5C6\uC74C"}${previous.length ? ` (\uC774\uC804 \uB2F4\uB2F9 ${previous.join(", ")})` : ""} / \uC0C1\uD0DC ${STATUS_KO[it.status] ?? it.status} / \uC9C4\uCC99 ${it.measure === "number" ? `${it.num_current ?? "-"} / ${it.num_target ?? "-"}${it.unit}` : `${it.progress}%`} / \uAE30\uAC04 ${it.start_date ?? "-"} ~ ${it.due_date ?? "-"} / \uC624\uB298 ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}${it.note ? `
\uC124\uBA85: ${clip(it.note, 400)}` : ""}`,
    `## \uD300\uC6D0 \uBAA9\uB85D
${ctx.members}`,
    `## \uD300\uC758 \uB2E4\uB978 \uACFC\uC81C (related \uACE0\uB97C \uB54C\uB9CC)
${[...rel.entries()].map(([k, v]) => `${k}: ${v.title}`).join("\n") || "(\uC5C6\uC74C)"}`,
    prev ? `## \uAE30\uC874 \uD788\uC2A4\uD1A0\uB9AC
${prevForAi}${pinned.size ? `
\uACE0\uC815 \uD56D\uBAA9 (\uADF8\uB300\uB85C \uB458 \uAC83): ${[...pinned].join(", ")}` : ""}` : "## \uAE30\uC874 \uD788\uC2A4\uD1A0\uB9AC\n(\uC5C6\uC74C \u2014 \uCC98\uC74C \uB9CC\uB4ED\uB2C8\uB2E4)",
    book.text(prev ? `\uC0C8 \uAE30\uB85D (${fmtDate(row?.synced_at)} \uC774\uD6C4)` : "\uAE30\uB85D \uC804\uCCB4")
  ].join("\n\n");
  const { parsed, output } = await runAi({
    teamId: ctx.teamId,
    kind: "task_history",
    model: initial ? MODEL_SMART : MODEL_FAST,
    system: SYSTEM,
    content: [{ type: "text", text: input }],
    book,
    depth: depthOf(recs.length, [5, 15, 40]),
    level: "L2",
    createdBy: ctx.createdBy,
    refTable: "work_items",
    refId: it.id,
    maxTokens: initial ? 4e3 : 3e3,
    force: true
  });
  const content = finalize(parsed, prev, edits, tags, rel);
  content.progress = await progressOf(it);
  content.owner = { id: it.owner_id, name: ctx.nameOf(it.owner_id), previous };
  content.meta = { model: output.model, ai_output_id: output.id, records: (row?.record_count ?? 0) + recs.length };
  const up = {
    item_id: it.id,
    team_id: ctx.teamId,
    content,
    synced_at: ctx.startedAt,
    record_count: (row?.record_count ?? 0) + recs.length,
    new_count: recs.length,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const { error } = await admin.from("task_histories").upsert(up, { onConflict: "item_id" });
  if (error) throw error;
  return { item_id: it.id, updated: true, new_records: recs.length };
}
async function runTeam(teamId, opts) {
  const startedAt = new Date(Date.now() - 1e3).toISOString();
  const all = await teamItems(teamId);
  const { data: mem } = await admin.from("team_members").select("user_id, role, job_title, status, profiles(full_name)").eq("team_id", teamId);
  const names = new Map((mem ?? []).map((m) => [m.user_id, m.profiles?.full_name ?? ""]));
  const nameOf = (id) => id ? names.get(id) ?? "" : "";
  const members = (mem ?? []).filter((m) => m.status === "active").map((m) => `${names.get(m.user_id)} (${m.role === "leader" ? "\uD300\uC7A5" : m.job_title || "\uD300\uC6D0"})`).join(", ");
  let targets = opts.itemIds?.length ? await teamItems(teamId, opts.itemIds) : all;
  const { data: hs } = await admin.from("task_histories").select("item_id, synced_at").eq("team_id", teamId);
  const syncedOf = new Map((hs ?? []).map((h) => [h.item_id, h.synced_at]));
  if (opts.weekly) {
    if (!syncedOf.size) return { team_id: teamId, skipped: "not_enabled" };
    const { data: bud } = await admin.rpc("ai_budget", { p_team: teamId });
    const b = bud;
    if (b && Number(b.cap_usd) > 0 && Number(b.cost_usd) >= Number(b.cap_usd) * 0.7) return { team_id: teamId, skipped: "budget" };
  }
  if (!targets.length) return { team_id: teamId, results: [] };
  const fresh = targets.filter((t) => !syncedOf.get(t.id));
  const old = targets.filter((t) => syncedOf.get(t.id));
  const recs = [];
  const byItem = /* @__PURE__ */ new Map();
  const group = (rs) => {
    for (const r of rs) {
      if (!byItem.has(r.item)) byItem.set(r.item, []);
      byItem.get(r.item).push(r);
    }
  };
  const count = (id) => byItem.get(id)?.length ?? 0;
  if (old.length) {
    const minSince = old.map((t) => syncedOf.get(t.id)).sort()[0];
    const got = await collect(teamId, old, minSince, nameOf, false);
    recs.push(...got.filter((r) => r.at > (syncedOf.get(r.item) ?? "")));
  }
  group(recs);
  const oldTargets = opts.weekly ? old.filter((t) => count(t.id) > 0).sort((a, b) => count(b.id) - count(a.id)).slice(0, WEEKLY_MAX) : old;
  const slots = opts.weekly ? WEEKLY_MAX - oldTargets.length : fresh.length;
  let freshTargets = [];
  if (fresh.length && slots > 0) {
    group(await collect(teamId, fresh, "1970-01-01T00:00:00Z", nameOf, true));
    for (const t of fresh) {
      const v = byItem.get(t.id);
      if (v && v.length > 120) byItem.set(t.id, v.sort((a, b) => a.at.localeCompare(b.at)).slice(-120));
    }
    freshTargets = opts.weekly ? fresh.filter((t) => count(t.id) > 0).sort((a, b) => count(b.id) - count(a.id)).slice(0, slots) : fresh;
  }
  targets = opts.weekly ? [...oldTargets, ...freshTargets] : targets.filter((t) => syncedOf.get(t.id) || freshTargets.includes(t));
  const ctx = { teamId, createdBy: opts.createdBy, nameOf, members, others: all, startedAt, force: opts.force };
  const results = [];
  for (let i = 0; i < targets.length; i += PARALLEL) {
    const chunk = targets.slice(i, i + PARALLEL);
    const got = await Promise.allSettled(chunk.map((t) => updateOne(t, byItem.get(t.id) ?? [], ctx)));
    got.forEach((g, j) => results.push(g.status === "fulfilled" ? g.value : { item_id: chunk[j].id, error: g.reason?.code ?? "ERROR", message: String(g.reason?.message ?? g.reason) }));
    if (got.some((g) => g.status === "rejected" && /AI_(COST_CAP|RATE_HOUR|RATE_DAY)|CORE_LIMIT|AI_LOCKED/.test(`${g.reason?.code ?? ""} ${g.reason?.message ?? ""}`))) break;
  }
  return { team_id: teamId, results };
}
serve(async (req) => {
  const body = await readJson(req);
  const caller = await getCaller(req);
  if (body.all) {
    if (!caller.isService) throw new HttpError(403, "forbidden");
    const ids = /* @__PURE__ */ new Set();
    for (let from = 0; ; from += 1e3) {
      const { data, error } = await admin.from("task_histories").select("team_id").order("team_id").range(from, from + 999);
      if (error) throw error;
      (data ?? []).forEach((t) => ids.add(t.team_id));
      if ((data ?? []).length < 1e3) break;
    }
    const out = [];
    for (const team_id of ids) {
      const { data: on } = await admin.rpc("team_has_feature", { p_team: team_id, p_feature: "history" });
      if (on) out.push(await runTeam(team_id, { createdBy: null, weekly: true }).catch((e) => ({ team_id, error: String(e.message) })));
    }
    return json({ teams: out });
  }
  if (!body.team_id) throw new HttpError(400, "MISSING_TEAM");
  await assertLeader(caller, body.team_id);
  await assertFeature(body.team_id, "history");
  if (body.weekly) return json(await runTeam(body.team_id, { createdBy: null, weekly: true }));
  const itemIds = body.item_id ? [body.item_id] : (body.item_ids ?? []).slice(0, PARALLEL * 2);
  if (!itemIds.length) throw new HttpError(400, "MISSING_ITEM");
  return json(await runTeam(body.team_id, { createdBy: caller.userId, itemIds, force: !!body.force }));
});
