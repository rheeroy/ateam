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
function toBase64(bytes) {
  let bin = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// functions/_shared/gateway.ts
var BASE_RULES = `\uB2F9\uC2E0\uC740 \uD55C\uAD6D \uAE30\uC5C5 \uD300\uC7A5\uC758 \uC131\uACFC\uAD00\uB9AC\uB97C \uB3D5\uB294 \uBCF4\uC870\uC790\uC785\uB2C8\uB2E4. \uBC18\uB4DC\uC2DC \uC9C0\uD0AC \uC6D0\uCE59:
1. \uC8FC\uC5B4\uC9C4 \uAE30\uB85D\uC5D0 \uC788\uB294 \uC0AC\uC2E4\uB9CC \uC501\uB2C8\uB2E4. \uAE30\uB85D\uC5D0 \uC5C6\uB294 \uC22B\uC790\xB7\uC0AC\uAC74\xB7\uD3C9\uAC00\uB97C \uB9CC\uB4E4\uC5B4 \uB0B4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
2. \uC0AC\uB78C\uC5D0 \uB300\uD55C \uD310\uB2E8\uC774\uB098 \uD3C9\uAC00\uB294 \uADFC\uAC70 \uD0DC\uADF8(\uC608: [E3])\uB97C \uBD99\uC5EC\uC11C\uB9CC \uB9D0\uD569\uB2C8\uB2E4. \uADFC\uAC70\uAC00 \uBAA8\uC790\uB77C\uBA74 "\uADFC\uAC70 \uBD80\uC871"\uC774\uB77C\uACE0 \uC501\uB2C8\uB2E4.
3. \uC22B\uC790\uB294 \uC785\uB825\uC5D0 \uC8FC\uC5B4\uC9C4 \uACC4\uC0B0 \uACB0\uACFC\uB9CC \uC778\uC6A9\uD569\uB2C8\uB2E4. \uC0C8\uB85C \uACC4\uC0B0\uD558\uAC70\uB098 \uCD94\uC815\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
4. \uC810\uC218\uB85C \uC0AC\uB78C\uC744 \uC904 \uC138\uC6B0\uAC70\uB098 \uBE44\uAD50\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
5. \uBB38\uCCB4: \uD55C\uAD6D \uAE30\uC5C5 \uC2E4\uBB34 \uBCF4\uACE0\uC11C\uCC98\uB7FC \uC9E7\uACE0 \uB2F4\uBC31\uD558\uAC8C, '~\uD569\uB2C8\uB2E4'\uCCB4. \uACFC\uC7A5, \uAC10\uD0C4, \uC601\uC5B4 \uC9C1\uC5ED\uD22C, \uC774\uBAA8\uC9C0\uB294 \uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
6. \uCD9C\uB825\uC740 \uC694\uCCAD\uD55C JSON \uAC1D\uCCB4 \uD558\uB098\uB9CC. \uC55E\uB4A4 \uC124\uBA85\uC774\uB098 \uCF54\uB4DC \uD39C\uC2A4\uB97C \uBD99\uC774\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.
7. '\uD300\uC7A5\uC758 \uAE30\uC900' \uC139\uC158\uC774 \uC788\uC73C\uBA74 \uADF8 \uAE30\uC900\uC744 \uC77C\uBC18\uC801\uC778 \uC0C1\uC2DD\uBCF4\uB2E4 \uC6B0\uC120\uD574 \uC801\uC6A9\uD558\uACE0, \uAE30\uC900\uC744 \uC801\uC6A9\uD55C \uBB38\uC7A5\uC5D0\uB294 \uD574\uB2F9 \uADFC\uAC70 \uD0DC\uADF8\uB97C \uBD99\uC785\uB2C8\uB2E4. \uAE30\uC900\uACFC \uAE30\uB85D\uC774 \uC5B4\uAE0B\uB098\uBA74 \uADF8 \uC810\uC744 \uC9DA\uC2B5\uB2C8\uB2E4.
8. 'ATEAM \uD50C\uB808\uC774\uBD81' \uC139\uC158\uC740 \uC774 \uC0C1\uD669\uC5D0 \uB9DE\uCDB0 \uACE0\uB978 \uAC80\uC99D\uB41C \uC5C5\uBB34 \uBC29\uBC95\uB860\uC785\uB2C8\uB2E4. \uC77C\uBC18 \uC0C1\uC2DD\uBCF4\uB2E4\uB294 \uC6B0\uC120\uD558\uB418 '\uD300\uC7A5\uC758 \uAE30\uC900'\uACFC \uC5B4\uAE0B\uB098\uBA74 \uD300\uC7A5\uC758 \uAE30\uC900\uC744 \uB530\uB985\uB2C8\uB2E4. \uC2E4\uC81C\uB85C \uC774 \uAE30\uB85D\uC5D0 \uB4E4\uC5B4\uB9DE\uB294 \uBC29\uBC95\uB860\uB9CC \uC4F0\uACE0, \uC801\uC6A9\uD55C \uBB38\uC7A5\uC5D0\uB294 \uD574\uB2F9 \uADFC\uAC70 \uD0DC\uADF8\uB97C \uBD99\uC785\uB2C8\uB2E4. \uBC29\uBC95\uB860 \uC774\uB984\uC744 \uB298\uC5B4\uB193\uAC70\uB098 \uC774\uB860\uC744 \uC124\uBA85\uD558\uC9C0 \uB9D0\uACE0, \uAE30\uB85D\uC5D0 \uBE44\uCD98 \uAD6C\uCCB4\uC801\uC778 \uD310\uB2E8\uACFC \uD589\uB3D9\uC73C\uB85C \uC501\uB2C8\uB2E4.`;
async function assertCredits(teamId, need) {
  const { data, error } = await admin.rpc("credit_status", { p_team: teamId });
  if (error) throw error;
  if (!(data?.features ?? []).includes("ai_premium")) throw new HttpError(402, "AI_LOCKED", "AI \uAE30\uB2A5\uC740 Pro\uC5D0\uC11C \uC4F8 \uC218 \uC788\uC2B5\uB2C8\uB2E4");
  const left = (data?.monthly_remaining ?? 0) + (data?.topup_remaining ?? 0);
  if (left < need) throw new HttpError(402, "INSUFFICIENT_CREDITS", `\uD06C\uB808\uB527\uC774 \uBD80\uC871\uD569\uB2C8\uB2E4 (\uD544\uC694 ${need}, \uB0A8\uC74C ${left})`);
}

// functions/_shared/prompts/index.ts
var INGEST = `\uACFC\uC81C: \uD300\uC7A5\uC774 \uB358\uC838 \uB123\uC740 \uC790\uB8CC(\uBA54\uBAA8, \uBB38\uC11C, \uD504\uB808\uC784\uC6CC\uD06C, \uD3C9\uAC00 \uAE30\uC900, \uC0AC\uC5C5 \uD604\uD669 \uB4F1)\uB97C \uC77D\uACE0,
AI\uAC00 \uC55E\uC73C\uB85C \uC774 \uD300\uC7A5\uC758 \uC77C\uC744 \uB3C4\uC6B8 \uB54C \uCC38\uACE0\uD560 '\uB178\uD558\uC6B0 \uCE74\uB4DC'\uB85C \uC815\uB9AC\uD569\uB2C8\uB2E4.
\uCE74\uB4DC\uB294 \uD300\uC7A5\uC758 \uC0DD\uAC01\uACFC \uAE30\uC900\uC744 \uADF8\uB300\uB85C \uB2F4\uC544\uC57C \uD569\uB2C8\uB2E4. \uC77C\uBC18\uB860\uC73C\uB85C \uBC14\uAFB8\uAC70\uB098, \uC790\uB8CC\uC5D0 \uC5C6\uB294 \uB0B4\uC6A9\uC744 \uB367\uBD99\uC774\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.

\uCE74\uB4DC \uC885\uB958(kind):
- principle: \uC77C\uD558\uB294 \uC6D0\uCE59\xB7\uD310\uB2E8 \uAE30\uC900 (\uC608: \uC22B\uC790 \uC5C6\uB294 \uBCF4\uACE0\uB294 \uBC1B\uC9C0 \uC54A\uB294\uB2E4)
- rubric: \uACB0\uACFC\uBB3C\xB7\uC0AC\uB78C\uC744 \uD3C9\uAC00\uD558\uB294 \uAE30\uC900, \uC88B\uC740 \uACB0\uACFC\uBB3C\uC758 \uC870\uAC74, \uC5ED\uB7C9 \uC815\uC758
- framework: \uC5C5\uBB34 \uD504\uB808\uC784\uC6CC\uD06C\xB7\uD15C\uD50C\uB9BF\xB7\uBCF4\uACE0 \uC591\uC2DD\xB7\uBB38\uC81C \uD574\uACB0 \uC21C\uC11C
- context: \uC870\uC9C1\xB7\uC0AC\uC5C5\xB7\uACE0\uAC1D\xB7\uC2DC\uC7A5\xB7\uC0C1\uC704 \uC804\uB7B5 \uB4F1 \uBC30\uACBD \uC9C0\uC2DD
- coaching: \uD300 \uC6B4\uC601\xB71on1\xB7\uD53C\uB4DC\uBC31\xB7\uCF54\uCE6D \uBC29\uC2DD
- glossary: \uD300\uC5D0\uC11C \uC4F0\uB294 \uC6A9\uC5B4\xB7\uC57D\uC5B4\uC758 \uB73B

\uC801\uC6A9\uCC98(applies_to, \uD574\uB2F9\uD558\uB294 \uAC83 \uBAA8\uB450):
- review: \uD300\uC6D0 \uACB0\uACFC\uBB3C 1\uCC28 \uAC80\uD1A0
- prep: 1on1 \uC900\uBE44 \uB178\uD2B8
- report: \uC8FC\uAC04\uBCF4\uACE0 \uCD08\uC548
- evaluation: \uD3C9\uAC00 \uC758\uACAC \uCD08\uC548
- briefing: \uC6D4\uC694\uC77C \uD300 \uBE0C\uB9AC\uD551
- strategy: \uBD84\uAE30 \uC804\uB7B5 \uC810\uAC80
- scenario: What-if \uD574\uC11D
- plan: \uBAA9\uD45C\xB7\uACFC\uC81C \uACC4\uD68D \uCD08\uC548\uACFC \uC218\uC815

\uCD9C\uB825 JSON \uD615\uC2DD:
{
  "summary": "\uC774 \uC790\uB8CC\uAC00 \uBB34\uC5C7\uC778\uC9C0 1~2\uBB38\uC7A5",
  "cards": [
    {"kind": "principle", "title": "\uC9E7\uC740 \uC81C\uBAA9(20\uC790 \uC774\uB0B4)", "body": "\uC694\uC810 2~4\uBB38\uC7A5", "rules": ["AI\uAC00 \uADF8\uB300\uB85C \uC801\uC6A9\uD560 \uC9E7\uC740 \uADDC\uCE59"], "applies_to": ["review", "report"], "keywords": ["\uD0A4\uC6CC\uB4DC"]}
  ]
}
cards \uB294 1~12\uAC1C. \uAC19\uC740 \uB0B4\uC6A9\uC740 \uD558\uB098\uB85C \uD569\uCE69\uB2C8\uB2E4. rules \uB294 \uCE74\uB4DC\uB2F9 1~5\uAC1C, \uAC01 40\uC790 \uC774\uB0B4\uC758 \uBA85\uB839\uD615 \uBB38\uC7A5.
\uC790\uB8CC\uAC00 \uAC1C\uC778\uC815\uBCF4(\uC8FC\uBBFC\uBC88\uD638, \uC5F0\uBD09 \uB4F1)\uB97C \uB2F4\uACE0 \uC788\uC73C\uBA74 \uADF8 \uBD80\uBD84\uC740 \uCE74\uB4DC\uC5D0 \uC62E\uAE30\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`;

// functions/ai-ingest-knowhow/index.ts
var CREDITS = 2;
var KINDS = ["principle", "rubric", "framework", "context", "coaching", "glossary"];
var FEATURES = ["review", "prep", "report", "evaluation", "briefing", "strategy", "scenario", "plan"];
serve(async (req) => {
  const { source_id } = await readJson(req);
  if (!source_id) throw new HttpError(400, "MISSING_ID");
  const caller = await getCaller(req);
  const src = must(await admin.from("knowhow_sources").select("*").eq("id", source_id).maybeSingle());
  await assertLeader(caller, src.team_id);
  await assertCredits(src.team_id, CREDITS);
  await admin.from("knowhow_sources").update({ status: "processing", error: null }).eq("id", src.id);
  try {
    const content = [];
    if (src.mime_type === "application/pdf" && src.file_path) {
      const { data: file, error } = await admin.storage.from("knowhow").download(src.file_path);
      if (error) throw error;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, "FILE_TOO_LARGE");
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) }, title: src.title || src.file_name || "\uC790\uB8CC" });
    } else if (!src.raw_text.trim()) {
      throw new HttpError(422, "NO_TEXT", "\uB0B4\uC6A9\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4");
    }
    content.push({ type: "text", text: [
      `\uC790\uB8CC \uC81C\uBAA9: ${src.title || src.file_name || "(\uC81C\uBAA9 \uC5C6\uC74C)"}`,
      src.raw_text.trim() ? `## \uC790\uB8CC \uBCF8\uBB38
${src.raw_text.slice(0, 6e4)}` : "## \uC790\uB8CC \uBCF8\uBB38\n(\uCCA8\uBD80 PDF)"
    ].join("\n\n") });
    const res = await callClaude({ model: MODEL_SMART, system: `${BASE_RULES}

${INGEST}`, content, maxTokens: 3e3 });
    const out = parseJson(res.text);
    const rows = (out.cards ?? []).slice(0, 12).filter((c) => c.title && KINDS.includes(c.kind)).map((c) => ({
      team_id: src.team_id,
      owner_id: src.owner_id,
      source_id: src.id,
      kind: c.kind,
      title: String(c.title).slice(0, 60),
      body: String(c.body ?? "").slice(0, 800),
      rules: (c.rules ?? []).map((r) => String(r).slice(0, 80)).slice(0, 5),
      applies_to: (c.applies_to ?? []).filter((f) => FEATURES.includes(f)),
      keywords: (c.keywords ?? []).map(String).slice(0, 8),
      provenance: "ai"
    }));
    if (rows.length) {
      const { error } = await admin.from("knowhow_cards").insert(rows);
      if (error) throw error;
    }
    await admin.from("knowhow_sources").update({ status: "done", summary: out.summary ?? "", card_count: rows.length }).eq("id", src.id);
    await admin.rpc("consume_credits", {
      p_team: src.team_id,
      p_credits: CREDITS,
      p_kind: "knowhow_ingest",
      p_ai_output: null,
      p_model: res.model,
      p_in: res.inputTokens,
      p_out: res.outputTokens,
      p_cost: res.costUsd
    });
    return json({ source_id: src.id, summary: out.summary, cards: rows.length });
  } catch (e) {
    await admin.from("knowhow_sources").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "error" }).eq("id", src.id);
    throw e;
  }
});
