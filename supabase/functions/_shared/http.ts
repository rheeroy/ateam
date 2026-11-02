// 공통 HTTP 유틸: CORS, JSON 응답, 오류 코드
import { AsyncLocalStorage } from 'node:async_hooks';

/** 요청별 값 — 데모 링크 토큰(x-demo-token)과 인증 헤더. gateway 의 데모 AI 한도가 읽는다 */
export const reqCtx = new AsyncLocalStorage<{ demoToken: string | null; auth: string }>();
export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-demo-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** 핸들러를 감싸 CORS·오류 응답을 일관되게 처리한다 */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve((req) => reqCtx.run({ demoToken: req.headers.get('x-demo-token'), auth: req.headers.get('Authorization') ?? '' }, async () => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
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
