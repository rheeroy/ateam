// 이번 주 팀원관리 액션 — AI가 추천하고, 팀장은 카드에서 바로 실행(1on1 잡기 · 칭찬 배지 · 관찰 기록 · 요청)
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Award, CalendarPlus, Check, ChevronDown, HeartHandshake, MessageCircleQuestion, RefreshCw, Send, SkipForward, Sprout, StickyNote, Undo2 } from 'lucide-react';
import { useTeam } from '../../state/session';
import { useGenerate } from '../../lib/hooks';
import { cx, fmtDate } from '../../lib/format';
import { ACTION_META, actionKey, useActionStatus, usePeopleActions, useSendPraise, type PeopleAction } from '../../lib/peopleActions';
import { Avatar, Button, Field, Modal, inputCls } from '../ui';
import { AiBand } from '../AiBar';
import { ActionRequestModal } from '../RequestModal';
import { MemoModal } from '../home/shared';
import { ScheduleModal } from '../../pages/OneOnOnes';
import { AiIcon, CoreAI } from '../Brand';

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
  // 3개 넘으면 나머지는 접어 둔다
  const [more, setMore] = useState(false);
  const shown = more ? open : open.slice(0, 3);
  const [modal, setModal] = useState<{ kind: 'oo' | 'memo' | 'req' | 'praise'; a: PeopleAction } | null>(null);
  const done = (a: PeopleAction) => st.set.mutate({ key: keyOf(a), status: 'done' });

  const title = only ? `이번 주 ${nameOf(only)} 님께 하면 좋은 것` : '이번 주 팀원관리 액션';
  return (
    <AiBand title={ai ? title : `${title} · 기록 기반 자동 추천`} cadence="weekly" start={week}
      right={<>
        {!!all.length && <span className="text-[11px] text-slate-500">완료 {closed.length}/{all.length}</span>}
        {hasFeature('ai_core') && !only && (
          <button disabled={gen.isPending} onClick={() => gen.mutate({ team_id: team.id })}
            className="text-[11px] font-semibold rounded-lg bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 px-2 py-1 inline-flex items-center gap-1 disabled:opacity-60">
            {gen.isPending || ai ? <RefreshCw size={11} className={gen.isPending ? 'animate-spin' : ''} /> : <AiIcon size={13} className="text-violet-600" />}{gen.isPending ? '추천 만드는 중…' : ai ? '다시 추천' : '이번 주 추천 받기'}</button>
        )}
      </>}>
      {!only && (ai ? <p className="text-[15px] font-semibold leading-snug">{strip(pa.out!.content.summary)}<span className="ml-2 text-[11px] font-normal text-slate-400">{fmtDate(pa.out!.created_at)} · 매주 월요일 자동</span></p>
        : <p className="text-sm text-slate-600">{pa.stale ? '지난주 추천입니다. ' : ''}아직 이번 주 <CoreAI /> 추천이 없어 기록에서 바로 보이는 것만 골랐습니다. '이번 주 추천 받기'를 누르면 명분과 함께 1on1 · 칭찬 · 육성 · 독려까지 정리합니다.</p>)}
      {!open.length ? <p className={cx('text-sm text-slate-500', !only && 'mt-2')}>{all.length ? '이번 주 추천 액션을 모두 처리했습니다.' : '지금 추천할 액션이 없습니다.'}</p> : (
        <ol className={cx('rounded-xl bg-white text-slate-900 divide-y divide-slate-100 overflow-hidden ring-1 ring-slate-200', !only && 'mt-3')}>
          {shown.map((a, i) => <Card no={i + 1} key={keyOf(a)} a={a} ai={ai} name={nameOf(a.user_id)} onDo={(kind) => setModal({ kind, a })} onDone={() => done(a)} onSkip={() => st.set.mutate({ key: keyOf(a), status: 'skipped' })} />)}
        </ol>
      )}
      {open.length > 3 && (
        <button onClick={() => setMore((v) => !v)} className="mt-2 w-full text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg bg-white/70 ring-1 ring-slate-200 py-1.5 inline-flex items-center justify-center gap-1">
          {more ? '접기' : `나머지 ${open.length - 3}개 더 보기`}<ChevronDown size={13} className={more ? 'rotate-180' : ''} /></button>
      )}
      {!!closed.length && (
        <div className="mt-2.5">
          <button onClick={() => setShowClosed((v) => !v)} className="text-[11px] text-slate-500 hover:text-slate-900 inline-flex items-center gap-0.5">처리한 액션 {closed.length}<ChevronDown size={12} className={showClosed ? 'rotate-180' : ''} /></button>
          {showClosed && <ul className="mt-1.5 flex flex-wrap gap-1.5">{closed.map((a) => (
            <li key={keyOf(a)} className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 inline-flex items-center gap-1">
              {st.map.get(keyOf(a)) === 'done' ? <Check size={11} /> : <SkipForward size={11} />}{nameOf(a.user_id)} · {ACTION_META[a.type]?.label}
              <button title="되돌리기" onClick={() => st.set.mutate({ key: keyOf(a), status: null })}><Undo2 size={11} /></button></li>
          ))}</ul>}
        </div>
      )}
      {modal?.kind === 'oo' && <ScheduleModal open onClose={() => setModal(null)} memberId={modal.a.user_id} />}
      {modal?.kind === 'memo' && <MemoModal teamId={team.id} open preset={modal.a.user_id} onSaved={() => done(modal.a)} onClose={() => setModal(null)} />}
      {modal?.kind === 'req' && <ActionRequestModal type={(['push', 'develop', 'support'] as const).find((t) => t === modal.a.type) ?? 'push'} toId={modal.a.user_id} name={nameOf(modal.a.user_id)}
        defaultText={modal.a.request ? strip(modal.a.request) : undefined} onSent={() => done(modal.a)} onClose={() => setModal(null)} onScheduleOo={() => setModal({ kind: 'oo', a: modal.a })} />}
      {modal?.kind === 'praise' && <PraiseModal a={modal.a} name={nameOf(modal.a.user_id)} onClose={() => setModal(null)} onSent={() => done(modal.a)} />}
    </AiBand>
  );
}

function Card({ no, a, ai, name, onDo, onDone, onSkip }: { no: number; a: PeopleAction; ai: boolean; name: string; onDo: (k: 'oo' | 'memo' | 'req' | 'praise') => void; onDone: () => void; onSkip: () => void }) {
  const meta = ACTION_META[a.type] ?? ACTION_META.push;
  const primary = a.type === 'one_on_one' ? { k: 'oo' as const, label: '1on1 잡기', I: CalendarPlus } : a.type === 'praise' ? { k: 'praise' as const, label: '칭찬 배지', I: Award }
    : a.type === 'observe' ? { k: 'memo' as const, label: '관찰 기록', I: StickyNote } : { k: 'req' as const, ...(a.type === 'support' ? { label: '지원·격려 보내기', I: HeartHandshake } : a.type === 'develop' ? { label: '육성 제안', I: Sprout } : { label: '업무 독려 보내기', I: Send }) };
  const extra = a.opener ? { cls: 'text-teal-800', I: MessageCircleQuestion, t: `“${a.opener}”` }
    : a.message ? { cls: 'text-amber-800', I: Award, t: `“${a.message}”` }
    : a.request && a.type !== 'praise' ? { cls: 'text-slate-600', I: Send, t: `보낼 말: ${strip(a.request)}` } : null;
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

/** 칭찬 기본 문구 — 최근 마친 일이 있으면 그 일을 짚고, 없으면 일반 문구 */
const PRAISE_TPL: { label: string; text: (n: string, t?: string) => string }[] = [
  { label: '마무리', text: (n, t) => t ? `${n} 님, '${t}' 끝까지 잘 마무리해 주셔서 고맙습니다. 꼼꼼하게 챙겨 준 덕분에 팀 일정이 한결 수월해졌어요.` : `${n} 님, 맡은 일을 끝까지 책임지고 마무리해 주셔서 고맙습니다. 덕분에 팀 일정이 한결 수월해졌어요.` },
  { label: '주도성', text: (n, t) => `${n} 님, ${t ? `'${t}'에서 ` : ''}먼저 문제를 찾고 해결 방법까지 제안해 준 점이 정말 좋았습니다. 이런 주도적인 모습이 팀에 큰 힘이 됩니다.` },
  { label: '품질', text: (n, t) => `${n} 님, ${t ? `'${t}' ` : ''}결과물의 완성도가 높아서 따로 손볼 곳이 거의 없었습니다. 근거와 정리가 탄탄해서 믿고 맡길 수 있겠다는 생각이 들었어요.` },
  { label: '협업', text: (n) => `${n} 님, 바쁜 와중에도 동료들을 먼저 챙기고 도와준 모습 고맙습니다. 덕분에 팀 분위기와 속도가 함께 좋아졌어요.` },
];

function useRecentDone(teamId: string, userId: string) {
  return useQuery({
    queryKey: ['praise-recent', teamId, userId],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const { data } = await supabase.from('work_items').select('title, done_at').eq('team_id', teamId).eq('owner_id', userId)
        .gte('done_at', since).order('done_at', { ascending: false }).limit(1);
      return (data?.[0]?.title as string | undefined) ?? null;
    },
    staleTime: 60_000,
  });
}

export function PraiseModal({ a, name, onClose, onSent }: { a: PeopleAction; name: string; onClose: () => void; onSent: () => void }) {
  const { team } = useTeam();
  const send = useSendPraise(team.id);
  const aiMsg = strip(a.message ?? '');
  const recent = useRecentDone(team.id, a.user_id);
  const [tpl, setTpl] = useState(0);
  const [body, setBody] = useState(aiMsg || PRAISE_TPL[0].text(name));
  const [touched, setTouched] = useState(false);
  const short = (t?: string | null) => t ? (t.length > 24 ? `${t.slice(0, 24)}…` : t) : undefined;
  // 최근 마친 일을 불러오면, 아직 손대지 않은 기본 문구만 그 일에 맞춰 바꾼다
  useEffect(() => { if (!aiMsg && !touched && recent.data !== undefined) setBody(PRAISE_TPL[tpl].text(name, short(recent.data))); }, [recent.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (i: number) => { setTpl(i); setTouched(false); setBody(PRAISE_TPL[i].text(name, short(recent.data))); };
  return (
    <Modal open onClose={onClose} title={`칭찬 배지 · ${name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send.mutate({ to: a.user_id, body }, { onSuccess: () => { onSent(); onClose(); } }); }}>
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-4 text-center"><Award size={28} className="mx-auto text-amber-500" /><div className="mt-1 text-sm font-semibold text-amber-900">칭찬 배지</div></div>
        <Field label="보낼 말" hint="무엇을 잘했는지 구체적으로 · 고쳐서 보내도 됩니다">
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {PRAISE_TPL.map((t, i) => (
              <button key={t.label} type="button" onClick={() => pick(i)}
                className={cx('text-[11px] rounded-full px-2.5 py-1 ring-1', !aiMsg && i === tpl && !touched ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>{t.label}</button>
            ))}
          </div>
          <textarea rows={4} className={inputCls} value={body} onChange={(e) => { setTouched(true); setBody(e.target.value); }} />
        </Field>
        <p className="text-xs text-slate-500">팀원에게 알림으로 가고, 팀장 관찰 기록(칭찬)으로도 남아 평가 근거가 됩니다.</p>
        <Button type="submit" className="w-full" loading={send.isPending} disabled={!body.trim()}><Award size={14} />보내기</Button>
      </form>
    </Modal>
  );
}
