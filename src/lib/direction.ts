// 팀 방향 — ATEAM이 팀 목표 · 팀장 요청 · 피드백 · 공유한 위에서 온 것에서 정리한 '팀이 지금 중요하게 보는 것' (41_workspace_plus.sql)
//   열 때 정리한 지 7일이 지났거나 아직 없으면 서버에 새로 정리해 달라고 하고, 끝날 때까지 몇 초마다 다시 읽는다
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, invoke } from './supabase';

export interface DirectionItem { text: string; why?: string; source?: string; date?: string; repeat?: number; new?: boolean }
export interface DirectionSection { key: string; title: string; sub?: string; items: DirectionItem[] }
export interface DirectionContent { title?: string; generated_at?: string; sections?: DirectionSection[] }
export interface DirectionRow { team_id: string; content: DirectionContent; status: 'ready' | 'running' | 'failed'; started_at: string | null; updated_at: string }

const WEEK = 7 * 86400000;

export function useTeamDirection(teamId: string, opts: { refresh?: boolean } = { refresh: true }) {
  const qc = useQueryClient();
  const asked = useRef(false);
  const row = useQuery({
    queryKey: ['team-direction', teamId],
    queryFn: () => q<DirectionRow | null>(supabase.from('team_directions').select('*').eq('team_id', teamId).maybeSingle()),
    refetchInterval: (qr) => (qr.state.data?.status === 'running' ? 4000 : false),
    retry: false,
  });
  const d = row.data;
  const stale = !row.isLoading && !row.isError && (!d || !d.content?.sections?.length || Date.now() - Date.parse(d.updated_at) > WEEK || d.status === 'failed');
  useEffect(() => {
    if (!opts.refresh || !stale || asked.current || d?.status === 'running') return;
    asked.current = true;
    invoke('ai-team-direction', { team_id: teamId }).catch(() => { /* 다음에 다시 */ }).finally(() => qc.invalidateQueries({ queryKey: ['team-direction', teamId] }));
  }, [stale, d?.status, teamId, qc, opts.refresh]);
  return row;
}

export async function refreshDirection(teamId: string) {
  await invoke('ai-team-direction', { team_id: teamId, force: true });
}

/** 모든 항목을 한 줄로 (번호는 문서 순서) */
export const allItems = (c?: DirectionContent | null) => (c?.sections ?? []).flatMap((s) => s.items.map((i) => ({ ...i, section: s.key })));
