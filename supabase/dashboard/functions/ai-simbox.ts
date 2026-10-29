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
  let out = "", inStr = false, esc2 = false;
  for (const c of s) {
    if (inStr) {
      if (esc2) {
        esc2 = false;
        out += c;
        continue;
      }
      if (c === "\\") {
        esc2 = true;
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
  let inStr = false, esc2 = false, good = -1, goodStack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc2) esc2 = false;
      else if (c === "\\") esc2 = true;
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

// functions/_shared/teampublic.ts
async function teamPeople(teamId) {
  const { data } = await admin.from("team_members").select("user_id, role, profiles(full_name)").eq("team_id", teamId).eq("status", "active");
  const names = (data ?? []).map((m) => ({ id: m.user_id, name: (m.profiles?.full_name ?? "").trim(), leader: m.role === "leader" }));
  return { leaderId: names.find((n) => n.leader)?.id ?? null, names };
}
var esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function maskNames(text, people, selfId) {
  if (!text) return text;
  let out = text;
  const list = [...people.names].filter((n) => n.name.length >= 2).sort((a, b) => b.name.length - a.name.length);
  for (const p of list) {
    const to = p.leader ? "\uD300\uC7A5\uB2D8" : p.id === selfId ? "\uBCF8\uC778" : "\uD300\uC6D0";
    out = out.replace(new RegExp(`${esc(p.name)}\\s*(\uB2D8|\uC528|\uD300\uC7A5\uB2D8|\uD300\uC7A5)?`, "g"), to);
    if (p.name.length === 3) {
      const given = p.name.slice(1);
      out = out.replace(new RegExp(`(^|[^\uAC00-\uD7A3])${esc(given)}(\\s*(?:\uB2D8|\uC528))`, "g"), `$1${to}`);
    }
  }
  return out.replace(/팀장님\s*팀장님/g, "\uD300\uC7A5\uB2D8").replace(/팀원\s*팀원/g, "\uD300\uC6D0");
}
var DAY = 864e5;
var since = (d) => new Date(Date.now() - d * DAY).toISOString();
var ymd = (d) => d ? String(d).slice(0, 10) : "";
function directionText(c) {
  if (!c?.sections?.length) return "";
  return c.sections.map((s) => `### ${s.title}
${s.items.map((i, n) => `${n + 1}. ${i.text}${i.why ? ` \u2014 ${i.why}` : ""}`).join("\n")}`).join("\n");
}
async function publicBasics(teamId, people) {
  const yr = (/* @__PURE__ */ new Date()).getFullYear();
  const [{ data: team }, { data: items }, { data: kh }] = await Promise.all([
    admin.from("teams").select("name").eq("id", teamId).single(),
    admin.from("work_items").select("id, parent_id, title, status, due_date, start_date, created_at, priority, num_target, unit, role, updated_at").eq("team_id", teamId).not("status", "in", "(dropped,proposed)"),
    admin.from("knowhow_cards").select("title, body, created_at, updated_at").eq("team_id", teamId).eq("active", true).eq("shared", true).neq("source", "consulting").order("updated_at", { ascending: false }).limit(10)
  ]);
  const all = items ?? [];
  const roots = all.filter((x) => !x.parent_id && x.status !== "done" && String(x.start_date ?? x.due_date ?? x.created_at).slice(0, 4) === String(yr)).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).slice(0, 4);
  const goals = roots.map((g) => {
    const kids = all.filter((x) => x.parent_id === g.id && x.role === "metric").slice(0, 3).map((m) => `${m.title}${m.num_target != null ? ` ${Number(m.num_target).toLocaleString("ko-KR")}${m.unit ?? ""}` : ""}`);
    return { title: g.title, sub: kids.join(" \xB7 ") || (g.due_date ? `${ymd(g.due_date)}\uAE4C\uC9C0` : ""), date: ymd(g.updated_at), created: ymd(g.created_at) };
  });
  return {
    team: team?.name ?? "",
    goals,
    knowhow: (kh ?? []).map((k) => ({ title: maskNames(String(k.title ?? ""), people), body: maskNames(String(k.body ?? ""), people).replace(/\s+/g, " ").slice(0, 300), created: ymd(k.created_at) }))
  };
}
function quotes(out, sources, n = 14) {
  const norm = (t) => t.replace(/[\s"'“”‘’「」.,·:;!?()\[\]-]/g, "");
  const o = norm(out);
  if (o.length < n) return false;
  const src = sources.map(norm).filter((x) => x.length >= n);
  for (let i = 0; i + n <= o.length; i++) {
    const w = o.slice(i, i + n);
    if (src.some((x) => x.includes(w))) return true;
  }
  return false;
}
async function myFeedback(teamId, userId, people) {
  const { data: subs } = await admin.from("submissions").select("id, title").eq("team_id", teamId).eq("author_id", userId).gte("updated_at", since(90)).limit(60);
  const ids = (subs ?? []).map((s) => s.id);
  const [{ data: cm }, { data: pr }, { data: co }] = await Promise.all([
    ids.length ? admin.from("review_comments").select("body, submission_id, created_at").in("submission_id", ids).neq("author_id", userId).eq("provenance", "human").order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    admin.from("observations").select("body, occurred_at").eq("team_id", teamId).eq("subject_id", userId).eq("kind", "praise").gte("occurred_at", since(120).slice(0, 10)).order("occurred_at", { ascending: false }).limit(8),
    admin.from("coaching_notes").select("title, body, created_at").eq("team_id", teamId).eq("member_id", userId).not("seen_at", "is", null).gte("created_at", since(120)).order("created_at", { ascending: false }).limit(6)
  ]);
  const title = new Map((subs ?? []).map((s) => [s.id, s.title]));
  const m = (t) => maskNames(String(t ?? ""), people, userId).replace(/\s+/g, " ").trim();
  const lines = [
    ...(cm ?? []).map((c) => `- [\uACB0\uACFC\uBB3C \uD53C\uB4DC\uBC31 \xB7 ${m(title.get(c.submission_id) ?? "")}] ${m(c.body).slice(0, 240)}`),
    ...(pr ?? []).map((p) => `- [\uCE6D\uCC2C] ${m(p.body).replace(/^\[칭찬 배지\]\s*/, "").slice(0, 200)}`),
    ...(co ?? []).map((c) => `- [\uCF54\uCE6D] ${m(c.title)}: ${m(c.body).slice(0, 240)}`)
  ];
  const raw = [...(cm ?? []).map((c) => m(c.body)), ...(pr ?? []).map((p) => m(p.body)), ...(co ?? []).map((c) => m(c.body))];
  return { text: lines.join("\n") || "(\uC544\uC9C1 \uC5C6\uC74C)", raw };
}

// functions/ai-simbox/index.ts
var CATS = ["evidence", "structure", "clarity", "priority", "reporting", "stakeholder", "planning", "idea", "data"];
var SYSTEM = `\uB2F9\uC2E0\uC740 \uD300\uC6D0 \uC804\uC6A9 \uACF5\uAC04 'Sim.Box'\uC758 \uB3C4\uC6B0\uBBF8\uC785\uB2C8\uB2E4. \uD300\uC6D0\uC774 \uD300\uC7A5\uB2D8\uAED8 \uC62C\uB9AC\uAE30 \uC804\uC5D0 \uCD08\uC548 \xB7 \uC544\uC774\uB514\uC5B4 \xB7 \uBA54\uC77C \xB7 \uBCF4\uACE0 \uBC29\uBC95\uC744 \uC790\uC720\uB86D\uAC8C \uC2DC\uBBAC\uB808\uC774\uC158\uD558\uACE0 \uBA54\uBAA8\uD558\uB294 \uACF3\uC785\uB2C8\uB2E4.
\uB9D0\uD22C: \uAC19\uC740 \uD300 \uC120\uBC30\uCC98\uB7FC \uD3B8\uD558\uACE0 \uC9E7\uAC8C, \uBD80\uB4DC\uB7EC\uC6B4 \uC874\uB313\uB9D0(~\uD574\uC694). \uC774\uBAA8\uC9C0 \xB7 \uACFC\uC7A5 \uC5C6\uC774. \uB2F5\uC740 6\uBB38\uC7A5 \uC548\uD30E(\uBB38\uC11C \uAC80\uD1A0\uC77C \uB54C\uB3C4 \uD575\uC2EC\uB9CC, \uC790\uC138\uD55C \uAC74 panel\uC5D0).

\uADFC\uAC70 \uC6D0\uCE59:
- '\uD300\uC7A5\uB2D8\uC774\uB77C\uBA74'\uC740 \uC544\uB798 \uC790\uB8CC(\uD300 \uBC29\uD5A5 \xB7 \uD300 \uBAA9\uD45C \xB7 \uB0B4\uAC00 \uBC1B\uC740 \uC758\uACAC \xB7 \uD300 \uB178\uD558\uC6B0)\uC5D0 \uB4DC\uB7EC\uB09C \uAE30\uC900\uC73C\uB85C\uB9CC \uCD94\uB860\uD569\uB2C8\uB2E4. \uC790\uB8CC\uC5D0 \uC5C6\uB294 \uD300\uC7A5\uB2D8\uC758 \uC0DD\uAC01 \xB7 \uAC10\uC815 \xB7 \uD3C9\uAC00 \xB7 \uC120\uD638\uB97C \uC9C0\uC5B4\uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
- \uC790\uB8CC\uAC00 \uC5C6\uAC70\uB098 \uC9C8\uBB38\uACFC \uAD00\uB828\uB41C \uC790\uB8CC\uAC00 \uC5C6\uC73C\uBA74 \uC194\uC9C1\uD558\uAC8C \uB9D0\uD569\uB2C8\uB2E4. \uC608: "\uC544\uC9C1 \uD300\uC7A5\uB2D8 \uAE30\uC900\uC744 \uC54C \uB9CC\uD55C \uAE30\uB85D\uC774 \uB9CE\uC9C0 \uC54A\uC544\uC11C, \uC77C\uBC18\uC801\uC778 \uAD00\uC810\uC73C\uB85C \uB9D0\uC500\uB4DC\uB9B4\uAC8C\uC694." \uC774\uB54C '\uD300\uC7A5\uB2D8\uC740 ~\uC744 \uC88B\uC544\uD558\uC2E0\uB2E4' \uAC19\uC740 \uB9D0\uC744 \uD558\uC9C0 \uC54A\uACE0, panel.questions \uB3C4 '\uBCF4\uD1B5 \uC774\uB7F0 \uC9C8\uBB38\uC774 \uB098\uC62C \uC218 \uC788\uC5B4\uC694' \uC218\uC900\uC73C\uB85C\uB9CC \uC501\uB2C8\uB2E4.
- \uC790\uB8CC\uC758 \uBB38\uC7A5\uC744 \uADF8\uB300\uB85C \uC62E\uAE30\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uB530\uC634\uD45C \uC778\uC6A9 \xB7 \uC6D0\uBB38 \uBCF5\uC0AC \uC5C6\uC774 \uB2F9\uC2E0\uC758 \uB9D0\uB85C \uD480\uC5B4\uC11C \uC9E7\uAC8C \uC501\uB2C8\uB2E4. \uCD9C\uCC98\uB97C \uBC1D\uD790 \uB54C\uB294 "\uD300 \uBC29\uD5A5\uC758 '\uC77C\uD558\uB294 \uBC29\uC2DD'\uC5D0 \uB530\uB974\uBA74"\uCC98\uB7FC \uBB36\uC74C \uC774\uB984\uB9CC \uC501\uB2C8\uB2E4.
- \uB2E4\uB978 \uD300\uC6D0 \xB7 \uC0AC\uB78C \uC774\uB984\uC740 \uC808\uB300 \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uD300\uC7A5\uB2D8\uC740 '\uD300\uC7A5\uB2D8'\uC73C\uB85C\uB9CC \uBD80\uB985\uB2C8\uB2E4.
- \uB2E4\uB978 \uC0AC\uB78C\uC5D0 \uB300\uD55C \uC815\uBCF4, \uD300\uC7A5\uB2D8\uC758 \uC0AC\uC801\uC778 \uC0DD\uAC01, \uD3C9\uAC00 \xB7 \uACE0\uACFC \xB7 \uBCF4\uC0C1 \uC608\uCE21, \uC778\uC0AC \uC815\uBCF4\uB97C \uBB3C\uC73C\uBA74 \uC815\uC911\uD788 '\uC5EC\uAE30\uC11C\uB294 \uB2F5\uD560 \uC218 \uC5C6\uB2E4'\uACE0 \uD558\uACE0, \uD560 \uC218 \uC788\uB294 \uB3C4\uC6C0\uC744 \uC81C\uC548\uD569\uB2C8\uB2E4.
- \uD300\uC6D0\uC774 \uC4F4 \uB0B4\uC6A9\uC744 \uD300\uC7A5\uB2D8\uAED8 \uC804\uD558\uAC70\uB098 \uAE30\uB85D\uD55C\uB2E4\uACE0 \uB9D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4(\uC774 \uACF5\uAC04\uC740 \uBCF8\uC778\uB9CC \uBD05\uB2C8\uB2E4).

panel: \uD300\uC6D0\uC774 \uBB38\uC11C \xB7 \uCD08\uC548 \xB7 \uBA54\uC77C \xB7 \uBCF4\uACE0 \uB0B4\uC6A9\uC744 \uBCF4\uC5EC \uC8FC\uBA70 \uC758\uACAC\uC744 \uAD6C\uD560 \uB54C\uB9CC \uCC44\uC6C1\uB2C8\uB2E4(\uADF8 \uBC16\uC758 \uC9C8\uBB38\uC774\uBA74 null).
  { "title": \uAC80\uD1A0 \uB300\uC0C1 \uC774\uB984, "questions": [{ "q": \uD300\uC7A5\uB2D8\uC774 \uBB3C\uC5B4\uBCFC \uC9C8\uBB38, "tip": \uBBF8\uB9AC \uC900\uBE44\uD560 \uAC83 }] (1~3), "fixes": [{ "t": \uBCF4\uC644\uD560 \uC810, "d": \uD55C \uC904 \uC124\uBA85 }] (0~3), "good": [{ "t": \uC798\uD55C \uC810, "d": \uD55C \uC904 }] (0~2) }
chips: \uC774\uC5B4\uC11C \uBB3C\uC5B4\uBCFC \uB9CC\uD55C \uC9E7\uC740 \uBB38\uC7A5 2~3\uAC1C (\uC608: "\uACE0\uCE5C \uBC84\uC804 \uB2E4\uC2DC \uBD10 \uC918").
digest: \uC774\uBC88 \uBA54\uC2DC\uC9C0\uC5D0 \uD30C\uC77C \xB7 \uAE34 \uAE00\uC774 \uBD99\uC5B4 \uC788\uC73C\uBA74, \uB2E4\uC74C \uB300\uD654\uC5D0\uC11C \uCC38\uACE0\uD560 \uC694\uC9C0(2000\uC790 \uC774\uB0B4). \uC5C6\uC73C\uBA74 \uBE48 \uBB38\uC790\uC5F4.
tags: \uC774 \uB300\uD654\uAC00 \uB2E4\uB8EC \uC8FC\uC81C\uB97C \uB2E4\uC74C \uC911 0~2\uAC1C \u2014 evidence(\uADFC\uAC70\xB7\uC22B\uC790) structure(\uAD6C\uC870\xB7\uACB0\uB860 \uC704\uCE58) clarity(\uBB38\uC7A5\xB7\uC804\uB2EC\uB825) priority(\uC6B0\uC120\uC21C\uC704\xB7\uBC29\uD5A5 \uD655\uC778) reporting(\uBCF4\uACE0 \uBC29\uBC95\xB7\uD0C0\uC774\uBC0D) stakeholder(\uC720\uAD00\uBD80\uC11C\xB7\uB300\uC678 \uC18C\uD1B5) planning(\uC77C\uC815\xB7\uACC4\uD68D) idea(\uC544\uC774\uB514\uC5B4 \uAD6C\uC0C1) data(\uB370\uC774\uD130 \uBD84\uC11D).
sensitive: \uB300\uD654\uC5D0 \uAC74\uAC15 \xB7 \uD1F4\uC0AC \xB7 \uC774\uC9C1 \xB7 \uAC1C\uC778 \uC0AC\uC815 \xB7 \uAC00\uC871 \xB7 \uD3C9\uAC00 \xB7 \uBCF4\uC0C1 \xB7 \uD300\uC7A5\uB2D8\uC774\uB098 \uB3D9\uB8CC\uC5D0 \uB300\uD55C \uBD88\uB9CC \xB7 \uAC08\uB4F1\uC774 \uB2F4\uACBC\uC73C\uBA74 true.
\uCD9C\uB825 JSON: { "reply": "...", "panel": {...} | null, "chips": ["..."], "digest": "", "tags": [], "sensitive": false }`;
serve(async (req) => {
  const body = await readJson(req);
  if (!body.team_id) throw new HttpError(400, "MISSING_TEAM");
  const teamId = body.team_id;
  const caller = await getCaller(req);
  if (caller.isService) throw new HttpError(403, "forbidden");
  const uid = caller.userId;
  const { data: me } = await admin.from("team_members").select("role, status").eq("team_id", teamId).eq("user_id", uid).maybeSingle();
  if (!me || me.status !== "active" || me.role !== "member") throw new HttpError(403, "forbidden", "Sim.Box\uB294 \uD300\uC6D0 \uACF5\uAC04\uC785\uB2C8\uB2E4");
  if (body.action === "reset") {
    await admin.from("simbox_messages").delete().eq("team_id", teamId).eq("user_id", uid);
    return json({ ok: true });
  }
  const text = String(body.text ?? "").trim().slice(0, 4e3);
  const att = body.attachment && (body.attachment.text || body.attachment.data) ? body.attachment : null;
  if (!text && !att) throw new HttpError(422, "EMPTY", "\uB0B4\uC6A9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694");
  if ((att?.data?.length ?? 0) > 14e6) throw new HttpError(413, "FILE_TOO_LARGE", "\uD30C\uC77C\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4 (PDF 10MB\uAE4C\uC9C0)");
  await admin.from("simbox_messages").delete().eq("user_id", uid).lt("created_at", new Date(Date.now() - 30 * 864e5).toISOString());
  const { data: bud } = await admin.rpc("ai_budget", { p_team: teamId });
  const b = bud;
  if (b && Number(b.cap_usd) > 0 && Number(b.cost_usd) >= Number(b.cap_usd)) throw new HttpError(429, "AI_COST_CAP", "\uC774\uBC88 \uB2EC \uD300\uC758 AI \uC0AC\uC6A9\uB7C9\uC744 \uBAA8\uB450 \uC37C\uC2B5\uB2C8\uB2E4. \uB2E4\uC74C \uACB0\uC81C \uC8FC\uAE30\uC5D0 \uB2E4\uC2DC \uC5F4\uB9BD\uB2C8\uB2E4.");
  const { data: take, error: te } = await admin.rpc("simbox_take", { p_team: teamId, p_user: uid });
  if (te) {
    if (/SIMBOX_LIMIT/.test(te.message)) throw new HttpError(429, "SIMBOX_LIMIT", /day/.test(`${te.hint ?? ""}`) ? "\uC624\uB298 Sim.Box \uD69F\uC218\uB97C \uBAA8\uB450 \uC37C\uC2B5\uB2C8\uB2E4. \uB0B4\uC77C \uB2E4\uC2DC \uC4F8 \uC218 \uC788\uC5B4\uC694." : "\uC774\uBC88 \uB2EC Sim.Box \uD69F\uC218\uB97C \uBAA8\uB450 \uC37C\uC2B5\uB2C8\uB2E4. \uB2E4\uC74C \uB2EC 1\uC77C\uC5D0 \uB2E4\uC2DC \uCC44\uC6CC\uC9D1\uB2C8\uB2E4.");
    throw te;
  }
  const usageId = take;
  try {
    const people = await teamPeople(teamId);
    const mask = (t) => maskNames(t, people, uid);
    const [{ data: dir }, mat, fb, { data: hist }] = await Promise.all([
      admin.from("team_directions").select("content").eq("team_id", teamId).maybeSingle(),
      publicBasics(teamId, people),
      myFeedback(teamId, uid, people),
      admin.from("simbox_messages").select("role, body, attachment, created_at").eq("team_id", teamId).eq("user_id", uid).order("created_at", { ascending: false }).limit(16)
    ]);
    const history = [...hist ?? []].reverse();
    const lastAtt = [...history].reverse().find((h) => h.attachment)?.attachment;
    const dirText = directionText(dir?.content);
    const goalsText = mat.goals.map((g) => `- ${g.title}${g.sub ? ` (${g.sub})` : ""}`).join("\n");
    const khText = mat.knowhow.map((k) => `- ${k.title}: ${k.body}`).join("\n");
    const have = [dirText && "\uD300 \uBC29\uD5A5", goalsText && "\uD300 \uBAA9\uD45C", khText && "\uD300 \uB178\uD558\uC6B0", fb.raw.length && "\uB0B4\uAC00 \uBC1B\uC740 \uC758\uACAC"].filter(Boolean);
    const ctx = [
      `## \uC790\uB8CC \uC0C1\uD0DC
${have.length ? `\uC788\uB294 \uC790\uB8CC: ${have.join(" \xB7 ")}` : "\uD300\uC7A5\uB2D8 \uAE30\uC900\uC744 \uC54C \uB9CC\uD55C \uC790\uB8CC\uAC00 \uAC70\uC758 \uC5C6\uC2B5\uB2C8\uB2E4 \u2014 \uADF8\uB807\uB2E4\uACE0 \uBA3C\uC800 \uB9D0\uD558\uACE0 \uC77C\uBC18\uC801\uC778 \uAD00\uC810\uC73C\uB85C\uB9CC \uB2F5\uD558\uC138\uC694"}${fb.raw.length + (dirText ? 1 : 0) < 2 ? " (\uD300\uC7A5\uB2D8 \uAD00\uB828 \uC790\uB8CC\uAC00 \uC801\uC74C \u2014 \uB2E8\uC815\uD558\uC9C0 \uB9D0 \uAC83)" : ""}`,
      `## \uD300 \uBC29\uD5A5
${dirText || "(\uC544\uC9C1 \uC5C6\uC74C)"}`,
      `## \uD300 \uBAA9\uD45C
${goalsText || "(\uC5C6\uC74C)"}`,
      `## \uD300 \uB178\uD558\uC6B0 (\uACF5\uC720\uB41C \uAC83)
${khText || "(\uC5C6\uC74C)"}`,
      `## \uB0B4\uAC00 \uBC1B\uC740 \uC758\uACAC \xB7 \uCE6D\uCC2C \xB7 \uCF54\uCE6D (\uBCF8\uC778\uC774 \uC774\uBBF8 \uBCF8 \uAC83)
${fb.text}`
    ].join("\n\n");
    const convo = history.map((h) => `${h.role === "user" ? "\uB098" : "Sim.Box"}: ${mask(h.body).slice(0, 1200)}${h.attachment ? ` [\uCCA8\uBD80: ${h.attachment.name ?? "\uD30C\uC77C"}]` : ""}`).join("\n");
    const content = [];
    if (att?.kind === "pdf" && att.data) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: att.data }, title: att.name ?? "\uD30C\uC77C" });
    if (att?.kind === "image" && att.data) content.push({ type: "image", source: { type: "base64", media_type: att.media_type ?? "image/jpeg", data: att.data } });
    content.push({ type: "text", text: [
      ctx,
      lastAtt && !att ? `## \uC55E\uC11C \uC62C\uB9B0 \uD30C\uC77C \u300C${lastAtt.name ?? ""}\u300D
${mask(lastAtt.digest || lastAtt.text || "").slice(0, 12e3)}` : "",
      convo ? `## \uC9C0\uAE08\uAE4C\uC9C0\uC758 \uB300\uD654
${convo}` : "",
      att?.kind === "text" && att.text ? `## \uC774\uBC88\uC5D0 \uC62C\uB9B0 \uD30C\uC77C \u300C${att.name ?? ""}\u300D
${mask(att.text).slice(0, 4e4)}` : "",
      `## \uC774\uBC88 \uBA54\uC2DC\uC9C0
${mask(text) || "(\uD30C\uC77C\uB9CC \uC62C\uB9BC \u2014 \uC774 \uC790\uB8CC\uB97C \uD300\uC7A5\uB2D8 \uAD00\uC810\uC5D0\uC11C \uBD10 \uB2EC\uB77C\uB294 \uB73B\uC73C\uB85C \uC774\uD574)"}`
    ].filter(Boolean).join("\n\n") });
    const res = await callClaude({ model: MODEL_SMART, system: SYSTEM, content, maxTokens: 2600, timeoutMs: 9e4, thinking: "fast", effort: "medium" });
    await admin.rpc("simbox_cost", { p_id: usageId, p_model: res.model, p_in: res.inputTokens, p_out: res.outputTokens, p_cost: res.costUsd });
    const out = parseJson(res.text);
    const src = [...fb.raw, ...mat.knowhow.map((k) => k.body)];
    const noQuote = (t) => t.split(/(?<=[.!?。]|요\.|다\.)\s+/).filter((x) => !quotes(x, src)).join(" ");
    const s = (v, n) => noQuote(mask(String(v ?? "")).replace(/\s*\[E\d+\]/g, "").trim()).slice(0, n);
    const panel = out.panel && typeof out.panel === "object" ? {
      title: s(out.panel.title, 80),
      questions: (out.panel.questions ?? []).slice(0, 3).map((x) => ({ q: s(x?.q, 120), tip: s(x?.tip, 200) })).filter((x) => x.q),
      fixes: (out.panel.fixes ?? []).slice(0, 3).map((x) => ({ t: s(x?.t, 80), d: s(x?.d, 200) })).filter((x) => x.t),
      good: (out.panel.good ?? []).slice(0, 2).map((x) => ({ t: s(x?.t, 80), d: s(x?.d, 200) })).filter((x) => x.t)
    } : null;
    const reply = s(out.reply, 2400) || "\uB2E4\uC2DC \uD55C \uBC88 \uB9D0\uC500\uD574 \uC8FC\uC2DC\uACA0\uC5B4\uC694?";
    const chips = (out.chips ?? []).slice(0, 3).map((c) => s(c, 40)).filter(Boolean);
    const attRow = att ? { name: String(att.name ?? "\uD30C\uC77C").slice(0, 120), kind: att.kind, text: att.kind === "text" ? String(att.text ?? "").slice(0, 3e4) : void 0, digest: s(out.digest, 2500) || void 0 } : null;
    const now = Date.now();
    const { error: ie } = await admin.from("simbox_messages").insert([
      { team_id: teamId, user_id: uid, role: "user", body: text, attachment: attRow, created_at: new Date(now).toISOString() },
      { team_id: teamId, user_id: uid, role: "assistant", body: reply, meta: { panel: panel && (panel.questions.length || panel.fixes.length || panel.good.length) ? panel : null, chips }, created_at: new Date(now + 1).toISOString() }
    ]);
    if (ie) throw ie;
    const memberCount = people.names.filter((n) => !n.leader).length;
    const tags = [...new Set((out.tags ?? []).filter((t) => CATS.includes(t)))].slice(0, 2);
    if (!out.sensitive && memberCount >= 5 && tags.length) {
      await admin.from("simbox_tags").insert(tags.map((category) => ({ team_id: teamId, user_id: uid, category })));
    }
    return json({ ok: true });
  } catch (e) {
    await admin.rpc("simbox_refund", { p_id: usageId });
    throw e;
  }
});
