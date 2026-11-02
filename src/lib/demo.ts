// 데모 링크 — 관리자가 승인한 7일짜리 개인 링크(/demo?t=…)로 데모 팀에 들어온 상태
//   localStorage 'ateam.demo' = { token, expires_at, as } · invoke 가 x-demo-token 헤더로 보낸다
import { supabase, invoke } from './supabase';

export interface DemoState { token: string; expires_at: string; as: 'leader' | 'member'; name?: string }
const KEY = 'ateam.demo';

export function getDemo(): DemoState | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as DemoState | null; } catch { return null; }
}
function setDemo(d: DemoState | null) {
  try { if (d) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); } catch { /* 저장소 없음 */ }
}

/** 링크로 데모 팀장(또는 팀원) 계정에 들어간다 — 비밀번호 없이 일회용 로그인 값으로 */
export async function enterDemo(token: string, as: 'leader' | 'member' = 'leader', member?: string) {
  const r = await invoke<{ token_hash: string; expires_at: string; as: 'leader' | 'member'; name: string }>('demo-access', { action: 'enter', token, as, member });
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  const { error } = await supabase.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
  if (error) throw error;
  setDemo({ token, expires_at: r.expires_at, as: r.as, name: r.name });
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
