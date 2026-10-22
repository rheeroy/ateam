// 팀원: 받은 히스토리 — 팀장이 전달한 과제 히스토리 (보낸 순간의 사본). 확인 · 질문 · 히스토리 요청
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Hash, History as HistoryIcon, Inbox, Send } from 'lucide-react';
import { useTeam } from '../state/session';
import { useItems } from '../lib/items';
import { useHistoryActions, useHistoryMessages, useShares, type HistoryShare } from '../lib/history';
import { HistoryView } from '../components/history/HistoryView';
import { historyItems } from './History';
import { Button, Card, Empty, Field, Modal, PageHeader, Spinner, inputCls } from '../components/ui';
import { cx, fmtDate, fmtShort } from '../lib/format';

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
        <p className="text-sm text-slate-600">과제의 지금까지 흐름 · 확정 사항 · 관계자를 팀장님께 요청합니다. 팀장님이 확인하고 보내 주면 여기로 옵니다.</p>
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

export default function MyHistory() {
  const { team, nameOf } = useTeam();
  const [params, setParams] = useSearchParams();
  const items = useItems(team.id);
  const shares = useShares({ mine: true });
  const [reqOpen, setReqOpen] = useState(false);
  const titleOf = (id: string) => (items.data ?? []).find((i) => i.id === id)?.title ?? '과제';
  const got = (shares.data ?? []).filter((s) => s.status === 'sent' || s.status === 'read');
  const waiting = (shares.data ?? []).filter((s) => s.status === 'requested');
  const sel = got.find((s) => s.id === params.get('id')) ?? got[0] ?? null;
  return (
    <section>
      <PageHeader title="받은 히스토리" sub="팀장님이 전달한 과제 히스토리입니다. 지금까지의 흐름과 확정 사항을 먼저 확인하세요."
        right={<Button variant="secondary" onClick={() => setReqOpen(true)}><Inbox size={15} />히스토리 요청</Button>} />
      {shares.isLoading ? <Spinner /> : !got.length && !waiting.length ? (
        <Card><Empty icon={<HistoryIcon size={18} />} title="아직 받은 히스토리가 없습니다" action={<Button variant="secondary" onClick={() => setReqOpen(true)}><Inbox size={14} />히스토리 요청</Button>}>
          과제를 새로 맡거나 함께 일하게 되면 팀장님이 그 과제의 지금까지 흐름 · 확정 사항 · 관계자를 정리해서 보내 줍니다. 필요하면 먼저 요청할 수도 있습니다.
        </Empty></Card>
      ) : (
        <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-4 items-start">
          <aside className="rounded-2xl bg-slate-100/70 p-2.5">
            {got.map((s) => (
              <button key={s.id} onClick={() => setParams({ id: s.id }, { replace: true })} className={cx('w-full text-left rounded-lg px-2.5 py-2 mb-0.5', sel?.id === s.id ? 'bg-white ring-1 ring-indigo-200 shadow-sm' : 'hover:bg-white/70')}>
                <div className="flex items-center gap-1 text-[13px]"><Hash size={12} className="text-slate-400 shrink-0" /><span className={cx('flex-1 truncate', sel?.id === s.id ? 'font-semibold text-indigo-800' : 'text-slate-700')}>{titleOf(s.item_id)}</span></div>
                <div className="ml-4 mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400"><span className="truncate">{nameOf(s.from_id)} 팀장님 · {fmtShort(s.sent_at ?? s.created_at)}</span>
                  <span className={cx('ml-auto shrink-0 text-[10px] font-semibold rounded-full px-1.5', s.status === 'sent' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>{s.status === 'sent' ? '확인 전' : '확인함'}</span></div>
              </button>
            ))}
            {!!waiting.length && <div className="text-[10px] font-semibold text-slate-400 px-1.5 mt-2 mb-1">요청 중</div>}
            {waiting.map((s) => <div key={s.id} className="rounded-lg px-2.5 py-2 text-[13px] text-slate-500"><div className="truncate">{titleOf(s.item_id)}</div><div className="text-[11px] text-slate-400">{fmtShort(s.created_at)} 요청 · 팀장님 확인 중</div></div>)}
          </aside>
          {sel ? (
            <div className="min-w-0 space-y-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-bold">{titleOf(sel.item_id)}</h2><span className="text-xs text-slate-500">{nameOf(sel.from_id)} 팀장님 · {fmtDate(sel.sent_at ?? sel.created_at)} 전달</span></div>
                <p className="text-[13.5px] text-slate-700 mt-1">{sel.snapshot.summary}</p>
              </div>
              {sel.note && <div className="rounded-xl bg-indigo-50 ring-1 ring-indigo-100 px-4 py-2.5"><div className="text-[11px] font-semibold text-indigo-700 mb-0.5">팀장 한마디</div><p className="text-[13px] text-slate-800 whitespace-pre-line">{sel.note}</p></div>}
              <HistoryView title={titleOf(sel.item_id)} content={sel.snapshot} />
              <Thread s={sel} />
            </div>
          ) : <Card><Empty title="팀장님이 확인하고 보내 주면 여기에 보입니다" /></Card>}
        </div>
      )}
      <RequestModal open={reqOpen} onClose={() => setReqOpen(false)} />
    </section>
  );
}
