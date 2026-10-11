import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Save, Scale } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import type { AiOutput, Forecast, GoalOutlook, Metric, Scenario, Task } from '../lib/types';
import { BASE_INPUT, keyPerson, sensitivity, simulate, taskHours, type Allocation, type SimBase, type SimInput } from '../lib/sim';
import { cx, num, sign } from '../lib/format';
import { Button, Card, Empty, PageHeader, Spinner, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, kindFromStatus } from '../components/Prov';
import { CompareBars, Tornado } from '../components/charts';
import { Upsell } from './Perf';

function useSimBase(teamId: string) {
  const { members } = useTeam();
  const goals = useQuery({ queryKey: ['goal-outlook', teamId], queryFn: () => q<GoalOutlook[]>(supabase.rpc('goal_outlook', { p_team: teamId })) });
  const tasks = useQuery({ queryKey: ['tasks', teamId, 'active'], queryFn: () => q<Task[]>(supabase.from('tasks').select('*').eq('team_id', teamId).in('status', ['planned', 'in_progress', 'blocked'])) });
  const alloc = useQuery({ queryKey: ['alloc', teamId], queryFn: () => q<Allocation[]>(supabase.from('task_allocations').select('task_id, user_id, share_pct').eq('team_id', teamId)) });
  const metric = useQuery({ queryKey: ['metrics', teamId, 'primary'], queryFn: async () => (await q<Metric[]>(supabase.from('metrics').select('*').eq('team_id', teamId).not('target', 'is', null).order('created_at').limit(1)))[0] ?? null });
  const fc = useQuery({ queryKey: ['forecast', metric.data?.id], enabled: !!metric.data, queryFn: () => q<Forecast>(supabase.rpc('metric_forecast', { p_metric: metric.data!.id })) });
  const loading = goals.isLoading || tasks.isLoading || alloc.isLoading || metric.isLoading || (!!metric.data && fc.isLoading);
  const base: SimBase | null = loading ? null : {
    goals: goals.data ?? [], tasks: tasks.data ?? [], allocations: alloc.data ?? [], members,
    forecast: fc.data ?? null, metricGoalId: metric.data?.goal_id ?? null,
  };
  return { base, loading };
}

export default function Sim() {
  const { team, hasFeature, members, uid } = useTeam();
  const toast = useToast();
  const qc = useQueryClient();
  const { base, loading } = useSimBase(team.id);
  const [inp, setInp] = useState<SimInput>(BASE_INPUT);
  const [preset, setPreset] = useState('base');
  const [note, setNote] = useState<AiOutput<{ headline: string; text: string; report_line: string }> | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  useEffect(() => { setSavedId(null); setNote(null); }, [inp]);

  const hrs = useMemo(() => (base ? taskHours(base) : new Map<string, number>()), [base]);
  const res = useMemo(() => (base ? simulate(base, inp) : null), [base, inp]);
  const sens = useMemo(() => (base ? sensitivity(base) : []), [base]);
  const key = useMemo(() => (base ? keyPerson(base) : null), [base]);

  const presets = useMemo(() => {
    if (!base) return [];
    const lowTask = [...base.tasks].filter((t) => (hrs.get(t.id) ?? 0) > 0).sort((a, b) => a.mission_contribution - b.mission_contribution)[0];
    const topTask = base.tasks.filter((t) => t.goal_id === base.metricGoalId || !base.metricGoalId).sort((a, b) => a.priority - b.priority || b.mission_contribution - a.mission_contribution)[0];
    const riskGoal = [...base.goals].filter((g) => g.probability != null).sort((a, b) => (a.probability ?? 0) - (b.probability ?? 0))[0];
    return [
      { id: 'base', label: '기준', v: BASE_INPUT },
      key && { id: 'leave', label: `${key.name} 이탈`, v: { ...BASE_INPUT, leave: key.id } },
      { id: 'hire', label: '1명 충원', v: { ...BASE_INPUT, hc: 1 } },
      riskGoal && { id: 'delay', label: `${riskGoal.title.slice(0, 10)} 4주 지연`, v: { ...BASE_INPUT, delayGoal: base.metricGoalId ?? riskGoal.goal_id, delayWeeks: 4 } },
      { id: 'budget', label: '예산 20% 삭감', v: { ...BASE_INPUT, budget: -20 } },
      lowTask && topTask && lowTask.id !== topTask.id && { id: 'realloc', label: `${lowTask.title.slice(0, 10)} 절반 재배치`, v: { ...BASE_INPUT, reallocFrom: lowTask.id, reallocTo: topTask.id, reallocPct: 50 } },
    ].filter(Boolean) as { id: string; label: string; v: SimInput }[];
  }, [base, hrs, key]);

  const set = (p: Partial<SimInput>) => { setInp((x) => ({ ...x, ...p })); setPreset(''); };
  const describe = (i: SimInput) => {
    const parts: string[] = [];
    if (i.hc) parts.push(`인력 ${sign(i.hc, 0)}명`);
    if (i.leave) parts.push(`${members.find((m) => m.user_id === i.leave)?.profiles?.full_name} 이탈`);
    if (i.reallocFrom && i.reallocTo && i.reallocPct) parts.push(`${base?.tasks.find((t) => t.id === i.reallocFrom)?.title} 시간 ${i.reallocPct}% → ${base?.tasks.find((t) => t.id === i.reallocTo)?.title}`);
    if (i.delayGoal && i.delayWeeks) parts.push(`${base?.goals.find((g) => g.goal_id === i.delayGoal)?.title} ${i.delayWeeks}주 지연`);
    if (i.demand) parts.push(`수요 ${sign(i.demand, 0)}%`);
    if (i.budget) parts.push(`예산 ${sign(i.budget, 0)}%`);
    return parts.join(', ') || '기준';
  };

  const save = useMutation({
    mutationFn: async () => {
      const sc = await q<Scenario>(supabase.from('scenarios').insert({ team_id: team.id, name: describe(inp), inputs: { ...inp, description: describe(inp) }, results: res, created_by: uid }).select().single());
      setSavedId(sc.id);
      const out = await invoke<AiOutput<{ headline: string; text: string; report_line: string }>>('ai-interpret', { kind: 'scenario_note', team_id: team.id, scenario_id: sc.id });
      setNote(out);
      qc.invalidateQueries({ queryKey: ['credits'] });
    },
    onError: (e) => toast(errorText(e)),
  });
  const decide = useMutation({
    mutationFn: () => q(supabase.from('decisions').insert({
      team_id: team.id, decided_by: uid, scenario_id: savedId, title: `시나리오: ${describe(inp)}`,
      rationale: note?.content.text ?? '', expected_outcome: res?.metric ? `${res.metric.name} ${num(res.metric.base)}${res.metric.unit}, 달성 확률 ${res.metric.prob ?? '-'}%` : '',
    })),
    onSuccess: () => { toast('의사결정 로그에 저장했습니다'); qc.invalidateQueries({ queryKey: ['decisions'] }); },
    onError: (e) => toast(errorText(e)),
  });

  if (!hasFeature('simulation')) return <section><PageHeader title="What-if 시뮬레이션" /><Upsell feature="What-if 시뮬레이션" /></section>;
  if (loading || !base || !res) return <Spinner />;
  if (!base.goals.length) return (
    <section><PageHeader title="What-if 시뮬레이션" />
      <Card><Empty title="전략 목표와 과제가 먼저 필요합니다" action={<Link to="/strategy"><Button>팀 전략으로</Button></Link>}>목표·과제·주당 공수가 있어야 인력·일정 변화의 효과를 계산할 수 있습니다.</Empty></Card>
    </section>
  );

  const m = res.metric;
  const dBase = m ? m.base - m.baseValue : 0;
  const dProb = m && m.prob != null && m.baseProb != null ? m.prob - m.baseProb : 0;
  const tasks = base.tasks;
  const requestText = m ? [
    `[충원·자원 요청 근거] ${team.name}`,
    `· 시나리오: ${describe(inp)}`,
    `· ${m.name} 마감 전망: 기준 ${num(m.baseValue)}${m.unit} → ${num(m.base)}${m.unit} (범위 ${num(m.low)}~${num(m.high)}${m.unit}${m.target != null ? `, 목표 ${m.target}${m.unit}` : ''})`,
    m.prob != null ? `· 목표 달성 확률: ${m.baseProb ?? '-'}% → ${m.prob}%` : '',
    ...res.goals.filter((g) => g.base != null).map((g) => `· ${g.title}: ${g.base}% → ${g.value}%`),
    note ? `· 해석: ${note.content.report_line}` : '',
    '※ 용량 모델(사람별 가용 시간 × 과제 공수)과 실적 예측 모델로 계산',
  ].filter(Boolean).join('\n') : '';

  return (
    <section>
      <PageHeader title="What-if 시뮬레이션" sub="내가 움직일 수 있는 것(레버)과 통제할 수 없는 것(가정)을 바꿔 보고, 결과가 어떻게 달라지는지 봅니다" />
      <div className="flex flex-wrap gap-1.5 text-xs">
        {presets.map((p) => (
          <button key={p.id} onClick={() => { setInp(p.v); setPreset(p.id); }}
            className={cx('border rounded-full px-3 py-1.5 bg-white', preset === p.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>{p.label}</button>
        ))}
      </div>

      <div className="mt-4 grid lg:grid-cols-5 gap-5 items-start">
        <Card className="lg:col-span-2 p-5 space-y-5">
          <div>
            <div className="text-xs font-semibold text-indigo-700 mb-3">내부 레버 · 내가 정하는 것</div>
            <label className="flex justify-between text-sm"><span>인력 변동</span><span className="font-mono num">{sign(inp.hc, 0) || '0'}명</span></label>
            <input type="range" min={-1} max={2} step={1} value={inp.hc} onChange={(e) => set({ hc: Number(e.target.value) })} className="w-full mt-1 accent-indigo-600" aria-label="인력 변동" />
            <p className="text-[11px] text-slate-500">충원은 첫 분기 생산성 50%, 전망이 가장 낮은 목표에 배치한다고 가정</p>
            <div className="mt-4 text-sm">시간 재배치</div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <select aria-label="뺄 과제" className={inputCls} value={inp.reallocFrom ?? ''} onChange={(e) => set({ reallocFrom: e.target.value || null })}>
                <option value="">뺄 과제</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title} ({num(hrs.get(t.id))}h)</option>)}
              </select>
              <select aria-label="넣을 과제" className={inputCls} value={inp.reallocTo ?? ''} onChange={(e) => set({ reallocTo: e.target.value || null })}>
                <option value="">넣을 과제</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <label className="mt-2 flex justify-between text-xs text-slate-500"><span>옮길 비율</span><span className="font-mono">{inp.reallocPct}%</span></label>
            <input type="range" min={0} max={100} step={10} value={inp.reallocPct} onChange={(e) => set({ reallocPct: Number(e.target.value) })} className="w-full accent-indigo-600" aria-label="옮길 비율" />
          </div>
          <div className="pt-4 border-t border-slate-100">
            <div className="text-xs font-semibold text-slate-500 mb-3">외부 가정 · 통제할 수 없는 것</div>
            <div className="text-sm">팀원 이탈</div>
            <select aria-label="이탈하는 팀원" className={`${inputCls} mt-1`} value={inp.leave ?? ''} onChange={(e) => set({ leave: e.target.value || null })}>
              <option value="">없음</option>{members.map((mm) => <option key={mm.user_id} value={mm.user_id}>{mm.profiles?.full_name}</option>)}
            </select>
            <div className="mt-4 text-sm">외부 지연</div>
            <div className="mt-1 grid grid-cols-[1fr_auto] gap-2 items-center">
              <select aria-label="지연되는 목표" className={inputCls} value={inp.delayGoal ?? ''} onChange={(e) => set({ delayGoal: e.target.value || null })}>
                <option value="">목표 선택</option>{base.goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.title}</option>)}
              </select>
              <span className="font-mono text-sm w-10 text-right">{inp.delayWeeks}주</span>
            </div>
            <input type="range" min={0} max={8} step={1} value={inp.delayWeeks} onChange={(e) => set({ delayWeeks: Number(e.target.value) })} className="w-full mt-1 accent-indigo-600" aria-label="지연 주수" />
            <label className="mt-4 flex justify-between text-sm"><span>시장 수요 변화</span><span className="font-mono num">{sign(inp.demand, 0) || '0'}%</span></label>
            <input type="range" min={-30} max={30} step={5} value={inp.demand} onChange={(e) => set({ demand: Number(e.target.value) })} className="w-full mt-1 accent-indigo-600" aria-label="수요 변화" />
            <label className="mt-4 flex justify-between text-sm"><span>팀 예산 변화</span><span className="font-mono num">{sign(inp.budget, 0) || '0'}%</span></label>
            <input type="range" min={-30} max={0} step={5} value={inp.budget} onChange={(e) => set({ budget: Number(e.target.value) })} className="w-full mt-1 accent-indigo-600" aria-label="예산 변화" />
          </div>
          <p className="text-[11px] text-slate-500">팀 주당 투입 시간 {num(res.hours.before, 0)}h → <b>{num(res.hours.after, 0)}h</b></p>
        </Card>

        <div className="lg:col-span-3 space-y-5">
          {m && (
            <div className="grid grid-cols-2 gap-4">
              <ProvBlock kind="calc" className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="text-xs text-slate-500">마감 {m.name}</div>
                <div className="mt-1 flex items-baseline gap-2"><span className="text-2xl font-bold num">{num(m.base)}{m.unit}</span>
                  <span className={cx('text-sm font-semibold num', dBase > 0.05 ? 'text-indigo-600' : dBase < -0.05 ? 'text-rose-600' : 'text-slate-400')}>{Math.abs(dBase) < 0.05 ? '기준' : sign(dBase)}</span></div>
                <div className="text-xs text-slate-500 num mt-1">범위 {num(m.low)} ~ {num(m.high)}{m.unit}{m.target != null && ` · 목표 ${m.target}${m.unit}`}</div>
              </ProvBlock>
              <ProvBlock kind="calc" className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="text-xs text-slate-500">목표 달성 확률</div>
                <div className="mt-1 flex items-baseline gap-2"><span className="text-2xl font-bold num">{m.prob ?? '-'}%</span>
                  <span className={cx('text-sm font-semibold num', dProb > 0 ? 'text-indigo-600' : dProb < 0 ? 'text-rose-600' : 'text-slate-400')}>{dProb === 0 ? '기준' : `${sign(dProb, 0)}%p`}</span></div>
                <div className="text-xs text-slate-500 mt-1">기준 시나리오 {m.baseProb ?? '-'}%</div>
              </ProvBlock>
            </div>
          )}
          <ProvBlock kind="calc" className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between flex-wrap gap-2"><h2 className="font-semibold inline-flex items-center gap-2">전략 목표별 달성 확률
              <ProvChip kind="calc" sources={['용량 모델: 사람별 가용 시간 × 과제 공수', '실적 예측 모델', '입력한 가정']} level="L4" depth={2} note="같은 입력이면 언제나 같은 결과가 나옵니다." /></h2>
              <div className="flex items-center gap-4 text-xs text-slate-500"><span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-slate-300" />기준</span><span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-indigo-600" />이 시나리오</span></div></div>
            <div className="mt-4"><CompareBars rows={res.goals.map((g) => ({ label: g.title, base: g.base, value: g.value }))} /></div>
          </ProvBlock>
          {!!sens.length && m && (
            <Card className="p-5">
              <div className="flex items-center justify-between flex-wrap gap-2"><h2 className="font-semibold">무엇이 결과를 가장 크게 흔드나</h2><span className="text-xs text-slate-400">마감 {m.name}에 미치는 영향 ({m.unit})</span></div>
              <div className="mt-4"><Tornado rows={sens} /></div>
            </Card>
          )}
          <ProvBlock className="rounded-2xl border border-violet-100 bg-violet-50/50 p-5 text-sm text-slate-700 leading-relaxed">
            {note ? (
              <>
                <ProvChip kind={kindFromStatus(note.status)} label="AI 해석" sources={note.sources} level={note.level} depth={note.depth} note="결과를 가장 크게 흔드는 요인부터 설명합니다." />
                <p className="mt-2 font-semibold">{note.content.headline}</p>
                <p className="mt-1">{note.content.text}</p>
              </>
            ) : <p className="text-slate-600">시나리오를 저장하면 AI가 결과를 해석하고, 상향 보고·충원 요청에 쓸 문장을 만들어 줍니다.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {!savedId ? <Button loading={save.isPending} onClick={() => save.mutate()}><Save size={14} />시나리오 저장 · 해석 받기</Button>
                : <Button loading={decide.isPending} onClick={() => decide.mutate()}><Scale size={14} />의사결정 로그에 저장</Button>}
              {m && <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(requestText); toast('요청서 근거를 복사했습니다'); }}><Copy size={14} />충원·자원 요청 근거 복사</Button>}
            </div>
          </ProvBlock>
          <p className="text-[11px] text-slate-400">계산은 용량 모델(사람별 가용 시간 × 과제 공수)과 실적 예측 모델이 하고, AI는 해석만 합니다. 공수와 배분이 실제와 다르면 결과도 달라집니다 — <Link to="/strategy" className="underline">과제 공수 고치기</Link></p>
        </div>
      </div>
    </section>
  );
}
