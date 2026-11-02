// 목표 한 장 — 최상위 목표 하나를 크게: 지표 · 과제 트리 · 결과물 · 성과입력 · 담당자 · 변경 이력
//   팀목표 오른쪽 패널의 확대 아이콘으로 들어온다. 고치는 일은 지금처럼 패널(ItemDetail)에서
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Crosshair, FileText, History, Pencil, Repeat, Target, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import { buildTree, STATUS_META, useItems, useLevelNames, type Node } from '../lib/items';
import { currentLabel, latestPayload, payloadLabel } from '../lib/checkin';
import { isRoutine, useSubmissionsAi } from '../lib/work';
import type { CheckinPayload, Submission, WorkItemEvent } from '../lib/types';
import { cx, fmtDate, fmtShort } from '../lib/format';
import { Avatar, Card, Empty, Pill, Spinner } from '../components/ui';
import { AiChip } from '../components/AiBar';
import { PlanBar } from '../components/goals/PlanBar';
import { EVENT_LABEL, evText, ItemDetail } from '../components/goals/ItemDetail';
import { STATUS as SUB_STATUS } from './MySubmissions';

type Outlook = { goal_id: string; probability: number | null };
type CkRow = Submission & { submission_versions: { version: number; checkin: CheckinPayload | null; created_at: string }[] };

export default function GoalPage() {
  const { id } = useParams();
  const { team, nameOf, isLeader } = useTeam();
  const levelName = useLevelNames();
  const [params, setParams] = useSearchParams();
  const items = useItems(team.id);
  const { byId } = useMemo(() => buildTree((items.data ?? []).filter((x) => x.status !== 'dropped')), [items.data]);
  const goal = id ? byId.get(id) : undefined;
  // 이 목표와 그 아래 전부
  const all = useMemo(() => { const out: Node[] = []; const walk = (n: Node) => { out.push(n); n.children.forEach(walk); }; if (goal) walk(goal); return out; }, [goal]);
  const ids = useMemo(() => all.map((n) => n.id), [all]);
  const idSet = useMemo(() => new Set(ids), [ids]);

  const outlook = useQuery({ queryKey: ['goal-outlook', team.id], enabled: isLeader, queryFn: () => q<Outlook[]>(supabase.rpc('goal_outlook', { p_team: team.id })) });
  const subs = useSubmissionsAi(team.id);
  const checkins = useQuery({
    queryKey: ['goal-checkins', team.id, id, ids.length], enabled: ids.length > 0,
    queryFn: () => q<CkRow[]>(supabase.from('submissions').select('*, submission_versions(version, checkin, created_at)').eq('team_id', team.id).eq('kind', 'checkin').in('item_id', ids).order('updated_at', { ascending: false }).limit(30)),
  });
  const events = useQuery({
    queryKey: ['goal-events', id, ids.length], enabled: ids.length > 0,
    queryFn: () => q<WorkItemEvent[]>(supabase.from('work_item_events').select('*').in('item_id', ids).neq('kind', 'created').order('created_at', { ascending: false }).limit(20)),
  });

  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const open = params.get('item') ? byId.get(params.get('item')!) : null;
  const back = isLeader ? '/goals' : '/my/goals';

  if (items.isLoading) return <Spinner />;
  if (!goal) return <Empty title="목표를 찾을 수 없습니다"><Link to={back} className="text-indigo-700 font-semibold">팀목표로 →</Link></Empty>;
  // 하위 항목 주소로 들어오면 그 항목의 최상위 목표로
  if (goal.depth > 0) {
    const root = byId.get(goal.path[0]);
    if (root) return <Empty title={`${levelName(goal.depth)}은 목표 화면에서 봅니다`}><Link to={`/goals/${root.id}?item=${goal.id}`} className="text-indigo-700 font-semibold">{root.title} →</Link></Empty>;
  }

  const metrics = goal.children.filter((c) => c.role === 'metric');
  const tasks = goal.children.filter((c) => c.role !== 'metric');
  const work = all.filter((n) => n.id !== goal.id && n.role !== 'metric');
  const blocked = work.filter((n) => n.status === 'blocked');
  const prob = (outlook.data ?? []).find((o) => o.goal_id === goal.id)?.probability ?? null;
  const results = (subs.data ?? []).filter((s) => s.item_id && idSet.has(s.item_id) && s.kind !== 'checkin');
  const cks = checkins.data ?? [];
  // 담당자별: 맡은 항목 · 평균 진척 · 막힘
  const owners = (() => {
    const m = new Map<string, Node[]>();
    for (const n of all) if (n.owner_id && n.id !== goal.id) m.set(n.owner_id, [...(m.get(n.owner_id) ?? []), n]);
    return [...m.entries()].map(([uid, ns]) => ({ uid, n: ns.length, avg: Math.round(ns.reduce((a, x) => a + (x.status === 'done' ? 100 : x.progress), 0) / ns.length), blocked: ns.filter((x) => x.status === 'blocked').length }))
      .sort((a, b) => b.n - a.n);
  })();

  return (
    <div className="space-y-5">
      {/* 머리 */}
      <div>
        <Link to={back} className="inline-flex items-center gap-0.5 text-xs text-slate-500 hover:text-indigo-700"><ChevronLeft size={14} />팀목표</Link>
        <div className="mt-1 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center shadow-sm shrink-0"><Target size={20} /></span>
            <div className="min-w-0">
              <div className="text-xs text-slate-500">{levelName(0)}</div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 flex-wrap">{goal.title}<Pill tone={STATUS_META[goal.status].tone}>{STATUS_META[goal.status].label}</Pill></h1>
              <p className="mt-0.5 text-sm text-slate-500 flex items-center gap-1.5 flex-wrap">
                {goal.owner_id && <><Avatar name={nameOf(goal.owner_id)} size={7} /><span>{nameOf(goal.owner_id)}</span><span className="text-slate-300">·</span></>}
                <span>{goal.start_date ? fmtDate(goal.start_date) : '시작일 없음'} ~ {goal.due_date ? fmtDate(goal.due_date) : '마감일 없음'}</span>
              </p>
              {goal.note && <p className="mt-2 text-sm text-slate-600 max-w-3xl whitespace-pre-wrap">{goal.note}</p>}
            </div>
          </div>
          <button onClick={() => setParam('item', goal.id)} className="text-sm rounded-xl px-3.5 py-2 bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5"><Pencil size={14} />상세 · 수정</button>
        </div>
      </div>

      {/* 요약 */}
      <Card className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100">
        <div className="px-5 py-4"><div className="text-[11px] text-slate-500 mb-1.5">계획 대비 달성도</div><PlanBar item={goal} /></div>
        <Num label="달성 가능성" value={prob != null ? `${prob}%` : '—'} sub={isLeader ? '목표별 전망 모델' : '팀장 화면에서 봅니다'} tone={prob != null && prob < 35 ? 'rose' : prob != null && prob < 50 ? 'amber' : undefined} />
        <Num label={`${levelName(1)} · ${levelName(2)}`} value={`${work.length}개`} sub={blocked.length ? `막힘 ${blocked.length}개` : `완료 ${work.filter((n) => n.status === 'done').length}개`} tone={blocked.length ? 'rose' : undefined} />
        <Num label="결과물 · 성과입력" value={`${results.length} · ${cks.length}`} sub="이 목표 아래에서 올라온 것" />
      </Card>

      {blocked.length > 0 && (
        <Card className="px-4 py-3 bg-rose-50/60 ring-rose-100 text-sm flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-rose-600 mt-0.5 shrink-0" />
          <div className="min-w-0"><b className="text-rose-800">막힌 항목 {blocked.length}개</b>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">{blocked.map((n) => (
              <button key={n.id} onClick={() => setParam('item', n.id)} className="text-rose-700 hover:underline">{n.title}{n.owner_id ? ` · ${nameOf(n.owner_id)}` : ''}</button>
            ))}</div></div>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          {/* 지표 */}
          <Card>
            <Head icon={<Crosshair size={15} className="text-indigo-600" />} title="지표" sub={metrics.length ? `${metrics.length}개 · 목표 달성을 재는 숫자` : undefined} />
            {!metrics.length ? <p className="px-5 pb-4 text-sm text-slate-500">아직 지표가 없습니다. 상세 · 수정에서 지표를 걸면 달성 여부를 숫자로 볼 수 있습니다.</p> : (
              <ul className="divide-y divide-slate-100">{metrics.map((m) => (
                <li key={m.id}><button onClick={() => setParam('item', m.id)} className="w-full text-left px-5 py-3 grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_150px_170px] gap-x-4 gap-y-1.5 items-center hover:bg-slate-50">
                  <div className="min-w-0"><div className="font-medium truncate">{m.title}</div><div className="text-[11px] text-slate-400">{m.owner_id ? nameOf(m.owner_id) : '담당 미정'}{m.due_date ? ` · ~${fmtShort(m.due_date)}` : ''}</div></div>
                  <div className="text-right sm:text-left"><b className="num">{currentLabel(m)}</b>{m.measure === 'number' && m.num_target != null && <span className="text-xs text-slate-400 num"> / {m.num_target.toLocaleString()}{m.unit}</span>}</div>
                  <div className="col-span-2 sm:col-span-1"><PlanBar item={m} compact /></div>
                </button></li>
              ))}</ul>
            )}
          </Card>

          {/* 과제 트리 */}
          <Card>
            <Head icon={<Target size={15} className="text-indigo-600" />} title={`${levelName(1)} · ${levelName(2)}`} sub="누르면 오른쪽에 상세가 열립니다" />
            {!tasks.length ? <p className="px-5 pb-4 text-sm text-slate-500">아직 {levelName(1)}가 없습니다.</p> : (
              <div className="overflow-x-auto"><div className="min-w-[620px] text-sm">
                <div className="grid grid-cols-[minmax(0,1fr)_110px_150px_64px] px-5 py-2 border-y border-slate-100 bg-slate-50/70 text-[11px] text-slate-500"><span>항목</span><span>담당</span><span>계획 대비 달성도</span><span>상태</span></div>
                {tasks.flatMap((t) => [t, ...t.children.flatMap(function rec(c: Node): Node[] { return [c, ...c.children.flatMap(rec)]; })]).map((n) => (
                  <button key={n.id} onClick={() => setParam('item', n.id)} className={cx('w-full text-left grid grid-cols-[minmax(0,1fr)_110px_150px_64px] items-center px-5 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50', n.depth === 1 && 'bg-slate-50/30')}>
                    <span className="min-w-0 flex items-center gap-1.5" style={{ paddingLeft: (n.depth - 1) * 18 }}>
                      <span className={cx('truncate', n.depth === 1 ? 'font-medium' : 'text-slate-700')}>{n.title}</span>
                      {isRoutine(n) && <Repeat size={12} className="text-slate-400 shrink-0" />}
                    </span>
                    <span className="flex items-center gap-1.5 min-w-0">{n.owner_id ? <><Avatar name={nameOf(n.owner_id)} size={7} /><span className="text-xs truncate">{nameOf(n.owner_id)}</span></> : <span className="text-xs text-slate-300">미정</span>}</span>
                    <span className="pr-3">{n.measure === 'recurring' ? <span className="text-xs text-slate-400">정기 업무</span> : <PlanBar item={n} compact />}</span>
                    <span><Pill tone={STATUS_META[n.status].tone}>{STATUS_META[n.status].label}</Pill></span>
                  </button>
                ))}
              </div></div>
            )}
          </Card>

          {/* 결과물 */}
          <Card>
            <Head icon={<FileText size={15} className="text-violet-600" />} title="업무플랫폼 결과물" sub={results.length ? `${results.length}건 · 최근 순` : undefined} />
            {!results.length ? <p className="px-5 pb-4 text-sm text-slate-500">이 목표에 태그된 결과물이 아직 없습니다.</p> : (
              <ul className="divide-y divide-slate-100">{results.slice(0, 12).map((s) => {
                const st = SUB_STATUS[s.status as keyof typeof SUB_STATUS];
                return (
                  <li key={s.id}><Link to={`/work/${s.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-violet-50/40">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5"><span className="font-medium truncate">{s.title}</span>{s.latest && <span className="font-mono text-[10px] text-indigo-600 bg-indigo-50 rounded px-1 shrink-0">v{s.latest.version}</span>}</span>
                      <span className="block text-[11px] text-slate-400 truncate">{nameOf(s.author_id)} · {s.item_id && byId.get(s.item_id)?.title}</span>
                      {s.review && <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-600 min-w-0"><AiChip label={`AI ${s.review.depth_score}/4`} /><span className="truncate">{s.review.summary}</span></span>}
                    </span>
                    {st && <Pill tone={st.tone}>{st.label}</Pill>}
                    <ChevronRight size={14} className="text-slate-300 shrink-0" />
                  </Link></li>
                );
              })}</ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {/* 성과입력 */}
          <Card>
            <Head icon={<Crosshair size={15} className="text-indigo-600" />} title="성과입력" sub="팀원이 올린 공식 성과" />
            {!cks.length ? <p className="px-5 pb-4 text-sm text-slate-500">아직 성과입력이 없습니다.</p> : (
              <ul className="divide-y divide-slate-100">{cks.slice(0, 10).map((s) => {
                const p = latestPayload(s); const n = s.item_id ? byId.get(s.item_id) : null;
                return (
                  <li key={s.id}><Link to={isLeader ? `/work/${s.id}` : `/my/submissions?open=${s.id}`} className="block px-5 py-2.5 hover:bg-slate-50">
                    <div className="flex items-center gap-2 text-sm"><span className="font-medium truncate flex-1">{n?.title ?? s.title}</span>
                      <Pill tone={s.status === 'approved' ? 'emerald' : s.status === 'needs_work' ? 'amber' : 'indigo'}>{s.status === 'approved' ? '승인' : s.status === 'needs_work' ? '보완 요청' : '승인 대기'}</Pill></div>
                    <div className="text-[11px] text-slate-500 num">{p ? `${p.prev ?? ''}${p.prev ? ' → ' : ''}${p.label ?? payloadLabel(p, n)}` : ''} · {nameOf(s.author_id)} · {fmtShort(s.updated_at)}</div>
                  </Link></li>
                );
              })}</ul>
            )}
          </Card>

          {/* 담당자 */}
          <Card>
            <Head icon={<Users size={15} className="text-teal-600" />} title="담당자" sub={owners.length ? `${owners.length}명` : undefined} />
            {!owners.length ? <p className="px-5 pb-4 text-sm text-slate-500">담당자가 정해진 항목이 없습니다.</p> : (
              <ul className="px-5 pb-4 space-y-2.5">{owners.map((o) => (
                <li key={o.uid} className="flex items-center gap-2.5 text-sm">
                  <Avatar name={nameOf(o.uid)} size={7} />
                  <span className="min-w-0 flex-1"><span className="font-medium">{nameOf(o.uid)}</span><span className="block text-[11px] text-slate-400">맡은 항목 {o.n}개{o.blocked ? ` · 막힘 ${o.blocked}` : ''}</span></span>
                  <span className="w-20"><span className="block h-1.5 rounded-full bg-slate-100"><span className={cx('block h-full rounded-full', o.blocked ? 'bg-rose-400' : 'bg-indigo-500')} style={{ width: `${o.avg}%` }} /></span><span className="block text-right text-[11px] text-slate-500 num mt-0.5">평균 {o.avg}%</span></span>
                </li>
              ))}</ul>
            )}
          </Card>

          {/* 변경 이력 */}
          <Card>
            <Head icon={<History size={15} className="text-slate-500" />} title="변경 이력" sub="일정 · 목표값 · 담당 · 상태" />
            {!events.data?.length ? <p className="px-5 pb-4 text-sm text-slate-500">처음 계획에서 바뀐 것이 없습니다.</p> : (
              <ul className="px-5 pb-4 space-y-2 text-xs">{events.data.slice(0, 12).map((e) => (
                <li key={e.id} className="flex gap-2"><span className="text-slate-400 w-11 shrink-0">{fmtShort(e.created_at)}</span>
                  <span className="min-w-0"><span className="text-slate-500">{byId.get(e.item_id)?.title}</span> · <b className="font-semibold">{EVENT_LABEL[e.kind] ?? e.kind}</b> {evText(e, nameOf)}{e.reason && <span className="text-slate-500"> · {e.reason}</span>}</span></li>
              ))}</ul>
            )}
          </Card>
        </div>
      </div>

      {open && <ItemDetail key={open.id} item={open} byId={byId} mode={isLeader ? 'leader' : 'member'} onClose={() => setParam('item', null)} />}
    </div>
  );
}

function Head({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return <div className="px-5 pt-4 pb-3 flex items-center gap-2">{icon}<span className="text-sm font-bold text-slate-900">{title}</span>{sub && <span className="text-[11px] text-slate-400">{sub}</span>}</div>;
}

function Num({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'amber' | 'rose' }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={cx('text-2xl font-bold num', tone === 'amber' && 'text-amber-600', tone === 'rose' && 'text-rose-600')}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
