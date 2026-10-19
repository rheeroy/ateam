// 아웃라인: 문서 쓰듯 편집 (Enter 저장·다음 줄 · Tab 들여쓰기 · Shift+Tab 내어쓰기 · 끌어서 이동)
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, Crosshair, GripVertical, MoreHorizontal, Plus, RotateCcw } from 'lucide-react';
import { currentLabel, usePendingCheckins } from '../../lib/checkin';
import { useTeam } from '../../state/session';
import type { WorkItem } from '../../lib/types';
import { STATUS_META, isOverdue, measureText, slipDays, sortBetween, useItemMutations, useLevelNames, type Node } from '../../lib/items';
import { cx, fmtShort } from '../../lib/format';
import { Avatar, Pill } from '../ui';

interface Props {
  rootDefaults?: Partial<WorkItem>;   // 최상위 항목을 새로 만들 때 덧붙일 값 (연도 판의 날짜 등)
  addRootSignal?: number;              // 바뀌면 최상위 추가 줄을 연다
  rows: Node[];                       // 화면에 보일 순서 (접힘·필터 반영)
  byId: Map<string, Node>;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onOpen: (id: string) => void;
  canEditItem: (n: WorkItem) => boolean;
  /** 진척·상태 (없으면 canEditItem) */
  canProgress?: (n: WorkItem) => boolean;
  canAddUnder: (parent: Node | null) => boolean;
  canStructure: boolean;
  dim?: (n: Node) => boolean;         // 맥락용으로만 보이는 항목
}

export function Outline({ rows, byId, collapsed, toggle, onOpen, canEditItem, canProgress = canEditItem, canAddUnder, canStructure, dim, rootDefaults, addRootSignal }: Props) {
  const { team, uid, isLeader, members, nameOf } = useTeam();
  const levelName = useLevelNames();
  const pendingCk = usePendingCheckins();
  const { update, create } = useItemMutations(team.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | 'root' | null>(null);  // 부모 id
  useEffect(() => { if (addRootSignal) setAdding('root'); }, [addRootSignal]);
  const [drag, setDrag] = useState<{ id: string; over?: string; pos?: 'before' | 'after' | 'inside' } | null>(null);

  const siblingsOf = (n: Node) => (n.parent_id ? byId.get(n.parent_id)?.children ?? [] : [...byId.values()].filter((x) => !x.parent_id).sort((a, b) => a.sort - b.sort));

  const indent = (n: Node) => {
    const sib = siblingsOf(n); const i = sib.findIndex((x) => x.id === n.id);
    if (i <= 0) return;
    const prev = sib[i - 1];
    update.mutate({ id: n.id, patch: { parent_id: prev.id, sort: sortBetween(prev.children.at(-1)?.sort, undefined) } });
    if (collapsed.has(prev.id)) toggle(prev.id);
  };
  const outdent = (n: Node) => {
    if (!n.parent_id) return;
    const parent = byId.get(n.parent_id)!;
    const sib = siblingsOf(parent); const i = sib.findIndex((x) => x.id === parent.id);
    update.mutate({ id: n.id, patch: { parent_id: parent.parent_id, sort: sortBetween(parent.sort, sib[i + 1]?.sort) } });
  };
  const addChild = (parentId: string | null, title: string) => {
    const parent = parentId ? byId.get(parentId) ?? null : null;
    const kids = parent ? parent.children : [...byId.values()].filter((x) => !x.parent_id);
    const owner = isLeader ? (parent?.owner_id ?? uid) : uid;
    create.mutate({
      parent_id: parentId, title, owner_id: owner, sort: sortBetween(kids.at(-1)?.sort, undefined),
      measure: parent && parent.depth >= 1 ? 'check' : parent ? 'percent' : 'children',
      status: isLeader || (parent && parent.depth >= 1) ? 'active' : 'proposed',   // 팀원의 할 일은 바로 진행, 목표·과제는 승인 대기
      ...(parentId ? {} : rootDefaults ?? {}),
    });
    if (parentId && collapsed.has(parentId)) toggle(parentId);
  };
  const drop = () => {
    if (!drag?.over || drag.over === drag.id || !drag.pos) return setDrag(null);
    const t = byId.get(drag.over)!; const moving = byId.get(drag.id)!;
    if (t.path.includes(moving.id)) return setDrag(null);    // 자기 하위로는 못 감
    if (drag.pos === 'inside') {
      update.mutate({ id: moving.id, patch: { parent_id: t.id, sort: sortBetween(t.children.at(-1)?.sort, undefined) } });
    } else {
      const sib = siblingsOf(t).filter((x) => x.id !== moving.id); const i = sib.findIndex((x) => x.id === t.id);
      const sort = drag.pos === 'before' ? sortBetween(sib[i - 1]?.sort, t.sort) : sortBetween(t.sort, sib[i + 1]?.sort);
      update.mutate({ id: moving.id, patch: { parent_id: t.parent_id, sort } });
    }
    setDrag(null);
  };

  return (
    <div role="tree" aria-label="목표·과제" className="text-sm [--indent:12px] sm:[--indent:22px]">
      {rows.map((n) => {
        const editable = canEditItem(n);
        const st = STATUS_META[n.status];
        const slip = slipDays(n);
        const over = isOverdue(n);
        const isDrop = drag?.over === n.id && drag.id !== n.id;
        return (
          <div key={n.id}>
            <div role="treeitem" aria-level={n.depth + 1} aria-expanded={n.children.length ? !collapsed.has(n.id) : undefined}
              className={cx('group relative flex items-center gap-2 pr-3 py-2 border-b border-slate-100 hover:bg-slate-50',
                dim?.(n) && 'opacity-55', n.status === 'done' && 'text-slate-500',
                isDrop && drag?.pos === 'before' && 'shadow-[inset_0_2px_0_#6366F1]', isDrop && drag?.pos === 'after' && 'shadow-[inset_0_-2px_0_#6366F1]',
                isDrop && drag?.pos === 'inside' && 'bg-indigo-50')}
              style={{ paddingLeft: `calc(8px + ${n.depth} * var(--indent))` }}
              onDragOver={(e) => {
                if (!drag) return; e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height;
                setDrag({ ...drag, over: n.id, pos: y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside' });
              }}
              onDrop={(e) => { e.preventDefault(); drop(); }}>
              {canStructure ? (
                <span draggable onDragStart={() => setDrag({ id: n.id })} onDragEnd={() => setDrag(null)} title="끌어서 옮기기"
                  className="cursor-grab text-slate-300 opacity-0 group-hover:opacity-100 -ml-1"><GripVertical size={14} /></span>
              ) : <span className="w-[10px]" />}
              <button className={cx('w-4 text-slate-400', !n.children.length && 'invisible')} onClick={() => toggle(n.id)} aria-label={collapsed.has(n.id) ? '펼치기' : '접기'}>
                {collapsed.has(n.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
              {/* 진척 */}
              {n.measure === 'check' ? (
                <input type="checkbox" className="accent-indigo-600 w-4 h-4 shrink-0" checked={n.status === 'done'} disabled={!canProgress(n) || n.status === 'proposed' || n.status === 'changes_requested'}
                  aria-label="완료" onChange={(e) => update.mutate({ id: n.id, patch: { status: e.target.checked ? 'done' : 'active' } })} />
              ) : (
                <span className="relative w-4 h-4 shrink-0" title={measureText(n)}>
                  <svg viewBox="0 0 20 20" className="w-4 h-4 -rotate-90"><circle cx="10" cy="10" r="8" fill="none" stroke="#E2E8F0" strokeWidth="3" />
                    <circle cx="10" cy="10" r="8" fill="none" stroke={n.status === 'done' ? '#10B981' : n.status === 'blocked' ? '#F43F5E' : '#6366F1'} strokeWidth="3"
                      strokeDasharray={`${(n.progress / 100) * 50.3} 50.3`} strokeLinecap="round" /></svg>
                </span>
              )}
              {/* 제목 */}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {editing === n.id ? (
                  <TitleInput initial={n.title} onDone={(v, key) => {
                    setEditing(null);
                    if (v && v !== n.title) update.mutate({ id: n.id, patch: { title: v } });
                    if (key === 'Enter' && canAddUnder(n.parent_id ? byId.get(n.parent_id) ?? null : null)) setAdding(n.parent_id ?? 'root');
                    if (key === 'Tab' && canStructure) indent(n);
                    if (key === 'ShiftTab' && canStructure) outdent(n);
                  }} />
                ) : (
                  <button className={cx('text-left truncate', n.depth === 0 && 'font-semibold', n.status === 'done' && n.measure === 'check' && 'line-through')}
                    onClick={() => (editable ? setEditing(n.id) : onOpen(n.id))} title={editable ? '눌러서 고치기' : n.title}>{n.title}</button>
                )}
                <span className="text-[11px] text-slate-400 shrink-0 hidden sm:inline">{levelName(n.depth)}</span>
                {n.status !== 'active' && <Pill tone={st.tone} className="shrink-0">{st.label}</Pill>}
                {n.needs_plan && <Pill tone="violet" className="shrink-0">계획 요청됨</Pill>}
                {n.measure === 'number' && <span className="text-xs text-slate-500 shrink-0 num">{measureText(n)}</span>}
                {n.measure === 'recurring' && <span className="text-xs text-slate-500 shrink-0">{measureText(n)}</span>}
                {n.measure === 'stage' && <span className="text-xs text-slate-500 shrink-0">{currentLabel(n)}{n.stages?.length ? ` · ${n.stage_current ?? 0}/${n.stages.length}` : ''}</span>}
                {!!pendingCk.data?.get(n.id) && <button onClick={() => onOpen(n.id)} className="shrink-0 text-[10px] font-bold rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 px-1.5 py-0.5 inline-flex items-center gap-0.5"><Crosshair size={10} />체크인 대기</button>}
              </div>
              {/* 계획 대비 */}
              {(slip ?? 0) !== 0 && <span className={cx('text-[11px] shrink-0 inline-flex items-center gap-0.5', (slip ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700')} title={`처음 계획 ${fmtShort(n.base_due)} · 변경 ${n.replan_count}회`}>
                <RotateCcw size={10} />{(slip ?? 0) > 0 ? '+' : ''}{slip}일</span>}
              {/* 마감 */}
              <DueCell n={n} editable={editable} overdue={over} onSave={(v) => update.mutate({ id: n.id, patch: { due_date: v } })} />
              {/* 담당 */}
              <span className="w-24 shrink-0 hidden md:flex items-center gap-1.5 text-xs text-slate-600">
                {isLeader ? (
                  <select aria-label="담당" className="w-full bg-transparent text-xs text-slate-600 focus:outline-none cursor-pointer" value={n.owner_id ?? ''}
                    onChange={(e) => update.mutate({ id: n.id, patch: { owner_id: e.target.value || null } })}>
                    <option value="">미정</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
                  </select>
                ) : <><Avatar name={nameOf(n.owner_id)} size={7} tone={n.owner_id === uid ? 'indigo' : 'slate'} /><span className="truncate">{nameOf(n.owner_id) || '미정'}</span></>}
              </span>
              <span className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100">
                {canAddUnder(n) && <button className="p-1 text-slate-400 hover:text-indigo-600" title={`${levelName(n.depth + 1)} 추가`} aria-label="하위 항목 추가" onClick={() => setAdding(n.id)}><Plus size={14} /></button>}
                <button className="p-1 text-slate-400 hover:text-indigo-600" title="자세히" aria-label="자세히" onClick={() => onOpen(n.id)}><MoreHorizontal size={15} /></button>
              </span>
            </div>
            {adding === n.id && (
              <AddRow depth={n.depth + 1} label={levelName(n.depth + 1)} onAdd={(t) => addChild(n.id, t)} onClose={() => setAdding(null)} />
            )}
          </div>
        );
      })}
      {adding === 'root' ? (
        <AddRow depth={0} label={levelName(0)} onAdd={(t) => addChild(null, t)} onClose={() => setAdding(null)} />
      ) : canAddUnder(null) && (
        <button className="w-full text-left px-4 py-2.5 text-sm text-slate-500 hover:text-indigo-700 hover:bg-slate-50 inline-flex items-center gap-1.5" onClick={() => setAdding('root')}>
          <Plus size={14} />{levelName(0)} 추가
        </button>
      )}
      {!rows.length && <p className="px-4 py-6 text-sm text-slate-500 flex items-center gap-1.5"><CircleAlert size={14} />조건에 맞는 항목이 없습니다.</p>}
    </div>
  );
}

function TitleInput({ initial, onDone }: { initial: string; onDone: (v: string, key?: 'Enter' | 'Tab' | 'ShiftTab' | 'Escape') => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (val: string, k?: 'Enter' | 'Tab' | 'ShiftTab' | 'Escape') => { if (done.current) return; done.current = true; onDone(val, k); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(v.trim(), 'Enter'); }
    if (e.key === 'Escape') { e.preventDefault(); finish(initial, 'Escape'); }
    if (e.key === 'Tab') { e.preventDefault(); finish(v.trim(), e.shiftKey ? 'ShiftTab' : 'Tab'); }
  };
  return <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={key} onBlur={() => finish(v.trim())}
    className="flex-1 min-w-0 text-sm border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none" aria-label="제목" />;
}

function AddRow({ depth, label, onAdd, onClose }: { depth: number; label: string; onAdd: (t: string) => void; onClose: () => void }) {
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex items-center gap-2 py-1.5 pr-3 border-b border-slate-100 bg-indigo-50/40" style={{ paddingLeft: `calc(40px + ${depth} * var(--indent))` }}>
      <Plus size={14} className="text-indigo-400" />
      <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} aria-label={`새 ${label}`}
        placeholder={`새 ${label} — Enter로 추가하고 이어서 쓰기, Esc로 닫기`}
        className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-slate-400"
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && v.trim()) { e.preventDefault(); onAdd(v.trim()); setV(''); }
          if (e.key === 'Escape') onClose();
        }}
        onBlur={() => { if (!v.trim()) onClose(); }} />
    </div>
  );
}

function DueCell({ n, editable, overdue, onSave }: { n: WorkItem; editable: boolean; overdue: boolean; onSave: (v: string | null) => void }) {
  const [edit, setEdit] = useState(false);
  if (edit) return <input type="date" autoFocus defaultValue={n.due_date ?? ''} aria-label="마감"
    className="w-32 text-xs border border-indigo-300 rounded px-1 py-0.5 shrink-0"
    onBlur={(e) => { setEdit(false); const v = e.target.value || null; if (v !== n.due_date) onSave(v); }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(false); }} />;
  return (
    <button disabled={!editable} onClick={() => setEdit(true)} title="마감"
      className={cx('w-14 text-right text-xs shrink-0 num', overdue ? 'text-rose-600 font-semibold' : 'text-slate-500', !n.due_date && 'text-slate-300')}>
      {n.due_date ? fmtShort(n.due_date) : editable ? '마감' : '-'}
    </button>
  );
}
