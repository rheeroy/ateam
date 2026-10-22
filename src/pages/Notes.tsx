// 내 메모 — 팀장 전용. 어디서 적었든 여기 다 모입니다 (팀원 · 목표 · 상위 관리자에 붙인 메모 포함)
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Plus, Search, StickyNote } from 'lucide-react';
import { useNotes, openQuickNote, getAiDefault, setAiDefault, type AnchorType } from '../lib/notes';
import { NoteRow, useAnchorInfo } from '../components/notes/Notes';
import { cx } from '../lib/format';
import { Button, Card, Spinner, inputCls } from '../components/ui';
import { AiIcon, CoreAI } from '../components/Brand';

type F = 'all' | 'pinned' | 'todo' | AnchorType;
const FILTERS: { id: F; label: string }[] = [
  { id: 'all', label: '전체' }, { id: 'pinned', label: '고정' }, { id: 'todo', label: '할 일' },
  { id: 'member', label: '팀원' }, { id: 'item', label: '목표·과제' }, { id: 'exec', label: '상위 관리자' }, { id: 'decision', label: '결정' }, { id: 'none', label: '연결 안 함' },
];

export default function Notes() {
  const notes = useNotes();
  const { info } = useAnchorInfo();
  const [f, setF] = useState<F>('all');
  const [q, setQ] = useState('');
  const [aiDef, setAiDef] = useState(getAiDefault());
  const all = notes.data ?? [];
  const count = (id: F) => all.filter((n) => match(n, id)).length;
  const list = useMemo(() => all.filter((n) => match(n, f)).filter((n) => {
    if (!q.trim()) return true;
    const k = q.trim().toLowerCase();
    return n.body.toLowerCase().includes(k) || (info(n.anchor_type, n.anchor_id, n.anchor_label)?.label ?? '').toLowerCase().includes(k);
  }), [all, f, q, info]);
  const open = list.filter((n) => !(n.kind === 'todo' && n.done)), closed = list.filter((n) => n.kind === 'todo' && n.done);
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-sm"><StickyNote size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">내 메모 모아보기</h1>
            <p className="text-sm text-slate-500 inline-flex items-center gap-1.5 flex-wrap"><Lock size={13} />팀원 · 목표 · 상위 관리자 · 결정에서 적은 메모가 여기 다 모입니다. 나만 보고, 평가 근거(관찰 메모)와 따로 둡니다</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => openQuickNote({ kind: 'todo' })}><Plus size={15} />할 일</Button>
          <Button onClick={() => openQuickNote({ anchor: { type: 'none', id: null } })}><Plus size={15} />메모</Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map((x) => (
            <button key={x.id} onClick={() => setF(x.id)} className={cx('text-xs rounded-full px-3 py-1.5 border whitespace-nowrap', f === x.id ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'border-slate-200 text-slate-600 bg-white hover:border-slate-300')}>
              {x.label} <span className="num">{count(x.id)}</span></button>
          ))}
        </div>
        <label className="ml-auto relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={cx(inputCls, 'pl-8 w-56 text-sm')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="메모 · 사람 · 목표 찾기" /></label>
      </div>

      <Card className="px-5 py-2">
        {notes.isLoading ? <Spinner /> : !list.length ? (
          <div className="py-10 text-center text-sm text-slate-500">
            {all.length ? '조건에 맞는 메모가 없습니다.' : <>아직 메모가 없습니다. 생각나는 것을 바로 적어 두세요.<br /><span className="text-xs text-slate-400">팀원 상세 · 목표 상세 · 임원 브리핑에서 적은 메모도 여기에 모입니다.</span></>}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">{open.map((n) => <NoteRow key={n.id} n={n} />)}</ul>
            {!!closed.length && <details className="py-2"><summary className="text-xs text-slate-400 cursor-pointer">끝낸 할 일 {closed.length}</summary>
              <ul className="divide-y divide-slate-100">{closed.map((n) => <NoteRow key={n.id} n={n} />)}</ul></details>}
          </>
        )}
      </Card>
      <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
        <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" className="accent-violet-600" checked={aiDef} onChange={(e) => { setAiDef(e.target.checked); setAiDefault(e.target.checked); }} />
          <span className="inline-flex items-center gap-1"><span>새 메모는 '<CoreAI />가 참고해도 돼요'를 켜 둔 채로 시작</span></span></label>
        <span className="text-slate-400"><AiIcon size={11} className="text-violet-600" /> 참고를 켠 메모만 1on1 준비 노트 · 팀원 액션 · <Link to="/advisor" className="underline">ATEAM의 제안</Link> · 임원 브리핑이 읽습니다. 평가 초안은 읽지 않습니다. 메모마다 <AiIcon size={11} className="text-violet-600" /> 버튼으로 바꿀 수 있습니다.</span>
      </div>
    </div>
  );
}

function match(n: { pinned: boolean; kind: string; anchor_type: AnchorType }, f: F) {
  if (f === 'all') return true;
  if (f === 'pinned') return n.pinned;
  if (f === 'todo') return n.kind === 'todo';
  return n.anchor_type === f;
}
