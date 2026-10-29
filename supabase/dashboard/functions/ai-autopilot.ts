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
var FEATURE_DOMAINS = {
  review: ["logic", "writing", "creative", "decision"],
  report: ["writing", "comm"],
  prep: ["coach"],
  briefing: ["team", "decision", "coach"],
  strategy: ["goal", "decision", "creative"],
  scenario: ["team", "decision"],
  plan: ["goal", "creative", "logic"],
  evaluation: []
};
var MAX_PLAYBOOK = 8;
var tplCache = null;
async function templateMeta() {
  if (tplCache && Date.now() - tplCache.at < 10 * 6e4) return tplCache.map;
  const { data, error } = await admin.from("knowhow_templates").select("key, tier, domain, sort");
  const map = /* @__PURE__ */ new Map();
  if (!error) for (const t of data ?? []) map.set(t.key, { tier: t.tier ?? 2, domain: t.domain ?? "", sort: t.sort ?? 0 });
  tplCache = { at: Date.now(), map };
  return map;
}
var norm = (s) => s.toLowerCase().replace(/[\s·・\-_/()'"‘’“”]/g, "");
function playbookScore(c, meta, feature, ctx) {
  const m = meta.get(c.template_key ?? "");
  let s = c.pinned ? 100 : 0;
  if (m?.tier === 1) s += 3;
  if (m && FEATURE_DOMAINS[feature]?.includes(m.domain)) s += 2;
  if (ctx) {
    let hits = 0;
    for (const k of c.keywords ?? []) {
      const nk = norm(k);
      if (nk.length >= 2 && ctx.includes(nk)) hits++;
    }
    s += Math.min(hits, 4) * 3;
  }
  return s;
}
async function addKnowhow(book, teamId, feature, limitChars = 3200, onlyShared = false, consulting = true, context = "", own = true) {
  let qb = admin.from("knowhow_cards").select("id, kind, title, body, rules, pinned, updated_at, source, template_key, keywords").eq("team_id", teamId).eq("active", true).contains("applies_to", [feature]);
  if (onlyShared) qb = qb.eq("shared", true);
  const { data } = await qb.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(160);
  const rows = data ?? [];
  const isCon = (c) => c.source === "consulting";
  let con = consulting ? rows.filter(isCon) : [];
  if (con.length > 1) {
    const meta = await templateMeta();
    const ctx = norm((context || book.evidenceText()).slice(0, 2e4));
    con = con.map((c) => ({ c, s: playbookScore(c, meta, feature, ctx), o: meta.get(c.template_key ?? "")?.sort ?? 9999 })).sort((a, b) => b.s - a.s || a.o - b.o).map((x) => x.c);
  }
  const ordered = [...own ? rows.filter((c) => !isCon(c)) : [], ...con];
  let used = 0, n = 0, nCon = 0;
  for (const c of ordered) {
    const rules = Array.isArray(c.rules) ? c.rules.filter(Boolean) : [];
    const text = `${c.body}${rules.length ? ` / \uADDC\uCE59: ${rules.join(" \xB7 ")}` : ""}`;
    if (isCon(c) && nCon >= MAX_PLAYBOOK) break;
    if (used + text.length > limitChars && n > 0) {
      if (isCon(c)) break;
      continue;
    }
    if (isCon(c)) {
      book.add("consulting", c.id, `ATEAM Method\u2122 \xB7 ${c.title}`, text);
      nCon++;
    } else book.add("knowhow", c.id, `\uB0B4 \uB178\uD558\uC6B0 \xB7 ${c.title}`, text);
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
var HEAVY_MOODS = ["tired", "unwell", "heavy", "personal", "need_rest"];
var SECTION_NAME = { todo: "\uB0B4\uAC00 \uD560 \uC77C", decide: "\uC758\uC0AC\uACB0\uC815", perf: "\uD300 \uC131\uACFC", people: "\uD300\uC6D0\uAD00\uB9AC", org: "\uC870\uC9C1\xB7\uC804\uC0AC" };
var DOMAIN_META = {
  goal: { name: "\uBAA9\uD45C\xB7\uC2E4\uC801", desc: "\uBAA9\uD45C \uB2EC\uC131 \uAC00\uB2A5\uC131\uACFC \uC2E4\uC801 \uC804\uB9DD", period: "\uC6D4\uAC04 \uC804\uB9DD" },
  exec: { name: "\uC2E4\uD589\xB7\uACFC\uC81C", desc: "\uACC4\uD68D \uB300\uBE44 \uC9C0\uC5F0\xB7\uB9C9\uD798\xB7\uC2DC\uAC04 \uBC30\uBD84", period: "\uC8FC\uAC04 \uC9C4\uCC99" },
  people: { name: "\uC0AC\uB78C\xB7\uCEE8\uB514\uC158", desc: "\uCEE8\uB514\uC158 \uCD94\uC138, 1on1 \uAC04\uACA9, \uCEE8\uB514\uC158 \uACF5\uC720", period: "\uC8FC\uAC04 \uCD94\uC138" },
  output: { name: "\uACB0\uACFC\uBB3C\xB7\uB9AC\uBDF0", desc: "\uB9AC\uBDF0 \uB300\uAE30\uC640 \uC7AC\uC791\uC5C5 \uD328\uD134", period: "\uC8FC\uAC04 \uD750\uB984" },
  growth: { name: "\uC721\uC131\xB7\uD3C9\uAC00", desc: "\uD3C9\uAC00 \uADFC\uAC70\uC640 \uC131\uC7A5 \uC2E0\uD638", period: "\uC6D4\uAC04 \uADA4\uC801" },
  org: { name: "\uC870\uC9C1\xB7\uC804\uC0AC", desc: "\uC0C1\uC704 \uBC29\uD5A5\xB7\uC694\uCCAD\xB7\uC804\uC0AC \uC77C\uC815", period: "\uC218\uC2DC" }
};
var TODO_IDS = ["exec-proposed-", "out-aged-", "req-late-", "promise-late-", "org-req-"];
function sectionOf(s) {
  if (TODO_IDS.some((p) => s.id.startsWith(p))) return "todo";
  if (s.id.startsWith("decide-")) return "decide";
  if (s.domain === "goal" || s.domain === "exec") return "perf";
  if (s.domain === "org") return "org";
  return "people";
}
var TYPE_LABEL = {
  risk: "\uB9AC\uC2A4\uD06C",
  missed: "\uB193\uCE5C \uAC83",
  forecast: "\uC804\uB9DD",
  pattern: "\uD328\uD134",
  good: "\uC88B\uC740 \uC2E0\uD638",
  data: "\uB370\uC774\uD130 \uBCF4\uAC15"
};
var KST = 9 * 36e5;
var kstToday = (now = Date.now()) => new Date(now + KST).toISOString().slice(0, 10);
var addDaysYmd = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
var kstMonday = (now = Date.now()) => {
  const d = new Date(now + KST);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDaysYmd(d.toISOString().slice(0, 10), -dow);
};
var daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 864e5);
async function safe(p, fallback) {
  try {
    const { data, error } = await p;
    return error ? fallback : data ?? fallback;
  } catch {
    return fallback;
  }
}
async function loadRaw(db, teamId, leaderId, minEvidence) {
  const mon = kstMonday();
  const since60 = new Date(Date.now() - 60 * 864e5).toISOString();
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const [goals, metrics, items, schedule, portfolio, care, checkins, subs, depth, perf, level, obs, requests, late, rlogs, orgNotes, orgImpacts, decisionsDue, jscores] = await Promise.all([
    safe(db.rpc("goal_outlook", { p_team: teamId }), null),
    safe(db.from("metrics").select("id, item_id").eq("team_id", teamId).not("target", "is", null).order("created_at").limit(4), []),
    safe(db.from("work_items").select("id, parent_id, owner_id, title, status, measure, progress, start_date, due_date, base_due, replan_count, recur, needs_plan, updated_at, created_at, est_hours_per_week").eq("team_id", teamId).neq("status", "dropped"), []),
    safe(db.rpc("item_schedule", { p_team: teamId }), null),
    safe(db.rpc("task_portfolio", { p_team: teamId }), null),
    safe(db.rpc("care_radar", { p_team: teamId }), null),
    // moods·note 는 24_condition.sql 이후 — 아직 안 돌렸으면 예전 칸만 읽는다
    (async () => {
      const r = await db.from("checkins").select("user_id, week_start, condition, moods, note, did, blocked").eq("team_id", teamId).gte("week_start", addDaysYmd(mon, -35));
      return r.error ? safe(db.from("checkins").select("user_id, week_start, condition, did, blocked").eq("team_id", teamId).gte("week_start", addDaysYmd(mon, -35)), []) : r.data ?? [];
    })().catch(() => []),
    safe(db.from("submissions").select("id, author_id, status, created_at, submission_versions(version, created_at)").eq("team_id", teamId).gte("updated_at", since60), []),
    safe(db.rpc("member_data_depth", { p_team: teamId }), null),
    safe(db.rpc("team_performance_map", { p_team: teamId }), null),
    safe(db.rpc("team_insight_level", { p_team: teamId }), null),
    safe(db.from("observations").select("subject_id, polarity, created_at").eq("team_id", teamId).gte("created_at", since30), []),
    safe(db.from("team_requests").select("id, to_id, title, kind, due_date, created_at, status").eq("team_id", teamId).eq("from_id", leaderId).eq("status", "open"), []),
    safe(db.from("action_items").select("id, due_date, one_on_one_id").eq("team_id", teamId).eq("owner_id", leaderId).is("done_at", null).lt("due_date", kstToday()), []),
    safe(db.from("work_item_logs").select("item_id, period, done").eq("team_id", teamId).eq("kind", "recurring").gte("period", addDaysYmd(kstToday(), -100)), []),
    safe(db.from("org_notes").select("id, kind, title, event_date, status, created_at").eq("team_id", teamId).eq("status", "open").order("created_at", { ascending: false }).limit(40), []),
    safe(db.from("ai_outputs").select("ref_id").eq("team_id", teamId).eq("kind", "org_impact").gte("created_at", since60), []),
    safe(db.from("decisions").select("id, title, decided_at, review_on").eq("team_id", teamId).is("outcome", null).order("decided_at").limit(20), []),
    safe(db.from("judgment_scores").select("user_id, score, scored_at").eq("team_id", teamId).gte("scored_at", new Date(Date.now() - 120 * 864e5).toISOString()).order("scored_at"), [])
  ]);
  const ooIds = [...new Set(late.map((a) => a.one_on_one_id).filter(Boolean))];
  const oos = ooIds.length ? await safe(db.from("one_on_ones").select("id, member_id").in("id", ooIds), []) : [];
  const memberOf = new Map(oos.map((o) => [o.id, o.member_id]));
  const latePromiseBy = late.filter((a) => a.one_on_one_id && memberOf.has(a.one_on_one_id)).map((a) => ({ member_id: memberOf.get(a.one_on_one_id), days: a.due_date ? daysSince(a.due_date) : 0 }));
  const forecasts = (await Promise.all(metrics.map(async (m) => {
    const f = await safe(db.rpc("metric_forecast", { p_metric: m.id }), null);
    return f ? { ...f, item_id: m.item_id } : null;
  }))).filter(Boolean);
  const thisYear = Number(kstToday().slice(0, 4));
  const pastIds = /* @__PURE__ */ new Set();
  const kids = /* @__PURE__ */ new Map();
  for (const it of items) if (it.parent_id) kids.set(it.parent_id, [...kids.get(it.parent_id) ?? [], it.id]);
  for (const it of items) {
    if (it.parent_id || it.status !== "done") continue;
    if (Number((it.start_date ?? it.due_date ?? it.created_at).slice(0, 4)) >= thisYear) continue;
    const stack = [it.id];
    while (stack.length) {
      const id = stack.pop();
      pastIds.add(id);
      stack.push(...kids.get(id) ?? []);
    }
  }
  if (pastIds.size) {
    const keep = items.filter((it) => !pastIds.has(it.id));
    items.length = 0;
    items.push(...keep);
  }
  const goalsNow = goals ? goals.filter((g) => !pastIds.has(g.goal_id)) : goals;
  return {
    goals: goalsNow,
    forecasts,
    items,
    schedule,
    portfolio,
    care,
    checkins,
    subs,
    depth,
    perf,
    level,
    obs,
    requests,
    recurringLogs: rlogs,
    latePromises: late.length,
    minEvidence,
    latePromiseBy,
    jscores,
    orgNotes,
    orgImpacts: orgImpacts.map((o) => o.ref_id),
    decisionsDue
  };
}
var fmtN = (n) => Math.abs(n) >= 100 ? Math.round(n).toLocaleString("ko-KR") : String(Math.round(n * 10) / 10);
var names = (arr2, max = 3) => arr2.slice(0, max).join(", ") + (arr2.length > max ? ` \uC678 ${arr2.length - max}\uBA85` : "");
var avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
var D = ["daily"];
var W = ["weekly"];
var M = ["monthly"];
var DW = ["daily", "weekly"];
var WM = ["weekly", "monthly"];
var ALL = ["daily", "weekly", "monthly"];
var FLAG_LABEL = {
  frustrated: "\uC758\uC9C0\uB294 \uC788\uB294\uB370 \uB9C9\uD798",
  recog_gap: "\uC778\uC815 \uACF5\uBC31",
  growth_stall: "\uC131\uC7A5 \uC815\uCCB4",
  promise_late: "\uD300\uC7A5 \uC57D\uC18D \uBC00\uB9BC",
  withdrawn: "\uCC38\uC5EC \uC704\uCD95"
};
function flagsFor(raw, uid) {
  const out = [];
  const mon = kstMonday();
  const recentFrom = addDaysYmd(mon, -14);
  const mine = raw.checkins.filter((c) => c.user_id === uid).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const lastCond = [...mine].reverse().find((c) => c.condition != null && c.week_start >= recentFrom)?.condition ?? null;
  if (lastCond != null && lastCond >= 3) {
    const why = [];
    if ((raw.care ?? []).some((r) => r.user_id === uid && r.signals.some((x) => x.type === "blocked_repeat"))) why.push("\uAC19\uC740 \uB9C9\uD798 2\uC8FC \uC5F0\uC18D");
    const blk = raw.items.filter((i) => i.owner_id === uid && i.status === "blocked");
    if (blk.length) why.push(`\uB9C9\uD798 \uC0C1\uD0DC \uD56D\uBAA9 ${blk.length}\uAC74`);
    const waiting = raw.subs.filter((x) => x.author_id === uid && x.status === "in_review" && daysSince(x.submission_versions.reduce((a, v) => v.created_at > a ? v.created_at : a, x.created_at)) >= 3);
    if (waiting.length) why.push(`\uB9AC\uBDF0 \uB300\uAE30 3\uC77C \uB118\uC740 \uACB0\uACFC\uBB3C ${waiting.length}\uAC74`);
    if (why.length) out.push({ key: "frustrated", label: FLAG_LABEL.frustrated, detail: `\uCEE8\uB514\uC158 ${lastCond}/5 \xB7 ${why.join(" \xB7 ")}` });
  }
  const done = raw.items.filter((i) => i.owner_id === uid && i.status === "done" && daysSince(i.updated_at) <= 30).length;
  const appr = raw.subs.filter((x) => x.author_id === uid && x.status === "approved" && daysSince(x.created_at) <= 45).length;
  const pos = raw.obs.filter((o) => o.subject_id === uid && o.polarity === "positive").length;
  if (done + appr >= 2 && pos === 0) out.push({ key: "recog_gap", label: FLAG_LABEL.recog_gap, detail: `\uCD5C\uADFC \uB9C8\uCE5C \uC77C ${done}\uAC74 \xB7 \uC2B9\uC778\uB41C \uACB0\uACFC\uBB3C ${appr}\uAC74, 30\uC77C\uAC04 \uCE6D\uCC2C\xB7\uAE0D\uC815 \uAD00\uCC30 0\uAC74` });
  const js = (raw.jscores ?? []).filter((j) => j.user_id === uid).map((j) => ({ s: Number(j.score), at: j.scored_at }));
  if (js.length >= 4) {
    const last4 = js.slice(-4).map((j) => j.s);
    const spanDays = (Date.parse(js[js.length - 1].at) - Date.parse(js[js.length - 4].at)) / 864e5;
    const mean = last4.reduce((a, b) => a + b, 0) / 4;
    const fresh = raw.items.some((i) => i.owner_id === uid && daysSince(i.created_at) <= 60);
    if (spanDays >= 56 && Math.max(...last4) - Math.min(...last4) <= 0.5 && mean < 3.5 && !fresh)
      out.push({ key: "growth_stall", label: FLAG_LABEL.growth_stall, detail: `\uCD5C\uADFC \uACB0\uACFC\uBB3C 4\uAC74 \uD310\uB2E8 \uAE4A\uC774 \uD3C9\uADE0 ${Math.round(mean * 10) / 10}/4\uB85C \uBE44\uC2B7 \xB7 60\uC77C\uAC04 \uC0C8\uB85C \uB9E1\uC740 \uC77C \uC5C6\uC74C` });
  }
  const pr = (raw.latePromiseBy ?? []).filter((x) => x.member_id === uid);
  if (pr.length >= 2 || pr.some((x) => x.days >= 14))
    out.push({ key: "promise_late", label: FLAG_LABEL.promise_late, detail: `\uAE30\uD55C \uC9C0\uB09C \uC57D\uC18D ${pr.length}\uAC74 \xB7 \uCD5C\uC7A5 ${Math.max(...pr.map((x) => x.days))}\uC77C` });
  const shared = (c) => c.condition != null || (c.moods ?? []).length > 0 || !!(c.did ?? "").trim();
  const before = [2, 3, 4, 5].map((k) => addDaysYmd(mon, -7 * k));
  const priorN = before.filter((w) => mine.some((c) => c.week_start === w && shared(c))).length;
  const recentN = [addDaysYmd(mon, -7), mon].filter((w) => mine.some((c) => c.week_start === w && shared(c))).length;
  if (priorN >= 3 && recentN === 0)
    out.push({ key: "withdrawn", label: FLAG_LABEL.withdrawn, detail: `\uADF8 \uC804 4\uC8FC \uC911 ${priorN}\uC8FC \uCEE8\uB514\uC158\uC744 \uB098\uB234\uB294\uB370 \uCD5C\uADFC 2\uC8FC\uB294 \uC5C6\uC74C` });
  return out;
}
function analyze(raw, members) {
  const S = [];
  const today = kstToday();
  const mem = members.filter((m) => m.role === "member");
  const nameOf = (id) => members.find((m) => m.user_id === id)?.name ?? "\uBBF8\uC9C0\uC815";
  const nMem = mem.length;
  const items = raw.items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const hasChildren = new Set(items.filter((i) => i.parent_id).map((i) => i.parent_id));
  const goals = raw.goals ?? [];
  const probs = goals.filter((g) => g.probability != null).map((g) => g.probability);
  for (const g of goals) {
    if (g.probability == null || g.basis === "metric") continue;
    if (g.probability < 50) S.push({
      id: `goal-risk-${g.goal_id}`,
      domain: "goal",
      type: "risk",
      severity: g.probability < 35 ? 3 : 2,
      periods: WM,
      title: `'${g.title}' \uB2EC\uC131 \uAC00\uB2A5\uC131 ${g.probability}%`,
      detail: `\uC77C\uC815 \uB300\uBE44 \uC9C4\uCC99 ${g.progress}%${g.blocked ? ` \xB7 \uB9C9\uD78C \uD558\uC704 \uD56D\uBAA9 ${g.blocked}\uAC74` : ""}\uB85C \uBCF8 \uC804\uB9DD\uC785\uB2C8\uB2E4.`,
      rule: "\uD558\uC704 \uD56D\uBAA9\uC758 \uC77C\uC815 \uB300\uBE44 \uC9C4\uCC99(\uC2A4\uCF00\uC904 \uC9C0\uC218)",
      action: { label: "\uC77C\uC815 \uB2E4\uC2DC \uBCF4\uAE30", to: "/goals" }
    });
  }
  for (const f of raw.forecasts) {
    if (f.insufficient) {
      S.push({
        id: `metric-data-${f.metric_id}`,
        domain: "goal",
        type: "data",
        severity: 1,
        periods: M,
        title: `'${f.name}' \uC2E4\uC801\uC774 ${f.months_of_data}\uAC1C\uC6D4\uCE58\uBFD0\uC774\uB77C \uC804\uB9DD\uC744 \uB0BC \uC218 \uC5C6\uC2B5\uB2C8\uB2E4`,
        detail: "\uC6D4 \uC2E4\uC801\uC744 2\uAC1C\uC6D4 \uC774\uC0C1 \uB123\uC73C\uBA74 \uAE30\uB9D0 \uC804\uB9DD\uACFC \uB2EC\uC131 \uD655\uB960\uC774 \uACC4\uC0B0\uB429\uB2C8\uB2E4.",
        rule: "\uC2E4\uC801 \uB370\uC774\uD130 2\uAC1C\uC6D4 \uBBF8\uB9CC",
        action: { label: "\uC2E4\uC801 \uC785\uB825\uD558\uAE30", to: "/perf" }
      });
    } else if (f.base != null && f.target != null) {
      const gap = f.base - f.target;
      const p = f.probability ?? null;
      const goal = goals.find((g) => g.goal_id === f.item_id);
      S.push({
        id: `metric-fc-${f.metric_id}`,
        domain: "goal",
        type: p != null && p < 50 ? "risk" : "forecast",
        severity: p != null && p < 35 ? 3 : p != null && p < 50 ? 2 : 1,
        periods: WM,
        title: p != null && p < 50 && goal ? `'${goal.title}' \uB2EC\uC131 \uAC00\uB2A5\uC131 ${p}% \u2014 ${f.name} \uAE30\uB9D0 \uC804\uB9DD ${fmtN(f.base)}${f.unit} (\uBAA9\uD45C ${fmtN(f.target)}${f.unit})` : `${goal ? `'${goal.title}' \xB7 ` : ""}${f.name} \uAE30\uB9D0 \uC804\uB9DD ${fmtN(f.base)}${f.unit} (\uBAA9\uD45C ${fmtN(f.target)}${f.unit})`,
        detail: `${gap >= 0 ? "\uBAA9\uD45C\uBCF4\uB2E4 " + fmtN(gap) + f.unit + " \uB9CE\uC744" : "\uBAA9\uD45C\uC5D0 " + fmtN(-gap) + f.unit + " \uBABB \uBBF8\uCE60"} \uAC83\uC73C\uB85C \uBCF4\uC785\uB2C8\uB2E4. 80% \uBC94\uC704 ${fmtN(f.low ?? 0)}~${fmtN(f.high ?? 0)}${f.unit}${p != null ? ` \xB7 \uB2EC\uC131 \uD655\uB960 ${p}%` : ""}.`,
        rule: "\uCD5C\uADFC 3\uAC1C\uC6D4 \uB7F0\uB808\uC774\uD2B8 + \uC9C4\uD589 \uC911 \uB51C \uAC00\uC911\uD569, \uBCC0\uB3D9\uC131\uC73C\uB85C \uBC94\uC704 \uACC4\uC0B0",
        action: { label: "\uC804\uB9DD \uC790\uC138\uD788", to: "/perf" }
      });
    }
  }
  if (!goals.length) S.push({
    id: "goal-none",
    domain: "goal",
    type: "data",
    severity: 1,
    periods: ALL,
    title: "\uBAA9\uD45C\uAC00 \uC5C6\uC5B4 \uB2EC\uC131 \uC804\uB9DD\uC744 \uBCFC \uC218 \uC5C6\uC2B5\uB2C8\uB2E4",
    detail: "\uACC4\uD68D\uC11C\uB97C \uB123\uC73C\uBA74 AI\uAC00 \uBAA9\uD45C\xB7\uACFC\uC81C \uCD08\uC548\uC744 \uB9CC\uB4E4\uC5B4 \uB4DC\uB9BD\uB2C8\uB2E4.",
    rule: "\uCD5C\uC0C1\uC704 \uD56D\uBAA9 0\uAC1C",
    action: { label: "\uBAA9\uD45C \uC138\uC6B0\uAE30", to: "/goals" }
  });
  const goalLow = probs.length ? Math.min(...probs) : null;
  const tops = items.filter((i) => !i.parent_id && ["active", "blocked"].includes(i.status));
  const kidsOf = /* @__PURE__ */ new Map();
  for (const it of items) if (it.parent_id) kidsOf.set(it.parent_id, [...kidsOf.get(it.parent_id) ?? [], it]);
  const measurable = (id) => {
    const it = byId.get(id);
    if (it && (it.measure === "number" || it.measure === "percent")) return true;
    if (raw.forecasts.some((f) => f.item_id === id)) return true;
    return (kidsOf.get(id) ?? []).some((k) => measurable(k.id));
  };
  if (tops.length > 5) S.push({
    id: `goal-many-${tops.length}`,
    domain: "goal",
    type: "pattern",
    severity: 1,
    periods: M,
    title: `\uD300 \uBAA9\uD45C\uAC00 ${tops.length}\uAC1C\uC785\uB2C8\uB2E4 \u2014 3~5\uAC1C\uB85C \uBB36\uC73C\uBA74 \uC6B0\uC120\uC21C\uC704\uAC00 \uC120\uBA85\uD574\uC9D1\uB2C8\uB2E4`,
    detail: tops.slice(0, 6).map((t) => t.title).join(" \xB7 "),
    rule: "\uC9C4\uD589 \uC911 \uCD5C\uC0C1\uC704 \uBAA9\uD45C 6\uAC1C \uC774\uC0C1",
    action: { label: "\uBAA9\uD45C \uC815\uB9AC\uD558\uAE30", to: "/goals" }
  });
  const noDue = tops.filter((t) => !t.due_date);
  if (noDue.length) S.push({
    id: `goal-nodue-${noDue.length}`,
    domain: "goal",
    type: "data",
    severity: 1,
    periods: M,
    title: `\uB9C8\uAC10\uC774 \uC5C6\uB294 \uBAA9\uD45C ${noDue.length}\uAC1C \u2014 \uB9C8\uAC10\uC744 \uB123\uC73C\uBA74 \uACC4\uD68D \uB300\uBE44\uAC00 \uADF8\uB824\uC9D1\uB2C8\uB2E4`,
    detail: noDue.slice(0, 3).map((t) => t.title).join(" \xB7 "),
    rule: "\uC9C4\uD589 \uC911 \uCD5C\uC0C1\uC704 \uBAA9\uD45C \uC911 \uB9C8\uAC10\uC77C \uC5C6\uC74C",
    action: { label: "\uB9C8\uAC10 \uB123\uAE30", to: "/goals" }
  });
  const noMeasure = tops.filter((t) => !measurable(t.id) && !(t.measure === "check"));
  if (noMeasure.length) S.push({
    id: `goal-nomeasure-${noMeasure.length}`,
    domain: "goal",
    type: "data",
    severity: 1,
    periods: M,
    title: `\uB2EC\uC131\uD588\uB294\uC9C0 \uC7B4 \uAE30\uC900\uC774 \uC5C6\uB294 \uBAA9\uD45C ${noMeasure.length}\uAC1C`,
    detail: `${noMeasure.slice(0, 3).map((t) => t.title).join(" \xB7 ")} \u2014 \uC22B\uC790 \uBAA9\uD45C\uB098 '\uC644\uB8CC \uD310\uB2E8 \uAE30\uC900'\uC744 \uD558\uB098 \uBD99\uC5EC \uB450\uC138\uC694.`,
    rule: "\uCD5C\uC0C1\uC704 \uBAA9\uD45C\uC640 \uADF8 \uD558\uC704\uC5D0 \uC22B\uC790\xB7\uC9C4\uCC99\uB960 \uD56D\uBAA9\uC774\uB098 \uC2E4\uC801 \uC9C0\uD45C\uAC00 \uC5C6\uC74C",
    action: { label: "\uAE30\uC900 \uBD99\uC774\uAE30", to: "/goals" }
  });
  const work = items.filter((i) => i.parent_id && ["active", "blocked"].includes(i.status));
  const leaves = work.filter((i) => !hasChildren.has(i.id));
  const overdue = leaves.filter((t) => t.due_date && t.due_date < today);
  const blocked = work.filter((t) => t.status === "blocked");
  const stale = leaves.filter((t) => t.measure !== "recurring" && t.measure !== "check" && daysSince(t.updated_at) >= 14);
  const proposed = items.filter((i) => i.status === "proposed");
  const changes = items.filter((i) => i.status === "changes_requested" && daysSince(i.updated_at) >= 5);
  const needsPlan = items.filter((i) => i.needs_plan && !hasChildren.has(i.id) && daysSince(i.updated_at) >= 3);
  const sched = raw.schedule ?? [];
  const delayed = sched.filter((r) => (r.projected_delay ?? 0) >= 7 && byId.get(r.item_id)?.status !== "done");
  const replanned = sched.filter((r) => r.replan_count >= 2 || (r.slip_days ?? 0) >= 14);
  if (proposed.length) S.push({
    id: `exec-proposed-${proposed.length}-${proposed[0].id.slice(0, 6)}`,
    domain: "exec",
    type: "missed",
    severity: proposed.some((p) => daysSince(p.updated_at) >= 3) ? 2 : 1,
    periods: DW,
    title: `\uD300\uC6D0\uC774 \uC62C\uB9B0 \uACC4\uD68D ${proposed.length}\uAC74\uC774 \uAC80\uD1A0\uB97C \uAE30\uB2E4\uB9BD\uB2C8\uB2E4`,
    detail: proposed.slice(0, 3).map((p) => `${p.title}(${nameOf(p.owner_id)})`).join(" \xB7 "),
    rule: "\uC0C1\uD0DC\uAC00 '\uC81C\uC548'\uC778 \uD56D\uBAA9",
    action: { label: "\uAC80\uD1A0\uD558\uAE30", to: "/goals/edit?filter=proposed" }
  });
  if (overdue.length) S.push({
    id: `exec-overdue-${overdue.length}`,
    domain: "exec",
    type: "risk",
    severity: overdue.length >= 3 ? 3 : 2,
    periods: DW,
    title: `\uAE30\uD55C \uC9C0\uB09C \uD56D\uBAA9 ${overdue.length}\uAC74`,
    detail: overdue.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)}, ${t.due_date.slice(5).replace("-", "/")})`).join(" \xB7 "),
    rule: "\uB9C8\uAC10\uC77C\uC774 \uC9C0\uB0AC\uB294\uB370 \uC644\uB8CC\uB418\uC9C0 \uC54A\uC740 \uD56D\uBAA9",
    action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: "/goals/edit?filter=overdue" }
  });
  if (blocked.length) S.push({
    id: `exec-blocked-${blocked.map((t) => t.id.slice(0, 4)).join("")}`,
    domain: "exec",
    type: "risk",
    severity: 2,
    periods: DW,
    title: `\uB9C9\uD78C \uD56D\uBAA9 ${blocked.length}\uAC74 \u2014 \uD300\uC7A5\uC774 \uD480\uC5B4 \uC904 \uC218 \uC788\uB294\uC9C0 \uD655\uC778`,
    detail: blocked.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)})`).join(" \xB7 "),
    rule: "\uC0C1\uD0DC\uAC00 '\uB9C9\uD798'",
    action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: "/goals/edit?filter=blocked" }
  });
  for (const r of delayed.slice(0, 3)) S.push({
    id: `exec-delay-${r.item_id}`,
    domain: "exec",
    type: "forecast",
    severity: (r.projected_delay ?? 0) >= 14 ? 3 : 2,
    periods: W,
    title: `'${r.title}' \uC774 \uC18D\uB3C4\uBA74 \uB9C8\uAC10\uBCF4\uB2E4 ${r.projected_delay}\uC77C \uB2A6\uC5B4\uC9D1\uB2C8\uB2E4`,
    detail: `\uCD5C\uADFC 3\uC8FC \uC9C4\uCC99 \uC18D\uB3C4\uB85C \uACC4\uC0B0\uD55C \uC608\uC0C1 \uC644\uB8CC\uC77C ${r.projected_done?.slice(5).replace("-", "/")} (\uB9C8\uAC10 ${r.due_date?.slice(5).replace("-", "/")}) \xB7 \uB2F4\uB2F9 ${nameOf(r.owner_id)}`,
    rule: "\uCD5C\uADFC 21\uC77C \uC9C4\uCC99 \uAE30\uB85D\uC758 \uAE30\uC6B8\uAE30\uB85C \uB0A8\uC740 \uC9C4\uCC99\uC744 \uB098\uB208 \uC608\uC0C1 \uC644\uB8CC\uC77C",
    action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: `/goals?item=${r.item_id}` }
  });
  if (replanned.length) S.push({
    id: `exec-replan-${replanned.length}`,
    domain: "exec",
    type: "pattern",
    severity: 2,
    periods: WM,
    title: `\uACC4\uD68D\uC774 \uBC18\uBCF5\uD574\uC11C \uBC00\uB9AC\uB294 \uD56D\uBAA9 ${replanned.length}\uAC74`,
    detail: replanned.slice(0, 3).map((r) => `${r.title}(\uC77C\uC815 \uBCC0\uACBD ${r.replan_count}\uD68C${r.slip_days ? `, \uCC98\uC74C \uACC4\uD68D\uBCF4\uB2E4 ${r.slip_days}\uC77C` : ""})`).join(" \xB7 "),
    rule: "\uC77C\uC815 \uBCC0\uACBD 2\uD68C \uC774\uC0C1 \uB610\uB294 \uCC98\uC74C \uACC4\uD68D \uB300\uBE44 14\uC77C \uC774\uC0C1 \uC9C0\uC5F0",
    action: { label: "\uACC4\uD68D \uB300\uBE44 \uBCF4\uAE30", to: "/goals/edit?view=timeline" }
  });
  if (stale.length) S.push({
    id: `exec-stale-${stale.length}`,
    domain: "exec",
    type: "missed",
    severity: 1,
    periods: W,
    title: `2\uC8FC \uB118\uAC8C \uC9C4\uCC99 \uC5C5\uB370\uC774\uD2B8\uAC00 \uC5C6\uB294 \uD56D\uBAA9 ${stale.length}\uAC74`,
    detail: stale.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)})`).join(" \xB7 "),
    rule: "\uC9C4\uD589 \uC911 \uD56D\uBAA9\uC758 \uB9C8\uC9C0\uB9C9 \uC218\uC815\uC774 14\uC77C \uC804",
    action: { label: "\uC9C4\uCC99 \uC694\uCCAD \uBCF4\uB0B4\uAE30", to: "/goals/edit?filter=stale" }
  });
  if (needsPlan.length) S.push({
    id: `exec-needsplan-${needsPlan.length}`,
    domain: "exec",
    type: "missed",
    severity: 1,
    periods: W,
    title: `\uD558\uC704 \uACC4\uD68D\uC744 \uC694\uCCAD\uD588\uB294\uB370 \uC544\uC9C1 \uBE44\uC5B4 \uC788\uB294 \uD56D\uBAA9 ${needsPlan.length}\uAC74`,
    detail: needsPlan.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)})`).join(" \xB7 "),
    rule: "\uACC4\uD68D \uC694\uCCAD \uD6C4 3\uC77C \uC774\uC0C1 \uD558\uC704 \uD56D\uBAA9 \uC5C6\uC74C",
    action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: "/goals" }
  });
  if (changes.length) S.push({
    id: `exec-changes-${changes.length}`,
    domain: "exec",
    type: "missed",
    severity: 1,
    periods: W,
    title: `\uC218\uC815 \uC694\uCCAD \uD6C4 5\uC77C \uB118\uAC8C \uADF8\uB300\uB85C\uC778 \uACC4\uD68D ${changes.length}\uAC74`,
    detail: changes.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)})`).join(" \xB7 "),
    rule: "\uC0C1\uD0DC '\uC218\uC815 \uC694\uCCAD'\uC73C\uB85C 5\uC77C \uACBD\uACFC",
    action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: "/goals/edit?filter=changes" }
  });
  const recurring = items.filter((i) => i.measure === "recurring" && i.status === "active");
  for (const r of recurring) {
    const logs = raw.recurringLogs.filter((l) => l.item_id === r.id).sort((a, b) => b.period.localeCompare(a.period));
    if (logs[0] && logs[0].done === false) S.push({
      id: `exec-recur-${r.id}-${logs[0].period}`,
      domain: "exec",
      type: "risk",
      severity: 2,
      periods: WM,
      title: `\uC815\uAE30 \uC5C5\uBB34 '${r.title}' \uC9C0\uB09C ${r.recur === "weekly" ? "\uC8FC" : "\uB2EC"} \uAE30\uD55C\uC744 \uBABB \uC9C0\uCF30\uC2B5\uB2C8\uB2E4`,
      detail: `\uCD5C\uADFC ${logs.length}\uD68C \uC911 ${logs.filter((l) => l.done).length}\uD68C \uC644\uB8CC \xB7 \uB2F4\uB2F9 ${nameOf(r.owner_id)}`,
      rule: "\uC815\uAE30 \uC5C5\uBB34 \uAE30\uB85D\uC758 \uCD5C\uADFC \uAE30\uAC04 \uBBF8\uC644\uB8CC",
      action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: `/goals?item=${r.id}` }
    });
  }
  const lateReq = raw.requests.filter((q) => q.due_date && q.due_date < today || daysSince(q.created_at) >= 5);
  if (lateReq.length) S.push({
    id: `req-late-${lateReq.length}`,
    domain: "exec",
    type: "missed",
    severity: 1,
    periods: D,
    title: `\uD300\uC6D0\uC5D0\uAC8C \uBCF4\uB0B8 \uC694\uCCAD ${lateReq.length}\uAC74\uC774 \uC544\uC9C1 \uB2F5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4`,
    detail: lateReq.slice(0, 3).map((q) => `${q.title}(${nameOf(q.to_id)})`).join(" \xB7 "),
    rule: "\uAE30\uD55C\uC774 \uC9C0\uB0AC\uAC70\uB098 5\uC77C \uB118\uAC8C \uC5F4\uB9B0 \uC694\uCCAD",
    action: { label: "\uC694\uCCAD \uBCF4\uAE30", to: "/settings?tab=members" }
  });
  const pf = raw.portfolio ?? [];
  const lowShare = pf.filter((r) => r.mission_contribution <= 2).reduce((a, r) => a + (r.share_pct ?? 0), 0);
  if (lowShare >= 25) S.push({
    id: "exec-lowvalue",
    domain: "exec",
    type: "pattern",
    severity: 2,
    periods: M,
    title: `\uAE30\uC5EC\uB3C4\uAC00 \uB0AE\uC740 \uACFC\uC81C\uC5D0 \uD300 \uC2DC\uAC04 ${Math.round(lowShare)}%\uAC00 \uB4E4\uC5B4\uAC00\uACE0 \uC788\uC2B5\uB2C8\uB2E4`,
    detail: "\uAE30\uC5EC\uB3C4 1~2\uC778 \uACFC\uC81C\uB97C \uC904\uC774\uAC70\uB098 \uB118\uAE30\uBA74 \uD575\uC2EC \uBAA9\uD45C\uC5D0 \uC4F8 \uC2DC\uAC04\uC774 \uC0DD\uAE41\uB2C8\uB2E4.",
    rule: "\uC2DC\uAC04 \uD3EC\uD2B8\uD3F4\uB9AC\uC624: \uAE30\uC5EC\uB3C4 \u2264 2 \uD56D\uBAA9\uC758 \uC2DC\uAC04 \uBE44\uC911 25% \uC774\uC0C1",
    action: { label: "\uD3EC\uD2B8\uD3F4\uB9AC\uC624 \uBCF4\uAE30", to: "/goals/edit?view=table" }
  });
  const byOwner = /* @__PURE__ */ new Map();
  leaves.forEach((t) => t.owner_id && byOwner.set(t.owner_id, (byOwner.get(t.owner_id) ?? 0) + 1));
  const top = [...byOwner.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && leaves.length >= 6 && nMem >= 3 && top[1] / leaves.length >= 0.4) S.push({
    id: `exec-conc-${top[0]}`,
    domain: "exec",
    type: "pattern",
    severity: 2,
    periods: M,
    title: `\uC77C\uC774 ${nameOf(top[0])}\uB2D8\uC5D0\uAC8C \uBAB0\uB824 \uC788\uC2B5\uB2C8\uB2E4 (${top[1]}\uAC74, \uC9C4\uD589 \uD56D\uBAA9\uC758 ${Math.round(top[1] / leaves.length * 100)}%)`,
    detail: "\uD55C \uC0AC\uB78C\uC774 \uB9C9\uD788\uBA74 \uD300 \uC804\uCCB4 \uC77C\uC815\uC774 \uBC00\uB9BD\uB2C8\uB2E4. \uC7AC\uBC30\uBD84\uC744 \uAC80\uD1A0\uD574 \uBCF4\uC138\uC694.",
    rule: "\uD55C \uBA85\uC774 \uC9C4\uD589 \uC911\uC778 \uB9D0\uB2E8 \uD56D\uBAA9\uC758 40% \uC774\uC0C1 \uB2F4\uB2F9",
    action: { label: "\uD300\uC6D0\uAD00\uB9AC\uC5D0\uC11C \uBCF4\uAE30", to: "/people" }
  });
  const noOwner = work.filter((t) => !t.owner_id);
  if (noOwner.length) S.push({
    id: `exec-noowner-${noOwner.length}`,
    domain: "exec",
    type: "data",
    severity: 1,
    periods: M,
    title: `\uB2F4\uB2F9\uC790\uAC00 \uC5C6\uB294 \uD56D\uBAA9 ${noOwner.length}\uAC74`,
    detail: noOwner.slice(0, 3).map((t) => t.title).join(" \xB7 "),
    rule: "\uC9C4\uD589 \uC911\uC778\uB370 \uB2F4\uB2F9\uC790 \uBBF8\uC9C0\uC815",
    action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: "/goals" }
  });
  const noEffort = pf.filter((r) => !r.hours).length;
  if (pf.length >= 3 && noEffort / pf.length > 0.5) S.push({
    id: "exec-effort-data",
    domain: "exec",
    type: "data",
    severity: 1,
    periods: M,
    title: `\uACFC\uC81C ${pf.length}\uAC74 \uC911 ${noEffort}\uAC74\uC5D0 \uC8FC\uB2F9 \uD22C\uC785 \uC2DC\uAC04\uC774 \uC5C6\uC2B5\uB2C8\uB2E4`,
    detail: "\uD22C\uC785 \uC2DC\uAC04\uC744 \uB123\uC73C\uBA74 \uC2DC\uAC04 \uBC30\uBD84\xB7\uCDA9\uC6D0 \uC2DC\uBBAC\uB808\uC774\uC158\uC774 \uC815\uD655\uD574\uC9D1\uB2C8\uB2E4.",
    rule: "\uACF5\uC218 \uC785\uB825\uB960 50% \uBBF8\uB9CC",
    action: { label: "\uD45C\uC5D0\uC11C \uC785\uB825", to: "/goals/edit?view=table" }
  });
  const flagMap = new Map(mem.map((m) => [m.user_id, flagsFor(raw, m.user_id)]));
  const has = (u, k) => !!flagMap.get(u)?.some((f) => f.key === k);
  const noOO = [];
  const missing = [];
  for (const r of raw.care ?? []) for (const s of r.signals) {
    if (s.type === "condition_down") S.push({
      id: `care-cond-${r.user_id}`,
      domain: "people",
      type: "risk",
      severity: 3,
      periods: DW,
      title: `${r.full_name}\uB2D8 \uCEE8\uB514\uC158\uC774 3\uC8FC \uC5F0\uC18D \uB5A8\uC5B4\uC84C\uC2B5\uB2C8\uB2E4 (${s.label.replace("\uCEE8\uB514\uC158 ", "")})`,
      detail: "\uBC88\uC544\uC6C3\xB7\uC774\uD0C8 \uC2E0\uD638\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC774\uBC88 \uC8FC \uC548\uC5D0 1on1\uC744 \uAD8C\uD569\uB2C8\uB2E4.",
      rule: "\uACF5\uC720\uD55C \uCEE8\uB514\uC158 3\uC8FC \uC5F0\uC18D \uD558\uB77D, \uCD5C\uADFC \uAC12 3 \uC774\uD558",
      action: { label: "1on1 \uC7A1\uAE30", to: `/one-on-ones?new=${r.user_id}` }
    });
    if (s.type === "blocked_repeat" && !has(r.user_id, "frustrated")) S.push({
      id: `care-block-${r.user_id}`,
      domain: "people",
      type: "risk",
      severity: 2,
      periods: DW,
      title: `${r.full_name}\uB2D8\uC774 2\uC8FC\uC9F8 \uAC19\uC740 \uBB38\uC81C\uB85C \uB9C9\uD600 \uC788\uC2B5\uB2C8\uB2E4`,
      detail: s.detail ? `"${s.detail}"` : void 0,
      rule: "\uB9C9\uD78C \uC77C 2\uC8FC \uC5F0\uC18D (\uC608\uC804 \uC8FC\uAC04 \uCCB4\uD06C\uC778 \uAE30\uB85D)",
      action: { label: "1on1 \uC7A1\uAE30", to: `/one-on-ones?new=${r.user_id}` }
    });
    if (s.type === "no_one_on_one") noOO.push(r.full_name);
    if (s.type === "checkin_missing") missing.push(r.full_name);
  }
  if (noOO.length) S.push({
    id: `care-oo-${noOO.length}`,
    domain: "people",
    type: "missed",
    severity: 2,
    periods: W,
    title: `1on1\uC744 2\uC8FC \uB118\uAC8C \uC548 \uD55C \uD300\uC6D0 ${noOO.length}\uBA85`,
    detail: names(noOO),
    rule: "\uB9C8\uC9C0\uB9C9 \uC644\uB8CC 1on1\uC774 14\uC77C \uC804",
    action: { label: "1on1 \uC7A1\uAE30", to: "/people?new=1" }
  });
  const thisMon = kstMonday();
  for (const m of mem) {
    const c = raw.checkins.find((x) => x.user_id === m.user_id && x.week_start === thisMon);
    if (!c) continue;
    const moods = c.moods ?? [];
    const heavy = moods.filter((k) => HEAVY_MOODS.includes(k));
    if (heavy.length >= 2 || heavy.length >= 1 && c.condition != null && c.condition <= 2) S.push({
      id: `care-heavy-${m.user_id}-${thisMon}`,
      domain: "people",
      type: "risk",
      severity: 2,
      periods: DW,
      title: `${m.name}\uB2D8 \uCEE8\uB514\uC158 \uC800\uD558 \uC694\uC778 \uACF5\uC720`,
      detail: [heavy.map((k) => MOOD_LABEL[k]).join(" \xB7 "), c.note ? `"${c.note}"` : ""].filter(Boolean).join(" \u2014 "),
      rule: "\uC774\uBC88 \uC8FC \uBD80\uB2F4 \uC694\uC778 2\uAC1C \uC774\uC0C1, \uB610\uB294 \uCEE8\uB514\uC158 2 \uC774\uD558 + \uBD80\uB2F4 \uC694\uC778",
      action: { label: "\uD300\uC6D0 \uBCF4\uAE30", to: `/people/${m.user_id}` }
    });
  }
  if (missing.length) S.push({
    id: `care-ci-${thisMon}`,
    domain: "people",
    type: "data",
    severity: 1,
    periods: DW,
    title: `\uC774\uBC88 \uC8FC \uCEE8\uB514\uC158\uC744 \uACF5\uC720\uD558\uC9C0 \uC54A\uC740 \uD300\uC6D0 ${missing.length}\uBA85`,
    detail: `${names(missing)} \u2014 \uCEE8\uB514\uC158 \uACF5\uC720\uAC00 \uBE60\uC9C0\uBA74 \uCEE8\uB514\uC158\xB7\uB9C9\uD798 \uC2E0\uD638\uB97C \uB193\uCE69\uB2C8\uB2E4.`,
    rule: "\uC218\uC694\uC77C \uC774\uD6C4 \uC774\uBC88 \uC8FC \uCEE8\uB514\uC158 \uACF5\uC720 \uC5C6\uC74C",
    action: { label: "\uCEE8\uB514\uC158 \uACF5\uC720 \uC694\uCCAD \uBCF4\uB0B4\uAE30", to: "/settings?tab=members" }
  });
  const condOf = (pred) => raw.checkins.filter((c) => pred(c.week_start) && c.condition != null).map((c) => c.condition);
  const thisWeek = condOf((w) => w >= thisMon);
  const lastMon = addDaysYmd(thisMon, -7);
  const curC = avg(thisWeek.length >= 2 ? thisWeek : condOf((w) => w === lastMon));
  const priorC = avg(thisWeek.length >= 2 ? condOf((w) => w < thisMon) : condOf((w) => w < lastMon));
  if (curC != null && priorC != null) {
    const d = curC - priorC;
    if (d <= -0.4) S.push({
      id: `people-cond-down-${thisMon}`,
      domain: "people",
      type: "pattern",
      severity: 2,
      periods: WM,
      title: `\uD300 \uD3C9\uADE0 \uCEE8\uB514\uC158\uC774 ${priorC.toFixed(1)} \u2192 ${curC.toFixed(1)}\uB85C \uB0B4\uB824\uAC14\uC2B5\uB2C8\uB2E4`,
      detail: "\uD2B9\uC815 \uD504\uB85C\uC81D\uD2B8\xB7\uC77C\uC815 \uC555\uBC15\uC774 \uACB9\uCE5C \uC2DC\uAE30\uC778\uC9C0 \uD655\uC778\uD574 \uBCF4\uC138\uC694.",
      rule: "\uCD5C\uADFC \uC8FC \uD3C9\uADE0 vs \uC9C1\uC804 4\uC8FC \uD3C9\uADE0, 0.4 \uC774\uC0C1 \uD558\uB77D"
    });
    if (d >= 0.4) S.push({
      id: `people-cond-up-${thisMon}`,
      domain: "people",
      type: "good",
      severity: 1,
      periods: WM,
      title: `\uD300 \uD3C9\uADE0 \uCEE8\uB514\uC158\uC774 ${priorC.toFixed(1)} \u2192 ${curC.toFixed(1)}\uB85C \uC62C\uB77C\uAC14\uC2B5\uB2C8\uB2E4`,
      rule: "\uCD5C\uADFC \uC8FC \uD3C9\uADE0 vs \uC9C1\uC804 4\uC8FC \uD3C9\uADE0, 0.4 \uC774\uC0C1 \uC0C1\uC2B9"
    });
  }
  if (raw.latePromises) S.push({
    id: `promise-late-${raw.latePromises}`,
    domain: "people",
    type: "missed",
    severity: 2,
    periods: D,
    title: `\uD300\uC6D0\uC5D0\uAC8C \uD55C \uC57D\uC18D ${raw.latePromises}\uAC74\uC774 \uAE30\uD55C\uC744 \uB118\uACBC\uC2B5\uB2C8\uB2E4`,
    detail: "\uD300\uC7A5\uC758 \uC57D\uC18D\uC774 \uBC00\uB9AC\uBA74 1on1 \uC2E0\uB8B0\uAC00 \uAC00\uC7A5 \uBA3C\uC800 \uB5A8\uC5B4\uC9D1\uB2C8\uB2E4.",
    rule: "1on1\uC5D0\uC11C \uC815\uD55C \uD300\uC7A5 \uD560 \uC77C, \uAE30\uD55C \uACBD\uACFC",
    action: { label: "\uC57D\uC18D \uBCF4\uAE30", to: "#today" }
  });
  for (const m of mem) for (const f of flagMap.get(m.user_id) ?? []) {
    const nm = m.name;
    if (f.key === "frustrated") S.push({
      id: `care-frus-${m.user_id}`,
      domain: "people",
      type: "risk",
      severity: 2,
      periods: DW,
      title: `${nm}\uB2D8\uC740 \uC758\uC695\uC740 \uC788\uB294\uB370 \uB9C9\uD600 \uC788\uC2B5\uB2C8\uB2E4 \u2014 \uB9C9\uD78C \uAC83\uBD80\uD130 \uD480\uC5B4 \uC8FC\uC138\uC694`,
      detail: f.detail,
      rule: "\uCD5C\uADFC \uCEE8\uB514\uC158 3 \uC774\uC0C1 + (\uAC19\uC740 \uB9C9\uD798 2\uC8FC \uC5F0\uC18D \xB7 \uB9C9\uD798 \uC0C1\uD0DC \uD56D\uBAA9 \xB7 \uB9AC\uBDF0 \uB300\uAE30 3\uC77C \uC774\uC0C1)",
      action: { label: "1on1 \uC7A1\uAE30", to: `/one-on-ones?new=${m.user_id}` }
    });
    if (f.key === "recog_gap") S.push({
      id: `care-recog-${m.user_id}`,
      domain: "people",
      type: "missed",
      severity: 2,
      periods: WM,
      title: `${nm}\uB2D8\uC774 \uCD5C\uADFC \uC77C\uC744 \uB9C8\uCCE4\uB294\uB370 \uC778\uC815 \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4`,
      detail: `${f.detail} \u2014 \uC778\uC815\uC774 \uB04A\uAE30\uBA74 '\uB0B4\uAC00 \uBB58 \uD588\uC9C0'\uAC00 \uC313\uC785\uB2C8\uB2E4.`,
      rule: "\uCD5C\uADFC 30\uC77C \uC644\uB8CC \uD56D\uBAA9 + 45\uC77C \uC2B9\uC778 \uACB0\uACFC\uBB3C 2\uAC74 \uC774\uC0C1, 30\uC77C\uAC04 \uAE0D\uC815 \uAD00\uCC30\xB7\uCE6D\uCC2C 0\uAC74",
      action: { label: "\uCE6D\uCC2C \uBA54\uBAA8 \uB0A8\uAE30\uAE30", memo: m.user_id }
    });
    if (f.key === "growth_stall") S.push({
      id: `growth-stall-${m.user_id}`,
      domain: "growth",
      type: "pattern",
      severity: 1,
      periods: M,
      title: `${nm}\uB2D8 \uACB0\uACFC\uBB3C \uC218\uC900\uC774 \uB450 \uB2EC \uB118\uAC8C \uBE44\uC2B7\uD569\uB2C8\uB2E4 \u2014 \uD55C \uB2E8\uACC4 \uC5B4\uB824\uC6B4 \uC77C\uC744 \uB9E1\uAE38 \uB54C`,
      detail: f.detail,
      rule: "\uD310\uB2E8 \uAE4A\uC774 \uCD5C\uADFC 4\uAC74 \uCC28\uC774 0.5 \uC774\uD558\xB78\uC8FC \uC774\uC0C1, \uD3C9\uADE0 3.5 \uBBF8\uB9CC, 60\uC77C\uAC04 \uC0C8\uB85C \uB9E1\uC740 \uD56D\uBAA9 \uC5C6\uC74C",
      action: { label: "\uD300\uC6D0 \uBCF4\uAE30", to: `/people/${m.user_id}` }
    });
    if (f.key === "promise_late") S.push({
      id: `care-promise-${m.user_id}`,
      domain: "people",
      type: "missed",
      severity: 2,
      periods: W,
      title: `${nm}\uB2D8\uACFC\uC758 1on1\uC5D0\uC11C \uD55C \uC57D\uC18D\uC774 \uBC00\uB824 \uC788\uC2B5\uB2C8\uB2E4 \u2014 \uB2E4\uC74C 1on1 \uCCAB \uC548\uAC74\uC73C\uB85C`,
      detail: f.detail,
      rule: "\uC774 \uD300\uC6D0\uACFC\uC758 1on1\uC5D0\uC11C \uC815\uD55C \uD300\uC7A5 \uD560 \uC77C, \uAE30\uD55C \uC9C0\uB09C \uAC83 2\uAC74 \uC774\uC0C1 \uB610\uB294 14\uC77C \uC774\uC0C1",
      action: { label: "\uC57D\uC18D \uBCF4\uAE30", to: "#today" }
    });
    if (f.key === "withdrawn") S.push({
      id: `care-quiet-${m.user_id}`,
      domain: "people",
      type: "pattern",
      severity: 1,
      periods: W,
      title: `${nm}\uB2D8 \uCEE8\uB514\uC158 \uACF5\uC720\uAC00 \uB208\uC5D0 \uB744\uAC8C \uC9E7\uC544\uC84C\uC2B5\uB2C8\uB2E4 \u2014 \uCD94\uAD81\uBCF4\uB2E4 \uC548\uBD80\uBD80\uD130`,
      detail: f.detail,
      rule: "\uC774\uC804 \uCEE8\uB514\uC158 \uACF5\uC720 \uD3C9\uADE0 \uB300\uBE44 \uCD5C\uADFC 2\uC8FC 40% \uBBF8\uB9CC \uB610\uB294 \uBE60\uC9D0, \uB9C9\uD798 \uCE78 \uBE44\uC5B4 \uC788\uC74C",
      action: { label: "1on1 \uC7A1\uAE30", to: `/one-on-ones?new=${m.user_id}` }
    });
  }
  const ciThis = new Set(raw.checkins.filter((c) => c.week_start >= thisMon).map((c) => c.user_id)).size;
  const ciLast = new Set(raw.checkins.filter((c) => c.week_start === lastMon).map((c) => c.user_id)).size;
  const ciWeeks = new Set(raw.checkins.map((c) => c.week_start)).size;
  const inReview = raw.subs.filter((s) => s.status === "in_review");
  const waitDays = (s) => daysSince(s.submission_versions.reduce((a, v) => v.created_at > a ? v.created_at : a, s.created_at));
  const aged = inReview.filter((s) => waitDays(s) >= 3);
  const maxWait = inReview.length ? Math.max(...inReview.map(waitDays)) : 0;
  if (aged.length) S.push({
    id: `out-aged-${aged.length}-${maxWait}`,
    domain: "output",
    type: "missed",
    severity: maxWait >= 5 ? 2 : 1,
    periods: DW,
    title: `3\uC77C \uB118\uAC8C \uB9AC\uBDF0\uB97C \uAE30\uB2E4\uB9AC\uB294 \uACB0\uACFC\uBB3C ${aged.length}\uAC74 (\uCD5C\uC7A5 ${maxWait}\uC77C)`,
    detail: "AI 1\uCC28 \uAC80\uD1A0\uAC00 \uB05D\uB09C \uAC74\uBD80\uD130 \uBCF4\uBA74 \uBE60\uB985\uB2C8\uB2E4.",
    rule: "\uB9C8\uC9C0\uB9C9 \uBC84\uC804 \uC81C\uCD9C \uD6C4 3\uC77C \uACBD\uACFC, \uB9AC\uBDF0 \uC911 \uC0C1\uD0DC",
    action: { label: "\uB9AC\uBDF0\uD558\uB7EC \uAC00\uAE30", to: "/work" }
  });
  const byAuthor = /* @__PURE__ */ new Map();
  raw.subs.filter((s) => s.status !== "shared").forEach((s) => {
    const v = Math.max(1, ...s.submission_versions.map((x) => x.version));
    byAuthor.set(s.author_id, [...byAuthor.get(s.author_id) ?? [], v]);
  });
  for (const [a, vs] of byAuthor) {
    const av = avg(vs);
    if (vs.length >= 2 && av >= 2.5) S.push({
      id: `out-rework-${a}`,
      domain: "output",
      type: "pattern",
      severity: 2,
      periods: WM,
      title: `${nameOf(a)}\uB2D8 \uACB0\uACFC\uBB3C\uC774 \uD3C9\uADE0 ${av.toFixed(1)}\uCC28 \uC218\uC815\uAE4C\uC9C0 \uAC11\uB2C8\uB2E4`,
      detail: "\uAE30\uB300 \uAE30\uC900\uC774 \uCC98\uC74C\uC5D0 \uB35C \uC804\uB2EC\uB410\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uB0B4 \uB178\uD558\uC6B0\uC758 \uAE30\uC900 \uCE74\uB4DC\uB97C \uD300\uC6D0\uC5D0\uAC8C \uACF5\uAC1C\uD574 \uBCF4\uC138\uC694.",
      rule: "\uCD5C\uADFC 60\uC77C \uACB0\uACFC\uBB3C 2\uAC74 \uC774\uC0C1, \uD3C9\uADE0 \uBC84\uC804 2.5 \uC774\uC0C1",
      action: { label: "\uAE30\uC900 \uACF5\uC720\uD558\uAE30", to: "/knowhow" }
    });
  }
  const approved = raw.subs.filter((s) => s.status === "approved").length;
  const shared = raw.subs.filter((s) => s.status === "shared").length;
  const firstPass = raw.subs.filter((s) => s.status === "approved" && Math.max(1, ...s.submission_versions.map((x) => x.version)) === 1).length;
  const silent = mem.filter((m) => !raw.subs.some((s) => s.author_id === m.user_id) && !raw.checkins.some((c) => c.user_id === m.user_id && c.week_start >= addDaysYmd(thisMon, -14)));
  if (nMem >= 2 && silent.length) S.push({
    id: `out-silent-${silent.length}`,
    domain: "output",
    type: "missed",
    severity: 1,
    periods: WM,
    title: `2\uC8FC \uB118\uAC8C ATEAM\uC5D0 \uD754\uC801\uC774 \uC5C6\uB294 \uD300\uC6D0 ${silent.length}\uBA85`,
    detail: `${names(silent.map((m) => m.name))} \u2014 \uC694\uCCAD\uC744 \uBCF4\uB0B4\uBA74 \uD300\uC6D0 \uD654\uBA74\uC5D0 \uD560 \uC77C\uB85C \uB739\uB2C8\uB2E4.`,
    rule: "\uCD5C\uADFC 2\uC8FC \uCEE8\uB514\uC158 \uACF5\uC720\xB7\uC5C5\uBB34 \uACF5\uC720\xB7\uACB0\uACFC\uBB3C 0\uAC74",
    action: { label: "\uC694\uCCAD \uBCF4\uB0B4\uAE30", to: "/settings?tab=members" }
  });
  const depth = raw.depth ?? [];
  const thin = depth.filter((d) => !d.eligible);
  if (depth.length && thin.length) S.push({
    id: `growth-thin-${thin.length}`,
    domain: "growth",
    type: "data",
    severity: thin.length / depth.length >= 0.5 ? 2 : 1,
    periods: M,
    title: `\uD310\uB2E8 \uADFC\uAC70\uAC00 ${raw.minEvidence}\uAC74 \uBBF8\uB9CC\uC778 \uD300\uC6D0 ${thin.length}\uBA85 \u2014 \uC9C0\uAE08 \uD3C9\uAC00\uD558\uBA74 '\uD310\uB2E8 \uBCF4\uB958'`,
    detail: thin.slice(0, 4).map((d) => `${d.full_name} ${d.judgment_evidence}\uAC74`).join(" \xB7 "),
    rule: `\uACB0\uACFC\uBB3C\xB7\uAD00\uCC30\xB7\uB9AC\uBDF0 \uCF54\uBA58\uD2B8\xB7\uD300\uC7A5 \uD53C\uB4DC\uBC31\xB7\uC644\uB8CC \uD56D\uBAA9 \uD569\uACC4 < ${raw.minEvidence}\uAC74`,
    action: { label: "\uAD00\uCC30 \uBA54\uBAA8 \uC4F0\uAE30", memo: thin[0].user_id }
  });
  const obsSet = new Set(raw.obs.map((o) => o.subject_id));
  const noObs = mem.filter((m) => !obsSet.has(m.user_id));
  if (nMem && noObs.length) S.push({
    id: `growth-noobs-${noObs.length}`,
    domain: "growth",
    type: "missed",
    severity: 1,
    periods: WM,
    title: `\uCD5C\uADFC 30\uC77C \uAD00\uCC30 \uBA54\uBAA8\uAC00 \uC5C6\uB294 \uD300\uC6D0 ${noObs.length}\uBA85`,
    detail: `${names(noObs.map((m) => m.name))} \u2014 \uC798\uD55C \uC7A5\uBA74\uC744 \uADF8\uB54C\uADF8\uB54C \uB0A8\uACA8 \uB450\uBA74 \uD3C9\uAC00 \uC2DC\uC98C\uC774 \uD3B8\uD574\uC9D1\uB2C8\uB2E4.`,
    rule: "\uCD5C\uADFC 30\uC77C \uAD00\uCC30 \uBA54\uBAA8 0\uAC74",
    action: { label: "\uAD00\uCC30 \uBA54\uBAA8 \uC4F0\uAE30", memo: noObs[0].user_id }
  });
  for (const p of raw.perf ?? []) {
    if (p.withheld) continue;
    const dx = p.x - p.prev_x;
    const dy = p.y - p.prev_y;
    if (dx <= -12 || dy <= -12) S.push({
      id: `growth-down-${p.user_id}`,
      domain: "growth",
      type: "risk",
      severity: 2,
      periods: M,
      title: `${p.full_name}\uB2D8 \uC131\uACFC \uC9C0\uD45C\uAC00 90\uC77C \uC804\uBCF4\uB2E4 \uB5A8\uC5B4\uC84C\uC2B5\uB2C8\uB2E4`,
      detail: `\uACB0\uACFC ${Math.round(p.prev_x)} \u2192 ${Math.round(p.x)} \xB7 \uD310\uB2E8\xB7\uC131\uC7A5 ${Math.round(p.prev_y)} \u2192 ${Math.round(p.y)}`,
      rule: "\uC131\uACFC \uC9C0\uB3C4 \uC88C\uD45C, 90\uC77C \uC804 \uB300\uBE44 12\uC810 \uC774\uC0C1 \uD558\uB77D",
      action: { label: "\uD300 \uC131\uACFC \uBCF4\uAE30", to: "/perf" }
    });
    else if (dx >= 12 || dy >= 12) S.push({
      id: `growth-up-${p.user_id}`,
      domain: "growth",
      type: "good",
      severity: 1,
      periods: M,
      title: `${p.full_name}\uB2D8\uC774 \uB208\uC5D0 \uB744\uAC8C \uC131\uC7A5\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4`,
      detail: `\uACB0\uACFC ${Math.round(p.prev_x)} \u2192 ${Math.round(p.x)} \xB7 \uD310\uB2E8\xB7\uC131\uC7A5 ${Math.round(p.prev_y)} \u2192 ${Math.round(p.y)} \u2014 \uC778\uC815\uD574 \uC904 \uD0C0\uC774\uBC0D\uC785\uB2C8\uB2E4.`,
      rule: "\uC131\uACFC \uC9C0\uB3C4 \uC88C\uD45C, 90\uC77C \uC804 \uB300\uBE44 12\uC810 \uC774\uC0C1 \uC0C1\uC2B9",
      action: { label: "\uCE6D\uCC2C \uBA54\uBAA8 \uB0A8\uAE30\uAE30", memo: p.user_id }
    });
  }
  const onTime = /* @__PURE__ */ new Map();
  items.filter((i) => i.status === "done" && i.base_due && i.owner_id && daysSince(i.updated_at) <= 30 && i.updated_at.slice(0, 10) <= i.base_due).forEach((i) => onTime.set(i.owner_id, (onTime.get(i.owner_id) ?? 0) + 1));
  for (const [u, n] of onTime) if (n >= 3 && members.some((m) => m.user_id === u && m.role === "member")) S.push({
    id: `growth-ontime-${u}`,
    domain: "growth",
    type: "good",
    severity: 1,
    periods: M,
    title: `${nameOf(u)}\uB2D8\uC774 \uCD5C\uADFC 30\uC77C \uACC4\uD68D\uD55C \uC77C ${n}\uAC74\uC744 \uAE30\uD55C \uC548\uC5D0 \uB05D\uB0C8\uC2B5\uB2C8\uB2E4`,
    rule: "\uCD5C\uADFC 30\uC77C, \uCC98\uC74C \uACC4\uD68D\uD55C \uB9C8\uAC10 \uC774\uC804 \uC644\uB8CC 3\uAC74 \uC774\uC0C1",
    action: { label: "\uCE6D\uCC2C \uBA54\uBAA8 \uB0A8\uAE30\uAE30", memo: u }
  });
  const org = raw.orgNotes ?? [];
  const dDay = (d) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
  for (const n of org.filter((x) => x.event_date && (x.kind === "calendar" || x.kind === "request"))) {
    const dd = dDay(n.event_date);
    if (n.kind === "request" && dd < 0) S.push({
      id: `org-req-late-${n.id}`,
      domain: "org",
      type: "missed",
      severity: 2,
      periods: DW,
      title: `\uC0C1\uC704 \uC694\uCCAD '${n.title}' \uAE30\uD55C\uC774 ${-dd}\uC77C \uC9C0\uB0AC\uC2B5\uB2C8\uB2E4`,
      rule: "\uC0C1\uC704 \uC694\uCCAD \uBA54\uBAA8\uC758 \uAE30\uD55C \uACBD\uACFC, \uC644\uB8CC \uD45C\uC2DC \uC5C6\uC74C",
      action: { label: "\uC870\uC9C1\xB7\uC804\uC0AC \uBCF4\uAE30", to: "#org" }
    });
    else if (n.kind === "request" && dd <= 7) S.push({
      id: `org-req-soon-${n.id}`,
      domain: "org",
      type: "forecast",
      severity: dd <= 2 ? 3 : 2,
      periods: dd <= 3 ? DW : W,
      title: `\uC0C1\uC704 \uC694\uCCAD '${n.title}' \uB9C8\uAC10 D-${dd}`,
      rule: "\uC0C1\uC704 \uC694\uCCAD \uBA54\uBAA8\uC758 \uAE30\uD55C 7\uC77C \uC774\uB0B4",
      action: { label: "\uC870\uC9C1\xB7\uC804\uC0AC \uBCF4\uAE30", to: "#org" }
    });
    else if (n.kind === "calendar" && dd >= 0 && dd <= 14) S.push({
      id: `org-cal-${n.id}`,
      domain: "org",
      type: "forecast",
      severity: dd <= 7 ? 2 : 1,
      periods: dd <= 7 ? DW : WM,
      title: `\uC804\uC0AC \uC77C\uC815 '${n.title}' D-${dd}`,
      rule: "\uC804\uC0AC \uC77C\uC815 \uBA54\uBAA8 14\uC77C \uC774\uB0B4",
      action: { label: "\uC870\uC9C1\xB7\uC804\uC0AC \uBCF4\uAE30", to: "#org" }
    });
  }
  const analyzed = new Set(raw.orgImpacts ?? []);
  const unread = org.filter((n) => ["strategy", "exec", "request", "peer"].includes(n.kind) && daysSince(n.created_at) <= 14 && !analyzed.has(n.id));
  if (unread.length) S.push({
    id: `org-unread-${unread.length}-${unread[0].id.slice(0, 6)}`,
    domain: "org",
    type: "missed",
    severity: 1,
    periods: WM,
    title: `\uC6B0\uB9AC \uD300 \uC601\uD5A5\uC744 \uC544\uC9C1 \uD655\uC778\uD558\uC9C0 \uC54A\uC740 \uC704\uC758 \uC18C\uC2DD ${unread.length}\uAC74`,
    detail: unread.slice(0, 3).map((n) => n.title).join(" \xB7 "),
    rule: "\uCD5C\uADFC 14\uC77C \uC0C1\uC704 \uC18C\uC2DD \uBA54\uBAA8 \uC911 \uC601\uD5A5 \uBD84\uC11D \uC5C6\uC74C",
    action: { label: "\uC601\uD5A5 \uBCF4\uAE30", to: "#org" }
  });
  const decDue = (raw.decisionsDue ?? []).filter((d) => d.review_on ? d.review_on <= today : daysSince(d.decided_at) >= 30);
  if (decDue.length) S.push({
    id: `decide-review-${decDue.length}`,
    domain: "goal",
    type: "missed",
    severity: 1,
    periods: WM,
    title: `\uACB0\uACFC\uB97C \uB3CC\uC544\uBCFC \uC2DC\uC810\uC774 \uC9C0\uB09C \uACB0\uC815 ${decDue.length}\uAC74`,
    detail: decDue.slice(0, 3).map((d) => d.title).join(" \xB7 "),
    rule: "\uD68C\uACE0\uC77C\uC774 \uC9C0\uB0AC\uAC70\uB098 \uACB0\uC815 \uD6C4 30\uC77C\uC774 \uC9C0\uB0AC\uB294\uB370 \uACB0\uACFC \uAE30\uB85D \uC5C6\uC74C",
    action: { label: "\uACB0\uACFC \uAE30\uB85D\uD558\uAE30", to: "/decide" }
  });
  const lv = raw.level;
  if (lv && lv.level < 5) {
    const next = lv.levels[lv.level];
    const gap = next.conditions.find((c) => c.current < c.target);
    if (gap) {
      const gl = gap.label.replace("\uCCB4\uD06C\uC778\uC774 \uC313\uC778 \uC8FC", "\uCEE8\uB514\uC158 \uACF5\uC720\uAC00 \uC313\uC778 \uC8FC").replace(/1:1/g, "1on1");
      const gd = /체크인|컨디션|1:1|1on1/.test(gl) ? "people" : /결과물/.test(gl) ? "output" : /근거/.test(gl) ? "growth" : /공수/.test(gl) ? "exec" : "goal";
      S.push({
        id: `level-${lv.level}-${gl}`,
        domain: gd,
        type: "data",
        severity: 1,
        periods: M,
        title: `${gl} ${gap.target - gap.current}${gap.unit ?? ""}\uB9CC \uB354 \uC313\uC774\uBA74 AI\uAC00 'L${next.level} ${next.name}'\uAE4C\uC9C0 \uBD05\uB2C8\uB2E4`,
        detail: `\uC9C0\uAE08\uC740 L${lv.level} ${lv.levels[lv.level - 1].name} \uB2E8\uACC4\uC785\uB2C8\uB2E4.`,
        rule: "AI \uC778\uC0AC\uC774\uD2B8 \uB808\uBCA8 \uC870\uAC74",
        action: { label: "\uB808\uBCA8 \uC870\uAC74 \uBCF4\uAE30", to: "/insight" }
      });
    }
  }
  const pick = (d) => S.filter((s) => s.domain === d && s.type !== "good" && s.type !== "data").sort((a, b) => b.severity - a.severity)[0];
  const statusOf = (d, unknown) => {
    if (unknown) return "unknown";
    const sev = Math.max(0, ...S.filter((s) => s.domain === d && (s.type === "risk" || s.type === "missed" || s.type === "forecast")).map((s) => s.type === "forecast" ? s.severity - 1 : s.severity));
    const dataGap = S.some((s) => s.domain === d && s.type === "data" && s.severity >= 2);
    return sev >= 3 ? "risk" : sev === 2 || dataGap ? "watch" : "good";
  };
  const effortPct = pf.length ? Math.round((pf.length - noEffort) / pf.length * 100) : 0;
  const metricMonths = lv?.totals.metric_months ?? 0;
  const onPlan = leaves.length ? Math.round((leaves.length - overdue.length - leaves.filter((l) => l.status === "blocked").length) / leaves.length * 100) : null;
  const domains = [
    {
      domain: "goal",
      status: statusOf("goal", !goals.length && !raw.forecasts.length),
      kpi: goalLow != null ? `${goalLow}%` : "\u2014",
      kpiLabel: goalLow != null ? "\uAC00\uC7A5 \uB0AE\uC740 \uBAA9\uD45C \uB2EC\uC131 \uAC00\uB2A5\uC131" : "\uC804\uB9DD \uC5C6\uC74C",
      line: pick("goal")?.title ?? (goals.length ? `\uBAA9\uD45C ${goals.length}\uAC1C \uBAA8\uB450 \uC21C\uD56D \uC911\uC785\uB2C8\uB2E4` : "\uBAA9\uD45C\uB97C \uC138\uC6B0\uBA74 \uC804\uB9DD\uC774 \uB098\uC635\uB2C8\uB2E4"),
      confidence: metricMonths >= 6 ? 3 : metricMonths >= 3 ? 2 : goals.length ? 1 : 0,
      confidenceNote: `\uC2E4\uC801 ${metricMonths}\uAC1C\uC6D4\uCE58 \xB7 \uBAA9\uD45C ${goals.length}\uAC1C`,
      to: "/goals",
      period: DOMAIN_META.goal.period
    },
    {
      domain: "exec",
      status: statusOf("exec", !work.length),
      kpi: onPlan != null ? `${onPlan}%` : "\u2014",
      kpiLabel: onPlan != null ? `\uACC4\uD68D\uB300\uB85C \uC9C4\uD589 (\uD56D\uBAA9 ${leaves.length}\uAC74 \uC911)` : "\uC9C4\uD589 \uD56D\uBAA9 \uC5C6\uC74C",
      line: pick("exec")?.title ?? (work.length ? "\uC9C0\uC5F0\xB7\uB9C9\uD798 \uC5C6\uC774 \uC9C4\uD589 \uC911\uC785\uB2C8\uB2E4" : "\uACFC\uC81C\uB97C \uC138\uC6B0\uBA74 \uACC4\uD68D \uB300\uBE44\uB97C \uBD05\uB2C8\uB2E4"),
      confidence: !work.length ? 0 : effortPct >= 60 && sched.length >= 3 ? 3 : sched.length ? 2 : 1,
      confidenceNote: `\uC9C4\uD589 \uD56D\uBAA9 ${work.length}\uAC74 \xB7 \uACF5\uC218 \uC785\uB825 ${effortPct}%`,
      to: "/goals",
      period: DOMAIN_META.exec.period
    },
    {
      domain: "people",
      status: statusOf("people", !nMem),
      kpi: curC != null ? `${curC.toFixed(1)}` : "\u2014",
      kpiLabel: curC != null ? `\uD300 \uCEE8\uB514\uC158 (5\uC810) \xB7 \uCEE8\uB514\uC158 \uACF5\uC720 ${ciThis || ciLast}/${nMem}\uBA85` : "\uCEE8\uB514\uC158 \uAE30\uB85D \uC5C6\uC74C",
      line: pick("people")?.title ?? (nMem ? "\uD2B9\uBCC4\uD788 \uCC59\uAE38 \uC2E0\uD638\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4" : "\uD300\uC6D0\uC744 \uCD08\uB300\uD558\uBA74 \uCEE8\uB514\uC158 \uCD94\uC138\uB97C \uBD05\uB2C8\uB2E4"),
      confidence: !nMem ? 0 : ciWeeks >= 4 ? 3 : ciWeeks >= 2 ? 2 : 1,
      confidenceNote: `\uCD5C\uADFC 5\uC8FC \uC911 \uCEE8\uB514\uC158 \uACF5\uC720 \uC788\uB294 \uC8FC ${ciWeeks}\uC8FC`,
      to: "/people",
      period: DOMAIN_META.people.period
    },
    {
      domain: "output",
      status: statusOf("output", !raw.subs.length),
      kpi: `${inReview.length}`,
      kpiLabel: inReview.length ? `\uB9AC\uBDF0 \uB300\uAE30 \xB7 \uCD5C\uC7A5 ${maxWait}\uC77C` : "\uB9AC\uBDF0 \uB300\uAE30",
      line: pick("output")?.title ?? (raw.subs.length ? `\uCD5C\uADFC 60\uC77C \uC2B9\uC778 ${approved}\uAC74 \xB7 \uD55C \uBC88\uC5D0 \uD1B5\uACFC ${firstPass}\uAC74 \xB7 \uACF5\uC720 ${shared}\uAC74` : "\uACB0\uACFC\uBB3C\uC774 \uC62C\uB77C\uC624\uBA74 \uB9AC\uBDF0 \uD750\uB984\uC744 \uBD05\uB2C8\uB2E4"),
      confidence: raw.subs.length >= 10 ? 3 : raw.subs.length >= 4 ? 2 : raw.subs.length ? 1 : 0,
      confidenceNote: `\uCD5C\uADFC 60\uC77C \uACB0\uACFC\uBB3C\xB7\uACF5\uC720 ${raw.subs.length}\uAC74`,
      to: "/work",
      period: DOMAIN_META.output.period
    },
    {
      domain: "growth",
      status: statusOf("growth", !depth.length),
      kpi: depth.length ? `${depth.length - thin.length}/${depth.length}` : "\u2014",
      kpiLabel: "\uD3C9\uAC00 \uADFC\uAC70\uAC00 \uCDA9\uBD84\uD55C \uD300\uC6D0",
      line: pick("growth")?.title ?? (thin.length ? `\uADFC\uAC70\uAC00 \uBD80\uC871\uD55C \uD300\uC6D0 ${thin.length}\uBA85` : depth.length ? "\uBAA8\uB4E0 \uD300\uC6D0\uC758 \uD3C9\uAC00 \uADFC\uAC70\uAC00 \uCDA9\uBD84\uD569\uB2C8\uB2E4" : "\uD300\uC6D0\uC744 \uCD08\uB300\uD558\uBA74 \uD3C9\uAC00 \uADFC\uAC70\uB97C \uBAA8\uC74D\uB2C8\uB2E4"),
      confidence: !depth.length ? 0 : thin.length === 0 ? 3 : thin.length / depth.length < 0.5 ? 2 : 1,
      confidenceNote: `\uCD5C\uADFC 30\uC77C \uAD00\uCC30 \uBA54\uBAA8 ${raw.obs.length}\uAC74`,
      to: "/eval",
      period: DOMAIN_META.growth.period
    }
  ];
  const order = { risk: 0, missed: 1, forecast: 2, pattern: 3, good: 4, data: 5 };
  S.sort((a, b) => b.severity - a.severity || order[a.type] - order[b.type]);
  return { signals: S, domains };
}
function signalsFor(period, signals) {
  return signals.filter((s) => s.periods.includes(period));
}

// functions/_shared/notes.ts
var NOTE_RULE = `

[\uD300\uC7A5 \uAC1C\uC778 \uBA54\uBAA8] \uADFC\uAC70 \uC911 '\uD300\uC7A5 \uAC1C\uC778 \uBA54\uBAA8'\uB294 \uD300\uC7A5\uC774 \uC790\uAE30\uB9CC \uBCF4\uB824\uACE0 \uC801\uC740 \uC0DD\uAC01\xB7\uAD00\uCC30\uC785\uB2C8\uB2E4. \uC0AC\uC2E4\uB85C \uB2E8\uC815\uD558\uC9C0 \uB9D0\uACE0 \uD310\uB2E8\uC758 \uB9E5\uB77D\uC73C\uB85C\uB9CC \uC4F0\uBA70, \uBA54\uBAA8 \uBB38\uC7A5\uC744 \uADF8\uB300\uB85C \uC62E\uACA8 \uC801\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uD300\uC6D0\uC5D0 \uB300\uD55C \uBA54\uBAA8\uB97C \uD3C9\uAC00\uB098 \uB4F1\uAE09\uC758 \uADFC\uAC70\uB85C \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`;
var KIND = { member: "\uD300\uC6D0", item: "\uBAA9\uD45C\xB7\uACFC\uC81C", exec: "\uC0C1\uC704 \uAD00\uB9AC\uC790", decision: "\uACB0\uC815", one_on_one: "1on1", none: "" };
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

// functions/ai-autopilot/index.ts
var DAY = 864e5;
var since = (d) => new Date(Date.now() - d * DAY).toISOString();
var ACTION_TYPES = ["praise", "cheer", "push", "progress", "rework", "thread", "grow", "plan", "oo", "memo"];
var SEMI_DEFAULT = { praise: true, cheer: true, progress: true, rework: true, push: true, thread: false, grow: false, plan: false, oo: false, memo: true };
var SENSITIVE = /(건강|병원|아프|아픈|질병|수술|진단|우울|불안|스트레스|번아웃|개인\s*사정|가족|육아|출산|임신|결혼|이혼|장례|이직|퇴사|그만두|면접|연봉|급여|보상|성과급|승진|평가\s*등급|등급|징계|갈등|다툼|괴롭힘|불화)/;
var AUTO_CAP_PER_MEMBER = 2;
var MAX_LINES = 20;
var AUTOPILOT = `\uACFC\uC81C: \uB2F9\uC2E0\uC740 \uD300\uC7A5\uC758 'AUTOPILOT(\uC790\uC728\uC8FC\uD589)'\uC785\uB2C8\uB2E4. \uD300\uC7A5\uC774 \uBC84\uD2BC\uC744 \uD55C \uBC88 \uB204\uB974\uBA74, \uD300 \uB370\uC774\uD130\uB97C \uC77D\uACE0 \uC544\uB798 \uD575\uC2EC \uC9C8\uBB38\uC5D0 \uB2F5\uD574 '\uD55C\uB208\uC5D0 \uD6D1\uACE0 \uBC14\uB85C \uCC98\uB9AC\uD558\uB294 \uBAA9\uB85D'\uC744 \uB9CC\uB4ED\uB2C8\uB2E4. \uC9C8\uBB38\uBCC4 \uBCF4\uACE0\uC11C\uAC00 \uC544\uB2D9\uB2C8\uB2E4. \uBAA9\uB85D\uC758 \uD55C \uC904 = \uD300\uC7A5\uC774 \uC54C\uC544\uC57C \uD560 \uAC83 \uD558\uB098 + (\uC788\uC73C\uBA74) \uBC14\uB85C \uD560 \uC218 \uC788\uB294 \uC561\uC158.
\uC785\uB825: \uACC4\uC0B0\uB41C \uD300 \uC2E0\uD638, \uD300\uC6D0(M#)\xB7\uACFC\uC81C(I#)\xB7\uACB0\uACFC\uBB3C(S#)\xB7\uBAA9\uD45C(G#) \uBAA9\uB85D, \uC704\uC5D0\uC11C \uC628 \uAC83(\uC804\uC0AC\xB7\uC784\uC6D0\xB7\uC0C1\uC704 \uC694\uCCAD\xB7\uC720\uAD00\uBD80\uC11C\xB7\uC804\uC0AC \uC77C\uC815), \uD300\uC7A5 \uC6B4\uC601 \uBD80\uB2F4, \uBAA9\uD45C\uBCC4 \uBD84\uAE30 \uB9D0 \uC608\uC0C1\uCE58(\uACC4\uC0B0\uAC12).

\uC2DC\uAC04 \uCD95: \uC774 \uBAA9\uB85D\uC740 '\uD604\uC548'\uACFC '\uC804\uB9DD'\uC785\uB2C8\uB2E4. \uC9C0\uAE08 \uC5F4\uB824 \uC788\uB294 \uAC83(\uC624\uB798\uB410\uC5B4\uB3C4 \uC544\uC9C1 \uC548 \uD480\uB838\uC73C\uBA74 \uD604\uC548 \u2014 \uBA70\uCE60\uC9F8\uC778\uC9C0\uAC00 \uC2E0\uD638), \uCD5C\uADFC 2~4\uC8FC\uC758 \uBCC0\uD654, \uC55E\uC73C\uB85C 2\uC8FC\uC758 \uB9C8\uAC10\xB7\uC77C\uC815\uACFC \uBD84\uAE30 \uB9D0 \uC804\uB9DD\uC744 \uBD05\uB2C8\uB2E4. \uC774\uBBF8 \uB05D\uB09C \uC9C0\uB09C \uC77C\uC740 \uC9C0\uAE08\uB3C4 \uC601\uD5A5\uC744 \uC904 \uB54C\uB9CC \uC501\uB2C8\uB2E4.

\uD575\uC2EC \uC9C8\uBB38 (q \uBC88\uD638):
1 \uC9C0\uAE08 \uD558\uC9C0 \uC54A\uC73C\uBA74 \uD06C\uB9AC\uD2F0\uCEEC\uD55C \uC77C \u2014 \uC774\uBC88 \uC8FC~2\uC8FC \uC548\uC5D0 \uC190\uB300\uC9C0 \uC54A\uC73C\uBA74 \uBB38\uC81C\uAC00 \uB418\uB294 \uAC83. \uD300 \uC548(\uAE30\uD55C \uC784\uBC15\xB7\uACC4\uD68D\uBCF4\uB2E4 \uB2A6\uC740 \uD56D\uBAA9\xB7\uB9C9\uD798)\uACFC \uC704\xB7\uC606(\uC0C1\uC704 \uC694\uCCAD \uB9C8\uAC10\xB7\uC804\uC0AC \uC77C\uC815\xB7\uBC29\uCE68 \uBCC0\uACBD\xB7\uC720\uAD00\uBD80\uC11C\uC640 \uC8FC\uACE0\uBC1B\uC744 \uAC83).
2 \uBCD1\uBAA9\uACFC \uC6D0\uC778 \u2014 \uC77C\uC774 \uBA48\uCD98 \uAD6C\uC870\uC801 \uC6D0\uC778. \uD300 \uC548(\uB9C9\uD798\xB7\uB9AC\uBDF0 \uB300\uAE30\xB7\uACB0\uC815 \uB300\uAE30\xB7\uC7AC\uACC4\uD68D \uBC18\uBCF5), \uC704\xB7\uC606(\uC720\uAD00\uBD80\uC11C \uC77C\uC815\xB7\uC678\uBD80 \uC758\uC874\xB7\uC804\uC0AC \uBC29\uCE68\uACFC\uC758 \uCDA9\uB3CC), \uD300\uC7A5 \uBCF8\uC778\uC774 \uBCD1\uBAA9\uC778 \uAC83(\uB9AC\uBDF0 \uC801\uCCB4\xB7\uB2F5 \uC548 \uD55C \uC694\uCCAD).
3 \uC6B0\uC120\uC21C\uC704 \uB300\uBE44 \uB9AC\uC18C\uC2A4 \u2014 \uAE30\uC5EC\uB3C4\uB294 \uB192\uC740\uB370 \uD22C\uC785\uC774 \uC801\uC740 \uACF3, \uD55C \uC0AC\uB78C\uC5D0\uAC8C \uBAB0\uB9B0 \uC77C, \uC190\uB300\uC9C0 \uC54A\uC740 \uC911\uC694 \uACFC\uC81C.
4 \uC774\uBC88 \uBD84\uAE30 \uBAA9\uD45C \uC804\uB9DD \u2014 \uBAA9\uD45C\uBCC4 '\uC9C0\uAE08 \uC18D\uB3C4' \uC608\uC0C1\uCE58\uB294 \uC2DC\uC2A4\uD15C\uC774 \uACC4\uC0B0\uD574\uC11C \uB530\uB85C \uBCF4\uC5EC \uC90D\uB2C8\uB2E4. \uB2F9\uC2E0\uC740 \uBD84\uAE30 \uBAA9\uD45C\uB97C \uD754\uB4E4 \uB9AC\uC2A4\uD06C(\uAC00\uB2A5\uC131\xD7\uC601\uD5A5)\uB97C \uD56D\uBAA9\uC73C\uB85C \uC4F0\uACE0, forecast \uC5D0 \uBAA9\uD45C\uBCC4 \uBCC0\uD654\uD3ED\uB9CC \uD310\uB2E8\uD569\uB2C8\uB2E4.
5 \uC0AC\uB78C\uAD00\uB9AC \u2014 \uCEE8\uB514\uC158 \uD558\uB77D\xB7\uC774\uD0C8 \uC2E0\uD638\xB71on1 \uACF5\uBC31\xB7\uC778\uC815\uC774 \uD544\uC694\uD55C \uC0AC\uB78C\xB7\uC131\uC7A5 \uAE30\uD68C.
6 \uC774\uB807\uAC8C \uD574\uBCF4\uC138\uC694 \u2014 1~5\uB97C \uC885\uD569\uD574 \uACB0\uACFC\uB97C \uAC00\uC7A5 \uD06C\uAC8C \uBC14\uAFC0 \uD589\uB3D9 2~3\uAC1C. \uD6A8\uACFC\uAC00 \uAC00\uC7A5 \uD070 \uAC83\uC744 \uB9E8 \uC55E\uC5D0.
7 \uD55C \uAC78\uC74C \uBB3C\uB7EC\uC11C\uC11C \u2014 \uD300 \uC0C1\uD669\uC744 \uB2E4\uB978 \uD2C0\uB85C \uBCF4\uAC8C \uD558\uB294 \uAD00\uC810 \uD55C \uAC1C. \uD560 \uC77C \uBAA9\uB85D\uC774 \uC544\uB2D9\uB2C8\uB2E4.

items \uC6D0\uCE59:
- \uBAA9\uB85D\uC758 \uC904 \uC218\uC5D0 \uD55C\uB3C4\uAC00 \uC788\uC2B5\uB2C8\uB2E4(\uC785\uB825 \uCCAB\uBA38\uB9AC\uC758 '\uBAA9\uB85D \uD55C\uB3C4'). \uBCF4\uB0BC \uC561\uC158 \uD558\uB098 \xB7 \uD300\uC7A5 \uD560 \uC77C \uD558\uB098\uAC00 \uAC01\uAC01 \uD55C \uC904\uC774\uACE0, \uB458 \uB2E4 \uC5C6\uB294 \uD56D\uBAA9\uC740 \uD55C \uC904\uC785\uB2C8\uB2E4. \uD55C\uB3C4 \uC548\uC5D0\uC11C \uC815\uB9D0 \uC911\uC694\uD55C \uAC83\uB9CC \uACE0\uB974\uACE0, \uD55C\uB3C4\uB97C \uCC44\uC6B0\uB824\uACE0 \uB35C \uC911\uC694\uD55C \uAC83\uC744 \uB123\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- q \uC21C\uC11C(1\u21927)\uB85C, \uAC19\uC740 q \uC548\uC5D0\uC11C\uB294 \uC911\uC694\uD55C \uC21C\uC11C\uB85C. \uD574\uB2F9 \uC5C6\uB294 q \uB294 \uAC74\uB108\uB701\uB2C8\uB2E4(7\uC740 1\uAC1C).
- q: \uAC00\uC7A5 \uB9DE\uB294 \uC9C8\uBB38 \uBC88\uD638 \uD558\uB098. also: \uD568\uAED8 \uD574\uB2F9\uD558\uB294 \uB2E4\uB978 \uC9C8\uBB38 \uBC88\uD638(\uC5C6\uC73C\uBA74 \uBE48 \uBC30\uC5F4, \uCD5C\uB300 2\uAC1C).
- level: high(\uC774\uBC88 \uC8FC \uAF2D) | mid | low(\uCC38\uACE0).
- \uB9D0\uD22C: \uD300\uC7A5\uC774 \uC77D\uACE0 \uBC14\uB85C \uC774\uD574\uD558\uB294 \uC790\uC5F0\uC2A4\uB7EC\uC6B4 \uBB38\uC7A5\uC73C\uB85C. \uCEE8\uC124\uD305 \uC6A9\uC5B4(\uB808\uBC84 \xB7 \uC784\uD329\uD2B8 \xB7 \uC5BC\uB77C\uC778 \uB4F1)\uB294 \uC368\uB3C4 \uB418\uC9C0\uB9CC \uBB38\uC7A5 \uC548\uC5D0\uC11C \uB9E4\uB044\uB7FD\uAC8C \uC4F0\uACE0, '\uAC00\uC7A5 \uD06C\uAC8C \uC6C0\uC9C1\uC774\uB294 \uB808\uBC84'\uCC98\uB7FC \uC6A9\uC5B4\uB9CC \uB369\uADF8\uB7EC\uB2C8 \uC81C\uBAA9\uC774 \uB418\uB294 \uC5B4\uC0C9\uD55C \uD45C\uD604\uC740 \uD53C\uD569\uB2C8\uB2E4.
- title: \uD55C \uC904(35\uC790 \uC774\uB0B4, \uB118\uAE30\uC9C0 \uC54A\uC74C \u2014 \uC22B\uC790\uB97C \uB298\uC5B4\uB193\uC9C0 \uB9D0\uACE0 \uD575\uC2EC\uB9CC). \uD6D1\uC5B4\uBCF4\uAE30\uB9CC \uD574\uB3C4 \uBB34\uC5C7\uC778\uC9C0 \uC54C\uAC8C \u2014 \uB204\uAC00/\uBB34\uC5C7\uC774 \uC5B4\uB5A4 \uC0C1\uD0DC\uC778\uC9C0. \uADFC\uAC70 \uD0DC\uADF8 \uC5C6\uC774.
- detail: 1~3\uBB38\uC7A5. \uC65C \uADF8\uB7F0\uC9C0 \uC785\uB825\uC758 \uC0AC\uC2E4\uACFC \uACC4\uC0B0\uAC12\uC73C\uB85C, \uBB38\uC7A5 \uB05D\uC5D0 \uADFC\uAC70 [E#]. \uAC19\uC740 \uC0AC\uC2E4\uC744 \uC5EC\uB7EC \uD56D\uBAA9\uC5D0 \uBC18\uBCF5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- tag: \uCD9C\uCC98\uB97C \uC9E7\uAC8C(\uC608: "\uC0C1\uC704 \uC694\uCCAD", "\uC720\uAD00\uBD80\uC11C \xB7 \uC601\uC5C5\uD300", "\uD300\uBAA9\uD45C", "\uCEE8\uB514\uC158 \uACF5\uC720", "\uD300\uC7A5 \uBCF8\uC778").
- effect: \uC9E7\uC740 \uD6A8\uACFC\xB7\uC601\uD5A5(\uC120\uD0DD). 4\uBC88 \uB9AC\uC2A4\uD06C\uB294 "\uC81C\uD734 \uBAA9\uD45C \u221218%p", 6\uBC88\uC740 "\uB2EC\uC131\uB960 +12%p \uAE30\uB300"\uCC98\uB7FC. \uC22B\uC790\uB294 \uACC4\uC0B0\uAC12\uC5D0 \uADFC\uAC70.
- goal: \uAD00\uB828 \uBAA9\uD45C G#(\uC5C6\uC73C\uBA74 null).
- actions: \uC774 \uD56D\uBAA9\uC744 \uCC98\uB9AC\uD558\uB824\uACE0 \uD300\uC6D0\uC5D0\uAC8C \uBC14\uB85C \uBCF4\uB0BC \uBA54\uC2DC\uC9C0 0~2\uAC1C. \uD300\uC6D0\uC5D0\uAC8C \uBCF4\uB0BC \uAC8C \uC544\uB2C8\uBA74 \uBE48 \uBC30\uC5F4. \uC774 \uD56D\uBAA9\uC758 title \xB7 detail \uC774 \uB2E4\uB8E8\uB294 \uBC14\uB85C \uADF8 \uC0AC\uB78C \xB7 \uACFC\uC81C \xB7 \uACB0\uACFC\uBB3C\uC5D0 \uB300\uD55C \uC561\uC158\uB9CC \uB123\uC2B5\uB2C8\uB2E4. \uB2E4\uB978 \uC0AC\uB78C\uC774\uB098 \uB2E4\uB978 \uACB0\uACFC\uBB3C\uC5D0 \uBCF4\uB0BC \uC77C\uC774\uBA74 \uADF8 \uC0C1\uD669\uC744 \uB2E4\uB8E8\uB294 \uD56D\uBAA9\uC744 \uB530\uB85C \uB9CC\uB4ED\uB2C8\uB2E4(\uD654\uBA74\uC5D0\uC11C \uD56D\uBAA9 \uC124\uBA85\uC774 \uC561\uC158\uC758 \uADFC\uAC70\uB85C \uD568\uAED8 \uBCF4\uC785\uB2C8\uB2E4).
- todo: \uD300\uC6D0\uC5D0\uAC8C \uBCF4\uB0B4\uC9C0 \uC54A\uACE0 \uD300\uC7A5\uC774 \uC9C1\uC811 \uD560 \uC77C(\uC0C1\uC704 \uBCF4\uACE0\xB7\uC720\uAD00\uBD80\uC11C \uD611\uC758\xB7\uB2F4\uB2F9 \uC870\uC815\xB7\uACB0\uC815\xB7\uB9AC\uBDF0)\uC774 \uC788\uC73C\uBA74 { "text": \uD560 \uC77C \uD55C \uBB38\uC7A5, "why": \uC65C \uC9C0\uAE08 \uD574\uC57C \uD558\uB294\uC9C0 \uD55C \uC904(30\uC790 \uC548\uD30E), "link": goals|work|people|upward|decide|knowhow|none }, \uC5C6\uC73C\uBA74 null.
- \uC561\uC158\uB3C4 \uD560 \uC77C\uB3C4 \uC5C6\uB294 \uD56D\uBAA9(\uC54C\uC544\uB9CC \uB450\uBA74 \uB418\uB294 \uAC83, 7\uBC88 \uAD00\uC810)\uB3C4 \uAD1C\uCC2E\uC2B5\uB2C8\uB2E4.

\uC561\uC158(actions) \uC6D0\uCE59 \u2014 \uD300\uC7A5 \uC774\uB984\uC73C\uB85C \uADF8\uB300\uB85C \uB098\uAC00\uB294 \uBA54\uC2DC\uC9C0\uC785\uB2C8\uB2E4:
- type: praise(\uCE6D\uCC2C \uBC30\uC9C0) \xB7 cheer(\uC9C0\uC6D0\xB7\uACA9\uB824) \xB7 push(\uC5C5\uBB34 \uB3C5\uB824, \uACFC\uC81C \uC9C0\uC815 \uC5C6\uC74C) \xB7 progress(\uC9C4\uCC99 \uACF5\uC720\xB7\uC131\uACFC\uC785\uB825 \uB9AC\uB9C8\uC778\uB4DC, item \uD544\uC218) \xB7 rework(\uBCF4\uC644 \uC694\uCCAD\uD55C \uACB0\uACFC\uBB3C \uB9AC\uB9C8\uC778\uB4DC, submission \uD544\uC218, \uC0C1\uD0DC\uAC00 \uBCF4\uC644 \uC694\uCCAD\uC778 \uAC83\uB9CC) \xB7 thread(\uACB0\uACFC\uBB3C \uC2A4\uB808\uB4DC\uC5D0 \uB0A8\uAE38 \uC9E7\uC740 \uD53C\uB4DC\uBC31, submission \uD544\uC218) \xB7 grow(\uC721\uC131 \uC81C\uC548) \xB7 plan(\uACC4\uD68D\uC744 \uC138\uC6CC \uB2EC\uB77C\uB294 \uC694\uCCAD, item \uC788\uC73C\uBA74 \uC9C0\uC815) \xB7 oo(1on1 \uC81C\uC548) \xB7 memo(\uD300\uC7A5\uB9CC \uBCF4\uB294 \uAD00\uCC30 \uBA54\uBAA8 \u2014 \uD300\uC6D0\uC5D0\uAC8C \uAC00\uC9C0 \uC54A\uC74C).
- member \uB294 \uC785\uB825\uC758 M#. item \uC740 I#, submission \uC740 S#. \uBAA9\uB85D\uC5D0 \uC5C6\uB294 \uB300\uC0C1\uC740 \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- message: \uD300\uC7A5\uC758 \uB9D0\uD22C\uB85C 1~2\uBB38\uC7A5, \uBD80\uB4DC\uB7EC\uC6B4 \uC874\uB313\uB9D0("~\uD574 \uC904\uB798\uC694?", "~\uACE0\uB9C8\uC6CC\uC694"). \uADFC\uAC70 \uD0DC\uADF8\uB97C \uB123\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
  \uAD6C\uCCB4\uC801\uC778 \uC5C5\uBB34 \uC9C0\uC2DC(\uBB34\uC5C7\uC744 \uC5B8\uC81C\uAE4C\uC9C0 \uC5B4\uB5BB\uAC8C)\uB294 \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. "\uC9C4\uCC99\uC774 \uACC4\uD68D\uBCF4\uB2E4 \uB290\uB824 \uBCF4\uC5EC\uC694, \uC0C1\uD669\uC744 \uD55C \uBC88 \uACF5\uC720\uD574 \uC904\uB798\uC694?"\uCC98\uB7FC \uAD00\uCC30\uACFC \uBC29\uD5A5\uB9CC \uC501\uB2C8\uB2E4.
  \uCE6D\uCC2C\uC740 \uBB34\uC5C7\uC744 \uC798\uD588\uB294\uC9C0 \uAD6C\uCCB4\uC801\uC73C\uB85C(\uC785\uB825\uC5D0 \uC788\uB294 \uC0AC\uC2E4\uB85C). memo \uB294 "[\uC798\uD55C \uC810] ..." \uB610\uB294 "[\uC6B0\uB824] ..."\uB85C \uC2DC\uC791\uD558\uB294 \uAD00\uCC30 \uAE30\uB85D.
- why: \uC774 \uC561\uC158\uC774 \uC65C \uD544\uC694\uD55C\uC9C0 \uD55C \uC904(30\uC790 \uC548\uD30E, \uADFC\uAC70 \uD0DC\uADF8 \uC5C6\uC774). \uBC1B\uB294 \uC0AC\uB78C \uBCF8\uC778\uC758 \uC0C1\uD669\uC73C\uB85C \uC501\uB2C8\uB2E4. \uC608: "\uC81C\uC548\uC11C\uAC00 9\uC77C\uC9F8 \uB9C9\uD798 \xB7 \uB9C8\uAC10 11/15". \uD654\uBA74 \uBAA9\uB85D\uC5D0 \uADF8\uB300\uB85C \uBCF4\uC785\uB2C8\uB2E4.
- sensitive: \uBA54\uC2DC\uC9C0\uB098 \uADF8 \uC774\uC720\uAC00 \uAC74\uAC15\xB7\uAC1C\uC778 \uC0AC\uC815\xB7\uC774\uD0C8\xB7\uD3C9\uAC00\xB7\uBCF4\uC0C1\xB7\uAC08\uB4F1\uC5D0 \uB2FF\uC73C\uBA74 \uADF8 \uB0B4\uC6A9\uC744 \uC9E7\uAC8C(\uC608: "\uAC1C\uC778 \uC0AC\uC815 \uC5B8\uAE09"), \uC544\uB2C8\uBA74 \uBE48 \uBB38\uC790\uC5F4.
- \uC804\uCCB4 \uCD5C\uB300 10\uAC1C, \uD55C \uC0AC\uB78C\uC5D0\uAC8C 3\uAC1C\uB97C \uB118\uAE30\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uC0AC\uB78C\uC5D0\uAC8C \uBE44\uC2B7\uD55C \uBA54\uC2DC\uC9C0\uB97C \uB450 \uBC88 \uBCF4\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.

forecast.goals: \uC785\uB825\uC758 G# \uB9C8\uB2E4 { "ref": "G1", "risk_delta": -18, "plan_delta": 12, "note": "\uD55C \uC904" }. risk_delta \uB294 4\uBC88 \uB9AC\uC2A4\uD06C\uAC00 \uD130\uC84C\uC744 \uB54C \uBD84\uAE30 \uB9D0 \uB2EC\uC131\uB960 \uBCC0\uD654(%p, -40~0), plan_delta \uB294 6\uBC88\uC744 \uC2E4\uD589\uD588\uC744 \uB54C(0~+30). \uADFC\uAC70\uAC00 \uC57D\uD558\uBA74 0\uC5D0 \uAC00\uAE5D\uAC8C.
headline: \uC774\uBC88 \uC2E4\uD589\uC758 \uD55C \uBB38\uC7A5 \uC694\uC57D.

\uCD9C\uB825 JSON:
{
  "headline": "...",
  "items": [
    { "q": 1, "also": [2], "level": "high", "title": "...", "detail": "... [E1]", "tag": "...", "effect": "", "goal": null,
      "actions": [{ "type": "push", "member": "M2", "item": null, "submission": null, "message": "...", "why": "...", "sensitive": "" }],
      "todo": { "text": "...", "why": "...", "link": "upward" } }
  ],
  "forecast": { "goals": [{ "ref": "G1", "risk_delta": -10, "plan_delta": 8, "note": "..." }] }
}`;
var clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
var ymdDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
function quarterEnd(today) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const qm = Math.ceil(m / 3) * 3;
  return `${y}-${String(qm).padStart(2, "0")}-${qm === 6 || qm === 9 ? "30" : "31"}`;
}
async function setRun(id, patch) {
  const { error } = await admin.from("autopilot_runs").update(patch).eq("id", id);
  if (error) console.error("autopilot setRun failed", id, error.message);
}
var arr = (v, n) => Array.isArray(v) ? v.slice(0, n) : [];
var str = (v) => typeof v === "string" ? v : v == null ? "" : String(v);
var noTag = (v) => str(v).replace(/\s*\[E\d+(?:\s*,\s*E\d+)*\]/g, "").trim();
var cleanTodo = (t) => t && typeof t === "object" && str(t.text) ? { text: noTag(t.text), why: noTag(t.why).slice(0, 80), link: str(t.link), label: str(t.label) } : null;
var qOf = (v) => {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 7 ? n : 0;
};
async function build(teamId, leaderId, runId) {
  const { data: team } = await admin.from("teams").select("id, name, mission, settings").eq("id", teamId).single();
  const { data: tm } = await admin.from("team_members").select("user_id, role, job_title, weekly_hours, joined_at, profiles(full_name)").eq("team_id", teamId).eq("status", "active");
  const all = (tm ?? []).map((m) => ({ user_id: m.user_id, role: m.role, name: m.profiles?.full_name ?? "" }));
  const members = (tm ?? []).filter((m) => m.role === "member");
  const nameOf = new Map(all.map((m) => [m.user_id, m.name]));
  const today = kstToday();
  const qEnd = quarterEnd(today);
  const minEv = Number(team?.settings?.min_judgment_evidence ?? 8);
  const book = new SourceBook();
  const parts = [];
  const raw = await loadRaw(admin, teamId, leaderId, minEv);
  const { signals, domains } = analyze(raw, all);
  for (const s of signalsFor("weekly", signals).slice(0, 20)) book.add("signal", null, `[${SECTION_NAME[sectionOf(s)]}] ${DOMAIN_META[s.domain].name} \xB7 ${TYPE_LABEL[s.type]}`, `${s.title}${s.detail ? ` \u2014 ${s.detail}` : ""}`);
  parts.push(`## \uC601\uC5ED\uBCC4 \uC0C1\uD0DC (\uACC4\uC0B0\uAC12)
${domains.map((d) => `${DOMAIN_META[d.domain].name}: ${d.status}, ${d.kpiLabel} ${d.kpi}`).join("\n")}`);
  await setRun(runId, { step: 1 });
  const [{ data: items }, { data: ck }, { data: oos }, { data: praises }, { data: attnRows }] = await Promise.all([
    admin.from("work_items").select("id, owner_id, parent_id, title, status, progress, start_date, due_date, base_start, base_due, created_at, est_hours_per_week, contribution, replan_count").eq("team_id", teamId).not("status", "in", "(dropped,proposed)"),
    admin.from("checkins").select("user_id, week_start, condition, moods").eq("team_id", teamId).gte("week_start", addDaysYmd(today, -35)).order("week_start"),
    admin.from("one_on_ones").select("member_id, scheduled_at, status").eq("team_id", teamId).gte("scheduled_at", since(90)).order("scheduled_at", { ascending: false }),
    admin.from("observations").select("subject_id, occurred_at").eq("team_id", teamId).eq("kind", "praise").gte("occurred_at", addDaysYmd(today, -90)),
    admin.rpc("leader_attention", { p_team: teamId, p_days: 28 })
  ]);
  const attn = new Map((attnRows ?? []).map((r) => [r.user_id, r]));
  const mRef = /* @__PURE__ */ new Map();
  const mId = /* @__PURE__ */ new Map();
  const mLines = members.map((m, i) => {
    const ref = `M${i + 1}`;
    mRef.set(m.user_id, ref);
    mId.set(ref, m.user_id);
    const mine = (items ?? []).filter((x) => x.owner_id === m.user_id && x.status !== "done");
    const hours = mine.reduce((a2, x) => a2 + Number(x.est_hours_per_week ?? 0), 0);
    const conds = (ck ?? []).filter((c) => c.user_id === m.user_id && c.condition != null).map((c) => c.condition);
    const moods = (ck ?? []).filter((c) => c.user_id === m.user_id).slice(-1)[0]?.moods ?? [];
    const lastOo = (oos ?? []).find((o) => o.member_id === m.user_id && o.status !== "canceled");
    const lastPraise = (praises ?? []).filter((p) => p.subject_id === m.user_id).map((p) => p.occurred_at).sort().slice(-1)[0];
    const a = attn.get(m.user_id);
    return `${ref} ${nameOf.get(m.user_id)} (${m.job_title || "-"}, \uC785\uC0AC ${Math.floor((Date.now() - Date.parse(m.joined_at)) / DAY)}\uC77C): \uC9C4\uD589 ${mine.length}\uAC74 \xB7 \uB9C9\uD798 ${mine.filter((x) => x.status === "blocked").length} \xB7 \uBD80\uD558 \uC8FC ${hours}h/${m.weekly_hours}h(${m.weekly_hours ? Math.round(hours / m.weekly_hours * 100) : "-"}%) \xB7 \uCEE8\uB514\uC158(5\uC810) ${conds.length ? conds.join("\u2192") : "\uACF5\uC720 \uC5C6\uC74C"}${moods.length ? ` \xB7 \uCD5C\uADFC \uACE0\uB978 \uC694\uC778 ${moods.join(", ")}` : ""} \xB7 \uB9C8\uC9C0\uB9C9 1on1 ${lastOo ? `${Math.floor((Date.now() - Date.parse(lastOo.scheduled_at)) / DAY)}\uC77C \uC804` : "90\uC77C \uB0B4 \uC5C6\uC74C"} \xB7 \uB9C8\uC9C0\uB9C9 \uCE6D\uCC2C ${lastPraise ? `${Math.max(0, ymdDiff(today, String(lastPraise).slice(0, 10)))}\uC77C \uC804` : "90\uC77C \uB0B4 \uC5C6\uC74C"}` + (a ? ` \xB7 \uD300\uC7A5 \uC811\uC810 28\uC77C ${a.touch} \xB7 \uBC18\uC751 \uB300\uAE30 ${a.waiting}` : "");
  });
  book.add("members", null, "\uD300\uC6D0 \uD604\uD669 (M#)", mLines.join(" | "));
  const yr = today.slice(0, 4);
  const roots = (items ?? []).filter((x) => !x.parent_id && x.status !== "done" && String(x.start_date ?? x.base_start ?? x.due_date ?? x.created_at).slice(0, 4) === yr);
  const gRef = /* @__PURE__ */ new Map();
  const gId = /* @__PURE__ */ new Map();
  const outlook = new Map((raw.goals ?? []).map((g) => [g.goal_id, g]));
  const goals = roots.slice(0, 6).map((g, i) => {
    const ref = `G${i + 1}`;
    gRef.set(g.id, ref);
    gId.set(ref, g.id);
    const start = String(g.start_date ?? g.base_start ?? g.created_at).slice(0, 10);
    const due = g.due_date ? String(g.due_date) : null;
    const elapsed = Math.max(7, ymdDiff(today, start));
    const left = Math.max(0, ymdDiff(qEnd, today));
    const p = Number(g.progress ?? 0);
    const base = clamp(p + p / elapsed * left);
    const planNow = due ? clamp((Date.parse(today) - Date.parse(start)) / Math.max(DAY, Date.parse(due) - Date.parse(start)) * 100) : null;
    const planQ = due ? clamp((Date.parse(qEnd) - Date.parse(start)) / Math.max(DAY, Date.parse(due) - Date.parse(start)) * 100) : null;
    const o = outlook.get(g.id);
    return { ref, id: g.id, title: g.title, progress: p, planNow, planQ, base, due, probability: o?.probability ?? null, blocked: o?.blocked ?? 0 };
  });
  parts.push(`## \uBAA9\uD45C (G#) \u2014 \uBD84\uAE30 \uB9D0(${qEnd}) \uC608\uC0C1 (\uACC4\uC0B0\uAC12: \uC9C0\uAE08\uAE4C\uC9C0\uC758 \uC9C4\uCC99 \uC18D\uB3C4\uB97C \uB0A8\uC740 \uAE30\uAC04\uC5D0 \uADF8\uB300\uB85C \uC801\uC6A9)
${goals.map((g) => `${g.ref} ${g.title}: \uD604\uC7AC ${g.progress}%${g.planNow != null ? ` \xB7 \uACC4\uD68D\uC0C1 \uC624\uB298 ${g.planNow}%` : ""} \xB7 \uC9C0\uAE08 \uC18D\uB3C4\uBA74 \uBD84\uAE30 \uB9D0 ${g.base}%${g.planQ != null ? ` (\uACC4\uD68D\uC0C1 \uBD84\uAE30 \uB9D0 ${g.planQ}%)` : ""}${g.due ? ` \xB7 \uB9C8\uAC10 ${g.due}` : ""}${g.probability != null ? ` \xB7 \uB2EC\uC131 \uAC00\uB2A5\uC131 \uBAA8\uB378 ${g.probability}%` : ""} \xB7 \uB9C9\uD798 ${g.blocked}`).join("\n") || "(\uC9C4\uD589 \uC911\uC778 \uC62C\uD574 \uBAA9\uD45C \uC5C6\uC74C)"}`);
  const iRef = /* @__PURE__ */ new Map();
  const iId = /* @__PURE__ */ new Map();
  const kids = (items ?? []).filter((x) => x.parent_id && x.status !== "done").sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999"))).slice(0, 40);
  parts.push(`## \uACFC\uC81C (I#)
${kids.map((x, i) => {
    const ref = `I${i + 1}`;
    iRef.set(x.id, ref);
    iId.set(ref, x.id);
    const goal = gRef.get(x.parent_id) ?? "";
    return `${ref} ${x.title}${goal ? ` (${goal})` : ""} \xB7 \uB2F4\uB2F9 ${mRef.get(x.owner_id ?? "") ?? (x.owner_id === leaderId ? "\uD300\uC7A5" : "\uC5C6\uC74C")} \xB7 ${x.status} \xB7 \uC9C4\uCC99 ${x.progress}%${x.due_date ? ` \xB7 \uB9C8\uAC10 ${x.due_date}` : ""}${x.est_hours_per_week ? ` \xB7 \uC8FC ${x.est_hours_per_week}h` : ""} \xB7 \uAE30\uC5EC\uB3C4 ${x.contribution}/5${x.replan_count ? ` \xB7 \uC7AC\uACC4\uD68D ${x.replan_count}\uD68C` : ""}`;
  }).join("\n") || "(\uC5C6\uC74C)"}`);
  const { data: subs } = await admin.from("submissions").select("id, author_id, title, status, request_type, updated_at, closed_at").eq("team_id", teamId).is("closed_at", null).in("status", ["in_review", "needs_work"]).order("updated_at").limit(15);
  const sRef = /* @__PURE__ */ new Map();
  const sId = /* @__PURE__ */ new Map();
  parts.push(`## \uC5F4\uB9B0 \uACB0\uACFC\uBB3C (S#)
${(subs ?? []).map((s, i) => {
    const ref = `S${i + 1}`;
    sRef.set(s.id, ref);
    sId.set(ref, s.id);
    return `${ref} ${s.title} \xB7 ${mRef.get(s.author_id) ?? nameOf.get(s.author_id) ?? "-"} \xB7 ${s.status === "needs_work" ? "\uBCF4\uC644 \uC694\uCCAD" : "\uB9AC\uBDF0 \uB300\uAE30"} ${Math.floor((Date.now() - Date.parse(s.updated_at)) / DAY)}\uC77C\uC9F8`;
  }).join("\n") || "(\uC5C6\uC74C)"}`);
  const { data: revs } = await admin.from("ai_outputs").select("id, ref_id, content").eq("team_id", teamId).eq("kind", "review").gte("created_at", since(30)).order("created_at", { ascending: false }).limit(12);
  for (const r of revs ?? []) {
    const c = r.content;
    const s = (subs ?? []).find((x) => x.id === r.ref_id);
    if (c.summary || c.headline) book.add("review", r.id, `\uACB0\uACFC\uBB3C 1\uCC28 \uAC80\uD1A0${s ? ` \xB7 ${sRef.get(s.id)}` : ""}`, `${c.headline ?? ""} ${c.summary ?? ""}`.replace(/\s*\[E\d+\]/g, "").slice(0, 300));
  }
  await setRun(runId, { step: 2 });
  const [{ data: notes }, { data: board }, { data: waitSubs }, { data: openReq }] = await Promise.all([
    // 위에서 온 것은 '아직 열려 있으면' 오래돼도 현안 — 기간으로 자르지 않고 며칠째인지 붙인다
    admin.from("org_notes").select("id, kind, title, body, source, event_date, created_at").eq("team_id", teamId).eq("status", "open").order("created_at", { ascending: false }).limit(12),
    admin.from("decision_board").select("title, stage, updated_at").eq("team_id", teamId).in("stage", ["reviewing", "promoted"]),
    admin.from("submissions").select("id, updated_at").eq("team_id", teamId).eq("status", "in_review").is("closed_at", null),
    admin.from("team_requests").select("id, created_at").eq("team_id", teamId).eq("to_id", leaderId).eq("status", "open")
  ]);
  const KIND2 = { strategy: "\uC804\uC0AC \uBC29\uCE68", exec: "\uC784\uC6D0 \uAD00\uC2EC\uC0AC", request: "\uC0C1\uC704 \uC694\uCCAD", peer: "\uC720\uAD00\uBD80\uC11C", calendar: "\uC804\uC0AC \uC77C\uC815", other: "\uAE30\uD0C0" };
  for (const n2 of notes ?? []) book.add("org_note", n2.id, `${KIND2[n2.kind] ?? "\uC704\uC5D0\uC11C \uC628 \uAC83"} \xB7 ${n2.title}`, `${n2.body ?? ""}${n2.source ? ` (\uCD9C\uCC98 ${n2.source})` : ""}${n2.event_date ? ` \xB7 \uC77C\uC815 ${n2.event_date} (D-${ymdDiff(n2.event_date, today)})` : ""} \xB7 \uB4F1\uB85D ${Math.max(0, ymdDiff(today, String(n2.created_at).slice(0, 10)))}\uC77C\uC9F8 \uC5F4\uB824 \uC788\uC74C`.slice(0, 400));
  const in14 = addDaysYmd(today, 14);
  const { data: dueDec } = await admin.from("decisions").select("title, review_on").eq("team_id", teamId).is("outcome", null).gte("review_on", today).lte("review_on", in14).limit(6);
  const soon = [
    ...(items ?? []).filter((x) => x.status !== "done" && x.due_date && String(x.due_date) >= addDaysYmd(today, -7) && String(x.due_date) <= in14).map((x) => ({ d: String(x.due_date), t: `${iRef.get(x.id) ?? gRef.get(x.id) ?? ""} ${x.title} \uB9C8\uAC10 \xB7 \uC9C4\uCC99 ${x.progress}% \xB7 \uB2F4\uB2F9 ${mRef.get(x.owner_id ?? "") ?? (x.owner_id === leaderId ? "\uD300\uC7A5" : "-")}${String(x.due_date) < today ? " (\uC774\uBBF8 \uC9C0\uB0A8)" : ""}` })),
    ...(notes ?? []).filter((n2) => n2.event_date && n2.event_date >= today && n2.event_date <= in14).map((n2) => ({ d: n2.event_date, t: `${KIND2[n2.kind] ?? "\uC704\uC5D0\uC11C \uC628 \uAC83"} \xB7 ${n2.title}` })),
    ...(dueDec ?? []).map((d) => ({ d: String(d.review_on), t: `\uACB0\uC815 \uB2E4\uC2DC \uBCF4\uAE30 \xB7 ${d.title}` }))
  ].sort((a, b) => a.d.localeCompare(b.d)).slice(0, 15);
  parts.push(`## \uC55E\uC73C\uB85C 2\uC8FC (${today} ~ ${in14}) \u2014 \uB9C8\uAC10 \xB7 \uC77C\uC815
${soon.map((x) => `${x.d} (D${ymdDiff(x.d, today) >= 0 ? "-" : "+"}${Math.abs(ymdDiff(x.d, today))}) ${x.t.trim()}`).join("\n") || "(\uC5C6\uC74C)"}`);
  if (board?.length) book.add("decision_board", null, "\uC758\uC0AC\uACB0\uC815 \uBCF4\uB4DC \xB7 \uAC80\uD1A0 \uC911", board.map((b) => `${b.title} (${Math.floor((Date.now() - Date.parse(b.updated_at)) / DAY)}\uC77C\uC9F8)`).join(" / "));
  const oldest = (waitSubs ?? []).map((s) => Math.floor((Date.now() - Date.parse(s.updated_at)) / DAY)).sort((a, b) => b - a)[0];
  book.add("leader", null, "\uD300\uC7A5 \uBCF8\uC778 \uB300\uAE30", `\uB9AC\uBDF0 \uB300\uAE30 ${waitSubs?.length ?? 0}\uAC74${oldest != null ? ` (\uAC00\uC7A5 \uC624\uB798 ${oldest}\uC77C)` : ""} \xB7 \uD300\uC7A5\uC774 \uB2F5\uD560 \uC694\uCCAD ${openReq?.length ?? 0}\uAC74 \xB7 \uAC80\uD1A0 \uC911 \uACB0\uC815 ${board?.length ?? 0}\uAC74`);
  if (raw.goals?.length) book.add("goals", null, "\uBAA9\uD45C \uC9C4\uCC99 \xB7 \uB2EC\uC131 \uAC00\uB2A5\uC131(\uBAA8\uB378)", raw.goals.slice(0, 6).map((g) => `${g.title} \uC9C4\uCC99 ${g.progress}% \xB7 \uB2EC\uC131 \uAC00\uB2A5\uC131 ${g.probability ?? "-"}% \xB7 \uB9C9\uD798 ${g.blocked}`).join(" / "));
  await addLeaderNotes(book, teamId, leaderId, { limit: 10, nameOf: (n2) => n2.anchor_type === "member" && n2.anchor_id ? nameOf.get(n2.anchor_id) : void 0 });
  const { data: sbt } = await admin.rpc("simbox_trends", { p_team: teamId, p_days: 30 });
  const sb = sbt;
  const SB = { evidence: "\uADFC\uAC70\xB7\uC22B\uC790", structure: "\uAD6C\uC870\xB7\uACB0\uB860 \uC704\uCE58", clarity: "\uBB38\uC7A5\xB7\uC804\uB2EC\uB825", priority: "\uC6B0\uC120\uC21C\uC704\xB7\uBC29\uD5A5 \uD655\uC778", reporting: "\uBCF4\uACE0 \uBC29\uBC95\xB7\uD0C0\uC774\uBC0D", stakeholder: "\uC720\uAD00\uBD80\uC11C\xB7\uB300\uC678 \uC18C\uD1B5", planning: "\uC77C\uC815\xB7\uACC4\uD68D", idea: "\uC544\uC774\uB514\uC5B4 \uAD6C\uC0C1", data: "\uB370\uC774\uD130 \uBD84\uC11D" };
  if (sb?.available && sb.rows?.length) book.add("simbox_trend", null, "\uD300\uC6D0\uB4E4\uC774 Sim.Box\uC5D0\uC11C \uB9CE\uC774 \uB2E4\uB4EC\uB294 \uAC83 (\uD300 \uC804\uCCB4 \uD569\uACC4 \xB7 \uAC1C\uC778 \uAD6C\uBD84 \uC5C6\uC74C)", sb.rows.map((r) => `${SB[r.category] ?? r.category} ${r.share}%`).join(" \xB7 "));
  await addKnowhow(book, teamId, "briefing", 1800);
  await setRun(runId, { step: 3 });
  const itemBudget = Math.max(12, MAX_LINES - goals.length);
  const head = [
    `\uC624\uB298: ${today} \xB7 \uC774\uBC88 \uBD84\uAE30 \uB9D0 ${qEnd} (\uB0A8\uC740 ${ymdDiff(qEnd, today)}\uC77C) / \uD300: ${team?.name} / \uBBF8\uC158: ${team?.mission || "-"} / \uD300\uC6D0 ${members.length}\uBA85`,
    `\uBAA9\uB85D \uD55C\uB3C4: \uB2F9\uC2E0\uC774 \uC4F0\uB294 \uC904\uC740 \uCD5C\uB300 ${itemBudget}\uC904 (\uBAA9\uD45C \uC804\uB9DD ${goals.length}\uC904\uC740 \uC2DC\uC2A4\uD15C\uC774 \uB530\uB85C \uBD99\uC784 \xB7 \uC804\uCCB4 ${MAX_LINES}\uC904)`,
    `## \uD300\uC6D0 (M#)
${mLines.join("\n")}`,
    ...parts
  ].join("\n\n");
  const facts = book.text("\uC0AC\uC2E4\uACFC \uAE30\uB85D");
  const kh = book.knowhowText();
  const compose = (budget) => {
    const h = head.slice(0, Math.floor(budget * 0.55));
    const left = budget - h.length;
    const f = facts.length > left * 0.75 ? `${facts.slice(0, Math.floor(left * 0.75))}
(\uAE30\uB85D\uC774 \uB9CE\uC544 \uC77C\uBD80\uB9CC \uC2E4\uC5C8\uC2B5\uB2C8\uB2E4)` : facts;
    const k = kh.slice(0, Math.max(0, left - f.length));
    return [h, k, f].filter(Boolean).join("\n\n");
  };
  const t0 = Date.now();
  const call = (compact) => runAi({
    teamId,
    kind: "autopilot",
    model: MODEL_SMART,
    system: AUTOPILOT + NOTE_RULE + (compact ? "\n\n[\uAC04\uACB0 \uBAA8\uB4DC] \uBAA9\uB85D\uC740 12\uC904 \uC774\uB0B4, detail \uC740 \uD55C \uBB38\uC7A5, \uC561\uC158\uC740 \uC804\uCCB4 6\uAC1C \uC774\uB0B4\uB85C \uC9E7\uAC8C \uC501\uB2C8\uB2E4." : ""),
    content: [{ type: "text", text: compose(compact ? 24e3 : 6e4) }],
    book,
    depth: depthOf(book.size, [6, 12, 20]),
    level: "L3",
    createdBy: leaderId,
    credits: 0,
    // 먼저 생각하지 않고 바로 JSON 을 쓴다 — 기본(생각 후 답)은 입력이 큰 팀에서 출력 한도를 생각에 다 써서 빈 응답이 났다
    thinking: "fast",
    effort: compact ? "low" : "medium",
    maxTokens: compact ? 5e3 : 9e3,
    timeoutMs: compact ? 12e4 : 18e4,
    force: true
  });
  let res;
  try {
    res = await call(false);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : "";
    if (["AI_RATE_HOUR", "AI_RATE_DAY", "AI_COST_CAP", "AI_LOCKED", "CORE_LIMIT", "AI_NOT_CONFIGURED"].includes(code) || Date.now() - t0 > 25e4) throw e;
    console.warn("autopilot retry compact", e instanceof Error ? e.message : e);
    await setRun(runId, { step: 4 });
    res = await call(true);
  }
  const { output, parsed } = res;
  await setRun(runId, { step: 7 });
  const actions = [];
  const perMember = /* @__PURE__ */ new Map();
  let n = 0;
  const fixActs = (q, list2) => arr(list2, 2).filter((a) => a && typeof a === "object").flatMap((a) => {
    const type = a.type;
    if (!ACTION_TYPES.includes(type)) return [];
    const member = mId.get(String(a.member ?? ""));
    if (!member) return [];
    const item = a.item ? iId.get(a.item) ?? gId.get(a.item) ?? null : null;
    const submission = a.submission ? sId.get(a.submission) ?? null : null;
    if (type === "progress" && !item) return [];
    if ((type === "thread" || type === "rework") && !submission) return [];
    if (type === "rework" && (subs ?? []).find((s) => s.id === submission)?.status !== "needs_work") return [];
    const message = String(a.message ?? "").replace(/\s*\[E\d+(?:\s*,\s*E\d+)*\]/g, "").trim().slice(0, 500);
    if (!message) return [];
    const c = (perMember.get(member) ?? 0) + 1;
    if (c > 3 || actions.length >= 10) return [];
    perMember.set(member, c);
    const sensitive = String(a.sensitive ?? "").trim() || (SENSITIVE.test(message) ? "\uBBFC\uAC10 \uB0B4\uC6A9" : "");
    const key = `a${++n}`;
    const act = {
      key,
      section: `q${q}`,
      type,
      member_id: member,
      item_id: item,
      submission_id: submission,
      message,
      sensitive,
      why: noTag(a.why).slice(0, 80),
      item_title: item ? (items ?? []).find((x) => x.id === item)?.title ?? null : null,
      submission_title: submission ? (subs ?? []).find((s) => s.id === submission)?.title ?? null : null
    };
    actions.push(act);
    return [key];
  });
  const LV = { high: 0, mid: 1, low: 2 };
  const list = arr(parsed.items, 24).filter((x) => x && typeof x === "object" && qOf(x.q) && str(x.title).trim()).map((x, i) => ({ x, i, q: qOf(x.q), lv: x.level === "high" || x.level === "low" ? x.level : "mid" })).sort((a, b) => a.q - b.q || LV[a.lv] - LV[b.lv] || a.i - b.i).map(({ x, q, lv }, i) => ({
    id: `i${i + 1}`,
    q,
    also: arr(x.also, 2).map(qOf).filter((v) => v && v !== q),
    level: lv,
    title: str(x.title).replace(/\s*\[E\d+(?:\s*,\s*E\d+)*\]/g, "").trim().slice(0, 120),
    detail: str(x.detail),
    tag: str(x.tag),
    effect: str(x.effect),
    goal_id: x.goal ? gId.get(str(x.goal)) ?? null : null,
    action_keys: fixActs(q, x.actions),
    todo: cleanTodo(x.todo)
  }));
  const lines = (x) => Math.max(1, x.action_keys.length + (x.todo ? 1 : 0));
  let total = list.reduce((n2, x) => n2 + lines(x), 0);
  while (total > itemBudget + 2) {
    let at = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i];
      if (x.level === "high" || x.q === 7 && list.filter((y) => y.q === 7).length === 1) continue;
      if (at < 0 || LV[x.level] > LV[list[at].level]) at = i;
    }
    if (at < 0) break;
    const [cut] = list.splice(at, 1);
    total -= lines(cut);
    for (const k of cut.action_keys) {
      const j = actions.findIndex((a) => a.key === k);
      if (j >= 0) actions.splice(j, 1);
    }
  }
  const fg = new Map(arr(parsed.forecast?.goals, 12).filter((g) => g && typeof g === "object").map((g) => [str(g.ref), g]));
  const forecast = {
    quarter_end: qEnd,
    goals: goals.map((g) => {
      const f = fg.get(g.ref);
      const rd = Math.max(-40, Math.min(0, Number(f?.risk_delta ?? 0)));
      const pd = Math.max(0, Math.min(30, Number(f?.plan_delta ?? 0)));
      return { goal_id: g.id, title: g.title, progress: g.progress, plan_now: g.planNow, plan_q: g.planQ, base: g.base, risk: clamp(g.base + (Number.isFinite(rd) ? rd : 0)), exec: clamp(g.base + (Number.isFinite(pd) ? pd : 0)), note: str(f?.note) };
    })
  };
  const result = {
    v: 2,
    headline: str(parsed.headline),
    items: list,
    forecast,
    actions,
    sources: output.sources ?? [],
    counts: { signals: signals.length, members: members.length }
  };
  return { result, aiOutputId: output.id };
}
serve(async (req) => {
  const body = await readJson(req);
  if (!body.team_id) throw new HttpError(400, "MISSING_TEAM");
  const caller = await getCaller(req);
  if (caller.isService || !caller.userId) throw new HttpError(403, "forbidden", "\uD300\uC7A5\uC774 \uC9C1\uC811 \uC2E4\uD589\uD569\uB2C8\uB2E4");
  await assertLeader(caller, body.team_id);
  const teamId = body.team_id;
  const { count: mc } = await admin.from("team_members").select("user_id", { count: "exact", head: true }).eq("team_id", teamId).eq("status", "active").eq("role", "member");
  if (!mc) throw new HttpError(422, "NO_MEMBERS", "\uD300\uC6D0\uC744 \uCD08\uB300\uD558\uBA74 AUTOPILOT\uC744 \uC4F8 \uC218 \uC788\uC2B5\uB2C8\uB2E4");
  const { data: team } = await admin.from("teams").select("settings").eq("id", teamId).single();
  const ap = team?.settings?.autopilot ?? {};
  const mode = ap.mode === "auto" || ap.mode === "semi" ? ap.mode : "direct";
  const allow = { ...SEMI_DEFAULT, ...ap.allow ?? {} };
  const { data: st, error } = await admin.rpc("autopilot_start", { p_team: teamId, p_leader: caller.userId, p_mode: mode, p_allow: allow });
  if (error) {
    if (/AUTOPILOT_LIMIT/.test(error.message)) throw new HttpError(429, "AUTOPILOT_LIMIT", /trial/.test(`${error.hint ?? ""}`) ? "\uCCB4\uD5D8 \uAE30\uAC04\uC5D0\uB294 AUTOPILOT\uC744 1\uBC88 \uC2E4\uD589\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4" : "\uC774\uBC88 \uB2EC AUTOPILOT \uC2E4\uD589 \uD69F\uC218\uB97C \uBAA8\uB450 \uC37C\uC2B5\uB2C8\uB2E4");
    throw error;
  }
  const run = { id: st.run_id };
  if (st.existing) return json({ run_id: run.id, status: "running" });
  const work = async () => {
    try {
      const { result, aiOutputId } = await build(teamId, caller.userId, run.id);
      await setRun(run.id, { output: result, ai_output_id: aiOutputId, step: 8 });
      if (mode !== "direct") {
        const sent = /* @__PURE__ */ new Map();
        for (const a of result.actions) {
          if (a.sensitive) continue;
          if (mode === "semi" && !allow[a.type]) continue;
          const c = sent.get(a.member_id) ?? 0;
          if (a.type !== "memo" && c >= AUTO_CAP_PER_MEMBER) continue;
          const { error: sErr } = await admin.rpc("autopilot_send", { p_run: run.id, p_key: a.key, p_body: null, p_auto: true });
          if (sErr) {
            console.error("autopilot auto send failed", a.key, sErr.message);
            continue;
          }
          if (a.type !== "memo") sent.set(a.member_id, c + 1);
        }
      }
      await setRun(run.id, { status: "done", finished_at: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (e) {
      console.error("autopilot failed", e);
      const msg = e instanceof HttpError ? e.message : e instanceof Error ? e.message : String(e);
      await setRun(run.id, { status: "failed", error: String(msg).slice(0, 300), finished_at: (/* @__PURE__ */ new Date()).toISOString() });
    }
  };
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work());
  else await work();
  return json({ run_id: run.id, status: "running" });
});
export {
  ACTION_TYPES
};
