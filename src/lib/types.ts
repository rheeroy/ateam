// DB 행 타입 (마이그레이션과 맞춘 수기 타입). 스키마가 커지면 `npm run db:types` 로 생성 타입으로 바꿔도 된다.
export type Role = 'leader' | 'member';
export type TaskStatus = 'planned' | 'in_progress' | 'blocked' | 'done' | 'dropped';
export type AiKind =
  | 'briefing' | 'one_on_one_prep' | 'review' | 'weekly_report'
  | 'evaluation_draft' | 'forecast_note' | 'strategy_check' | 'scenario_note';
export type AiStatus = 'draft' | 'edited' | 'final' | 'withheld';

export interface Profile { id: string; email: string | null; full_name: string; avatar_url: string | null }
export interface Team { id: string; name: string; mission: string; parent_link: string; owner_id: string; settings: Record<string, unknown>; created_at: string }
export interface TeamMember {
  team_id: string; user_id: string; role: Role; job_title: string; weekly_hours: number;
  status: 'active' | 'left'; joined_at: string; profiles?: Profile;
}
export interface Invitation { id: string; team_id: string; email: string; role: Role; job_title: string; token: string; accepted_at: string | null; expires_at: string; created_at: string }

export interface Checkin { id: string; team_id: string; user_id: string; week_start: string; did: string; blocked: string; next: string; condition: number | null; created_at: string; updated_at: string }
export interface OneOnOne {
  id: string; team_id: string; leader_id: string; member_id: string; scheduled_at: string; duration_min: number;
  status: 'scheduled' | 'done' | 'canceled'; shared_notes: string; completed_at: string | null; created_at: string;
}
export interface ActionItem { id: string; team_id: string; one_on_one_id: string | null; owner_id: string; title: string; due_date: string | null; done_at: string | null; created_by: string; created_at: string }
export interface Observation { id: string; team_id: string; author_id: string; subject_id: string; kind: 'praise' | 'concern' | 'note'; competency: string | null; body: string; occurred_at: string; created_at: string }
export interface Submission { id: string; team_id: string; author_id: string; task_id: string | null; title: string; status: 'in_review' | 'needs_work' | 'approved'; approved_at: string | null; created_at: string; updated_at: string }
export interface SubmissionVersion { id: string; submission_id: string; team_id: string; version: number; file_path: string | null; file_name: string | null; mime_type: string | null; extracted_text: string; note: string; created_by: string; created_at: string }
export interface ReviewComment { id: string; submission_id: string; version_id: string | null; team_id: string; parent_id: string | null; author_id: string; section_ref: string | null; body: string; provenance: string; created_at: string }

export interface Goal { id: string; team_id: string; title: string; description: string; sort: number; archived: boolean; created_at: string }
export interface Hypothesis { id: string; team_id: string; goal_id: string | null; statement: string; signal: string; status: 'testing' | 'validated' | 'refuted'; created_at: string }
export interface Task {
  id: string; team_id: string; goal_id: string | null; title: string; owner_id: string | null; priority: number;
  mission_contribution: number; est_hours_per_week: number | null; progress: number; status: TaskStatus;
  start_date: string | null; due_date: string | null; completed_at: string | null; created_at: string; updated_at: string;
}
export interface Metric { id: string; team_id: string; goal_id: string | null; name: string; unit: string; target: number | null; period_start: string; period_end: string; cumulative: boolean; higher_is_better: boolean }
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
export interface PortfolioRow { task_id: string; title: string; goal_id: string | null; mission_contribution: number; hours: number; share_pct: number | null; owner_name: string | null; status: TaskStatus }
export interface CreditStatus {
  plan_id: 'free' | 'pro' | 'pro_plus'; plan_name: string; features: string[]; max_members: number; monthly_credits: number;
  monthly_remaining: number; topup_remaining: number; period_start: string; period_end: string;
  status: string; trial_ends_at: string | null; is_owner: boolean;
}
export interface Plan { id: string; name: string; price_month_krw: number; price_year_krw: number; max_members: number; max_teams: number; monthly_credits: number; features: string[]; sort: number }

// ---- 팀장 노하우 ----
export type KnowhowKind = 'principle' | 'rubric' | 'framework' | 'context' | 'coaching' | 'glossary';
export type KnowhowFeature = 'review' | 'prep' | 'report' | 'evaluation' | 'briefing' | 'strategy' | 'scenario';
export interface KnowhowSource {
  id: string; team_id: string; owner_id: string; title: string; raw_text: string; file_path: string | null; file_name: string | null;
  mime_type: string | null; status: 'pending' | 'processing' | 'done' | 'failed'; error: string | null; summary: string | null;
  card_count: number; created_at: string;
}
export interface KnowhowCard {
  id: string; team_id: string; owner_id: string; source_id: string | null; kind: KnowhowKind; title: string; body: string;
  rules: string[]; applies_to: KnowhowFeature[]; keywords: string[]; active: boolean; pinned: boolean; shared: boolean;
  provenance: 'ai' | 'human' | 'human_edit'; use_count: number; last_used_at: string | null; created_at: string; updated_at: string;
}
