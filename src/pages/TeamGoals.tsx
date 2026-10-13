// 팀목표 — 연도별 타임라인 하나로: 담당자 · 계획 대비 달성도 · 일정, 펼치면 하위 과제와 업무플랫폼 결과물
import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileText, History, Pencil, Repeat, Sparkles, Target } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import { buildTree, STATUS_META, useItems, useLevelNames, type Node } from '../lib/items';
import { GAP_TONE, planGap, yearOf } from '../lib/plan';
import { isRoutine, useSubmissionsAi, type SubRow } from '../lib/work';
import { cx, fmtShort } from '../lib/format';
import { Avatar, Card, Empty, Pill, Spinner } from '../components/ui';
import { AiChip } from '../components/AiBar';
import { MissionBand } from '../components/goals/MissionBand';
import { PlanBar } from '../components/goals/PlanBar';
import { ItemDetail } from '../components/goals/ItemDetail';
import { PlanDraftModal } from '../components/goals/PlanAI';
import { STATUS as SUB_STATUS } from './MySubmissions';

const DAY = 86400000;
const T = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z');
const COLS = 'grid-cols-[minmax(250px,2.3fr)_118px_170px_74px_minmax(380px,3.6fr)]';
type Outlook = { goal_id: string; probability: number | null };

export default function TeamGoals() {
  const { team, nameOf } = useTeam();
  const levelName = useLevelNames();
  const [params, setParams] = useSearchParams();
  const items = useItems(team.id);
  const subs = useSubmissionsAi(team.id);
  const outlook = useQuery({ queryKey: ['goal-outlook', team.id], queryFn: () => q<Outlook[]>(supabase.rpc('goal_outlook', { p_team: team.id })) });
  const nowYear = new Date().getFullYear();
  const year = Number(params.get('year') ?? nowYear);
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const [draft, setDraft] = useState<{ open: boolean; parent: string | null }>({ open: false, parent: null });

  const { roots, byId } = useMemo(() => buildTree((items.data ?? []).filter((x) => x.status !== 'dropped')), [items.data]);
  // 연도별 묶음 (최상위 목표의 연도를 하위가 따른다)
  const years = useMemo(() => {
    const m = new Map<number, Node[]>();
    for (const r of roots) { const y = yearOf(r); m.set(y, [...(m.get(y) ?? []), r]); }
    if (!m.has(nowYear)) m.set(nowYear, []);
    return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([y, rs]) => ({
      y, roots: rs, done: rs.filter((r) => r.status === 'done').length,
      avg: rs.length ? Math.round(rs.reduce((a, r) => a + (r.status === 'done' ? 100 : r.progress), 0) / rs.length) : null,
    }));
  }, [roots, nowYear]);
  const cur = years.find((x) => x.y === year) ?? years.find((x) => x.y === nowYear)!;
  const past = cur.y < nowYear;
  const all = useMemo(() => { const out: Node[] = []; const walk = (a: Node[]) => a.forEach((n) => { out.push(n); walk(n.children); }); walk(cur.roots); return out; }, [cur]);
  const proposed = [...byId.values()].filter((n) => n.status === 'proposed').length;
  const gaps = all.filter((n) => n.status !== 'done' && n.measure !== 'recurring').map((n) => planGap(n));
  const behind = gaps.filter((g) => g.tone === 'behind' || g.tone === 'late').length;
  const planned = gaps.filter((g) => g.plan != null);
  const avgPlan = cur.roots.length ? Math.round(cur.roots.map((r) => planGap(r).plan ?? 0).reduce((a, b) => a + b, 0) / cur.roots.length) : null;
  const prob = new Map((outlook.data ?? []).map((o) => [o.goal_id, o.probability]));
  const minProb = cur.roots.map((r) => prob.get(r.id)).filter((x): x is number => x != null).sort((a, b) => a - b)[0] ?? null;
  const open = params.get('item') ? byId.get(params.get('item')!) : null;

  return (
    <div className="space-y-5">
      {/* 머리 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center shadow-sm"><Target size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">팀목표
              <select aria-label="연도" value={cur.y} onChange={(e) => setParam('year', Number(e.target.value) === nowYear ? null : e.target.value)}
                className="text-base font-semibold rounded-lg border border-slate-200 bg-white px-2 py-0.5">
                {years.map((x) => <option key={x.y} value={x.y}>{x.y}년</option>)}
              </select>
              {past && <span className="text-xs font-semibold rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 inline-flex items-center gap-1"><History size={12} />지난 기록</span>}
            </h1>
            <p className="text-sm text-slate-500">{[0, 1, 2].map(levelName).join(' › ')} · 담당자와 계획 대비 달성도를 한 타임라인에서 봅니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!past && <button onClick={() => setDraft({ open: true, parent: null })} className="text-sm rounded-xl px-3 py-2 bg-violet-50 text-violet-800 ring-1 ring-violet-200 hover:bg-violet-100 inline-flex items-center gap-1.5"><Sparkles size={15} />AI로 계획 만들기</button>}
          <Link to={proposed && !past ? '/goals/edit?filter=proposed' : '/goals/edit'} className="text-sm rounded-xl px-3.5 py-2 bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5"><Pencil size={14} />목표 수정{proposed > 0 && !past && <span className="ml-1 text-[10px] font-bold rounded-full bg-violet-500 px-1.5 py-0.5" title="팀원이 올린 계획 검토 대기">검토 {proposed}</span>}</Link>
        </div>
      </div>


      <MissionBand />

      {past && <Card className="p-4 flex items-center gap-3 text-sm bg-slate-50"><History size={16} className="text-slate-500" />{cur.y}년 목표 기록입니다. 일정·진척은 그해 마지막 상태 그대로입니다. 연도는 위 선택에서 바꿉니다.</Card>}

      {/* 요약 */}
      <Card className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100">
          <Num label={`${levelName(0)}`} value={`${cur.roots.length}개`} sub={past ? `완료 ${cur.done}개` : `하위 항목 ${all.length - cur.roots.length}개`} />
          <Num label="평균 진척" value={cur.avg != null ? `${cur.avg}%` : '—'} sub={!past && avgPlan != null ? `오늘까지 계획 ${avgPlan}%` : past ? '연말 기준' : undefined} tone={!past && cur.avg != null && avgPlan != null && cur.avg - avgPlan <= -8 ? 'amber' : undefined} />
          <Num label="계획보다 늦은 항목" value={`${behind}`} sub={`일정 있는 ${planned.length}건 중`} tone={behind ? 'amber' : undefined} />
          <Num label="최저 달성 가능성" value={minProb != null ? `${minProb}%` : '—'} sub="목표별 전망 모델" tone={minProb != null && minProb < 35 ? 'rose' : undefined} />
      </Card>

      {/* 타임라인 */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-slate-500">
          <span className="font-semibold text-sm text-slate-800">{cur.y}년 타임라인</span>
          <span className="inline-flex items-center gap-1"><span className="w-5 h-2 rounded-sm bg-indigo-500" />실제 진척</span>
          <span className="inline-flex items-center gap-1"><span className="w-0.5 h-3 bg-slate-800" />오늘까지 계획</span>
          <span className="inline-flex items-center gap-1"><span className="w-5 h-1 rounded-full bg-slate-300" />처음 계획</span>
          {!past && <span className="inline-flex items-center gap-1"><span className="w-0.5 h-3 bg-rose-400" />오늘</span>}
          <span className="ml-auto">항목을 누르면 상세 · <FileText size={11} className="inline" /> 결과물을 펼치면 업무플랫폼으로</span>
        </div>
        {items.isLoading ? <Spinner /> : !cur.roots.length ? (
          <Empty title={past ? `${cur.y}년 목표가 없습니다` : '올해 목표를 세워 보세요'}
            action={!past ? <div className="flex gap-2 justify-center"><button onClick={() => setDraft({ open: true, parent: null })} className="text-sm rounded-xl px-3 py-2 bg-indigo-600 text-white inline-flex items-center gap-1.5"><Sparkles size={14} />계획서로 AI 초안</button>
              <Link to="/goals/edit" className="text-sm rounded-xl px-3 py-2 ring-1 ring-slate-200">직접 쓰기</Link></div> : undefined}>
            {past ? '연도는 목표의 시작일(없으면 마감일) 기준입니다.' : '계획서나 업무 분장표를 넣으면 AI가 목표 › 과제 › 할 일 초안을 만듭니다.'}
          </Empty>
        ) : <Board year={cur.y} roots={cur.roots} subs={subs.data ?? []} prob={prob} nameOf={nameOf} onOpen={(id) => setParam('item', id)} />}
      </Card>

      {open && <ItemDetail key={open.id} item={open} byId={byId} mode="leader" onClose={() => setParam('item', null)} onAiPlan={(pid) => setDraft({ open: true, parent: pid })} />}
      <PlanDraftModal open={draft.open} onClose={() => setDraft({ open: false, parent: null })} byId={byId} parentId={draft.parent} />
    </div>
  );
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

// ---------------------------------------------------------------------
// 표 + 간트 한 몸
// ---------------------------------------------------------------------
function Board({ year, roots, subs, prob, nameOf, onOpen }: {
  year: number; roots: Node[]; subs: SubRow[]; prob: Map<string, number | null>; nameOf: (id: string | null | undefined) => string; onOpen: (id: string) => void;
}) {
  // 기본: 목표와 과제까지 펼침, 할 일은 접힘
  const [collapsed, setCollapsed] = useState<Set<string>>(() => { const s = new Set<string>(); const walk = (a: Node[]) => a.forEach((n) => { if (n.depth >= 1 && n.children.length) s.add(n.id); walk(n.children); }); walk(roots); return s; });
  const [subOpen, setSubOpen] = useState<Set<string>>(new Set());
  const tog = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setter(n); };
  const subsOf = useMemo(() => { const m = new Map<string, SubRow[]>(); for (const s of subs) if (s.item_id) m.set(s.item_id, [...(m.get(s.item_id) ?? []), s]); return m; }, [subs]);
  const deepSubs = (n: Node): SubRow[] => [...(subsOf.get(n.id) ?? []), ...n.children.flatMap(deepSubs)];
  const rows: Node[] = [];
  const walk = (a: Node[]) => a.forEach((n) => { rows.push(n); if (!collapsed.has(n.id)) walk(n.children); });
  walk(roots);

  const y0 = Date.UTC(year, 0, 1), y1 = Date.UTC(year + 1, 0, 1);
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - y0) / (y1 - y0)) * 100));
  const today = Date.now();
  const showToday = today >= y0 && today < y1;
  const months = Array.from({ length: 12 }, (_, i) => ({ i, x: pct(Date.UTC(year, i, 1)) }));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1060px] text-sm">
        <div className={cx('grid border-b border-slate-200 bg-slate-50/70 text-[11px] text-slate-500', COLS)}>
          <div className="px-4 py-2">항목</div><div className="px-2 py-2">담당</div><div className="px-2 py-2">계획 대비 달성도</div><div className="px-2 py-2">상태</div>
          <div className="relative h-8">{months.map((m) => <span key={m.i} className="absolute top-2 pl-1 border-l border-slate-200 h-6" style={{ left: `${m.x}%` }}>{m.i + 1}월</span>)}</div>
        </div>
        {rows.map((n) => {
          const g = planGap(n);
          const ds = deepSubs(n);
          const p = n.depth === 0 ? prob.get(n.id) : undefined;
          const s = n.start_date ?? (n.due_date ? new Date(T(n.due_date) - 7 * DAY).toISOString() : null);
          const e = n.due_date;
          const bs = n.base_start ?? n.base_due; const be = n.base_due;
          const tone = n.status === 'done' ? 'bg-emerald-500' : n.status === 'blocked' ? 'bg-rose-500' : GAP_TONE[g.tone].bar;
          return (
            <Fragment key={n.id}>
              <div className={cx('grid border-b border-slate-100 items-center hover:bg-slate-50/60', COLS, n.depth === 0 && 'bg-indigo-50/30')}>
                <div className="px-2 py-2 flex items-center gap-1 min-w-0" style={{ paddingLeft: 8 + n.depth * 18 }}>
                  <button className={cx('text-slate-400 hover:text-slate-700 shrink-0', !n.children.length && 'invisible')} onClick={() => tog(collapsed, setCollapsed, n.id)} aria-label="펼치기/접기">
                    {collapsed.has(n.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button>
                  <button onClick={() => onOpen(n.id)} className={cx('truncate text-left hover:text-indigo-700', n.depth === 0 ? 'font-bold' : n.depth === 1 ? 'font-medium' : 'text-slate-700')}>{n.title}</button>
                  {isRoutine(n) && <span title="정기 업무" className="text-slate-400 shrink-0"><Repeat size={12} /></span>}
                  {p != null && <span className={cx('text-[10px] font-semibold rounded px-1 py-0.5 num shrink-0', p < 35 ? 'bg-rose-50 text-rose-700' : p < 50 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700')} title="달성 가능성">{p}%</span>}
                  {ds.length > 0 && (
                    <button onClick={() => tog(subOpen, setSubOpen, n.id)} className={cx('ml-auto shrink-0 text-[10px] font-semibold rounded-full px-1.5 py-0.5 inline-flex items-center gap-0.5', subOpen.has(n.id) ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700 ring-1 ring-violet-200')}>
                      <FileText size={10} />{ds.length}</button>
                  )}
                </div>
                <div className="px-2 flex items-center gap-1.5 min-w-0">{n.owner_id ? <><Avatar name={nameOf(n.owner_id)} size={7} /><span className="text-xs truncate">{nameOf(n.owner_id)}</span></> : <span className="text-xs text-slate-300">미정</span>}</div>
                <div className="px-2">{n.measure === 'recurring' ? <span className="text-xs text-slate-400">정기 업무</span> : <PlanBar item={n} compact />}</div>
                <div className="px-2"><Pill tone={STATUS_META[n.status].tone}>{STATUS_META[n.status].label}</Pill></div>
                <div className="relative h-10">
                  {months.map((m) => <span key={m.i} className="absolute inset-y-0 border-l border-slate-100" style={{ left: `${m.x}%` }} />)}
                  {showToday && <span className="absolute inset-y-0 w-0.5 bg-rose-400/70 z-10" style={{ left: `${pct(today)}%` }} />}
                  {be && bs && <span className="absolute top-[27px] h-1 rounded-full bg-slate-300" style={{ left: `${pct(T(bs))}%`, width: `${Math.max(0.6, pct(T(be) + DAY) - pct(T(bs)))}%` }} title={`처음 계획 ${fmtShort(bs)}~${fmtShort(be)}`} />}
                  {s && e ? (
                    <span className="absolute top-[11px] h-3.5 rounded-md overflow-hidden" style={{ left: `${pct(T(s))}%`, width: `${Math.max(0.8, pct(T(e) + DAY) - pct(T(s)))}%` }}
                      title={`${n.title} · ${fmtShort(s)}~${fmtShort(e)} · 실제 ${g.actual}%${g.plan != null ? ` · 계획 ${g.plan}%` : ''}`}>
                      <span className={cx('absolute inset-0 opacity-25', tone)} />
                      <span className={cx('absolute inset-y-0 left-0', tone)} style={{ width: `${Math.min(100, g.actual)}%` }} />
                      {g.plan != null && n.status !== 'done' && <span className="absolute inset-y-0 w-0.5 bg-slate-900/80" style={{ left: `calc(${Math.min(100, g.plan)}% - 1px)` }} />}
                    </span>
                  ) : <span className="absolute top-3 left-2 text-[11px] text-slate-300">일정 없음</span>}
                  {e && T(e) >= y1 && <span className="absolute right-1 top-2.5 text-[10px] text-slate-400">→ {fmtShort(e)}</span>}
                </div>
              </div>
              {subOpen.has(n.id) && ds.map((sb) => <SubLine key={sb.id} s={sb} depth={n.depth + 1} direct={sb.item_id === n.id} nameOf={nameOf} />)}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function SubLine({ s, depth, direct, nameOf }: { s: SubRow; depth: number; direct: boolean; nameOf: (id: string | null | undefined) => string }) {
  const st = SUB_STATUS[s.status];
  return (
    <Link to={`/work/${s.id}`} className="flex items-center gap-3 border-b border-slate-100 bg-violet-50/40 hover:bg-violet-50 py-2 pr-4 text-xs" style={{ paddingLeft: 30 + depth * 18 }}>
      <FileText size={13} className="text-violet-500 shrink-0" />
      <span className="font-medium text-slate-800 truncate max-w-[360px]">{s.title}</span>
      {s.latest && <span className="font-mono text-[10px] text-indigo-600 bg-white rounded px-1">v{s.latest.version}</span>}
      <span className="text-slate-500 shrink-0">{nameOf(s.author_id)}</span>
      {!direct && <span className="text-slate-400 shrink-0">· 하위 항목</span>}
      {s.review ? <span className="truncate text-slate-600 flex-1 min-w-0"><AiChip label={`AI ${s.review.depth_score}/4`} className="mr-1.5" />{s.review.summary}</span> : <span className="flex-1 text-slate-400">AI 검토 전</span>}
      <Pill tone={st.tone}>{st.label}</Pill>
      <span className="text-violet-700 font-semibold shrink-0 inline-flex items-center">업무플랫폼<ChevronRight size={12} /></span>
    </Link>
  );
}
