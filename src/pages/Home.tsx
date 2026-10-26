// 팀장 홈 — 스크롤 없이 한눈에: TOP PRIORITY(최상단) → 섹션 6칸(핵심 지표 + AI 한두 줄)
// 색: 섹션 정체성 성과 indigo · 사람 teal · 의사결정 slate · 리스크 rose · 조직 fuchsia · 업무 sky / 상태는 rose·amber·emerald, 항상 글자와 함께.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Briefcase, Building2, CalendarCheck, CheckCircle2, ChevronRight, Circle, FileText, Gavel, Inbox, ListTree, MessagesSquare, ScatterChart, Sparkles, StickyNote, Target, UserRound, Users, X } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { OrgNote } from '../lib/types';
import { cx, daysAgo, fmtDate, fmtTime, mondayOf } from '../lib/format';
import type { Raw } from '../lib/insights';
import { isOpenSub, latestAt, useSubmissionsAi, type AiReview } from '../lib/work';
import { usePeopleActions, type MemberIndex } from '../lib/peopleActions';
import { usePeopleIndex } from '../components/people/usePeopleIndex';
import { useBoard, usePriorities } from '../components/decide/priorities';
import { useAdvisor } from '../lib/advisor';
import { useLatestAi } from '../lib/hooks';
import { AiIcon, aiText, AteamAI, LogoMark } from '../components/Brand';
import { onboardingOf } from '../lib/onboarding';
import { useNotes } from '../lib/notes';
import {
  MemoModal, PeriodTabs, QuickStart, SetupResume, periodRangeLabel, STATUS_META,
  dDay, isToday, todayYmd, useAnsweredRequests, useHomeModel, usePeriod, usePromises, useReviewQueue, useWeekOneOnOnes,
  type HomeModel, type MainSection,
} from '../components/home/shared';

const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');

function Header() {
  const { profile } = useTeam();
  const now = new Date();
  const hello = now.getHours() < 11 ? '좋은 아침입니다' : now.getHours() < 18 ? '안녕하세요' : '오늘도 수고 많으셨습니다';
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0 flex items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight">{hello}, {profile?.full_name} 팀장님</h1>
        <span className="text-sm text-slate-500">{fmtDate(now.toISOString(), true)}</span>
      </div>
    </div>
  );
}

// =====================================================================
// ① 팀 성과 — 대시보드 (작은 그래프 카드)
// =====================================================================

// =====================================================================
// DAILY BRIEFING — 최상단. 에이전트가 무엇을 만들고 갱신했는지, 어느 메뉴로 가면 되는지만 짧게.
//   (예전 TOP PRIORITY의 '최우선 3가지'는 ATEAM의 제안 페이지로 옮겼습니다)
// =====================================================================
type BTone = 'rose' | 'amber' | 'agent' | 'slate';
interface BLine { key: string; tone: BTone; text: ReactNode; go: string; to: string; icon: typeof Target }
const B_ORDER: Record<BTone, number> = { rose: 0, agent: 1, amber: 2, slate: 3 };
const AdvisorIcon = ((p: { size?: number; className?: string }) => <LogoMark {...p} weight={4} />) as unknown as typeof Target;

/** 1on1 요청이 중요한 이유 (팀원관리 지표 그대로 — 추가 AI 없음). 빈 배열이면 브리핑에 띄우지 않는다 (이유는 화면에 쓰지 않음) */
function ooWhy(r: { created_at: string }, ix: MemberIndex | undefined, flags: string[], joined?: string | null): string[] {
  const why: string[] = [];
  if (ix && (ix.flight.level === 'risk' || ix.flight.level === 'watch')) why.push(`이탈 가능성 ${ix.flight.label}`);
  const cond = ix?.indices.find((i) => i.key === 'cond');
  const prev = Number(cond?.sub?.match(/3주 전 (\d)/)?.[1] ?? NaN);
  if (ix?.condition != null && (ix.condition <= 2 || (!Number.isNaN(prev) && ix.condition < prev))) why.push('컨디션 하락');
  const oo = ix?.indices.find((i) => i.key === 'oo');
  if (oo?.level === 'risk') why.push(oo.value === '없음' ? '1on1 기록 없음' : `마지막 1on1 ${oo.value}`);
  if (flags.includes('blocked_repeat')) why.push('막힘 반복');
  if (joined && daysAgo(joined) <= 60) why.push('합류 60일 이내');
  if (daysAgo(r.created_at) >= 2) why.push(`요청 ${daysAgo(r.created_at)}일째 대기`);
  return why;
}

function useBriefing(m: HomeModel): BLine[] {
  const { team } = useTeam();
  const k = m.k;
  const pr = usePriorities(m);
  const pi = usePeopleIndex(m);
  const pa = usePeopleActions(team.id, team.is_demo);
  const adv = useAdvisor(team.id, team.is_demo);
  const brief = useLatestAi<{ briefs?: unknown[] }>(team.id, 'exec_brief');
  const subs = useSubmissionsAi(team.id);
  const notes = useNotes();
  const { uid: me } = useTeam();
  const ooReq = useQuery({
    queryKey: ['requests', team.id, 'oo-to-me'],
    queryFn: () => q<{ id: string; from_id: string; created_at: string }[]>(supabase.from('team_requests').select('id, from_id, created_at').eq('team_id', team.id).eq('to_id', me).eq('kind', 'meeting').eq('status', 'open')),
  });
  const { nameOf, members } = useTeam();
  const idx = [...pi.idx.values()];
  const high = idx.filter((x) => x.flight.level === 'risk').length, mid = idx.filter((x) => x.flight.level === 'watch').length;
  const ooGap = idx.filter((x) => ['watch', 'risk'].includes(x.indices.find((i) => i.key === 'oo')?.level ?? '')).length;
  const waiting = (subs.data ?? []).filter(isOpenSub).filter((s) => s.status === 'in_review');
  const reviewed = waiting.filter((s) => s.review).length, old = waiting.filter((s) => daysAgo(latestAt(s)) >= 3).length;
  const briefFresh = !!brief.data && (team.is_demo || (brief.data.period_start ?? '') >= mondayOf());
  const nearest = m.orgSt.nearest ? dDay(m.orgSt.nearest.event_date!) : null;
  const n = (v: number, unit: string) => <b className="text-slate-900 num">{v}{unit}</b>;
  const out: BLine[] = [];
  // 팀원의 1on1 요청 — 맥락상 중요한 것만 (나머지는 팀원관리 · 팀원 상세에서). 2일 넘게 방치되면 중요로 올린다
  const ooR = (ooReq.data ?? []).map((r) => ({ ...r, why: ooWhy(r, pi.idx.get(r.from_id), m.raw?.care?.find((c) => c.user_id === r.from_id)?.signals.map((x) => x.type) ?? [],
    members.find((x) => x.user_id === r.from_id)?.joined_at) })).filter((r) => r.why.length);
  if (ooR.length) out.push({ key: 'ooreq', tone: 'rose', icon: Users,
    text: <>{ooR.length === 1 ? <>{nameOf(ooR[0].from_id)} 님이</> : <>팀원 {n(ooR.length, '명')}이</>} 1on1을 요청했어요.</>,
    go: ooR.length === 1 ? '일정 잡기를' : '팀원관리를', to: ooR.length === 1 ? `/people/${ooR[0].from_id}?oo=1` : '/people' });
  if (m.lowGoals.length) out.push({ key: 'low', tone: 'rose', icon: ScatterChart, text: <>달성이 어려워 보이는 목표가 {n(m.lowGoals.length, '개')} 있어요.</>, go: '팀 성과를', to: '/perf' });
  if (k.blocked + k.delayed) out.push({ key: 'late', tone: k.blocked ? 'rose' : 'amber', icon: Target, text: <>업무가 늦어지고 있다는 신호가 {n(k.blocked + k.delayed, '건')} 발생했어요.</>, go: '팀목표를', to: '/goals' });
  if (high + mid) out.push({ key: 'flight', tone: high ? 'rose' : 'amber', icon: Users, text: <>이탈 신호가 보이는 팀원이 {n(high + mid, '명')} 있어요.</>, go: '팀원관리를', to: '/people' });
  if (pr.length) out.push({ key: 'decide', tone: 'agent', icon: Gavel, text: <><AteamAI />가 시급한 의사결정 {n(pr.length, '건')}을 정리했어요.</>, go: '의사결정을', to: '/decide' });
  if (adv.out?.content.advice.length) out.push({ key: 'advisor', tone: 'agent', icon: AdvisorIcon, text: <><AteamAI />가 이번 주 운영 제안 {n(adv.out.content.advice.length, '개')}를 만들었어요.</>, go: 'ATEAM AI의 제안을', to: '/advisor' });
  if (pa.out?.content.actions?.length) out.push({ key: 'pa', tone: 'agent', icon: Users, text: <><AteamAI />가 팀원별 이번 주 액션 {n(pa.out.content.actions.length, '개')}를 추천했어요.</>, go: '팀원관리를', to: '/people' });
  if (reviewed) out.push({ key: 'rev', tone: 'agent', icon: FileText, text: <><AteamAI />가 리뷰 대기 결과물 {n(reviewed, '건')}을 먼저 검토해 뒀어요.</>, go: '업무플랫폼을', to: '/work' });
  else if (waiting.length) out.push({ key: 'wait', tone: old ? 'amber' : 'slate', icon: FileText, text: <>리뷰를 기다리는 결과물이 {n(waiting.length, '건')} 있어요.</>, go: '업무플랫폼을', to: '/work' });
  if (briefFresh) out.push({ key: 'brief', tone: 'agent', icon: UserRound, text: <><AteamAI />가 이번 주 임원 브리핑을 업데이트했어요{nearest != null && nearest <= 7 ? <> · 가장 가까운 기한 {n(nearest, '')}일 남음</> : null}.</>, go: '임원 브리핑을', to: '/upward' });
  else if (m.orgSt.feed.length) out.push({ key: 'org', tone: nearest != null && nearest <= 3 ? 'amber' : 'slate', icon: UserRound, text: <>위에서 내려온 소식 {n(m.orgSt.feed.length, '건')}이 열려 있어요.</>, go: '임원 브리핑을', to: '/upward' });
  if (ooGap) out.push({ key: 'oo', tone: 'amber', icon: Users, text: <>2주 넘게 1on1을 못 한 팀원이 {n(ooGap, '명')} 있어요.</>, go: '팀원관리를', to: '/people' });
  if (k.decisionsDue) out.push({ key: 'due', tone: 'slate', icon: Gavel, text: <>결과를 기록할 결정이 {n(k.decisionsDue, '건')} 있어요.</>, go: '의사결정을', to: '/decide' });
  // 내 메모 — 남은 할 일, 한 사람에게 쌓인 메모
  const live = (notes.data ?? []).filter((x) => !(x.kind === 'todo' && x.done));
  const todos = live.filter((x) => x.kind === 'todo').length;
  if (todos) out.push({ key: 'todo', tone: 'slate', icon: StickyNote, text: <>내 메모의 할 일 {n(todos, '개')}가 남아 있어요.</>, go: '내 메모 모아보기를', to: '/notes' });
  const per = new Map<string, number>();
  for (const x of live) if (x.anchor_type === 'member' && x.anchor_id) per.set(x.anchor_id, (per.get(x.anchor_id) ?? 0) + 1);
  const top = [...per.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) out.push({ key: 'mnote', tone: 'slate', icon: StickyNote, text: <>{nameOf(top[0])} 님에 대한 메모가 {n(top[1], '개')} 쌓였어요. 다음 1on1 전에 보세요.</>, go: '팀원 상세를', to: `/people/${top[0]}` });
  return out.sort((a, b) => B_ORDER[a.tone] - B_ORDER[b.tone]);
}

function DailyBriefing({ m }: { m: HomeModel }) {
  const lines = useBriefing(m);
  const shown = lines.slice(0, 6);
  return (
    <section aria-label="Daily Briefing" className="overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-sm">
      <div className="flex items-center gap-3 flex-wrap px-4 py-3 bg-slate-900 text-white">
        <span className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Sparkles size={14} /></span>
        <span className="text-sm font-extrabold tracking-wider text-violet-300">DAILY BRIEFING</span>
        <span className="text-base font-bold tracking-tight">{m.loading ? <><AteamAI supCls="text-violet-300" />가 팀 기록을 살펴보는 중…</> : shown.length ? <><AteamAI supCls="text-violet-300" />가 팀 기록을 살펴보고 정리했어요</> : <>오늘 따로 챙길 신호가 없어요. <AteamAI supCls="text-violet-300" />가 계속 지켜보고 있어요</>}</span>
        {!m.loading && !!shown.length && <span className="ml-auto text-xs text-slate-400 num">{shown.length}건</span>}
      </div>
      {!m.loading && !!shown.length && (
        <ul className="px-4 py-3 grid md:grid-cols-2 gap-x-6 gap-y-1">
          {shown.map((l) => (
            <li key={l.key}>
              <Link to={l.to} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 -mx-2 hover:bg-slate-50 min-w-0">
                <span className={cx('w-6 h-6 rounded-md flex items-center justify-center shrink-0',
                  l.tone === 'rose' ? 'bg-rose-100 text-rose-700' : l.tone === 'amber' ? 'bg-amber-100 text-amber-700' : l.tone === 'agent' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600')}><l.icon size={13} /></span>
                <span className="text-[13px] text-slate-700 leading-snug min-w-0 truncate">{l.text} <span className="font-semibold text-violet-700 group-hover:text-violet-900 whitespace-nowrap">{aiText(l.go)} 확인하세요<ChevronRight size={12} className="inline align-[-2px]" /></span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// =====================================================================
// 섹션 칸 — 핵심 지표 3개 + AI 한두 줄
// =====================================================================
type Tone = 'rose' | 'amber' | undefined;
interface K { label: string; value: ReactNode; sub?: string; tone?: Tone; subTone?: Tone; viz?: ReactNode; under?: ReactNode }

// ── 칸 안의 작은 그래프 — 숫자 옆 한 줄 높이(28px) 안에서만 그린다. 상세 값은 마우스를 올리면 보인다.
/** 비율 하나 (x/y, %) — 링 */
function Ring({ pct, tone, title }: { pct: number | null; tone?: Tone; title?: string }) {
  const r = 10, c = 2 * Math.PI * r, p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const col = tone === 'rose' ? 'stroke-rose-500' : tone === 'amber' ? 'stroke-amber-500' : 'stroke-indigo-500';
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" className="shrink-0" role="img" aria-label={title}><title>{title}</title>
      <circle cx="13" cy="13" r={r} fill="none" strokeWidth="4" className="stroke-slate-200" />
      {pct != null && p > 0 && <circle cx="13" cy="13" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className={col}
        strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 13 13)" />}
    </svg>
  );
}
/** 몇 개 항목의 건수 비교 — 가로 막대 3줄 (숫자 한 줄 높이 안) */
function Bars({ items }: { items: { label: string; v: number }[] }) {
  const max = Math.max(1, ...items.map((x) => x.v));
  return (
    <div className="flex-1 min-w-0 flex flex-col justify-center gap-[2px]" role="img" aria-label={items.map((x) => `${x.label} ${x.v}건`).join(', ')}>
      {items.map((x) => (
        <div key={x.label} className="flex items-center gap-1 h-2" title={`${x.label} ${x.v}건`}>
          <span className="w-5 shrink-0 text-[9px] leading-none text-slate-500">{x.label}</span>
          <span className="flex-1 min-w-0 h-[6px]"><span className={cx('block h-full rounded-r-[3px]', x.v ? 'bg-indigo-400' : 'bg-slate-200')} style={{ width: x.v ? `${(x.v / max) * 100}%` : 2 }} /></span>
          <span className={cx('w-2.5 shrink-0 text-right text-[9px] leading-none num font-semibold', x.v ? 'text-slate-700' : 'text-slate-300')}>{x.v}</span>
        </div>
      ))}
    </div>
  );
}
/** 주별 추이 — 스파크라인 (마지막 점 강조) */
function Spark({ points, labels }: { points: (number | null)[]; labels: string[] }) {
  const W = 56, H = 24, n = points.length;
  const vs = points.filter((v): v is number => v != null);
  const min = Math.max(1, Math.min(...vs) - 0.4), max = Math.min(5, Math.max(...vs) + 0.4);
  const xy = points.map((v, i) => (v == null ? null : [3 + (i / Math.max(1, n - 1)) * (W - 6), H - 3 - ((v - min) / (max - min)) * (H - 6)] as const));
  const pts = xy.filter(Boolean) as (readonly [number, number])[];
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" role="img" aria-label="주별 팀 컨디션 추이">
      <title>{points.map((v, i) => `${labels[i] ?? ''} ${v == null ? '—' : v.toFixed(1)}`).join(' · ')}</title>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="stroke-indigo-400" />
      <circle cx={last[0]} cy={last[1]} r="3" strokeWidth="1.5" className="fill-indigo-600 stroke-white" />
    </svg>
  );
}
/** 사람 단위 — 팀원 한 명당 사람 모양 하나 (높음 빨강 · 주의 주황 · 안정 회색) */
function People({ items }: { items: { tone: 'rose' | 'amber' | 'slate'; title: string }[] }) {
  return (
    <div className="flex items-end gap-[2px] h-[14px] overflow-hidden" role="img" aria-label={items.map((x) => x.title).join(', ')}>
      {items.map((x, i) => (
        <svg key={i} width="11" height="13" viewBox="0 0 12 14" className={cx('shrink-0', x.tone === 'rose' ? 'fill-rose-500' : x.tone === 'amber' ? 'fill-amber-400' : 'fill-slate-200')}>
          <title>{x.title}</title><circle cx="6" cy="3.6" r="3" /><path d="M0.8 14 a5.2 5.2 0 0 1 10.4 0 Z" />
        </svg>
      ))}
    </div>
  );
}
/** 반원 게이지 — 위험(빨강)·주의(주황)·양호(초록) 구간 위에 바늘 */
function Gauge({ pct, title }: { pct: number; title: string }) {
  const W = 40, cx0 = 20, cy0 = 21, r = 16;
  const pt = (p: number, rr = r) => [cx0 - rr * Math.cos(Math.PI * p), cy0 - rr * Math.sin(Math.PI * p)] as const;
  const arc = (a: number, b: number) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`; };
  const v = Math.max(0, Math.min(100, pct)) / 100;
  const [nx, ny] = pt(v, r - 3);
  return (
    <svg width={W} height="24" viewBox={`0 0 ${W} 24`} className="shrink-0" role="img" aria-label={title}><title>{title}</title>
      <path d={arc(0, 0.35)} fill="none" strokeWidth="5" className="stroke-rose-300" />
      <path d={arc(0.36, 0.6)} fill="none" strokeWidth="5" className="stroke-amber-200" />
      <path d={arc(0.61, 1)} fill="none" strokeWidth="5" className="stroke-emerald-200" />
      <line x1={cx0} y1={cy0} x2={nx} y2={ny} strokeWidth="2" strokeLinecap="round" className="stroke-slate-700" />
      <circle cx={cx0} cy={cy0} r="2.5" className="fill-slate-700" />
    </svg>
  );
}
// 모든 칸은 같은 모양 — 색은 '상태'와 '경고 수치'에만 씁니다
const GAP_THEMES: [string, RegExp][] = [
  ['근거·데이터', /근거|데이터|수치|숫자|지표|출처|사례|검증/],
  ['결론·메시지', /결론|요약|핵심|메시지|목적|의도|주장/],
  ['일정·리스크', /일정|기한|리스크|위험|대안|변수|가정/],
  ['실행·책임', /실행|담당|책임|다음 ?단계|계획|후속|오너/],
  ['이해관계자', /고객|이해관계|합의|협의|설득|보고 대상/],
];
function workPattern(rs: AiReview[]): string | null {
  if (!rs.length) return null;
  const avg = rs.reduce((a, r) => a + (r.depth_score ?? 0), 0) / rs.length;
  const cnt = new Map<string, number>();
  for (const r of rs) for (const g of r.gaps ?? []) {
    const t = `${g.section} ${g.text}`;
    const hit = GAP_THEMES.find(([, re]) => re.test(t));
    if (hit) cnt.set(hit[0], (cnt.get(hit[0]) ?? 0) + 1);
  }
  const top = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
  const lvl = avg >= 3 ? '결과물 품질은 안정적입니다' : avg >= 2.2 ? '결과물이 실행 수준에서 멈추고 판단까지 가지 못합니다' : '결과물의 판단 깊이가 얕습니다';
  const why = top && top[1] >= 2 ? ` — 보완점이 '${top[0]}'에 반복되는 건 개인 실수보다 팀의 작성 기준이 비어 있다는 뜻입니다`
    : top ? ` — 보완점은 '${top[0]}' 쪽에 몰려 있습니다` : '';
  return `${lvl}${why} (AI 판단 깊이 평균 ${avg.toFixed(1)}/4 · ${rs.length}건).`;
}
interface Fact { label: string; meta?: string; tone?: 'rose' | 'amber' | 'emerald' | 'slate' }
const FACT_DOT = { rose: 'bg-rose-500', amber: 'bg-amber-400', emerald: 'bg-emerald-500', slate: 'bg-slate-300' } as const;
/** 주요 팩트 3줄 — 데이터가 없어도 3줄 높이를 지켜 칸 크기를 맞춘다 */
function Facts({ rows, empty }: { rows: Fact[]; empty: string }) {
  const slots = [0, 1, 2].map((i) => rows[i]);
  return (
    <ul className="px-4 mt-3 pt-2.5 border-t border-slate-100 space-y-1">
      {slots.map((f, i) => (
        <li key={i} className="h-5 flex items-center gap-2 text-xs min-w-0">
          {f ? <>
            <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', FACT_DOT[f.tone ?? 'slate'])} />
            <span className="truncate text-slate-700" title={f.label}>{f.label}</span>
            {f.meta && <span className={cx('ml-auto shrink-0 text-[11px] num', f.tone === 'rose' ? 'text-rose-600 font-semibold' : f.tone === 'amber' ? 'text-amber-700 font-semibold' : 'text-slate-400')}>{f.meta}</span>}
          </> : <span className="text-slate-300">{i === 0 && !rows.length ? empty : '—'}</span>}
        </li>
      ))}
    </ul>
  );
}

function Tile({ icon: Icon, title, status, to, kpis, facts, empty = '아직 기록이 없습니다', ai, aiLabel = 'AI', fallback }: {
  icon: typeof Target; title: string; status?: { label: string; cls: string } | null; to: string; kpis: K[];
  facts: Fact[]; empty?: string; ai?: string | null; aiLabel?: string; fallback?: string | null;
}) {
  return (
    <Link to={to} className="group relative rounded-2xl bg-white ring-1 ring-slate-900/[0.07] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md hover:ring-slate-900/[0.12] transition-all overflow-hidden flex flex-col">
      <div className="px-4 pt-3.5 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-100 text-slate-600 group-hover:bg-slate-900 group-hover:text-white transition-colors"><Icon size={15} /></span>
        <span className="font-bold tracking-tight">{title}</span>
        {status && <span className={cx('text-[10px] font-semibold border rounded-full px-1.5 py-px', status.cls)}>{status.label}</span>}
        <span className="ml-auto text-slate-300 group-hover:text-slate-600"><ChevronRight size={16} /></span>
      </div>
      <dl className="px-4 mt-2.5 grid grid-cols-3 gap-2">
        {kpis.map((k) => (
          <div key={k.label} className="min-w-0">
            <dt className="text-[10px] text-slate-500 truncate">{aiText(k.label, 'mark')}</dt>
            <dd className="h-7 flex items-center gap-2 min-w-0">
              {k.value !== '' && <span className={cx('text-xl font-bold num leading-none shrink-0', k.tone === 'rose' && 'text-rose-600', k.tone === 'amber' && 'text-amber-600')}>{k.value}</span>}
              {k.viz}
            </dd>
            {k.under ? <dd>{k.under}</dd> : <dd className={cx('text-[10px] truncate', k.subTone === 'amber' ? 'text-amber-700 font-semibold' : k.subTone === 'rose' ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{k.sub ? aiText(k.sub, 'mark') : '\u00a0'}</dd>}
          </div>
        ))}
      </dl>
      <Facts rows={facts} empty={empty} />
      <div className="mt-auto px-3 pb-3 pt-2.5">
        {ai ? (
          <div className="h-[78px] overflow-hidden rounded-lg bg-violet-50/80 ring-1 ring-violet-100 px-2.5 py-2"><p title={strip(ai)} className="text-xs leading-relaxed text-slate-700 line-clamp-3">
            <AiIcon size={11} className="text-violet-700 mr-1 align-[0px]" />{aiLabel !== 'AI' && <span className="font-semibold text-violet-700 mr-1">{aiLabel.replace(/^AI\s*/, '')}</span>}{aiText(strip(ai))}</p></div>
        ) : (
          <div className="h-[78px] overflow-hidden rounded-lg bg-slate-50 px-2.5 py-2"><p className="text-xs leading-relaxed text-slate-500 line-clamp-3">{fallback != null ? aiText(fallback) : '특별히 짚을 신호가 없습니다.'}</p></div>
        )}
      </div>
    </Link>
  );
}

function Tiles({ m }: { m: HomeModel }) {
  const { team, nameOf, members } = useTeam();
  const k = m.k;
  const st = (s: MainSection) => (m.loading ? null : STATUS_META[m.status[s]]);
  const topAi = (s: MainSection) => m.ai[s].summary || null;
  const sig = (s: 'perf' | 'people' | 'org') => m.by(s).filter((x) => x.type !== 'data')[0]?.title;
  // 사람
  const pi = usePeopleIndex(m);
  const pa = usePeopleActions(team.id, team.is_demo);
  const idx = [...pi.idx.values()];
  const high = idx.filter((x) => x.flight.level === 'risk').length, mid = idx.filter((x) => x.flight.level === 'watch').length;
  const ooGap = idx.filter((x) => ['watch', 'risk'].includes(x.indices.find((i) => i.key === 'oo')?.level ?? '')).length;
  // 의사결정
  const pr = usePriorities(m);
  const board = useBoard(team.id);
  const reviewing = board.rows.filter((r) => r.stage === 'reviewing').length;
  // 업무
  const subs = useSubmissionsAi(team.id);
  const open = (subs.data ?? []).filter(isOpenSub);
  const waiting = open.filter((s) => s.status === 'in_review');
  const old = waiting.filter((s) => daysAgo(latestAt(s)) >= 3);
  const reviewed = waiting.filter((s) => s.review);
  const pattern = workPattern((subs.data ?? []).filter((s) => s.review && daysAgo(latestAt(s)) <= 60).map((s) => s.review!));
  // 성과
  const goals = m.raw?.goals ?? [];
  const avgProg = goals.length ? Math.round(goals.reduce((a, g) => a + g.progress, 0) / goals.length) : null;
  const nearest = m.orgSt.nearest;
  const areas = (['perf', 'people', 'org'] as const).map((a) => m.riskList.filter((x) => m.by(a).includes(x)).length);

  // 주요 팩트 3줄
  const pctTone = (p: number | null | undefined) => (p == null ? 'slate' : p < 35 ? 'rose' : p < 60 ? 'amber' : 'emerald') as Fact['tone'];
  const fPerf: Fact[] = [...goals].sort((a, b) => (a.probability ?? 101) - (b.probability ?? 101)).slice(0, 3)
    .map((g) => ({ label: g.title, meta: `진척 ${g.progress}%${g.probability != null ? ` · 가능성 ${g.probability}%` : ''}`, tone: pctTone(g.probability) }));
  const due = (m.raw?.decisionsDue ?? []).filter((d) => (d.review_on ? d.review_on <= todayYmd() : daysAgo(d.decided_at) >= 30));
  const fDecide: Fact[] = [
    ...due.map((d) => ({ label: `회고 · ${d.title}`, meta: `${daysAgo(d.decided_at)}일 전 결정`, tone: 'amber' as const })),
    ...board.rows.filter((r) => r.stage === 'reviewing' || r.stage === 'promoted').map((r) => ({ label: `${r.stage === 'reviewing' ? '검토 중' : '올림'} · ${r.title}`, meta: `${daysAgo(r.updated_at)}일째`, tone: 'slate' as const })),
    ...m.recentDecisions.filter((d) => !due.some((x) => x.id === d.id)).map((d) => ({ label: `결정함 · ${d.title}`, meta: `${daysAgo(d.decided_at)}일 전`, tone: (d.outcome_rating === 'hit' ? 'emerald' : 'slate') as Fact['tone'] })),
  ].slice(0, 3);
  const AREA = { perf: '성과', people: '사람', org: '조직' } as const;
  const areaOf = (x: (typeof m.riskList)[number]) => (['perf', 'people', 'org'] as const).find((a) => m.by(a).includes(x));
  const fRisk: Fact[] = [...m.riskList].sort((a, b) => b.severity - a.severity).slice(0, 3)
    .map((x) => ({ label: x.title, meta: areaOf(x) ? AREA[areaOf(x)!] : undefined, tone: x.severity >= 3 ? 'rose' : 'amber' }));
  const fWork: Fact[] = [...waiting].sort((a, b) => latestAt(a).localeCompare(latestAt(b))).slice(0, 3)
    .map((x) => { const d = daysAgo(latestAt(x)); return { label: x.title, meta: `${nameOf(x.author_id)} · ${d === 0 ? '오늘' : `${d}일째`}`, tone: d >= 3 ? 'amber' : 'slate' }; });
  const fPeople: Fact[] = members.filter((mb) => mb.role === 'member').map((mb) => ({ mb, ix: pi.idx.get(mb.user_id) })).filter((x) => x.ix)
    .sort((a, b) => b.ix!.flight.score - a.ix!.flight.score).slice(0, 3).map(({ mb, ix }) => {
      const bad = ix!.indices.filter((i) => i.level === 'risk' || i.level === 'watch').map((i) => `${i.label} ${i.value}`);
      return { label: mb.profiles?.full_name ?? '팀원', meta: bad.slice(0, 2).join(' · ') || '특이 없음', tone: ix!.flight.level === 'risk' ? 'rose' : ix!.flight.level === 'watch' ? 'amber' : 'emerald' };
    });
  const fOrg: Fact[] = [...m.orgSt.upcoming.filter((n) => dDay(n.event_date!) >= 0), ...m.orgSt.feed.filter((n) => !n.event_date)].slice(0, 3)
    .map((n) => { const d = n.event_date ? dDay(n.event_date) : null; return { label: n.title, meta: d == null ? '열림' : d === 0 ? '오늘' : `D-${d}`, tone: d != null && d <= 3 ? 'amber' : 'slate' }; });

  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
      <Tile icon={Target} title="팀 성과" status={st('perf')} to="/goals"
        facts={fPerf} empty="목표를 세우면 목표별 진척이 보입니다"
        kpis={[
          { label: '최저 달성 가능성', value: k.goalLow, sub: `목표 ${k.goals}개 중 가장 낮은 것`, tone: k.goalLowTone,
            viz: k.goalLowNum != null ? <Gauge pct={k.goalLowNum} title={`가장 낮은 목표 달성 가능성 ${k.goalLowNum}% (35% 미만 위험 · 60% 미만 주의)`} /> : null },
          { label: '평균 진척', value: avgProg != null ? `${avgProg}%` : '—', sub: k.onPlan !== '—' ? `계획대로 ${k.onPlan}` : undefined,
            viz: avgProg != null ? <Ring pct={avgProg} title={`평균 진척 ${avgProg}%`} /> : null },
          { label: '막힘 · 지연', value: `${k.blocked}·${k.delayed}`, sub: '건', tone: k.blocked + k.delayed ? 'amber' : undefined },
        ]}
        ai={topAi('perf')} fallback={sig('perf') ? `자동 감지 · ${sig('perf')}` : null} />
      <Tile icon={Gavel} title="의사결정" status={st('decide')} to="/decide"
        facts={fDecide} empty="기록한 결정이 아직 없습니다"
        kpis={[
          { label: '결정할 것', value: pr.length, sub: '성과에 걸린 것' },
          { label: '검토 중', value: reviewing, sub: '보드' },
          { label: '결정 적중률', value: k.hitRate != null ? `${k.hitRate}%` : '—', sub: k.decisionsDue ? `회고 대기 ${k.decisionsDue}` : '회고 대기 없음', subTone: k.decisionsDue ? 'amber' : undefined,
            viz: k.hitRate != null ? <Ring pct={k.hitRate} title={`결과를 기록한 결정 ${k.rated}개 중 적중률 ${k.hitRate}%`} /> : null },
        ]}
        ai={topAi('decide')} fallback={pr[0] ? `1순위 · ${pr[0].title}` : null} />
      <Tile icon={AlertTriangle} title="리스크" status={st('risk')} to="/decide?f=risk"
        facts={fRisk} empty="지금 짚을 리스크가 없습니다"
        kpis={[
          { label: '지금 확인', value: m.bigRisks.length, sub: '가장 급한 단계', tone: m.bigRisks.length ? 'rose' : undefined },
          { label: '주의', value: m.riskList.length - m.bigRisks.length, sub: '커지기 전', tone: m.riskList.length - m.bigRisks.length ? 'amber' : undefined },
          { label: '영역별 리스크', value: '', sub: '\u00a0', viz: <Bars items={[{ label: '성과', v: areas[0] }, { label: '사람', v: areas[1] }, { label: '조직', v: areas[2] }]} /> },
        ]}
        ai={topAi('risk')} fallback={m.riskList[0] ? `자동 감지 · ${m.riskList[0].title}` : null} />
      <Tile icon={Briefcase} title="업무플랫폼" status={null} to="/work"
        facts={fWork} empty="리뷰를 기다리는 결과물이 없습니다"
        kpis={[
          { label: '열린 업무', value: open.length, sub: '팀 전체' },
          { label: '리뷰 대기', value: waiting.length, sub: old.length ? `3일 넘게 ${old.length}` : '오래된 것 없음', tone: old.length ? 'amber' : undefined },
          { label: 'AI 검토 완료', value: `${reviewed.length}/${waiting.length}`, sub: '리뷰 대기 중',
            viz: waiting.length ? <Ring pct={(reviewed.length / waiting.length) * 100} title={`리뷰 대기 ${waiting.length}건 중 AI 검토 ${reviewed.length}건`} /> : null },
        ]}
        ai={pattern} fallback={waiting.length ? '리뷰 대기 결과물을 열면 AI가 먼저 읽고 정리합니다.' : '리뷰를 기다리는 결과물이 없습니다.'} />
      <Tile icon={Users} title="팀원관리" status={st('people')} to="/people"
        facts={fPeople} empty="팀원을 초대하면 보입니다"
        kpis={[
          { label: '팀 컨디션', value: k.cond, sub: `이번 주 공유 ${k.ciThis}/${k.nMem}명 · 주별 추이`, viz: <Spark points={k.condTrend} labels={k.condWeeks} /> },
          { label: '이탈 가능성', value: <><span className={high ? 'text-rose-600' : 'text-slate-300'}>{high}</span><span className="text-slate-300 text-base mx-0.5">·</span><span className={mid ? 'text-amber-600' : 'text-slate-300'}>{mid}</span></>,
            under: <People items={members.filter((mb) => mb.role === 'member').map((mb) => ({ mb, lv: pi.idx.get(mb.user_id)?.flight.level }))
              .sort((a, b) => (b.lv === 'risk' ? 2 : b.lv === 'watch' ? 1 : 0) - (a.lv === 'risk' ? 2 : a.lv === 'watch' ? 1 : 0))
              .map(({ mb, lv }) => ({ tone: lv === 'risk' ? 'rose' as const : lv === 'watch' ? 'amber' as const : 'slate' as const, title: `${mb.profiles?.full_name ?? '팀원'} · ${lv === 'risk' ? '이탈 가능성 높음' : lv === 'watch' ? '주의' : '안정'}` }))} /> },
          { label: '1on1 공백', value: ooGap, sub: '2주 넘게', tone: ooGap ? 'amber' : undefined },
        ]}
        ai={topAi('people') ?? pa.out?.content.summary} fallback={sig('people') ? `자동 감지 · ${sig('people')}` : null} />
      <Tile icon={Building2} title="조직·전사" status={st('org')} to="/upward"
        facts={fOrg} empty="위에서 온 소식이 없습니다"
        kpis={[
          { label: '위에서 온 것', value: m.orgSt.feed.length, sub: '열린 소식' },
          { label: '영향 확인', value: `${m.orgSt.analyzed}/${m.orgSt.feed.length}`, sub: 'AI 분석', tone: m.orgSt.feed.length > m.orgSt.analyzed ? 'amber' : undefined,
            viz: m.orgSt.feed.length ? <Ring pct={(m.orgSt.analyzed / m.orgSt.feed.length) * 100} tone={m.orgSt.feed.length > m.orgSt.analyzed ? 'amber' : undefined} title={`열린 소식 ${m.orgSt.feed.length}건 중 영향 분석 ${m.orgSt.analyzed}건`} /> : null },
          { label: '다가오는 기한', value: nearest ? (dDay(nearest.event_date!) === 0 ? '오늘' : `D-${dDay(nearest.event_date!)}`) : '—', sub: nearest?.title ?? '없음' },
        ]}
        ai={topAi('org')} fallback={sig('org') ? `자동 감지 · ${sig('org')}` : null} />
    </div>
  );
}

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
    { k: '1on1', n: ooUp.length, sub: ooUp.some((o) => isToday(o.scheduled_at)) ? `오늘 ${ooUp.filter((o) => isToday(o.scheduled_at)).length}건` : '이번 주', icon: MessagesSquare, to: '/people', alert: false },
    { k: '리뷰 대기', n: rv.length, sub: rv.length ? (rv.some((r) => r.review) ? 'AI 검토 완료 있음' : 'AI 검토 전') : '없음', icon: FileText, to: '/work', alert: rv.some((r) => daysAgo(r.v?.created_at ?? r.s.created_at) >= 3) },
    { k: '내 약속', n: pr.length, sub: late.length ? `기한 지남 ${late.length}` : '기한 내', icon: CheckCircle2, to: '#', alert: late.length > 0 },
  ];
  const extras = [
    proposed && { k: `팀원 계획 승인 ${proposed}`, to: '/goals/edit?filter=proposed', icon: ListTree },
    upReq.length && { k: `상위 요청 D-${Math.max(0, Math.min(...upReq.map((n) => dDay(n.event_date!))))}`, to: '/upward', icon: ArrowUpRight },
    answered && { k: `팀원 답변 ${answered}`, to: '/settings?tab=members', icon: Inbox },
  ].filter(Boolean) as { k: string; to: string; icon: typeof Inbox }[];
  const items = [
    ...ooUp.filter((o) => isToday(o.scheduled_at)).map((o) => ({ key: o.id, node: <Link to={`/one-on-ones/${o.id}`} className="flex items-center gap-3 hover:text-indigo-700"><span className="font-mono text-xs text-teal-700 font-semibold w-11 shrink-0">{fmtTime(o.scheduled_at)}</span><span className="truncate">{nameOf(o.member_id)} 1on1</span></Link> })),
    ...rv.slice(0, 2).map(({ s }) => ({ key: s.id, node: <Link to={`/work/${s.id}`} className="flex items-center gap-3 hover:text-indigo-700"><span className="text-[11px] text-sky-700 font-semibold w-11 shrink-0">리뷰</span><span className="truncate">{s.title}</span></Link> })),
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
            <div className={cx('text-[11px]', c.alert ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{aiText(c.sub, 'mark')}</div>
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


export default function Home() {
  const { team } = useTeam();
  const [period, setPeriod] = usePeriod();
  const m = useHomeModel(period);
  const [memo, setMemo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  return (
    <div className="space-y-3">
      <Header />
      {onboardingOf(team.settings).status === 'done' && <SetupResume teamId={team.id} />}
      <DailyBriefing m={m} />
      <div className="pt-2 flex items-center gap-2 flex-wrap"><h2 className="text-[15px] font-extrabold tracking-tight text-slate-900">Managing Views</h2><span className="text-xs font-semibold text-slate-500 num">{periodRangeLabel(period)}</span>
        <span className="ml-auto"><PeriodTabs period={period} setPeriod={setPeriod} /></span></div>
      <Tiles m={m} />
      <div className="pt-4"><QuickStart teamId={team.id} /></div>
      <FloatingToday teamId={team.id} raw={m.raw} orgNotes={m.org.data?.notes ?? []} />
      <div className="h-12" aria-hidden />
      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
    </div>
  );
}
