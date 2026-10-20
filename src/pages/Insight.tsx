import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { DepthRow, InsightLevel, LevelCondition } from '../lib/types';
import { cx } from '../lib/format';
import { Card, PageHeader, Spinner, Tabs } from '../components/ui';

const LEVEL_INFO: Record<number, { desc: string; ex: string }> = {
  1: { desc: '흩어진 컨디션 공유·면담·코멘트를 요약하고, 팀장님 노하우대로 초안을 씁니다.', ex: '주간보고 초안 · 1:1 준비 노트 · 1차 검토 · 내 노하우 반영' },
  2: { desc: '반복되는 막힘, 컨디션 추세, 같은 피드백의 반복을 잡아냅니다.', ex: '케어 레이더 · 월요일 브리핑' },
  3: { desc: '팀원별 위치와 이동 방향, 판단 깊이 추세, 근거 달린 평가 초안을 만듭니다.', ex: '팀 성과 지도 · 지난 결과물 비교 · 평가 초안' },
  4: { desc: '실적 범위와 목표 달성 확률을 계산하고 What-if를 돌립니다.', ex: '실적 전망 · 시뮬레이션 · 분기 전략 점검' },
  5: { desc: '이 팀이 어떤 조건에서 성과를 내는지, 팀장 판단이 언제 잘 맞았는지를 봅니다.', ex: '팀장 판단 회고 · 우리 팀 기준 리뷰 · 사람-과제 매칭 제안' },
};
const ACTION: [RegExp, string, string][] = [
  [/컨디션|체크인/, '팀원에게 주간 컨디션 공유를 요청하세요', '/settings?tab=members'],
  [/1:1/, '이번 주 1:1을 잡으세요', '/people?new=1'],
  [/판단 근거/, '관찰 메모를 남기거나 결과물을 리뷰하세요', '/'],
  [/리뷰한 결과물/, '리뷰룸에서 코멘트를 남기세요', '/work'],
  [/실적/, '실적 지표에 월별 실적을 입력하세요', '/perf'],
  [/공수/, '과제에 주당 공수를 적으세요', '/goals/edit'],
  [/의사결정/, '지난 의사결정에 결과를 기록하세요', '/decide'],
  [/예측과 실제/, '분기가 끝나면 자동으로 쌓입니다', '/perf'],
  [/승인/, "리뷰룸에서 '이대로 좋음'을 누르면 쌓입니다", '/work'],
];

function cell(v: number, th: [number, number, number]) {
  const lvl = v >= th[0] ? 3 : v >= th[1] ? 2 : v >= th[2] ? 1 : 0;
  const st = ['bg-slate-50 text-slate-400', 'bg-violet-100 text-violet-900', 'bg-violet-300 text-violet-950', 'bg-violet-600 text-white'][lvl];
  return <td className="p-0.5"><div className={cx('rounded-md text-center font-mono num py-2', st)}>{v}</div></td>;
}

/** SQL(team_insight_level)이 주는 옛 이름표를 화면 이름으로 */
const condLabel = (s: string) => s.replace('체크인이 쌓인 주', '컨디션 공유가 쌓인 주');

function Cond({ c, open }: { c: LevelCondition; open: boolean }) {
  const pct = Math.min(100, (c.current / Math.max(1, c.target)) * 100);
  return (
    <div>
      <div className="flex justify-between gap-2 text-xs"><span className="text-slate-600">{condLabel(c.label)}</span><span className="font-mono num text-slate-500">{c.current}/{c.target}{c.unit ?? ''}</span></div>
      {!open && <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

export default function Insight() {
  const { team } = useTeam();
  const [tab, setTab] = useState<'d1' | 'd3' | 'd5'>('d3');
  const lv = useQuery({ queryKey: ['insight', team.id], queryFn: () => q<InsightLevel>(supabase.rpc('team_insight_level', { p_team: team.id })) });
  const depth = useQuery({ queryKey: ['depth', team.id], queryFn: () => q<DepthRow[]>(supabase.rpc('member_data_depth', { p_team: team.id })) });
  if (lv.isLoading || !lv.data) return <Spinner />;
  const d = lv.data;
  const next = d.levels[d.level];
  const todo = next ? next.conditions.filter((c) => c.current < c.target) : [];

  return (
    <section>
      <PageHeader title="AI 인사이트 레벨" sub={'기록이 쌓일수록 AI가 볼 수 있는 깊이가 달라집니다. 근거가 모자라면 추측하지 않고 "아직 판단할 수 없다"고 말합니다.'} />
      <div className="rounded-2xl bg-slate-900 text-white p-6">
        <div className="text-xs font-semibold tracking-wider text-violet-300">{team.name}</div>
        <div className="mt-3 flex items-end gap-4 flex-wrap">
          <div className="text-5xl font-bold font-mono leading-none">L{d.level}</div>
          <div><div className="text-lg font-semibold">{d.levels[d.level - 1].name}</div><div className="text-sm text-slate-300">{LEVEL_INFO[d.level].desc}</div></div>
        </div>
        {next && (
          <div className="mt-6">
            <div className="flex justify-between text-xs text-slate-300"><span>다음 · L{next.level} {next.name}</span><span className="font-mono num">{d.next_progress ?? 0}%</span></div>
            <div className="mt-1.5 h-2 rounded-full bg-white/10"><div className="h-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${d.next_progress ?? 0}%` }} /></div>
          </div>
        )}
        <div className="mt-6 grid grid-cols-3 sm:grid-cols-6 gap-3 text-sm">
          {[['컨디션 공유', d.totals.checkins], ['1:1 기록', d.totals.one_on_ones], ['올린 결과물', d.totals.submissions], ['리뷰한 결과물', d.totals.reviewed], ['관찰 메모', d.totals.observations], ['실적 데이터', `${d.totals.metric_months}개월`]].map(([l, v]) => (
            <div key={l as string}><div className="text-2xl font-bold font-mono num">{v}</div><div className="text-xs text-slate-400">{l}</div></div>
          ))}
        </div>
      </div>

      <div className="mt-5 grid lg:grid-cols-5 gap-5 items-start">
        <Card className="lg:col-span-3 p-5 md:p-6">
          <h2 className="font-semibold">레벨별로 AI가 할 수 있는 일</h2>
          <div className="mt-2 divide-y divide-slate-100">
            {d.levels.map((l) => {
              const open = l.level <= d.level;
              const isNext = l.level === d.level + 1;
              return (
                <div key={l.level} className={cx('grid sm:grid-cols-[auto_1fr_220px] gap-x-4 gap-y-2 py-4', isNext && 'rounded-xl bg-violet-50/50 -mx-3 px-3')}>
                  <div className={cx('w-11 h-11 rounded-xl font-mono font-bold flex items-center justify-center shrink-0', open ? 'bg-violet-600 text-white' : 'border-2 border-dashed border-violet-300 text-violet-600')}>L{l.level}</div>
                  <div className="min-w-0"><div className="font-semibold">{l.name}</div><p className="text-sm text-slate-600 mt-0.5">{LEVEL_INFO[l.level].desc}</p><p className="text-xs text-violet-700 mt-1.5">{LEVEL_INFO[l.level].ex}</p></div>
                  <div className="sm:pt-1 space-y-2">
                    {open && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={13} />열림</span>}
                    {l.conditions.map((c) => <Cond key={c.label} c={c} open={open} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="lg:col-span-2 space-y-5">
          <Card className="p-5">
            <h2 className="font-semibold">같은 질문, 다른 깊이</h2>
            <p className="text-sm text-slate-600 mt-1">"이 팀원은 잘하고 있나요?" <span className="text-xs text-slate-400">— 예시</span></p>
            <div className="mt-3"><Tabs value={tab} onChange={setTab} items={[{ id: 'd1', label: 'L1 · 1개월' }, { id: 'd3', label: 'L3 · 6개월' }, { id: 'd5', label: 'L5 · 1년' }]} /></div>
            {tab === 'd1' && <div className="pt-4"><div className="text-[11px] text-slate-500">근거 · 컨디션 공유 4건 · 1:1 2회</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-700 rounded-lg bg-violet-50/60 p-3">최근 4주 동안 신제품 기획서를 작성했고, 경쟁사 데이터 확보에서 한 번 막혔습니다. 컨디션은 3~4로 안정적입니다.</p>
              <p className="mt-2 text-xs text-slate-500">있었던 일을 정리하는 수준입니다. 잘하고 있는지는 아직 판단하지 않습니다.</p></div>}
            {tab === 'd3' && <div className="pt-4"><div className="text-[11px] text-slate-500">근거 · 컨디션 공유 26주 · 1:1 12회 · 결과물 9건 · 관찰 메모 7건</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-700 rounded-lg bg-violet-50/60 p-3">판단 깊이가 1.8에서 2.5로 올라 <b>핵심 기여 쪽으로 이동 중</b>입니다. 문제 정의와 방향 전환이 강점입니다. 실행 관리는 근거가 3건뿐이라 아직 판단하기 이릅니다.</p>
              <p className="mt-2 text-xs text-slate-500">추세와 강점·약점을 근거와 함께 말합니다. 근거가 모자란 항목은 비워 둡니다.</p></div>}
            {tab === 'd5' && <div className="pt-4"><div className="text-[11px] text-slate-500">근거 · L3 근거 + 결과가 기록된 의사결정 10건 · 예측과 실제 2분기</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-700 rounded-lg bg-violet-50/60 p-3">이 팀원이 리드한 과제는 <b>가설이 명확할 때</b> 5건 중 4건이 목표를 넘겼고, 일정이 촉박한 과제에서는 품질이 떨어졌습니다. 다음 과제를 맡긴다면 2주의 일정 여유와 실행 관리 코칭을 함께 주는 편이 좋습니다.</p>
              <p className="mt-2 text-xs text-slate-500">결과까지 이어진 기록이 있어야 가능한 답입니다.</p></div>}
          </Card>
          <Card className="p-5 text-sm">
            <div className="font-semibold">AI가 똑똑해지는 게 아니라, 볼 것이 많아지는 겁니다</div>
            <ul className="mt-2 space-y-1.5 text-slate-600 leading-relaxed text-[13px]">
              <li>· 팀 기록으로 AI 모델을 학습시키지 않습니다. 요청할 때마다 쌓인 기록을 근거로 읽습니다.</li>
              <li>· 레벨은 팀 전체와 팀원 한 명 한 명에게 따로 적용됩니다.</li>
              <li>· 근거가 기준에 못 미치면 그 항목은 '판단 보류'로 둡니다. 보류된 요청은 크레딧을 쓰지 않습니다.</li>
            </ul>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid lg:grid-cols-5 gap-5 items-start">
        <Card className="lg:col-span-3 min-w-0 p-5">
          <div className="flex items-center justify-between flex-wrap gap-2"><h2 className="font-semibold">팀원별 데이터 깊이</h2>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">얕음<span className="w-4 h-3 rounded-sm bg-slate-50 border border-slate-200" /><span className="w-4 h-3 rounded-sm bg-violet-100" /><span className="w-4 h-3 rounded-sm bg-violet-300" /><span className="w-4 h-3 rounded-sm bg-violet-600" />풍부</div></div>
          <div className="mt-3 overflow-x-auto">
            {!depth.data?.length ? <p className="text-sm text-slate-500 py-4">팀원이 없습니다.</p> : (
              <table className="w-full text-sm min-w-[520px]">
                <thead><tr className="text-xs text-slate-500"><th className="text-left font-normal pb-1">팀원</th><th className="font-normal pb-1">컨디션 공유(주)</th><th className="font-normal pb-1">1:1(회)</th><th className="font-normal pb-1">결과물</th><th className="font-normal pb-1">관찰 메모</th><th className="text-left font-normal pb-1 pl-3">AI가 볼 수 있는 것</th></tr></thead>
                <tbody>
                  {depth.data.map((m) => (
                    <tr key={m.user_id}>
                      <td className="py-1 pr-3 whitespace-nowrap"><span className="font-medium">{m.full_name}</span> <span className="text-xs text-slate-400">{m.job_title}</span></td>
                      {cell(m.checkin_weeks, [20, 12, 4])}{cell(m.one_on_ones, [10, 6, 2])}{cell(m.submissions, [8, 5, 2])}{cell(m.observations, [6, 4, 2])}
                      <td className="pl-3"><span className={cx('text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap', m.eligible ? 'text-violet-700 bg-violet-50 border border-violet-200' : 'text-amber-800 bg-amber-50 border border-dashed border-amber-300')}>{m.can_see}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-3">판단 근거(결과물·관찰 메모·리뷰 코멘트·팀장 메모·과제 완료)가 {String((team.settings?.min_judgment_evidence as number) ?? 8)}건 미만인 팀원은 평가 초안과 성과 지도에서 판단을 보류합니다.</p>
        </Card>
        <Card className="lg:col-span-2 p-5">
          <h2 className="font-semibold">{next ? `L${next.level}까지 남은 일` : '모든 레벨이 열렸습니다'}</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {todo.map((c, i) => {
              const a = ACTION.find(([re]) => re.test(c.label));
              return (
                <li key={c.label} className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-mono font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="flex-1"><b>{condLabel(c.label)} {c.target - c.current}{c.unit ?? ''} 더</b><p className="text-xs text-slate-500 mt-0.5">{a?.[1]}</p></div>
                  {a && <Link to={a[2]} className="text-xs font-semibold text-indigo-700 shrink-0">바로 가기</Link>}
                </li>
              );
            })}
          </ul>
          {(depth.data ?? []).filter((m) => !m.eligible).length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-600 leading-relaxed">
              <b>판단 보류 중인 팀원</b> — {(depth.data ?? []).filter((m) => !m.eligible).map((m) => `${m.full_name}(${m.judgment_evidence}건)`).join(', ')}. 관찰 메모나 결과물 리뷰가 쌓이면 진단이 열립니다.
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}
