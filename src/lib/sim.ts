// What-if 시뮬레이터 (결정론적 모델). 같은 입력이면 언제나 같은 결과.
// ⑭ 용량 모델: 과제별 주당 시간 = Σ(배분율 × 사람별 가용 시간) 또는 예상 공수
// 목표 달성 확률: logit(p') = logit(p) + 1.6·ln(시간 비율) − 0.35·지연 주수
// 실적 지표: 남은 실적 × (1+수요 변화) × 시간 비율^0.7 × 지연 계수
import type { Forecast, GoalOutlook, Task, TeamMember } from './types';

export interface Allocation { task_id: string; user_id: string; share_pct: number }
export interface SimBase {
  goals: GoalOutlook[];
  tasks: Task[];
  allocations: Allocation[];
  members: TeamMember[];
  forecast: Forecast | null;
  metricGoalId: string | null;
}
export interface SimInput {
  hc: number; // 일반 충원(+)/감원(−) 인원
  leave: string | null; // 이탈하는 팀원
  reallocFrom: string | null; reallocTo: string | null; reallocPct: number; // 과제 간 시간 이동
  delayGoal: string | null; delayWeeks: number; // 외부 지연
  demand: number; // 시장 수요 변화 %
  budget: number; // 팀 예산 변화 %
}
export const BASE_INPUT: SimInput = { hc: 0, leave: null, reallocFrom: null, reallocTo: null, reallocPct: 0, delayGoal: null, delayWeeks: 0, demand: 0, budget: 0 };

export interface SimResult {
  goals: { id: string; title: string; base: number | null; value: number | null }[];
  metric: { base: number; low: number; high: number; prob: number | null; baseValue: number; baseProb: number | null; unit: string; target: number | null; name: string } | null;
  hours: { before: number; after: number };
}

const NEW_HIRE_HOURS = 40;
const RAMP = 0.5; // 첫 분기 생산성
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function taskHours(base: SimBase): Map<string, number> {
  const hrs = new Map<string, number>();
  const wh = new Map(base.members.map((m) => [m.user_id, Number(m.weekly_hours) || 40]));
  for (const t of base.tasks) {
    const al = base.allocations.filter((a) => a.task_id === t.id);
    const h = al.length ? al.reduce((s, a) => s + (a.share_pct / 100) * (wh.get(a.user_id) ?? 40), 0) : Number(t.est_hours_per_week ?? 0);
    hrs.set(t.id, h);
  }
  return hrs;
}

function goalHours(tasks: Task[], hrs: Map<string, number>) {
  const g = new Map<string, number>();
  for (const t of tasks) if (t.goal_id) g.set(t.goal_id, (g.get(t.goal_id) ?? 0) + (hrs.get(t.id) ?? 0));
  return g;
}

export function simulate(base: SimBase, inp: SimInput): SimResult {
  const h0 = taskHours(base);
  const h1 = new Map(h0);
  const wh = new Map(base.members.map((m) => [m.user_id, Number(m.weekly_hours) || 40]));

  // 이탈: 그 사람이 맡던 시간이 빠진다
  if (inp.leave) {
    for (const t of base.tasks) {
      const al = base.allocations.filter((a) => a.task_id === t.id);
      if (al.length) {
        const mine = al.find((a) => a.user_id === inp.leave);
        if (mine) h1.set(t.id, Math.max(0, (h1.get(t.id) ?? 0) - (mine.share_pct / 100) * (wh.get(inp.leave) ?? 40)));
      } else if (t.owner_id === inp.leave) {
        h1.set(t.id, (h1.get(t.id) ?? 0) * 0.2); // 인수인계 전까지 20%만 유지
      }
    }
  }
  // 예산: 외주·도구 축소가 실행 여력에 일부 반영
  if (inp.budget) for (const [k, v] of h1) h1.set(k, v * (1 + (inp.budget / 100) * 0.3));
  // 재배치
  if (inp.reallocFrom && inp.reallocTo && inp.reallocPct > 0 && inp.reallocFrom !== inp.reallocTo) {
    const moved = (h1.get(inp.reallocFrom) ?? 0) * (inp.reallocPct / 100);
    h1.set(inp.reallocFrom, (h1.get(inp.reallocFrom) ?? 0) - moved);
    h1.set(inp.reallocTo, (h1.get(inp.reallocTo) ?? 0) + moved);
  }
  // 인력 변동
  const total1 = [...h1.values()].reduce((a, b) => a + b, 0);
  if (inp.hc < 0 && total1 > 0) {
    const cut = Math.min(total1, NEW_HIRE_HOURS * -inp.hc);
    for (const [k, v] of h1) h1.set(k, v - cut * (v / total1));
  }
  const g0 = goalHours(base.tasks, h0);
  if (inp.hc > 0) {
    // 충원 인력은 전망이 가장 낮은 목표에 배치한다고 가정
    const target = [...base.goals].filter((g) => g.probability != null).sort((a, b) => (a.probability ?? 0) - (b.probability ?? 0))[0];
    const tTask = base.tasks.filter((t) => t.goal_id === target?.goal_id).sort((a, b) => a.priority - b.priority)[0];
    if (tTask) h1.set(tTask.id, (h1.get(tTask.id) ?? 0) + NEW_HIRE_HOURS * RAMP * inp.hc);
  }
  const g1 = goalHours(base.tasks, h1);
  // 시간이 늘어도 효과는 체감한다 (상한 1.8배), 줄어드는 쪽은 그대로 반영
  const ratioOf = (gid: string) => {
    const a = g0.get(gid) ?? 0, b = g1.get(gid) ?? 0;
    if (a <= 0) return b > 0 ? 1.3 : 1;
    return clamp(b / a, 0.05, 1.8);
  };

  // 실적 지표
  let metric: SimResult['metric'] = null;
  const fc = base.forecast;
  if (fc && !fc.insufficient && fc.base != null && fc.actual != null && fc.low != null && fc.high != null) {
    const ratio = base.metricGoalId ? ratioOf(base.metricGoalId) : 1;
    const remainingMonths = Math.max(1, fc.drivers?.remaining_months ?? 1);
    const delayF = inp.delayGoal && inp.delayGoal === base.metricGoalId ? Math.max(0, 1 - inp.delayWeeks / (remainingMonths * 4.33)) : 1;
    const r0 = fc.base - fc.actual;
    const r1 = r0 * (1 + inp.demand / 100) * Math.pow(ratio, ratio > 1 ? 0.5 : 0.7) * delayF;
    const b1 = fc.actual + r1;
    const sigma0 = Math.max(0.0001, (fc.high - fc.low) / 2 / 1.28);
    const sigma1 = sigma0 * (1 + (Math.abs(inp.demand) / 100) * 0.5) * (inp.delayWeeks && delayF < 1 ? 1.15 : 1);
    const prob = (b: number, s: number) => fc.target == null ? null : Math.round(clamp(100 * sigmoid(1.702 * ((b - fc.target) / s)), 1, 99));
    metric = {
      name: fc.name, unit: fc.unit, target: fc.target,
      base: b1, low: b1 - 1.28 * sigma1, high: b1 + 1.28 * sigma1, prob: prob(b1, sigma1),
      baseValue: fc.base, baseProb: fc.probability ?? prob(fc.base, sigma0),
    };
  }

  const goals = base.goals.map((g) => {
    if (g.probability == null) return { id: g.goal_id, title: g.title, base: null, value: null };
    if (metric && g.goal_id === base.metricGoalId && g.basis === 'metric') {
      return { id: g.goal_id, title: g.title, base: g.probability, value: metric.prob };
    }
    const p0 = clamp(g.probability, 3, 97) / 100;
    const r = ratioOf(g.goal_id);
    let x = logit(p0) + (r > 1 ? 1.2 : 1.6) * Math.log(r);
    if (inp.delayGoal === g.goal_id) x -= 0.35 * inp.delayWeeks;
    if (inp.demand && g.goal_id === base.metricGoalId) x += (inp.demand / 100) * 1.2;
    return { id: g.goal_id, title: g.title, base: g.probability, value: Math.round(clamp(sigmoid(x) * 100, 3, 97)) };
  });

  return {
    goals, metric,
    hours: { before: [...h0.values()].reduce((a, b) => a + b, 0), after: [...h1.values()].reduce((a, b) => a + b, 0) },
  };
}

/** 표준 충격별 실적 변화 (민감도) */
export function sensitivity(base: SimBase): { label: string; value: number }[] {
  if (!base.forecast || base.forecast.insufficient) return [];
  const b = simulate(base, BASE_INPUT).metric?.base ?? 0;
  const rows: { label: string; inp: Partial<SimInput> }[] = [];
  if (base.metricGoalId) rows.push({ label: '외부 지연 4주', inp: { delayGoal: base.metricGoalId, delayWeeks: 4 } });
  rows.push({ label: '수요 −20%', inp: { demand: -20 } });
  rows.push({ label: '1명 충원', inp: { hc: 1 } });
  const h = taskHours(base);
  const low = [...base.tasks].filter((t) => (h.get(t.id) ?? 0) > 0 && t.mission_contribution <= 2).sort((a, b2) => a.mission_contribution - b2.mission_contribution)[0];
  const top = base.tasks.filter((t) => t.goal_id === base.metricGoalId).sort((a, b2) => a.priority - b2.priority)[0];
  if (low && top) rows.push({ label: `${low.title.slice(0, 8)} 절반 재배치`, inp: { reallocFrom: low.id, reallocTo: top.id, reallocPct: 50 } });
  rows.push({ label: '예산 −20%', inp: { budget: -20 } });
  const key = keyPerson(base);
  if (key) rows.push({ label: `${key.name} 이탈`, inp: { leave: key.id } });
  return rows
    .map((r) => ({ label: r.label, value: (simulate(base, { ...BASE_INPUT, ...r.inp }).metric?.base ?? b) - b }))
    .sort((a, b2) => Math.abs(b2.value) - Math.abs(a.value));
}

/** 지표 목표에 가장 많은 시간을 쓰는 사람 */
export function keyPerson(base: SimBase): { id: string; name: string } | null {
  const wh = new Map(base.members.map((m) => [m.user_id, Number(m.weekly_hours) || 40]));
  const score = new Map<string, number>();
  for (const t of base.tasks.filter((x) => !base.metricGoalId || x.goal_id === base.metricGoalId)) {
    const al = base.allocations.filter((a) => a.task_id === t.id);
    if (al.length) al.forEach((a) => score.set(a.user_id, (score.get(a.user_id) ?? 0) + (a.share_pct / 100) * (wh.get(a.user_id) ?? 40)));
    else if (t.owner_id) score.set(t.owner_id, (score.get(t.owner_id) ?? 0) + Number(t.est_hours_per_week ?? 1));
  }
  const top = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const m = base.members.find((x) => x.user_id === top[0]);
  return { id: top[0], name: m?.profiles?.full_name ?? '' };
}
