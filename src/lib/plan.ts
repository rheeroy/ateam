// 계획 대비 달성도: 오늘까지 와 있어야 할 진척(계획)과 실제 진척을 비교
import type { WorkItem } from './types';

const DAY = 86400000;
const t = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z');
export const todayT = () => t(new Date().toISOString());

/** 계획상 오늘까지의 진척 % (처음 계획이 있으면 그것 기준) — 날짜가 없으면 null */
export function plannedPct(n: Pick<WorkItem, 'base_start' | 'base_due' | 'start_date' | 'due_date' | 'created_at' | 'measure'>, now = todayT()): number | null {
  if (n.measure === 'recurring') return null;
  const e = n.base_due ?? n.due_date;
  if (!e) return null;
  const s = n.base_start ?? n.start_date ?? n.created_at;
  const S = t(s), E = t(e) + DAY;
  if (E <= S) return now >= E ? 100 : 0;
  return Math.round(Math.max(0, Math.min(1, (now - S) / (E - S))) * 100);
}

export interface PlanGap { plan: number | null; actual: number; gap: number | null; tone: 'ahead' | 'ok' | 'behind' | 'late' | 'none' }
export function planGap(n: Pick<WorkItem, 'base_start' | 'base_due' | 'start_date' | 'due_date' | 'created_at' | 'measure' | 'progress' | 'status'>): PlanGap {
  const actual = n.status === 'done' ? 100 : n.progress;
  const plan = plannedPct(n);
  if (plan == null) return { plan, actual, gap: null, tone: 'none' };
  const gap = actual - plan;
  const tone = n.status === 'done' ? 'ok' : gap <= -20 ? 'late' : gap <= -8 ? 'behind' : gap >= 8 ? 'ahead' : 'ok';
  return { plan, actual, gap, tone };
}
export const GAP_TONE: Record<PlanGap['tone'], { bar: string; text: string; label: string }> = {
  ahead: { bar: 'bg-emerald-500', text: 'text-emerald-700', label: '앞섬' },
  ok: { bar: 'bg-indigo-500', text: 'text-slate-600', label: '계획대로' },
  behind: { bar: 'bg-amber-500', text: 'text-amber-700', label: '조금 늦음' },
  late: { bar: 'bg-rose-500', text: 'text-rose-600', label: '늦음' },
  none: { bar: 'bg-slate-400', text: 'text-slate-400', label: '일정 없음' },
};

/** 항목이 속한 연도 — 최상위 목표의 시작(없으면 마감·생성) 연도를 따른다 (하반기 목표가 다음 해 1월에 끝나도 시작한 해의 목표) */
export function yearOf(n: Pick<WorkItem, 'due_date' | 'base_due' | 'start_date' | 'base_start' | 'created_at'>): number {
  const d = n.start_date ?? n.base_start ?? n.due_date ?? n.base_due ?? n.created_at;
  return Number(d.slice(0, 4));
}
