// 내 메모 — 팀장 전용 메모. 저장은 한 곳(leader_notes), 붙이는 곳은 여러 군데(팀원 · 목표/과제 · 임원 · 결정 · 1on1)
//   관찰 메모(observations, 평가 근거)와 다릅니다 — 평가에 쓰지 않고, 팀원에게 보이지 않습니다.
//   'AI 참고 허용'을 켠 메모만 1on1 준비 노트 · 팀원 액션 · ATEAM의 제안 · 임원 브리핑이 읽습니다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, errorText } from './supabase';
import { useTeam } from '../state/session';
import { useToast } from '../components/ui';

export type AnchorType = 'none' | 'member' | 'item' | 'exec' | 'decision' | 'one_on_one';
export interface Anchor { type: AnchorType; id: string | null; label?: string }
export interface LeaderNote {
  id: string; team_id: string; owner_id: string; body: string; kind: 'note' | 'todo'; done: boolean;
  anchor_type: AnchorType; anchor_id: string | null; anchor_label: string; pinned: boolean; ai_allowed: boolean; tags: string[]; created_at: string; updated_at: string;
}
export const ANCHOR_LABEL: Record<AnchorType, string> = { none: '연결 안 함', member: '팀원', item: '목표·과제', exec: '상위 관리자', decision: '결정', one_on_one: '1on1' };

/** 어디서든 빠른 메모 창 열기 — 상단바 [메모] 버튼, 각 화면의 '할 일로' */
export const OPEN_NOTE = 'ateam:open-note';
export interface OpenNoteDetail { anchor?: Anchor; note?: LeaderNote; kind?: 'note' | 'todo' }
export const openQuickNote = (d: OpenNoteDetail = {}) => window.dispatchEvent(new CustomEvent<OpenNoteDetail>(OPEN_NOTE, { detail: d }));

/** 새 메모의 'AI 참고 허용' 기본값 — 이 브라우저에만 기억 */
const AI_DEFAULT_KEY = 'ateam:note-ai-default';
export function getAiDefault(): boolean { try { return localStorage.getItem(AI_DEFAULT_KEY) === '1'; } catch { return false; } }
export function setAiDefault(v: boolean) { try { localStorage.setItem(AI_DEFAULT_KEY, v ? '1' : '0'); } catch { /* 저장 불가 환경 */ } }

const TABLE_MISSING = (e: unknown) => /leader_notes|anchor_label/.test(errorText(e));

export function useNotes(anchor?: Anchor) {
  const { team, uid } = useTeam();
  return useQuery({
    queryKey: ['notes', team.id, uid, anchor?.type ?? 'all', anchor?.id ?? ''],
    queryFn: async () => {
      let qb = supabase.from('leader_notes').select('*').eq('team_id', team.id).eq('owner_id', uid);
      if (anchor) qb = anchor.id ? qb.eq('anchor_type', anchor.type).eq('anchor_id', anchor.id) : qb.eq('anchor_type', anchor.type);
      const { data, error } = await qb.order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(300);
      if (error) { if (TABLE_MISSING(error)) return [] as LeaderNote[]; throw new Error(error.message); }
      return data as LeaderNote[];
    },
  });
}

export function useNoteMutations() {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const done = () => qc.invalidateQueries({ queryKey: ['notes', team.id] });
  const fail = (e: unknown) => toast(TABLE_MISSING(e) ? '메모 테이블이 아직 최신이 아닙니다. 12_leader_notes.sql 을 실행해 주세요.' : errorText(e));
  const save = useMutation({
    mutationFn: async (n: Partial<LeaderNote> & { body: string }) => {
      const anchored = !!n.anchor_type && n.anchor_type !== 'none';
      const row = {
        body: n.body.trim(), kind: n.kind ?? 'note', anchor_type: n.anchor_type ?? 'none', anchor_id: anchored ? n.anchor_id ?? null : null, anchor_label: anchored ? n.anchor_label ?? '' : '',
        pinned: n.pinned ?? false, done: n.done ?? false, ai_allowed: n.ai_allowed ?? getAiDefault(), updated_at: new Date().toISOString(),
      };
      const r = n.id
        ? await supabase.from('leader_notes').update(row).eq('id', n.id)
        : await supabase.from('leader_notes').insert({ ...row, team_id: team.id, owner_id: uid });
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: done, onError: fail,
  });
  const patch = useMutation({
    mutationFn: async (p: { id: string } & Partial<Pick<LeaderNote, 'pinned' | 'done' | 'ai_allowed'>>) => {
      const { id, ...rest } = p;
      const { error } = await supabase.from('leader_notes').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: done, onError: fail,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('leader_notes').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: done, onError: fail,
  });
  return { save, patch, remove };
}
