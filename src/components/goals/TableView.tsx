// 표: 엑셀처럼 한 번에 고치기 + 엑셀·문서에서 붙여 넣어 한꺼번에 추가
import { useMemo, useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../../state/session';
import type { ItemStatus, WorkItem } from '../../lib/types';
import { STATUS_META, applyOps, isOverdue, useItemMutations, useLevelNames, type Node, type PlanOp } from '../../lib/items';
import { cx, fmtShort } from '../../lib/format';
import { Button, Field, Modal, inputCls, useToast } from '../ui';

const cell = 'w-full bg-transparent text-sm px-1.5 py-1 rounded focus:outline-none focus:ring-1 focus:ring-indigo-300 disabled:text-slate-500';

export function TableView({ rows, onOpen, canEditItem, canProgress = canEditItem }: { rows: Node[]; onOpen: (id: string) => void; canEditItem: (n: WorkItem) => boolean; canProgress?: (n: WorkItem) => boolean }) {
  const { team, members, isLeader } = useTeam();
  const levelName = useLevelNames();
  const { update } = useItemMutations(team.id);
  const save = (n: WorkItem, patch: Partial<WorkItem>) => {
    const k = Object.keys(patch)[0] as keyof WorkItem;
    if (JSON.stringify(n[k]) !== JSON.stringify(patch[k])) update.mutate({ id: n.id, patch });
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[980px]">
        <thead className="text-xs text-slate-500 bg-slate-50">
          <tr>{['항목', '단계', '담당', '상태', '진척', '시작', '마감', '처음 마감', '주당 시간', '기여도'].map((h) => <th key={h} className="text-left font-medium px-2 py-2">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((n) => {
            const ed = canEditItem(n);
            const edp = canProgress(n);
            const edv = edp && (isLeader || !(n.role === 'metric' || (n.depth === 0 && n.measure !== 'children')));   // 지표 값은 체크인 → 승인으로만
            return (
              <tr key={`${n.id}-${n.updated_at}`} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-2 py-1 min-w-[260px]" style={{ paddingLeft: 8 + n.depth * 16 }}>
                  <div className="flex items-center gap-1">
                    <input className={cx(cell, n.depth === 0 && 'font-semibold')} defaultValue={n.title} disabled={!ed} aria-label="제목"
                      onBlur={(e) => e.target.value.trim() && save(n, { title: e.target.value.trim() })} />
                    <button className="text-xs text-slate-400 hover:text-indigo-600 shrink-0" onClick={() => onOpen(n.id)}>열기</button>
                  </div>
                </td>
                <td className="px-2 text-xs text-slate-400 whitespace-nowrap">{levelName(n.depth)}</td>
                <td className="px-2 w-28">
                  <select className={cell} value={n.owner_id ?? ''} disabled={!isLeader} aria-label="담당" onChange={(e) => save(n, { owner_id: e.target.value || null })}>
                    <option value="">미정</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
                  </select>
                </td>
                <td className="px-2 w-28">
                  <select className={cell} value={n.status} disabled={!edp} aria-label="상태" onChange={(e) => save(n, { status: e.target.value as ItemStatus })}>
                    {(Object.keys(STATUS_META) as ItemStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                  </select>
                </td>
                <td className="px-2 w-24">
                  {n.measure === 'percent' ? (
                    <input type="number" min={0} max={100} className={cell} defaultValue={n.progress} disabled={!edv} aria-label="진척"
                      onBlur={(e) => save(n, { progress: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
                  ) : n.measure === 'number' ? (
                    <input type="number" className={cell} defaultValue={n.num_current ?? ''} disabled={!edv || !!n.metric_id} aria-label="현재값" title={`목표 ${n.num_target ?? '-'}${n.unit}`}
                      onBlur={(e) => save(n, { num_current: e.target.value === '' ? null : Number(e.target.value) })} />
                  ) : <span className="text-xs text-slate-500 px-1.5">{n.progress}%</span>}
                </td>
                <td className="px-2 w-36"><input type="date" className={cell} defaultValue={n.start_date ?? ''} disabled={!ed} aria-label="시작" onBlur={(e) => save(n, { start_date: e.target.value || null })} /></td>
                <td className="px-2 w-36"><input type="date" className={cx(cell, isOverdue(n) && 'text-rose-600 font-semibold')} defaultValue={n.due_date ?? ''} disabled={!ed} aria-label="마감" onBlur={(e) => save(n, { due_date: e.target.value || null })} /></td>
                <td className="px-2 text-xs text-slate-500 whitespace-nowrap">{n.base_due ? fmtShort(n.base_due) : '-'}{n.replan_count > 0 && <span className="text-amber-700"> · {n.replan_count}회 변경</span>}</td>
                <td className="px-2 w-20"><input type="number" className={cell} defaultValue={n.est_hours_per_week ?? ''} disabled={!isLeader} aria-label="주당 시간" onBlur={(e) => save(n, { est_hours_per_week: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                <td className="px-2 w-16"><input type="number" min={1} max={5} className={cell} defaultValue={n.contribution} disabled={!isLeader} aria-label="기여도" onBlur={(e) => save(n, { contribution: Math.max(1, Math.min(5, Number(e.target.value) || 3)) })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 붙여 넣기 ----------
const DATE = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})|(\d{1,2})[/.](\d{1,2})/;
function toDate(s: string): string | null {
  const m = s.match(DATE);
  if (!m) return null;
  const y = m[1] ? Number(m[1]) : new Date().getFullYear();
  const mo = Number(m[2] ?? m[4]); const d = Number(m[3] ?? m[5]);
  if (!mo || !d || mo > 12 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parsePaste(text: string, memberNames: string[]): PlanOp[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const ops: PlanOp[] = [];
  const stack: { level: number; ref: string }[] = [];
  lines.forEach((raw, i) => {
    const lead = raw.match(/^[\t ]*/)?.[0] ?? '';
    const bullet = raw.slice(lead.length).match(/^([-*•·]+|\d+[.)]|[가-힣][.)])\s*/)?.[0] ?? '';
    const level = lead.replace(/\t/g, '  ').length / 2 + (bullet.match(/^[-*•·]+/)?.[0].length ?? 1) - 1;
    const cols = raw.slice(lead.length + bullet.length).split('\t').map((c) => c.trim());
    let title = cols[0];
    let owner = cols.slice(1).find((c) => memberNames.includes(c)) ?? '';
    const dates = cols.slice(1).map(toDate).filter(Boolean) as string[];
    // 한 줄 메모 형태: "과제명 (김현정, 10/31)"
    const paren = title.match(/\(([^)]*)\)\s*$/);
    if (paren) {
      const inside = paren[1].split(/[,·/]/).map((x) => x.trim());
      owner = owner || inside.find((x) => memberNames.includes(x)) || '';
      inside.map(toDate).forEach((d) => d && dates.push(d));
      title = title.slice(0, paren.index).trim();
    }
    if (!title) return;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const ref = `p${i}`;
    ops.push({ op: 'add', ref, parent: stack.length ? stack[stack.length - 1].ref : null, title, owner,
      start_date: dates.length > 1 ? dates[0] : null, due_date: dates.length ? dates[dates.length - 1] : null,
      measure: 'percent' });
    stack.push({ level, ref });
  });
  // 하위가 있는 항목은 '하위 항목 기준'
  for (const o of ops) if (ops.some((c) => c.parent === o.ref)) o.measure = 'children';
  return ops;
}

export function PasteModal({ open, onClose, byId, defaultParent }: { open: boolean; onClose: () => void; byId: Map<string, Node>; defaultParent?: string | null }) {
  const { team, members, isLeader, uid } = useTeam();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [parent, setParent] = useState(defaultParent ?? '');
  const [busy, setBusy] = useState(false);
  const names = members.map((m) => m.profiles?.full_name ?? '').filter(Boolean);
  const ops = useMemo(() => parsePaste(text, names), [text, names]);
  const depth = (o: PlanOp): number => { const p = ops.find((x) => x.ref === o.parent); return p ? depth(p) + 1 : 0; };
  const go = async () => {
    setBusy(true);
    const errs = await applyOps(team.id, ops, members, { asMember: isLeader ? undefined : uid, fallbackParent: parent || null });
    setBusy(false);
    qc.invalidateQueries({ queryKey: ['items', team.id] });
    toast(errs.length ? `일부 실패: ${errs[0]}` : `${ops.length}개 항목을 추가했습니다`);
    if (!errs.length) { setText(''); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} wide title={<span className="inline-flex items-center gap-2"><ClipboardPaste size={16} />붙여 넣어 한꺼번에 추가</span>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">엑셀 표나 문서의 목록을 그대로 붙여 넣으세요. 들여쓰기(탭·공백·글머리표)가 단계가 되고, 팀원 이름과 날짜는 자동으로 알아봅니다.</p>
        <Field label="어디 아래에 넣을까요?">
          <select className={inputCls} value={parent} onChange={(e) => setParent(e.target.value)}>
            {isLeader && <option value="">최상위</option>}
            {[...byId.values()].filter((n) => n.status !== 'dropped').map((n) => <option key={n.id} value={n.id}>{'— '.repeat(n.depth)}{n.title}</option>)}
          </select>
        </Field>
        <textarea rows={7} className={cx(inputCls, 'font-mono text-xs')} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'파트너 채널 확대\t이경훈\t2026-12-31\n\t후보사 10곳 발굴\t정우성\t10/31\n\t제안서 3건\t김현정\t11/30\n- 또는 이렇게 (김현정, 11/15)'} />
        {!!ops.length && (
          <ul className="max-h-48 overflow-y-auto text-sm border border-slate-200 rounded-lg divide-y divide-slate-100">
            {ops.map((o) => (
              <li key={o.ref} className="py-1.5 pr-2 flex gap-2" style={{ paddingLeft: 8 + depth(o) * 16 }}>
                <span className="flex-1 truncate">{o.title}</span>
                <span className="text-xs text-slate-500">{o.owner || ''}</span>
                <span className="text-xs text-slate-500 num">{o.due_date ? fmtShort(o.due_date) : ''}</span>
              </li>
            ))}
          </ul>
        )}
        <Button className="w-full" onClick={go} loading={busy} disabled={!ops.length || (!isLeader && !parent)}>{ops.length}개 추가{!isLeader && ' (팀장 검토 요청)'}</Button>
      </div>
    </Modal>
  );
}
