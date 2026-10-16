// 팀 성과 › 성과 탭 — 목표별 전망 '계획선 지도'
//   가로: 기간 경과(%) · 세로: 진척(%) · 대각선 = 계획 속도. 선 아래는 뒤처진 목표, 점 색은 달성 가능성.
//   오른쪽: 고른 목표의 진척/계획 · 달성 가능성 · 예상 완료, 끌어내리는 것, AI 한 줄
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTeam } from '../../state/session';
import { supabase, q } from '../../lib/supabase';
import { useLatestAi } from '../../lib/hooks';
import { cx } from '../../lib/format';
import type { Metric } from '../../lib/types';
import { X } from 'lucide-react';
import { Card, Spinner } from '../ui';
import { sectionsOf, type InsightOut } from '../home/shared';

interface GoalRow { id: string; title: string; progress: number; start_date: string | null; due_date: string | null; owner_id: string | null; status: string }
interface ChildRow { id: string; title: string; parent_id: string; owner_id: string | null; status: string; progress: number; start_date: string | null; due_date: string | null; contribution: number | null; est_hours_per_week: number | null; updated_at: string }
interface Outlook { goal_id: string; probability: number | null; basis: string; blocked: number; task_count: number }
interface Sched { item_id: string; projected_done: string | null; projected_delay: number | null }
type Tone = 'rose' | 'amber' | 'emerald' | 'slate';
interface Drag { text: string; who?: string; tone: Tone }
export interface G {
  id: string; title: string; progress: number; elapsed: number | null; gap: number | null; prob: number | null; tone: Tone;
  dday: number | null; due: string | null; projected: string | null; lateDays: number | null; owners: string[]; drags: Drag[]; ai?: string; basis: string | null;
}
/** 아래 '실적 전망'(sub)에 무엇을 띄울지 — 목표에 연결된 지표들, 또는 목표에 안 묶인 지표 하나 */
export type ForecastScope = { kind: 'goal'; goalId: string; goalTitle: string } | { kind: 'metric'; metricId: string; metricName: string };

const DAY = 86400000;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const dt = (s: string) => new Date(`${s}T00:00:00`);
const md = (s: string) => { const d = dt(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const toneOf = (p: number | null): Tone => (p == null ? 'slate' : p < 35 ? 'rose' : p < 60 ? 'amber' : 'emerald');
const STATUS: Record<Tone, { label: string; dot: string; text: string; fill: string }> = {
  rose: { label: '위험', dot: 'bg-rose-500', text: 'text-rose-600', fill: '#f43f5e' },
  amber: { label: '주의', dot: 'bg-amber-400', text: 'text-amber-700', fill: '#fbbf24' },
  emerald: { label: '순항', dot: 'bg-emerald-500', text: 'text-emerald-700', fill: '#10b981' },
  slate: { label: '근거 부족', dot: 'bg-slate-300', text: 'text-slate-500', fill: '#cbd5e1' },
};
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
const tokens = (t: string) => t.split(/[\s·,()'"‘’]+/).filter((w) => w.length >= 2 && !/^(목표|과제|확대|성공|관리|운영|개선|하반기|상반기|신규)$/.test(w));

function useGoalMap() {
  const { team, nameOf } = useTeam();
  const goals = useQuery({
    queryKey: ['goalmap-goals', team.id],
    queryFn: () => q<GoalRow[]>(supabase.from('work_items').select('id, title, progress, start_date, due_date, owner_id, status').eq('team_id', team.id).is('parent_id', null)
      .not('status', 'in', '(dropped,proposed,changes_requested,done)').order('sort')),
  });
  const ids = (goals.data ?? []).map((g) => g.id);
  const kids = useQuery({
    queryKey: ['goalmap-kids', team.id, ids.join(',')], enabled: ids.length > 0,
    queryFn: () => q<ChildRow[]>(supabase.from('work_items').select('id, title, parent_id, owner_id, status, progress, start_date, due_date, contribution, est_hours_per_week, updated_at')
      .eq('team_id', team.id).in('parent_id', ids).not('status', 'in', '(dropped,proposed,changes_requested)')),
  });
  const outlook = useQuery({ queryKey: ['goal-outlook', team.id], queryFn: () => q<Outlook[]>(supabase.rpc('goal_outlook', { p_team: team.id })) });
  const sched = useQuery({ queryKey: ['item-schedule', team.id], queryFn: async () => { const { data } = await supabase.rpc('item_schedule', { p_team: team.id }); return (data ?? []) as Sched[]; } });
  const ins = useLatestAi<InsightOut>(team.id, 'insight_weekly');

  const rows = useMemo<G[]>(() => {
    const t0 = today().getTime();
    const perfAi = sectionsOf(ins.data?.content as InsightOut | undefined);
    const aiItems = [...perfAi.perf.items, ...perfAi.risk.items, ...perfAi.decide.items];
    return (goals.data ?? []).map((g) => {
      const ol = (outlook.data ?? []).find((o) => o.goal_id === g.id);
      const ch = (kids.data ?? []).filter((c) => c.parent_id === g.id);
      const elapsed = g.start_date && g.due_date && dt(g.due_date) > dt(g.start_date)
        ? Math.max(0, Math.min(100, Math.round(((t0 - dt(g.start_date).getTime()) / (dt(g.due_date).getTime() - dt(g.start_date).getTime())) * 100))) : null;
      // 예상 완료 = 하위 항목 중 가장 늦게 끝날 것으로 보이는 날 (최근 3주 진척 속도 기준)
      const proj = ch.map((c) => (sched.data ?? []).find((s) => s.item_id === c.id)?.projected_done).filter(Boolean) as string[];
      const projected = proj.length ? proj.sort().at(-1)! : null;
      const lateDays = projected && g.due_date ? Math.round((dt(projected).getTime() - dt(g.due_date).getTime()) / DAY) : null;
      const drags: Drag[] = [];
      for (const c of ch.filter((c) => c.status === 'blocked')) drags.push({ text: `${c.title} — 막힘${Math.round((t0 - new Date(c.updated_at).getTime()) / DAY) >= 7 ? ` ${Math.floor((t0 - new Date(c.updated_at).getTime()) / DAY / 7)}주째` : ''}`, who: nameOf(c.owner_id) || undefined, tone: 'rose' });
      for (const c of ch) {
        if (c.status === 'blocked') continue;
        const s = (sched.data ?? []).find((x) => x.item_id === c.id);
        if (s?.projected_delay && s.projected_delay >= 3) { drags.push({ text: `${c.title} — 이 속도면 ${s.projected_delay}일 늦음`, who: nameOf(c.owner_id) || undefined, tone: 'amber' }); continue; }
        if (c.start_date && c.due_date && dt(c.due_date) > dt(c.start_date)) {
          const exp = Math.min(100, Math.max(0, ((t0 - dt(c.start_date).getTime()) / (dt(c.due_date).getTime() - dt(c.start_date).getTime())) * 100));
          if (exp - c.progress >= 15) { drags.push({ text: `${c.title} — 계획보다 ${Math.round(exp - c.progress)}%p 뒤처짐`, who: nameOf(c.owner_id) || undefined, tone: 'amber' }); continue; }
        }
        if ((c.contribution ?? 3) <= 2 && (c.est_hours_per_week ?? 0) >= 12) drags.push({ text: `${c.title} — 기여 ${c.contribution}인데 주 ${c.est_hours_per_week}시간`, who: nameOf(c.owner_id) || undefined, tone: 'slate' });
      }
      const keys = tokens(g.title).filter((w) => w.length >= 2);
      const hit = aiItems.find((it) => keys.filter((k) => `${it.title} ${it.body}`.includes(k)).length >= Math.min(2, keys.length));
      const owners = [...new Set([g.owner_id, ...ch.map((c) => c.owner_id)].map((u) => nameOf(u)).filter(Boolean))];
      const prob = ol?.probability ?? null;
      return {
        id: g.id, title: g.title, progress: g.progress, elapsed, gap: elapsed == null ? null : g.progress - elapsed, prob, tone: toneOf(prob),
        dday: g.due_date ? Math.round((dt(g.due_date).getTime() - t0) / DAY) : null, due: g.due_date, projected, lateDays, owners,
        drags: drags.slice(0, 4), ai: hit ? strip(`${hit.title} — ${hit.body}`) : undefined, basis: ol?.basis ?? null,
      };
    }).sort((a, b) => (a.prob ?? 101) - (b.prob ?? 101));
  }, [goals.data, kids.data, outlook.data, sched.data, ins.data, nameOf]);
  return { rows, loading: goals.isLoading || outlook.isLoading };
}

// ---------------------------------------------------------------------
const W = 560, H = 380, L = 50, R = 540, T = 20, B = 340;
const px = (e: number) => L + ((R - L) * e) / 100;
const py = (p: number) => B - ((B - T) * p) / 100;

export function Chart({ rows, sel, onSel }: { rows: G[]; sel: string | null; onSel: (id: string) => void }) {
  const pts = rows.filter((r) => r.elapsed != null);
  // 라벨: 계획선 위(앞섬)는 왼쪽 위, 아래(뒤처짐)는 오른쪽 아래 — 대각선을 가로지르지 않게. 겹치면 같은 방향으로 더 민다.
  const boxes: { x1: number; x2: number; y1: number; y2: number }[] = [];
  const labels = pts.map((r) => {
    const x = px(r.elapsed!), y = py(r.progress);
    const ahead = (r.gap ?? 0) >= 0;
    const w = Math.min(190, r.title.length * 12 + 10);
    const anchorEnd = ahead ? x - 16 > L + w : x + 16 + w > W - 2;
    let ly = ahead ? y - 26 : y + 22;
    const lx = anchorEnd ? x - 16 : x + 16;
    let moved = false;
    for (let i = 0; i < 6; i++) {
      moved = i > 0;
      const bx = { x1: anchorEnd ? lx - w : lx, x2: anchorEnd ? lx : lx + w, y1: ly - 13, y2: ly + 17 };
      if (!boxes.some((b) => b.x1 < bx.x2 && bx.x1 < b.x2 && b.y1 < bx.y2 && bx.y1 < b.y2)) { boxes.push(bx); break; }
      ly += ahead ? -32 : 32;
    }
    return { r, x, y, lx, ly: Math.max(T + 12, Math.min(B - 18, ly)), anchor: (anchorEnd ? 'end' : 'start') as 'end' | 'start', moved };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="목표별 계획선 지도: 가로 기간 경과, 세로 진척">
      <defs><clipPath id="gm-plot"><rect x={L} y={T} width={R - L} height={B - T} /></clipPath></defs>
      <polygon points={`${L},${B} ${R},${T} ${R},${B}`} className="fill-rose-50" clipPath="url(#gm-plot)" />
      <polygon points={`${L},${B} ${L},${T} ${R},${T}`} className="fill-slate-50" clipPath="url(#gm-plot)" />
      <g className="stroke-slate-200">
        <line x1={L} y1={B} x2={R} y2={B} /><line x1={L} y1={T} x2={L} y2={B} />
        <line x1={L} y1={py(50)} x2={R} y2={py(50)} strokeDasharray="2 4" /><line x1={px(50)} y1={T} x2={px(50)} y2={B} strokeDasharray="2 4" />
      </g>
      <line x1={L} y1={B} x2={R} y2={T} strokeWidth="1.5" strokeDasharray="6 5" className="stroke-slate-900" />
      <text x={R - 56} y={T + 68} fontSize="11" fontWeight="600" className="fill-slate-900">계획 속도</text>
      <text x={L + 20} y={T + 24} fontSize="12" fontWeight="600" className="fill-slate-500">앞서감</text>
      <text x={R - 120} y={B - 20} fontSize="12" fontWeight="600" className="fill-rose-600">뒤처짐</text>
      <g fontSize="10" className="fill-slate-400">
        <text x={L - 6} y={B + 4} textAnchor="end">0</text><text x={L - 6} y={py(50) + 4} textAnchor="end">50</text><text x={L - 6} y={T + 4} textAnchor="end">100</text>
        <text x={L} y={B + 16} textAnchor="middle">0</text><text x={px(50)} y={B + 16} textAnchor="middle">50</text><text x={R} y={B + 16} textAnchor="middle">100</text>
      </g>
      <text x={(L + R) / 2} y={H - 6} fontSize="11" textAnchor="middle" className="fill-slate-500">기간 경과 (%) →</text>
      <text x={14} y={(T + B) / 2} fontSize="11" textAnchor="middle" transform={`rotate(-90 14 ${(T + B) / 2})`} className="fill-slate-500">진척 (%) →</text>
      {/* 계획 대비 차이: 10%p 넘게 뒤처진 목표만 */}
      {labels.filter(({ r }) => (r.gap ?? 0) <= -10).map(({ r, x, y }) => (
        <g key={`gap-${r.id}`}>
          <line x1={x} y1={py(r.elapsed!)} x2={x} y2={y} strokeWidth="1.5" className="stroke-rose-600" />
          <text x={x + 8} y={(py(r.elapsed!) + y) / 2 + 4} fontSize="11" fontWeight="700" className="fill-rose-600">{r.gap}%p</text>
        </g>
      ))}
      {labels.map(({ r, x, y, lx, ly, anchor, moved }) => {
        const on = r.id === sel;
        return (
          <g key={r.id} onClick={() => onSel(r.id)} className="cursor-pointer">
            {moved && <line x1={x} y1={y} x2={lx + (anchor === 'end' ? 4 : -4)} y2={ly + (ly < y ? 18 : -12)} strokeWidth="1" className="stroke-slate-300" />}
            <title>{`${r.title} · 진척 ${r.progress}% / 계획 ${r.elapsed}% · 달성 가능성 ${r.prob ?? '—'}%`}</title>
            <circle cx={x} cy={y} r="18" fill="transparent" />
            {on && <circle cx={x} cy={y} r="16" fill="none" strokeWidth="2" className="stroke-violet-400" />}
            <circle cx={x} cy={y} r="11" fill={STATUS[r.tone].fill} stroke="#fff" strokeWidth="2.5" />
            <text x={lx} y={ly} textAnchor={anchor} fontSize="12" fontWeight="700" className="fill-slate-900">{r.title.length > 16 ? `${r.title.slice(0, 15)}…` : r.title}</text>
            <text x={lx} y={ly + 15} textAnchor={anchor} fontSize="11" className="fill-slate-500">{`달성 가능성 ${r.prob ?? '—'}%${r.dday != null ? ` · ${r.dday >= 0 ? `D-${r.dday}` : `${-r.dday}일 지남`}` : ''}`}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Detail({ g, linked }: { g: G; linked?: boolean }) {
  const st = STATUS[g.tone];
  return (
    <Card className={cx('p-5 h-full flex flex-col', linked && 'ring-2 ring-violet-300')}>
      <div className="flex items-center gap-1.5 text-[11px] flex-wrap"><span className={cx('w-2 h-2 rounded-full', st.dot)} /><b className={st.text}>{st.label}</b>
        <span className="text-slate-400">{g.dday != null && `· ${g.dday >= 0 ? `D-${g.dday}` : `마감 ${-g.dday}일 지남`}`}{g.owners.length ? ` · ${g.owners.slice(0, 3).join(' · ')}` : ''}</span></div>
      <div className="mt-1 text-lg font-bold leading-snug tracking-tight">{g.title}</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 py-2"><div className="text-[10px] text-slate-500">진척 / 계획</div>
          <div className="font-bold num">{g.progress}%{g.elapsed != null && <span className="text-slate-400 font-normal text-xs"> / {g.elapsed}%</span>}</div></div>
        <div className={cx('rounded-lg py-2', g.tone === 'rose' ? 'bg-rose-50' : 'bg-slate-50')}><div className="text-[10px] text-slate-500">달성 가능성</div>
          <div className={cx('font-bold num', st.text)}>{g.prob != null ? `${g.prob}%` : '—'}</div>
          {g.basis && g.basis !== 'insufficient' && <div className="text-[9px] text-slate-500">{g.basis === 'metric' ? '실적 전망 기준' : '일정·진척 기준'}</div>}</div>
        <div className="rounded-lg bg-slate-50 py-2"><div className="text-[10px] text-slate-500">예상 완료</div>
          <div className="font-bold num">{g.projected ? md(g.projected) : '—'}{g.lateDays != null && g.lateDays > 0 && <span className="text-xs text-rose-600"> +{g.lateDays}일</span>}</div></div>
      </div>
      <div className="mt-1.5 text-[11px] text-slate-400">{g.due ? `마감 ${md(g.due)}` : '마감일 없음'}{g.gap != null && ` · 계획 대비 ${g.gap >= 0 ? '+' : ''}${g.gap}%p`}{!g.projected && ' · 예상 완료는 진척 기록이 쌓이면 나옵니다'}</div>
      <div className="mt-4 text-[11px] font-bold text-slate-500">끌어내리는 것</div>
      {g.drags.length ? (
        <ul className="mt-1.5 space-y-1.5 text-sm">
          {g.drags.map((d, i) => (
            <li key={i} className="flex gap-2"><span className={cx('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', STATUS[d.tone].dot)} />
              <span className="leading-snug">{d.text}{d.who && <span className="text-slate-400 text-xs"> · {d.who}</span>}</span></li>
          ))}
        </ul>
      ) : <p className="mt-1.5 text-sm text-slate-500">막히거나 뒤처진 하위 항목이 없습니다.</p>}
      {g.ai && <div className="mt-4 rounded-lg bg-violet-50/80 ring-1 ring-violet-100 px-3 py-2 text-xs text-slate-700 leading-relaxed line-clamp-4"><b className="text-violet-700 mr-1">AI</b>{g.ai}</div>}
      <div className="mt-auto pt-4 flex gap-4 text-xs font-semibold text-indigo-700">
        <Link to="/decide">의사결정으로 →</Link><Link to="/goals">목표 열기 →</Link>
      </div>
    </Card>
  );
}

/** 박스 위 제목 — 굵은 제목 + 회색 설명 (임원 브리핑 · 의사결정과 같은 모양) */
export function BoxTitle({ title, hint, right, className }: { title: ReactNode; hint?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-end gap-2 flex-wrap min-w-0', className)}>
      <span className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">{title}</span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
      {right && <span className="ml-auto text-xs">{right}</span>}
    </div>
  );
}

export function GoalMapSection({ renderForecast }: { renderForecast?: (scope: ForecastScope) => ReactNode }) {
  const { team } = useTeam();
  const { rows, loading } = useGoalMap();
  const [sel, setSel] = useState<string | null>(null);
  const [picked, setPicked] = useState<ForecastScope | null>(null);
  // 기본 선택은 가장 위험한 목표 — 달성 가능성이 다 들어온 뒤에 정한다
  useEffect(() => { if (!sel && !loading && rows.length) setSel(rows[0].id); }, [rows, sel, loading]);
  const cur = rows.find((r) => r.id === sel) ?? rows[0];
  const offMap = rows.filter((r) => r.elapsed == null);
  const n = { rose: rows.filter((r) => r.tone === 'rose').length, amber: rows.filter((r) => r.tone === 'amber').length, emerald: rows.filter((r) => r.tone === 'emerald').length };
  // 목표에 안 묶인 실적 지표 — 지도 아래 칩으로
  const metrics = useQuery({ queryKey: ['metrics', team.id], queryFn: () => q<Metric[]>(supabase.from('metrics').select('*').eq('team_id', team.id).order('created_at')) });
  const loose = (metrics.data ?? []).filter((m) => !m.item_id || !rows.some((r) => r.id === m.item_id));
  const pickGoal = (id: string) => { setSel(id); const r = rows.find((x) => x.id === id); if (r) setPicked({ kind: 'goal', goalId: r.id, goalTitle: r.title }); };
  const pickedGoal = picked?.kind === 'goal' ? picked.goalId : null;
  return (
    <div className="space-y-4">
      {loading ? <Card className="p-6"><Spinner /></Card> : !rows.length ? (
        <div className="space-y-2"><BoxTitle title="목표별 전망" />
          <Card className="p-6 text-sm text-slate-500">진행 중인 목표가 없습니다. <Link to="/goals" className="text-indigo-700 font-semibold">목표 세우기 →</Link></Card></div>
      ) : (
        <div className="grid lg:grid-cols-5 gap-4 items-stretch">
          <div className="lg:col-span-3 flex flex-col gap-2 min-w-0">
            <BoxTitle title="목표별 전망" hint="대각선이 계획 속도 · 선 아래는 뒤처진 목표 · 점 색은 달성 가능성"
              right={<><span className="text-rose-600 font-semibold">위험 {n.rose}</span> · <span className="text-amber-700 font-semibold">주의 {n.amber}</span> · <span className="text-emerald-700 font-semibold">순항 {n.emerald}</span></>} />
            <Card className="p-4 flex-1">
              <Chart rows={rows} sel={pickedGoal ?? cur?.id ?? null} onSel={pickGoal} />
              <div className="flex items-center gap-4 text-[11px] text-slate-500 px-2 flex-wrap">
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" />위험 (35% 미만)</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" />주의 (60% 미만)</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />순항</span>
                <span className="ml-auto">점을 누르면 아래에 실적 전망이 열립니다</span>
              </div>
              {!!offMap.length && (
                <div className="mt-2 px-2 text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">시작일·마감일이 없어 지도에 못 올린 목표:
                  {offMap.map((r) => <button key={r.id} onClick={() => pickGoal(r.id)} className={cx('rounded-full px-2 py-0.5', r.id === pickedGoal ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 hover:bg-slate-200')}>{r.title}</button>)}</div>
              )}
              {!!loose.length && (
                <div className="mt-2 px-2 text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">목표에 안 묶인 지표:
                  {loose.map((m) => <button key={m.id} onClick={() => setPicked({ kind: 'metric', metricId: m.id, metricName: m.name })}
                    className={cx('rounded-full px-2 py-0.5', picked?.kind === 'metric' && picked.metricId === m.id ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 hover:bg-slate-200')}>{m.name}</button>)}</div>
              )}
            </Card>
          </div>
          <div className="lg:col-span-2 flex flex-col gap-2 min-w-0">
            <BoxTitle title="선택한 목표" hint="점을 누르면 바뀝니다" />
            <div className="flex-1">{cur && <Detail g={cur} linked={pickedGoal === cur.id} />}</div>
          </div>
        </div>
      )}
      {/* sub: 고른 목표(또는 지표)의 실적 전망 — 점을 누르기 전에는 보이지 않음 */}
      {picked && renderForecast && (
        <div className="ml-2 sm:ml-6 pl-4 border-l-2 border-violet-200 space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-semibold text-slate-700 whitespace-nowrap">↳ {picked.kind === 'goal' ? '선택한 목표의 실적 전망' : '지표 실적 전망'}</span>
            <span className="text-xs text-slate-400 truncate">{picked.kind === 'goal' ? `${picked.goalTitle} › 연결된 실적 지표` : `${picked.metricName} · 목표에 연결되지 않은 지표`}</span>
            <button onClick={() => setPicked(null)} className="ml-auto shrink-0 text-xs text-slate-400 hover:text-slate-700 inline-flex items-center gap-0.5"><X size={12} />닫기</button>
          </div>
          {renderForecast(picked)}
        </div>
      )}
    </div>
  );
}
