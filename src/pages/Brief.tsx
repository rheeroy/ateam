// 홈 섹션 상세 — /brief/decide | perf | people | org
// 홈에서 엑기스만 본 것을 여기서 전부: 섹션 AI 해석 전체 · 숫자 · 그림 · 자동 감지 전체
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { useTeam } from '../state/session';
import { cx } from '../lib/format';
import { Button, Card, Spinner } from '../components/ui';
import { TaggedText } from '../components/Prov';
import { PERIOD_LABEL } from '../lib/insights';
import {
  GoalBars, IMPACT_LEVEL, Kpi, MAIN_SECTIONS, MemberStrip, MemoModal, OrgDetail, OrgNoteModal, PeriodTabs, SECTION_META, SECTION_TONE, STATUS_META,
  SectionAiCard, SignalList, dDay, useHomeModel, usePeriod, useSignalAct, type MainSection,
} from '../components/home/shared';

export default function Brief() {
  const { section } = useParams();
  const { team } = useTeam();
  const [period, setPeriod] = usePeriod();
  const m = useHomeModel(period);
  const [memo, setMemo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  const [orgOpen, setOrgOpen] = useState(false);
  const openMemo = (who: string | null = null) => setMemo({ open: true, who });
  const act = useSignalAct(openMemo);
  if (!MAIN_SECTIONS.includes(section as MainSection)) return <Navigate to="/" replace />;
  const sec = section as MainSection;
  const meta = SECTION_META[sec];
  const st = m.loading ? null : STATUS_META[m.status[sec]];
  const k = m.k;
  const items = sec === 'risk' ? m.riskList : sec === 'decide' ? m.decideRule : m.by(sec);
  const today = new Date().toISOString().slice(0, 10);
  const due = (m.raw?.decisionsDue ?? []).filter((d) => (d.review_on ? d.review_on <= today : (Date.now() - Date.parse(d.decided_at)) / 86400000 >= 30));
  const nearest = m.orgSt.nearest;

  return (
    <div className="space-y-5">
      <div>
        <Link to={period === 'daily' ? '/' : `/?p=${period}`} className="text-sm text-slate-500 hover:text-indigo-700 inline-flex items-center gap-1"><ArrowLeft size={14} />홈</Link>
        <div className="mt-2 flex items-end justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className={cx('w-10 h-10 rounded-xl flex items-center justify-center', SECTION_TONE[sec].icon)}><meta.icon size={19} /></span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{meta.name}
                {st && <span className={cx('text-xs font-semibold border rounded-full px-2 py-0.5', st.cls)}>{st.label}</span>}</h1>
              <p className="text-sm text-slate-500">{meta.question}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sec === 'org' && <Button size="sm" variant="soft" onClick={() => setOrgOpen(true)}><Plus size={14} />위에서 온 것 남기기</Button>}
            <PeriodTabs period={period} setPeriod={setPeriod} />
          </div>
        </div>
        <nav className="mt-3 flex gap-1.5 overflow-x-auto" aria-label="섹션">
          {MAIN_SECTIONS.map((s) => (
            <Link key={s} to={`/brief/${s}${period === 'daily' ? '' : `?p=${period}`}`}
              className={cx('text-xs rounded-full px-3 py-1.5 border whitespace-nowrap', s === sec ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'border-slate-200 text-slate-600 hover:border-indigo-300')}>{SECTION_META[s].name}</Link>
          ))}
        </nav>
      </div>

      <SectionAiCard teamId={team.id} period={period} section={sec} out={m.insight} loading={m.insightLoading} />

      <Card>
        <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {sec === 'risk' && <>
            <Kpi label="지금 확인" value={m.bigRisks.length} tone={m.bigRisks.length ? 'rose' : undefined} sub="가장 급한 단계" />
            <Kpi label="주의" value={m.riskList.length - m.bigRisks.length} sub="커지기 전" />
            <Kpi label="성과 · 사람 · 조직" value={(['perf', 'people', 'org'] as const).map((a) => m.riskList.filter((x) => m.by(a).includes(x)).length).join(' · ')} sub="영역별 건수" />
            <Kpi label="가장 낮은 달성 가능성" value={k.goalLow} tone={k.goalLowTone} sub={`목표 ${k.goals}개`} />
          </>}
          {sec === 'decide' && <>
            <Kpi label="돌아볼 결정" value={k.decisionsDue} sub="결과 기록 시점 지남" />
            <Kpi label="방침 대응" value={m.orgSt.high.length} sub="영향 큰 위의 소식" />
            <Kpi label="목표 조정 검토" value={m.lowGoals.length} tone={m.lowGoals.length ? 'rose' : undefined} sub="달성 가능성 35% 미만" />
            <Kpi label="최근 결정" value={m.recentDecisions.length} sub="최근 기록 6건까지" />
          </>}
          {sec === 'perf' && <>
            <Kpi label="가장 낮은 달성 가능성" value={k.goalLow} tone={k.goalLowTone} sub={`목표 ${k.goals}개`} />
            <Kpi label="계획대로 진행" value={k.onPlan} sub={k.onPlanSub} />
            <Kpi label="막힘 · 지연 예상" value={`${k.blocked} · ${k.delayed}`} tone={k.blocked + k.delayed ? 'amber' : undefined} sub="건" />
            <Kpi label={k.fc ? `${k.fc.name} 기말 전망` : '실적 전망'} value={k.fc ? `${Math.round((k.fc.base ?? 0) * 10) / 10}${k.fc.unit}` : '—'} sub={k.fc?.target != null ? `목표 ${k.fc.target}${k.fc.unit}` : '실적 2개월 이상 필요'} />
          </>}
          {sec === 'people' && <>
            <Kpi label="팀 컨디션 (5점)" value={k.cond} sub={`이번 주 체크인 ${k.ciThis}/${k.nMem}명`} />
            <Kpi label="챙길 팀원" value={k.careN} tone={k.careN ? 'amber' : undefined} sub={k.careNames.join(', ') || '없음'} />
            <Kpi label="평가 근거 충분" value={k.evidence} sub="판단 근거 기준 충족" />
            <Kpi label="리뷰 대기" value={k.reviewWait} sub={k.reviewSub} />
          </>}
          {sec === 'org' && <>
            <Kpi label="열린 소식" value={m.orgSt.feed.length} sub="전략·임원·요청·유관 부서" />
            <Kpi label="영향 확인" value={`${m.orgSt.analyzed}/${m.orgSt.feed.length}`} tone={m.orgSt.feed.length > m.orgSt.analyzed ? 'amber' : undefined} sub="AI가 우리 팀과 맞춰 본 것" />
            <Kpi label="다가오는 기한" value={nearest ? (dDay(nearest.event_date!) === 0 ? '오늘' : `D-${dDay(nearest.event_date!)}`) : '—'} sub={nearest?.title ?? '없음'} />
            <Kpi label="위로 올릴 것" value={m.orgSt.up.length} sub="주간보고에 담을 것" />
          </>}
        </div>
        {m.loading || !m.raw ? <Spinner /> : <>
          {sec === 'perf' && <div className="border-t border-slate-100"><div className="px-5 pt-3 text-xs font-semibold text-slate-500">목표별 진척 · 달성 가능성</div><GoalBars raw={m.raw} /></div>}
          {sec === 'people' && <div className="border-t border-slate-100"><div className="px-5 pt-3 text-xs font-semibold text-slate-500">팀원별 (이름을 누르면 관찰 메모)</div><MemberStrip raw={m.raw} onMemo={(w) => openMemo(w)} /></div>}
          {sec === 'org' && <div className="border-t border-slate-100"><OrgDetail teamId={team.id} data={m.org.data} loading={m.org.isLoading} perfRisks={m.perfRisks} onAdd={() => setOrgOpen(true)} /></div>}
          {sec === 'decide' && (
            <div className="border-t border-slate-100 grid md:grid-cols-2 md:divide-x divide-slate-100">
              <div className="px-5 py-3">
                <div className="text-xs font-semibold text-slate-500">결과를 기록할 결정</div>
                {due.length ? <ul className="mt-2 space-y-1.5">{due.map((d) => <li key={d.id} className="text-sm"><Link to="/strategy" className="hover:underline">{d.title}</Link></li>)}</ul>
                  : <p className="mt-2 text-sm text-slate-400">없습니다.</p>}
                <div className="mt-3 text-xs font-semibold text-slate-500">목표 조정을 검토할 것</div>
                {m.lowGoals.length ? <ul className="mt-2 space-y-1.5">{m.lowGoals.map((g) => <li key={g.goal_id} className="text-sm"><Link to="/sim" className="hover:underline">{g.title}</Link> <span className="text-rose-600 text-xs font-semibold">{g.probability}%</span></li>)}</ul>
                  : <p className="mt-2 text-sm text-slate-400">없습니다.</p>}
              </div>
              <div className="px-5 py-3">
                <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">최근 결정</span><Link to="/strategy" className="text-xs text-indigo-700 font-semibold">결정 기록하기 →</Link></div>
                {m.recentDecisions.length ? <ul className="mt-2 space-y-1.5">{m.recentDecisions.map((d) => (
                  <li key={d.id} className="text-sm flex items-center gap-2"><span className={cx('text-[10px] font-semibold rounded px-1.5 py-0.5 w-14 text-center shrink-0', d.outcome_rating === 'hit' ? 'bg-emerald-50 text-emerald-700' : d.outcome_rating === 'partial' ? 'bg-amber-50 text-amber-800' : d.outcome_rating === 'miss' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500')}>{d.outcome_rating === 'hit' ? '적중' : d.outcome_rating === 'partial' ? '부분' : d.outcome_rating === 'miss' ? '빗나감' : '결과 대기'}</span>
                    <span className="truncate flex-1">{d.title}</span><span className="text-[11px] text-slate-400">{d.decided_at.slice(5, 10).replace('-', '/')}</span></li>
                ))}</ul> : <p className="mt-2 text-sm text-slate-400">기록한 결정이 없습니다.</p>}
              </div>
            </div>
          )}
          {sec === 'decide' && m.orgSt.high.length > 0 && (
            <div className="border-t border-slate-100 px-5 py-3">
              <div className="text-xs font-semibold text-slate-500">대응을 정해야 할 위의 소식</div>
              <ul className="mt-2 space-y-2">
                {m.orgSt.high.map((n) => {
                  const im = m.org.data?.impactOf.get(n.id);
                  return (
                    <li key={n.id} className="text-sm"><Link to="/brief/org" className="font-semibold hover:text-indigo-700">{n.title}</Link>
                      <span className={cx('ml-2 text-[11px] font-semibold rounded px-1.5 py-0.5', IMPACT_LEVEL.high.cls)}>{IMPACT_LEVEL.high.label}</span>
                      {im && <p className="text-slate-600 mt-0.5"><TaggedText text={im.content.summary} sources={im.sources} /></p>}</li>
                  );
                })}
              </ul>
            </div>
          )}
        </>}
      </Card>

      <Card>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="font-semibold text-sm">자동 감지 · {PERIOD_LABEL[period]}</span>
          <span className="text-xs text-slate-400">규칙·모델 계산 (AI 미사용)</span>
        </div>
        {m.loading ? <Spinner /> : <SignalList items={items} snooze={m.snooze} locked={m.locked} onAct={act} max={20}
          empty={`${PERIOD_LABEL[period]} ${meta.name}에서 자동 감지된 것이 없습니다. 다른 기간도 확인해 보세요.`} />}
      </Card>

      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
      <OrgNoteModal teamId={team.id} open={orgOpen} onClose={() => setOrgOpen(false)} />
    </div>
  );
}
