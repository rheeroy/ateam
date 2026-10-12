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

// functions/_shared/prompts/index.ts
var PLAN_DRAFT = `\uACFC\uC81C: \uD300\uC7A5(\uB610\uB294 \uD300\uC6D0)\uC774 \uC900 \uC790\uB8CC(\uC0AC\uC5C5\uACC4\uD68D\uC11C, \uC5C5\uBB34 \uBD84\uC7A5, \uBA54\uBAA8 \uB4F1)\uB97C \uC77D\uACE0 \uBAA9\uD45C\xB7\uACFC\uC81C\xB7\uD560 \uC77C \uACC4\uD68D \uCD08\uC548\uC744 \uB9CC\uB4ED\uB2C8\uB2E4.
\uC790\uB8CC\uC5D0 \uC788\uB294 \uB0B4\uC6A9\uB9CC \uAD6C\uC870\uD654\uD569\uB2C8\uB2E4. \uC5C6\uB294 \uBAA9\uD45C\uB098 \uC22B\uC790\uB97C \uC9C0\uC5B4\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uB0A0\uC9DC\uAC00 \uC5C6\uC73C\uBA74 \uBE44\uC6CC \uB461\uB2C8\uB2E4.
'\uB2E8\uACC4 \uC774\uB984'\uC774 \uC8FC\uC5B4\uC9C0\uBA74 \uADF8 \uC774\uB984\uC73C\uB85C \uACC4\uCE35\uC744 \uB9CC\uB4ED\uB2C8\uB2E4 (\uC608: \uBAA9\uD45C > \uACFC\uC81C > \uD560 \uC77C). \uACC4\uCE35\uC740 \uCD5C\uB300 3\uB2E8\uACC4.
\uB2F4\uB2F9\uC790\uB294 \uC8FC\uC5B4\uC9C4 \uD300\uC6D0 \uC774\uB984 \uC911\uC5D0\uC11C\uB9CC \uACE0\uB974\uACE0, \uC790\uB8CC\uB85C \uC54C \uC218 \uC5C6\uC73C\uBA74 \uBE44\uC6CC \uB461\uB2C8\uB2E4.
'\uC0C1\uC704 \uD56D\uBAA9'\uC774 \uC8FC\uC5B4\uC9C0\uBA74 \uADF8 \uC544\uB798\uC5D0 \uB4E4\uC5B4\uAC08 \uD558\uC704 \uD56D\uBAA9\uB9CC \uB9CC\uB4ED\uB2C8\uB2E4.

\uCE21\uC815 \uBC29\uC2DD(measure): check(\uD55C \uBC88\uC5D0 \uB05D\uB098\uB294 \uC77C), children(\uD558\uC704 \uD56D\uBAA9\uC73C\uB85C \uC9C4\uCC99 \uACC4\uC0B0), percent(\uC9C4\uCC99\uB960\uB85C \uAD00\uB9AC), number(\uC22B\uC790 \uBAA9\uD45C\uAC00 \uC788\uB294 \uC77C), recurring(\uC815\uAE30 \uC5C5\uBB34)

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "summary": "\uC790\uB8CC\uB97C \uC5B4\uB5BB\uAC8C \uAD6C\uC870\uD654\uD588\uB294\uC9C0 \uD55C\uB450 \uBB38\uC7A5",
  "ops": [
    {"op": "add", "ref": "n1", "parent": null, "title": "\uC81C\uBAA9", "note": "\uC124\uBA85(\uC120\uD0DD)", "owner": "\uD300\uC6D0 \uC774\uB984 \uB610\uB294 \uBE48 \uBB38\uC790\uC5F4",
     "measure": "children", "start_date": "2026-11-01", "due_date": "2026-12-31", "num_target": null, "unit": "", "recur": null, "reason": "\uC790\uB8CC\uC758 \uC5B4\uB514\uC5D0\uC11C \uC654\uB294\uC9C0"}
  ]
}
parent \uB294 null(\uCD5C\uC0C1\uC704), \uAC19\uC740 \uC751\uB2F5\uC758 \uB2E4\uB978 add \uD56D\uBAA9\uC758 ref, \uB610\uB294 \uAE30\uC874 \uD56D\uBAA9 id. \uD56D\uBAA9\uC740 30\uAC1C \uC774\uD558.`;
var PLAN_EDIT = `\uACFC\uC81C: \uD300\uC7A5(\uB610\uB294 \uD300\uC6D0)\uC758 \uB9D0\uB85C \uB41C \uC9C0\uC2DC\uC5D0 \uB530\uB77C \uD604\uC7AC \uBAA9\uD45C\xB7\uACFC\uC81C \uD2B8\uB9AC\uB97C \uACE0\uCE58\uB294 \uBCC0\uACBD\uC548\uC744 \uB9CC\uB4ED\uB2C8\uB2E4.
\uC9C0\uC2DC\uC5D0 \uD544\uC694\uD55C \uBCC0\uACBD\uB9CC \uB9CC\uB4ED\uB2C8\uB2E4. \uC9C0\uC2DC\uAC00 \uBAA8\uD638\uD558\uBA74 \uAC00\uC7A5 \uBCF4\uC218\uC801\uC73C\uB85C \uD574\uC11D\uD558\uACE0 summary \uC5D0 \uADF8 \uD574\uC11D\uC744 \uBC1D\uD799\uB2C8\uB2E4.
\uD56D\uBAA9\uC740 [id] \uB85C \uAC00\uB9AC\uD0B5\uB2C8\uB2E4. \uB2F4\uB2F9\uC790\uB294 \uC8FC\uC5B4\uC9C4 \uD300\uC6D0 \uC774\uB984 \uC911\uC5D0\uC11C\uB9CC \uACE0\uB985\uB2C8\uB2E4. \uB0A0\uC9DC\uB294 YYYY-MM-DD.

op \uC885\uB958:
- add: {"op":"add","ref":"n1","parent": \uAE30\uC874 id \uB610\uB294 ref \uB610\uB294 null,"title","note","owner","measure","start_date","due_date","num_target","unit","recur","reason"}
- update: {"op":"update","id":"\uAE30\uC874 id","set":{"title"?, "note"?, "owner"?, "start_date"?, "due_date"?, "status"?, "measure"?, "num_target"?, "progress"?, "priority"?, "contribution"?},"reason"}
- move: {"op":"move","id":"\uAE30\uC874 id","parent": \uC0C8 \uC0C1\uC704 id \uB610\uB294 null,"reason"}
- delete: {"op":"delete","id":"\uAE30\uC874 id","reason"}
status \uAC12: active, blocked, done, dropped.

\uCD9C\uB825 JSON \uD615\uC2DD:
{ "summary": "\uBB34\uC5C7\uC744 \uBC14\uAFB8\uB294\uC9C0 \uD55C\uB450 \uBB38\uC7A5", "ops": [ ... ] }
ops \uB294 20\uAC1C \uC774\uD558. \uC9C0\uC2DC\uC640 \uAD00\uACC4\uC5C6\uB294 \uD56D\uBAA9\uC740 \uAC74\uB4DC\uB9AC\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`;

// functions/_shared/signals.ts
var KST = 9 * 36e5;
var kstToday = (now = Date.now()) => new Date(now + KST).toISOString().slice(0, 10);

// functions/ai-plan/index.ts
var ST = { proposed: "\uC81C\uC548", changes_requested: "\uC218\uC815\uC694\uCCAD", active: "\uC9C4\uD589", blocked: "\uB9C9\uD798", done: "\uC644\uB8CC" };
serve(async (req) => {
  const body = await readJson(req);
  if (!body.team_id || !["draft", "edit"].includes(body.mode)) throw new HttpError(400, "MISSING_FIELDS");
  const caller = await getCaller(req);
  const { data: me } = await admin.from("team_members").select("role").eq("team_id", body.team_id).eq("user_id", caller.userId).eq("status", "active").maybeSingle();
  if (!me) throw new HttpError(403, "forbidden");
  const leader = me.role === "leader";
  const { data: team } = await admin.from("teams").select("name, mission, settings").eq("id", body.team_id).single();
  const levels = team?.settings?.level_names ?? ["\uBAA9\uD45C", "\uACFC\uC81C", "\uD560 \uC77C"];
  const { data: tm } = await admin.from("team_members").select("user_id, job_title, profiles(full_name)").eq("team_id", body.team_id).eq("status", "active");
  const people = (tm ?? []).map((m) => ({ id: m.user_id, name: m.profiles?.full_name ?? "", job: m.job_title }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const { data: all } = await admin.from("work_items").select("id, parent_id, owner_id, title, status, measure, progress, start_date, due_date, num_target, unit").eq("team_id", body.team_id).neq("status", "dropped").order("sort").limit(400);
  const items = all ?? [];
  let scopeRoot = null;
  if (body.parent_id) {
    scopeRoot = items.find((i) => i.id === body.parent_id) ?? null;
    if (!scopeRoot) throw new HttpError(404, "NOT_FOUND");
  }
  const memberOwn = !leader && !scopeRoot && body.mode === "edit";
  if (!leader && !memberOwn) {
    if (!scopeRoot) throw new HttpError(403, "forbidden", "\uD300\uC6D0\uC740 \uB2F4\uB2F9 \uD56D\uBAA9 \uC544\uB798\uC5D0\uC11C\uB9CC AI \uACC4\uD68D \uCD08\uC548\uC744 \uC4F8 \uC218 \uC788\uC2B5\uB2C8\uB2E4");
    const { data: rq } = await admin.from("team_requests").select("id").eq("team_id", body.team_id).eq("to_id", caller.userId).eq("item_id", scopeRoot.id).limit(1);
    if (scopeRoot.owner_id !== caller.userId && !rq?.length) throw new HttpError(403, "forbidden");
  }
  const inScope = (id) => {
    if (memberOwn) {
      let cur2 = items.find((i) => i.id === id);
      while (cur2) {
        if (cur2.owner_id === caller.userId) return true;
        cur2 = items.find((i) => i.id === cur2.parent_id);
      }
      return false;
    }
    if (!scopeRoot) return true;
    let cur = items.find((i) => i.id === id);
    while (cur) {
      if (cur.id === scopeRoot.id) return true;
      cur = items.find((i) => i.id === cur.parent_id);
    }
    return false;
  };
  const depthOf = (i) => {
    let d = 0;
    let c = i;
    while (c.parent_id) {
      d++;
      c = items.find((x) => x.id === c.parent_id) ?? { ...c, parent_id: null };
    }
    return d;
  };
  const tree = items.filter((i) => inScope(i.id)).map((i) => `${"  ".repeat(depthOf(i))}[${i.id}] ${levels[Math.min(depthOf(i), levels.length - 1)]} \xB7 ${i.title} \xB7 ${ST[i.status] ?? i.status} \xB7 \uB2F4\uB2F9 ${nameOf.get(i.owner_id ?? "") || "-"} \xB7 ${i.start_date ?? ""}~${i.due_date ?? ""} \xB7 \uC9C4\uCC99 ${i.progress}%${i.num_target != null ? ` \xB7 \uBAA9\uD45C ${i.num_target}${i.unit}` : ""}`).join("\n");
  const book = new SourceBook();
  await addKnowhow(book, body.team_id, "plan", 2e3, !leader);
  const content = [];
  const header = [
    `\uC624\uB298: ${kstToday()}`,
    `\uD300: ${team?.name} / \uBBF8\uC158: ${team?.mission || "-"}`,
    `\uB2E8\uACC4 \uC774\uB984: ${levels.join(" > ")}`,
    `\uD300\uC6D0: ${people.map((p) => `${p.name}(${p.job || "-"})`).join(", ")}`,
    !leader ? `\uC694\uCCAD\uD55C \uC0AC\uB78C: ${nameOf.get(caller.userId)} (\uBCF8\uC778\uC744 \uB2F4\uB2F9\uC790\uB85C \uB461\uB2C8\uB2E4)` : "",
    scopeRoot ? `\uC0C1\uC704 \uD56D\uBAA9: [${scopeRoot.id}] ${scopeRoot.title} \u2014 \uC774 \uC544\uB798\uB9CC \uB2E4\uB8F9\uB2C8\uB2E4` : "",
    book.knowhowText(),
    `## \uD604\uC7AC \uBAA9\uD45C\xB7\uACFC\uC81C
${tree || "(\uC5C6\uC74C)"}`
  ].filter(Boolean).join("\n\n");
  if (body.mode === "draft") {
    if (body.file_path) {
      if (!leader || !body.file_path.startsWith(`${body.team_id}/`)) throw new HttpError(403, "forbidden");
      const { data: file, error } = await admin.storage.from("knowhow").download(body.file_path);
      if (error) throw error;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, "FILE_TOO_LARGE");
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) }, title: "\uACC4\uD68D \uC790\uB8CC" });
    } else if (!body.text?.trim()) throw new HttpError(422, "NO_TEXT", "\uC790\uB8CC \uB0B4\uC6A9\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4");
    content.push({ type: "text", text: `${header}

## \uC790\uB8CC
${(body.text ?? "(\uCCA8\uBD80 PDF)").slice(0, 5e4)}` });
  } else {
    if (!body.instruction?.trim()) throw new HttpError(422, "NO_TEXT", "\uBB34\uC5C7\uC744 \uBC14\uAFC0\uC9C0 \uC801\uC5B4 \uC8FC\uC138\uC694");
    content.push({ type: "text", text: `${header}

## \uC9C0\uC2DC
${body.instruction.slice(0, 2e3)}` });
  }
  const scoped = body.mode === "draft" && !!scopeRoot;
  const { output } = await runAi({
    teamId: body.team_id,
    kind: body.mode === "draft" ? "plan_draft" : "plan_edit",
    model: MODEL_SMART,
    system: body.mode === "draft" ? PLAN_DRAFT : PLAN_EDIT,
    content,
    book,
    depth: 1,
    level: "L1",
    createdBy: caller.userId,
    credits: scoped ? 0 : void 0,
    refTable: scopeRoot ? "work_items" : void 0,
    refId: scopeRoot?.id,
    visibility: leader ? "leader" : "subject",
    maxTokens: 3500,
    extra: { scope: scopeRoot?.id ?? null, people: people.map((p) => ({ id: p.id, name: p.name })) }
  });
  return json(output);
});
