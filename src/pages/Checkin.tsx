import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, MessageSquare } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import type { ActionItem, Checkin as C } from '../lib/types';
import { MyProgress } from '../components/goals/MyProgress';
import { cx, fmtDate, mondayOf, weekLabel, weekRangeLabel } from '../lib/format';
import { LeaderGuide } from '../components/LeaderGuide';
import { Button, Card, CardHead, Field, PageHeader, inputCls, useToast } from '../components/ui';

const DOT = ['', 'bg-rose-500', 'bg-orange-400', 'bg-amber-400', 'bg-emerald-400', 'bg-emerald-600'];

export default function Checkin() {
  const { team, uid, nameOf } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const week = mondayOf();
  const [did, setDid] = useState('');
  const [blocked, setBlocked] = useState('');
  const [next, setNext] = useState('');
  const [cond, setCond] = useState<number | null>(null);

  const history = useQuery({
    queryKey: ['checkins', team.id, uid],
    queryFn: () => q<C[]>(supabase.from('checkins').select('*').eq('team_id', team.id).eq('user_id', uid).order('week_start', { ascending: false }).limit(12)),
  });
  const mine = history.data?.find((c) => c.week_start === week);
  useEffect(() => {
    if (mine) { setDid(mine.did); setBlocked(mine.blocked); setNext(mine.next); setCond(mine.condition); }
  }, [mine]);

  const items = useQuery({
    queryKey: ['my-actions', team.id, uid],
    queryFn: () => q<ActionItem[]>(supabase.from('action_items').select('*').eq('team_id', team.id).eq('owner_id', uid).is('done_at', null).order('due_date')),
  });

  const feedback = useQuery({
    queryKey: ['my-feedback', team.id, uid],
    queryFn: async () => {
      const subs = await q<{ id: string; title: string }[]>(supabase.from('submissions').select('id, title').eq('team_id', team.id).eq('author_id', uid));
      if (!subs.length) return [];
      const cs = await q<{ id: string; submission_id: string; author_id: string; body: string; section_ref: string | null; created_at: string }[]>(
        supabase.from('review_comments').select('id, submission_id, author_id, body, section_ref, created_at').in('submission_id', subs.map((x) => x.id)).neq('author_id', uid).order('created_at', { ascending: false }).limit(5));
      return cs.map((c) => ({ ...c, title: subs.find((x) => x.id === c.submission_id)?.title ?? '' }));
    },
  });
  const save = useMutation({
    mutationFn: () => q(supabase.from('checkins').upsert({ team_id: team.id, user_id: uid, week_start: week, did, blocked, next, condition: cond }, { onConflict: 'team_id,user_id,week_start' })),
    onSuccess: () => { toast('체크인을 보냈습니다'); qc.invalidateQueries({ queryKey: ['checkins'] }); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <section>
      <div className="grid lg:grid-cols-5 gap-6 items-start">
        <div className="lg:col-span-3">
          <PageHeader title="이번 주 체크인" sub={`${weekRangeLabel(week)} · 1분이면 됩니다`} />
          <Card className="p-6 space-y-5">
            {mine && <div className="text-xs text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={13} />{fmtDate(mine.updated_at)}에 보냈습니다. 고쳐서 다시 보낼 수 있습니다.</div>}
            <Field label="이번 주에 한 일"><textarea rows={3} className={inputCls} value={did} onChange={(e) => setDid(e.target.value)} placeholder={history.data?.[0]?.next ? `지난주 계획: ${history.data[0].next}` : '예) 신제품 기획서 v3 제출, 사용자 인터뷰 설계 시작'} /></Field>
            <Field label="막힌 일" hint="(없으면 비워두세요)"><textarea rows={2} className={inputCls} value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder="예) 영업팀 인터뷰 대상 섭외가 늦어지고 있음" /></Field>
            <Field label="다음 주에 할 일"><textarea rows={2} className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} placeholder="예) 인터뷰 8명 진행" /></Field>
            <div>
              <div className="text-sm font-semibold">이번 주 컨디션</div>
              <div className="mt-2 grid grid-cols-5 gap-2 text-sm">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setCond(n)}
                    className={cx('border rounded-lg py-2', cond === n ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>
                    {n}<span className="block text-[11px] text-slate-400">{n === 1 ? '힘듦' : n === 3 ? '보통' : n === 5 ? '좋음' : ''}</span>
                  </button>
                ))}
              </div>
            </div>
            <Button className="w-full" disabled={!did.trim()} loading={save.isPending} onClick={() => save.mutate()}>{mine ? '다시 보내기' : '보내기'}</Button>
          </Card>
          <p className="text-[11px] text-slate-400 mt-3 px-1 leading-relaxed">체크인은 팀장님과 나만 볼 수 있습니다. AI가 팀장님의 1:1·피드백 준비를 돕는 데 사용됩니다.</p>
        </div>

        <div className="lg:col-span-2 space-y-5">
          <MyProgress title="내 목표·과제 진척" />
          {!!feedback.data?.length && (
            <Card>
              <CardHead title="최근 받은 피드백" />
              <ul className="p-5 space-y-3 text-sm">
                {feedback.data.map((f) => (
                  <li key={f.id}>
                    <Link to={`/work/${f.submission_id}`} className="text-xs text-indigo-700">{f.title}{f.section_ref && ` · ${f.section_ref}`}</Link>
                    <p className="text-slate-700 mt-0.5">{f.body}</p>
                    <p className="text-[11px] text-slate-400">{nameOf(f.author_id)} · {fmtDate(f.created_at)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <LeaderGuide teamId={team.id} kinds={['principle', 'coaching', 'framework']} />
          <Card>
            <CardHead title="지난 체크인" />
            <ul className="p-5 space-y-3 text-sm">
              {(history.data ?? []).filter((c) => c.week_start !== week).slice(0, 6).map((c) => (
                <li key={c.id} className="flex gap-3">
                  <span className="font-mono text-xs text-slate-400 w-9 shrink-0 mt-0.5">{weekLabel(c.week_start)}</span>
                  <span className="flex-1 text-slate-700">{c.did}{c.blocked && <span className="text-amber-700"> · 막힘: {c.blocked}</span>}</span>
                  {c.condition && <span className={cx('w-2 h-2 rounded-full mt-1.5', DOT[c.condition])} title={`컨디션 ${c.condition}`} />}
                </li>
              ))}
              {!history.data?.filter((c) => c.week_start !== week).length && <li className="text-slate-500">첫 체크인입니다.</li>}
            </ul>
          </Card>
          <Card className="p-5">
            <div className="font-semibold">할 일</div>
            {!items.data?.length ? <p className="mt-2 text-sm text-slate-500">1:1에서 정한 할 일이 없습니다.</p> : (
              <ul className="mt-3 space-y-2 text-sm">{items.data.map((a) => <li key={a.id} className="flex justify-between gap-2"><span>{a.title}</span><span className="text-xs text-slate-500">{a.due_date ? fmtDate(a.due_date) : ''}</span></li>)}</ul>
            )}
            <div className="mt-4 flex gap-2">
              <Link to="/my/one-on-ones" className="flex-1"><Button variant="secondary" className="w-full"><MessageSquare size={14} />내 1:1</Button></Link>
              <Link to="/my/submissions" className="flex-1"><Button variant="secondary" className="w-full"><FileUp size={14} />결과물 올리기</Button></Link>
            </div>
            <p className="mt-3 text-xs text-slate-400">팀장 · {nameOf(team.owner_id)}</p>
          </Card>
        </div>
      </div>
    </section>
  );
}
