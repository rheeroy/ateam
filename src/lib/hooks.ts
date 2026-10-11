import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, invoke, errorText } from './supabase';
import type { AiKind, AiOutput } from './types';
import { useToast } from '../components/ui';
import { useSession } from '../state/session';

interface AiFilter { ref_table?: string; ref_id?: string | null; subject?: string | null; period_start?: string | null }

/** 조건에 맞는 가장 최근 AI 출력 1건 */
export function useLatestAi<C = Record<string, unknown>>(teamId: string | undefined, kind: AiKind, f: AiFilter = {}, enabled = true) {
  return useQuery({
    queryKey: ['ai', teamId, kind, f],
    enabled: !!teamId && enabled,
    queryFn: async () => {
      let qb = supabase.from('ai_outputs').select('*').eq('team_id', teamId!).eq('kind', kind);
      if (f.ref_table) qb = qb.eq('ref_table', f.ref_table);
      if (f.ref_id) qb = qb.eq('ref_id', f.ref_id);
      if (f.subject) qb = qb.eq('subject_user_id', f.subject);
      if (f.period_start) qb = qb.eq('period_start', f.period_start);
      const rows = await q<AiOutput<C>[]>(qb.order('created_at', { ascending: false }).limit(1));
      return rows[0] ?? null;
    },
  });
}

/** Edge Function으로 AI 생성 → 관련 쿼리 갱신 */
export function useGenerate(fn: string, invalidate: unknown[][] = [['ai']]) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => invoke<AiOutput>(fn, body),
    onSuccess: () => {
      invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      qc.invalidateQueries({ queryKey: ['credits'] });
      qc.invalidateQueries({ queryKey: ['insight'] });
    },
    onError: (e) => toast(errorText(e)),
  });
}

/** AI 출력 수정·확정 */
export function useUpdateAi() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (p: { id: string; edited_content?: unknown; status?: 'final' | 'edited' }) => {
      const patch: Record<string, unknown> = {};
      if (p.edited_content !== undefined) patch.edited_content = p.edited_content;
      if (p.status) patch.status = p.status;
      return q(supabase.from('ai_outputs').update(patch).eq('id', p.id).select().single());
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['ai'] });
      toast(v.status === 'final' ? '확정했습니다' : '수정본을 저장했습니다. AI 원본은 따로 보관됩니다.');
    },
    onError: (e) => toast(errorText(e)),
  });
}

/** 팀원(팀장 제외) 목록 */
export function useTeamMembersOnly() {
  const { members } = useSession();
  return members.filter((m) => m.role === 'member');
}
