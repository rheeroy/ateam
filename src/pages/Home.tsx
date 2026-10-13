// 팀장 홈 — 스크롤 없이 한눈에: TOP PRIORITY(최상단) → 섹션 6칸(핵심 지표 + AI 한두 줄)
// 색: 섹션 정체성 성과 indigo · 사람 teal · 의사결정 slate · 리스크 rose · 조직 fuchsia · 업무 sky / 상태는 rose·amber·emerald, 항상 글자와 함께.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowUpRight, Briefcase, Building2, CalendarCheck, CheckCircle2, ChevronRight, Circle, ClipboardList, FileText, Gavel,
  Inbox, ListTree, MessagesSquare, Sparkles, StickyNote, Target, Users, X,
} from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { OrgNote } from '../lib/types';
import { cx, daysAgo, fmtDate, fmtTime } from '../lib/format';
import type { Raw } from '../lib/insights';
import { isOpenSub, latestAt, useSubmissionsAi, type AiReview } from '../lib/work';
import { usePeopleActions } from '../lib/peopleActions';
import { LEVER_OF, LEVERS, STATE_META, useAdvisor } from '../lib/advisor';
import { ATeamAdvice, LogoBlock } from '../components/Brand';
import { usePeopleIndex } from '../components/people/usePeopleIndex';
import { useBoard, usePriorities, type Prio } from '../components/decide/priorities';
import {
  MemoModal, OrgNoteModal, PeriodTabs, QuickStart, STATUS_META, Sparkline,
  dDay, isToday, todayYmd, useAnsweredRequests, useHomeModel, usePeriod, usePromises, useReviewQueue, useWeekOneOnOnes,
  type HomeModel, type MainSection,
} from '../components/home/shared';

const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');

function Header({ onMemo, onOrg }: { onMemo: () => void; onOrg: () => void }) {
  const { profile } = useTeam();
  const now = new Date();
  const hello = now.getHours() < 11 ? '좋은 아침입니다' : now.getHours() < 18 ? '안녕하세요' : '오늘도 수고 많으셨습니다';
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0 flex items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight">{hello}, {profile?.full_name} 팀장님</h1>
        <span className="text-sm text-slate-500">{fmtDate(now.toISOString(), true)}</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={onMemo} className="text-sm rounded-xl px-3 py-1.5 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><StickyNote size={15} />관찰 메모</button>
        <button onClick={onOrg} className="text-sm rounded-xl px-3 py-1.5 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Building2 size={15} />위에서 온 것</button>
        <Link to="/report" className="text-sm font-semibold rounded-xl px-3 py-1.5 bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5"><ClipboardList size={15} />주간보고 초안</Link>
      </div>
    </div>
  );
}

// =====================================================================
// ① 팀 성과 — 대시보드 (작은 그래프 카드)
// =====================================================================

// =====================================================================
// TOP PRIORITY — 최상단, 낮게
// =====================================================================
function TopPriority({ m, period, setPeriod }: { m: HomeModel; period: 'daily' | 'weekly' | 'monthly'; setPeriod: (p: 'daily' | 'weekly' | 'monthly') => void }) {
  const all = usePriorities(m);
  const list = all.slice(0, 3);
  return (
    <section aria-label="Top Priority" className="relative overflow-hidden rounded-2xl bg-slate-950 text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(124,58,237,0.45),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(79,70,229,0.25),transparent_50%)]" />
      <div className="relative p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center shrink-0"><Sparkles size={14} /></span>
          <span className="text-[11px] font-bold tracking-wide text-violet-300">TOP PRIORITY</span>
          <span className="text-sm font-semibold">{m.loading ? '팀 기록을 살펴보는 중…' : list.length ? '최우선으로 챙겨야 할 것들' : '지금 판단이 필요한 큰 결정은 없습니다'}</span>
          {all.length > 3 && <Link to="/decide" className="text-xs text-violet-300 hover:text-white inline-flex items-center">+{all.length - 3} 의사결정 보드<ChevronRight size={12} /></Link>}
          <span className="ml-auto"><PeriodTabs period={period} setPeriod={setPeriod} dark /></span>
        </div>
        {!m.loading && !!list.length && (
          <div className="mt-3 grid md:grid-cols-3 gap-2.5">{list.map((p, i) => <PrioMini key={p.key} p={p} rank={i + 1} />)}</div>
        )}
      </div>
    </section>
  );
}
function PrioMini({ p, rank }: { p: Prio; rank: number }) {
  const top = rank === 1;
  return (
    <Link to={p.to ?? '/decide'} className={cx('group rounded-xl p-3 ring-1 flex flex-col min-w-0 transition-colors', top ? 'bg-gradient-to-br from-violet-500/30 to-indigo-500/10 ring-violet-300/40 hover:from-violet-500/40' : 'bg-white/[0.06] ring-white/10 hover:bg-white/[0.1]')}>
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className={cx('font-bold rounded-full px-1.5 py-px', top ? 'bg-white text-slate-900' : 'bg-white/10 text-white/80')}>{rank}순위</span>
        <span className="text-slate-300 font-semibold">{p.kind}</span>
        {p.ai && <span className="text-violet-300 inline-flex items-center gap-0.5"><Sparkles size={9} />AI</span>}
      </div>
      <div className="mt-1.5 text-[14px] font-bold leading-snug line-clamp-2">{p.title}</div>
      {(p.impact || p.why) && <div className="mt-1 text-[11px] text-slate-400 line-clamp-1">{p.impact ? <b className="text-violet-300 font-semibold mr-1">효과</b> : null}{p.impact ?? p.why}</div>}
      <div className="mt-auto pt-2 text-[11px] font-semibold text-violet-200 group-hover:text-white inline-flex items-center gap-0.5 truncate">{p.action ?? '결정하러 가기'}<ChevronRight size={12} /></div>
    </Link>
  );
}

// =====================================================================
// 섹션 칸 — 핵심 지표 3개 + AI 한두 줄
// =====================================================================
type Tone = 'rose' | 'amber' | undefined;
interface K { label: string; value: ReactNode; sub?: string; tone?: Tone }
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
function Tile({ icon: Icon, title, status, to, kpis, ai, aiLabel = 'AI', fallback, viz }: {
  icon: typeof Target; title: string; status?: { label: string; cls: string } | null; to: string; kpis: K[];
  ai?: string | null; aiLabel?: string; fallback?: string | null; viz?: ReactNode;
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
            <dt className="text-[10px] text-slate-500 truncate">{k.label}</dt>
            <dd className={cx('text-xl font-bold num leading-tight', k.tone === 'rose' && 'text-rose-600', k.tone === 'amber' && 'text-amber-600')}>{k.value}</dd>
            {k.sub && <dd className="text-[10px] text-slate-400 truncate">{k.sub}</dd>}
          </div>
        ))}
      </dl>
      {viz && <div className="px-4 mt-1">{viz}</div>}
      <div className="mt-auto px-3 pb-3 pt-2.5">
        {ai ? (
          <div className="rounded-lg bg-violet-50/80 ring-1 ring-violet-100 px-2.5 py-2"><p title={strip(ai)} className="text-xs leading-relaxed text-slate-700 line-clamp-3">
            <Sparkles size={11} className="inline align-[-1px] text-violet-700 mr-0.5" /><span className="font-semibold text-violet-700 mr-1">{aiLabel}</span>{strip(ai)}</p></div>
        ) : (
          <div className="rounded-lg bg-slate-50 px-2.5 py-2"><p className="text-xs leading-relaxed text-slate-500 line-clamp-2">{fallback ?? '특별히 짚을 신호가 없습니다.'}</p></div>
        )}
      </div>
    </Link>
  );
}

function Tiles({ m }: { m: HomeModel }) {
  const { team } = useTeam();
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

  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
      <Tile icon={Target} title="팀 성과" status={st('perf')} to="/goals"
        kpis={[
          { label: '최저 달성 가능성', value: k.goalLow, sub: `목표 ${k.goals}개`, tone: k.goalLowTone },
          { label: '평균 진척', value: avgProg != null ? `${avgProg}%` : '—', sub: k.onPlan !== '—' ? `계획대로 ${k.onPlan}` : undefined },
          { label: '막힘 · 지연', value: `${k.blocked}·${k.delayed}`, sub: '건', tone: k.blocked + k.delayed ? 'amber' : undefined },
        ]}
        ai={topAi('perf')} fallback={sig('perf') ? `자동 감지 · ${sig('perf')}` : null} />
      <Tile icon={Users} title="팀원관리" status={st('people')} to="/people"
        kpis={[
          { label: '팀 컨디션', value: k.cond, sub: `체크인 ${k.ciThis}/${k.nMem}` },
          { label: '이탈 가능성', value: `${high}·${mid}`, sub: '높음·주의', tone: high ? 'rose' : mid ? 'amber' : undefined },
          { label: '1:1 공백', value: ooGap, sub: '2주 넘게', tone: ooGap ? 'amber' : undefined },
        ]}
        viz={<Sparkline points={k.condTrend} labels={k.condWeeks} tone="slate" w={300} h={18} />}
        ai={topAi('people') ?? pa.out?.content.summary} fallback={sig('people') ? `자동 감지 · ${sig('people')}` : null} />
      <Tile icon={Gavel} title="의사결정" status={st('decide')} to="/decide"
        kpis={[
          { label: '결정할 것', value: pr.length, sub: '성과에 걸린 것' },
          { label: '검토 중', value: reviewing, sub: '보드' },
          { label: '회고 대기', value: k.decisionsDue, sub: k.hitRate != null ? `적중률 ${k.hitRate}%` : '결과 기록', tone: k.decisionsDue ? 'amber' : undefined },
        ]}
        ai={topAi('decide')} fallback={pr[0] ? `1순위 · ${pr[0].title}` : null} />
      <Tile icon={AlertTriangle} title="리스크" status={st('risk')} to="/decide?f=risk"
        kpis={[
          { label: '지금 확인', value: m.bigRisks.length, sub: '가장 급한 단계', tone: m.bigRisks.length ? 'rose' : undefined },
          { label: '주의', value: m.riskList.length - m.bigRisks.length, sub: '커지기 전', tone: m.riskList.length - m.bigRisks.length ? 'amber' : undefined },
          { label: '성과·사람·조직', value: areas.join('·'), sub: '영역별' },
        ]}
        ai={topAi('risk')} fallback={m.riskList[0] ? `자동 감지 · ${m.riskList[0].title}` : null} />
      <Tile icon={Briefcase} title="업무플랫폼" status={null} to="/work"
        kpis={[
          { label: '열린 업무', value: open.length, sub: '팀 전체' },
          { label: '리뷰 대기', value: waiting.length, sub: old.length ? `3일 넘게 ${old.length}` : '오래된 것 없음', tone: old.length ? 'amber' : undefined },
          { label: 'AI 검토 완료', value: `${reviewed.length}/${waiting.length}`, sub: '리뷰 대기 중' },
        ]}
        ai={pattern} fallback={waiting.length ? '리뷰 대기 결과물을 열면 AI가 먼저 읽고 정리합니다.' : '리뷰를 기다리는 결과물이 없습니다.'} />
      <Tile icon={Building2} title="조직·전사" status={st('org')} to="/brief/org"
        kpis={[
          { label: '위에서 온 것', value: m.orgSt.feed.length, sub: '열린 소식' },
          { label: '영향 확인', value: `${m.orgSt.analyzed}/${m.orgSt.feed.length}`, sub: 'AI 분석', tone: m.orgSt.feed.length > m.orgSt.analyzed ? 'amber' : undefined },
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
    { k: '1:1', n: ooUp.length, sub: ooUp.some((o) => isToday(o.scheduled_at)) ? `오늘 ${ooUp.filter((o) => isToday(o.scheduled_at)).length}건` : '이번 주', icon: MessagesSquare, to: '/people', alert: false },
    { k: '리뷰 대기', n: rv.length, sub: rv.length ? (rv.some((r) => r.review) ? 'AI 검토 완료 있음' : 'AI 검토 전') : '없음', icon: FileText, to: '/work', alert: rv.some((r) => daysAgo(r.v?.created_at ?? r.s.created_at) >= 3) },
    { k: '내 약속', n: pr.length, sub: late.length ? `기한 지남 ${late.length}` : '기한 내', icon: CheckCircle2, to: '#', alert: late.length > 0 },
  ];
  const extras = [
    proposed && { k: `팀원 계획 승인 ${proposed}`, to: '/goals/edit?filter=proposed', icon: ListTree },
    upReq.length && { k: `상위 요청 D-${Math.max(0, Math.min(...upReq.map((n) => dDay(n.event_date!))))}`, to: '/brief/org', icon: ArrowUpRight },
    answered && { k: `팀원 답변 ${answered}`, to: '/settings?tab=members', icon: Inbox },
  ].filter(Boolean) as { k: string; to: string; icon: typeof Inbox }[];
  const items = [
    ...ooUp.filter((o) => isToday(o.scheduled_at)).map((o) => ({ key: o.id, node: <Link to={`/one-on-ones/${o.id}`} className="flex items-center gap-3 hover:text-indigo-700"><span className="font-mono text-xs text-teal-700 font-semibold w-11 shrink-0">{fmtTime(o.scheduled_at)}</span><span className="truncate">{nameOf(o.member_id)} 1:1</span></Link> })),
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


/** A·Team의 제안 한 줄 — 이번 주 처방 1순위 + 조치 필요 레버 */
function AdviceStrip() {
  const { team, hasFeature } = useTeam();
  const adv = useAdvisor(team.id, team.is_demo);
  if (!hasFeature('ai_core') || adv.loading) return null;
  const c = adv.out?.content;
  const top = c ? [...c.advice].sort((a, b) => b.urgency - a.urgency)[0] : null;
  const acts = c ? LEVERS.filter((l) => c.levers[l.key]?.state === 'act') : [];
  return (
    <Link to="/advisor" className="group flex items-center gap-3 rounded-xl bg-white ring-1 ring-slate-900/[0.07] px-4 py-2.5 hover:ring-slate-900/[0.15] hover:shadow-sm transition-all">
      <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-slate-900"><LogoBlock size={22} /><ATeamAdvice /></span>
      {top ? (
        <>
          <span className="shrink-0 text-[10px] font-bold rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5">{LEVER_OF[top.lever]?.label}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{strip(top.title)}</span>
          <span className="hidden lg:flex items-center gap-1 shrink-0">{acts.map((l) => <span key={l.key} className={cx('text-[10px] font-bold rounded-full px-1.5 py-px ring-1', STATE_META.act.cls)}>{l.label}</span>)}</span>
          <span className="shrink-0 text-xs text-slate-400">처방 {c!.advice.length}건</span>
        </>
      ) : <span className="min-w-0 flex-1 truncate text-sm text-slate-500">이번 주 운영 처방이 아직 없습니다 — 월요일 아침에 자동으로 만들어지고, 지금 받을 수도 있습니다.</span>}
      <ChevronRight size={16} className="shrink-0 text-slate-300 group-hover:text-slate-600" />
    </Link>
  );
}

export default function Home() {
  const { team } = useTeam();
  const [period, setPeriod] = usePeriod();
  const m = useHomeModel(period);
  const [memo, setMemo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  const [orgOpen, setOrgOpen] = useState(false);
  return (
    <div className="space-y-3">
      <Header onMemo={() => setMemo({ open: true, who: null })} onOrg={() => setOrgOpen(true)} />
      <TopPriority m={m} period={period} setPeriod={setPeriod} />
      <AdviceStrip />
      <Tiles m={m} />
      <div className="pt-4"><QuickStart teamId={team.id} /></div>
      <FloatingToday teamId={team.id} raw={m.raw} orgNotes={m.org.data?.notes ?? []} />
      <div className="h-12" aria-hidden />
      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
      <OrgNoteModal teamId={team.id} open={orgOpen} onClose={() => setOrgOpen(false)} />
    </div>
  );
}
