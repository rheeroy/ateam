// 팀원관리: 주간 AI 액션 추천 + 팀원별 표준 지표(index)
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, errorText } from './supabase';
import { useLatestAi } from './hooks';
import { mondayOf, daysAgo, ymd } from './format';
import type { AiOutput, TeamMember, WorkItem } from './types';
import { flagsFor, type Raw } from './insights';
import type { ScoreRow } from './people';
import { useToast } from '../components/ui';
import { readActivity, type ActRead, type ActStat } from './activity';

export type ActionType = 'one_on_one' | 'praise' | 'observe' | 'develop' | 'push' | 'support' | 'workload';
export interface PeopleAction { user_id: string; type: ActionType; urgency: number; title: string; why: string; message?: string; opener?: string; request?: string }
export interface MemberView { user_id: string; work_status: 'good' | 'watch' | 'support'; work_view: string; flight_risk: 'low' | 'medium' | 'high'; flight_note?: string }
export interface PeopleActionsOut { summary: string; actions: PeopleAction[]; members?: MemberView[] }

export const ACTION_META: Record<ActionType, { label: string; cls: string; dot: string }> = {
  one_on_one: { label: '1on1 면담', cls: 'bg-teal-50 text-teal-800 ring-teal-200', dot: 'bg-teal-500' },
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
// 팀장 관심(접점) — 최근 28일 1on1(×3) · 리뷰 코멘트 · 관찰·칭찬 · 요청 · 과제 코멘트, 리뷰 응답 시간
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
export interface MemberIndex { condition: number | null; flight: { score: number; level: Level; label: string; ai?: boolean; note?: string }; indices: Index[]; act?: { stat: ActStat | null; read: ActRead }; load: number | null; flags: string[] }

export function memberIndex(p: {
  member: TeamMember; raw: Raw | undefined; weekStarts: string[]; lastOoAt?: string | null; scores: ScoreRow[]; items: WorkItem[];
  concerns: number; view?: MemberView; attn?: AttnCtx; act?: ActStat | null;
}): MemberIndex {
  const uid = p.member.user_id;
  const series = p.weekStarts.map((w) => (p.raw?.checkins ?? []).find((c) => c.user_id === uid && c.week_start === w)?.condition ?? null);
  const vals = series.filter((v): v is number => v != null);
  const cond = vals.length ? vals[vals.length - 1] : null;
  const prev = vals.length >= 3 ? vals[vals.length - 3] : vals[0] ?? null;
  const flags = new Set((p.raw?.care ?? []).find((c) => c.user_id === uid)?.signals.map((s) => s.type) ?? []);
  const ooDays = p.lastOoAt ? daysAgo(p.lastOoAt) : null;
  // 이탈 가능성 — 쉽게 뜨면 안 된다. 컨디션 몇 주 나빠진 것만으로는 오르지 않고(그건 '컨디션' 지표가 맡는다),
  //   장기간(8주 안팎) 서로 다른 영역의 리스크가 겹치거나, 팀장이 직접 남긴 큰 사건(우려 관찰)이 다른 신호와 함께 있을 때만 '주의' · '높음'
  //   영역: ① 컨디션 장기 저하(8주 중 4주 이상 2 이하) ② 참여 위축(공유 끊김 · 활동 급감) ③ 바꿀 수 있는 동인 2개 이상 겹침(막힘 · 인정 공백 · 성장 정체 · 약속 밀림)
  //         ④ 관계 공백(1on1 6주 넘게 없음) ⑤ 큰 사건(팀장이 남긴 우려 관찰)
  //   합류 8주 미만 · 컨디션 기록 4주 미만이면 판단을 보류한다
  const mf = p.raw ? flagsFor(p.raw, uid) : [];
  const has = (k: string) => mf.some((f) => f.key === k);
  const since8 = ymd(new Date(Date.now() - 56 * 86400000));
  const long = (p.raw?.checkins ?? []).filter((c) => c.user_id === uid && c.condition != null && c.week_start >= since8);
  const lowWeeks = long.filter((c) => (c.condition ?? 5) <= 2).length;
  const actDrop = (p.act?.change ?? 0) <= -0.5 && (p.act?.base ?? 0) >= 3;
  const drivers = (['frustrated', 'recog_gap', 'growth_stall', 'promise_late'] as const).filter(has);
  const domains: string[] = [];
  if (long.length >= 4 && lowWeeks >= 4) domains.push(`컨디션 장기 저하(8주 중 ${lowWeeks}주 2 이하)`);
  if (has('withdrawn') || actDrop) domains.push(has('withdrawn') ? '참여 위축(컨디션 공유 끊김)' : '활동 급감(4주 전 대비 절반 이하)');
  if (drivers.length >= 2) domains.push(`동인 겹침(${mf.filter((f) => (drivers as readonly string[]).includes(f.key)).map((f) => f.label).join(' · ')})`);
  if (ooDays == null ? daysAgo(p.member.joined_at) > 42 : ooDays > 42) domains.push(ooDays == null ? '1on1 기록 없음' : `1on1 ${ooDays}일 공백`);
  const event = p.concerns > 0;
  if (event) domains.push(`팀장이 남긴 우려 관찰 ${p.concerns}건`);
  const tooEarly = daysAgo(p.member.joined_at) < 56 || (long.length < 4 && !event);
  const ruleLv: Level = tooEarly ? 'none'
    : domains.length >= 3 || (p.concerns >= 2 && domains.length >= 2) ? 'risk'
    : domains.length >= 2 ? 'watch' : 'good';
  const score = Math.min(100, domains.length * 20);
  // AI 판단은 규칙보다 높게 올리지 못한다 (기록이 겹치지 않았는데 '높음'이 뜨지 않게)
  const ai = p.view?.flight_risk;
  const aiLv: Level | null = ai ? (ai === 'high' ? 'risk' : ai === 'medium' ? 'watch' : 'good') : null;
  const rank: Record<Level, number> = { none: -1, good: 0, watch: 1, risk: 2 };
  const lv: Level = ruleLv === 'none' ? 'none' : aiLv && rank[aiLv] < rank[ruleLv] ? aiLv : ruleLv;
  const lvLabel = lv === 'none' ? '판단 보류' : lv === 'risk' ? '높음' : lv === 'watch' ? '주의' : '낮음';
  const flagNote = lv === 'none' ? (daysAgo(p.member.joined_at) < 56 ? '합류 8주 전에는 판단하지 않습니다' : '컨디션 기록이 4주 이상 쌓이면 판단합니다')
    : domains.length ? `겹친 신호 ${domains.length}개: ${domains.join(' · ')}` : undefined;
  // 업무 부하: 진행 중 담당 항목의 주당 예상 시간 ÷ 가용 시간
  const mine = p.items.filter((i) => i.owner_id === uid && (i.status === 'active' || i.status === 'blocked'));
  const hours = mine.reduce((a, i) => a + Number(i.est_hours_per_week ?? 0), 0);
  const load = p.member.weekly_hours ? Math.round((hours / p.member.weekly_hours) * 100) : null;
  // 활동: 같은 사람의 지난 4주와 비교 + 부하 · 컨디션과 엮어 읽기
  const read = readActivity(p.act ?? null, { load, cond, condPrev: prev, checkinGap: flags.has('checkin_missing'), newbie: daysAgo(p.member.joined_at) <= 45 });
  const sa = p.act ?? null;
  const actLv: Level = read.tone === 'none' ? 'none' : read.tone;
  const sc = p.scores.filter((s) => s.user_id === uid).map((s) => Number(s.score));
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const gNow = avg(sc.slice(-3)), gPrev = avg(sc.slice(-6, -3));
  const dep = (p.raw?.depth ?? []).find((d) => d.user_id === uid);
  // 팀장 관심: 필요도(신규 · 컨디션 하락 · 이탈 주의 · 막힘 반복 · 과부하)가 높을수록 기대 접점을 높게 잡는다
  const ar = p.attn?.rows.find((r) => r.user_id === uid);
  const need = [lv === 'watch' || lv === 'risk', cond != null && cond <= 2, daysAgo(p.member.joined_at) <= 60, flags.has('blocked_repeat'), load != null && load > 110].filter(Boolean).length;
  const expect = (p.attn?.median || 0) * (need >= 2 ? 1.5 : need === 1 ? 1.2 : 1);
  const ratio = ar && expect > 0 ? ar.touch / expect : null;
  const slow = ar?.resp_hours != null && p.attn?.respMedian != null && p.attn.respMedian > 0 && ar.resp_hours >= p.attn.respMedian * 2 && ar.resp_hours >= 48;
  const attnLv: Level = !ar || ratio == null ? 'none' : ratio < 0.5 && need ? 'risk' : ratio < 0.6 || (ratio < 0.8 && (need || slow)) ? 'watch' : 'good';
  const rel = ar && p.attn?.median ? Math.round((ar.touch / p.attn.median) * 10) / 10 : null;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return {
    condition: cond, load, flags: [...flags], act: { stat: sa, read },
    flight: { score, level: lv, label: lvLabel, ai: !!ai && lv !== 'none', note: lv !== 'none' && aiLv && lv === aiLv && p.view?.flight_note ? p.view.flight_note : flagNote },
    indices: [
      { key: 'cond', label: '컨디션', value: cond != null ? `${cond}/5` : '—', sub: cond != null && prev != null && cond !== prev ? `3주 전 ${prev}` : '컨디션 공유 기준', level: cond == null ? 'none' : cond <= 2 ? 'risk' : cond === 3 ? 'watch' : 'good', pct: cond != null ? cond * 20 : undefined },
      { key: 'flight', label: '이탈 가능성', value: lvLabel, sub: lv === 'none' ? '장기 기록 기준' : `겹친 신호 ${domains.length}/5 · 8주 기준`, level: lv, pct: lv === 'none' ? undefined : score },
      { key: 'load', label: '업무 부하', value: load != null ? `${load}%` : '—', sub: `${load == null ? '' : load <= 90 ? '여유 · ' : load <= 110 ? '가끔 몰림 · ' : load <= 130 ? '종종 시간외 · ' : '상시 시간외 · '}진행 ${mine.length}건 · 주 ${hours}h`, level: load == null ? 'none' : load > 110 ? 'risk' : load > 90 ? 'watch' : 'good', pct: load != null ? Math.min(100, load) : undefined },
      { key: 'act', label: '활동', value: sa && read.key !== 'none' ? read.label : '—', sub: read.key === 'none' || !sa ? '업무 기록 기준' : `주 ${sa.recent}건${sa.change != null && Math.abs(sa.change) >= 0.2 ? ` · 4주 전 대비 ${sa.change > 0 ? '+' : ''}${Math.round(sa.change * 100)}%` : sa.rel != null ? ` · 팀의 ${sa.rel}배` : ''}${sa.offShare >= 0.2 ? ` · 밤·주말 ${Math.round(sa.offShare * 100)}%` : ''}`,
        level: actLv, pct: sa?.rel != null ? Math.min(100, Math.round(sa.rel * 50)) : undefined },
      { key: 'growth', label: '성장', value: gNow != null ? `${gNow}/4` : '—', sub: gNow != null && gPrev != null ? `직전 대비 ${sign(Math.round((gNow - gPrev) * 10) / 10)}` : '판단 깊이', level: gNow == null ? 'none' : gPrev != null && gNow - gPrev <= -0.3 ? 'watch' : 'good', pct: gNow != null ? gNow * 25 : undefined },
      { key: 'oo', label: '1on1', value: ooDays == null ? '없음' : ooDays === 0 ? '오늘' : `${ooDays}일 전`, sub: '마지막 면담', level: ooDays == null || ooDays > 21 ? 'risk' : ooDays > 14 ? 'watch' : 'good', pct: ooDays == null ? 100 : Math.min(100, Math.round((ooDays / 28) * 100)) },
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
    if (ix.flight.level === 'risk' || oo.level === 'risk') out.push({ user_id: m.user_id, type: 'one_on_one', urgency: ix.flight.level === 'risk' ? 3 : 2, title: `${name} 님과 1on1`, why: `이탈 가능성 ${ix.flight.label} · 마지막 1on1 ${oo.value}` });
    if (flags.has('blocked_repeat')) out.push({ user_id: m.user_id, type: 'support', urgency: 2, title: `${name} 님 챙기기 — 어려운 점 들어 주기`, why: '컨디션 공유에 막힌 일이 반복돼 지쳐 있을 수 있습니다', request: '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 같이 볼게요.' });
    const at = ix.indices.find((i) => i.key === 'attn');
    if (at?.level === 'risk' && oo.level !== 'risk') out.push({ user_id: m.user_id, type: 'one_on_one', urgency: 2, title: `${name} 님에게 시간 더 쓰기`, why: `최근 4주 팀장 접점이 필요도에 비해 적습니다 (${at.sub})`, opener: '요즘 일하면서 제가 더 챙겨 줬으면 하는 게 있어요?' });
    // 활동 판단 — 판정하지 않고 먼저 묻는 행동으로
    const rd = ix.act?.read;
    if (rd?.key === 'overload') out.push({ user_id: m.user_id, type: 'support', urgency: 3, title: `${name} 님 일 덜어 주기 — 이번 주 하지 않아도 되는 일 함께 고르기`, why: rd.why, request: '요즘 일이 많이 몰려 있는 것 같아요. 이번 주에 미루거나 넘겨도 되는 일을 같이 골라 봐요.' });
    else if (rd?.key === 'motivation' && oo.level !== 'risk') out.push({ user_id: m.user_id, type: 'one_on_one', urgency: 3, title: `${name} 님과 짧게 근황 나누기`, why: rd.why, opener: '요즘 일하면서 에너지가 빠지는 순간이 있다면 언제예요?' });
    else if (rd?.key === 'drop') out.push({ user_id: m.user_id, type: 'one_on_one', urgency: 2, title: `${name} 님 요즘 흐름 물어보기`, why: rd.why, opener: '요즘 맡은 일 중에 막혀 있거나 기다리는 게 있어요?' });
    else if (rd?.key === 'slack') out.push({ user_id: m.user_id, type: 'develop', urgency: 1, title: `${name} 님께 새 역할 · 기회 제안하기`, why: rd.why, request: '다음에 맡아 보고 싶은 일이 있으면 알려 줘요. 지금 하는 일과 이어서 해 볼 만한 걸 같이 정해 봐요.' });
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
