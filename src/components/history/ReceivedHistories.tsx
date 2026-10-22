// 팀원 매니징 보드 — 받은 히스토리: 팀장이 넘겨준 과제의 흐름 · 확정 사항 · 관계자 (보낸 순간의 사본)
//   카드를 누르면 오른쪽 넓은 창에서 자세히 (?history=<id>) · 확인했어요 · 질문 · 히스토리 요청
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleHelp, Flag, History as HistoryIcon, Inbox, MessageSquare, Send, X } from 'lucide-react';
import { useTeam } from '../../state/session';
import { useItems } from '../../lib/items';
import { historyItems, useHistoryActions, useHistoryMessages, useShares, type HistoryShare } from '../../lib/history';
import { HistoryView } from './HistoryView';
import { Button, Card, Field, Modal, inputCls } from '../ui';
import { cx, fmtDate, fmtShort } from '../../lib/format';

function RequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { team, uid } = useTeam();
  const items = useItems(team.id);
  const a = useHistoryActions();
  const list = useMemo(() => historyItems(items.data ?? []), [items.data]);
  const mine = list.filter((i) => i.owner_id === uid);
  const others = list.filter((i) => i.owner_id !== uid);
  const [item, setItem] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setItem(mine[0]?.id ?? ''); setNote(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Inbox size={16} className="text-violet-600" />히스토리 요청</span>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">과제의 지금까지 흐름 · 확정 사항 · 관계자를 팀장님께 요청합니다. 팀장님이 확인하고 보내 주면 매니징 보드로 옵니다.</p>
        <Field label="과제">
          <select className={inputCls} value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">고르세요</option>
            {!!mine.length && <optgroup label="내 과제">{mine.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</optgroup>}
            {!!others.length && <optgroup label="팀의 다른 과제">{others.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</optgroup>}
          </select>
        </Field>
        <Field label="이유 (선택)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예) 다음 주부터 이 과제를 같이 맡게 됐습니다" /></Field>
        <div className="flex justify-end"><Button disabled={!item} loading={a.request.isPending} onClick={() => a.request.mutate({ itemId: item, note: note.trim() }, { onSuccess: onClose })}><Send size={14} />요청하기</Button></div>
      </div>
    </Modal>
  );
}

function Thread({ s }: { s: HistoryShare }) {
  const { uid, nameOf } = useTeam();
  const msgs = useHistoryMessages(s.id);
  const a = useHistoryActions();
  const [body, setBody] = useState('');
  const send = () => { const b = body.trim(); if (b) a.ask.mutate({ shareId: s.id, body: b }, { onSuccess: () => setBody('') }); };
  return (
    <Card className="p-3 space-y-2">
      {!!(msgs.data ?? []).length && (
        <ul className="space-y-2 px-1">{(msgs.data ?? []).map((m) => { const me = m.author_id === uid; return (
          <li key={m.id} className={cx('flex', me && 'justify-end')}><div className={cx('max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px]', me ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800')}>
            {!me && <div className="text-[10px] text-slate-500">{nameOf(m.author_id)} 팀장님 · {fmtShort(m.created_at)}</div>}{m.body}</div></li>); })}</ul>
      )}
      <div className="flex gap-2 items-center">
        <input className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder="궁금한 점 묻기 — 팀장님께 바로 갑니다. 답은 이 과제 히스토리에 남습니다"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }} />
        <Button size="sm" variant="secondary" disabled={!body.trim()} loading={a.ask.isPending} onClick={send}>묻기</Button>
        {s.status === 'sent' && <Button size="sm" loading={a.markRead.isPending} onClick={() => a.markRead.mutate(s.id)}><CheckCircle2 size={14} />확인했어요</Button>}
      </div>
    </Card>
  );
}

/** 카드를 눌렀을 때 — 오른쪽 넓은 창 */
function Drawer({ s, title, onClose }: { s: HistoryShare; title: string; onClose: () => void }) {
  const { nameOf } = useTeam();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[35]">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 w-full lg:w-[min(1080px,92vw)] bg-[#F6F7F9] shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-[#F6F7F9]/95 backdrop-blur px-5 md:px-7 py-3 border-b border-slate-200 flex items-center gap-2">
          <HistoryIcon size={15} className="text-slate-400" /><span className="text-xs text-slate-500">받은 히스토리</span>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="px-5 md:px-7 py-5 space-y-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-bold">{title}</h2><span className="text-xs text-slate-500">{nameOf(s.from_id)} 팀장님 · {fmtDate(s.sent_at ?? s.created_at)} 전달</span></div>
            <p className="text-[13.5px] text-slate-700 mt-1">{s.snapshot.summary}</p>
          </div>
          {s.note && <div className="rounded-xl bg-indigo-50 ring-1 ring-indigo-100 px-4 py-2.5"><div className="text-[11px] font-semibold text-indigo-700 mb-0.5">팀장 한마디</div><p className="text-[13px] text-slate-800 whitespace-pre-line">{s.note}</p></div>}
          <HistoryView title={title} content={s.snapshot} />
          <Thread s={s} />
        </div>
      </aside>
    </div>
  );
}

export function ReceivedHistories() {
  const { team, nameOf } = useTeam();
  const [params, setParams] = useSearchParams();
  const items = useItems(team.id);
  const shares = useShares({ mine: true });
  const [reqOpen, setReqOpen] = useState(false);
  const titleOf = (id: string) => (items.data ?? []).find((i) => i.id === id)?.title ?? '과제';
  const got = (shares.data ?? []).filter((s) => s.status === 'sent' || s.status === 'read')
    .sort((a, b) => (a.status === b.status ? (b.sent_at ?? b.created_at).localeCompare(a.sent_at ?? a.created_at) : a.status === 'sent' ? -1 : 1));
  const waiting = (shares.data ?? []).filter((s) => s.status === 'requested');
  const unread = got.filter((s) => s.status === 'sent').length;
  const open = got.find((s) => s.id === params.get('history')) ?? null;
  const setOpen = (id: string | null) => { const p = new URLSearchParams(params); if (id) p.set('history', id); else p.delete('history'); setParams(p, { replace: !id }); };
  return (
    <Card>
      <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <HistoryIcon size={16} className="text-slate-500" /><span className="font-semibold">받은 히스토리</span>
        {!!unread && <span className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">확인 전 {unread}</span>}
        <span className="text-[11px] text-slate-400 hidden sm:inline">팀장님이 넘겨준 과제의 흐름 · 확정 사항 · 관계자</span>
        <button onClick={() => setReqOpen(true)} className="ml-auto text-xs font-semibold text-violet-700 bg-violet-50 ring-1 ring-violet-200 rounded-lg px-3 py-1.5 inline-flex items-center gap-1 hover:bg-violet-100"><Inbox size={13} />히스토리 요청</button>
      </div>
      <div className="p-4 space-y-3">
        {shares.isLoading ? <p className="text-sm text-slate-400">불러오는 중</p> : !got.length ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            <Inbox size={18} className="mx-auto mb-1.5 text-slate-300" />아직 받은 히스토리가 없습니다.<br />
            <span className="text-xs text-slate-400">과제를 새로 맡거나 함께 일하게 되면 팀장님이 그 과제의 지금까지 흐름 · 확정 사항 · 관계자를 정리해서 보내 줍니다. 흐름을 모르겠다면 먼저 요청하세요.</span>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {got.map((s) => {
              const c = s.snapshot; const isNew = s.status === 'sent';
              return (
                <button key={s.id} onClick={() => setOpen(s.id)} className={cx('text-left rounded-xl ring-1 p-4 hover:ring-indigo-300 transition', isNew ? 'ring-violet-300 bg-violet-50/40' : 'ring-slate-200 bg-white')}>
                  <div className="flex items-center gap-2"><b className="text-sm truncate"># {titleOf(s.item_id)}</b>
                    <span className={cx('ml-auto shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5', isNew ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>{isNew ? '확인 전' : '확인함'}</span></div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{nameOf(s.from_id)} 팀장님 · {fmtShort(s.sent_at ?? s.created_at)}</div>
                  {c.summary && <p className="text-[13px] text-slate-700 mt-2 line-clamp-2">{c.summary}</p>}
                  <div className="mt-3 flex items-center gap-1.5 text-[11px] flex-wrap">
                    {!!c.fixed?.length && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5"><CheckCircle2 size={10} />확정 {c.fixed.length}</span>}
                    {!!c.open?.length && <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 px-2 py-0.5"><Flag size={10} />미결 {c.open.length}</span>}
                    {!!c.gaps?.length && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2 py-0.5"><CircleHelp size={10} />확인 필요 {c.gaps.length}</span>}
                    {s.note && <span className="inline-flex items-center gap-1 text-indigo-700"><MessageSquare size={10} />한마디</span>}
                    <span className="ml-auto font-semibold text-indigo-700">자세히 →</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {!!waiting.length && (
          <div className="text-xs text-slate-500 space-y-1">
            {waiting.map((s) => <div key={s.id} className="flex items-center gap-1.5"><Inbox size={12} className="text-slate-400" /><b className="font-medium text-slate-600">{titleOf(s.item_id)}</b> · {fmtShort(s.created_at)} 요청 · 팀장님 확인 중</div>)}
          </div>
        )}
      </div>
      {open && <Drawer s={open} title={titleOf(open.item_id)} onClose={() => setOpen(null)} />}
      <RequestModal open={reqOpen} onClose={() => setReqOpen(false)} />
    </Card>
  );
}
