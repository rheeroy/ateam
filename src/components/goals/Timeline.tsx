// 타임라인: 처음 계획(회색) 위에 지금 계획(막대). 막대를 끌어 옮기고, 오른쪽 끝을 끌어 마감을 바꾼다.
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTeam } from '../../state/session';
import type { WorkItem } from '../../lib/types';
import { isOverdue, useItemMutations, type Node } from '../../lib/items';
import { cx, fmtShort } from '../../lib/format';

const DAY = 86400000;
const toT = (d: string) => Date.parse(d + 'T00:00:00Z');
const toD = (t: number) => new Date(t).toISOString().slice(0, 10);
const ROW = 36;

export function Timeline({ rows, collapsed, toggle, onOpen, canEditItem }: {
  rows: Node[]; collapsed: Set<string>; toggle: (id: string) => void; onOpen: (id: string) => void; canEditItem: (n: WorkItem) => boolean;
}) {
  const { team } = useTeam();
  const { update } = useItemMutations(team.id);
  const today = toT(new Date().toISOString().slice(0, 10));
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'end'; x0: number; s0: number; e0: number; ds: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);

  const { start, days } = useMemo(() => {
    const ts: number[] = [today];
    for (const n of rows) for (const d of [n.start_date, n.due_date, n.base_start, n.base_due]) if (d) ts.push(toT(d));
    const s = Math.min(...ts) - 7 * DAY; const e = Math.max(...ts) + 21 * DAY;
    const first = new Date(s); const s1 = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
    return { start: s1, days: Math.max(90, Math.ceil((e - s1) / DAY)) };
  }, [rows, today]);
  const pxPerDay = days > 240 ? 4 : days > 150 ? 6 : 9;
  const W = days * pxPerDay;
  const X = (t: number) => ((t - start) / DAY) * pxPerDay;
  const months: { x: number; label: string }[] = [];
  for (let d = new Date(start); d.getTime() < start + days * DAY; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push({ x: X(d.getTime()), label: `${d.getUTCMonth() + 1}월` });
  }

  const onDown = (e: PointerEvent, n: WorkItem, mode: 'move' | 'end') => {
    if (!canEditItem(n) || !n.due_date) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: n.id, mode, x0: e.clientX, s0: toT(n.start_date ?? n.due_date), e0: toT(n.due_date), ds: 0 });
  };
  const onMove = (e: PointerEvent) => { if (drag) setDrag({ ...drag, ds: Math.round((e.clientX - drag.x0) / pxPerDay) }); };
  const onUp = () => {
    if (!drag) return;
    const n = rows.find((r) => r.id === drag.id)!;
    if (drag.ds) {
      const patch: Partial<WorkItem> & { change_reason?: string } = { change_reason: '타임라인에서 조정' };
      if (drag.mode === 'move') { if (n.start_date) patch.start_date = toD(drag.s0 + drag.ds * DAY); patch.due_date = toD(drag.e0 + drag.ds * DAY); }
      else patch.due_date = toD(Math.max(drag.s0, drag.e0 + drag.ds * DAY));
      update.mutate({ id: n.id, patch });
    }
    setDrag(null);
  };
  const setDates = (e: React.MouseEvent, n: WorkItem) => {
    if (!canEditItem(n) || n.due_date) return;
    const r = area.current!.getBoundingClientRect();
    const day = Math.floor((e.clientX - r.left + area.current!.scrollLeft) / pxPerDay);
    const s = start + day * DAY;
    update.mutate({ id: n.id, patch: { start_date: toD(s), due_date: toD(s + 14 * DAY) } });
  };

  return (
    <div className="flex text-sm select-none" onPointerMove={onMove} onPointerUp={onUp}>
      <div className="w-56 sm:w-72 shrink-0 border-r border-slate-200">
        <div className="h-9 border-b border-slate-200 px-3 flex items-center text-xs text-slate-500">항목</div>
        {rows.map((n) => (
          <div key={n.id} className="flex items-center gap-1.5 border-b border-slate-100 pr-2" style={{ height: ROW, paddingLeft: 6 + n.depth * 16 }}>
            <button className={cx('text-slate-400', !n.children.length && 'invisible')} onClick={() => toggle(n.id)} aria-label="펼치기/접기">
              {collapsed.has(n.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
            <button className={cx('truncate text-left flex-1', n.depth === 0 && 'font-semibold')} onClick={() => onOpen(n.id)}>{n.title}</button>
          </div>
        ))}
      </div>
      <div ref={area} className="flex-1 overflow-x-auto">
        <div style={{ width: W }} className="relative">
          <div className="h-9 border-b border-slate-200 relative">
            {months.map((m) => <div key={m.x} className="absolute top-0 h-full border-l border-slate-200 text-xs text-slate-500 pl-1.5 pt-2.5" style={{ left: m.x }}>{m.label}</div>)}
          </div>
          <div className="absolute top-9 bottom-0 border-l-2 border-rose-400/70 z-10 pointer-events-none" style={{ left: X(today) }}>
            <span className="absolute -top-0 -translate-x-1/2 text-[10px] text-rose-500 bg-white px-1">오늘</span></div>
          {months.map((m) => <div key={'g' + m.x} className="absolute top-9 bottom-0 border-l border-slate-100" style={{ left: m.x }} />)}
          {rows.map((n) => {
            const d = drag?.id === n.id ? drag : null;
            const s = n.due_date ? (n.start_date ? toT(n.start_date) : toT(n.due_date) - 3 * DAY) : null;
            const e = n.due_date ? toT(n.due_date) : null;
            const s1 = s != null && d ? (d.mode === 'move' ? s + d.ds * DAY : s) : s;
            const e1 = e != null && d ? e + d.ds * DAY : e;
            const over = isOverdue(n);
            const tone = n.status === 'done' ? 'bg-emerald-500' : n.status === 'blocked' || over ? 'bg-rose-500' : n.status === 'proposed' || n.status === 'changes_requested' ? 'bg-violet-400' : 'bg-indigo-500';
            return (
              <div key={n.id} className="relative border-b border-slate-100" style={{ height: ROW }} onDoubleClick={(ev) => setDates(ev, n)}
                title={!n.due_date && canEditItem(n) ? '두 번 눌러 날짜 정하기' : undefined}>
                {n.base_due && (
                  <div className="absolute top-[22px] h-1.5 rounded-full bg-slate-300/80" title={`처음 계획 ${fmtShort(n.base_start)}~${fmtShort(n.base_due)}`}
                    style={{ left: X(n.base_start ? toT(n.base_start) : toT(n.base_due) - 3 * DAY), width: Math.max(4, X(toT(n.base_due) + DAY) - X(n.base_start ? toT(n.base_start) : toT(n.base_due) - 3 * DAY)) }} />
                )}
                {s1 != null && e1 != null ? (
                  <div className={cx('absolute top-[7px] h-[14px] rounded-md overflow-hidden', canEditItem(n) && 'cursor-grab active:cursor-grabbing')}
                    style={{ left: X(s1), width: Math.max(8, X(e1 + DAY) - X(s1)) }}
                    onPointerDown={(ev) => onDown(ev, n, 'move')} title={`${n.title} · ${fmtShort(toD(s1))}~${fmtShort(toD(e1))} · ${n.progress}%`}>
                    <div className={cx('absolute inset-0 opacity-30', tone)} />
                    <div className={cx('absolute inset-y-0 left-0', tone)} style={{ width: `${n.progress}%` }} />
                    {canEditItem(n) && <div className="absolute right-0 inset-y-0 w-2 cursor-ew-resize bg-black/10" onPointerDown={(ev) => onDown(ev, n, 'end')} />}
                  </div>
                ) : <div className="absolute top-[9px] left-2 text-[11px] text-slate-400">날짜 없음{canEditItem(n) ? ' · 두 번 눌러 정하기' : ''}</div>}
                {d && d.ds !== 0 && e1 != null && <span className="absolute top-0 text-[10px] text-indigo-700 font-semibold" style={{ left: X(e1 + DAY) + 4 }}>{fmtShort(toD(e1))}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
