// 업무 스페이스 (채팅형) 데이터 — 개인 스페이스(팀원 id) · 그룹방(그룹 id)
//   흐름 = 대화(space_messages) + 업무 카드(submissions, v2부터는 '새 버전' 말풍선) + 팀장 요청(team_requests)
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, errorText } from './supabase';
import { useToast } from '../components/ui';
import { useTeam } from '../state/session';
import type { Submission, TeamRequest } from './types';

export type SpaceRef = { kind: 'user'; id: string } | { kind: 'group'; id: string };
export const spaceKey = (r: SpaceRef) => `${r.kind === 'user' ? 'u' : 'g'}:${r.id}`;

export interface SpaceMessage { id: string; team_id: string; space_user: string | null; group_id: string | null; author_id: string; parent_id: string | null; item_id: string | null; body: string; created_at: string }
export interface SpaceVersion { id: string; version: number; created_at: string; created_by: string; note: string; file_name: string | null; mime_type: string | null }
export interface SpaceComment { id: string; author_id: string; body: string; created_at: string; parent_id: string | null; file_name: string | null }
export type SpaceSub = Submission & { space_id?: string | null; submission_versions: SpaceVersion[]; review_comments: SpaceComment[] };

export type Entry =
  | { t: 'msg'; at: string; id: string; m: SpaceMessage }
  | { t: 'post'; at: string; id: string; s: SpaceSub; v: SpaceVersion | null }
  | { t: 'ver'; at: string; id: string; s: SpaceSub; v: SpaceVersion }
  | { t: 'req'; at: string; id: string; r: TeamRequest };

const LIVE = { refetchInterval: 15_000 };

export function useSpace(ref: SpaceRef) {
  const { team } = useTeam();
  const key = spaceKey(ref);
  const subs = useQuery({
    queryKey: ['subs', team.id, 'space', key],
    queryFn: () => q<SpaceSub[]>(supabase.from('submissions')
      .select('*, submission_versions(id, version, created_at, created_by, note, file_name, mime_type), review_comments(id, author_id, body, created_at, parent_id, file_name)')
      .eq('team_id', team.id).eq(ref.kind === 'user' ? 'space_id' : 'group_id', ref.id).order('created_at').limit(300)),
    ...LIVE,
  });
  const msgs = useQuery({
    queryKey: ['space-msgs', team.id, key],
    queryFn: () => q<SpaceMessage[]>(supabase.from('space_messages').select('*').eq('team_id', team.id).eq(ref.kind === 'user' ? 'space_user' : 'group_id', ref.id).order('created_at').limit(600)),
    ...LIVE,
  });
  const reqs = useQuery({
    queryKey: ['requests', team.id, 'space', key], enabled: ref.kind === 'user',
    queryFn: () => q<TeamRequest[]>(supabase.from('team_requests').select('*').eq('team_id', team.id).eq('to_id', ref.id).not('kind', 'in', '(meeting,change)').order('created_at').limit(200)),
    ...LIVE,
  });
  return { subs, msgs, reqs, missing: !!subs.error && errorText(subs.error).includes('space_id') };
}

/** 흐름 만들기 — 답글(스레드)은 빠지고, v2부터는 '새 버전'으로 따로 올라온다 */
export function buildEntries(subs: SpaceSub[], msgs: SpaceMessage[], reqs: TeamRequest[]): Entry[] {
  const out: Entry[] = [];
  for (const m of msgs) if (!m.parent_id) out.push({ t: 'msg', at: m.created_at, id: `m:${m.id}`, m });
  for (const s of subs) {
    const vs = [...(s.submission_versions ?? [])].sort((a, b) => a.version - b.version);
    out.push({ t: 'post', at: s.created_at, id: `s:${s.id}`, s, v: vs[0] ?? null });
    for (const v of vs.slice(1)) out.push({ t: 'ver', at: v.created_at, id: `v:${v.id}`, s, v });
  }
  for (const r of reqs) out.push({ t: 'req', at: r.created_at, id: `r:${r.id}`, r });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** 다른 사람의 마지막 활동 시각 (안 읽음 판단용) */
export function lastOther(e: Entry, uid: string, msgs: SpaceMessage[]): string {
  const ts: string[] = [];
  if (e.t === 'msg') {
    if (e.m.author_id !== uid) ts.push(e.m.created_at);
    for (const r of msgs) if (r.parent_id === e.m.id && r.author_id !== uid) ts.push(r.created_at);
  } else if (e.t === 'req') {
    if (e.r.from_id !== uid) ts.push(e.r.created_at);
  } else {
    if (e.t === 'post' && e.s.author_id !== uid) ts.push(e.s.created_at);
    if (e.t === 'ver' && e.v.created_by !== uid) ts.push(e.v.created_at);
    for (const c of e.s.review_comments ?? []) if (c.author_id !== uid) ts.push(c.created_at);
  }
  return ts.reduce((m, t) => (t > m ? t : m), '');
}

/** 읽음 표시 — 열 때의 '지난번 읽은 때'를 기억해 두고(이번에 새로 온 것 강조), 보고 있는 동안 계속 갱신 */
export function useSpaceRead(ref: SpaceRef, ready: boolean, latest: string) {
  const { team, uid } = useTeam();
  const key = spaceKey(ref);
  const qc = useQueryClient();
  const read = useQuery({
    queryKey: ['space-read', key, uid],
    queryFn: async () => {
      const { data, error } = await supabase.from('space_reads').select('read_at').eq('user_id', uid).eq('space_key', key).maybeSingle();
      if (error) return null;
      return (data?.read_at as string | undefined) ?? '1970-01-01T00:00:00Z';
    },
    staleTime: Infinity,
  });
  const [seenAt, setSeenAt] = useState<string | null>(null);
  useEffect(() => { setSeenAt(null); }, [key]);
  useEffect(() => { if (seenAt == null && read.data !== undefined) setSeenAt(read.data ?? '1970-01-01T00:00:00Z'); }, [read.data, seenAt]);
  const last = useRef('');
  useEffect(() => {
    if (!ready || read.data === undefined || read.data === null || document.visibilityState !== 'visible') return;
    if (latest && latest === last.current) return;
    last.current = latest;
    supabase.from('space_reads').upsert({ user_id: uid, team_id: team.id, space_key: key, read_at: new Date().toISOString() })
      .then(() => qc.invalidateQueries({ queryKey: ['space-unread'] }));
  }, [ready, latest, read.data, key, uid, team.id, qc]);
  return seenAt ?? '9999-12-31';
}

/** 탭 배지용: 스페이스마다 안 읽은 수 (내 마지막 읽은 때 이후 다른 사람이 쓴 것) */
export function useSpaceUnread(refs: SpaceRef[]) {
  const { team, uid } = useTeam();
  const keys = refs.map(spaceKey);
  return useQuery({
    queryKey: ['space-unread', team.id, uid, keys.join(',')], enabled: refs.length > 0, refetchInterval: 30_000,
    queryFn: async () => {
      const { data: reads } = await supabase.from('space_reads').select('space_key, read_at').eq('user_id', uid).in('space_key', keys);
      const at = (k: string) => reads?.find((r) => r.space_key === k)?.read_at ?? '1970-01-01T00:00:00Z';
      const out: Record<string, number> = {};
      await Promise.all(refs.map(async (r) => {
        const k = spaceKey(r); const since = at(k);
        const col = r.kind === 'user' ? 'space_user' : 'group_id';
        const scol = r.kind === 'user' ? 'space_id' : 'group_id';
        const [m, subs] = await Promise.all([
          supabase.from('space_messages').select('id', { count: 'exact', head: true }).eq('team_id', team.id).eq(col, r.id).neq('author_id', uid).gt('created_at', since),
          supabase.from('submissions').select('id').eq('team_id', team.id).eq(scol, r.id).gt('updated_at', since).limit(100),
        ]);
        let n = m.count ?? 0;
        const ids = (subs.data ?? []).map((s) => s.id as string);
        if (ids.length) {
          const [c, v] = await Promise.all([
            supabase.from('review_comments').select('id', { count: 'exact', head: true }).in('submission_id', ids).neq('author_id', uid).gt('created_at', since),
            supabase.from('submission_versions').select('id', { count: 'exact', head: true }).in('submission_id', ids).neq('created_by', uid).gt('created_at', since),
          ]);
          n += (c.count ?? 0) + (v.count ?? 0);
        }
        out[k] = n;
      }));
      return out;
    },
  });
}

export function useSendMessage(ref: SpaceRef) {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (p: { body: string; item_id?: string | null; parent_id?: string | null }) => q(supabase.from('space_messages').insert({
      team_id: team.id, author_id: uid, body: p.body.trim(), item_id: p.item_id ?? null, parent_id: p.parent_id ?? null,
      ...(ref.kind === 'user' ? { space_user: ref.id } : { group_id: ref.id }),
    })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['space-msgs', team.id, spaceKey(ref)] }),
    onError: (e) => toast(errorText(e).includes('space_messages') ? '업무 스페이스 SQL(19_work_space.sql)을 먼저 실행해 주세요.' : errorText(e)),
  });
}

/** 과제 태그 고르기 목록에 쓰는 이름 */
export function useEntryCounts(entries: Entry[], msgs: SpaceMessage[]) {
  return useMemo(() => {
    const by = new Map<string, number>();
    const itemOf = (e: Entry) => (e.t === 'msg' ? e.m.item_id : e.t === 'req' ? e.r.item_id : e.s.item_id);
    for (const e of entries) { if (e.t === 'ver') continue; const it = itemOf(e) ?? ''; by.set(it, (by.get(it) ?? 0) + 1); }
    return { by, itemOf, msgs };
  }, [entries, msgs]);
}
