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
    max_tokens: opts.maxTokens ?? 2e3,
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
  if (start < 0 || end < start) throw new HttpError(502, "AI_BAD_OUTPUT", text.slice(0, 300));
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    throw new HttpError(502, "AI_BAD_OUTPUT", text.slice(0, 300));
  }
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
  "self_check"
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
    return this.items.filter((i) => i.type !== "knowhow").length;
  }
  get sources() {
    return this.items;
  }
  /** 기록(근거) 섹션 — 팀장 노하우는 따로 출력한다 */
  text(title) {
    const ls = this.lines.filter((l) => l.type !== "knowhow").map((l) => l.line);
    return ls.length ? `## ${title}
${ls.join("\n")}` : `## ${title}
(\uAE30\uB85D \uC5C6\uC74C)`;
  }
  /** 팀장의 기준 섹션 (없으면 빈 문자열) */
  knowhowText() {
    const ls = this.lines.filter((l) => l.type === "knowhow").map((l) => l.line);
    return ls.length ? `## \uD300\uC7A5\uC758 \uAE30\uC900 (\uD300\uC7A5\uC774 \uC9C1\uC811 \uB123\uC740 \uB178\uD558\uC6B0 \u2014 \uC77C\uBC18 \uC0C1\uC2DD\uBCF4\uB2E4 \uC6B0\uC120)
${ls.join("\n")}` : "";
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
async function addKnowhow(book, teamId, feature, limitChars = 2600, onlyShared = false) {
  let qb = admin.from("knowhow_cards").select("id, kind, title, body, rules, pinned, updated_at").eq("team_id", teamId).eq("active", true).contains("applies_to", [feature]);
  if (onlyShared) qb = qb.eq("shared", true);
  const { data } = await qb.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(30);
  let used = 0, n = 0;
  for (const c of data ?? []) {
    const rules = Array.isArray(c.rules) ? c.rules.filter(Boolean) : [];
    const text = `${c.body}${rules.length ? ` / \uADDC\uCE59: ${rules.join(" \xB7 ")}` : ""}`;
    if (used + text.length > limitChars && n > 0) break;
    book.add("knowhow", c.id, `\uB0B4 \uB178\uD558\uC6B0 \xB7 ${c.title}`, text);
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
7. '\uD300\uC7A5\uC758 \uAE30\uC900' \uC139\uC158\uC774 \uC788\uC73C\uBA74 \uADF8 \uAE30\uC900\uC744 \uC77C\uBC18\uC801\uC778 \uC0C1\uC2DD\uBCF4\uB2E4 \uC6B0\uC120\uD574 \uC801\uC6A9\uD558\uACE0, \uAE30\uC900\uC744 \uC801\uC6A9\uD55C \uBB38\uC7A5\uC5D0\uB294 \uD574\uB2F9 \uADFC\uAC70 \uD0DC\uADF8\uB97C \uBD99\uC785\uB2C8\uB2E4. \uAE30\uC900\uACFC \uAE30\uB85D\uC774 \uC5B4\uAE0B\uB098\uBA74 \uADF8 \uC810\uC744 \uC9DA\uC2B5\uB2C8\uB2E4.`;
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
async function runAi(job) {
  const credits = job.credits ?? CREDITS[job.kind];
  const core = CORE.includes(job.kind) && !credits;
  await assertAccess(job.teamId, job.kind, credits);
  const res = await callClaude({
    model: job.model,
    system: `${BASE_RULES}

${job.system}`,
    content: job.content,
    maxTokens: job.maxTokens
  });
  const parsed = parseJson(res.text);
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
  const kh = job.book.citedStrict(parsed).filter((x) => x.type === "knowhow" && x.id).map((x) => x.id);
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
var INSIGHT = `\uACFC\uC81C: \uD300\uC7A5\uC774 \uC774\uBC88 \uAE30\uAC04\uC5D0 \uD310\uB2E8\uD558\uACE0 \uCC59\uACA8\uC57C \uD560 \uAC83\uC744 \uC9DA\uB294 'AI \uC778\uC0AC\uC774\uD2B8'\uB97C \uC501\uB2C8\uB2E4.
\uC785\uB825\uC73C\uB85C (1) \uADDC\uCE59\xB7\uBAA8\uB378\uC774 \uACC4\uC0B0\uD55C '\uD300 \uC2E0\uD638'(\uC0AC\uC2E4), (2) \uADF8 \uAE30\uAC04\uC758 \uC6D0\uBCF8 \uAE30\uB85D \uC77C\uBD80, (3) \uD300\uC7A5\uC758 \uAE30\uC900\uC774 \uC8FC\uC5B4\uC9D1\uB2C8\uB2E4.
\uC2E0\uD638\uB97C \uADF8\uB300\uB85C \uBC18\uBCF5\uD558\uC9C0 \uB9D0\uACE0, \uC11C\uB85C \uC5EE\uC5B4\uC11C \uC6D0\uC778\xB7\uC5F0\uACB0\xB7\uC6B0\uC120\uC21C\uC704\uB97C \uC9DA\uC2B5\uB2C8\uB2E4. \uC608: \uC9C0\uC5F0\uB41C \uACFC\uC81C\uC640 \uB2F4\uB2F9\uC790\uC758 \uCEE8\uB514\uC158 \uD558\uB77D, \uB9C9\uD798 \uBC18\uBCF5\uC774 \uAC19\uC740 \uC6D0\uC778\uC744 \uAC00\uB9AC\uD0A4\uB294\uC9C0.
\uC22B\uC790\uC640 \uC0AC\uC2E4\uC740 \uC785\uB825\uC5D0 \uC788\uB294 \uAC83\uB9CC \uC501\uB2C8\uB2E4. \uCD94\uCE21\uC740 '\uAC00\uB2A5\uC131'\uC73C\uB85C \uD45C\uC2DC\uD558\uACE0, \uD310\uB2E8\uC758 \uADFC\uAC70 \uD0DC\uADF8\uB97C \uBD99\uC785\uB2C8\uB2E4.
\uD55C \uBB38\uC7A5\uC740 \uC9E7\uAC8C. \uD300\uC7A5\uC774 \uC9C0\uAE08 \uD560 \uD589\uB3D9\uC744 \uAD6C\uCCB4\uC801\uC73C\uB85C(\uB204\uAD6C\uC640, \uBB34\uC5C7\uC744).

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "headline": "\uC774\uBC88 \uAE30\uAC04 \uD300 \uC0C1\uD669\uC744 \uD55C \uBB38\uC7A5\uC73C\uB85C",
  "items": [
    {"domain": "goal|exec|people|output|growth", "type": "risk|missed|forecast|pattern|good|data", "severity": 1,
     "title": "\uC9E7\uC740 \uC81C\uBAA9", "body": "2~3\uBB38\uC7A5 \uD574\uC11D [E1][E3]", "action": "\uD300\uC7A5\uC774 \uD560 \uD589\uB3D9 \uD55C \uBB38\uC7A5", "link": "goals|team|reviews|one_on_ones|perf|sim|knowhow|report|eval"}
  ],
  "watch_next": "\uB2E4\uC74C \uAE30\uAC04\uC5D0 \uC9C0\uCF1C\uBCFC \uAC83 \uD55C \uBB38\uC7A5"
}
severity \uB294 1~3 (3\uC774 \uAC00\uC7A5 \uAE09\uD568). items \uB294 \uC77C\uAC04 2~4\uAC1C, \uC8FC\uAC04 3~5\uAC1C, \uC6D4\uAC04 4~6\uAC1C.
\uB370\uC774\uD130\uAC00 \uBD80\uC871\uD574\uC11C \uD310\uB2E8\uC774 \uC5B4\uB824\uC6B4 \uC601\uC5ED\uC774 \uC788\uC73C\uBA74 type 'data' \uD56D\uBAA9\uC73C\uB85C \uBB34\uC5C7\uC744 \uB354 \uC313\uC73C\uBA74 \uB418\uB294\uC9C0 \uC501\uB2C8\uB2E4.`;
var INSIGHT_PERIOD = {
  daily: "\uAE30\uAC04: \uC624\uB298. \uC624\uB298 \uC548\uC5D0 \uC190\uC368\uC57C \uD560 \uAC83(\uAE09\uD55C \uB9AC\uC2A4\uD06C, \uB193\uCE5C \uC57D\uC18D\xB7\uC694\uCCAD\xB7\uB9AC\uBDF0, \uC624\uB298 1:1 \uC900\uBE44)\uB9CC \uC9E7\uAC8C. \uCD94\uC138 \uD574\uC11D\uC740 \uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  weekly: "\uAE30\uAC04: \uC774\uBC88 \uC8FC. \uC9C0\uB09C 7\uC77C\uC758 \uD750\uB984(\uC9C4\uCC99 \uC18D\uB3C4, \uB9C9\uD798 \uBC18\uBCF5, \uCEE8\uB514\uC158 \uCD94\uC138, \uB9AC\uBDF0 \uD750\uB984)\uACFC \uC774\uBC88 \uC8FC \uC6B0\uC120\uC21C\uC704\uB97C \uC9DA\uC2B5\uB2C8\uB2E4.",
  monthly: "\uAE30\uAC04: \uC774\uBC88 \uB2EC. \uAD6C\uC870\uC640 \uC6D0\uC778(\uBAA9\uD45C \uC804\uB9DD \uBCC0\uD654, \uACC4\uD68D\uC774 \uBC18\uBCF5\uD574\uC11C \uBC00\uB9AC\uB294 \uD328\uD134, \uC2DC\uAC04 \uBC30\uBD84, \uACB0\uACFC\uBB3C \uD488\uC9C8 \uD328\uD134, \uD300\uC6D0 \uC131\uC7A5 \uADA4\uC801, \uD300\uC7A5 \uC790\uC2E0\uC758 \uC6B4\uC601 \uD328\uD134)\uC744 \uC9DA\uC2B5\uB2C8\uB2E4. \uC0C1\uC704 \uBCF4\uACE0\uC5D0 \uC4F8 \uC218 \uC788\uB294 \uBB38\uC7A5\uC73C\uB85C."
};

// functions/_shared/signals.ts
var DOMAIN_META = {
  goal: { name: "\uBAA9\uD45C\xB7\uC2E4\uC801", desc: "\uBAA9\uD45C \uB2EC\uC131 \uAC00\uB2A5\uC131\uACFC \uC2E4\uC801 \uC804\uB9DD", period: "\uC6D4\uAC04 \uC804\uB9DD" },
  exec: { name: "\uC2E4\uD589\xB7\uACFC\uC81C", desc: "\uACC4\uD68D \uB300\uBE44 \uC9C0\uC5F0\xB7\uB9C9\uD798\xB7\uC2DC\uAC04 \uBC30\uBD84", period: "\uC8FC\uAC04 \uC9C4\uCC99" },
  people: { name: "\uC0AC\uB78C\xB7\uCEE8\uB514\uC158", desc: "\uCEE8\uB514\uC158 \uCD94\uC138, 1:1 \uAC04\uACA9, \uCCB4\uD06C\uC778", period: "\uC8FC\uAC04 \uCD94\uC138" },
  output: { name: "\uACB0\uACFC\uBB3C\xB7\uB9AC\uBDF0", desc: "\uB9AC\uBDF0 \uB300\uAE30\uC640 \uC7AC\uC791\uC5C5 \uD328\uD134", period: "\uC8FC\uAC04 \uD750\uB984" },
  growth: { name: "\uC721\uC131\xB7\uD3C9\uAC00", desc: "\uD3C9\uAC00 \uADFC\uAC70\uC640 \uC131\uC7A5 \uC2E0\uD638", period: "\uC6D4\uAC04 \uADA4\uC801" }
};
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
  const [goals, metrics, items, schedule, portfolio, care, checkins, subs, depth, perf, level, obs, requests, late, rlogs] = await Promise.all([
    safe(db.rpc("goal_outlook", { p_team: teamId }), null),
    safe(db.from("metrics").select("id, item_id").eq("team_id", teamId).not("target", "is", null).order("created_at").limit(4), []),
    safe(db.from("work_items").select("id, parent_id, owner_id, title, status, measure, progress, start_date, due_date, base_due, replan_count, recur, needs_plan, updated_at, created_at, est_hours_per_week").eq("team_id", teamId).neq("status", "dropped"), []),
    safe(db.rpc("item_schedule", { p_team: teamId }), null),
    safe(db.rpc("task_portfolio", { p_team: teamId }), null),
    safe(db.rpc("care_radar", { p_team: teamId }), null),
    safe(db.from("checkins").select("user_id, week_start, condition").eq("team_id", teamId).gte("week_start", addDaysYmd(mon, -35)), []),
    safe(db.from("submissions").select("id, author_id, status, created_at, submission_versions(version, created_at)").eq("team_id", teamId).gte("updated_at", since60), []),
    safe(db.rpc("member_data_depth", { p_team: teamId }), null),
    safe(db.rpc("team_performance_map", { p_team: teamId }), null),
    safe(db.rpc("team_insight_level", { p_team: teamId }), null),
    safe(db.from("observations").select("subject_id").eq("team_id", teamId).gte("created_at", since30), []),
    safe(db.from("team_requests").select("id, to_id, title, kind, due_date, created_at, status").eq("team_id", teamId).eq("from_id", leaderId).eq("status", "open"), []),
    safe(db.from("action_items").select("id").eq("team_id", teamId).eq("owner_id", leaderId).is("done_at", null).lt("due_date", kstToday()), []),
    safe(db.from("work_item_logs").select("item_id, period, done").eq("team_id", teamId).eq("kind", "recurring").gte("period", addDaysYmd(kstToday(), -100)), [])
  ]);
  const forecasts = (await Promise.all(metrics.map(async (m) => {
    const f = await safe(db.rpc("metric_forecast", { p_metric: m.id }), null);
    return f ? { ...f, item_id: m.item_id } : null;
  }))).filter(Boolean);
  return {
    goals,
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
    minEvidence
  };
}
var fmtN = (n) => Math.abs(n) >= 100 ? Math.round(n).toLocaleString("ko-KR") : String(Math.round(n * 10) / 10);
var names = (arr, max = 3) => arr.slice(0, max).join(", ") + (arr.length > max ? ` \uC678 ${arr.length - max}\uBA85` : "");
var avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
var D = ["daily"];
var W = ["weekly"];
var M = ["monthly"];
var DW = ["daily", "weekly"];
var WM = ["weekly", "monthly"];
var ALL = ["daily", "weekly", "monthly"];
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
      action: { label: "\uBB34\uC5C7\uC744 \uBC14\uAFB8\uBA74 \uB418\uB294\uC9C0 \uC2DC\uBBAC\uB808\uC774\uC158", to: "/sim" }
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
        action: p != null && p < 50 ? { label: "\uBB34\uC5C7\uC744 \uBC14\uAFB8\uBA74 \uB418\uB294\uC9C0 \uC2DC\uBBAC\uB808\uC774\uC158", to: "/sim" } : { label: "\uC804\uB9DD \uC790\uC138\uD788", to: "/perf" }
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
    action: { label: "\uAC80\uD1A0\uD558\uAE30", to: "/goals?filter=proposed" }
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
    action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: "/goals?filter=overdue" }
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
    action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: "/goals?filter=blocked" }
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
    action: { label: "\uACC4\uD68D \uB300\uBE44 \uBCF4\uAE30", to: "/goals?view=timeline" }
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
    action: { label: "\uC9C4\uCC99 \uC694\uCCAD \uBCF4\uB0B4\uAE30", to: "/goals?filter=stale" }
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
    action: { label: "\uD56D\uBAA9 \uBCF4\uAE30", to: "/goals?filter=changes" }
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
    action: { label: "\uC694\uCCAD \uBCF4\uAE30", to: "/team?tab=requests" }
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
    action: { label: "\uD3EC\uD2B8\uD3F4\uB9AC\uC624 \uBCF4\uAE30", to: "/goals?view=table" }
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
    action: { label: "\uC2DC\uBBAC\uB808\uC774\uC158", to: "/sim" }
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
    action: { label: "\uD45C\uC5D0\uC11C \uC785\uB825", to: "/goals?view=table" }
  });
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
      detail: "\uBC88\uC544\uC6C3\xB7\uC774\uD0C8 \uC2E0\uD638\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC774\uBC88 \uC8FC \uC548\uC5D0 1:1\uC744 \uAD8C\uD569\uB2C8\uB2E4.",
      rule: "\uCCB4\uD06C\uC778 \uCEE8\uB514\uC158 3\uC8FC \uC5F0\uC18D \uD558\uB77D, \uCD5C\uADFC \uAC12 3 \uC774\uD558",
      action: { label: "1:1 \uC7A1\uAE30", to: `/one-on-ones?new=${r.user_id}` }
    });
    if (s.type === "blocked_repeat") S.push({
      id: `care-block-${r.user_id}`,
      domain: "people",
      type: "risk",
      severity: 2,
      periods: DW,
      title: `${r.full_name}\uB2D8\uC774 2\uC8FC\uC9F8 \uAC19\uC740 \uBB38\uC81C\uB85C \uB9C9\uD600 \uC788\uC2B5\uB2C8\uB2E4`,
      detail: s.detail ? `"${s.detail}"` : void 0,
      rule: "\uCCB4\uD06C\uC778 \uB9C9\uD798 \uD56D\uBAA9 2\uC8FC \uC5F0\uC18D",
      action: { label: "1:1 \uC7A1\uAE30", to: `/one-on-ones?new=${r.user_id}` }
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
    title: `1:1\uC744 2\uC8FC \uB118\uAC8C \uC548 \uD55C \uD300\uC6D0 ${noOO.length}\uBA85`,
    detail: names(noOO),
    rule: "\uB9C8\uC9C0\uB9C9 \uC644\uB8CC 1:1\uC774 14\uC77C \uC804",
    action: { label: "1:1 \uC7A1\uAE30", to: "/one-on-ones?new=1" }
  });
  const thisMon = kstMonday();
  if (missing.length) S.push({
    id: `care-ci-${thisMon}`,
    domain: "people",
    type: "data",
    severity: 1,
    periods: DW,
    title: `\uC774\uBC88 \uC8FC \uCCB4\uD06C\uC778\uC744 \uC548 \uB0B8 \uD300\uC6D0 ${missing.length}\uBA85`,
    detail: `${names(missing)} \u2014 \uCCB4\uD06C\uC778\uC774 \uBE60\uC9C0\uBA74 \uCEE8\uB514\uC158\xB7\uB9C9\uD798 \uC2E0\uD638\uB97C \uB193\uCE69\uB2C8\uB2E4.`,
    rule: "\uC218\uC694\uC77C \uC774\uD6C4 \uC774\uBC88 \uC8FC \uCCB4\uD06C\uC778 \uC5C6\uC74C",
    action: { label: "\uCCB4\uD06C\uC778 \uC694\uCCAD \uBCF4\uB0B4\uAE30", to: "/team?tab=requests" }
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
    detail: "\uD300\uC7A5\uC758 \uC57D\uC18D\uC774 \uBC00\uB9AC\uBA74 1:1 \uC2E0\uB8B0\uAC00 \uAC00\uC7A5 \uBA3C\uC800 \uB5A8\uC5B4\uC9D1\uB2C8\uB2E4.",
    rule: "1:1\uC5D0\uC11C \uC815\uD55C \uD300\uC7A5 \uD560 \uC77C, \uAE30\uD55C \uACBD\uACFC",
    action: { label: "\uC57D\uC18D \uBCF4\uAE30", to: "#today" }
  });
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
    action: { label: "\uB9AC\uBDF0\uD558\uB7EC \uAC00\uAE30", to: "/reviews" }
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
    rule: "\uCD5C\uADFC 2\uC8FC \uCCB4\uD06C\uC778\xB7\uACF5\uC720\xB7\uACB0\uACFC\uBB3C 0\uAC74",
    action: { label: "\uC694\uCCAD \uBCF4\uB0B4\uAE30", to: "/team?tab=requests" }
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
  const lv = raw.level;
  if (lv && lv.level < 5) {
    const next = lv.levels[lv.level];
    const gap = next.conditions.find((c) => c.current < c.target);
    if (gap) {
      const gl = gap.label;
      const gd = /체크인|1:1/.test(gl) ? "people" : /결과물/.test(gl) ? "output" : /근거/.test(gl) ? "growth" : /공수/.test(gl) ? "exec" : "goal";
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
      kpiLabel: curC != null ? `\uD300 \uCEE8\uB514\uC158 (5\uC810) \xB7 \uCCB4\uD06C\uC778 ${ciThis || ciLast}/${nMem}\uBA85` : "\uCEE8\uB514\uC158 \uAE30\uB85D \uC5C6\uC74C",
      line: pick("people")?.title ?? (nMem ? "\uD2B9\uBCC4\uD788 \uCC59\uAE38 \uC2E0\uD638\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4" : "\uD300\uC6D0\uC744 \uCD08\uB300\uD558\uBA74 \uCEE8\uB514\uC158 \uCD94\uC138\uB97C \uBD05\uB2C8\uB2E4"),
      confidence: !nMem ? 0 : ciWeeks >= 4 ? 3 : ciWeeks >= 2 ? 2 : 1,
      confidenceNote: `\uCD5C\uADFC 5\uC8FC \uC911 \uCCB4\uD06C\uC778 \uC788\uB294 \uC8FC ${ciWeeks}\uC8FC`,
      to: "/team",
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
      to: "/reviews",
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

// functions/ai-insights/index.ts
var KIND = { daily: "insight_daily", weekly: "insight_weekly", monthly: "insight_monthly" };
var SPAN = { daily: 2, weekly: 7, monthly: 31 };
async function insightFor(teamId, period, createdBy) {
  const { data: team } = await admin.from("teams").select("id, name, mission, settings").eq("id", teamId).single();
  const { data: tm } = await admin.from("team_members").select("user_id, role, job_title, profiles(full_name)").eq("team_id", teamId).eq("status", "active");
  const members = (tm ?? []).map((m) => ({ user_id: m.user_id, role: m.role, name: m.profiles?.full_name ?? "" }));
  const leader = members.find((m) => m.role === "leader");
  if (!leader) throw new HttpError(422, "NO_LEADER");
  const nameOf = new Map(members.map((m) => [m.user_id, m.name]));
  const minEv = Number(team?.settings?.min_judgment_evidence ?? 8);
  const raw = await loadRaw(admin, teamId, leader.user_id, minEv);
  const { signals, domains } = analyze(raw, members);
  const picked = signalsFor(period, signals).slice(0, 18);
  const book = new SourceBook();
  for (const s of picked) book.add("signal", null, `${DOMAIN_META[s.domain].name} \xB7 ${TYPE_LABEL[s.type]}`, `${s.title}${s.detail ? ` \u2014 ${s.detail}` : ""} (\uADDC\uCE59: ${s.rule})`);
  const domainLine = domains.map((d) => `${DOMAIN_META[d.domain].name}: \uC0C1\uD0DC ${d.status}, ${d.kpiLabel} ${d.kpi}, \uB370\uC774\uD130 \uCDA9\uC2E4\uB3C4 ${d.confidence}/3`).join("\n");
  const since = new Date(Date.now() - SPAN[period] * 864e5).toISOString();
  const { data: cis } = await admin.from("checkins").select("id, user_id, week_start, did, blocked, condition").eq("team_id", teamId).gte("updated_at", period === "daily" ? new Date(Date.now() - 7 * 864e5).toISOString() : since).limit(30);
  for (const c of cis ?? []) if (c.blocked || period !== "daily") book.add("checkin", c.id, `\uCCB4\uD06C\uC778 ${nameOf.get(c.user_id)} ${weekLabel(c.week_start)}`, `\uD55C \uC77C: ${c.did} / \uB9C9\uD798: ${c.blocked || "\uC5C6\uC74C"} / \uCEE8\uB514\uC158 ${c.condition ?? "-"}`);
  const { data: cms } = await admin.from("work_item_comments").select("id, item_id, author_id, body, kind, work_items(title)").eq("team_id", teamId).gte("created_at", since).limit(15);
  for (const c of cms ?? []) book.add("item_comment", c.id, `\uCF54\uBA58\uD2B8 \xB7 ${c.work_items?.title}`, `${nameOf.get(c.author_id)}: ${c.body}`);
  const { data: evs } = await admin.from("work_item_events").select("id, item_id, kind, reason, old, new, work_items(title)").eq("team_id", teamId).in("kind", ["replan", "target"]).gte("created_at", since).limit(15);
  for (const e of evs ?? []) book.add("item_event", null, `\uACC4\uD68D \uBCC0\uACBD \xB7 ${e.work_items?.title}`, `${JSON.stringify(e.old)} \u2192 ${JSON.stringify(e.new)} \uC0AC\uC720: ${e.reason ?? "\uC5C6\uC74C"}`);
  if (period === "daily") {
    const today = kstToday();
    const { data: oos } = await admin.from("one_on_ones").select("id, member_id, scheduled_at").eq("team_id", teamId).eq("status", "scheduled").gte("scheduled_at", `${today}T00:00:00+09:00`).lt("scheduled_at", `${addDaysYmd(today, 1)}T00:00:00+09:00`);
    for (const o of oos ?? []) book.add("one_on_one", o.id, `\uC624\uB298 1:1 \xB7 ${nameOf.get(o.member_id)}`, `\uC608\uC815 ${o.scheduled_at.slice(11, 16)}`);
  }
  if (book.size === 0) return null;
  await addKnowhow(book, teamId, "briefing", 1500);
  const text = [
    `\uD300: ${team?.name} / \uBBF8\uC158: ${team?.mission || "-"}`,
    INSIGHT_PERIOD[period],
    `## \uC601\uC5ED\uBCC4 \uC0C1\uD0DC (\uACC4\uC0B0\uAC12)
${domainLine}`,
    book.knowhowText(),
    book.text("\uD300 \uC2E0\uD638\uC640 \uAE30\uB85D")
  ].filter(Boolean).join("\n\n");
  const periodStart = period === "daily" ? kstToday() : period === "weekly" ? kstMonday() : `${kstToday().slice(0, 7)}-01`;
  const { output } = await runAi({
    teamId,
    kind: KIND[period],
    model: period === "daily" ? MODEL_FAST : MODEL_SMART,
    system: INSIGHT,
    content: [{ type: "text", text }],
    book,
    depth: depthOf(book.size, [5, 12, 25]),
    level: period === "monthly" ? "L3" : "L2",
    createdBy,
    periodStart,
    periodEnd: kstToday(),
    maxTokens: period === "monthly" ? 2200 : 1400,
    extra: { period, signal_count: picked.length }
  });
  return output;
}
serve(async (req) => {
  const body = await readJson(req);
  const period = ["daily", "weekly", "monthly"].includes(body.period) ? body.period : "weekly";
  const caller = await getCaller(req);
  if (body.all) {
    if (!caller.isService) throw new HttpError(403, "forbidden");
    const { data: ids } = await admin.rpc("active_ai_teams");
    const results = {};
    for (const id of ids ?? []) {
      try {
        const out2 = await insightFor(id, period, null);
        results[id] = out2 ? "ok" : "empty";
      } catch (e) {
        results[id] = e instanceof Error ? e.message.slice(0, 80) : "error";
      }
    }
    return json({ results });
  }
  if (!body.team_id) throw new HttpError(400, "MISSING_TEAM");
  await assertLeader(caller, body.team_id);
  const out = await insightFor(body.team_id, period, caller.userId);
  if (!out) throw new HttpError(422, "NO_DATA", "\uBD84\uC11D\uD560 \uAE30\uB85D\uC774 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4");
  return json(out);
});
