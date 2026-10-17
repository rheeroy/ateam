// 팀원 상세 › "○○ 님 요즘 어때요" — 사람 단위 종합 진단
// 업무플랫폼(과제 하나하나가 어떻게 되고 있나)과 달리, 이 사람의 지난 30일을 네 영역으로 묶어 지난달과 비교한다.
// 규칙 기반 (AI 호출 없음). 과제 단위 상세는 업무플랫폼으로 보낸다.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, HeartPulse, Sprout, Target, Workflow } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q } from '../../lib/supabase';
import { useItems } from '../../lib/items';
import { planGap } from '../../lib/plan';
import { useCheckins, useJudgmentScores, useObservations, useOneOnOneMap, trendOf } from '../../lib/people';
import { useSubmissionsAi } from '../../lib/work';
import { cx, daysAgo } from '../../lib/format';
import { todayYmd } from '../home/shared';
import { usePeopleIndex } from './usePeopleIndex';
import { useHomeModel } from '../home/shared';
import { LogoMark } from '../Brand';
import { Spinner } from '../ui';

type Lv = 'good' | 'watch' | 'risk';
type Tr = 'up' | 'down' | 'flat' | null;
type AreaKey = 'perf' | 'way' | 'grow' | 'bond';
interface Fact { k: string; v: string; warn?: boolean }
interface Area { key: AreaKey; level: Lv; trend: Tr; trendNote: string; facts: Fact[] }

const META: Record<AreaKey, { label: string; topic: string; subj: string; icon: typeof Target; tint: string; hint: string }> = {
  perf: { label: '성과 기여', topic: '성과 기여는', subj: '성과 기여가', icon: Target, tint: 'text-indigo-600 bg-indigo-50', hint: '막힌 과제부터 같이 풀어 주세요' },
  way: { label: '일하는 방식', topic: '일하는 방식은', subj: '일하는 방식이', icon: Workflow, tint: 'text-sky-600 bg-sky-50', hint: '다음 결과물은 초안 단계에서 한 번 먼저 봐 주세요' },
  grow: { label: '성장', topic: '성장은', subj: '성장이', icon: Sprout, tint: 'text-emerald-600 bg-emerald-50', hint: '잘한 점을 짚어 주고 다음에 맡을 일을 같이 정해 보세요' },
  bond: { label: '관계·몰입', topic: '관계·몰입은', subj: '관계·몰입이', icon: HeartPulse, tint: 'text-rose-600 bg-rose-50', hint: '업무 얘기보다 요즘 어떤지부터 물어봐 주세요' },
};
const DOT: Record<Lv, string> = { good: 'bg-emerald-500', watch: 'bg-amber-400', risk: 'bg-rose-500' };
const LV_LABEL: Record<Lv, string> = { good: '순항', watch: '주의', risk: '챙길 때' };

const D = 86400000;
const inWin = (iso: string | null | undefined, from: number, to: number) => { if (!iso) return false; const t = Date.parse(iso); return t >= Date.now() - from * D && t < Date.now() - to * D; };
const cmp = (now: number | null, prev: number | null, eps = 0): Tr => (now == null || prev == null ? null : now > prev + eps ? 'up' : now < prev - eps ? 'down' : 'flat');
const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);

function useOverview(uid: string) {
  const { team } = useTeam();
  const items = useItems(team.id);
  const subs = useSubmissionsAi(team.id, { authorId: uid });
  const sc = useJudgmentScores(team.id, uid);
  const obs = useObservations(team.id, uid, 70);
  const ci = useCheckins(team.id, uid, 8);
  const oo = useOneOnOneMap(team.id);
  const pi = usePeopleIndex(useHomeModel('weekly'));
  const reqs = useQuery({
    queryKey: ['requests', team.id, 'to', uid, 'all'],
    queryFn: () => q<{ id: string; status: string; due_date: string | null; responded_at: string | null }[]>(supabase.from('team_requests').select('id, status, due_date, responded_at').eq('team_id', team.id).eq('to_id', uid)
      .gte('created_at', new Date(Date.now() - 60 * D).toISOString())),
  });
  const loading = items.isLoading || subs.isLoading || ci.isLoading;
  const today = todayYmd();

  // 1) 성과 기여 — 맡은 일의 진척과 최근 마무리
  const mine = (items.data ?? []).filter((n) => n.owner_id === uid && n.status !== 'dropped');
  const active = mine.filter((n) => n.status === 'active' || n.status === 'blocked');
  const late = active.filter((n) => { const g = planGap(n); return g.tone === 'behind' || g.tone === 'late'; });
  const blocked = active.filter((n) => n.status === 'blocked');
  const done30 = mine.filter((n) => n.status === 'done' && inWin(n.done_at ?? n.updated_at, 30, 0)).length;
  const donePrev = mine.filter((n) => n.status === 'done' && inWin(n.done_at ?? n.updated_at, 60, 30)).length;
  const prog = avg(active.map((n) => Number(n.progress ?? 0)));
  const perf: Area = {
    key: 'perf',
    level: blocked.length || late.length >= 2 ? 'risk' : late.length ? 'watch' : 'good',
    trend: cmp(done30, donePrev), trendNote: `마무리 ${done30}건 · 지난달 ${donePrev}건`,
    facts: [
      { k: '맡은 목표·과제', v: active.length ? `${active.length}건 · 평균 ${Math.round(prog ?? 0)}%` : '없음' },
      { k: '계획보다 늦음 · 막힘', v: `${late.length} · ${blocked.length}`, warn: late.length + blocked.length > 0 },
      { k: '최근 30일 마무리', v: `${done30}건` },
    ],
  };

  // 2) 일하는 방식 — 기한, 판단 깊이, 같은 보완점 반복, 요청 처리
  const t = trendOf((sc.data ?? []).map((s) => Number(s.score)));
  const overdue = active.filter((n) => n.due_date && n.due_date < today).length;
  const gapCount = new Map<string, number>();
  for (const s of (subs.data ?? []).slice(0, 6)) for (const g of s.review?.gaps ?? []) { const k = (g.section || '').trim(); if (k) gapCount.set(k, (gapCount.get(k) ?? 0) + 1); }
  const rep = [...gapCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const repeat = rep && rep[1] >= 2 ? rep : null;
  const rq = (reqs.data ?? []).filter((r) => r.status === 'done');
  const onTime = rq.filter((r) => !r.due_date || (r.responded_at ?? '').slice(0, 10) <= r.due_date).length;
  const depthDown = t.now != null && t.prev != null && t.now - t.prev <= -0.3;
  const way: Area = {
    key: 'way',
    level: overdue >= 2 || (depthDown && repeat) ? 'risk' : overdue || depthDown || repeat ? 'watch' : 'good',
    trend: cmp(t.now, t.prev, 0.2), trendNote: t.now != null ? `판단 깊이 ${t.now}/4${t.prev != null ? ` · 직전 ${t.prev}` : ''}` : '판단 깊이 기록 없음',
    facts: [
      { k: '기한 지남', v: `${overdue}건`, warn: overdue > 0 },
      { k: '같은 보완점 반복', v: repeat ? `'${repeat[0]}' ${repeat[1]}회` : '없음', warn: !!repeat },
      { k: '요청 기한 준수', v: rq.length ? `${onTime}/${rq.length}` : '—', warn: rq.length > 0 && onTime < rq.length },
    ],
  };

  // 3) 성장 — 인정받은 장면, 새로 맡은 일, 승인된 결과물
  const ob = obs.data ?? [];
  const praise30 = ob.filter((o) => o.kind === 'praise' && inWin(o.occurred_at, 30, 0)).length;
  const praisePrev = ob.filter((o) => o.kind === 'praise' && inWin(o.occurred_at, 60, 30)).length;
  const newItems = mine.filter((n) => inWin(n.created_at, 30, 0)).length;
  const approved30 = (subs.data ?? []).filter((s) => s.status === 'approved' && inWin(s.approved_at ?? s.updated_at, 30, 0)).length;
  const grow: Area = {
    key: 'grow',
    level: praise30 + approved30 + newItems === 0 ? 'watch' : 'good',
    trend: cmp(praise30 + approved30, praisePrev), trendNote: `칭찬·좋은 장면 ${praise30}건 · 지난달 ${praisePrev}건`,
    facts: [
      { k: '칭찬·좋은 장면', v: `${praise30}건` },
      { k: '결과물 승인', v: `${approved30}건` },
      { k: '새로 맡은 일', v: `${newItems}건` },
    ],
  };

  // 4) 관계·몰입 — 컨디션 흐름, 체크인 빈도, 1:1 간격, 팀장 접점
  const rows = ci.data ?? [];
  const cNow = avg(rows.filter((c) => inWin(c.week_start, 28, -7)).map((c) => c.condition).filter((v): v is number => v != null));
  const cPrev = avg(rows.filter((c) => inWin(c.week_start, 56, 28)).map((c) => c.condition).filter((v): v is number => v != null));
  const ciCount = rows.filter((c) => inWin(c.week_start, 28, -7)).length;
  const last = oo.data?.last.get(uid); const ooDays = last ? daysAgo(last.scheduled_at) : null;
  const attn = pi.idx.get(uid)?.indices.find((i) => i.key === 'attn');
  const bond: Area = {
    key: 'bond',
    level: (cNow != null && cNow <= 2) || (cNow != null && cPrev != null && cNow - cPrev <= -1) ? 'risk'
      : (cNow != null && cNow < 3.5) || ooDays == null || ooDays > 21 || ciCount <= 1 || attn?.level === 'risk' ? 'watch' : 'good',
    trend: cmp(cNow, cPrev, 0.3), trendNote: cNow != null ? `컨디션 평균 ${cNow}${cPrev != null ? ` · 지난달 ${cPrev}` : ''}` : '컨디션 기록 없음',
    facts: [
      { k: '컨디션 (4주 평균)', v: cNow != null ? `${cNow}/5` : '—', warn: cNow != null && cNow < 3 },
      { k: '체크인', v: `4주 중 ${Math.min(4, ciCount)}번`, warn: ciCount <= 1 },
      { k: '마지막 1:1 · 팀장 접점', v: `${ooDays == null ? '없음' : `${ooDays}일 전`} · ${attn?.value ?? '—'}`, warn: ooDays == null || ooDays > 21 || attn?.level === 'risk' },
    ],
  };

  return { loading, areas: [perf, way, grow, bond] };
}

/** 네 영역에서 진단 한 줄 — 괜찮은 쪽 하나와 걸리는 쪽 하나를 짚고, 팀장이 할 일을 붙인다 */
function diagnose(areas: Area[]): { text: string; hint?: string } {
  const rank = (a: Area) => (a.level === 'risk' ? 2 : a.level === 'watch' ? 1 : 0) + (a.trend === 'down' ? 0.5 : 0);
  const weak = [...areas].filter((a) => a.level !== 'good').sort((a, b) => rank(b) - rank(a))[0];
  const strong = areas.filter((a) => a.level === 'good').sort((a, b) => (b.trend === 'up' ? 1 : 0) - (a.trend === 'up' ? 1 : 0))[0];
  if (!weak) return { text: '네 영역 모두 순항 중이에요', hint: '지금 흐름을 짚어서 인정해 주면 좋아요' };
  const w = META[weak.key];
  if (!strong) return { text: `전반적으로 챙길 때예요. 특히 ${w.subj} 가장 걸려요`, hint: w.hint };
  return { text: `${META[strong.key].topic} 괜찮은데, ${w.subj} ${weak.level === 'risk' ? '걸려요' : '조금 걸려요'}`, hint: w.hint };
}

function TrendChip({ t, note }: { t: Tr; note: string }) {
  const m = t === 'up' ? { I: ArrowUpRight, cls: 'text-emerald-700 bg-emerald-50', l: '좋아짐' } : t === 'down' ? { I: ArrowDownRight, cls: 'text-rose-700 bg-rose-50', l: '나빠짐' } : t === 'flat' ? { I: ArrowRight, cls: 'text-slate-600 bg-slate-100', l: '비슷' } : null;
  if (!m) return <span className="text-[10px] text-slate-400" title={note}>비교 기록 없음</span>;
  return <span title={note} className={cx('text-[10px] font-semibold rounded-full px-1.5 py-0.5 inline-flex items-center gap-0.5', m.cls)}><m.I size={11} />{m.l}</span>;
}

export function PersonOverview({ uid, name }: { uid: string; name: string }) {
  const { loading, areas } = useOverview(uid);
  const dx = diagnose(areas);
  return (
    <section className="rounded-2xl bg-white ring-1 ring-slate-900/[0.07] overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm">{name} 님 요즘 어때요</span>
        <span className="text-[11px] text-slate-400">최근 30일 · 지난달 대비</span>
        <Link to={`/work/u/${uid}`} className="ml-auto text-xs font-semibold text-indigo-700 inline-flex items-center">과제별 진행은 업무플랫폼에서<ChevronRight size={13} /></Link>
      </div>
      {loading ? <div className="p-6"><Spinner /></div> : (
        <>
          <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-violet-50/40 flex items-start gap-2.5">
            <span className="mt-0.5 w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center shrink-0"><LogoMark size={13} /></span>
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-slate-900 leading-snug">{dx.text}</div>
              {dx.hint && <div className="text-xs text-indigo-800 mt-0.5">→ {dx.hint}</div>}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-px bg-slate-100">
            {areas.map((a) => {
              const M = META[a.key];
              return (
                <div key={a.key} className="bg-white p-4">
                  <div className="flex items-center gap-2">
                    <span className={cx('w-6 h-6 rounded-md flex items-center justify-center', M.tint)}><M.icon size={13} /></span>
                    <span className="text-sm font-semibold">{M.label}</span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><span className={cx('w-2 h-2 rounded-full', DOT[a.level])} />{LV_LABEL[a.level]}</span>
                    <span className="ml-auto"><TrendChip t={a.trend} note={a.trendNote} /></span>
                  </div>
                  <dl className="mt-2.5 space-y-1">
                    {a.facts.map((f) => (
                      <div key={f.k} className="flex items-baseline gap-2 text-xs">
                        <dt className="text-slate-500">{f.k}</dt>
                        <span className="flex-1 border-b border-dotted border-slate-200" />
                        <dd className={cx('num font-semibold', f.warn ? 'text-amber-700' : 'text-slate-800')}>{f.v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-1.5 text-[10px] text-slate-400">{a.trendNote}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
