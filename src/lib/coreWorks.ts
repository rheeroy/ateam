// 핵심 업무 — 해마다 이름이 다른 과제를 AI가 같은 일의 연속으로 묶고 여러 해의 흐름을 정리한 것 (팀장만 · 전달하면 사본으로)
//   데이터: core_works · core_work_items · core_work_chapters · core_work_state (46_core_works.sql)
//   묶기 · 장 접기 · 정리: ai-core-works (매주 월요일 06:30 자동 · [지금 정리]) — 팀장 승인 없이 모두 자동
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, invoke, errorText } from './supabase';
import { useTeam } from '../state/session';
import { useToast } from '../components/ui';

export type CLine = { text: string; year?: number | null; since?: number | null; when?: string | null };
export interface CoreContent {
  summary?: string;
  eras?: { name: string; from: string; to: string | null }[];
  principles?: CLine[]; recurring?: CLine[]; tried?: CLine[]; people?: CLine[]; open?: CLine[]; cautions?: CLine[]; gaps?: CLine[];
}
export interface CoreWork { id: string; team_id: string; title: string; summary: string; content: CoreContent; since_year: number | null; synced_at: string | null; updated_at: string }
export interface CoreLink { item_id: string; core_work_id: string; reason: string; linked_at: string }
export interface CoreChapter { id: string; core_work_id: string | null; item_id: string | null; year: number; title: string; owner_name: string; period: string; content: { summary?: string; key?: string } }
export interface CoreState { status: 'ready' | 'running' | 'failed'; started_at: string | null; finished_at: string | null; actions: { at: string; core_work_id: string | null; text: string }[] }
/** 화면 · 전달 사본에 쓰는 한 해 칸 */
export type CoreTask = { year: number; title: string; status: 'done' | 'active' | 'blocked'; item_id?: string | null; key?: string };
export interface CoreSnapshot { kind: 'core'; title: string; summary?: string; since_year: number | null; content: CoreContent; tasks: CoreTask[] }

export function useCoreWorks() {
  const { team, isLeader } = useTeam();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['core-works', team.id], enabled: isLeader,
    queryFn: async () => {
      const [c, l, ch, st] = await Promise.all([
        supabase.from('core_works').select('*').eq('team_id', team.id).order('updated_at', { ascending: false }),
        supabase.from('core_work_items').select('item_id, core_work_id, reason, linked_at').eq('team_id', team.id),
        supabase.from('core_work_chapters').select('id, core_work_id, item_id, year, title, owner_name, period, content').eq('team_id', team.id).order('year'),
        supabase.from('core_work_state').select('status, started_at, finished_at, actions').eq('team_id', team.id).maybeSingle(),
      ]);
      // 46_core_works.sql 전이면 빈 상태로
      if (c.error) return { cores: [] as CoreWork[], links: [] as CoreLink[], chapters: [] as CoreChapter[], state: null as CoreState | null };
      return { cores: (c.data ?? []) as CoreWork[], links: (l.data ?? []) as CoreLink[], chapters: (ch.data ?? []) as CoreChapter[], state: (st.data ?? null) as CoreState | null };
    },
    // 정리 중이면 끝날 때까지 10초마다
    refetchInterval: (qy) => (qy.state.data?.state?.status === 'running' ? 10_000 : false),
  });
  const running = q.data?.state?.status === 'running';
  const toast = useToast();
  const run = useMutation({
    mutationFn: () => invoke('ai-core-works', { team_id: team.id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['core-works', team.id] }); toast('핵심 업무를 다시 정리하는 중입니다. 1~2분 뒤 반영됩니다.'); },
    onError: (e) => toast(errorText(e)),
  });
  return { ...q, running, run };
}

/** 한 핵심 업무의 연도별 칸 — 접힌 장(끝난 과제) + 지금 묶여 있는 진행 중 과제 */
export function coreTasks(coreId: string, chapters: CoreChapter[], links: CoreLink[], items: { id: string; title: string; status: string; start_date: string | null; due_date: string | null; created_at: string }[]): CoreTask[] {
  const chs = chapters.filter((c) => c.core_work_id === coreId);
  const folded = new Set(chs.map((c) => c.item_id).filter(Boolean));
  const live = links.filter((l) => l.core_work_id === coreId && !folded.has(l.item_id)).map((l) => items.find((i) => i.id === l.item_id)).filter((i): i is NonNullable<typeof i> => !!i);
  return [
    ...chs.map((c) => ({ year: c.year, title: c.title, status: 'done' as const, item_id: c.item_id, key: c.content?.key })),
    ...live.map((i) => ({ year: Number((i.start_date ?? i.due_date ?? i.created_at).slice(0, 4)), title: i.title, status: (i.status === 'blocked' ? 'blocked' : i.status === 'done' ? 'done' : 'active') as CoreTask['status'], item_id: i.id })),
  ].sort((a, b) => a.year - b.year);
}
