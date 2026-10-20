// A·Team의 제안 — 주간 운영 컨설팅 (6개 운영 레버)
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Globe2, HeartHandshake, Rocket, Settings2, UserRound } from 'lucide-react';
import { supabase, errorText } from './supabase';
import { useLatestAi } from './hooks';
import { mondayOf } from './format';
import type { AiOutput } from './types';
import { useToast } from '../components/ui';

export type Lever = 'exec' | 'staffing' | 'people' | 'external' | 'self' | 'system';
export type LeverState = 'good' | 'watch' | 'act';
export type Route = 'decide' | 'request' | 'one_on_one' | 'report' | 'calendar' | 'none';
export interface Advice {
  id: string; lever: Lever; urgency: number; effort: 'low' | 'mid' | 'high'; title: string; why: string; effect?: string; if_not?: string;
  route: Route; target_user_id?: string; script?: string;
}
export interface AdviceReview { id: string; title: string; verdict: 'done' | 'partial' | 'not_done' | 'unknown'; observed: string }
export interface AdvisorOut {
  headline: string; focus?: string; levers: Partial<Record<Lever, { state: LeverState; note: string }>>;
  advice: Advice[]; review?: AdviceReview[]; watch_next?: string;
  perspective?: Perspective;
}
/** 한 걸음 물러서 보기 — 미시 처방과 별도로, 큰 그림 · 다른 관점 · 작은 실험 하나씩 (렌즈는 매주 바뀜) */
export interface Perspective {
  big?: { lens: string; text: string; why?: string };
  reframe?: { lens: string; text: string; why?: string };
  experiment?: { title: string; how: string; check?: string };
  question?: string;
}

export const LEVERS: { key: Lever; label: string; hint: string; icon: typeof Rocket }[] = [
  { key: 'exec', label: '실행·우선순위', hint: '업무 푸시 · 우선순위 · 범위', icon: Rocket },
  { key: 'staffing', label: '인력 운영', hint: '재배분 · 백업 · 충원·채용', icon: Briefcase },
  { key: 'people', label: '사람·팀 분위기', hint: '1on1 리듬 · 인정 · 육성 · 팀 의례', icon: HeartHandshake },
  { key: 'external', label: '외부·전사', hint: '외부 변수 · 전사 방침 · 상향 보고', icon: Globe2 },
  { key: 'self', label: '팀장 자신', hint: '시간 배분 · 위임 · 에너지', icon: UserRound },
  { key: 'system', label: '운영 체계', hint: '회의·보고 리듬 · 작성 기준', icon: Settings2 },
];
export const LEVER_OF = Object.fromEntries(LEVERS.map((l) => [l.key, l])) as Record<Lever, (typeof LEVERS)[number]>;
export const STATE_META: Record<LeverState, { label: string; cls: string; dot: string; bar: string }> = {
  good: { label: '이상 없음', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', bar: 'border-t-emerald-400' },
  watch: { label: '주의', cls: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-400', bar: 'border-t-amber-400' },
  act: { label: '조치 필요', cls: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500', bar: 'border-t-rose-500' },
};
export const VERDICT: Record<AdviceReview['verdict'], { label: string; cls: string }> = {
  done: { label: '실행됨', cls: 'bg-emerald-50 text-emerald-700' },
  partial: { label: '일부', cls: 'bg-amber-50 text-amber-800' },
  not_done: { label: '안 됨', cls: 'bg-rose-50 text-rose-700' },
  unknown: { label: '확인 불가', cls: 'bg-slate-100 text-slate-600' },
};
export type AdviceStatus = 'adopted' | 'held' | 'done';
export const STATUS_LABEL: Record<AdviceStatus, string> = { adopted: '채택', held: '보류', done: '완료' };
export const EFFORT_LABEL = { low: '가벼움', mid: '보통', high: '큼' } as const;

/** 이번 주 제안 (데모 팀은 최근 것) + 지난주 제안 */
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
/** AI 출력이 일부 빠져 와도(길이 제한 등) 화면이 깨지지 않게 모양을 맞춘다 */
export function normalizeAdvisor(c: unknown): AdvisorOut {
  const o = (c && typeof c === 'object' ? c : {}) as Partial<AdvisorOut>;
  return {
    headline: typeof o.headline === 'string' ? o.headline : '',
    focus: o.focus, watch_next: o.watch_next,
    levers: o.levers && typeof o.levers === 'object' ? o.levers : {},
    advice: arr<Advice>(o.advice).filter((a) => a && a.title).map((a, i) => ({ ...a, id: a.id || `a${i + 1}`, lever: a.lever || 'exec', urgency: Number(a.urgency) || 1, effort: a.effort || 'mid', route: a.route || 'none', why: a.why || '' })),
    review: arr<AdviceReview>(o.review).filter((r) => r && r.title),
    perspective: o.perspective && typeof o.perspective === 'object' && (o.perspective.big || o.perspective.reframe || o.perspective.experiment) ? o.perspective : undefined,
  };
}
const fix = (o: AiOutput<AdvisorOut> | null | undefined) => (o ? { ...o, content: normalizeAdvisor(o.content) } : o);

export function useAdvisor(teamId: string, isDemo?: boolean) {
  const week = mondayOf();
  const cur = useLatestAi<AdvisorOut>(teamId, 'advisor_weekly');
  const out = fix(cur.data as AiOutput<AdvisorOut> | null | undefined);
  const fresh = !!out && (isDemo || (out.period_start ?? '') >= week);
  const prev = useQuery({
    queryKey: ['ai', teamId, 'advisor_prev', out?.period_start ?? week], enabled: !cur.isLoading,
    queryFn: async () => {
      const { data } = await supabase.from('ai_outputs').select('*').eq('team_id', teamId).eq('kind', 'advisor_weekly').lt('period_start', out?.period_start ?? week)
        .order('period_start', { ascending: false }).limit(1).maybeSingle();
      return fix(data as AiOutput<AdvisorOut> | null) ?? null;
    },
  });
  return { out: fresh ? out! : null, stale: out && !fresh ? out : null, prev: prev.data ?? null, week: fresh && out?.period_start ? out.period_start : week, loading: cur.isLoading };
}

export const adviceKey = (week: string, id: string) => `${week}:${id}`;
export function useAdviceStatus(teamId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const qy = useQuery({
    queryKey: ['advice-status', teamId],
    queryFn: async () => {
      const { data, error } = await supabase.from('advice_status').select('advice_key, status').eq('team_id', teamId);
      return error ? [] : (data as { advice_key: string; status: AdviceStatus }[]);
    },
  });
  const map = new Map((qy.data ?? []).map((r) => [r.advice_key, r.status]));
  const set = useMutation({
    mutationFn: async (p: { key: string; status: AdviceStatus | null }) => {
      const r = p.status === null
        ? await supabase.from('advice_status').delete().eq('team_id', teamId).eq('advice_key', p.key)
        : await supabase.from('advice_status').upsert({ team_id: teamId, advice_key: p.key, status: p.status, updated_at: new Date().toISOString() });
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['advice-status', teamId] }),
    onError: (e) => toast(errorText(e).includes('advice_status') ? '제안 상태 테이블이 아직 없습니다. 10_ateam_advice.sql 을 실행해 주세요.' : errorText(e)),
  });
  return { map, set };
}

export interface SelfCheck { week_start: string; energy: number | null; burden: number | null; note: string | null }
export function useSelfCheck(teamId: string, uid: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const week = mondayOf();
  const qy = useQuery({
    queryKey: ['selfcheck', teamId, uid],
    queryFn: async () => {
      const { data, error } = await supabase.from('leader_selfcheck').select('week_start, energy, burden, note').eq('team_id', teamId).eq('user_id', uid).order('week_start', { ascending: false }).limit(6);
      return error ? [] : (data as SelfCheck[]);
    },
  });
  const save = useMutation({
    mutationFn: async (p: { energy: number | null; burden: number | null; note: string }) => {
      const { error } = await supabase.from('leader_selfcheck').upsert({ team_id: teamId, user_id: uid, week_start: week, ...p, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['selfcheck', teamId, uid] }); toast('이번 주 상태를 남겼습니다. 다음 제안에 반영됩니다.'); },
    onError: (e) => toast(errorText(e).includes('leader_selfcheck') ? '셀프 체크 테이블이 아직 없습니다. 10_ateam_advice.sql 을 실행해 주세요.' : errorText(e)),
  });
  const rows = qy.data ?? [];
  return { rows, current: rows.find((r) => r.week_start === week) ?? null, week, save };
}
