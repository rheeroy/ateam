// 내 메모 — 빠른 메모 창(어디서든) · 대상별 메모 칸(팀원 · 목표 · 임원 · 결정 · 1on1) · 메모 한 줄
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRightLeft, Check, CheckSquare, Lock, Pin, PinOff, Plus, Sparkles, StickyNote, Trash2 } from 'lucide-react';
import { useTeam } from '../../state/session';
import { useItems } from '../../lib/items';
import { useExecutives } from '../../lib/upward';
import { ANCHOR_LABEL, OPEN_NOTE, getAiDefault, openQuickNote, useNoteMutations, useNotes, type Anchor, type AnchorType, type LeaderNote, type OpenNoteDetail } from '../../lib/notes';
import { cx, fmtShort } from '../../lib/format';
import { Button, Modal, Spinner, inputCls } from '../ui';
import { MemoModal } from '../home/shared';

/** 붙인 대상의 이름과 링크 (지금 이름 → 없으면 붙일 때 저장한 이름) */
export function useAnchorInfo() {
  const { team, nameOf, members } = useTeam();
  const items = useItems(team.id);
  const ex = useExecutives(team.id);
  const itemTitle = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i.title])), [items.data]);
  const execName = useMemo(() => new Map(ex.list.map((e) => [e.id, `${e.name}${e.title ? ` ${e.title}` : ''}`])), [ex.list]);
  const info = (t: AnchorType, id: string | null, saved = ''): { label: string; to?: string } | null => {
    if (t === 'none' || !id) return null;
    if (t === 'member') return { label: nameOf(id) || saved || '팀원', to: `/people/${id}` };
    if (t === 'item') return { label: itemTitle.get(id) ?? (saved || '목표·과제'), to: `/goals?item=${id}` };
    if (t === 'exec') return { label: execName.get(id) ?? (saved || '상위 관리자'), to: '/upward' };
    if (t === 'decision') return { label: saved || '결정 카드', to: '/decide' };
    if (t === 'one_on_one') return { label: saved || '1on1', to: `/one-on-ones/${id}` };
    return null;
  };
  const options = {
    member: members.filter((m) => m.role === 'member').map((m) => ({ id: m.user_id, label: m.profiles?.full_name ?? '팀원' })),
    item: (items.data ?? []).filter((i) => !['dropped', 'done'].includes(i.status)).map((i) => ({ id: i.id, label: `${i.parent_id ? '· ' : ''}${i.title}` })),
    exec: ex.list.map((e) => ({ id: e.id, label: `${e.name}${e.title ? ` (${e.title})` : ''}` })),
  };
  return { info, options };
}

/** 지금 보던 화면에서 붙일 대상 추정 (팀원 상세 · 목표 상세) */
function anchorFromLocation(path: string, search: string): Anchor | undefined {
  const m = path.match(/^\/people\/([^/?#]+)/);
  if (m) return { type: 'member', id: m[1] };
  const item = new URLSearchParams(search).get('item');
  if (path.startsWith('/goals') && item) return { type: 'item', id: item };
  return undefined;
}

type Form = { id?: string; body: string; kind: 'note' | 'todo'; anchor_type: AnchorType; anchor_id: string | null; anchor_label: string; pinned: boolean; ai_allowed: boolean };
const PICKABLE: AnchorType[] = ['none', 'member', 'item', 'exec'];

/** 어디서든 여는 빠른 메모 창 — Layout에 한 번 둔다 */
export function QuickNote() {
  const loc = useLocation();
  const { save } = useNoteMutations();
  const { options, info } = useAnchorInfo();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>({ body: '', kind: 'note', anchor_type: 'none', anchor_id: null, anchor_label: '', pinned: false, ai_allowed: false });
  useEffect(() => {
    const h = (e: Event) => {
      const d = ((e as CustomEvent<OpenNoteDetail>).detail ?? {}) as OpenNoteDetail;
      const n = d.note;
      const a = n ? undefined : d.anchor ?? anchorFromLocation(loc.pathname, loc.search);
      setF(n ? { id: n.id, body: n.body, kind: n.kind, anchor_type: n.anchor_type, anchor_id: n.anchor_id, anchor_label: n.anchor_label, pinned: n.pinned, ai_allowed: n.ai_allowed }
        : { body: '', kind: d.kind ?? 'note', anchor_type: a?.type ?? 'none', anchor_id: a?.id ?? null, anchor_label: a?.label ?? '', pinned: false, ai_allowed: getAiDefault() });
      setOpen(true);
    };
    window.addEventListener(OPEN_NOTE, h);
    return () => window.removeEventListener(OPEN_NOTE, h);
  }, [loc.pathname, loc.search]);
  const fixed = !PICKABLE.includes(f.anchor_type); // 결정 · 1on1은 그 화면에서만 붙임
  const opts = f.anchor_type === 'member' ? options.member : f.anchor_type === 'item' ? options.item : f.anchor_type === 'exec' ? options.exec : [];
  const labelOf = (t: AnchorType, id: string | null) => (t === 'none' || !id ? '' : opts.find((o) => o.id === id)?.label.replace(/^· /, '') ?? f.anchor_label);
  const submit = () => { if (f.body.trim()) save.mutate({ ...f, anchor_label: fixed ? f.anchor_label : labelOf(f.anchor_type, f.anchor_id) }, { onSuccess: () => setOpen(false) }); };
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={<span className="inline-flex items-center gap-2"><StickyNote size={16} />{f.id ? '메모 고치기' : '내 메모'}</span>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 w-fit text-xs">
          {([['note', '메모'], ['todo', '할 일']] as const).map(([k, l]) => (
            <button type="button" key={k} onClick={() => setF({ ...f, kind: k })} className={cx('px-3 py-1.5 rounded-md', f.kind === k ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}>{l}</button>
          ))}
        </div>
        <textarea autoFocus rows={4} className={inputCls} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder={f.kind === 'todo' ? '예) 다음 1on1에서 교육 예산 얘기 꺼내기' : '생각나는 것, 아이디어, 기억해 둘 것 — 자유롭게'} />
        <div className="grid grid-cols-[auto_1fr] gap-2 items-center text-sm">
          <span className="text-xs text-slate-500">붙이기</span>
          {fixed ? (
            <span className="text-sm rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 truncate">{ANCHOR_LABEL[f.anchor_type]} · {info(f.anchor_type, f.anchor_id, f.anchor_label)?.label}</span>
          ) : (
            <div className="flex gap-1.5 min-w-0">
              <select className={cx(inputCls, 'w-32 shrink-0')} value={f.anchor_type} onChange={(e) => setF({ ...f, anchor_type: e.target.value as AnchorType, anchor_id: null })}>
                {PICKABLE.map((t) => <option key={t} value={t}>{ANCHOR_LABEL[t]}</option>)}
              </select>
              {f.anchor_type !== 'none' && (
                <select className={cx(inputCls, 'min-w-0')} value={f.anchor_id ?? ''} onChange={(e) => setF({ ...f, anchor_id: e.target.value || null })}>
                  <option value="">— 고르기 —</option>
                  {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="accent-indigo-600" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />맨 위에 고정</label>
          <label className="flex items-center gap-2 cursor-pointer" title="켜면 1on1 준비 노트 · 팀원 액션 · ATEAM의 제안 · 임원 브리핑이 이 메모를 참고합니다. 평가 초안에는 쓰지 않습니다.">
            <input type="checkbox" className="accent-violet-600" checked={f.ai_allowed} onChange={(e) => setF({ ...f, ai_allowed: e.target.checked })} />
            <span className="inline-flex items-center gap-1"><Sparkles size={13} className="text-violet-600" />AI가 참고해도 돼요</span></label>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Lock size={11} />나만 보는 메모 · 팀원에게 보이지 않고 평가에 쓰이지 않습니다</span>
          <Button type="submit" className="ml-auto" loading={save.isPending} disabled={!f.body.trim() || (f.anchor_type !== 'none' && !f.anchor_id)}>저장</Button>
        </div>
      </form>
    </Modal>
  );
}

/** 메모 한 줄 */
export function NoteRow({ n, showAnchor = true }: { n: LeaderNote; showAnchor?: boolean }) {
  const { team } = useTeam();
  const { patch, remove } = useNoteMutations();
  const { info } = useAnchorInfo();
  const [obs, setObs] = useState(false);
  const a = showAnchor ? info(n.anchor_type, n.anchor_id, n.anchor_label) : null;
  return (
    <li className={cx('group flex gap-2.5 py-2.5', n.kind === 'todo' && n.done && 'opacity-60')}>
      {n.kind === 'todo'
        ? <button onClick={() => patch.mutate({ id: n.id, done: !n.done })} aria-label={n.done ? '안 한 것으로' : '했음'} className={cx('mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center', n.done ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 hover:border-indigo-500')}>{n.done && <Check size={11} />}</button>
        : <span className={cx('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', n.pinned ? 'bg-amber-400' : 'bg-slate-300')} />}
      <div className="min-w-0 flex-1">
        <button onClick={() => openQuickNote({ note: n })} className={cx('text-left text-sm leading-relaxed whitespace-pre-wrap break-words hover:text-indigo-700', n.kind === 'todo' && n.done && 'line-through')}>{n.body}</button>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
          <span>{fmtShort(n.updated_at)}</span>
          {n.ai_allowed && <span className="inline-flex items-center gap-0.5 text-violet-600"><Sparkles size={10} />AI 참고</span>}
          {a && (a.to ? <Link to={a.to} className="rounded-full bg-slate-100 text-slate-600 px-1.5 py-px hover:bg-slate-200">{ANCHOR_LABEL[n.anchor_type]} · {a.label}</Link>
            : <span className="rounded-full bg-slate-100 text-slate-600 px-1.5 py-px">{ANCHOR_LABEL[n.anchor_type]} · {a.label}</span>)}
        </div>
      </div>
      <div className="flex items-start gap-0.5 opacity-60 group-hover:opacity-100">
        {n.anchor_type === 'member' && n.anchor_id && <button onClick={() => setObs(true)} title="관찰 메모로 옮기기 — 평가 근거가 됩니다" className="p-1 rounded text-slate-400 hover:text-indigo-700 hover:bg-slate-100"><ArrowRightLeft size={13} /></button>}
        <button onClick={() => patch.mutate({ id: n.id, ai_allowed: !n.ai_allowed })} title={n.ai_allowed ? 'AI 참고 끄기' : 'AI가 참고해도 돼요'} className={cx('p-1 rounded hover:bg-slate-100', n.ai_allowed ? 'text-violet-600' : 'text-slate-400')}><Sparkles size={13} /></button>
        <button onClick={() => patch.mutate({ id: n.id, pinned: !n.pinned })} title={n.pinned ? '고정 풀기' : '맨 위에 고정'} className={cx('p-1 rounded hover:bg-slate-100', n.pinned ? 'text-amber-500' : 'text-slate-400')}>{n.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
        <button onClick={() => { if (confirm('이 메모를 지울까요?')) remove.mutate(n.id); }} title="지우기" className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100"><Trash2 size={13} /></button>
      </div>
      {obs && <MemoModal teamId={team.id} open preset={n.anchor_id} initialBody={n.body} onClose={() => setObs(false)} />}
    </li>
  );
}

/** 대상에 붙은 내 메모 칸 — 팀원 상세 · 목표 상세 · 임원 · 결정 · 1on1 */
export function NotesBox({ anchor, className, bare, title = '내 메모' }: { anchor: Anchor; className?: string; bare?: boolean; title?: string }) {
  const notes = useNotes(anchor);
  const { save } = useNoteMutations();
  const [body, setBody] = useState('');
  const list = notes.data ?? [];
  const add = (e: React.FormEvent) => { e.preventDefault(); if (body.trim()) save.mutate({ body, anchor_type: anchor.type, anchor_id: anchor.id, anchor_label: anchor.label ?? '' }, { onSuccess: () => setBody('') }); };
  return (
    <div className={cx(!bare && 'rounded-2xl bg-amber-50/60 ring-1 ring-amber-200/70', className)}>
      <div className={cx('flex items-center gap-2', bare ? 'pb-1' : 'px-4 pt-3')}>
        <span className="text-sm font-semibold inline-flex items-center gap-1.5"><StickyNote size={14} className="text-amber-600" />{title} <span className="text-xs text-slate-400 font-normal num">{list.length || ''}</span></span>
        <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Lock size={10} />나만 보기</span>
        <button type="button" onClick={() => openQuickNote({ anchor, kind: 'todo' })} className="ml-auto text-[11px] text-slate-500 hover:text-indigo-700 inline-flex items-center gap-0.5"><CheckSquare size={12} />할 일로</button>
      </div>
      <div className={cx(!bare && 'px-4 pb-3')}>
        {notes.isLoading ? <Spinner /> : !!list.length && <ul className="divide-y divide-amber-200/60">{list.slice(0, 8).map((n) => <NoteRow key={n.id} n={n} showAnchor={false} />)}</ul>}
        <form onSubmit={add} className="mt-2 flex gap-1.5">
          <input className={cx(inputCls, 'bg-white text-sm')} value={body} onChange={(e) => setBody(e.target.value)} placeholder="생각나는 것을 바로 적어 두세요" />
          <Button type="submit" size="sm" variant="secondary" loading={save.isPending} disabled={!body.trim()} aria-label="메모 추가"><Plus size={14} /></Button>
        </form>
        {list.length > 8 && <Link to="/notes" className="mt-2 block text-xs text-indigo-700 font-semibold">내 메모 모아보기에서 {list.length - 8}개 더 보기 →</Link>}
      </div>
    </div>
  );
}

/** 접어 두는 메모 칸 — 카드 안처럼 자리가 좁은 곳 (임원 · 결정 카드) */
export function NotesToggle({ anchor, className }: { anchor: Anchor; className?: string }) {
  const notes = useNotes(anchor);
  const [open, setOpen] = useState(false);
  const n = notes.data?.length ?? 0;
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen((x) => !x)} className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 inline-flex items-center gap-1"><StickyNote size={12} />내 메모 {n || ''}{open ? ' 접기' : n ? '' : ' 남기기'}</button>
      {open && <NotesBox anchor={anchor} className="mt-1.5" />}
    </div>
  );
}
