import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Circle, ClipboardList, Clock, EyeOff, FileText, HeartPulse, Layers,
  Lock, MessagesSquare, RefreshCw, Sparkles, StickyNote, ThumbsUp, TrendingDown, X,
} from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { useGenerate, useLatestAi, useTeamMembersOnly } from '../lib/hooks';
import type { ActionItem, AiOutput, CareRow, InsightLevel, OneOnOne, Submission, SubmissionVersion } from '../lib/types';
import { addDays, cx, daysAgo, fmtDate, fmtTime, mondayOf, relDay, ymd } from '../lib/format';
import { Avatar, Button, Card, Modal, Spinner, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, TaggedText, kindFromStatus } from '../components/Prov';

// =====================================================================
// 데이터 (같은 queryKey를 쓰므로 요약 문장·탭·목록이 한 번만 조회한다)
// =====================================================================
type PromiseRow = ActionItem & { one_on_ones: { member_id: string } | null };
type ReviewRow = { s: Submission; v?: Pick<SubmissionVersion, 'id' | 'version' | 'created_at'>; review?: Pick<AiOutput, 'ref_id' | 'sources' | 'depth' | 'level'> };

function useWeekOneOnOnes(teamId: string) {
  const mon = mondayOf();
  return useQuery({
    queryKey: ['oo-week', teamId, mon],
    queryFn: () => q<OneOnOne[]>(supabase.from('one_on_ones').select('*').eq('team_id', teamId).eq('status', 'scheduled')
      .gte('scheduled_at', mon).lt('scheduled_at', addDays(mon, 7)).order('scheduled_at')),
  });
}
function useReviewQueue(teamId: string) {
  return useQuery({
    queryKey: ['review-queue', teamId],
    queryFn: async (): Promise<ReviewRow[]> => {
      const subs = await q<(Submission & { submission_versions: Pick<SubmissionVersion, 'id' | 'version' | 'created_at'>[] })[]>(
        supabase.from('submissions').select('*, submission_versions(id, version, created_at)').eq('team_id', teamId).eq('status', 'in_review').order('updated_at', { ascending: false }).limit(20));
      const latest = subs.map((s) => [...s.submission_versions].sort((a, b) => b.version - a.version)[0]).filter(Boolean);
      const reviews = latest.length ? await q<Pick<AiOutput, 'ref_id' | 'sources' | 'depth' | 'level'>[]>(supabase.from('ai_outputs')
        .select('ref_id, sources, depth, level').eq('kind', 'review').in('ref_id', latest.map((v) => v.id))) : [];
      return subs.map((s) => {
        const v = [...s.submission_versions].sort((a, b) => b.version - a.version)[0];
        return { s, v, review: reviews.find((r) => r.ref_id === v?.id) };
      });
    },
  });
}
function usePromises(teamId: string) {
  const { uid } = useTeam();
  return useQuery({
    queryKey: ['promises', teamId, uid],
    queryFn: () => q<PromiseRow[]>(supabase.from('action_items')
      .select('*, one_on_ones(member_id)').eq('team_id', teamId).eq('owner_id', uid).is('done_at', null).order('due_date', { nullsFirst: false }).limit(20)),
  });
}
function useCare(teamId: string) {
  return useQuery({ queryKey: ['care', teamId], queryFn: () => q<CareRow[]>(supabase.rpc('care_radar', { p_team: teamId })) });
}
const todayYmd = () => ymd(new Date());
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

// =====================================================================
// 공통 레이아웃 조각
// =====================================================================
function Section({ n, title, desc, children }: { n: string; title: string; desc: string; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-8">
      <div className="mb-3 flex items-baseline gap-3 flex-wrap">
        <span className="font-mono text-xs font-semibold text-indigo-600">{n}</span>
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        <span className="text-sm text-slate-500">{desc}</span>
      </div>
      {children}
    </section>
  );
}
function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="block px-5 py-3 text-sm text-center text-indigo-700 font-semibold border-t border-slate-100 hover:bg-slate-50 rounded-b-2xl">{children}</Link>;
}
function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-sm text-slate-500 text-center">{children}</p>;
}

// =====================================================================
// 머리말: 인사 + 오늘 요약 한 문장 + 자주 쓰는 동작
// =====================================================================
function Header({ teamId, onMemo }: { teamId: string; onMemo: () => void }) {
  const { profile } = useTeam();
  const oo = useWeekOneOnOnes(teamId).data ?? [];
  const rv = useReviewQueue(teamId).data ?? [];
  const pr = usePromises(teamId).data ?? [];
  const care = useCare(teamId).data ?? [];
  const now = new Date();
  const hello = now.getHours() < 11 ? '좋은 아침입니다' : now.getHours() < 18 ? '안녕하세요' : '오늘도 수고 많으셨습니다';
  const late = pr.filter((a) => a.due_date && a.due_date < todayYmd()).length;
  const ooToday = oo.filter((o) => isToday(o.scheduled_at)).length;
  const parts = [
    ooToday > 0 && `오늘 1:1 ${ooToday}건`,
    rv.length > 0 && `리뷰 ${rv.length}건`,
    late > 0 && `기한 지난 약속 ${late}건`,
    care.length > 0 && `챙길 팀원 ${care.length}명`,
  ].filter(Boolean) as string[];
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{fmtDate(now.toISOString(), true)}</p>
        <h1 className="text-2xl font-bold tracking-tight mt-1">{hello}, {profile?.full_name} 팀장님</h1>
        <p className="mt-1.5 text-[15px] text-slate-600">
          {parts.length ? <>오늘은 <b className="text-slate-900">{parts.join(' · ')}</b>이 기다리고 있습니다.</> : '오늘은 급한 일이 없습니다. 팀 흐름을 살펴보세요.'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onMemo}><StickyNote size={15} />관찰 메모</Button>
        <Link to="/report"><Button><ClipboardList size={15} />주간보고 초안</Button></Link>
      </div>
    </div>
  );
}

// =====================================================================
// 시작 가이드 (다 끝나면 사라짐) — 한 줄짜리로 얇게
// =====================================================================
const QS_KEY = 'ateam.quickstart.hidden';
function QuickStart({ teamId }: { teamId: string }) {
  const { members } = useTeam();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(QS_KEY) === '1'; } catch { return false; } });
  const st = useQuery({
    queryKey: ['quickstart', teamId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count = async (t: string, f?: (x: any) => any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let qb: any = supabase.from(t).select('id', { count: 'exact', head: true }).eq('team_id', teamId);
        if (f) qb = f(qb);
        return (await qb).count ?? 0;
      };
      const [kh, rep, oo] = await Promise.all([
        count('knowhow_cards'), count('ai_outputs', (x) => x.eq('kind', 'weekly_report')), count('one_on_ones'),
      ]);
      return { kh, rep, oo };
    },
  });
  if (hidden || !st.data) return null;
  const steps = [
    { done: st.data.kh > 0, title: '내 노하우 넣기', desc: '원칙·자료를 넣으면 AI가 팀장님 기준으로 일합니다', to: '/knowhow' },
    { done: members.some((m) => m.role === 'member'), title: '팀원 초대', desc: '링크 하나로 초대, 팀원은 무료', to: '/team' },
    { done: st.data.rep > 0, title: '주간보고 초안 받기', desc: '팀원이 없어도 메모 몇 줄이면 됩니다', to: '/report' },
    { done: st.data.oo > 0, title: '첫 1:1 잡기', desc: 'AI가 준비 노트를 만들어 둡니다', to: '/one-on-ones?new=1' },
  ];
  const doneN = steps.filter((x) => x.done).length;
  if (doneN === steps.length) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(QS_KEY, '1'); } catch { /* 저장 불가 */ } };
  return (
    <div className="mt-6 rounded-2xl bg-indigo-50/70 border border-indigo-100 p-4">
      <div className="flex items-center gap-3">
        <Sparkles size={16} className="text-indigo-600 shrink-0" />
        <div className="font-semibold text-sm">ATEAM 시작하기</div>
        <div className="flex-1 h-1.5 rounded-full bg-indigo-100 max-w-40"><div className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${(doneN / steps.length) * 100}%` }} /></div>
        <span className="font-mono text-xs text-indigo-700">{doneN}/{steps.length}</span>
        <button aria-label="시작 가이드 숨기기" className="ml-auto text-slate-400 hover:text-slate-600" onClick={hide}><X size={16} /></button>
      </div>
      <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {steps.map((x, i) => (
          <Link key={x.title} to={x.to} className={cx('rounded-xl px-3 py-2.5 text-sm flex items-start gap-2.5',
            x.done ? 'text-slate-400' : 'bg-white border border-indigo-100 hover:border-indigo-300')}>
            {x.done ? <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 shrink-0" />
              : <span className="w-4 h-4 mt-0.5 rounded-full border-2 border-indigo-300 text-[9px] font-bold flex items-center justify-center text-indigo-600 shrink-0">{i + 1}</span>}
            <span className="min-w-0">
              <span className={cx('font-semibold block', x.done && 'line-through')}>{x.title}</span>
              {!x.done && <span className="text-xs text-slate-500 block mt-0.5">{x.desc}</span>}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// ① 오늘 할 일 — 리뷰 / 1:1 / 약속을 한 상자에서 탭으로
// =====================================================================
type TaskTab = 'review' | 'oo' | 'promise';
const LIST_MAX = 4;

function TaskInbox({ teamId }: { teamId: string }) {
  const oo = useWeekOneOnOnes(teamId);
  const rv = useReviewQueue(teamId);
  const pr = usePromises(teamId);
  const late = (pr.data ?? []).filter((a) => a.due_date && a.due_date < todayYmd()).length;
  const ooToday = (oo.data ?? []).filter((o) => isToday(o.scheduled_at)).length;
  const auto: TaskTab = ooToday > 0 ? 'oo' : (rv.data?.length ?? 0) > 0 ? 'review' : late > 0 ? 'promise' : 'oo';
  const [picked, setPicked] = useState<TaskTab | null>(null);
  const tab = picked ?? auto;
  const tabs: { id: TaskTab; icon: ReactNode; label: string; n: number; alert?: string }[] = [
    { id: 'review', icon: <FileText size={15} />, label: '리뷰 대기', n: rv.data?.length ?? 0 },
    { id: 'oo', icon: <MessagesSquare size={15} />, label: '이번 주 1:1', n: oo.data?.length ?? 0, alert: ooToday ? `오늘 ${ooToday}` : undefined },
    { id: 'promise', icon: <CheckCircle2 size={15} />, label: '내가 한 약속', n: pr.data?.length ?? 0, alert: late ? `지남 ${late}` : undefined },
  ];
  return (
    <Card className="flex flex-col">
      <div className="grid grid-cols-3 border-b border-slate-100" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setPicked(t.id)}
            className={cx('px-3 sm:px-5 py-3.5 text-left border-b-2 -mb-px first:rounded-tl-2xl last:rounded-tr-2xl',
              tab === t.id ? 'border-indigo-600 bg-indigo-50/40' : 'border-transparent hover:bg-slate-50')}>
            <div className={cx('flex items-center gap-1.5 text-xs sm:text-sm', tab === t.id ? 'text-indigo-700 font-semibold' : 'text-slate-500')}>{t.icon}<span className="truncate">{t.label}</span></div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={cx('text-2xl font-bold num', tab === t.id ? 'text-slate-900' : 'text-slate-700')}>{t.n}</span>
              {t.alert && <span className={cx('text-[11px] font-semibold rounded-full px-1.5 py-0.5', t.id === 'promise' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-100 text-indigo-700')}>{t.alert}</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="flex-1">
        {tab === 'review' && <ReviewList rows={rv.data} loading={rv.isLoading} />}
        {tab === 'oo' && <OneOnOneList teamId={teamId} rows={oo.data} loading={oo.isLoading} />}
        {tab === 'promise' && <PromiseList rows={pr.data} loading={pr.isLoading} />}
      </div>
    </Card>
  );
}

function ReviewList({ rows, loading }: { rows?: ReviewRow[]; loading: boolean }) {
  const { nameOf } = useTeam();
  if (loading) return <Spinner />;
  if (!rows?.length) return <EmptyLine>리뷰를 기다리는 결과물이 없습니다.</EmptyLine>;
  return (
    <>
      {rows.slice(0, LIST_MAX).map(({ s, v, review }) => (
        <Link key={s.id} to={`/reviews/${s.id}`} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{s.title} {v && <span className="font-mono text-xs text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5 ml-1">v{v.version}</span>}</div>
            <div className="text-sm text-slate-500">{nameOf(s.author_id)} · {fmtDate(v?.created_at ?? s.created_at)} 제출</div>
          </div>
          {review ? <ProvChip kind="ai" label="AI 1차 검토 완료" sources={review.sources} depth={review.depth} level={review.level} />
            : <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-violet-600"><span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />AI 검토 대기</span>}
          <ChevronRight size={16} className="text-slate-300 shrink-0" />
        </Link>
      ))}
      {rows.length > LIST_MAX && <MoreLink to="/reviews">리뷰 {rows.length - LIST_MAX}건 더 보기</MoreLink>}
    </>
  );
}

function OneOnOneList({ teamId, rows, loading }: { teamId: string; rows?: OneOnOne[]; loading: boolean }) {
  const { nameOf } = useTeam();
  const preps = useQuery({
    queryKey: ['ai', teamId, 'one_on_one_prep', 'week', (rows ?? []).map((o) => o.id)],
    enabled: !!rows?.length,
    queryFn: () => q<Pick<AiOutput, 'ref_id' | 'sources' | 'depth' | 'level' | 'status'>[]>(supabase.from('ai_outputs')
      .select('ref_id, sources, depth, level, status').eq('kind', 'one_on_one_prep').in('ref_id', rows!.map((o) => o.id))),
  });
  if (loading) return <Spinner />;
  if (!rows?.length) return <EmptyLine>이번 주에 잡힌 1:1이 없습니다. <Link to="/one-on-ones?new=1" className="text-indigo-600 font-semibold">일정 잡기</Link></EmptyLine>;
  return (
    <>
      {rows.slice(0, LIST_MAX).map((o) => {
        const prep = preps.data?.find((p) => p.ref_id === o.id);
        const today = isToday(o.scheduled_at);
        return (
          <Link key={o.id} to={`/one-on-ones/${o.id}`} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
            <div className={cx('text-center w-14 shrink-0 rounded-lg py-1', today && 'bg-indigo-50')}>
              <div className={cx('text-xs', today ? 'text-indigo-700 font-semibold' : 'text-slate-400')}>{relDay(o.scheduled_at)}</div>
              <div className="font-mono font-semibold num text-sm">{fmtTime(o.scheduled_at)}</div>
            </div>
            <div className="flex-1 min-w-0"><div className="font-semibold">{nameOf(o.member_id)}</div><div className="text-sm text-slate-500">{o.duration_min}분</div></div>
            {prep ? <ProvChip kind="ai" label="준비 노트 완료" sources={prep.sources} depth={prep.depth} level={prep.level} />
              : <span className="text-xs text-indigo-600 font-semibold">준비 노트 만들기</span>}
            <ChevronRight size={16} className="text-slate-300 shrink-0" />
          </Link>
        );
      })}
      {rows.length > LIST_MAX && <MoreLink to="/one-on-ones">1:1 {rows.length - LIST_MAX}건 더 보기</MoreLink>}
    </>
  );
}

function PromiseList({ rows, loading }: { rows?: PromiseRow[]; loading: boolean }) {
  const { nameOf } = useTeam();
  const qc = useQueryClient();
  const done = useMutation({
    mutationFn: (id: string) => q(supabase.from('action_items').update({ done_at: new Date().toISOString() }).eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['promises'] }),
  });
  if (loading) return <Spinner />;
  if (!rows?.length) return <EmptyLine>남은 약속이 없습니다. 1:1에서 정한 내 할 일이 여기 모입니다.</EmptyLine>;
  const today = todayYmd();
  return (
    <ul>
      {rows.slice(0, 6).map((a) => {
        const late = a.due_date && a.due_date < today;
        return (
          <li key={a.id} className="px-5 py-3.5 flex items-start gap-3 border-b border-slate-100 last:border-b-0">
            <button onClick={() => done.mutate(a.id)} title="완료로 표시" aria-label="완료로 표시"
              className={cx('mt-0.5 shrink-0 hover:text-indigo-600', late ? 'text-rose-400' : 'text-slate-300')}><Circle size={18} /></button>
            <span className="flex-1 min-w-0">
              <span className="font-medium">{a.title}</span>
              <span className={cx('block text-sm', late ? 'text-rose-600' : 'text-slate-500')}>
                {a.one_on_ones?.member_id ? `${nameOf(a.one_on_ones.member_id)}에게 · ` : ''}{a.due_date ? fmtDate(a.due_date) : '기한 없음'}{late ? ' · 기한 지남' : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// =====================================================================
// ① 오른쪽 — 챙길 사람
// =====================================================================
function CarePanel({ teamId, onMemo }: { teamId: string; onMemo: (uid: string) => void }) {
  const nav = useNavigate();
  const radar = useCare(teamId);
  const icon = (t: string) => t === 'condition_down' ? <TrendingDown size={12} /> : t === 'no_one_on_one' ? <Clock size={12} /> : t === 'blocked_repeat' ? <AlertTriangle size={12} /> : null;
  const tone = (t: string) => t === 'condition_down' ? 'bg-rose-50 text-rose-700' : t === 'checkin_missing' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800';
  const n = radar.data?.length ?? 0;
  return (
    <ProvBlock className="bg-white rounded-2xl border border-slate-200 h-full flex flex-col">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <HeartPulse size={16} className={n ? 'text-rose-500' : 'text-slate-400'} />챙길 사람
          {n > 0 && <span className="text-xs font-bold text-rose-600 bg-rose-50 rounded-full px-2 py-0.5">{n}</span>}
        </div>
        <ProvChip kind="ai" label="자동 감지" sources={['체크인 컨디션 추세', '1:1 간격', '막힘 반복', '체크인 제출 여부']} level="L2"
          note="정해진 신호 4가지 중 하나라도 걸리면 올립니다. 왜 올렸는지는 그대로 보여 드립니다." />
      </div>
      {radar.isLoading ? <Spinner /> : !n ? (
        <EmptyLine>이번 주에는 특별히 챙길 신호가 없습니다.</EmptyLine>
      ) : (
        <div className="divide-y divide-slate-100">
          {radar.data!.map((r) => {
            const quote = r.signals.find((s) => s.detail)?.detail;
            return (
              <div key={r.user_id} className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <Avatar name={r.full_name} tone={r.signals.some((s) => s.type === 'condition_down') ? 'rose' : 'amber'} size={8} />
                  <div className="min-w-0 flex-1"><div className="font-semibold truncate">{r.full_name}</div><div className="text-xs text-slate-400 truncate">{r.job_title}</div></div>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
                  {r.signals.map((s) => <span key={s.type} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5', tone(s.type))}>{icon(s.type)}{s.label}</span>)}
                </div>
                {quote && <p className="mt-2 text-sm text-slate-600 leading-relaxed">"{quote}"</p>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => nav(`/one-on-ones?new=${r.user_id}`)}>1:1 잡기</Button>
                  <Button size="sm" variant="ghost" onClick={() => onMemo(r.user_id)}><StickyNote size={12} />메모</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ProvBlock>
  );
}

// =====================================================================
// ② 이번 주 팀 흐름 — AI 브리핑
// =====================================================================
interface Briefing {
  items: { headline: string; detail: string; link: string }[];
  one_line?: string;
  stats?: { submitted: number; members: number; avg_condition: number | null };
  counts?: Record<string, number>;
}
const LINK: Record<string, string> = { review: '/reviews', one_on_one: '/one-on-ones', report: '/report', checkin: '/team', strategy: '/strategy' };
const COUNT_LABEL: Record<string, string> = { checkin: '체크인', one_on_one: '1:1 기록', submission: '제출', task: '과제', signal: '케어 신호' };

function BriefingCard({ teamId }: { teamId: string }) {
  const brief = useLatestAi<Briefing>(teamId, 'briefing');
  const gen = useGenerate('ai-weekly-briefing');
  const b = brief.data;
  const stale = b ? daysAgo(b.created_at) >= 7 : true;
  return (
    <ProvBlock rail className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 h-full">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-semibold">
          AI 팀 브리핑
          {b && <ProvChip kind={kindFromStatus(b.status)} label="AI 생성" sources={b.sources} level={b.level} depth={b.depth}
            note="지난 7일 기록에서 바뀐 것과 반복되는 것만 골랐습니다." />}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {b && <span>{fmtDate(b.created_at, true)} · 매주 월 07:00 자동</span>}
          <Button size="sm" variant={stale ? 'soft' : 'ghost'} loading={gen.isPending} onClick={() => gen.mutate({ team_id: teamId })}>
            <RefreshCw size={12} />{b ? '다시 만들기' : '지금 만들기'}
          </Button>
        </div>
      </div>
      {brief.isLoading ? <Spinner /> : !b ? (
        <div className="mt-6 mb-2 text-center">
          <p className="text-sm text-slate-500 leading-relaxed">아직 브리핑이 없습니다.<br />팀원 체크인과 1:1 기록이 쌓이면 월요일 아침마다 자동으로 만들어집니다.</p>
        </div>
      ) : (
        <>
          {b.content.one_line && <p className="mt-3 text-[15px] font-semibold text-slate-900">{b.content.one_line}</p>}
          <ol className="mt-4 space-y-3 text-[15px] leading-relaxed">
            {(b.content.items ?? []).map((it, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-indigo-600 text-sm mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <span className="flex-1">
                  <b>{it.headline}</b> <TaggedText text={it.detail} sources={b.sources} />
                  {LINK[it.link] && <Link to={LINK[it.link]} className="ml-1.5 text-xs text-indigo-600 whitespace-nowrap">보기 →</Link>}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
            <span>
              근거 · {Object.entries(b.content.counts ?? {}).map(([k, v]) => `${COUNT_LABEL[k] ?? k} ${v}건`).join(' · ')}
              {b.content.stats && ` · 체크인 ${b.content.stats.submitted}/${b.content.stats.members}명`}
            </span>
            <Link to="/report" className="text-indigo-700 font-semibold inline-flex items-center gap-1">이걸로 주간보고 만들기 <ArrowRight size={13} /></Link>
          </div>
        </>
      )}
    </ProvBlock>
  );
}

// =====================================================================
// ② 오른쪽 — ATEAM이 한 일 (아낀 시간 + 인사이트 레벨)
// =====================================================================
const MINUTES: Record<string, number> = { briefing: 20, one_on_one_prep: 15, review: 20, weekly_report: 40, evaluation_draft: 60, forecast_note: 10, strategy_check: 30, scenario_note: 20 };
function AiPanel({ teamId }: { teamId: string }) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const saved = useQuery({
    queryKey: ['saved-time', teamId, monthStart],
    queryFn: async () => {
      const kinds = await q<{ kind: string }[]>(supabase.from('ai_outputs').select('kind').eq('team_id', teamId).neq('status', 'withheld').gte('created_at', monthStart));
      return { n: kinds.length, minutes: kinds.reduce((a, k) => a + (MINUTES[k.kind] ?? 10), 0) };
    },
  });
  const lv = useQuery({ queryKey: ['insight', teamId], queryFn: () => q<InsightLevel>(supabase.rpc('team_insight_level', { p_team: teamId })) });
  const d = lv.data;
  const next = d ? d.levels[d.level] : undefined;
  const gap = next?.conditions.find((c) => c.current < c.target);
  const hours = saved.data ? Math.round((saved.data.minutes / 60) * 10) / 10 : 0;
  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <div className="p-5 bg-gradient-to-br from-violet-600 to-indigo-600 text-white">
        <div className="text-xs text-violet-100 flex items-center gap-1.5">이번 달 아낀 시간
          <span className="[&_button]:bg-white/15 [&_button]:border-white/30 [&_button]:text-white [&_svg]:text-white">
            <ProvChip kind="calc" label="추정" sources={['브리핑 20분 · 1:1 준비 15분 · 1차 검토 20분', '주간보고 40분 · 평가 초안 60분 · 전략 점검 30분', '해석·시나리오 10~20분']}
              note="AI가 만든 초안 1건마다 팀장이 직접 했을 때 걸렸을 시간을 더한 추정치입니다. 확인·수정 시간은 빼지 않았습니다." />
          </span>
        </div>
        <div className="mt-1 text-3xl font-bold num">{hours}<span className="text-base font-semibold ml-0.5">시간</span></div>
        <div className="text-xs text-violet-100 mt-0.5">AI가 먼저 해 둔 일 {saved.data?.n ?? 0}건</div>
      </div>
      <Link to="/insight" className="flex-1 p-5 hover:bg-slate-50 block">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm inline-flex items-center gap-2"><Layers size={15} className="text-violet-600" />AI 인사이트 레벨</div>
          {d && <span className="font-mono text-sm font-bold text-violet-700">L{d.level}</span>}
        </div>
        {!d ? <Spinner /> : next ? (
          <>
            <div className="mt-1 text-xs text-slate-500">{d.levels[d.level - 1].name} → L{next.level} {next.name}</div>
            <div className="mt-2.5 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${d.next_progress ?? 0}%` }} /></div>
            {gap && <p className="mt-2.5 text-xs text-slate-600 leading-relaxed">{gap.label} {gap.target - gap.current}{gap.unit ?? ''} 더 쌓이면 다음 단계가 열립니다.</p>}
          </>
        ) : <p className="mt-2 text-xs text-slate-600">모든 레벨이 열렸습니다.</p>}
      </Link>
    </Card>
  );
}

// =====================================================================
// 관찰 메모 (모달)
// =====================================================================
function MemoModal({ teamId, open, preset, onClose }: { teamId: string; open: boolean; preset: string | null; onClose: () => void }) {
  const { uid } = useTeam();
  const members = useTeamMembersOnly();
  const toast = useToast();
  const qc = useQueryClient();
  const [who, setWho] = useState<string | null>(null);
  const [kind, setKind] = useState<'praise' | 'concern' | 'note'>('praise');
  const [body, setBody] = useState('');
  const sel = who ?? preset ?? members[0]?.user_id;
  const close = () => { setWho(null); onClose(); };
  const save = useMutation({
    mutationFn: () => q(supabase.from('observations').insert({ team_id: teamId, author_id: uid, subject_id: sel, kind, body })),
    onSuccess: () => { setBody(''); toast('관찰 메모를 저장했습니다. 평가 근거로 쌓입니다.'); qc.invalidateQueries({ queryKey: ['insight'] }); close(); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Modal open={open} onClose={close} title={<span className="inline-flex items-center gap-2"><StickyNote size={16} className="text-indigo-600" />관찰 메모</span>}>
      {members.length === 0 ? <p className="text-sm text-slate-500">팀원을 초대하면 쓸 수 있습니다. <Link to="/team" className="text-indigo-600 font-semibold">초대하기</Link></p> : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">10초면 됩니다. 평가 시즌에 근거로 쓰입니다.</p>
          <div className="flex flex-wrap gap-1.5 text-sm">
            {members.map((m) => (
              <button key={m.user_id} onClick={() => setWho(m.user_id)}
                className={cx('border rounded-full px-3 py-1', sel === m.user_id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>
                {m.profiles?.full_name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-sm">
            {([['praise', '잘한 점', ThumbsUp], ['concern', '우려', AlertTriangle], ['note', '관찰', EyeOff]] as const).map(([k, l, I]) => (
              <button key={k} onClick={() => setKind(k)}
                className={cx('border rounded-lg py-2 inline-flex items-center justify-center gap-1.5', kind === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>
                <I size={13} />{l}
              </button>
            ))}
          </div>
          <textarea aria-label="메모" rows={4} value={body} onChange={(e) => setBody(e.target.value)} className={inputCls}
            placeholder="예) 임원 보고에서 가격 전략 질문에 근거를 들어 침착하게 답변함" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Lock size={11} />팀장만 볼 수 있음</span>
            <Button disabled={!body.trim()} loading={save.isPending} onClick={() => save.mutate()}>저장</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// =====================================================================
export default function Home() {
  const { team } = useTeam();
  const [memo, setMemo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  const openMemo = (who: string | null = null) => setMemo({ open: true, who });
  return (
    <div>
      <Header teamId={team.id} onMemo={() => openMemo()} />
      <QuickStart teamId={team.id} />

      <Section n="01" title="오늘 할 일" desc="처리하면 목록에서 사라집니다">
        <div className="grid lg:grid-cols-3 gap-5 items-stretch">
          <div className="lg:col-span-2"><TaskInbox teamId={team.id} /></div>
          <CarePanel teamId={team.id} onMemo={(id) => openMemo(id)} />
        </div>
      </Section>

      <Section n="02" title="이번 주 팀 흐름" desc="AI가 지난 7일 기록에서 골라 정리합니다">
        <div className="grid lg:grid-cols-3 gap-5 items-stretch">
          <div className="lg:col-span-2"><BriefingCard teamId={team.id} /></div>
          <AiPanel teamId={team.id} />
        </div>
      </Section>

      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
    </div>
  );
}
