// 팀원 한 사람 페이지 — 컨디션 · 1:1 · 맡은 일 · 결과물 · 관찰 · 근거 원장
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Award, CalendarPlus, ChevronRight, HeartHandshake, MessageSquare, Scale, Send, Sprout, StickyNote } from 'lucide-react';
import { NotesBox } from '../components/notes/Notes';
import { useNotes } from '../lib/notes';
import { CoachModal } from '../components/people/Coaching';
import { LogoMark } from '../components/Brand';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import { useLatestAi } from '../lib/hooks';
import type { ActionItem } from '../lib/types';
import { cx, daysAgo, fmtDate, fmtShort, relDay, fmtTime } from '../lib/format';
import { EVIDENCE_LABEL, useCheckins, useEvidence, useObservations, useOneOnOneMap } from '../lib/people';
import { Avatar, Card, Spinner } from '../components/ui';
import { AiChip } from '../components/AiBar';
import { PraiseModal } from '../components/people/ActionsPanel';
import { usePeopleIndex } from '../components/people/usePeopleIndex';
import { PersonOverview } from '../components/people/PersonOverview';
import { ACTION_META, type Level, type MemberIndex, type PeopleAction } from '../lib/peopleActions';
import { ActionRequestModal, type ActionReqType } from '../components/RequestModal';
import { MemoModal, Sparkline, useHomeModel } from '../components/home/shared';
import { ScheduleModal } from './OneOnOnes';

interface Prep { last_time: string; watch: string; questions: string[]; recent_work: string }
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
const OBS: Record<string, { label: string; cls: string }> = { praise: { label: '칭찬', cls: 'bg-emerald-50 text-emerald-700' }, concern: { label: '우려', cls: 'bg-rose-50 text-rose-700' }, note: { label: '메모', cls: 'bg-slate-100 text-slate-600' } };

export default function PersonDetail() {
  const { id } = useParams();
  const { team, members } = useTeam();
  const mb = members.find((x) => x.user_id === id);
  const [memo, setMemo] = useState(false);
  const [oo, setOo] = useState(false);
  const [act, setAct] = useState<ActionReqType | null>(null);
  const [praise, setPraise] = useState(false);
  const [coach, setCoach] = useState(false);
  const nav = useNavigate();
  if (!mb || !id) return <Navigate to="/people" replace />;
  const name = mb.profiles?.full_name ?? '팀원';
  return (
    <div className="space-y-5">
      <div>
        <Link to="/people" className="text-sm text-slate-500 hover:text-teal-700 inline-flex items-center gap-1"><ArrowLeft size={14} />팀원관리</Link>
        <div className="mt-2 flex items-end justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="rounded-full ring-2 ring-teal-400 ring-offset-2"><Avatar name={name} size={9} /></span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
              <p className="text-sm text-slate-500">{mb.job_title || '직무 미입력'} · {fmtDate(mb.joined_at)} 합류 · 주 {mb.weekly_hours}시간</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <MemoButton uid={id} name={name} />
            <Link to={`/eval?member=${id}`} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Award size={15} />평가 시뮬레이션</Link>
          </div>
        </div>
        {/* 모든 액션 — 팀원관리 액션 종류 7가지를 바로 */}
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-400 mr-1">액션</span>
          <button onClick={() => setCoach(true)} title="말하기 껄끄러운 개선점을 ATEAM이 코치처럼 대신 알려 줍니다" className="text-xs font-bold rounded-full px-3 py-1.5 inline-flex items-center gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"><LogoMark size={12} /><span><span className="font-extrabold">ATEAM</span>의 코칭</span></button>
          {([
            ['one_on_one', CalendarPlus, () => setOo(true)],
            ['praise', Award, () => setPraise(true)],
            ['observe', StickyNote, () => setMemo(true)],
            ['develop', Sprout, () => setAct('develop')],
            ['push', Send, () => setAct('push')],
            ['support', HeartHandshake, () => setAct('support')],
            ['workload', Scale, () => nav('/goals/edit?view=table')],
          ] as const).map(([k, I, on]) => (
            <button key={k} onClick={on} className={cx('text-xs font-semibold rounded-full ring-1 px-3 py-1.5 inline-flex items-center gap-1.5 hover:brightness-95', ACTION_META[k].cls)}><I size={13} />{ACTION_META[k].label}</button>
          ))}
        </div>
      </div>

      <PersonTop uid={id} />

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          <PersonOverview uid={id} name={name} />
          <Condition teamId={team.id} uid={id} />
          <Observations teamId={team.id} uid={id} onNew={() => setMemo(true)} />
        </div>
        <div className="space-y-4">
          <OneOnOneBox teamId={team.id} uid={id} onNew={() => setOo(true)} />
          <Ledger teamId={team.id} uid={id} />
        </div>
      </div>

      <MemoModal teamId={team.id} open={memo} preset={id} onClose={() => setMemo(false)} />
      <ScheduleModal open={oo} onClose={() => setOo(false)} memberId={id} />
      {act && <ActionRequestModal type={act} toId={id} name={name} onClose={() => setAct(null)} onScheduleOo={() => setOo(true)} />}
      {coach && <CoachModal memberId={id} name={name} onClose={() => setCoach(false)} />}
      {praise && <PraiseModal a={{ user_id: id, type: 'praise' } as PeopleAction} name={name} onClose={() => setPraise(false)} onSent={() => {}} />}
    </div>
  );
}

/** 표준 지표 (신호등) — 상세에서는 Core Insight 액션을 따로 띄우지 않는다 */
function PersonTop({ uid }: { uid: string }) {
  const m = useHomeModel('weekly');
  const pi = usePeopleIndex(m);
  const ix = pi.idx.get(uid);
  return (
    <>
      <section className="rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-950 text-white px-4 py-3.5 shadow-sm">
        <div className="flex items-center gap-2 mb-3 flex-wrap"><span className="font-semibold text-sm">주요 지표</span>
          {ix && <SignalCount ix={ix} />}
          {ix?.flight.note && <span className="text-xs text-slate-400 truncate">· 이탈 가능성 근거: {ix.flight.note}</span>}</div>
        {pi.loading ? <Spinner /> : <SignalGrid ix={ix} />}
      </section>
    </>
  );
}

/** 신호등 — 지표마다 빨강·노랑·초록 중 하나에 불이 들어온다 */
const LAMP: Record<Exclude<Level, 'none'>, { on: string; glow: string; text: string; label: string }> = {
  risk: { on: 'bg-rose-500', glow: 'shadow-[0_0_6px_1px_rgba(244,63,94,0.8)]', text: 'text-rose-400', label: '위험' },
  watch: { on: 'bg-amber-400', glow: 'shadow-[0_0_6px_1px_rgba(251,191,36,0.75)]', text: 'text-amber-300', label: '주의' },
  good: { on: 'bg-emerald-400', glow: 'shadow-[0_0_6px_1px_rgba(52,211,153,0.7)]', text: 'text-white', label: '양호' },
};
function Lamps({ level }: { level: Level }) {
  return (
    <span className="inline-flex items-center gap-[3px] rounded-full bg-black/40 ring-1 ring-white/10 px-1.5 py-1" aria-label={level === 'none' ? '데이터 없음' : LAMP[level].label}>
      {(['risk', 'watch', 'good'] as const).map((k) => <span key={k} className={cx('w-2 h-2 rounded-full', level === k ? cx(LAMP[k].on, LAMP[k].glow) : 'bg-white/15')} />)}
    </span>
  );
}
function SignalCount({ ix }: { ix: MemberIndex }) {
  const n = (l: Level) => ix.indices.filter((i) => i.level === l).length;
  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-slate-400">
      {(['risk', 'watch', 'good'] as const).map((k) => n(k) ? <span key={k} className="inline-flex items-center gap-1"><span className={cx('w-2 h-2 rounded-full', LAMP[k].on)} />{LAMP[k].label} <b className="num text-white">{n(k)}</b></span> : null)}
    </span>
  );
}
/** 박스 없이 세로 구분선으로만 나눈 신호등 줄 */
function SignalGrid({ ix }: { ix?: MemberIndex }) {
  if (!ix) return null;
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-y-3 lg:divide-x lg:divide-white/10">
      {ix.indices.map((i) => {
        const L = i.level === 'none' ? null : LAMP[i.level];
        return (
          <div key={i.key} className="px-3 first:pl-0 lg:first:pl-0">
            <div className="flex items-center gap-1.5"><dt className="text-[11px] text-slate-400 truncate">{i.label}</dt><span className="ml-auto"><Lamps level={i.level} /></span></div>
            <dd className={cx('mt-1 text-lg font-bold num leading-tight', L ? L.text : 'text-slate-500')}>{i.value}</dd>
            {i.sub && <dd className="mt-0.5 text-[10px] text-slate-500 truncate">{i.sub}</dd>}
          </div>
        );
      })}
    </dl>
  );
}

/** 우측 상단 '내 메모' — 눌러서 이 팀원에 대한 메모를 보고 바로 남긴다 (나만 보기) */
function MemoButton({ uid, name }: { uid: string; name: string }) {
  const notes = useNotes({ type: 'member', id: uid });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[role="dialog"], .fixed')) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const n = (notes.data ?? []).filter((x) => !(x.kind === 'todo' && x.done)).length;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((x) => !x)} className={cx('text-sm rounded-xl px-3 py-2 ring-1 inline-flex items-center gap-1.5', open ? 'bg-amber-100 ring-amber-300 text-amber-900' : 'bg-amber-50 ring-amber-200 text-amber-800 hover:ring-amber-300')}>
        <StickyNote size={15} />내 메모{n ? <span className="num text-xs font-semibold rounded-full bg-amber-200/80 px-1.5">{n}</span> : ' 남기기'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-1.5">
          <NotesBox anchor={{ type: 'member', id: uid, label: name }} title={`${name} 님 메모`} />
        </div>
      )}
    </div>
  );
}

function Box({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2"><span className="font-semibold text-sm flex items-center gap-2">{title}</span><span className="ml-auto flex items-center gap-2 text-xs">{right}</span></div>
      {children}
    </Card>
  );
}

function Condition({ teamId, uid }: { teamId: string; uid: string }) {
  const ci = useCheckins(teamId, uid, 12);
  const rows = ci.data ?? [];
  const pts = rows.map((c) => c.condition);
  const last = [...pts].reverse().find((v) => v != null) ?? null;
  return (
    <Box title="컨디션 · 체크인" right={<span className="text-slate-400">최근 12주</span>}>
      {ci.isLoading ? <Spinner /> : !rows.length ? <p className="px-4 py-4 text-sm text-slate-400">아직 체크인이 없습니다.</p> : (
        <div className="p-4 grid sm:grid-cols-5 gap-4">
          <div className="sm:col-span-2">
            <div className="text-[11px] text-slate-500">지금 컨디션</div>
            <div className={cx('text-4xl font-bold num', last != null && last <= 2 ? 'text-rose-600' : '')}>{last ?? '—'}<span className="text-base text-slate-400">/5</span></div>
            <Sparkline points={pts} labels={rows.map((c) => fmtShort(c.week_start))} tone={last != null && last <= 2 ? 'rose' : 'teal'} w={200} h={40} />
          </div>
          <div className="sm:col-span-3">
            <div className="text-[11px] text-slate-500 mb-1.5">주별 컨디션</div>
            <div className="flex items-end gap-1.5 h-20">
              {rows.map((c) => (
                <div key={c.id} className="flex-1 flex flex-col items-center gap-1" title={`${fmtShort(c.week_start)} 주 · ${c.condition ?? '-'}`}>
                  <div className={cx('w-full rounded-t', c.condition == null ? 'bg-slate-100' : c.condition <= 2 ? 'bg-rose-400' : c.condition === 3 ? 'bg-amber-300' : 'bg-teal-400')} style={{ height: `${((c.condition ?? 0.3) / 5) * 64}px` }} />
                  <span className="text-[9px] text-slate-400 num">{fmtShort(c.week_start).replace(/^\d+\//, '')}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">한 일·막힘 같은 업무 내용은 업무플랫폼의 팀원 스페이스에 있습니다.</p>
          </div>
        </div>
      )}
    </Box>
  );
}



function OneOnOneBox({ teamId, uid, onNew }: { teamId: string; uid: string; onNew: () => void }) {
  const map = useOneOnOneMap(teamId);
  const rows = (map.data?.rows ?? []).filter((o) => o.member_id === uid);
  const next = map.data?.next.get(uid); const last = map.data?.last.get(uid);
  const prep = useLatestAi<Prep>(teamId, 'one_on_one_prep', { subject: uid });
  const promises = useQuery({
    queryKey: ['promises', teamId, uid],
    queryFn: () => q<(ActionItem & { one_on_ones: { member_id: string } | null })[]>(supabase.from('action_items').select('*, one_on_ones(member_id)').eq('team_id', teamId).is('done_at', null)),
  });
  const open = (promises.data ?? []).filter((a) => a.owner_id === uid || a.one_on_ones?.member_id === uid);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Box title={<><MessageSquare size={14} className="text-teal-600" />1:1</>} right={<button onClick={onNew} className="text-teal-700 font-semibold">잡기</button>}>
      <div className="p-4 space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-[10px] text-slate-500">다음</div>
            {next ? <Link to={`/one-on-ones/${next.id}`} className="font-semibold hover:text-teal-700">{relDay(next.scheduled_at)} {fmtTime(next.scheduled_at)}</Link> : <span className="text-slate-400">없음</span>}</div>
          <div className={cx('rounded-xl px-3 py-2', !last || daysAgo(last.scheduled_at) > 14 ? 'bg-amber-50' : 'bg-slate-50')}><div className="text-[10px] text-slate-500">마지막</div>
            {last ? <Link to={`/one-on-ones/${last.id}`} className="font-semibold hover:text-teal-700">{daysAgo(last.scheduled_at)}일 전</Link> : <span className="text-amber-800 font-semibold">기록 없음</span>}</div>
        </div>
        {prep.data ? (
          <div className="rounded-xl bg-violet-50 ring-1 ring-violet-100 p-3">
            <div className="flex items-center gap-1.5"><AiChip label="AI 준비 노트" tone="solid" /><span className="text-[10px] text-slate-400">{fmtDate(prep.data.created_at)}</span></div>
            {prep.data.content.watch && <p className="mt-1.5 text-xs text-slate-700">{strip(prep.data.content.watch)}</p>}
            {!!prep.data.content.questions?.length && <ul className="mt-1.5 space-y-0.5">{prep.data.content.questions.slice(0, 2).map((x, i) => <li key={i} className="text-xs text-violet-900">• {x}</li>)}</ul>}
          </div>
        ) : <p className="text-xs text-slate-500 rounded-xl bg-violet-50/60 px-3 py-2"><AiChip label="AI 준비 노트" className="mr-1" />1:1을 열면 지난 대화·체크인·결과물을 엮은 준비 노트를 만듭니다.</p>}
        {!!open.length && (
          <div><div className="text-[11px] font-semibold text-slate-500">열린 약속</div>
            <ul className="mt-1 space-y-1">{open.slice(0, 4).map((a) => <li key={a.id} className="text-xs flex gap-1.5"><span className={cx(a.due_date && a.due_date < today ? 'text-rose-600' : 'text-slate-400')}>•</span><span className="flex-1">{a.title}</span>{a.due_date && <span className={cx('num', a.due_date < today ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{fmtShort(a.due_date)}</span>}</li>)}</ul></div>
        )}
        {rows.filter((o) => o.status === 'done').slice(0, 3).map((o) => (
          <Link key={o.id} to={`/one-on-ones/${o.id}`} className="flex items-center gap-2 text-xs hover:text-teal-700"><span className="text-slate-400 num w-12">{fmtShort(o.scheduled_at.slice(0, 10))}</span><span className="truncate flex-1">{o.shared_notes.split('\n')[0] || '(노트 없음)'}</span><ChevronRight size={12} className="text-slate-300" /></Link>
        ))}
      </div>
    </Box>
  );
}

function Observations({ teamId, uid, onNew }: { teamId: string; uid: string; onNew: () => void }) {
  const obs = useObservations(teamId, uid, 183);
  return (
    <Box title="관찰 메모" right={<button onClick={onNew} className="text-teal-700 font-semibold">남기기</button>}>
      {obs.isLoading ? <Spinner /> : !obs.data?.length ? <p className="px-4 py-4 text-sm text-slate-400">아직 없습니다. 눈에 띈 장면을 한 줄로 남기면 평가 근거가 됩니다.</p> : (
        <ul className="divide-y divide-slate-100">{obs.data.slice(0, 5).map((o) => (
          <li key={o.id} className="px-4 py-2.5 text-sm"><span className={cx('text-[10px] font-semibold rounded px-1.5 py-0.5 mr-1.5', OBS[o.kind]?.cls)}>{OBS[o.kind]?.label}</span>{o.body}
            <span className="block text-[11px] text-slate-400 mt-0.5">{fmtDate(o.occurred_at)}{o.competency && ` · ${o.competency}`}</span></li>
        ))}</ul>
      )}
    </Box>
  );
}

/** 근거 원장 — 일하면서 자동으로 쌓이는 평가 근거 */
function Ledger({ teamId, uid }: { teamId: string; uid: string }) {
  const ev = useEvidence(teamId, uid, 183);
  const rows = ev.data ?? [];
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.source, (by.get(r.source) ?? 0) + 1);
  const max = Math.max(1, ...by.values());
  return (
    <Box title="평가 근거 원장" right={<Link to={`/eval?member=${uid}`} className="text-indigo-700 font-semibold">평가 초안 →</Link>}>
      <div className="p-4">
        <div className="flex items-baseline gap-2"><span className="text-2xl font-bold num">{rows.length}</span><span className="text-xs text-slate-500">건 · 최근 6개월 자동 축적</span></div>
        {ev.isLoading ? <Spinner /> : (
          <ul className="mt-3 space-y-1.5">
            {[...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <li key={k} className="flex items-center gap-2 text-xs"><span className="w-20 text-slate-600 shrink-0">{EVIDENCE_LABEL[k] ?? k}</span>
                <span className="flex-1 h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-teal-500" style={{ width: `${(n / max) * 100}%` }} /></span>
                <span className="w-6 text-right num font-semibold">{n}</span></li>
            ))}
            {!rows.length && <li className="text-sm text-slate-400">아직 쌓인 근거가 없습니다.</li>}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">체크인 · 1:1 · 결과물 · 리뷰 피드백 · 관찰 메모 · 업무 완료가 따로 정리하지 않아도 여기에 쌓이고, 평가 초안은 이 근거로만 씁니다.</p>
      </div>
    </Box>
  );
}
