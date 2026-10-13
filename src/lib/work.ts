// 업무플랫폼: 결과물 + 최신 버전 + 그 버전의 AI 1차 검토를 한 번에
import { useQuery } from '@tanstack/react-query';
import { supabase, q } from './supabase';
import type { Submission, WorkItem } from './types';
import type { Node } from './items';

export interface AiReview {
  depth_score: number; summary: string;
  strengths: { section: string; text: string }[]; gaps: { section: string; text: string }[];
  questions: string[]; change_from_previous?: string; trend_note?: string;
  criteria_check?: { criterion: string; met: boolean; note: string; tag?: string }[];
}
export interface SubRow extends Submission {
  submission_versions: { id: string; version: number; created_at: string }[];
  latest: { id: string; version: number; created_at: string } | null;
  review: AiReview | null; reviewedAt: string | null;
}

export function useSubmissionsAi(teamId: string, f: { authorId?: string; itemIds?: string[] } = {}) {
  return useQuery({
    queryKey: ['subs', teamId, 'ai', f.authorId ?? '', (f.itemIds ?? []).length],
    queryFn: async () => {
      let qb = supabase.from('submissions').select('*, submission_versions(id, version, created_at)').eq('team_id', teamId);
      if (f.authorId) qb = qb.eq('author_id', f.authorId);
      const subs = await q<(Submission & { submission_versions: SubRow['submission_versions'] })[]>(qb.order('updated_at', { ascending: false }).limit(200));
      const rows: SubRow[] = subs.map((s) => {
        const latest = [...s.submission_versions].sort((a, b) => b.version - a.version)[0] ?? null;
        return { ...s, latest, review: null, reviewedAt: null };
      });
      const ids = rows.map((r) => r.latest?.id).filter(Boolean) as string[];
      if (ids.length) {
        const ais = await q<{ ref_id: string; content: AiReview; edited_content: AiReview | null; created_at: string }[]>(
          supabase.from('ai_outputs').select('ref_id, content, edited_content, created_at').eq('team_id', teamId).eq('kind', 'review')
            .eq('ref_table', 'submission_versions').in('ref_id', ids).order('created_at', { ascending: false }));
        const by = new Map<string, (typeof ais)[number]>();
        for (const a of ais) if (!by.has(a.ref_id)) by.set(a.ref_id, a);
        for (const r of rows) { const a = r.latest ? by.get(r.latest.id) : undefined; if (a) { r.review = a.edited_content ?? a.content; r.reviewedAt = a.created_at; } }
      }
      return rows;
    },
  });
}

/** 결과물이 걸린 목표 › 과제 경로 — 정기 업무(루틴)이면 'routine' */
export function chainOf(itemId: string | null, byId: Map<string, Node>): { kind: 'goal' | 'routine' | 'none'; root: Node | null; path: Node[] } {
  const it = itemId ? byId.get(itemId) : null;
  if (!it) return { kind: 'none', root: null, path: [] };
  const path = [...it.path.map((id) => byId.get(id)).filter(Boolean) as Node[], it];
  const routine = path.some((n) => n.measure === 'recurring' || !!n.recur);
  return { kind: routine ? 'routine' : 'goal', root: path[0] ?? null, path };
}

export const isRoutine = (n: Pick<WorkItem, 'measure' | 'recur'>) => n.measure === 'recurring' || !!n.recur;
