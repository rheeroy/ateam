// 팀원관리 — 구성원 컨디션 · 1:1 면담 · 육성 · 이탈 신호 · 구성원 설정을 한곳에서
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, CalendarPlus, CheckCircle2, ChevronRight, HeartPulse, MessageSquare, Send, Sprout, StickyNote, UserCog, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { useTeamMembersOnly } from '../lib/hooks';
import { cx, daysAgo, fmtShort } from '../lib/format';
import { useJudgmentScores, useObservations, useOneOnOneMap, trendOf } from '../lib/people';
import { Avatar, Card, Spinner } from '../components/ui';
import { AiBar, AiChip } from '../components/AiBar';
import { RequestModal } from '../components/RequestModal';
import {
  MemoModal, PeriodTabs, SignalList, Sparkline, STATUS_META, sectionsOf, useHomeModel, usePeriod, useSignalAct, type HomeModel, type InsightItem,
} from '../components/home/shared';
import OneOnOnes, { ScheduleModal } from './OneOnOnes';
import TeamPage from './Team';

type Tab = 'board' | '1on1' | 'growth' | 'risk' | 'members';
const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'board', label: '팀원 보드', icon: Users },
  { id: '1on1', label: '1:1 면담', icon: MessageSquare },
  { id: 'growth', label: '육성', icon: Sprout },
  { id: 'risk', label: '이탈·리스크', icon: HeartPulse },
  { id: 'members', label: '구성원·초대', icon: UserCog },
];
export const FLAG: Record<string, string> = { condition_down: '컨디션 하락', blocked_repeat: '막힘 반복', no_one_on_one: '1:1 공백', checkin_missing: '체크인 없음' };
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
/** AI 해석 중 이 사람을 언급한 항목 */
export const aiAbout = (items: InsightItem[], name?: string | null) => (name ? items.filter((it) => `${it.title} ${it.body}`.includes(name)) : []);

export default function People() {
  const { team } = useTeam();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'board') as Tab;
  const setTab = (t: Tab) => { const p = new URLSearchParams(params); if (t === 'board') p.delete('tab'); else p.set('tab', t); p.delete('new'); setParams(p, { replace: true }); };
  const [period, setPeriod] = usePeriod();
  const m = useHomeModel(period);
  const [memo, setMemo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  const [oo, setOo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  const [req, setReq] = useState<string | null | undefined>(undefined);
  const openMemo = (who: string | null = null) => setMemo({ open: true, who });
  const act = useSignalAct(openMemo);
  const st = m.loading ? null : STATUS_META[m.status.people];
  const members = useTeamMembersOnly();
  const ooMap = useOneOnOneMap(team.id);
  const gap = members.filter((mb) => { const l = ooMap.data?.last.get(mb.user_id); return !l || daysAgo(l.scheduled_at) > 14; }).length;
  const k = m.k;

  return (
    <div className="space-y-5">
      {/* 머리 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white flex items-center justify-center shadow-sm"><Users size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">팀원관리
              {st && <span className={cx('text-xs font-semibold border rounded-full px-2 py-0.5', st.cls)}>{st.label}</span>}</h1>
            <p className="text-sm text-slate-500">컨디션 · 1:1 면담 · 육성 · 이탈 신호 — 기록이 쌓일수록 AI가 먼저 짚어 줍니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => openMemo()} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><StickyNote size={15} />관찰 메모</button>
          <button onClick={() => setReq(null)} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Send size={15} />요청</button>
          <button onClick={() => setOo({ open: true, who: null })} className="text-sm rounded-xl px-3 py-2 bg-teal-600 text-white hover:bg-teal-700 inline-flex items-center gap-1.5"><CalendarPlus size={15} />1:1 잡기</button>
        </div>
      </div>

      <AiBar section="people" label="팀원관리" />

      {/* 숫자 */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-slate-100">
          <Stat label="팀 컨디션 (5점)" value={k.cond} sub={`체크인 ${k.ciThis}/${k.nMem}명`} viz={<Sparkline points={k.condTrend} labels={k.condWeeks} tone="teal" w={84} h={28} />} />
          <Stat label="챙길 팀원" value={k.careN} tone={k.careN ? 'amber' : undefined} sub={k.careNames.join(', ') || '없음'} />
          <Stat label="1:1 2주 넘게 없음" value={ooMap.isLoading ? '—' : gap} tone={gap ? 'amber' : undefined} sub={`팀원 ${members.length}명 중`} />
          <Stat label="평가 근거 충분" value={k.evidenceAll ? `${k.evidenceOk}/${k.evidenceAll}` : '—'} sub="판단 근거 기준 충족" />
          <Stat label="리뷰 대기" value={k.reviewWait} sub={k.reviewSub} />
        </div>
      </Card>

      {/* 탭 */}
      <div className="flex items-center gap-2 flex-wrap">
        <nav className="flex gap-1 rounded-xl bg-slate-100 p-1 overflow-x-auto" aria-label="팀원관리">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id}
              className={cx('text-sm px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap', tab === t.id ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-600 hover:text-slate-900')}>
              <t.icon size={14} />{t.label}</button>
          ))}
        </nav>
        {(tab === 'risk' || tab === 'growth') && <div className="ml-auto"><PeriodTabs period={period} setPeriod={setPeriod} /></div>}
      </div>

      {tab === 'board' && <Board m={m} ooMap={ooMap.data} onMemo={openMemo} onOo={(w) => setOo({ open: true, who: w })} />}
      {tab === '1on1' && <OneOnOnes embedded />}
      {tab === 'growth' && <Growth m={m} onMemo={openMemo} />}
      {tab === 'risk' && <Risk m={m} act={act} />}
      {tab === 'members' && <TeamPage embedded />}

      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
      <ScheduleModal open={oo.open} onClose={() => setOo({ open: false, who: null })} memberId={oo.who} />
      <RequestModal open={req !== undefined} onClose={() => setReq(undefined)} toId={req ?? null} />
    </div>
  );
}

function Stat({ label, value, sub, tone, viz }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'amber' | 'rose'; viz?: ReactNode }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-end gap-3">
        <span className={cx('text-2xl font-bold num leading-none', tone === 'amber' && 'text-amber-600', tone === 'rose' && 'text-rose-600')}>{value}</span>{viz}
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-400 truncate">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// 팀원 보드 — 한 사람 한 카드
// ---------------------------------------------------------------------
function Board({ m, ooMap, onMemo, onOo }: { m: HomeModel; ooMap: ReturnType<typeof useOneOnOneMap>['data']; onMemo: (w: string) => void; onOo: (w: string) => void }) {
  const { team } = useTeam();
  const members = useTeamMembersOnly();
  const scores = useJudgmentScores(team.id);
  const raw = m.raw;
  const k = m.k;
  const care = new Map((raw?.care ?? []).map((c) => [c.user_id, c.signals]));
  const depth = new Map((raw?.depth ?? []).map((d) => [d.user_id, d]));
  const aiPeople = sectionsOf(m.insight?.content).people.items;
  const condOf = (uid: string) => k.weekStarts.map((w) => (raw?.checkins ?? []).find((c) => c.user_id === uid && c.week_start === w)?.condition ?? null);
  const sorted = [...members].sort((a, b) => ((care.get(b.user_id)?.length ?? 0) - (care.get(a.user_id)?.length ?? 0)));
  if (m.loading) return <Spinner />;
  if (!members.length) return <Card className="p-6 text-sm text-slate-500">팀원을 초대하면 팀원별 카드가 생깁니다. <Link to="/people?tab=members" className="text-indigo-700 font-semibold">초대하기 →</Link></Card>;
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
      {sorted.map((mb) => {
        const series = condOf(mb.user_id);
        const c = [...series].reverse().find((v) => v != null) ?? null;
        const flags = (care.get(mb.user_id) ?? []).map((x) => FLAG[x.type]).filter(Boolean);
        const d = depth.get(mb.user_id);
        const last = ooMap?.last.get(mb.user_id); const next = ooMap?.next.get(mb.user_id);
        const lastD = last ? daysAgo(last.scheduled_at) : null;
        const sc = trendOf((scores.data ?? []).filter((s) => s.user_id === mb.user_id).map((s) => Number(s.score)));
        const about = aiAbout(aiPeople, mb.profiles?.full_name)[0];
        const ring = c == null ? 'ring-slate-200' : c <= 2 ? 'ring-rose-400' : c === 3 ? 'ring-amber-400' : 'ring-emerald-400';
        const alert = flags.length > 0;
        return (
          <article key={mb.user_id} className={cx('relative rounded-2xl bg-white ring-1 p-4 flex flex-col overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]', alert ? 'ring-rose-200' : 'ring-slate-900/[0.07]')}>
            {alert && <span aria-hidden className="absolute left-0 inset-y-0 w-1 bg-rose-400" />}
            <div className="flex items-center gap-3">
              <span className={cx('rounded-full ring-2 ring-offset-2 shrink-0', ring)}><Avatar name={mb.profiles?.full_name} size={9} /></span>
              <Link to={`/people/${mb.user_id}`} className="min-w-0 group">
                <span className="block font-semibold truncate group-hover:text-teal-700">{mb.profiles?.full_name}</span>
                <span className="block text-xs text-slate-500 truncate">{mb.job_title || '직무 미입력'}</span>
              </Link>
              <span className="ml-auto text-right"><span className="block text-[10px] text-slate-400">컨디션</span><span className="text-xl font-bold num leading-none">{c ?? '—'}</span></span>
            </div>
            <div className="mt-2"><Sparkline points={series} labels={k.condWeeks} tone={c != null && c <= 2 ? 'rose' : 'teal'} w={260} h={30} /></div>
            <dl className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <Fact label="마지막 1:1" value={lastD == null ? '없음' : lastD === 0 ? '오늘' : `${lastD}일 전`} warn={lastD == null || lastD > 14} sub={next ? `다음 ${fmtShort(next.scheduled_at.slice(0, 10))}` : undefined} />
              <Fact label="판단 깊이" value={sc.now != null ? `${sc.now}` : '—'} sub={sc.now != null && sc.prev != null ? <Delta d={sc.now - sc.prev} /> : '/4'} />
              <Fact label="평가 근거" value={d ? `${d.judgment_evidence}` : '—'} warn={!!d && !d.eligible} sub={d ? (d.eligible ? '충분' : '부족') : undefined} />
            </dl>
            <div className="mt-2 flex flex-wrap gap-1 min-h-[20px]">
              {flags.map((f) => <span key={f} className="text-[10px] font-semibold rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-100 px-1.5 py-0.5">{f}</span>)}
              {!alert && <span className="text-[10px] text-emerald-700 font-semibold inline-flex items-center gap-1"><CheckCircle2 size={11} />특이사항 없음</span>}
            </div>
            {about && (
              <div className="mt-2.5 rounded-xl bg-violet-50 ring-1 ring-violet-100 px-3 py-2 text-xs">
                <AiChip label="AI" tone="solid" className="mr-1.5" /><b className="font-semibold text-slate-800">{strip(about.title)}</b>
                {about.action && <div className="mt-0.5 text-violet-800">→ {strip(about.action)}</div>}
              </div>
            )}
            <div className="mt-auto pt-3 flex items-center gap-1.5 text-xs">
              <button onClick={() => onMemo(mb.user_id)} className="rounded-lg px-2 py-1 ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1"><StickyNote size={12} />메모</button>
              <button onClick={() => onOo(mb.user_id)} className="rounded-lg px-2 py-1 ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1"><CalendarPlus size={12} />1:1</button>
              <Link to={`/people/${mb.user_id}`} className="ml-auto font-semibold text-teal-700 hover:text-teal-900 inline-flex items-center gap-0.5">팀원 페이지<ChevronRight size={13} /></Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
function Fact({ label, value, sub, warn }: { label: string; value: ReactNode; sub?: ReactNode; warn?: boolean }) {
  return (
    <div className={cx('rounded-lg px-1.5 py-1.5', warn ? 'bg-amber-50' : 'bg-slate-50')}>
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className={cx('text-sm font-bold num leading-tight', warn && 'text-amber-800')}>{value}</dd>
      {sub && <dd className="text-[10px] text-slate-400 leading-tight">{sub}</dd>}
    </div>
  );
}
export function Delta({ d }: { d: number }) {
  const r = Math.round(d * 10) / 10;
  if (Math.abs(r) < 0.1) return <span className="text-slate-400">변화 없음</span>;
  return r > 0 ? <span className="text-emerald-700 inline-flex items-center"><ArrowUpRight size={10} />{r}</span> : <span className="text-rose-600 inline-flex items-center"><ArrowDownRight size={10} />{Math.abs(r)}</span>;
}

// ---------------------------------------------------------------------
// 육성 — 판단 깊이 추이, 관찰, 인정할 타이밍, 근거 부족
// ---------------------------------------------------------------------
function Growth({ m, onMemo }: { m: HomeModel; onMemo: (w: string) => void }) {
  const { team } = useTeam();
  const members = useTeamMembersOnly();
  const scores = useJudgmentScores(team.id);
  const obs = useObservations(team.id);
  const depth = new Map((m.raw?.depth ?? []).map((d) => [d.user_id, d]));
  const approved = (uid: string) => (m.raw?.subs ?? []).filter((s) => s.author_id === uid && s.status === 'approved').length;
  const aiPeople = sectionsOf(m.insight?.content).people.items;
  const aiGrowth = aiPeople.filter((it) => it.type === 'good' || it.type === 'data');
  const goods = m.goods.filter((g) => g.domain === 'growth' || g.domain === 'people' || g.domain === 'output');
  const thin = (m.raw?.depth ?? []).filter((d) => !d.eligible);
  const rows = useMemo(() => members.map((mb) => {
    const list = (scores.data ?? []).filter((s) => s.user_id === mb.user_id).map((s) => Number(s.score));
    const o = (obs.data ?? []).filter((x) => x.subject_id === mb.user_id);
    return { mb, list, t: trendOf(list), praise: o.filter((x) => x.kind === 'praise').length, concern: o.filter((x) => x.kind === 'concern').length, notes: o.length };
  }), [members, scores.data, obs.data]);

  return (
    <div className="grid lg:grid-cols-3 gap-4 items-start">
      <Card className="lg:col-span-2 overflow-x-auto">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2"><span className="font-semibold text-sm">팀원별 성장</span>
          <AiChip label="판단 깊이 = AI 1차 검토 점수" className="ml-1" /><span className="ml-auto text-xs text-slate-400">최근 8개월</span></div>
        <table className="w-full text-sm min-w-[620px]">
          <thead className="text-[11px] text-slate-500"><tr>
            <th className="text-left font-normal px-5 py-2">팀원</th><th className="text-left font-normal px-2">판단 깊이 추이</th><th className="text-left font-normal px-2">관찰 (칭찬·우려)</th>
            <th className="text-left font-normal px-2">승인 결과물</th><th className="text-left font-normal px-2">평가 근거</th><th /></tr></thead>
          <tbody>
            {rows.map(({ mb, list, t, praise, concern, notes }) => {
              const d = depth.get(mb.user_id);
              return (
                <tr key={mb.user_id} className="border-t border-slate-100">
                  <td className="px-5 py-2.5"><Link to={`/people/${mb.user_id}`} className="flex items-center gap-2 hover:text-teal-700"><Avatar name={mb.profiles?.full_name} size={7} /><span className="font-medium">{mb.profiles?.full_name}</span></Link></td>
                  <td className="px-2"><div className="flex items-center gap-2">
                    {list.length >= 2 ? <Sparkline points={list.slice(-8)} labels={list.slice(-8).map((_, i) => `${i + 1}`)} tone="teal" w={80} h={22} min={0} max={4} /> : <span className="text-xs text-slate-400 w-20">기록 부족</span>}
                    <span className="text-xs num">{t.now ?? '—'}{t.now != null && t.prev != null && <span className="ml-1"><Delta d={t.now - t.prev} /></span>}</span></div></td>
                  <td className="px-2 text-xs num">{notes ? <><span className="text-emerald-700">{praise}</span> · <span className="text-rose-600">{concern}</span><span className="text-slate-400"> / {notes}</span></> : <button onClick={() => onMemo(mb.user_id)} className="text-amber-700 font-semibold">없음 · 남기기</button>}</td>
                  <td className="px-2 text-xs num">{approved(mb.user_id)}건 <span className="text-slate-400">60일</span></td>
                  <td className="px-2 text-xs">{d ? <span className={cx('font-semibold rounded-full px-1.5 py-0.5', d.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>{d.judgment_evidence}건 · {d.eligible ? '충분' : '부족'}</span> : '—'}</td>
                  <td className="px-3 text-right"><Link to={`/eval?member=${mb.user_id}`} className="text-xs text-indigo-700 font-semibold whitespace-nowrap">평가 초안 →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-500">체크인 · 1:1 · 결과물 · 리뷰 피드백 · 관찰 메모 · 요청 완료가 <b className="font-semibold">근거 원장에 자동으로 쌓여</b> 평가 초안의 근거가 됩니다.</p>
      </Card>
      <div className="space-y-4">
        <Card className="p-4">
          <div className="font-semibold text-sm flex items-center gap-2"><Sprout size={15} className="text-emerald-600" />인정할 타이밍</div>
          <ul className="mt-2 space-y-2">
            {aiGrowth.filter((x) => x.type === 'good').map((it, i) => (
              <li key={`a${i}`} className="text-sm rounded-xl bg-violet-50 ring-1 ring-violet-100 px-3 py-2"><AiChip label="AI" tone="solid" className="mr-1.5" /><b className="font-semibold">{strip(it.title)}</b>
                {it.action && <div className="text-xs text-violet-800 mt-0.5">→ {strip(it.action)}</div>}</li>
            ))}
            {goods.slice(0, 5).map((g) => <li key={g.id} className="text-sm flex gap-2"><CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" /><span>{g.title}{g.detail && <span className="block text-xs text-slate-500">{g.detail}</span>}</span></li>)}
            {!goods.length && !aiGrowth.some((x) => x.type === 'good') && <li className="text-sm text-slate-400">아직 쌓인 좋은 신호가 없습니다.</li>}
          </ul>
        </Card>
        <Card className="p-4">
          <div className="font-semibold text-sm">근거가 부족한 팀원</div>
          {aiGrowth.filter((x) => x.type === 'data').map((it, i) => <p key={i} className="mt-2 text-xs rounded-lg bg-violet-50 px-2.5 py-1.5"><AiChip label="AI" className="mr-1" />{strip(it.title)}</p>)}
          {!thin.length ? <p className="mt-2 text-sm text-slate-400">모두 충분합니다.</p> : (
            <ul className="mt-2 space-y-1.5">{thin.map((d) => (
              <li key={d.user_id} className="text-sm flex items-center gap-2"><span className="flex-1">{d.full_name} <span className="text-xs text-slate-400">근거 {d.judgment_evidence}건</span></span>
                <button onClick={() => onMemo(d.user_id)} className="text-xs text-teal-700 font-semibold">관찰 메모</button></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 이탈·리스크 — 컨디션 하락, 반복 막힘, 1:1 공백 (자동 감지 + AI)
// ---------------------------------------------------------------------
function Risk({ m, act }: { m: HomeModel; act: ReturnType<typeof useSignalAct> }) {
  const members = useTeamMembersOnly();
  const items = m.by('people').filter((s) => s.type !== 'good');
  const aiRisk = sectionsOf(m.insight?.content).people.items.filter((it) => it.type === 'risk' || it.type === 'missed' || it.type === 'pattern');
  const care = (m.raw?.care ?? []).filter((c) => c.signals.length);
  return (
    <div className="grid lg:grid-cols-5 gap-4 items-start">
      <Card className="lg:col-span-3">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between"><span className="font-semibold text-sm">자동 감지 · 사람</span><span className="text-xs text-slate-400">규칙·모델 계산</span></div>
        {m.loading ? <Spinner /> : <SignalList items={items} snooze={m.snooze} locked={m.locked} onAct={act} max={8} empty="지금 감지된 이탈·리스크 신호가 없습니다." />}
      </Card>
      <div className="lg:col-span-2 space-y-4">
        {!!aiRisk.length && (
          <Card className="p-4 bg-gradient-to-br from-violet-50 to-white">
            <div className="font-semibold text-sm flex items-center gap-2"><AiChip label="AI 해석" tone="solid" />원인과 순서</div>
            <ul className="mt-2 space-y-2.5">{aiRisk.map((it, i) => (
              <li key={i} className="text-sm"><b className="font-semibold">{strip(it.title)}</b><p className="text-xs text-slate-600 mt-0.5">{strip(it.body)}</p>
                {it.action && <p className="text-xs text-violet-800 font-semibold mt-0.5">→ {strip(it.action)}</p>}</li>
            ))}</ul>
          </Card>
        )}
        <Card>
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm">팀원별 신호</div>
          {!care.length ? <p className="px-4 py-4 text-sm text-slate-400">신호가 있는 팀원이 없습니다.</p> : (
            <ul className="divide-y divide-slate-100">{care.map((c) => {
              const mb = members.find((x) => x.user_id === c.user_id);
              return (
                <li key={c.user_id}><Link to={`/people/${c.user_id}`} className="px-4 py-2.5 flex items-center gap-2.5 hover:bg-slate-50">
                  <Avatar name={c.full_name} size={7} /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{c.full_name} <span className="text-xs text-slate-400 font-normal">{mb?.job_title}</span></span>
                    <span className="flex flex-wrap gap-1 mt-0.5">{c.signals.map((s, i) => <span key={i} className="text-[10px] font-semibold rounded-full bg-rose-50 text-rose-700 px-1.5 py-0.5">{FLAG[s.type] ?? s.label}</span>)}</span></span>
                  <ChevronRight size={14} className="text-slate-300" /></Link></li>
              );
            })}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
