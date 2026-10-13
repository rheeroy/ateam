// 팀 신호 엔진 (규칙·모델 기반) — 브라우저(홈 화면)와 Edge Function(AI 인사이트)이 같이 쓴다.
// 외부 의존 없이 순수 TypeScript. 숫자는 SQL 모델 값을 그대로 쓰고, 규칙에 걸린 것만 '신호'로 만든다.
// AI 인사이트는 이 신호들을 '사실'로 받아 엮고 해석한다.

export type Domain = 'goal' | 'exec' | 'people' | 'output' | 'growth' | 'org';
/** 신호가 속하는 홈 섹션: 내가 할 일(대기열) · 의사결정 · 팀 성과 · 사람 · 조직·전사 (리스크 섹션은 여러 섹션의 위험 신호를 모아 보여 준다) */
export type HomeSection = 'todo' | 'decide' | 'perf' | 'people' | 'org';
export const SECTION_NAME: Record<HomeSection, string> = { todo: '내가 할 일', decide: '의사결정', perf: '팀 성과', people: '팀원관리', org: '조직·전사' };
export type SignalType = 'risk' | 'missed' | 'forecast' | 'pattern' | 'good' | 'data';
export type Period = 'daily' | 'weekly' | 'monthly';
export type Status = 'good' | 'watch' | 'risk' | 'unknown';

export interface Signal {
  id: string;
  domain: Domain;
  type: SignalType;
  severity: 1 | 2 | 3;
  periods: Period[];
  title: string;
  detail?: string;
  rule: string;
  action?: { label: string; to?: string; memo?: string | null };
}
export interface DomainSummary {
  domain: Domain; status: Status; kpi: string; kpiLabel: string; line: string;
  confidence: 0 | 1 | 2 | 3; confidenceNote: string; to: string; period: string;
}

export const DOMAIN_META: Record<Domain, { name: string; desc: string; period: string }> = {
  goal: { name: '목표·실적', desc: '목표 달성 가능성과 실적 전망', period: '월간 전망' },
  exec: { name: '실행·과제', desc: '계획 대비 지연·막힘·시간 배분', period: '주간 진척' },
  people: { name: '사람·컨디션', desc: '컨디션 추세, 1:1 간격, 체크인', period: '주간 추세' },
  output: { name: '결과물·리뷰', desc: '리뷰 대기와 재작업 패턴', period: '주간 흐름' },
  growth: { name: '육성·평가', desc: '평가 근거와 성장 신호', period: '월간 궤적' },
  org: { name: '조직·전사', desc: '상위 방향·요청·전사 일정', period: '수시' },
};

/** 신호가 홈의 어느 섹션에 들어가는지. 팀장이 처리할 대기열(승인·리뷰·요청·약속·상위 요청 마감)은 '내가 할 일', 돌아볼 결정은 '의사결정' */
const TODO_IDS = ['exec-proposed-', 'out-aged-', 'req-late-', 'promise-late-', 'org-req-'];
export function sectionOf(s: Pick<Signal, 'id' | 'domain'>): HomeSection {
  if (TODO_IDS.some((p) => s.id.startsWith(p))) return 'todo';
  if (s.id.startsWith('decide-')) return 'decide';
  if (s.domain === 'goal' || s.domain === 'exec') return 'perf';
  if (s.domain === 'org') return 'org';
  return 'people';
}
export const TYPE_LABEL: Record<SignalType, string> = {
  risk: '리스크', missed: '놓친 것', forecast: '전망', pattern: '패턴', good: '좋은 신호', data: '데이터 보강',
};
export const PERIOD_LABEL: Record<Period, string> = { daily: '오늘', weekly: '이번 주', monthly: '이번 달' };

// ---------- 입력 ----------
export interface RawMember { user_id: string; name: string; role: 'leader' | 'member' }
export interface RawItem {
  id: string; parent_id: string | null; owner_id: string | null; title: string; status: string; measure: string;
  progress: number; start_date: string | null; due_date: string | null; base_due: string | null; replan_count: number;
  recur: string | null; needs_plan: boolean; updated_at: string; created_at: string; est_hours_per_week: number | null;
}
export interface Raw {
  goals: { goal_id: string; title: string; progress: number; probability: number | null; basis: string; blocked: number; task_count: number }[] | null;
  forecasts: { metric_id: string; name: string; unit: string; target: number | null; insufficient: boolean; months_of_data: number;
    base?: number; low?: number; high?: number; probability?: number | null; item_id: string | null }[];
  items: RawItem[];
  schedule: { item_id: string; title: string; owner_id: string | null; slip_days: number | null; replan_count: number; projected_delay: number | null; projected_done: string | null; due_date: string | null }[] | null;
  portfolio: { task_id: string; title: string; mission_contribution: number; hours: number; share_pct: number | null }[] | null;
  care: { user_id: string; full_name: string; signals: { type: string; label: string; detail?: string }[] }[] | null;
  checkins: { user_id: string; week_start: string; condition: number | null }[];
  subs: { id: string; author_id: string; status: string; created_at: string; submission_versions: { version: number; created_at: string }[] }[];
  depth: { user_id: string; full_name: string; judgment_evidence: number; eligible: boolean }[] | null;
  perf: { user_id: string; full_name: string; x: number; y: number; prev_x: number; prev_y: number; withheld: boolean }[] | null;
  level: { level: number; levels: { level: number; name: string; conditions: { label: string; current: number; target: number; unit?: string }[] }[]; totals: { metric_months: number } } | null;
  obs: { subject_id: string }[];
  requests: { id: string; to_id: string; title: string; kind: string; due_date: string | null; created_at: string; status: string }[];
  recurringLogs: { item_id: string; period: string; done: boolean | null }[];
  latePromises: number;
  minEvidence: number;
  orgNotes: { id: string; kind: string; title: string; event_date: string | null; status: string; created_at: string }[];
  orgImpacts: string[]; // 영향 분석이 끝난 메모 id
  decisionsDue: { id: string; title: string; decided_at: string; review_on: string | null }[];
}

// ---------- 날짜 (한국 시간 기준) ----------
const KST = 9 * 3600000;
export const kstToday = (now = Date.now()) => new Date(now + KST).toISOString().slice(0, 10);
export const addDaysYmd = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const kstMonday = (now = Date.now()) => {
  const d = new Date(now + KST); const dow = (d.getUTCDay() + 6) % 7;
  return addDaysYmd(d.toISOString().slice(0, 10), -dow);
};
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);

// ---------- 불러오기 (supabase-js 클라이언트면 무엇이든: 브라우저 / service_role) ----------
// deno-lint-ignore no-explicit-any
type Client = any;
async function safe<T>(p: PromiseLike<{ data: unknown; error: unknown }>, fallback: T): Promise<T> {
  try { const { data, error } = await p; return error ? fallback : ((data ?? fallback) as T); } catch { return fallback; }
}

export async function loadRaw(db: Client, teamId: string, leaderId: string, minEvidence: number): Promise<Raw> {
  const mon = kstMonday();
  const since60 = new Date(Date.now() - 60 * 86400000).toISOString();
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [goals, metrics, items, schedule, portfolio, care, checkins, subs, depth, perf, level, obs, requests, late, rlogs, orgNotes, orgImpacts, decisionsDue] = await Promise.all([
    safe<Raw['goals']>(db.rpc('goal_outlook', { p_team: teamId }), null),
    safe<{ id: string; item_id: string | null }[]>(db.from('metrics').select('id, item_id').eq('team_id', teamId).not('target', 'is', null).order('created_at').limit(4), []),
    safe<RawItem[]>(db.from('work_items').select('id, parent_id, owner_id, title, status, measure, progress, start_date, due_date, base_due, replan_count, recur, needs_plan, updated_at, created_at, est_hours_per_week').eq('team_id', teamId).neq('status', 'dropped'), []),
    safe<Raw['schedule']>(db.rpc('item_schedule', { p_team: teamId }), null),
    safe<Raw['portfolio']>(db.rpc('task_portfolio', { p_team: teamId }), null),
    safe<Raw['care']>(db.rpc('care_radar', { p_team: teamId }), null),
    safe<Raw['checkins']>(db.from('checkins').select('user_id, week_start, condition').eq('team_id', teamId).gte('week_start', addDaysYmd(mon, -35)), []),
    safe<Raw['subs']>(db.from('submissions').select('id, author_id, status, created_at, submission_versions(version, created_at)').eq('team_id', teamId).gte('updated_at', since60), []),
    safe<Raw['depth']>(db.rpc('member_data_depth', { p_team: teamId }), null),
    safe<Raw['perf']>(db.rpc('team_performance_map', { p_team: teamId }), null),
    safe<Raw['level']>(db.rpc('team_insight_level', { p_team: teamId }), null),
    safe<Raw['obs']>(db.from('observations').select('subject_id').eq('team_id', teamId).gte('created_at', since30), []),
    safe<Raw['requests']>(db.from('team_requests').select('id, to_id, title, kind, due_date, created_at, status').eq('team_id', teamId).eq('from_id', leaderId).eq('status', 'open'), []),
    safe<{ id: string }[]>(db.from('action_items').select('id').eq('team_id', teamId).eq('owner_id', leaderId).is('done_at', null).lt('due_date', kstToday()), []),
    safe<Raw['recurringLogs']>(db.from('work_item_logs').select('item_id, period, done').eq('team_id', teamId).eq('kind', 'recurring').gte('period', addDaysYmd(kstToday(), -100)), []),
    safe<Raw['orgNotes']>(db.from('org_notes').select('id, kind, title, event_date, status, created_at').eq('team_id', teamId).eq('status', 'open').order('created_at', { ascending: false }).limit(40), []),
    safe<{ ref_id: string }[]>(db.from('ai_outputs').select('ref_id').eq('team_id', teamId).eq('kind', 'org_impact').gte('created_at', since60), []),
    safe<Raw['decisionsDue']>(db.from('decisions').select('id, title, decided_at, review_on').eq('team_id', teamId).is('outcome', null).order('decided_at').limit(20), []),
  ]);
  const forecasts = (await Promise.all(metrics.map(async (m) => {
    const f = await safe<Raw['forecasts'][number] | null>(db.rpc('metric_forecast', { p_metric: m.id }), null);
    return f ? { ...f, item_id: m.item_id } : null;
  }))).filter(Boolean) as Raw['forecasts'];
  // 지난 해에 끝난 목표(연도별 기록)는 올해 판단에서 뺀다 — 목표의 연도 = 시작일(없으면 마감·생성) 연도
  const thisYear = Number(kstToday().slice(0, 4));
  const pastIds = new Set<string>();
  const kids = new Map<string, string[]>();
  for (const it of items) if (it.parent_id) kids.set(it.parent_id, [...(kids.get(it.parent_id) ?? []), it.id]);
  for (const it of items) {
    if (it.parent_id || it.status !== 'done') continue;
    if (Number((it.start_date ?? it.due_date ?? it.created_at).slice(0, 4)) >= thisYear) continue;
    const stack = [it.id];
    while (stack.length) { const id = stack.pop()!; pastIds.add(id); stack.push(...(kids.get(id) ?? [])); }
  }
  if (pastIds.size) {
    const keep = items.filter((it) => !pastIds.has(it.id));
    items.length = 0; items.push(...keep);
  }
  const goalsNow = goals ? goals.filter((g) => !pastIds.has(g.goal_id)) : goals;
  return { goals: goalsNow, forecasts, items, schedule, portfolio, care, checkins, subs, depth, perf, level, obs, requests,
    recurringLogs: rlogs, latePromises: late.length, minEvidence, orgNotes, orgImpacts: orgImpacts.map((o) => o.ref_id), decisionsDue };
}

// ---------- 분석 ----------
const fmtN = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('ko-KR') : String(Math.round(n * 10) / 10));
const names = (arr: string[], max = 3) => arr.slice(0, max).join(', ') + (arr.length > max ? ` 외 ${arr.length - max}명` : '');
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const D: Period[] = ['daily']; const W: Period[] = ['weekly']; const M: Period[] = ['monthly'];
const DW: Period[] = ['daily', 'weekly']; const WM: Period[] = ['weekly', 'monthly']; const ALL: Period[] = ['daily', 'weekly', 'monthly'];

export function analyze(raw: Raw, members: RawMember[]): { signals: Signal[]; domains: DomainSummary[] } {
  const S: Signal[] = [];
  const today = kstToday();
  const mem = members.filter((m) => m.role === 'member');
  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.name ?? '미지정';
  const nMem = mem.length;
  const items = raw.items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const hasChildren = new Set(items.filter((i) => i.parent_id).map((i) => i.parent_id!));

  // ---------------- 목표·실적 ----------------
  const goals = raw.goals ?? [];
  const probs = goals.filter((g) => g.probability != null).map((g) => g.probability!);
  for (const g of goals) {
    if (g.probability == null || g.basis === 'metric') continue;
    if (g.probability < 50) S.push({
      id: `goal-risk-${g.goal_id}`, domain: 'goal', type: 'risk', severity: g.probability < 35 ? 3 : 2, periods: WM,
      title: `'${g.title}' 달성 가능성 ${g.probability}%`,
      detail: `일정 대비 진척 ${g.progress}%${g.blocked ? ` · 막힌 하위 항목 ${g.blocked}건` : ''}로 본 전망입니다.`,
      rule: '하위 항목의 일정 대비 진척(스케줄 지수)', action: { label: '무엇을 바꾸면 되는지 시뮬레이션', to: '/sim' },
    });
  }
  for (const f of raw.forecasts) {
    if (f.insufficient) {
      S.push({ id: `metric-data-${f.metric_id}`, domain: 'goal', type: 'data', severity: 1, periods: M,
        title: `'${f.name}' 실적이 ${f.months_of_data}개월치뿐이라 전망을 낼 수 없습니다`,
        detail: '월 실적을 2개월 이상 넣으면 기말 전망과 달성 확률이 계산됩니다.', rule: '실적 데이터 2개월 미만', action: { label: '실적 입력하기', to: '/perf' } });
    } else if (f.base != null && f.target != null) {
      const gap = f.base - f.target; const p = f.probability ?? null;
      const goal = goals.find((g) => g.goal_id === f.item_id);
      S.push({
        id: `metric-fc-${f.metric_id}`, domain: 'goal', type: p != null && p < 50 ? 'risk' : 'forecast',
        severity: p != null && p < 35 ? 3 : p != null && p < 50 ? 2 : 1, periods: WM,
        title: p != null && p < 50 && goal ? `'${goal.title}' 달성 가능성 ${p}% — ${f.name} 기말 전망 ${fmtN(f.base)}${f.unit} (목표 ${fmtN(f.target)}${f.unit})`
          : `${goal ? `'${goal.title}' · ` : ''}${f.name} 기말 전망 ${fmtN(f.base)}${f.unit} (목표 ${fmtN(f.target)}${f.unit})`,
        detail: `${gap >= 0 ? '목표보다 ' + fmtN(gap) + f.unit + ' 많을' : '목표에 ' + fmtN(-gap) + f.unit + ' 못 미칠'} 것으로 보입니다. 80% 범위 ${fmtN(f.low ?? 0)}~${fmtN(f.high ?? 0)}${f.unit}${p != null ? ` · 달성 확률 ${p}%` : ''}.`,
        rule: '최근 3개월 런레이트 + 진행 중 딜 가중합, 변동성으로 범위 계산',
        action: p != null && p < 50 ? { label: '무엇을 바꾸면 되는지 시뮬레이션', to: '/sim' } : { label: '전망 자세히', to: '/perf' },
      });
    }
  }
  if (!goals.length) S.push({ id: 'goal-none', domain: 'goal', type: 'data', severity: 1, periods: ALL,
    title: '목표가 없어 달성 전망을 볼 수 없습니다', detail: '계획서를 넣으면 AI가 목표·과제 초안을 만들어 드립니다.', rule: '최상위 항목 0개', action: { label: '목표 세우기', to: '/goals' } });
  const goalLow = probs.length ? Math.min(...probs) : null;

  // ---------------- 실행·과제 ----------------
  const work = items.filter((i) => i.parent_id && ['active', 'blocked'].includes(i.status));
  const leaves = work.filter((i) => !hasChildren.has(i.id));
  const overdue = leaves.filter((t) => t.due_date && t.due_date < today);
  const blocked = work.filter((t) => t.status === 'blocked');
  const stale = leaves.filter((t) => t.measure !== 'recurring' && t.measure !== 'check' && daysSince(t.updated_at) >= 14);
  const proposed = items.filter((i) => i.status === 'proposed');
  const changes = items.filter((i) => i.status === 'changes_requested' && daysSince(i.updated_at) >= 5);
  const needsPlan = items.filter((i) => i.needs_plan && !hasChildren.has(i.id) && daysSince(i.updated_at) >= 3);
  const sched = raw.schedule ?? [];
  const delayed = sched.filter((r) => (r.projected_delay ?? 0) >= 7 && byId.get(r.item_id)?.status !== 'done');
  const replanned = sched.filter((r) => r.replan_count >= 2 || (r.slip_days ?? 0) >= 14);

  if (proposed.length) S.push({ id: `exec-proposed-${proposed.length}-${proposed[0].id.slice(0, 6)}`, domain: 'exec', type: 'missed', severity: proposed.some((p) => daysSince(p.updated_at) >= 3) ? 2 : 1, periods: DW,
    title: `팀원이 올린 계획 ${proposed.length}건이 검토를 기다립니다`, detail: proposed.slice(0, 3).map((p) => `${p.title}(${nameOf(p.owner_id)})`).join(' · '),
    rule: "상태가 '제안'인 항목", action: { label: '검토하기', to: '/goals/edit?filter=proposed' } });
  if (overdue.length) S.push({ id: `exec-overdue-${overdue.length}`, domain: 'exec', type: 'risk', severity: overdue.length >= 3 ? 3 : 2, periods: DW,
    title: `기한 지난 항목 ${overdue.length}건`, detail: overdue.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)}, ${t.due_date!.slice(5).replace('-', '/')})`).join(' · '),
    rule: '마감일이 지났는데 완료되지 않은 항목', action: { label: '항목 보기', to: '/goals/edit?filter=overdue' } });
  if (blocked.length) S.push({ id: `exec-blocked-${blocked.map((t) => t.id.slice(0, 4)).join('')}`, domain: 'exec', type: 'risk', severity: 2, periods: DW,
    title: `막힌 항목 ${blocked.length}건 — 팀장이 풀어 줄 수 있는지 확인`, detail: blocked.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)})`).join(' · '),
    rule: "상태가 '막힘'", action: { label: '항목 보기', to: '/goals/edit?filter=blocked' } });
  for (const r of delayed.slice(0, 3)) S.push({ id: `exec-delay-${r.item_id}`, domain: 'exec', type: 'forecast', severity: (r.projected_delay ?? 0) >= 14 ? 3 : 2, periods: W,
    title: `'${r.title}' 이 속도면 마감보다 ${r.projected_delay}일 늦어집니다`,
    detail: `최근 3주 진척 속도로 계산한 예상 완료일 ${r.projected_done?.slice(5).replace('-', '/')} (마감 ${r.due_date?.slice(5).replace('-', '/')}) · 담당 ${nameOf(r.owner_id)}`,
    rule: '최근 21일 진척 기록의 기울기로 남은 진척을 나눈 예상 완료일', action: { label: '항목 보기', to: `/goals?item=${r.item_id}` } });
  if (replanned.length) S.push({ id: `exec-replan-${replanned.length}`, domain: 'exec', type: 'pattern', severity: 2, periods: WM,
    title: `계획이 반복해서 밀리는 항목 ${replanned.length}건`, detail: replanned.slice(0, 3).map((r) => `${r.title}(일정 변경 ${r.replan_count}회${r.slip_days ? `, 처음 계획보다 ${r.slip_days}일` : ''})`).join(' · '),
    rule: '일정 변경 2회 이상 또는 처음 계획 대비 14일 이상 지연', action: { label: '계획 대비 보기', to: '/goals/edit?view=timeline' } });
  if (stale.length) S.push({ id: `exec-stale-${stale.length}`, domain: 'exec', type: 'missed', severity: 1, periods: W,
    title: `2주 넘게 진척 업데이트가 없는 항목 ${stale.length}건`, detail: stale.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)})`).join(' · '),
    rule: '진행 중 항목의 마지막 수정이 14일 전', action: { label: '진척 요청 보내기', to: '/goals/edit?filter=stale' } });
  if (needsPlan.length) S.push({ id: `exec-needsplan-${needsPlan.length}`, domain: 'exec', type: 'missed', severity: 1, periods: W,
    title: `하위 계획을 요청했는데 아직 비어 있는 항목 ${needsPlan.length}건`, detail: needsPlan.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)})`).join(' · '),
    rule: '계획 요청 후 3일 이상 하위 항목 없음', action: { label: '항목 보기', to: '/goals' } });
  if (changes.length) S.push({ id: `exec-changes-${changes.length}`, domain: 'exec', type: 'missed', severity: 1, periods: W,
    title: `수정 요청 후 5일 넘게 그대로인 계획 ${changes.length}건`, detail: changes.slice(0, 3).map((t) => `${t.title}(${nameOf(t.owner_id)})`).join(' · '),
    rule: "상태 '수정 요청'으로 5일 경과", action: { label: '항목 보기', to: '/goals/edit?filter=changes' } });
  // 정기 업무: 지난 기간 누락
  const recurring = items.filter((i) => i.measure === 'recurring' && i.status === 'active');
  for (const r of recurring) {
    const logs = raw.recurringLogs.filter((l) => l.item_id === r.id).sort((a, b) => b.period.localeCompare(a.period));
    if (logs[0] && logs[0].done === false) S.push({ id: `exec-recur-${r.id}-${logs[0].period}`, domain: 'exec', type: 'risk', severity: 2, periods: WM,
      title: `정기 업무 '${r.title}' 지난 ${r.recur === 'weekly' ? '주' : '달'} 기한을 못 지켰습니다`,
      detail: `최근 ${logs.length}회 중 ${logs.filter((l) => l.done).length}회 완료 · 담당 ${nameOf(r.owner_id)}`, rule: '정기 업무 기록의 최근 기간 미완료', action: { label: '항목 보기', to: `/goals?item=${r.id}` } });
  }
  // 요청: 답이 없는 요청
  const lateReq = raw.requests.filter((q) => (q.due_date && q.due_date < today) || daysSince(q.created_at) >= 5);
  if (lateReq.length) S.push({ id: `req-late-${lateReq.length}`, domain: 'exec', type: 'missed', severity: 1, periods: D,
    title: `팀원에게 보낸 요청 ${lateReq.length}건이 아직 답이 없습니다`, detail: lateReq.slice(0, 3).map((q) => `${q.title}(${nameOf(q.to_id)})`).join(' · '),
    rule: '기한이 지났거나 5일 넘게 열린 요청', action: { label: '요청 보기', to: '/people?tab=requests' } });

  const pf = raw.portfolio ?? [];
  const lowShare = pf.filter((r) => r.mission_contribution <= 2).reduce((a, r) => a + (r.share_pct ?? 0), 0);
  if (lowShare >= 25) S.push({ id: 'exec-lowvalue', domain: 'exec', type: 'pattern', severity: 2, periods: M,
    title: `기여도가 낮은 과제에 팀 시간 ${Math.round(lowShare)}%가 들어가고 있습니다`,
    detail: '기여도 1~2인 과제를 줄이거나 넘기면 핵심 목표에 쓸 시간이 생깁니다.', rule: '시간 포트폴리오: 기여도 ≤ 2 항목의 시간 비중 25% 이상', action: { label: '포트폴리오 보기', to: '/goals/edit?view=table' } });
  const byOwner = new Map<string, number>();
  leaves.forEach((t) => t.owner_id && byOwner.set(t.owner_id, (byOwner.get(t.owner_id) ?? 0) + 1));
  const top = [...byOwner.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && leaves.length >= 6 && nMem >= 3 && top[1] / leaves.length >= 0.4) S.push({ id: `exec-conc-${top[0]}`, domain: 'exec', type: 'pattern', severity: 2, periods: M,
    title: `일이 ${nameOf(top[0])}님에게 몰려 있습니다 (${top[1]}건, 진행 항목의 ${Math.round((top[1] / leaves.length) * 100)}%)`,
    detail: '한 사람이 막히면 팀 전체 일정이 밀립니다. 재배분을 검토해 보세요.', rule: '한 명이 진행 중인 말단 항목의 40% 이상 담당', action: { label: '시뮬레이션', to: '/sim' } });
  const noOwner = work.filter((t) => !t.owner_id);
  if (noOwner.length) S.push({ id: `exec-noowner-${noOwner.length}`, domain: 'exec', type: 'data', severity: 1, periods: M,
    title: `담당자가 없는 항목 ${noOwner.length}건`, detail: noOwner.slice(0, 3).map((t) => t.title).join(' · '), rule: '진행 중인데 담당자 미지정', action: { label: '항목 보기', to: '/goals' } });
  const noEffort = pf.filter((r) => !r.hours).length;
  if (pf.length >= 3 && noEffort / pf.length > 0.5) S.push({ id: 'exec-effort-data', domain: 'exec', type: 'data', severity: 1, periods: M,
    title: `과제 ${pf.length}건 중 ${noEffort}건에 주당 투입 시간이 없습니다`,
    detail: '투입 시간을 넣으면 시간 배분·충원 시뮬레이션이 정확해집니다.', rule: '공수 입력률 50% 미만', action: { label: '표에서 입력', to: '/goals/edit?view=table' } });

  // ---------------- 사람·컨디션 ----------------
  const noOO: string[] = []; const missing: string[] = [];
  for (const r of raw.care ?? []) for (const s of r.signals) {
    if (s.type === 'condition_down') S.push({ id: `care-cond-${r.user_id}`, domain: 'people', type: 'risk', severity: 3, periods: DW,
      title: `${r.full_name}님 컨디션이 3주 연속 떨어졌습니다 (${s.label.replace('컨디션 ', '')})`, detail: '번아웃·이탈 신호일 수 있습니다. 이번 주 안에 1:1을 권합니다.',
      rule: '체크인 컨디션 3주 연속 하락, 최근 값 3 이하', action: { label: '1:1 잡기', to: `/one-on-ones?new=${r.user_id}` } });
    if (s.type === 'blocked_repeat') S.push({ id: `care-block-${r.user_id}`, domain: 'people', type: 'risk', severity: 2, periods: DW,
      title: `${r.full_name}님이 2주째 같은 문제로 막혀 있습니다`, detail: s.detail ? `"${s.detail}"` : undefined,
      rule: '체크인 막힘 항목 2주 연속', action: { label: '1:1 잡기', to: `/one-on-ones?new=${r.user_id}` } });
    if (s.type === 'no_one_on_one') noOO.push(r.full_name);
    if (s.type === 'checkin_missing') missing.push(r.full_name);
  }
  if (noOO.length) S.push({ id: `care-oo-${noOO.length}`, domain: 'people', type: 'missed', severity: 2, periods: W,
    title: `1:1을 2주 넘게 안 한 팀원 ${noOO.length}명`, detail: names(noOO), rule: '마지막 완료 1:1이 14일 전', action: { label: '1:1 잡기', to: '/people?tab=1on1&new=1' } });
  const thisMon = kstMonday();
  if (missing.length) S.push({ id: `care-ci-${thisMon}`, domain: 'people', type: 'data', severity: 1, periods: DW,
    title: `이번 주 체크인을 안 낸 팀원 ${missing.length}명`, detail: `${names(missing)} — 체크인이 빠지면 컨디션·막힘 신호를 놓칩니다.`, rule: '수요일 이후 이번 주 체크인 없음', action: { label: '체크인 요청 보내기', to: '/people?tab=requests' } });
  const condOf = (pred: (w: string) => boolean) => raw.checkins.filter((c) => pred(c.week_start) && c.condition != null).map((c) => c.condition!);
  const thisWeek = condOf((w) => w >= thisMon);
  const lastMon = addDaysYmd(thisMon, -7);
  const curC = avg(thisWeek.length >= 2 ? thisWeek : condOf((w) => w === lastMon));
  const priorC = avg(thisWeek.length >= 2 ? condOf((w) => w < thisMon) : condOf((w) => w < lastMon));
  if (curC != null && priorC != null) {
    const d = curC - priorC;
    if (d <= -0.4) S.push({ id: `people-cond-down-${thisMon}`, domain: 'people', type: 'pattern', severity: 2, periods: WM,
      title: `팀 평균 컨디션이 ${priorC.toFixed(1)} → ${curC.toFixed(1)}로 내려갔습니다`, detail: '특정 프로젝트·일정 압박이 겹친 시기인지 확인해 보세요.', rule: '최근 주 평균 vs 직전 4주 평균, 0.4 이상 하락' });
    if (d >= 0.4) S.push({ id: `people-cond-up-${thisMon}`, domain: 'people', type: 'good', severity: 1, periods: WM,
      title: `팀 평균 컨디션이 ${priorC.toFixed(1)} → ${curC.toFixed(1)}로 올라갔습니다`, rule: '최근 주 평균 vs 직전 4주 평균, 0.4 이상 상승' });
  }
  if (raw.latePromises) S.push({ id: `promise-late-${raw.latePromises}`, domain: 'people', type: 'missed', severity: 2, periods: D,
    title: `팀원에게 한 약속 ${raw.latePromises}건이 기한을 넘겼습니다`, detail: '팀장의 약속이 밀리면 1:1 신뢰가 가장 먼저 떨어집니다.', rule: '1:1에서 정한 팀장 할 일, 기한 경과', action: { label: '약속 보기', to: '#today' } });
  const ciThis = new Set(raw.checkins.filter((c) => c.week_start >= thisMon).map((c) => c.user_id)).size;
  const ciLast = new Set(raw.checkins.filter((c) => c.week_start === lastMon).map((c) => c.user_id)).size;
  const ciWeeks = new Set(raw.checkins.map((c) => c.week_start)).size;

  // ---------------- 결과물·리뷰 ----------------
  const inReview = raw.subs.filter((s) => s.status === 'in_review');
  const waitDays = (s: Raw['subs'][number]) => daysSince(s.submission_versions.reduce((a, v) => (v.created_at > a ? v.created_at : a), s.created_at));
  const aged = inReview.filter((s) => waitDays(s) >= 3);
  const maxWait = inReview.length ? Math.max(...inReview.map(waitDays)) : 0;
  if (aged.length) S.push({ id: `out-aged-${aged.length}-${maxWait}`, domain: 'output', type: 'missed', severity: maxWait >= 5 ? 2 : 1, periods: DW,
    title: `3일 넘게 리뷰를 기다리는 결과물 ${aged.length}건 (최장 ${maxWait}일)`, detail: 'AI 1차 검토가 끝난 건부터 보면 빠릅니다.', rule: '마지막 버전 제출 후 3일 경과, 리뷰 중 상태', action: { label: '리뷰하러 가기', to: '/work' } });
  const byAuthor = new Map<string, number[]>();
  raw.subs.filter((s) => s.status !== 'shared').forEach((s) => { const v = Math.max(1, ...s.submission_versions.map((x) => x.version)); byAuthor.set(s.author_id, [...(byAuthor.get(s.author_id) ?? []), v]); });
  for (const [a, vs] of byAuthor) {
    const av = avg(vs)!;
    if (vs.length >= 2 && av >= 2.5) S.push({ id: `out-rework-${a}`, domain: 'output', type: 'pattern', severity: 2, periods: WM,
      title: `${nameOf(a)}님 결과물이 평균 ${av.toFixed(1)}차 수정까지 갑니다`, detail: '기대 기준이 처음에 덜 전달됐을 수 있습니다. 내 노하우의 기준 카드를 팀원에게 공개해 보세요.',
      rule: '최근 60일 결과물 2건 이상, 평균 버전 2.5 이상', action: { label: '기준 공유하기', to: '/knowhow' } });
  }
  const approved = raw.subs.filter((s) => s.status === 'approved').length;
  const shared = raw.subs.filter((s) => s.status === 'shared').length;
  const firstPass = raw.subs.filter((s) => s.status === 'approved' && Math.max(1, ...s.submission_versions.map((x) => x.version)) === 1).length;
  const silent = mem.filter((m) => !raw.subs.some((s) => s.author_id === m.user_id) && !raw.checkins.some((c) => c.user_id === m.user_id && c.week_start >= addDaysYmd(thisMon, -14)));
  if (nMem >= 2 && silent.length) S.push({ id: `out-silent-${silent.length}`, domain: 'output', type: 'missed', severity: 1, periods: WM,
    title: `2주 넘게 ATEAM에 흔적이 없는 팀원 ${silent.length}명`, detail: `${names(silent.map((m) => m.name))} — 요청을 보내면 팀원 화면에 할 일로 뜹니다.`,
    rule: '최근 2주 체크인·공유·결과물 0건', action: { label: '요청 보내기', to: '/people?tab=requests' } });

  // ---------------- 육성·평가 ----------------
  const depth = raw.depth ?? [];
  const thin = depth.filter((d) => !d.eligible);
  if (depth.length && thin.length) S.push({ id: `growth-thin-${thin.length}`, domain: 'growth', type: 'data', severity: thin.length / depth.length >= 0.5 ? 2 : 1, periods: M,
    title: `판단 근거가 ${raw.minEvidence}건 미만인 팀원 ${thin.length}명 — 지금 평가하면 '판단 보류'`,
    detail: thin.slice(0, 4).map((d) => `${d.full_name} ${d.judgment_evidence}건`).join(' · '), rule: `결과물·관찰·리뷰 코멘트·팀장 피드백·완료 항목 합계 < ${raw.minEvidence}건`,
    action: { label: '관찰 메모 쓰기', memo: thin[0].user_id } });
  const obsSet = new Set(raw.obs.map((o) => o.subject_id));
  const noObs = mem.filter((m) => !obsSet.has(m.user_id));
  if (nMem && noObs.length) S.push({ id: `growth-noobs-${noObs.length}`, domain: 'growth', type: 'missed', severity: 1, periods: WM,
    title: `최근 30일 관찰 메모가 없는 팀원 ${noObs.length}명`, detail: `${names(noObs.map((m) => m.name))} — 잘한 장면을 그때그때 남겨 두면 평가 시즌이 편해집니다.`,
    rule: '최근 30일 관찰 메모 0건', action: { label: '관찰 메모 쓰기', memo: noObs[0].user_id } });
  for (const p of raw.perf ?? []) {
    if (p.withheld) continue;
    const dx = p.x - p.prev_x; const dy = p.y - p.prev_y;
    if (dx <= -12 || dy <= -12) S.push({ id: `growth-down-${p.user_id}`, domain: 'growth', type: 'risk', severity: 2, periods: M,
      title: `${p.full_name}님 성과 지표가 90일 전보다 떨어졌습니다`, detail: `결과 ${Math.round(p.prev_x)} → ${Math.round(p.x)} · 판단·성장 ${Math.round(p.prev_y)} → ${Math.round(p.y)}`,
      rule: '성과 지도 좌표, 90일 전 대비 12점 이상 하락', action: { label: '팀 성과 보기', to: '/perf' } });
    else if (dx >= 12 || dy >= 12) S.push({ id: `growth-up-${p.user_id}`, domain: 'growth', type: 'good', severity: 1, periods: M,
      title: `${p.full_name}님이 눈에 띄게 성장하고 있습니다`, detail: `결과 ${Math.round(p.prev_x)} → ${Math.round(p.x)} · 판단·성장 ${Math.round(p.prev_y)} → ${Math.round(p.y)} — 인정해 줄 타이밍입니다.`,
      rule: '성과 지도 좌표, 90일 전 대비 12점 이상 상승', action: { label: '칭찬 메모 남기기', memo: p.user_id } });
  }
  // 계획 내 완료한 팀원 (좋은 신호)
  const onTime = new Map<string, number>();
  items.filter((i) => i.status === 'done' && i.base_due && i.owner_id && daysSince(i.updated_at) <= 30 && i.updated_at.slice(0, 10) <= i.base_due)
    .forEach((i) => onTime.set(i.owner_id!, (onTime.get(i.owner_id!) ?? 0) + 1));
  for (const [u, n] of onTime) if (n >= 3 && members.some((m) => m.user_id === u && m.role === 'member')) S.push({ id: `growth-ontime-${u}`, domain: 'growth', type: 'good', severity: 1, periods: M,
    title: `${nameOf(u)}님이 최근 30일 계획한 일 ${n}건을 기한 안에 끝냈습니다`, rule: '최근 30일, 처음 계획한 마감 이전 완료 3건 이상', action: { label: '칭찬 메모 남기기', memo: u } });


  // ---------------- 조직·전사 ----------------
  const org = raw.orgNotes ?? [];
  const dDay = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
  for (const n of org.filter((x) => x.event_date && (x.kind === 'calendar' || x.kind === 'request'))) {
    const dd = dDay(n.event_date!);
    if (n.kind === 'request' && dd < 0) S.push({ id: `org-req-late-${n.id}`, domain: 'org', type: 'missed', severity: 2, periods: DW,
      title: `상위 요청 '${n.title}' 기한이 ${-dd}일 지났습니다`, rule: '상위 요청 메모의 기한 경과, 완료 표시 없음', action: { label: '조직·전사 보기', to: '#org' } });
    else if (n.kind === 'request' && dd <= 7) S.push({ id: `org-req-soon-${n.id}`, domain: 'org', type: 'forecast', severity: dd <= 2 ? 3 : 2, periods: dd <= 3 ? DW : W,
      title: `상위 요청 '${n.title}' 마감 D-${dd}`, rule: '상위 요청 메모의 기한 7일 이내', action: { label: '조직·전사 보기', to: '#org' } });
    else if (n.kind === 'calendar' && dd >= 0 && dd <= 14) S.push({ id: `org-cal-${n.id}`, domain: 'org', type: 'forecast', severity: dd <= 7 ? 2 : 1, periods: dd <= 7 ? DW : WM,
      title: `전사 일정 '${n.title}' D-${dd}`, rule: '전사 일정 메모 14일 이내', action: { label: '조직·전사 보기', to: '#org' } });
  }
  const analyzed = new Set(raw.orgImpacts ?? []);
  const unread = org.filter((n) => ['strategy', 'exec', 'request', 'peer'].includes(n.kind) && daysSince(n.created_at) <= 14 && !analyzed.has(n.id));
  if (unread.length) S.push({ id: `org-unread-${unread.length}-${unread[0].id.slice(0, 6)}`, domain: 'org', type: 'missed', severity: 1, periods: WM,
    title: `우리 팀 영향을 아직 확인하지 않은 위의 소식 ${unread.length}건`, detail: unread.slice(0, 3).map((n) => n.title).join(' · '),
    rule: '최근 14일 상위 소식 메모 중 영향 분석 없음', action: { label: '영향 보기', to: '#org' } });
  const decDue = (raw.decisionsDue ?? []).filter((d) => (d.review_on ? d.review_on <= today : daysSince(d.decided_at) >= 30));
  if (decDue.length) S.push({ id: `decide-review-${decDue.length}`, domain: 'goal', type: 'missed', severity: 1, periods: WM,
    title: `결과를 돌아볼 시점이 지난 결정 ${decDue.length}건`, detail: decDue.slice(0, 3).map((d) => d.title).join(' · '),
    rule: '회고일이 지났거나 결정 후 30일이 지났는데 결과 기록 없음', action: { label: '결과 기록하기', to: '/strategy' } });

  // ---------------- AI 인사이트 수준 ----------------
  const lv = raw.level;
  if (lv && lv.level < 5) {
    const next = lv.levels[lv.level];
    const gap = next.conditions.find((c) => c.current < c.target);
    if (gap) {
      const gl = gap.label;
      const gd: Domain = /체크인|1:1/.test(gl) ? 'people' : /결과물/.test(gl) ? 'output' : /근거/.test(gl) ? 'growth' : /공수/.test(gl) ? 'exec' : 'goal';
      S.push({ id: `level-${lv.level}-${gl}`, domain: gd, type: 'data', severity: 1, periods: M,
        title: `${gl} ${gap.target - gap.current}${gap.unit ?? ''}만 더 쌓이면 AI가 'L${next.level} ${next.name}'까지 봅니다`,
        detail: `지금은 L${lv.level} ${lv.levels[lv.level - 1].name} 단계입니다.`, rule: 'AI 인사이트 레벨 조건', action: { label: '레벨 조건 보기', to: '/insight' } });
    }
  }

  // ---------------- 영역 요약 ----------------
  const pick = (d: Domain) => S.filter((s) => s.domain === d && s.type !== 'good' && s.type !== 'data').sort((a, b) => b.severity - a.severity)[0];
  const statusOf = (d: Domain, unknown: boolean): Status => {
    if (unknown) return 'unknown';
    const sev = Math.max(0, ...S.filter((s) => s.domain === d && (s.type === 'risk' || s.type === 'missed' || s.type === 'forecast')).map((s) => (s.type === 'forecast' ? s.severity - 1 : s.severity)));
    const dataGap = S.some((s) => s.domain === d && s.type === 'data' && s.severity >= 2);
    return sev >= 3 ? 'risk' : sev === 2 || dataGap ? 'watch' : 'good';
  };
  const effortPct = pf.length ? Math.round(((pf.length - noEffort) / pf.length) * 100) : 0;
  const metricMonths = lv?.totals.metric_months ?? 0;
  const onPlan = leaves.length ? Math.round(((leaves.length - overdue.length - leaves.filter((l) => l.status === 'blocked').length) / leaves.length) * 100) : null;
  const domains: DomainSummary[] = [
    { domain: 'goal', status: statusOf('goal', !goals.length && !raw.forecasts.length),
      kpi: goalLow != null ? `${goalLow}%` : '—', kpiLabel: goalLow != null ? '가장 낮은 목표 달성 가능성' : '전망 없음',
      line: pick('goal')?.title ?? (goals.length ? `목표 ${goals.length}개 모두 순항 중입니다` : '목표를 세우면 전망이 나옵니다'),
      confidence: metricMonths >= 6 ? 3 : metricMonths >= 3 ? 2 : goals.length ? 1 : 0, confidenceNote: `실적 ${metricMonths}개월치 · 목표 ${goals.length}개`, to: '/goals', period: DOMAIN_META.goal.period },
    { domain: 'exec', status: statusOf('exec', !work.length),
      kpi: onPlan != null ? `${onPlan}%` : '—', kpiLabel: onPlan != null ? `계획대로 진행 (항목 ${leaves.length}건 중)` : '진행 항목 없음',
      line: pick('exec')?.title ?? (work.length ? '지연·막힘 없이 진행 중입니다' : '과제를 세우면 계획 대비를 봅니다'),
      confidence: !work.length ? 0 : effortPct >= 60 && sched.length >= 3 ? 3 : sched.length ? 2 : 1, confidenceNote: `진행 항목 ${work.length}건 · 공수 입력 ${effortPct}%`, to: '/goals', period: DOMAIN_META.exec.period },
    { domain: 'people', status: statusOf('people', !nMem),
      kpi: curC != null ? `${curC.toFixed(1)}` : '—', kpiLabel: curC != null ? `팀 컨디션 (5점) · 체크인 ${ciThis || ciLast}/${nMem}명` : '컨디션 기록 없음',
      line: pick('people')?.title ?? (nMem ? '특별히 챙길 신호가 없습니다' : '팀원을 초대하면 컨디션 추세를 봅니다'),
      confidence: !nMem ? 0 : ciWeeks >= 4 ? 3 : ciWeeks >= 2 ? 2 : 1, confidenceNote: `최근 5주 중 체크인 있는 주 ${ciWeeks}주`, to: '/people', period: DOMAIN_META.people.period },
    { domain: 'output', status: statusOf('output', !raw.subs.length),
      kpi: `${inReview.length}`, kpiLabel: inReview.length ? `리뷰 대기 · 최장 ${maxWait}일` : '리뷰 대기',
      line: pick('output')?.title ?? (raw.subs.length ? `최근 60일 승인 ${approved}건 · 한 번에 통과 ${firstPass}건 · 공유 ${shared}건` : '결과물이 올라오면 리뷰 흐름을 봅니다'),
      confidence: raw.subs.length >= 10 ? 3 : raw.subs.length >= 4 ? 2 : raw.subs.length ? 1 : 0, confidenceNote: `최근 60일 결과물·공유 ${raw.subs.length}건`, to: '/work', period: DOMAIN_META.output.period },
    { domain: 'growth', status: statusOf('growth', !depth.length),
      kpi: depth.length ? `${depth.length - thin.length}/${depth.length}` : '—', kpiLabel: '평가 근거가 충분한 팀원',
      line: pick('growth')?.title ?? (thin.length ? `근거가 부족한 팀원 ${thin.length}명` : depth.length ? '모든 팀원의 평가 근거가 충분합니다' : '팀원을 초대하면 평가 근거를 모읍니다'),
      confidence: !depth.length ? 0 : thin.length === 0 ? 3 : thin.length / depth.length < 0.5 ? 2 : 1, confidenceNote: `최근 30일 관찰 메모 ${raw.obs.length}건`, to: '/eval', period: DOMAIN_META.growth.period },
  ];

  const order: Record<SignalType, number> = { risk: 0, missed: 1, forecast: 2, pattern: 3, good: 4, data: 5 };
  S.sort((a, b) => b.severity - a.severity || order[a.type] - order[b.type]);
  return { signals: S, domains };
}

/** AI 프롬프트용: 기간에 맞는 신호를 근거 문장으로 */
export function signalsFor(period: Period, signals: Signal[]) {
  return signals.filter((s) => s.periods.includes(period));
}
