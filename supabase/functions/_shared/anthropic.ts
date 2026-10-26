// Claude API 호출 (Messages API). 모델명은 환경변수로 바꿀 수 있다.
import { HttpError } from './http.ts';

export const MODEL_SMART = Deno.env.get('AI_MODEL_SMART') ?? 'claude-sonnet-5-5';
export const MODEL_FAST = Deno.env.get('AI_MODEL_FAST') ?? 'claude-sonnet-5-5';

// USD / 100만 토큰 (2026-10 기준 공개 단가). 원가 기록용이며 과금은 크레딧으로 한다.
const PRICE: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export type Block =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } };

export interface ClaudeResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function callClaude(opts: {
  model: string;
  system: string;
  content: Block[];
  maxTokens?: number;
  temperature?: number;
}): Promise<ClaudeResult> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new HttpError(500, 'AI_NOT_CONFIGURED', 'ANTHROPIC_API_KEY 가 설정되지 않았습니다');

  const body = {
    model: opts.model,
    // 상한은 '쓸 수 있는 최대'일 뿐 원가는 실제 출력만큼 — 너무 낮으면 모델이 생각만 하다 답을 못 쓴다
    max_tokens: Math.max(opts.maxTokens ?? 2000, 3000),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    // 시스템 프롬프트는 기능마다 고정이므로 캐시한다
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: opts.content }],
  };

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${Deno.env.get('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      const text = (data.content ?? [])
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('');
      // 빈 응답(출력 한도에 걸림 등)이면 한도를 늘려 다시 시도
      if (!text.trim() && attempt < 2) {
        lastErr = `empty response (stop: ${data.stop_reason ?? '-'})`;
        body.max_tokens = Math.min(12000, body.max_tokens * 2);
        continue;
      }
      const u = data.usage ?? {};
      const p = PRICE[opts.model] ?? PRICE['claude-sonnet-5-5'];
      const cost =
        ((u.input_tokens ?? 0) * p.in +
          (u.output_tokens ?? 0) * p.out +
          (u.cache_read_input_tokens ?? 0) * p.cacheRead +
          (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
        1_000_000;
      return {
        text,
        model: data.model ?? opts.model,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        costUsd: Math.round(cost * 100000) / 100000,
      };
    }
    lastErr = `${res.status} ${await res.text()}`;
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }
  throw new HttpError(502, 'AI_UPSTREAM', lastErr.slice(0, 500));
}

/** 응답에서 JSON 객체를 꺼낸다 (```json 펜스나 앞뒤 설명이 섞여도) */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0) throw new HttpError(502, 'AI_BAD_OUTPUT', text.trim() ? text.slice(0, 300) : 'AI 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요.');
  if (end > start) {
    try {
      return JSON.parse(src.slice(start, end + 1)) as T;
    } catch { /* 아래에서 다시 시도 */ }
    // 문자열 안에 줄바꿈·탭을 그대로 넣어 보낸 경우 (본문이 긴 글에서 잦다) — 이스케이프해서 다시
    try {
      return JSON.parse(escapeControls(src.slice(start, end + 1))) as T;
    } catch { /* 아래에서 잘린 JSON 복구 시도 */ }
  }
  // 출력이 중간에 잘렸으면 마지막 온전한 항목까지 살려서 닫는다
  const fixed = closeTruncated(escapeControls(src.slice(start)));
  if (fixed) {
    try {
      return JSON.parse(fixed) as T;
    } catch { /* 복구 실패 */ }
  }
  throw new HttpError(502, 'AI_BAD_OUTPUT', text.slice(0, 300));
}

/** JSON 문자열 값 안의 날 줄바꿈 · 탭 · CR 을 이스케이프한다 (문자열 밖은 그대로) */
function escapeControls(s: string): string {
  let out = '', inStr = false, esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) { esc = false; out += c; continue; }
      if (c === '\\') { esc = true; out += c; continue; }
      if (c === '"') { inStr = false; out += c; continue; }
      out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : c;
      continue;
    }
    if (c === '"') inStr = true;
    out += c;
  }
  return out;
}

/** 잘린 JSON: 마지막으로 끝난 값까지 자르고 열린 괄호를 닫는다 */
function closeTruncated(s: string): string | null {
  const stack: string[] = [];
  let inStr = false, esc = false, good = -1, goodStack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === ',' && stack.length) { good = i; goodStack = stack.slice(); }
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      good = i + 1; goodStack = stack.slice();
      if (!stack.length) return s.slice(0, good);
    }
  }
  if (good < 0) return null;
  return s.slice(0, good) + goodStack.reverse().join('');
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
