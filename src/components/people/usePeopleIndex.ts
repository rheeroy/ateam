// 팀원별 표준 지표 (컨디션 · 이탈 가능성 · 업무 부하 · 성장 · 1on1 · 평가 근거)를 한 번에
import { useMemo } from 'react';
import { useTeam } from '../../state/session';
import { useTeamMembersOnly } from '../../lib/hooks';
import { useItems } from '../../lib/items';
import { useJudgmentScores, useObservations, useOneOnOneMap } from '../../lib/people';
import { attnCtx, memberIndex, useAttention, usePeopleActions, type MemberIndex, type MemberView } from '../../lib/peopleActions';
import type { HomeModel } from '../home/shared';

export function usePeopleIndex(m: HomeModel) {
  const { team } = useTeam();
  const members = useTeamMembersOnly();
  const oo = useOneOnOneMap(team.id);
  const scores = useJudgmentScores(team.id);
  const items = useItems(team.id);
  const obs = useObservations(team.id, undefined, 60);
  const pa = usePeopleActions(team.id, team.is_demo);
  const at = useAttention(team.id);
  const ctx = useMemo(() => attnCtx(at.data ?? []), [at.data]);
  const views = useMemo(() => new Map<string, MemberView>((pa.out?.content.members ?? []).map((v) => [v.user_id, v])), [pa.out]);
  const idx = useMemo(() => {
    const map = new Map<string, MemberIndex>();
    for (const mb of members) {
      map.set(mb.user_id, memberIndex({
        member: mb, raw: m.raw, weekStarts: m.k.weekStarts, lastOoAt: oo.data?.last.get(mb.user_id)?.scheduled_at ?? null,
        scores: scores.data ?? [], items: items.data ?? [], concerns: (obs.data ?? []).filter((o) => o.subject_id === mb.user_id && o.kind === 'concern').length,
        view: views.get(mb.user_id), attn: at.data?.length ? ctx : undefined,
      }));
    }
    return map;
  }, [members, m.raw, m.k.weekStarts, oo.data, scores.data, items.data, obs.data, views, ctx, at.data]);
  return { idx, views, attn: at.data ?? [], oo: oo.data, actions: pa, loading: m.loading || oo.isLoading };
}
