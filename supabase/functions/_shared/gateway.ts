// ⑨ AI 게이트웨이: 크레딧 확인 → Claude 호출 → 출처와 함께 저장 → 크레딧 차감
import { admin } from './supabase.ts';
import { HttpError } from './http.ts';
import { callClaude, parseJson, type Block } from './anthropic.ts';

export type AiKind =
  | 'briefing' | 'one_on_one_prep' | 'review' | 'weekly_report'
  | 'evaluation_draft' | 'forecast_note' | 'strategy_check' | 'scenario_note'
  | 'insight_daily' | 'insight_weekly' | 'insight_monthly' | 'plan_draft' | 'plan_edit' | 'self_check' | 'org_impact' | 'people_actions' | 'advisor_weekly' | 'exec_brief' | 'coaching' | 'checkin_draft' | 'work_brief';

/** 코어 AI: 구독에 포함 (크레딧 차감 없음, 요금제별 공정 사용 한도만) */
export const CORE: AiKind[] = ['briefing', 'one_on_one_prep', 'review', 'weekly_report',
  'insight_daily', 'insight_weekly', 'insight_monthly', 'plan_edit', 'self_check', 'org_impact', 'people_actions', 'advisor_weekly', 'exec_brief', 'coaching', 'checkin_draft', 'work_brief'];

/** 프리미엄 AI: 크레딧 차감 */
export const CREDITS: Record<AiKind, number> = {
  one_on_one_prep: 0, review: 0, briefing: 0, weekly_report: 0,
  insight_daily: 0, insight_weekly: 0, insight_monthly: 0, plan_edit: 0, self_check: 0, org_impact: 0, people_actions: 0, advisor_weekly: 0, exec_brief: 0, coaching: 0, checkin_draft: 0, work_brief: 0,
  evaluation_draft: 5, plan_draft: 2, forecast_note: 1, strategy_check: 1, scenario_note: 1,
};

export interface Source {
  tag: string; // E1, E2 ...
  type: string; // checkin, one_on_one, submission, observation, review_comment, leader_note, task, metric, decision
  id: string | null;
  label: string; // 화면에 보이는 근거 이름
}

/** 근거에 [E#] 태그를 붙여 프롬프트용 텍스트와 출처 목록을 함께 만든다 */
export class SourceBook {
  private items: Source[] = [];
  private lines: { type: string; line: string }[] = [];
  add(type: string, id: string | null, label: string, text: string): string {
    const tag = `E${this.items.length + 1}`;
    this.items.push({ tag, type, id, label });
    this.lines.push({ type, line: `[${tag}] (${label}) ${text.replace(/\s+/g, ' ').trim().slice(0, 1200)}` });
    return tag;
  }
  get size() {
    return this.items.filter((i) => !KH_TYPES.includes(i.type)).length;
  }
  get sources() {
    return this.items;
  }
  /** 기록(근거) 섹션 — 팀장 노하우는 따로 출력한다 */
  text(title: string) {
    const ls = this.lines.filter((l) => !KH_TYPES.includes(l.type)).map((l) => l.line);
    return ls.length ? `## ${title}\n${ls.join('\n')}` : `## ${title}\n(기록 없음)`;
  }
  /** 지금까지 실은 기록 본문 (노하우 제외) — 플레이북 카드를 상황에 맞게 고를 때 쓴다 */
  evidenceText() {
    return this.lines.filter((l) => !KH_TYPES.includes(l.type)).map((l) => l.line).join('\n');
  }
  /** 팀장의 기준 섹션 + ATEAM 플레이북 섹션 (없으면 빈 문자열) */
  knowhowText() {
    const own = this.lines.filter((l) => l.type === 'knowhow').map((l) => l.line);
    const con = this.lines.filter((l) => l.type === 'consulting').map((l) => l.line);
    return [
      own.length ? `## 팀장의 기준 (팀장이 직접 넣은 노하우 — 일반 상식보다 우선)\n${own.join('\n')}` : '',
      con.length ? `## ATEAM 플레이북 (검증된 업무 방법론 중 이 상황에 맞는 것 — 팀장의 기준과 어긋나면 팀장의 기준을 따름)\n${con.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
  }
  /** AI가 실제로 인용한 근거만 남긴다 */
  cited(output: unknown): Source[] {
    const used = this.citedStrict(output);
    return used.length ? used : this.items;
  }
  citedStrict(output: unknown): Source[] {
    const s = JSON.stringify(output);
    return this.items.filter((i) => s.includes(`[${i.tag}]`) || s.includes(`"${i.tag}"`));
  }
  byType(): Record<string, number> {
    return this.items.reduce((acc, i) => ((acc[i.type] = (acc[i.type] ?? 0) + 1), acc), {} as Record<string, number>);
  }
}

/** 노하우 근거 종류: 팀장 카드(knowhow) · ATEAM 플레이북 카드(consulting) — 기록(근거) 수에는 세지 않는다 */
const KH_TYPES = ['knowhow', 'consulting'];

export type KnowhowFeature = 'review' | 'prep' | 'report' | 'evaluation' | 'briefing' | 'strategy' | 'scenario' | 'plan';

// ---------- ATEAM 플레이북: 상황에 맞는 방법론 고르기 ----------
/** 기능마다 먼저 볼 플레이북 영역 (supabase/playbook/playbook.json 의 domain) */
const FEATURE_DOMAINS: Record<KnowhowFeature, string[]> = {
  review: ['logic', 'writing', 'creative', 'decision'],
  report: ['writing', 'comm'],
  prep: ['coach'],
  briefing: ['team', 'decision', 'coach'],
  strategy: ['goal', 'decision', 'creative'],
  scenario: ['team', 'decision'],
  plan: ['goal', 'creative', 'logic'],
  evaluation: [],
};
/** 한 번에 싣는 플레이북 카드 수 상한 — 많이 실으면 AI가 흐려진다 */
const MAX_PLAYBOOK = 8;
type TplMeta = { tier: number; domain: string; sort: number };
let tplCache: { at: number; map: Map<string, TplMeta> } | null = null;
async function templateMeta(): Promise<Map<string, TplMeta>> {
  if (tplCache && Date.now() - tplCache.at < 10 * 60_000) return tplCache.map;
  const { data, error } = await admin.from('knowhow_templates').select('key, tier, domain, sort');
  const map = new Map<string, TplMeta>();
  // 29_playbook.sql 전이면 tier·domain 칸이 없다 → 예전처럼 순서대로
  if (!error) for (const t of (data ?? []) as { key: string; tier?: number; domain?: string; sort?: number }[]) map.set(t.key, { tier: t.tier ?? 2, domain: t.domain ?? '', sort: t.sort ?? 0 });
  tplCache = { at: Date.now(), map };
  return map;
}
const norm = (s: string) => s.toLowerCase().replace(/[\s·・\-_/()'"‘’“”]/g, '');
/** 카드 하나가 지금 상황에 얼마나 맞는가: 고정 > 본문·기록과 겹치는 키워드 > 기능에 맞는 영역 > 대표 방법론 */
function playbookScore(c: KbRow, meta: Map<string, TplMeta>, feature: KnowhowFeature, ctx: string): number {
  const m = meta.get(c.template_key ?? '');
  let s = c.pinned ? 100 : 0;
  if (m?.tier === 1) s += 3;
  if (m && FEATURE_DOMAINS[feature]?.includes(m.domain)) s += 2;
  if (ctx) {
    let hits = 0;
    for (const k of c.keywords ?? []) { const nk = norm(k); if (nk.length >= 2 && ctx.includes(nk)) hits++; }
    s += Math.min(hits, 4) * 3;
  }
  return s;
}
type KbRow = { id: string; title: string; body: string; rules: unknown; pinned?: boolean; source?: string | null; template_key?: string | null; keywords?: string[] | null };

/** 팀장이 켜 둔 노하우 카드 중 이 기능에 해당하는 것을 근거책에 싣는다
 *  순서: 팀장 카드(고정 → 최근) 먼저, 남는 글자 수 안에서 ATEAM 플레이북 카드(source='consulting').
 *  플레이북은 지금 상황(context — 비우면 근거책에 이미 실린 기록)에 맞는 순서로 골라 최대 MAX_PLAYBOOK 장.
 *  consulting=false 면 플레이북 카드는 싣지 않는다 (예: 팀원 액션) · own=false 면 팀장 카드는 싣지 않는다 (예: 팀원에게 그대로 보이는 코칭) */
export async function addKnowhow(book: SourceBook, teamId: string, feature: KnowhowFeature, limitChars = 3200, onlyShared = false, consulting = true, context = '', own = true): Promise<number> {
  let qb = admin.from('knowhow_cards')
    .select('id, kind, title, body, rules, pinned, updated_at, source, template_key, keywords')
    .eq('team_id', teamId).eq('active', true).contains('applies_to', [feature]);
  if (onlyShared) qb = qb.eq('shared', true);
  const { data } = await qb.order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(160);
  const rows = (data ?? []) as KbRow[];
  const isCon = (c: { source?: string | null }) => c.source === 'consulting';
  let con = consulting ? rows.filter(isCon) : [];
  if (con.length > 1) {
    const meta = await templateMeta();
    const ctx = norm((context || book.evidenceText()).slice(0, 20000));
    con = con.map((c) => ({ c, s: playbookScore(c, meta, feature, ctx), o: meta.get(c.template_key ?? '')?.sort ?? 9999 }))
      .sort((a, b) => b.s - a.s || a.o - b.o).map((x) => x.c);
  }
  const ordered = [...(own ? rows.filter((c) => !isCon(c)) : []), ...con];
  let used = 0, n = 0, nCon = 0;
  for (const c of ordered) {
    const rules = Array.isArray(c.rules) ? (c.rules as string[]).filter(Boolean) : [];
    const text = `${c.body}${rules.length ? ` / 규칙: ${rules.join(' · ')}` : ''}`;
    if (isCon(c) && nCon >= MAX_PLAYBOOK) break;
    if (used + text.length > limitChars && n > 0) { if (isCon(c)) break; continue; }
    if (isCon(c)) { book.add('consulting', c.id, `ATEAM 플레이북 · ${c.title}`, text); nCon++; }
    else book.add('knowhow', c.id, `내 노하우 · ${c.title}`, text);
    used += text.length; n++;
  }
  return n;
}

/** 근거 건수로 데이터 깊이(1~4)를 정한다 */
export function depthOf(n: number, steps: [number, number, number] = [4, 10, 25]): number {
  if (n <= 0) return 0;
  if (n < steps[0]) return 1;
  if (n < steps[1]) return 2;
  if (n < steps[2]) return 3;
  return 4;
}

export const BASE_RULES = `당신은 한국 기업 팀장의 성과관리를 돕는 보조자입니다. 반드시 지킬 원칙:
1. 주어진 기록에 있는 사실만 씁니다. 기록에 없는 숫자·사건·평가를 만들어 내지 않습니다.
2. 사람에 대한 판단이나 평가는 근거 태그(예: [E3])를 붙여서만 말합니다. 근거가 모자라면 "근거 부족"이라고 씁니다.
3. 숫자는 입력에 주어진 계산 결과만 인용합니다. 새로 계산하거나 추정하지 않습니다.
4. 점수로 사람을 줄 세우거나 비교하지 않습니다.
5. 문체: 한국 기업 실무 보고서처럼 짧고 담백하게, '~합니다'체. 과장, 감탄, 영어 직역투, 이모지는 쓰지 않습니다.
6. 출력은 요청한 JSON 객체 하나만. 앞뒤 설명이나 코드 펜스를 붙이지 않습니다.
7. '팀장의 기준' 섹션이 있으면 그 기준을 일반적인 상식보다 우선해 적용하고, 기준을 적용한 문장에는 해당 근거 태그를 붙입니다. 기준과 기록이 어긋나면 그 점을 짚습니다.
8. 'ATEAM 플레이북' 섹션은 이 상황에 맞춰 고른 검증된 업무 방법론입니다. 일반 상식보다는 우선하되 '팀장의 기준'과 어긋나면 팀장의 기준을 따릅니다. 실제로 이 기록에 들어맞는 방법론만 쓰고, 적용한 문장에는 해당 근거 태그를 붙입니다. 방법론 이름을 늘어놓거나 이론을 설명하지 말고, 기록에 비춘 구체적인 판단과 행동으로 씁니다.`;

export interface AiJob {
  teamId: string;
  kind: AiKind;
  model: string;
  system: string;
  content: Block[];
  maxTokens?: number;
  book: SourceBook;
  depth: number;
  level: string; // L1~L5
  createdBy: string | null;
  subjectUserId?: string | null;
  refTable?: string;
  refId?: string;
  periodStart?: string;
  periodEnd?: string;
  visibility?: 'leader' | 'subject' | 'team';
  credits?: number;
  /** 모델 출력 외에 함께 저장할 계산값 (예: 컨디션 공유 미제출자) */
  extra?: Record<string, unknown>;
  /** true면 10분 안의 같은 결과를 재사용하지 않고 새로 만든다 */
  force?: boolean;
}

export async function assertCredits(teamId: string, need: number) {
  const { data, error } = await admin.rpc('credit_status', { p_team: teamId });
  if (error) throw error;
  if (!(data?.features ?? []).includes('ai_premium')) throw new HttpError(402, 'AI_LOCKED', 'AI 기능은 Pro에서 쓸 수 있습니다');
  const left = (data?.monthly_remaining ?? 0) + (data?.topup_remaining ?? 0);
  if (left < need) throw new HttpError(402, 'INSUFFICIENT_CREDITS', `크레딧이 부족합니다 (필요 ${need}, 남음 ${left})`);
}

/** 코어 AI 사용 가능 여부 (요금제·공정 사용 한도) */
export async function assertCore(teamId: string) {
  const { data, error } = await admin.rpc('credit_status', { p_team: teamId });
  if (error) throw error;
  if (!(data?.features ?? []).includes('ai_core')) throw new HttpError(402, 'AI_LOCKED', 'AI 기능은 Pro에서 쓸 수 있습니다');
  if ((data?.core_used ?? 0) >= (data?.core_cap ?? 0)) throw new HttpError(429, 'CORE_LIMIT', '이번 달 AI 기본 사용량을 모두 썼습니다');
}

export async function assertAccess(teamId: string, kind: AiKind, credits?: number) {
  const need = credits ?? CREDITS[kind];
  if (CORE.includes(kind) && !need) return assertCore(teamId);
  return assertCredits(teamId, need);
}

/** 입력이 '대상'으로 정해지는 종류 — 10분 안에 같은 대상을 다시 누르면 AI를 다시 부르지 않고 방금 결과를 돌려준다 */
const REUSABLE: AiKind[] = ['insight_daily', 'insight_weekly', 'insight_monthly', 'review', 'one_on_one_prep', 'people_actions', 'briefing', 'org_impact', 'advisor_weekly', 'exec_brief'];
const REUSE_MIN = 10;

const GUARD_MSG: Record<string, [number, string]> = {
  AI_RATE_HOUR: [429, '잠시 AI 요청이 많았습니다. 한 시간 안에 다시 시도해 주세요.'],
  AI_RATE_DAY: [429, '오늘 AI 요청이 많았습니다. 내일 다시 시도해 주세요.'],
  AI_COST_CAP: [429, '이번 달 AI 기본 사용량을 모두 썼습니다. 다음 결제 주기에 다시 열립니다.'],
  AI_REPEAT: [429, '같은 내용을 오늘 여러 번 다시 만들었습니다. 기록이 더 쌓인 뒤 내일 다시 만들어 주세요.'],
};

/** AI를 부르기 직전: 시간당·하루 상한, 월 원가 상한, 같은 대상 반복 (SQL ai_guard) */
async function guard(job: AiJob) {
  const { error } = await admin.rpc('ai_guard', {
    p_team: job.teamId, p_kind: job.kind, p_ref: job.refId ?? null, p_period: job.periodStart ?? null, p_subject: job.subjectUserId ?? null,
  });
  if (!error) return;
  const hit = Object.keys(GUARD_MSG).find((k) => error.message?.includes(k));
  if (hit) throw new HttpError(GUARD_MSG[hit][0], hit, GUARD_MSG[hit][1]);
  // ai_guard 가 아직 없는 DB(09 미실행)에서는 기존 월 횟수 한도만으로 동작
  if (/ai_guard|function .* does not exist|PGRST202/i.test(`${error.message} ${error.code}`)) { console.warn('ai_guard missing — run 09_ai_guard.sql'); return; }
  throw error;
}

async function recent(job: AiJob) {
  if (job.force || !REUSABLE.includes(job.kind) || (!job.refId && !job.periodStart)) return null;
  let qb = admin.from('ai_outputs').select('*').eq('team_id', job.teamId).eq('kind', job.kind).eq('status', 'draft')
    .gte('created_at', new Date(Date.now() - REUSE_MIN * 60000).toISOString());
  qb = job.refId ? qb.eq('ref_id', job.refId) : qb.is('ref_id', null);
  qb = job.periodStart ? qb.eq('period_start', job.periodStart) : qb.is('period_start', null);
  qb = job.subjectUserId ? qb.eq('subject_user_id', job.subjectUserId) : qb.is('subject_user_id', null);
  const { data } = await qb.order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

export async function runAi<T>(job: AiJob): Promise<{ output: Record<string, unknown>; parsed: T; reused?: boolean }> {
  const credits = job.credits ?? CREDITS[job.kind];
  const core = CORE.includes(job.kind) && !credits;
  await assertAccess(job.teamId, job.kind, credits);

  const again = await recent(job);
  if (again) return { output: again, parsed: again.content as T, reused: true };
  await guard(job);

  const res = await callClaude({
    model: job.model,
    system: `${BASE_RULES}\n\n${job.system}`,
    content: job.content,
    maxTokens: job.maxTokens,
  });
  let parsed: T;
  try {
    parsed = parseJson<T>(res.text);
  } catch (e) {
    // 실패한 호출도 원가는 남긴다 (횟수 한도엔 안 셈)
    await admin.rpc('log_ai_error', { p_team: job.teamId, p_kind: job.kind, p_model: res.model, p_in: res.inputTokens, p_out: res.outputTokens, p_cost: res.costUsd });
    throw e;
  }

  const { data: row, error } = await admin
    .from('ai_outputs')
    .insert({
      team_id: job.teamId,
      kind: job.kind,
      subject_user_id: job.subjectUserId ?? null,
      ref_table: job.refTable ?? null,
      ref_id: job.refId ?? null,
      period_start: job.periodStart ?? null,
      period_end: job.periodEnd ?? null,
      status: 'draft',
      visibility: job.visibility ?? 'leader',
      level: job.level,
      depth: job.depth,
      content: { ...(parsed as unknown as Record<string, unknown>), ...(job.extra ?? {}) },
      sources: job.book.cited(parsed),
      model: res.model,
      input_tokens: res.inputTokens,
      output_tokens: res.outputTokens,
      created_by: job.createdBy,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: cErr } = core
    ? await admin.rpc('consume_core', {
      p_team: job.teamId, p_kind: job.kind, p_ai_output: row.id,
      p_model: res.model, p_in: res.inputTokens, p_out: res.outputTokens, p_cost: res.costUsd,
    })
    : await admin.rpc('consume_credits', {
      p_team: job.teamId,
      p_credits: credits,
      p_kind: job.kind,
      p_ai_output: row.id,
      p_model: res.model,
      p_in: res.inputTokens,
      p_out: res.outputTokens,
      p_cost: res.costUsd,
    });
  if (cErr) console.error('consume_credits failed', cErr);

  const kh = job.book.citedStrict(parsed).filter((x) => KH_TYPES.includes(x.type) && x.id).map((x) => x.id);
  if (kh.length) await admin.rpc('mark_knowhow_used', { p_ids: kh });

  return { output: row, parsed };
}

/** 근거가 기준에 못 미칠 때: AI를 부르지 않고 '판단 보류'를 기록한다 (크레딧 차감 없음) */
export async function withhold(job: Omit<AiJob, 'model' | 'system' | 'content'>, reason: string, needed: Record<string, unknown>) {
  const { data, error } = await admin
    .from('ai_outputs')
    .insert({
      team_id: job.teamId,
      kind: job.kind,
      subject_user_id: job.subjectUserId ?? null,
      ref_table: job.refTable ?? null,
      ref_id: job.refId ?? null,
      period_start: job.periodStart ?? null,
      period_end: job.periodEnd ?? null,
      status: 'withheld',
      visibility: 'leader',
      level: job.level,
      depth: job.depth,
      content: { reason, needed },
      sources: job.book.sources,
      created_by: job.createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export const fmtDate = (d: string | null | undefined) => (d ? d.slice(0, 10) : '');
export const weekLabel = (d: string) => {
  const dt = new Date(d);
  const onejan = new Date(dt.getFullYear(), 0, 1);
  const w = Math.ceil(((dt.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `W${String(w).padStart(2, '0')}`;
};
