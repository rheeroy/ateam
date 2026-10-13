// 팀원 한 사람 페이지 — 컨디션 · 1:1 · 맡은 일 · 결과물 · 관찰 · 근거 원장
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Award, CalendarPlus, ChevronRight, FileText, MessageSquare, Send, StickyNote } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import { useItems } from '../lib/items';
import { useLatestAi } from '../lib/hooks';
import type { ActionItem } from '../lib/types';
import { cx, daysAgo, fmtDate, fmtShort, relDay, fmtTime } from '../lib/format';
import { EVIDENCE_LABEL, useCheckins, useEvidence, useJudgmentScores, useObservations, useOneOnOneMap, trendOf } from '../lib/people';
import { useSubmissionsAi } from '../lib/work';
import { Avatar, Card, Pill, Spinner } from '../components/ui';
import { AiBar, AiChip } from '../components/AiBar';
import { PlanBar } from '../components/goals/PlanBar';
import { RequestModal } from '../components/RequestModal';
import { MemoModal, Sparkline } from '../components/home/shared';
import { ScheduleModal } from './OneOnOnes';
import { STATUS as SUB_STATUS } from './MySubmissions';
import { Delta } from './People';

interface Prep { last_time: string; watch: string; questions: string[]; recent_work: string }
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
const OBS: Record<string, { label: string; cls: string }> = { praise: { label: '칭찬', cls: 'bg-emerald-50 text-emerald-700' }, concern: { label: '우려', cls: 'bg-rose-50 text-rose-700' }, note: { label: '메모', cls: 'bg-slate-100 text-slate-600' } };

export default function PersonDetail() {
  const { id } = useParams();
  const { team, members } = useTeam();
  const mb = members.find((x) => x.user_id === id);
  const [memo, setMemo] = useState(false);
  const [oo, setOo] = useState(false);
  const [req, setReq] = useState(false);
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
            <button onClick={() => setMemo(true)} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><StickyNote size={15} />관찰 메모</button>
            <button onClick={() => setReq(true)} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Send size={15} />요청</button>
            <Link to={`/eval?member=${id}`} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Award size={15} />평가 초안</Link>
            <button onClick={() => setOo(true)} className="text-sm rounded-xl px-3 py-2 bg-teal-600 text-white hover:bg-teal-700 inline-flex items-center gap-1.5"><CalendarPlus size={15} />1:1 잡기</button>
          </div>
        </div>
      </div>

      <AiBar section="people" label={name} filter={(it) => `${it.title} ${it.body}`.includes(name)} n={3}
        emptyHint={`${name} 님을 직접 짚은 AI 해석은 아직 없습니다. 아래 1:1 준비 노트와 결과물 검토를 확인하세요.`} />

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          <Condition teamId={team.id} uid={id} />
          <Items teamId={team.id} uid={id} />
          <Outputs teamId={team.id} uid={id} />
        </div>
        <div className="space-y-4">
          <OneOnOneBox teamId={team.id} uid={id} onNew={() => setOo(true)} />
          <Observations teamId={team.id} uid={id} onNew={() => setMemo(true)} />
          <Ledger teamId={team.id} uid={id} />
        </div>
      </div>

      <MemoModal teamId={team.id} open={memo} preset={id} onClose={() => setMemo(false)} />
      <ScheduleModal open={oo} onClose={() => setOo(false)} memberId={id} />
      <RequestModal open={req} onClose={() => setReq(false)} toId={id} />
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
  const recent = [...rows].reverse().slice(0, 3);
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
          <ul className="sm:col-span-3 space-y-2.5">
            {recent.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="text-[11px] text-slate-400">{fmtShort(c.week_start)} 주 · 컨디션 {c.condition ?? '—'}</div>
                {c.did && <p className="leading-snug line-clamp-2"><b className="text-xs text-slate-500 mr-1">한 일</b>{c.did}</p>}
                {c.blocked && <p className="leading-snug text-rose-700 line-clamp-2"><b className="text-xs mr-1">막힘</b>{c.blocked}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Box>
  );
}

function Items({ teamId, uid }: { teamId: string; uid: string }) {
  const items = useItems(teamId);
  const mine = (items.data ?? []).filter((n) => n.owner_id === uid && n.status !== 'dropped' && n.status !== 'done');
  const done = (items.data ?? []).filter((n) => n.owner_id === uid && n.status === 'done').length;
  return (
    <Box title="맡은 목표·과제" right={<><span className="text-slate-400">완료 {done}건</span><Link to="/goals" className="text-indigo-700 font-semibold">팀목표 →</Link></>}>
      {items.isLoading ? <Spinner /> : !mine.length ? <p className="px-4 py-4 text-sm text-slate-400">진행 중인 담당 항목이 없습니다.</p> : (
        <ul className="divide-y divide-slate-100">
          {mine.slice(0, 8).map((n) => (
            <li key={n.id} className="px-4 py-2.5 grid grid-cols-5 gap-3 items-center">
              <Link to={`/goals?item=${n.id}`} className="col-span-3 text-sm truncate hover:text-indigo-700">{n.title}
                {n.status === 'blocked' && <span className="ml-1.5 text-[10px] font-semibold text-rose-600">막힘</span>}
                {n.due_date && <span className="ml-1.5 text-[11px] text-slate-400">~{fmtShort(n.due_date)}</span>}</Link>
              <div className="col-span-2"><PlanBar item={n} compact /></div>
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}

function Outputs({ teamId, uid }: { teamId: string; uid: string }) {
  const subs = useSubmissionsAi(teamId, { authorId: uid });
  const sc = useJudgmentScores(teamId, uid);
  const list = (sc.data ?? []).map((s) => Number(s.score));
  const t = trendOf(list);
  return (
    <Box title={<>결과물 <AiChip label="AI 1차 검토" /></>} right={<span className="text-slate-500 num">판단 깊이 {t.now ?? '—'}/4 {t.now != null && t.prev != null && <Delta d={t.now - t.prev} />}</span>}>
      {subs.isLoading ? <Spinner /> : !subs.data?.length ? <p className="px-4 py-4 text-sm text-slate-400">올린 결과물이 없습니다.</p> : (
        <ul className="divide-y divide-slate-100">
          {subs.data.slice(0, 6).map((s) => (
            <li key={s.id}><Link to={`/work/${s.id}`} className="px-4 py-2.5 flex items-start gap-3 hover:bg-slate-50">
              <FileText size={15} className="text-slate-400 mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium truncate">{s.title} {s.latest && <span className="font-mono text-[10px] text-indigo-600 bg-indigo-50 rounded px-1">v{s.latest.version}</span>}</span>
                {s.review && <span className="block text-xs text-slate-500 line-clamp-1"><span className="text-violet-700 font-semibold">AI</span> {s.review.summary}</span>}</span>
              {s.review && <span className="text-xs font-semibold num text-violet-700 shrink-0">{s.review.depth_score}/4</span>}
              <Pill tone={SUB_STATUS[s.status].tone}>{SUB_STATUS[s.status].label}</Pill>
            </Link></li>
          ))}
        </ul>
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
