// A·Team의 제안 — 매주 월요일, 팀 성과와 운영을 위한 참모(HR BP·컨설턴트)의 처방
//   6개 운영 레버(실행 · 인력 · 사람 · 외부 · 팀장 자신 · 운영 체계)를 빠짐없이 점검하고, 처방은 실행 경로(보드 · 요청 · 1:1 · 보고)로 바로 이어진다
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarPlus, Check, ChevronRight, ClipboardCopy, Eye, Gavel, Lock, Megaphone, RefreshCw, Send, Sparkles, Target } from 'lucide-react';
import { useTeam } from '../state/session';
import { useGenerate } from '../lib/hooks';
import { cx, daysAgo, fmtDate } from '../lib/format';
import {
  EFFORT_LABEL, LEVERS, LEVER_OF, STATE_META, STATUS_LABEL, VERDICT, adviceKey, useAdviceStatus, useAdvisor, useSelfCheck,
  type Advice, type AdviceStatus, type AdvisorOut,
} from '../lib/advisor';
import { Button, Card, Spinner, useToast } from '../components/ui';
import { ATeam, ATeamAdvice, LogoBlock } from '../components/Brand';
import { periodRange } from '../components/AiBar';
import { riskCards, useBoard, usePriorities } from '../components/decide/priorities';
import { dDay, todayYmd, useHomeModel, usePromises } from '../components/home/shared';
import { usePeopleIndex } from '../components/people/usePeopleIndex';
import { isOpenSub, latestAt, useSubmissionsAi } from '../lib/work';
import { RequestModal } from '../components/RequestModal';
import { ScheduleModal } from './OneOnOnes';

const strip = (t?: string) => (t ?? '').replace(/\s*\[E\d+\]/g, '');

export default function Advisor() {
  const { team, uid, hasFeature } = useTeam();
  const adv = useAdvisor(team.id, team.is_demo);
  const gen = useGenerate('ai-advisor', [['ai']]);
  const ai = hasFeature('ai_core');
  const shown = adv.out ?? adv.stale;
  const c = shown?.content;
  const week = shown?.period_start ?? adv.week;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <LogoBlock size={44} className="shadow-sm" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight"><ATeamAdvice /></h1>
            <p className="text-sm text-slate-500">매주 월요일 아침, 팀 성과를 올리고 팀을 잘 운영하기 위한 참모의 처방 — 6개 운영 레버를 빠짐없이 점검합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-slate-200 px-2.5 py-1.5 text-xs">
            <span className="rounded bg-slate-900 text-white px-1.5 py-px text-[10px] font-extrabold tracking-wider">WEEKLY</span>
            <span className="num font-semibold text-slate-700">{periodRange('weekly', week)}</span>
          </span>
          {ai && <Button variant={shown ? 'secondary' : 'primary'} loading={gen.isPending} onClick={() => gen.mutate({ team_id: team.id })}>
            <RefreshCw size={14} />{shown && adv.out ? '다시 받기' : '이번 주 제안 받기'}</Button>}
        </div>
      </div>

      {!ai ? (<><PicksShell><TopPicks c={null} week={week} /></PicksShell>
        <Card className="p-6 text-sm text-slate-600 flex items-center gap-2 flex-wrap"><Lock size={15} />A·Team의 제안은 Pro에서 매주 자동으로 받아 볼 수 있습니다.
          <Link to="/settings?tab=billing" className="text-indigo-700 font-semibold">요금제 보기 →</Link></Card></>
      ) : adv.loading ? <Spinner /> : !c || (!c.advice.length && !c.headline) ? <><PicksShell><TopPicks c={null} week={week} /></PicksShell><EmptyState broken={!!c} /></> : (
        <>
          {adv.stale && !adv.out && <p className="text-xs rounded-lg bg-amber-50 text-amber-800 px-3 py-2">지난주({fmtDate(adv.stale.period_start)}) 제안입니다. 이번 주 제안은 월요일 아침에 자동으로 만들어지고, '이번 주 제안 받기'로 지금 받을 수도 있습니다.</p>}
          <Hero c={c} at={shown!.created_at}><TopPicks c={c} week={week} /></Hero>
          <LeverGrid c={c} />
          <div className="grid lg:grid-cols-3 gap-5 items-start">
            <div className="lg:col-span-2"><AdviceList c={c} week={week} /></div>
            <div className="space-y-5">
              <Review c={c} prev={adv.prev?.content ?? null} prevWeek={adv.prev?.period_start ?? null} />
              <SelfCheckCard teamId={team.id} uid={uid} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** 이번 주 가장 먼저 챙길 것 — 예전 대시보드 TOP PRIORITY.
 *  결정 · 챙길 것 · 주의 세 종류를 한 순위표에 섞는다(성과 영향 × 시급성 하나의 점수). 종류마다 최소 1개는 들어가게 하고 5개까지.
 *  주간 처방(아래)이 '이번 주 무엇을 바꿀지'라면, 이건 '지금 무엇부터 손댈지'. 매일 다시 매깁니다. AI를 새로 부르지 않습니다. */
type PickKind = 'decide' | 'care' | 'watch';
interface Pick { key: string; kind: PickKind; score: number; title: string; sub?: string; action: string; to?: string; anchor?: string; ai?: boolean }
const PICK_META: Record<PickKind, { label: string; cls: string }> = {
  decide: { label: '결정', cls: 'bg-violet-500/30 text-violet-100 ring-violet-300/30' },
  care: { label: '챙길 것', cls: 'bg-sky-500/25 text-sky-100 ring-sky-300/30' },
  watch: { label: '주의', cls: 'bg-rose-500/30 text-rose-100 ring-rose-300/30' },
};
const norm = (t: string) => t.replace(/\s+/g, '').slice(0, 24);

function usePicks(c: AdvisorOut | null, week: string): { list: Pick[]; more: number; loading: boolean } {
  const { team, members, nameOf } = useTeam();
  const m = useHomeModel('weekly');
  const prio = usePriorities(m);
  const board = useBoard(team.id);
  const pi = usePeopleIndex(m);
  const subs = useSubmissionsAi(team.id);
  const promises = usePromises(team.id);
  const st = useAdviceStatus(team.id);
  const all: Pick[] = [];
  // 결정
  for (const p of prio) {
    const self = !p.to || p.to === '/advisor';
    all.push({ key: `d:${p.key}`, kind: 'decide', score: p.score, title: p.title, sub: p.impact ?? p.why, ai: p.ai,
      action: self ? '의사결정 보드에서 결정' : p.action ?? '결정하러 가기', to: self ? '/decide' : p.to });
  }
  // 챙길 것 — 위에서 온 기한, 지난 약속, 오래된 리뷰, 1:1 공백
  for (const n of m.orgSt.upcoming) {
    const d = dDay(n.event_date!);
    if (d < 0 || d > 3) continue;
    all.push({ key: `o:${n.id}`, kind: 'care', score: 192 - d * 12, title: n.title, sub: `${d === 0 ? '오늘' : `D-${d}`} · 위에서 온 ${n.kind === 'request' ? '요청' : '일정'}`, action: '임원 브리핑에서 준비', to: '/upward' });
  }
  const today = todayYmd();
  for (const a of (promises.data ?? []).filter((x) => x.due_date && x.due_date < today).slice(0, 2)) {
    const late = -dDay(a.due_date!);
    const who = a.one_on_ones?.member_id;
    all.push({ key: `p:${a.id}`, kind: 'care', score: 166 + Math.min(late, 10), title: `약속 · ${a.title}`, sub: `${late}일 지남${who ? ` · ${nameOf(who)}님과 한 약속` : ''}`, action: '챙기기', to: who ? `/people/${who}` : '/people' });
  }
  const waiting = (subs.data ?? []).filter(isOpenSub).filter((x) => x.status === 'in_review').map((x) => ({ x, d: daysAgo(latestAt(x)) })).filter((r) => r.d >= 3).sort((a, b) => b.d - a.d);
  for (const { x, d } of waiting.slice(0, 2)) all.push({ key: `r:${x.id}`, kind: 'care', score: 136 + Math.min(d, 10) * 3, title: x.title, sub: `리뷰 ${d}일째 기다리는 중 · ${nameOf(x.author_id)}`, action: '리뷰하기', to: `/work/${x.id}` });
  for (const mb of members.filter((x) => x.role === 'member')) {
    const ix = pi.idx.get(mb.user_id);
    const name = mb.profiles?.full_name ?? '팀원';
    if (ix?.indices.find((i) => i.key === 'oo')?.level === 'risk') all.push({ key: `oo:${mb.user_id}`, kind: 'care', score: 128, title: `${name}님과 1:1`, sub: '2주 넘게 1:1이 없습니다', action: '1:1 잡기', to: `/people/${mb.user_id}` });
    // 주의 — 이탈 위험이 높은 팀원
    if (ix?.flight.level === 'risk') {
      const bad = ix.indices.filter((i) => i.level === 'risk' || i.level === 'watch').map((i) => `${i.label} ${i.value}`).slice(0, 2).join(' · ');
      all.push({ key: `f:${mb.user_id}`, kind: 'watch', score: 172, title: `${name} · 이탈 가능성 높음`, sub: bad || ix.flight.note, action: '팀원 보기', to: `/people/${mb.user_id}` });
    }
  }
  // 주의 — 커지는 리스크(아직 결정으로 올리지 않은 것), 이번 주 꼭 해야 할 처방
  for (const r of riskCards(m, board).filter((x) => x.s.severity >= 3)) all.push({ key: `k:${r.key}`, kind: 'watch', score: 160 + r.s.severity * 5, title: r.s.title, sub: r.s.detail ?? '자동 감지', action: '리스크 보기', to: '/decide?f=risk' });
  for (const a of (c?.advice ?? []).filter((x) => x.urgency >= 3 && st.map.get(adviceKey(week, x.id)) !== 'done'))
    all.push({ key: `a:${a.id}`, kind: 'watch', score: 178, title: strip(a.title), sub: `이번 주 꼭 · ${LEVER_OF[a.lever]?.label ?? ''}`, action: '처방 보기', anchor: `advice-${a.id}`, ai: true });

  // 같은 내용은 하나만 (제안을 결정으로 올린 경우 등)
  const seen = new Set<string>();
  const uniq = [...all].sort((a, b) => b.score - a.score).filter((p) => { const k = norm(p.title); if (seen.has(k)) return false; seen.add(k); return true; });
  const picked: Pick[] = [];
  for (const k of ['decide', 'care', 'watch'] as PickKind[]) { const top = uniq.find((p) => p.kind === k); if (top) picked.push(top); }
  for (const p of uniq) { if (picked.length >= 5) break; if (!picked.includes(p)) picked.push(p); }
  return { list: picked.sort((a, b) => b.score - a.score), more: Math.max(0, uniq.length - picked.length), loading: m.loading };
}

function TopPicks({ c, week }: { c: AdvisorOut | null; week: string }) {
  const { list, more, loading } = usePicks(c, week);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return (
    <div>
      <div className="flex items-end gap-2 flex-wrap">
        <span className="text-[15px] font-bold tracking-tight">이번 주 가장 먼저 챙길 것</span>
        <span className="text-xs text-slate-400">결정 · 챙길 것 · 주의를 한 순위로 · 성과 영향과 시급성 순 · 에이전트가 매일 다시 매깁니다</span>
        <Link to="/decide" className="ml-auto text-xs font-semibold text-violet-200 hover:text-white inline-flex items-center">의사결정 보드{more ? ` (+${more})` : ''}<ChevronRight size={13} /></Link>
      </div>
      {loading ? <p className="mt-3 text-sm text-slate-400">팀 기록을 살펴보는 중…</p> : !list.length ? <p className="mt-3 text-sm text-slate-300">지금 따로 챙길 것이 없습니다.</p> : (
        <ol className="mt-2.5 space-y-1">
          {list.map((p, i) => {
            const meta = PICK_META[p.kind];
            const inner = (<>
              <span className={cx('w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold num shrink-0', i === 0 ? 'bg-white text-slate-900' : 'bg-white/10 text-slate-200')}>{i + 1}</span>
              <span className={cx('w-[54px] text-center text-[11px] font-semibold rounded-full py-0.5 ring-1 whitespace-nowrap', meta.cls)}>{meta.label}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 min-w-0"><span className="text-[14px] font-semibold text-white truncate">{p.title}</span>{p.ai && <Sparkles size={11} className="shrink-0 text-violet-300" />}</span>
                {p.sub && <span className="block text-xs text-slate-300 truncate">{strip(p.sub)}</span>}
              </span>
              <span className="text-xs font-semibold text-violet-200 group-hover:text-white whitespace-nowrap inline-flex items-center">{p.action}<ChevronRight size={13} /></span>
            </>);
            const cls = 'group grid grid-cols-[24px_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-white/[0.07]';
            return <li key={p.key}>{p.anchor
              ? <a href={`#${p.anchor}`} onClick={(e) => { e.preventDefault(); go(p.anchor!); }} className={cls}>{inner}</a>
              : <Link to={p.to ?? '/decide'} className={cls}>{inner}</Link>}</li>;
          })}
        </ol>
      )}
    </div>
  );
}

function EmptyState({ broken }: { broken?: boolean }) {
  return (
    <Card className="p-6">
      {broken && <p className="mb-3 text-xs rounded-lg bg-amber-50 text-amber-800 px-3 py-2">이번 AI 응답이 중간에 끊겨 제안을 읽지 못했습니다. '다시 받기'를 한 번 더 눌러 주세요.</p>}
      <p className="text-sm text-slate-600 leading-relaxed">이번 주 제안이 아직 없습니다. 매주 월요일 아침 자동으로 만들어지고, 위의 '이번 주 제안 받기'로 지금 받을 수도 있습니다.<br />
        팀 신호 · AI 인사이트 · 팀원관리 액션 · 미결 결정 · 위에서 온 것 · 팀장 시간 배분을 함께 보고, 아래 6개 레버마다 상태와 처방을 냅니다.</p>
      <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {LEVERS.map((l) => <div key={l.key} className="rounded-xl bg-slate-50 px-3 py-2.5 flex items-center gap-2"><l.icon size={15} className="text-slate-500" /><span className="text-sm font-semibold">{l.label}</span><span className="text-[11px] text-slate-400 truncate">{l.hint}</span></div>)}
      </div>
    </Card>
  );
}

function Hero({ c, at, children }: { c: AdvisorOut; at: string; children?: ReactNode }) {
  const urgent = c.advice.filter((a) => a.urgency >= 3).length;
  const acts = LEVERS.filter((l) => c.levers[l.key]?.state === 'act').length;
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white p-5 sm:p-6 shadow-[0_18px_40px_-24px_rgba(30,27,75,0.9)]">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_-20%,rgba(129,140,248,0.28),transparent_50%)]" />
      <div className="relative grid md:grid-cols-[1fr_auto] gap-5 items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-indigo-200"><span><ATeam className="text-[12px] text-white" />의 이번 주 총평</span><span className="font-normal text-slate-400">· {fmtDate(at)}</span></div>
          <p className="mt-2 text-xl sm:text-[22px] font-bold leading-snug tracking-tight">{strip(c.headline)}</p>
          {c.focus && <p className="mt-3 text-sm text-slate-200 flex gap-2"><Target size={15} className="mt-0.5 shrink-0 text-rose-300" /><span><b className="text-white mr-1">성과에 가장 크게 걸린 것</b>{strip(c.focus)}</span></p>}
          {c.watch_next && <p className="mt-1.5 text-xs text-slate-400 flex gap-2"><Eye size={13} className="mt-0.5 shrink-0" />다음 주에 지켜볼 것 · {strip(c.watch_next)}</p>}
        </div>
        <dl className="grid grid-cols-3 md:grid-cols-1 gap-2 md:w-36">
          {[['처방', c.advice.length], ['이번 주 꼭', urgent], ['조치 필요 레버', acts]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl bg-white/[0.07] ring-1 ring-white/10 px-3 py-2"><dt className="text-[10px] text-slate-400">{l}</dt><dd className="text-xl font-bold num">{v}</dd></div>
          ))}
        </dl>
      </div>
      {children && <div className="relative mt-5 pt-4 border-t border-white/10">{children}</div>}
    </section>
  );
}

/** 주간 처방이 없을 때(무료·미생성) '가장 먼저 챙길 것'만 같은 어두운 판에 */
function PicksShell({ children }: { children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white p-5 sm:p-6">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_-20%,rgba(129,140,248,0.28),transparent_50%)]" />
      <div className="relative">{children}</div>
    </section>
  );
}

function LeverGrid({ c }: { c: AdvisorOut }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2"><span className="font-semibold">운영 레버 점검</span><span className="text-xs text-slate-400">6개 영역을 매주 빠짐없이 — 조언이 없는 레버도 상태를 표시합니다</span></div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {LEVERS.map((l) => {
          const v = c.levers[l.key];
          const st = STATE_META[v?.state ?? 'good'];
          const n = c.advice.filter((a) => a.lever === l.key).length;
          return (
            <div key={l.key} className={cx('rounded-xl bg-white ring-1 ring-slate-900/[0.07] border-t-[3px] p-3 flex flex-col', st.bar)}>
              <div className="flex items-center gap-1.5"><l.icon size={15} className="text-slate-500 shrink-0" /><span className="text-sm font-bold truncate">{l.label}</span></div>
              <div className="mt-1.5 flex items-center gap-1.5"><span className={cx('text-[10px] font-bold rounded-full px-1.5 py-px ring-1', st.cls)}>{v ? st.label : '판단 없음'}</span>{n > 0 && <span className="text-[10px] text-slate-400">처방 {n}</span>}</div>
              <p className="mt-1.5 text-xs text-slate-600 leading-relaxed line-clamp-3" title={strip(v?.note)}>{strip(v?.note) || '이번 주 특이 신호가 없습니다.'}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdviceList({ c, week }: { c: AdvisorOut; week: string }) {
  const { team } = useTeam();
  const st = useAdviceStatus(team.id);
  const board = useBoard(team.id);
  const toast = useToast();
  const [modal, setModal] = useState<{ kind: 'req' | 'oo'; a: Advice } | null>(null);
  const list = [...c.advice].sort((a, b) => b.urgency - a.urgency);
  const statusOf = (a: Advice) => st.map.get(adviceKey(week, a.id));
  const setStatus = (a: Advice, s: AdviceStatus | null) => st.set.mutate({ key: adviceKey(week, a.id), status: s });
  const adopt = (a: Advice) => { if (!statusOf(a)) setStatus(a, 'adopted'); };
  const copy = (a: Advice, msg: string) => { navigator.clipboard?.writeText(strip(a.script)); toast(msg); adopt(a); };
  const onBoard = (a: Advice) => board.map.get(`advice:${week}:${a.id}`);
  const toBoard = (a: Advice) => board.set.mutate({ key: `advice:${week}:${a.id}`, title: strip(a.title), stage: 'promoted', note: strip(a.why) }, { onSuccess: () => { toast('의사결정 보드의 \'결정할 것\'에 올렸습니다.'); adopt(a); } });

  const action = (a: Advice): ReactNode => {
    switch (a.route) {
      case 'decide': return onBoard(a)
        ? <Link to="/decide" className="text-xs font-semibold rounded-lg px-2.5 py-1.5 bg-slate-100 text-slate-700 inline-flex items-center gap-1"><Gavel size={13} />보드에 올라감<ArrowRight size={12} /></Link>
        : <Button size="sm" onClick={() => toBoard(a)}><Gavel size={13} />의사결정 보드에 올리기</Button>;
      case 'request': return <Button size="sm" onClick={() => setModal({ kind: 'req', a })}><Send size={13} />요청 보내기</Button>;
      case 'one_on_one': return <Button size="sm" onClick={() => setModal({ kind: 'oo', a })}><CalendarPlus size={13} />1:1 잡기</Button>;
      case 'report': return <><Button size="sm" onClick={() => copy(a, '보고 문장을 복사했습니다')} disabled={!a.script}><Megaphone size={13} />보고 문장 복사</Button>
        <Link to="/upward" className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-0.5">임원 브리핑<ArrowRight size={12} /></Link></>;
      case 'calendar': return a.script ? <Button size="sm" variant="secondary" onClick={() => copy(a, '공지 문장을 복사했습니다')}><ClipboardCopy size={13} />공지 문장 복사</Button> : null;
      default: return null;
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <span className="font-semibold">이번 주 처방</span><span className="text-xs text-slate-400">성과에 미치는 영향이 큰 순 · 채택·보류·완료를 남기면 다음 주에 결과를 회고합니다</span>
      </div>
      {!list.length && <p className="px-4 py-5 text-sm text-amber-800 bg-amber-50/60">이번 AI 응답에 처방이 빠져 있습니다(응답이 중간에 끊겼을 수 있습니다). 위의 '다시 받기'를 한 번 더 눌러 주세요.</p>}
      <ol className="divide-y divide-slate-100">
        {list.map((a, i) => {
          const L = LEVER_OF[a.lever] ?? LEVER_OF.exec;
          const s = statusOf(a);
          return (
            <li key={a.id} id={`advice-${a.id}`} className={cx('px-4 py-4 flex gap-3 scroll-mt-24', s === 'done' && 'bg-slate-50/70')}>
              <span className="w-7 h-7 rounded-lg bg-slate-900 text-white text-xs font-bold num flex items-center justify-center shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 font-bold px-2 py-0.5"><L.icon size={11} />{L.label}</span>
                  {a.urgency >= 3 && <span className="rounded bg-rose-500 text-white font-bold px-1.5 py-px">이번 주 꼭</span>}
                  <span className="text-slate-400">부담 {EFFORT_LABEL[a.effort] ?? '보통'}</span>
                  {s && <span className={cx('ml-auto rounded-full px-2 py-0.5 font-bold', s === 'done' ? 'bg-emerald-50 text-emerald-700' : s === 'held' ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-700')}>{STATUS_LABEL[s]}</span>}
                </div>
                <p className={cx('mt-1.5 text-[15px] font-bold leading-snug', s === 'done' && 'text-slate-500 line-through decoration-slate-300')}>{strip(a.title)}</p>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed"><span className="font-semibold text-violet-700 mr-1">근거</span>{strip(a.why)}</p>
                {(a.effect || a.if_not) && (
                  <div className="mt-2 grid sm:grid-cols-2 gap-2 text-xs leading-relaxed">
                    {a.effect && <div className="rounded-lg bg-emerald-50/70 px-2.5 py-2 text-emerald-900"><b className="mr-1">하면</b>{strip(a.effect)}</div>}
                    {a.if_not && <div className="rounded-lg bg-rose-50/70 px-2.5 py-2 text-rose-900"><b className="mr-1">안 하면</b>{strip(a.if_not)}</div>}
                  </div>
                )}
                {a.script && <div className="mt-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-sm text-slate-700 leading-relaxed">“{strip(a.script)}”</div>}
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  {action(a)}
                  <div className="ml-auto inline-flex rounded-lg bg-slate-100 p-0.5 text-xs">
                    {(['adopted', 'held', 'done'] as AdviceStatus[]).map((k) => (
                      <button key={k} onClick={() => setStatus(a, s === k ? null : k)}
                        className={cx('px-2 py-1 rounded-md inline-flex items-center gap-0.5', s === k ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-500 hover:text-slate-800')}>
                        {k === 'done' && <Check size={11} />}{STATUS_LABEL[k]}</button>
                    ))}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {modal?.kind === 'req' && <RequestModal open onClose={() => setModal(null)} toId={modal.a.target_user_id || null} defaultKind="other"
        defaultTitle={strip(modal.a.script || modal.a.title)} onSent={() => adopt(modal.a)} />}
      {modal?.kind === 'oo' && <ScheduleModal open onClose={() => { adopt(modal.a); setModal(null); }} memberId={modal.a.target_user_id || null} />}
    </Card>
  );
}

function Review({ c, prev, prevWeek }: { c: AdvisorOut; prev: AdvisorOut | null; prevWeek: string | null }) {
  const { team } = useTeam();
  const st = useAdviceStatus(team.id);
  const rows = c.review?.length ? c.review : (prev?.advice ?? []).map((a) => ({ id: a.id, title: a.title, verdict: 'unknown' as const, observed: '' }));
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-100"><span className="font-semibold">지난주 제안 회고</span>
        <span className="ml-2 text-xs text-slate-400">{prevWeek ? `${periodRange('weekly', prevWeek)} · ` : ''}팀장의 선택 → 기록으로 본 결과</span></div>
      {!rows.length ? <p className="px-4 py-4 text-sm text-slate-400">지난주 제안이 없습니다. 다음 주부터 이번 주 처방의 실행과 효과를 여기서 돌아봅니다.</p> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => {
            const mine = prevWeek ? st.map.get(adviceKey(prevWeek, r.id)) : undefined;
            const v = VERDICT[r.verdict] ?? VERDICT.unknown;
            return (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-slate-400">팀장</span><span className="font-bold text-slate-600">{mine ? STATUS_LABEL[mine] : '표시 없음'}</span>
                  <ArrowRight size={10} className="text-slate-300" /><span className={cx('rounded-full px-1.5 py-px font-bold', v.cls)}>{v.label}</span>
                </div>
                <p className="mt-1 text-sm font-semibold leading-snug">{strip(r.title)}</p>
                {r.observed && <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">{strip(r.observed)}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SelfCheckCard({ teamId, uid }: { teamId: string; uid: string }) {
  const sc = useSelfCheck(teamId, uid);
  const [energy, setEnergy] = useState<number | null>(null);
  const [burden, setBurden] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const e = energy ?? sc.current?.energy ?? null, b = burden ?? sc.current?.burden ?? null, n = note ?? sc.current?.note ?? '';
  const last = sc.rows.find((r) => r.week_start < sc.week);
  const Scale = ({ label, lo, hi, v, set }: { label: string; lo: string; hi: string; v: number | null; set: (x: number) => void }) => (
    <div>
      <div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-700">{label}</span><span className="text-[10px] text-slate-400">{lo} ↔ {hi}</span></div>
      <div className="mt-1 grid grid-cols-5 gap-1">{[1, 2, 3, 4, 5].map((x) => (
        <button key={x} type="button" onClick={() => set(x)} className={cx('h-8 rounded-lg text-sm font-bold num', v === x ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>{x}</button>
      ))}</div>
    </div>
  );
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2"><span className="font-semibold">이번 주 나의 상태</span><span className="text-[10px] rounded-full bg-slate-100 text-slate-500 px-1.5 py-px inline-flex items-center gap-0.5"><Lock size={9} />팀장 본인만</span></div>
      <p className="mt-0.5 text-xs text-slate-500">10초면 됩니다. '팀장 자신' 레버의 처방이 기록만이 아니라 지금 상태를 반영합니다.</p>
      <div className="mt-3 space-y-3">
        <Scale label="에너지" lo="바닥" hi="충분" v={e} set={setEnergy} />
        <Scale label="부담" lo="가벼움" hi="버거움" v={b} set={setBurden} />
        <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="한 줄 메모 (선택) — 예: 런칭·제휴가 겹쳐 리뷰가 밀림" value={n} onChange={(ev) => setNote(ev.target.value)} />
        <div className="flex items-center gap-2">
          <Button size="sm" loading={sc.save.isPending} disabled={e == null && b == null} onClick={() => sc.save.mutate({ energy: e, burden: b, note: n })}>{sc.current ? '고치기' : '남기기'}</Button>
          {last && <span className="text-[11px] text-slate-400">지난주 에너지 {last.energy ?? '-'} · 부담 {last.burden ?? '-'}</span>}
        </div>
      </div>
    </Card>
  );
}
