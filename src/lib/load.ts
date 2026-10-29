// 업무 부하 계산 — 팀원관리 8주 흐름(히트맵)
//   부하 = 그 기간에 진행 중인 '맨 아래 과제'의 주간 예상 시간 합 ÷ 주 근무시간
//   (지표 · 최상위 목표는 일이 아니라 세지 않는다. 하위 과제가 있으면 하위만 센다)
//   주간 예상 시간이 비어 있는 과제는 EST_DEFAULT 시간으로 잡고 '추정치'로 표시한다
import type { WorkItem } from './types';

export const EST_DEFAULT = 3;
const LIVE = (s: string) => !['dropped', 'proposed', 'changes_requested'].includes(s);

/** 일로 세는 과제 (맨 아래 · 지표 아님 · 최상위 아님) */
export function workLeaves(items: WorkItem[]): WorkItem[] {
  const live = items.filter((x) => LIVE(x.status));
  const parents = new Set(live.map((x) => x.parent_id).filter(Boolean) as string[]);
  return live.filter((x) => x.parent_id && x.role !== 'metric' && !parents.has(x.id) && x.measure !== 'recurring');
}

/** 그 기간에 진행 중이었나 (시작 ≤ 기간 끝, 끝남 ≥ 기간 시작) */
export function activeIn(x: WorkItem, from: string, to: string): boolean {
  const start = (x.start_date ?? x.created_at).slice(0, 10);
  const end = x.status === 'done' ? (x.done_at ?? x.updated_at).slice(0, 10) : '9999-12-31';
  return start <= to && end >= from;
}

export interface Load { hours: number; estimated: boolean; items: WorkItem[] }
export function loadOf(leaves: WorkItem[], uid: string, from: string, to: string, exclude?: string | null): Load {
  const mine = leaves.filter((x) => x.owner_id === uid && x.id !== exclude && activeIn(x, from, to));
  return {
    hours: mine.reduce((a, x) => a + (x.est_hours_per_week ?? EST_DEFAULT), 0),
    estimated: mine.some((x) => x.est_hours_per_week == null),
    items: mine,
  };
}
export const pct = (hours: number, weekly: number | null | undefined) => Math.round((100 * hours) / Math.max(1, weekly || 40));

/** 최근 n주 월요일들 (오래된 것부터, 마지막이 이번 주) */
export function lastMondays(n: number, today = new Date()): string[] {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return Array.from({ length: n }, (_, i) => new Date(d.getTime() - (n - 1 - i) * 7 * 86400000).toISOString().slice(0, 10));
}
export const addDays = (ymd: string, k: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);

