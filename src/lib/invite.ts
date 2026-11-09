// 팀원 초대 메일 — invite-mail 함수(Resend)가 초대받은 주소로 합류 링크를 보낸다
import { invoke, errorText } from './supabase';

/** 보냈으면 null · 못 보냈으면 사람이 읽을 이유 (초대 자체는 그대로 유효하다) */
export async function mailInvite(token: string): Promise<string | null> {
  try { await invoke('invite-mail', { token }); return null; } catch (e) { return errorText(e); }
}
