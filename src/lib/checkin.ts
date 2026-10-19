// 성과 체크인 — 목표 하나에 성과를 점찍고, 팀장이 승인하면 그 항목의 공식 값이 된다 (22_checkin.sql)
//   기록은 업무 카드(submissions.kind = 'checkin')로 남아 업무플랫폼 흐름 · 스레드 · 승인 · 알림 · 성과 근거를 그대로 쓴다
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, errorText } from './supabase';
import { useToast } from '../components/ui';
import { useTeam } from '../state/session';
import type { CheckinPayload, CheckinType, Submission, SubmissionVersion, WorkItem } from './types';

/** 항목의 측정 방식으로 기본 체크인 종류 */
export function checkinTypeFor(n: Pick<WorkItem, 'measure'>): CheckinType {
  if (n.measure === 'number') return 'number';
  if (n.measure === 'percent') return 'percent';
  if (n.measure === 'stage') return 'stage';
  if (n.measure === 'check') return 'done';
  return 'note';
}

const num = (v: number | null | undefined) => (v == null ? '-' : Number.isInteger(v) ? v.toLocaleString('ko-KR') : String(Math.round(v * 100) / 100));

/** 지금 공식 값 (예: '7억' · '40%' · '초안' · '진행 중') */
export function currentLabel(n: Pick<WorkItem, 'measure' | 'num_current' | 'unit' | 'progress' | 'stages' | 'stage_current' | 'status'>): string {
  if (n.measure === 'number') return n.num_current == null ? '기록 없음' : `${num(n.num_current)}${n.unit}`;
  if (n.measure === 'stage') return n.stage_current ? (n.stages ?? [])[n.stage_current - 1] ?? `${n.stage_current}단계` : '시작 전';
  if (n.measure === 'check') return n.status === 'done' ? '완료' : '진행 중';
  return `${n.progress}%`;
}

/** 체크인이 말하는 새 값 */
export function payloadLabel(c: CheckinPayload, n?: Pick<WorkItem, 'unit' | 'stages'> | null): string {
  if (c.type === 'number') return `${num(c.value)}${n?.unit ?? ''}`;
  if (c.type === 'percent') return `${num(c.value)}%`;
  if (c.type === 'stage') return (n?.stages ?? [])[(c.stage ?? 1) - 1] ?? `${c.stage}단계`;
  if (c.type === 'done') return '완료';
  return '성과 기록';
}

/** 새 값이면 목표 대비 몇 % (숫자·퍼센트·단계만) */
export function payloadPct(c: CheckinPayload, n?: Pick<WorkItem, 'num_target' | 'higher_is_better' | 'stages'> | null): number | null {
  if (c.type === 'percent') return c.value ?? null;
  if (c.type === 'done') return 100;
  if (c.type === 'stage') { const len = n?.stages?.length ?? 0; return len ? Math.round((100 * (c.stage ?? 0)) / len) : null; }
  if (c.type === 'number' && n?.num_target && c.value != null) {
    const p = n.higher_is_better === false ? (100 * n.num_target) / (c.value || 1) : (100 * c.value) / n.num_target;
    return Math.max(0, Math.min(100, Math.round(p)));
  }
  return c.type === 'note' && c.progress != null ? c.progress : null;
}

export type CheckinRow = Submission & { submission_versions: Pick<SubmissionVersion, 'id' | 'version' | 'note' | 'checkin' | 'created_at'>[] };

/** 한 항목의 체크인 이력 (오래된 것부터) */
export function useItemCheckins(itemId: string | null | undefined) {
  const { team } = useTeam();
  return useQuery({
    queryKey: ['checkins-item', team.id, itemId], enabled: !!itemId,
    queryFn: () => q<CheckinRow[]>(supabase.from('submissions').select('*, submission_versions(id, version, note, checkin, created_at)')
      .eq('team_id', team.id).eq('item_id', itemId!).eq('kind', 'checkin').order('created_at').limit(60)),
  });
}

/** 팀 전체: 승인 대기 체크인이 있는 항목 (팀목표 줄 표시용) */
export function usePendingCheckins() {
  const { team } = useTeam();
  return useQuery({
    queryKey: ['checkins-pending', team.id],
    queryFn: async () => {
      const rows = await q<{ item_id: string | null }[]>(supabase.from('submissions').select('item_id').eq('team_id', team.id).eq('kind', 'checkin').eq('status', 'in_review').is('closed_at', null));
      const m = new Map<string, number>();
      for (const r of rows) if (r.item_id) m.set(r.item_id, (m.get(r.item_id) ?? 0) + 1);
      return m;
    },
  });
}

export const latestPayload = (s: { submission_versions?: { version: number; checkin?: CheckinPayload | null }[] }) =>
  [...(s.submission_versions ?? [])].sort((a, b) => b.version - a.version)[0]?.checkin ?? null;

/** 체크인 올리기 — 기본은 내 스페이스(그룹 스페이스에서 열면 그 그룹) */
export function useCreateCheckin() {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (p: { item: Pick<WorkItem, 'id' | 'title'>; payload: CheckinPayload; note: string; spaceId?: string | null; groupId?: string | null; resubmit?: { id: string; version: number } }) => {
      if (p.resubmit) {
        // 보완 요청 받은 체크인을 고쳐서 다시 (새 버전)
        await q(supabase.from('submission_versions').insert({
          submission_id: p.resubmit.id, team_id: team.id, version: p.resubmit.version + 1, mime_type: 'text/plain', extracted_text: p.note, note: p.note, created_by: uid,
          value: p.payload.type === 'number' || p.payload.type === 'percent' ? p.payload.value ?? null : null, checkin: p.payload,
        }));
        return { id: p.resubmit.id } as Submission;
      }
      const label = p.payload.label ?? '';
      const sub = await q<Submission>(supabase.from('submissions').insert({
        team_id: team.id, author_id: uid, item_id: p.item.id, kind: 'checkin', request_type: 'approval',
        title: `체크인 · ${p.item.title}${label ? ` ${label}` : ''}`.slice(0, 120),
        ...(p.groupId ? { group_id: p.groupId } : { space_id: p.spaceId ?? uid }),
      }).select().single());
      await q(supabase.from('submission_versions').insert({
        submission_id: sub.id, team_id: team.id, version: 1, mime_type: 'text/plain', extracted_text: p.note, note: p.note, created_by: uid,
        value: p.payload.type === 'number' || p.payload.type === 'percent' ? p.payload.value ?? null : null, checkin: p.payload,
      }));
      return sub;
    },
    onSuccess: () => {
      toast('체크인을 올렸습니다. 팀장님이 승인하면 팀목표에 반영됩니다.');
      qc.invalidateQueries({ queryKey: ['space-delta'] });
      ['checkins-item', 'checkins-pending', 'member-badges', 'review-queue'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ['subs'], predicate: (x) => x.queryKey[2] !== 'space' });
    },
    onError: (e) => toast(errorText(e).includes('submissions_kind_check') || errorText(e).includes('checkin') ? '체크인 SQL(22_checkin.sql)을 먼저 실행해 주세요.' : errorText(e)),
  });
}

/** 팀장: 승인 (성과 기록형은 진척률을 함께 정할 수 있다) · 보완 */
export function useDecideCheckin() {
  const { team } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (p: { id: string; ok: boolean; progress?: number | null }) => {
      if (p.ok) await q(supabase.rpc('approve_checkin', { p_sub: p.id, p_progress: p.progress ?? null }));
      else await q(supabase.from('submissions').update({ status: 'needs_work' }).eq('id', p.id));
    },
    onSuccess: (_d, p) => {
      toast(p.ok ? '승인했습니다. 팀목표에 반영됐습니다.' : '보완을 요청했습니다.');
      ['items', 'checkins-item', 'checkins-pending', 'sub', 'subs', 'space-delta', 'review-queue'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ['items', team.id] });
    },
    onError: (e) => toast(errorText(e)),
  });
}
