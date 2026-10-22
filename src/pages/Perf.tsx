import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Copy, Database, Info, Lightbulb, Lock, Plus, ScatterChart, Sparkles } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import { useGenerate, useLatestAi } from '../lib/hooks';
import type { Forecast, Metric, PerfPoint, PortfolioRow, WorkItem } from '../lib/types';
import { cx, fmtDate, num } from '../lib/format';
import { Bar, Button, Card, Empty, Spinner, Tabs, useToast } from '../components/ui';
import { ProvBlock, ProvChip, kindFromStatus } from '../components/Prov';
import { ForecastChart, PerfMap, PortfolioChart, Sparkline } from '../components/charts';
import { MetricDataModal, NewMetricModal } from '../components/MetricEditor';
import { BoxTitle, GoalMapSection, type ForecastScope } from '../components/perf/GoalMap';
import { AiIcon } from '../components/Brand';

/** Pro부터 쓰는 기능 — 무엇을 하는 기능인지 + 요금제 안내. desc·points 를 주면 기능 설명이 함께 보인다 */
export function Upsell({ feature, desc, points }: { feature: string; desc?: string; points?: string[] }) {
  if (!desc) return (
    <Card><Empty icon={<Sparkles size={18} />} title={`${feature}은(는) Pro 요금제부터 쓸 수 있습니다`} action={<Link to="/settings?tab=billing"><Button>요금제 보기</Button></Link>}>
      Pro는 팀원 10명까지 월 29,000원(VAT 별도)이고, 요금제를 바꾸면 바로 열립니다.
    </Empty></Card>
  );
  return (
    <div className="min-h-[62vh] flex flex-col items-center justify-center text-center px-4">
      <span className="w-11 h-11 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><Lock size={18} /></span>
      <h2 className="mt-4 text-xl font-bold text-slate-900">{feature}</h2>
      <p className="mt-2 max-w-xl text-sm text-slate-600 leading-relaxed">{desc}</p>
      {!!points?.length && (
        <ul className="mt-4 space-y-1.5 text-[13px] text-slate-500">
          {points.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <p className="mt-3 text-sm text-slate-700"><b>Pro 요금제부터 사용할 수 있습니다.</b></p>
      <Link to="/settings?tab=billing" className="mt-5"><Button>요금제 보기</Button></Link>
    </div>
  );
}

function quadrant(p: PerfPoint) {
  if (p.withheld) return { label: '판단 보류', tone: 'text-slate-600 bg-slate-100' };
  const dx = p.x - p.prev_x, dy = p.y - p.prev_y;
  const moving = Math.hypot(dx, dy) > 5;
  const q = p.x >= 50 && p.y >= 50 ? '핵심 기여' : p.x < 50 && p.y >= 50 ? '성장 중' : p.x >= 50 ? '성장 정체' : '집중 지원';
  return { label: moving ? `${q}${dx + dy > 0 ? '로 이동 중' : ' · 하락 추세'}` : q, tone: q === '핵심 기여' ? 'text-indigo-700 bg-indigo-50' : q === '집중 지원' ? 'text-rose-700 bg-rose-50' : 'text-amber-800 bg-amber-50' };
}

function MemberCard({ teamId, p }: { teamId: string; p: PerfPoint }) {
  const tasks = useQuery({ queryKey: ['items', teamId, 'owner', p.user_id], queryFn: () => q<WorkItem[]>(supabase.from('work_items').select('*').eq('team_id', teamId).eq('owner_id', p.user_id).in('status', ['active', 'blocked', 'proposed']).not('parent_id', 'is', null).neq('measure', 'check').order('due_date')) });
  const scores = useQuery({ queryKey: ['scores', teamId, p.user_id], queryFn: () => q<{ score: number; scored_at: string }[]>(supabase.from('judgment_scores').select('score, scored_at').eq('team_id', teamId).eq('user_id', p.user_id).order('scored_at').limit(24)) });
  const comps = useQuery({
    queryKey: ['evidence-comp', teamId, p.user_id],
    queryFn: async () => {
      const rows = await q<{ competency: string | null; source: string }[]>(supabase.from('evidence').select('competency, source').eq('team_id', teamId).eq('subject_user_id', p.user_id).not('competency', 'is', null));
      const m = new Map<string, number>();
      rows.forEach((r) => m.set(r.competency!, (m.get(r.competency!) ?? 0) + 1));
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    },
  });
  const qd = quadrant(p);
  const sc = (scores.data ?? []).map((s) => Number(s.score));
  const maxC = Math.max(1, ...(comps.data ?? []).map(([, n]) => n));
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div><div className="font-semibold text-lg">{p.full_name} <span className="text-sm text-slate-400 font-normal">· {p.job_title}</span></div>
          <div className="text-xs text-slate-500 mt-0.5">판단 근거 {p.evidence}건</div></div>
        <span className={cx('text-xs font-semibold rounded-full px-2.5 py-1 inline-flex items-center gap-1', qd.tone)}><ArrowUpRight size={12} />{qd.label}</span>
      </div>
      <div className="mt-5 text-xs font-semibold text-slate-400">담당 과제</div>
      <div className="mt-2 space-y-3 text-sm">
        {!tasks.data?.length && <p className="text-slate-500">담당 과제가 없습니다.</p>}
        {(tasks.data ?? []).slice(0, 4).map((t) => (
          <div key={t.id}>
            <div className="flex justify-between gap-2"><span className="truncate">{t.title}</span><span className="font-mono num font-semibold">{t.progress}%</span></div>
            <div className="mt-1"><Bar value={t.progress} tone={t.status === 'blocked' ? 'amber' : 'indigo'} /></div>
            {t.due_date && <div className="text-[11px] text-slate-500 mt-1">마감 {fmtDate(t.due_date)}{t.base_due && t.base_due !== t.due_date && <span className="text-amber-700"> (처음 {fmtDate(t.base_due)})</span>}{t.status === 'blocked' && ' · 막힘'}{t.status === 'proposed' && ' · 검토 대기'}</div>}
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <div><div className="text-xs font-semibold text-slate-400">판단 깊이 추세</div><div className="text-[11px] text-slate-500">리뷰 결과물 기준 · {sc.length}건</div></div>
        <div className="flex items-center gap-1.5"><Sparkline values={sc} label="판단 깊이 추세" />{sc.length > 0 && <span className="font-mono text-xs font-semibold">{num(sc[sc.length - 1])}</span>}</div>
      </div>
      <div className="mt-5 text-xs font-semibold text-slate-400">역량별 근거</div>
      <div className="mt-2 space-y-2 text-xs">
        {!comps.data?.length && <p className="text-slate-500">역량이 태그된 근거가 아직 없습니다. 관찰 메모에 역량을 달거나 결과물이 리뷰되면 쌓입니다.</p>}
        {(comps.data ?? []).map(([c, n]) => (
          <div key={c} className="grid grid-cols-[84px_1fr_24px] items-center gap-2"><span className="truncate">{c}</span><Bar value={(n / maxC) * 100} tone={n < 3 ? 'slate' : 'indigo'} /><span className={cx('font-mono text-right', n < 3 && 'text-amber-700')}>{n}</span></div>
        ))}
        {(comps.data ?? []).some(([, n]) => n < 3) && <p className="text-amber-700 inline-flex items-center gap-1"><Info size={12} />3건 미만인 역량은 아직 판단하기 이릅니다</p>}
      </div>
    </Card>
  );
}

/** 실적 전망 — 목표별 전망 지도에서 고른 목표(또는 목표에 안 묶인 지표)의 sub 패널 */
function ForecastSection({ teamId, scope }: { teamId: string; scope: ForecastScope }) {
  const [metricId, setMetricId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const metrics = useQuery({ queryKey: ['metrics', teamId], queryFn: () => q<Metric[]>(supabase.from('metrics').select('*').eq('team_id', teamId).order('created_at')) });
  const list = (metrics.data ?? []).filter((m) => (scope.kind === 'goal' ? m.item_id === scope.goalId : m.id === scope.metricId));
  useEffect(() => { if (!list.some((m) => m.id === metricId)) setMetricId(list[0]?.id ?? null); }, [list, metricId]);
  const metric = list.find((m) => m.id === metricId) ?? null;
  const fc = useQuery({ queryKey: ['forecast', metricId], enabled: !!metricId, queryFn: () => q<Forecast>(supabase.rpc('metric_forecast', { p_metric: metricId })) });
  const note = useLatestAi<{ text: string }>(teamId, 'forecast_note', { ref_table: 'metrics', ref_id: metricId });
  const gen = useGenerate('ai-interpret');
  const toast = useToast();
  const f = fc.data;
  const prob = f?.probability ?? null;

  return (
    <ProvBlock kind="calc" className="bg-slate-50/80 rounded-xl ring-1 ring-slate-200 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">{metric ? `${metric.name} (${metric.cumulative ? '누적, ' : ''}${metric.unit})` : '실적 지표'}{' '}
            {f && !f.insufficient && <ProvChip kind="calc" sources={[`실적 ${f.months_of_data}개월`, `진행 중 딜 ${f.drivers?.pipeline_count ?? 0}건 (확률 가중)`, '월별 변동성으로 범위 계산']}
              level="L4" depth={Math.min(4, f.months_of_data)} note={`실적이 ${f.months_of_data}개월치입니다. 쌓일수록 범위가 좁아집니다.`} />}</h3>
          <p className="text-xs text-slate-500 mt-0.5">실선은 실적, 점선은 기준 전망, 음영은 비관~낙관 범위(80%)</p>
        </div>
        <div className="flex gap-1.5 text-xs flex-wrap">
          {list.length > 1 && list.map((m) => (
            <button key={m.id} onClick={() => setMetricId(m.id)} className={cx('border rounded-full px-2.5 py-1 bg-white', m.id === metricId ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>{m.name}</button>
          ))}
          {scope.kind === 'goal' && !!list.length && <button onClick={() => setNewOpen(true)} className="border border-dashed border-slate-300 rounded-full px-2.5 py-1 text-slate-500 inline-flex items-center gap-1 bg-white"><Plus size={12} />이 목표에 지표 연결</button>}
        </div>
      </div>
      {metrics.isLoading ? <Spinner /> : !list.length ? (
        <Empty icon={<Database size={18} />} title={scope.kind === 'goal' ? '이 목표에는 실적 지표가 없습니다' : '지표를 찾을 수 없습니다'} action={scope.kind === 'goal' ? <Button onClick={() => setNewOpen(true)}><Plus size={14} />지표 연결</Button> : undefined}>
          지금 달성 가능성은 하위 과제의 일정·진척으로 계산한 값입니다. 매출, 계약액, 고객 수처럼 숫자로 세는 결과를 연결하고 월별 실적을 넣으면, 마감 시점의 전망과 달성 확률을 실적 기준으로 계산합니다.
        </Empty>
      ) : !f ? <Spinner /> : f.insufficient ? (
        <Empty icon={<Database size={18} />} title="실적이 2개월 이상 쌓여야 전망을 낼 수 있습니다" action={<Button onClick={() => setDataOpen(true)}>실적 입력</Button>}>
          지금 {f.months_of_data}개월치가 있습니다.
        </Empty>
      ) : (
        <div className="mt-4 grid lg:grid-cols-3 gap-5 items-center">
          <div className="lg:col-span-2 overflow-x-auto min-w-0"><ForecastChart fc={f} /></div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white ring-1 ring-slate-200/70 p-3"><div className="text-xs text-slate-500">마감 기준 전망</div><div className="text-xl font-bold num mt-0.5">{num(f.base)}{f.unit}</div>{f.target != null && <div className="text-[11px] text-slate-500">목표의 {Math.round(((f.base ?? 0) / f.target) * 100)}%</div>}</div>
              <div className={cx('rounded-xl p-3', prob == null ? 'bg-white ring-1 ring-slate-200/70' : prob < 40 ? 'bg-rose-50' : prob < 60 ? 'bg-amber-50' : 'bg-emerald-50')}>
                <div className="text-xs text-slate-600">목표 달성 확률</div><div className="text-xl font-bold num mt-0.5">{prob ?? '-'}{prob != null && '%'}</div>
                {prob != null && prob < 60 && <div className="text-[11px] inline-flex items-center gap-1 text-amber-800"><AlertTriangle size={11} />주의</div>}
              </div>
            </div>
            <div className="text-xs text-slate-600 leading-relaxed">
              <div className="font-semibold text-slate-400 mb-1">이 숫자의 근거</div>
              · 지금까지 {f.cumulative ? '누적' : '최근'} {num(f.actual)}{f.unit}<br />
              · 최근 3개월 페이스 월 {num(f.drivers?.pace)}{f.unit} · 남은 {f.drivers?.remaining_months}개월<br />
              · 진행 중 딜 {f.drivers?.pipeline_count}건, 확률 가중 {num(f.drivers?.pipeline_weighted)}{f.unit}<br />
              · 범위 폭 {num(f.range_width)}{f.unit} (실적 {f.months_of_data}개월 기준)
            </div>
            <ProvBlock className="rounded-xl border border-violet-100 bg-violet-50/50 p-3 text-xs text-slate-700 leading-relaxed">
              {note.data ? (
                <><ProvChip kind={kindFromStatus(note.data.status)} label="AI 해석" sources={note.data.sources} level={note.data.level} depth={note.data.depth} note="숫자는 모델이 냈고, AI는 그 의미만 풀어 썼습니다." />
                  <p className="mt-2">{note.data.content.text}</p>
                  <button className="mt-1 text-violet-700" onClick={() => gen.mutate({ kind: 'forecast_note', team_id: teamId, metric_id: metricId })}>{gen.isPending ? '해석 중…' : '최신 숫자로 다시 해석'}</button></>
              ) : (
                <button className="text-violet-700 font-semibold" onClick={() => gen.mutate({ kind: 'forecast_note', team_id: teamId, metric_id: metricId })}>{gen.isPending ? '해석 중…' : <span className="inline-flex items-center gap-1"><AiIcon size={13} />해석 받기 · 1 크레딧</span>}</button>
              )}
            </ProvBlock>
            <button className="w-full text-xs font-semibold text-indigo-700 inline-flex items-center justify-center gap-1 py-1"
              onClick={() => {
                const line = `[${f.name}] 마감 전망 ${num(f.base)}${f.unit} (범위 ${num(f.low)}~${num(f.high)}${f.unit}${f.target != null ? `, 목표 ${f.target}${f.unit}, 달성 확률 ${prob ?? '-'}%` : ''}). `
                  + `근거: ${f.cumulative ? '누적' : '최근'} ${num(f.actual)}${f.unit}, 최근 3개월 월 ${num(f.drivers?.pace)}${f.unit}, 진행 중 딜 ${f.drivers?.pipeline_count}건(확률 가중 ${num(f.drivers?.pipeline_weighted)}${f.unit}).`
                  + (note.data ? ` ${note.data.content.text}` : '');
                navigator.clipboard.writeText(line); toast('본부장 보고용 문장을 복사했습니다');
              }}><Copy size={12} />보고용 문장 복사</button>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDataOpen(true)}>실적·딜 입력</Button>
              <Link to="/advisor" className="flex-1"><Button variant="soft" className="w-full"><Lightbulb size={14} />A·Team의 제안</Button></Link>
            </div>
          </div>
        </div>
      )}
      <NewMetricModal open={newOpen} presetItemId={scope.kind === 'goal' ? scope.goalId : null} onClose={() => setNewOpen(false)} onCreated={(id) => { setMetricId(id); setDataOpen(true); }} />
      {metric && <MetricDataModal metric={metric} open={dataOpen} onClose={() => setDataOpen(false)} />}
    </ProvBlock>
  );
}

type PerfTab = 'perf' | 'portfolio' | 'people';
const PERF_TABS: { id: PerfTab; label: string }[] = [{ id: 'perf', label: '목표별' }, { id: 'portfolio', label: '과제별' }, { id: 'people', label: '사람별' }];

export default function Perf() {
  const { team, hasFeature } = useTeam();
  const [params, setParams] = useSearchParams();
  const tab = (PERF_TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'perf') as PerfTab;
  const setTab = (t: PerfTab) => setParams((p) => { const n = new URLSearchParams(p); if (t === 'perf') n.delete('tab'); else n.set('tab', t); return n; }, { replace: true });
  const now = new Date();
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-sm shrink-0"><ScatterChart size={20} /></span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">팀 성과</h1>
          <p className="text-sm text-slate-500">{`${now.getFullYear()}년 ${Math.floor(now.getMonth() / 3) + 1}분기 · ${fmtDate(now.toISOString())} 기준 · 이대로 가면 어디에 떨어지는지, 시간은 어디에 쓰는지, 사람은 어디쯤인지`}</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} items={PERF_TABS} />
      {tab === 'perf' && <GoalMapSection renderForecast={(sc) => (hasFeature('forecast') ? <ForecastSection key={sc.kind === 'goal' ? sc.goalId : sc.metricId} teamId={team.id} scope={sc} /> : <Upsell feature="실적 전망" />)} />}
      {tab === 'portfolio' && <PortfolioSection teamId={team.id} />}
      {tab === 'people' && (hasFeature('perf_map') ? <PeopleSection /> : <Upsell feature="팀 성과 지도" />)}
    </section>
  );
}

/** 사람별 — 팀 성과 지도 + 고른 팀원 카드 */
function PeopleSection() {
  const { team } = useTeam();
  const [sel, setSel] = useState<string | null>(null);
  const map = useQuery({ queryKey: ['perf-map', team.id], queryFn: () => q<PerfPoint[]>(supabase.rpc('team_performance_map', { p_team: team.id })) });
  useEffect(() => { if (!sel && map.data?.length) setSel((map.data.find((p) => !p.withheld) ?? map.data[0]).user_id); }, [map.data, sel]);
  const selected = map.data?.find((p) => p.user_id === sel);
  return (
    <div className="grid lg:grid-cols-5 gap-4 items-stretch">
      <div className="lg:col-span-3 flex flex-col gap-2 min-w-0">
        <BoxTitle title={<>팀 성과 지도<ProvChip kind="calc" sources={['가로: 담당 과제 진척 + 결과물 승인 비율', '세로: 판단 깊이(리뷰) + 역량 근거의 폭', '이동 화살표: 90일 전 위치 → 지금']} level="L3" depth={3}
          note="위치는 통계로 계산합니다. AI가 사람에게 점수를 매기지 않습니다." /></>}
          hint="실적·진척(가로) × 판단 깊이·역량 근거(세로)" right={<span className="text-slate-500">○— 90일 전 → 지금 · ◌ 근거 부족</span>} />
        <ProvBlock kind="calc" className="flex-1 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="overflow-x-auto">
            {map.isLoading ? <Spinner /> : !map.data?.length ? <Empty title="팀원이 없습니다">팀원을 초대하면 위치가 표시됩니다.</Empty> : <PerfMap points={map.data} selected={sel} onSelect={setSel} />}
          </div>
          <p className="text-xs text-slate-500 mt-2">판단 근거가 {String((team.settings?.min_judgment_evidence as number) ?? 8)}건 미만이면 위치를 매기지 않고 판단을 보류합니다.</p>
        </ProvBlock>
      </div>
      <div className="lg:col-span-2 flex flex-col gap-2 min-w-0">
        <BoxTitle title="선택한 팀원" hint="지도에서 고르면 바뀝니다" />
        <div className="flex-1">{selected ? <MemberCard teamId={team.id} p={selected} /> : <Card className="p-5 text-sm text-slate-500">지도에서 팀원을 고르세요.</Card>}</div>
      </div>
    </div>
  );
}

/** 과제 포트폴리오 — 미션 기여도 × 팀 시간 투입 (팀 전략 페이지에서 옮겨 옴) */
function PortfolioSection({ teamId }: { teamId: string }) {
  const port = useQuery({ queryKey: ['portfolio', teamId], queryFn: () => q<PortfolioRow[]>(supabase.rpc('task_portfolio', { p_team: teamId })) });
  return (
    <div className="space-y-2">
      <BoxTitle title={<>과제 포트폴리오<ProvChip kind="calc" sources={['팀 시간 = 과제별 배분율 × 사람별 주당 가용 시간 (없으면 예상 공수)', '미션 기여도 = 팀장이 매긴 1~5']} level="L4" depth={2} /></>}
        hint="미션 기여도 × 팀 시간 투입 — 기여도는 낮은데 시간이 많이 드는 과제가 줄일 후보입니다"
        right={<Link to="/goals/edit" className="text-indigo-700 font-semibold">공수·기여도 고치기 →</Link>} />
      <ProvBlock kind="calc" className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="overflow-x-auto">{port.isLoading ? <Spinner /> : port.data?.length ? <div className="max-w-3xl mx-auto"><PortfolioChart rows={port.data} /></div> : <p className="text-sm text-slate-500 py-6">진행 중인 과제가 없습니다.</p>}</div>
      </ProvBlock>
    </div>
  );
}
