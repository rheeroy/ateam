-- =====================================================================
-- ATEAM · 0001 core schema
-- 백본 ① 아이덴티티·조직 ② 업무 객체 ③ 이벤트 로그 ④ 근거 원장
--      ⑦ 역량 ⑫ 실적 지표 ⑬ 미션·전략 ⑭ 용량 ⑮ 시나리오 + AI 출력(출처)
-- 원칙: "데이터는 소급할 수 없다" — 쓰지 않는 화면이 있어도 테이블은 처음부터.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type public.team_role        as enum ('leader', 'member');
create type public.member_status    as enum ('active', 'left');
create type public.task_status      as enum ('planned', 'in_progress', 'blocked', 'done', 'dropped');
create type public.hypothesis_status as enum ('testing', 'validated', 'refuted');
create type public.meeting_status   as enum ('scheduled', 'done', 'canceled');
create type public.submission_status as enum ('in_review', 'needs_work', 'approved');
create type public.observation_kind as enum ('praise', 'concern', 'note');
create type public.evidence_source  as enum ('checkin', 'one_on_one', 'submission', 'review_comment', 'observation', 'leader_note', 'task', 'metric', 'decision', 'ai');
create type public.polarity         as enum ('positive', 'concern', 'neutral');
-- 출처(provenance): 글은 AI, 숫자는 모델, 결정은 팀장
create type public.provenance       as enum ('human', 'ai', 'model', 'human_edit', 'human_final', 'withheld');
create type public.ai_kind          as enum ('briefing', 'one_on_one_prep', 'review', 'weekly_report', 'evaluation_draft', 'forecast_note', 'strategy_check', 'scenario_note');
create type public.ai_status        as enum ('draft', 'edited', 'final', 'withheld');
create type public.ai_visibility    as enum ('leader', 'subject', 'team');
create type public.outcome_rating   as enum ('hit', 'partial', 'miss');

-- ---------- ① identity & org ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  mission     text not null default '',
  parent_link text not null default '',            -- 상위 연결 (회사 전략 목표 등)
  owner_id    uuid not null references public.profiles(id),
  settings    jsonb not null default '{}'::jsonb,  -- 레벨 조건 등 고객사별 조정값
  created_at  timestamptz not null default now()
);

create table public.team_members (
  team_id       uuid not null references public.teams(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          public.team_role not null default 'member',
  job_title     text not null default '',
  weekly_hours  numeric(5,1) not null default 40,  -- ⑭ 용량 모델의 기본 가용 시간
  status        public.member_status not null default 'active',
  joined_at     timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index on public.team_members (user_id);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  email       text not null,
  role        public.team_role not null default 'member',
  job_title   text not null default '',
  token       uuid not null unique default gen_random_uuid(),
  invited_by  uuid not null references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  expires_at  timestamptz not null default now() + interval '14 days',
  created_at  timestamptz not null default now()
);
create index on public.invitations (team_id);

-- ---------- ⑦ competency model ----------
create table public.competencies (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid references public.teams(id) on delete cascade, -- null = 기본 세트
  name        text not null,
  description text not null default '',
  sort        int not null default 0
);
insert into public.competencies (team_id, name, description, sort) values
  (null, '문제 정의', '무엇을 풀어야 하는지 스스로 정의한다', 1),
  (null, '데이터 분석', '근거를 찾고 해석한다', 2),
  (null, '커뮤니케이션', '상대에 맞게 설득하고 전달한다', 3),
  (null, '협업', '다른 사람·팀과 함께 일을 진전시킨다', 4),
  (null, '실행 관리', '일정·품질·리스크를 관리해 끝까지 해낸다', 5);

-- ---------- ⑬ mission & strategy / ② work objects ----------
create table public.strategic_goals (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  title       text not null,
  description text not null default '',
  sort        int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.strategic_goals (team_id);

create table public.hypotheses (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  goal_id     uuid references public.strategic_goals(id) on delete cascade,
  statement   text not null,
  signal      text not null default '',             -- 지금까지의 신호
  status      public.hypothesis_status not null default 'testing',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.hypotheses (team_id);

create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  team_id              uuid not null references public.teams(id) on delete cascade,
  goal_id              uuid references public.strategic_goals(id) on delete set null,
  title                text not null,
  owner_id             uuid references public.profiles(id) on delete set null,
  priority             smallint not null default 2 check (priority between 1 and 3),
  mission_contribution smallint not null default 3 check (mission_contribution between 1 and 5),
  est_hours_per_week   numeric(5,1),                -- ⑭ 예상 공수 (주당)
  progress             smallint not null default 0 check (progress between 0 and 100),
  status               public.task_status not null default 'planned',
  start_date           date,
  due_date             date,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index on public.tasks (team_id);
create index on public.tasks (owner_id);

create table public.milestones (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  title      text not null,
  due_date   date,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- 공통 활동 ----------
create table public.checkins (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  week_start  date not null,                        -- 월요일
  did         text not null default '',
  blocked     text not null default '',
  next        text not null default '',
  condition   smallint check (condition between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, user_id, week_start)
);
create index on public.checkins (team_id, week_start);

create table public.one_on_ones (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  leader_id     uuid not null references public.profiles(id),
  member_id     uuid not null references public.profiles(id),
  scheduled_at  timestamptz not null,
  duration_min  int not null default 30,
  status        public.meeting_status not null default 'scheduled',
  shared_notes  text not null default '',           -- 팀원도 보는 노트
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.one_on_ones (team_id, scheduled_at);
create index on public.one_on_ones (member_id);

create table public.one_on_one_private (           -- 팀장 메모 (팀장만)
  one_on_one_id uuid primary key references public.one_on_ones(id) on delete cascade,
  team_id       uuid not null references public.teams(id) on delete cascade,
  leader_id     uuid not null references public.profiles(id),
  notes         text not null default '',
  updated_at    timestamptz not null default now()
);

create table public.action_items (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  one_on_one_id uuid references public.one_on_ones(id) on delete set null,
  owner_id      uuid not null references public.profiles(id),
  title         text not null,
  due_date      date,
  done_at       timestamptz,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index on public.action_items (team_id, owner_id);

create table public.observations (                  -- 관찰 메모 (팀장만)
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  author_id   uuid not null references public.profiles(id),
  subject_id  uuid not null references public.profiles(id),
  kind        public.observation_kind not null default 'note',
  competency  text,
  body        text not null,
  occurred_at date not null default current_date,
  created_at  timestamptz not null default now()
);
create index on public.observations (team_id, subject_id);

create table public.submissions (                   -- 결과물 (리뷰룸)
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  author_id   uuid not null references public.profiles(id),
  task_id     uuid references public.tasks(id) on delete set null,
  title       text not null,
  status      public.submission_status not null default 'in_review',
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.submissions (team_id, status);

create table public.submission_versions (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  team_id        uuid not null references public.teams(id) on delete cascade,
  version        int not null,
  file_path      text,                              -- storage: submissions/{team}/{submission}/{version}-{name}
  file_name      text,
  mime_type      text,
  extracted_text text not null default '',          -- docx/txt/md 본문 (pdf는 AI가 직접 읽음)
  note           text not null default '',          -- 이번 버전에서 바뀐 점
  created_by     uuid not null references public.profiles(id),
  created_at     timestamptz not null default now(),
  unique (submission_id, version)
);

create table public.review_comments (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  version_id    uuid references public.submission_versions(id) on delete set null,
  team_id       uuid not null references public.teams(id) on delete cascade,
  parent_id     uuid references public.review_comments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id),
  section_ref   text,                               -- "§2 가격 전략"
  body          text not null,
  provenance    public.provenance not null default 'human',
  created_at    timestamptz not null default now()
);
create index on public.review_comments (submission_id);

-- 리뷰 결과물의 판단 깊이 (AI 1차 검토가 매기는 참고 눈금, 1~4)
create table public.judgment_scores (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  user_id       uuid not null references public.profiles(id),
  submission_id uuid references public.submissions(id) on delete cascade,
  version_id    uuid references public.submission_versions(id) on delete cascade,
  score         numeric(3,1) not null check (score between 0 and 4),
  competencies  jsonb not null default '{}'::jsonb, -- {"문제 정의": 1, ...} 근거 신호
  ai_output_id  uuid,
  scored_at     timestamptz not null default now()
);
create index on public.judgment_scores (team_id, user_id, scored_at);

-- ---------- ⑫ 실적 지표 ----------
create table public.metrics (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  goal_id      uuid references public.strategic_goals(id) on delete set null,
  name         text not null,
  unit         text not null default '',
  target       numeric,
  period_start date not null,
  period_end   date not null,
  cumulative   boolean not null default true,        -- 누적 지표(매출 등) 여부
  higher_is_better boolean not null default true,
  created_at   timestamptz not null default now()
);
create index on public.metrics (team_id);

create table public.metric_values (
  id         uuid primary key default gen_random_uuid(),
  metric_id  uuid not null references public.metrics(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  period     date not null,                          -- 월 첫날
  value      numeric not null,                       -- 해당 월 실적(증분)
  source     text not null default 'manual',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (metric_id, period)
);

create table public.metric_pipeline (                -- 진행 중 딜 (단계별 가중)
  id          uuid primary key default gen_random_uuid(),
  metric_id   uuid not null references public.metrics(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  label       text not null,
  amount      numeric not null,
  probability numeric(4,3) not null check (probability between 0 and 1),
  expected_close date,
  closed      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- ⑭ 용량 / ⑮ 시나리오 / 의사결정 ----------
create table public.task_allocations (
  task_id   uuid not null references public.tasks(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  team_id   uuid not null references public.teams(id) on delete cascade,
  share_pct numeric(5,1) not null check (share_pct between 0 and 100), -- 그 사람 시간의 %
  primary key (task_id, user_id)
);

create table public.scenarios (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null,
  inputs      jsonb not null,
  results     jsonb not null,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.decisions (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.teams(id) on delete cascade,
  title            text not null,
  rationale        text not null default '',
  expected_outcome text not null default '',
  review_on        date,
  scenario_id      uuid references public.scenarios(id) on delete set null,
  outcome          text,
  outcome_rating   public.outcome_rating,
  outcome_at       timestamptz,
  decided_by       uuid not null references public.profiles(id),
  decided_at       timestamptz not null default now()
);
create index on public.decisions (team_id);

-- ---------- AI 출력 (⑨ 게이트웨이의 결과, 출처 표시의 원천) ----------
create table public.ai_outputs (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  kind            public.ai_kind not null,
  subject_user_id uuid references public.profiles(id),
  ref_table       text,
  ref_id          uuid,
  period_start    date,
  period_end      date,
  status          public.ai_status not null default 'draft',
  visibility      public.ai_visibility not null default 'leader',
  level           text,                               -- 'L1'..'L5'
  depth           smallint check (depth between 0 and 4),
  content         jsonb not null,                     -- AI 원본 (절대 덮어쓰지 않음)
  edited_content  jsonb,                              -- 팀장 수정본
  sources         jsonb not null default '[]'::jsonb, -- [{type, id, label}]
  model           text,
  input_tokens    int,
  output_tokens   int,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  edited_by       uuid references public.profiles(id),
  edited_at       timestamptz,
  finalized_by    uuid references public.profiles(id),
  finalized_at    timestamptz
);
create index on public.ai_outputs (team_id, kind, created_at desc);
create index on public.ai_outputs (ref_table, ref_id);

-- ---------- ③ 이벤트 로그 (append-only) ----------
create table public.events (
  id              bigint generated always as identity primary key,
  team_id         uuid not null references public.teams(id) on delete cascade,
  actor_id        uuid references public.profiles(id),
  subject_user_id uuid references public.profiles(id),
  kind            text not null,                      -- 'checkin.created' 등
  ref_table       text,
  ref_id          uuid,
  provenance      public.provenance not null default 'human',
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index on public.events (team_id, created_at desc);
create index on public.events (team_id, subject_user_id);

-- ---------- ④ 근거 원장 ----------
create table public.evidence (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id),
  source          public.evidence_source not null,
  source_id       uuid,
  competency      text,
  polarity        public.polarity not null default 'neutral',
  summary         text not null,
  provenance      public.provenance not null default 'human',
  occurred_at     timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index on public.evidence (team_id, subject_user_id, occurred_at desc);
create unique index evidence_source_uniq on public.evidence (source, source_id, subject_user_id) where source_id is not null;

-- ---------- ⑩ 알림 / ⑧ 연동 ----------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  team_id    uuid references public.teams(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text not null default '',
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, read_at);

create table public.integrations (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  provider   text not null,                          -- google_calendar, slack, jira ...
  status     text not null default 'disconnected',
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (team_id, provider)
);

-- ---------- updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create trigger t_touch before update on public.tasks            for each row execute function public.touch_updated_at();
create trigger t_touch before update on public.hypotheses       for each row execute function public.touch_updated_at();
create trigger t_touch before update on public.checkins         for each row execute function public.touch_updated_at();
create trigger t_touch before update on public.one_on_ones      for each row execute function public.touch_updated_at();
create trigger t_touch before update on public.one_on_one_private for each row execute function public.touch_updated_at();
create trigger t_touch before update on public.submissions      for each row execute function public.touch_updated_at();
