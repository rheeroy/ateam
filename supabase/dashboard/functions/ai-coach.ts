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
  "coaching"
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
  const kh = job.book.citedStrict(parsed).filter((x) => x.type === "knowhow" && x.id).map((x) => x.id);
  if (kh.length) await admin.rpc("mark_knowhow_used", { p_ids: kh });
  return { output: row, parsed };
}
var fmtDate = (d) => d ? d.slice(0, 10) : "";
var weekLabel = (d) => {
  const dt = new Date(d);
  const onejan = new Date(dt.getFullYear(), 0, 1);
  const w = Math.ceil(((dt.getTime() - onejan.getTime()) / 864e5 + onejan.getDay() + 1) / 7);
  return `W${String(w).padStart(2, "0")}`;
};

// functions/_shared/prompts/index.ts
var COACH = `\uACFC\uC81C: \uD300\uC6D0 \uD55C \uBA85\uC5D0\uAC8C \uBCF4\uB0BC 'ATEAM\uC758 \uCF54\uCE6D' \uD55C \uD1B5\uC744 \uC501\uB2C8\uB2E4. \uD300\uC6D0\uC758 \uCD5C\uADFC \uC5C5\uBB34 \uAE30\uB85D\uC5D0\uC11C \uAC1C\uC120\uC774 \uD544\uC694\uD55C \uC810\uC744 \uCC3E\uC544, \uCF54\uCE58\uAC00 \uBBF8\uB9AC \uCC59\uACA8 \uC8FC\uB4EF \uC54C\uB824 \uC90D\uB2C8\uB2E4.
\uC774 \uAE00\uC740 \uD300\uC6D0\uC5D0\uAC8C \uADF8\uB300\uB85C \uBCF4\uC785\uB2C8\uB2E4. \uC544\uB798 \uADDC\uCE59\uC774 \uACF5\uD1B5 \uC6D0\uCE59\uC758 \uBB38\uCCB4 \uADDC\uCE59(~\uD569\uB2C8\uB2E4\uCCB4)\uBCF4\uB2E4 \uC6B0\uC120\uD569\uB2C8\uB2E4.

[\uBB34\uC5C7\uC744 \uACE0\uB974\uB098]
- \uC5C5\uBB34 \uAE30\uB85D\uC5D0\uC11C \uBCF4\uC774\uB294 \uAC1C\uC120\uC810 1~2\uAC1C\uB9CC \uACE0\uB985\uB2C8\uB2E4. \uC6B0\uC120\uC21C\uC704: \uAE30\uD55C \uC9C0\uB0A8\xB7\uC9C4\uCC99 \uACF5\uC720 \uC5C6\uC74C > \uACB0\uACFC\uBB3C \uBCF4\uC644\uC810 \uBC18\uBCF5(\uAC19\uC740 \uC8FC\uC81C) > \uD310\uB2E8 \uAE4A\uC774 \uB0AE\uC74C > \uACC4\uD68D \uB300\uBE44 \uD06C\uAC8C \uB2A6\uC74C > \uCCB4\uD06C\uC778 \uBE60\uC9D0.
- \uAE30\uB85D\uC5D0 \uC5C6\uB294 \uAC83\uC740 \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC131\uACA9\xB7\uD0DC\uB3C4\xB7\uC758\uC695\uC744 \uB2E8\uC815\uD558\uC9C0 \uC54A\uACE0, \uB2E4\uB978 \uD300\uC6D0\uACFC \uBE44\uAD50\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- \uD3C9\uAC00\xB7\uB4F1\uAE09\xB7\uC778\uC0AC \uC870\uCE58\uB97C \uB5A0\uC62C\uB9AC\uAC8C \uD558\uB294 \uB9D0(\uD3C9\uAC00, \uAC10\uC810, \uACBD\uACE0, \uBB38\uC81C \uC778\uBB3C \uB4F1)\uC740 \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.

[\uB204\uAC00 \uBCF4\uB0B4\uB098]
- \uBCF4\uB0B4\uB294 \uC774\uB294 'ATEAM'\uC785\uB2C8\uB2E4. \uD300\uC7A5\xB7\uB9AC\uB354\xB7\uC0C1\uC0AC\uB97C \uC5B8\uAE09\uD558\uAC70\uB098 "\uD300\uC7A5\uB2D8\uC774 \uBCF4\uC2DC\uAE30\uC5D0", "\uC704\uC5D0\uC11C" \uAC19\uC740 \uD45C\uD604\uC744 \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- "\uD63C\uB098\uAE30 \uC804\uC5D0" \uAC19\uC740 \uC704\uD611 \uB300\uC2E0 "\uB2E4\uC74C \uB9AC\uBDF0 \uC804\uC5D0 \uBBF8\uB9AC \uCC59\uAE30\uBA74 \uC88B\uC544\uC694" \uAC19\uC740 \uB3C4\uC6C0 \uD1A4\uC73C\uB85C \uC501\uB2C8\uB2E4.

[\uD615\uC2DD]
- \uBB38\uCCB4: '~\uD574\uC694'\uCCB4. \uB530\uB73B\uD558\uC9C0\uB9CC \uAD6C\uCCB4\uC801\uC73C\uB85C. \uACFC\uC7A5\xB7\uAC10\uD0C4\xB7\uC774\uBAA8\uC9C0 \uC5C6\uC774.
- title: 18~30\uC790, \uC9C8\uBB38\uD615\uC774\uB098 \uC81C\uC548\uD615 (\uC608: "\uC81C\uC548\uC11C, \uD55C \uBC88 \uB354 \uB2E8\uB2E8\uD558\uAC8C \uB9CC\uB4E4\uC5B4 \uBCFC\uAE4C\uC694?")
- body: \uC544\uB798 \uB124 \uB369\uC5B4\uB9AC\uB97C \uC21C\uC11C\uB300\uB85C, \uB369\uC5B4\uB9AC \uC0AC\uC774 \uBE48 \uC904 \uD558\uB098. \uAC01 \uC904 \uC55E '\xB7 '\uB294 \uBAA9\uB85D.
  \uC9C0\uAE08 \uBCF4\uC774\uB294 \uAC83
  \xB7 \uC0AC\uC2E4 1~2\uC904 (\uACB0\uACFC\uBB3C\xB7\uACFC\uC81C \uC774\uB984\uC744 \uB530\uC634\uD45C\uB85C) [E#]
  
  \uC65C \uC911\uC694\uD574\uC694
  \uD55C\uB450 \uBB38\uC7A5
  
  \uC774\uB807\uAC8C \uD574 \uBCF4\uC138\uC694
  \xB7 \uBC14\uB85C \uD560 \uC218 \uC788\uB294 \uD589\uB3D9 2~3\uAC1C (\uC608\uC2DC \uBB38\uC7A5\uC774\uB098 \uC22B\uC790 \uC608\uB97C \uBD99\uC774\uBA74 \uC88B\uC74C)
  
  \uAD8C\uC7A5 \uC2DC\uC810 \xB7 \uC774\uBC88 \uC8FC \uAE08\uC694\uC77C\uAE4C\uC9C0 (\uB610\uB294 \uAE30\uB85D\uC5D0 \uB9DE\uB294 \uB0A0\uC9DC)
- body \uC804\uCCB4 220~420\uC790. [E#] \uD0DC\uADF8\uB294 '\uC9C0\uAE08 \uBCF4\uC774\uB294 \uAC83'\uC758 \uC0AC\uC2E4 \uC904 \uB05D\uC5D0\uB9CC \uBD99\uC785\uB2C8\uB2E4.
- \uAC1C\uC120\uD560 \uC810\uC774 \uB69C\uB837\uD558\uC9C0 \uC54A\uC73C\uBA74 title\uC740 "\uC9C0\uAE08 \uD750\uB984 \uC88B\uC544\uC694 \u2014 \uC774\uB807\uAC8C \uC774\uC5B4 \uAC00\uC694", body\uB294 \uC798\uD558\uACE0 \uC788\uB294 \uC810 1\uC904\uACFC \uB2E4\uC74C \uD55C \uAC78\uC74C 1~2\uAC1C\uB85C \uC9E7\uAC8C \uC501\uB2C8\uB2E4.

\uCD9C\uB825 JSON:
{"title": "\uC81C\uBAA9", "body": "\uBCF8\uBB38(\uC904\uBC14\uAFC8 \\n \uD3EC\uD568)"}`;

// functions/ai-coach/index.ts
var DAY = 864e5;
var since = (d) => new Date(Date.now() - d * DAY).toISOString();
serve(async (req) => {
  const { team_id, member_id } = await readJson(req);
  if (!team_id || !member_id) throw new HttpError(400, "MISSING_ID");
  const caller = await getCaller(req);
  await assertLeader(caller, team_id);
  const member = must(await admin.from("profiles").select("id, full_name").eq("id", member_id).maybeSingle());
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const book = new SourceBook();
  const { data: subs } = await admin.from("submissions").select("id, title, status, updated_at").eq("team_id", team_id).eq("author_id", member_id).gte("updated_at", since(42)).order("updated_at", { ascending: false }).limit(6);
  const gapCount = /* @__PURE__ */ new Map();
  for (const s of subs ?? []) {
    const { data: vers } = await admin.from("submission_versions").select("id, version").eq("submission_id", s.id).order("version", { ascending: false }).limit(3);
    const { data: rvs } = await admin.from("ai_outputs").select("content").eq("kind", "review").eq("ref_table", "submission_versions").in("ref_id", (vers ?? []).map((v) => v.id)).order("created_at", { ascending: false }).limit(2);
    const rv = (rvs ?? [])[0]?.content;
    for (const g of rv?.gaps ?? []) {
      const k = (g.section ?? "").replace(/^§\d+\s*/, "") || g.text.slice(0, 12);
      gapCount.set(k, (gapCount.get(k) ?? 0) + 1);
    }
    book.add("submission", s.id, `\uACB0\uACFC\uBB3C '${s.title}'`, `\uC0C1\uD0DC ${{ in_review: "\uB9AC\uBDF0 \uC911", needs_work: "\uBCF4\uC644 \uC694\uCCAD", approved: "\uC2B9\uC778", shared: "\uACF5\uC720" }[s.status] ?? s.status} \xB7 ${fmtDate(s.updated_at)}` + (rv ? ` \xB7 AI \uD310\uB2E8 \uAE4A\uC774 ${rv.depth_score ?? "-"}/4 \xB7 \uBCF4\uC644\uC810: ${(rv.gaps ?? []).map((g) => `${g.section ? `${g.section} ` : ""}${g.text}`).join(" / ") || "\uC5C6\uC74C"}` : "") + ` \xB7 \uBC84\uC804 ${(vers ?? []).length}\uAC1C`);
  }
  const repeat = [...gapCount.entries()].filter(([, n]) => n >= 2);
  if (repeat.length) book.add("pattern", null, "\uBC18\uBCF5\uB418\uB294 \uBCF4\uC644\uC810", repeat.map(([k, n]) => `${k} ${n}\uD68C`).join(" / "));
  const { data: items } = await admin.from("work_items").select("id, title, status, progress, start_date, due_date, base_due, updated_at").eq("team_id", team_id).eq("owner_id", member_id).in("status", ["active", "blocked"]).limit(20);
  for (const i of items ?? []) {
    const late = i.due_date && i.due_date < today ? Math.round((Date.parse(today) - Date.parse(i.due_date)) / DAY) : 0;
    const plan = i.start_date && i.due_date && i.due_date > i.start_date ? Math.min(100, Math.max(0, (Date.now() - Date.parse(i.start_date)) / (Date.parse(i.due_date) - Date.parse(i.start_date)) * 100)) : null;
    const behind = plan != null ? Math.round(plan - i.progress) : 0;
    const quiet = Math.round((Date.now() - Date.parse(i.updated_at)) / DAY);
    if (late > 0 || behind >= 15 || i.status === "blocked")
      book.add("task", i.id, `\uACFC\uC81C '${i.title}'`, `\uC9C4\uCC99 ${i.progress}%${plan != null ? ` (\uACC4\uD68D\uC0C1 ${Math.round(plan)}%)` : ""} \xB7 \uB9C8\uAC10 ${i.due_date ?? "-"}${late ? ` \xB7 ${late}\uC77C \uC9C0\uB0A8` : ""}${i.status === "blocked" ? " \xB7 \uB9C9\uD798" : ""} \xB7 \uB9C8\uC9C0\uB9C9 \uC5C5\uB370\uC774\uD2B8 ${quiet}\uC77C \uC804`);
  }
  const { data: reqs } = await admin.from("team_requests").select("id, title, due_date, status").eq("team_id", team_id).eq("to_id", member_id).eq("status", "open").lt("due_date", today).limit(5);
  for (const r of reqs ?? []) book.add("request", r.id, `\uC694\uCCAD '${r.title}'`, `\uAE30\uD55C ${r.due_date} \uC9C0\uB0A8 \xB7 \uC544\uC9C1 \uB2F5 \uC5C6\uC74C`);
  const { data: cis } = await admin.from("checkins").select("id, week_start").eq("team_id", team_id).eq("user_id", member_id).gte("week_start", since(28).slice(0, 10));
  const missing = Math.max(0, 4 - (cis?.length ?? 0));
  if (missing >= 2) book.add("checkin", null, "\uCCB4\uD06C\uC778", `\uCD5C\uADFC 4\uC8FC \uC911 ${missing}\uC8FC \uCCB4\uD06C\uC778 \uC5C6\uC74C${cis?.length ? ` (\uB9C8\uC9C0\uB9C9 ${weekLabel(cis.map((c) => c.week_start).sort().at(-1))})` : ""}`);
  const { data: prev } = await admin.from("coaching_notes").select("title, created_at").eq("team_id", team_id).eq("member_id", member_id).gte("created_at", since(30)).order("created_at", { ascending: false }).limit(3);
  const prevText = (prev ?? []).map((p) => `${fmtDate(p.created_at)} "${p.title}"`).join(" / ");
  if (book.size === 0) throw new HttpError(422, "NO_DATA", `${member.full_name} \uB2D8\uC758 \uCD5C\uADFC \uC5C5\uBB34 \uAE30\uB85D\uC774 \uC544\uC9C1 \uC801\uC5B4 \uCF54\uCE6D\uD560 \uC810\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.`);
  const text = [
    `\uC624\uB298: ${today} / \uD300\uC6D0: ${member.full_name}`,
    prevText ? `## \uCD5C\uADFC 30\uC77C\uC5D0 \uC774\uBBF8 \uBCF4\uB0B8 \uCF54\uCE6D (\uAC19\uC740 \uB0B4\uC6A9 \uBC18\uBCF5 \uAE08\uC9C0)
${prevText}` : "",
    book.text("\uCD5C\uADFC \uC5C5\uBB34 \uAE30\uB85D")
  ].filter(Boolean).join("\n\n");
  const { output } = await runAi({
    teamId: team_id,
    kind: "coaching",
    model: MODEL_SMART,
    system: COACH,
    content: [{ type: "text", text }],
    book,
    depth: depthOf(book.size, [2, 4, 7]),
    level: "L2",
    createdBy: caller.userId,
    subjectUserId: member_id,
    maxTokens: 1500
  });
  return json(output);
});
