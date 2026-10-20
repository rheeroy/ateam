// DB 행 타입 (마이그레이션과 맞춘 수기 타입). 스키마가 커지면 `npm run db:types` 로 생성 타입으로 바꿔도 된다.
export type Role = 'leader' | 'member';
export type AiKind =
  | 'briefing' | 'one_on_one_prep' | 'review' | 'weekly_report'
  | 'evaluation_draft' | 'forecast_note' | 'strategy_check' | 'scenario_note'
  | 'insight_daily' | 'insight_weekly' | 'insight_monthly' | 'plan_draft' | 'plan_edit' | 'self_check' | 'org_impact' | 'people_actions' | 'advisor_weekly' | 'exec_brief' | 'coaching' | 'checkin_draft';
export type AiStatus = 'draft' | 'edited' | 'final' | 'withheld';

export interface Profile { id: string; email: string | null; full_name: string; avatar_url: string | null }
export interface Team { id: string; name: string; mission: string; parent_link: string; owner_id: string; settings: Record<string, unknown>; created_at: string; is_demo?: boolean }
export interface TeamMember {
  team_id: string; user_id: string; role: Role; job_title: string; weekly_hours: number;
  status: 'active' | 'left'; joined_at: string; profiles?: Profile;
}
export interface Invitation { id: string; team_id: string; email: string; role: Role; job_title: string; token: string; accepted_at: string | null; expires_at: string; created_at: string }

/** 컨디션 공유 (did·blocked·next 는 예전 주간 체크인의 업무 칸 — 새로 쓰지 않음) */
export interface Checkin { id: string; team_id: string; user_id: string; week_start: string; did: string; blocked: string; next: string; condition: number | null; moods?: string[] | null; note?: string | null; created_at: string; updated_at: string }
export interface OneOnOne {
  id: string; team_id: string; leader_id: string; member_id: string; scheduled_at: string; duration_min: number;
  status: 'scheduled' | 'done' | 'canceled'; shared_notes: string; completed_at: string | null; created_at: string;
}
export interface ActionItem { id: string; team_id: string; one_on_one_id: string | null; owner_id: string; title: string; due_date: string | null; done_at: string | null; created_by: string; created_at: string }
export interface Observation { id: string; team_id: string; author_id: string; subject_id: string; kind: 'praise' | 'concern' | 'note'; competency: string | null; body: string; occurred_at: string; created_at: string }
export interface Submission { id: string; team_id: string; author_id: string; item_id: string | null; title: string; status: 'in_review' | 'needs_work' | 'approved' | 'shared'; kind: ShareKind; request_type: RequestType; link_url: string | null; approved_at: string | null; closed_at?: string | null; group_id?: string | null; space_id?: string | null; created_at: string; updated_at: string }
export type ShareKind = 'document' | 'link' | 'image' | 'number' | 'note' | 'checkin';
export type RequestType = 'approval' | 'feedback' | 'share';
export interface SubmissionVersion { id: string; submission_id: string; team_id: string; version: number; file_path: string | null; file_name: string | null; mime_type: string | null; extracted_text: string; note: string; created_by: string; value: number | null; created_at: string; checkin?: CheckinPayload | null }
/** 성과 체크인 — 목표 하나에 성과를 점찍는다. 승인되면 그 항목의 공식 값이 된다 */
export type CheckinType = 'number' | 'percent' | 'stage' | 'done' | 'note';
export interface CheckinPayload { type: CheckinType; value?: number | null; stage?: number | null; progress?: number | null; prev?: string | null; label?: string | null; evidence?: { t: 'sub' | 'msg'; id: string; title: string }[] }
export interface ReviewComment { id: string; submission_id: string; version_id: string | null; team_id: string; parent_id: string | null; author_id: string; section_ref: string | null; body: string; provenance: string; file_path?: string | null; file_name?: string | null; mime_type?: string | null; created_at: string }

export interface Hypothesis { id: string; team_id: string; item_id: string | null; statement: string; signal: string; status: 'testing' | 'validated' | 'refuted'; created_at: string }
export type ItemStatus = 'proposed' | 'changes_requested' | 'active' | 'blocked' | 'done' | 'dropped';
export type ItemMeasure = 'check' | 'children' | 'percent' | 'number' | 'recurring' | 'stage';
export interface WorkItem {
  id: string; team_id: string; parent_id: string | null; owner_id: string | null; created_by: string | null;
  title: string; note: string; status: ItemStatus; measure: ItemMeasure; progress: number;
  num_current: number | null; num_target: number | null; unit: string; higher_is_better: boolean; recur: 'weekly' | 'monthly' | null;
  stages?: string[]; stage_current?: number | null;
  /** goal(최상위) · metric(지표) · task(과제·할 일) — 23_goal_metrics */
  role?: 'goal' | 'metric' | 'task' | null;
  start_date: string | null; due_date: string | null; done_at: string | null;
  base_start: string | null; base_due: string | null; base_target: number | null; baselined_at: string | null; replan_count: number;
  tags: string[]; contribution: number; priority: number; est_hours_per_week: number | null; metric_id: string | null;
  needs_plan: boolean; sort: number; created_at: string; updated_at: string;
}
export interface WorkItemLog { id: string; item_id: string; team_id: string; author_id: string | null; kind: 'progress' | 'number' | 'recurring' | 'note'; period: string; value: number | null; done: boolean | null; note: string; created_at: string }
export interface WorkItemEvent { id: number; item_id: string; actor_id: string | null; kind: string; old: unknown; new: unknown; reason: string | null; created_at: string }
export interface WorkItemComment { id: string; item_id: string; team_id: string; author_id: string; kind: 'comment' | 'feedback' | 'approve' | 'changes'; body: string; created_at: string }
export interface TeamRequest {
  id: string; team_id: string; from_id: string; to_id: string; kind: 'plan' | 'progress' | 'share' | 'meeting' | 'other' | 'grow' | 'cheer' | 'change';
  item_id: string | null; title: string; body: string; due_date: string | null; status: 'open' | 'done' | 'canceled';
  response: string; responded_at: string | null; created_at: string;
}
export interface AppNotification { id: string; user_id: string; team_id: string | null; kind: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }
export interface ScheduleRow { item_id: string; title: string; owner_id: string | null; progress: number; start_date: string | null; due_date: string | null; base_due: string | null; slip_days: number | null; replan_count: number; velocity: number | null; projected_done: string | null; projected_delay: number | null }
export interface Metric { id: string; team_id: string; item_id: string | null; name: string; unit: string; target: number | null; period_start: string; period_end: string; cumulative: boolean; higher_is_better: boolean }
export interface MetricValue { id: string; metric_id: string; period: string; value: number }
export interface Pipeline { id: string; metric_id: string; label: string; amount: number; probability: number; expected_close: string | null; closed: boolean }
export interface Decision { id: string; team_id: string; title: string; rationale: string; expected_outcome: string; review_on: string | null; scenario_id: string | null; outcome: string | null; outcome_rating: 'hit' | 'partial' | 'miss' | null; decided_at: string }
export interface Scenario { id: string; team_id: string; name: string; inputs: Record<string, unknown>; results: Record<string, unknown>; created_at: string }

export interface SourceRef { tag: string; type: string; id: string | null; label: string }
export interface AiOutput<C = Record<string, unknown>> {
  id: string; team_id: string; kind: AiKind; subject_user_id: string | null; ref_table: string | null; ref_id: string | null;
  period_start: string | null; period_end: string | null; status: AiStatus; visibility: 'leader' | 'subject' | 'team';
  level: string | null; depth: number | null; content: C; edited_content: C | null; sources: SourceRef[];
  model: string | null; created_at: string; edited_at: string | null; finalized_at: string | null;
}

// ---- 분석 함수 반환 ----
export interface CareSignal { type: string; label: string; detail?: string }
export interface CareRow { user_id: string; full_name: string; job_title: string; signals: CareSignal[] }
export interface DepthRow { user_id: string; full_name: string; job_title: string; checkin_weeks: number; one_on_ones: number; submissions: number; observations: number; judgment_evidence: number; eligible: boolean; can_see: string }
export interface LevelCondition { label: string; current: number; target: number; unit?: string }
export interface InsightLevel {
  level: number; next_progress: number | null;
  levels: { level: number; name: string; conditions: LevelCondition[] }[];
  totals: { checkins: number; one_on_ones: number; submissions: number; reviewed: number; observations: number; metric_months: number; members: number };
}
export interface PerfPoint { user_id: string; full_name: string; job_title: string; x: number; y: number; prev_x: number; prev_y: number; evidence: number; withheld: boolean }
export interface Forecast {
  metric_id: string; name: string; unit: string; target: number | null; period_start: string; period_end: string; cumulative: boolean;
  series: { period: string; value: number; cumulative: number }[]; months_of_data: number; insufficient: boolean;
  actual?: number; base?: number; low?: number; high?: number; range_width?: number; probability?: number | null;
  drivers?: { pace: number; remaining_months: number; pipeline_weighted: number; pipeline_count: number; volatility: number };
}
export interface GoalOutlook { goal_id: string; title: string; progress: number; probability: number | null; basis: 'metric' | 'schedule' | 'insufficient'; blocked: number; task_count: number }
export interface PortfolioRow { task_id: string; title: string; goal_id: string | null; mission_contribution: number; hours: number; share_pct: number | null; owner_name: string | null; status: string }
export interface CreditStatus {
  /** 'free' = 체험·구독 종료(잠금) */
  plan_id: 'free' | 'starter' | 'pro' | 'pro_plus'; plan_name: string; features: string[]; max_members: number; monthly_credits: number;
  monthly_remaining: number; topup_remaining: number; period_start: string; period_end: string;
  status: string; trial_ends_at: string | null; trial_expired?: boolean; expired?: boolean; was_trial?: boolean; is_owner: boolean; core_used?: number; core_cap?: number;
  /** 이번 달 AI 원가 / 원가 상한 (%) — 기본 AI 안내용, 숫자는 화면에 보이지 않음 */
  ai_usage_pct?: number;
}
export interface Plan { id: string; name: string; price_month_krw: number; price_year_krw: number; max_members: number; max_teams: number; monthly_credits: number; core_monthly_cap?: number; features: string[]; sort: number }

// ---- 팀장 노하우 ----
export type KnowhowKind = 'principle' | 'rubric' | 'framework' | 'context' | 'coaching' | 'glossary';
export type KnowhowFeature = 'review' | 'prep' | 'report' | 'evaluation' | 'briefing' | 'strategy' | 'scenario' | 'plan';
export interface KnowhowSource {
  id: string; team_id: string; owner_id: string; title: string; raw_text: string; file_path: string | null; file_name: string | null;
  mime_type: string | null; status: 'pending' | 'processing' | 'done' | 'failed'; error: string | null; summary: string | null;
  card_count: number; created_at: string;
}
export interface KnowhowCard {
  id: string; team_id: string; owner_id: string; source_id: string | null; kind: KnowhowKind; title: string; body: string;
  rules: string[]; applies_to: KnowhowFeature[]; keywords: string[]; active: boolean; pinned: boolean; shared: boolean;
  provenance: 'ai' | 'human' | 'human_edit'; use_count: number; last_used_at: string | null; created_at: string; updated_at: string;
  /** team = 팀장이 넣은 카드 · consulting = 기본 제공 컨설팅 기준 */
  source?: 'team' | 'consulting'; template_key?: string | null;
}


export type OrgNoteKind = 'strategy' | 'exec' | 'request' | 'peer' | 'calendar' | 'other';
export interface OrgNote { id: string; team_id: string; author_id: string | null; kind: OrgNoteKind; title: string; body: string; source: string; event_date: string | null; status: 'open' | 'done'; exec_id?: string | null; created_at: string; updated_at: string }
export interface OrgImpact {
  summary: string; level: 'high' | 'medium' | 'low' | 'none';
  affected?: { item_id: string; title: string; how: string }[];
  actions?: { label: string; kind: 'replan' | 'report' | 'discuss' | 'watch' }[];
  report_line?: string;
}
