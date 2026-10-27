// AUTOPILOT (자율주행) — 실행 · 진행 확인 · 결과 · 보내기/되돌리기 · 설정
//   설정은 teams.settings.autopilot = { mode: 'direct' | 'semi' | 'auto', allow: { [type]: boolean } }
//   모드는 '다음 실행부터' 적용 — 실행할 때의 모드가 autopilot_runs.mode 에 남는다
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, invoke, errorText } from './supabase';
import { useToast } from '../components/ui';

export type ApMode = 'direct' | 'semi' | 'auto';
export type ApType = 'praise' | 'cheer' | 'progress' | 'rework' | 'push' | 'thread' | 'grow' | 'plan' | 'oo' | 'memo';

/** 액션 종류 — 이름 · 팀원이 받는 곳 · 반자동 추천값 (서버 ai-autopilot 의 SEMI_DEFAULT 와 같게) */
export const AP_TYPES: Record<ApType, { label: string; to: string; semi: boolean; cls: string }> = {
  praise: { label: '칭찬 배지', to: '매니징 보드 › Feedback', semi: true, cls: 'bg-amber-100 text-amber-800' },
  cheer: { label: '지원·격려', to: '매니징 보드 › Feedback', semi: true, cls: 'bg-rose-100 text-rose-700' },
  progress: { label: '진척 공유 · 성과입력 리마인드', to: '업무플랫폼 › 요청 카드', semi: true, cls: 'bg-sky-100 text-sky-700' },
  rework: { label: '보완 요청 리마인드', to: '해당 결과물 스레드', semi: true, cls: 'bg-orange-100 text-orange-800' },
  push: { label: '업무 독려', to: '매니징 보드 › 팀장님 액션', semi: true, cls: 'bg-blue-100 text-blue-700' },
  thread: { label: '결과물 스레드 피드백', to: '해당 결과물 스레드', semi: false, cls: 'bg-slate-200 text-slate-700' },
  grow: { label: '육성 제안', to: '매니징 보드 › Feedback', semi: false, cls: 'bg-emerald-100 text-emerald-700' },
  plan: { label: '계획 세워 달라는 요청', to: '업무플랫폼 › 요청 카드', semi: false, cls: 'bg-violet-100 text-violet-700' },
  oo: { label: '1on1 요청', to: '매니징 보드 › 1on1', semi: false, cls: 'bg-teal-100 text-teal-700' },
  memo: { label: '관찰 메모 기록', to: '팀장님만 봄 (평가 근거)', semi: true, cls: 'bg-slate-100 text-slate-600' },
};
export const AP_TYPE_KEYS = Object.keys(AP_TYPES) as ApType[];
export const SEMI_DEFAULT = Object.fromEntries(AP_TYPE_KEYS.map((k) => [k, AP_TYPES[k].semi])) as Record<ApType, boolean>;
export const MODE_LABEL: Record<ApMode, string> = { direct: '직접', semi: '반자동', auto: '완전 자동' };

export const KEY_QUESTIONS = [
  '지금 하지 않으면 크리티컬한 일은?',
  '현재 팀의 병목과 원인은?',
  '우선순위는 높은데 리소스가 적은 곳은?',
  '이대로 가면 이번 분기 목표 달성은?',
  '사람관리에서 놓치거나 챙길 것은?',
  '이렇게 해보세요',
  '한 걸음 물러서서, 관점 바꾸기',
];

export interface ApSettings { mode: ApMode; allow: Record<ApType, boolean> }
export function autopilotOf(settings: Record<string, unknown> | undefined): ApSettings {
  const a = (settings?.autopilot ?? {}) as { mode?: string; allow?: Partial<Record<ApType, boolean>> };
  const mode: ApMode = a.mode === 'auto' || a.mode === 'semi' ? a.mode : 'direct';
  return { mode, allow: { ...SEMI_DEFAULT, ...(a.allow ?? {}) } };
}
/** 실행할 때 이 액션이 바로 나가는지 */
export const allowedIn = (s: ApSettings, t: ApType) => (s.mode === 'auto' ? true : s.mode === 'direct' ? false : !!s.allow[t]);

export interface ApDiag { text: string; level?: string; tag?: string }
export interface ApTodo { text: string; link?: string; label?: string }
export interface ApSection { diagnosis: ApDiag[]; note?: string; todos: ApTodo[]; action_keys: string[] }
export interface ApAction {
  key: string; section: string; type: ApType; member_id: string; item_id: string | null; submission_id: string | null;
  message: string; sensitive: string; item_title?: string | null; submission_title?: string | null;
}
export interface ApOutput {
  headline: string;
  sections: Record<'critical' | 'bottleneck' | 'resource' | 'people', ApSection>;
  forecast: {
    quarter_end: string;
    goals: { goal_id: string; title: string; progress: number; plan_now: number | null; plan_q: number | null; base: number; risk: number; exec: number; note: string }[];
    risks: { title: string; likelihood?: string; impact?: string; detail?: string }[];
    lever: { text: string; goal_id: string | null } | null;
    todos: ApTodo[];
  };
  solutions: { title: string; why?: string; effect?: string; link?: string; label?: string }[];
  perspective: { text?: string; sources?: string } | null;
  actions: ApAction[];
  sources: { tag: string; type: string; id: string | null; label: string }[];
  counts?: { signals: number; members: number };
}
export interface ApActState { status: 'sent' | 'skip'; ref_table?: string; ref_id?: string; at: string; auto?: boolean; body?: string }
export interface ApRun {
  id: string; team_id: string; leader_id: string; mode: ApMode; allow: Record<ApType, boolean>; status: 'running' | 'done' | 'failed';
  step: number; output: ApOutput | null; actions: Record<string, ApActState>; error: string | null; created_at: string; finished_at: string | null;
}
export interface ApQuota { limit: number; used: number; remaining: number; trial: boolean; resets_at: string | null }

export const LINKS: Record<string, string> = { goals: '/goals', work: '/work', people: '/people', upward: '/upward', decide: '/decide', knowhow: '/knowhow' };
export const stripTags = (t?: string) => (t ?? '').replace(/\s*\[E\d+(?:\s*,\s*E\d+)*\]/g, '');

export function useApQuota(teamId: string) {
  return useQuery({ queryKey: ['autopilot', teamId, 'quota'], queryFn: () => q<ApQuota>(supabase.rpc('autopilot_quota', { p_team: teamId })), staleTime: 30_000, retry: false });
}
export function useApRuns(teamId: string) {
  return useQuery({
    queryKey: ['autopilot', teamId, 'runs'],
    queryFn: () => q<Pick<ApRun, 'id' | 'mode' | 'status' | 'created_at' | 'actions'>[]>(supabase.from('autopilot_runs').select('id, mode, status, created_at, actions').eq('team_id', teamId).order('created_at', { ascending: false }).limit(20)),
    retry: false,
  });
}
/** 실행 하나 — 진행 중이면 2초마다 다시 읽는다 */
export function useApRun(id: string | null | undefined) {
  return useQuery({
    queryKey: ['autopilot', 'run', id], enabled: !!id,
    queryFn: () => q<ApRun>(supabase.from('autopilot_runs').select('*').eq('id', id!).single()),
    refetchInterval: (qr) => (qr.state.data?.status === 'running' ? 2000 : false),
  });
}

export function useStartAutopilot(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<{ run_id: string; status: string }>('ai-autopilot', { team_id: teamId }),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['autopilot', teamId] }); },
  });
}

export function useApAct(runId: string, teamId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const done = () => { qc.invalidateQueries({ queryKey: ['autopilot', 'run', runId] }); qc.invalidateQueries({ queryKey: ['autopilot', teamId, 'runs'] }); qc.invalidateQueries({ queryKey: ['requests'] }); qc.invalidateQueries({ queryKey: ['obs'] }); };
  const send = useMutation({
    mutationFn: (p: { key: string; body?: string }) => q(supabase.rpc('autopilot_send', { p_run: runId, p_key: p.key, p_body: p.body ?? null, p_auto: false })),
    onSuccess: () => { done(); toast('보냈습니다. 10분 안에는 되돌릴 수 있습니다.'); }, onError: (e) => toast(errorText(e)),
  });
  const undo = useMutation({
    mutationFn: (key: string) => q(supabase.rpc('autopilot_undo', { p_run: runId, p_key: key })),
    onSuccess: () => { done(); toast('되돌렸습니다. 팀원 화면에서도 사라집니다.'); }, onError: (e) => toast(errorText(e)),
  });
  const mark = useMutation({
    mutationFn: (p: { key: string; status: 'skip' | 'wait' }) => q(supabase.rpc('autopilot_mark', { p_run: runId, p_key: p.key, p_status: p.status })),
    onSuccess: done, onError: (e) => toast(errorText(e)),
  });
  return { send, undo, mark };
}

/** 서버에서 autopilot 키만 바꾼다 (다른 설정을 덮어쓰지 않게) */
export async function saveApSettings(teamId: string, s: ApSettings) {
  await q(supabase.rpc('autopilot_save_settings', { p_team: teamId, p_settings: s }));
}

/** 실행 시작을 화면 어디서든 알린다 (플로팅 버튼이 받아 로딩 바를 띄움) */
export const AP_EVENT = 'ateam:autopilot-run';
