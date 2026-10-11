import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FlaskConical, Link2, Pencil, Plus, Scale, SlidersHorizontal } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { useGenerate, useLatestAi } from '../lib/hooks';
import type { Decision, GoalOutlook, Hypothesis, PortfolioRow, Task, TaskStatus } from '../lib/types';
import { cx, fmtDate, fmtShort } from '../lib/format';
import { Bar, Button, Card, CardHead, Empty, ErrorBox, Field, Modal, PageHeader, Pill, Spinner, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, kindFromStatus } from '../components/Prov';
import { PortfolioChart } from '../components/charts';
import { Upsell } from './Perf';

const TS: Record<TaskStatus, string> = { planned: '계획', in_progress: '진행', blocked: '막힘', done: '완료', dropped: '중단' };

function useInval() {
  const qc = useQueryClient();
  return () => ['goal-outlook', 'portfolio', 'tasks', 'hyps', 'goals', 'decisions', 'insight'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

function TaskModal({ open, onClose, task, goals }: { open: boolean; onClose: () => void; task?: Task | null; goals: GoalOutlook[] }) {
  const { team, members } = useTeam();
  const inval = useInval();
  const [f, setF] = useState(() => ({
    title: task?.title ?? '', goal_id: task?.goal_id ?? '', owner_id: task?.owner_id ?? '', priority: task?.priority ?? 2,
    mission_contribution: task?.mission_contribution ?? 3, est_hours_per_week: task?.est_hours_per_week?.toString() ?? '',
    progress: task?.progress ?? 0, status: task?.status ?? 'planned' as TaskStatus, start_date: task?.start_date ?? '', due_date: task?.due_date ?? '',
  }));
  const save = useMutation({
    mutationFn: () => {
      const row = { ...f, team_id: team.id, goal_id: f.goal_id || null, owner_id: f.owner_id || null, est_hours_per_week: f.est_hours_per_week === '' ? null : Number(f.est_hours_per_week), start_date: f.start_date || null, due_date: f.due_date || null };
      return task ? q(supabase.from('tasks').update(row).eq('id', task.id)) : q(supabase.from('tasks').insert(row));
    },
    onSuccess: () => { inval(); onClose(); },
  });
  const del = useMutation({ mutationFn: () => q(supabase.from('tasks').update({ status: 'dropped' }).eq('id', task!.id)), onSuccess: () => { inval(); onClose(); } });
  return (
    <Modal open={open} onClose={onClose} title={task ? '과제 고치기' : '과제 추가'} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="과제"><input required className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="연결 전략 목표"><select className={inputCls} value={f.goal_id} onChange={(e) => setF({ ...f, goal_id: e.target.value })}><option value="">없음 (운영·기타)</option>{goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.title}</option>)}</select></Field>
          <Field label="담당"><select className={inputCls} value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}><option value="">미정</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="미션 기여도" hint="1~5"><input type="number" min={1} max={5} className={inputCls} value={f.mission_contribution} onChange={(e) => setF({ ...f, mission_contribution: Number(e.target.value) })} /></Field>
          <Field label="우선순위" hint="1 높음"><input type="number" min={1} max={3} className={inputCls} value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })} /></Field>
          <Field label="주당 공수" hint="시간"><input type="number" min={0} step="0.5" className={inputCls} value={f.est_hours_per_week} onChange={(e) => setF({ ...f, est_hours_per_week: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="시작"><input type="date" className={inputCls} value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="마감"><input type="date" className={inputCls} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="진척 %"><input type="number" min={0} max={100} className={inputCls} value={f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} /></Field>
          <Field label="상태"><select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as TaskStatus })}>{(Object.keys(TS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TS[s]}</option>)}</select></Field>
        </div>
        <p className="text-xs text-slate-500">주당 공수와 미션 기여도는 포트폴리오·시뮬레이션 계산에 쓰입니다. 대략적인 값이면 충분합니다.</p>
        <ErrorBox error={save.error ? errorText(save.error) : null} />
        <div className="flex gap-2">
          {task && <Button type="button" variant="danger" onClick={() => del.mutate()}>중단 처리</Button>}
          <span className="flex-1" /><Button type="submit" loading={save.isPending}>저장</Button>
        </div>
      </form>
    </Modal>
  );
}

function GoalCard({ g, hyps, tasks, onTask }: { g: GoalOutlook; hyps: Hypothesis[]; tasks: Task[]; onTask: (t: Task) => void }) {
  const { team, nameOf } = useTeam();
  const inval = useInval();
  const [addHyp, setAddHyp] = useState(false);
  const [stmt, setStmt] = useState('');
  const [signal, setSignal] = useState('');
  const p = g.probability;
  const tone = p == null ? 'slate' : p >= 60 ? 'emerald' : p >= 40 ? 'amber' : 'rose';
  const label = p == null ? '데이터 부족' : p >= 60 ? '정상' : p >= 40 ? '주의' : '위험';
  const add = useMutation({ mutationFn: () => q(supabase.from('hypotheses').insert({ team_id: team.id, goal_id: g.goal_id, statement: stmt, signal })), onSuccess: () => { setStmt(''); setSignal(''); setAddHyp(false); inval(); } });
  const setHyp = useMutation({ mutationFn: (h: { id: string; status: Hypothesis['status'] }) => q(supabase.from('hypotheses').update({ status: h.status }).eq('id', h.id)), onSuccess: inval });
  const archive = useMutation({ mutationFn: () => q(supabase.from('strategic_goals').update({ archived: true }).eq('id', g.goal_id)), onSuccess: inval });
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
          <li key={t.id} className="flex justify-between gap-2"><button className="text-left hover:text-indigo-700 truncate" onClick={() => onTask(t)}>{t.title}{t.status === 'blocked' && <span className="text-rose-600 text-xs"> · 막힘</span>}</button><span className="text-slate-500 shrink-0">{nameOf(t.owner_id) || '미정'}</span></li>
        ))}
      </ul>
      <button className="mt-3 text-[11px] text-slate-400 hover:text-rose-600" onClick={() => { if (confirm('이 전략 목표를 보관할까요?')) archive.mutate(); }}>목표 보관</button>
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
  const [taskModal, setTaskModal] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [goalTitle, setGoalTitle] = useState('');
  const goals = useQuery({ queryKey: ['goal-outlook', team.id], queryFn: () => q<GoalOutlook[]>(supabase.rpc('goal_outlook', { p_team: team.id })) });
  const hyps = useQuery({ queryKey: ['hyps', team.id], queryFn: () => q<Hypothesis[]>(supabase.from('hypotheses').select('*').eq('team_id', team.id).order('created_at')) });
  const tasks = useQuery({ queryKey: ['tasks', team.id], queryFn: () => q<Task[]>(supabase.from('tasks').select('*').eq('team_id', team.id).neq('status', 'dropped').order('priority')) });
  const port = useQuery({ queryKey: ['portfolio', team.id], queryFn: () => q<PortfolioRow[]>(supabase.rpc('task_portfolio', { p_team: team.id })) });
  const check = useLatestAi<Check>(team.id, 'strategy_check');
  const gen = useGenerate('ai-interpret');
  const saveMission = useMutation({ mutationFn: () => q(supabase.from('teams').update({ mission }).eq('id', team.id)), onSuccess: () => { setEditMission(false); refresh(); } });
  const addGoal = useMutation({
    mutationFn: () => q(supabase.from('strategic_goals').insert({ team_id: team.id, title: goalTitle, sort: (goals.data?.length ?? 0) + 1 })),
    onSuccess: () => { setGoalTitle(''); inval(); }, onError: (e) => toast(errorText(e)),
  });
  const seed = useMutation({ mutationFn: () => q(supabase.rpc('seed_sample_strategy', { p_team: team.id })), onSuccess: () => { inval(); refresh(); }, onError: (e) => toast(errorText(e)) });

  if (!hasFeature('strategy')) return <section><PageHeader title="팀 전략" /><Upsell feature="팀 전략" /></section>;
  const noTaskGoal = (tasks.data ?? []).filter((t) => !t.goal_id);
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
            <GoalCard key={g.goal_id} g={g} hyps={(hyps.data ?? []).filter((h) => h.goal_id === g.goal_id)} tasks={(tasks.data ?? []).filter((t) => t.goal_id === g.goal_id)} onTask={(t) => setTaskModal({ open: true, task: t })} />
          ))}
        </div>
      )}
      <form className="mt-3 flex gap-2 max-w-lg" onSubmit={(e) => { e.preventDefault(); if (goalTitle.trim()) addGoal.mutate(); }}>
        <input aria-label="새 전략 목표" className={inputCls} placeholder="새 전략 목표" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} />
        <Button type="submit" variant="soft"><Plus size={14} />목표</Button>
        <Button type="button" variant="soft" onClick={() => setTaskModal({ open: true, task: null })}><Plus size={14} />과제</Button>
      </form>

      <div className="mt-5 grid lg:grid-cols-5 gap-5 items-start">
        <ProvBlock kind="calc" className="lg:col-span-3 min-w-0 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between flex-wrap gap-2"><h2 className="font-semibold inline-flex items-center gap-2">과제 포트폴리오
            <ProvChip kind="calc" sources={['팀 시간 = 과제별 배분율 × 사람별 주당 가용 시간 (없으면 예상 공수)', '미션 기여도 = 팀장이 매긴 1~5']} level="L4" depth={2} /></h2>
            <span className="text-xs text-slate-400">미션 기여도 × 팀 시간 투입</span></div>
          <div className="mt-3 overflow-x-auto">{port.data?.length ? <PortfolioChart rows={port.data} /> : <p className="text-sm text-slate-500 py-6">진행 중인 과제가 없습니다.</p>}</div>
          {!!noTaskGoal.length && <p className="text-xs text-slate-500">전략 목표에 연결되지 않은 과제 {noTaskGoal.length}개: {noTaskGoal.map((t) => <button key={t.id} className="underline underline-offset-2 mr-1.5" onClick={() => setTaskModal({ open: true, task: t })}>{t.title}</button>)}</p>}
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

      <Card className="mt-5 overflow-x-auto">
        <CardHead title="전체 과제" right={<span className="num">{tasks.data?.length ?? 0}개</span>} />
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-xs text-slate-500"><tr><th className="text-left font-normal px-5 py-2">과제</th><th className="text-left font-normal px-3">목표</th><th className="text-left font-normal px-3">담당</th><th className="text-left font-normal px-3">진척</th><th className="text-left font-normal px-3">상태</th><th className="text-left font-normal px-3">마감</th><th className="text-left font-normal px-3">공수/주</th><th /></tr></thead>
          <tbody>
            {(tasks.data ?? []).map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-5 py-2.5">{t.title}</td>
                <td className="px-3 text-slate-500 truncate max-w-[160px]">{goals.data?.find((g) => g.goal_id === t.goal_id)?.title ?? '-'}</td>
                <td className="px-3"><TaskOwner id={t.owner_id} /></td>
                <td className="px-3 w-32"><div className="flex items-center gap-2"><div className="flex-1"><Bar value={t.progress} /></div><span className="font-mono text-xs">{t.progress}</span></div></td>
                <td className="px-3"><Pill tone={t.status === 'blocked' ? 'rose' : t.status === 'done' ? 'emerald' : 'slate'}>{TS[t.status]}</Pill></td>
                <td className="px-3 text-slate-500">{t.due_date ? fmtShort(t.due_date) : '-'}</td>
                <td className="px-3 font-mono text-slate-500">{t.est_hours_per_week ?? '-'}</td>
                <td className="px-3 text-right"><button className="text-slate-400 hover:text-indigo-600" onClick={() => setTaskModal({ open: true, task: t })} title="고치기"><Pencil size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {taskModal.open && <TaskModal open onClose={() => setTaskModal({ open: false, task: null })} task={taskModal.task} goals={goals.data ?? []} />}
    </section>
  );
}

function TaskOwner({ id }: { id: string | null }) {
  const { nameOf } = useTeam();
  return <span>{nameOf(id) || '미정'}</span>;
}
