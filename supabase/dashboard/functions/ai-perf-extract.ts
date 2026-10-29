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

// functions/_shared/anthropic.ts
var MODEL_SMART = Deno.env.get("AI_MODEL_SMART") ?? "claude-sonnet-5-5";
var MODEL_FAST = Deno.env.get("AI_MODEL_FAST") ?? "claude-sonnet-5-5";
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
    messages: [{ role: "user", content: opts.content }],
    ...opts.thinking === "fast" ? fastThinking(opts.model) : {},
    ...opts.effort ? { output_config: { effort: opts.effort } } : {}
  };
  const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : 0;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const remain = deadline ? deadline - Date.now() : 0;
    if (deadline && remain < 5e3) throw new HttpError(504, "AI_TIMEOUT", `AI \uC751\uB2F5\uC774 ${Math.round((opts.timeoutMs ?? 0) / 1e3)}\uCD08 \uC548\uC5D0 \uC624\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4${lastErr ? ` (${lastErr.slice(0, 120)})` : ""}`);
    const ctl = deadline ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), remain) : null;
    let res;
    try {
      res = await fetch(`${Deno.env.get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        signal: ctl?.signal,
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (ctl?.signal.aborted) throw new HttpError(504, "AI_TIMEOUT", `AI \uC751\uB2F5\uC774 ${Math.round((opts.timeoutMs ?? 0) / 1e3)}\uCD08 \uC548\uC5D0 \uC624\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4`);
      throw e;
    }
    if (res.ok) {
      let data;
      try {
        data = await res.json();
      } catch (e) {
        if (ctl?.signal.aborted) throw new HttpError(504, "AI_TIMEOUT", `AI \uC751\uB2F5\uC774 ${Math.round((opts.timeoutMs ?? 0) / 1e3)}\uCD08 \uC548\uC5D0 \uC624\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4`);
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
      const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      if (!text.trim() && deadline) {
        console.warn("claude empty response", { stop: data.stop_reason, usage: data.usage });
        throw new HttpError(502, "AI_EMPTY", `AI \uC751\uB2F5\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4 (stop: ${data.stop_reason ?? "-"})`);
      }
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
    lastErr = `${res.status} ${await res.text().catch(() => "")}`;
    if (timer) clearTimeout(timer);
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }
  throw new HttpError(502, "AI_UPSTREAM", lastErr.slice(0, 500));
}
function fastThinking(model) {
  if (/-5-5|fable|mythos/.test(model)) return { thinking: { type: "between_tools" } };
  if (/-5($|-)/.test(model)) return { thinking: { type: "disabled" } };
  return {};
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
  "task_history",
  "autopilot",
  "team_direction",
  "perf_extract"
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
  autopilot: 0,
  team_direction: 0,
  perf_extract: 0,
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
    maxTokens: job.maxTokens,
    timeoutMs: job.timeoutMs,
    thinking: job.thinking,
    effort: job.effort
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

// functions/ai-perf-extract/index.ts
var PROMPT = `\uACFC\uC81C: \uC62C\uB9B0 \uD30C\uC77C\uC5D0\uC11C \uC544\uB798 \uBAA9\uD45C \uD56D\uBAA9(P#)\uC758 '\uD604\uC7AC \uC2E4\uC801 \uAC12'\uC744 \uCC3E\uC544 \uC81C\uC548\uD569\uB2C8\uB2E4. \uC0AC\uB78C\uC774 \uD655\uC778\uD55C \uB4A4 \uB4F1\uB85D\uD558\uBBC0\uB85C, \uD655\uC2E4\uD558\uC9C0 \uC54A\uC73C\uBA74 \uADF8\uB807\uB2E4\uACE0 \uD45C\uC2DC\uD569\uB2C8\uB2E4.
- \uD30C\uC77C\uC5D0 \uADFC\uAC70\uAC00 \uC788\uB294 \uD56D\uBAA9\uB9CC \uC501\uB2C8\uB2E4. \uADFC\uAC70\uAC00 \uC5C6\uC73C\uBA74 \uADF8 \uD56D\uBAA9\uC740 \uBE7C\uACE0, \uC22B\uC790\uB97C \uC9C0\uC5B4\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- value: \uD56D\uBAA9 \uB2E8\uC704\uC5D0 \uB9DE\uCD98 \uC22B\uC790 \uD558\uB098 (number: \uADF8 \uB2E8\uC704\uC758 \uAC12, percent: 0~100). \uB204\uC801\uC778\uC9C0 \uAE30\uAC04 \uAC12\uC778\uC9C0 \uD56D\uBAA9 \uC124\uBA85\uACFC \uB9DE\uCDB0 \uACE0\uB985\uB2C8\uB2E4.
  stage \uD56D\uBAA9\uC740 stage(1\uBD80\uD130 \uB2E8\uACC4 \uBC88\uD638), done \uD56D\uBAA9\uC740 \uC644\uB8CC\uAC00 \uD655\uC778\uB420 \uB54C\uB9CC done: true.
- period: \uAC12\uC774 \uAC00\uB9AC\uD0A4\uB294 \uAE30\uAC04 (\uC608: "10\uC6D4", "10/1~10/31", "3\uBD84\uAE30 \uB204\uACC4"). \uBAA8\uB974\uBA74 \uBE48 \uBB38\uC790\uC5F4.
- location: \uD30C\uC77C \uC548 \uC704\uCE58 (\uC5D1\uC140\uC740 "\uC2DC\uD2B8!\uC140" \uC608: "\uC694\uC57D!C7", \uBB38\uC11C\uB294 "3\uCABD \uD45C" \uCC98\uB7FC).
- candidates: \uADF8\uB7F4\uB4EF\uD55C \uAC12\uC774 \uB458 \uC774\uC0C1\uC774\uBA74 [{ "value": \uC22B\uC790, "location": "..." }]. \uD558\uB098\uBA74 \uBE48 \uBC30\uC5F4.
- issue: \uD655\uC778\uC774 \uD544\uC694\uD558\uBA74 \uC9E7\uAC8C ("\uAC12 2\uAC1C \xB7 \uACE8\uB77C \uC8FC\uC138\uC694", "\uAE30\uAC04 \uBD88\uBA85\uD655", "\uB2E8\uC704 \uB2E4\uB984(\uCC9C\uC6D0)"), \uC544\uB2C8\uBA74 \uBE48 \uBB38\uC790\uC5F4.
- note: \uD55C \uC904 \uC124\uBA85 (\uC608: "\uC694\uC57D \uC2DC\uD2B8 10\uC6D4 \uD569\uACC4") \u2014 \uC131\uACFC\uC785\uB825\uC758 \uD55C \uC904 \uC124\uBA85\uC73C\uB85C \uC501\uB2C8\uB2E4.
\uCD9C\uB825 JSON: { "rows": [ { "ref": "P1", "value": 12480, "stage": null, "done": false, "period": "...", "location": "...", "candidates": [], "issue": "", "note": "..." } ] }`;
serve(async (req) => {
  const body = await readJson(req);
  if (!body.team_id || !body.item_ids?.length) throw new HttpError(400, "MISSING");
  const caller = await getCaller(req);
  if (caller.isService) throw new HttpError(403, "forbidden");
  const { data: me } = await admin.from("team_members").select("role, status").eq("team_id", body.team_id).eq("user_id", caller.userId).maybeSingle();
  if (!me || me.status !== "active") throw new HttpError(403, "forbidden");
  const leader = me.role === "leader";
  if (body.mode === "leader" && !leader) throw new HttpError(403, "forbidden");
  if (!body.text?.trim() && !body.pdf && !body.image) throw new HttpError(422, "NO_TEXT", "\uD30C\uC77C\uC5D0\uC11C \uC77D\uC744 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4");
  if ((body.pdf?.length ?? 0) > 14e6 || (body.image?.length ?? 0) > 8e6) throw new HttpError(413, "FILE_TOO_LARGE", "\uD30C\uC77C\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4 (PDF 10MB\uAE4C\uC9C0)");
  const { data: items } = await admin.from("work_items").select("id, title, owner_id, measure, unit, num_target, num_current, progress, stages, stage_current, status, team_id").in("id", body.item_ids.slice(0, 40)).eq("team_id", body.team_id);
  const list = (items ?? []).filter((x) => x.status !== "dropped" && (body.mode === "leader" ? true : x.owner_id === caller.userId));
  if (!list.length) throw new HttpError(422, "NO_ITEMS", "\uC2E4\uC801\uC744 \uB123\uC744 \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4");
  const ref = new Map(list.map((x, i) => [`P${i + 1}`, x]));
  const kind = (m) => m === "number" ? "number" : m === "percent" ? "percent" : m === "stage" ? "stage" : m === "check" ? "done" : "percent";
  const lines = [...ref.entries()].map(([r, x]) => `${r} ${x.title} \xB7 \uBC29\uC2DD ${kind(x.measure)}${x.measure === "number" ? ` \xB7 \uB2E8\uC704 '${x.unit ?? ""}' \xB7 \uBAA9\uD45C ${x.num_target ?? "-"} \xB7 \uC9C0\uAE08 ${x.num_current ?? "-"}` : ""}${x.measure === "stage" ? ` \xB7 \uB2E8\uACC4 ${(x.stages ?? []).map((s, i) => `${i + 1}.${s}`).join(" ")}` : ""}${x.measure === "percent" ? ` \xB7 \uC9C0\uAE08 ${x.progress}%` : ""}`);
  const content = [];
  if (body.pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: body.pdf }, title: body.file_name ?? "\uD30C\uC77C" });
  if (body.image) content.push({ type: "image", source: { type: "base64", media_type: body.image_type ?? "image/jpeg", data: body.image } });
  content.push({ type: "text", text: [`\uD30C\uC77C: ${body.file_name ?? ""}`, `## \uBAA9\uD45C \uD56D\uBAA9 (P#)
${lines.join("\n")}`, body.text?.trim() ? `## \uD30C\uC77C \uB0B4\uC6A9
${body.text.slice(0, 8e4)}` : ""].filter(Boolean).join("\n\n") });
  const { parsed } = await runAi({
    teamId: body.team_id,
    kind: "perf_extract",
    model: MODEL_SMART,
    system: PROMPT,
    content,
    book: new SourceBook(),
    depth: 1,
    level: "L1",
    createdBy: caller.userId,
    subjectUserId: caller.userId,
    visibility: body.mode === "leader" ? "leader" : "subject",
    credits: 0,
    force: true,
    maxTokens: 3500,
    timeoutMs: 12e4,
    thinking: "fast",
    effort: "low"
  });
  const num = (v) => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const rows = (Array.isArray(parsed.rows) ? parsed.rows : []).flatMap((r) => {
    const x = ref.get(String(r?.ref ?? ""));
    if (!x) return [];
    const k = kind(x.measure);
    const value = num(r.value);
    const stage = num(r.stage);
    if (k === "number" && value == null) return [];
    if (k === "percent" && (value == null || value < 0 || value > 100)) return [];
    if (k === "stage" && (stage == null || stage < 1 || stage > (x.stages ?? []).length)) return [];
    if (k === "done" && !r.done) return [];
    return [{
      item_id: x.id,
      type: k,
      value: k === "number" || k === "percent" ? value : null,
      stage: k === "stage" ? Math.round(stage) : null,
      period: String(r.period ?? "").slice(0, 40),
      location: String(r.location ?? "").slice(0, 60),
      issue: String(r.issue ?? "").slice(0, 40),
      note: String(r.note ?? "").slice(0, 120),
      candidates: (Array.isArray(r.candidates) ? r.candidates : []).map((c) => ({ value: num(c?.value), location: String(c?.location ?? "").slice(0, 60) })).filter((c) => c.value != null).slice(0, 3)
    }];
  });
  return json({ rows });
});
