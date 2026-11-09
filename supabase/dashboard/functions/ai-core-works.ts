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
async function assertFeature(teamId, feature) {
  const { data, error } = await admin.rpc("team_has_feature", { p_team: teamId, p_feature: feature });
  if (error) throw error;
  if (!data) throw new HttpError(402, "PLAN_FEATURE", `\uC694\uAE08\uC81C\uC5D0 '${feature}' \uAE30\uB2A5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4`);
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
  "perf_extract",
  "decision_asks",
  "core_work"
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
  decision_asks: 0,
  core_work: 0,
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
var SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
var demoTeams = /* @__PURE__ */ new Map();
async function demoGate(teamId, kind) {
  const ctx = reqCtx.getStore();
  if (!ctx || !ctx.auth || ctx.auth.replace(/^Bearer\s+/i, "") === SERVICE_KEY) return null;
  if (!demoTeams.has(teamId)) {
    const { data } = await admin.from("teams").select("is_demo").eq("id", teamId).maybeSingle();
    demoTeams.set(teamId, !!data?.is_demo);
  }
  if (!demoTeams.get(teamId)) return null;
  const token = ctx.demoToken;
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) throw new HttpError(403, "DEMO_LINK", "\uB370\uBAA8 \uB9C1\uD06C\uB85C \uB4E4\uC5B4\uC628 \uACBD\uC6B0\uC5D0\uB9CC AI\uB97C \uCCB4\uD5D8\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  const { data: ok, error } = await admin.rpc("demo_ai_take", { p_token: token, p_kind: kind });
  if (error) throw error;
  if (!ok) throw new HttpError(429, "DEMO_AI_LIMIT", "\uB370\uBAA8\uC5D0\uC11C\uB294 AI \uAE30\uB2A5\uB9C8\uB2E4 \uD55C \uBC88\uC529 \uCCB4\uD5D8\uD560 \uC218 \uC788\uC5B4\uC694. \uB0B4 \uD300\uC73C\uB85C \uC2DC\uC791\uD558\uBA74 \uB9C8\uC74C\uAECF \uC4F8 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  return async () => {
    await admin.rpc("demo_ai_refund", { p_token: token, p_kind: kind });
  };
}
async function runAi(job) {
  const credits = job.credits ?? CREDITS[job.kind];
  const core = CORE.includes(job.kind) && !credits;
  await assertAccess(job.teamId, job.kind, credits);
  const again = await recent(job);
  if (again) return { output: again, parsed: again.content, reused: true };
  const demoRefund = await demoGate(job.teamId, job.kind);
  try {
    await guard(job);
  } catch (e) {
    await demoRefund?.();
    throw e;
  }
  const res = await callClaude({
    model: job.model,
    system: `${BASE_RULES}

${job.system}`,
    content: job.content,
    maxTokens: job.maxTokens,
    timeoutMs: job.timeoutMs,
    thinking: job.thinking,
    effort: job.effort
  }).catch(async (e) => {
    await demoRefund?.();
    throw e;
  });
  let parsed;
  try {
    parsed = parseJson(res.text);
  } catch (e) {
    await demoRefund?.();
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

// functions/ai-core-works/index.ts
var FOLD_MAX = 8;
var LINK_MAX = 30;
var SYNTH_MAX = 4;
var DAY = 864e5;
var yearOf = (i) => Number((i.start_date ?? i.due_date ?? i.created_at).slice(0, 4));
var ym = (d) => d ? d.slice(0, 7) : "";
var lines = (x, n = 6) => (Array.isArray(x) ? x : []).slice(0, n).map((l) => l?.text ?? (l?.name ? `${l.name}${l.role ? `(${l.role})` : ""}` : "")).filter(Boolean).join(" / ");
var FOLD = `\uACFC\uC81C \uD558\uB098\uC758 \uD788\uC2A4\uD1A0\uB9AC(JSON)\uB97C '\uC7A5(\u7AE0)' \uD55C \uAC1C\uB85C \uC811\uC2B5\uB2C8\uB2E4. \uBA87 \uB144 \uB4A4 \uC774 \uC77C\uC744 \uB118\uACA8\uBC1B\uB294 \uC0AC\uB78C\uC774 \uC77D\uC744 \uAE30\uB85D\uC785\uB2C8\uB2E4.
- \uC0AC\uC18C\uD55C \uC9C4\uD589\uC740 \uBC84\uB9AC\uACE0, \uB0A8\uAE38 \uAC00\uCE58\uAC00 \uC788\uB294 \uAC83\uB9CC: \uBB34\uC5C7\uC744 \uC815\uD588\uACE0(\uC774\uC720\uC640 \uD568\uAED8), \uACB0\uACFC\uAC00 \uC5B4\uB560\uACE0, \uBC30\uC6B4 \uAC83, \uB2E4\uC74C\uC73C\uB85C \uB118\uC5B4\uAC04 \uC219\uC81C, \uC5EE\uC778 \uC0AC\uB78C\xB7\uC870\uC9C1.
- \uD788\uC2A4\uD1A0\uB9AC\uC5D0 \uC5C6\uB294 \uB0B4\uC6A9\uC744 \uC9C0\uC5B4\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uBB38\uCCB4\uB294 \uAC1C\uC870\uC2DD \uBA85\uC0AC\uD615.
\uCD9C\uB825 JSON: {"summary":"\uC774 \uACFC\uC81C\uAC00 \uD55C \uC77C \uD55C \uBB38\uC7A5 (60\uC790)","key":"\uADF8\uD574 \uD575\uC2EC \uD55C \uC904 (24\uC790 \uC548\uD30E, \uC5F0\uB3C4\uBCC4 \uD750\uB984 \uCE78\uC5D0 \uB4E4\uC5B4\uAC10)",
 "decisions":["\uBB34\uC5C7\uC744 \uC65C \uC815\uD588\uB098 (60\uC790)"],"results":"\uACB0\uACFC \uD55C \uBB38\uC7A5","lessons":["\uBC30\uC6B4 \uAC83 \xB7 \uD574 \uBD24\uB294\uB370 \uC548 \uB41C \uAC83"],"carried":["\uB2E4\uC74C\uC73C\uB85C \uB118\uC5B4\uAC04 \uC219\uC81C"],
 "people":["\uC0AC\uB78C\xB7\uC870\uC9C1 \u2014 \uC774 \uACFC\uC81C\uC5D0\uC11C\uC758 \uAD00\uACC4 (40\uC790)"]}  \uAC01 \uBAA9\uB85D \uCD5C\uB300 5\uAC1C.`;
var LINK = `\uD300\uC758 \uACFC\uC81C\uB4E4\uC744 '\uD575\uC2EC \uC5C5\uBB34'\uB85C \uBB36\uC2B5\uB2C8\uB2E4. \uD575\uC2EC \uC5C5\uBB34\uB294 \uD574\uAC00 \uBC14\uB00C\uC5B4\uB3C4 \uACC4\uC18D\uB418\uB294 \uC77C\uC785\uB2C8\uB2E4 (\uC608: \uC81C\uD734\uC0AC \uD30C\uD2B8\uB108\uC2ED \uC6B4\uC601, \uC5F0\uAC04 \uC608\uC0B0 \uD3B8\uC131).
\uD574\uB9C8\uB2E4 \uACFC\uC81C \uC774\uB984\uC740 \uB2EC\uB77C\uB3C4 \uAC19\uC740 \uC77C\uC774 \uC774\uC5B4\uC9C0\uB294\uC9C0\uB97C \uBD05\uB2C8\uB2E4. \uD310\uB2E8 \uADFC\uAC70(\uC911\uC694\uD55C \uC21C\uC11C):
1) \uAC19\uC740 \uAD00\uACC4\uC790(\uC678\uBD80 \uD68C\uC0AC \xB7 \uC720\uAD00 \uBD80\uC11C)\uAC00 \uC774\uC5B4\uC11C \uB098\uC634  2) \uC55E \uACFC\uC81C\uC758 \uC219\uC81C \xB7 \uC774\uC288 \xB7 \uACB0\uC815\uC774 \uB2E4\uC74C \uACFC\uC81C\uC5D0 \uC774\uC5B4\uC9D0  3) \uAC19\uC740 \uC9C0\uD45C \xB7 \uC22B\uC790\uB97C \uB2E4\uB8F8  4) \uB2F4\uB2F9\uC790 \uD750\uB984  5) \uC81C\uBAA9 \xB7 \uC124\uBA85 (\uBCF4\uC870\uB85C\uB9CC)
\uADDC\uCE59:
- \uD655\uC2E4\uD560 \uB54C\uB9CC \uBB36\uC2B5\uB2C8\uB2E4. \uC560\uB9E4\uD558\uBA74 core \uB97C null \uB85C \uB461\uB2C8\uB2E4 (\uB2E8\uB3C5 \uACFC\uC81C\uB85C \uB0A8\uACE0 \uB2E4\uC74C \uC8FC\uC5D0 \uB2E4\uC2DC \uBD04).
- \uC0C8 \uD575\uC2EC \uC5C5\uBB34\uB294 \uC11C\uB85C \uC774\uC5B4\uC9C0\uB294 \uACFC\uC81C\uAC00 2\uAC1C \uC774\uC0C1\uC77C \uB54C\uB9CC \uB9CC\uB4ED\uB2C8\uB2E4 (\uC544\uB798 '\uACFC\uC81C'\uC640 '\uC7A5' \uBAA8\uB450 \uC149\uB2C8\uB2E4). \uC774\uB984\uC740 '\u25CB\u25CB \uC6B4\uC601 \xB7 \u25CB\u25CB \uAD00\uB9AC'\uCC98\uB7FC \uACC4\uC18D\uB418\uB294 \uC77C\uC758 \uC774\uB984\uC73C\uB85C (14\uC790 \uC548\uD30E). \uADF8\uD574 \uBAA9\uD45C \uC774\uB984(\u25CB\u25CB \uD655\uB300 \xB7 \u25CB\u25CB \uB2EC\uC131)\uC73C\uB85C \uC9D3\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- \uC774\uBBF8 \uBB36\uC778 \uACFC\uC81C\uB294 \uADFC\uAC70\uAC00 \uBD84\uBA85\uD788 \uB2EC\uB77C\uC84C\uC744 \uB54C\uB9CC \uC62E\uAE30\uAC70\uB098 \uBE8D\uB2C8\uB2E4 (keep \uC774 \uAE30\uBCF8).
- reason \uC740 \uD654\uBA74\uC5D0 \uADF8\uB300\uB85C \uBCF4\uC785\uB2C8\uB2E4: \uBB34\uC5C7\uC774 \uAC19\uC544\uC11C \uBB36\uC5C8\uB294\uC9C0 \uC9E7\uAC8C (\uC608: "\uAD00\uACC4\uC790 B\uC0AC \xB7 \uC9C0\uD45C '\uC81C\uD734 \uC2E0\uADDC \uACE0\uAC1D'\uC774 \uAC19\uC74C").
\uCD9C\uB825 JSON: {"new":[{"key":"N1","title":"..."}],
 "assign":[{"n":\uACFC\uC81C \uBC88\uD638,"core":"C1 \uAC19\uC740 \uAE30\uC874 id \uB610\uB294 N1 \uAC19\uC740 \uC0C8 key \uB610\uB294 null","keep":true/false,"reason":"..."}],
 "chapters":[{"n":\uC7A5 \uBC88\uD638,"core":"C1 \uB610\uB294 N1 \uB610\uB294 null","reason":"..."}]}`;
var SYNTH = `'\uD575\uC2EC \uC5C5\uBB34' \uD558\uB098\uC758 \uC5EC\uB7EC \uD574 \uD750\uB984\uC744 \uC815\uB9AC\uD569\uB2C8\uB2E4. \uC774 \uC77C\uC744 \uCC98\uC74C \uB118\uACA8\uBC1B\uB294 \uC0AC\uB78C\uC774 \uD558\uB8E8 \uB9CC\uC5D0 \uB9E5\uB77D\uC744 \uD30C\uC545\uD558\uAC8C \uD558\uB294 \uBB38\uC11C\uC785\uB2C8\uB2E4.
\uC7AC\uB8CC: \uD574\uB9C8\uB2E4 \uC811\uC5B4 \uB454 '\uC7A5'(\uB05D\uB09C \uACFC\uC81C)\uACFC \uC9C0\uAE08 \uC9C4\uD589 \uC911\uC778 \uACFC\uC81C\uC758 \uD788\uC2A4\uD1A0\uB9AC \uC694\uC57D. \uAE30\uC874 \uC815\uB9AC\uAC00 \uC788\uC73C\uBA74 \uACE0\uCCD0 \uC501\uB2C8\uB2E4.
\uC6D0\uCE59:
- \uC7AC\uB8CC\uC5D0 \uC788\uB294 \uAC83\uB9CC \uC501\uB2C8\uB2E4. \uCD94\uCE21\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC5F0\uB3C4\uB294 \uC7AC\uB8CC\uC5D0 \uC788\uB294 \uAC83\uB9CC.
- \uB0B1\uAC1C \uC0AC\uAC74\uC744 \uB298\uC5B4\uB193\uC9C0 \uB9D0\uACE0, \uC5EC\uB7EC \uD574\uC5D0 \uAC78\uCCD0 \uC758\uBBF8 \uC788\uB294 \uAC83\uC73C\uB85C \uC62C\uB824 \uC815\uB9AC\uD569\uB2C8\uB2E4.
- principles: \uC9C0\uCF1C \uC628 \uC6D0\uCE59 \xB7 \uD655\uC815 \uC0AC\uD56D (\uC5B8\uC81C \uBB34\uC2A8 \uC77C\uB85C \uC815\uD574\uC84C\uB294\uC9C0 year \uC640 \uD568\uAED8)
- recurring: \uD574\uB9C8\uB2E4 \xB7 \uBD84\uAE30\uB9C8\uB2E4 \uBC18\uBCF5\uB418\uB294 \uC77C (when: "\uB9E4\uB144 3\uC6D4" \uAC19\uC774 \uC7AC\uB8CC\uB85C \uD655\uC778\uB418\uB294 \uAC83\uB9CC)
- tried: \uD574 \uBD24\uB294\uB370 \uC548 \uB41C \uAC83 (year)
- people: \uC624\uB798 \uC774\uC5B4\uC9C4 \uAD00\uACC4\uC790 \u2014 \uC870\uC9C1 \xB7 \uC0AC\uB78C\uACFC \uAD00\uACC4\uC758 \uBCC0\uD654 (since: \uCC98\uC74C \uB098\uC628 \uD574)
- open: \uC9C0\uAE08 \uC5F4\uB824 \uC788\uB294 \uC219\uC81C (since: \uCC98\uC74C \uC0DD\uAE34 \uD574)
- cautions: \uB118\uACA8\uBC1B\uB294 \uC0AC\uB78C\uC774 \uC870\uC2EC\uD560 \uAC83 (\uC7AC\uB8CC\uC5D0 \uADFC\uAC70\uAC00 \uC788\uC744 \uB54C\uB9CC)
- gaps: \uB118\uACA8\uBC1B\uB294 \uC0AC\uB78C\uC5D0\uAC8C \uAF2D \uD544\uC694\uD55C\uB370 \uC7AC\uB8CC\uC5D0 \uC5C6\uB294 \uAC83 "\uBB34\uC5C7 \u2014 \uAE30\uB85D \uC5C6\uC74C \u2192 \uB204\uAD6C\uC5D0\uAC8C \uD655\uC778"
- eras: \uB2F4\uB2F9\uC790 \uC2DC\uAE30 (\uC7AC\uB8CC\uC758 \uB2F4\uB2F9\uC790\uC640 \uAE30\uAC04\uC73C\uB85C) [{name, from:"YYYY-MM", to:"YYYY-MM" \uB610\uB294 null(\uC9C0\uAE08)}]
- \uBB38\uCCB4: \uAC1C\uC870\uC2DD \uBA85\uC0AC\uD615, \uAC01 \uC904 50\uC790 \uC548\uD30E. \uAC01 \uBAA9\uB85D \uCD5C\uB300 6\uAC1C.
\uCD9C\uB825 JSON: {"summary":"\uC9C0\uAE08\uAE4C\uC9C0\uC758 \uD750\uB984\uACFC \uD604\uD669 \uB450 \uBB38\uC7A5 (120\uC790)",
 "eras":[{"name":"","from":"","to":null}],
 "principles":[{"text":"","year":2021}],"recurring":[{"text":"","when":""}],"tried":[{"text":"","year":2023}],
 "people":[{"text":"","since":2019}],"open":[{"text":"","since":2024}],"cautions":[{"text":""}],"gaps":[{"text":""}]}`;
async function load(teamId) {
  const [{ data: hs }, { data: items }, { data: chs }, { data: cores }, { data: links }, { data: mem }] = await Promise.all([
    admin.from("task_histories").select("item_id, content, updated_at").eq("team_id", teamId),
    admin.from("work_items").select("id, title, note, status, owner_id, parent_id, start_date, due_date, done_at, created_at").eq("team_id", teamId).limit(2e3),
    admin.from("core_work_chapters").select("id, core_work_id, item_id, year, title, owner_name, period, content").eq("team_id", teamId).order("year"),
    admin.from("core_works").select("id, title, summary, content, dirty, synced_at").eq("team_id", teamId),
    admin.from("core_work_items").select("item_id, core_work_id, reason").eq("team_id", teamId),
    admin.from("team_members").select("user_id, profiles(full_name)").eq("team_id", teamId)
  ]);
  const names = new Map((mem ?? []).map((m) => [m.user_id, m.profiles?.full_name ?? ""]));
  return {
    hists: hs ?? [],
    items: new Map((items ?? []).map((i) => [i.id, i])),
    chapters: chs ?? [],
    cores: cores ?? [],
    links: links ?? [],
    nameOf: (id) => id ? names.get(id) ?? "" : ""
  };
}
var histText = (h, i, nameOf) => {
  const c = h.content;
  const owner = c.owner;
  return [
    `\uACFC\uC81C: ${i.title} (${yearOf(i)}\uB144 \xB7 \uC0C1\uD0DC ${i.status} \xB7 \uB2F4\uB2F9 ${[...owner?.previous ?? [], owner?.name ?? nameOf(i.owner_id)].filter(Boolean).join(" \u2192 ")})`,
    c.summary ? `\uD604\uD669: ${c.summary}` : "",
    lines(c.people, 8) ? `\uAD00\uACC4\uC790: ${lines(c.people, 8)}` : "",
    lines(c.fixed) ? `\uD655\uC815: ${lines(c.fixed)}` : "",
    lines(c.open) ? `\uBBF8\uACB0: ${lines(c.open)}` : "",
    lines(c.tried) ? `\uC774\uC804 \uC2DC\uB3C4: ${lines(c.tried)}` : "",
    lines(c.risks) ? `\uB9AC\uC2A4\uD06C: ${lines(c.risks)}` : "",
    i.note ? `\uC124\uBA85: ${i.note.slice(0, 200)}` : ""
  ].filter(Boolean).join("\n");
};
var chapterText = (c) => {
  const x = c.content;
  return [
    `${c.year}\uB144 \xB7 ${c.title} (\uB2F4\uB2F9 ${c.owner_name || "\uBBF8\uC0C1"}${c.period ? ` \xB7 ${c.period}` : ""})`,
    x.summary ?? "",
    x.decisions?.length ? `\uC815\uD55C \uAC83: ${x.decisions.join(" / ")}` : "",
    x.results ? `\uACB0\uACFC: ${x.results}` : "",
    x.lessons?.length ? `\uBC30\uC6B4 \uAC83: ${x.lessons.join(" / ")}` : "",
    x.carried?.length ? `\uB118\uC5B4\uAC04 \uC219\uC81C: ${x.carried.join(" / ")}` : "",
    x.people?.length ? `\uAD00\uACC4\uC790: ${x.people.join(" / ")}` : ""
  ].filter(Boolean).join("\n");
};
async function runTeam(teamId, createdBy) {
  const actions = [];
  const now = () => (/* @__PURE__ */ new Date()).toISOString();
  const ai = (system, text, smart = false, maxTokens = 1800) => runAi({
    teamId,
    kind: "core_work",
    model: smart ? MODEL_SMART : MODEL_FAST,
    system,
    content: [{ type: "text", text }],
    book: new SourceBook(),
    depth: 2,
    level: "L2",
    createdBy,
    visibility: "leader",
    credits: 0,
    force: true,
    maxTokens,
    timeoutMs: 9e4,
    thinking: "fast",
    effort: "low"
  }).then((r) => r.parsed);
  let d = await load(teamId);
  const histOf = new Map(d.hists.map((h) => [h.item_id, h]));
  const thisYear = Number(new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 4));
  const folded = new Set(d.chapters.map((c) => c.item_id).filter(Boolean));
  const toFold = d.hists.map((h) => d.items.get(h.item_id)).filter((i) => !!i && !folded.has(i.id) && (i.status === "done" || yearOf(i) < thisYear || !!i.due_date && Date.parse(i.due_date) < Date.now() - 30 * DAY)).slice(0, FOLD_MAX);
  for (const i of toFold) {
    try {
      const h = histOf.get(i.id);
      const out = await ai(FOLD, `## \uACFC\uC81C \uD788\uC2A4\uD1A0\uB9AC
${histText(h, i, d.nameOf)}

## \uC6D0\uBCF8 JSON
${JSON.stringify(h.content).slice(0, 9e3)}`);
      const owner = h.content.owner?.name ?? d.nameOf(i.owner_id);
      const link = d.links.find((l) => l.item_id === i.id);
      await admin.from("core_work_chapters").insert({
        team_id: teamId,
        item_id: i.id,
        core_work_id: link?.core_work_id ?? null,
        year: yearOf(i),
        title: i.title,
        owner_name: owner,
        period: [ym(i.start_date ?? i.created_at), ym(i.done_at ?? i.due_date)].filter(Boolean).join(" ~ "),
        content: out
      });
      if (link) await admin.from("core_works").update({ dirty: true }).eq("id", link.core_work_id);
      actions.push({ at: now(), core_work_id: link?.core_work_id ?? null, text: `${yearOf(i)} '${i.title}'\uC744 \uC7A5\uC73C\uB85C \uC811\uC5B4 \uACE0\uC815` });
    } catch (e) {
      console.error("fold failed", i.id, e);
    }
  }
  if (toFold.length) d = await load(teamId);
  const linked = new Map(d.links.map((l) => [l.item_id, l]));
  const week = Date.now() - 8 * DAY;
  const cand = d.hists.map((h) => ({ h, i: d.items.get(h.item_id) })).filter((x) => !!x.i).filter((x) => !linked.has(x.i.id) || Date.parse(x.h.updated_at) > week).slice(0, LINK_MAX);
  const looseCh = d.chapters.filter((c) => !c.core_work_id && !(c.item_id && cand.some((x) => x.i.id === c.item_id)) && !(c.item_id && linked.has(c.item_id))).slice(0, 20);
  if (cand.some((x) => !linked.has(x.i.id)) || looseCh.length) {
    const coreIds = d.cores.map((c, k) => ({ key: `C${k + 1}`, c }));
    const keyOf = new Map(coreIds.map((x) => [x.c.id, x.key]));
    const text = [
      "## \uAE30\uC874 \uD575\uC2EC \uC5C5\uBB34",
      coreIds.length ? coreIds.map((x) => `[${x.key}] ${x.c.title} \u2014 ${x.c.summary || "(\uC815\uB9AC \uC804)"}
  \uAD00\uACC4\uC790: ${lines(x.c.content.people, 6) || "-"}
  \uBB36\uC778 \uC7A5: ${d.chapters.filter((ch) => ch.core_work_id === x.c.id).map((ch) => `${ch.year} ${ch.title}`).join(", ") || "-"}`).join("\n") : "(\uC5C6\uC74C)",
      "",
      "## \uACFC\uC81C",
      cand.map((x, k) => `[${k + 1}] ${linked.has(x.i.id) ? `(\uC9C0\uAE08 ${keyOf.get(linked.get(x.i.id).core_work_id) ?? "?"}\uC5D0 \uBB36\uC5EC \uC788\uC74C) ` : ""}${histText(x.h, x.i, d.nameOf)}`).join("\n\n"),
      "",
      "## \uC5B4\uB514\uC5D0\uB3C4 \uC548 \uBD99\uC740 \uC7A5 (\uB05D\uB09C \uACFC\uC81C)",
      looseCh.length ? looseCh.map((c, k) => `[${k + 1}] ${chapterText(c)}`).join("\n\n") : "(\uC5C6\uC74C)"
    ].join("\n");
    try {
      const out = await ai(LINK, text, false, 2500);
      const uses = /* @__PURE__ */ new Map();
      for (const a of [...out.assign ?? [], ...out.chapters ?? []]) if (a.core?.startsWith("N")) uses.set(a.core, (uses.get(a.core) ?? 0) + 1);
      const created = /* @__PURE__ */ new Map();
      for (const n of out.new ?? []) {
        if ((uses.get(n.key) ?? 0) < 2 || !n.title?.trim()) continue;
        const { data } = await admin.from("core_works").insert({ team_id: teamId, title: n.title.trim().slice(0, 40), dirty: true }).select("id").single();
        if (data) {
          created.set(n.key, data.id);
          actions.push({ at: now(), core_work_id: data.id, text: `\uC0C8 \uD575\uC2EC \uC5C5\uBB34 '${n.title.trim()}'\uC744 \uB9CC\uB4E6` });
        }
      }
      const resolve = (k) => !k ? null : k.startsWith("N") ? created.get(k) ?? null : coreIds.find((x) => x.key === k)?.c.id ?? null;
      for (const a of out.assign ?? []) {
        const x = cand[Number(a.n) - 1];
        if (!x) continue;
        const cur = linked.get(x.i.id);
        if (cur && a.keep !== false) continue;
        const to = resolve(a.core);
        const reason = (a.reason ?? "").slice(0, 120);
        if (to && to !== cur?.core_work_id) {
          await admin.from("core_work_items").upsert({ item_id: x.i.id, core_work_id: to, team_id: teamId, reason, linked_at: now() });
          await admin.from("core_work_chapters").update({ core_work_id: to }).eq("item_id", x.i.id);
          await admin.from("core_works").update({ dirty: true }).in("id", [to, cur?.core_work_id].filter(Boolean));
          const title = d.cores.find((c) => c.id === to)?.title ?? (out.new ?? []).find((n) => created.get(n.key) === to)?.title ?? "";
          actions.push({ at: now(), core_work_id: to, text: `${yearOf(x.i)} '${x.i.title}'\uC744 ${cur ? "\uC62E\uACA8 " : ""}'${title}'\uC5D0 \uBB36\uC74C${reason ? ` (${reason})` : ""}` });
        } else if (!to && cur && a.keep === false) {
          await admin.from("core_work_items").delete().eq("item_id", x.i.id);
          await admin.from("core_work_chapters").update({ core_work_id: null }).eq("item_id", x.i.id);
          await admin.from("core_works").update({ dirty: true }).eq("id", cur.core_work_id);
          actions.push({ at: now(), core_work_id: cur.core_work_id, text: `'${x.i.title}'\uC744 \uB2E8\uB3C5 \uACFC\uC81C\uB85C \uBE8C${reason ? ` (${reason})` : ""}` });
        }
      }
      for (const a of out.chapters ?? []) {
        const c = looseCh[Number(a.n) - 1];
        const to = resolve(a.core);
        if (!c || !to) continue;
        await admin.from("core_work_chapters").update({ core_work_id: to }).eq("id", c.id);
        await admin.from("core_works").update({ dirty: true }).eq("id", to);
        actions.push({ at: now(), core_work_id: to, text: `${c.year} '${c.title}' \uC7A5\uC744 \uBB36\uC74C${a.reason ? ` (${a.reason.slice(0, 80)})` : ""}` });
      }
    } catch (e) {
      console.error("link failed", e);
    }
    d = await load(teamId);
  }
  const changed = d.cores.filter((c) => c.dirty || d.links.some((l) => l.core_work_id === c.id && Date.parse(d.hists.find((h) => h.item_id === l.item_id)?.updated_at ?? "1970") > Date.parse(c.synced_at ?? "1970"))).slice(0, SYNTH_MAX);
  for (const c of changed) {
    const chs = d.chapters.filter((x) => x.core_work_id === c.id).sort((a, b) => a.year - b.year);
    const live = d.links.filter((l) => l.core_work_id === c.id && !chs.some((x) => x.item_id === l.item_id)).map((l) => ({ h: d.hists.find((h) => h.item_id === l.item_id), i: d.items.get(l.item_id) })).filter((x) => !!x.h && !!x.i);
    if (!chs.length && !live.length) continue;
    try {
      const out = await ai(SYNTH, [
        `## \uD575\uC2EC \uC5C5\uBB34: ${c.title}`,
        c.summary ? `## \uAE30\uC874 \uC815\uB9AC
${JSON.stringify(c.content).slice(0, 6e3)}` : "",
        "## \uC7A5 (\uB05D\uB09C \uACFC\uC81C, \uC624\uB798\uB41C \uC21C)",
        chs.map(chapterText).join("\n\n") || "(\uC5C6\uC74C)",
        "## \uC9C4\uD589 \uC911\uC778 \uACFC\uC81C",
        live.map((x) => histText(x.h, x.i, d.nameOf)).join("\n\n") || "(\uC5C6\uC74C)"
      ].filter(Boolean).join("\n\n"), true, 3e3);
      const years = [...chs.map((x) => x.year), ...live.map((x) => yearOf(x.i))];
      await admin.from("core_works").update({
        summary: (out.summary ?? "").slice(0, 300),
        content: out,
        since_year: years.length ? Math.min(...years) : null,
        dirty: false,
        synced_at: now(),
        updated_at: now()
      }).eq("id", c.id);
      actions.push({ at: now(), core_work_id: c.id, text: `'${c.title}' \uD750\uB984\uC744 \uB2E4\uC2DC \uC815\uB9AC (\uC7A5 ${chs.length}\uAC1C \xB7 \uC9C4\uD589 \uC911 \uACFC\uC81C ${live.length}\uAC1C)` });
    } catch (e) {
      console.error("synth failed", c.id, e);
    }
  }
  const { data: st } = await admin.from("core_work_state").select("actions").eq("team_id", teamId).maybeSingle();
  await admin.from("core_work_state").update({ status: "ready", finished_at: now(), actions: [...actions.reverse(), ...st?.actions ?? []].slice(0, 40) }).eq("team_id", teamId);
  return { folded: toFold.length, actions: actions.length };
}
serve(async (req) => {
  const body = await readJson(req);
  if (!body.team_id) throw new HttpError(400, "MISSING_TEAM");
  const caller = await getCaller(req);
  await assertLeader(caller, body.team_id);
  await assertFeature(body.team_id, "history");
  const { data: go, error } = await admin.rpc("core_work_claim", { p_team: body.team_id });
  if (error) throw error;
  if (!go) return json({ status: "running" });
  const work = runTeam(body.team_id, caller.userId).catch(async (e) => {
    console.error("core works failed", e);
    await admin.from("core_work_state").update({ status: "failed", finished_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("team_id", body.team_id);
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return json({ status: "running" });
});
