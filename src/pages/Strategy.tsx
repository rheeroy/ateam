import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FlaskConical, Link2, Pencil, Plus, Scale, SlidersHorizontal } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { useGenerate, useLatestAi } from '../lib/hooks';
import type { Decision, GoalOutlook, Hypothesis, PortfolioRow, WorkItem } from '../lib/types';
import { cx, fmtDate, fmtShort } from '../lib/format';
import { Bar, Button, Card, CardHead, Empty, Field, Modal, PageHeader, Pill, Spinner, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, kindFromStatus } from '../components/Prov';
import { PortfolioChart } from '../components/charts';
import { Upsell } from './Perf';


function useInval() {
  const qc = useQueryClient();
  return () => ['goal-outlook', 'portfolio', 'items', 'hyps', 'goals', 'decisions', 'insight'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

function GoalCard({ g, hyps, tasks }: { g: GoalOutlook; hyps: Hypothesis[]; tasks: WorkItem[] }) {
  const { team, nameOf } = useTeam();
  const inval = useInval();
  const [addHyp, setAddHyp] = useState(false);
  const [stmt, setStmt] = useState('');
  const [signal, setSignal] = useState('');
  const p = g.probability;
  const tone = p == null ? 'slate' : p >= 60 ? 'emerald' : p >= 40 ? 'amber' : 'rose';
  const label = p == null ? '데이터 부족' : p >= 60 ? '정상' : p >= 40 ? '주의' : '위험';
  const add = useMutation({ mutationFn: () => q(supabase.from('hypotheses').insert({ team_id: team.id, item_id: g.goal_id, statement: stmt, signal })), onSuccess: () => { setStmt(''); setSignal(''); setAddHyp(false); inval(); } });
  const setHyp = useMutation({ mutationFn: (h: { id: string; status: Hypothesis['status'] }) => q(supabase.from('hypotheses').update({ status: h.status }).eq('id', h.id)), onSuccess: inval });
  const archive = useMutation({ mutationFn: () => q(supabase.from('work_items').update({ status: 'dropped' }).eq('id', g.goal_id)), onSuccess: inval });
  return (
    <Card className={cx('p-5', tone === 'amber' && 'border-amber-300', tone === 'rose' && 'border-rose-300')}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">{g.title}</div>
        <Pill tone={tone as 'slate'}>{tone === 'emerald' ? <CheckCircle2 size={11} /> : tone !== 'slate' ? <AlertTriangle size={11} /> : null}{label}</Pill>
      </div>
      <div className="mt-3 flex items-center gap-3"><div className="flex-1"><Bar value={g.progress} /></div><span className="text-xs text-slate-500">진척 <b className="font-mono">{g.progress}%</b></span></div>
      <div className="mt-1.5 text-xs text-slate-500 flex items-center gap-1.5">달성 전망 <b className={cx('font-mono', tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-800')}>{p ?? '-'}{p != null && '%'}</b>
        <ProvChip kind="calc" label={g.basis === 'metric' ? '지표 기반' : g.basis === 'schedule' ? '일정 기반' : '계산 불가'} level="L4" depth={g.basis === 'metric' ? 3 : g.basis === 'schedule' ? 2 : 0}
          sources={g.basis === 'metric' ? ['연결된 실적 지표의 달성 확률'] : ['과제별 일정 대비 진척', `막힌 과제 ${g.blocked}건 감점`]} /></div>
      <div className="mt-4 space-y-2">
        {hyps.map((h) => (
          <div key={h.id} className="rounded-xl bg-slate-50 p-3 text-xs">
            <div className="flex items-center justify-between gap-2 font-semibold text-slate-600"><span className="inline-flex items-center gap-1"><FlaskConical size={12} />가설</span>
              <select aria-label="가설 상태" value={h.status} onChange={(e) => setHyp.mutate({ id: h.id, status: e.target.value as Hypothesis['status'] })} className="bg-transparent text-[11px] border-0 p-0 pr-5 focus:ring-0">
                <option value="testing">검증 중</option><option value="validated">맞음</option><option value="refuted">틀림</option>
              </select></div>
            <div className="mt-1 text-slate-800">{h.statement}</div>
            {h.signal && <div className={cx('mt-0.5', h.status === 'refuted' ? 'text-rose-700' : 'text-slate-500')}>신호 · {h.signal}</div>}
          </div>
        ))}
        {addHyp ? (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (stmt.trim()) add.mutate(); }}>
            <input className={inputCls} placeholder="가설 (예: 침투가로 전환율 20% 이상)" value={stmt} onChange={(e) => setStmt(e.target.value)} />
            <input className={inputCls} placeholder="지금까지의 신호 (선택)" value={signal} onChange={(e) => setSignal(e.target.value)} />
            <div className="flex gap-2"><Button size="sm" type="submit">추가</Button><Button size="sm" variant="ghost" type="button" onClick={() => setAddHyp(false)}>취소</Button></div>
          </form>
        ) : <button className="text-xs text-slate-500 hover:text-indigo-600 inline-flex items-center gap-1" onClick={() => setAddHyp(true)}><Plus size={12} />가설</button>}
      </div>
      <ul className="mt-4 text-sm space-y-1.5">
        {tasks.map((t) => (
          <li key={t.id} className="flex justify-between gap-2"><Link className="text-left hover:text-indigo-700 truncate" to={`/goals?item=${t.id}`}>{t.title}{t.status === 'blocked' && <span className="text-rose-600 text-xs"> · 막힘</span>}{t.status === 'proposed' && <span className="text-violet-600 text-xs"> · 검토 대기</span>}</Link><span className="text-slate-500 shrink-0">{nameOf(t.owner_id) || '미정'}</span></li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between"><Link to={`/goals?item=${g.goal_id}`} className="text-xs text-indigo-700 font-semibold">목표·과제에서 열기 →</Link>
        <button className="text-[11px] text-slate-400 hover:text-rose-600" onClick={() => { if (confirm('이 목표를 중단 처리할까요?')) archive.mutate(); }}>중단</button></div>
    </Card>
  );
}

interface Check { summary: string; keep: string[]; stop: string[]; start: string[]; question?: string }

function DecisionLog({ teamId }: { teamId: string }) {
  const { uid } = useTeam();
  const inval = useInval();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', rationale: '', expected_outcome: '', review_on: '' });
  const [outcomeFor, setOutcomeFor] = useState<Decision | null>(null);
  const [oc, setOc] = useState({ outcome: '', rating: 'hit' as Decision['outcome_rating'] });
  const list = useQuery({ queryKey: ['decisions', teamId], queryFn: () => q<Decision[]>(supabase.from('decisions').select('*').eq('team_id', teamId).order('decided_at', { ascending: false }).limit(30)) });
  const add = useMutation({ mutationFn: () => q(supabase.from('decisions').insert({ team_id: teamId, decided_by: uid, ...f, review_on: f.review_on || null })), onSuccess: () => { setOpen(false); setF({ title: '', rationale: '', expected_outcome: '', review_on: '' }); inval(); toast('의사결정을 기록했습니다'); } });
  const rec = useMutation({ mutationFn: () => q(supabase.from('decisions').update({ outcome: oc.outcome, outcome_rating: oc.rating }).eq('id', outcomeFor!.id)), onSuccess: () => { setOutcomeFor(null); inval(); toast('결과를 기록했습니다. 팀장 판단 회고(L5)의 재료가 됩니다.'); } });
  const label = { hit: '맞음', partial: '일부', miss: '빗나감' };
  return (
    <Card>
      <CardHead icon={<Scale size={16} className="text-indigo-600" />} title="의사결정 로그" right={<Button size="sm" variant="soft" onClick={() => setOpen(true)}><Plus size={12} />기록</Button>} />
      {!list.data?.length ? <p className="px-5 py-4 text-sm text-slate-500">결정할 때 기대한 결과를 남겨 두면, 나중에 실제 결과와 비교해 팀장 판단을 돌아볼 수 있습니다.</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {list.data.map((d) => (
            <li key={d.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-2"><span className="font-medium">{d.title}</span>
                {d.outcome_rating ? <Pill tone={d.outcome_rating === 'hit' ? 'emerald' : d.outcome_rating === 'partial' ? 'amber' : 'rose'}>{label[d.outcome_rating]}</Pill>
                  : <button className="text-xs text-indigo-600 shrink-0" onClick={() => { setOutcomeFor(d); setOc({ outcome: '', rating: 'hit' }); }}>결과 기록</button>}</div>
              <div className="text-xs text-slate-500 mt-0.5">{fmtShort(d.decided_at)} · 기대: {d.expected_outcome || '-'}{d.review_on && ` · ${fmtDate(d.review_on)} 검증`}</div>
              {d.outcome && <div className="text-xs text-slate-600 mt-0.5">결과: {d.outcome}</div>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="의사결정 기록">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label="결정"><input required className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="가격 정책을 침투가로 확정" /></Field>
          <Field label="근거"><textarea rows={2} className={inputCls} value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} /></Field>
          <Field label="기대하는 결과"><input className={inputCls} value={f.expected_outcome} onChange={(e) => setF({ ...f, expected_outcome: e.target.value })} placeholder="파일럿 전환율 20%" /></Field>
          <Field label="검증할 날"><input type="date" className={inputCls} value={f.review_on} onChange={(e) => setF({ ...f, review_on: e.target.value })} /></Field>
          <Button type="submit" className="w-full" loading={add.isPending}>기록</Button>
        </form>
      </Modal>
      <Modal open={!!outcomeFor} onClose={() => setOutcomeFor(null)} title={`결과 기록 · ${outcomeFor?.title ?? ''}`}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); rec.mutate(); }}>
          <p className="text-sm text-slate-600">기대: {outcomeFor?.expected_outcome || '-'}</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            {(['hit', 'partial', 'miss'] as const).map((r) => (
              <button type="button" key={r} onClick={() => setOc({ ...oc, rating: r })} className={cx('border rounded-lg py-2', oc.rating === r ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>{label[r]}</button>
            ))}
          </div>
          <Field label="실제 결과"><textarea rows={2} className={inputCls} value={oc.outcome} onChange={(e) => setOc({ ...oc, outcome: e.target.value })} /></Field>
          <Button type="submit" className="w-full" loading={rec.isPending}>저장</Button>
        </form>
      </Modal>
    </Card>
  );
}

export default function Strategy() {
  const { team, hasFeature, refresh } = useTeam();
  const inval = useInval();
  const toast = useToast();
  const [editMission, setEditMission] = useState(false);
  const [mission, setMission] = useState(team.mission);
  const [goalTitle, setGoalTitle] = useState('');
  const goals = useQuery({ queryKey: ['goal-outlook', team.id], queryFn: () => q<GoalOutlook[]>(supabase.rpc('goal_outlook', { p_team: team.id })) });
  const hyps = useQuery({ queryKey: ['hyps', team.id], queryFn: () => q<Hypothesis[]>(supabase.from('hypotheses').select('*').eq('team_id', team.id).order('created_at')) });
  const tasks = useQuery({ queryKey: ['items', team.id, 'strategy'], queryFn: () => q<WorkItem[]>(supabase.from('work_items').select('*').eq('team_id', team.id).not('parent_id', 'is', null).not('status', 'in', '(dropped,done)').order('sort')) });
  const port = useQuery({ queryKey: ['portfolio', team.id], queryFn: () => q<PortfolioRow[]>(supabase.rpc('task_portfolio', { p_team: team.id })) });
  const check = useLatestAi<Check>(team.id, 'strategy_check');
  const gen = useGenerate('ai-interpret');
  const saveMission = useMutation({ mutationFn: () => q(supabase.from('teams').update({ mission }).eq('id', team.id)), onSuccess: () => { setEditMission(false); refresh(); } });
  const addGoal = useMutation({
    mutationFn: () => q(supabase.from('work_items').insert({ team_id: team.id, title: goalTitle, measure: 'children', owner_id: team.owner_id, sort: (goals.data?.length ?? 0) * 1000 + 1000 })),
    onSuccess: () => { setGoalTitle(''); inval(); }, onError: (e) => toast(errorText(e)),
  });
  const seed = useMutation({ mutationFn: () => q(supabase.rpc('seed_sample_strategy', { p_team: team.id })), onSuccess: () => { inval(); refresh(); }, onError: (e) => toast(errorText(e)) });

  if (!hasFeature('strategy')) return <section><PageHeader title="팀 전략" /><Upsell feature="팀 전략" /></section>;
  const c = check.data;

  return (
    <section>
      <div className="rounded-2xl bg-slate-900 text-white p-6">
        <div className="flex items-center justify-between"><div className="text-xs font-semibold tracking-wider text-indigo-300">팀 미션</div>
          {!editMission && <button className="text-slate-400 hover:text-white" onClick={() => setEditMission(true)} title="고치기"><Pencil size={14} /></button>}</div>
        {editMission ? (
          <div className="mt-2 flex gap-2"><input className={`${inputCls} text-slate-900`} value={mission} onChange={(e) => setMission(e.target.value)} /><Button onClick={() => saveMission.mutate()}>저장</Button></div>
        ) : <div className="mt-2 text-xl font-bold leading-snug">{team.mission || '팀 미션을 적어 주세요'}</div>}
        {team.parent_link && <div className="mt-3 text-sm text-slate-300 inline-flex items-center gap-1.5"><Link2 size={14} />상위 연결 · {team.parent_link}</div>}
      </div>

      {goals.isLoading ? <Spinner /> : !goals.data?.length ? (
        <Card className="mt-5"><Empty title="전략 목표가 없습니다" action={<div className="flex gap-2 justify-center"><Button variant="secondary" loading={seed.isPending} onClick={() => seed.mutate()}>샘플로 채워 보기</Button></div>}>
          미션을 이루기 위한 전략 목표를 2~4개 적고, 과제를 연결하세요. 목표별 전망과 시간 배분이 자동으로 계산됩니다.
        </Empty></Card>
      ) : (
        <div className="mt-5 grid md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
          {goals.data.map((g) => (
            <GoalCard key={g.goal_id} g={g} hyps={(hyps.data ?? []).filter((h) => h.item_id === g.goal_id)} tasks={(tasks.data ?? []).filter((t) => t.parent_id === g.goal_id)} />
          ))}
        </div>
      )}
      <form className="mt-3 flex gap-2 max-w-lg" onSubmit={(e) => { e.preventDefault(); if (goalTitle.trim()) addGoal.mutate(); }}>
        <input aria-label="새 전략 목표" className={inputCls} placeholder="새 전략 목표" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} />
        <Button type="submit" variant="soft"><Plus size={14} />목표</Button>
        <Link to="/goals"><Button type="button" variant="secondary">목표·과제 편집</Button></Link>
      </form>

      <div className="mt-5 grid lg:grid-cols-5 gap-5 items-start">
        <ProvBlock kind="calc" className="lg:col-span-3 min-w-0 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between flex-wrap gap-2"><h2 className="font-semibold inline-flex items-center gap-2">과제 포트폴리오
            <ProvChip kind="calc" sources={['팀 시간 = 과제별 배분율 × 사람별 주당 가용 시간 (없으면 예상 공수)', '미션 기여도 = 팀장이 매긴 1~5']} level="L4" depth={2} /></h2>
            <span className="text-xs text-slate-400">미션 기여도 × 팀 시간 투입</span></div>
          <div className="mt-3 overflow-x-auto">{port.data?.length ? <PortfolioChart rows={port.data} /> : <p className="text-sm text-slate-500 py-6">진행 중인 과제가 없습니다.</p>}</div>
        </ProvBlock>
        <div className="lg:col-span-2 space-y-5">
          <ProvBlock rail className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-semibold">분기 전략 점검
              {c && <ProvChip kind={kindFromStatus(c.status)} label="AI 제안" sources={c.sources} level={c.level} depth={c.depth} note="계속·멈춤·시작은 제안입니다. 결정은 의사결정 로그에 팀장 이름으로 남습니다." />}</div>
              <Button size="sm" variant="ghost" loading={gen.isPending} onClick={() => gen.mutate({ kind: 'strategy_check', team_id: team.id })}>{c ? '다시 점검' : '점검하기 · 1'}</Button></div>
            {c ? (
              <>
                <p className="mt-3 text-sm leading-relaxed text-slate-700">{c.content.summary}</p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-emerald-50 p-2.5"><div className="font-semibold text-emerald-800">계속</div>{c.content.keep.map((x, i) => <p key={i} className="mt-1 text-slate-700">{x}</p>)}</div>
                  <div className="rounded-lg bg-rose-50 p-2.5"><div className="font-semibold text-rose-800">멈춤</div>{c.content.stop.map((x, i) => <p key={i} className="mt-1 text-slate-700">{x}</p>)}</div>
                  <div className="rounded-lg bg-indigo-50 p-2.5"><div className="font-semibold text-indigo-800">시작</div>{c.content.start.map((x, i) => <p key={i} className="mt-1 text-slate-700">{x}</p>)}</div>
                </div>
                {c.content.question && <p className="mt-3 text-xs text-slate-600"><b>스스로 답해 볼 질문</b> · {c.content.question}</p>}
                <Link to="/sim"><Button className="mt-4 w-full"><SlidersHorizontal size={14} />재배분 효과 시뮬레이션</Button></Link>
              </>
            ) : <p className="mt-3 text-sm text-slate-500">목표별 전망, 과제별 시간 배분, 가설 현황을 함께 보고 자원 배분을 점검합니다.</p>}
          </ProvBlock>
          <DecisionLog teamId={team.id} />
        </div>
      </div>

    </section>
  );
}
