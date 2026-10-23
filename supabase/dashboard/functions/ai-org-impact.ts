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

// functions/_shared/prompts/index.ts
var ORG_IMPACT = `\uACFC\uC81C: \uD300\uC7A5\uC774 '\uC704\uC5D0\uC11C \uC628 \uAC83'(\uC804\uC0AC \uBC29\uCE68, \uC804\uB7B5 \uBCC0\uACBD, \uC784\uC6D0 \uAD00\uC2EC\uC0AC, \uC0C1\uC704 \uC694\uCCAD, \uC720\uAD00 \uBD80\uC11C \uBCC0\uD654, \uC804\uC0AC \uC77C\uC815)\uC744 \uBA54\uBAA8\uB85C \uB0A8\uACBC\uC2B5\uB2C8\uB2E4.
\uC774 \uC18C\uC2DD\uC774 \uD300\uC758 \uD604\uC7AC \uBAA9\uD45C\xB7\uACFC\uC81C\xB7\uACB0\uC815\uC5D0 \uC5B4\uB5A4 \uC601\uD5A5\uC744 \uC8FC\uB294\uC9C0, \uD300\uC7A5\uC774 \uBB34\uC5C7\uC744 \uD574\uC57C \uD558\uB294\uC9C0 \uC815\uB9AC\uD569\uB2C8\uB2E4.
\uC8FC\uC5B4\uC9C4 \uBAA9\uD45C\xB7\uACFC\uC81C\xB7\uACB0\uC815 \uBAA9\uB85D\uC5D0 \uC788\uB294 \uAC83\uB9CC \uC5F0\uACB0\uD569\uB2C8\uB2E4. \uC5C6\uB294 \uACC4\uD68D\uC774\uB098 \uC22B\uC790\uB97C \uC9C0\uC5B4\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC601\uD5A5\uC774 \uC5C6\uC73C\uBA74 level \uC744 none \uC73C\uB85C \uC194\uC9C1\uD558\uAC8C \uC501\uB2C8\uB2E4.
\uD56D\uBAA9\uC740 [id] \uB85C \uAC00\uB9AC\uD0B5\uB2C8\uB2E4. \uD589\uB3D9\uC740 \uAD6C\uCCB4\uC801\uC73C\uB85C(\uB204\uAD6C\uC640, \uBB34\uC5C7\uC744). \uADFC\uAC70 \uD0DC\uADF8\uB97C \uBD99\uC785\uB2C8\uB2E4.

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "summary": "\uC6B0\uB9AC \uD300\uC5D0 \uC8FC\uB294 \uC601\uD5A5 \uD55C\uB450 \uBB38\uC7A5 [E1]",
  "level": "high|medium|low|none",
  "affected": [{"item_id": "\uAE30\uC874 \uD56D\uBAA9 id", "title": "\uD56D\uBAA9 \uC774\uB984", "how": "\uC5B4\uB5BB\uAC8C \uC601\uD5A5\uC744 \uBC1B\uB294\uC9C0 \uD55C \uBB38\uC7A5"}],
  "actions": [{"label": "\uD300\uC7A5\uC774 \uD560 \uD589\uB3D9 \uD55C \uBB38\uC7A5", "kind": "replan|report|discuss|watch"}],
  "report_line": "\uC0C1\uC704\uC5D0 \uBCF4\uACE0\uD560 \uB54C \uC4F8 \uC218 \uC788\uB294 \uD55C \uBB38\uC7A5 (\uD544\uC694 \uC5C6\uC73C\uBA74 \uBE48 \uBB38\uC790\uC5F4)"
}
affected \uB294 0~4\uAC1C, actions \uB294 1~3\uAC1C.`;

// functions/_shared/signals.ts
var KST = 9 * 36e5;
var kstToday = (now = Date.now()) => new Date(now + KST).toISOString().slice(0, 10);

// functions/ai-org-impact/index.ts
var KIND = { strategy: "\uC804\uB7B5\xB7\uBC29\uD5A5 \uBCC0\uACBD", exec: "\uC784\uC6D0 \uAD00\uC2EC\uC0AC", request: "\uC0C1\uC704 \uC694\uCCAD", peer: "\uC720\uAD00 \uBD80\uC11C", calendar: "\uC804\uC0AC \uC77C\uC815", other: "\uAE30\uD0C0" };
var ST = { proposed: "\uC81C\uC548", changes_requested: "\uC218\uC815\uC694\uCCAD", active: "\uC9C4\uD589", blocked: "\uB9C9\uD798", done: "\uC644\uB8CC" };
serve(async (req) => {
  const body = await readJson(req);
  if (!body.team_id || !body.note_id) throw new HttpError(400, "MISSING_FIELDS");
  const caller = await getCaller(req);
  await assertLeader(caller, body.team_id);
  const { data: note } = await admin.from("org_notes").select("*").eq("id", body.note_id).eq("team_id", body.team_id).maybeSingle();
  if (!note) throw new HttpError(404, "NOT_FOUND");
  const { data: team } = await admin.from("teams").select("name, mission, parent_link").eq("id", body.team_id).single();
  const { data: tm } = await admin.from("team_members").select("user_id, profiles(full_name)").eq("team_id", body.team_id).eq("status", "active");
  const nameOf = new Map((tm ?? []).map((m) => [m.user_id, m.profiles?.full_name ?? ""]));
  const { data: items } = await admin.from("work_items").select("id, parent_id, owner_id, title, status, progress, due_date").eq("team_id", body.team_id).not("status", "in", "(dropped,done)").order("sort").limit(200);
  const all = items ?? [];
  const tops = all.filter((i) => !i.parent_id);
  const topIds = new Set(tops.map((t) => t.id));
  const second = all.filter((i) => i.parent_id && topIds.has(i.parent_id));
  const book = new SourceBook();
  const noteTag = book.add(
    "org_note",
    note.id,
    `\uC704\uC5D0\uC11C \uC628 \uAC83 \xB7 ${KIND[note.kind] ?? note.kind}`,
    `${note.title}${note.source ? ` (\uCD9C\uCC98: ${note.source})` : ""}${note.event_date ? ` \xB7 \uC77C\uC815 ${note.event_date}` : ""}
${note.body ?? ""}`
  );
  const { data: others } = await admin.from("org_notes").select("id, kind, title, created_at").eq("team_id", body.team_id).eq("status", "open").neq("id", note.id).gte("created_at", new Date(Date.now() - 45 * 864e5).toISOString()).limit(5);
  for (const o of others ?? []) book.add("org_note", o.id, `\uCD5C\uADFC \uB2E4\uB978 \uC18C\uC2DD \xB7 ${KIND[o.kind] ?? o.kind}`, o.title);
  const { data: decs } = await admin.from("decisions").select("id, title, rationale, expected_outcome, decided_at").eq("team_id", body.team_id).order("decided_at", { ascending: false }).limit(6);
  for (const d of decs ?? []) book.add("decision", d.id, `\uCD5C\uADFC \uACB0\uC815 \xB7 ${d.title}`, `\uADFC\uAC70: ${d.rationale || "-"} \xB7 \uAE30\uB300: ${d.expected_outcome || "-"} \xB7 ${String(d.decided_at).slice(0, 10)}`);
  await addKnowhow(book, body.team_id, "briefing", 1200);
  const tree = tops.map((t) => {
    const kids = second.filter((s) => s.parent_id === t.id).map((s) => `   - [${s.id}] ${s.title} \xB7 ${nameOf.get(s.owner_id ?? "") || "\uB2F4\uB2F9 \uC5C6\uC74C"} \xB7 ${ST[s.status] ?? s.status} ${s.progress}%${s.due_date ? ` \xB7 \uB9C8\uAC10 ${s.due_date}` : ""}`);
    return [`- [${t.id}] ${t.title}${t.due_date ? ` (\uB9C8\uAC10 ${t.due_date})` : ""}`, ...kids].join("\n");
  }).join("\n");
  const text = [
    `\uC624\uB298: ${kstToday()} / \uD300: ${team?.name} / \uBBF8\uC158: ${team?.mission || "-"}${team?.parent_link ? ` / \uC0C1\uC704 \uC5F0\uACB0: ${team.parent_link}` : ""}`,
    `## \uBD84\uC11D\uD560 \uC18C\uC2DD
${noteTag} \uB97C \uC911\uC2EC\uC73C\uB85C \uBD05\uB2C8\uB2E4.`,
    `## \uD300\uC758 \uD604\uC7AC \uBAA9\uD45C\xB7\uACFC\uC81C
${tree || "(\uBAA9\uD45C \uC5C6\uC74C)"}`,
    book.knowhowText(),
    book.text("\uC18C\uC2DD\uACFC \uCD5C\uADFC \uACB0\uC815")
  ].filter(Boolean).join("\n\n");
  const { output } = await runAi({
    teamId: body.team_id,
    kind: "org_impact",
    model: MODEL_SMART,
    system: ORG_IMPACT,
    content: [{ type: "text", text }],
    book,
    depth: Math.min(3, 1 + Math.floor(book.size / 4)),
    level: "L2",
    createdBy: caller.userId,
    refTable: "org_notes",
    refId: note.id,
    maxTokens: 900
  });
  return json(output);
});
