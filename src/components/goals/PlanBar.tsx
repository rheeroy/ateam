// 계획 대비 달성도 막대: 채움 = 실제 진척, 세로 눈금 = 오늘까지의 계획
import type { WorkItem } from '../../lib/types';
import { GAP_TONE, planGap } from '../../lib/plan';
import { cx } from '../../lib/format';

export function PlanBar({ item, compact }: { item: Pick<WorkItem, 'base_start' | 'base_due' | 'start_date' | 'due_date' | 'created_at' | 'measure' | 'progress' | 'status'>; compact?: boolean }) {
  const g = planGap(item);
  const tone = GAP_TONE[g.tone];
  return (
    <div className="min-w-0" title={g.plan == null ? `실제 ${g.actual}% · 일정이 없어 계획과 비교할 수 없음` : `계획 ${g.plan}% · 실제 ${g.actual}% (${g.gap! >= 0 ? '+' : ''}${g.gap})`}>
      <div className="relative h-1.5 rounded-full bg-slate-100">
        <div className={cx('absolute inset-y-0 left-0 rounded-full', tone.bar)} style={{ width: `${Math.min(100, g.actual)}%` }} />
        {g.plan != null && <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-800 rounded" style={{ left: `calc(${Math.min(100, g.plan)}% - 1px)` }} />}
      </div>
      <div className={cx('mt-1 flex items-center gap-1 text-[11px] num', compact && 'text-[10px]')}>
        <span className="font-semibold text-slate-800">{g.actual}%</span>
        {g.plan != null ? <span className="text-slate-400">/ 계획 {g.plan}%</span> : <span className="text-slate-400">· 일정 없음</span>}
        {g.gap != null && item.status !== 'done' && Math.abs(g.gap) >= 1 && <span className={cx('ml-auto font-semibold', tone.text)}>{g.gap > 0 ? '+' : '−'}{Math.abs(g.gap)}</span>}
      </div>
    </div>
  );
}
