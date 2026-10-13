// 이번 주 팀원관리 액션 — AI가 추천하고, 팀장은 카드에서 바로 실행(1:1 잡기 · 칭찬 배지 · 관찰 기록 · 요청)
import { useState } from 'react';
import { Award, CalendarPlus, Check, ChevronDown, MessageCircleQuestion, RefreshCw, Send, SkipForward, StickyNote, Undo2 } from 'lucide-react';
import { useTeam } from '../../state/session';
import { useGenerate } from '../../lib/hooks';
import { cx, fmtDate, fmtShort } from '../../lib/format';
import { ACTION_META, actionKey, useActionStatus, usePeopleActions, useSendPraise, type PeopleAction } from '../../lib/peopleActions';
import { Avatar, Button, Field, Modal, inputCls } from '../ui';
import { AiBand } from '../AiBar';
import { RequestModal } from '../RequestModal';
import { MemoModal } from '../home/shared';
import { ScheduleModal } from '../../pages/OneOnOnes';

const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');

export function ActionsPanel({ fallback, only }: { fallback: PeopleAction[]; only?: string; compact?: boolean }) {
  const { team, nameOf, hasFeature, members } = useTeam();
  const pa = usePeopleActions(team.id, team.is_demo);
  const st = useActionStatus(team.id);
  const gen = useGenerate('ai-people-actions');
  const ai = !!pa.out;
  const all = (ai ? pa.out!.content.actions : fallback).filter((a) => a.type !== 'workload').filter((a) => !only || a.user_id === only).filter((a) => members.some((m) => m.user_id === a.user_id));
  const week = pa.week;
  const keyOf = (a: PeopleAction) => actionKey(week, a);
  const open = all.filter((a) => !st.map.get(keyOf(a))).sort((a, b) => b.urgency - a.urgency);
  const closed = all.filter((a) => st.map.get(keyOf(a)));
  const [showClosed, setShowClosed] = useState(false);
  const [modal, setModal] = useState<{ kind: 'oo' | 'memo' | 'req' | 'praise'; a: PeopleAction } | null>(null);
  const done = (a: PeopleAction) => st.set.mutate({ key: keyOf(a), status: 'done' });

  const title = only ? `이번 주 ${nameOf(only)} 님께 할 것` : `이번 주 팀원관리 액션 · ${fmtShort(week)} 주`;
  return (
    <AiBand title={ai ? `AI 추천 · ${title}` : `${title} · 자동 추천`}
      right={<>
        {!!all.length && <span className="text-[11px] text-violet-100">완료 {closed.length}/{all.length}</span>}
        {hasFeature('ai_core') && !only && (
          <button disabled={gen.isPending} onClick={() => gen.mutate({ team_id: team.id })}
            className="text-[11px] font-semibold rounded-lg bg-white/15 hover:bg-white/25 px-2 py-1 inline-flex items-center gap-1 disabled:opacity-60">
            <RefreshCw size={11} className={gen.isPending ? 'animate-spin' : ''} />{gen.isPending ? '추천 만드는 중…' : ai ? '다시 추천' : 'AI로 이번 주 추천 받기'}</button>
        )}
      </>}>
      {!only && (ai ? <p className="text-[15px] font-semibold leading-snug">{strip(pa.out!.content.summary)}<span className="ml-2 text-[11px] font-normal text-violet-200">{fmtDate(pa.out!.created_at)} · 매주 월요일 자동</span></p>
        : <p className="text-sm text-violet-50">{pa.stale ? '지난주 추천입니다. ' : ''}아직 이번 주 AI 추천이 없어 기록에서 바로 보이는 것만 골랐습니다. 'AI로 이번 주 추천 받기'를 누르면 명분과 함께 1:1 · 칭찬 · 육성 · 독려까지 정리합니다.</p>)}
      {!open.length ? <p className={cx('text-sm text-violet-100', !only && 'mt-2')}>{all.length ? '이번 주 추천 액션을 모두 처리했습니다.' : '지금 추천할 액션이 없습니다.'}</p> : (
        <ol className={cx('rounded-xl bg-white text-slate-900 divide-y divide-slate-100 overflow-hidden shadow-sm', !only && 'mt-3')}>
          {open.map((a, i) => <Card no={i + 1} key={keyOf(a)} a={a} ai={ai} name={nameOf(a.user_id)} onDo={(kind) => setModal({ kind, a })} onDone={() => done(a)} onSkip={() => st.set.mutate({ key: keyOf(a), status: 'skipped' })} />)}
        </ol>
      )}
      {!!closed.length && (
        <div className="mt-2.5">
          <button onClick={() => setShowClosed((v) => !v)} className="text-[11px] text-violet-100 hover:text-white inline-flex items-center gap-0.5">처리한 액션 {closed.length}<ChevronDown size={12} className={showClosed ? 'rotate-180' : ''} /></button>
          {showClosed && <ul className="mt-1.5 flex flex-wrap gap-1.5">{closed.map((a) => (
            <li key={keyOf(a)} className="text-[11px] rounded-full bg-white/10 px-2 py-0.5 inline-flex items-center gap-1">
              {st.map.get(keyOf(a)) === 'done' ? <Check size={11} /> : <SkipForward size={11} />}{nameOf(a.user_id)} · {ACTION_META[a.type]?.label}
              <button title="되돌리기" onClick={() => st.set.mutate({ key: keyOf(a), status: null })}><Undo2 size={11} /></button></li>
          ))}</ul>}
        </div>
      )}
      {modal?.kind === 'oo' && <ScheduleModal open onClose={() => setModal(null)} memberId={modal.a.user_id} />}
      {modal?.kind === 'memo' && <MemoModal teamId={team.id} open preset={modal.a.user_id} onClose={() => { done(modal.a); setModal(null); }} />}
      {modal?.kind === 'req' && <RequestModal open onClose={() => setModal(null)} toId={modal.a.user_id} defaultKind={modal.a.type === 'push' ? 'progress' : 'other'}
        defaultTitle={strip(modal.a.request || modal.a.title)} onSent={() => done(modal.a)} />}
      {modal?.kind === 'praise' && <PraiseModal a={modal.a} name={nameOf(modal.a.user_id)} onClose={() => setModal(null)} onSent={() => done(modal.a)} />}
    </AiBand>
  );
}

function Card({ no, a, ai, name, onDo, onDone, onSkip }: { no: number; a: PeopleAction; ai: boolean; name: string; onDo: (k: 'oo' | 'memo' | 'req' | 'praise') => void; onDone: () => void; onSkip: () => void }) {
  const meta = ACTION_META[a.type] ?? ACTION_META.push;
  const primary = a.type === 'one_on_one' ? { k: 'oo' as const, label: '1:1 잡기', I: CalendarPlus } : a.type === 'praise' ? { k: 'praise' as const, label: '칭찬 배지', I: Award }
    : a.type === 'observe' ? { k: 'memo' as const, label: '관찰 기록', I: StickyNote } : { k: 'req' as const, label: '요청 보내기', I: Send };
  const extra = a.opener ? { cls: 'text-teal-800', I: MessageCircleQuestion, t: `“${a.opener}”` }
    : a.message ? { cls: 'text-amber-800', I: Award, t: `“${a.message}”` }
    : a.request && a.type !== 'praise' ? { cls: 'text-slate-600', I: Send, t: `요청: ${strip(a.request)}` } : null;
  return (
    <li className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 hover:bg-slate-50/70">
      <span className="hidden md:flex w-7 h-7 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold num items-center justify-center shrink-0">{no}</span>
      <div className="flex items-center gap-2 md:w-40 shrink-0">
        <Avatar name={name} size={7} />
        <span className="min-w-0"><span className="block text-sm font-semibold truncate">{name}</span>
          <span className={cx('inline-block mt-0.5 text-[10px] font-bold rounded-full px-1.5 py-px ring-1', meta.cls)}>{meta.label}</span></span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {a.urgency >= 3 && <span className="shrink-0 text-[10px] font-bold rounded bg-rose-500 text-white px-1">이번 주 꼭</span>}
          <span className="text-sm font-bold leading-snug truncate">{strip(a.title)}</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-600 leading-relaxed line-clamp-2">{ai && <span className="font-semibold text-violet-700 mr-1">명분</span>}{strip(a.why)}</p>
        {extra && <p className={cx('mt-0.5 text-xs leading-relaxed line-clamp-1 flex items-center gap-1', extra.cls)}><extra.I size={12} className="shrink-0" />{extra.t}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" onClick={() => onDo(primary.k)}><primary.I size={13} />{primary.label}</Button>
        <button onClick={onDone} className="text-xs rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100 inline-flex items-center gap-0.5"><Check size={12} />했음</button>
        <button onClick={onSkip} className="text-xs text-slate-400 hover:text-slate-700 px-1">건너뛰기</button>
      </div>
    </li>
  );
}

function PraiseModal({ a, name, onClose, onSent }: { a: PeopleAction; name: string; onClose: () => void; onSent: () => void }) {
  const { team } = useTeam();
  const send = useSendPraise(team.id);
  const [body, setBody] = useState(strip(a.message ?? '') || `${name} 님, `);
  return (
    <Modal open onClose={onClose} title={`칭찬 배지 · ${name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send.mutate({ to: a.user_id, body }, { onSuccess: () => { onSent(); onClose(); } }); }}>
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-4 text-center"><Award size={28} className="mx-auto text-amber-500" /><div className="mt-1 text-sm font-semibold text-amber-900">칭찬 배지</div></div>
        <Field label="보낼 말" hint="무엇을 잘했는지 구체적으로"><textarea rows={3} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">팀원에게 알림으로 가고, 팀장 관찰 기록(칭찬)으로도 남아 평가 근거가 됩니다.</p>
        <Button type="submit" className="w-full" loading={send.isPending}><Award size={14} />보내기</Button>
      </form>
    </Modal>
  );
}
