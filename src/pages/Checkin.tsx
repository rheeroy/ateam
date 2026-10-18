import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, MessageSquare, Sparkles } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import type { AiOutput, Checkin as C } from '../lib/types';
import { PromiseList } from '../components/member/Member';
import { MyProgress } from '../components/goals/MyProgress';
import { cx, fmtDate, mondayOf, weekLabel, weekRangeLabel } from '../lib/format';
import { LeaderGuide } from '../components/LeaderGuide';
import { Button, Card, CardHead, Field, PageHeader, inputCls, useToast } from '../components/ui';

const DOT = ['', 'bg-rose-500', 'bg-orange-400', 'bg-amber-400', 'bg-emerald-400', 'bg-emerald-600'];

export default function Checkin() {
  const { team, uid } = useTeam();
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

  const [nudge, setNudge] = useState(false);
  const draft = useMutation({
    mutationFn: () => invoke<AiOutput<{ did?: string; blocked?: string; next?: string }>>('ai-checkin-draft', { team_id: team.id }),
    onSuccess: (o) => {
      const c = o.content ?? {};
      if (!did.trim() && c.did) setDid(c.did);
      if (!blocked.trim() && c.blocked) setBlocked(c.blocked);
      if (!next.trim() && c.next) setNext(c.next);
      toast(did.trim() || next.trim() ? '비어 있던 칸만 채웠습니다. 고쳐서 보내세요.' : '이번 주 기록으로 초안을 채웠습니다. 고쳐서 보내세요.');
    },
    onError: (e) => toast(errorText(e)),
  });
  const submit = () => { if (cond == null && !nudge) { setNudge(true); return; } save.mutate(); };
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
            <div className="flex items-center justify-between gap-2 -mb-2">
              <span className="text-xs text-slate-500">이번 주 앱 기록(올린 결과물·진척·요청)으로 초안을 만들 수 있어요</span>
              <Button size="sm" variant="soft" loading={draft.isPending} onClick={() => draft.mutate()}><Sparkles size={13} />AI로 초안 채우기</Button>
            </div>
            <Field label="이번 주에 한 일"><textarea rows={3} className={inputCls} value={did} onChange={(e) => setDid(e.target.value)} placeholder={history.data?.[0]?.next ? `지난주 계획: ${history.data[0].next}` : '예) 신제품 기획서 v3 제출, 사용자 인터뷰 설계 시작'} /></Field>
            <Field label="막힌 일" hint="(없으면 비워두세요)"><textarea rows={2} className={inputCls} value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder="예) 영업팀 인터뷰 대상 섭외가 늦어지고 있음" /></Field>
            <Field label="다음 주에 할 일"><textarea rows={2} className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} placeholder="예) 인터뷰 8명 진행" /></Field>
            <div>
              <div className="text-sm font-semibold">이번 주 컨디션</div>
              <div className="mt-2 grid grid-cols-5 gap-2 text-sm">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => { setCond(n); setNudge(false); }}
                    className={cx('border rounded-lg py-2', cond === n ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>
                    {n}<span className="block text-[11px] text-slate-400">{n === 1 ? '힘듦' : n === 3 ? '보통' : n === 5 ? '좋음' : ''}</span>
                  </button>
                ))}
              </div>
            </div>
            {nudge && cond == null && <p className="-mt-2 text-xs text-amber-700 rounded-lg bg-amber-50 px-3 py-2">이번 주 컨디션도 골라 주세요 — 팀장님만 보고, 도움이 필요한 때를 알아차리는 데 씁니다. 그래도 그냥 보내려면 한 번 더 누르세요.</p>}
            <Button className="w-full" disabled={!did.trim()} loading={save.isPending} onClick={submit}>{mine ? '다시 보내기' : '보내기'}</Button>
          </Card>
          <p className="text-[11px] text-slate-400 mt-3 px-1 leading-relaxed">체크인은 팀장님과 나만 볼 수 있습니다. AI가 팀장님의 1:1·피드백 준비를 돕는 데 사용됩니다.</p>
        </div>

        <div className="lg:col-span-2 space-y-5">
          <MyProgress title="내 목표·과제 진척" />
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
            <div className="font-semibold mb-3">1:1에서 정한 약속</div>
            <PromiseList />
            <div className="mt-4 flex gap-2">
              <Link to="/my/one-on-ones" className="flex-1"><Button variant="secondary" className="w-full"><MessageSquare size={14} />내 1:1</Button></Link>
              <Link to="/my/submissions" className="flex-1"><Button variant="secondary" className="w-full"><FileUp size={14} />결과물 올리기</Button></Link>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
