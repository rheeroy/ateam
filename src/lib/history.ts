// 히스토리 관리 — 과제별 '살아 있는 히스토리' (팀장) · 전달받은 히스토리 (팀원)
//   데이터: task_histories (팀장만) · history_shares (전달 · 요청, 보낸 순간의 사본) · history_messages (질문 · 답)
//   만들기·업데이트: ai-task-history (매주 월요일 06:00 자동 · [지금 업데이트])  — 30_history.sql
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, invoke, errorText } from './supabase';
import { useTeam } from '../state/session';
import { useToast } from '../components/ui';
import type { WorkItem } from './types';

export type HRef = { type: string; id: string | null; label: string };
export type HLine = { id: string; text: string; detail?: string; since?: string; src?: HRef[] };
export type HEvent = { id: string; lane: string; date: string; title: string; kind: 'doc' | 'decision' | 'issue' | 'feedback' | 'plan' | 'change' | string; detail?: string; future?: boolean; src?: HRef[] };
export type HPerson = { id: string; name: string; org?: string; scope: 'team' | 'dept' | 'external' | string; role?: string; check?: boolean; src?: HRef[] };
export interface HistoryContent {
  summary?: string;
  lanes?: { id: string; title: string }[];
  events?: HEvent[];
  links?: { from: string; to: string; label?: string }[];
  people?: HPerson[];
  fixed?: HLine[]; open?: HLine[]; tried?: HLine[]; risks?: HLine[]; gaps?: HLine[];
  related?: { item_id: string; title: string; why?: string }[];
  progress?: { measure: string; unit: string; target: number | null; points: { date: string; value: number }[] };
  owner?: { id: string | null; name: string; previous: string[] };
  meta?: { records?: number };
}
export type HistoryEdits = { pinned?: string[]; hidden?: string[]; text?: Record<string, string> };
export interface TaskHistory { item_id: string; team_id: string; content: HistoryContent; edits: HistoryEdits; synced_at: string | null; record_count: number; new_count: number; updated_at: string }
export interface HistoryShare { id: string; team_id: string; item_id: string; from_id: string | null; to_id: string; note: string; snapshot: HistoryContent; status: 'requested' | 'sent' | 'read' | 'declined'; sent_at: string | null; read_at: string | null; created_at: string; updated_at: string }
export interface HistoryMessage { id: string; share_id: string; author_id: string; body: string; created_at: string }

export const LISTS = [
  { k: 'fixed', label: '확정 사항', tone: 'emerald' },
  { k: 'open', label: '미결 사항', tone: 'violet' },
  { k: 'risks', label: '리스크', tone: 'rose' },
  { k: 'tried', label: '이전 시도', tone: 'slate' },
  { k: 'gaps', label: '확인 필요', tone: 'amber' },
] as const;
export type ListKey = (typeof LISTS)[number]['k'];

/** 팀장 손질(숨김·고친 문장)을 반영한 '보이는 히스토리' — 전달할 때 이걸 사본으로 남긴다 */
export function applyEdits(c: HistoryContent, e: HistoryEdits | null | undefined): HistoryContent {
  const hidden = new Set(e?.hidden ?? []);
  const pinned = new Set(e?.pinned ?? []);
  const txt = e?.text ?? {};
  const line = (l: HLine) => (txt[l.id] ? { ...l, text: txt[l.id] } : l);
  const sortPin = <T extends { id: string }>(xs: T[]) => [...xs.filter((x) => pinned.has(x.id)), ...xs.filter((x) => !pinned.has(x.id))];
  const out: HistoryContent = { ...c, summary: txt.summary ?? c.summary };
  for (const { k } of LISTS) out[k] = sortPin((c[k] ?? []).filter((x) => !hidden.has(x.id)).map(line));
  out.events = (c.events ?? []).filter((x) => !hidden.has(x.id)).map((x) => (txt[x.id] ? { ...x, title: txt[x.id] } : x));
  out.people = (c.people ?? []).filter((x) => !hidden.has(x.id));
  return out;
}

export function useHistories() {
  const { team } = useTeam();
  return useQuery({
    queryKey: ['histories', team.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('task_histories').select('*').eq('team_id', team.id);
      if (error) { if (/task_histories/.test(error.message)) return [] as TaskHistory[]; throw new Error(error.message); }
      return data as TaskHistory[];
    },
  });
}

export function useShares(opts: { mine?: boolean } = {}) {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const key = ['history-shares', team.id, opts.mine ? uid : 'all'];
  // 실시간 — 받은 히스토리 · 요청 · 확인
  useEffect(() => {
    const ch = supabase.channel(`hs:${team.id}:${opts.mine ? uid : 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'history_shares', filter: `team_id=eq.${team.id}` }, () => {
        qc.invalidateQueries({ queryKey: ['history-shares', team.id] }); qc.invalidateQueries({ queryKey: ['member-badges'] });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'history_messages', filter: `team_id=eq.${team.id}` }, () => qc.invalidateQueries({ queryKey: ['history-msgs'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [team.id, uid, opts.mine]); // eslint-disable-line react-hooks/exhaustive-deps
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      let qb = supabase.from('history_shares').select('*').eq('team_id', team.id).order('created_at', { ascending: false }).limit(200);
      if (opts.mine) qb = qb.eq('to_id', uid);
      const { data, error } = await qb;
      if (error) { if (/history_shares/.test(error.message)) return [] as HistoryShare[]; throw new Error(error.message); }
      return data as HistoryShare[];
    },
  });
}

export function useHistoryMessages(shareId: string | null) {
  return useQuery({
    queryKey: ['history-msgs', shareId], enabled: !!shareId,
    queryFn: () => q<HistoryMessage[]>(supabase.from('history_messages').select('*').eq('share_id', shareId!).order('created_at')),
  });
}

export function useHistoryActions() {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const inval = () => ['histories', 'history-shares', 'history-msgs', 'member-badges', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const fail = (e: unknown) => toast(/task_histories|history_shares|history_messages/.test(errorText(e)) ? '히스토리 SQL(30_history.sql)을 먼저 실행해 주세요.' : errorText(e));
  return {
    /** 만들기·업데이트 (AI) — 처음은 여러 과제를 나눠서 */
    update: useMutation({
      mutationFn: (p: { itemIds: string[]; force?: boolean }) => invoke<{ results?: { item_id: string; updated?: boolean; skipped?: string; error?: string }[] }>('ai-task-history',
        p.itemIds.length === 1 ? { team_id: team.id, item_id: p.itemIds[0], force: p.force } : { team_id: team.id, item_ids: p.itemIds }),
      onSuccess: () => inval(), onError: fail,
    }),
    edit: useMutation({
      mutationFn: (p: { itemId: string; edits: HistoryEdits }) => q(supabase.from('task_histories').update({ edits: p.edits }).eq('item_id', p.itemId)),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['histories'] }), onError: fail,
    }),
    send: useMutation({
      mutationFn: async (p: { itemId: string; toIds: string[]; note: string; snapshot: HistoryContent; requestId?: string | null; newOwner?: string | null }) => {
        const now = new Date().toISOString();
        for (const to of p.toIds) {
          if (p.requestId && to === p.toIds[0]) {
            await q(supabase.from('history_shares').update({ status: 'sent', from_id: uid, note: p.note, snapshot: p.snapshot, sent_at: now, updated_at: now }).eq('id', p.requestId));
          } else {
            await q(supabase.from('history_shares').insert({ team_id: team.id, item_id: p.itemId, from_id: uid, to_id: to, note: p.note, snapshot: p.snapshot, status: 'sent', sent_at: now }));
          }
        }
        if (p.newOwner) await q(supabase.from('work_items').update({ owner_id: p.newOwner }).eq('id', p.itemId));
      },
      onSuccess: (_d, p) => { inval(); if (p.newOwner) qc.invalidateQueries({ queryKey: ['items'] }); toast('전달했습니다. 확인하면 알려 드립니다.'); },
      onError: fail,
    }),
    decline: useMutation({
      mutationFn: (id: string) => q(supabase.from('history_shares').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', id)),
      onSuccess: inval, onError: fail,
    }),
    request: useMutation({
      mutationFn: (p: { itemId: string; note: string }) => q(supabase.from('history_shares').insert({ team_id: team.id, item_id: p.itemId, to_id: uid, note: p.note, status: 'requested' })),
      onSuccess: () => { inval(); toast('팀장님께 히스토리를 요청했습니다.'); }, onError: fail,
    }),
    markRead: useMutation({
      mutationFn: (id: string) => q(supabase.rpc('history_mark_read', { p_share: id })),
      onSuccess: () => { inval(); toast('확인했다고 팀장님께 알렸습니다.'); }, onError: fail,
    }),
    ask: useMutation({
      mutationFn: (p: { shareId: string; body: string }) => q(supabase.from('history_messages').insert({ share_id: p.shareId, team_id: team.id, author_id: uid, body: p.body })),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['history-msgs'] }), onError: fail,
    }),
  };
}

/** 받은 히스토리 중 확인 전 (팀원 메뉴 숫자) */
export function useUnreadShares(enabled: boolean) {
  const { team, uid } = useTeam();
  return useQuery({
    queryKey: ['history-shares', team?.id, 'unread', uid], enabled: enabled && !!team, staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from('history_shares').select('id', { count: 'exact', head: true }).eq('team_id', team.id).eq('to_id', uid).eq('status', 'sent');
      return error ? 0 : count ?? 0;
    },
  });
}

/** 팀장 메뉴 숫자 = 받은 요청 + 아직 답 안 한 질문 */
export function useHistoryTodo(enabled: boolean) {
  const { team, uid } = useTeam();
  return useQuery({
    queryKey: ['history-shares', team?.id, 'todo'], enabled: enabled && !!team, staleTime: 60_000,
    queryFn: async () => {
      const { data: sh, error } = await supabase.from('history_shares').select('id, status').eq('team_id', team.id).neq('status', 'declined').limit(300);
      if (error) return 0;
      const req = (sh ?? []).filter((s) => s.status === 'requested').length;
      const ids = (sh ?? []).filter((s) => s.status !== 'requested').map((s) => s.id);
      if (!ids.length) return req;
      const { data: ms } = await supabase.from('history_messages').select('share_id, author_id, created_at').in('share_id', ids).order('created_at');
      const last = new Map<string, string>();
      for (const m of ms ?? []) last.set(m.share_id, m.author_id);
      return req + [...last.values()].filter((a) => a !== uid).length;
    },
  });
}

/** 히스토리 대상 과제 — 목표·지표·할 일·오래전에 끝난 것 제외 (ai-task-history 와 같은 기준) */
export function historyItems(items: WorkItem[]) {
  const cut = Date.now() - 60 * 86400000;
  return items.filter((i) => i.parent_id && i.measure !== 'check' && i.role !== 'goal' && i.role !== 'metric'
    && ['active', 'blocked', 'done'].includes(i.status) && !(i.status === 'done' && i.done_at && Date.parse(i.done_at) < cut));
}
