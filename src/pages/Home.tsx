// 팀장 홈 — 내용마다 어울리는 모양으로 (같은 박스 반복 X)
//   머리(AI 한 줄·기간) → 팀 성과 대시보드(가로 넓게: 숫자·목표 차트·실적 전망 │ AI 인사이트)
//   → Positive ↔ Risk (가로로 마주 보게) → 의사결정(목록 │ AI) + 오늘 할 일 카드 → 사람(팀원 작은 카드) + 조직·전사
// 색: 섹션 정체성 성과 indigo · 사람 teal · 조직 fuchsia · 의사결정 slate / 상태(위험·주의·양호)는 rose·amber·emerald 로만, 항상 글자와 함께.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowUpRight, Building2, CalendarCheck, CalendarClock, CheckCircle2, ChevronRight, Circle, ClipboardList, FileText, Gavel,
  Inbox, ListTree, MessagesSquare, Plus, Sparkles, StickyNote, Target, ThumbsUp, Users, X,
} from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import { useTeamMembersOnly } from '../lib/hooks';
import type { OrgNote } from '../lib/types';
import { cx, daysAgo, fmtDate, fmtTime } from '../lib/format';
import { Avatar } from '../components/ui';
import { ProvChip, kindFromStatus } from '../components/Prov';
import { PERIOD_LABEL, sectionOf, type Raw, type Signal } from '../lib/insights';
import {
  AiStrip, IMPACT_LEVEL, MemoModal, Meter, ORG_KIND, OrgNoteModal, PeriodTabs, QuickStart, RangeBar, Ring, SECTION_TONE, STATUS_META, Sparkline, MiniColumns,
  dDay, isToday, sevOfPct, todayYmd, useAnsweredRequests, useHomeModel, usePeriod, usePromises, useReviewQueue, useSignalAct, useWeekOneOnOnes,
  type HomeModel, type MainSection,
} from '../components/home/shared';

const stripTags = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
const briefLink = (section: MainSection, period: string) => `/brief/${section}${period === 'daily' ? '' : `?p=${period}`}`;
const AREA_SHORT: Record<string, string> = { perf: '성과', people: '사람', org: '조직', decide: '결정', todo: '할 일' };
const AREA_DOT: Record<string, string> = { perf: 'bg-indigo-600', people: 'bg-teal-600', org: 'bg-fuchsia-600', decide: 'bg-slate-700', todo: 'bg-slate-400' };
const STATUS_DOT: Record<string, string> = { risk: 'bg-rose-500', watch: 'bg-amber-400', good: 'bg-emerald-500', unknown: 'bg-slate-300' };
const card = 'rounded-3xl bg-white ring-1 ring-slate-900/[0.06] shadow-[0_1px_3px_rgba(15,23,42,0.05),0_10px_30px_-18px_rgba(15,23,42,0.18)]';

function StatusPill({ m, section }: { m: HomeModel; section: MainSection }) {
  if (m.loading) return null;
  const st = m.status[section];
  return <span className={cx('text-[11px] font-semibold border rounded-full pl-1.5 pr-2 py-0.5 inline-flex items-center gap-1', STATUS_META[st].cls)}><span className={cx('w-1.5 h-1.5 rounded-full', STATUS_DOT[st])} />{STATUS_META[st].label}</span>;
}

function CardHead({ section, m, title, sub, right, icon }: { section?: MainSection; m: HomeModel; title: string; sub?: string; right?: ReactNode; icon: ReactNode }) {
  const [period] = usePeriod();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {icon}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {section ? <Link to={briefLink(section, period)} className="font-bold text-lg tracking-tight hover:underline underline-offset-4 decoration-2">{title}</Link> : <span className="font-bold text-lg tracking-tight">{title}</span>}
            {section && <StatusPill m={m} section={section} />}
          </div>
          {sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">{right}</div>
    </div>
  );
}
const IconBox = ({ grad, children }: { grad: string; children: ReactNode }) => (
  <span className={cx('w-10 h-10 rounded-2xl bg-gradient-to-br text-white flex items-center justify-center shrink-0 shadow-sm', grad)}>{children}</span>
);
const MoreLink = ({ to, label = '자세히', className }: { to: string; label?: string; className?: string }) => (
  <Link to={to} className={cx('text-xs font-semibold inline-flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 hover:bg-slate-100', className ?? 'text-slate-600')}>{label}<ChevronRight size={13} /></Link>
);

// AI 인사이트 — 패널형(섹션 오른쪽 기둥) / 띠형(카드 안 한 줄)
function AiInsight({ m, section, n = 3, variant = 'panel' }: { m: HomeModel; section: MainSection; n?: number; variant?: 'panel' | 'strip' | 'stack' }) {
  const [period] = usePeriod();
  const s = m.ai[section];
  const chip = m.insight && <ProvChip kind={kindFromStatus(m.insight.status)} label="근거" sources={m.insight.sources} level={m.insight.level} depth={m.insight.depth} note="AI 해석입니다. 전체 문장과 근거는 자세히에서 봅니다." />;
  const empty = !m.insight
    ? <p className="text-sm text-slate-500">아직 {PERIOD_LABEL[period]} AI 인사이트가 없습니다. <Link to={briefLink(section, period)} className="text-violet-700 font-semibold">지금 만들기 →</Link></p>
    : <p className="text-sm text-slate-500">이번 해석에서 짚을 것이 없었습니다.</p>;
  if (variant === 'stack') return (
    <div className="rounded-2xl bg-gradient-to-br from-violet-50 to-indigo-50/60 ring-1 ring-violet-100 p-4">
      <div className="flex items-center justify-between gap-2 mb-1.5"><span className="text-[11px] font-semibold tracking-wide text-violet-700 inline-flex items-center gap-1.5"><Sparkles size={12} />AI 인사이트</span>{chip}</div>
      {m.insight && (s.summary || s.items[0]) ? <>
        <p className="text-sm font-semibold leading-snug text-slate-900">{stripTags(s.summary || s.items[0].title)}</p>
        {s.items[0]?.action && <p className="text-xs text-violet-700 mt-1">→ {s.items[0].action}</p>}
      </> : empty}
    </div>
  );
  if (variant === 'strip') return (
    <div className="rounded-2xl bg-gradient-to-r from-violet-50 to-indigo-50/50 ring-1 ring-violet-100 px-4 py-3 flex items-start gap-3">
      <Sparkles size={15} className="text-violet-600 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        {m.insight && (s.summary || s.items[0]) ? <>
          <p className="font-semibold leading-snug text-slate-900">{stripTags(s.summary || s.items[0].title)}</p>
          {s.items[0]?.action && <p className="text-xs text-violet-700 mt-0.5">→ {s.items[0].action}</p>}
        </> : empty}
      </div>
      {chip}
    </div>
  );
  return (
    <div className="h-full rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-indigo-700 text-white p-5 flex flex-col relative overflow-hidden">
      <div aria-hidden className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-violet-100 inline-flex items-center gap-1.5"><Sparkles size={13} />AI 인사이트 · {PERIOD_LABEL[period]}</span>
        {m.insight && <span className="[&_button]:bg-white/15 [&_button]:border-white/25 [&_button]:text-white [&_svg]:text-white">{chip}</span>}
      </div>
      <div className="relative mt-3 flex-1">
        {!m.insight ? <p className="text-sm text-violet-100">아직 {PERIOD_LABEL[period]} 인사이트가 없습니다.<Link to={briefLink(section, period)} className="block mt-2 font-semibold text-white underline underline-offset-4">지금 만들기 →</Link></p>
          : !s.summary && !s.items.length ? <p className="text-sm text-violet-100">이번 해석에서 짚을 것이 없었습니다.</p> : <>
            {s.summary && <p className="text-[17px] font-semibold leading-snug">{stripTags(s.summary)}</p>}
            <ol className="mt-4 space-y-3">
              {s.items.slice(0, n).map((it, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="w-5 h-5 rounded-full bg-white/20 text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="min-w-0 leading-snug"><span className="font-medium">{it.title}</span>{it.action && <span className="block text-xs text-violet-100 mt-0.5">→ {it.action}</span>}</span>
                </li>
              ))}
            </ol>
          </>}
      </div>
      <Link to={briefLink(section, period)} className="relative mt-4 text-xs font-semibold text-white/90 hover:text-white inline-flex items-center gap-0.5">해석 전체와 근거 보기<ChevronRight size={13} /></Link>
    </div>
  );
}

// =====================================================================
// 머리 — 인사 + 바로가기
// =====================================================================
function Header({ onMemo, onOrg }: { onMemo: () => void; onOrg: () => void }) {
  const { profile } = useTeam();
  const now = new Date();
  const hello = now.getHours() < 11 ? '좋은 아침입니다' : now.getHours() < 18 ? '안녕하세요' : '오늘도 수고 많으셨습니다';
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{fmtDate(now.toISOString(), true)}</p>
        <h1 className="text-[26px] font-bold tracking-tight mt-0.5">{hello}, {profile?.full_name} 팀장님</h1>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={onMemo} className="text-sm rounded-xl px-3.5 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><StickyNote size={15} />관찰 메모</button>
        <button onClick={onOrg} className="text-sm rounded-xl px-3.5 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Building2 size={15} />위에서 온 것</button>
        <Link to="/report" className="text-sm font-semibold rounded-xl px-3.5 py-2 bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5"><ClipboardList size={15} />주간보고 초안</Link>
      </div>
    </div>
  );
}

// =====================================================================
// ① 팀 성과 — 대시보드 (작은 그래프 카드)
// =====================================================================
function GCard({ title, value, sub, tone, graph, to }: { title: string; value: ReactNode; sub?: ReactNode; tone?: 'rose' | 'amber'; graph?: ReactNode; to?: string }) {
  const body = (
    <>
      <div className="text-[11px] font-semibold text-slate-500 truncate">{title}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={cx('text-[24px] font-bold num leading-none tracking-tight whitespace-nowrap', tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900')}>{value}</div>
          {sub && <div className="text-[11px] text-slate-400 mt-1 truncate">{sub}</div>}
        </div>
        {graph && <div className="shrink-0">{graph}</div>}
      </div>
    </>
  );
  const cls = 'rounded-2xl bg-white ring-1 ring-indigo-100/80 shadow-sm px-4 py-3.5 min-w-0 block transition-all hover:shadow-md hover:-translate-y-0.5';
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

function PerfDashboard({ m }: { m: HomeModel }) {
  const [period] = usePeriod();
  const k = m.k;
  const fc = k.fc;
  const goals = m.raw?.goals ?? [];
  const avgProg = goals.length ? Math.round(goals.reduce((a, g) => a + g.progress, 0) / goals.length) : null;
  const doneByWeek = k.weekStarts.map((w, i) => {
    const next = k.weekStarts[i + 1] ?? '9999-12-31';
    return (m.raw?.items ?? []).filter((it) => it.status === 'done' && it.updated_at.slice(0, 10) >= w && it.updated_at.slice(0, 10) < next).length;
  });
  const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ko-KR') : String(Math.round(v * 10) / 10));
  return (
    <section id="sec-perf" className="scroll-mt-24 rounded-3xl px-5 sm:px-6 py-5 bg-gradient-to-br from-indigo-50 via-indigo-50/40 to-sky-50/60 ring-1 ring-indigo-200/70 shadow-[0_1px_3px_rgba(49,46,129,0.08),0_12px_32px_-18px_rgba(49,46,129,0.35)]">
      <CardHead section="perf" m={m} title="팀 성과" sub="목표가 달성되나, 일이 굴러가나"
        icon={<IconBox grad={SECTION_TONE.perf.grad}><Target size={19} /></IconBox>}
        right={<MoreLink to={briefLink('perf', period)} label="성과 자세히" className="text-indigo-700" />} />
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <GCard title="최저 달성 가능성" value={k.goalLow} tone={k.goalLowTone} sub={`목표 ${k.goals}개 중`} to="/goals"
          graph={<Ring value={k.goalLowNum} tone={sevOfPct(k.goalLowNum)} size={40} label={`가장 낮은 목표 달성 가능성 ${k.goalLow}`} />} />
        <GCard title="목표 평균 진척" value={avgProg != null ? `${avgProg}%` : '—'} sub="최상위 목표 기준" to="/goals"
          graph={<Ring value={avgProg} tone="indigo" size={40} label={`목표 평균 진척 ${avgProg ?? '—'}%`} />} />
        <GCard title="계획대로 진행" value={k.onPlan} sub="진행 중 항목" to="/goals?view=timeline"
          graph={k.onPlanNum != null ? <div className="w-14 pb-1"><Meter pct={k.onPlanNum} tone={k.onPlanNum < 70 ? 'amber' : 'indigo'} /></div> : undefined} />
        <GCard title="막힘 · 지연 예상" value={`${k.blocked} · ${k.delayed}`} tone={k.blocked + k.delayed ? 'amber' : undefined} sub="건" to="/goals?filter=blocked"
          graph={<div className="w-10"><MiniColumns values={[k.blocked, k.delayed]} labels={["막힘", "지연 예상"]} h={36} hex="#f59e0b" unit="건" bare /></div>} />
        <GCard title={fc ? `실적 전망 · ${fc.name}` : '실적 전망'} to="/perf"
          value={fc && fc.base != null ? <>{fmt(fc.base)}<span className="text-xs font-semibold text-slate-400 ml-0.5">{fc.unit}</span></> : '—'}
          tone={fc && fc.target != null && fc.base != null && fc.base < fc.target ? 'rose' : undefined}
          sub={fc?.target != null ? `목표 ${fmt(fc.target)}${fc.unit}` : '실적 2개월 이상 필요'}
          graph={fc && fc.base != null && fc.low != null && fc.high != null ? <div className="w-12"><RangeBar low={fc.low} base={fc.base} high={fc.high} target={fc.target} unit={fc.unit} compact /></div> : undefined} />
        <GCard title="이번 주 완료" value={doneByWeek[doneByWeek.length - 1]} sub="최근 6주 추이" to="/goals"
          graph={<div className="w-16"><MiniColumns values={doneByWeek} labels={k.condWeeks} h={36} unit="건" bare /></div>} />
      </div>
    </section>
  );
}

// =====================================================================
// ② Top Priority — 결정·리스크·할 일·조직을 모두 모아 지금 가장 중요한 것
// =====================================================================
interface Prio { key: string; score: number; tag: string; tagCls: string; title: string; why?: string; action?: string; to?: string; signal?: Signal; ai?: boolean }
const TAG: Record<string, string> = {
  risk: 'bg-rose-500/20 text-rose-200', decide: 'bg-white/15 text-slate-100', todo: 'bg-violet-500/25 text-violet-200',
  perf: 'bg-indigo-500/25 text-indigo-200', people: 'bg-teal-500/25 text-teal-200', org: 'bg-fuchsia-500/25 text-fuchsia-200',
};
const SEC_TAG: Record<MainSection, string> = { risk: '리스크', decide: '의사결정', perf: '팀 성과', people: '팀원관리', org: '조직·전사' };
const AI_TO: Record<string, string> = { goals: '/goals', team: '/team', reviews: '/reviews', one_on_ones: '/one-on-ones', perf: '/perf', sim: '/sim', knowhow: '/knowhow', report: '/report', eval: '/eval', strategy: '/strategy', org: '/brief/org' };

function usePriorities(m: HomeModel, teamId: string): Prio[] {
  const { members, nameOf } = useTeam();
  const pr = usePromises(teamId).data ?? [];
  const rv = useReviewQueue(teamId).data ?? [];
  const oo = useWeekOneOnOnes(teamId).data ?? [];
  const today = todayYmd();
  const out: Prio[] = [];
  // AI가 고른 것 (섹션별 해석의 급한 항목)
  if (m.insight) for (const sec of ['risk', 'decide', 'perf', 'people', 'org'] as MainSection[]) {
    for (const it of m.ai[sec].items) {
      if (it.severity < 2 && it.type !== 'risk') continue;
      out.push({ key: `ai-${sec}-${it.title}`, score: (it.severity >= 3 ? 100 : 80) + (sec === 'decide' ? 3 : sec === 'risk' ? 2 : 0), tag: SEC_TAG[sec], tagCls: TAG[sec],
        title: it.title, why: stripTags(it.body), action: it.action, to: it.link ? AI_TO[it.link] : briefLink(sec, 'daily'), ai: true });
    }
  }
  // 규칙: 큰 리스크
  for (const s of m.bigRisks) out.push({ key: s.id, score: 95, tag: '리스크', tagCls: TAG.risk, title: s.title, why: s.detail, action: s.action?.label, signal: s });
  // 할 일: 상위 요청 마감 임박 · 지난 약속 · 오래 기다린 리뷰/계획 · 오늘 1:1
  for (const n of m.orgSt.upcoming.filter((n) => n.kind === 'request' && dDay(n.event_date!) <= 3)) {
    const dd = dDay(n.event_date!);
    out.push({ key: `req-${n.id}`, score: dd < 0 ? 92 : 88, tag: '할 일', tagCls: TAG.todo, title: `상위 요청 '${n.title}' ${dd < 0 ? `${-dd}일 지남` : dd === 0 ? '오늘 마감' : `D-${dd}`}`, why: n.source ? `${n.source} 요청` : undefined, action: '조직·전사에서 보기', to: '/brief/org' });
  }
  const late = pr.filter((a) => a.due_date && a.due_date < today);
  if (late.length) out.push({ key: 'promise-late', score: 84, tag: '할 일', tagCls: TAG.todo, title: `팀원에게 한 약속 ${late.length}건이 기한을 넘겼습니다`, why: late.slice(0, 2).map((a) => a.title).join(' · '), action: '오늘 할 일에서 처리', to: '#today' });
  const ooToday = oo.filter((o) => isToday(o.scheduled_at) && new Date(o.scheduled_at).getTime() > Date.now() - 3600000);
  if (ooToday.length) out.push({ key: 'oo-today', score: 72, tag: '할 일', tagCls: TAG.todo, title: `오늘 1:1 ${ooToday.map((o) => `${nameOf(o.member_id)} ${fmtTime(o.scheduled_at)}`).join(', ')}`, why: '준비 노트를 미리 만들어 두면 15분이 줄어듭니다', action: '1:1 준비', to: `/one-on-ones/${ooToday[0].id}` });
  const oldRv = rv.filter((r) => daysAgo(r.v?.created_at ?? r.s.created_at) >= 3);
  if (oldRv.length) out.push({ key: 'rv-old', score: 66, tag: '할 일', tagCls: TAG.todo, title: `3일 넘게 리뷰를 기다리는 결과물 ${oldRv.length}건`, why: oldRv.slice(0, 2).map((r) => r.s.title).join(' · '), action: '리뷰하기', to: '/reviews' });
  // 의사결정
  for (const g of m.lowGoals) out.push({ key: `goal-${g.goal_id}`, score: 78, tag: '의사결정', tagCls: TAG.decide, title: `'${g.title}' 목표 조정 또는 지원 결정 (달성 가능성 ${g.probability}%)`, action: '무엇을 바꾸면 되는지 시뮬레이션', to: '/sim' });
  for (const n of m.orgSt.high) out.push({ key: `org-${n.id}`, score: 74, tag: '의사결정', tagCls: TAG.decide, title: `전사 방침 대응: ${n.title}`, why: m.org.data?.impactOf.get(n.id)?.content.summary, action: '영향 보기', to: '/brief/org' });
  // AI와 같은 사람·같은 목표를 말하는 규칙 항목은 뺀다
  const names = members.map((x) => x.profiles?.full_name).filter(Boolean) as string[];
  const goalTitles = (m.raw?.goals ?? []).map((g) => g.title);
  const aiText = out.filter((p) => p.ai).map((p) => p.title + ' ' + (p.why ?? '')).join(' ');
  const dup = (p: Prio) => !p.ai && (names.some((n) => p.title.includes(n) && aiText.includes(n)) || goalTitles.some((g) => p.title.includes(g) && aiText.includes(g.slice(0, 6))));
  const seen = new Set<string>();
  return out.filter((p) => !dup(p)).sort((a, b) => b.score - a.score).filter((p) => (seen.has(p.title) ? false : (seen.add(p.title), true))).slice(0, 5);
}

function TopPriority({ m, period, setPeriod, onAct }: { m: HomeModel; period: 'daily' | 'weekly' | 'monthly'; setPeriod: (p: 'daily' | 'weekly' | 'monthly') => void; onAct: (s: Signal) => void }) {
  const { team } = useTeam();
  const list = usePriorities(m, team.id);
  const headline = m.insight?.content.headline;
  const go = (p: Prio) => {
    if (p.signal) return onAct(p.signal);
    if (p.to === '#today') return window.dispatchEvent(new Event(OPEN_TODAY));
    if (p.to?.startsWith('#')) return document.getElementById(p.to.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const Row = ({ p, i, big }: { p: Prio; i: number; big?: boolean }) => {
    const body = (
      <>
        <span className={cx('font-bold num shrink-0 leading-none', big ? 'text-4xl text-white' : 'text-2xl text-white/60')}>{i + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className={cx('text-[10px] font-semibold rounded px-1.5 py-0.5', p.tagCls)}>{p.tag}</span>
            {p.ai && <span className="text-[10px] font-semibold text-violet-300 inline-flex items-center gap-0.5"><Sparkles size={10} />AI</span>}
          </span>
          <span className={cx('block font-semibold leading-snug mt-1', big ? 'text-lg' : 'text-[15px]')}>{p.title}</span>
          {p.why && <span className={cx('block text-slate-400 leading-snug mt-0.5', big ? 'text-sm line-clamp-2' : 'text-xs line-clamp-1')}>{p.why}</span>}
          {p.action && <span className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-semibold text-violet-300 group-hover:text-white">{p.action}<ChevronRight size={12} /></span>}
        </span>
      </>
    );
    const cls = cx('group flex items-start gap-3 rounded-2xl text-left transition-colors', big ? 'bg-white/[0.08] hover:bg-white/[0.12] ring-1 ring-white/10 p-5' : 'bg-white/[0.04] hover:bg-white/[0.09] ring-1 ring-white/[0.07] p-4');
    return p.to && !p.to.startsWith('#') && !p.signal ? <Link to={p.to} className={cls}>{body}</Link> : <button onClick={() => go(p)} className={cls}>{body}</button>;
  };
  return (
    <section aria-label="Top Priority" className="relative overflow-hidden rounded-3xl bg-slate-950 text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(124,58,237,0.45),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(79,70,229,0.25),transparent_50%)]" />
      <div className="relative p-5 sm:p-6">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center shrink-0"><Sparkles size={19} /></span>
          <div className="flex-1 min-w-[220px]">
            <div className="text-[11px] font-semibold tracking-wide text-violet-300">TOP PRIORITY · {PERIOD_LABEL[period]}</div>
            <p className="text-lg font-semibold leading-snug">{m.loading ? '팀 기록을 살펴보는 중입니다…' : headline ? stripTags(headline) : `지금 가장 중요한 ${list.length}가지`}</p>
          </div>
          <PeriodTabs period={period} setPeriod={setPeriod} dark />
        </div>
        {!m.loading && (!list.length ? <p className="mt-5 text-slate-300">지금 급하게 챙길 것이 없습니다. 아래 섹션에서 흐름을 확인해 보세요.</p> : (
          <div className="mt-5 grid lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2 grid"><Row p={list[0]} i={0} big /></div>
            <div className="lg:col-span-3 grid sm:grid-cols-2 gap-3">{list.slice(1).map((p, i) => <Row key={p.key} p={p} i={i + 1} />)}</div>
          </div>
        ))}
        <p className="relative mt-4 text-[11px] text-slate-500">리스크·의사결정·할 일·조직 소식을 모두 모아 급하고 영향이 큰 순으로 고릅니다. {m.insight ? 'AI 해석과 자동 감지를 함께 씁니다.' : 'AI 해석을 만들면 원인까지 엮어 고릅니다.'}</p>
      </div>
    </section>
  );
}

// =====================================================================
// ② Positive ↔ Risk (마주 보게)
// =====================================================================
function PosRisk({ m, act }: { m: HomeModel; act: (s: Signal) => void }) {
  const [period] = usePeriod();
  const pos = m.positives.slice(0, 4);
  const risks = m.riskList.slice(0, 4);
  const aiGood = m.insight ? (['perf', 'people', 'org', 'decide'] as const).flatMap((s) => m.ai[s].items.filter((i) => i.type === 'good')).slice(0, 1) : [];
  const risk = m.ai.risk;
  return (
    <section id="sec-risk" aria-label="잘 되는 것과 리스크" className={cx(card, 'overflow-hidden scroll-mt-24')}>
      <div className="grid md:grid-cols-2">
        {/* Positive */}
        <div className="p-5 sm:p-6 bg-gradient-to-br from-emerald-50/70 via-white to-white">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <IconBox grad="from-emerald-500 to-emerald-600"><ThumbsUp size={18} /></IconBox>
              <div><div className="font-bold text-lg tracking-tight">잘 되고 있는 것</div><div className="text-xs text-slate-500">인정하고 키울 것</div></div>
            </div>
            <div className="text-right"><div className="text-3xl font-bold num text-emerald-700 leading-none">{m.positives.length}</div><div className="text-[11px] text-slate-500">Positive</div></div>
          </div>
          {aiGood[0] && <p className="mt-4 text-sm rounded-xl bg-white/80 ring-1 ring-emerald-100 px-3 py-2 flex gap-2"><Sparkles size={14} className="text-violet-600 mt-0.5 shrink-0" /><span><b className="font-semibold">{aiGood[0].title}</b> {stripTags(aiGood[0].body)}</span></p>}
          <ul className="mt-4 space-y-1">
            {!pos.length && <li className="text-sm text-slate-400">아직 쌓인 좋은 신호가 없습니다. 기한 안 완료·컨디션 상승·결정 적중이 생기면 여기에 모입니다.</li>}
            {pos.map((p) => (
              <li key={p.id}>
                <button onClick={() => p.signal && act(p.signal)} className="w-full text-left flex items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-white">
                  <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1"><span className="block text-sm leading-snug">{p.title}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5"><span className={cx('w-1.5 h-1.5 rounded-full', AREA_DOT[p.area] ?? 'bg-slate-400')} />{AREA_SHORT[p.area] ?? ''}{p.detail ? ` · ${p.detail}` : ''}</span></span>
                </button>
              </li>
            ))}
          </ul>
          {pos.length > 0 && <p className="mt-3 text-xs text-emerald-800/80 px-2.5">→ 관찰 메모로 남겨 두면 평가 근거가 됩니다</p>}
        </div>
        {/* Risk */}
        <div className="p-5 sm:p-6 bg-gradient-to-bl from-rose-50/80 via-white to-white border-t md:border-t-0 md:border-l border-slate-100">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <IconBox grad="from-rose-500 to-rose-600"><AlertTriangle size={18} /></IconBox>
              <div><div className="flex items-center gap-2"><Link to={briefLink('risk', period)} className="font-bold text-lg tracking-tight hover:underline underline-offset-4">커지는 리스크</Link><StatusPill m={m} section="risk" /></div><div className="text-xs text-slate-500">원인이 어디서 오나</div></div>
            </div>
            <div className="text-right"><div className="text-3xl font-bold num text-rose-600 leading-none">{m.riskList.length}</div><div className="text-[11px] text-slate-500">{m.bigRisks.length ? `지금 확인 ${m.bigRisks.length}` : 'Risk'}</div></div>
          </div>
          {m.insight && (risk.summary || risk.items[0]) && <p className="mt-4 text-sm rounded-xl bg-white/80 ring-1 ring-rose-100 px-3 py-2 flex gap-2"><Sparkles size={14} className="text-violet-600 mt-0.5 shrink-0" /><span className="font-medium">{stripTags(risk.summary || risk.items[0].title)}</span></p>}
          <ul className="mt-4 space-y-1">
            {!risks.length && <li className="text-sm text-slate-400">{PERIOD_LABEL[period]} 감지된 리스크가 없습니다.</li>}
            {risks.map((s) => (
              <li key={s.id} className={cx(m.locked(s.id) && 'blur-[3px] select-none pointer-events-none')}>
                <button onClick={() => act(s)} className="w-full text-left flex items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-white">
                  <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0 ring-2 ring-white', s.severity >= 3 ? 'bg-rose-500' : 'bg-amber-400')} />
                  <span className="min-w-0 flex-1"><span className="block text-sm leading-snug">{s.title}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5"><span className={cx('w-1.5 h-1.5 rounded-full', AREA_DOT[sectionOf(s)])} />{AREA_SHORT[sectionOf(s)]}{s.severity >= 3 && <b className="text-rose-600 font-semibold">· 지금 확인</b>}{s.action && <span className="text-slate-400">· {s.action.label}</span>}</span></span>
                </button>
              </li>
            ))}
          </ul>
          {m.riskList.length > 4 && <div className="mt-2 px-2.5"><MoreLink to={briefLink('risk', period)} label={`리스크 ${m.riskList.length}건 모두 보기`} className="text-rose-700 -ml-2.5" /></div>}
        </div>
      </div>
    </section>
  );
}

// =====================================================================
// ③ 의사결정 — 목록 │ AI 인사이트
// =====================================================================
const RATING: Record<string, { label: string; cls: string }> = {
  hit: { label: '적중', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }, partial: { label: '부분', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  miss: { label: '빗나감', cls: 'bg-rose-50 text-rose-700 ring-rose-200' }, wait: { label: '결과 대기', cls: 'bg-slate-50 text-slate-500 ring-slate-200' },
};
function DecidePanel({ m }: { m: HomeModel }) {
  const [period] = usePeriod();
  const today = todayYmd();
  const due = (m.raw?.decisionsDue ?? []).filter((d) => (d.review_on ? d.review_on <= today : daysAgo(d.decided_at) >= 30));
  const rows = [
    ...due.map((d) => ({ key: `d-${d.id}`, tag: '결과 기록', title: d.title, to: '/strategy', icon: <Gavel size={14} />, c: 'bg-slate-100 text-slate-700' })),
    ...m.orgSt.high.map((n) => ({ key: `o-${n.id}`, tag: '방침 대응', title: n.title, to: '/brief/org', icon: <Building2 size={14} />, c: 'bg-fuchsia-50 text-fuchsia-700' })),
    ...m.lowGoals.map((g) => ({ key: `g-${g.goal_id}`, tag: '목표 조정', title: `${g.title} · ${g.probability}%`, to: '/sim', icon: <Target size={14} />, c: 'bg-indigo-50 text-indigo-700' })),
  ].slice(0, 4);
  const recent = m.recentDecisions.slice(0, 3);
  const k = m.k;
  return (
    <section id="sec-decide" className="scroll-mt-24 rounded-3xl bg-white ring-1 ring-slate-900/10 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_10px_30px_-18px_rgba(15,23,42,0.35)] overflow-hidden">
      <div className="relative bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 text-white px-5 sm:px-6 py-4 flex items-center gap-4 flex-wrap">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_-20%,rgba(255,255,255,0.18),transparent_45%)]" />
        <span className="relative w-11 h-11 rounded-full bg-white/10 ring-2 ring-white/30 flex items-center justify-center shrink-0"><Gavel size={19} /></span>
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-2"><Link to={briefLink('decide', period)} className="font-bold text-lg tracking-tight hover:underline underline-offset-4">의사결정</Link>
            {!m.loading && <span className="text-[11px] font-semibold rounded-full bg-white/15 px-2 py-0.5 inline-flex items-center gap-1"><span className={cx('w-1.5 h-1.5 rounded-full', STATUS_DOT[m.status.decide])} />{STATUS_META[m.status.decide].label}</span>}</div>
          <div className="text-xs text-slate-300">결정할 것 · 지난 결정 회고</div>
        </div>
        <div className="relative flex items-center gap-4 text-xs text-slate-300">
          <span>결정할 것 <b className="text-white text-base num ml-0.5">{rows.length}</b></span>
          {k.hitRate != null && <span>판단 적중률 <b className="text-white text-base num ml-0.5">{k.hitRate}%</b></span>}
        </div>
        <Link to="/strategy" className="relative text-xs font-semibold rounded-lg bg-white text-slate-900 hover:bg-slate-100 px-2.5 py-1.5 inline-flex items-center gap-1"><Plus size={12} />결정 기록</Link>
        <Link to={briefLink('decide', period)} className="relative text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 inline-flex items-center gap-0.5">자세히<ChevronRight size={13} /></Link>
      </div>
      <div className="p-5 sm:p-6">
      <div className="grid lg:grid-cols-5 gap-5">
        <div className="min-w-0 lg:col-span-3">
          <div className="flex items-baseline justify-between"><span className="text-[11px] font-semibold tracking-wide text-slate-400">결정할 것</span><span className="text-xs text-slate-500 num">{rows.length}건</span></div>
          <ul className="mt-2 space-y-1.5">
            {!rows.length && <li className="text-sm text-slate-400 rounded-xl bg-slate-50 px-3 py-3">지금 내려야 할 결정이 없습니다.</li>}
            {rows.map((r) => (
              <li key={r.key}><Link to={r.to} className="flex items-center gap-3 rounded-xl ring-1 ring-slate-200/70 px-3 py-2.5 hover:ring-slate-300 hover:bg-slate-50 group">
                <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', r.c)}>{r.icon}</span>
                <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold text-slate-500">{r.tag}</span><span className="block text-sm leading-snug truncate">{r.title}</span></span>
                <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 shrink-0" />
              </Link></li>
            ))}
          </ul>
          <div className="mt-5 flex items-baseline justify-between"><span className="text-[11px] font-semibold tracking-wide text-slate-400">최근 결정</span>
            {k.hitRate != null && <span className="text-xs text-slate-500">판단 적중률 <b className="text-slate-800 num">{k.hitRate}%</b> ({k.rated}건)</span>}</div>
          {!recent.length ? <p className="mt-2 text-sm text-slate-400">기록한 결정이 없습니다.</p> : (
            <ol className="mt-2 relative ml-2 pl-4 border-l border-slate-200 space-y-2.5">
              {recent.map((d) => {
                const r = RATING[d.outcome_rating ?? 'wait'];
                return (
                  <li key={d.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-white ring-2 ring-slate-300" />
                    <div className="flex items-center gap-2 text-sm"><span className="truncate flex-1">{d.title}</span><span className={cx('text-[10px] font-semibold rounded-full px-2 py-0.5 ring-1 shrink-0', r.cls)}>{r.label}</span></div>
                    <div className="text-[11px] text-slate-400">{fmtDate(d.decided_at)}{d.expected_outcome ? ` · 기대: ${d.expected_outcome}` : ''}</div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="lg:col-span-2"><AiInsight m={m} section="decide" n={2} /></div>
      </div>
      </div>
    </section>
  );
}

// =====================================================================
// 오늘 할 일 — 작은 카드 (1:1 · 리뷰 대기 · 내 약속 + 그 밖의 대기열)
// =====================================================================
function TodayCard({ teamId, raw, orgNotes, onClose }: { teamId: string; raw: Raw | undefined; orgNotes: OrgNote[]; onClose?: () => void }) {
  // 오른쪽 아래 떠 있는 버튼으로 여는 패널
  const { nameOf } = useTeam();
  const qc = useQueryClient();
  const oo = useWeekOneOnOnes(teamId).data ?? [];
  const rv = useReviewQueue(teamId).data ?? [];
  const pr = usePromises(teamId).data ?? [];
  const answered = useAnsweredRequests(teamId).data ?? 0;
  const done = useMutation({
    mutationFn: (id: string) => q(supabase.from('action_items').update({ done_at: new Date().toISOString() }).eq('id', id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['promises'] }); qc.invalidateQueries({ queryKey: ['home-insights'] }); },
  });
  const today = todayYmd();
  const ooUp = oo.filter((o) => new Date(o.scheduled_at).getTime() > Date.now() - 3600000);
  const late = pr.filter((a) => a.due_date && a.due_date < today);
  const proposed = (raw?.items ?? []).filter((i) => i.status === 'proposed').length;
  const upReq = orgNotes.filter((n) => n.status === 'open' && n.kind === 'request' && n.event_date && dDay(n.event_date) <= 7);
  const cols = [
    { k: '1:1', n: ooUp.length, sub: ooUp.some((o) => isToday(o.scheduled_at)) ? `오늘 ${ooUp.filter((o) => isToday(o.scheduled_at)).length}건` : '이번 주', icon: MessagesSquare, to: '/one-on-ones', alert: false },
    { k: '리뷰 대기', n: rv.length, sub: rv.length ? (rv.some((r) => r.review) ? 'AI 검토 완료 있음' : 'AI 검토 전') : '없음', icon: FileText, to: '/reviews', alert: rv.some((r) => daysAgo(r.v?.created_at ?? r.s.created_at) >= 3) },
    { k: '내 약속', n: pr.length, sub: late.length ? `기한 지남 ${late.length}` : '기한 내', icon: CheckCircle2, to: '#', alert: late.length > 0 },
  ];
  const extras = [
    proposed && { k: `팀원 계획 승인 ${proposed}`, to: '/goals?filter=proposed', icon: ListTree },
    upReq.length && { k: `상위 요청 D-${Math.max(0, Math.min(...upReq.map((n) => dDay(n.event_date!))))}`, to: '/brief/org', icon: ArrowUpRight },
    answered && { k: `팀원 답변 ${answered}`, to: '/team?tab=requests', icon: Inbox },
  ].filter(Boolean) as { k: string; to: string; icon: typeof Inbox }[];
  const items = [
    ...ooUp.filter((o) => isToday(o.scheduled_at)).map((o) => ({ key: o.id, node: <Link to={`/one-on-ones/${o.id}`} className="flex items-center gap-3 hover:text-indigo-700"><span className="font-mono text-xs text-teal-700 font-semibold w-11 shrink-0">{fmtTime(o.scheduled_at)}</span><span className="truncate">{nameOf(o.member_id)} 1:1</span></Link> })),
    ...rv.slice(0, 2).map(({ s }) => ({ key: s.id, node: <Link to={`/reviews/${s.id}`} className="flex items-center gap-3 hover:text-indigo-700"><span className="text-[11px] text-sky-700 font-semibold w-11 shrink-0">리뷰</span><span className="truncate">{s.title}</span></Link> })),
    ...pr.slice(0, 3).map((a) => {
      const isLate = a.due_date && a.due_date < today;
      return { key: a.id, node: (
        <div className="flex items-start gap-3">
          <button onClick={() => done.mutate(a.id)} aria-label="완료로 표시" title="완료로 표시" className={cx('w-11 shrink-0 flex', isLate ? 'text-rose-400' : 'text-slate-300', 'hover:text-violet-600')}><Circle size={15} /></button>
          <span className="min-w-0"><span className="block truncate">{a.title}</span><span className={cx('text-[11px]', isLate ? 'text-rose-600' : 'text-slate-400')}>{a.due_date ? fmtDate(a.due_date) : '기한 없음'}{isLate ? ' · 지남' : ''}</span></span>
        </div>) };
    }),
  ];
  return (
    <section aria-label="오늘 할 일" className="rounded-2xl bg-white overflow-hidden flex flex-col max-h-[70vh]">
      <div className="px-5 py-4 border-b border-slate-100 font-bold flex items-center gap-2"><CalendarCheck size={17} className="text-violet-600" />오늘 할 일
        {onClose && <button onClick={onClose} aria-label="닫기" className="ml-auto text-slate-400 hover:text-slate-700"><X size={17} /></button>}</div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
        {cols.map((c) => (
          <Link key={c.k} to={c.to} onClick={(e) => { if (c.to === '#') e.preventDefault(); }} className="px-2 py-3.5 text-center hover:bg-slate-50">
            <div className="text-[11px] text-slate-500 flex items-center justify-center gap-1"><c.icon size={12} />{c.k}</div>
            <div className="text-2xl font-bold num mt-0.5">{c.n}</div>
            <div className={cx('text-[11px]', c.alert ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{c.sub}</div>
          </Link>
        ))}
      </div>
      {extras.length > 0 && (
        <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap gap-1.5">
          {extras.map((x) => <Link key={x.k} to={x.to} className="text-xs font-semibold rounded-full bg-violet-50 text-violet-700 px-2.5 py-1 inline-flex items-center gap-1 hover:bg-violet-100"><x.icon size={12} />{x.k}</Link>)}
        </div>
      )}
      <ul className="flex-1 overflow-y-auto text-sm divide-y divide-slate-50">
        {!items.length ? <li className="px-5 py-8 text-center text-slate-500">오늘 처리할 일이 없습니다.</li>
          : items.map((i) => <li key={i.key} className="px-5 py-2.5">{i.node}</li>)}
      </ul>
    </section>
  );
}

/** 오늘 할 일 — 화면 오른쪽 아래 떠 있는 버튼. 처리할 건수를 배지로, 누르면 패널 */
const OPEN_TODAY = 'ateam:open-today';
function FloatingToday({ teamId, raw, orgNotes }: { teamId: string; raw: Raw | undefined; orgNotes: OrgNote[] }) {
  const [open, setOpen] = useState(false);
  const oo = useWeekOneOnOnes(teamId).data ?? [];
  const rv = useReviewQueue(teamId).data ?? [];
  const pr = usePromises(teamId).data ?? [];
  const today = todayYmd();
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(OPEN_TODAY, h);
    return () => window.removeEventListener(OPEN_TODAY, h);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const ooToday = oo.filter((o) => isToday(o.scheduled_at) && new Date(o.scheduled_at).getTime() > Date.now() - 3600000).length;
  const late = pr.filter((a) => a.due_date && a.due_date < today).length;
  const proposed = (raw?.items ?? []).filter((i) => i.status === 'proposed').length;
  const upReq = orgNotes.filter((n) => n.status === 'open' && n.kind === 'request' && n.event_date && dDay(n.event_date) <= 3).length;
  const n = ooToday + rv.length + pr.length + proposed + upReq;
  const urgent = late + upReq > 0;
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/20 sm:bg-transparent" onClick={() => setOpen(false)} aria-hidden />}
      {open && (
        <div role="dialog" aria-label="오늘 할 일" className="fixed z-50 inset-x-3 bottom-20 sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[380px] rounded-2xl shadow-2xl ring-1 ring-slate-900/10 bg-white">
          <TodayCard teamId={teamId} raw={raw} orgNotes={orgNotes} onClose={() => setOpen(false)} />
        </div>
      )}
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`오늘 할 일 ${n}건`}
        className={cx('fixed z-50 right-4 bottom-4 sm:right-6 sm:bottom-6 rounded-full shadow-xl pl-4 pr-5 py-3 inline-flex items-center gap-2.5 text-white transition-all hover:scale-[1.03]',
          open ? 'bg-slate-900' : 'bg-gradient-to-r from-violet-600 to-indigo-600')}>
        <span className="relative">{open ? <X size={18} /> : <CalendarCheck size={18} />}
          {!open && urgent && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-violet-600" />}</span>
        <span className="text-sm font-semibold">오늘 할 일</span>
        {n > 0 && <span className="text-xs font-bold num rounded-full bg-white text-violet-700 px-2 py-0.5">{n}</span>}
      </button>
    </>
  );
}

// =====================================================================
// ④ 팀원관리 — 청록 띠 머리 + 왼쪽 요약 │ 오른쪽 팀원 카드
// =====================================================================
function TeamMembers({ m, onMemo }: { m: HomeModel; onMemo: (w: string) => void }) {
  const [period] = usePeriod();
  const members = useTeamMembersOnly();
  const raw = m.raw;
  const k = m.k;
  const care = new Map((raw?.care ?? []).map((c) => [c.user_id, c.signals]));
  const depth = new Map((raw?.depth ?? []).map((d) => [d.user_id, d]));
  const FLAG: Record<string, string> = { condition_down: '컨디션 하락', blocked_repeat: '막힘 반복', no_one_on_one: '1:1 공백', checkin_missing: '체크인 없음' };
  const condOf = (uid: string) => k.weekStarts.map((w) => (raw?.checkins ?? []).find((c) => c.user_id === uid && c.week_start === w)?.condition ?? null);
  const sorted = [...members].sort((a, b) => ((care.get(b.user_id)?.length ?? 0) - (care.get(a.user_id)?.length ?? 0)));
  const st = m.loading ? null : m.status.people;
  return (
    <section id="sec-people" className="scroll-mt-24 rounded-3xl bg-white ring-1 ring-teal-900/10 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_10px_30px_-18px_rgba(13,148,136,0.35)] overflow-hidden">
      <div className="relative bg-gradient-to-r from-teal-600 via-teal-600 to-emerald-600 text-white px-5 sm:px-6 py-4 flex items-center gap-4 flex-wrap">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_-20%,rgba(255,255,255,0.25),transparent_45%)]" />
        <span className="relative w-11 h-11 rounded-full bg-white/15 ring-2 ring-white/40 flex items-center justify-center shrink-0"><Users size={20} /></span>
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-2"><Link to={briefLink('people', period)} className="font-bold text-lg tracking-tight hover:underline underline-offset-4">팀원관리</Link>
            {st && <span className="text-[11px] font-semibold rounded-full bg-white/20 px-2 py-0.5 inline-flex items-center gap-1"><span className={cx('w-1.5 h-1.5 rounded-full', STATUS_DOT[st])} />{STATUS_META[st].label}</span>}</div>
          <div className="text-xs text-teal-50/90">컨디션 · 1:1 · 성장과 평가 근거</div>
        </div>
        <div className="relative flex -space-x-2">
          {members.slice(0, 6).map((mb) => <span key={mb.user_id} className="rounded-full ring-2 ring-teal-600"><Avatar name={mb.profiles?.full_name} size={7} /></span>)}
        </div>
        <Link to={briefLink('people', period)} className="relative text-xs font-semibold rounded-lg bg-white/15 hover:bg-white/25 px-2.5 py-1.5 inline-flex items-center gap-0.5">자세히<ChevronRight size={13} /></Link>
      </div>
      <div className="grid lg:grid-cols-4">
        <div className="p-5 sm:p-6 bg-teal-50/40 lg:border-r border-teal-100 space-y-4">
          <div>
            <div className="text-[11px] text-slate-500">팀 컨디션 (5점) · 6주</div>
            <div className="flex items-end gap-3"><span className="text-4xl font-bold num leading-none">{k.cond}</span><Sparkline points={k.condTrend} labels={k.condWeeks} tone="teal" w={96} h={34} /></div>
          </div>
          <dl className="grid grid-cols-3 lg:grid-cols-1 gap-2 text-sm">
            <div className="rounded-xl bg-white ring-1 ring-teal-100 px-3 py-2 flex items-center justify-between"><dt className="text-xs text-slate-500">체크인</dt><dd className="font-bold num">{k.ciThis}/{k.nMem}</dd></div>
            <div className="rounded-xl bg-white ring-1 ring-teal-100 px-3 py-2 flex items-center justify-between"><dt className="text-xs text-slate-500">챙길 팀원</dt><dd className={cx('font-bold num', k.careN ? 'text-amber-600' : '')}>{k.careN}</dd></div>
            <div className="rounded-xl bg-white ring-1 ring-teal-100 px-3 py-2 flex items-center justify-between"><dt className="text-xs text-slate-500">평가 근거</dt><dd className="font-bold num">{k.evidence}</dd></div>
          </dl>
          <AiInsight m={m} section="people" variant="stack" />
        </div>
        <div className="lg:col-span-3 p-5 sm:p-6">
          <div className="text-[11px] font-semibold tracking-wide text-slate-400 mb-2.5">팀원별 · 챙길 사람 먼저 (누르면 관찰 메모)</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {!members.length && <p className="text-sm text-slate-400 col-span-full">팀원을 초대하면 팀원별 카드가 생깁니다.</p>}
            {sorted.map((mb) => {
              const series = condOf(mb.user_id);
              const c = [...series].reverse().find((v) => v != null) ?? null;
              const flags = (care.get(mb.user_id) ?? []).map((x) => FLAG[x.type]).filter(Boolean);
              const thin = depth.get(mb.user_id) && !depth.get(mb.user_id)!.eligible;
              const ring = c == null ? 'ring-slate-200' : c <= 2 ? 'ring-rose-400' : c === 3 ? 'ring-amber-400' : 'ring-emerald-400';
              const alert = flags.length > 0;
              return (
                <button key={mb.user_id} onClick={() => onMemo(mb.user_id)} title="관찰 메모 남기기"
                  className={cx('relative text-left rounded-2xl p-3.5 ring-1 transition-all hover:-translate-y-0.5 hover:shadow-md bg-white overflow-hidden', alert ? 'ring-rose-200' : 'ring-slate-900/[0.07]')}>
                  {alert && <span aria-hidden className="absolute left-0 inset-y-0 w-1 bg-rose-400" />}
                  <div className="flex items-center gap-2.5">
                    <span className={cx('rounded-full ring-2 ring-offset-2 shrink-0', ring)}><Avatar name={mb.profiles?.full_name} size={8} /></span>
                    <span className="min-w-0"><span className="block text-sm font-semibold truncate">{mb.profiles?.full_name}</span><span className="block text-[11px] text-slate-500 truncate">{mb.job_title}</span></span>
                    <span className="ml-auto text-right"><span className="block text-[10px] text-slate-400">컨디션</span><span className="text-lg font-bold num leading-none">{c ?? '—'}</span></span>
                  </div>
                  <div className="mt-2"><Sparkline points={series} labels={k.condWeeks} tone={c != null && c <= 2 ? 'rose' : 'teal'} w={150} h={26} /></div>
                  <div className="mt-1.5 flex flex-wrap gap-1 min-h-[20px]">
                    {flags.map((f) => <span key={f} className="text-[10px] font-semibold rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-100 px-1.5 py-0.5">{f}</span>)}
                    {thin && <span className="text-[10px] font-semibold rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-100 px-1.5 py-0.5">근거 부족</span>}
                    {!alert && !thin && <span className="text-[10px] text-emerald-700 font-semibold inline-flex items-center gap-1"><CheckCircle2 size={11} />특이사항 없음</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// =====================================================================
// ⑤ 조직·전사 — 세 칸: AI·위로 올릴 것 │ 위에서 온 것 │ 일정 타임라인
// =====================================================================
function OrgBoard({ m, onAdd }: { m: HomeModel; onAdd: () => void }) {
  const [period] = usePeriod();
  const feed = m.orgSt.feed.slice(0, 4);
  const st = m.loading ? null : m.status.org;
  return (
    <section id="sec-org" className="scroll-mt-24 rounded-3xl bg-white ring-1 ring-fuchsia-900/10 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_10px_30px_-18px_rgba(192,38,211,0.3)] overflow-hidden">
      <div className="px-5 sm:px-6 pt-5 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="relative w-11 h-11 shrink-0">
            <span className="absolute inset-0 rounded-xl bg-fuchsia-200 rotate-6" />
            <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white flex items-center justify-center shadow-sm"><Building2 size={19} /></span>
          </span>
          <div>
            <div className="flex items-center gap-2"><Link to={briefLink('org', period)} className="font-bold text-lg tracking-tight hover:underline underline-offset-4">조직·전사</Link>
              {st && <span className={cx('text-[11px] font-semibold border rounded-full pl-1.5 pr-2 py-0.5 inline-flex items-center gap-1', STATUS_META[st].cls)}><span className={cx('w-1.5 h-1.5 rounded-full', STATUS_DOT[st])} />{STATUS_META[st].label}</span>}</div>
            <div className="text-xs text-slate-500">위에서 온 것 → 우리 팀 영향 → 위로 올릴 것</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onAdd} className="text-xs font-semibold text-white bg-fuchsia-600 hover:bg-fuchsia-700 rounded-lg px-3 py-1.5 inline-flex items-center gap-1 shadow-sm"><Plus size={13} />위에서 온 것 남기기</button>
          <MoreLink to={briefLink('org', period)} label="자세히" className="text-fuchsia-700" />
        </div>
      </div>
      <div className="mt-4 grid lg:grid-cols-3 border-t border-slate-100">
        {/* 1. AI + 위로 올릴 것 */}
        <div className="p-5 sm:p-6 space-y-3 lg:border-r border-slate-100">
          <AiInsight m={m} section="org" variant="stack" />
          {m.orgSt.up.length ? m.orgSt.up.slice(0, 2).map((x, i) => (
            <Link key={i} to="/report" className="block rounded-2xl bg-slate-900 text-white px-4 py-3 hover:bg-slate-800">
              <div className="text-[10px] font-semibold text-fuchsia-300 flex items-center gap-1"><ArrowUpRight size={12} />위로 올릴 것 · {x.src}</div>
              <div className="text-sm leading-snug mt-1 line-clamp-3">{x.t}</div>
              <div className="text-[11px] text-slate-400 mt-1.5">주간보고에 담기 →</div>
            </Link>
          )) : <p className="text-sm text-slate-400 rounded-2xl bg-slate-50 px-4 py-3">지금 위에 올릴 급한 것이 없습니다.</p>}
        </div>
        {/* 2. 위에서 온 것 */}
        <div className="p-5 sm:p-6 lg:border-r border-slate-100 bg-fuchsia-50/30">
          <div className="flex items-baseline justify-between mb-2"><span className="text-[11px] font-semibold tracking-wide text-slate-400">위에서 온 것</span>
            <span className="text-xs text-slate-500">영향 확인 <b className="num text-slate-800">{m.orgSt.analyzed}/{m.orgSt.feed.length}</b></span></div>
          {!feed.length ? <p className="text-sm text-slate-400">전사 방침, 임원 관심사, 상위 요청을 남기면 우리 팀 영향을 AI가 맞춰 봅니다.</p> : (
            <ul className="space-y-2">
              {feed.map((n) => {
                const im = m.org.data?.impactOf.get(n.id)?.content;
                return (
                  <li key={n.id}><Link to={briefLink('org', period)} className="block rounded-xl bg-white ring-1 ring-slate-900/5 px-3 py-2.5 hover:ring-fuchsia-200 hover:shadow-sm">
                    <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                      <span className={cx('font-semibold rounded px-1.5 py-px', ORG_KIND[n.kind].cls)}>{ORG_KIND[n.kind].label}</span>
                      {im ? <span className={cx('font-semibold rounded px-1.5 py-px', IMPACT_LEVEL[im.level]?.cls)}>{IMPACT_LEVEL[im.level]?.label}</span> : <span className="text-violet-600 font-semibold">영향 확인 전</span>}
                      <span className="text-slate-400 ml-auto">{n.source || fmtDate(n.created_at)}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium leading-snug">{n.title}</div>
                    {im?.summary && <div className="text-xs text-slate-500 line-clamp-2 mt-0.5">{stripTags(im.summary)}</div>}
                  </Link></li>
                );
              })}
            </ul>
          )}
        </div>
        {/* 3. 일정 타임라인 */}
        <div className="p-5 sm:p-6">
          <div className="text-[11px] font-semibold tracking-wide text-slate-400 mb-3 flex items-center gap-1.5"><CalendarClock size={12} />다가오는 일정·기한</div>
          {!m.orgSt.upcoming.length ? <p className="text-sm text-slate-400">상위 요청 기한이나 평가 시즌 같은 전사 일정을 남기면 여기에 D-day로 보입니다.</p> : (
            <ol className="relative ml-1.5 border-l-2 border-dashed border-fuchsia-200 space-y-4 pl-5">
              {m.orgSt.upcoming.slice(0, 4).map((n) => {
                const dd = dDay(n.event_date!);
                const near = dd <= 7;
                return (
                  <li key={n.id} className="relative">
                    <span className={cx('absolute -left-[27px] top-0.5 w-3 h-3 rounded-full ring-4 ring-white', dd < 0 ? 'bg-rose-500' : near ? 'bg-fuchsia-600' : 'bg-fuchsia-300')} />
                    <div className="flex items-baseline gap-2">
                      <span className={cx('font-mono text-sm font-bold', dd < 0 ? 'text-rose-600' : near ? 'text-fuchsia-700' : 'text-slate-500')}>{dd < 0 ? `+${-dd}일` : dd === 0 ? '오늘' : `D-${dd}`}</span>
                      <span className="text-[11px] text-slate-400">{fmtDate(n.event_date)}</span>
                    </div>
                    <div className="text-sm leading-snug mt-0.5">{n.title}</div>
                    <div className="text-[11px] text-slate-500">{ORG_KIND[n.kind].label}{n.source ? ` · ${n.source}` : ''}</div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

// =====================================================================
export default function Home() {
  const { team } = useTeam();
  const [period, setPeriod] = usePeriod();
  const m = useHomeModel(period);
  const [memo, setMemo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  const [orgOpen, setOrgOpen] = useState(false);
  const openMemo = (who: string | null = null) => setMemo({ open: true, who });
  const act = useSignalAct(openMemo);

  return (
    <div>
      <Header onMemo={() => openMemo()} onOrg={() => setOrgOpen(true)} />
      <QuickStart teamId={team.id} />

      <div className="mt-6 space-y-5">
        <PerfDashboard m={m} />
        <TopPriority m={m} period={period} setPeriod={setPeriod} onAct={act} />
        <PosRisk m={m} act={act} />
        <DecidePanel m={m} />
        <TeamMembers m={m} onMemo={(w) => openMemo(w)} />
        <OrgBoard m={m} onAdd={() => setOrgOpen(true)} />
      </div>

      <AiStrip teamId={team.id} />
      <FloatingToday teamId={team.id} raw={m.raw} orgNotes={m.org.data?.notes ?? []} />
      <div className="h-16" aria-hidden />
      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
      <OrgNoteModal teamId={team.id} open={orgOpen} onClose={() => setOrgOpen(false)} />
    </div>
  );
}
