// 8주 흐름 — 팀원 × 주 히트맵 (업무 부하 · 컨디션 · 팀장 접점) + 눈에 띄는 것 + Sim.Box 팀 경향(익명 집계)
//   부하: lib/load (주간 예상 시간 ÷ 주 근무시간, 비어 있으면 추정치)
//   컨디션: 주간 성과입력의 컨디션 · 접점: 팀장이 보낸 요청 · 관찰 메모 · 1on1
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useTeam } from '../../state/session';
import { useTeamMembersOnly } from '../../lib/hooks';
import { supabase, q } from '../../lib/supabase';
import { useItems } from '../../lib/items';
import { addDays, lastMondays, loadOf, pct, workLeaves } from '../../lib/load';
import { SIM_CATS, useSimTrends } from '../../lib/simbox';
import { cx } from '../../lib/format';
import { Card, Spinner } from '../ui';

type Metric = 'load' | 'cond' | 'touch';
const METRICS: [Metric, string, string][] = [
  ['load', '업무 부하', '주 근무시간 대비 진행 중 과제 시간'],
  ['cond', '컨디션', '주간 성과입력 때 공유한 컨디션 (5점)'],
  ['touch', '팀장 접점', '요청 · 관찰 메모 · 1on1 횟수'],
];

const loadCls = (v: number) => (v > 110 ? 'bg-rose-500 text-white' : v > 90 ? 'bg-amber-400 text-amber-950' : v >= 60 ? 'bg-indigo-400 text-white' : v > 0 ? 'bg-indigo-200 text-indigo-900' : 'bg-slate-100 text-slate-400');
const condCls = (v: number) => (v <= 2 ? 'bg-rose-500 text-white' : v < 3 ? 'bg-amber-400 text-amber-950' : v < 4 ? 'bg-teal-300 text-teal-950' : 'bg-teal-500 text-white');
const touchCls = (v: number) => (v === 0 ? 'bg-slate-100 text-slate-400' : v === 1 ? 'bg-violet-200 text-violet-900' : v <= 3 ? 'bg-violet-400 text-white' : 'bg-violet-600 text-white');

export function TeamFlow() {
  const { team, uid } = useTeam();
  const members = useTeamMembersOnly();
  const items = useItems(team.id);
  const weeks = useMemo(() => lastMondays(8), []);
  const from = weeks[0];
  const [metric, setMetric] = useState<Metric>('load');

  const ck = useQuery({
    queryKey: ['flow-checkins', team.id, from],
    queryFn: () => q<{ user_id: string; week_start: string; condition: number | null }[]>(supabase.from('checkins').select('user_id, week_start, condition').eq('team_id', team.id).gte('week_start', from)),
  });
  const touch = useQuery({
    queryKey: ['flow-touch', team.id, from, uid],
    queryFn: async () => {
      const since = from + 'T00:00:00Z';
      const [r, o, oo] = await Promise.all([
        supabase.from('team_requests').select('to_id, created_at').eq('team_id', team.id).eq('from_id', uid).gte('created_at', since),
        supabase.from('observations').select('subject_id, occurred_at').eq('team_id', team.id).eq('author_id', uid).gte('occurred_at', since),
        supabase.from('one_on_ones').select('member_id, scheduled_at, status').eq('team_id', team.id).eq('status', 'done').gte('scheduled_at', since),
      ]);
      return [
        ...((r.data ?? []) as { to_id: string; created_at: string }[]).map((x) => ({ who: x.to_id, at: x.created_at })),
        ...((o.data ?? []) as { subject_id: string; occurred_at: string }[]).map((x) => ({ who: x.subject_id, at: x.occurred_at })),
        ...((oo.data ?? []) as { member_id: string; scheduled_at: string }[]).map((x) => ({ who: x.member_id, at: x.scheduled_at })),
      ];
    },
  });

  const grid = useMemo(() => {
    const leaves = workLeaves(items.data ?? []);
    return members.map((m) => {
      const load = weeks.map((w) => { const l = loadOf(leaves, m.user_id, w, addDays(w, 6)); return { v: pct(l.hours, m.weekly_hours), est: l.estimated }; });
      const cond = weeks.map((w) => (ck.data ?? []).find((c) => c.user_id === m.user_id && c.week_start === w)?.condition ?? null);
      const tc = weeks.map((w) => (touch.data ?? []).filter((t) => t.who === m.user_id && t.at.slice(0, 10) >= w && t.at.slice(0, 10) <= addDays(w, 6)).length);
      return { m, name: m.profiles?.full_name ?? '팀원', load, cond, tc };
    });
  }, [items.data, members, weeks, ck.data, touch.data]);

  // 눈에 띄는 것 — 계산으로만 뽑는다
  const notes = useMemo(() => {
    const out: { who: string; text: string; tone: 'rose' | 'amber' | 'slate' }[] = [];
    let anyOver = false;
    for (const g of grid) {
      const L = g.load.map((x) => x.v);
      const now = L[L.length - 1];
      const overRun = L.slice(-3).every((v) => v > 100);
      const c = g.cond.filter((x): x is number => x != null);
      const condDown = c.length >= 3 && c[c.length - 1] <= 2 && c[c.length - 1] < c[0];
      if (overRun) anyOver = true;
      if (overRun && condDown) out.push({ who: g.name, text: `3주 연속 부하 100% 초과에 컨디션도 ${c[0]} → ${c[c.length - 1]} — 일을 나눌 때입니다`, tone: 'rose' });
      else if (overRun) out.push({ who: g.name, text: `3주 연속 부하 100% 초과 (이번 주 ${now}%)`, tone: 'rose' });
      else if (condDown) out.push({ who: g.name, text: `컨디션 ${c[0]} → ${c[c.length - 1]}로 내려감`, tone: 'rose' });
      if (g.tc.slice(-4).every((x) => x === 0)) out.push({ who: g.name, text: '4주 동안 팀장 접점 없음', tone: 'amber' });
    }
    // 누군가 넘칠 때만 — 가장 여유 있는 한 명
    const free = anyOver ? [...grid].map((g) => ({ g, v: g.load[g.load.length - 1].v })).filter((x) => x.v < 60).sort((x, y) => x.v - y.v)[0] : null;
    if (free) out.push({ who: free.g.name, text: `이번 주 부하 ${free.v}% — 나눠 맡길 여유가 있음`, tone: 'slate' });
    const rank = { rose: 0, amber: 1, slate: 2 };
    out.sort((x, y) => rank[x.tone] - rank[y.tone]);
    return out.slice(0, 6);
  }, [grid]);

  if (items.isLoading || ck.isLoading) return <Spinner />;
  const anyEst = grid.some((g) => g.load.some((x) => x.est));
  const meta = METRICS.find(([k]) => k === metric)!;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
      <Card className="p-4 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {METRICS.map(([k, l]) => (
              <button key={k} onClick={() => setMetric(k)} className={cx('text-xs rounded-md px-2.5 py-1', metric === k ? 'bg-white shadow-sm font-bold text-slate-900' : 'text-slate-500 hover:text-slate-800')}>{l}</button>
            ))}
          </div>
          <span className="text-[11px] text-slate-400">{meta[2]}</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
            <thead>
              <tr>
                <th className="w-20" />
                {weeks.map((w, i) => <th key={w} className={cx('text-[10.5px] font-semibold num', i === weeks.length - 1 ? 'text-slate-800' : 'text-slate-400')}>{i === weeks.length - 1 ? '이번 주' : `${Number(w.slice(5, 7))}/${Number(w.slice(8, 10))}`}</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.map((g) => (
                <tr key={g.m.user_id}>
                  <td className="text-[12px] font-semibold text-slate-700 pr-2 whitespace-nowrap truncate max-w-[80px]">{g.name}</td>
                  {weeks.map((w, i) => {
                    if (metric === 'load') { const c = g.load[i]; return <td key={w} title={`${c.v}%${c.est ? ' (추정치 포함)' : ''}`} className={cx('h-8 min-w-[38px] rounded-md text-center text-[10.5px] font-bold num', loadCls(c.v))}>{c.v ? `${c.v}${c.est ? '*' : ''}` : ''}</td>; }
                    if (metric === 'cond') { const v = g.cond[i]; return <td key={w} className={cx('h-8 min-w-[38px] rounded-md text-center text-[11px] font-bold num', v == null ? 'bg-slate-50 text-slate-300' : condCls(v))}>{v ?? '–'}</td>; }
                    const v = g.tc[i]; return <td key={w} className={cx('h-8 min-w-[38px] rounded-md text-center text-[11px] font-bold num', touchCls(v))}>{v || ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center gap-3 flex-wrap text-[10.5px] text-slate-400">
          {metric === 'load' && <><Legend cls="bg-indigo-200" l="60% 미만" /><Legend cls="bg-indigo-400" l="60–90%" /><Legend cls="bg-amber-400" l="90–110%" /><Legend cls="bg-rose-500" l="110% 초과" />{anyEst && <span>* 주당 시간이 빈 과제는 3시간으로 잡은 추정치</span>}</>}
          {metric === 'cond' && <><Legend cls="bg-rose-500" l="2 이하" /><Legend cls="bg-amber-400" l="2–3" /><Legend cls="bg-teal-300" l="3–4" /><Legend cls="bg-teal-500" l="4 이상" /><span>– 공유 없음</span></>}
          {metric === 'touch' && <><Legend cls="bg-slate-100" l="없음" /><Legend cls="bg-violet-200" l="1회" /><Legend cls="bg-violet-400" l="2–3회" /><Legend cls="bg-violet-600" l="4회 이상" /></>}
        </div>
      </Card>

      <div className="space-y-3">
        <Card className="p-4">
          <div className="text-[13px] font-bold text-slate-900">눈에 띄는 것</div>
          {notes.length ? (
            <ul className="mt-2 space-y-2">
              {notes.map((n, i) => (
                <li key={i} className="text-[12.5px] leading-snug flex gap-2">
                  <span className={cx('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', n.tone === 'rose' ? 'bg-rose-500' : n.tone === 'amber' ? 'bg-amber-400' : 'bg-slate-300')} />
                  <span><b className="text-slate-800">{n.who}</b> <span className="text-slate-600">{n.text}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-xs text-slate-500">8주 동안 크게 튀는 흐름이 없습니다.</p>}
        </Card>
        <SimTrendsCard />
      </div>
    </div>
  );
}

function Legend({ cls, l }: { cls: string; l: string }) {
  return <span className="inline-flex items-center gap-1"><span className={cx('w-2.5 h-2.5 rounded-sm', cls)} />{l}</span>;
}

/** Sim.Box 팀 경향 — 주제 분류 개수만 (팀원 5명 이상 · 3명 이상이 쓴 주제만 · 민감한 대화 제외) */
function SimTrendsCard() {
  const { team } = useTeam();
  const t = useSimTrends(team.id);
  const rows = t.data?.available ? t.data.rows ?? [] : [];
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5"><span className="text-[13px] font-bold text-slate-900">팀원들이 요즘 준비하는 것</span><span className="ml-auto text-[10px] font-bold rounded-full bg-slate-100 text-slate-500 px-1.5 py-0.5">Sim.Box</span></div>
      {rows.length ? (
        <ul className="mt-2.5 space-y-1.5">
          {rows.map((r) => (
            <li key={r.category} className="text-[12px]">
              <div className="flex justify-between"><span className="text-slate-700">{SIM_CATS[r.category] ?? r.category}</span><b className="num text-slate-800">{r.share}%</b></div>
              <div className="mt-0.5 h-1 rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.min(100, r.share)}%` }} /></div>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-xs text-slate-500">{t.isLoading ? '불러오는 중…' : '아직 집계할 만큼 쌓이지 않았습니다.'}</p>}
      <p className="mt-2.5 text-[10.5px] text-slate-400 flex gap-1 leading-snug"><Lock size={11} className="shrink-0 mt-px" />최근 30일 팀 전체 익명 집계입니다. 누가 무엇을 썼는지는 알 수 없고, 팀원 5명 이상 · 3명 이상이 쓴 주제만 보입니다.</p>
    </Card>
  );
}
