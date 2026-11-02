// 공통 HTTP 유틸: CORS, JSON 응답, 오류 코드
import { AsyncLocalStorage } from 'node:async_hooks';

/** 요청별 값 — 데모 링크 토큰(x-demo-token) · 인증 헤더 · 요청 출처. gateway 의 데모 AI 한도와 CORS가 읽는다 */
export const reqCtx = new AsyncLocalStorage<{ demoToken: string | null; auth: string; origin: string | null }>();

// 허용 출처: APP_ORIGIN 에 쉼표로 여러 개 (예: https://leada.team,https://app.leada.team). 비어 있으면 모두 허용
const ORIGINS = (Deno.env.get('APP_ORIGIN') ?? '*').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
function allowOrigin(origin: string | null): string {
  if (!ORIGINS.length || ORIGINS.includes('*')) return '*';
  if (origin && ORIGINS.includes(origin.replace(/\/$/, ''))) return origin;
  return ORIGINS[0];
}
const BASE_CORS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-demo-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
/** 지금 요청에 맞는 CORS 헤더 (요청 출처가 허용 목록에 있으면 그 출처를 돌려준다) */
export function cors(origin?: string | null): Record<string, string> {
  const o = origin !== undefined ? origin : reqCtx.getStore()?.origin ?? null;
  return { ...BASE_CORS, 'Access-Control-Allow-Origin': allowOrigin(o), Vary: 'Origin' };
}
/** 예전 이름 — 직접 쓰는 곳이 있으면 첫 허용 출처 기준 */
export const corsHeaders = { ...BASE_CORS, 'Access-Control-Allow-Origin': allowOrigin(null) };

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** 핸들러를 감싸 CORS·오류 응답을 일관되게 처리한다 */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve((req) => reqCtx.run({ demoToken: req.headers.get('x-demo-token'), auth: req.headers.get('Authorization') ?? '', origin: req.headers.get('Origin') }, async () => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req.headers.get('Origin')) });
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      // Postgres 예외 코드를 그대로 전달 (INSUFFICIENT_CREDITS, PLAN_FEATURE 등)
      const known = msg.match(/(INSUFFICIENT_CREDITS|CORE_LIMIT|PLAN_FEATURE|PLAN_LIMIT_\w+|DEMO_READONLY|forbidden)/);
      if (known) return json({ error: known[1], message: known[1] === 'DEMO_READONLY' ? '데모에서는 할 수 없는 작업입니다' : msg }, known[1] === 'forbidden' || known[1] === 'DEMO_READONLY' ? 403 : 402);
      console.error(e);
      return json({ error: 'INTERNAL', message: msg }, 500);
    }
  }));
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'BAD_JSON');
  }
}
