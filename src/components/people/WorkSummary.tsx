// 업무 수행 경과 — 진척 · 계획 대비 · 결과물 · 요청 처리를 모은 숫자 + AI의 종합 판단
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q } from '../../lib/supabase';
import { useItems } from '../../lib/items';
import { planGap } from '../../lib/plan';
import { useJudgmentScores, trendOf } from '../../lib/people';
import { useSubmissionsAi } from '../../lib/work';
import { usePeopleActions } from '../../lib/peopleActions';
import { cx } from '../../lib/format';
import { todayYmd as todayStr } from '../home/shared';
import { AiChip } from '../AiBar';

const WORK: Record<string, { label: string; cls: string }> = {
  good: { label: '순항', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  watch: { label: '주의', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  support: { label: '지원 필요', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
};
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');

export function useWorkFacts(uid: string) {
  const { team } = useTeam();
  const items = useItems(team.id);
  const subs = useSubmissionsAi(team.id, { authorId: uid });
  const sc = useJudgmentScores(team.id, uid);
  const reqs = useQuery({
    queryKey: ['requests', team.id, 'to', uid, 'all'],
    queryFn: () => q<{ id: string; status: string; due_date: string | null; responded_at: string | null }[]>(supabase.from('team_requests').select('id, status, due_date, responded_at').eq('team_id', team.id).eq('to_id', uid)
      .gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString())),
  });
  const today = todayStr();
  const mine = (items.data ?? []).filter((n) => n.owner_id === uid && n.status !== 'dropped');
  const active = mine.filter((n) => n.status === 'active' || n.status === 'blocked');
  const late = active.filter((n) => { const g = planGap(n); return g.tone === 'behind' || g.tone === 'late'; });
  const t = trendOf((sc.data ?? []).map((s) => Number(s.score)));
  const s = subs.data ?? [];
  const rq = reqs.data ?? [];
  const onTime = rq.filter((r) => r.status === 'done' && (!r.due_date || (r.responded_at ?? '').slice(0, 10) <= r.due_date)).length;
  return {
    loading: items.isLoading || subs.isLoading,
    chips: [
      { k: '진행', v: `${active.length}건`, warn: false },
      { k: '막힘', v: `${active.filter((n) => n.status === 'blocked').length}`, warn: active.some((n) => n.status === 'blocked') },
      { k: '계획보다 늦음', v: `${late.length}`, warn: late.length > 0 },
      { k: '기한 지남', v: `${active.filter((n) => n.due_date && n.due_date < today).length}`, warn: active.some((n) => n.due_date && n.due_date < today) },
      { k: '완료', v: `${mine.filter((n) => n.status === 'done').length}`, warn: false },
      { k: '결과물 리뷰 중·승인', v: `${s.filter((x) => x.status === 'in_review').length} · ${s.filter((x) => x.status === 'approved').length}`, warn: false },
      { k: '판단 깊이', v: t.now != null ? `${t.now}/4` : '—', warn: t.now != null && t.prev != null && t.now - t.prev <= -0.3 },
      { k: '요청 기한 준수', v: rq.length ? `${onTime}/${rq.filter((r) => r.status === 'done').length}` : '—', warn: false },
    ],
  };
}

export function WorkSummary({ uid, link, className }: { uid: string; link?: boolean; className?: string }) {
  const { team } = useTeam();
  const pa = usePeopleActions(team.id, team.is_demo);
  const view = pa.out?.content.members?.find((v) => v.user_id === uid);
  const f = useWorkFacts(uid);
  return (
    <section className={cx('rounded-2xl bg-white ring-1 ring-slate-900/[0.07] p-4', className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm">업무 수행 경과</span>
        {view && <span className={cx('text-[11px] font-semibold rounded-full ring-1 px-2 py-0.5', WORK[view.work_status]?.cls)}>{WORK[view.work_status]?.label}</span>}
        {link && <Link to={`/work/u/${uid}`} className="ml-auto text-xs font-semibold text-indigo-700 inline-flex items-center">업무플랫폼에서 자세히<ChevronRight size={13} /></Link>}
      </div>
      {view ? <p className="mt-2 text-sm leading-relaxed text-slate-800"><AiChip label="AI 종합 판단" tone="solid" className="mr-1.5" />{strip(view.work_view)}</p>
        : <p className="mt-2 text-xs text-slate-500"><AiChip label="AI" className="mr-1" />팀원관리에서 '이번 주 추천'을 만들면 진척·계획 대비·결과물·요청 처리를 엮은 종합 판단이 여기에 붙습니다.</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {f.chips.map((c) => <span key={c.k} className={cx('text-[11px] rounded-full px-2 py-0.5', c.warn ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' : 'bg-slate-100 text-slate-600')}>{c.k} <b className="num">{c.v}</b></span>)}
      </div>
    </section>
  );
}
