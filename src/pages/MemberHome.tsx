import { useState } from 'react';
// 팀원 홈: 팀장이 부탁한 것 · 내 목표·과제 · 받은 피드백 · 이번 주 체크인
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, FileUp, Inbox, MessageSquareQuote, PenLine } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import type { Checkin, OneOnOne, TeamRequest } from '../lib/types';
import { cx, fmtDate, fmtShort, fmtTime, mondayOf, relDay } from '../lib/format';
import { Avatar, Button, Card, CardHead, Pill, useToast } from '../components/ui';
import { MyProgress } from '../components/goals/MyProgress';
import { LeaderGuide } from '../components/LeaderGuide';
import { REQUEST_KIND } from '../components/RequestModal';
import { MyCoaching } from '../components/people/Coaching';

function Requests() {
  const { team, uid, nameOf } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = useState<Record<string, string>>({});
  const list = useQuery({
    queryKey: ['requests', team.id, 'to', uid, 'all'],
    queryFn: () => q<TeamRequest[]>(supabase.from('team_requests').select('*').eq('team_id', team.id).eq('to_id', uid).eq('status', 'open').order('created_at', { ascending: false })),
  });
  const done = useMutation({
    mutationFn: (r: TeamRequest) => q(supabase.from('team_requests').update({ status: 'done', response: reply[r.id] ?? '' }).eq('id', r.id)),
    onSuccess: (_d, r) => { qc.invalidateQueries({ queryKey: ['requests'] }); toast(r.kind === 'cheer' ? '확인했다고 팀장님께 알렸어요.' : r.kind === 'grow' ? '답을 보냈어요. 팀장님께 알림이 갑니다.' : '완료로 표시했습니다. 팀장에게 알림이 갑니다.'); },
    onError: (e) => toast(errorText(e)),
  });
  if (!list.data?.length) return null;
  const CTA: Record<TeamRequest['kind'], { label: string; to: (r: TeamRequest) => string } | null> = {
    plan: { label: '계획 세우기', to: (r) => `/my/goals${r.item_id ? `?item=${r.item_id}` : ''}` },
    progress: { label: '진척 남기기', to: (r) => `/my/goals${r.item_id ? `?item=${r.item_id}` : ''}` },
    share: { label: '공유하기', to: () => '/my/submissions?new=1' },
    meeting: { label: '내 1:1', to: () => '/my/one-on-ones' },
    other: null,
    grow: null,
    cheer: null,
  };
  const DONE: Partial<Record<TeamRequest['kind'], string>> = { grow: '답 보내기', cheer: '확인했어요' };
  return (
    <Card className="border-violet-200">
      <CardHead icon={<Inbox size={16} className="text-violet-600" />} title={`팀장님 요청·메시지 ${list.data.length}건`} />
      <ul className="divide-y divide-slate-100">
        {list.data.map((r) => {
          const late = r.due_date && r.due_date < new Date().toISOString().slice(0, 10);
          const cta = CTA[r.kind];
          return (
            <li key={r.id} className="px-5 py-3.5">
              <div className="flex items-start gap-3">
                <Avatar name={nameOf(r.from_id)} size={8} tone="indigo" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{r.title}</span><Pill tone="violet">{REQUEST_KIND[r.kind].label}</Pill></div>
                  {r.body && <p className="text-sm text-slate-600 mt-0.5">{r.body}</p>}
                  <div className={cx('text-xs mt-0.5', late ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{fmtDate(r.created_at)} 요청{r.due_date && ` · ${fmtShort(r.due_date)}까지`}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {cta && <Link to={cta.to(r)}><Button size="sm">{cta.label}</Button></Link>}
                    <input className="flex-1 min-w-[140px] text-xs border border-slate-200 rounded-lg px-2.5 py-1.5" placeholder={r.kind === 'grow' ? '해 보고 싶은 일 · 생각 (선택)' : r.kind === 'cheer' ? '한 줄 답장 (선택)' : '한 줄 답 (선택)'} value={reply[r.id] ?? ''} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} />
                    <Button size="sm" variant="secondary" onClick={() => done.mutate(r)}><CheckCircle2 size={13} />{DONE[r.kind] ?? '완료'}</Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Feedback() {
  const { team, uid, nameOf } = useTeam();
  const fb = useQuery({
    queryKey: ['my-feedback-all', team.id, uid],
    queryFn: async () => {
      const its = await q<{ id: string; title: string }[]>(supabase.from('work_items').select('id, title').eq('team_id', team.id).eq('owner_id', uid));
      const subs = await q<{ id: string; title: string }[]>(supabase.from('submissions').select('id, title').eq('team_id', team.id).eq('author_id', uid));
      const [ic, rc] = await Promise.all([
        its.length ? q<{ id: string; item_id: string; author_id: string; body: string; kind: string; created_at: string }[]>(supabase.from('work_item_comments').select('id, item_id, author_id, body, kind, created_at').in('item_id', its.map((x) => x.id)).neq('author_id', uid).order('created_at', { ascending: false }).limit(6)) : [],
        subs.length ? q<{ id: string; submission_id: string; author_id: string; body: string; created_at: string }[]>(supabase.from('review_comments').select('id, submission_id, author_id, body, created_at').in('submission_id', subs.map((x) => x.id)).neq('author_id', uid).order('created_at', { ascending: false }).limit(6)) : [],
      ]);
      return [
        ...ic.map((c) => ({ id: c.id, who: c.author_id, body: c.body || (c.kind === 'approve' ? '승인했습니다' : ''), at: c.created_at, title: its.find((x) => x.id === c.item_id)?.title ?? '', to: `/my/goals?item=${c.item_id}`, kind: c.kind })),
        ...rc.map((c) => ({ id: c.id, who: c.author_id, body: c.body, at: c.created_at, title: subs.find((x) => x.id === c.submission_id)?.title ?? '', to: `/work/${c.submission_id}`, kind: 'review' })),
      ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
    },
  });
  if (!fb.data?.length) return null;
  return (
    <Card>
      <CardHead icon={<MessageSquareQuote size={16} className="text-indigo-600" />} title="최근 받은 피드백" />
      <ul className="divide-y divide-slate-100">
        {fb.data.map((f) => (
          <li key={f.id}><Link to={f.to} className="block px-5 py-3 hover:bg-slate-50 text-sm">
            <div className="text-xs text-indigo-700 truncate">{f.title}{f.kind === 'changes' && <span className="text-amber-700"> · 수정 요청</span>}{f.kind === 'approve' && <span className="text-emerald-700"> · 승인</span>}</div>
            <p className="text-slate-700 mt-0.5 line-clamp-2">{f.body}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{nameOf(f.who)} · {fmtDate(f.at)}</p>
          </Link></li>
        ))}
      </ul>
    </Card>
  );
}

export default function MemberHome() {
  const { team, uid, profile, nameOf } = useTeam();
  const week = mondayOf();
  const [params] = useSearchParams();
  const ci = useQuery({ queryKey: ['checkins', team.id, uid, 'this'], queryFn: () => q<Checkin[]>(supabase.from('checkins').select('*').eq('team_id', team.id).eq('user_id', uid).eq('week_start', week)) });
  const oo = useQuery({ queryKey: ['my-oo-next', team.id, uid], queryFn: () => q<OneOnOne[]>(supabase.from('one_on_ones').select('*').eq('team_id', team.id).eq('member_id', uid).eq('status', 'scheduled').gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(1)) });
  const sent = !!ci.data?.length;
  const next = oo.data?.[0];
  return (
    <section>
      <p className="text-sm text-slate-500">{fmtDate(new Date().toISOString(), true)}</p>
      <h1 className="text-2xl font-bold tracking-tight mt-1">{profile?.full_name}님, 이번 주도 화이팅입니다</h1>
      <div className="mt-5 grid sm:grid-cols-3 gap-3">
        <Link to="/checkin" className={cx('rounded-2xl border p-4 hover:border-indigo-300', sent ? 'bg-white border-slate-200' : 'bg-indigo-600 border-indigo-600 text-white')}>
          <div className={cx('text-xs flex items-center gap-1.5', sent ? 'text-slate-500' : 'text-indigo-100')}><PenLine size={13} />이번 주 체크인</div>
          <div className="mt-1 font-semibold">{sent ? '보냈습니다 · 고치기' : '1분이면 됩니다 →'}</div>
          <div className={cx('text-xs mt-0.5', sent ? 'text-slate-400' : 'text-indigo-100')}>체크인만 하면 따로 주간보고를 안 써도 됩니다</div>
        </Link>
        <Link to="/my/submissions?new=1" className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-300">
          <div className="text-xs text-slate-500 flex items-center gap-1.5"><FileUp size={13} />공유하기</div>
          <div className="mt-1 font-semibold">문서·링크·캡처·숫자</div>
          <div className="text-xs text-slate-400 mt-0.5">어디서 일했든 결과만 올리면 팀장님께 바로 갑니다</div>
        </Link>
        <Link to="/my/one-on-ones" className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-300">
          <div className="text-xs text-slate-500 flex items-center gap-1.5"><CalendarClock size={13} />다음 1:1</div>
          <div className="mt-1 font-semibold">{next ? `${relDay(next.scheduled_at)} ${fmtTime(next.scheduled_at)} · ${nameOf(next.leader_id)}` : '잡힌 일정 없음'}</div>
          <div className="text-xs text-slate-400 mt-0.5">이야기할 거리를 미리 남겨 둘 수 있습니다</div>
        </Link>
      </div>
      <div className="mt-6 grid lg:grid-cols-5 gap-5 items-start">
        <div className="lg:col-span-3 space-y-5">
          <MyCoaching focusId={params.get('coach')} />
          <Requests />
          <MyProgress limit={10} />
          <Card className="p-5 text-sm text-slate-600">
            <b className="text-slate-800">내 목표·과제</b>에서 팀장님이 맡긴 목표 아래 계획을 세우고, AI로 초안을 만들 수 있습니다.
            <Link to="/my/goals" className="ml-1 text-indigo-700 font-semibold">열기 →</Link>
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-5">
          <Feedback />
          <LeaderGuide teamId={team.id} kinds={['principle', 'rubric', 'framework', 'coaching']} />
        </div>
      </div>
    </section>
  );
}
