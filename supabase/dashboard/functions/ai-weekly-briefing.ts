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
var fmtDate = (d) => d ? d.slice(0, 10) : "";
var weekLabel = (d) => {
  const dt = new Date(d);
  const onejan = new Date(dt.getFullYear(), 0, 1);
  const w = Math.ceil(((dt.getTime() - onejan.getTime()) / 864e5 + onejan.getDay() + 1) / 7);
  return `W${String(w).padStart(2, "0")}`;
};

// functions/_shared/prompts/index.ts
var BRIEFING = `\uACFC\uC81C: \uC6D4\uC694\uC77C \uC544\uCE68 \uD300\uC7A5\uC5D0\uAC8C \uBCF4\uB0B4\uB294 \uC9C0\uB09C\uC8FC \uD300 \uBE0C\uB9AC\uD551\uC744 \uC501\uB2C8\uB2E4.
\uC9C0\uB09C\uC8FC \uAE30\uB85D \uC911 '\uBC14\uB010 \uAC83'\uACFC '\uBC18\uBCF5\uB418\uB294 \uAC83'\uB9CC \uACE0\uB985\uB2C8\uB2E4. \uD3C9\uBC94\uD55C \uC9C4\uD589 \uC0C1\uD669\uC740 \uBE7C\uC138\uC694.
\uC6B0\uC120\uC21C\uC704: \uC0AC\uB78C \uBB38\uC81C(\uB9C9\uD798 \uBC18\uBCF5, \uCEE8\uB514\uC158 \uD558\uB77D) > \uC77C\uC815 \uC704\uD5D8 > \uC81C\uCD9C\uB41C \uACB0\uACFC\uBB3C > \uAE30\uD0C0.

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "items": [{"headline": "\uAD75\uAC8C \uBCF4\uC77C \uD55C \uBB38\uC7A5", "detail": "\uBCF4\uCDA9 \uD55C \uBB38\uC7A5(\uADFC\uAC70 \uD0DC\uADF8 \uD3EC\uD568)", "link": "review | one_on_one | report | checkin | strategy | none"}],
  "one_line": "\uC774\uBC88 \uC8FC\uB97C \uD55C \uC904\uB85C"
}
items \uB294 3~5\uAC1C, \uC911\uC694\uD55C \uC21C\uC11C.`;

// functions/ai-weekly-briefing/index.ts
async function briefTeam(teamId, createdBy) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const book = new SourceBook();
  const { data: members } = await admin.from("team_members").select("user_id, profiles(full_name)").eq("team_id", teamId).eq("status", "active");
  const nameOf = new Map((members ?? []).map((m) => [m.user_id, m.profiles?.full_name ?? ""]));
  const { data: checkins } = await admin.from("checkins").select("id, user_id, week_start, did, blocked, condition").eq("team_id", teamId).gte("updated_at", since);
  for (const c of checkins ?? []) {
    book.add(
      "checkin",
      c.id,
      `\uCCB4\uD06C\uC778 ${nameOf.get(c.user_id)} ${weekLabel(c.week_start)}`,
      `\uD55C \uC77C: ${c.did} / \uB9C9\uD798: ${c.blocked || "\uC5C6\uC74C"} / \uCEE8\uB514\uC158 ${c.condition ?? "-"}`
    );
  }
  const prevWeek = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data: prevChecks } = await admin.from("checkins").select("id, user_id, week_start, blocked, condition").eq("team_id", teamId).gte("updated_at", prevWeek).lt("updated_at", since);
  for (const c of prevChecks ?? []) {
    book.add("checkin", c.id, `\uC9C0\uB09C\uC8FC \uCCB4\uD06C\uC778 ${nameOf.get(c.user_id)}`, `\uB9C9\uD798: ${c.blocked || "\uC5C6\uC74C"} / \uCEE8\uB514\uC158 ${c.condition ?? "-"}`);
  }
  const { data: oos } = await admin.from("one_on_ones").select("id, member_id, scheduled_at, shared_notes").eq("team_id", teamId).eq("status", "done").gte("scheduled_at", since);
  for (const o of oos ?? []) book.add("one_on_one", o.id, `1:1 ${nameOf.get(o.member_id)} ${fmtDate(o.scheduled_at)}`, o.shared_notes);
  const { data: vers } = await admin.from("submission_versions").select("id, version, note, submissions(title, author_id)").eq("team_id", teamId).gte("created_at", since);
  for (const v of vers ?? []) {
    const s = v.submissions;
    const { data: rv } = await admin.from("ai_outputs").select("content").eq("ref_table", "submission_versions").eq("ref_id", v.id).maybeSingle();
    book.add(
      "submission",
      v.id,
      `\uC81C\uCD9C ${s?.title} v${v.version} (${nameOf.get(s?.author_id)})`,
      `${v.note} ${rv?.content?.summary ?? ""}`
    );
  }
  const { data: tasks } = await admin.from("work_items").select("id, title, status, progress, due_date, owner_id, base_due, replan_count").eq("team_id", teamId).in("status", ["active", "blocked"]).not("parent_id", "is", null).neq("measure", "check").limit(40);
  for (const t of tasks ?? []) {
    book.add("task", t.id, `\uACFC\uC81C ${t.title}`, `\uC0C1\uD0DC ${t.status === "blocked" ? "\uB9C9\uD798" : "\uC9C4\uD589"}, \uC9C4\uCC99 ${t.progress}%, \uB9C8\uAC10 ${t.due_date ?? "-"}${t.base_due && t.due_date && t.base_due !== t.due_date ? ` (\uCC98\uC74C \uACC4\uD68D ${t.base_due}, \uBCC0\uACBD ${t.replan_count}\uD68C)` : ""}, \uB2F4\uB2F9 ${nameOf.get(t.owner_id) ?? "-"}`);
  }
  const { data: radar } = await admin.rpc("care_radar", { p_team: teamId });
  for (const r of radar ?? []) {
    book.add("signal", r.user_id, `\uCF00\uC5B4 \uC2E0\uD638 ${r.full_name}`, r.signals.map((s) => s.label).join(", "));
  }
  if (book.size === 0) return null;
  await addKnowhow(book, teamId, "briefing", 1500);
  const memberCount = (members ?? []).filter((m) => m.user_id).length - 1;
  const submitted = new Set((checkins ?? []).map((c) => c.user_id)).size;
  const conds = (checkins ?? []).map((c) => c.condition).filter((x) => typeof x === "number");
  const avg = conds.length ? Math.round(conds.reduce((a, b) => a + b, 0) / conds.length * 10) / 10 : null;
  const { output } = await runAi({
    teamId,
    kind: "briefing",
    model: MODEL_SMART,
    system: BRIEFING,
    content: [{ type: "text", text: `\uACC4\uC0B0\uB41C \uAC12: \uCCB4\uD06C\uC778 ${submitted}/${memberCount}\uBA85 \uC81C\uCD9C, \uD3C9\uADE0 \uCEE8\uB514\uC158 ${avg ?? "-"}

${book.knowhowText()}

${book.text("\uC9C0\uB09C 7\uC77C \uAE30\uB85D")}` }],
    book,
    depth: depthOf(book.size, [5, 12, 25]),
    level: "L2",
    createdBy,
    periodStart: since.slice(0, 10),
    periodEnd: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    maxTokens: 1e3,
    extra: { stats: { submitted, members: memberCount, avg_condition: avg }, counts: book.byType() }
  });
  return output;
}
serve(async (req) => {
  const body = await readJson(req);
  const caller = await getCaller(req);
  if (body.all) {
    if (!caller.isService) throw new HttpError(403, "forbidden");
    const { data: teams } = await admin.from("teams").select("id");
    const results = {};
    for (const t of teams ?? []) {
      try {
        const out2 = await briefTeam(t.id, null);
        results[t.id] = out2 ? "ok" : "empty";
      } catch (e) {
        results[t.id] = e instanceof Error ? e.message.slice(0, 80) : "error";
      }
    }
    return json({ results });
  }
  if (!body.team_id) throw new HttpError(400, "MISSING_TEAM");
  await assertLeader(caller, body.team_id);
  const out = await briefTeam(body.team_id, caller.userId);
  if (!out) throw new HttpError(422, "NO_DATA", "\uC9C0\uB09C 7\uC77C \uB3D9\uC548 \uC313\uC778 \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4");
  return json(out);
});
