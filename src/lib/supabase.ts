import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anon);

export const supabase = createClient(url ?? 'http://localhost:54321', anon ?? 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** supabase 응답에서 data를 꺼내고 error면 throw */
export async function q<T>(p: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new AppError(error.message, error.code);
  return data as T;
}

export class AppError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

const KNOWN: Record<string, string> = {
  INSUFFICIENT_CREDITS: '프리미엄 크레딧이 부족합니다. 설정 > 요금제에서 추가할 수 있습니다.',
  AI_LOCKED: 'AI 기능은 Pro에서 쓸 수 있습니다. 설정 > 요금제에서 시작하세요.',
  CORE_LIMIT: '이번 달 기본 AI 사용량을 모두 썼습니다. 다음 달에 다시 채워집니다.',
  NO_REVIEW: '공유·숫자 업데이트는 AI 검토 대상이 아닙니다.',
  PLAN_FEATURE: '현재 요금제에서는 쓸 수 없는 기능입니다.',
  PLAN_LIMIT_MEMBERS: '요금제의 팀원 수 한도에 도달했습니다.',
  PLAN_LIMIT_TEAMS: '요금제에서 만들 수 있는 팀 수를 넘었습니다.',
  INVITE_EXPIRED: '초대 링크가 만료됐습니다. 팀장에게 새 링크를 요청하세요.',
  INVITE_USED: '이미 사용된 초대 링크입니다.',
  INVITE_NOT_FOUND: '초대 링크를 찾을 수 없습니다.',
  NO_DATA: '아직 쌓인 기록이 없습니다.',
  NO_GOALS: '전략 목표를 먼저 등록해 주세요.',
  INSUFFICIENT_DATA: '실적이 2개월 이상 쌓여야 해석할 수 있습니다.',
  AI_NOT_CONFIGURED: 'AI 키가 설정되지 않았습니다 (Supabase secrets: ANTHROPIC_API_KEY).',
  ALREADY_HAS_GOALS: '이미 전략 목표가 있습니다.',
  forbidden: '권한이 없습니다.',
  '팀장 승인 전에는': '팀장 승인 전에는 진행 상태로 바꿀 수 없습니다.',
};

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message
    : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message
    : typeof e === 'string' ? e : '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  for (const [k, v] of Object.entries(KNOWN)) if (msg.includes(k)) return v;
  return msg;
}

/** Edge Function 호출 (오류 본문까지 읽어서 사람이 읽을 메시지로) */
export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // 함수에 아예 닿지 못함 (배포 안 됨·이름 다름·APP_ORIGIN 불일치로 CORS 차단·시간 초과)
    if ((error as { name?: string }).name === 'FunctionsFetchError') {
      throw new AppError(`AI 서버 함수 '${name}'에 연결하지 못했습니다. Supabase Edge Functions에 '${name}' 이름으로 배포돼 있는지, APP_ORIGIN 값이 앱 주소와 같은지 확인해 주세요.`);
    }
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        detail = j.error ? `${j.error}: ${j.message ?? ''}` : JSON.stringify(j);
      } catch { /* ignore */ }
    }
    throw new AppError(detail);
  }
  return data as T;
}
