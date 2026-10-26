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
var weekLabel = (d) => {
  const dt = new Date(d);
  const onejan = new Date(dt.getFullYear(), 0, 1);
  const w = Math.ceil(((dt.getTime() - onejan.getTime()) / 864e5 + onejan.getDay() + 1) / 7);
  return `W${String(w).padStart(2, "0")}`;
};

// functions/_shared/prompts/index.ts
var PEOPLE_ACTIONS = `\uACFC\uC81C: \uD300\uC7A5\uC774 \uC774\uBC88 \uC8FC\uC5D0 \uD300\uC6D0 \uD55C \uC0AC\uB78C \uD55C \uC0AC\uB78C\uC5D0\uAC8C \uD560 '\uAD00\uB9AC \uD589\uB3D9'\uC744 \uCD94\uCC9C\uD558\uACE0, \uD300\uC6D0\uBCC4 \uC5C5\uBB34 \uC218\uD589 \uACBD\uACFC\uB97C \uC9E7\uAC8C \uD310\uB2E8\uD569\uB2C8\uB2E4.
\uC785\uB825\uC740 \uD300\uC6D0\uBCC4\uB85C \uC815\uB9AC\uB41C \uC0AC\uC2E4(\uCEE8\uB514\uC158 \uCD94\uC774, 1on1 \uAC04\uACA9, \uAD00\uCC30 \uAE30\uB85D, \uACB0\uACFC\uBB3C \uD310\uB2E8 \uAE4A\uC774, \uB9E1\uC740 \uC77C\uC758 \uC9C4\uCC99\xB7\uACC4\uD68D \uB300\uBE44\xB7\uB9C9\uD798, \uC694\uCCAD \uCC98\uB9AC, \uCEE8\uB514\uC158 \uACF5\uC720\uC758 \uC601\uD5A5 \uC694\uC778)\uC785\uB2C8\uB2E4.

\uC774 \uCD94\uCC9C\uC740 '\uC0AC\uB78C \uAD00\uB9AC'\uC785\uB2C8\uB2E4. \uAC1C\uBCC4 \uC5C5\uBB34\xB7\uACB0\uACFC\uBB3C\xB7\uACFC\uC81C\uC758 \uB0B4\uC6A9\uC740 \uB2E4\uB8E8\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- \uD558\uC9C0 \uC54A\uB294 \uAC83: \uD2B9\uC815 \uACB0\uACFC\uBB3C\uC758 \uC218\uC815 \uC9C0\uC2DC, \uC2B9\uC778 \uC870\uAC74, \uBAA9\uD45C\uCE58\xB7\uBC94\uC704\xB7\uC77C\uC815 \uC870\uC815, \uD2B9\uC815 \uACFC\uC81C\uC758 \uD574\uACB0 \uBC29\uBC95, \uC5C5\uBB34 \uC7AC\uBC30\uBD84 (\uC774\uAC83\uB4E4\uC740 \uC5C5\uBB34\uD50C\uB7AB\uD3FC\xB7\uD300\uBAA9\uD45C\xB7\uC758\uC0AC\uACB0\uC815\uC5D0\uC11C \uB2E4\uB8F9\uB2C8\uB2E4)
- \uD558\uB294 \uAC83: \uAD00\uACC4(1on1), \uC778\uC815(\uCE6D\uCC2C), \uAE30\uB85D(\uAD00\uCC30), \uC131\uC7A5(\uC5ED\uD560\xB7\uAE30\uD68C), \uC5C5\uBB34 \uC804\uBC18\uC758 \uD398\uC774\uC2A4\uC640 \uB9AC\uB4EC(\uB3C5\uB824), \uC9C0\uCCD0 \uC788\uAC70\uB098 \uB9C9\uD78C \uC0AC\uB78C \uCC59\uAE30\uAE30(\uC9C0\uC6D0)
- \uC81C\uBAA9\xB7\uBA85\uBD84\xB7\uBB38\uAD6C\uC5D0 \uACFC\uC81C\uBA85\uC774\uB098 \uACB0\uACFC\uBB3C \uC81C\uBAA9\uC744 \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. "\uCD5C\uADFC \uACB0\uACFC\uBB3C \uC218\uC900", "\uB9E1\uC740 \uC77C \uC804\uBC18\uC758 \uC9C4\uCC99", "\uAC19\uC740 \uB9C9\uD798\uC774 \uBC18\uBCF5" \uCC98\uB7FC \uC0AC\uB78C \uC218\uC900\uC73C\uB85C \uC501\uB2C8\uB2E4.

\uD589\uB3D9 \uC885\uB958(type):
  one_on_one  1on1 \uBA74\uB2F4 \u2014 \uCEE8\uB514\uC158 \uD558\uB77D, 1on1 \uACF5\uBC31, \uBC18\uBCF5 \uB9C9\uD798, \uC9C4\uB85C\xB7\uB3D9\uAE30 \uC2E0\uD638
  praise      \uCE6D\uCC2C \uBC30\uC9C0 \u2014 \uC5C5\uBB34 \uC804\uBC18\uC5D0\uC11C \uBCF4\uC778 \uD0DC\uB3C4\xB7\uAFB8\uC900\uD568\xB7\uC131\uC7A5 (\uD2B9\uC815 \uC0B0\uCD9C\uBB3C \uCE6D\uCC2C\uC774 \uC544\uB2C8\uB77C \uADF8 \uC0AC\uB78C\uC758 \uC77C\uD558\uB294 \uBC29\uC2DD\uC744 \uC778\uC815)
  observe     \uAD00\uCC30 \uAE30\uB85D \uB0A8\uAE30\uAE30 \u2014 \uD3C9\uAC00 \uADFC\uAC70\uAC00 \uBD80\uC871\uD558\uAC70\uB098 \uCD5C\uADFC \uAD00\uCC30\uC774 \uC5C6\uB294 \uC0AC\uB78C
  develop     \uC721\uC131 \u2014 \uB354 \uD070 \uC5ED\uD560\xB7\uAE30\uD68C \uC81C\uC548, \uC131\uC7A5 \uB300\uD654 (\uD310\uB2E8 \uAE4A\uC774\uAC00 \uAFB8\uC900\uD788 \uC624\uB984, \uAC19\uC740 \uBCF4\uC644\uC810\uC774 \uBC18\uBCF5)
  push        \uC5C5\uBB34 \uB3C5\uB824 \u2014 \uC5C5\uBB34 \uC804\uBC18\uC758 \uC9C4\uCC99\uC774 \uB354\uB514\uAC70\uB098 \uACF5\uC720\uAC00 \uB738\uD560 \uB54C, \uD398\uC774\uC2A4\xB7\uB9AC\uB4EC\uC744 \uD568\uAED8 \uC810\uAC80 (\uC555\uBC15\uC774 \uC544\uB2C8\uB77C \uC9C4\uCC99 \uACF5\uC720\uC640 \uB3C4\uC6C0 \uC81C\uC548 \uD1A4)
  support     \uC9C0\uC6D0\xB7\uACA9\uB824 \u2014 \uB9C9\uD798\uC774 \uBC18\uBCF5\uB3FC \uC9C0\uCCD0 \uC788\uC744 \uC218 \uC788\uB294 \uC0AC\uB78C\uC5D0\uAC8C \uB4E4\uC5B4 \uC8FC\uACE0 \uB3C4\uC6B8 \uC758\uC0AC\uB97C \uC804\uD568 (\uAD6C\uCCB4 \uD574\uACB0\uCC45 \uC81C\uC2DC X)

\uC120\uD589 \uC2E0\uD638 \u2192 \uD589\uB3D9 (\uC785\uB825\uC758 '\uC120\uD589 \uC2E0\uD638'\uAC00 \uC788\uC73C\uBA74 \uC774 \uAE30\uC900\uC73C\uB85C \uACE0\uB985\uB2C8\uB2E4. \uC774\uD0C8 \uC778\uD130\uBDF0\uC5D0\uC11C \uBC18\uBCF5\uB418\uB294 \uB3D9\uC778\uC785\uB2C8\uB2E4):
  \uC778\uC815 \uACF5\uBC31(\uB9C8\uCE5C \uC77C\uC774 \uC788\uB294\uB370 \uC778\uC815 \uAE30\uB85D \uC5C6\uC74C)        \u2192 praise
  \uC758\uC9C0\uB294 \uC788\uB294\uB370 \uB9C9\uD798(\uCEE8\uB514\uC158\uC740 \uAD1C\uCC2E\uC740\uB370 \uB9C9\uD798\xB7\uB300\uAE30)   \u2192 support \u2014 \uC774 \uC0AC\uB78C\uC5D0\uAC8C push \uB294 \uCD94\uCC9C\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. request \uB294 "\uB9C9\uD78C \uAC83\uC744 \uAC19\uC774 \uD480\uACA0\uB2E4"\uB294 \uB9D0\uB85C.
  \uC131\uC7A5 \uC815\uCCB4(\uACB0\uACFC\uBB3C \uC218\uC900\uC774 \uC624\uB798 \uBE44\uC2B7, \uC0C8\uB85C \uB9E1\uC740 \uC77C \uC5C6\uC74C) \u2192 develop \u2014 \uC131\uACF5 \uAC00\uB2A5\uC131 50~70% \uC815\uB3C4\uC758 \uD55C \uB2E8\uACC4 \uC5B4\uB824\uC6B4 \uC5ED\uD560\xB7\uACFC\uC81C\uB97C \uC81C\uC548
  \uD300\uC7A5 \uC57D\uC18D \uBC00\uB9BC(\uC774 \uD300\uC6D0\uACFC\uC758 1on1\uC5D0\uC11C \uD55C \uC57D\uC18D\uC774 \uAE30\uD55C \uC9C0\uB0A8) \u2192 one_on_one \u2014 opener \uB294 \uBC00\uB9B0 \uC57D\uC18D\uC744 \uD300\uC7A5\uC774 \uBA3C\uC800 \uAEBC\uB0B4\uB294 \uBB38\uC7A5
  \uCC38\uC5EC \uC704\uCD95(\uAFB8\uC900\uD788 \uB098\uB204\uB358 \uCEE8\uB514\uC158 \uACF5\uC720\uAC00 2\uC8FC\uC9F8 \uB04A\uAE40) \u2192 one_on_one \u2014 opener \uB294 \uC5C5\uBB34\uAC00 \uC544\uB2CC \uC548\uBD80\uD615, \uCD94\uAD81 \uAE08\uC9C0
  \uBD80\uB2F4 \uC694\uC778\uC774 \uACB9\uCE68(\uCEE8\uB514\uC158 \uACF5\uC720) \u2192 one_on_one(urgency \uB192\uAC8C) \u2014 opener \uB294 \uADFC\uD669\uD615, \uD300\uC6D0\uC774 \uACE0\uB978 \uD56D\uBAA9\uC744 \uADF8\uB300\uB85C \uC62E\uAE30\uC9C0 \uC54A\uC74C

\uC6D0\uCE59:
- \uD300\uC6D0\uB9C8\uB2E4 0~2\uAC1C, \uC804\uCCB4 4~8\uAC1C. \uC774\uBC88 \uC8FC\uC5D0 \uD558\uC9C0 \uC54A\uC73C\uBA74 \uC190\uD574\uAC00 \uD070 \uAC83\uBD80\uD130 urgency 3.
- why(\uBA85\uBD84)\uB294 \uC785\uB825 \uC0AC\uC2E4\uB9CC\uC73C\uB85C 1~2\uBB38\uC7A5, [E#] \uD0DC\uADF8\uB97C \uBD99\uC785\uB2C8\uB2E4. \uCD94\uCE21\xB7\uC9C4\uB2E8\xB7\uC131\uACA9 \uD310\uB2E8 \uAE08\uC9C0.
- \uCEE8\uB514\uC158\uC774 2 \uC774\uD558\uC774\uAC70\uB098 \uB5A8\uC5B4\uC9C0\uB294 \uC0AC\uB78C\uC5D0\uAC8C push \uB97C \uCD94\uCC9C\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- '\uD300\uC7A5 \uC811\uC810'(\uCD5C\uADFC 28\uC77C \uD300\uC7A5\uC774 \uADF8 \uC0AC\uB78C\uC5D0\uAC8C \uC4F4 1on1\xB7\uCF54\uBA58\uD2B8\xB7\uAD00\uCC30\xB7\uC694\uCCAD, \uB9AC\uBDF0 \uCCAB \uBC18\uC751 \uC2DC\uAC04)\uC744 \uBD05\uB2C8\uB2E4. \uD544\uC694\uB3C4\uAC00 \uB192\uC740\uB370(\uCEE8\uB514\uC158 \uD558\uB77D\xB7\uC774\uD0C8 \uC8FC\uC758\xB7\uC2E0\uADDC\xB7\uB9C9\uD798 \uBC18\uBCF5) \uC811\uC810\uC774 \uD300 \uC911\uC559\uAC12\uBCF4\uB2E4 \uD06C\uAC8C \uC801\uAC70\uB098 \uB9AC\uBDF0 \uBC18\uC751\uC774 \uB2A6\uC740 \uC0AC\uB78C\uC5D0\uAC8C\uB294
  one_on_one \uB610\uB294 support \uB97C \uC6B0\uC120 \uCD94\uCC9C\uD558\uACE0, why \uC5D0 "\uD300\uC7A5 \uC2DC\uAC04\uC774 \uB35C \uAC00\uACE0 \uC788\uB2E4"\uB294 \uC0AC\uC2E4\uC744 \uC22B\uC790\uB85C \uBC1D\uD799\uB2C8\uB2E4. \uBC18\uB300\uB85C \uC811\uC810\uC774 \uC18C\uC218\uC5D0\uAC8C \uBAB0\uB824 \uC788\uC73C\uBA74 summary \uC5D0\uC11C \uC9DA\uC2B5\uB2C8\uB2E4. (\uC571 \uAE30\uB85D \uAE30\uC900\uC774\uB77C \uAD6C\uB450 \uB300\uD654\uB294 \uBE60\uC838 \uC788\uC744 \uC218 \uC788\uC74C)
- praise \uC5D0\uB294 \uD300\uC6D0\uC5D0\uAC8C \uADF8\uB300\uB85C \uBCF4\uB0BC \uC218 \uC788\uB294 \uCE6D\uCC2C \uBB38\uAD6C(message) \uD55C \uBB38\uC7A5 \u2014 \uC5B4\uB5A4 \uD589\uB3D9\uC744 \uD588\uACE0 \uADF8\uAC8C \uD300\uC774\uB098 \uC77C\uC5D0 \uC5B4\uB5A4 \uACB0\uACFC\uB97C \uB0C8\uB294\uC9C0\uB97C \uAD6C\uCCB4\uC801\uC73C\uB85C, \uACFC\uC7A5 \uC5C6\uC774. "\uC218\uACE0\uD588\uC5B4\uC694", "\uACE0\uC0DD \uB9CE\uC558\uC5B4\uC694" \uAC19\uC740 \uC77C\uBC18\uC801\uC778 \uB9D0\uB85C \uB05D\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- support \uC758 request \uB294 \uC9C0\uCCD0 \uBCF4\uC774\uB294 \uC774\uC720\uC5D0 \uB9DE\uCDA5\uB2C8\uB2E4: \uBE44\uD310\xB7\uBCF4\uC644 \uC694\uCCAD\uC774 \uC774\uC5B4\uC9C4 \uC0AC\uB78C\uC5D0\uAC8C\uB294 \uAE30\uB300\uD558\uB294 \uAE30\uC900\uC744 \uD568\uAED8 \uC815\uB9AC\uD558\uC790\uB294 \uB9D0, \uC77C\uC5D0\uC11C \uC18C\uC678\uB3FC \uBCF4\uC774\uB294 \uC0AC\uB78C\uC5D0\uAC8C\uB294 \uD575\uC2EC \uB17C\uC758\uC5D0 \uD568\uAED8\uD558\uC790\uB294 \uB9D0, \uD558\uB294 \uC77C\uC758 \uC758\uBBF8\uAC00 \uD750\uB824 \uBCF4\uC774\uB294 \uC0AC\uB78C\uC5D0\uAC8C\uB294 \uADF8 \uC77C\uC774 \uD300 \uBAA9\uD45C\uC5D0 \uC5B4\uB5BB\uAC8C \uC774\uC5B4\uC9C0\uB294\uC9C0\uB97C \uB2F4\uC740 \uB9D0. \uC6D0\uC778\uC744 \uB2E8\uC815\uD558\uC9C0 \uC54A\uACE0 \uAE30\uB85D\uC73C\uB85C \uBCF4\uC774\uB294 \uCABD\uC5D0 \uB9DE\uCDA5\uB2C8\uB2E4.
- develop \uC758 request \uB294 \uC9C0\uAE08\uBCF4\uB2E4 \uD55C \uB2E8\uACC4 \uC5B4\uB824\uC6B4 \uC5ED\uD560\uC774\uB098 \uAE30\uD68C\uB97C \uD568\uAED8 \uC815\uD574 \uBCF4\uC790\uB294 \uC81C\uC548\uC73C\uB85C, \uD300\uC7A5\uC774 \uBB34\uC5C7\uC744 \uC9C0\uC6D0\uD560\uC9C0 \uD55C \uAD6C\uC808 \uB123\uC2B5\uB2C8\uB2E4.
- one_on_one \uC5D0\uB294 \uB300\uD654\uB97C \uC5EC\uB294 \uCCAB \uC9C8\uBB38(opener) \uD55C \uBB38\uC7A5 \u2014 \uC5C5\uBB34 \uB0B4\uC6A9\uC774 \uC544\uB2C8\uB77C \uC0AC\uB78C(\uC5D0\uB108\uC9C0\xB7\uC5B4\uB824\uC6C0\xB7\uBC14\uB77C\uB294 \uAC83)\uC5D0 \uB300\uD55C \uC9C8\uBB38.
- push \xB7 support \xB7 develop \uC5D0\uB294 \uD300\uC6D0\uC5D0\uAC8C \uBCF4\uB0BC \uD55C \uBB38\uC7A5(request) \u2014 \uD2B9\uC815 \uACFC\uC81C \uC9C0\uC2DC\uAC00 \uC544\uB2CC \uB9AC\uB4EC\xB7\uC9C0\uC6D0\xB7\uAE30\uD68C\uC5D0 \uB300\uD55C \uB9D0.
- members \uC5D0\uB294 \uC785\uB825\uC5D0 \uC788\uB294 \uD300\uC6D0 \uC804\uC6D0\uC744 \uB123\uC2B5\uB2C8\uB2E4. work_view \uB294 \uC5C5\uBB34 \uC218\uD589 \uACBD\uACFC(\uC9C4\uCC99\xB7\uACC4\uD68D \uB300\uBE44\xB7\uACB0\uACFC\uBB3C \uD488\uC9C8\xB7\uC694\uCCAD \uCC98\uB9AC)\uB97C \uC885\uD569\uD55C 2\uBB38\uC7A5 \uD310\uB2E8 [E#] \u2014 \uC5EC\uAE30\uC11C\uB294 \uC5C5\uBB34 \uC0AC\uC2E4\uC744 \uC368\uB3C4 \uB429\uB2C8\uB2E4.
  flight_risk \uB294 \uC785\uB825\uC758 \uCEE8\uB514\uC158 \uCD94\uC774\xB71on1 \uACF5\uBC31\xB7\uB9C9\uD798\xB7\uC6B0\uB824 \uAD00\uCC30\xB7\uC120\uD589 \uC2E0\uD638\uB85C\uB9CC low|medium|high \uB97C \uACE0\uB985\uB2C8\uB2E4. medium \uC774\uC0C1\uC740 \uADFC\uAC70\uAC00 2\uAC1C \uC774\uC0C1\uC77C \uB54C\uB9CC, \uADFC\uAC70\uAC00 \uD558\uB098\uBFD0\uC774\uBA74 low \uB85C \uB450\uACE0 flight_note \uC5D0 "\uC9C0\uCF1C\uBCFC \uAC83"\uC73C\uB85C \uC501\uB2C8\uB2E4.
  flight_note \uB294 \uADFC\uAC70 \uD55C \uBB38\uC7A5 \u2014 \uD300\uC7A5\uC774 \uBC14\uAFC0 \uC218 \uC788\uB294 \uAC83(\uC778\uC815\xB7\uC131\uC7A5 \uAE30\uD68C\xB7\uC5C5\uBB34\uB7C9\xB7\uB9C9\uD798\xB7\uD300\uC7A5 \uC57D\uC18D\xB7\uC18C\uD1B5)\uC744 \uBA3C\uC800 \uC501\uB2C8\uB2E4. \uBCF4\uC0C1\xB7\uC81C\uB3C4\uCC98\uB7FC \uD68C\uC0AC \uCC28\uC6D0 \uC774\uC720\uAC00 \uAE30\uB85D\uC5D0 \uBCF4\uC774\uBA74 \uAC1C\uBCC4 \uC561\uC158\uC73C\uB85C \uB9CC\uB4E4\uC9C0 \uB9D0\uACE0 summary \uC5D0 "\uD68C\uC0AC \uCC28\uC6D0 \uC774\uC288 \u2014 \uC0C1\uD5A5 \uBCF4\uACE0 \uD544\uC694"\uB85C\uB9CC \uC9DA\uC2B5\uB2C8\uB2E4.

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "summary": "\uC774\uBC88 \uC8FC \uD300\uC6D0\uAD00\uB9AC \uD55C \uBB38\uC7A5 [E#]",
  "actions": [{"user_id": "\uC785\uB825\uC758 id", "type": "one_on_one", "urgency": 3, "title": "\uB204\uAD6C\uC5D0\uAC8C \uBB34\uC5C7\uC744 (\uC9E7\uAC8C)", "why": "\uBA85\uBD84 [E1]",
               "message": "", "opener": "", "request": ""}],
  "members": [{"user_id": "\uC785\uB825\uC758 id", "work_status": "good|watch|support", "work_view": "\uC5C5\uBB34 \uC218\uD589 \uACBD\uACFC \uD310\uB2E8 [E2]", "flight_risk": "low|medium|high", "flight_note": "\uADFC\uAC70 \uD55C \uBB38\uC7A5"}]
}`;

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

// functions/ai-people-actions/index.ts
var DAY = 864e5;
var since = (d) => new Date(Date.now() - d * DAY).toISOString();
var avg = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null;
async function actionsFor(teamId, createdBy) {
  const { data: team } = await admin.from("teams").select("name, mission").eq("id", teamId).single();
  const { data: tm } = await admin.from("team_members").select("user_id, role, job_title, weekly_hours, joined_at, profiles(full_name)").eq("team_id", teamId).eq("status", "active");
  const members = (tm ?? []).filter((m) => m.role === "member");
  if (!members.length) return null;
  const today = kstToday();
  const mon = kstMonday();
  const { data: attnRows } = await admin.rpc("leader_attention", { p_team: teamId, p_days: 28 });
  const attn = new Map((attnRows ?? []).map((r) => [r.user_id, r]));
  const touches = [...attn.values()].map((r) => Number(r.touch)).sort((a, b) => a - b);
  const medTouch = touches.length ? touches[Math.floor(touches.length / 2)] : null;
  const [cis, oos, obs, scores, items, subs, reqs] = await Promise.all([
    admin.from("checkins").select("id, user_id, week_start, condition, moods, note").eq("team_id", teamId).gte("week_start", addDaysYmd(mon, -42)).order("week_start"),
    admin.from("one_on_ones").select("id, member_id, scheduled_at, status").eq("team_id", teamId).gte("scheduled_at", since(120)),
    admin.from("observations").select("id, subject_id, kind, body, occurred_at").eq("team_id", teamId).gte("occurred_at", addDaysYmd(today, -60)),
    admin.from("judgment_scores").select("user_id, score, scored_at").eq("team_id", teamId).gte("scored_at", since(240)).order("scored_at"),
    admin.from("work_items").select("id, owner_id, title, status, progress, start_date, due_date, base_start, base_due, created_at, est_hours_per_week, measure, replan_count").eq("team_id", teamId).not("status", "in", "(dropped,proposed)"),
    admin.from("submissions").select("id, author_id, title, status, updated_at").eq("team_id", teamId).gte("updated_at", since(45)),
    admin.from("team_requests").select("id, to_id, title, status, due_date, responded_at, created_at").eq("team_id", teamId).gte("created_at", since(45))
  ]);
  const book = new SourceBook();
  const blocks = [];
  const leaderId = (tm ?? []).find((x) => x.role === "leader")?.user_id;
  const myNotes = leaderId ? await loadLeaderNotes(teamId, leaderId, { types: ["member"], limit: 40 }) : [];
  const raw = leaderId ? await loadRaw(admin, teamId, leaderId, 8).catch(() => null) : null;
  for (const m of members) {
    const uid = m.user_id;
    const name = m.profiles?.full_name ?? "\uD300\uC6D0";
    const ci = (cis.data ?? []).filter((c) => c.user_id === uid);
    const cond = ci.map((c) => c.condition).filter((x) => x != null);
    const lastCi = ci[ci.length - 1];
    const done = (oos.data ?? []).filter((o) => o.member_id === uid && o.status === "done").sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
    const next = (oos.data ?? []).filter((o) => o.member_id === uid && o.status === "scheduled" && o.scheduled_at >= (/* @__PURE__ */ new Date()).toISOString());
    const ob = (obs.data ?? []).filter((o) => o.subject_id === uid);
    const sc = (scores.data ?? []).filter((s) => s.user_id === uid).map((s) => Number(s.score));
    const its = (items.data ?? []).filter((i) => i.owner_id === uid);
    const active = its.filter((i) => i.status === "active" || i.status === "blocked");
    const behind = active.filter((i) => {
      const e = i.base_due ?? i.due_date;
      if (!e || i.measure === "recurring") return false;
      const s = Date.parse((i.base_start ?? i.start_date ?? i.created_at).slice(0, 10));
      const E = Date.parse(e) + DAY;
      const plan = E > s ? Math.max(0, Math.min(1, (Date.now() - s) / (E - s))) * 100 : 100;
      return i.progress - plan <= -15;
    });
    const overdue = active.filter((i) => i.due_date && i.due_date < today);
    const hours = active.reduce((a, i) => a + Number(i.est_hours_per_week ?? 0), 0);
    const doneRecent = its.filter((i) => i.status === "done");
    const sb = (subs.data ?? []).filter((s) => s.author_id === uid);
    const rq = (reqs.data ?? []).filter((r) => r.to_id === uid);
    const rqLate = rq.filter((r) => r.status === "open" && r.due_date && r.due_date < today);
    const rqOnTime = rq.filter((r) => r.status === "done" && (!r.due_date || (r.responded_at ?? "").slice(0, 10) <= r.due_date));
    const facts = [
      `id=${uid}`,
      `\uC9C1\uBB34 ${m.job_title || "-"}`,
      `\uC8FC \uAC00\uC6A9 ${m.weekly_hours}\uC2DC\uAC04`,
      `\uCEE8\uB514\uC158 \uCD5C\uADFC ${cond.slice(-6).join("\u2192") || "\uAE30\uB85D \uC5C6\uC74C"}`,
      `\uB9C8\uC9C0\uB9C9 1on1 ${done[0] ? `${Math.floor((Date.now() - Date.parse(done[0].scheduled_at)) / DAY)}\uC77C \uC804` : "\uAE30\uB85D \uC5C6\uC74C"}${next.length ? ` \xB7 \uB2E4\uC74C 1on1 \uC608\uC815 ${next[0].scheduled_at.slice(0, 10)}` : ""}`,
      `\uAD00\uCC30 60\uC77C \uCE6D\uCC2C ${ob.filter((o) => o.kind === "praise").length} \xB7 \uC6B0\uB824 ${ob.filter((o) => o.kind === "concern").length} \xB7 \uBA54\uBAA8 ${ob.filter((o) => o.kind === "note").length}`,
      `\uACB0\uACFC\uBB3C \uD310\uB2E8 \uAE4A\uC774 \uCD5C\uADFC ${avg(sc.slice(-3)) ?? "-"} (\uC774\uC804 ${avg(sc.slice(-6, -3)) ?? "-"}) /4`,
      `\uB9E1\uC740 \uC77C \uC9C4\uD589 ${active.length}\uAC74 \xB7 \uB9C9\uD798 ${active.filter((i) => i.status === "blocked").length} \xB7 \uACC4\uD68D\uBCF4\uB2E4 15%p \uC774\uC0C1 \uB2A6\uC74C ${behind.length} \xB7 \uAE30\uD55C \uC9C0\uB0A8 ${overdue.length} \xB7 \uC644\uB8CC ${doneRecent.length} \xB7 \uC8FC\uB2F9 \uC608\uC0C1 ${hours}\uC2DC\uAC04`,
      `\uACB0\uACFC\uBB3C 45\uC77C ${sb.length}\uAC74 (\uB9AC\uBDF0 \uC911 ${sb.filter((s) => s.status === "in_review").length} \xB7 \uBCF4\uC644 \uC694\uCCAD ${sb.filter((s) => s.status === "needs_work").length} \xB7 \uC2B9\uC778 ${sb.filter((s) => s.status === "approved").length})`,
      `\uC694\uCCAD 45\uC77C ${rq.length}\uAC74 (\uAE30\uD55C \uC548 \uC644\uB8CC ${rqOnTime.length} \xB7 \uAE30\uD55C \uC9C0\uB0A8 ${rqLate.length})`,
      ...attn.get(uid) ? [(() => {
        const a = attn.get(uid);
        return `\uD300\uC7A5 \uC811\uC810 28\uC77C ${a.touch} (\uD300 \uC911\uC559\uAC12 ${medTouch ?? "-"}; 1on1 ${a.oo} \xB7 \uB9AC\uBDF0 \uCF54\uBA58\uD2B8 ${a.comments} \xB7 \uAD00\uCC30 ${a.obs} \xB7 \uCE6D\uCC2C ${a.praise} \xB7 \uC694\uCCAD ${a.reqs} \xB7 \uACFC\uC81C \uCF54\uBA58\uD2B8 ${a.item_comments}) \xB7 \uB9AC\uBDF0 \uCCAB \uBC18\uC751 \uD3C9\uADE0 ${a.resp_hours ?? "-"}\uC2DC\uAC04 \xB7 \uBC18\uC751 \uAE30\uB2E4\uB9AC\uB294 \uACB0\uACFC\uBB3C ${a.waiting}`;
      })()] : [],
      `\uC785\uC0AC ${Math.floor((Date.now() - Date.parse(m.joined_at)) / DAY)}\uC77C`,
      (() => {
        const f = raw ? flagsFor(raw, uid) : [];
        return `\uC120\uD589 \uC2E0\uD638 ${f.length ? f.map((x) => `${x.label}(${x.detail})`).join(" \xB7 ") : "\uC5C6\uC74C"}`;
      })()
    ].join(" / ");
    const tag = book.add("member", uid, `${name} \uC774\uBC88 \uC8FC \uC0AC\uC2E4`, facts);
    const extra = [];
    if (lastCi) extra.push(book.add("checkin", lastCi.id, `\uCEE8\uB514\uC158 \uACF5\uC720 ${name} ${weekLabel(lastCi.week_start)}`, conditionText(lastCi)));
    for (const o of ob.filter((x) => x.kind !== "note").slice(-2)) extra.push(book.add("observation", o.id, `\uAD00\uCC30 ${name} ${o.occurred_at}`, `${o.kind === "praise" ? "\uCE6D\uCC2C" : "\uC6B0\uB824"}: ${o.body}`));
    for (const i of [...overdue, ...behind].slice(0, 2)) extra.push(book.add("task", i.id, `${name} \uB2F4\uB2F9 \xB7 ${i.title}`, `\uC9C4\uCC99 ${i.progress}% \xB7 \uB9C8\uAC10 ${i.due_date ?? "-"} \xB7 \uC0C1\uD0DC ${i.status}${i.replan_count ? ` \xB7 \uACC4\uD68D \uBCC0\uACBD ${i.replan_count}\uD68C` : ""}`));
    for (const s of sb.filter((x) => x.status === "approved").slice(0, 1)) extra.push(book.add("submission", s.id, `${name} \uACB0\uACFC\uBB3C \uC2B9\uC778`, s.title));
    for (const n of myNotes.filter((x) => x.anchor_id === uid).slice(0, 2)) extra.push(addNote(book, n, name));
    blocks.push(`### ${name} ${tag}${extra.length ? ` (\uAD00\uB828 \uAE30\uB85D ${extra.join(" ")})` : ""}`);
  }
  await addKnowhow(book, teamId, "prep", 1e3, false, false);
  const text = [
    `\uC624\uB298: ${today} (\uC774\uBC88 \uC8FC \uC2DC\uC791 ${mon}) / \uD300: ${team?.name} / \uBBF8\uC158: ${team?.mission || "-"}`,
    `## \uD300\uC6D0 (${members.length}\uBA85)
${blocks.join("\n")}`,
    book.knowhowText(),
    book.text("\uD300\uC6D0\uBCC4 \uC0AC\uC2E4\uACFC \uAE30\uB85D")
  ].filter(Boolean).join("\n\n");
  const { output } = await runAi({
    teamId,
    kind: "people_actions",
    model: MODEL_SMART,
    system: PEOPLE_ACTIONS + NOTE_RULE,
    content: [{ type: "text", text }],
    book,
    depth: depthOf(book.size, [6, 14, 26]),
    level: "L2",
    createdBy,
    periodStart: mon,
    periodEnd: addDaysYmd(mon, 6),
    maxTokens: 4e3
  });
  return output;
}
serve(async (req) => {
  const body = await readJson(req);
  const caller = await getCaller(req);
  if (body.all) {
    if (!caller.isService) throw new HttpError(403, "forbidden");
    const { data: ids } = await admin.rpc("active_ai_teams");
    const results = {};
    for (const id of ids ?? []) {
      try {
        results[id] = await actionsFor(id, null) ? "ok" : "empty";
      } catch (e) {
        results[id] = e instanceof Error ? e.message.slice(0, 80) : "error";
      }
    }
    return json({ results });
  }
  if (!body.team_id) throw new HttpError(400, "MISSING_TEAM");
  await assertLeader(caller, body.team_id);
  const out = await actionsFor(body.team_id, caller.userId);
  if (!out) throw new HttpError(422, "NO_DATA", "\uD300\uC6D0\uC774 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4");
  return json(out);
});
