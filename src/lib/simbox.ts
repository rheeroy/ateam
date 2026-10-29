// Sim.Box — 팀원 혼자 쓰는 시뮬레이션 · 메모 공간 (41_workspace_plus.sql · ai-simbox)
//   대화는 본인만 읽는다. 팀장에게는 정해진 분류의 팀 전체 합계만 (simbox_trends)
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, invoke } from './supabase';

export interface SimPanel { title: string; questions: { q: string; tip?: string }[]; fixes: { t: string; d?: string }[]; good: { t: string; d?: string }[] }
export interface SimMessage {
  id: string; role: 'user' | 'assistant'; body: string; created_at: string;
  attachment: { name: string; kind?: string } | null;
  meta: { panel?: SimPanel | null; chips?: string[] } | null;
}
export interface SimQuota { limit: number; used: number; remaining: number; daily_limit: number; day_used: number; day_remaining: number; trial: boolean }
export interface SimAttachment { name: string; kind: 'text' | 'pdf' | 'image'; text?: string; data?: string; media_type?: string }

export function useSimMessages(teamId: string, uid: string) {
  return useQuery({
    queryKey: ['simbox', teamId, uid],
    queryFn: () => q<SimMessage[]>(supabase.from('simbox_messages').select('id, role, body, attachment, meta, created_at').eq('team_id', teamId).eq('user_id', uid).order('created_at').limit(200)),
    retry: false,
  });
}
export function useSimQuota(teamId: string) {
  return useQuery({ queryKey: ['simbox-quota', teamId], queryFn: () => q<SimQuota>(supabase.rpc('simbox_quota', { p_team: teamId })), retry: false });
}
export function useSimSend(teamId: string, uid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { text: string; attachment?: SimAttachment | null }) => invoke('ai-simbox', { team_id: teamId, action: 'send', text: p.text, attachment: p.attachment ?? null }),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['simbox', teamId, uid] }); qc.invalidateQueries({ queryKey: ['simbox-quota', teamId] }); },
  });
}
export function useSimReset(teamId: string, uid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke('ai-simbox', { team_id: teamId, action: 'reset' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['simbox', teamId, uid] }),
  });
}

/** 팀장용 — 이름 없는 팀 전체 합계 */
export const SIM_CATS: Record<string, string> = {
  evidence: '근거 · 숫자 보완', structure: '구조 · 결론 위치', clarity: '문장 · 전달력', priority: '우선순위 · 방향 확인', reporting: '보고 방법 · 타이밍',
  stakeholder: '유관부서 · 대외 소통', planning: '일정 · 계획', idea: '아이디어 구상', data: '데이터 분석',
};
export interface SimTrends { available: boolean; reason?: string; rows?: { category: string; share: number }[] }
export function useSimTrends(teamId: string) {
  return useQuery({ queryKey: ['simbox-trends', teamId], queryFn: () => q<SimTrends>(supabase.rpc('simbox_trends', { p_team: teamId, p_days: 30 })), retry: false, staleTime: 300_000 });
}
