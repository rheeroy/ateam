// 시작하기(온보딩) 상태 — teams.settings.onboarding = { status: 'pending' | 'done', step, plan_applied }
import { supabase, q } from './supabase';

export interface OnboardingState { status?: 'pending' | 'done'; step?: 1 | 2 | 3; plan_applied?: string }

export const onboardingOf = (settings: Record<string, unknown> | undefined): OnboardingState =>
  (settings?.onboarding ?? {}) as OnboardingState;

/** 새 팀의 팀장은 '시작하기'를 마치거나 건너뛰기 전까지 /setup 으로 간다 */
export const onboardingPending = (settings: Record<string, unknown> | undefined) => onboardingOf(settings).status === 'pending';

/** 다른 설정을 덮어쓰지 않도록 최신 settings 를 읽어 onboarding 만 고친다 */
export async function saveOnboarding(teamId: string, patch: OnboardingState) {
  const { data } = await supabase.from('teams').select('settings').eq('id', teamId).single();
  const settings = (data?.settings as Record<string, unknown>) ?? {};
  await q(supabase.from('teams').update({ settings: { ...settings, onboarding: { ...onboardingOf(settings), ...patch } } }).eq('id', teamId));
}

/** 초대할 때 적는 강점·보완할 점 → 초대장에 담아 두면, 팀원이 합류할 때 팀장 개인 메모(AI 참고)로 옮겨진다 (팀원에게는 보이지 않음) */
export const inviteNote = (strength: string, weak: string) =>
  [strength.trim() && `강점: ${strength.trim()}`, weak.trim() && `보완할 점: ${weak.trim()}`].filter(Boolean).join('\n');

export async function saveInviteNote(teamId: string, token: string, note: string) {
  if (!note) return;
  await q(supabase.from('invitations').update({ leader_note: note.slice(0, 2000) }).eq('team_id', teamId).eq('token', token));
}
