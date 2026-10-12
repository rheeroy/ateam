// 홈 인사이트: 규칙·모델 신호(브라우저에서 계산) + AI 인사이트(일·주·월, Edge Function이 만든 것)
// 신호 엔진은 Edge Function과 같은 코드를 쓴다 → supabase/functions/_shared/signals.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { TeamMember } from './types';
import { analyze, loadRaw, type RawMember } from '../../supabase/functions/_shared/signals';

export * from '../../supabase/functions/_shared/signals';

export const TYPE_META = {
  risk: { label: '리스크', cls: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500' },
  missed: { label: '놓친 것', cls: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  forecast: { label: '전망', cls: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
  pattern: { label: '패턴', cls: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
  good: { label: '좋은 신호', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  data: { label: '데이터 보강', cls: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
} as const;

export const toRawMembers = (members: TeamMember[]): RawMember[] =>
  members.filter((m) => m.status === 'active').map((m) => ({ user_id: m.user_id, name: m.profiles?.full_name ?? '팀원', role: m.role }));

export function useHomeInsights(teamId: string, uid: string, members: TeamMember[], minEvidence: number) {
  return useQuery({
    queryKey: ['home-insights', teamId, uid, members.length],
    queryFn: async () => analyze(await loadRaw(supabase, teamId, uid, minEvidence), toRawMembers(members)),
    staleTime: 60_000,
  });
}
