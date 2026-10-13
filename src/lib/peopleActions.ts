// 팀원관리: 주간 AI 액션 추천 + 팀원별 표준 지표(index)
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, errorText } from './supabase';
import { useLatestAi } from './hooks';
import { mondayOf, daysAgo } from './format';
import type { AiOutput, TeamMember, WorkItem } from './types';
import type { Raw } from './insights';
import type { ScoreRow } from './people';
import { useToast } from '../components/ui';

export type ActionType = 'one_on_one' | 'praise' | 'observe' | 'develop' | 'push' | 'support' | 'workload';
export interface PeopleAction { user_id: string; type: ActionType; urgency: number; title: string; why: string; message?: string; opener?: string; request?: string }
export interface MemberView { user_id: string; work_status: 'good' | 'watch' | 'support'; work_view: string; flight_risk: 'low' | 'medium' | 'high'; flight_note?: string }
export interface PeopleActionsOut { summary: string; actions: PeopleAction[]; members?: MemberView[] }

export const ACTION_META: Record<ActionType, { label: string; cls: string; dot: string }> = {
  one_on_one: { label: '1:1 면담', cls: 'bg-teal-50 text-teal-800 ring-teal-200', dot: 'bg-teal-500' },
  praise: { label: '칭찬 배지', cls: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-400' },
  observe: { label: '관찰 기록', cls: 'bg-sky-50 text-sky-800 ring-sky-200', dot: 'bg-sky-500' },
  develop: { label: '육성', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500' },
  push: { label: '업무 독려', cls: 'bg-indigo-50 text-indigo-800 ring-indigo-200', dot: 'bg-indigo-500' },
  support: { label: '지원·격려', cls: 'bg-rose-50 text-rose-800 ring-rose-200', dot: 'bg-rose-500' },
  workload: { label: '업무 조정', cls: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-500' },
};
export const actionKey = (week: string, a: Pick<PeopleAction, 'user_id' | 'type'>) => `${week}:${a.user_id}:${a.type}`;

/** 이번 주(월요일 시작) AI 추천 — 데모 팀은 지난 것도 보여 준다 */
export function usePeopleActions(teamId: string, isDemo?: boolean) {
  const qy = useLatestAi<PeopleActionsOut>(teamId, 'people_actions');
  const week = mondayOf();
  const out = qy.data as AiOutput<PeopleActionsOut> | null | undefined;
  const fresh = !!out && (isDemo || (out.period_start ?? '') >= week);
  return { out: fresh ? out! : null, stale: out && !fresh ? out : null, week: fresh && out?.period_start ? out.period_start : week, loading: qy.isLoading };
}

export function useActionStatus(teamId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const qy = useQuery({
    queryKey: ['people-action-status', teamId],
    queryFn: async () => {
      const { data, error } = await supabase.from('people_action_status').select('action_key, status').eq('team_id', teamId);
      return error ? [] : (data as { action_key: string; status: 'done' | 'skipped' }[]);
    },
  });
  const map = new Map((qy.data ?? []).map((r) => [r.action_key, r.status]));
  const set = useMutation({
    mutationFn: async (p: { key: string; status: 'done' | 'skipped' | null }) => {
      const r = p.status === null
        ? await supabase.from('people_action_status').delete().eq('team_id', teamId).eq('action_key', p.key)
        : await supabase.from('people_action_status').upsert({ team_id: teamId, action_key: p.key, status: p.status, updated_at: new Date().toISOString() });
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people-action-status', teamId] }),
    onError: (e) => toast(errorText(e).includes('people_action_status') ? '팀원관리 액션 테이블이 아직 없습니다. 08_people_work.sql 을 실행해 주세요.' : errorText(e)),
  });
  return { map, set };
}

export function useSendPraise(teamId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (p: { to: string; body: string }) => q(supabase.rpc('send_praise', { p_team: teamId, p_to: p.to, p_body: p.body })),
    onSuccess: () => { toast('칭찬 배지를 보냈습니다. 관찰 기록(칭찬)으로도 남아 평가 근거가 됩니다.'); qc.invalidateQueries({ queryKey: ['obs'] }); qc.invalidateQueries({ queryKey: ['evidence'] }); },
    onError: (e) => toast(errorText(e)),
  });
}

// ---------------------------------------------------------------------
// 팀장 관심(접점) — 최근 28일 1:1(×3) · 리뷰 코멘트 · 관찰·칭찬 · 요청 · 과제 코멘트, 리뷰 응답 시간
// ---------------------------------------------------------------------
export interface AttnRow { user_id: string; oo: number; comments: number; obs: number; praise: number; reqs: number; item_comments: number; touch: number; resp_hours: number | null; waiting: number; last_touch: string | null }
export function useAttention(teamId: string) {
  return useQuery({
    queryKey: ['attention', teamId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('leader_attention', { p_team: teamId, p_days: 28 });
      if (error) return [] as AttnRow[]; // 10_ateam_advice.sql 전: 지수만 비어 보임
      return (data ?? []).map((r: AttnRow) => ({ ...r, touch: Number(r.touch), resp_hours: r.resp_hours == null ? null : Number(r.resp_hours) })) as AttnRow[];
    },
  });
}
const median = (a: number[]) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const h = Math.floor(b.length / 2); return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
export interface AttnCtx { rows: AttnRow[]; median: number; respMedian: number | null }
export const attnCtx = (rows: AttnRow[]): AttnCtx => {
  const r = rows.map((x) => x.resp_hours).filter((x): x is number => x != null);
  return { rows, median: median(rows.map((x) => x.touch)), respMedian: r.length ? median(r) : null };
};
/** 팀 차원: 접점이 1~2명에게 몰림 */
export function attnSkew(rows: AttnRow[]): { top2: number; names: string[] } | null {
  const tot = rows.reduce((a, r) => a + r.touch, 0);
  if (rows.length < 4 || tot < 8) return null;
  const top = [...rows].sort((a, b) => b.touch - a.touch).slice(0, 2);
  const share = (top[0].touch + top[1].touch) / tot;
  return share >= 0.5 ? { top2: Math.round(share * 100), names: top.map((t) => t.user_id) } : null;
}

// ---------------------------------------------------------------------
// 팀원별 표준 지표
// ---------------------------------------------------------------------
export type Level = 'good' | 'watch' | 'risk' | 'none';
export interface Index { key: string; label: string; value: string; sub?: string; level: Level; pct?: number }
export interface MemberIndex { condition: number | null; flight: { score: number; level: Level; label: string; ai?: boolean; note?: string }; indices: Index[] }

export function memberIndex(p: {
  member: TeamMember; raw: Raw | undefined; weekStarts: string[]; lastOoAt?: string | null; scores: ScoreRow[]; items: WorkItem[];
  concerns: number; view?: MemberView; attn?: AttnCtx;
}): MemberIndex {
  const uid = p.member.user_id;
  const series = p.weekStarts.map((w) => (p.raw?.checkins ?? []).find((c) => c.user_id === uid && c.week_start === w)?.condition ?? null);
  const vals = series.filter((v): v is number => v != null);
  const cond = vals.length ? vals[vals.length - 1] : null;
  const prev = vals.length >= 3 ? vals[vals.length - 3] : vals[0] ?? null;
  const flags = new Set((p.raw?.care ?? []).find((c) => c.user_id === uid)?.signals.map((s) => s.type) ?? []);
  const ooDays = p.lastOoAt ? daysAgo(p.lastOoAt) : null;
  // 이탈 가능성: 컨디션 수준·하락 · 1:1 공백 · 반복 막힘 · 체크인 누락 · 우려 관찰
  let score = 0;
  if (cond != null) score += cond <= 2 ? 35 : cond === 3 ? 12 : 0;
  if (cond != null && prev != null && cond < prev) score += 15 + (prev - cond) * 5;
  if (ooDays == null || ooDays > 21) score += 15; else if (ooDays > 14) score += 8;
  if (flags.has('blocked_repeat')) score += 10;
  if (flags.has('checkin_missing')) score += 10;
  score += Math.min(15, p.concerns * 8);
  score = Math.min(100, score);
  const ai = p.view?.flight_risk;
  const lv: Level = ai ? (ai === 'high' ? 'risk' : ai === 'medium' ? 'watch' : 'good') : score >= 55 ? 'risk' : score >= 30 ? 'watch' : 'good';
  const lvLabel = lv === 'risk' ? '높음' : lv === 'watch' ? '주의' : '낮음';
  // 업무 부하: 진행 중 담당 항목의 주당 예상 시간 ÷ 가용 시간
  const mine = p.items.filter((i) => i.owner_id === uid && (i.status === 'active' || i.status === 'blocked'));
  const hours = mine.reduce((a, i) => a + Number(i.est_hours_per_week ?? 0), 0);
  const load = p.member.weekly_hours ? Math.round((hours / p.member.weekly_hours) * 100) : null;
  const sc = p.scores.filter((s) => s.user_id === uid).map((s) => Number(s.score));
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const gNow = avg(sc.slice(-3)), gPrev = avg(sc.slice(-6, -3));
  const dep = (p.raw?.depth ?? []).find((d) => d.user_id === uid);
  // 팀장 관심: 필요도(신규 · 컨디션 하락 · 이탈 주의 · 막힘 반복 · 과부하)가 높을수록 기대 접점을 높게 잡는다
  const ar = p.attn?.rows.find((r) => r.user_id === uid);
  const need = [lv !== 'good', cond != null && cond <= 2, daysAgo(p.member.joined_at) <= 60, flags.has('blocked_repeat'), load != null && load > 110].filter(Boolean).length;
  const expect = (p.attn?.median || 0) * (need >= 2 ? 1.5 : need === 1 ? 1.2 : 1);
  const ratio = ar && expect > 0 ? ar.touch / expect : null;
  const slow = ar?.resp_hours != null && p.attn?.respMedian != null && p.attn.respMedian > 0 && ar.resp_hours >= p.attn.respMedian * 2 && ar.resp_hours >= 48;
  const attnLv: Level = !ar || ratio == null ? 'none' : ratio < 0.5 && need ? 'risk' : ratio < 0.6 || (ratio < 0.8 && (need || slow)) ? 'watch' : 'good';
  const rel = ar && p.attn?.median ? Math.round((ar.touch / p.attn.median) * 10) / 10 : null;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return {
    condition: cond,
    flight: { score, level: lv, label: lvLabel, ai: !!ai, note: p.view?.flight_note },
    indices: [
      { key: 'cond', label: '컨디션', value: cond != null ? `${cond}/5` : '—', sub: cond != null && prev != null && cond !== prev ? `3주 전 ${prev}` : '체크인 기준', level: cond == null ? 'none' : cond <= 2 ? 'risk' : cond === 3 ? 'watch' : 'good', pct: cond != null ? cond * 20 : undefined },
      { key: 'flight', label: '이탈 가능성', value: lvLabel, sub: ai ? 'AI 판단' : `지표 ${score}`, level: lv, pct: ai ? ({ risk: 85, watch: 50, good: 15, none: 0 } as const)[lv] : score },
      { key: 'load', label: '업무 부하', value: load != null ? `${load}%` : '—', sub: `진행 ${mine.length}건 · 주 ${hours}h`, level: load == null ? 'none' : load > 110 ? 'risk' : load > 90 ? 'watch' : 'good', pct: load != null ? Math.min(100, load) : undefined },
      { key: 'growth', label: '성장', value: gNow != null ? `${gNow}/4` : '—', sub: gNow != null && gPrev != null ? `직전 대비 ${sign(Math.round((gNow - gPrev) * 10) / 10)}` : '판단 깊이', level: gNow == null ? 'none' : gPrev != null && gNow - gPrev <= -0.3 ? 'watch' : 'good', pct: gNow != null ? gNow * 25 : undefined },
      { key: 'oo', label: '1:1', value: ooDays == null ? '없음' : ooDays === 0 ? '오늘' : `${ooDays}일 전`, sub: '마지막 면담', level: ooDays == null || ooDays > 21 ? 'risk' : ooDays > 14 ? 'watch' : 'good', pct: ooDays == null ? 100 : Math.min(100, Math.round((ooDays / 28) * 100)) },
      { key: 'attn', label: '팀장 관심', value: !ar ? '—' : attnLv === 'risk' ? '부족' : attnLv === 'watch' ? '적음' : rel != null && rel >= 1.4 ? '많음' : '보통',
        sub: !ar ? '앱 기록 기준' : `접점 ${ar.touch} · 팀 평균의 ${rel ?? '-'}배${need ? ' · 필요도↑' : ''}`, level: attnLv, pct: ratio != null ? Math.min(100, Math.round(ratio * 100)) : undefined },
      { key: 'ev', label: '평가 근거', value: dep ? `${dep.judgment_evidence}건` : '—', sub: dep ? (dep.eligible ? '충분' : '부족') : '', level: !dep ? 'none' : dep.eligible ? 'good' : 'watch', pct: dep ? Math.min(100, dep.judgment_evidence * 8) : undefined },
    ],
  };
}

/** AI 추천이 아직 없을 때 쓰는 규칙 기반 후보 (AI라고 표시하지 않음) */
export function ruleActions(members: TeamMember[], idx: Map<string, MemberIndex>, raw: Raw | undefined): PeopleAction[] {
  const out: PeopleAction[] = [];
  for (const m of members) {
    const ix = idx.get(m.user_id); if (!ix) continue;
    const name = m.profiles?.full_name ?? '팀원';
    const oo = ix.indices.find((i) => i.key === 'oo')!;
    const flags = new Set((raw?.care ?? []).find((c) => c.user_id === m.user_id)?.signals.map((s) => s.type) ?? []);
    if (ix.flight.level === 'risk' || oo.level === 'risk') out.push({ user_id: m.user_id, type: 'one_on_one', urgency: ix.flight.level === 'risk' ? 3 : 2, title: `${name} 님과 1:1`, why: `이탈 가능성 ${ix.flight.label} · 마지막 1:1 ${oo.value}` });
    if (flags.has('blocked_repeat')) out.push({ user_id: m.user_id, type: 'support', urgency: 2, title: `${name} 님 챙기기 — 어려운 점 들어 주기`, why: '막힌 체크인이 반복돼 지쳐 있을 수 있습니다', request: '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 같이 볼게요.' });
    const at = ix.indices.find((i) => i.key === 'attn');
    if (at?.level === 'risk' && oo.level !== 'risk') out.push({ user_id: m.user_id, type: 'one_on_one', urgency: 2, title: `${name} 님에게 시간 더 쓰기`, why: `최근 4주 팀장 접점이 필요도에 비해 적습니다 (${at.sub})`, opener: '요즘 일하면서 제가 더 챙겨 줬으면 하는 게 있어요?' });
    const ev = ix.indices.find((i) => i.key === 'ev')!;
    if (ev.level === 'watch') out.push({ user_id: m.user_id, type: 'observe', urgency: 1, title: `${name} 님 관찰 기록 남기기`, why: `평가 근거 ${ev.value} — 기준에 못 미칩니다` });
  }
  return out.sort((a, b) => b.urgency - a.urgency).slice(0, 8);
}

export const LEVEL_CLS: Record<Level, { bar: string; text: string; ring: string }> = {
  good: { bar: 'bg-emerald-500', text: 'text-emerald-700', ring: 'border-t-emerald-400' },
  watch: { bar: 'bg-amber-400', text: 'text-amber-700', ring: 'border-t-amber-400' },
  risk: { bar: 'bg-rose-500', text: 'text-rose-600', ring: 'border-t-rose-500' },
  none: { bar: 'bg-slate-300', text: 'text-slate-400', ring: 'border-t-slate-200' },
};
