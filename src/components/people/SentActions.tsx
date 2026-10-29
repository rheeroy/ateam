// 팀원관리 › 보낸 액션 — 팀장이 팀원에게 보낸 육성 · 지원·격려 · 업무 독려 · 코칭을 한곳에서 (상태 · 답 · 취소)
//   팀원 쪽에서는 매니징 보드 › Feedback 에 같은 이름으로 보인다 (코칭은 팀원에게 'ATEAM 업무 피드백')
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartHandshake, Send, Sprout } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, errorText } from '../../lib/supabase';
import type { TeamRequest } from '../../lib/types';
import { cx, fmtShort } from '../../lib/format';
import { Card, useToast } from '../ui';
import { LogoMark } from '../Brand';

type Coach = { id: string; member_id: string; title: string; created_at: string; seen_at: string | null; acked_at: string | null; helpful: boolean | null };
type Row =
  | { t: 'req'; id: string; at: string; to: string; r: TeamRequest }
  | { t: 'coach'; id: string; at: string; to: string; c: Coach };
type Filter = 'all' | 'open' | 'grow' | 'push' | 'cheer' | 'coach';

const DAY = 86400000;
const KIND = {
  grow: { label: '육성', icon: Sprout, cls: 'bg-emerald-50 text-emerald-600' },
  push: { label: '업무 독려', icon: Send, cls: 'bg-indigo-50 text-indigo-600' },
  cheer: { label: '지원·격려', icon: HeartHandshake, cls: 'bg-rose-50 text-rose-500' },
} as const;
const reqType = (r: TeamRequest): 'grow' | 'push' | 'cheer' => (r.kind === 'grow' ? 'grow' : r.kind === 'cheer' ? 'cheer' : 'push');

export function SentActions({ bare = false }: { bare?: boolean } = {}) {
  const { team, uid, nameOf } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const box = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(8);
  const since = new Date(Date.now() - 90 * DAY).toISOString();

  const reqs = useQuery({
    queryKey: ['requests', team.id, 'sent-actions', uid],
    queryFn: () => q<TeamRequest[]>(supabase.from('team_requests').select('*').eq('team_id', team.id).eq('from_id', uid)
      .or(`and(kind.in.(grow,cheer),or(status.eq.open,created_at.gte.${since})),and(kind.eq.progress,item_id.is.null,or(status.eq.open,created_at.gte.${since}))`)
      .order('created_at', { ascending: false }).limit(80)),
  });
  const coach = useQuery({
    queryKey: ['coaching', team.id, 'sent'],
    queryFn: async () => {
      const { data, error } = await supabase.from('coaching_notes').select('id, member_id, title, created_at, seen_at, acked_at, helpful').eq('team_id', team.id).gte('created_at', since).order('created_at', { ascending: false }).limit(40);
      return error ? [] : (data as Coach[]);
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => q(supabase.from('team_requests').update({ status: 'canceled' }).eq('id', id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requests'] }); toast('취소했습니다. 팀원 화면에서도 사라집니다.'); },
    onError: (e) => toast(errorText(e)),
  });

  const rows = useMemo<Row[]>(() => [
    ...(reqs.data ?? []).map((r) => ({ t: 'req' as const, id: r.id, at: r.created_at, to: r.to_id, r })),
    ...(coach.data ?? []).map((c) => ({ t: 'coach' as const, id: c.id, at: c.created_at, to: c.member_id, c })),
  ].sort((a, b) => b.at.localeCompare(a.at)), [reqs.data, coach.data]);
  const isOpen = (x: Row) => (x.t === 'req' ? x.r.status === 'open' : !x.c.acked_at);
  const pick = (f: Filter) => (f === 'all' ? rows : f === 'open' ? rows.filter(isOpen) : f === 'coach' ? rows.filter((x) => x.t === 'coach') : rows.filter((x) => x.t === 'req' && reqType(x.r) === f));
  const shown = pick(filter);
  const TABS: [Filter, string][] = [['all', '전체'], ['open', '답 기다림'], ['grow', '육성'], ['push', '업무 독려'], ['cheer', '지원·격려'], ['coach', '코칭']];

  // 알림(답이 왔어요)에서 들어오면 여기로
  useEffect(() => { if (params.get('sent')) setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300); }, [params]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div ref={box} className="space-y-2.5 scroll-mt-20">
      {!bare && <div className="flex items-end gap-2 flex-wrap"><span className="text-sm font-bold text-slate-900">보낸 액션</span>
        <span className="text-xs text-slate-400">최근 90일 · 팀원에게 보낸 육성 · 지원·격려 · 업무 독려 · 코칭과 답</span></div>}
      <Card>
        <div className="px-4 py-3 border-b border-slate-100 flex gap-1 flex-wrap">
          {TABS.filter(([k]) => k === 'all' || pick(k).length > 0).map(([k, l]) => (
            <button key={k} onClick={() => { setFilter(k); setLimit(8); }}
              className={cx('text-xs rounded-md px-2.5 py-1 inline-flex items-center gap-1', filter === k ? 'bg-slate-800 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100')}>
              {l}<span className={cx('num', filter === k ? 'text-slate-300' : 'text-slate-400')}>{pick(k).length}</span></button>
          ))}
        </div>
        {reqs.isLoading || coach.isLoading ? <p className="px-5 py-6 text-sm text-slate-400">불러오는 중</p> : !shown.length ? (
          <p className="px-5 py-6 text-sm text-slate-400 text-center">{filter === 'all' ? '최근 90일 동안 보낸 액션이 없습니다. 위 추천이나 팀원 상세에서 보낼 수 있어요.' : '해당하는 액션이 없습니다.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.slice(0, limit).map((x) => {
              if (x.t === 'coach') {
                const c = x.c;
                return (
                  <li key={x.id} className="px-5 py-3 flex items-start gap-3">
                    <span className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><LogoMark size={15} weight={4} /></span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-slate-400"><b className="font-semibold text-slate-500">코칭</b> · {nameOf(c.member_id)} · {fmtShort(c.created_at)}</div>
                      <div className="text-sm font-semibold text-slate-800 truncate">{c.title}</div>
                    </div>
                    <span className={cx('shrink-0 text-[11px] rounded-full px-2 py-0.5 mt-1', c.acked_at ? 'bg-emerald-50 text-emerald-700' : c.seen_at ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700')}>
                      {c.acked_at ? `확인함${c.helpful ? ' · 도움됨' : ''}` : c.seen_at ? '읽음' : '안 읽음'}</span>
                  </li>
                );
              }
              const r = x.r; const m = KIND[reqType(r)];
              const late = r.status === 'open' && !!r.due_date && r.due_date < today;
              return (
                <li key={x.id} className="px-5 py-3 flex items-start gap-3">
                  <span className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', m.cls, r.status === 'canceled' && 'opacity-50')}><m.icon size={15} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-slate-400"><b className="font-semibold text-slate-500">{m.label}</b> · {nameOf(r.to_id)} · {fmtShort(r.created_at)}{r.due_date && ` · ${fmtShort(r.due_date)}까지`}</div>
                    <div className={cx('text-sm font-semibold truncate', r.status === 'canceled' ? 'text-slate-400 line-through' : 'text-slate-800')}>{r.title}</div>
                    {r.status === 'done' && r.response && <p className="text-xs text-slate-600 mt-0.5">답 · {r.response}</p>}
                  </div>
                  <span className={cx('shrink-0 text-[11px] rounded-full px-2 py-0.5 mt-1',
                    r.status === 'done' ? 'bg-emerald-50 text-emerald-700' : r.status === 'canceled' ? 'bg-slate-100 text-slate-500' : late ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>
                    {r.status === 'done' ? (r.kind === 'cheer' ? '확인함' : '답함') : r.status === 'canceled' ? '취소' : late ? '기한 지남' : '답 기다림'}</span>
                  {r.status === 'open' && <button className="shrink-0 mt-1 text-xs text-slate-400 hover:text-rose-600" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>취소</button>}
                </li>
              );
            })}
          </ul>
        )}
        {shown.length > limit && <button onClick={() => setLimit((n) => n + 20)} className="w-full border-t border-slate-100 py-2.5 text-xs text-slate-500 hover:bg-slate-50">더 보기 ({shown.length - limit})</button>}
      </Card>
    </div>
  );
}
