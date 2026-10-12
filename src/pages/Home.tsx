import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, CalendarCheck, Check, CheckCircle2, ChevronRight, Circle, ClipboardList, EyeOff, FileText, HeartPulse, Layers,
  ListChecks, ListTree, Lock, MessagesSquare, RefreshCw, Sparkles, Sprout, StickyNote, Target, ThumbsUp, X,
} from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { useGenerate, useLatestAi, useTeamMembersOnly } from '../lib/hooks';
import type { ActionItem, AiKind, AiOutput, InsightLevel, OneOnOne, Submission, SubmissionVersion } from '../lib/types';
import { addDays, cx, daysAgo, fmtDate, fmtTime, mondayOf, relDay, ymd } from '../lib/format';
import { Button, Card, Modal, Spinner, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, TaggedText, kindFromStatus } from '../components/Prov';
import { DOMAIN_META, PERIOD_LABEL, TYPE_META, useHomeInsights, type Domain, type DomainSummary, type Period, type Signal, type SignalType, type Status } from '../lib/insights';

// =====================================================================
// 데이터 (오늘 할 일)
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
const todayYmd = () => ymd(new Date());
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();


// =====================================================================
// 공통 조각
// =====================================================================
function Section({ n, title, desc, right, children }: { n: string; title: string; desc?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-xs font-semibold text-indigo-600">{n}</span>
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          {desc && <span className="text-sm text-slate-500">{desc}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
const STATUS_META: Record<Status, { label: string; cls: string; bar: string }> = {
  risk: { label: '위험', cls: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500' },
  watch: { label: '주의', cls: 'bg-amber-50 text-amber-800', bar: 'bg-amber-400' },
  good: { label: '양호', cls: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' },
  unknown: { label: '데이터 부족', cls: 'bg-slate-100 text-slate-500', bar: 'bg-slate-300' },
};
const DOMAIN_ICON: Record<Domain, typeof Target> = { goal: Target, exec: ListChecks, people: HeartPulse, output: FileText, growth: Sprout };

// 확인한 신호는 7일 동안 숨김 (브라우저별 편의 기능)
const SNOOZE_DAYS = 7;
function useSnooze(teamId: string) {
  const key = `ateam.snooze.${teamId}`;
  const [map, setMap] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
  });
  const save = (m: Record<string, number>) => { setMap(m); try { localStorage.setItem(key, JSON.stringify(m)); } catch { /* 저장 불가 */ } };
  const now = Date.now();
  return {
    isHidden: (id: string) => (map[id] ?? 0) > now,
    hide: (id: string) => save({ ...Object.fromEntries(Object.entries(map).filter(([, t]) => t > now)), [id]: now + SNOOZE_DAYS * 86400000 }),
    reset: () => save({}),
  };
}

// AI 주간 브리핑 → 신호로 합치기
interface Briefing { items: { headline: string; detail: string; link: string }[]; one_line?: string }
const BRIEF_DOMAIN: Record<string, Domain> = { review: 'output', one_on_one: 'people', report: 'exec', checkin: 'people', strategy: 'goal' };
const BRIEF_TO: Record<string, string> = { review: '/reviews', one_on_one: '/one-on-ones', report: '/report', checkin: '/team', strategy: '/goals' };
type FeedItem = Signal & { ai?: AiOutput<Briefing> };

// AI 인사이트 (일·주·월) — ai-insights 함수가 만든 것
interface InsightOut {
  headline: string; watch_next?: string; period?: Period;
  items: { domain: Domain; type: SignalType; severity: number; title: string; body: string; action?: string; link?: string }[];
}
const INSIGHT_KIND: Record<Period, AiKind> = { daily: 'insight_daily', weekly: 'insight_weekly', monthly: 'insight_monthly' };
const LINKS: Record<string, string> = { goals: '/goals', team: '/team', reviews: '/reviews', one_on_ones: '/one-on-ones', perf: '/perf', sim: '/sim', knowhow: '/knowhow', report: '/report', eval: '/eval' };
const fresh = (o: { created_at: string } | null | undefined, p: Period) => !!o && daysAgo(o.created_at) < (p === 'daily' ? 1 : p === 'weekly' ? 7 : 31);

// =====================================================================
// 머리말 — 인사 + AI 종합 한 문장
// =====================================================================
function Header({ signals, briefing, insight, loading, onMemo }: { signals: Signal[]; briefing: AiOutput<Briefing> | null | undefined; insight: AiOutput<InsightOut> | null | undefined; loading: boolean; onMemo: () => void }) {
  const { profile } = useTeam();
  const now = new Date();
  const hello = now.getHours() < 11 ? '좋은 아침입니다' : now.getHours() < 18 ? '안녕하세요' : '오늘도 수고 많으셨습니다';
  const risk = signals.filter((s) => s.type === 'risk').length;
  const missed = signals.filter((s) => s.type === 'missed').length;
  const top = signals.find((s) => s.type === 'risk' || s.type === 'missed');
  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">{fmtDate(now.toISOString(), true)}</p>
          <h1 className="text-2xl font-bold tracking-tight mt-1">{hello}, {profile?.full_name} 팀장님</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onMemo}><StickyNote size={15} />관찰 메모</Button>
          <Link to="/report"><Button><ClipboardList size={15} />주간보고 초안</Button></Link>
        </div>
      </div>
      <div className="mt-4 rounded-2xl bg-slate-900 text-white p-5 flex gap-4 items-start">
        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0"><Sparkles size={18} className="text-violet-300" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">AI 종합 · {insight ? `${fmtDate(insight.created_at)} AI 인사이트` : '팀 기록 전체를 규칙과 모델로 훑은 결과'}
            {(risk + missed) > 0 && <span className="flex gap-1.5">
              {risk > 0 && <span className="rounded-full bg-rose-500/20 text-rose-200 px-2 py-0.5 font-semibold">리스크 {risk}</span>}
              {missed > 0 && <span className="rounded-full bg-amber-400/20 text-amber-200 px-2 py-0.5 font-semibold">놓친 것 {missed}</span>}
            </span>}
          </div>
          {loading ? <p className="mt-1.5 text-slate-300">팀 기록을 살펴보는 중입니다…</p> : (
            <p className="mt-1.5 text-[17px] leading-relaxed">
              {insight?.content.headline ? <b className="text-white font-semibold">{insight.content.headline}</b>
                : top ? <>가장 먼저 볼 것은 <b className="text-white">{top.title}</b>입니다.</> : '지금 당장 손쓸 리스크는 없습니다. 아래에서 전망과 패턴을 확인해 보세요.'}
              {insight?.content.headline && top && <span className="block text-sm text-slate-300 mt-1">가장 급한 신호: {top.title}</span>}
              {!insight && briefing?.content.one_line && <span className="block text-sm text-slate-300 mt-1">이번 주 AI 브리핑: {briefing.content.one_line}</span>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// 01 관리 영역 현황
// =====================================================================
function DomainGrid({ domains, active, onPick }: { domains: DomainSummary[]; active: Domain | null; onPick: (d: Domain | null) => void }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2.5 sm:gap-3">
      {domains.map((d) => {
        const Icon = DOMAIN_ICON[d.domain];
        const st = STATUS_META[d.status];
        const on = active === d.domain;
        return (
          <div key={d.domain} className={cx('relative bg-white rounded-2xl border p-4 flex flex-col transition-colors overflow-hidden',
            on ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-indigo-300')}>
            <span className={cx('absolute left-0 top-0 bottom-0 w-1', st.bar)} />
            <button className="text-left flex-1 flex flex-col" onClick={() => onPick(on ? null : d.domain)} aria-pressed={on}
              title="이 영역의 신호만 아래에서 보기">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold"><Icon size={15} className="text-slate-500" />{DOMAIN_META[d.domain].name}</span>
                <span className={cx('text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap', st.cls)}>{st.label}</span>
              </div>
              <div className="mt-3 text-2xl font-bold num">{d.kpi}</div>
              <div className="text-xs text-slate-500">{d.kpiLabel}</div>
              <p className="mt-2.5 text-xs sm:text-sm text-slate-700 leading-snug line-clamp-3 sm:line-clamp-2 flex-1">{d.line}</p>
            </button>
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-400" title={d.confidenceNote}>
                데이터
                <span className="flex gap-0.5">{[1, 2, 3].map((i) => <span key={i} className={cx('w-1.5 h-3 rounded-sm', i <= d.confidence ? 'bg-indigo-500' : 'bg-slate-200')} />)}</span>
              </span>
              <Link to={d.to} className="text-indigo-600 font-semibold hover:underline">자세히</Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// 02 AI가 찾은 것 — 리스크·놓친 것·전망·패턴·좋은 신호·데이터 보강
// =====================================================================
function AiInsightCard({ teamId, period, out, loading }: { teamId: string; period: Period; out: AiOutput<InsightOut> | null | undefined; loading: boolean }) {
  const { hasFeature, credits } = useTeam();
  const nav = useNavigate();
  const gen = useGenerate('ai-insights');
  if (!hasFeature('ai_core')) return (
    <div className="mx-5 my-4 rounded-xl border border-dashed border-violet-300 bg-violet-50/60 p-4 text-sm">
      <div className="font-semibold flex items-center gap-1.5"><Lock size={14} className="text-violet-600" />AI 인사이트는 Pro에서 열립니다</div>
      <p className="mt-1 text-slate-600">{credits?.trial_expired ? '30일 체험이 끝났습니다. 기록은 그대로 쌓이고 있고, ' : ''}AI가 아래 신호들을 엮어 원인과 우선순위, 할 일을 {PERIOD_LABEL[period]} 단위로 정리해 드립니다.</p>
      <Link to="/settings?tab=billing"><Button size="sm" className="mt-3">Pro 시작하기</Button></Link>
    </div>
  );
  const o = fresh(out, period) ? out! : null;
  return (
    <ProvBlock rail className="mx-5 my-4 rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50/40 border border-violet-100 p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles size={15} className="text-violet-600" />
        <span className="font-semibold text-sm">{PERIOD_LABEL[period]}의 AI 인사이트</span>
        {o && <ProvChip kind={kindFromStatus(o.status)} label="AI 해석" sources={o.sources} level={o.level} depth={o.depth} note="아래 자동 감지 신호와 기간 기록을 AI가 엮어 해석했습니다. 숫자는 모델 계산값 그대로입니다." />}
        <span className="ml-auto text-[11px] text-slate-400">{o ? `${fmtDate(o.created_at)} · ` : ''}{period === 'daily' ? '평일 아침 자동' : period === 'weekly' ? '월요일 아침 자동' : '매월 1일 자동'}</span>
        <Button size="sm" variant="ghost" loading={gen.isPending} onClick={() => gen.mutate({ team_id: teamId, period })}><RefreshCw size={12} />{o ? '다시' : '지금 만들기'}</Button>
      </div>
      {loading ? <Spinner /> : !o ? (
        <p className="mt-2 text-sm text-slate-600">아직 {PERIOD_LABEL[period]} 인사이트가 없습니다. 지금 만들기를 누르면 30초 안에 정리합니다. 구독에 포함되어 크레딧이 들지 않습니다.</p>
      ) : (
        <div className="mt-2.5 space-y-3">
          <p className="text-[15px] font-semibold text-slate-900">{o.content.headline}</p>
          <ul className="space-y-2.5">
            {(o.content.items ?? []).map((it, i) => {
              const meta = TYPE_META[it.type] ?? TYPE_META.pattern;
              return (
                <li key={i} className="flex gap-2.5">
                  <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', meta.dot)} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                      <span className={cx('font-semibold rounded px-1.5 py-0.5', meta.cls)}>{meta.label}</span>
                      <span className="text-slate-400">{DOMAIN_META[it.domain]?.name}</span>
                      {it.severity >= 3 && <span className="text-rose-600 font-semibold">· 지금 확인</span>}
                    </div>
                    <div className="mt-0.5 font-semibold">{it.title}</div>
                    <p className="text-slate-700 leading-relaxed"><TaggedText text={it.body} sources={o.sources} /></p>
                    {it.action && (
                      <button onClick={() => it.link && LINKS[it.link] && nav(LINKS[it.link])}
                        className={cx('mt-1 text-xs inline-flex items-center gap-1', it.link && LINKS[it.link] ? 'text-indigo-700 font-semibold hover:underline' : 'text-slate-600')}>
                        → {it.action}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {o.content.watch_next && <p className="text-xs text-slate-500 border-t border-violet-100 pt-2">다음에 지켜볼 것 · {o.content.watch_next}</p>}
        </div>
      )}
    </ProvBlock>
  );
}

const FEED_MAX = 8;
function SignalFeed({ teamId, items, loading, domain, onDomain, onMemo, period, setPeriod, insight, insightLoading }:
  { teamId: string; items: FeedItem[]; loading: boolean; domain: Domain | null; onDomain: (d: Domain | null) => void; onMemo: (who: string | null) => void;
    period: Period; setPeriod: (p: Period) => void; insight: AiOutput<InsightOut> | null | undefined; insightLoading: boolean }) {
  const nav = useNavigate();
  const { hasFeature } = useTeam();
  const snooze = useSnooze(teamId);
  const [type, setType] = useState<SignalType | 'all'>('all');
  const [more, setMore] = useState(false);
  const full = hasFeature('signals');
  const visible = items.filter((s) => !snooze.isHidden(s.id) && (s.ai || s.periods.includes(period)));
  const hiddenN = items.length - visible.length;
  const inDomain = visible.filter((s) => !domain || s.domain === domain);
  const list = inDomain.filter((s) => type === 'all' || s.type === type);
  const counts = (Object.keys(TYPE_META) as SignalType[]).map((t) => [t, inDomain.filter((s) => s.type === t).length] as const).filter(([, n]) => n > 0);
  const act = (s: FeedItem) => {
    if (!s.action) return;
    if (s.action.memo !== undefined) return onMemo(s.action.memo ?? null);
    if (s.action.to?.startsWith('#')) return document.getElementById(s.action.to.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (s.action.to) nav(s.action.to);
  };
  return (
    <Card className="flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100 space-y-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 w-fit" role="tablist" aria-label="기간">
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}
              className={cx('text-sm px-3.5 py-1.5 rounded-md', period === p ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-600')}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {domain ? (
              <button onClick={() => onDomain(null)} className="inline-flex items-center gap-1 text-xs font-semibold rounded-full bg-indigo-600 text-white pl-2.5 pr-1.5 py-1">
                {DOMAIN_META[domain].name}<X size={12} />
              </button>
            ) : <span className="text-sm text-slate-500">전체 영역</span>}
            <span className="text-sm text-slate-400">· 자동 감지 {list.length}건</span>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5" role="tablist">
          <button role="tab" aria-selected={type === 'all'} onClick={() => setType('all')}
            className={cx('text-xs rounded-full px-2.5 py-1 border whitespace-nowrap', type === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600')}>전체 {inDomain.length}</button>
          {counts.map(([t, n]) => (
            <button key={t} role="tab" aria-selected={type === t} onClick={() => setType(t)}
              className={cx('text-xs rounded-full px-2.5 py-1 border whitespace-nowrap inline-flex items-center gap-1.5', type === t ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600')}>
              <span className={cx('w-1.5 h-1.5 rounded-full', TYPE_META[t].dot)} />{TYPE_META[t].label} {n}
            </button>
          ))}
        </div>
      </div>
      <AiInsightCard teamId={teamId} period={period} out={insight} loading={insightLoading} />
      {loading ? <Spinner label="팀 기록을 분석하는 중" /> : !list.length ? (
        <p className="px-5 py-10 text-sm text-slate-500 text-center">이 조건에서 AI가 찾은 신호가 없습니다.</p>
      ) : (
        <ul className="relative border-t border-slate-100">
          {!full && list.length > 2 && (
            <li className="absolute inset-x-0 bottom-0 top-[180px] z-10 bg-gradient-to-b from-white/60 to-white flex items-end justify-center pb-6">
              <div className="text-center text-sm"><div className="font-semibold">신호 {list.length - 2}건이 더 있습니다</div>
                <p className="text-slate-500 text-xs mt-0.5">Free에서는 가장 급한 2건만 보입니다</p>
                <Link to="/settings?tab=billing"><Button size="sm" className="mt-2">Pro로 모두 보기</Button></Link></div>
            </li>
          )}
          {(more ? list : list.slice(0, full ? FEED_MAX : 4)).map((s, idx) => (
            <li key={s.id} className={cx('px-5 py-3.5 border-b border-slate-100 last:border-b-0 flex gap-3', !full && idx >= 2 && 'blur-[3px] select-none pointer-events-none')} aria-hidden={!full && idx >= 2}>
              <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', TYPE_META[s.type].dot)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className={cx('font-semibold rounded px-1.5 py-0.5', TYPE_META[s.type].cls)}>{TYPE_META[s.type].label}</span>
                  <span className="text-slate-400">{DOMAIN_META[s.domain].name}</span>
                  {s.severity === 3 && <span className="text-rose-600 font-semibold">· 지금 확인</span>}
                  <span className="ml-auto">
                    {s.ai ? <ProvChip kind={kindFromStatus(s.ai.status)} label="AI 브리핑" sources={s.ai.sources} level={s.ai.level} depth={s.ai.depth} note="지난 7일 기록에서 AI가 고른 내용입니다." />
                      : <ProvChip kind="calc" label="자동 감지" sources={[s.rule]} note="AI 크레딧을 쓰지 않는 규칙·모델 계산입니다. 위 규칙에 걸려서 표시됐습니다." />}
                  </span>
                </div>
                <div className="mt-1 font-semibold leading-snug">{s.title}</div>
                {s.detail && <p className="mt-0.5 text-sm text-slate-600 leading-relaxed">{s.ai ? <TaggedText text={s.detail} sources={s.ai.sources} /> : s.detail}</p>}
                <div className="mt-1.5 flex items-center gap-3 text-xs">
                  {s.action && <button onClick={() => act(s)} className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1">{s.action.label}<ArrowRight size={12} /></button>}
                  <button onClick={() => snooze.hide(s.id)} className="text-slate-400 hover:text-slate-700 inline-flex items-center gap-1" title={`${SNOOZE_DAYS}일 동안 숨깁니다`}><Check size={12} />확인함</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {full && (list.length > FEED_MAX || hiddenN > 0) && (
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-sm">
          {list.length > FEED_MAX ? <button onClick={() => setMore(!more)} className="text-indigo-700 font-semibold">{more ? '접기' : `${list.length - FEED_MAX}건 더 보기`}</button> : <span />}
          {hiddenN > 0 && <button onClick={snooze.reset} className="text-xs text-slate-400 hover:text-slate-700">확인한 {hiddenN}건 다시 보기</button>}
        </div>
      )}
    </Card>
  );
}

// =====================================================================
// 오른쪽 — 오늘 할 일 (작게)
// =====================================================================
function TodayCompact({ teamId }: { teamId: string }) {
  const { nameOf } = useTeam();
  const qc = useQueryClient();
  const oo = useWeekOneOnOnes(teamId).data ?? [];
  const rv = useReviewQueue(teamId).data ?? [];
  const pr = usePromises(teamId).data ?? [];
  const done = useMutation({
    mutationFn: (id: string) => q(supabase.from('action_items').update({ done_at: new Date().toISOString() }).eq('id', id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['promises'] }); qc.invalidateQueries({ queryKey: ['home-insights'] }); },
  });
  const today = todayYmd();
  const ooUpcoming = oo.filter((o) => new Date(o.scheduled_at).getTime() > Date.now() - 3600000);
  const late = pr.filter((a) => a.due_date && a.due_date < today);
  const rows = [
    { k: '1:1', n: ooUpcoming.length, sub: ooUpcoming.filter((o) => isToday(o.scheduled_at)).length ? `오늘 ${ooUpcoming.filter((o) => isToday(o.scheduled_at)).length}건` : '이번 주', to: '/one-on-ones', icon: MessagesSquare },
    { k: '리뷰 대기', n: rv.length, sub: rv.filter((r) => !r.review).length ? `AI 검토 전 ${rv.filter((r) => !r.review).length}` : 'AI 검토 완료', to: '/reviews', icon: FileText },
    { k: '내 약속', n: pr.length, sub: late.length ? `기한 지남 ${late.length}` : '기한 내', to: '#today-promises', icon: CheckCircle2, alert: late.length > 0 },
  ];
  return (
    <Card id="today">
      <div className="px-5 py-4 border-b border-slate-100 font-semibold flex items-center gap-2"><CalendarCheck size={16} className="text-indigo-600" />오늘 할 일</div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
        {rows.map((r) => (
          <Link key={r.k} to={r.to.startsWith('#') ? '#' : r.to} onClick={(e) => { if (r.to.startsWith('#')) { e.preventDefault(); document.getElementById(r.to.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }}
            className="px-3 py-3 hover:bg-slate-50 text-center">
            <div className="text-[11px] text-slate-500 flex items-center justify-center gap-1"><r.icon size={12} />{r.k}</div>
            <div className="text-xl font-bold num mt-0.5">{r.n}</div>
            <div className={cx('text-[11px]', r.alert ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{r.sub}</div>
          </Link>
        ))}
      </div>
      <ProposalsLine teamId={teamId} />
      <ul className="text-sm">
        {ooUpcoming.slice(0, 2).map((o) => (
          <li key={o.id}><Link to={`/one-on-ones/${o.id}`} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50">
            <span className={cx('font-mono text-xs w-16 shrink-0', isToday(o.scheduled_at) ? 'text-indigo-700 font-semibold' : 'text-slate-400')}>{relDay(o.scheduled_at)} {fmtTime(o.scheduled_at)}</span>
            <span className="flex-1 truncate">{nameOf(o.member_id)} 1:1</span><ChevronRight size={14} className="text-slate-300" />
          </Link></li>
        ))}
        {rv.slice(0, 2).map(({ s }) => (
          <li key={s.id}><Link to={`/reviews/${s.id}`} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50">
            <span className="text-xs text-slate-400 w-16 shrink-0">리뷰</span>
            <span className="flex-1 truncate">{s.title}</span><ChevronRight size={14} className="text-slate-300" />
          </Link></li>
        ))}
        <li id="today-promises" />
        {pr.slice(0, 4).map((a) => {
          const isLate = a.due_date && a.due_date < today;
          return (
            <li key={a.id} className="px-5 py-2.5 flex items-start gap-3">
              <button onClick={() => done.mutate(a.id)} aria-label="완료로 표시" title="완료로 표시" className={cx('mt-0.5 shrink-0 hover:text-indigo-600', isLate ? 'text-rose-400' : 'text-slate-300')}><Circle size={15} /></button>
              <span className="flex-1 min-w-0"><span className="block truncate">{a.title}</span>
                <span className={cx('text-xs', isLate ? 'text-rose-600' : 'text-slate-400')}>{a.one_on_ones?.member_id ? `${nameOf(a.one_on_ones.member_id)} · ` : ''}{a.due_date ? fmtDate(a.due_date) : '기한 없음'}{isLate ? ' · 지남' : ''}</span></span>
            </li>
          );
        })}
        {!ooUpcoming.length && !rv.length && !pr.length && <li className="px-5 py-6 text-center text-slate-500">오늘 처리할 일이 없습니다.</li>}
      </ul>
    </Card>
  );
}

function ProposalsLine({ teamId }: { teamId: string }) {
  const n = useQuery({ queryKey: ['items', teamId, 'proposed-count'], queryFn: async () => (await supabase.from('work_items').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('status', 'proposed')).count ?? 0 });
  if (!n.data) return null;
  return (
    <Link to="/goals?filter=proposed" className="flex items-center gap-2 px-5 py-2.5 border-b border-slate-100 bg-violet-50/60 text-sm hover:bg-violet-50">
      <ListTree size={14} className="text-violet-600" /><span className="flex-1">팀원이 올린 계획 <b>{n.data}건</b> 검토</span><ChevronRight size={14} className="text-violet-400" />
    </Link>
  );
}

// =====================================================================
// 오른쪽 — ATEAM이 한 일 (아낀 시간 + 인사이트 레벨)
// =====================================================================
const MINUTES: Record<string, number> = { briefing: 20, one_on_one_prep: 15, review: 20, weekly_report: 40, evaluation_draft: 60, forecast_note: 10, strategy_check: 30, scenario_note: 20, insight_daily: 10, insight_weekly: 25, insight_monthly: 45, plan_draft: 40, plan_edit: 5, self_check: 0 };
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
  const hours = saved.data ? Math.round((saved.data.minutes / 60) * 10) / 10 : 0;
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-violet-100 flex items-center gap-1.5">이번 달 아낀 시간
            <span className="[&_button]:bg-white/15 [&_button]:border-white/30 [&_button]:text-white [&_svg]:text-white">
              <ProvChip kind="calc" label="추정" sources={['브리핑 20분 · 1:1 준비 15분 · 1차 검토 20분', '주간보고 40분 · 평가 초안 60분 · 전략 점검 30분', '해석·시나리오 10~20분']}
                note="AI가 만든 초안 1건마다 팀장이 직접 했을 때 걸렸을 시간을 더한 추정치입니다. 확인·수정 시간은 빼지 않았습니다." />
            </span>
          </div>
          <div className="mt-1 text-3xl font-bold num">{hours}<span className="text-base font-semibold ml-0.5">시간</span></div>
        </div>
        <div className="text-xs text-violet-100 text-right">AI가 먼저 해 둔 일<br /><b className="text-white text-base num">{saved.data?.n ?? 0}</b>건</div>
      </div>
      <Link to="/insight" className="block px-5 py-4 hover:bg-slate-50">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm inline-flex items-center gap-2"><Layers size={15} className="text-violet-600" />AI가 볼 수 있는 깊이</div>
          {d && <span className="font-mono text-sm font-bold text-violet-700">L{d.level} {d.levels[d.level - 1].name}</span>}
        </div>
        {d && next && (
          <>
            <div className="mt-2.5 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${d.next_progress ?? 0}%` }} /></div>
            <div className="mt-1.5 flex justify-between text-xs text-slate-500"><span>다음: L{next.level} {next.name}</span><span className="num">{d.next_progress ?? 0}%</span></div>
          </>
        )}
      </Link>
    </Card>
  );
}

// =====================================================================
// 시작 가이드
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
      const [kh, rep, oo, it] = await Promise.all([
        count('knowhow_cards'), count('ai_outputs', (x) => x.eq('kind', 'weekly_report')), count('one_on_ones'), count('work_items'),
      ]);
      return { kh, rep, oo, it };
    },
  });
  if (hidden || !st.data) return null;
  const steps = [
    { done: st.data.it > 0, title: '목표 세우기', desc: '계획서를 넣으면 AI가 목표·과제 초안을 만듭니다', to: '/goals' },
    { done: members.some((m) => m.role === 'member'), title: '팀원 초대', desc: '링크 하나로 초대, 팀원은 무료', to: '/team' },
    { done: st.data.kh > 0, title: '내 노하우 넣기', desc: '원칙·자료를 넣으면 AI가 팀장님 기준으로 일합니다', to: '/knowhow' },
    { done: st.data.rep > 0, title: '주간보고 초안 받기', desc: '팀원이 없어도 메모 몇 줄이면 됩니다', to: '/report' },
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
  const { team, uid, members } = useTeam();
  const [memo, setMemo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  const [domain, setDomain] = useState<Domain | null>(null);
  const openMemo = (who: string | null = null) => setMemo({ open: true, who });
  const minEv = (team.settings?.min_judgment_evidence as number) ?? 8;
  const ins = useHomeInsights(team.id, uid, members, minEv);
  const brief = useLatestAi<Briefing>(team.id, 'briefing');
  const [period, setPeriod] = useState<Period>('daily');
  const insight = useLatestAi<InsightOut>(team.id, INSIGHT_KIND[period]);
  const insightW = useLatestAi<InsightOut>(team.id, 'insight_weekly');

  const feed: FeedItem[] = useMemo(() => {
    const base: FeedItem[] = [...(ins.data?.signals ?? [])];
    const b = brief.data;
    if (b && daysAgo(b.created_at) < 8 && b.status !== 'withheld' && !fresh(insightW.data, 'weekly')) {
      // 규칙 신호와 같은 사람·같은 주제를 말하는 브리핑 항목은 빼서 중복을 없앤다
      const people = members.map((m) => m.profiles?.full_name).filter(Boolean) as string[];
      const TOPICS = ['컨디션', '막', '1:1', '리뷰', '지연', '늦어', '전망', '확률', '기한', '체크인'];
      const dup = (text: string) => base.some((sg) => {
        const sameName = people.some((n) => text.includes(n) && sg.title.includes(n));
        const sameTopic = TOPICS.some((t) => text.includes(t) && (sg.title + (sg.detail ?? '')).includes(t));
        return sameName && sameTopic;
      });
      (b.content.items ?? []).filter((it) => !dup(`${it.headline} ${it.detail}`)).forEach((it, i) => base.push({
        id: `brief-${b.id}-${i}`, domain: BRIEF_DOMAIN[it.link] ?? 'people', type: 'pattern', severity: 1, periods: ['weekly'],
        title: it.headline, detail: it.detail, rule: 'AI 주간 브리핑', ai: b,
        action: BRIEF_TO[it.link] ? { label: '보기', to: BRIEF_TO[it.link] } : undefined,
      }));
    }
    return base;
  }, [ins.data, brief.data, members, insightW.data]);

  const pickDomain = (d: Domain | null) => {
    setDomain(d);
    if (d) document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      <Header signals={feed.filter((x) => x.periods.includes('daily') || x.periods.includes('weekly'))} briefing={brief.data}
        insight={fresh(insight.data, period) ? insight.data : fresh(insightW.data, 'weekly') ? insightW.data : null} loading={ins.isLoading} onMemo={() => openMemo()} />
      <QuickStart teamId={team.id} />

      <Section n="01" title="관리 영역 현황" desc="영역을 누르면 그 영역의 신호만 아래에 모아 봅니다">
        {ins.isLoading || !ins.data ? <Spinner /> : <DomainGrid domains={ins.data.domains} active={domain} onPick={pickDomain} />}
      </Section>

      <Section n="02" title="AI가 찾은 것" desc="기간마다 다르게 봅니다 · 오늘은 할 일, 이번 주는 흐름, 이번 달은 구조와 원인">
        <div className="grid lg:grid-cols-3 gap-5 items-start" id="feed">
          <div className="lg:col-span-2">
            <SignalFeed teamId={team.id} items={feed} loading={ins.isLoading} domain={domain} onDomain={setDomain} onMemo={openMemo}
              period={period} setPeriod={setPeriod} insight={insight.data} insightLoading={insight.isLoading} />
          </div>
          <div className="space-y-5">
            <TodayCompact teamId={team.id} />
            <AiPanel teamId={team.id} />
          </div>
        </div>
      </Section>

      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
    </div>
  );
}
