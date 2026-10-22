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

export interface SpaceMessage { id: string; team_id: string; space_user: string | null; group_id: string | null; author_id: string; parent_id: string | null; item_id: string | null; body: string; created_at: string; request_id?: string | null }
export interface SpaceVersion { id: string; version: number; created_at: string; created_by: string; note: string; file_name: string | null; file_path?: string | null; mime_type: string | null; checkin?: import('./types').CheckinPayload | null }
export interface SpaceComment { id: string; author_id: string; body: string; created_at: string; parent_id: string | null; file_name: string | null }
export type SpaceSub = Submission & { space_id?: string | null; submission_versions: SpaceVersion[]; review_comments: SpaceComment[] };

export type Entry =
  | { t: 'msg'; at: string; id: string; m: SpaceMessage }
  | { t: 'post'; at: string; id: string; s: SpaceSub; v: SpaceVersion | null }
  | { t: 'ver'; at: string; id: string; s: SpaceSub; v: SpaceVersion }
  | { t: 'req'; at: string; id: string; r: TeamRequest };

const SUBSEL = '*, submission_versions(id, version, created_at, created_by, note, file_name, file_path, mime_type, checkin), review_comments(id, author_id, body, created_at, parent_id, file_name)';
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';
const byCreated = <T extends { id: string; created_at: string }>(rows: T[]) => [...new Map(rows.map((r) => [r.id, r])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at));

/**
 * 스페이스 데이터 — 처음엔 최근 30일만(이전은 '더 보기'), 그 뒤엔 15초마다 '바뀐 것만' 받아 합친다.
 *   (예전처럼 15초마다 전체 목록을 다시 받지 않는다 → 전송량·DB 부하 절감. 창이 숨겨지면 멈춘다)
 */
export function useSpace(ref: SpaceRef) {
  const { team } = useTeam();
  const qc = useQueryClient();
  const key = spaceKey(ref);
  const [days, setDays] = useState(30);
  useEffect(() => { setDays(30); }, [key]);
  const since0 = useMemo(() => iso(Date.now() - days * 86400000), [days, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const col = ref.kind === 'user' ? 'space_id' : 'group_id';
  const mcol = ref.kind === 'user' ? 'space_user' : 'group_id';
  const subsKey = ['subs', team.id, 'space', key, days];
  const msgsKey = ['space-msgs', team.id, key, days];
  const subs = useQuery({
    queryKey: subsKey,
    queryFn: () => q<SpaceSub[]>(supabase.from('submissions').select(SUBSEL).eq('team_id', team.id).eq(col, ref.id)
      .or(`created_at.gte.${since0},updated_at.gte.${since0}`).order('created_at').limit(300)),
  });
  const msgs = useQuery({
    queryKey: msgsKey,
    queryFn: () => q<SpaceMessage[]>(supabase.from('space_messages').select('*').eq('team_id', team.id).eq(mcol, ref.id).gte('created_at', since0).order('created_at').limit(800)),
  });
  const reqs = useQuery({
    queryKey: ['requests', team.id, 'space', key, days], enabled: ref.kind === 'user', refetchInterval: 60_000,
    queryFn: () => q<TeamRequest[]>(supabase.from('team_requests').select('*').eq('team_id', team.id).eq('to_id', ref.id).not('kind', 'in', '(meeting,change,grow,cheer)')
      .or(`created_at.gte.${since0},status.eq.open`).order('created_at').limit(100))
      .then((rs) => rs.filter((r) => !(r.kind === 'progress' && !r.item_id))),   // 업무 독려(과제 없음)는 매니징 보드 '팀장님 액션'에
  });

  // 바뀐 것만: 새 대화 · 바뀐 결과물(상태·새 버전) · 새 댓글이 달린 결과물
  //   새 대화는 '내가 가진 마지막 메시지의 서버 시각' 기준으로 받는다 (기기 시계가 서버와 어긋나도 빠지지 않게).
  const synced = useRef('');
  useEffect(() => { synced.current = ''; }, [key, days]);
  const delta = useQuery({
    queryKey: ['space-delta', team.id, key, days], enabled: subs.isSuccess && msgs.isSuccess, refetchInterval: 15_000,
    queryFn: async () => {
      const since = synced.current || iso(Math.min(subs.dataUpdatedAt, msgs.dataUpdatedAt) - 5000);
      const next = iso(Date.now() - 5000);
      const have0 = qc.getQueryData<SpaceMessage[]>(msgsKey) ?? [];
      const lastMsg = have0.length ? iso(Date.parse(have0[have0.length - 1].created_at) - 2000) : since0;
      const [nm, ns, nc] = await Promise.all([
        q<SpaceMessage[]>(supabase.from('space_messages').select('*').eq('team_id', team.id).eq(mcol, ref.id).gt('created_at', lastMsg).order('created_at')),
        q<{ id: string }[]>(supabase.from('submissions').select('id').eq('team_id', team.id).eq(col, ref.id).gt('updated_at', since)),
        q<{ submission_id: string }[]>(supabase.from('review_comments').select('submission_id').eq('team_id', team.id).gt('created_at', since)),
      ]);
      synced.current = next;
      if (nm.length) qc.setQueryData<SpaceMessage[]>(msgsKey, (old) => byCreated([...(old ?? []), ...nm]));
      const have = new Set((qc.getQueryData<SpaceSub[]>(subsKey) ?? []).map((x) => x.id));
      const changed = [...new Set([...ns.map((x) => x.id), ...nc.map((x) => x.submission_id).filter((x) => have.has(x))])];
      if (changed.length) {
        const rows = await q<SpaceSub[]>(supabase.from('submissions').select(SUBSEL).in('id', changed.slice(0, 50)));
        qc.setQueryData<SpaceSub[]>(subsKey, (old) => byCreated([...(old ?? []), ...rows]));
      }
      return nm.length + changed.length;
    },
  });

  // 실시간 — 상대가 쓴 대화·요청 변화·업무 카드 변화·AI 분석 완료를 바로 받는다 (27_realtime.sql · 28_realtime_ai.sql). 15초 확인은 끊겼을 때의 안전망.
  const refetchDelta = useRef(delta.refetch); refetchDelta.current = delta.refetch;
  useEffect(() => {
    if (typeof (supabase as { channel?: unknown }).channel !== 'function') return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => refetchDelta.current(), 300); };
    const ch = supabase.channel(`space:${team.id}:${key}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'space_messages', filter: `${mcol}=eq.${ref.id}` }, (p) => {
        const m = p.new as SpaceMessage;
        if (m.team_id !== team.id) return;
        qc.setQueriesData<SpaceMessage[]>({ queryKey: ['space-msgs', team.id, key] }, (old) => (old ? byCreated([...old, m]) : old));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions', filter: `${col}=eq.${ref.id}` }, soon);
    // AI 1차 분석이 끝나면 (팀장만 받는다 — ai_outputs 읽기 권한) 표시와 패널을 바로 갱신
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_outputs', filter: `team_id=eq.${team.id}` }, () => qc.invalidateQueries({ queryKey: ['ai', team.id] }));
    if (ref.kind === 'user') ch.on('postgres_changes', { event: '*', schema: 'public', table: 'team_requests', filter: `to_id=eq.${ref.id}` }, () => {
      qc.invalidateQueries({ queryKey: ['requests', team.id] });
    });
    ch.subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [team.id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { subs, msgs, reqs, days, more: () => setDays((d) => d + 60), missing: !!subs.error && errorText(subs.error).includes('space_id') };
}

/** 흐름 만들기 — 답글(스레드)은 빠지고, v2부터는 '새 버전'으로 따로 올라온다 */
export function buildEntries(subs: SpaceSub[], msgs: SpaceMessage[], reqs: TeamRequest[]): Entry[] {
  const out: Entry[] = [];
  for (const m of msgs) if (!m.parent_id && !m.request_id) out.push({ t: 'msg', at: m.created_at, id: `m:${m.id}`, m });
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
    for (const r of msgs) if (r.request_id === e.r.id && r.author_id !== uid) ts.push(r.created_at);
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
    const now = new Date().toISOString();
    supabase.from('space_reads').upsert({ user_id: uid, team_id: team.id, space_key: key, read_at: now })
      .then(() => {
        // 다른 탭·스페이스에 갔다 돌아와도 새로고침 없이 읽음 상태가 맞도록 캐시도 바꾼다
        qc.setQueryData(['space-read', key, uid], now);
        qc.invalidateQueries({ queryKey: ['space-unread'] });
      });
  }, [ready, latest, read.data, key, uid, team.id, qc]);
  return seenAt ?? '9999-12-31';
}

/** 탭 배지용: 스페이스마다 안 읽은 수 — DB 함수 한 번 (25_cost_guard.sql) */
export function useSpaceUnread(refs: SpaceRef[]) {
  const { team, uid } = useTeam();
  const keys = refs.map(spaceKey);
  return useQuery({
    queryKey: ['space-unread', team.id, uid, keys.join(',')], enabled: refs.length > 0, refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('space_unread', { p_team: team.id, p_keys: keys });
      if (error) return {} as Record<string, number>;
      return Object.fromEntries(((data ?? []) as { space_key: string; n: number }[]).map((r) => [r.space_key, r.n]));
    },
  });
}

export function useSendMessage(ref: SpaceRef) {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (p: { body: string; item_id?: string | null; parent_id?: string | null; request_id?: string | null }) => q(supabase.from('space_messages').insert({
      team_id: team.id, author_id: uid, body: p.body.trim(), item_id: p.item_id ?? null, parent_id: p.parent_id ?? null, ...(p.request_id ? { request_id: p.request_id } : {}),
      ...(ref.kind === 'user' ? { space_user: ref.id } : { group_id: ref.id }),
    }).select('*').single()),
    onSuccess: (row) => {
      // 내가 보낸 글은 서버 응답을 받자마자 흐름에 넣는다 (다음 확인 주기를 기다리지 않음)
      if (row) qc.setQueriesData<SpaceMessage[]>({ queryKey: ['space-msgs', team.id, spaceKey(ref)] }, (old) => (old ? byCreated([...old, row as SpaceMessage]) : old));
      else qc.invalidateQueries({ queryKey: ['space-delta', team.id, spaceKey(ref)] });
    },
    onError: (e) => toast(errorText(e).includes('request_id') ? '요청 답글 SQL(24_request_thread.sql)을 먼저 실행해 주세요.' : errorText(e).includes('space_messages') ? '업무 스페이스 SQL(19_work_space.sql)을 먼저 실행해 주세요.' : errorText(e)),
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
