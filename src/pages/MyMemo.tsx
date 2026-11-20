// 팀원 · 나만 보기 › 📝 메모 — 노션처럼 가볍게 적어 두는 개인 메모 · 할 일
//   저장은 leader_notes(쓴 사람만 읽음). 팀원 메모는 대상 연결 없음 · AI 참고 끔 — 팀장도, AI도 읽지 않는다 (49_member_memo.sql)
import { useState } from 'react';
import { Check, Pin, PinOff, Trash2 } from 'lucide-react';
import { useNoteMutations, useNotes, type LeaderNote } from '../lib/notes';
import { cx, fmtShort } from '../lib/format';
import { Spinner } from '../components/ui';
import { NotionHead } from '../components/NotionHead';

export default function MyMemo() {
  const notes = useNotes();
  const { save, patch, remove } = useNoteMutations();
  const [body, setBody] = useState('');
  const [todo, setTodo] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const list = notes.data ?? [];
  const open = list.filter((n) => !n.done);
  const done = list.filter((n) => n.done);
  const add = () => {
    if (!body.trim()) return;
    save.mutate({ body, kind: todo ? 'todo' : 'note', anchor_type: 'none', ai_allowed: false }, { onSuccess: () => setBody('') });
  };
  return (
    <section className="max-w-3xl">
      <NotionHead emoji="📝" title="메모" sub={<span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-slate-600">🔒 나만 봅니다 · 팀장님도, AI도 읽지 않아요</span>} />
      <div className="rounded-xl ring-1 ring-[#E3E2E0] px-3 py-2.5 shadow-[0_4px_16px_-10px_rgba(15,15,15,.2)]">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(6, Math.max(2, body.split('\n').length))}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } }}
          placeholder="떠오른 생각 · 해야 할 일 · 회의 메모를 적어 두세요" aria-label="새 메모"
          className="w-full resize-none bg-transparent text-[15px] leading-7 focus:outline-none placeholder:text-slate-400" />
        <div className="mt-1 flex items-center gap-2 text-xs">
          <button onClick={() => setTodo(false)} className={cx('rounded-md px-2 py-1', !todo ? 'bg-slate-800 text-white font-semibold' : 'text-slate-500 hover:bg-slate-100')}>📝 메모</button>
          <button onClick={() => setTodo(true)} className={cx('rounded-md px-2 py-1', todo ? 'bg-slate-800 text-white font-semibold' : 'text-slate-500 hover:bg-slate-100')}>☑️ 할 일</button>
          <span className="ml-auto text-slate-400 hidden sm:inline">Ctrl + Enter</span>
          <button onClick={add} disabled={!body.trim() || save.isPending} className="rounded-md bg-indigo-600 text-white font-semibold px-3 py-1.5 disabled:opacity-40">남기기</button>
        </div>
      </div>

      {notes.isLoading ? <Spinner /> : !list.length ? (
        <p className="mt-10 text-center text-sm text-slate-400">아직 메모가 없습니다. 위에 첫 메모를 남겨 보세요.</p>
      ) : (
        <div className="mt-6">
          {open.map((n) => <Row key={n.id} n={n} onPin={() => patch.mutate({ id: n.id, pinned: !n.pinned })} onDone={() => patch.mutate({ id: n.id, done: !n.done })} onDel={() => remove.mutate(n.id)} onSave={(b) => save.mutate({ ...n, body: b, ai_allowed: false })} />)}
          {!!done.length && (
            <div className="mt-6">
              <button onClick={() => setShowDone((x) => !x)} className="text-xs font-semibold text-slate-400 hover:text-slate-600">완료 {done.length} {showDone ? '▴' : '▾'}</button>
              {showDone && done.map((n) => <Row key={n.id} n={n} onPin={() => patch.mutate({ id: n.id, pinned: !n.pinned })} onDone={() => patch.mutate({ id: n.id, done: !n.done })} onDel={() => remove.mutate(n.id)} onSave={(b) => save.mutate({ ...n, body: b, ai_allowed: false })} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ n, onPin, onDone, onDel, onSave }: { n: LeaderNote; onPin: () => void; onDone: () => void; onDel: () => void; onSave: (b: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [b, setB] = useState(n.body);
  return (
    <div className="group flex items-start gap-2.5 py-2.5 border-b border-[#EDEDEB]">
      {n.kind === 'todo'
        ? <button onClick={onDone} aria-label={n.done ? '완료 취소' : '완료'} className={cx('mt-1 w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0', n.done ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-400')}>{n.done && <Check size={11} />}</button>
        : <span className="mt-0.5 text-[14px] shrink-0">{n.pinned ? '📌' : '📝'}</span>}
      <div className="flex-1 min-w-0">
        {edit ? (
          <textarea autoFocus value={b} onChange={(e) => setB(e.target.value)} onBlur={() => { setEdit(false); if (b.trim() && b !== n.body) onSave(b); }}
            rows={Math.max(2, b.split('\n').length)} className="w-full resize-none text-[15px] leading-7 rounded-md ring-1 ring-indigo-200 px-2 focus:outline-none" />
        ) : (
          <button onClick={() => setEdit(true)} className={cx('block w-full text-left text-[15px] leading-7 whitespace-pre-wrap break-words', n.done ? 'text-slate-400 line-through' : 'text-[#37352F]')}>{n.body}</button>
        )}
        <div className="text-[11px] text-slate-400">{fmtShort(n.updated_at)}</div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 shrink-0">
        {n.kind === 'note' && <button onClick={onPin} title={n.pinned ? '고정 풀기' : '위에 고정'} className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700">{n.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>}
        {n.kind === 'note' && <button onClick={onDone} title="보관(완료)" className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Check size={14} /></button>}
        <button onClick={onDel} title="지우기" className="p-1 rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
      </div>
    </div>
  );
}
