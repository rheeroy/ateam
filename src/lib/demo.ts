// 데모 링크 — 관리자가 승인한 7일짜리 개인 링크(/demo?t=…)로 데모 팀에 들어온 상태
//   localStorage 'ateam.demo' = { token, expires_at, as } · invoke 가 x-demo-token 헤더로 보낸다
import { supabase, invoke } from './supabase';

export interface DemoState { token: string; expires_at: string; as: 'leader' | 'member'; name?: string; team?: string }
const KEY = 'ateam.demo';

export function getDemo(): DemoState | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as DemoState | null; } catch { return null; }
}
function setDemo(d: DemoState | null) {
  try { if (d) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); } catch { /* 저장소 없음 */ }
}

/** 링크로 데모 팀장(또는 팀원) 계정에 들어간다 — 비밀번호 없이 일회용 로그인 값으로 */
export async function enterDemo(token: string, as: 'leader' | 'member' = 'leader', member?: string, team?: string) {
  const r = await invoke<{ token_hash: string; expires_at: string; as: 'leader' | 'member'; name: string; team?: string }>('demo-access', { action: 'enter', token, as, member, team });
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  const { error } = await supabase.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
  if (error) throw error;
  setDemo({ token, expires_at: r.expires_at, as: r.as, name: r.name, team: r.team });
  try { localStorage.removeItem('ateam.team'); } catch { /* 저장소 없음 */ }
  window.location.replace(r.as === 'member' ? '/my/submissions' : '/');
}

/** 데모를 끝내고 나간다 (가입하러 가거나 링크가 만료됐을 때) */
export async function leaveDemo(to = '/login?mode=signup') {
  setDemo(null);
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  window.location.replace(to);
}

/** 링크가 아직 유효한가 (앱을 열 때 한 번) */
export async function checkDemo(token: string): Promise<boolean> {
  try { await invoke('demo-access', { action: 'check', token }); return true; } catch { return false; }
}

/** 데모 팀 목록 (데모 띠의 팀 고르기) */
export async function demoTeams(token: string): Promise<{ key: string; label: string; name: string }[]> {
  try { return (await invoke<{ teams: { key: string; label: string; name: string }[] }>('demo-access', { action: 'teams', token })).teams ?? []; } catch { return []; }
}

// 팀 직무 — 고른 직무의 데모 팀이 열린다 (데모 띠에서 다른 팀으로 바꿔 볼 수도 있음)
export const DEPTS: [string, string][] = [['marketing', '마케팅 · 기획'], ['sales', '영업'], ['dev', '제품 · IT 개발'], ['hr', '인사'], ['finance', '재무 · 회계'], ['strategy', '경영기획 · 전략'], ['scm', '구매 · SCM'], ['quality', '생산 · 품질'], ['cs', '고객지원 (CS)'], ['rnd', '연구개발 (R&D)']];
