// 팀원: 피드백 · 코칭 — 팀장이 나에게 한 '사람·성장' 관련 행동만 (성장 제안 · 격려 · 칭찬 · ATEAM 코칭)
//   업무 요청(기타 · 자료 공유 · 계획 · 성과입력)은 업무플랫폼·팀목표에서, 1on1 요청은 1on1 칸에서 본다.
//   위에는 '답할 것'(열린 요청 · 확인 안 한 코칭), 아래는 지난 것. 종류별로 걸러 볼 수 있다.
//   업무 결과물의 보완 요청·리뷰 코멘트는 업무플랫폼에, 목표 승인은 팀목표에 — 여기에 다시 쌓지 않는다.
//   ATEAM 코칭은 보낸 사람을 표시하지 않는다 (코칭 설계 그대로).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, CheckCircle2, ChevronDown, HeartHandshake, Inbox, Send, Sprout } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, errorText } from '../../lib/supabase';
import type { TeamRequest } from '../../lib/types';
import { REQUEST_KIND } from '../RequestModal';
import { cx, fmtDate, fmtShort } from '../../lib/format';
import { LogoMark } from '../Brand';
import type { CoachingNote } from '../people/Coaching';
import { Button, Card, useToast } from '../ui';

type Praise = { id: string; author_id: string; body: string; occurred_at: string };
type Item =
  | { t: 'req'; id: string; at: string; open: boolean; r: TeamRequest }
  | { t: 'coach'; id: string; at: string; open: boolean; c: CoachingNote }
  | { t: 'praise'; id: string; at: string; open: false; p: Praise };
type Filter = 'all' | 'todo' | 'req' | 'praise' | 'coach';

const DAY = 86400000;
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '').replace(/^\[칭찬 배지\]\s*/, '');

/** 팀장님에게서 온 것 — 메뉴 배지·페이지가 같이 쓴다 */
export function useFromLeader() {
  const { team, uid } = useTeam();
  const since = new Date(Date.now() - 120 * DAY).toISOString();
  const reqs = useQuery({
    queryKey: ['requests', team.id, 'to', uid, 'care'],
    queryFn: () => q<TeamRequest[]>(supabase.from('team_requests').select('*').eq('team_id', team.id).eq('to_id', uid).in('kind', ['grow', 'cheer']).neq('status', 'canceled')
      .or(`status.eq.open,created_at.gte.${since}`).order('created_at', { ascending: false }).limit(60)),
  });
  const coach = useQuery({
    queryKey: ['my-coaching', team.id, uid],
    queryFn: async () => {
      const { data, error } = await supabase.from('coaching_notes').select('*').eq('team_id', team.id).eq('member_id', uid).order('created_at', { ascending: false }).limit(20);
      return error ? [] : (data as CoachingNote[]);
    },
  });
  const praise = useQuery({
    queryKey: ['my-praise', team.id, uid],
    queryFn: () => q<Praise[]>(supabase.from('observations').select('id, author_id, body, occurred_at').eq('team_id', team.id).eq('subject_id', uid).eq('kind', 'praise').order('occurred_at', { ascending: false }).limit(30)),
  });
  const items = useMemo<Item[]>(() => [
    ...(reqs.data ?? []).map((r) => ({ t: 'req' as const, id: r.id, at: r.created_at, open: r.status === 'open', r })),
    ...(coach.data ?? []).map((c) => ({ t: 'coach' as const, id: c.id, at: c.created_at, open: !c.acked_at, c })),
    ...(praise.data ?? []).map((p) => ({ t: 'praise' as const, id: p.id, at: p.occurred_at, open: false as const, p })),
  ].sort((a, b) => b.at.localeCompare(a.at)), [reqs.data, coach.data, praise.data]);
  return { items, loading: reqs.isLoading || coach.isLoading || praise.isLoading };
}

const META = {
  req: { icon: Send, cls: 'bg-indigo-50 text-indigo-600' },
  grow: { icon: Sprout, cls: 'bg-emerald-50 text-emerald-600' },
  cheer: { icon: HeartHandshake, cls: 'bg-rose-50 text-rose-500' },
  praise: { icon: Award, cls: 'bg-amber-50 text-amber-600' },
} as const;

export function FromLeader({ focus }: { focus?: string | null }) {
  const { nameOf } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const { items, loading } = useFromLeader();
  const [filter, setFilter] = useState<Filter>('all');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(focus ?? null);
  const [limit, setLimit] = useState(8);
  const focusRef = useRef<HTMLLIElement>(null);
  useEffect(() => { if (focus) { setOpenId(focus); setTimeout(() => focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); } }, [focus]);

  const done = useMutation({
    mutationFn: (r: TeamRequest) => q(supabase.from('team_requests').update({ status: 'done', response: reply[r.id] ?? '' }).eq('id', r.id)),
    onSuccess: (_d, r) => { ['requests', 'member-badges'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast(r.kind === 'cheer' ? '확인했다고 팀장님께 알렸습니다.' : r.kind === 'grow' ? '답을 보냈습니다.' : '완료로 표시했습니다. 팀장님께 알림이 갑니다.'); },
    onError: (e) => toast(errorText(e)),
  });
  const mark = useMutation({
    mutationFn: async (p: { id: string; ack?: boolean; helpful?: boolean }) => { await supabase.rpc('coaching_mark', { p_id: p.id, p_ack: !!p.ack, p_helpful: p.helpful ?? null }); },
    onSuccess: () => { ['my-coaching', 'member-badges'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
  // 보이면 코칭 '읽음'
  useEffect(() => { for (const it of items) if (it.t === 'coach' && !it.c.seen_at) mark.mutate({ id: it.id }); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const todo = items.filter((i) => i.open);
  const count: Record<Filter, number> = {
    all: items.length, todo: todo.length,
    req: items.filter((i) => i.t === 'req').length, praise: items.filter((i) => i.t === 'praise').length, coach: items.filter((i) => i.t === 'coach').length,
  };
  const shown = (filter === 'all' ? [...todo, ...items.filter((i) => !i.open)] : filter === 'todo' ? todo : items.filter((i) => i.t === filter));
  const today = new Date().toISOString().slice(0, 10);
  const CTA: Partial<Record<TeamRequest['kind'], { label: string; to: (r: TeamRequest) => string }>> = {
    plan: { label: '계획 세우기', to: (r) => `/my/goals${r.item_id ? `?item=${r.item_id}` : ''}` },
    progress: { label: '성과입력 하기', to: (r) => `/my/goals${r.item_id ? `?item=${r.item_id}` : ''}` },
    share: { label: '업무플랫폼에 올리기', to: () => '/my/submissions' },
  };
  const DONE: Partial<Record<TeamRequest['kind'], string>> = { grow: '답 보내기', cheer: '확인' };
  const TABS: [Filter, string][] = [['all', '전체'], ['todo', '답할 것'], ['req', '성장 제안·격려'], ['praise', '칭찬'], ['coach', '코칭']];

  return (
    <Card>
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-slate-500" /><span className="font-semibold">피드백 · 코칭</span>
          {!!todo.length && <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5">답할 것 {todo.length}</span>}
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto -mx-1 px-1">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => { setFilter(k); setLimit(8); }}
              className={cx('shrink-0 text-xs rounded-md px-2.5 py-1 inline-flex items-center gap-1', filter === k ? 'bg-slate-800 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100')}>
              {l}<span className={cx('num', filter === k ? 'text-slate-300' : 'text-slate-400')}>{count[k]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="p-6 text-sm text-slate-400">불러오는 중</div> : !shown.length ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">{filter === 'todo' ? '지금 답할 것이 없습니다.' : '아직 받은 성장 제안 · 칭찬 · 코칭이 없습니다.'}</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.slice(0, limit).map((it) => {
            const focused = it.id === focus;
            const expanded = openId === it.id;
            if (it.t === 'req') {
              const r = it.r; const m = r.kind === 'grow' ? META.grow : r.kind === 'cheer' ? META.cheer : META.req;
              const late = it.open && r.due_date && r.due_date < today; const cta = CTA[r.kind];
              return (
                <li key={it.id} ref={focused ? focusRef : undefined} className={cx('px-5 py-3.5', focused && 'bg-indigo-50/40')}>
                  <Row icon={m.icon} cls={m.cls} type={REQUEST_KIND[r.kind].label} from={nameOf(r.from_id)} at={r.created_at} muted={!it.open}
                    title={r.title} right={it.open ? (r.due_date ? <span className={cx('text-[11px] num', late ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{fmtShort(r.due_date)}까지</span> : null)
                      : <span className="text-[11px] text-emerald-700 inline-flex items-center gap-0.5"><CheckCircle2 size={11} />{r.responded_at ? fmtShort(r.responded_at) : '완료'}</span>}>
                    {r.body && <p className="text-sm text-slate-600 mt-0.5">{r.body}</p>}
                    {!it.open && r.response && <p className="text-xs text-slate-500 mt-1">내 답 · {r.response}</p>}
                    {it.open && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {cta && <Link to={cta.to(r)}><Button size="sm">{cta.label}</Button></Link>}
                        <input className="flex-1 min-w-[140px] text-xs border border-slate-200 rounded-lg px-2.5 py-1.5" value={reply[r.id] ?? ''} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })}
                          placeholder={r.kind === 'grow' ? '해 보고 싶은 일 · 생각 (선택)' : '한 줄 답 (선택)'} />
                        <Button size="sm" variant="secondary" loading={done.isPending && done.variables?.id === r.id} onClick={() => done.mutate(r)}><CheckCircle2 size={13} />{DONE[r.kind] ?? '완료'}</Button>
                      </div>
                    )}
                  </Row>
                </li>
              );
            }
            if (it.t === 'coach') {
              const c = it.c; const body = strip(c.body);
              return (
                <li key={it.id} ref={focused ? focusRef : undefined} className={cx('px-5 py-3.5', focused && 'bg-violet-50/40')}>
                  <Row icon={null} cls="bg-violet-50 text-violet-600" type="ATEAM 코칭" at={c.created_at} title={c.title} muted={!it.open}
                    right={!it.open ? <span className="text-[11px] text-slate-400">확인함</span> : null}>
                    <div className={cx('text-sm text-slate-600 mt-0.5 whitespace-pre-line', !expanded && 'line-clamp-2')}>{body}</div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <button onClick={() => setOpenId(expanded ? null : it.id)} className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-0.5">{expanded ? '접기' : '전체 보기'}<ChevronDown size={12} className={cx(expanded && 'rotate-180')} /></button>
                      <span className="text-[11px] text-slate-400">평가와 무관한 코칭입니다</span>
                      <span className="ml-auto flex gap-1.5">
                        <Button size="sm" variant="ghost" disabled={c.helpful === true} onClick={() => mark.mutate({ id: c.id, helpful: true })}>{c.helpful ? '도움됨' : '도움됐어요'}</Button>
                        {it.open && <Button size="sm" variant="secondary" onClick={() => mark.mutate({ id: c.id, ack: true })}><CheckCircle2 size={13} />확인</Button>}
                      </span>
                    </div>
                  </Row>
                </li>
              );
            }
            const p = it.p;
            return (
              <li key={it.id} ref={focused ? focusRef : undefined} className={cx('px-5 py-3.5', focused && 'bg-amber-50/40')}>
                <Row icon={META.praise.icon} cls={META.praise.cls} type="칭찬" from={nameOf(p.author_id)} at={p.occurred_at} title={`“${strip(p.body)}”`} />
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > limit && (
        <button onClick={() => setLimit((n) => n + 10)} className="w-full border-t border-slate-100 py-2.5 text-xs text-slate-500 hover:bg-slate-50">이전 것 더 보기 ({shown.length - limit})</button>
      )}
    </Card>
  );
}

function Row({ icon: I, cls, type, from, at, title, right, muted, children }: {
  icon: typeof Send | null; cls: string; type: string; from?: string; at: string; title: string; right?: ReactNode; muted?: boolean; children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', cls, muted && 'opacity-60')}>{I ? <I size={15} /> : <LogoMark size={14} />}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="font-semibold text-slate-500">{type}</span>{from && <span>· {from} 팀장님</span>}<span>· {fmtDate(at)}</span>
          <span className="ml-auto">{right}</span>
        </div>
        <div className={cx('mt-0.5 text-sm font-semibold leading-snug', muted ? 'text-slate-500' : 'text-slate-900')}>{title}</div>
        {children}
      </div>
    </div>
  );
}

/** 메뉴 배지용: 답할 것 수 (열린 요청 · 확인 안 한 코칭) */
export function useFromLeaderOpenCount() {
  const { items } = useFromLeader();
  return items.filter((i) => i.open).length;
}

