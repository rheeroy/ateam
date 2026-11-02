// 팀원이 대화에서 물은 결정 — 의사결정 보드의 '팀원 요청' 카드 원천 (팀장만)
//   DB가 표현으로 후보를 걸러 두고(decision_asks.status = 'candidate'), 팀장 화면이 열릴 때 후보가 있으면
//   ai-decision-asks 가 진짜 결정 요청만 'ask'로 올린다. 팀장이 그 대화에 답하면 DB가 'answered'로 내린다.
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, invoke } from './supabase';

export interface DecisionAsk {
  id: string; src_table: 'space_messages' | 'review_comments'; src_id: string; author_id: string;
  space_user: string | null; group_id: string | null; root_id: string | null; submission_id: string | null; item_id: string | null;
  body: string; ai: { title: string; options?: string[]; due?: string | null } | null; created_at: string;
}

const lastScan = new Map<string, number>();   // 팀별 마지막 판별 (10분에 한 번)

export function useDecisionAsks(teamId: string | undefined, enabled: boolean) {
  const qc = useQueryClient();
  const asks = useQuery({
    queryKey: ['decision-asks', teamId], enabled: enabled && !!teamId, staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data, error } = await supabase.from('decision_asks').select('id, src_table, src_id, author_id, space_user, group_id, root_id, submission_id, item_id, body, ai, created_at')
        .eq('team_id', teamId!).eq('status', 'ask').gte('created_at', since).order('created_at', { ascending: false }).limit(30);
      return error ? [] : (data as DecisionAsk[]);   // 45_decision_asks.sql 전이면 빈 목록
    },
  });
  const pending = useQuery({
    queryKey: ['decision-asks-pending', teamId], enabled: enabled && !!teamId, staleTime: 5 * 60_000,
    queryFn: async () => { const { data, error } = await supabase.rpc('decision_ask_pending', { p_team: teamId }); return error ? 0 : Number(data ?? 0); },
  });
  useEffect(() => {
    if (!teamId || !pending.data) return;
    const t = lastScan.get(teamId) ?? 0;
    if (Date.now() - t < 10 * 60_000) return;
    lastScan.set(teamId, Date.now());
    invoke('ai-decision-asks', { team_id: teamId })
      .then(() => { qc.invalidateQueries({ queryKey: ['decision-asks', teamId] }); qc.invalidateQueries({ queryKey: ['decision-asks-pending', teamId] }); })
      .catch(() => { /* 한도 · 데모 제한이면 다음에 */ });
  }, [teamId, pending.data, qc]);
  return asks.data ?? [];
}

/** 카드에서 원래 대화로 */
export function askHref(a: DecisionAsk): string {
  if (a.src_table === 'review_comments') return `/work/${a.submission_id}`;
  const root = a.root_id ?? a.src_id;
  return a.group_id ? `/work/g/${a.group_id}?msg=${root}` : `/work/u/${a.space_user}?msg=${root}`;
}
