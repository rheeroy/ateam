// 목표·과제(work_items) 데이터 계층: 조회 · 트리 · 저장 · AI 변경안 반영
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, errorText } from './supabase';
import type { ItemMeasure, ItemStatus, TeamMember, WorkItem } from './types';
import { useToast } from '../components/ui';
import { useTeam } from '../state/session';

export const STATUS_META: Record<ItemStatus, { label: string; tone: 'slate' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet' }> = {
  proposed: { label: '검토 대기', tone: 'violet' },
  changes_requested: { label: '수정 요청', tone: 'amber' },
  active: { label: '진행', tone: 'indigo' },
  blocked: { label: '막힘', tone: 'rose' },
  done: { label: '완료', tone: 'emerald' },
  dropped: { label: '중단', tone: 'slate' },
};
export const MEASURE_META: Record<ItemMeasure, { label: string; hint: string }> = {
  children: { label: '하위 항목 기준', hint: '아래 항목들의 진척으로 자동 계산' },
  check: { label: '완료 체크', hint: '끝났는지만 체크' },
  percent: { label: '퍼센트', hint: '진척률을 직접 입력' },
  number: { label: '숫자 목표', hint: '현재값 / 목표값 (예: 리드 120 / 500건)' },
  recurring: { label: '정기 업무', hint: '매주·매달 해야 하는 일 (기한 준수율)' },
  stage: { label: '단계 (정성)', hint: '정해 둔 단계 중 어디까지 왔는지 (예: 착수 › 초안 › 검증 › 확정)' },
};

export const DEFAULT_LEVELS = ['목표', '과제', '할 일'];
export function useLevelNames() {
  const { team } = useTeam();
  const l = (team.settings?.level_names as string[] | undefined) ?? DEFAULT_LEVELS;
  return (depth: number) => l[Math.min(depth, l.length - 1)] ?? '항목';
}

export interface Node extends WorkItem { depth: number; children: Node[]; path: string[] }

export function buildTree(items: WorkItem[]): { roots: Node[]; byId: Map<string, Node> } {
  const byId = new Map<string, Node>();
  for (const it of items) byId.set(it.id, { ...it, depth: 0, children: [], path: [] });
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const p = n.parent_id ? byId.get(n.parent_id) : null;
    if (p) p.children.push(n); else roots.push(n);
  }
  const sortRec = (arr: Node[], depth: number, path: string[]) => {
    arr.sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
    for (const n of arr) { n.depth = depth; n.path = path; sortRec(n.children, depth + 1, [...path, n.id]); }
  };
  sortRec(roots, 0, []);
  return { roots, byId };
}

/** 트리를 화면 순서대로 편다 (접힌 항목의 자식은 뺀다) */
export function flatten(roots: Node[], collapsed: Set<string>, keep?: (n: Node) => boolean): Node[] {
  const out: Node[] = [];
  const walk = (arr: Node[]) => {
    for (const n of arr) {
      if (keep && !keep(n)) continue;
      out.push(n);
      if (!collapsed.has(n.id)) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

export const ITEMS_KEY = (teamId: string) => ['items', teamId];

export function useItems(teamId: string) {
  return useQuery({
    queryKey: ITEMS_KEY(teamId),
    queryFn: () => q<WorkItem[]>(supabase.from('work_items').select('*').eq('team_id', teamId).order('sort').order('created_at')),
  });
}

/** 낙관적 업데이트로 즉시 반영하는 저장 훅 */
export function useItemMutations(teamId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ITEMS_KEY(teamId);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['home-insights'] });
    qc.invalidateQueries({ queryKey: ['goal-outlook'] });
  };
  const patchCache = (id: string, patch: Partial<WorkItem>) =>
    qc.setQueryData<WorkItem[]>(key, (old) => old?.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<WorkItem> & { change_reason?: string | null } }) =>
      q<WorkItem>(supabase.from('work_items').update(patch).eq('id', id).select().single()),
    onMutate: ({ id, patch }) => { const { change_reason: _r, ...rest } = patch; void _r; patchCache(id, rest); },
    onSuccess: (row) => { patchCache(row.id, row); refresh(); },
    onError: (e) => { toast(errorText(e)); refresh(); },
  });
  const create = useMutation({
    mutationFn: (row: Partial<WorkItem>) => q<WorkItem>(supabase.from('work_items').insert({ team_id: teamId, ...row }).select().single()),
    onSuccess: (row) => { qc.setQueryData<WorkItem[]>(key, (old) => [...(old ?? []), row]); refresh(); },
    onError: (e) => toast(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => q(supabase.from('work_items').delete().eq('id', id)),
    onMutate: (id) => qc.setQueryData<WorkItem[]>(key, (old) => old?.filter((x) => x.id !== id)),
    onSuccess: refresh,
    onError: (e) => { toast(errorText(e)); refresh(); },
  });
  return { update, create, remove, refresh };
}

/** 같은 부모 안에서 a와 b 사이 정렬값 */
export function sortBetween(prev?: number, next?: number) {
  if (prev == null && next == null) return 1000;
  if (prev == null) return next! - 1000;
  if (next == null) return prev + 1000;
  return (prev + next) / 2;
}

export function measureText(n: WorkItem) {
  if (n.measure === 'number') { const f = (v: number | null) => (v == null ? '-' : v.toLocaleString('ko-KR')); return `${f(n.num_current ?? 0)}${n.unit} / ${f(n.num_target)}${n.unit}`; }
  if (n.measure === 'check') return n.status === 'done' ? '완료' : '미완료';
  if (n.measure === 'recurring') return `${n.recur === 'weekly' ? '매주' : '매달'} · 준수 ${n.progress}%`;
  if (n.measure === 'stage') return n.stage_current ? `${(n.stages ?? [])[n.stage_current - 1] ?? `${n.stage_current}단계`} (${n.stage_current}/${n.stages?.length ?? '-'})` : '시작 전';
  return `${n.progress}%`;
}

export function slipDays(n: WorkItem): number | null {
  if (!n.base_due || !n.due_date) return null;
  return Math.round((Date.parse(n.due_date) - Date.parse(n.base_due)) / 86400000);
}

export const isOverdue = (n: WorkItem) => !!n.due_date && n.status !== 'done' && n.status !== 'dropped' && n.due_date < new Date().toISOString().slice(0, 10);

// ---------- AI 변경안 ----------
export interface PlanOp {
  op: 'add' | 'update' | 'move' | 'delete';
  ref?: string; id?: string; parent?: string | null;
  title?: string; note?: string; owner?: string; measure?: ItemMeasure; start_date?: string | null; due_date?: string | null;
  num_target?: number | null; unit?: string; recur?: 'weekly' | 'monthly' | null; role?: 'goal' | 'metric' | 'task'; stages?: string[];
  set?: Record<string, unknown>; reason?: string;
}

const MEASURES: ItemMeasure[] = ['check', 'children', 'percent', 'number', 'recurring', 'stage'];
const STATUSES = ['active', 'blocked', 'done', 'dropped'];
const dateOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function ownerIdOf(name: string | undefined, members: TeamMember[]): string | null | undefined {
  if (name === undefined) return undefined;
  if (!name) return null;
  const m = members.find((x) => x.profiles?.full_name === name) ?? members.find((x) => (x.profiles?.full_name ?? '').includes(name) || name.includes(x.profiles?.full_name ?? '@@'));
  return m?.user_id ?? null;
}

/** 수락한 변경안을 순서대로 반영한다. 추가 → 수정 → 이동 → 중단 */
export async function applyOps(teamId: string, ops: PlanOp[], members: TeamMember[], opts: { asMember?: string; fallbackParent?: string | null; rootYear?: number } = {}) {
  const refMap = new Map<string, string>();
  const resolve = (p: string | null | undefined) => (p == null ? opts.fallbackParent ?? null : refMap.get(p) ?? p);
  let sort = Date.now() / 1000;
  const errors: string[] = [];
  const adds = ops.filter((o) => o.op === 'add');
  // 부모가 먼저 만들어지도록 (ref 의존 순서)
  const pending = [...adds];
  for (let guard = 0; pending.length && guard < 200; guard++) {
    const i = pending.findIndex((o) => !o.parent || !adds.some((a) => a.ref === o.parent) || refMap.has(o.parent));
    const o = pending.splice(i < 0 ? 0 : i, 1)[0];
    const owner = opts.asMember ?? ownerIdOf(o.owner, members) ?? null;
    const { data, error } = await supabase.from('work_items').insert({
      team_id: teamId, parent_id: resolve(o.parent), title: String(o.title ?? '').slice(0, 200) || '새 항목', note: o.note ?? '',
      owner_id: owner, measure: MEASURES.includes(o.measure as ItemMeasure) ? o.measure : 'percent',
      ...(() => {
        // 다른 연도 판에서 만든 최상위 항목은 그 해에 속하도록 시작일을 그 해로 (날짜가 없을 때만)
        const top = resolve(o.parent) == null;
        const sd = dateOrNull(o.start_date), dd = dateOrNull(o.due_date);
        if (top && opts.rootYear && opts.rootYear !== new Date().getFullYear() && !sd && !dd) return { start_date: `${opts.rootYear}-01-01`, due_date: `${opts.rootYear}-12-31` };
        return { start_date: sd, due_date: dd };
      })(),
      num_target: typeof o.num_target === 'number' ? o.num_target : null, unit: o.unit ?? '',
      ...(o.role === 'metric' || o.role === 'task' ? { role: o.role } : {}),
      ...(Array.isArray(o.stages) && o.stages.length ? { stages: o.stages.map(String).slice(0, 8) } : {}),
      recur: o.recur === 'weekly' || o.recur === 'monthly' ? o.recur : null, sort: sort++,
    }).select('id').single();
    if (error) errors.push(`${o.title}: ${errorText(error)}`);
    else if (o.ref) refMap.set(o.ref, data.id);
  }
  for (const o of ops.filter((x) => x.op === 'update' && x.id)) {
    const s = o.set ?? {};
    const patch: Record<string, unknown> = { change_reason: o.reason ? `AI 수정 · ${o.reason}`.slice(0, 200) : 'AI 수정' };
    if (typeof s.title === 'string') patch.title = s.title;
    if (typeof s.note === 'string') patch.note = s.note;
    if ('owner' in s) patch.owner_id = ownerIdOf(String(s.owner ?? ''), members);
    if ('start_date' in s) patch.start_date = dateOrNull(s.start_date);
    if ('due_date' in s) patch.due_date = dateOrNull(s.due_date);
    if (typeof s.status === 'string' && STATUSES.includes(s.status)) patch.status = s.status;
    if (typeof s.measure === 'string' && MEASURES.includes(s.measure as ItemMeasure)) patch.measure = s.measure;
    if (typeof s.num_target === 'number') patch.num_target = s.num_target;
    if (typeof s.progress === 'number') patch.progress = Math.max(0, Math.min(100, Math.round(s.progress)));
    if (typeof s.priority === 'number') patch.priority = Math.max(1, Math.min(3, Math.round(s.priority)));
    if (typeof s.contribution === 'number') patch.contribution = Math.max(1, Math.min(5, Math.round(s.contribution)));
    const { error } = await supabase.from('work_items').update(patch).eq('id', o.id!);
    if (error) errors.push(errorText(error));
  }
  for (const o of ops.filter((x) => x.op === 'move' && x.id)) {
    const { error } = await supabase.from('work_items').update({ parent_id: resolve(o.parent ?? null), sort: sort++ }).eq('id', o.id!);
    if (error) errors.push(errorText(error));
  }
  for (const o of ops.filter((x) => x.op === 'delete' && x.id)) {
    const { error } = await supabase.from('work_items').update({ status: 'dropped', change_reason: o.reason ?? 'AI 수정' }).eq('id', o.id!);
    if (error) errors.push(errorText(error));
  }
  return errors;
}

// ---------- 팀원 목표 수정 (켜기·끄기) ----------
// 목표·과제(1·2단계)는 팀장이 '팀원 수정'을 켜 둔 동안만 팀원이 고친다(승인 후 반영). 꺼지면 검토 중인 제안도 잠긴다.
// 할 일(3단계~)은 내 과제 아래에서 언제든. 진척·상태는 승인된 항목이면 항상. DB 트리거와 같은 규칙.
const PENDING = ['proposed', 'changes_requested'];

/** 팀원 수정 여부는 팀장이 다른 화면에서 바꾸므로 세션 값이 아니라 매번 새로 읽는다 */
export function usePlanWindow() {
  const { team } = useTeam();
  const qy = useQuery({
    queryKey: ['plan-window', team.id],
    queryFn: () => q<{ settings: Record<string, unknown> }>(supabase.from('teams').select('settings').eq('id', team.id).single()),
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 60_000,
  });
  return { open: !!(qy.data?.settings ?? team.settings)?.plan_open };
}

export function usePlanRules() {
  const { uid, isLeader } = useTeam();
  const { open } = usePlanWindow();
  return {
    open,
    /** 제목·설명·일정·목표값 등 계획 자체 */
    canEditPlan: (n: Pick<Node, 'depth' | 'owner_id' | 'status'>) => isLeader || (n.owner_id === uid && (n.depth >= 2 || open)),
    /** 진척·상태 (검토 중인 목표·과제는 기간이 열려 있을 때만) */
    canProgress: (n: Pick<Node, 'depth' | 'owner_id' | 'status'>) => isLeader || (n.owner_id === uid && (n.depth >= 2 || open || !PENDING.includes(n.status))),
    canAddUnder: (p: Node | null) => isLeader || (p ? (p.depth >= 1 ? p.owner_id === uid : open) : open),
    canDelete: (n: Node) => isLeader || (n.owner_id === uid && (n.depth >= 2 || (open && PENDING.includes(n.status) && !n.baselined_at))),
    /** 팀원이 목표·과제 계획을 고치면 다시 승인 대기로 */
    reapproves: (n: Pick<Node, 'depth' | 'status'>) => !isLeader && n.depth < 2 && ['active', 'blocked', 'changes_requested'].includes(n.status),
  };
}
