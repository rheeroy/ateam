// 팀장: 히스토리 관리 — 과제별 히스토리를 쌓아 두고, 맥락 전달이 필요할 때 팀원에게 한 번에 보낸다
//   왼쪽: 받은 요청 · 이번 주 업데이트 · 변동 없음 · 아직 없음 / 오른쪽: 과제 히스토리 (그림·문서) + 전달 기록(확인 · 질문/답)
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Hash, History as HistoryIcon, Inbox, Lock, MessageSquare, RefreshCw, Search, Send, Sparkles, X } from 'lucide-react';
import { useTeam } from '../state/session';
import { useItems } from '../lib/items';
import type { WorkItem } from '../lib/types';
import { applyEdits, historyItems, useHistories, useHistoryActions, useHistoryMessages, useShares, type HistoryShare, type TaskHistory } from '../lib/history';
import { HistoryView } from '../components/history/HistoryView';
import { Avatar, Button, Card, Empty, Modal, PageHeader, Spinner, inputCls } from '../components/ui';
import { Upsell } from './Perf';
import { cx, fmtDate, fmtShort } from '../lib/format';

const WEEK = 7 * 86400000;

function StatusPill({ s }: { s: HistoryShare['status'] }) {
  const m = { requested: ['요청', 'bg-violet-50 text-violet-700'], sent: ['확인 전', 'bg-amber-50 text-amber-700'], read: ['확인함', 'bg-emerald-50 text-emerald-700'], declined: ['보류', 'bg-slate-100 text-slate-500'] }[s];
  return <span className={cx('text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0', m[1])}>{m[0]}</span>;
}

/** 전달 창 */
function SendModal({ open, onClose, item, hist, request }: { open: boolean; onClose: () => void; item: WorkItem; hist: TaskHistory; request?: HistoryShare | null }) {
  const { members, uid, nameOf } = useTeam();
  const [params] = useSearchParams();
  const a = useHistoryActions();
  const people = members.filter((m) => m.user_id !== uid);
  const pre = request?.to_id ?? params.get('to') ?? '';
  const [to, setTo] = useState<string[]>(pre ? [pre] : []);
  const [note, setNote] = useState('');
  const [owner, setOwner] = useState(!!params.get('to') && params.get('to') !== item.owner_id);
  useEffect(() => { if (open) { setTo(pre ? [pre] : []); setNote(''); setOwner(!!params.get('to') && params.get('to') !== item.owner_id); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = new Set((hist.content.people ?? []).map((p) => p.name));
  const prev = hist.content.owner?.previous ?? [];
  const tagOf = (id: string) => (id === item.owner_id ? '현 담당' : prev.includes(nameOf(id)) ? '전 담당' : names.has(nameOf(id)) ? '관계자' : '');
  const one = to.length === 1 ? to[0] : null;
  const canOwner = !!one && one !== item.owner_id;
  const go = () => a.send.mutate({ itemId: item.id, toIds: to, note: note.trim(), snapshot: applyEdits(hist.content, hist.edits), requestId: request?.id ?? null, newOwner: canOwner && owner ? one : null },
    { onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Send size={16} className="text-violet-600" />팀원에게 전달</span>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm"><Hash size={14} className="text-slate-400" /><b>{item.title}</b><span className="text-xs text-slate-400">{fmtShort(hist.updated_at)} 업데이트 기준</span></div>
        {request && <div className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900"><b>{nameOf(request.to_id)}</b> 님이 요청했습니다{request.note && ` — ${request.note}`}</div>}
        <div>
          <div className="text-xs font-bold text-slate-700 mb-1.5">받는 사람</div>
          <div className="flex flex-wrap gap-1.5">
            {people.map((m) => { const on = to.includes(m.user_id); const tag = tagOf(m.user_id); return (
              <button key={m.user_id} onClick={() => setTo((x) => (on ? x.filter((y) => y !== m.user_id) : [...x, m.user_id]))}
                className={cx('rounded-full px-3 py-1 text-sm ring-1', on ? 'bg-violet-600 text-white ring-violet-600 font-semibold' : 'ring-slate-200 text-slate-600 hover:ring-slate-300')}>
                {nameOf(m.user_id)}{tag && <span className={cx('ml-1 text-[10px]', on ? 'text-violet-200' : 'text-slate-400')}>{tag}</span>}</button>); })}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold text-slate-700 mb-1.5">팀장 한마디 <span className="font-normal text-slate-400">(선택)</span></div>
          <textarea rows={3} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예) 예산은 재무팀 박과장과 먼저 맞춰 주세요. B사는 일단 빼고 가는 쪽입니다." />
          <p className="mt-1 text-[11px] text-slate-400">한마디도 이 과제 히스토리에 남아 다음 업데이트에 반영됩니다.</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-1.5">
          <div>전달되는 것: 현황 · 진행 흐름 · 관계자 · 확정/미결 사항 · 리스크 · 이전 시도 · 확인 필요 <span className="text-slate-400">(숨긴 항목 제외, 지금 화면 그대로)</span></div>
          <div className="inline-flex items-center gap-1"><Lock size={12} className="text-slate-400" />전달되지 않는 것: 1on1 · 컨디션 · 팀장 메모 · 평가 · 코칭</div>
        </div>
        {canOwner && (
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} className="rounded border-slate-300 text-violet-600" />
            담당자도 {nameOf(one)} 님으로 바꾸기 {item.owner_id && <span className="text-xs text-slate-400">(지금 {nameOf(item.owner_id)})</span>}</label>
        )}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-slate-400">받는 사람의 ‘받은 히스토리’로 가고 알림이 갑니다</span>
          <Button className="ml-auto" disabled={!to.length} loading={a.send.isPending} onClick={go}><Send size={14} />전달하기</Button>
        </div>
      </div>
    </Modal>
  );
}

/** 전달 기록 하나 — 확인 상태 · 질문/답 */
function ShareRow({ s, focus }: { s: HistoryShare; focus: boolean }) {
  const { nameOf, uid } = useTeam();
  const [open, setOpen] = useState(focus);
  const msgs = useHistoryMessages(open ? s.id : null);
  const a = useHistoryActions();
  const [body, setBody] = useState('');
  const send = () => { const b = body.trim(); if (b) a.ask.mutate({ shareId: s.id, body: b }, { onSuccess: () => setBody('') }); };
  return (
    <li className="border-b border-slate-100 last:border-0">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50">
        <Avatar name={nameOf(s.to_id)} size={7} /><span className="text-sm font-medium">{nameOf(s.to_id)}</span>
        <span className="text-xs text-slate-400">{fmtDate(s.sent_at ?? s.created_at)}{s.read_at && ` · ${fmtShort(s.read_at)} 확인`}</span>
        {s.note && <span className="text-xs text-slate-500 truncate flex-1">“{s.note}”</span>}
        <span className="ml-auto" /><StatusPill s={s.status} /><ChevronDown size={14} className={cx('text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          {msgs.isLoading ? <Spinner /> : !(msgs.data ?? []).length ? <p className="text-xs text-slate-400">아직 질문이 없습니다.</p> : (
            <ul className="space-y-2">{(msgs.data ?? []).map((m) => { const me = m.author_id === uid; return (
              <li key={m.id} className={cx('flex', me && 'justify-end')}><div className={cx('max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px]', me ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800')}>
                {!me && <div className="text-[10px] text-slate-500">{nameOf(m.author_id)} · {fmtShort(m.created_at)}</div>}{m.body}</div></li>); })}</ul>
          )}
          <div className="flex gap-2"><input className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder="답하기 — Enter" onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }} />
            <Button size="sm" disabled={!body.trim()} loading={a.ask.isPending} onClick={send}>보내기</Button></div>
        </div>
      )}
    </li>
  );
}

export default function HistoryPage() {
  const { team, hasFeature, nameOf } = useTeam();
  const [params, setParams] = useSearchParams();
  const items = useItems(team.id);
  const hists = useHistories();
  const shares = useShares();
  const a = useHistoryActions();
  const [qtext, setQtext] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const targets = useMemo(() => historyItems(items.data ?? []), [items.data]);
  const histOf = useMemo(() => new Map((hists.data ?? []).map((h) => [h.item_id, h])), [hists.data]);
  const sel = params.get('item') ?? '';
  const setSel = (id: string) => { const p = new URLSearchParams(params); p.set('item', id); p.delete('request'); p.delete('send'); p.delete('to'); p.delete('share'); setParams(p, { replace: true }); };
  const requests = (shares.data ?? []).filter((s) => s.status === 'requested');
  const request = requests.find((r) => r.id === params.get('request')) ?? null;
  useEffect(() => { if (params.get('send') || params.get('request')) setSendOpen(true); }, [params]);
  // 처음 들어오면 히스토리가 있는 첫 과제
  useEffect(() => { if (!sel && hists.data?.length) setSel([...hists.data].sort((x, y) => y.updated_at.localeCompare(x.updated_at))[0].item_id); }, [hists.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasFeature('history')) return <section><PageHeader title="히스토리 관리" sub="과제별 히스토리를 쌓아 두고, 맥락 전달이 필요할 때 팀원에게 한 번에 보냅니다." /><Upsell feature="히스토리 관리" /></section>;
  if (items.isLoading || hists.isLoading) return <Spinner />;

  const match = (i: WorkItem) => !qtext.trim() || i.title.toLowerCase().includes(qtext.trim().toLowerCase());
  const withH = targets.filter((i) => histOf.has(i.id) && match(i));
  const recent = withH.filter((i) => { const h = histOf.get(i.id)!; return h.new_count > 0 && Date.now() - Date.parse(h.updated_at) < WEEK; })
    .sort((x, y) => histOf.get(y.id)!.updated_at.localeCompare(histOf.get(x.id)!.updated_at));
  const quiet = withH.filter((i) => !recent.includes(i));
  const none = targets.filter((i) => !histOf.has(i.id) && match(i));
  const item = targets.find((i) => i.id === sel) ?? (items.data ?? []).find((i) => i.id === sel) ?? null;
  const hist = item ? histOf.get(item.id) ?? null : null;
  const itemShares = (shares.data ?? []).filter((s) => s.item_id === sel && s.status !== 'requested');

  const createAll = async (ids: string[]) => {
    setBatch({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i += 4) {
      try { await a.update.mutateAsync({ itemIds: ids.slice(i, i + 4) }); } catch { break; }
      setBatch({ done: Math.min(ids.length, i + 4), total: ids.length });
    }
    setBatch(null);
  };
  const Row = ({ i, n }: { i: WorkItem; n?: number }) => (
    <button onClick={() => setSel(i.id)} className={cx('w-full text-left rounded-lg px-2.5 py-2 mb-0.5', sel === i.id ? 'bg-white ring-1 ring-indigo-200 shadow-sm' : 'hover:bg-white/70')}>
      <div className="flex items-center gap-1 text-[13px]"><Hash size={12} className="text-slate-400 shrink-0" /><span className={cx('flex-1 truncate', sel === i.id ? 'font-semibold text-indigo-800' : 'text-slate-700')}>{i.title}</span>
        {!!n && <span className="text-[10px] font-semibold text-violet-700">+{n}</span>}</div>
      <div className="ml-4 text-[11px] text-slate-400 truncate">{nameOf(i.owner_id) || '담당 없음'}</div>
    </button>
  );

  return (
    <section>
      <PageHeader title="히스토리 관리" sub="과제별 히스토리를 쌓아 두고, 맥락 전달이 필요할 때 팀원에게 한 번에 보냅니다." />
      {!hists.data?.length ? (
        <Card><Empty icon={<HistoryIcon size={18} />} title="과제 히스토리를 만들어 볼까요?"
          action={<Button loading={!!batch} disabled={!targets.length} onClick={() => createAll(targets.map((i) => i.id))}><Sparkles size={14} />{batch ? `만드는 중 ${batch.done}/${batch.total}` : `히스토리 만들기 · 과제 ${targets.length}개`}</Button>}>
          지금까지 쌓인 결과물 · 피드백 · 대화 · 요청 · 변경 이력으로 과제마다 히스토리를 한 장씩 만듭니다. 처음 한 번만 전체를 읽고, 그다음부터는 매주 월요일 아침 새 기록만 합쳐 업데이트합니다.
          1on1 · 컨디션 · 평가 · 코칭은 읽지 않습니다.
        </Empty></Card>
      ) : (
        <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
          <aside className="rounded-2xl bg-slate-100/70 p-2.5 lg:sticky lg:top-20">
            <label className="flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-slate-200 px-2.5 py-1.5 mb-2"><Search size={13} className="text-slate-400" />
              <input value={qtext} onChange={(e) => setQtext(e.target.value)} placeholder="과제 찾기" className="flex-1 text-xs bg-transparent focus:outline-none" /></label>
            {!!requests.length && (<>
              <div className="text-[10px] font-semibold text-violet-700 px-1.5 mt-1 mb-1 inline-flex items-center gap-1"><Inbox size={11} />받은 요청 {requests.length}</div>
              {requests.map((r) => { const it = (items.data ?? []).find((i) => i.id === r.item_id); return (
                <button key={r.id} onClick={() => { const p = new URLSearchParams(params); p.set('item', r.item_id); p.set('request', r.id); setParams(p, { replace: true }); }}
                  className="w-full text-left rounded-lg px-2.5 py-2 mb-0.5 bg-violet-50 ring-1 ring-violet-100 hover:ring-violet-300">
                  <div className="text-[13px] font-semibold text-violet-900 truncate">{it?.title ?? '과제'}</div>
                  <div className="text-[11px] text-violet-700 truncate">{nameOf(r.to_id)} · {fmtShort(r.created_at)}{r.note && ` · ${r.note}`}</div>
                </button>); })}
            </>)}
            {!!recent.length && <div className="text-[10px] font-semibold text-slate-400 px-1.5 mt-2 mb-1">이번 주 업데이트</div>}
            {recent.map((i) => <Row key={i.id} i={i} n={histOf.get(i.id)!.new_count} />)}
            {!!quiet.length && <div className="text-[10px] font-semibold text-slate-400 px-1.5 mt-2 mb-1">변동 없음</div>}
            {quiet.map((i) => <Row key={i.id} i={i} />)}
            {!!none.length && (<>
              <div className="text-[10px] font-semibold text-slate-400 px-1.5 mt-2 mb-1 flex items-center">아직 히스토리 없음
                <button className="ml-auto text-indigo-700 font-semibold disabled:opacity-50" disabled={!!batch} onClick={() => createAll(none.map((i) => i.id))}>{batch ? `${batch.done}/${batch.total}` : '모두 만들기'}</button></div>
              {none.map((i) => <Row key={i.id} i={i} />)}
            </>)}
          </aside>

          <div className="min-w-0 space-y-3">
            {!item ? <Card><Empty title="왼쪽에서 과제를 고르세요" /></Card> : !hist ? (
              <Card><Empty icon={<HistoryIcon size={18} />} title={item.title} action={<Button loading={a.update.isPending} onClick={() => a.update.mutate({ itemIds: [item.id] })}><Sparkles size={14} />히스토리 만들기</Button>}>
                이 과제의 기록으로 히스토리를 만듭니다. 처음에는 30초~1분쯤 걸립니다.</Empty></Card>
            ) : (
              <>
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[280px]">
                    <div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-bold">{item.title}</h2>
                      <span className="text-xs text-slate-500">담당 {hist.content.owner?.previous?.length ? `${hist.content.owner.previous.join(' → ')} → ` : ''}{nameOf(item.owner_id) || '없음'}</span></div>
                    <p className="text-[13.5px] text-slate-700 mt-1">{applyEdits(hist.content, hist.edits).summary}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400 flex-wrap"><Sparkles size={11} className="text-violet-500" />
                      {fmtShort(hist.updated_at)} 업데이트 · 새 기록 {hist.new_count}건 반영 · 누적 기록 {hist.record_count}건 · 매주 월요일 자동
                      <button className="inline-flex items-center gap-1 text-indigo-600 font-semibold disabled:opacity-50" disabled={a.update.isPending} onClick={() => a.update.mutate({ itemIds: [item.id], force: true })}>
                        <RefreshCw size={11} className={cx(a.update.isPending && 'animate-spin')} />{a.update.isPending ? '업데이트 중…' : '지금 업데이트'}</button></div>
                  </div>
                  <Button onClick={() => setSendOpen(true)}><Send size={14} />팀원에게 전달</Button>
                </div>
                <HistoryView title={item.title} content={applyEdits(hist.content, hist.edits)} edits={hist.edits} editable onEdit={(e) => a.edit.mutate({ itemId: item.id, edits: e })} />
                <Card>
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 text-sm"><MessageSquare size={14} className="text-slate-400" /><b>전달 기록</b>
                    <span className="text-xs text-slate-400">{itemShares.length}건 · 확인 {itemShares.filter((s) => s.status === 'read').length}</span></div>
                  {!itemShares.length ? <p className="px-4 py-4 text-sm text-slate-400">아직 전달하지 않았습니다. 과제를 넘기거나 함께 일할 사람에게 [팀원에게 전달]로 보내 보세요.</p>
                    : <ul>{itemShares.map((s) => <ShareRow key={s.id} s={s} focus={params.get('share') === s.id} />)}</ul>}
                </Card>
                <SendModal open={sendOpen} onClose={() => { setSendOpen(false); const p = new URLSearchParams(params); p.delete('send'); p.delete('to'); p.delete('request'); setParams(p, { replace: true }); }}
                  item={item} hist={hist} request={request} />
              </>
            )}
            {item && !hist && request && (
              <Card className="px-4 py-3 text-sm flex items-center gap-2"><Inbox size={14} className="text-violet-600" /><b>{nameOf(request.to_id)}</b> 님의 요청 — 히스토리를 만든 뒤 전달할 수 있습니다.
                <button className="ml-auto text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1" onClick={() => a.decline.mutate(request.id)}><X size={12} />요청 보류</button></Card>
            )}
            {item && hist && request && (
              <div className="text-xs text-slate-500 flex items-center gap-2"><CheckCircle2 size={12} className="text-violet-600" />{nameOf(request.to_id)} 님 요청에 답하는 중
                <button className="ml-auto hover:text-slate-800" onClick={() => a.decline.mutate(request.id)}>요청 보류</button></div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
