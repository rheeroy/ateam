// 팀원 상세 › 업무 수행 경과 — 업무 측면을 '전반'으로 본다.
// 업무플랫폼 개인 스페이스(과제별 진행·막힘·리뷰 숫자)와 달리 디테일은 빼고:
//   AI 업무 종합 판단(주간 팀원 액션의 work_view) + 맡은 일 전체 상태 · 최근 30일 흐름 · 일하는 방식 세 줄.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q } from '../../lib/supabase';
import { useItems } from '../../lib/items';
import { planGap } from '../../lib/plan';
import { useJudgmentScores, trendOf } from '../../lib/people';
import { useSubmissionsAi } from '../../lib/work';
import { usePeopleActions } from '../../lib/peopleActions';
import { cx } from '../../lib/format';
import { todayYmd } from '../home/shared';
import { AiChip } from '../AiBar';
import { Spinner } from '../ui';
import { CoreAI } from '../Brand';

const WORK: Record<string, { label: string; cls: string }> = {
  good: { label: '순항', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  watch: { label: '주의', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  support: { label: '지원 필요', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
};
const D = 86400000;
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
const inWin = (iso: string | null | undefined, from: number, to: number) => { if (!iso) return false; const t = Date.parse(iso); return t >= Date.now() - from * D && t < Date.now() - to * D; };

function Trend({ now, prev, eps = 0 }: { now: number | null; prev: number | null; eps?: number }) {
  if (now == null || prev == null) return null;
  const m = now > prev + eps ? { I: ArrowUpRight, c: 'text-emerald-600', l: '좋아짐' } : now < prev - eps ? { I: ArrowDownRight, c: 'text-rose-600', l: '나빠짐' } : { I: ArrowRight, c: 'text-slate-400', l: '비슷' };
  return <m.I size={13} className={cx('inline -mt-0.5', m.c)} aria-label={m.l} />;
}
function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div className="flex items-center gap-3"><span className="w-20 shrink-0 text-xs text-slate-500">{k}</span><div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap text-xs text-slate-700 num">{children}</div></div>;
}

export function PersonOverview({ uid }: { uid: string; name?: string }) {
  const { team } = useTeam();
  const pa = usePeopleActions(team.id, team.is_demo);
  const view = pa.out?.content.members?.find((v) => v.user_id === uid);
  const items = useItems(team.id);
  const subs = useSubmissionsAi(team.id, { authorId: uid });
  const sc = useJudgmentScores(team.id, uid);
  const reqs = useQuery({
    queryKey: ['requests', team.id, 'to', uid, 'all'],
    queryFn: () => q<{ id: string; status: string; due_date: string | null; responded_at: string | null }[]>(supabase.from('team_requests').select('id, status, due_date, responded_at').eq('team_id', team.id).eq('to_id', uid)
      .gte('created_at', new Date(Date.now() - 60 * D).toISOString())),
  });
  const today = todayYmd();

  // 맡은 일 전체 — 진행 중인 일을 순항 · 늦음 · 막힘으로
  const mine = (items.data ?? []).filter((n) => n.owner_id === uid && n.status !== 'dropped');
  const active = mine.filter((n) => n.status === 'active' || n.status === 'blocked');
  const blocked = active.filter((n) => n.status === 'blocked').length;
  const late = active.filter((n) => n.status !== 'blocked' && ((!!n.due_date && n.due_date < today) || ['behind', 'late'].includes(planGap(n).tone))).length;
  const ok = active.length - blocked - late;
  // 최근 30일 흐름
  const done30 = mine.filter((n) => n.status === 'done' && inWin(n.done_at ?? n.updated_at, 30, 0)).length;
  const donePrev = mine.filter((n) => n.status === 'done' && inWin(n.done_at ?? n.updated_at, 60, 30)).length;
  const s30 = (subs.data ?? []).filter((s) => inWin(s.created_at, 30, 0));
  const approved = s30.filter((s) => s.status === 'approved').length;
  // 일하는 방식
  const rq = (reqs.data ?? []).filter((r) => r.status === 'done');
  const onTime = rq.filter((r) => !r.due_date || (r.responded_at ?? '').slice(0, 10) <= r.due_date).length;
  const t = trendOf((sc.data ?? []).map((s) => Number(s.score)));

  return (
    <section className="rounded-2xl bg-white ring-1 ring-slate-900/[0.07] p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm">업무 수행 경과</span>
        {view && <span className={cx('text-[11px] font-semibold rounded-full ring-1 px-2 py-0.5', WORK[view.work_status]?.cls)}>{WORK[view.work_status]?.label}</span>}
        <Link to={`/work/u/${uid}`} className="ml-auto text-xs font-semibold text-indigo-700 inline-flex items-center">과제별 진행은 업무플랫폼에서<ChevronRight size={13} /></Link>
      </div>
      {view ? <p className="mt-2 text-sm leading-relaxed text-slate-800"><AiChip label="AI 종합 판단" tone="solid" className="mr-1.5" />{strip(view.work_view)}</p>
        : <p className="mt-2 text-xs text-slate-500"><AiChip label="AI" className="mr-1" />팀원관리에서 '이번 주 추천'을 만들면 맡은 일 전반에 대한 <CoreAI /> 종합 판단이 여기에 붙습니다.</p>}
      {items.isLoading ? <Spinner /> : (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          <Row k="맡은 일 전체">
            {active.length ? (
              <>
                <div className="flex h-2 w-40 rounded-full overflow-hidden bg-slate-100 gap-px" title={`순항 ${ok} · 늦음 ${late} · 막힘 ${blocked}`}>
                  {ok > 0 && <span className="bg-emerald-500" style={{ flex: ok }} />}
                  {late > 0 && <span className="bg-amber-400" style={{ flex: late }} />}
                  {blocked > 0 && <span className="bg-rose-500" style={{ flex: blocked }} />}
                </div>
                <span>순항 <b>{ok}</b> · <span className={cx(late > 0 && 'text-amber-700')}>늦음 <b>{late}</b></span> · <span className={cx(blocked > 0 && 'text-rose-600')}>막힘 <b>{blocked}</b></span></span>
              </>
            ) : <span className="text-slate-400">진행 중인 일 없음</span>}
          </Row>
          <Row k="최근 30일">
            <span>마무리 <b>{done30}건</b> <Trend now={done30} prev={donePrev} /> <span className="text-slate-400">(지난달 {donePrev})</span></span>
            <span className="text-slate-300">·</span>
            <span>결과물 승인 <b>{s30.length ? `${approved}/${s30.length}` : '—'}</b></span>
          </Row>
          <Row k="일하는 방식">
            <span className={cx(rq.length > 0 && onTime < rq.length && 'text-amber-700')}>요청 기한 준수 <b>{rq.length ? `${onTime}/${rq.length}` : '—'}</b></span>
            <span className="text-slate-300">·</span>
            <span>판단 깊이 <b>{t.now != null ? `${t.now}/4` : '—'}</b> <Trend now={t.now} prev={t.prev} eps={0.2} /></span>
          </Row>
        </div>
      )}
    </section>
  );
}
