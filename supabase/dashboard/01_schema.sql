-- ATEAM · 대시보드용 스키마 합본 (migrations, 스케줄 제외) — 새 프로젝트의 SQL Editor 에서 한 번 Run

-- >>>>>>>>>> 20261006000001_core.sql
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

-- >>>>>>>>>> 20261006000002_rls.sql
-- =====================================================================
-- ATEAM · 0002 row level security
-- 기본: 팀원은 팀 공용 객체를 보고, 사람에 관한 기록(근거·관찰·평가)은 팀장만.
-- AI 출력은 visibility 에 따라 leader / subject / team.
-- =====================================================================

create or replace function public.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members
                 where team_id = p_team and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_team_leader(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members
                 where team_id = p_team and user_id = auth.uid() and role = 'leader' and status = 'active');
$$;

create or replace function public.shares_team(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members a join team_members b on a.team_id = b.team_id
                 where a.user_id = auth.uid() and b.user_id = p_user);
$$;

create or replace function public.can_see_submission(p_submission uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from submissions s
                 where s.id = p_submission
                   and (s.author_id = auth.uid() or public.is_team_leader(s.team_id)));
$$;

grant execute on function public.is_team_member(uuid), public.is_team_leader(uuid),
  public.shares_team(uuid), public.can_see_submission(uuid) to authenticated;

-- enable RLS everywhere
do $$ declare t text; begin
  foreach t in array array['profiles','teams','team_members','invitations','competencies','strategic_goals',
    'hypotheses','tasks','milestones','checkins','one_on_ones','one_on_one_private','action_items','observations',
    'submissions','submission_versions','review_comments','judgment_scores','metrics','metric_values',
    'metric_pipeline','task_allocations','scenarios','decisions','ai_outputs','events','evidence',
    'notifications','integrations'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- profiles ----------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_team(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- teams ----------
create policy teams_select on public.teams for select to authenticated using (public.is_team_member(id));
create policy teams_update on public.teams for update to authenticated using (public.is_team_leader(id));
-- 팀 생성은 create_team() RPC로만 (구독·멤버십을 같이 만들기 위해)

-- ---------- team_members ----------
create policy tm_select on public.team_members for select to authenticated using (public.is_team_member(team_id));
create policy tm_update on public.team_members for update to authenticated using (public.is_team_leader(team_id));
create policy tm_delete on public.team_members for delete to authenticated
  using (public.is_team_leader(team_id) and user_id <> auth.uid());

-- ---------- invitations ----------
create policy inv_all on public.invitations for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and invited_by = auth.uid());

-- ---------- competencies ----------
create policy comp_select on public.competencies for select to authenticated
  using (team_id is null or public.is_team_member(team_id));
create policy comp_write on public.competencies for all to authenticated
  using (team_id is not null and public.is_team_leader(team_id))
  with check (team_id is not null and public.is_team_leader(team_id));

-- ---------- 팀 공용 객체: 팀원 읽기, 팀장 쓰기 ----------
do $$ declare t text; begin
  foreach t in array array['strategic_goals','hypotheses','metrics','metric_values','metric_pipeline',
                           'task_allocations','scenarios','decisions'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_team_member(team_id))', t);
    execute format('create policy %1$s_write on public.%1$I for all to authenticated using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id))', t);
  end loop;
end $$;

-- tasks: 팀원 읽기, 팀장 쓰기, 담당자는 진척·상태 갱신
create policy tasks_select on public.tasks for select to authenticated using (public.is_team_member(team_id));
create policy tasks_leader on public.tasks for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
create policy tasks_owner_update on public.tasks for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy ms_select on public.milestones for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and public.is_team_member(t.team_id)));
create policy ms_write on public.milestones for all to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and (public.is_team_leader(t.team_id) or t.owner_id = auth.uid())))
  with check (exists (select 1 from tasks t where t.id = task_id and (public.is_team_leader(t.team_id) or t.owner_id = auth.uid())));

-- ---------- checkins: 본인 + 팀장 ----------
create policy ci_select on public.checkins for select to authenticated
  using (user_id = auth.uid() or public.is_team_leader(team_id));
create policy ci_insert on public.checkins for insert to authenticated
  with check (user_id = auth.uid() and public.is_team_member(team_id));
create policy ci_update on public.checkins for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 1on1 ----------
create policy oo_select on public.one_on_ones for select to authenticated
  using (public.is_team_leader(team_id) or member_id = auth.uid());
create policy oo_leader on public.one_on_ones for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and leader_id = auth.uid());
create policy oo_member_update on public.one_on_ones for update to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

-- 팀원은 shared_notes 만 바꿀 수 있다
create or replace function public.guard_one_on_one_member_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_leader(old.team_id) then
    if new.leader_id <> old.leader_id or new.member_id <> old.member_id or new.team_id <> old.team_id
       or new.scheduled_at <> old.scheduled_at or new.status <> old.status
       or new.duration_min <> old.duration_min then
      raise exception '팀원은 함께 보는 노트만 수정할 수 있습니다';
    end if;
  end if;
  return new;
end $$;
create trigger t_guard_oo before update on public.one_on_ones
  for each row execute function public.guard_one_on_one_member_update();

create policy oop_all on public.one_on_one_private for all to authenticated
  using (leader_id = auth.uid() and public.is_team_leader(team_id))
  with check (leader_id = auth.uid() and public.is_team_leader(team_id));

create policy ai_items_select on public.action_items for select to authenticated
  using (owner_id = auth.uid() or created_by = auth.uid() or public.is_team_leader(team_id)
         or exists (select 1 from one_on_ones o where o.id = one_on_one_id and o.member_id = auth.uid()));
create policy ai_items_insert on public.action_items for insert to authenticated
  with check (created_by = auth.uid() and public.is_team_member(team_id));
create policy ai_items_update on public.action_items for update to authenticated
  using (owner_id = auth.uid() or created_by = auth.uid() or public.is_team_leader(team_id));
create policy ai_items_delete on public.action_items for delete to authenticated
  using (created_by = auth.uid() or public.is_team_leader(team_id));

-- ---------- 관찰 메모: 팀장만 ----------
create policy obs_all on public.observations for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and author_id = auth.uid());

-- ---------- 결과물 / 리뷰 ----------
create policy sub_select on public.submissions for select to authenticated
  using (author_id = auth.uid() or public.is_team_leader(team_id));
create policy sub_insert on public.submissions for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id));
create policy sub_update on public.submissions for update to authenticated
  using (author_id = auth.uid() or public.is_team_leader(team_id));

create policy sv_select on public.submission_versions for select to authenticated
  using (public.can_see_submission(submission_id));
create policy sv_insert on public.submission_versions for insert to authenticated
  with check (created_by = auth.uid() and public.can_see_submission(submission_id));

create policy rc_select on public.review_comments for select to authenticated
  using (public.can_see_submission(submission_id));
create policy rc_insert on public.review_comments for insert to authenticated
  with check (author_id = auth.uid() and provenance = 'human' and public.can_see_submission(submission_id));
create policy rc_delete on public.review_comments for delete to authenticated
  using (author_id = auth.uid());

create policy js_select on public.judgment_scores for select to authenticated using (public.is_team_leader(team_id));

-- ---------- AI 출력 ----------
create policy aio_select on public.ai_outputs for select to authenticated
  using (public.is_team_leader(team_id)
         or (visibility = 'team' and public.is_team_member(team_id))
         or (visibility = 'subject' and subject_user_id = auth.uid() and status = 'final'));
-- 생성은 Edge Function(service_role)만. 팀장은 수정·확정만.
create policy aio_update on public.ai_outputs for update to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

create or replace function public.guard_ai_output_update() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' then
    -- AI 원본·근거·모델 정보는 바꿀 수 없다
    new.content := old.content; new.sources := old.sources; new.model := old.model;
    new.kind := old.kind; new.team_id := old.team_id; new.created_at := old.created_at;
    new.input_tokens := old.input_tokens; new.output_tokens := old.output_tokens;
    if new.edited_content is distinct from old.edited_content then
      new.edited_by := auth.uid(); new.edited_at := now();
      if new.status = 'draft' then new.status := 'edited'; end if;
    end if;
    if new.status = 'final' and old.status <> 'final' then
      new.finalized_by := auth.uid(); new.finalized_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger t_guard_aio before update on public.ai_outputs
  for each row execute function public.guard_ai_output_update();

-- ---------- 이벤트·근거: 팀장 읽기 (쓰기는 트리거/서비스) ----------
create policy ev_select on public.events for select to authenticated using (public.is_team_leader(team_id));
create policy evd_select on public.evidence for select to authenticated using (public.is_team_leader(team_id));
create policy evd_leader_insert on public.evidence for insert to authenticated
  with check (public.is_team_leader(team_id) and source = 'leader_note' and created_by = auth.uid());

-- ---------- 알림 / 연동 ----------
create policy nt_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy nt_read on public.notifications for update to authenticated using (user_id = auth.uid());
create policy int_leader on public.integrations for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

-- >>>>>>>>>> 20261006000003_billing.sql
-- =====================================================================
-- ATEAM · 0003 billing (팀장 개인 구독 + AI 크레딧)
-- - 결제 주체는 팀장 1인. 팀원은 무료로 초대된다.
-- - 팀의 요금제 = 팀 소유자(owner_id)의 구독.
-- - AI 사용은 크레딧으로 차감: 월 기본 제공분 → 소진 후 추가 구매분 순서.
-- =====================================================================

create table public.plans (
  id               text primary key,                 -- free / pro / pro_plus
  name             text not null,
  price_month_krw  int not null,                     -- VAT 별도
  price_year_krw   int not null,
  max_members      int not null,                     -- 팀장 제외 팀원 수
  max_teams        int not null,                     -- 겸직 팀장
  monthly_credits  int not null,
  features         text[] not null,
  sort             int not null default 0,
  active           boolean not null default true
);

insert into public.plans values
  ('free',     'Free',  0,      0,       4,  1,  30,
   array['checkin','one_on_one','review_room','weekly_report','briefing','prep','ai_review'], 1, true),
  ('pro',      'Pro',   29000,  290000,  12, 1,  300,
   array['checkin','one_on_one','review_room','weekly_report','briefing','prep','ai_review',
         'perf_map','forecast','strategy','simulation','evaluation','insight','care_radar'], 2, true),
  ('pro_plus', 'Pro+',  59000,  590000,  30, 3,  800,
   array['checkin','one_on_one','review_room','weekly_report','briefing','prep','ai_review',
         'perf_map','forecast','strategy','simulation','evaluation','insight','care_radar',
         'integrations','multi_team','priority_model'], 3, true);

create type public.sub_status as enum ('trialing', 'active', 'past_due', 'canceled');

create table public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null unique references public.profiles(id) on delete cascade,
  plan_id               text not null references public.plans(id),
  status                public.sub_status not null default 'trialing',
  billing_cycle         text not null default 'month' check (billing_cycle in ('month','year')),
  trial_ends_at         timestamptz,
  current_period_start  timestamptz not null default now(),
  current_period_end    timestamptz not null default now() + interval '1 month',
  cancel_at_period_end  boolean not null default false,
  provider              text not null default 'tosspayments',
  customer_key          uuid not null default gen_random_uuid(),   -- 토스 customerKey
  card_company          text,
  card_last4            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 빌링키는 클라이언트에 절대 노출하지 않는다 (정책 없음 = service_role 전용)
create table public.billing_secrets (
  subscription_id uuid primary key references public.subscriptions(id) on delete cascade,
  billing_key     text not null,
  updated_at      timestamptz not null default now()
);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions(id) on delete set null,
  owner_id        uuid not null references public.profiles(id),
  kind            text not null check (kind in ('subscription','topup')),
  order_id        text not null unique,
  order_name      text not null,
  amount_krw      int not null,                       -- VAT 포함 결제 금액
  status          text not null default 'pending',    -- pending / done / failed / canceled
  paid_at         timestamptz,
  receipt_url     text,
  failure_reason  text,
  raw             jsonb,
  created_at      timestamptz not null default now()
);
create index on public.payments (owner_id, created_at desc);

create table public.credit_balances (
  owner_id           uuid primary key references public.profiles(id) on delete cascade,
  period_start       timestamptz not null,
  monthly_remaining  int not null,
  topup_remaining    int not null default 0,
  updated_at         timestamptz not null default now()
);

create table public.credit_ledger (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  team_id        uuid references public.teams(id) on delete set null,
  delta          int not null,
  reason         text not null check (reason in ('monthly_grant','topup','usage','refund','adjust')),
  ai_kind        text,
  ai_output_id   uuid,
  model          text,
  input_tokens   int,
  output_tokens  int,
  cost_usd       numeric(10,5),
  created_at     timestamptz not null default now()
);
create index on public.credit_ledger (owner_id, created_at desc);

alter table public.plans           enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.billing_secrets enable row level security;
alter table public.payments        enable row level security;
alter table public.credit_balances enable row level security;
alter table public.credit_ledger   enable row level security;

create policy plans_read on public.plans for select to anon, authenticated using (active);
create policy subs_own   on public.subscriptions for select to authenticated using (owner_id = auth.uid());
create policy pay_own    on public.payments for select to authenticated using (owner_id = auth.uid());
create policy cb_own     on public.credit_balances for select to authenticated using (owner_id = auth.uid());
create policy cl_own     on public.credit_ledger for select to authenticated using (owner_id = auth.uid());

create trigger t_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

-- ---------- 유효 요금제 ----------
create or replace function public.effective_plan_for_owner(p_owner uuid) returns public.plans
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p from subscriptions s join plans p on p.id = s.plan_id
      where s.owner_id = p_owner
        and s.status in ('trialing','active','past_due')
        and now() < s.current_period_end + case when s.status = 'past_due' then interval '7 days' else interval '0' end),
    (select p from plans p where p.id = 'free'));
$$;

create or replace function public.team_plan(p_team uuid) returns public.plans
language sql stable security definer set search_path = public as $$
  select public.effective_plan_for_owner((select owner_id from teams where id = p_team));
$$;

create or replace function public.team_has_feature(p_team uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_feature = any((public.team_plan(p_team)).features);
$$;

-- 월 크레딧 리셋(구독 주기 기준, 연간 결제도 월 단위로 지급)
create or replace function public._ensure_credit_period(p_owner uuid) returns public.credit_balances
language plpgsql security definer set search_path = public as $$
declare
  v_plan  plans := public.effective_plan_for_owner(p_owner);
  v_start timestamptz;
  v_sub   subscriptions;
  v_bal   credit_balances;
  v_amount int;
begin
  select * into v_sub from subscriptions where owner_id = p_owner;
  -- 구독 시작 시각을 기준으로 한 이번 달 주기의 시작
  v_start := coalesce(v_sub.current_period_start, date_trunc('month', now()));
  while v_start + interval '1 month' <= now() loop v_start := v_start + interval '1 month'; end loop;
  while v_start > now() loop v_start := v_start - interval '1 month'; end loop;

  -- 체험 기간에는 월 제공량 대신 100 크레딧만 (남용 방지)
  v_amount := case when v_sub.status = 'trialing' then least(v_plan.monthly_credits, 100) else v_plan.monthly_credits end;

  select * into v_bal from credit_balances where owner_id = p_owner for update;
  if not found then
    insert into credit_balances (owner_id, period_start, monthly_remaining)
      values (p_owner, v_start, v_amount) returning * into v_bal;
    insert into credit_ledger (owner_id, delta, reason) values (p_owner, v_amount, 'monthly_grant');
  elsif v_bal.period_start < v_start then
    update credit_balances set period_start = v_start, monthly_remaining = v_amount, updated_at = now()
      where owner_id = p_owner returning * into v_bal;
    insert into credit_ledger (owner_id, delta, reason) values (p_owner, v_amount, 'monthly_grant');
  end if;
  return v_bal;
end $$;

create or replace function public.credit_status(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_bal credit_balances; v_plan plans; v_sub subscriptions;
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select owner_id into v_owner from teams where id = p_team;
  v_bal := public._ensure_credit_period(v_owner);
  v_plan := public.effective_plan_for_owner(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  return jsonb_build_object(
    'plan_id', v_plan.id, 'plan_name', v_plan.name, 'features', to_jsonb(v_plan.features),
    'max_members', v_plan.max_members, 'monthly_credits', v_plan.monthly_credits,
    'monthly_remaining', v_bal.monthly_remaining, 'topup_remaining', v_bal.topup_remaining,
    'period_start', v_bal.period_start, 'period_end', v_bal.period_start + interval '1 month',
    'status', coalesce(v_sub.status::text, 'free'), 'trial_ends_at', v_sub.trial_ends_at,
    'is_owner', v_owner = auth.uid());
end $$;

-- AI 호출 1건의 크레딧 차감 (Edge Function이 service_role로 호출)
create or replace function public.consume_credits(
  p_team uuid, p_credits int, p_kind text, p_ai_output uuid default null,
  p_model text default null, p_in int default null, p_out int default null, p_cost numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_bal credit_balances; v_from_month int; v_from_topup int;
begin
  select owner_id into v_owner from teams where id = p_team;
  v_bal := public._ensure_credit_period(v_owner);
  select * into v_bal from credit_balances where owner_id = v_owner for update;
  if v_bal.monthly_remaining + v_bal.topup_remaining < p_credits then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;
  v_from_month := least(v_bal.monthly_remaining, p_credits);
  v_from_topup := p_credits - v_from_month;
  update credit_balances
     set monthly_remaining = monthly_remaining - v_from_month,
         topup_remaining   = topup_remaining - v_from_topup, updated_at = now()
   where owner_id = v_owner;
  insert into credit_ledger (owner_id, team_id, delta, reason, ai_kind, ai_output_id, model, input_tokens, output_tokens, cost_usd)
    values (v_owner, p_team, -p_credits, 'usage', p_kind, p_ai_output, p_model, p_in, p_out, p_cost);
  return jsonb_build_object('monthly_remaining', v_bal.monthly_remaining - v_from_month,
                            'topup_remaining', v_bal.topup_remaining - v_from_topup);
end $$;

-- 추가 크레딧 지급 (결제 완료 후 service_role)
create or replace function public.grant_topup(p_owner uuid, p_credits int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._ensure_credit_period(p_owner);
  update credit_balances set topup_remaining = topup_remaining + p_credits, updated_at = now() where owner_id = p_owner;
  insert into credit_ledger (owner_id, delta, reason) values (p_owner, p_credits, 'topup');
end $$;

revoke all on function public.consume_credits(uuid,int,text,uuid,text,int,int,numeric) from public, anon, authenticated;
revoke all on function public.grant_topup(uuid,int) from public, anon, authenticated;
revoke all on function public._ensure_credit_period(uuid) from public, anon, authenticated;
grant execute on function public.credit_status(uuid), public.team_has_feature(uuid,text), public.team_plan(uuid) to authenticated;

-- >>>>>>>>>> 20261006000004_logic.sql
-- =====================================================================
-- ATEAM · 0004 triggers (③ 이벤트 로그, ④ 근거 원장) + RPC + 분석 함수
-- 숫자를 내는 것은 여기 SQL 함수(모델)이고, AI는 해석만 한다.
-- =====================================================================

-- ---------- 신규 가입 → 프로필 ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 공통: 이벤트 기록 ----------
create or replace function public.log_event(p_team uuid, p_kind text, p_ref_table text, p_ref uuid,
  p_subject uuid default null, p_prov public.provenance default 'human', p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into events (team_id, actor_id, subject_user_id, kind, ref_table, ref_id, provenance, payload)
  values (p_team, auth.uid(), p_subject, p_kind, p_ref_table, p_ref, p_prov, p_payload);
$$;

create or replace function public.upsert_evidence(p_team uuid, p_subject uuid, p_source public.evidence_source,
  p_source_id uuid, p_summary text, p_polarity public.polarity default 'neutral', p_competency text default null,
  p_occurred timestamptz default now(), p_prov public.provenance default 'human')
returns void language sql security definer set search_path = public as $$
  insert into evidence (team_id, subject_user_id, source, source_id, summary, polarity, competency, occurred_at, provenance, created_by)
  values (p_team, p_subject, p_source, p_source_id, left(coalesce(nullif(p_summary, ''), '(내용 없음)'), 400),
          p_polarity, p_competency, p_occurred, p_prov, auth.uid())
  on conflict (source, source_id, subject_user_id) where source_id is not null
  do update set summary = excluded.summary, polarity = excluded.polarity, competency = excluded.competency;
$$;

-- 체크인
create or replace function public.trg_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_event(new.team_id, case when tg_op = 'INSERT' then 'checkin.created' else 'checkin.updated' end,
                    'checkins', new.id, new.user_id, 'human',
                    jsonb_build_object('week_start', new.week_start, 'condition', new.condition, 'blocked', new.blocked <> ''));
  perform upsert_evidence(new.team_id, new.user_id, 'checkin', new.id,
    new.did || case when new.blocked <> '' then ' / 막힘: ' || new.blocked else '' end,
    (case when new.blocked <> '' then 'concern' else 'neutral' end)::polarity, null, new.week_start::timestamptz);
  return new;
end $$;
create trigger t_checkin_log after insert or update on public.checkins for each row execute function public.trg_checkin();

-- 관찰 메모
create or replace function public.trg_observation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_event(new.team_id, 'observation.created', 'observations', new.id, new.subject_id);
  perform upsert_evidence(new.team_id, new.subject_id, 'observation', new.id, new.body,
    case new.kind when 'praise' then 'positive' when 'concern' then 'concern' else 'neutral' end::polarity,
    new.competency, new.occurred_at::timestamptz);
  return new;
end $$;
create trigger t_obs_log after insert or update on public.observations for each row execute function public.trg_observation();

-- 1on1 완료
create or replace function public.trg_one_on_one() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := coalesce(new.completed_at, now());
    perform log_event(new.team_id, 'one_on_one.done', 'one_on_ones', new.id, new.member_id);
    perform upsert_evidence(new.team_id, new.member_id, 'one_on_one', new.id,
      '1on1 — ' || left(new.shared_notes, 300), 'neutral', null, new.scheduled_at);
  end if;
  return new;
end $$;
create trigger t_oo_log before insert or update on public.one_on_ones for each row execute function public.trg_one_on_one();

-- 팀장 메모 (1on1 비공개)
create or replace function public.trg_oo_private() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_member uuid; v_at timestamptz;
begin
  if coalesce(new.notes, '') = '' then return new; end if;
  select member_id, scheduled_at into v_member, v_at from one_on_ones where id = new.one_on_one_id;
  perform upsert_evidence(new.team_id, v_member, 'leader_note', new.one_on_one_id, new.notes, 'neutral', null, v_at);
  return new;
end $$;
create trigger t_oop_log after insert or update on public.one_on_one_private for each row execute function public.trg_oo_private();

-- 결과물 버전 업로드
create or replace function public.trg_submission_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions;
begin
  select * into v_sub from submissions where id = new.submission_id;
  update submissions set status = 'in_review', updated_at = now() where id = new.submission_id;
  perform log_event(new.team_id, 'submission.version', 'submission_versions', new.id, v_sub.author_id, 'human',
                    jsonb_build_object('version', new.version, 'title', v_sub.title));
  perform upsert_evidence(new.team_id, v_sub.author_id, 'submission', new.id,
    v_sub.title || ' v' || new.version || case when new.note <> '' then ' — ' || new.note else '' end,
    'neutral', null, new.created_at);
  return new;
end $$;
create trigger t_sv_log after insert on public.submission_versions for each row execute function public.trg_submission_version();

-- 결과물 승인 / 보완 요청
create or replace function public.trg_submission_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then new.approved_at := now(); new.approved_by := auth.uid(); end if;
    perform log_event(new.team_id, 'submission.' || new.status::text, 'submissions', new.id, new.author_id);
    if new.status = 'approved' then
      perform upsert_evidence(new.team_id, new.author_id, 'submission', new.id, new.title || ' — 승인', 'positive', null, now());
    end if;
  end if;
  return new;
end $$;
create trigger t_sub_status before update on public.submissions for each row execute function public.trg_submission_status();

-- 리뷰 코멘트 (팀장 코멘트는 근거)
create or replace function public.trg_review_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions;
begin
  select * into v_sub from submissions where id = new.submission_id;
  perform log_event(new.team_id, 'review.comment', 'review_comments', new.id, v_sub.author_id, new.provenance);
  if new.author_id <> v_sub.author_id and public.is_team_leader(new.team_id) then
    perform upsert_evidence(new.team_id, v_sub.author_id, 'review_comment', new.id,
      coalesce(new.section_ref || ' · ', '') || new.body, 'neutral', null, new.created_at);
  end if;
  return new;
end $$;
create trigger t_rc_log after insert on public.review_comments for each row execute function public.trg_review_comment();

-- 과제 완료 / 담당자 갱신 제한
create or replace function public.trg_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and not public.is_team_leader(old.team_id) and auth.role() = 'authenticated' then
    if new.team_id <> old.team_id or new.owner_id is distinct from old.owner_id or new.title <> old.title
       or new.goal_id is distinct from old.goal_id or new.priority <> old.priority
       or new.mission_contribution <> old.mission_contribution then
      raise exception '담당자는 진척률과 상태만 바꿀 수 있습니다';
    end if;
  end if;
  if new.status = 'done' then
    new.progress := 100;
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  if tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done' and new.owner_id is not null then
    perform log_event(new.team_id, 'task.done', 'tasks', new.id, new.owner_id);
    perform upsert_evidence(new.team_id, new.owner_id, 'task', new.id, '과제 완료 — ' || new.title, 'positive', '실행 관리', now());
  end if;
  return new;
end $$;
create trigger t_task before insert or update on public.tasks for each row execute function public.trg_task();

-- 의사결정
create or replace function public.trg_decision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_event(new.team_id, 'decision.created', 'decisions', new.id);
  elsif new.outcome_rating is distinct from old.outcome_rating then
    new.outcome_at := now();
    perform log_event(new.team_id, 'decision.outcome', 'decisions', new.id, null, 'human',
                      jsonb_build_object('rating', new.outcome_rating));
  end if;
  return new;
end $$;
create trigger t_decision before insert or update on public.decisions for each row execute function public.trg_decision();

-- AI 출력 → 출처 이벤트
create or replace function public.trg_ai_output() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_event(new.team_id, 'ai.' || new.kind::text || '.' || new.status::text, 'ai_outputs', new.id,
    new.subject_user_id,
    case new.status when 'draft' then 'ai' when 'edited' then 'human_edit' when 'final' then 'human_final' else 'withheld' end::provenance);
  return new;
end $$;
create trigger t_aio_log after insert or update of status, edited_content on public.ai_outputs
  for each row execute function public.trg_ai_output();

-- 실적 입력
create or replace function public.trg_metric_value() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_event(new.team_id, 'metric.value', 'metric_values', new.id, null, 'human',
                    jsonb_build_object('metric_id', new.metric_id, 'period', new.period, 'value', new.value));
  return new;
end $$;
create trigger t_mv_log after insert or update on public.metric_values for each row execute function public.trg_metric_value();

-- =====================================================================
-- RPC: 팀 만들기 / 초대 / 수락
-- =====================================================================
create or replace function public.create_team(p_name text, p_mission text default '', p_job_title text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_plan plans; v_owned int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from subscriptions where owner_id = auth.uid()) then
    -- 첫 팀 생성 시 Pro 14일 체험
    insert into subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (auth.uid(), 'pro', 'trialing', now() + interval '14 days', now(), now() + interval '14 days');
  end if;
  v_plan := public.effective_plan_for_owner(auth.uid());
  select count(*) into v_owned from teams where owner_id = auth.uid();
  if v_owned >= v_plan.max_teams then
    raise exception 'PLAN_LIMIT_TEAMS' using errcode = 'P0001', hint = v_plan.max_teams::text;
  end if;
  insert into teams (name, mission, owner_id) values (p_name, coalesce(p_mission, ''), auth.uid()) returning id into v_team;
  insert into team_members (team_id, user_id, role, job_title) values (v_team, auth.uid(), 'leader', coalesce(p_job_title, ''));
  perform log_event(v_team, 'team.created', 'teams', v_team);
  return v_team;
end $$;

create or replace function public.team_seat_usage(p_team uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'members', (select count(*) from team_members where team_id = p_team and role = 'member' and status = 'active'),
    'pending', (select count(*) from invitations where team_id = p_team and accepted_at is null and expires_at > now()),
    'max_members', (public.team_plan(p_team)).max_members);
$$;

create or replace function public.create_invitation(p_team uuid, p_email text, p_job_title text default '',
  p_role public.team_role default 'member') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_usage jsonb; v_token uuid;
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden'; end if;
  v_usage := public.team_seat_usage(p_team);
  if p_role = 'member' and (v_usage->>'members')::int + (v_usage->>'pending')::int >= (v_usage->>'max_members')::int then
    raise exception 'PLAN_LIMIT_MEMBERS' using errcode = 'P0001', hint = v_usage->>'max_members';
  end if;
  insert into invitations (team_id, email, role, job_title, invited_by)
  values (p_team, lower(trim(p_email)), p_role, coalesce(p_job_title, ''), auth.uid())
  returning token into v_token;
  return v_token;
end $$;

create or replace function public.invitation_preview(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('team_name', t.name, 'inviter', p.full_name, 'email', i.email,
                            'expired', i.expires_at < now(), 'accepted', i.accepted_at is not null)
  from invitations i join teams t on t.id = i.team_id join profiles p on p.id = i.invited_by
  where i.token = p_token;
$$;

create or replace function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv invitations; v_usage jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invitations where token = p_token for update;
  if not found then raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_inv.accepted_at is not null and v_inv.accepted_by <> auth.uid() then raise exception 'INVITE_USED' using errcode = 'P0001'; end if;
  if v_inv.expires_at < now() then raise exception 'INVITE_EXPIRED' using errcode = 'P0001'; end if;
  if v_inv.role = 'member' then
    v_usage := public.team_seat_usage(v_inv.team_id);
    if (v_usage->>'members')::int >= (v_usage->>'max_members')::int then
      raise exception 'PLAN_LIMIT_MEMBERS' using errcode = 'P0001';
    end if;
  end if;
  insert into team_members (team_id, user_id, role, job_title)
  values (v_inv.team_id, auth.uid(), v_inv.role, v_inv.job_title)
  on conflict (team_id, user_id) do update set status = 'active', role = excluded.role;
  update invitations set accepted_at = coalesce(accepted_at, now()), accepted_by = auth.uid() where id = v_inv.id;
  perform log_event(v_inv.team_id, 'member.joined', 'team_members', null, auth.uid());
  return v_inv.team_id;
end $$;

grant execute on function public.create_team(text,text,text), public.create_invitation(uuid,text,text,public.team_role),
  public.invitation_preview(uuid), public.accept_invitation(uuid), public.team_seat_usage(uuid) to authenticated;

-- =====================================================================
-- 분석 함수 (모델 계산)
-- =====================================================================
create or replace function public._assert_leader(p_team uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and not public.is_team_leader(p_team) then raise exception 'forbidden'; end if;
end $$;

-- 케어 레이더: 정해진 신호 4종
create or replace function public.care_radar(p_team uuid)
returns table (user_id uuid, full_name text, job_title text, signals jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assert_leader(p_team);
  return query
  with m as (
    select tm.user_id, p.full_name, tm.job_title, tm.joined_at
    from team_members tm join profiles p on p.id = tm.user_id
    where tm.team_id = p_team and tm.status = 'active' and tm.role = 'member'
  ), last3 as (
    select c.user_id, array_agg(c.condition order by c.week_start desc) as conds,
           array_agg(c.blocked order by c.week_start desc) as blocks,
           array_agg(c.week_start order by c.week_start desc) as weeks
    from (select *, row_number() over (partition by c0.user_id order by c0.week_start desc) rn
          from checkins c0 where c0.team_id = p_team) c
    where c.rn <= 3 group by c.user_id
  ), oo as (
    select o.member_id, max(o.scheduled_at) as last_at
    from one_on_ones o where o.team_id = p_team and o.status = 'done' group by o.member_id
  ), sig as (
    select m.user_id, m.full_name, m.job_title,
      jsonb_strip_nulls(jsonb_build_array(
        case when array_length(l.conds, 1) = 3 and l.conds[1] < l.conds[2] and l.conds[2] < l.conds[3] and l.conds[1] <= 3
             then jsonb_build_object('type', 'condition_down', 'label', '컨디션 ' || l.conds[3] || ' → ' || l.conds[2] || ' → ' || l.conds[1]) end,
        case when coalesce(oo.last_at, m.joined_at) < now() - interval '14 days'
             then jsonb_build_object('type', 'no_one_on_one', 'label', '1on1 ' || extract(day from now() - coalesce(oo.last_at, m.joined_at))::int || '일째 없음') end,
        case when extract(isodow from now()) >= 3 and (l.weeks is null or l.weeks[1] < date_trunc('week', now())::date)
             then jsonb_build_object('type', 'checkin_missing', 'label', '이번 주 체크인 미제출') end,
        case when array_length(l.blocks, 1) >= 2 and l.blocks[1] <> '' and l.blocks[2] <> '' and l.weeks[1] - l.weeks[2] <= 7
             then jsonb_build_object('type', 'blocked_repeat', 'label', '2주째 막힘', 'detail', l.blocks[1]) end
      )) as arr
    from m left join last3 l on l.user_id = m.user_id left join oo on oo.member_id = m.user_id
  )
  select s.user_id, s.full_name, s.job_title,
         (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(s.arr) e where e <> 'null'::jsonb)
  from sig s
  where exists (select 1 from jsonb_array_elements(s.arr) e where e <> 'null'::jsonb)
  order by (select count(*) from jsonb_array_elements(s.arr) e where e <> 'null'::jsonb) desc;
end $$;

-- 판단 근거 = 결과물·관찰·리뷰 코멘트·팀장 메모 (체크인·1on1 기록은 맥락)
create or replace function public.member_data_depth(p_team uuid)
returns table (user_id uuid, full_name text, job_title text, checkin_weeks int, one_on_ones int,
               submissions int, observations int, judgment_evidence int, eligible boolean, can_see text)
language plpgsql stable security definer set search_path = public as $$
declare v_min int := coalesce(((select settings from teams where id = p_team)->>'min_judgment_evidence')::int, 8);
begin
  perform public._assert_leader(p_team);
  return query
  select tm.user_id, p.full_name, tm.job_title,
    (select count(distinct c.week_start) from checkins c where c.team_id = p_team and c.user_id = tm.user_id)::int,
    (select count(*) from one_on_ones o where o.team_id = p_team and o.member_id = tm.user_id and o.status = 'done')::int,
    (select count(*) from submission_versions v join submissions s on s.id = v.submission_id
      where s.team_id = p_team and s.author_id = tm.user_id)::int,
    (select count(*) from observations ob where ob.team_id = p_team and ob.subject_id = tm.user_id)::int,
    (select count(*) from evidence e where e.team_id = p_team and e.subject_user_id = tm.user_id
      and e.source in ('submission','observation','review_comment','leader_note','task'))::int as je,
    (select count(*) from evidence e where e.team_id = p_team and e.subject_user_id = tm.user_id
      and e.source in ('submission','observation','review_comment','leader_note','task')) >= v_min,
    case
      when (select count(*) from evidence e where e.team_id = p_team and e.subject_user_id = tm.user_id
              and e.source in ('submission','observation','review_comment','leader_note','task')) >= v_min
        then case when (select count(distinct c.week_start) from checkins c where c.team_id = p_team and c.user_id = tm.user_id) >= 12
                  then '진단·추세' else '진단' end
      when (select count(distinct c.week_start) from checkins c where c.team_id = p_team and c.user_id = tm.user_id) >= 4
        then '패턴 (판단 보류)'
      else '기록 정리 (판단 보류)'
    end
  from team_members tm join profiles p on p.id = tm.user_id
  where tm.team_id = p_team and tm.status = 'active' and tm.role = 'member'
  order by p.full_name;
end $$;

-- 팀 인사이트 레벨 (⑰ 데이터 깊이 지표)
create or replace function public.team_insight_level(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_members int; v_ci_weeks int; v_oo int; v_reviewed int; v_elig int; v_metric_months int;
  v_effort_pct int; v_dec_outcome int; v_approved int; v_quarters int;
  v_checkins int; v_obs int; v_subs int;
  v_levels jsonb; v_level int := 1; v_next jsonb; v_i int; v_ok boolean; v_progress numeric;
  v_min_ev int := coalesce(((select settings from teams where id = p_team)->>'min_judgment_evidence')::int, 8);
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select greatest(count(*), 1) into v_members from team_members where team_id = p_team and status = 'active' and role = 'member';
  select count(distinct week_start), count(*) into v_ci_weeks, v_checkins from checkins where team_id = p_team;
  select count(*) into v_oo from one_on_ones where team_id = p_team and status = 'done';
  select count(distinct s.id) into v_reviewed from submissions s where s.team_id = p_team
    and (exists (select 1 from review_comments rc where rc.submission_id = s.id and rc.author_id <> s.author_id)
         or exists (select 1 from ai_outputs a join submission_versions sv on sv.id = a.ref_id
                    where a.ref_table = 'submission_versions' and sv.submission_id = s.id and a.kind = 'review'));
  select count(*) into v_subs from submission_versions where team_id = p_team;
  select count(*) into v_obs from observations where team_id = p_team;
  select count(*) into v_elig from (
    select subject_user_id from evidence where team_id = p_team and source in ('submission','observation','review_comment','leader_note','task')
    group by subject_user_id having count(*) >= v_min_ev) x;
  select coalesce(max(n), 0) into v_metric_months from (
    select count(distinct period) n from metric_values where team_id = p_team group by metric_id) x;
  select coalesce(round(100.0 * count(*) filter (where est_hours_per_week is not null or exists (select 1 from task_allocations ta where ta.task_id = t.id))
                        / nullif(count(*), 0)), 0)
    into v_effort_pct from tasks t where team_id = p_team and status in ('planned','in_progress','blocked');
  select count(*) into v_dec_outcome from decisions where team_id = p_team and outcome_rating is not null;
  select count(*) into v_approved from submissions where team_id = p_team and status = 'approved';
  select count(distinct date_trunc('quarter', period)) into v_quarters from metric_values
    where team_id = p_team and date_trunc('quarter', period) + interval '3 months' <= now();

  v_levels := jsonb_build_array(
    jsonb_build_object('level', 1, 'name', '기록 정리', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '사용 시작', 'current', 1, 'target', 1))),
    jsonb_build_object('level', 2, 'name', '패턴 발견', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '체크인이 쌓인 주', 'current', v_ci_weeks, 'target', 4, 'unit', '주'),
      jsonb_build_object('label', '완료된 1on1', 'current', v_oo, 'target', 2 * v_members, 'unit', '회'))),
    jsonb_build_object('level', 3, 'name', '진단', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '판단 근거 ' || v_min_ev || '건 이상인 팀원', 'current', v_elig, 'target', ceil(v_members / 2.0)::int, 'unit', '명'),
      jsonb_build_object('label', '리뷰한 결과물', 'current', v_reviewed, 'target', greatest(12, 5 * v_members), 'unit', '건'))),
    jsonb_build_object('level', 4, 'name', '예측', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '실적 데이터', 'current', v_metric_months, 'target', 3, 'unit', '개월'),
      jsonb_build_object('label', '과제 공수 입력률', 'current', v_effort_pct, 'target', 60, 'unit', '%'))),
    jsonb_build_object('level', 5, 'name', '팀 고유 인사이트', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '결과가 기록된 의사결정', 'current', v_dec_outcome, 'target', 10, 'unit', '건'),
      jsonb_build_object('label', '예측과 실제 비교', 'current', v_quarters, 'target', 2, 'unit', '분기'),
      jsonb_build_object('label', '팀장이 승인한 결과물', 'current', v_approved, 'target', 20, 'unit', '건'))));

  for v_i in 1..4 loop
    select bool_and((c->>'current')::numeric >= (c->>'target')::numeric) into v_ok
      from jsonb_array_elements(v_levels->v_i->'conditions') c;
    exit when not v_ok;
    v_level := v_i + 1;
  end loop;

  if v_level < 5 then
    select round(100 * avg(least(1, (c->>'current')::numeric / nullif((c->>'target')::numeric, 0)))) into v_progress
      from jsonb_array_elements(v_levels->v_level->'conditions') c;
  end if;

  return jsonb_build_object(
    'level', v_level, 'levels', v_levels, 'next_progress', v_progress,
    'totals', jsonb_build_object('checkins', v_checkins, 'one_on_ones', v_oo, 'submissions', v_subs,
      'reviewed', v_reviewed, 'observations', v_obs, 'metric_months', v_metric_months, 'members', v_members));
end $$;

-- 성과 지도: 가로 = 결과(과제 진척·승인), 세로 = 판단·성장(판단 깊이·역량 근거 폭)
create or replace function public._perf_point(p_team uuid, p_user uuid, p_as_of date)
returns table (x numeric, y numeric, evidence int)
language sql stable security definer set search_path = public as $$
  with t as (
    select coalesce(avg(case when status = 'done' then 100 else progress end), null) prog
    from tasks where team_id = p_team and owner_id = p_user and status <> 'dropped'
      and created_at::date <= p_as_of and (completed_at is null or completed_at::date > p_as_of - 90)
  ), s as (
    select count(*) filter (where status = 'approved' and approved_at::date <= p_as_of) ap,
           count(*) filter (where status in ('approved','needs_work') and updated_at::date <= p_as_of) tot
    from submissions where team_id = p_team and author_id = p_user and created_at::date > p_as_of - 180
  ), j as (
    select avg(score) sc from judgment_scores
    where team_id = p_team and user_id = p_user and scored_at::date <= p_as_of and scored_at::date > p_as_of - 120
  ), e as (
    select count(*) n, count(distinct competency) comp from evidence
    where team_id = p_team and subject_user_id = p_user and occurred_at::date <= p_as_of
      and source in ('submission','observation','review_comment','leader_note','task')
  )
  select
    round(coalesce(0.7 * t.prog + 0.3 * (100.0 * s.ap / nullif(s.tot, 0)), t.prog, 100.0 * s.ap / nullif(s.tot, 0), 50), 1),
    round(case when j.sc is null then 50 else 0.7 * (j.sc / 4 * 100) + 0.3 * least(e.comp / 5.0, 1) * 100 end, 1),
    e.n::int
  from t, s, j, e;
$$;

create or replace function public.team_performance_map(p_team uuid)
returns table (user_id uuid, full_name text, job_title text, x numeric, y numeric,
               prev_x numeric, prev_y numeric, evidence int, withheld boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_min int := coalesce(((select settings from teams where id = p_team)->>'min_judgment_evidence')::int, 8);
begin
  perform public._assert_leader(p_team);
  if not public.team_has_feature(p_team, 'perf_map') then raise exception 'PLAN_FEATURE' using errcode = 'P0001'; end if;
  return query
  select tm.user_id, p.full_name, tm.job_title, cur.x, cur.y, prv.x, prv.y, cur.evidence, cur.evidence < v_min
  from team_members tm join profiles p on p.id = tm.user_id
  cross join lateral public._perf_point(p_team, tm.user_id, current_date) cur
  cross join lateral public._perf_point(p_team, tm.user_id, current_date - 90) prv
  where tm.team_id = p_team and tm.status = 'active' and tm.role = 'member';
end $$;

-- 실적 예측: 런레이트(최근 3개월) + 진행 중 딜 가중합, 범위는 월 변동성 × √남은 개월 × 표본 보정
create or replace function public.metric_forecast(p_metric uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m metrics; v_series jsonb; v_actual numeric; v_n int; v_pace numeric; v_sd numeric; v_last date;
  v_remaining int; v_pipe numeric; v_pipe_n int; v_base numeric; v_sigma numeric; v_w numeric;
  v_prob numeric; v_z numeric;
begin
  select * into m from metrics where id = p_metric;
  if not found or not public.is_team_member(m.team_id) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('period', period, 'value', value, 'cumulative', cum) order by period), '[]'::jsonb),
         count(*), max(period)
    into v_series, v_n, v_last
    from (select period, value, sum(value) over (order by period) cum from metric_values where metric_id = p_metric) x;

  if v_n = 0 then
    return jsonb_build_object('metric_id', p_metric, 'series', v_series, 'months_of_data', 0, 'insufficient', true);
  end if;

  select case when m.cumulative then sum(value) else (array_agg(value order by period desc))[1] end into v_actual
    from metric_values where metric_id = p_metric;
  select avg(value), coalesce(stddev_samp(value), avg(value) * 0.3) into v_pace, v_sd
    from (select value from metric_values where metric_id = p_metric order by period desc limit 3) x;
  if v_n >= 3 then
    select coalesce(stddev_samp(value), v_sd) into v_sd from metric_values where metric_id = p_metric;
  end if;

  v_remaining := greatest(0, (extract(year from age(date_trunc('month', m.period_end), date_trunc('month', v_last))) * 12
                 + extract(month from age(date_trunc('month', m.period_end), date_trunc('month', v_last))))::int);
  select coalesce(sum(amount * probability), 0), count(*) into v_pipe, v_pipe_n
    from metric_pipeline where metric_id = p_metric and not closed
      and (expected_close is null or expected_close <= m.period_end);

  if m.cumulative then
    v_base := v_actual + case when v_pipe_n > 0 then (v_pace * v_remaining + v_pipe) / 2 else v_pace * v_remaining end;
    v_sigma := v_sd * sqrt(greatest(v_remaining, 1)) * (1 + 2.0 / v_n);
  else
    v_base := v_pace;
    v_sigma := v_sd * (1 + 2.0 / v_n);
  end if;
  v_w := 1.28 * v_sigma;                         -- 80% 구간

  if m.target is not null and v_sigma > 0 then
    v_z := (v_base - m.target) / v_sigma * case when m.higher_is_better then 1 else -1 end;
    v_prob := round(100 / (1 + exp(-1.702 * v_z)));
  end if;

  return jsonb_build_object(
    'metric_id', p_metric, 'name', m.name, 'unit', m.unit, 'target', m.target,
    'period_start', m.period_start, 'period_end', m.period_end, 'cumulative', m.cumulative,
    'series', v_series, 'months_of_data', v_n, 'insufficient', v_n < 2,
    'actual', round(v_actual, 2), 'base', round(v_base, 2), 'low', round(v_base - v_w, 2), 'high', round(v_base + v_w, 2),
    'range_width', round(2 * v_w, 2), 'probability', v_prob,
    'drivers', jsonb_build_object('pace', round(v_pace, 2), 'remaining_months', v_remaining,
       'pipeline_weighted', round(v_pipe, 2), 'pipeline_count', v_pipe_n, 'volatility', round(v_sd, 2)));
end $$;

-- 전략 목표별 전망: 지표가 연결돼 있으면 지표 확률, 아니면 일정 대비 진척(스케줄 지수)
create or replace function public.goal_outlook(p_team uuid)
returns table (goal_id uuid, title text, progress int, probability int, basis text, blocked int, task_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  return query
  with tk as (
    select t.goal_id, t.progress, t.status,
      case when t.start_date is not null and t.due_date is not null and t.due_date > t.start_date
           then least(1.0, greatest(0.05, (current_date - t.start_date)::numeric / (t.due_date - t.start_date))) * 100
           else null end as expected
    from tasks t where t.team_id = p_team and t.status <> 'dropped'
  ), agg as (
    select tk.goal_id, round(avg(tk.progress))::int prog,
      avg(least(1.5, tk.progress / nullif(tk.expected, 0))) si,
      count(*) filter (where tk.status = 'blocked')::int blk, count(*)::int n
    from tk group by tk.goal_id
  ), met as (
    select distinct on (mt.goal_id) mt.goal_id, (public.metric_forecast(mt.id)->>'probability')::int prob
    from metrics mt where mt.team_id = p_team and mt.goal_id is not null and mt.target is not null
    order by mt.goal_id, mt.created_at
  )
  select g.id, g.title, coalesce(a.prog, 0),
    case
      when met.prob is not null then met.prob
      when a.si is not null then greatest(3, least(97, round(100 / (1 + exp(-5 * (a.si - 0.85)))) - 8 * a.blk))::int
      else null
    end,
    case when met.prob is not null then 'metric' when a.si is not null then 'schedule' else 'insufficient' end,
    coalesce(a.blk, 0), coalesce(a.n, 0)
  from strategic_goals g left join agg a on a.goal_id = g.id left join met on met.goal_id = g.id
  where g.team_id = p_team and not g.archived
  order by g.sort, g.created_at;
end $$;

-- 과제 포트폴리오: 미션 기여도 × 팀 시간 투입 비중
create or replace function public.task_portfolio(p_team uuid)
returns table (task_id uuid, title text, goal_id uuid, mission_contribution int, hours numeric, share_pct numeric, owner_name text, status task_status)
language plpgsql stable security definer set search_path = public as $$
declare v_total numeric;
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  return query
  with h as (
    select t.id, t.title, t.goal_id, t.mission_contribution::int mc, t.status,
      coalesce((select sum(ta.share_pct / 100 * tm.weekly_hours) from task_allocations ta
                  join team_members tm on tm.team_id = t.team_id and tm.user_id = ta.user_id
                 where ta.task_id = t.id), t.est_hours_per_week, 0) hrs,
      (select p.full_name from profiles p where p.id = t.owner_id) owner_name
    from tasks t where t.team_id = p_team and t.status in ('planned','in_progress','blocked')
  )
  select h.id, h.title, h.goal_id, h.mc, round(h.hrs, 1),
         round(100 * h.hrs / nullif(sum(h.hrs) over (), 0), 1), h.owner_name, h.status
  from h order by h.hrs desc;
end $$;

grant execute on function public.care_radar(uuid), public.member_data_depth(uuid), public.team_insight_level(uuid),
  public.team_performance_map(uuid), public.metric_forecast(uuid), public.goal_outlook(uuid),
  public.task_portfolio(uuid) to authenticated;
revoke all on function public.log_event(uuid,text,text,uuid,uuid,public.provenance,jsonb) from public, anon, authenticated;
revoke all on function public.upsert_evidence(uuid,uuid,public.evidence_source,uuid,text,public.polarity,text,timestamptz,public.provenance) from public, anon, authenticated;
revoke all on function public._perf_point(uuid,uuid,date) from public, anon, authenticated;

-- =====================================================================
-- 샘플 전략 데이터 (빈 화면 대신 구조를 먼저 보고 싶을 때)
-- =====================================================================
create or replace function public.seed_sample_strategy(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g1 uuid; g2 uuid; g3 uuid; m1 uuid; me uuid := auth.uid(); v_month date := date_trunc('month', current_date)::date;
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden'; end if;
  if exists (select 1 from strategic_goals where team_id = p_team) then raise exception 'ALREADY_HAS_GOALS' using errcode = 'P0001'; end if;
  update teams set mission = coalesce(nullif(mission, ''), '신사업 기회를 빠르게 검증해, 회사의 다음 성장 동력을 만든다') where id = p_team;
  insert into strategic_goals (team_id, title, sort) values (p_team, '신제품 시장 진입 검증', 1) returning id into g1;
  insert into strategic_goals (team_id, title, sort) values (p_team, '파트너 채널 확대', 2) returning id into g2;
  insert into strategic_goals (team_id, title, sort) values (p_team, '팀 역량 강화', 3) returning id into g3;
  insert into hypotheses (team_id, goal_id, statement, signal) values
    (p_team, g1, '침투가로 Q1 파일럿 전환율 20% 이상', '인터뷰 12명 중 구매 의향 7명'),
    (p_team, g2, '파트너 제휴로 연내 계약 4억', '파트너 데이터 수급 2주째 지연'),
    (p_team, g3, '온보딩 개편으로 신규 입사자 적응 기간 3개월 → 2개월', '6주차 독립 수행률 60%');
  insert into tasks (team_id, goal_id, title, owner_id, priority, mission_contribution, est_hours_per_week, progress, status, start_date, due_date) values
    (p_team, g1, '진입 전략 수립', me, 1, 5, 12, 58, 'in_progress', current_date - 45, current_date + 40),
    (p_team, g1, '가격 정책 확정', me, 1, 4, 6, 85, 'in_progress', current_date - 60, current_date + 10),
    (p_team, g2, '파트너 제안서', me, 1, 5, 4, 30, 'blocked', current_date - 30, current_date + 20),
    (p_team, g3, '온보딩 개선', me, 2, 4, 6, 66, 'in_progress', current_date - 50, current_date + 30),
    (p_team, null, '사내 보고 자료 정비', me, 3, 1, 10, 40, 'in_progress', current_date - 90, current_date + 60),
    (p_team, null, '레거시 리포트 운영', me, 3, 2, 6, 50, 'in_progress', current_date - 90, current_date + 60);
  insert into metrics (team_id, goal_id, name, unit, target, period_start, period_end, cumulative)
    values (p_team, g2, '파트너 계약 금액', '억', 20, (v_month - interval '3 months')::date, (v_month + interval '2 months')::date, true)
    returning id into m1;
  insert into metric_values (metric_id, team_id, period, value, created_by) values
    (m1, p_team, (v_month - interval '3 months')::date, 3.4, me),
    (m1, p_team, (v_month - interval '2 months')::date, 3.6, me),
    (m1, p_team, (v_month - interval '1 months')::date, 4.2, me);
  insert into metric_pipeline (metric_id, team_id, label, amount, probability, expected_close) values
    (m1, p_team, 'B사 제휴', 4, 0.4, v_month + 45), (m1, p_team, 'C사 재계약', 2.5, 0.6, v_month + 30), (m1, p_team, 'D사 신규', 1.5, 0.3, v_month + 50);
end $$;
grant execute on function public.seed_sample_strategy(uuid) to authenticated;

-- >>>>>>>>>> 20261006000005_storage.sql
-- =====================================================================
-- ATEAM · 0005 storage
-- 경로 규칙: submissions/{team_id}/{submission_id}/{version}-{file_name}
-- 읽기: 작성자 + 팀장 / 쓰기: 작성자(본인 결과물 폴더)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('submissions', 'submissions', false, 26214400)   -- 25MB
on conflict (id) do nothing;

create policy "submissions read" on storage.objects for select to authenticated
using (
  bucket_id = 'submissions'
  and public.can_see_submission(((storage.foldername(name))[2])::uuid)
);

create policy "submissions upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'submissions'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
  and exists (select 1 from public.submissions s
              where s.id = ((storage.foldername(name))[2])::uuid and s.author_id = auth.uid())
);

-- >>>>>>>>>> 20261011000007_knowhow.sql
-- =====================================================================
-- ATEAM · 0007 팀장 노하우 (Leader Knowhow)
-- 팀장이 자기 기준·프레임워크·자료·맥락을 '던져 넣으면' AI가 카드로 정리하고,
-- 팀장이 확인한 카드는 리뷰·1on1 준비·주간보고·평가·전략 점검에 자동으로 반영된다.
--   knowhow_sources : 던져 넣은 원본 (텍스트 붙여넣기 / 파일)
--   knowhow_cards   : AI가 정리했거나 팀장이 직접 쓴 카드 (AI가 실제로 읽는 단위)
-- =====================================================================

create type public.knowhow_kind as enum ('principle', 'rubric', 'framework', 'context', 'coaching', 'glossary');

create table public.knowhow_sources (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id),
  title       text not null default '',
  raw_text    text not null default '',          -- 붙여넣은 글 또는 파일에서 뽑은 본문
  file_path   text,                              -- storage: knowhow/{team_id}/{source_id}-{name}
  file_name   text,
  mime_type   text,
  status      text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  error       text,
  summary     text,                              -- AI가 쓴 '이 자료는 무엇인가' 한두 문장
  card_count  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.knowhow_sources (team_id, created_at desc);

create table public.knowhow_cards (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id),
  source_id   uuid references public.knowhow_sources(id) on delete set null,
  kind        public.knowhow_kind not null,
  title       text not null,
  body        text not null default '',
  rules       jsonb not null default '[]'::jsonb,        -- AI가 그대로 적용할 짧은 규칙들
  applies_to  text[] not null default '{}',               -- review, prep, report, evaluation, briefing, strategy, scenario
  keywords    text[] not null default '{}',
  active      boolean not null default true,              -- 끄면 AI가 읽지 않는다
  pinned      boolean not null default false,             -- 항상 먼저 반영
  shared      boolean not null default false,             -- 팀원에게 '팀장 가이드'로 공개
  provenance  public.provenance not null default 'ai',    -- ai / human / human_edit
  use_count   int not null default 0,                     -- AI 결과에 반영된 횟수
  last_used_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.knowhow_cards (team_id, active);
create index on public.knowhow_cards using gin (applies_to);

create trigger t_touch before update on public.knowhow_sources for each row execute function public.touch_updated_at();
create trigger t_touch before update on public.knowhow_cards   for each row execute function public.touch_updated_at();

-- 팀장이 AI 카드를 고치면 출처가 '팀장 수정'으로 바뀐다
create or replace function public.trg_knowhow_card() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' and old.provenance = 'ai'
     and (new.title <> old.title or new.body <> old.body or new.rules <> old.rules) then
    new.provenance := 'human_edit';
  end if;
  return new;
end $$;
create trigger t_knowhow_card before update on public.knowhow_cards for each row execute function public.trg_knowhow_card();

-- ---------- RLS ----------
alter table public.knowhow_sources enable row level security;
alter table public.knowhow_cards   enable row level security;

create policy ks_leader on public.knowhow_sources for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and owner_id = auth.uid());

create policy kc_leader on public.knowhow_cards for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and owner_id = auth.uid());
-- 팀원은 팀장이 공개한 카드만 읽는다
create policy kc_member_shared on public.knowhow_cards for select to authenticated
  using (shared and active and public.is_team_member(team_id));

-- ---------- 스토리지: 팀장만 ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('knowhow', 'knowhow', false, 26214400)
on conflict (id) do nothing;

create policy "knowhow read" on storage.objects for select to authenticated
using (bucket_id = 'knowhow' and public.is_team_leader(((storage.foldername(name))[1])::uuid));
create policy "knowhow upload" on storage.objects for insert to authenticated
with check (bucket_id = 'knowhow' and public.is_team_leader(((storage.foldername(name))[1])::uuid));
create policy "knowhow delete" on storage.objects for delete to authenticated
using (bucket_id = 'knowhow' and public.is_team_leader(((storage.foldername(name))[1])::uuid));

-- ---------- AI가 카드를 썼다는 기록 (service_role 전용) ----------
create or replace function public.mark_knowhow_used(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update knowhow_cards set use_count = use_count + 1, last_used_at = now() where id = any(p_ids);
$$;
revoke all on function public.mark_knowhow_used(uuid[]) from public, anon, authenticated;

-- 모든 요금제에서 쓸 수 있다 (첫날부터 혼자 쓰는 가치)
update public.plans set features = array_append(features, 'knowhow') where not ('knowhow' = any(features));

-- >>>>>>>>>> 20261013000008_work_items.sql
-- =====================================================================
-- ATEAM · 0008 목표·과제 자유 구조 + 팀장 요청 + 알림 + 과금 v2
--   1) work_items : 목표·과제·할 일을 하나의 트리로 (단계 수·이름 자유)
--      · 측정 방식(체크/하위 항목/퍼센트/숫자/정기 업무), 기준선·재계획 이력, 진척 기록
--      · 팀원이 스스로 만들고(제안) 팀장이 승인·수정 요청·피드백
--   2) team_requests : 팀장 → 팀원 요청 (계획 세우기, 진척 공유, 자료 올리기 ...)
--   3) notifications 트리거 (요청·제안·피드백·결과물)
--   4) 결과물 공유 유형 확장 (문서·링크·이미지·숫자·메모, 승인/피드백/공유)
--   5) 과금 v2 : 30일 체험 → AI 잠금, 코어 AI(구독 포함) / 프리미엄 AI(크레딧)
--   기존 strategic_goals · tasks · milestones 데이터는 work_items 로 옮기고 지운다.
-- =====================================================================

-- ---------- enum ----------
create type public.item_status  as enum ('proposed', 'changes_requested', 'active', 'blocked', 'done', 'dropped');
create type public.item_measure as enum ('check', 'children', 'percent', 'number', 'recurring');
create type public.request_status as enum ('open', 'done', 'canceled');

alter type public.ai_kind add value if not exists 'insight_daily';
alter type public.ai_kind add value if not exists 'insight_weekly';
alter type public.ai_kind add value if not exists 'insight_monthly';
alter type public.ai_kind add value if not exists 'plan_draft';
alter type public.ai_kind add value if not exists 'plan_edit';
alter type public.ai_kind add value if not exists 'self_check';
alter type public.submission_status add value if not exists 'shared';

-- ---------- work_items ----------
create table public.work_items (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references public.teams(id) on delete cascade,
  parent_id          uuid references public.work_items(id) on delete cascade,
  owner_id           uuid references public.profiles(id) on delete set null,
  created_by         uuid references public.profiles(id) default auth.uid(),
  title              text not null check (length(trim(title)) > 0),
  note               text not null default '',
  status             public.item_status not null default 'active',
  measure            public.item_measure not null default 'children',
  progress           smallint not null default 0 check (progress between 0 and 100),
  num_current        numeric,
  num_target         numeric,
  unit               text not null default '',
  higher_is_better   boolean not null default true,
  recur              text check (recur in ('weekly', 'monthly')),
  start_date         date,
  due_date           date,
  done_at            timestamptz,
  -- 기준선 (처음 확정된 계획) / 재계획
  base_start         date,
  base_due           date,
  base_target        numeric,
  baselined_at       timestamptz,
  replan_count       int not null default 0,
  change_reason      text,                               -- 다음 변경 1건에만 쓰이고 비워진다
  -- 관리 속성
  tags               text[] not null default '{}',
  contribution       smallint not null default 3 check (contribution between 1 and 5),
  priority           smallint not null default 2 check (priority between 1 and 3),
  est_hours_per_week numeric(5,1),
  metric_id          uuid references public.metrics(id) on delete set null,
  needs_plan         boolean not null default false,     -- 팀장이 '하위 계획을 세워 달라' 요청한 항목
  sort               double precision not null default 0,
  legacy_id          uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on public.work_items (team_id, parent_id, sort);
create index on public.work_items (owner_id);
create index on public.work_items (legacy_id);

create table public.work_item_logs (                   -- 진척·숫자·정기 업무 기록 (추세의 재료)
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.work_items(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  author_id  uuid references public.profiles(id) default auth.uid(),
  kind       text not null check (kind in ('progress', 'number', 'recurring', 'note')),
  period     date not null default current_date,
  value      numeric,
  done       boolean,
  note       text not null default '',
  created_at timestamptz not null default now(),
  unique (item_id, kind, period)
);
create index on public.work_item_logs (team_id, created_at desc);

create table public.work_item_events (                 -- 변경 이력 (트리거만 쓴다)
  id         bigint generated always as identity primary key,
  item_id    uuid not null references public.work_items(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  actor_id   uuid references public.profiles(id),
  kind       text not null,                             -- created / replan / status / owner / target / approved / changes_requested
  old        jsonb,
  new        jsonb,
  reason     text,
  created_at timestamptz not null default now()
);
create index on public.work_item_events (item_id, created_at desc);

create table public.work_item_comments (               -- 대화·피드백
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.work_items(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) default auth.uid(),
  kind       text not null default 'comment' check (kind in ('comment', 'feedback', 'approve', 'changes')),
  body       text not null default '',
  created_at timestamptz not null default now()
);
create index on public.work_item_comments (item_id, created_at);

-- ---------- 팀장 → 팀원 요청 ----------
create table public.team_requests (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  from_id      uuid not null references public.profiles(id) default auth.uid(),
  to_id        uuid not null references public.profiles(id),
  kind         text not null default 'other' check (kind in ('plan', 'progress', 'share', 'meeting', 'other')),
  item_id      uuid references public.work_items(id) on delete set null,
  title        text not null,
  body         text not null default '',
  due_date     date,
  status       public.request_status not null default 'open',
  response     text not null default '',
  responded_at timestamptz,
  created_at   timestamptz not null default now()
);
create index on public.team_requests (team_id, to_id, status);

-- ---------- 기존 데이터 이전 ----------
-- 목표 → 최상위 항목 (담당 = 팀 소유자)
insert into public.work_items (team_id, parent_id, owner_id, created_by, title, note, status, measure, sort, legacy_id, created_at)
select g.team_id, null, t.owner_id, t.owner_id, g.title, g.description,
       case when g.archived then 'dropped' else 'active' end::public.item_status, 'children', g.sort, g.id, g.created_at
from public.strategic_goals g join public.teams t on t.id = g.team_id;

-- 과제 → 목표 아래 항목 (마일스톤이 있으면 '하위 항목' 측정)
insert into public.work_items (team_id, parent_id, owner_id, title, status, measure, progress, start_date, due_date, done_at,
  contribution, priority, est_hours_per_week, sort, legacy_id, created_at, updated_at, base_start, base_due, baselined_at)
select k.team_id, g.id, k.owner_id, k.title,
       case k.status when 'planned' then 'active' when 'in_progress' then 'active' when 'blocked' then 'blocked'
                     when 'done' then 'done' else 'dropped' end::public.item_status,
       case when exists (select 1 from public.milestones m where m.task_id = k.id) then 'children' else 'percent' end::public.item_measure,
       k.progress, k.start_date, k.due_date, k.completed_at, k.mission_contribution, k.priority, k.est_hours_per_week,
       k.priority * 10, k.id, k.created_at, k.updated_at, k.start_date, k.due_date, k.created_at
from public.tasks k left join public.work_items g on g.legacy_id = k.goal_id;

-- 마일스톤 → 과제 아래 체크 항목
insert into public.work_items (team_id, parent_id, owner_id, title, status, measure, progress, due_date, done_at, legacy_id, created_at, base_due, baselined_at)
select p.team_id, p.id, p.owner_id, m.title,
       case when m.done_at is not null then 'done' else 'active' end::public.item_status, 'check',
       case when m.done_at is not null then 100 else 0 end, m.due_date, m.done_at, m.id, m.created_at, m.due_date, m.created_at
from public.milestones m join public.work_items p on p.legacy_id = m.task_id;

-- 배분 → work_item_allocations
alter table public.task_allocations rename to work_item_allocations;
alter table public.work_item_allocations drop constraint if exists task_allocations_task_id_fkey;
alter table public.work_item_allocations rename column task_id to item_id;
update public.work_item_allocations a set item_id = w.id from public.work_items w where w.legacy_id = a.item_id;
delete from public.work_item_allocations a where not exists (select 1 from public.work_items w where w.id = a.item_id);
alter table public.work_item_allocations add constraint work_item_allocations_item_fkey
  foreign key (item_id) references public.work_items(id) on delete cascade;

-- 지표·결과물·가설의 연결
alter table public.metrics add column item_id uuid references public.work_items(id) on delete set null;
update public.metrics m set item_id = w.id from public.work_items w where w.legacy_id = m.goal_id;
alter table public.metrics drop column goal_id;

alter table public.submissions add column item_id uuid references public.work_items(id) on delete set null;
update public.submissions s set item_id = w.id from public.work_items w where w.legacy_id = s.task_id;
alter table public.submissions drop column task_id;

alter table public.hypotheses add column item_id uuid references public.work_items(id) on delete cascade;
update public.hypotheses h set item_id = w.id from public.work_items w where w.legacy_id = h.goal_id;
alter table public.hypotheses drop column goal_id;

update public.evidence e set source_id = w.id from public.work_items w where e.source = 'task' and w.legacy_id = e.source_id;
update public.events e set ref_table = 'work_items', ref_id = w.id from public.work_items w where e.ref_table = 'tasks' and w.legacy_id = e.ref_id;

-- 옛 구조 정리
drop trigger if exists t_task on public.tasks;
drop function if exists public.trg_task();
drop function if exists public.goal_outlook(uuid);
drop function if exists public.task_portfolio(uuid);
drop table public.milestones;
drop table public.tasks;
drop table public.strategic_goals;
drop type public.task_status;

-- ---------- 결과물 공유 유형 ----------
alter table public.submissions add column kind text not null default 'document'
  check (kind in ('document', 'link', 'image', 'number', 'note'));
alter table public.submissions add column request_type text not null default 'approval'
  check (request_type in ('approval', 'feedback', 'share'));
alter table public.submissions add column link_url text;
alter table public.submission_versions add column value numeric;  -- 숫자 업데이트

-- ---------- 팀 설정 기본값 ----------
update public.teams set settings = settings
  || jsonb_build_object('level_names', coalesce(settings->'level_names', '["목표","과제","할 일"]'::jsonb))
  || jsonb_build_object('member_free_edit', coalesce(settings->'member_free_edit', 'false'::jsonb));

-- =====================================================================
-- 트리거
-- =====================================================================
create trigger t_touch before update on public.work_items for each row execute function public.touch_updated_at();

create or replace function public._notify(p_user uuid, p_team uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, team_id, kind, title, body, link)
  select p_user, p_team, p_kind, p_title, coalesce(p_body, ''), p_link
  where p_user is not null and p_user is distinct from auth.uid();
$$;
revoke all on function public._notify(uuid,uuid,text,text,text,text) from public, anon, authenticated;

create or replace function public._team_leader(p_team uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from team_members where team_id = p_team and role = 'leader' and status = 'active' order by joined_at limit 1;
$$;

-- 항목 저장 전: 권한 정리 · 진척 계산 · 기준선 · 재계획 기록
create or replace function public.trg_work_item_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_leader boolean := coalesce(auth.role(), 'service') <> 'authenticated' or public.is_team_leader(new.team_id);
  v_free boolean := coalesce(((select settings from teams where id = new.team_id)->>'member_free_edit')::boolean, false);
  v_parent work_items;
begin
  if new.parent_id is not null then
    select * into v_parent from work_items where id = new.parent_id;
    if v_parent.team_id <> new.team_id then raise exception '다른 팀 항목 아래에 둘 수 없습니다'; end if;
  end if;

  if not v_leader then
    if tg_op = 'INSERT' then
      if new.owner_id is distinct from auth.uid() then raise exception '팀원은 본인 담당 항목만 만들 수 있습니다'; end if;
      if not v_free and new.status not in ('proposed') then new.status := 'proposed'; end if;
      new.needs_plan := false;
    else
      if new.owner_id is distinct from old.owner_id then raise exception '담당자는 팀장만 바꿀 수 있습니다'; end if;
      if new.parent_id is distinct from old.parent_id and not v_free then raise exception '항목 위치는 팀장만 바꿀 수 있습니다'; end if;
      -- 승인은 팀장만: 제안·수정 요청 상태에서 진행 상태로 바로 못 간다
      if not v_free and old.status in ('proposed', 'changes_requested') and new.status not in ('proposed', 'changes_requested', 'dropped') then
        raise exception '팀장 승인 전에는 진행 상태로 바꿀 수 없습니다';
      end if;
      if old.status = 'changes_requested' and new.status = 'changes_requested'
         and (new.title <> old.title or new.note <> old.note or new.due_date is distinct from old.due_date
              or new.start_date is distinct from old.start_date or new.num_target is distinct from old.num_target) then
        new.status := 'proposed';                       -- 고쳐서 다시 제안
      end if;
      new.needs_plan := old.needs_plan and not exists (select 1 from work_items c where c.parent_id = new.id);
    end if;
  end if;

  -- 진척 계산
  if new.status = 'done' then
    new.done_at := coalesce(new.done_at, now());
    if new.measure in ('check', 'percent') then new.progress := 100; end if;
  elsif tg_op = 'UPDATE' and old.status = 'done' then
    new.done_at := null;
    if new.measure = 'check' then new.progress := 0; end if;
  end if;
  if new.measure = 'check' then new.progress := case when new.status = 'done' then 100 else 0 end; end if;
  if new.measure = 'number' and new.num_target is not null and new.num_target <> 0 and new.num_current is not null then
    new.progress := greatest(0, least(100, round(
      case when new.higher_is_better then 100 * new.num_current / new.num_target
           else 100 * new.num_target / nullif(new.num_current, 0) end)))::smallint;
  end if;

  -- 기준선: 처음 '진행'이 되는 순간의 계획을 보관
  if new.baselined_at is null and new.status in ('active', 'blocked', 'done') then
    new.base_start := new.start_date; new.base_due := new.due_date; new.base_target := new.num_target;
    new.baselined_at := now();
  elsif tg_op = 'UPDATE' and old.baselined_at is not null then
    if new.due_date is distinct from old.due_date or new.start_date is distinct from old.start_date then
      new.replan_count := old.replan_count + 1;
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'replan',
              jsonb_build_object('start', old.start_date, 'due', old.due_date),
              jsonb_build_object('start', new.start_date, 'due', new.due_date), new.change_reason);
    end if;
    if new.num_target is distinct from old.num_target then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'target', to_jsonb(old.num_target), to_jsonb(new.num_target), new.change_reason);
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(),
              case when old.status in ('proposed', 'changes_requested') and new.status = 'active' then 'approved'
                   when new.status = 'changes_requested' then 'changes_requested' else 'status' end,
              to_jsonb(old.status), to_jsonb(new.status), new.change_reason);
    end if;
    if new.owner_id is distinct from old.owner_id then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'owner', to_jsonb(old.owner_id), to_jsonb(new.owner_id), new.change_reason);
    end if;
  end if;
  new.change_reason := null;
  return new;
end $$;
create trigger t_wi_before before insert or update on public.work_items for each row execute function public.trg_work_item_before();

-- 항목 저장 후: 상위 진척 재계산 · 진척 기록 · 근거 · 알림
create or replace function public._rollup_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_p smallint;
begin
  select coalesce(round(avg(case when c.status = 'done' then 100 else c.progress end)), 0)::smallint into v_p
    from work_items c where c.parent_id = p_id and c.status not in ('dropped', 'proposed', 'changes_requested');
  update work_items set progress = v_p where id = p_id and measure = 'children' and progress <> v_p;
end $$;

create or replace function public.trg_work_item_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_leader uuid; v_parent work_items;
begin
  if tg_op = 'DELETE' then
    if old.parent_id is not null then perform public._rollup_item(old.parent_id); end if;
    return old;
  end if;
  v_leader := public._team_leader(new.team_id);

  if tg_op = 'INSERT' then
    insert into work_item_events (item_id, team_id, actor_id, kind, new) values (new.id, new.team_id, auth.uid(), 'created', to_jsonb(new.status));
    if new.measure = 'children' then perform public._rollup_item(new.id); end if;
    if new.parent_id is not null then
      update work_items set needs_plan = false where id = new.parent_id and needs_plan;   -- 하위 계획이 생겼다
    end if;
  end if;
  if new.parent_id is not null and (tg_op = 'INSERT' or new.progress <> old.progress or new.status <> old.status or new.parent_id is distinct from old.parent_id) then
    perform public._rollup_item(new.parent_id);
  end if;
  if tg_op = 'UPDATE' and old.parent_id is not null and old.parent_id is distinct from new.parent_id then
    perform public._rollup_item(old.parent_id);
  end if;

  -- 진척 기록 (하루 1건으로 덮어씀)
  if tg_op = 'INSERT' or new.progress <> old.progress or new.num_current is distinct from old.num_current then
    insert into work_item_logs (item_id, team_id, author_id, kind, period, value)
    values (new.id, new.team_id, auth.uid(), 'progress', current_date, new.progress)
    on conflict (item_id, kind, period) do update set value = excluded.value, created_at = now();
    if new.measure = 'number' and new.num_current is not null then
      insert into work_item_logs (item_id, team_id, author_id, kind, period, value)
      values (new.id, new.team_id, auth.uid(), 'number', current_date, new.num_current)
      on conflict (item_id, kind, period) do update set value = excluded.value, created_at = now();
    end if;
  end if;

  -- 제안 → 팀장 알림
  if new.status = 'proposed' and (tg_op = 'INSERT' or old.status <> 'proposed') and new.owner_id is not null then
    perform public._notify(v_leader, new.team_id, 'item.proposed', '검토 요청: ' || new.title,
      coalesce((select full_name from profiles where id = new.owner_id), '') || '님이 계획을 올렸습니다', '/goals?item=' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'active' and old.status in ('proposed', 'changes_requested') then
      perform public._notify(new.owner_id, new.team_id, 'item.approved', '승인됨: ' || new.title, '', '/my/goals?item=' || new.id);
    elsif new.status = 'changes_requested' then
      perform public._notify(new.owner_id, new.team_id, 'item.changes', '수정 요청: ' || new.title, '', '/my/goals?item=' || new.id);
    elsif new.status = 'blocked' then
      perform public._notify(v_leader, new.team_id, 'item.blocked', '막힘: ' || new.title,
        coalesce((select full_name from profiles where id = new.owner_id), ''), '/goals?item=' || new.id);
    elsif new.status = 'done' and new.owner_id is not null then
      perform log_event(new.team_id, 'item.done', 'work_items', new.id, new.owner_id);
      if new.parent_id is null or (select parent_id from work_items where id = new.parent_id) is null or new.measure <> 'check' then
        perform upsert_evidence(new.team_id, new.owner_id, 'task', new.id, '완료 — ' || new.title
          || case when new.base_due is not null and new.done_at::date > new.base_due then ' (계획 대비 ' || (new.done_at::date - new.base_due) || '일 늦음)'
                  when new.base_due is not null then ' (계획 내 완료)' else '' end,
          case when new.base_due is not null and new.done_at::date > new.base_due + 7 then 'neutral' else 'positive' end, '실행 관리', now());
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.replan_count > old.replan_count and not public.is_team_leader(new.team_id) then
    perform public._notify(v_leader, new.team_id, 'item.replan', '일정 변경: ' || new.title,
      coalesce(to_char(old.due_date, 'MM/DD'), '-') || ' → ' || coalesce(to_char(new.due_date, 'MM/DD'), '-'), '/goals?item=' || new.id);
  end if;
  return new;
end $$;
create trigger t_wi_after after insert or update or delete on public.work_items for each row execute function public.trg_work_item_after();

-- 이전한 데이터의 상위 진척을 아래에서부터 다시 계산
do $$ declare r record; begin
  for r in (with recursive d as (
              select id, 0 lvl from public.work_items where parent_id is null
              union all select c.id, d.lvl + 1 from public.work_items c join d on c.parent_id = d.id)
            select id from d order by lvl desc) loop
    perform public._rollup_item(r.id);
  end loop;
end $$;

-- 정기 업무 기록 → 진척(최근 6회 완료율)
create or replace function public.trg_item_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rate smallint;
begin
  if new.kind = 'recurring' then
    select coalesce(round(100.0 * count(*) filter (where done) / nullif(count(*), 0)), 0)::smallint into v_rate
      from (select done from work_item_logs where item_id = new.item_id and kind = 'recurring' order by period desc limit 6) x;
    update work_items set progress = v_rate where id = new.item_id and measure = 'recurring';
  end if;
  return new;
end $$;
create trigger t_item_log after insert or update on public.work_item_logs for each row execute function public.trg_item_log();

-- 코멘트: 팀장 피드백은 근거 + 담당자 알림 / 팀원 코멘트는 팀장 알림
create or replace function public.trg_item_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item work_items;
begin
  select * into v_item from work_items where id = new.item_id;
  if public.is_team_leader(new.team_id) then
    if v_item.owner_id is not null and v_item.owner_id <> new.author_id and new.body <> '' then
      perform upsert_evidence(new.team_id, v_item.owner_id, 'leader_note', new.id, v_item.title || ' · ' || new.body, 'neutral', null, new.created_at);
    end if;
    perform public._notify(v_item.owner_id, new.team_id, 'item.feedback', '팀장 피드백: ' || v_item.title, left(new.body, 120), '/my/goals?item=' || v_item.id);
  else
    perform public._notify(public._team_leader(new.team_id), new.team_id, 'item.comment', '코멘트: ' || v_item.title, left(new.body, 120), '/goals?item=' || v_item.id);
  end if;
  return new;
end $$;
create trigger t_item_comment after insert on public.work_item_comments for each row execute function public.trg_item_comment();

-- 요청 알림
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request', '요청: ' || new.title, left(new.body, 120), '/');
    if new.kind = 'plan' and new.item_id is not null then
      update work_items set needs_plan = true where id = new.item_id;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done', '완료: ' || new.title, left(new.response, 120), '/');
  end if;
  return new;
end $$;
create trigger t_request_ins after insert on public.team_requests for each row execute function public.trg_request();
create trigger t_request_upd before update on public.team_requests for each row execute function public.trg_request();

-- 결과물 알림 (리뷰 요청은 팀장에게, 팀장 코멘트는 작성자에게)
create or replace function public.trg_submission_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions;
begin
  if tg_table_name = 'submission_versions' then
    select * into v_sub from submissions where id = new.submission_id;
    perform public._notify(public._team_leader(v_sub.team_id), v_sub.team_id, 'submission',
      case v_sub.request_type when 'share' then '공유: ' when 'feedback' then '피드백 요청: ' else '리뷰 요청: ' end || v_sub.title,
      coalesce((select full_name from profiles where id = v_sub.author_id), ''), '/reviews/' || v_sub.id);
  else
    select * into v_sub from submissions where id = new.submission_id;
    if new.author_id <> v_sub.author_id then
      perform public._notify(v_sub.author_id, v_sub.team_id, 'review.comment', '코멘트: ' || v_sub.title, left(new.body, 120), '/reviews/' || v_sub.id);
    else
      perform public._notify(public._team_leader(v_sub.team_id), v_sub.team_id, 'review.reply', '답글: ' || v_sub.title, left(new.body, 120), '/reviews/' || v_sub.id);
    end if;
  end if;
  return new;
end $$;
create trigger t_sv_notify after insert on public.submission_versions for each row execute function public.trg_submission_notify();
create trigger t_rc_notify after insert on public.review_comments for each row when (new.provenance = 'human') execute function public.trg_submission_notify();

-- 공유(승인 불필요) 결과물은 리뷰 대기에 올리지 않는다
create or replace function public.trg_submission_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions;
begin
  select * into v_sub from submissions where id = new.submission_id;
  update submissions set status = (case when v_sub.request_type = 'share' then 'shared' else 'in_review' end)::submission_status,
                         updated_at = now() where id = new.submission_id;
  perform log_event(new.team_id, 'submission.version', 'submission_versions', new.id, v_sub.author_id, 'human',
                    jsonb_build_object('version', new.version, 'title', v_sub.title, 'kind', v_sub.kind));
  perform upsert_evidence(new.team_id, v_sub.author_id, 'submission', new.id,
    v_sub.title || ' v' || new.version || case when new.note <> '' then ' — ' || new.note else '' end,
    'neutral', null, new.created_at);
  -- 숫자 업데이트는 연결 항목의 현재값으로
  if v_sub.kind = 'number' and new.value is not null and v_sub.item_id is not null then
    update work_items set num_current = new.value where id = v_sub.item_id and measure = 'number';
  end if;
  return new;
end $$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.work_items         enable row level security;
alter table public.work_item_logs     enable row level security;
alter table public.work_item_events   enable row level security;
alter table public.work_item_comments enable row level security;
alter table public.team_requests      enable row level security;

create policy wi_select on public.work_items for select to authenticated using (public.is_team_member(team_id));
create policy wi_insert on public.work_items for insert to authenticated
  with check (public.is_team_leader(team_id) or (public.is_team_member(team_id) and owner_id = auth.uid()));
create policy wi_update on public.work_items for update to authenticated
  using (public.is_team_leader(team_id) or owner_id = auth.uid())
  with check (public.is_team_leader(team_id) or owner_id = auth.uid());
create policy wi_delete on public.work_items for delete to authenticated
  using (public.is_team_leader(team_id)
         or (owner_id = auth.uid() and (status in ('proposed', 'changes_requested')
             or coalesce(((select settings from teams t where t.id = team_id)->>'member_free_edit')::boolean, false))));

create policy wil_select on public.work_item_logs for select to authenticated using (public.is_team_member(team_id));
create policy wil_write on public.work_item_logs for all to authenticated
  using (public.is_team_leader(team_id) or exists (select 1 from work_items w where w.id = item_id and w.owner_id = auth.uid()))
  with check (public.is_team_leader(team_id) or exists (select 1 from work_items w where w.id = item_id and w.owner_id = auth.uid()));

create policy wie_select on public.work_item_events for select to authenticated using (public.is_team_member(team_id));

create policy wic_select on public.work_item_comments for select to authenticated using (public.is_team_member(team_id));
create policy wic_insert on public.work_item_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id)
              and (kind in ('comment') or public.is_team_leader(team_id)));
create policy wic_delete on public.work_item_comments for delete to authenticated using (author_id = auth.uid());

create policy rq_select on public.team_requests for select to authenticated
  using (from_id = auth.uid() or to_id = auth.uid() or public.is_team_leader(team_id));
create policy rq_insert on public.team_requests for insert to authenticated
  with check (from_id = auth.uid() and public.is_team_member(team_id)
              and exists (select 1 from team_members m where m.team_id = team_requests.team_id and m.user_id = to_id and m.status = 'active'));
create policy rq_update on public.team_requests for update to authenticated
  using (from_id = auth.uid() or to_id = auth.uid());
create policy rq_delete on public.team_requests for delete to authenticated using (from_id = auth.uid());

-- 배분: 팀원 읽기, 팀장 쓰기 (이름이 바뀌었으므로 정책 재생성)
drop policy if exists task_allocations_select on public.work_item_allocations;
drop policy if exists task_allocations_write on public.work_item_allocations;
create policy wia_select on public.work_item_allocations for select to authenticated using (public.is_team_member(team_id));
create policy wia_write on public.work_item_allocations for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

-- 공유·피드백 결과물은 팀원 본인과 팀장이 본다 (기존 정책 유지)

-- =====================================================================
-- 분석 함수 (새 구조)
-- =====================================================================
-- 최상위 항목(목표)별 전망: 연결 지표 확률 → 숫자 목표 → 일정 대비 진척
create or replace function public.goal_outlook(p_team uuid)
returns table (goal_id uuid, title text, progress int, probability int, basis text, blocked int, task_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  return query
  with recursive tree as (
    select w.id, w.id as root from work_items w where w.team_id = p_team and w.parent_id is null and w.status not in ('dropped', 'proposed', 'changes_requested')
    union all
    select c.id, t.root from work_items c join tree t on c.parent_id = t.id where c.status not in ('dropped', 'proposed', 'changes_requested')
  ), leaf as (
    select t.root, w.progress, w.status,
      case when w.start_date is not null and w.due_date is not null and w.due_date > w.start_date
           then least(1.0, greatest(0.05, (current_date - w.start_date)::numeric / (w.due_date - w.start_date))) * 100 end as expected
    from tree t join work_items w on w.id = t.id
    where t.id <> t.root and not exists (select 1 from work_items c where c.parent_id = w.id and c.status <> 'dropped')
  ), agg as (
    select l.root, avg(least(1.5, l.progress / nullif(l.expected, 0))) si,
           count(*) filter (where l.status = 'blocked')::int blk, count(*)::int n
    from leaf l group by l.root
  ), met as (
    select distinct on (mt.item_id) mt.item_id, (public.metric_forecast(mt.id)->>'probability')::int prob
    from metrics mt where mt.team_id = p_team and mt.item_id is not null and mt.target is not null
    order by mt.item_id, mt.created_at
  )
  select g.id, g.title, g.progress::int,
    case
      when met.prob is not null then met.prob
      when a.si is not null then greatest(3, least(97, round(100 / (1 + exp(-5 * (a.si - 0.85)))) - 8 * a.blk))::int
      when g.start_date is not null and g.due_date is not null and g.due_date > g.start_date then
        greatest(3, least(97, round(100 / (1 + exp(-5 * (least(1.5, g.progress / nullif(least(1.0, greatest(0.05, (current_date - g.start_date)::numeric / (g.due_date - g.start_date))) * 100, 0)) - 0.85))))))::int
      else null
    end,
    case when met.prob is not null then 'metric' when a.si is not null or (g.start_date is not null and g.due_date is not null) then 'schedule' else 'insufficient' end,
    coalesce(a.blk, 0), coalesce(a.n, 0)
  from work_items g left join agg a on a.root = g.id left join met on met.item_id = g.id
  where g.team_id = p_team and g.parent_id is null and g.status not in ('dropped', 'proposed', 'changes_requested')
  order by g.sort, g.created_at;
end $$;

-- 시간 포트폴리오: 진행 중 항목(최상위 제외)의 주당 투입 시간과 기여도
create or replace function public.task_portfolio(p_team uuid)
returns table (task_id uuid, title text, goal_id uuid, mission_contribution int, hours numeric, share_pct numeric, owner_name text, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  return query
  with recursive tree as (
    select w.id, w.id as root, 0 as depth from work_items w where w.team_id = p_team and w.parent_id is null
    union all
    select c.id, t.root, t.depth + 1 from work_items c join tree t on c.parent_id = t.id
  ), h as (
    select w.id, w.title, t.root, w.contribution::int mc, w.status,
      coalesce((select sum(ta.share_pct / 100 * tm.weekly_hours) from work_item_allocations ta
                  join team_members tm on tm.team_id = w.team_id and tm.user_id = ta.user_id
                 where ta.item_id = w.id), w.est_hours_per_week, 0) hrs,
      (select p.full_name from profiles p where p.id = w.owner_id) owner_name
    from tree t join work_items w on w.id = t.id
    where t.depth >= 1 and w.status in ('active', 'blocked') and w.measure <> 'check'
  )
  select h.id, h.title, h.root, h.mc, round(h.hrs, 1),
         round(100 * h.hrs / nullif(sum(h.hrs) over (), 0), 1), h.owner_name, h.status::text
  from h order by h.hrs desc;
end $$;
grant execute on function public.goal_outlook(uuid), public.task_portfolio(uuid) to authenticated;

-- 항목별 계획 대비 (기준선 · 지연 예측 · 재계획)
create or replace function public.item_schedule(p_team uuid)
returns table (item_id uuid, title text, owner_id uuid, progress int, start_date date, due_date date, base_due date,
               slip_days int, replan_count int, velocity numeric, projected_done date, projected_delay int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  return query
  with v as (
    -- 최근 21일 진척 속도 (포인트/일)
    select l.item_id, (max(l.value) - min(l.value)) / greatest(1, max(l.period) - min(l.period)) as vel
    from work_item_logs l where l.team_id = p_team and l.kind = 'progress' and l.period >= current_date - 21
    group by l.item_id having count(*) >= 2
  )
  select w.id, w.title, w.owner_id, w.progress::int, w.start_date, w.due_date, w.base_due,
    case when w.base_due is not null and w.due_date is not null then (w.due_date - w.base_due) else null end,
    w.replan_count, round(v.vel, 2),
    case when w.status = 'done' then w.done_at::date
         when v.vel > 0 then (current_date + ceil((100 - w.progress) / v.vel)::int) end,
    case when w.status <> 'done' and w.due_date is not null and v.vel > 0
         then greatest(0, current_date + ceil((100 - w.progress) / v.vel)::int - w.due_date) end
  from work_items w left join v on v.item_id = w.id
  where w.team_id = p_team and w.status in ('active', 'blocked', 'done') and w.parent_id is not null
    and (w.due_date is not null or w.base_due is not null);
end $$;
grant execute on function public.item_schedule(uuid) to authenticated;

-- 성과 지도: 과제 → 항목
create or replace function public._perf_point(p_team uuid, p_user uuid, p_as_of date)
returns table (x numeric, y numeric, evidence int)
language sql stable security definer set search_path = public as $$
  with t as (
    select coalesce(avg(case when status = 'done' then 100 else progress end), null) prog
    from work_items where team_id = p_team and owner_id = p_user and status not in ('dropped', 'proposed', 'changes_requested')
      and parent_id is not null and created_at::date <= p_as_of and (done_at is null or done_at::date > p_as_of - 90)
  ), s as (
    select count(*) filter (where status = 'approved' and approved_at::date <= p_as_of) ap,
           count(*) filter (where status in ('approved','needs_work') and updated_at::date <= p_as_of) tot
    from submissions where team_id = p_team and author_id = p_user and created_at::date > p_as_of - 180
  ), j as (
    select avg(score) sc from judgment_scores
    where team_id = p_team and user_id = p_user and scored_at::date <= p_as_of and scored_at::date > p_as_of - 120
  ), e as (
    select count(*) n, count(distinct competency) comp from evidence
    where team_id = p_team and subject_user_id = p_user and occurred_at::date <= p_as_of
      and source in ('submission','observation','review_comment','leader_note','task')
  )
  select
    round(coalesce(0.7 * t.prog + 0.3 * (100.0 * s.ap / nullif(s.tot, 0)), t.prog, 100.0 * s.ap / nullif(s.tot, 0), 50), 1),
    round(case when j.sc is null then 50 else 0.7 * (j.sc / 4 * 100) + 0.3 * least(e.comp / 5.0, 1) * 100 end, 1),
    e.n::int
  from t, s, j, e;
$$;
revoke all on function public._perf_point(uuid,uuid,date) from public, anon, authenticated;

-- 인사이트 레벨: 공수 입력률을 항목 기준으로
create or replace function public.team_insight_level(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_members int; v_ci_weeks int; v_oo int; v_reviewed int; v_elig int; v_metric_months int;
  v_effort_pct int; v_dec_outcome int; v_approved int; v_quarters int;
  v_checkins int; v_obs int; v_subs int; v_items int;
  v_levels jsonb; v_level int := 1; v_i int; v_ok boolean; v_progress numeric;
  v_min_ev int := coalesce(((select settings from teams where id = p_team)->>'min_judgment_evidence')::int, 8);
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select greatest(count(*), 1) into v_members from team_members where team_id = p_team and status = 'active' and role = 'member';
  select count(distinct week_start), count(*) into v_ci_weeks, v_checkins from checkins where team_id = p_team;
  select count(*) into v_oo from one_on_ones where team_id = p_team and status = 'done';
  select count(distinct s.id) into v_reviewed from submissions s where s.team_id = p_team
    and (exists (select 1 from review_comments rc where rc.submission_id = s.id and rc.author_id <> s.author_id)
         or exists (select 1 from ai_outputs a join submission_versions sv on sv.id = a.ref_id
                    where a.ref_table = 'submission_versions' and sv.submission_id = s.id and a.kind = 'review'));
  select count(*) into v_subs from submission_versions where team_id = p_team;
  select count(*) into v_obs from observations where team_id = p_team;
  select count(*) into v_items from work_items where team_id = p_team and status not in ('dropped');
  select count(*) into v_elig from (
    select subject_user_id from evidence where team_id = p_team and source in ('submission','observation','review_comment','leader_note','task')
    group by subject_user_id having count(*) >= v_min_ev) x;
  select coalesce(max(n), 0) into v_metric_months from (
    select count(distinct period) n from metric_values where team_id = p_team group by metric_id) x;
  select coalesce(round(100.0 * count(*) filter (where est_hours_per_week is not null or exists (select 1 from work_item_allocations ta where ta.item_id = w.id))
                        / nullif(count(*), 0)), 0)
    into v_effort_pct from work_items w where team_id = p_team and parent_id is not null and measure <> 'check' and status in ('active','blocked');
  select count(*) into v_dec_outcome from decisions where team_id = p_team and outcome_rating is not null;
  select count(*) into v_approved from submissions where team_id = p_team and status = 'approved';
  select count(distinct date_trunc('quarter', period)) into v_quarters from metric_values
    where team_id = p_team and date_trunc('quarter', period) + interval '3 months' <= now();

  v_levels := jsonb_build_array(
    jsonb_build_object('level', 1, 'name', '기록 정리', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '사용 시작', 'current', 1, 'target', 1))),
    jsonb_build_object('level', 2, 'name', '패턴 발견', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '체크인이 쌓인 주', 'current', v_ci_weeks, 'target', 4, 'unit', '주'),
      jsonb_build_object('label', '완료된 1on1', 'current', v_oo, 'target', 2 * v_members, 'unit', '회'))),
    jsonb_build_object('level', 3, 'name', '진단', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '판단 근거 ' || v_min_ev || '건 이상인 팀원', 'current', v_elig, 'target', ceil(v_members / 2.0)::int, 'unit', '명'),
      jsonb_build_object('label', '리뷰한 결과물', 'current', v_reviewed, 'target', greatest(12, 5 * v_members), 'unit', '건'))),
    jsonb_build_object('level', 4, 'name', '예측', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '실적 데이터', 'current', v_metric_months, 'target', 3, 'unit', '개월'),
      jsonb_build_object('label', '과제 공수 입력률', 'current', v_effort_pct, 'target', 60, 'unit', '%'))),
    jsonb_build_object('level', 5, 'name', '팀 고유 인사이트', 'conditions', jsonb_build_array(
      jsonb_build_object('label', '결과가 기록된 의사결정', 'current', v_dec_outcome, 'target', 10, 'unit', '건'),
      jsonb_build_object('label', '예측과 실제 비교', 'current', v_quarters, 'target', 2, 'unit', '분기'),
      jsonb_build_object('label', '팀장이 승인한 결과물', 'current', v_approved, 'target', 20, 'unit', '건'))));

  for v_i in 1..4 loop
    select bool_and((c->>'current')::numeric >= (c->>'target')::numeric) into v_ok
      from jsonb_array_elements(v_levels->v_i->'conditions') c;
    exit when not v_ok;
    v_level := v_i + 1;
  end loop;
  if v_level < 5 then
    select round(100 * avg(least(1, (c->>'current')::numeric / nullif((c->>'target')::numeric, 0)))) into v_progress
      from jsonb_array_elements(v_levels->v_level->'conditions') c;
  end if;
  return jsonb_build_object(
    'level', v_level, 'levels', v_levels, 'next_progress', v_progress,
    'totals', jsonb_build_object('checkins', v_checkins, 'one_on_ones', v_oo, 'submissions', v_subs,
      'reviewed', v_reviewed, 'observations', v_obs, 'metric_months', v_metric_months, 'members', v_members, 'items', v_items));
end $$;

-- 샘플 데이터 (새 구조)
create or replace function public.seed_sample_strategy(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g1 uuid; g2 uuid; g3 uuid; t1 uuid; t3 uuid; m1 uuid; me uuid := auth.uid(); v_month date := date_trunc('month', current_date)::date;
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden'; end if;
  if exists (select 1 from work_items where team_id = p_team) then raise exception 'ALREADY_HAS_GOALS' using errcode = 'P0001'; end if;
  update teams set mission = coalesce(nullif(mission, ''), '신사업 기회를 빠르게 검증해, 회사의 다음 성장 동력을 만든다') where id = p_team;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution)
    values (p_team, me, '신제품 시장 진입 검증', 'children', 1, current_date - 60, current_date + 80, 5) returning id into g1;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution)
    values (p_team, me, '파트너 채널 확대', 'children', 2, current_date - 90, current_date + 70, 5) returning id into g2;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution)
    values (p_team, me, '팀 역량 강화', 'children', 3, current_date - 60, current_date + 100, 3) returning id into g3;
  insert into hypotheses (team_id, item_id, statement, signal) values
    (p_team, g1, '침투가로 Q1 파일럿 전환율 20% 이상', '인터뷰 12명 중 구매 의향 7명'),
    (p_team, g2, '파트너 제휴로 연내 계약 4억', '파트너 데이터 수급 2주째 지연'),
    (p_team, g3, '온보딩 개편으로 신규 입사자 적응 기간 3개월 → 2개월', '6주차 독립 수행률 60%');
  insert into work_items (team_id, parent_id, owner_id, title, measure, progress, contribution, priority, est_hours_per_week, start_date, due_date, sort)
    values (p_team, g1, me, '진입 전략 수립', 'children', 0, 5, 1, 12, current_date - 45, current_date + 40, 1) returning id into t1;
  insert into work_items (team_id, parent_id, owner_id, title, measure, status, sort) values
    (p_team, t1, me, '시장 규모 추정', 'check', 'done', 1), (p_team, t1, me, '경쟁사 가격 조사', 'check', 'done', 2),
    (p_team, t1, me, '진입 시나리오 3안', 'check', 'active', 3), (p_team, t1, me, '임원 보고', 'check', 'active', 4);
  insert into work_items (team_id, parent_id, owner_id, title, measure, progress, contribution, priority, est_hours_per_week, start_date, due_date, sort) values
    (p_team, g1, me, '가격 정책 확정', 'percent', 85, 4, 1, 6, current_date - 60, current_date + 10, 2);
  insert into work_items (team_id, parent_id, owner_id, title, measure, status, progress, contribution, priority, est_hours_per_week, start_date, due_date, sort)
    values (p_team, g2, me, '파트너 제안서', 'percent', 'blocked', 30, 5, 1, 4, current_date - 30, current_date + 20, 1) returning id into t3;
  insert into work_items (team_id, parent_id, owner_id, title, measure, progress, contribution, priority, est_hours_per_week, start_date, due_date, sort) values
    (p_team, g3, me, '온보딩 개선', 'percent', 66, 4, 2, 6, current_date - 50, current_date + 30, 1),
    (p_team, g3, me, '사내 보고 자료 정비', 'percent', 40, 1, 3, 10, current_date - 90, current_date + 60, 2);
  insert into work_items (team_id, parent_id, owner_id, title, measure, recur, contribution, priority, est_hours_per_week, sort) values
    (p_team, g3, me, '월간 리포트 운영', 'recurring', 'monthly', 2, 3, 6, 3);
  insert into metrics (team_id, item_id, name, unit, target, period_start, period_end, cumulative)
    values (p_team, g2, '파트너 계약 금액', '억', 20, (v_month - interval '3 months')::date, (v_month + interval '2 months')::date, true)
    returning id into m1;
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_current, num_target, unit, metric_id, sort)
    values (p_team, g2, me, '파트너 계약 금액', 'number', 11.2, 20, '억', m1, 2);
  insert into metric_values (metric_id, team_id, period, value, created_by) values
    (m1, p_team, (v_month - interval '3 months')::date, 3.4, me),
    (m1, p_team, (v_month - interval '2 months')::date, 3.6, me),
    (m1, p_team, (v_month - interval '1 months')::date, 4.2, me);
  insert into metric_pipeline (metric_id, team_id, label, amount, probability, expected_close) values
    (m1, p_team, 'B사 제휴', 4, 0.4, v_month + 45), (m1, p_team, 'C사 재계약', 2.5, 0.6, v_month + 30), (m1, p_team, 'D사 신규', 1.5, 0.3, v_month + 50);
end $$;
grant execute on function public.seed_sample_strategy(uuid) to authenticated;

-- 지표 값이 바뀌면 연결된 숫자 항목의 현재값을 맞춘다
create or replace function public.trg_metric_value_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_m metrics; v_actual numeric;
begin
  select * into v_m from metrics where id = coalesce(new.metric_id, old.metric_id);
  select case when v_m.cumulative then sum(value) else (array_agg(value order by period desc))[1] end into v_actual
    from metric_values where metric_id = v_m.id;
  update work_items set num_current = v_actual, num_target = coalesce(num_target, v_m.target), unit = coalesce(nullif(unit, ''), v_m.unit)
    where metric_id = v_m.id and measure = 'number';
  return null;
end $$;
create trigger t_mv_item after insert or update or delete on public.metric_values for each row execute function public.trg_metric_value_item();

-- =====================================================================
-- 과금 v2
--   · 30일 체험 (카드 없음) → 끝나면 Free: 기록 도구는 계속, AI는 잠김
--   · 코어 AI (브리핑·인사이트·1차 검토·1on1 준비·주간보고·계획 수정·셀프 점검)는 구독에 포함, 공정 사용 한도만
--   · 프리미엄 AI (평가 초안·계획서 초안·노하우 정리·전망/시나리오 해석)는 크레딧
-- =====================================================================
alter table public.plans add column if not exists core_monthly_cap int not null default 0;
alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('monthly_grant','topup','usage','refund','adjust','core_usage'));

update public.plans set monthly_credits = 0, core_monthly_cap = 0,
  features = array['checkin','one_on_one','review_room','goals','requests','knowhow','signals_basic'] where id = 'free';
update public.plans set monthly_credits = 100, core_monthly_cap = 400,
  features = array['checkin','one_on_one','review_room','goals','requests','knowhow','signals_basic','signals',
                   'ai_core','ai_premium','perf_map','forecast','strategy','simulation','evaluation','insight','care_radar'] where id = 'pro';
update public.plans set monthly_credits = 300, core_monthly_cap = 1000,
  features = array['checkin','one_on_one','review_room','goals','requests','knowhow','signals_basic','signals',
                   'ai_core','ai_premium','perf_map','forecast','strategy','simulation','evaluation','insight','care_radar',
                   'integrations','multi_team','priority_model'] where id = 'pro_plus';

-- 체험은 30일, 체험 중 프리미엄 크레딧 30
create or replace function public.create_team(p_name text, p_mission text default '', p_job_title text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_plan plans; v_owned int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from subscriptions where owner_id = auth.uid()) then
    insert into subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (auth.uid(), 'pro', 'trialing', now() + interval '30 days', now(), now() + interval '30 days');
  end if;
  v_plan := public.effective_plan_for_owner(auth.uid());
  select count(*) into v_owned from teams where owner_id = auth.uid();
  if v_owned >= v_plan.max_teams then
    raise exception 'PLAN_LIMIT_TEAMS' using errcode = 'P0001', hint = v_plan.max_teams::text;
  end if;
  insert into teams (name, mission, owner_id, settings) values (p_name, coalesce(p_mission, ''), auth.uid(),
    jsonb_build_object('level_names', '["목표","과제","할 일"]'::jsonb, 'member_free_edit', false)) returning id into v_team;
  insert into team_members (team_id, user_id, role, job_title) values (v_team, auth.uid(), 'leader', coalesce(p_job_title, ''));
  perform log_event(v_team, 'team.created', 'teams', v_team);
  return v_team;
end $$;

create or replace function public._ensure_credit_period(p_owner uuid) returns public.credit_balances
language plpgsql security definer set search_path = public as $$
declare
  v_plan  plans := public.effective_plan_for_owner(p_owner);
  v_start timestamptz; v_sub subscriptions; v_bal credit_balances; v_amount int;
begin
  select * into v_sub from subscriptions where owner_id = p_owner;
  v_start := coalesce(v_sub.current_period_start, date_trunc('month', now()));
  while v_start + interval '1 month' <= now() loop v_start := v_start + interval '1 month'; end loop;
  while v_start > now() loop v_start := v_start - interval '1 month'; end loop;
  v_amount := case when v_sub.status = 'trialing' and v_plan.id <> 'free' then least(v_plan.monthly_credits, 30) else v_plan.monthly_credits end;

  select * into v_bal from credit_balances where owner_id = p_owner for update;
  if not found then
    insert into credit_balances (owner_id, period_start, monthly_remaining) values (p_owner, v_start, v_amount) returning * into v_bal;
    insert into credit_ledger (owner_id, delta, reason) values (p_owner, v_amount, 'monthly_grant');
  elsif v_bal.period_start < v_start then
    update credit_balances set period_start = v_start, monthly_remaining = v_amount, updated_at = now()
      where owner_id = p_owner returning * into v_bal;
    insert into credit_ledger (owner_id, delta, reason) values (p_owner, v_amount, 'monthly_grant');
  end if;
  return v_bal;
end $$;

-- 코어 AI 사용 기록 (크레딧 차감 없음, 공정 사용 한도 확인)
create or replace function public.consume_core(p_team uuid, p_kind text, p_ai_output uuid default null,
  p_model text default null, p_in int default null, p_out int default null, p_cost numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_bal credit_balances; v_plan plans; v_used int;
begin
  select owner_id into v_owner from teams where id = p_team;
  v_bal := public._ensure_credit_period(v_owner);
  v_plan := public.effective_plan_for_owner(v_owner);
  select count(*) into v_used from credit_ledger where owner_id = v_owner and reason = 'core_usage' and created_at >= v_bal.period_start;
  if v_used >= v_plan.core_monthly_cap then raise exception 'CORE_LIMIT' using errcode = 'P0001'; end if;
  insert into credit_ledger (owner_id, team_id, delta, reason, ai_kind, ai_output_id, model, input_tokens, output_tokens, cost_usd)
    values (v_owner, p_team, 0, 'core_usage', p_kind, p_ai_output, p_model, p_in, p_out, p_cost);
end $$;
revoke all on function public.consume_core(uuid,text,uuid,text,int,int,numeric) from public, anon, authenticated;

create or replace function public.credit_status(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_bal credit_balances; v_plan plans; v_sub subscriptions; v_core int;
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select owner_id into v_owner from teams where id = p_team;
  v_bal := public._ensure_credit_period(v_owner);
  v_plan := public.effective_plan_for_owner(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  select count(*) into v_core from credit_ledger where owner_id = v_owner and reason = 'core_usage' and created_at >= v_bal.period_start;
  return jsonb_build_object(
    'plan_id', v_plan.id, 'plan_name', v_plan.name, 'features', to_jsonb(v_plan.features),
    'max_members', v_plan.max_members, 'monthly_credits', v_plan.monthly_credits,
    'monthly_remaining', v_bal.monthly_remaining, 'topup_remaining', v_bal.topup_remaining,
    'core_used', v_core, 'core_cap', v_plan.core_monthly_cap,
    'period_start', v_bal.period_start, 'period_end', v_bal.period_start + interval '1 month',
    'status', case when v_plan.id = 'free' then 'free' else coalesce(v_sub.status::text, 'free') end,
    'trial_ends_at', v_sub.trial_ends_at,
    'trial_expired', v_sub.status = 'trialing' and v_sub.trial_ends_at < now(),
    'is_owner', v_owner = auth.uid());
end $$;

-- 활동 중이고 AI가 켜진 팀 (예약 인사이트 대상)
create or replace function public.active_ai_teams() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from teams t
  where public.team_has_feature(t.id, 'ai_core')
    and exists (select 1 from events e where e.team_id = t.id and e.created_at > now() - interval '14 days');
$$;
revoke all on function public.active_ai_teams() from public, anon, authenticated;

-- >>>>>>>>>> 20261014000010_demo.sql
-- =====================================================================
-- 데모 팀: 팀장·팀원 데모 계정으로 로그인해 체험하는 가상 팀
--   · teams.is_demo — 요금제의 팀 수 한도에서 빠짐, 예약 AI 인사이트는 만든 뒤 14일만
--   · seed_demo_team() — 약 6개월치 기록을 채움 (SQL Editor·service_role 전용)
--   · 계정 만들기는 supabase/demo_accounts.sql (대시보드 06_demo_accounts.sql)
-- =====================================================================
alter table public.teams add column if not exists is_demo boolean not null default false;

-- 팀 수 한도는 데모 팀을 세지 않는다
create or replace function public.create_team(p_name text, p_mission text default '', p_job_title text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_plan plans; v_owned int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from subscriptions where owner_id = auth.uid()) then
    insert into subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (auth.uid(), 'pro_plus', 'trialing', now() + interval '14 days', now(), now() + interval '14 days');  -- 요금제 v3: 체험 14일 · Pro+ 전체
  end if;
  v_plan := public.effective_plan_for_owner(auth.uid());
  select count(*) into v_owned from teams where owner_id = auth.uid() and not is_demo;
  if v_owned >= v_plan.max_teams then
    raise exception 'PLAN_LIMIT_TEAMS' using errcode = 'P0001', hint = v_plan.max_teams::text;
  end if;
  insert into teams (name, mission, owner_id, settings) values (p_name, coalesce(p_mission, ''), auth.uid(),
    jsonb_build_object('level_names', '["목표","과제","할 일"]'::jsonb, 'member_free_edit', false)) returning id into v_team;
  insert into team_members (team_id, user_id, role, job_title) values (v_team, auth.uid(), 'leader', coalesce(p_job_title, ''));
  perform log_event(v_team, 'team.created', 'teams', v_team);
  return v_team;
end $$;

-- 예약 인사이트: 데모 팀은 만든 뒤 14일만 (원가)
create or replace function public.active_ai_teams() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from teams t
  where public.team_has_feature(t.id, 'ai_core')
    and (not t.is_demo or t.created_at > now() - interval '14 days')
    and exists (select 1 from events e where e.team_id = t.id and e.created_at > now() - interval '14 days');
$$;
revoke all on function public.active_ai_teams() from public, anon, authenticated;

-- 마케팅기획팀. p_members 순서: 김현정(브랜드) · 박서연(퍼포먼스) · 최다은(콘텐츠) · 정우성(제휴) · 이동욱(CRM) · 한수진(신규)
create or replace function public.seed_demo_team(p_team uuid, p_leader uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  L uuid := p_leader;
  m_kim uuid := p_members[1];
  m_park uuid := p_members[2];
  m_choi uuid := p_members[3];
  m_jung uuid := p_members[4];
  m_lee uuid := p_members[5];
  m_han uuid := p_members[6];
  T uuid := p_team;
  g1 uuid; g2 uuid; g3 uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; mt uuid;
  sub uuid; ver uuid; oo uuid;
  wk date; i int; u record; v_month date := date_trunc('month', current_date)::date;
  this_mon date := date_trunc('week', current_date)::date;
begin
  if coalesce(array_length(p_members, 1), 0) <> 6 then raise exception 'seed_demo_team: 팀원 6명이 필요합니다'; end if;
  if not exists (select 1 from teams where id = T and is_demo and owner_id = L) then raise exception 'seed_demo_team: 데모 팀이 아닙니다'; end if;

  update teams set name = '마케팅기획팀 (데모)', mission = '고객 데이터를 근거로 캠페인을 빠르게 검증해, 신규 고객 획득과 재구매를 함께 늘린다',
    parent_link = '2026 회사 전략 목표 「신규 고객 30만 명 확보」 · 기여 비중 40%' where id = T;
  insert into team_members (team_id, user_id, role, job_title, joined_at) values (T, L, 'leader', '팀장', now() - interval '200 days')
    on conflict (team_id, user_id) do update set role = 'leader', status = 'active', joined_at = now() - interval '200 days';
  insert into team_members (team_id, user_id, role, job_title, joined_at) values
    (T, m_kim, 'member', '브랜드 마케팅', now() - interval '190 days'),
    (T, m_park, 'member', '퍼포먼스 마케팅', now() - interval '190 days'),
    (T, m_choi, 'member', '콘텐츠 마케팅', now() - interval '180 days'),
    (T, m_jung, 'member', '제휴 마케팅', now() - interval '180 days'),
    (T, m_lee, 'member', 'CRM 마케팅', now() - interval '150 days'),
    (T, m_han, 'member', '마케팅 기획 (신규)', now() - interval '42 days');

  -- 목표·과제 (자유 계층)
  update teams set settings = settings || '{"level_names":["목표","과제","할 일"],"member_free_edit":false}'::jsonb
    || '{"plan_open": true}'::jsonb where id = T;   -- 정우성 계획 요청 중이라 팀원 수정 켜 둠
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '하반기 신제품 런칭 캠페인 성공', 'children', 1, current_date - 60, current_date + 80, 5, now() - interval '60 days') returning id into g1;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '제휴 채널 신규 고객 확대', 'children', 2, current_date - 90, current_date + 70, 5, now() - interval '90 days') returning id into g2;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '마케팅 운영 효율화', 'children', 3, current_date - 60, current_date + 100, 3, now() - interval '60 days') returning id into g3;
  insert into hypotheses (team_id, item_id, statement, signal) values
    (T, g1, '얼리버드 할인으로 사전 예약 전환율 20% 이상', '고객 FGI 12명 중 구매 의향 7명'),
    (T, g2, 'B사 멤버십 제휴로 연내 신규 고객 8만 명', 'B사 회원 데이터 수급 2주째 지연'),
    (T, g3, '콘텐츠 제작 리드타임 3주 → 2주', '최근 4건 평균 2.6주');
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '런칭 캠페인 기획', m_kim, 1, 5, 16, 'children', 0, current_date - 45, current_date + 40, 1, now() - interval '45 days') returning id into t1;
  insert into work_items (team_id, parent_id, owner_id, title, measure, status, due_date, sort) values
    (T, t1, m_kim, '타깃 고객 정의', 'check', 'done', current_date - 30, 1),
    (T, t1, m_kim, '경쟁사 캠페인 분석', 'check', 'done', current_date - 10, 2),
    (T, t1, m_kim, '크리에이티브 시안 3안', 'check', 'active', current_date + 10, 3),
    (T, t1, m_han, '고객 FGI 12명', 'check', 'active', current_date + 20, 4),
    (T, t1, m_kim, '임원 보고', 'check', 'active', current_date + 38, 5);
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '런칭 프로모션 정책 확정', m_kim, 1, 4, 8, 'percent', 85, current_date - 60, current_date - 5, 2, now() - interval '60 days') returning id into t2;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, status, start_date, due_date, sort, created_at) values
    (T, g2, '제휴 프로모션 제안서', m_jung, 1, 5, 6, 'percent', 30, 'blocked', current_date - 30, current_date + 20, 1, now() - interval '30 days') returning id into t3;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g2, '제휴 유입 고객 CRM 연계', m_lee, 2, 4, 6, 'percent', 35, current_date - 40, current_date + 50, 2, now() - interval '40 days') returning id into t4;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '콘텐츠 제작 프로세스 개선', m_choi, 2, 4, 10, 'percent', 66, current_date - 50, current_date + 30, 1, now() - interval '50 days') returning id into t5;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '채널별 성과 보고 체계 정비', m_jung, 3, 1, 18, 'percent', 40, current_date - 90, current_date + 60, 2, now() - interval '90 days') returning id into t6;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, recur, sort, created_at) values
    (T, g3, '월간 광고 성과 리포트 운영', m_park, 3, 2, 12, 'recurring', 'monthly', 3, now() - interval '120 days') returning id into t7;
  insert into work_item_logs (item_id, team_id, author_id, kind, period, done) values
    (t7, T, m_park, 'recurring', (v_month - interval '3 months')::date, true), (t7, T, m_park, 'recurring', (v_month - interval '2 months')::date, true),
    (t7, T, m_park, 'recurring', (v_month - interval '1 months')::date, false);
  -- 일정 변경 이력 (재계획 2회)
  update work_items set due_date = current_date + 5, change_reason = '경쟁사 할인 행사 추가 확인' where id = t2;
  update work_items set due_date = current_date + 10, change_reason = '임원 일정' where id = t2;
  -- 진척 기록 (최근 3주 속도)
  insert into work_item_logs (item_id, team_id, author_id, kind, period, value) values
    (t3, T, m_jung, 'progress', current_date - 21, 22), (t3, T, m_jung, 'progress', current_date - 14, 26), (t3, T, m_jung, 'progress', current_date - 7, 28),
    (t4, T, m_lee, 'progress', current_date - 21, 20), (t4, T, m_lee, 'progress', current_date - 14, 27),
    (t5, T, m_choi, 'progress', current_date - 21, 45), (t5, T, m_choi, 'progress', current_date - 14, 55)
    on conflict do nothing;
  -- 팀원이 올린 계획(검토 대기) + 팀장 요청
  insert into work_items (team_id, parent_id, owner_id, title, note, measure, status, start_date, due_date, sort)
    values (T, g2, m_lee, '제휴 고객 웰컴 메시지 A/B 테스트', '2개 문구 × 2주, 재방문율 비교', 'percent', 'proposed', current_date + 3, current_date + 35, 3);
  insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, due_date)
    values (T, L, m_jung, 'plan', g2, '제휴 채널 신규 고객 확대 — 하위 과제 계획 세워 주세요', '제안서 이후 실행 단계까지 포함해서요', current_date + 3);
  insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, due_date) values
    (T, L, m_park, 'share', t7, '광고 성과 대시보드 개편 화면 캡처 공유해 주세요', '지난주 말씀하신 1차 배포 화면이요. 승인까지는 필요 없습니다.', current_date + 2),
    (T, L, m_han, 'progress', t1, '고객 FGI 진행 상황 업데이트 부탁해요', '몇 명 했는지, 막히는 게 있는지만 짧게요', current_date + 1);
  -- 팀원 상세 액션: 지원·격려 / 육성 (요청 종류 추가 14_request_kinds 이후에만 들어감)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, title, body, created_at) values
      (T, L, m_lee, 'cheer', '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 같이 볼게요.', '', now() - interval '1 day'),
      (T, L, m_choi, 'grow', '다음 분기에 콘텐츠 운영 전체를 맡아 보면 어때요? 해 보고 싶은 범위를 알려 줘요', '', now() - interval '2 days');
    -- 팀원 → 팀장 1on1 요청 (팀원 앱에서 '1on1 요청하기')
    insert into team_requests (team_id, from_id, to_id, kind, title, body, created_at) values
      (T, m_lee, L, 'meeting', 'CRM 연계 방향이 맞는지 한번 같이 보고 싶어요', '', now() - interval '5 hours');
  exception when others then null;
  end;
  -- 김현정: '팀장님과' 받은함 예시 (열린 것 · 답한 것이 섞이게)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, title, body, due_date, created_at) values
      (T, L, m_kim, 'other', '목요일 30분, 런칭 FGI 결과 같이 봐요', '정리 안 된 상태로 가져와도 됩니다', current_date + 2, now() - interval '6 hours'),
      (T, L, m_kim, 'grow', '하반기 신규 브랜드 론칭을 리드해 보면 어때요? 해 보고 싶은 범위를 알려 줘요', '', null, now() - interval '3 days'),
      (T, L, m_kim, 'progress', '진행 상황과 막힌 점 공유 부탁해요', '지금까지 한 것과 남은 것만 짧게요', current_date + 3, now() - interval '1 day');   -- 업무 독려 (과제 없이 → 매니징 보드 Feedback)
    insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, status, response, responded_at, created_at) values
      (T, L, m_kim, 'share', t1, '런칭 기획서 v2 올려 주세요', '임원 보고 전에 한 번 보고 싶어요', 'done', '업무플랫폼에 v2 올렸습니다', now() - interval '19 days', now() - interval '20 days'),
      (T, L, m_kim, 'cheer', null, '임원 보고 준비하느라 고생 많았어요. 이번 주는 조금 쉬어 가요', '', 'done', '감사합니다. 금요일 오후 반차 쓰겠습니다', now() - interval '9 days', now() - interval '10 days');
  exception when others then null;
  end;
  -- 팀원 → 팀장 목표 변경 요청 (22_plan_window 이후에만 들어감)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, created_at) values
      (T, m_choi, L, 'change', t5, '콘텐츠 제작 프로세스 개선 — 마감 2주 연장 요청',
       '외주 제작사 교체로 템플릿 정비가 늦어졌습니다. 마감을 2주 미루고, 목표 범위에서 영상 가이드는 다음 분기로 넘기고 싶어요.', now() - interval '1 day');
  exception when others then null;
  end;
  insert into work_item_allocations (item_id, user_id, team_id, share_pct) values
    (t1, m_kim, T, 40), (t1, m_han, T, 30), (t2, m_kim, T, 20), (t3, m_jung, T, 15), (t4, m_lee, T, 20),
    (t5, m_choi, T, 30), (t6, m_jung, T, 45), (t6, m_park, T, 10), (t7, m_park, T, 30);

  insert into metrics (team_id, item_id, name, unit, target, period_start, period_end, cumulative)
    values (T, g2, '제휴 채널 신규 고객', '만 명', 20, (v_month - interval '3 months')::date, (v_month + interval '2 months')::date, true) returning id into mt;
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_target, unit, metric_id, sort)
    values (T, g2, m_lee, '제휴 채널 신규 고객', 'number', 20, '만 명', mt, 4);
  -- 목표마다 지표(결과를 재는 항목) — 목표 진척은 지표 평균 (23_goal_metrics)
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_current, num_target, unit, sort, start_date, due_date) values
    (T, g1, m_kim, '런칭 사전 예약 누적', 'number', 1840, 5000, '건', 0, current_date - 45, current_date + 40),
    (T, g2, m_lee, '제휴 고객 30일 재방문율', 'number', 22, 35, '%', 5, current_date - 40, current_date + 50);
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_current, num_target, unit, higher_is_better, sort, start_date, due_date)
    values (T, g3, m_choi, '콘텐츠 제작 리드타임', 'number', 6, 5, '일', false, 0, current_date - 50, current_date + 30);
  begin
    execute $q$insert into work_items (team_id, parent_id, owner_id, title, measure, stages, stage_current, sort, start_date, due_date)
      values ($1, $2, $3, '성과 보고 체계 표준화', 'stage', array['착수', '초안', '검증', '확정', '확산'], 2, 1, current_date - 60, current_date + 60)$q$ using T, g3, m_jung;
  exception when others then null;
  end;
  insert into metric_values (metric_id, team_id, period, value) values
    (mt, T, (v_month - interval '3 months')::date, 3.4), (mt, T, (v_month - interval '2 months')::date, 3.6), (mt, T, (v_month - interval '1 months')::date, 4.2);
  insert into metric_pipeline (metric_id, team_id, label, amount, probability, expected_close) values
    (mt, T, 'B사 멤버십 제휴', 4, 0.4, v_month + 45), (mt, T, 'C사 카드 프로모션 재계약', 2.5, 0.6, v_month + 30), (mt, T, 'D사 앱 공동 이벤트', 1.5, 0.3, v_month + 50);

  -- 컨디션 공유 26주 (업무 칸은 비움 — 컨디션 · 영향 요인 · 메모만)
  for i in 1..26 loop
    wk := this_mon - (i * 7);
    insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
      (T, m_kim, wk, '', '', '', case when i <= 1 then 3 else 4 end),
      (T, m_park, wk, '', '', '', 4),
      (T, m_choi, wk, '', '', '', case when i % 5 = 0 then 3 else 4 end),
      (T, m_jung, wk, '', '', '', case when i <= 2 then 3 else 4 end);
    if i <= 20 then
      insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
        (T, m_lee, wk, '', '', '', case i when 1 then 2 when 2 then 3 when 3 then 4 else 4 end);
    end if;
    if i <= 5 then
      insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
        (T, m_han, wk, '', '', '', 4);
    end if;
  end loop;
  -- 지난 기록의 작성 시각을 그 주 금요일로
  update checkins set created_at = week_start + interval '4 days 17 hours', updated_at = week_start + interval '4 days 17 hours' where team_id = T;
  -- 이번 주: 이동욱만 미공유
  insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
    (T, m_kim, this_mon, '', '', '', 3),
    (T, m_park, this_mon, '', '', '', 4),
    (T, m_choi, this_mon, '', '', '', 4),
    (T, m_jung, this_mon, '', '', '', 2),
    (T, m_han, this_mon, '', '', '', 4);
  -- 영향 요인 · 메모 (24_condition 의 moods · note 칸 — 아직 없으면 건너뜀)
  begin
    execute $q$update checkins set moods = array['rested'] where team_id = $1 and condition >= 4 and (extract(week from week_start)::int % 4) = 0$q$ using T;
    execute $q$update checkins set moods = array['energized'] where team_id = $1 and condition >= 4 and (extract(week from week_start)::int % 4) = 2$q$ using T;
    for u in select * from (values
        (m_kim, 0, array['tired']::text[], ''), (m_kim, 1, array['tired']::text[], ''),
        (m_park, 0, array['rested', 'energized']::text[], ''),
        (m_choi, 0, array['rested']::text[], ''),
        (m_jung, 0, array['personal', 'tired']::text[], '이번 주 이사 일정으로 오후 시간이 유동적입니다'),
        (m_jung, 1, array['personal']::text[], ''), (m_jung, 2, array['heavy']::text[], ''),
        (m_lee, 1, array['heavy', 'need_rest']::text[], ''), (m_lee, 2, array['tired']::text[], ''),
        (m_han, 0, array['energized']::text[], '')) as x(uid, ago, moods, note)
    loop
      execute 'update checkins set moods = $1, note = $2 where team_id = $3 and user_id = $4 and week_start = $5' using u.moods, u.note, T, u.uid, this_mon - u.ago * 7;
    end loop;
  exception when undefined_column then null;
  end;

  -- 1on1 (격주, 완료)
  for u in select * from (values (m_kim, 12), (m_park, 11), (m_choi, 10), (m_jung, 9), (m_lee, 5), (m_han, 3)) as x(uid, n) loop
    for i in 1..u.n loop
      insert into one_on_ones (team_id, leader_id, member_id, scheduled_at, status, shared_notes, completed_at)
      values (T, L, u.uid, now() - ((case when u.uid = m_lee then 21 else 7 end) + (i - 1) * 14) * interval '1 day', 'done',
              case when u.uid = m_kim and i = 1 then '런칭 프로모션을 얼리버드 할인 중심으로 바꾸는 방향에 합의. 2번 가설은 고객 FGI로 검증하기로 함.'
                   else '진행 상황 공유, 다음 2주 우선순위 확인' end,
              now() - ((case when u.uid = m_lee then 21 else 7 end) + (i - 1) * 14) * interval '1 day');
    end loop;
  end loop;
  insert into one_on_ones (team_id, leader_id, member_id, scheduled_at) values
    (T, L, m_kim, date_trunc('day', now()) + interval '14 hours'),
    (T, L, m_park, date_trunc('week', now()) + interval '3 days 10 hours');
  insert into action_items (team_id, owner_id, title, due_date, created_by) values
    (T, L, '경쟁사 캠페인 분석 리포트 공유', current_date - 7, L),
    (T, m_kim, 'FGI 설계안 초안', current_date + 2, L),
    (T, L, '4분기 광고 예산 재배분 확인', current_date + 4, L);

  -- 팀장 노하우: 일 잘하는 방식 · 좋은 결과물의 기준 (AI 검토 · 코칭 · 1on1 준비 · 보고가 읽는다)
  begin
    insert into knowhow_cards (team_id, owner_id, kind, title, body, rules, applies_to, keywords, pinned, shared, provenance, use_count, last_used_at, created_at) values
      (T, L, 'principle', '결론부터, 한 장으로', '보고는 첫 줄에 결론(무엇을 하자는지, 무엇을 정해 달라는지)을 쓰고 근거는 그 아래에 둔다. 첫 장만 읽어도 판단할 수 있어야 한다.',
        '["첫 줄에 결론과 요청 사항", "근거는 3개 이내로", "첫 장만 보고 결정할 수 있게"]'::jsonb, '{review,report,briefing}', '{결론,보고,한장}', true, true, 'human', 14, now() - interval '1 day', now() - interval '120 days'),
      (T, L, 'rubric', '좋은 기획서의 조건', '정보를 모은 것과 기획은 다르다. 내가 무엇을 문제로 보는지, 왜 이 안을 골랐는지가 보여야 한다.',
        '["문제 정의를 본인 언어로", "대안 2개 이상 비교하고 버린 이유", "리스크와 대응", "다음 행동·담당·일정까지"]'::jsonb, '{review,evaluation}', '{기획서,대안,리스크}', true, true, 'human', 11, now() - interval '2 days', now() - interval '110 days'),
      (T, L, 'principle', '숫자에는 출처와 비교 기준', '숫자만 있으면 판단이 안 된다. 어디서 나온 숫자인지, 무엇과 비교해 좋은지 나쁜지가 함께 있어야 한다.',
        '["숫자마다 출처", "지난달·목표 대비로 쓴다", "추정치는 가정을 함께"]'::jsonb, '{review,report}', '{숫자,출처,근거}', false, true, 'human', 9, now() - interval '3 days', now() - interval '100 days'),
      (T, L, 'rubric', '올리기 전 완성도 점검 3가지', '초안이어도 괜찮지만, 아래 세 가지는 비워 두지 않는다.',
        '["미정·TBD로 남긴 곳이 없는가", "요청받은 질문에 다 답했는가", "다음 행동과 날짜가 있는가"]'::jsonb, '{review}', '{완성도,점검}', false, true, 'human', 6, now() - interval '4 days', now() - interval '60 days'),
      (T, L, 'framework', '보고서 기본 구조', '결론 → 배경 → 대안 비교 → 리스크 → 다음 행동 순서. 분량보다 이 순서를 지키는 것이 중요하다.',
        '["결론 → 배경 → 대안 → 리스크 → 다음 행동"]'::jsonb, '{review,report}', '{구조,양식}', false, true, 'human', 7, now() - interval '6 days', now() - interval '90 days'),
      (T, L, 'principle', '막히면 이틀 안에 말한다', '혼자 오래 붙들수록 손해다. 막힌 지 이틀이 되면 무엇이 필요한지 한 줄로 공유한다. 도움을 청하는 건 약점이 아니다.',
        '["막힘은 2일 안에 공유", "무엇이 필요한지 함께 쓴다"]'::jsonb, '{review,prep,briefing}', '{막힘,공유}', false, true, 'human', 5, now() - interval '5 days', now() - interval '80 days'),
      (T, L, 'coaching', '1on1은 사람 먼저', '1on1 첫 10분은 업무가 아니라 컨디션과 어려움을 묻는다. 해결책보다 먼저 듣고, 약속은 하나만 정한다.',
        '["첫 10분은 사람 이야기", "약속은 하나만, 날짜와 함께"]'::jsonb, '{prep}', '{1on1,코칭}', false, false, 'human', 8, now() - interval '2 days', now() - interval '70 days'),
      (T, L, 'context', '하반기 우리 팀 우선순위', '하반기 최우선은 신제품 런칭과 제휴 채널 확대. 전사 비용 15% 절감 방침이 있어, 예산이 드는 안은 CAC 근거를 함께 낸다.',
        '["런칭·제휴가 최우선", "예산 안에는 CAC 근거"]'::jsonb, '{review,strategy,briefing,prep}', '{우선순위,예산,CAC}', true, false, 'human', 10, now() - interval '1 day', now() - interval '40 days');
  exception when others then null;
  end;

  -- 결과물: 김현정 기획서 v1~v3 (리뷰 중)
  insert into submissions (team_id, author_id, item_id, title, status, created_at) values (T, m_kim, t1, '하반기 신제품 런칭 캠페인 기획서', 'in_review', now() - interval '30 days') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 1, E'1. 시장·고객\n타깃 2030 직장인, 관련 시장 1.2조 연 8% 성장.\n\n2. 프로모션 — 정가 런칭\n할인 없이 정가로 런칭해 프리미엄 브랜드 이미지를 우선한다.', '초안', m_kim, now() - interval '30 days'),
    (sub, T, 2, E'1. 시장·고객\n타깃 2030 직장인, 관련 시장 1.2조 연 8% 성장. 주요 경쟁사 3곳.\n\n2. 프로모션 — 정가 런칭\n브랜드 인지도 조사 결과 반영 예정.\n\n3. 채널 계획\n유튜브·인스타그램 중심, 사전 예약 페이지.', '채널 계획 추가', m_kim, now() - interval '16 days');
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 3, E'1. 시장·고객\n타깃 2030 직장인, 관련 시장 1.2조 연 8% 성장. 주요 경쟁사 3곳의 점유율 합계 61%.\n\n2. 프로모션 — 얼리버드 할인\n경쟁사 캠페인 재분석 결과, 브랜드 인지도가 낮은 상태에서 정가 런칭은 초기 전환을 막는다고 판단했다. 사전 예약 고객에게 15% 얼리버드 할인을 주고, 런칭 6주 뒤 정가로 전환한다. 버린 대안: 정가 런칭(인지도 부족), 상시 할인(브랜드 훼손).\n\n3. 채널 계획\n유튜브·인스타그램 중심 사전 예약 → 런칭 후 제휴 채널(B사 멤버십) 확대.\n\n4. 가설별 검증 계획\n가설 1: 얼리버드 할인으로 사전 예약 전환율 20% 이상 — 예약 페이지 데이터로 검증\n가설 2: 3040 직장인도 주 고객 — 고객 FGI 12명으로 검증 (데이터 보강 필요)',
     '프로모션을 얼리버드 할인으로 전면 수정', m_kim, now() - interval '4 days') returning id into ver;
  insert into review_comments (submission_id, version_id, team_id, author_id, section_ref, body, created_at) values
    (sub, ver, T, L, '§2 프로모션', '근거가 좋아요. 다만 2번 가설은 데이터가 더 필요해 보입니다.', now() - interval '3 days');
  insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at, parent_id)
    select sub, ver, T, m_kim, '다음 주 고객 FGI로 보강하겠습니다.', now() - interval '3 days', id from review_comments where submission_id = sub limit 1;

  insert into submissions (team_id, author_id, item_id, title, status) values (T, m_choi, t5, '콘텐츠 제작 프로세스 개선안', 'in_review') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by) values
    (sub, T, 1, E'콘텐츠 제작 프로세스 개선안\n1. 현황: 콘텐츠 1건 제작 리드타임 평균 3주\n2. 개선: 브리프 템플릿, 디자인팀 주간 고정 슬롯', '초안', m_choi),
    (sub, T, 2, E'콘텐츠 제작 프로세스 개선안\n1. 현황: 콘텐츠 1건 제작 리드타임 평균 3주 (최근 10건 기준)\n2. 개선: 브리프 템플릿, 디자인팀 주간 고정 슬롯, 중간 리뷰 1회로 축소\n3. 측정: 월 제작 건수, 리드타임', '측정 지표 추가', m_choi);

  -- 지난 결과물 (승인 13건) + 판단 깊이 기록
  for i in 1..13 loop
    insert into submissions (team_id, author_id, title, created_at)
    values (T, (array[m_kim, m_park, m_choi, m_jung, m_kim, m_park, m_choi, m_kim, m_jung, m_park, m_choi, m_kim, m_lee])[i],
            (array['고객 세그먼트 분석','광고 성과 진단','SNS 채널 운영안','제휴사 후보 리스트','경쟁사 캠페인 동향','광고 성과 대시보드 설계','콘텐츠 가이드라인','고객 페르소나 정의','제휴 조건 비교','리포트 자동화 계획','브랜드 톤앤매너 정리','가격 민감도 분석','CRM 메시지 개편'])[i],
            now() - (170 - i * 11) * interval '1 day')
    returning id into sub;
    insert into submission_versions (submission_id, team_id, version, extracted_text, created_by, created_at)
    values (sub, T, 1, (array[
      E'고객 세그먼트 분석\n1. 구매 데이터 기준 4개 세그먼트: 가성비형 34%, 트렌드형 27%, 충성형 22%, 이탈 위험 17%\n2. 신제품 1차 타깃: 트렌드형 — 객단가 상위 30%, SNS 유입 비중 62%\n3. 다음: 트렌드형 대상 메시지 테스트',
      E'광고 성과 진단\n1. 3분기 CAC 2.9만 원 (전 분기 대비 +12%)\n2. 원인: 인스타그램 소재 피로도 — 같은 소재 6주 이상 집행\n3. 제안: 소재 교체 주기 3주로 단축, 제휴 채널 테스트 예산 10% 배정',
      E'SNS 채널 운영안\n1. 목표: 런칭 전 팔로워 3만 → 5만\n2. 주 3회 정기 콘텐츠 + 월 1회 협업 라이브\n3. 성과 지표: 저장 수·공유 수 중심 (좋아요 제외)',
      E'제휴사 후보 리스트\n1. 후보 6곳: 멤버십 규모·고객 겹침·데이터 제공 가능 여부로 비교\n2. 1순위 B사(멤버십 120만, 겹침 38%), 2순위 A사, 3순위 C사\n3. B사는 데이터 제공 일정이 불확실 — 대안 확보 필요',
      E'경쟁사 캠페인 동향\n1. 주요 3사 모두 런칭 초기 할인(10~20%) 사용\n2. 정가 런칭 사례는 인지도 상위 브랜드뿐\n3. 시사점: 우리 인지도에서는 초기 할인 검토 필요',
      E'광고 성과 대시보드 설계\n1. 보는 사람별 화면: 팀장(주간 CAC·전환), 실무(소재별 성과)\n2. 데이터 소스 3곳 자동 연동, 매일 오전 7시 갱신\n3. 1차 배포 범위: 채널별 CAC·전환율',
      E'콘텐츠 가이드라인\n1. 톤: 친근하지만 과장 없이, 숫자는 출처와 함께\n2. 이미지: 제품 단독 컷 금지, 사용 장면 위주\n3. 금지 표현 12개와 대체 표현 정리',
      E'고객 페르소나 정의\n1. 핵심 페르소나: 31세 직장인, 퇴근 후 30분 자기관리, SNS로 제품 탐색\n2. 구매 장벽: 가격보다 "나한테 맞을지" 확신 부족\n3. 메시지 방향: 후기·체험 중심',
      E'제휴 조건 비교\n1. A사: 수수료 8%, 데이터 월 1회 / B사: 수수료 10%, 데이터 실시간(일정 미정) / C사: 수수료 7%, 데이터 없음\n2. 추천: B사 우선 협상, A사 병행',
      E'리포트 자동화 계획\n1. 주간 리포트 작성 시간 4시간 → 30분 목표\n2. 대시보드 연동 후 자동 요약, 코멘트만 작성\n3. 일정: 3주, 1주차 데이터 정리',
      E'브랜드 톤앤매너 정리\n1. 키워드: 정직함·가벼움·실용\n2. 채널별 톤 차이: 인스타그램은 가볍게, 상세 페이지는 근거 중심\n3. 예시 문구 20개',
      E'가격 민감도 분석\n1. 설문 400명: 적정 가격 3.2만~3.8만 원\n2. 4만 원 이상에서 구매 의향 급감(−41%)\n3. 제안: 정가 3.9만 원, 런칭 할인으로 3.3만 원대 체험',
      E'CRM 메시지 개편\n1. 현재 웰컴 메시지 열람률 22% — 업계 평균 35%\n2. 개편: 첫 메시지에 혜택 1개만, 발송 시점 가입 직후 → 다음 날 오전\n3. 4주 뒤 열람률·첫 구매 전환 비교'])[i], (select author_id from submissions where id = sub), now() - (170 - i * 11) * interval '1 day') returning id into ver;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
    values (sub, ver, T, L, (array[
      '세그먼트 나눈 기준이 분명해서 좋아요. 다음엔 결론(어느 세그먼트부터)을 첫 줄로 올려 주세요.',
      'CAC 숫자에 출처랑 지난 분기 비교가 있어서 판단이 쉬웠어요. 이대로 진행하죠.',
      '좋습니다. 다만 성과 지표를 왜 저장·공유로 골랐는지 한 줄 근거가 있으면 더 좋겠어요.',
      '후보 비교 좋아요. B사 데이터 일정이 불확실하면 대안도 같이 적어 주세요 — 리스크는 미리.',
      '시사점까지 정리해 줘서 좋아요. 이대로 진행하죠.',
      '화면 구성 좋아요. 1차 범위 밖은 언제 하는지 다음 행동·날짜까지 적어 주세요.',
      '좋습니다. 금지 표현 정리가 특히 실용적이에요.',
      '페르소나 좋아요. 이 근거가 어느 데이터에서 나왔는지 출처를 달아 주세요.',
      '조건 비교표 좋아요. 추천 이유를 결론 쪽으로 올리면 첫 장만 봐도 판단돼요.',
      '좋습니다. 일정에 담당자까지 넣어 주면 완성이에요.',
      '톤 정리 좋아요. 이대로 진행하죠.',
      '설문 숫자 좋아요. 정가 3.9만 원으로 정한 이유를 대안(3.5만 원)과 비교해서 한 줄 넣어 주세요.',
      '열람률 기준선 잡은 거 좋아요. 4주 뒤 무엇을 보면 성공인지 목표치까지 적어 주세요.'])[i], now() - (166 - i * 11) * interval '1 day');
    -- 버전 업로드 트리거가 '리뷰 중'으로 돌려놓으므로, 승인은 그 뒤에
    update submissions set status = 'approved' where id = sub;
    update submissions set approved_at = now() - (165 - i * 11) * interval '1 day', updated_at = now() - (165 - i * 11) * interval '1 day' where id = sub;
  end loop;
  insert into judgment_scores (team_id, user_id, score, scored_at) values
    (T, m_kim, 1.8, now() - interval '150 days'), (T, m_kim, 2.0, now() - interval '110 days'), (T, m_kim, 2.0, now() - interval '80 days'),
    (T, m_kim, 2.2, now() - interval '50 days'), (T, m_kim, 2.0, now() - interval '30 days'), (T, m_kim, 2.5, now() - interval '4 days'),
    (T, m_park, 2.5, now() - interval '100 days'), (T, m_park, 2.8, now() - interval '40 days'),
    (T, m_choi, 2.0, now() - interval '90 days'), (T, m_choi, 2.5, now() - interval '20 days'),
    (T, m_jung, 2.2, now() - interval '120 days'), (T, m_jung, 2.0, now() - interval '30 days'),
    (T, m_lee, 1.5, now() - interval '60 days');

  -- 관찰 메모
  insert into observations (team_id, author_id, subject_id, kind, competency, body, occurred_at) values
    (T, L, m_kim, 'praise', '커뮤니케이션', '임원 보고에서 프로모션 전략 질문에 근거를 들어 침착하게 답변함', current_date - 6),
    (T, L, m_kim, 'praise', '문제 정의', '정가 런칭 가정을 스스로 뒤집고 경쟁사 캠페인 재분석을 제안함', current_date - 20),
    (T, L, m_kim, 'concern', '실행 관리', '마감 전 야근이 반복됨. 일정 분산 필요', current_date - 12),
    (T, L, m_kim, 'note', '데이터 분석', '시장 분석은 수치 나열에 그치는 경향', current_date - 60),
    (T, L, m_park, 'praise', '데이터 분석', '광고 지표 정의를 영업팀과 맞춰 정리함', current_date - 15),
    (T, L, m_park, 'praise', '협업', '다른 팀 데이터 요청을 우선순위 기준으로 조율', current_date - 40),
    (T, L, m_choi, 'praise', '문제 정의', '제작 지연 문제를 리드타임 지표로 정의', current_date - 25),
    (T, L, m_jung, 'note', '협업', '파트너사 데이터 수급 지연을 혼자 해결하려 함', current_date - 9),
    (T, L, m_jung, 'praise', '커뮤니케이션', '파트너 미팅 정리가 명확함', current_date - 45),
    (T, L, m_lee, 'concern', null, '최근 회의에서 발언이 줄어듦', current_date - 10);

  -- 의사결정 (결과 기록 7건)
  insert into decisions (team_id, title, rationale, expected_outcome, outcome, outcome_rating, decided_by, decided_at) values
    (T, '런칭 프로모션을 얼리버드 할인으로 확정', '경쟁사 캠페인 재분석', '사전 예약 전환율 20%', null, null, L, now() - interval '14 days'),
    (T, 'FGI 대상 8명 → 12명 확대', '2번 가설 데이터 부족', '가설 검증 가능', null, null, L, now() - interval '1 day'),
    (T, '파일럿 광고 채널 2곳 선정', '타깃 도달률', '6주 내 CPA 목표 달성', '5주 만에 달성', 'hit', L, now() - interval '120 days'),
    (T, '광고 리포트 자동화 우선 착수', '반복 업무 30%', '주 6시간 절감', '주 5시간 절감', 'hit', L, now() - interval '100 days'),
    (T, '제휴 후보 5곳으로 압축', '조건 비교', '2곳 협상 진입', '1곳만 진입', 'partial', L, now() - interval '90 days'),
    (T, '콘텐츠 브리프 템플릿 시범 운영', '제작 지연', '리드타임 3주 → 2.5주', '2.4주', 'hit', L, now() - interval '80 days'),
    (T, '영업팀 리드 공유 주간 회의 신설', '정보 공유', '리드 전환 +10%', '변화 없음', 'miss', L, now() - interval '70 days'),
    (T, 'SNS 운영 일부 자동화', '시간 절감', '주 4시간 절감', '주 4시간 절감', 'hit', L, now() - interval '60 days'),
    (T, '광고 예산 상반기 집중', '신제품 사전 인지', '사전 인지도 30%', '32%', 'hit', L, now() - interval '50 days');

  -- 돌아볼 결정 (결과 기록 시점이 지난 것)
  update decisions set review_on = current_date - 1 where team_id = T and title = '런칭 프로모션을 얼리버드 할인으로 확정';

  -- 조직·전사: 위에서 온 것 (org_notes 가 있을 때만)
  if to_regclass('public.org_notes') is not null then
    execute $q$insert into public.org_notes (team_id, author_id, kind, title, body, source, event_date, created_at) values
      ($1, $2, 'exec', '본부장 관심사: 제휴 채널 성과와 CAC 개선 속도',
        E'본부장 주간회의에서 두 번 연속 질문.\n"제휴 채널 신규 고객이 언제 숫자로 보이냐"\n"채널별 CAC 비교표를 다음 보고에 넣어 달라"', '본부장 주간회의', null, now() - interval '6 days'),
      ($1, $2, 'request', '본부 4분기 마케팅 실행계획 초안 제출', '비용 15% 절감 반영, 채널별 CAC 목표 포함', '경영기획팀', current_date + 6, now() - interval '2 days'),
      ($1, $2, 'calendar', '하반기 평가 시즌 시작 (자기평가 오픈)', '팀장 평가 의견 작성 기간 2주', 'HR팀 공지', current_date + 34, now() - interval '10 days'),
      ($1, $2, 'peer', '영업팀 리드 공유 회의 격주 → 월 1회로 변경', '제휴로 들어온 고객 후속 연락이 늦어질 수 있음', '영업팀', null, now() - interval '9 days')$q$
      using T, L;
    execute $q$insert into public.org_notes (team_id, author_id, kind, title, body, source, created_at) values
      ($1, $2, 'strategy', '4분기 전사 방침: 마케팅 비용 15% 절감, 고객 획득 효율(CAC) 중심',
        E'전사 경영회의 결정 사항\n- 4분기 마케팅 비용 전년 대비 15% 절감\n- 채널 평가 기준을 노출·도달에서 CAC(고객 1명 획득 비용)로 변경\n- CAC가 낮은 채널(제휴 등)에 예산 우선 배정', '전사 경영회의', now() - interval '3 days') returning id$q$
      into sub using T, L;
    -- 영향 분석 예시 1건 (ai_kind 'org_impact' 가 같은 실행에서 막 추가된 경우엔 건너뜀)
    begin
      execute $q$insert into public.ai_outputs (team_id, kind, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
        values ($1, 'org_impact', 'org_notes', $2, 'draft', 'leader', 'L2', 2, $3, '[]'::jsonb, $4, now() - interval '3 days')$q$
      using T, sub, jsonb_build_object(
        'summary', '비용 15% 절감 방침이 런칭 캠페인의 광고 집행 계획과 부딪히고, 제휴 채널 목표에는 힘이 실립니다.',
        'level', 'high',
        'affected', jsonb_build_array(
          jsonb_build_object('item_id', g1, 'title', '하반기 신제품 런칭 캠페인 성공', 'how', '유튜브·인스타그램 광고 비중이 커서 비용 절감의 첫 대상이 될 수 있습니다'),
          jsonb_build_object('item_id', g2, 'title', '제휴 채널 신규 고객 확대', 'how', 'CAC가 낮은 채널 우선 배정 방침과 맞아 예산을 더 요청할 근거가 됩니다')),
        'actions', jsonb_build_array(
          jsonb_build_object('label', '런칭 캠페인 광고 예산을 CAC 기준으로 다시 배분', 'kind', 'replan'),
          jsonb_build_object('label', '채널별 CAC 비교표를 이번 주간보고에 추가', 'kind', 'report'),
          jsonb_build_object('label', '정우성 님과 B사 데이터 막힘 해소 일정 확정 — 제휴 채널이 방침의 수혜 영역', 'kind', 'discuss')),
        'report_line', '전사 비용 절감 방침에 맞춰 런칭 캠페인 광고 예산을 CAC 기준으로 다시 나누고, 제휴 채널 비중을 늘리겠습니다.'), L;
    exception when others then null;
    end;
  end if;

  -- AI 인사이트 예시 (오늘·이번 주·이번 달) — 데모 팀은 날짜가 지나도 이 해석을 보여줌
  declare c jsonb;
  begin
    c := $j${
      "headline": "실행은 순항과 정체로 갈렸고, 관리는 운영 리듬이 느슨해진 상태입니다 — 외부 의존 하나가 성과와 사람 양쪽의 병목입니다.",
      "sections": {
        "risk": {"summary": "리스크가 한 곳으로 몰리는 구조입니다 — 외부 데이터 의존 하나가 목표·일정·담당자 컨디션을 동시에 끌어내리고 있어, 이 의존을 풀지 않으면 다른 조치가 효과를 내기 어렵습니다.", "items": [
          {"type": "risk", "severity": 3, "title": "제휴 채널: 데이터 막힘 → 제안서 지연 → 달성 가능성 12%", "body": "원인이 하나라 풀리면 세 가지가 같이 풀립니다.", "action": "B사 데이터 대체안 이번 주 확정", "link": "goals"},
          {"type": "risk", "severity": 2, "title": "이동욱 님 이탈 신호", "body": "컨디션 3주 하락과 1on1 공백이 겹칩니다.", "action": "이번 주 1on1", "link": "one_on_ones"}]},
        "decide": {"summary": "결정이 미뤄지며 비용이 쌓이는 국면입니다 — 목표를 지킬지 조정할지 정하지 않은 채 실행만 이어지고 있어, 이번 주 판단이 분기 결과를 가릅니다.", "items": [
          {"type": "risk", "severity": 3, "title": "제휴 목표(20만 명)를 조정할지, 데이터 지원을 요청해 지킬지", "body": "제안서 막힘이 목표 전망을 끌어내립니다. 전사 비용 절감 방침상 제휴 채널은 예산 우선 대상이라 지원 요청의 명분이 있습니다.", "action": "이번 주 안에 결정, 정우성 님과 15분", "link": "sim",
            "options": ["영업본부에 B사 데이터 협조를 공식 요청해 목표 유지", "목표를 16만 명으로 낮추고 런칭 캠페인에 인력 집중", "제안서 범위를 B사 제외 2개사로 줄여 일정 우선"],
            "impact": "기말 전망 18.6만 명 → 목표 20만 명과의 차이를 메우는 유일한 경로입니다."},
          {"type": "pattern", "severity": 2, "title": "런칭 캠페인 광고 예산을 CAC 기준으로 다시 나눌지", "body": "전사 비용 15% 절감 방침이 런칭 캠페인 광고 집행과 부딪힙니다.", "action": "4분기 실행계획 초안 전에 결정", "link": "org",
            "options": ["유튜브 비중을 줄이고 제휴 채널로 이동", "얼리버드 할인 기간을 줄여 비용 확보"],
            "impact": "런칭 목표(달성 가능성 94%)는 지키면서 제휴 목표에 예산을 돌릴 수 있습니다."},
          {"type": "pattern", "severity": 2, "title": "보고 체계 정비에 들어가는 팀 시간을 줄일지", "body": "기여도가 낮은 과제에 팀 시간 35%가 들어가고, 그중 정우성 님 몫이 45%입니다.", "action": "다음 주 계획 회의에서 결정", "link": "strategy",
            "options": ["보고 체계 정비를 다음 분기로 미루고 정우성 님을 제휴에 집중", "박서연 님에게 리포트 운영을 넘겨 시간 분산"],
            "impact": "정우성 님 시간이 제휴 제안서로 옮겨 가면 막힘 해소 속도가 빨라집니다."}]},
        "perf": {"summary": "성과는 순항과 정체로 갈려 있습니다 — 문제는 실행력보다 외부에 기대는 과제에 대체 경로가 없는 계획 구조이고, 그 한 축이 팀 전망 평균을 끌어내립니다.", "items": [
          {"type": "forecast", "severity": 2, "title": "제안서 지연이 제휴 목표 전망의 핵심 원인", "body": "최근 3주 진척 속도가 거의 0입니다.", "action": "B사 데이터 대체안으로 범위 축소", "link": "goals"},
          {"type": "good", "severity": 1, "title": "런칭 캠페인 달성 가능성 94%", "body": "FGI·랜딩 페이지가 일정대로 갑니다.", "link": "goals"}]},
        "people": {"summary": "팀원관리가 흔들리는 건 개인 문제보다 운영 리듬 때문입니다 — 1on1 간격이 벌어진 시기에 막힘을 혼자 끌어안는 패턴이 겹쳐 컨디션이 같이 꺾였고, 성장·인정은 일부에게만 몰려 있습니다.", "items": [
          {"type": "risk", "severity": 3, "title": "이동욱 님 3주 연속 컨디션 하락 (4 → 3 → 2)", "body": "1on1이 3주 넘게 없고, CRM 자동화 과제는 혼자 맡고 있습니다. 업무량보다 방향 불확실이 원인일 수 있습니다.", "action": "이번 주 안에 1on1 — 과제 우선순위부터 물어보기", "link": "one_on_ones"},
          {"type": "risk", "severity": 2, "title": "정우성 님 2주째 같은 문제로 막힘", "body": "본인 힘으로 풀 수 없는 외부 데이터 문제라, 팀장이 위로 올려 줘야 풀립니다.", "action": "영업본부 협조 요청을 대신 올리기", "link": "one_on_ones"},
          {"type": "good", "severity": 1, "title": "김현정·박서연 님 판단 깊이 상승", "body": "결과물 검토 점수와 결과 지표가 함께 올랐습니다. 지금 인정하면 효과가 큽니다.", "action": "관찰 메모로 남기기", "link": "team"},
          {"type": "data", "severity": 1, "title": "한수진 님 평가 근거 부족", "body": "입사 6주 차로 결과물·관찰 기록이 적습니다. 평가 시즌(D-33) 전에 근거를 쌓아야 합니다.", "action": "FGI 결과물 리뷰를 근거로 남기기", "link": "reviews"}]},
        "org": {"summary": "위와의 정렬이 늦어지고 있습니다 — 전사 기준은 비용·고객 획득 효율로 바뀌었는데 팀 계획과 보고는 아직 이전 기준이라, 임원 질문에 답할 근거가 비어 있습니다.", "items": [
          {"type": "forecast", "severity": 2, "title": "4분기 실행계획 제출 D-6", "body": "비용 15% 절감 반영이 필요합니다.", "action": "런칭 캠페인 예산 재배분안부터 준비", "link": "org"}]}
      },
      "watch_next": "다음 주 파트너 데이터가 들어오는지, 이동욱 님 컨디션이 반등하는지"
    }$j$::jsonb;
    insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
    select T, k::public.ai_kind, 'draft', 'leader', 'L2', 2,
           c || jsonb_build_object('period', p), '[]'::jsonb, L, now() - interval '10 minutes', current_date - d, current_date
    from (values ('insight_daily', 'daily', 0), ('insight_weekly', 'weekly', 6), ('insight_monthly', 'monthly', 30)) v(k, p, d);
  exception when others then null;
  end;

  -- 지난해 목표 (팀목표 '연도별 기록' 예시) — 모두 끝난 상태
  declare py int := extract(year from current_date)::int - 1; pg uuid;
  begin
    insert into work_items (team_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, contribution, created_at, updated_at)
      values (T, L, '브랜드 리뉴얼 캠페인 런칭', 'children', 'done', 100, 1, make_date(py, 3, 1), make_date(py, 9, 30), make_date(py, 3, 1), make_date(py, 8, 31), make_date(py, 9, 30), 5, make_date(py, 2, 20), make_date(py, 9, 30)) returning id into pg;
    insert into work_items (team_id, parent_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, created_at, updated_at) values
      (T, pg, m_kim, '리뉴얼 콘셉트·네이밍', 'check', 'done', 100, 1, make_date(py, 3, 1), make_date(py, 5, 15), make_date(py, 3, 1), make_date(py, 4, 30), make_date(py, 5, 15), make_date(py, 2, 20), make_date(py, 5, 15)),
      (T, pg, m_choi, '런칭 콘텐츠 20종 제작', 'check', 'done', 100, 2, make_date(py, 5, 1), make_date(py, 8, 31), make_date(py, 5, 1), make_date(py, 8, 15), make_date(py, 8, 31), make_date(py, 2, 20), make_date(py, 8, 31)),
      (T, pg, m_park, '런칭 광고 집행', 'check', 'done', 100, 3, make_date(py, 8, 1), make_date(py, 9, 30), make_date(py, 8, 1), make_date(py, 8, 31), make_date(py, 9, 30), make_date(py, 2, 20), make_date(py, 9, 30));
    insert into work_items (team_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, contribution, created_at, updated_at)
      values (T, L, '신규 고객 10만 명 확보', 'children', 'done', 82, 2, make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 12, 31), 5, make_date(py, 1, 2), make_date(py, 12, 31)) returning id into pg;
    insert into work_items (team_id, parent_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, created_at, updated_at) values
      (T, pg, m_park, '퍼포먼스 채널 신규 6만 명', 'percent', 'done', 95, 1, make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31)),
      (T, pg, m_jung, '제휴 채널 신규 4만 명', 'percent', 'done', 62, 2, make_date(py, 3, 1), make_date(py, 12, 31), make_date(py, 3, 1), make_date(py, 11, 30), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31));
  exception when others then null;
  end;

  -- 업무플랫폼: 리뷰 대기 결과물 2건의 AI 1차 검토 + 다가오는 1on1의 AI 준비 노트
  declare v1 uuid; v2 uuid; o1 uuid;
  begin
    select sv.id into v1 from submission_versions sv join submissions s on s.id = sv.submission_id
      where s.team_id = T and s.title = '하반기 신제품 런칭 캠페인 기획서' order by sv.version desc limit 1;
    select sv.id into v2 from submission_versions sv join submissions s on s.id = sv.submission_id
      where s.team_id = T and s.title = '콘텐츠 제작 프로세스 개선안' order by sv.version desc limit 1;
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at) values
      (T, 'review', m_kim, 'submission_versions', v1, 'draft', 'leader', 'L1', 1, $j${
        "depth_score": 3.0,
        "summary": "정가 런칭을 버린 이유와 대안 비교가 분명해 논리가 탄탄하고, 가설마다 검증 방법까지 붙여 완성도도 높아졌습니다. 다만 결론이 §2에 묻혀 있어 첫 장만 봐서는 무엇을 하자는지 바로 보이지 않고, 가설 2(3040 고객)는 아직 주장 수준입니다.",
        "brief": {"tone": "good", "text": "김현정 님이 올린 '하반기 신제품 런칭 캠페인 기획서'는 논리가 탄탄해 보입니다", "why": "버린 대안과 이유까지 비교함 · 결론은 뒤에 있음"},
        "decisions": ["얼리버드 15% 할인 적용", "B사 제휴 채널 확대 시점"],
        "strengths": [{"section": "§2 프로모션", "text": "경쟁사 재분석으로 정가 런칭을 버린 이유와 대안 2개를 비교해 밝혔습니다."},
                      {"section": "§4 가설", "text": "가설마다 검증 방법(예약 데이터, FGI)을 붙였습니다."}],
        "gaps": [{"section": "§4 가설 2", "text": "3040 직장인이 주 고객이라는 근거가 FGI 계획뿐이라 아직 주장 수준입니다."},
                 {"section": "§3 채널", "text": "제휴 채널(B사) 확대가 데이터 수급 지연과 어떻게 맞물리는지 빠져 있습니다."}],
        "questions": ["얼리버드 15%가 사전 예약 전환율 20%로 이어진다는 근거는?", "B사 데이터가 늦어지면 3단계 채널 계획은 어떻게 바뀌나요?"],
        "change_from_previous": "정가 런칭에서 얼리버드 할인으로 바꾸고, 버린 대안과 이유를 새로 적었습니다.",
        "criteria_check": [{"criterion": "결론부터 쓴다", "met": false, "note": "§1 시장 분석으로 시작해 결론이 뒤에 있습니다."},
                           {"criterion": "대안 비교", "met": true, "note": "§2에서 정가·상시 할인을 비교했습니다."},
                           {"criterion": "숫자와 출처", "met": true, "note": "시장 규모·점유율에 수치를 달았습니다."}]
      }$j$::jsonb, '[]'::jsonb, m_kim, now() - interval '4 days'),
      (T, 'review', m_choi, 'submission_versions', v2, 'draft', 'leader', 'L1', 1, $j${
        "depth_score": 2.0,
        "summary": "현황 수치와 측정 지표를 붙여 실행 가능한 모양은 갖췄지만, 목표치가 없고 세 가지 개선이 각각 리드타임을 얼마나 줄이는지 추정이 비어 있어 완결성이 낮습니다. 개선안도 일반적인 방법을 옮긴 수준이라 이 팀만의 병목을 짚은 관점이 약합니다.",
        "brief": {"tone": "watch", "text": "최다은 님이 올린 '콘텐츠 제작 프로세스 개선안'은 완결성이 낮아 보입니다", "why": "목표치가 없고 개선 효과 추정이 비어 있음"},
        "decisions": [],
        "strengths": [{"section": "1. 현황", "text": "최근 10건 기준 리드타임 3주로 기준선을 잡았습니다."}],
        "gaps": [{"section": "2. 개선", "text": "브리프 템플릿·고정 슬롯이 각각 며칠을 줄이는지 추정이 없습니다."},
                 {"section": "3. 측정", "text": "목표치(예: 2주)가 없어 성공 여부를 판단하기 어렵습니다."}],
        "questions": ["세 가지 개선 중 리드타임을 가장 많이 줄이는 건 무엇이라고 보나요?", "디자인팀 고정 슬롯은 디자인팀과 합의됐나요?"],
        "change_from_previous": "측정 지표(월 제작 건수, 리드타임)를 추가했습니다.",
        "criteria_check": [{"criterion": "결론부터 쓴다", "met": true, "note": "첫 줄에 개선안을 밝혔습니다."},
                           {"criterion": "대안 비교", "met": false, "note": "다른 개선 방법과 비교가 없습니다."}]
      }$j$::jsonb, '[]'::jsonb, m_choi, now() - interval '1 day');
    -- 김현정 기획서 v1 · v2 의 AI 검토 (버전마다 검토가 쌓이는 흐름)
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
    select T, 'review', m_kim, 'submission_versions', sv.id, 'draft', 'leader', 'L1', 1, x.c::jsonb, '[]'::jsonb, m_kim, sv.created_at + interval '5 minutes'
    from submission_versions sv join submissions s on s.id = sv.submission_id
    join (values
      (1, $j${
        "depth_score": 2.0,
        "summary": "타깃과 시장 규모는 잡았지만, 정가 런칭을 택한 이유가 '프리미엄 이미지' 한 줄뿐이라 근거가 비어 있습니다. 다른 프로모션 방식과 비교하지 않았고 채널·일정 등 실행 부분이 아직 없습니다.",
        "brief": {"tone": "risk", "text": "김현정 님이 올린 '하반기 신제품 런칭 캠페인 기획서'는 근거가 비어 보입니다", "why": "정가 런칭 이유가 '프리미엄 이미지' 한 줄뿐"},
        "decisions": [],
        "strengths": [{"section": "1. 시장·고객", "text": "타깃과 시장 규모·성장률을 숫자로 먼저 밝혔습니다."}],
        "gaps": [{"section": "2. 프로모션", "text": "정가 런칭이 인지도가 낮은 지금 맞는지, 할인과 비교한 근거가 없습니다."},
                 {"section": "전체", "text": "채널·일정 등 실행 계획이 빠져 있어 초안 단계입니다."}],
        "questions": ["인지도가 낮은 상태에서 정가 런칭이 초기 전환을 막지 않을까요?", "경쟁사들은 런칭 때 어떻게 했나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      (2, $j${
        "depth_score": 2.0,
        "summary": "채널 계획과 경쟁사 수가 추가돼 분량은 늘었지만, v1에서 비었던 정가 런칭의 근거는 '조사 결과 반영 예정'으로 미뤄져 고민의 깊이는 그대로입니다.",
        "brief": {"tone": "watch", "text": "김현정 님이 올린 '하반기 신제품 런칭 캠페인 기획서'는 고민의 깊이가 그대로로 보입니다", "why": "채널 계획은 늘었지만 정가 근거는 '반영 예정'"},
        "decisions": [],
        "strengths": [{"section": "3. 채널 계획", "text": "사전 예약 페이지까지 이어지는 채널 흐름을 새로 잡았습니다."}],
        "gaps": [{"section": "2. 프로모션", "text": "핵심 판단(정가 런칭)의 근거가 아직 '예정'으로 남아 있습니다."}],
        "questions": ["브랜드 인지도 조사는 언제 나오고, 결과에 따라 프로모션이 바뀔 수 있나요?"],
        "change_from_previous": "채널 계획(유튜브·인스타그램, 사전 예약 페이지)과 경쟁사 수를 추가했습니다.", "trend_note": "", "criteria_check": []
      }$j$)
    ) as x(ver, c) on sv.version = x.ver
    where s.team_id = T and s.title = '하반기 신제품 런칭 캠페인 기획서';
    select id into o1 from one_on_ones where team_id = T and member_id = m_kim and status = 'scheduled' order by scheduled_at limit 1;
    if o1 is not null then
      insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
      values (T, 'one_on_one_prep', m_kim, 'one_on_ones', o1, 'draft', 'leader', 'L2', 2, $j${
        "last_time": "런칭 프로모션을 얼리버드 할인 중심으로 바꾸는 방향에 합의했고, 2번 가설은 고객 FGI로 검증하기로 했습니다.",
        "since": [{"text": "기획서 v3 제출 — 얼리버드 할인으로 전면 수정"}, {"text": "판단 깊이 2.0 → 3.0으로 상승"}],
        "open_promises": [{"owner": "팀장", "text": "경쟁사 캠페인 분석 리포트 공유", "overdue": true}, {"owner": "팀원", "text": "FGI 설계안 초안", "overdue": false}],
        "recent_work": "기획서 v3에서 대안 비교와 가설별 검증 계획이 뚜렷해졌습니다.",
        "watch": "판단 깊이가 눈에 띄게 올랐습니다. 지금 인정하고, FGI 일정이 B사 데이터 지연과 겹치지 않는지 확인하세요.",
        "questions": ["얼리버드 할인을 결정한 가장 결정적인 근거는 무엇이었나요?", "FGI에서 꼭 확인하고 싶은 것 하나만 꼽는다면?", "제가 먼저 풀어 줘야 할 막힘이 있나요?"]
      }$j$::jsonb, '[]'::jsonb, L, now() - interval '2 hours');
    end if;
  exception when others then null;
  end;

  -- 팀원관리: 이번 주 AI 액션 추천 + 팀원별 업무 판단
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'people_actions', 'draft', 'leader', 'L2', 2, $2, '[]'::jsonb, $3, now() - interval '30 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, jsonb_build_object(
      'summary', '이번 주는 이동욱 님 1on1과 정우성 님 막힘 해소가 먼저이고, 김현정 님은 지금 인정할 타이밍입니다.',
      'actions', jsonb_build_array(
        jsonb_build_object('user_id', m_lee, 'type', 'one_on_one', 'urgency', 3, 'title', '이동욱 님과 1on1 — 이번 주 안에',
          'why', '컨디션이 3주 연속 떨어졌고(4 → 3 → 2) 마지막 1on1이 3주 전입니다.', 'opener', '요즘 일하면서 에너지가 가장 떨어지는 순간이 언제예요?'),
        jsonb_build_object('user_id', m_jung, 'type', 'support', 'urgency', 3, 'title', '정우성 님 챙기기 — 어려운 점 들어 주기',
          'why', '같은 막힘이 2주째 이어지고, 이번 주 컨디션 공유에서 개인 사정과 피로를 골랐습니다.', 'request', '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 제가 도울 수 있는 건 같이 할게요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'praise', 'urgency', 2, 'title', '김현정 님께 칭찬 배지',
          'why', '최근 결과물의 판단 깊이가 꾸준히 올랐고(2.0 → 3.0), 대안을 비교하고 근거를 남기는 방식이 자리 잡았습니다.', 'message', '요즘 결과물마다 대안을 따져 보고 근거를 남기는 게 보여서 든든해요. 고마워요!'),
        jsonb_build_object('user_id', m_han, 'type', 'observe', 'urgency', 2, 'title', '한수진 님 관찰 기록 남기기',
          'why', '입사 6주 차로 평가 근거가 기준에 못 미칩니다. 이번 주 일하는 모습을 보고 한 줄 남겨 두세요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'develop', 'urgency', 1, 'title', '김현정 님께 더 큰 역할 제안하기',
          'why', '판단 깊이가 꾸준히 올라 다음 단계 역할을 이야기할 시점입니다.', 'request', '다음 분기에는 더 넓은 범위를 직접 리드해 보면 좋겠어요. 어떤 걸 맡아 보고 싶은지 이야기해 봐요.'),
        jsonb_build_object('user_id', m_choi, 'type', 'push', 'urgency', 1, 'title', '최다은 님과 진행 공유 리듬 맞추기',
          'why', '결과물이 리뷰 단계에 머물러 있고 최근 진행 공유 간격이 길어졌습니다.', 'request', '이번 주부터 금요일마다 진행 상황을 한 줄로 공유해 줄래요? 막히는 게 있으면 같이 봐요.'),
        jsonb_build_object('user_id', m_park, 'type', 'praise', 'urgency', 1, 'title', '박서연 님께 꾸준함 인정하기',
          'why', '정기 업무를 빠짐없이 운영하고 결과물이 대부분 한 번에 통과했습니다.', 'message', '매달 빠짐없이 챙겨 주는 꾸준함 덕분에 팀이 숫자를 믿고 움직여요. 고마워요!')),
      'members', jsonb_build_array(
        jsonb_build_object('user_id', m_kim, 'work_status', 'good', 'work_view', '런칭 기획이 계획보다 조금 늦지만 결과물 품질이 뚜렷이 올랐습니다. 핵심 과제를 안정적으로 끌고 갑니다.', 'flight_risk', 'low', 'flight_note', '컨디션이 안정적이고 1on1이 꾸준합니다.'),
        jsonb_build_object('user_id', m_park, 'work_status', 'good', 'work_view', '정기 리포트를 빠짐없이 운영하고 결과물도 한 번에 통과하는 편입니다. 다만 업무가 겹쳐 시간이 빠듯합니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_choi, 'work_status', 'good', 'work_view', '프로세스 개선이 계획대로 가고, 개선안에 측정 지표를 붙이는 등 결과물이 나아지고 있습니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_jung, 'work_status', 'support', 'work_view', '제안서가 외부 데이터 막힘으로 계획보다 크게 늦고, 보고 체계 정비도 진척이 더딥니다. 본인 역량보다 외부 의존이 원인입니다.', 'flight_risk', 'medium', 'flight_note', '같은 막힘이 2주째 반복되고 일이 몰려 있습니다.'),
        jsonb_build_object('user_id', m_lee, 'work_status', 'watch', 'work_view', 'CRM 연계 과제가 계획보다 조금 늦지만 큰 이탈은 없습니다. 혼자 맡은 과제라 방향 확인이 필요합니다.', 'flight_risk', 'high', 'flight_note', '컨디션 3주 연속 하락과 1on1 공백이 겹칩니다.'),
        jsonb_build_object('user_id', m_han, 'work_status', 'good', 'work_view', 'FGI 준비를 일정대로 진행 중이나 아직 올린 결과물이 적어 판단 근거가 얇습니다.', 'flight_risk', 'low', 'flight_note', '신규 입사자로 적응 중입니다.'))
    ), L;
  exception when others then null;
  end;

  -- A·Team의 제안: 이번 주 + 지난주(회고용) + 지난주 제안 상태 + 팀장 셀프 체크
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 2, $2, '[]'::jsonb, $3, now() - interval '7 days 20 minutes', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date - 1)$q$
    using T, $j${"headline": "실행은 순항하지만 사람 관리의 리듬이 느슨해지고 있습니다 — 1on1과 기준 공유로 다시 조이는 주입니다.", "focus": "제휴 목표 — 고객사 데이터 수급이 공식 경로로 요청되지 않았습니다.", "levers": {"exec": {"state": "watch", "note": "제휴 과제가 2주째 같은 막힘입니다."}, "staffing": {"state": "good", "note": "부하는 고른 편입니다."}, "people": {"state": "act", "note": "1on1 간격이 평균 19일로 벌어졌습니다."}, "external": {"state": "watch", "note": "데이터 수급이 비공식 경로에만 의존합니다."}, "self": {"state": "good", "note": "특이 신호 없음."}, "system": {"state": "watch", "note": "결과물 보완점이 같은 주제로 반복됩니다."}}, "advice": [{"id": "a1", "lever": "people", "urgency": 3, "effort": "low", "title": "1on1 간격을 2주 이내로 되돌리세요", "why": "1on1 평균 간격이 19일로 벌어졌습니다.", "effect": "막힘을 일찍 듣게 됩니다.", "if_not": "컨디션 하락을 늦게 알게 됩니다.", "route": "one_on_one", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "system", "urgency": 2, "effort": "mid", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "why": "보완점이 같은 주제로 반복됩니다.", "effect": "수정 횟수가 줄어듭니다.", "if_not": "리뷰 시간이 계속 늘어납니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a3", "lever": "external", "urgency": 2, "effort": "low", "title": "제휴 데이터 수급을 영업본부에 공식 요청하세요", "why": "비공식 경로로 2주를 기다렸습니다.", "effect": "회신 날짜가 정해집니다.", "if_not": "막힘이 계속됩니다.", "route": "report", "target_user_id": "", "script": ""}], "review": [], "watch_next": "이동욱 님 컨디션."}$j$::jsonb, L;
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 3, $2, '[]'::jsonb, $3, now() - interval '20 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, replace($j${"headline": "성과는 외부 의존 하나에 묶여 있고, 운영은 팀장 시간이 순항하는 사람 쪽으로 쏠려 있습니다 — 이번 주는 '막힌 곳으로 사람과 시간을 옮기는 주'입니다.", "focus": "제휴 목표(20만 명) — 고객사 데이터 수급이 풀리지 않으면 4분기 전망이 18.6만 명 근처에서 멈춥니다.", "levers": {"exec": {"state": "act", "note": "제휴 과제가 3주째 같은 막힘(고객사 데이터)으로 멈춰 있고, 계획에 대체 경로가 없습니다."}, "staffing": {"state": "watch", "note": "제휴 목표의 하위 일 3건이 모두 정우성 님 한 사람에게 있고, 김현정 님은 가용 시간의 70%만 쓰고 있습니다."}, "people": {"state": "watch", "note": "최근 4주 칭찬·관찰이 김현정·박서연 님에게 몰렸고, 이동욱 님은 컨디션이 3주째 내려가는데 팀장 접점이 가장 적습니다."}, "external": {"state": "act", "note": "전사 비용 15% 절감 방침이 런칭 캠페인 예산과 부딪히는데, 아직 위로 방향을 확인하지 않았습니다."}, "self": {"state": "watch", "note": "리뷰 대기 6건(가장 오래 5일)과 검토 중 결정 3건이 겹쳐 있고, 최근 2주 앱 활동의 31%가 밤 10시 이후·주말입니다."}, "system": {"state": "good", "note": "체크인 제출 5/6명으로 주간 리듬은 유지됩니다. 다만 결과물 보완점이 '근거·데이터'에 반복됩니다."}}, "advice": [{"id": "a1", "lever": "exec", "urgency": 3, "effort": "low", "title": "제휴 과제에 '대체 데이터 경로'를 이번 주 안에 계획으로 넣으세요 — 고객사 데이터를 기다리는 동안 공개 데이터와 파일럿 고객 2곳으로 1차안을 만들게 하세요.", "why": "같은 막힘이 3주째 체크인에 반복되고, 제휴 목표 달성 가능성이 12%까지 내려왔습니다.", "effect": "데이터 회신이 늦어져도 11월 첫 주에 1차 제안이 가능해지고, 목표 전망의 바닥이 올라갑니다.", "if_not": "회신이 2주 더 밀리면 4분기 제휴 목표는 조정이 불가피합니다.", "route": "decide", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "staffing", "urgency": 2, "effort": "mid", "title": "제휴 과제의 '데이터 정리' 1건을 김현정 님에게 옮겨 정우성 님 한 사람 의존을 푸세요.", "why": "제휴 하위 일 3건이 한 사람에게 몰려 있고(주 46시간/가용 40시간), 김현정 님은 여유가 있습니다.", "effect": "정우성 님은 파트너 협상에 집중하고, 막힘이 한 곳에서 전체로 번지는 걸 막습니다.", "if_not": "정우성 님 과부하가 이어지면 이탈 주의 신호가 '높음'으로 올라갈 수 있습니다.", "route": "request", "target_user_id": "{{KIM}}", "script": "현정 씨, 제휴 제안서의 데이터 정리 파트를 이번 주부터 맡아 줄 수 있을까요? 우성 씨가 파트너 협상에 집중할 수 있게 하려는 거예요. 필요한 시간은 같이 조정할게요."}, {"id": "a3", "lever": "external", "urgency": 3, "effort": "low", "title": "비용 절감 방침과 런칭 예산의 충돌을 이번 주 본부장 보고에 먼저 올리세요 — 결정권은 위에 있습니다.", "why": "전사 방침(비용 15% 절감)이 런칭 캠페인 광고 집행과 부딪히는데, 팀 안에서 결론을 내기 어려운 사안입니다.", "effect": "예산 축소 범위가 일찍 정해지면 4분기 실행계획 초안을 다시 쓰지 않아도 됩니다.", "if_not": "실행계획 확정 직전에 예산이 깎이면 런칭 일정 전체가 밀립니다.", "route": "report", "target_user_id": "", "script": "전사 비용 15% 절감 방침에 맞춰 런칭 캠페인 광고 예산을 CAC 기준으로 재배분하려 합니다. 다만 제휴 목표(20만 명)에 필요한 최소 예산은 유지가 필요해, 이번 주 안에 방향 확인 부탁드립니다."}, {"id": "a4", "lever": "self", "urgency": 2, "effort": "low", "title": "리뷰 대기 6건 중 정기 보고 2건은 박서연 님에게 1차 리뷰를 맡기고, 아낀 시간을 이동욱·정우성 님에게 쓰세요.", "why": "최근 4주 팀장 접점의 48%가 김현정·박서연 님 두 사람에게 갔고, 필요도가 높은 이동욱 님은 팀 평균의 0.6배입니다.", "effect": "리뷰 적체가 절반으로 줄고, 이탈 주의 두 사람에게 이번 주 1on1 시간이 생깁니다.", "if_not": "적체와 늦은 시간 작업이 이어지면 결정이 더 미뤄지는 악순환이 됩니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a5", "lever": "people", "urgency": 1, "effort": "low", "title": "이번 주 금요일 점심을 '런칭 준비 중간 점검 + 김현정 님 기획서 통과 축하' 자리로 잡으세요.", "why": "팀 컨디션이 3.6으로 내려가는 중이고, 인정이 일부에게만 보이는 상태입니다.", "effect": "짧고 부담 없는 자리로 팀 전체가 진척을 함께 보고, 인정이 팀 전체의 이야기가 됩니다.", "if_not": "막힌 사람과 순항하는 사람 사이의 온도 차가 커집니다.", "route": "calendar", "target_user_id": "", "script": "금요일 점심은 다 같이 먹어요 — 런칭 준비 중간 점검 겸, 현정 씨 기획서 통과도 축하해요."}], "review": [{"id": "a1", "title": "1on1 간격을 2주 이내로 되돌리세요", "verdict": "partial", "observed": "정우성·한수진 님과는 1on1을 했지만, 이동욱 님은 아직 3주째 1on1이 없습니다."}, {"id": "a2", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "verdict": "not_done", "observed": "기준 카드가 공개되지 않았고, 이번 주에도 보완점 2건이 '근거·데이터'였습니다."}, {"id": "a3", "title": "제휴 데이터 수급을 영업본부에 공식 요청하세요", "verdict": "done", "observed": "영업본부 요청이 기록됐고, 파트너사 회신은 '11월 둘째 주 이후 가능'으로 왔습니다."}], "watch_next": "고객사 데이터 회신 날짜와 이동욱 님 다음 체크인의 컨디션.", "perspective": {"big": {"lens": "목표 구성 · 다가오는 시기", "text": "팀 목표 중 새로 만드는 일은 신제품 런칭 하나이고, 나머지는 지금 하는 일을 지키고 넓히는 목표입니다. 런칭이 끝나는 11월 이후 팀의 다음 성장 축이 비어 있습니다.", "why": "11~12월은 평가와 내년 목표 수립이 겹치는 시기입니다. 내년 목표에 넣을 '새로 만들 일' 후보를 지금부터 모아 두면 목표를 서둘러 정하지 않게 됩니다."}, "reframe": {"lens": "관심과 기회의 쏠림", "text": "일의 배분이 곧 동기의 배분이 되고 있습니다 — 런칭·기획처럼 성장이 보이는 일은 김현정·박서연 님에게, 막힌 일은 정우성·이동욱 님에게 가 있습니다.", "why": "최근 4주 칭찬·관찰도 같은 두 사람에게 몰렸습니다. 막힌 사람에게 시간을 더 쓰는 것과 별개로, 다음 배분 때 '보이는 일'을 한 번 돌려 볼 만합니다."}, "experiment": {"title": "주간 회의 첫 10분을 '막힌 것만' 말하는 시간으로 바꿔 보기", "how": "진행 보고는 업무플랫폼에 미리 올리고, 회의에서는 한 사람씩 막힌 것 하나와 필요한 도움만 말합니다. 팀장은 답보다 '누가 도울 수 있나'를 먼저 묻습니다.", "check": "2주 뒤 막힘이 공유되기까지 걸린 날짜와 회의 시간"}, "question": "내년 이맘때 우리 팀이 '그때 시작하길 잘했다'고 말할 일은 무엇일까요?"}}$j$, '{{KIM}}', m_kim::text)::jsonb, L;
    execute $q$insert into public.advice_status (team_id, advice_key, status, updated_by) values
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a1', 'adopted', $2),
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a2', 'held', $2),
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a3', 'done', $2) on conflict do nothing$q$ using T, L;
    execute $q$insert into public.leader_selfcheck (team_id, user_id, week_start, energy, burden, note) values
      ($1, $2, date_trunc('week', current_date)::date - 14, 4, 3, ''),
      ($1, $2, date_trunc('week', current_date)::date - 7, 3, 4, '런칭·제휴가 겹쳐 리뷰가 밀림') on conflict do nothing$q$ using T, L;
  exception when others then null;
  end;

  -- 상향 관리: 상위 관리자 2명 + 위에서 온 것 연결 + 임원 브리핑
  declare e1 uuid; e2 uuid;
  begin
    execute $q$insert into public.executives (team_id, name, title, style_tags, interests, prefs, sort) values ($1, '김정훈', '마케팅본부장', array['숫자·근거 중시','결론 먼저','비용·효율'],
      '제휴 채널 성과와 CAC 개선 속도. 지난달 대비 숫자로 물음', '월요일 본부 주간회의 · 1페이지 · 결론 먼저', 0) returning id$q$ into e1 using T;
    execute $q$insert into public.executives (team_id, name, title, style_tags, interests, prefs, sort) values ($1, '이수경', '전략기획 상무', array['리스크 민감','고객 관점','디테일 확인'],
      '4분기 실행계획의 리스크와 대안, 런칭 일정', '격주 · 이슈 중심 · 대안 2개 이상', 1) returning id$q$ into e2 using T;
    execute $q$update public.org_notes set exec_id = $2 where team_id = $1 and kind = 'exec'$q$ using T, e1;
    execute $q$update public.org_notes set exec_id = $2 where team_id = $1 and kind = 'request'$q$ using T, e2;
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'exec_brief', 'draft', 'leader', 'L3', 3, $2, '[]'::jsonb, $3, now() - interval '40 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, replace(replace(replace($j${"headline": "위에서 보면 우리 팀은 '런칭은 순항, 제휴는 숫자가 안 보이는 팀'입니다 — 이번 주 질문은 제휴 채널과 CAC에 몰릴 가능성이 큽니다.", "execs": [{"exec_id": "{{E1}}", "name": "김정훈", "lens": "비용 15% 절감 방침 아래에서 '제휴 채널이 CAC를 낮추는 근거가 숫자로 보이는가'", "opener": "제휴 채널은 아직 목표 대비 56%지만, CAC는 1.1만 원으로 채널 중 가장 낮습니다 — 남은 변수는 B사 데이터 하나입니다.", "questions": [{"q": "제휴 신규 고객이 언제 숫자로 보이나?", "why": "주간회의에서 두 번 연속 물었고, 현재 누적 11.2만 명으로 목표 20만 명의 56%입니다.", "prep": "기준 전망 18.6만 명(93%) · B사 데이터가 11월 둘째 주 이후 → 대체 경로(공개 데이터·파일럿 2곳)로 11월 첫 주 1차 제안 가능"}, {"q": "채널별 CAC 비교표는 준비됐나?", "why": "지난 회의에서 다음 보고에 넣어 달라고 요청했습니다.", "prep": "10월 광고 성과 리포트 기준 유튜브 3.2만 · 인스타그램 2.6만 · 제휴 1.1만 원 — 박서연 님 리포트에서 바로 가져올 수 있음"}, {"q": "비용 15% 절감은 어디서 줄이나?", "why": "전사 방침의 첫 대상이 광고 집행입니다.", "prep": "유튜브 예산 20%를 제휴로 이동하는 안 (10월 리포트 제안) — 런칭 사전 예약 전환율 18%는 유지"}], "challenges": [{"point": "제휴 목표 달성 가능성 12%", "why": "같은 막힘이 3주째 반복되고 계획에 대체 경로가 없습니다.", "prep": "인정: 외부 데이터 의존을 늦게 다뤘다. 대안: 대체 데이터 경로를 이번 주 계획에 넣고, 목표 조정 여부를 11월 첫 주에 판단"}, {"point": "보고 체계 정비가 계속 밀림", "why": "계획 변경 2회, 진척 정체.", "prep": "범위를 대시보드 1차 화면으로 줄이고 나머지는 1월로"}]}, {"exec_id": "{{E2}}", "name": "이수경", "lens": "4분기 실행계획이 '최악의 경우'까지 대비돼 있는가", "opener": "실행계획 초안은 제휴 데이터 지연을 가장 큰 리스크로 두고, 대체 경로까지 넣어 6일 뒤 제출하겠습니다.", "questions": [{"q": "실행계획 초안은 기한(D-6) 안에 나오나?", "why": "경영기획팀 요청 기한이 다가옵니다.", "prep": "초안 골격 완료 · 채널별 CAC 목표만 남음 — 금요일 내부 리뷰 후 제출"}, {"q": "B사 데이터가 안 들어오면 어떻게 되나?", "why": "리스크 중심으로 보는 분이고 외부 의존이 가장 큰 변수입니다.", "prep": "최악: 4분기 제휴 목표 약 18만 명에서 멈춤 → 대체 채널 2곳으로 1.4만 명 보완안"}], "challenges": [{"point": "런칭과 제휴가 같은 사람·같은 시기에 겹침", "why": "제휴 하위 과제 3건이 한 사람에게 몰려 있습니다.", "prep": "데이터 정리 1건을 김현정 님에게 옮기는 재배분 계획을 함께 보고"}]}], "requests": [{"note_id": "", "title": "본부 4분기 마케팅 실행계획 초안 제출", "due": "{{D6}}", "status": "진행 중", "reply": "4분기 실행계획 초안은 비용 15% 절감과 채널별 CAC 목표를 반영해 기한 안에 제출하겠습니다. 제휴 데이터 지연에 대비한 대체 경로도 함께 넣었습니다."}, {"note_id": "", "title": "채널별 CAC 비교표를 다음 보고에 추가", "due": "", "status": "미답", "reply": "채널별 CAC는 유튜브 3.2만 · 인스타그램 2.6만 · 제휴 1.1만 원입니다. 다음 주간회의에 비교표로 정리해 가겠습니다."}], "share_first": [{"title": "B사 데이터는 11월 둘째 주 이후 — 제휴 목표 일정에 영향", "why": "다른 경로로 들으면 '왜 미리 말 안 했나'가 됩니다.", "tone": "bad"}, {"title": "런칭 사전 예약 1,840명 · 전환율 18%", "why": "본부장 관심사(효율)에 바로 답이 되는 좋은 숫자입니다.", "tone": "good"}], "watch": "B사 회신 날짜, 실행계획 제출 후 예산 배분 결정."}$j$, '{{E1}}', e1::text), '{{E2}}', e2::text), '{{D6}}', (current_date + 6)::text)::jsonb, L;
  exception when others then null;
  end;

  -- 팀원 평가: 김현정 님 예상 등급(시뮬레이션) + 의견 초안
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, subject_user_id, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'evaluation_draft', $2, 'draft', 'leader', 'L3', 3, $3, '[]'::jsonb, $4, now() - interval '1 day',
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 7 else 1 end, 1),
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 12 else 6 end, case when extract(month from current_date) >= 7 then 31 else 30 end))$q$
    using T, m_kim, $j${"grade": {"expected": "A", "range": ["B", "A"], "confidence": "medium", "rationale": "핵심 과제(신제품 런칭 기획)를 끌고 가면서 결과물의 판단 깊이가 2.0에서 3.0으로 뚜렷이 올랐고, 결과물 대부분이 한 번에 승인됐습니다. 다만 런칭 일정은 계획보다 조금 늦습니다.", "up": [{"text": "가격 전략을 데이터로 스스로 뒤집고, 버린 대안과 이유를 남김 (기획서 v3)", "evidence": []}, {"text": "결과물 8건 중 6건 승인, 그중 4건이 한 번에 통과", "evidence": []}, {"text": "본부장 질의에 근거를 들어 답함 (1on1 기록)", "evidence": []}], "down": [{"text": "시장 분석처럼 정형 업무에서는 자기 관점이 약하다는 보완점이 두 번 반복", "evidence": []}], "missing": "실행 관리(일정 준수) 근거가 아직 적어 A로 확정하기는 이릅니다. 11월 런칭 결과를 보면 확실해집니다."}, "overall": "문제를 끝까지 붙들고 방향을 다시 잡는 힘이 이번 기간 가장 두드러졌습니다. 신제품 가격 전략에서 처음 가정을 데이터로 뒤집고 대안을 비교해 남긴 과정이 대표적입니다. 결과물의 판단 깊이가 꾸준히 올라 팀의 핵심 과제를 맡길 수 있는 수준입니다. 다만 정해진 틀을 채우는 작업에서는 자기 관점이 덜 드러납니다.", "strengths": [{"title": "근거 기반의 방향 전환", "detail": "초기 가정을 고집하지 않고 데이터를 보고 전략을 고쳤습니다.", "evidence": []}, {"title": "결과물 품질의 꾸준한 상승", "detail": "판단 깊이 2.0 → 3.0, 대부분 한 번에 승인됐습니다.", "evidence": []}], "growth": [{"title": "정형 업무에서의 자기 관점", "detail": "시장 분석 등에서 일반적 정리에 머무는 경우가 있습니다.", "evidence": []}, {"title": "일정 관리", "detail": "런칭 기획이 계획보다 조금 늦습니다.", "evidence": []}], "competencies": [{"name": "문제 정의", "signal": "강함", "evidence": []}, {"name": "데이터 분석", "signal": "보통", "evidence": []}, {"name": "커뮤니케이션", "signal": "강함", "evidence": []}, {"name": "실행 관리", "signal": "근거 부족", "evidence": []}], "coaching": "다음 기간에는 일정이 분명한 과제를 맡기고 2주 단위로 진척을 함께 점검해 실행 관리 근거를 쌓으세요."}$j$::jsonb, L;
  exception when others then null;
  end;

  -- 업무플랫폼: 최근에 올라온 다양한 업무 (컨펌·의견·공유 / 보고서·링크·캡처·메모·숫자)
  declare r record; sid uuid;
  begin
    for r in select * from (values
      (m_jung, t3, '제휴 제안서 — B사 제외 2개사 안, 의견 부탁드려요', 'note', 'feedback', null::text, E'B사 데이터가 이번 달 안에 들어오기 어려워 보여서, A사·C사 두 곳으로 범위를 줄인 안을 만들었습니다. 목표 영향은 약 -1.4만 명으로 봅니다. 이 방향으로 가도 될지 의견 부탁드려요.', 2),
      (m_jung, t3, 'B사 데이터 수급 지연 현황 (메일 캡처)', 'image', 'share', null, '파트너사 회신 메일 캡처 — 11월 둘째 주 이후 가능', 1),
      (m_park, t7, '10월 광고 성과 리포트', 'document', 'approval', null, E'10월 광고 성과 리포트\n1. 채널별 CAC: 유튜브 3.2만 원, 인스타그램 2.6만 원, 제휴 1.1만 원\n2. 런칭 사전 예약 전환율 18%\n3. 11월 제안: 유튜브 예산 20% 제휴로 이동', 0),
      (m_park, t7, '광고 성과 대시보드 개편 1차 화면', 'link', 'share', 'https://example.com/dashboard-v1', '요청하신 1차 배포 화면 링크입니다', 3),
      (m_lee, t4, 'CRM 웰컴 메시지 A/B안', 'document', 'feedback', null, E'A안: 혜택 중심 (첫 구매 15%)\nB안: 브랜드 스토리 중심\n제휴 유입 고객 대상, 2주 테스트 예정. 어느 쪽이 나을지 의견 주세요.', 1),
      (m_han, t1, 'FGI 1차 4명 결과 메모', 'note', 'share', null, E'4명 중 3명이 얼리버드 할인에 긍정적. 3040 직장인 2명은 가격보다 배송 속도를 더 중요하게 봄.', 4),
      (m_choi, t5, '11월 콘텐츠 캘린더', 'link', 'feedback', 'https://example.com/content-calendar-11', '런칭 주간에 콘텐츠를 몰았는데 괜찮을지 봐 주세요', 2),
      (m_kim, t1, '런칭 사전 예약 누적 수', 'number', 'share', null, '사전 예약 누적', 0)
    ) as x(author, item, title, kind, rtype, link, body, ago) loop
      insert into submissions (team_id, author_id, item_id, title, kind, request_type, link_url, created_at)
        values (T, r.author, r.item, r.title, r.kind, r.rtype, r.link, now() - (r.ago || ' days')::interval - interval '3 hours') returning id into sid;
      insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at, value)
        values (sid, T, 1, r.body, '', r.author, now() - (r.ago || ' days')::interval - interval '3 hours', case when r.kind = 'number' then 1840 else null end);
    end loop;
    -- 리뷰 대기 결과물의 AI 1차 검토 (업무플랫폼 Core Insight 한 줄 포함)
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
    select T, 'review', s.author_id, 'submission_versions', v.id, 'draft', 'leader', 'L1', 1, x.c::jsonb, '[]'::jsonb, s.author_id, now() - interval '2 hours'
    from (values
      ('제휴 제안서 — B사 제외 2개사 안, 의견 부탁드려요', $j${
        "depth_score": 1.5,
        "summary": "B사 데이터 지연이라는 문제는 분명히 짚었지만, 범위를 줄이는 것 말고 다른 길(파일럿·공개 데이터)을 비교하지 않았고 A사·C사를 고른 근거도 없습니다. 목표 영향 -1.4만 명이 어떻게 나왔는지도 빠져 있습니다.",
        "brief": {"tone": "risk", "text": "정우성 님이 올린 '제휴 제안서 — B사 제외 2개사 안'은 고민의 깊이가 낮아 보입니다", "why": "범위만 줄이고 대안 비교·선정 근거가 없음"},
        "decisions": [],
        "strengths": [{"section": "본문", "text": "막힌 원인(B사 데이터 회신 지연)과 목표 영향을 먼저 밝혔습니다."}],
        "gaps": [{"section": "본문", "text": "범위 축소 외에 파일럿 고객·공개 데이터로 1차안을 만드는 길을 검토하지 않았습니다."},
                 {"section": "본문", "text": "A사·C사를 고른 이유와 -1.4만 명 추정 근거가 없습니다."}],
        "questions": ["B사를 빼지 않고 1차안을 먼저 내는 방법은 검토해 봤나요?", "-1.4만 명은 어떤 가정으로 나온 숫자인가요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      ('10월 광고 성과 리포트', $j${
        "depth_score": 3.0,
        "summary": "채널별 CAC를 나란히 놓고 제휴 채널이 가장 효율적이라는 결론까지 짧고 분명하게 전달합니다. 승인 요청이라 팀장님이 정할 것이 있습니다 — 유튜브 예산 20% 이동은 런칭 주간 노출과 맞물려 있어 판단이 필요합니다.",
        "brief": {"tone": "risk", "text": "박서연 님이 요청한 '10월 광고 성과 리포트'에 팀장님이 결정할 사항이 있습니다", "why": "11월 유튜브 예산 20%를 제휴로 옮길지"},
        "decisions": ["11월 유튜브 예산 20% → 제휴 이동", "런칭 주간 유튜브 예산 예외 여부"],
        "strengths": [{"section": "1. 채널별 CAC", "text": "세 채널 CAC를 같은 기준으로 비교해 결론이 바로 보입니다."}],
        "gaps": [{"section": "3. 11월 제안", "text": "예산 이동이 런칭 사전 예약(유튜브 유입)에 주는 영향 추정이 없습니다."}],
        "questions": ["런칭 주간에도 유튜브 예산을 20% 줄이나요?", "제휴 채널 CAC 1.1만 원은 B사 지연 이후에도 유지되나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      ('CRM 웰컴 메시지 A/B안', $j${
        "depth_score": 2.5,
        "summary": "두 안의 방향(혜택 vs 브랜드)과 테스트 기간은 정리됐지만, 본인은 어느 안을 권하는지와 무엇으로 승부를 볼지(재방문율·구매 전환) 기준이 없어 결론이 잘 보이지 않습니다.",
        "brief": {"tone": "watch", "text": "이동욱 님이 올린 'CRM 웰컴 메시지 A/B안'은 결론이 잘 안 보입니다", "why": "어느 안을 권하는지·판단 기준이 없음"},
        "decisions": [],
        "strengths": [{"section": "본문", "text": "대상(제휴 유입 고객)과 테스트 기간을 분명히 했습니다."}],
        "gaps": [{"section": "본문", "text": "성공 지표와 본인 추천안이 빠져 있어 의견을 주기 어렵습니다."}],
        "questions": ["둘 중 어느 쪽이 나을 거라고 보나요, 이유는?", "2주 뒤 무엇을 보고 승자를 정하나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$)
    ) as x(title, c)
    join submissions s on s.team_id = T and s.title = x.title
    join submission_versions v on v.submission_id = s.id and v.version = 1;
    -- 최다은 11월 콘텐츠 캘린더: 보완 요청 (팀원 홈 '지금 할 일'에 뜬다)
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
    select s.id, v.id, T, L, '런칭 주간에 몰린 건 좋은데, 그 주 디자인팀 슬롯이 이미 찼어요. 2편은 앞 주로 당기고, 일정이랑 담당까지 표로 다시 올려 주세요.', now() - interval '20 hours'
    from submissions s join submission_versions v on v.submission_id = s.id where s.team_id = T and s.title = '11월 콘텐츠 캘린더';
    update submissions set status = 'needs_work' where team_id = T and title = '11월 콘텐츠 캘린더';
  exception when others then null;
  end;
  -- 그룹 스페이스 (23_work_groups 이후에만 들어감): 신제품 런칭 TF · 제휴 채널 확대
  declare wg1 uuid; wg2 uuid; gs uuid; gv1 uuid; gv2 uuid; c1 uuid;
  begin
    insert into work_groups (team_id, name, item_id, created_by, created_at) values (T, '신제품 런칭 TF', g1, m_kim, now() - interval '20 days') returning id into wg1;
    insert into work_groups (team_id, name, item_id, created_by, created_at) values (T, '제휴 채널 확대', g2, L, now() - interval '15 days') returning id into wg2;
    insert into work_group_members (group_id, user_id, team_id) values (wg1, m_kim, T), (wg1, m_han, T), (wg1, m_choi, T), (wg2, m_jung, T), (wg2, m_lee, T);
    -- TF: 김현정·한수진이 같이 다듬는 키비주얼 시안 (v1 김현정 → v2 한수진)
    insert into submissions (team_id, author_id, item_id, group_id, title, kind, request_type, created_at)
      values (T, m_kim, t1, wg1, '런칭 캠페인 키비주얼 시안', 'document', 'feedback', now() - interval '3 days') returning id into gs;
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
      (gs, T, 1, E'키비주얼 시안 2종\nA안: 제품 클로즈업 + 다크 톤 (프리미엄)\nB안: 일상 속 사용 장면 + 밝은 톤 (2030 공감)\n카피: "하루가 가벼워지는 첫 경험"', 'A/B 두 안', m_kim, now() - interval '3 days') returning id into gv1;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at) values
      (gs, gv1, T, m_han, 'FGI에서 2030은 B안 같은 사용 장면에 더 반응했어요. B안 색감을 조금 더 살려 보면 어떨까요?', now() - interval '2 days 20 hours') returning id into c1;
    insert into review_comments (submission_id, version_id, team_id, author_id, parent_id, body, created_at) values
      (gs, gv1, T, m_kim, c1, '좋아요. 그럼 B안 기준으로 톤 올려서 v2 만들어 볼게요.', now() - interval '2 days 18 hours'),
      (gs, gv1, T, m_choi, c1, '콘텐츠 쪽에서도 B안이 SNS 썸네일로 쓰기 편해요.', now() - interval '2 days 16 hours');
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
      (gs, T, 2, E'키비주얼 시안 — B안 발전\n일상 속 사용 장면, 밝은 톤을 한 단계 올림\nSNS 썸네일 크롭 버전 포함 (1:1, 4:5)\n카피: "하루가 가벼워지는 첫 경험"', 'B안 톤 보강 · SNS 크롭 추가 (한수진)', m_han, now() - interval '1 day') returning id into gv2;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at) values
      (gs, gv2, T, L, '방향 좋습니다. 런칭 페이지 첫 화면에도 같은 컷을 쓸 수 있는지 디자인팀과 확인해 주세요.', now() - interval '20 hours'),
      (gs, gv2, T, m_kim, '확인해서 내일까지 답 드릴게요.', now() - interval '6 hours');
    update submissions set status = 'in_review' where id = gs;
    -- 제휴: 공유만
    insert into submissions (team_id, author_id, item_id, group_id, title, kind, request_type, created_at)
      values (T, m_jung, t3, wg2, '제휴사 공동 프로모션 일정', 'note', 'share', now() - interval '2 days') returning id into gs;
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
      (gs, T, 1, E'A사 11/12~11/25, C사 11/19~12/2 공동 프로모션\nCRM 웰컴 메시지는 11/10까지 확정 필요', '', m_jung, now() - interval '2 days');
    insert into review_comments (submission_id, team_id, author_id, body, created_at) values
      (gs, T, m_lee, '웰컴 메시지는 A/B 결과 보고 11/8까지 확정할게요.', now() - interval '1 day');
  exception when others then null;
  end;
  -- 업무 스페이스 대화 (24_work_space 이후에만 들어감)
  declare c1 uuid; wg uuid;
  begin
    select id into wg from work_groups where team_id = T and name = '신제품 런칭 TF';
    insert into space_messages (team_id, space_user, author_id, item_id, body, created_at)
      values (T, m_choi, m_choi, t5, '디자인팀 주간 고정 슬롯 확정됐어요 — 매주 화 오후 2시간', now() - interval '26 hours') returning id into c1;
    insert into space_messages (team_id, space_user, author_id, parent_id, body, created_at)
      values (T, m_choi, L, c1, '좋아요, 이걸로 리드타임이 얼마나 줄지 다음 주에 같이 봐요.', now() - interval '25 hours');
    insert into space_messages (team_id, space_user, author_id, body, created_at) values
      (T, m_choi, L, '내일 오전 주간회의 10시로 당겨졌어요. 참고하세요!', now() - interval '22 hours'),
      (T, m_choi, m_choi, '네 확인했습니다 👍', now() - interval '21 hours'),
      (T, m_jung, L, 'B사 회신 오면 바로 알려 줘요. 급하면 메시지로 먼저 줘도 됩니다.', now() - interval '30 hours');
    if wg is not null then
      insert into space_messages (team_id, group_id, author_id, item_id, body, created_at)
        values (T, wg, m_han, t1, 'FGI 2차 4명 다음 주 화요일로 확정됐어요. 키비주얼 B안도 같이 보여 줄게요.', now() - interval '28 hours') returning id into c1;
      insert into space_messages (team_id, group_id, author_id, parent_id, body, created_at) values
        (T, wg, m_kim, c1, '좋아요! 반응 좋으면 B안으로 바로 굳히죠.', now() - interval '27 hours'),
        (T, wg, m_choi, c1, '썸네일 크롭본도 같이 보여 주면 좋을 것 같아요.', now() - interval '26 hours');
      insert into space_messages (team_id, group_id, author_id, body, created_at) values
        (T, wg, m_choi, '사전 예약 페이지 카피 초안은 이번 주 금요일까지 올릴게요.', now() - interval '5 hours');
    end if;
  exception when others then null;
  end;
  -- 히스토리 관리 (30_history 이후에만 들어감): 과제 3개 히스토리 + 한수진 님에게 전달 1건 · 질문/답
  declare h_tmpl text; h_txt text; h_m text; h_sh uuid;
  begin
    for h_tmpl in select x from (values
      -- 제휴 프로모션 제안서 (정우성)
      (t3::text || '|' || $j${"summary":"3개사 제휴로 시작했다가 B사 회원 데이터 수급 지연으로 A·C 2개사 축소안 검토 중. 범위 결정과 CRM 웰컴 메시지 확정이 다음 단계.",
 "lanes":[{"id":"L1","title":"제휴 범위"},{"id":"L2","title":"B사 데이터"},{"id":"L3","title":"A·C 프로모션"},{"id":"L4","title":"CRM 연계"}],
 "events":[{"id":"V1","lane":"L1","date":"@-30","title":"제안서 v1","kind":"doc","detail":"A·B·C 3개사 공동 프로모션 제안서 초안."},
  {"id":"V2","lane":"L1","date":"@-27","title":"보완: 숫자로","kind":"feedback","detail":"팀장 피드백 — 사별 기대 유입을 숫자로 제시할 것."},
  {"id":"V3","lane":"L1","date":"@-20","title":"3개사 확정","kind":"decision","detail":"v2 승인. 3개사 동시 진행으로 확정."},
  {"id":"V4","lane":"L2","date":"@-14","title":"데이터 지연","kind":"issue","detail":"B사 회원 데이터 수급이 11월 둘째 주 이후로 밀림 (메일 캡처 공유)."},
  {"id":"V5","lane":"L1","date":"@-7","title":"2개사 축소안","kind":"doc","detail":"B사 제외, A·C 2개사로 범위를 줄인 안. 목표 영향 약 −1.4만 명."},
  {"id":"V6","lane":"L3","date":"@-2","title":"일정 공유","kind":"doc","detail":"A사 11/12~25, C사 11/19~12/2 공동 프로모션 일정 공유."},
  {"id":"V7","lane":"L4","date":"@-1","title":"웰컴 확정 필요","kind":"issue","detail":"CRM 웰컴 메시지를 A/B 결과 보고 11/8까지 확정 (이동욱)."},
  {"id":"V8","lane":"L1","date":"@7","title":"범위 결정","kind":"decision","future":true,"detail":"축소안 채택 여부와 목표치 조정을 함께 결정."},
  {"id":"V9","lane":"L3","date":"@21","title":"A사 시작","kind":"plan","future":true}],
 "links":[{"from":"V4","to":"V5","label":"지연 → 축소안"},{"from":"V7","to":"V9","label":"시작 조건"}],
 "people":[{"id":"P1","name":"정우성","org":"제휴 마케팅","scope":"team","role":"담당 · 제안서 작성"},
  {"id":"P2","name":"이동욱","org":"CRM 마케팅","scope":"team","role":"웰컴 메시지 확정"},
  {"id":"P3","name":"B사","org":"제휴사","scope":"external","role":"회원 데이터 지연","check":true},
  {"id":"P4","name":"A사 제휴팀","org":"제휴사","scope":"external","role":"공동 프로모션 11/12~"},
  {"id":"P5","name":"C사 마케팅팀","org":"제휴사","scope":"external","role":"공동 프로모션 11/19~","check":true}],
 "fixed":[{"id":"F1","text":"제휴 보고는 사별 기대 유입·비용·리스크를 첫 장에","detail":"제안서 v1 피드백에서 팀장이 정한 보고 기준.","since":"@-27"},
  {"id":"F2","text":"A사 11/12~25, C사 11/19~12/2 공동 프로모션","since":"@-2"}],
 "open":[{"id":"O1","text":"진행 범위(A·C 2개사) — 목표치 조정과 함께 결정","detail":"축소안을 채택하면 연내 목표 8만 명 중 약 1.4만 명이 빠짐."},
  {"id":"O2","text":"CRM 웰컴 메시지 확정 — A사 시작 조건"}],
 "risks":[{"id":"K1","text":"B사 데이터 추가 지연 시 2차 합류 불가","detail":"11월 둘째 주 이후에도 수급이 안 되면 연내 합류가 어려움."}],
 "tried":[{"id":"T1","text":"3개사 동시 진행 — B사 데이터 의존이 커서 일정 리스크"}],
 "gaps":[{"id":"G1","text":"B사와 지연 이후 합의 내용 — 기록 없음 → 정우성 님께 확인"},{"id":"G2","text":"C사 비용 분담 비율 — 기록 없음"}],
 "related":[{"item_id":"@t4","title":"제휴 유입 고객 CRM 연계","why":"웰컴 메시지가 시작 조건"}],
 "progress":{"measure":"percent","unit":"%","target":100,"points":[{"date":"@-30","value":0},{"date":"@-21","value":22},{"date":"@-14","value":26},{"date":"@-7","value":28},{"date":"@0","value":30}]},
 "owner":{"id":null,"name":"정우성","previous":[]}}$j$),
      -- 런칭 캠페인 기획 (김현정)
      (t1::text || '|' || $j${"summary":"키비주얼은 FGI 반응을 근거로 B안(일상 장면·밝은 톤)으로 좁히는 중. FGI 2차와 임원 보고가 다음 고비.",
 "lanes":[{"id":"L1","title":"키비주얼"},{"id":"L2","title":"고객 FGI"},{"id":"L3","title":"임원 보고"}],
 "events":[{"id":"V1","lane":"L2","date":"@-30","title":"타깃 정의","kind":"decision","detail":"2030 직장인 · 첫 구매 고객으로 타깃 확정."},
  {"id":"V2","lane":"L2","date":"@-10","title":"FGI 1차 4명","kind":"doc","detail":"4명 중 3명이 얼리버드 할인에 긍정적. 3040은 배송 속도를 더 중요하게 봄."},
  {"id":"V3","lane":"L1","date":"@-3","title":"시안 A/B","kind":"doc","detail":"A안 제품 클로즈업·다크 톤, B안 일상 장면·밝은 톤."},
  {"id":"V4","lane":"L1","date":"@-2","title":"B안 기울기","kind":"feedback","detail":"FGI에서 2030이 B안에 더 반응 — B안 기준으로 v2."},
  {"id":"V5","lane":"L1","date":"@-1","title":"v2 · SNS 크롭","kind":"doc","detail":"B안 톤 보강, SNS 썸네일 크롭(1:1, 4:5) 추가."},
  {"id":"V6","lane":"L2","date":"@6","title":"FGI 2차","kind":"plan","future":true},
  {"id":"V7","lane":"L3","date":"@38","title":"임원 보고","kind":"plan","future":true}],
 "links":[{"from":"V2","to":"V4","label":"FGI 반응 → B안"}],
 "people":[{"id":"P1","name":"김현정","org":"브랜드 마케팅","scope":"team","role":"담당 · 키비주얼"},
  {"id":"P2","name":"한수진","org":"마케팅 기획","scope":"team","role":"FGI 진행"},
  {"id":"P3","name":"최다은","org":"콘텐츠 마케팅","scope":"team","role":"SNS 썸네일 활용"},
  {"id":"P4","name":"디자인팀","org":"디자인","scope":"dept","role":"런칭 페이지 첫 화면 컷","check":true}],
 "fixed":[{"id":"F1","text":"타깃: 2030 직장인 · 첫 구매 고객","since":"@-30"},{"id":"F2","text":"키비주얼은 B안 기준으로 발전","since":"@-2"}],
 "open":[{"id":"O1","text":"런칭 페이지 첫 화면에 같은 컷 사용 여부 — 디자인팀 확인"},{"id":"O2","text":"FGI 2차 결과로 B안 확정"}],
 "tried":[{"id":"T1","text":"다크 톤 프리미엄 A안 — 2030 반응 약함"}],
 "gaps":[{"id":"G1","text":"임원 보고 형식·참석자 — 기록 없음 → 팀장님께 확인"}],
 "progress":{"measure":"children","unit":"%","target":100,"points":[{"date":"@-30","value":20},{"date":"@-10","value":40},{"date":"@0","value":40}]},
 "owner":{"id":null,"name":"김현정","previous":[]}}$j$),
      -- 콘텐츠 제작 프로세스 개선 (최다은)
      (t5::text || '|' || $j${"summary":"디자인팀 고정 슬롯 확보 후 리드타임 측정 시작. 평균 2.6주로 목표 2주까지 남은 구간.",
 "lanes":[{"id":"L1","title":"프로세스"},{"id":"L2","title":"측정"}],
 "events":[{"id":"V1","lane":"L1","date":"@-21","title":"고정 슬롯","kind":"decision","detail":"디자인팀 주간 고정 슬롯 확정 (화 오후 2시간)."},
  {"id":"V2","lane":"L2","date":"@-14","title":"리드타임 측정","kind":"doc","detail":"측정 시작 — 평균 9일."},
  {"id":"V3","lane":"L2","date":"@-5","title":"월 제작 건수","kind":"doc","detail":"지표 추가, 4건 시범 적용."},
  {"id":"V4","lane":"L1","date":"@20","title":"마감 연장 요청","kind":"plan","future":true,"detail":"외주 제작사 교체로 2주 연장 요청."}],
 "people":[{"id":"P1","name":"최다은","org":"콘텐츠 마케팅","scope":"team","role":"담당"},{"id":"P2","name":"디자인팀","org":"디자인","scope":"dept","role":"주간 고정 슬롯"},{"id":"P3","name":"외주 제작사","scope":"external","role":"교체 중","check":true}],
 "fixed":[{"id":"F1","text":"디자인팀 주간 고정 슬롯 (화 오후 2시간)","since":"@-21"}],
 "open":[{"id":"O1","text":"마감 2주 연장 · 영상 가이드 다음 분기 이관 여부"}],
 "risks":[{"id":"K1","text":"외주 제작사 교체로 템플릿 정비 지연"}],
 "gaps":[],
 "progress":{"measure":"percent","unit":"%","target":100,"points":[{"date":"@-21","value":45},{"date":"@-14","value":55},{"date":"@-5","value":66}]},
 "owner":{"id":null,"name":"최다은","previous":[]}}$j$)
    ) v(x) loop
      h_txt := split_part(h_tmpl, '|', 2);
      for h_m in select m from (select distinct (regexp_matches(h_txt, '@(-?\d+)', 'g'))[1] m) z order by length(m) desc loop
        h_txt := replace(h_txt, '@' || h_m, to_char(current_date + h_m::int, 'YYYY-MM-DD'));
      end loop;
      h_txt := replace(h_txt, '@t4', t4::text);
      insert into task_histories (item_id, team_id, content, synced_at, record_count, new_count, updated_at)
        values (split_part(h_tmpl, '|', 1)::uuid, T, h_txt::jsonb, now() - interval '2 days', 24, 3, now() - interval '2 days')
        on conflict (item_id) do nothing;
    end loop;
    update task_histories set edits = '{"pinned":["F1"]}'::jsonb where item_id = t3;
    -- 런칭 캠페인 기획 → 한수진 (FGI 진행을 함께 맡음)
    insert into history_shares (team_id, item_id, from_id, to_id, note, snapshot, status, sent_at, created_at)
      select T, t1, L, m_han, '수진 님, FGI 2차부터 같이 봐 주세요. 키비주얼은 B안으로 기울어 있으니 그 기준으로 질문지를 다듬으면 됩니다.', content, 'sent', now() - interval '1 day', now() - interval '1 day'
        from task_histories where item_id = t1 returning id into h_sh;
    insert into history_messages (share_id, team_id, author_id, body, created_at) values
      (h_sh, T, m_han, 'FGI 2차도 4명으로 하나요? 3040 비중을 늘릴지 궁금합니다.', now() - interval '20 hours'),
      (h_sh, T, L, '4명 유지하고 3040을 2명으로 맞춰 주세요. 배송 속도 질문은 꼭 넣어 주세요.', now() - interval '18 hours');
    -- 김현정 님이 요청한 히스토리 (팀장 확인 대기)
    insert into history_shares (team_id, item_id, to_id, note, status, created_at)
      values (T, t3, m_kim, '제휴 채널과 런칭 일정이 겹쳐서 흐름을 알고 싶어요', 'requested', now() - interval '3 hours');
  exception when others then null;
  end;
  -- 성과 체크인 (22_checkin 이후에만 들어감): 최다은 '콘텐츠 제작 프로세스 개선' 승인 3건 + 승인 대기 1건
  declare ck uuid; r record;
  begin
    for r in select * from (values (45, '30%', 21, '디자인팀 고정 슬롯 확보, 1차 프로세스 문서 공유'), (55, '45%', 14, '리드타임 측정 시작 — 평균 9일'), (66, '55%', 5, '월 제작 건수 지표 추가, 4건 시범 적용'))
                    as x(v, prev, ago, note) loop
      insert into submissions (team_id, author_id, item_id, space_id, title, kind, request_type, created_at)
        values (T, m_choi, t5, m_choi, '성과입력 · 콘텐츠 제작 프로세스 개선 ' || r.v || '%', 'checkin', 'approval', now() - (r.ago || ' days')::interval) returning id into ck;
      insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, value, checkin, created_at)
        values (ck, T, 1, r.note, r.note, m_choi, r.v, jsonb_build_object('type', 'percent', 'value', r.v, 'prev', r.prev, 'label', r.v || '%'), now() - (r.ago || ' days')::interval);
      update submissions set status = 'approved', approved_by = L, updated_at = now() - (r.ago || ' days')::interval + interval '4 hours' where id = ck;
    end loop;
    insert into submissions (team_id, author_id, item_id, space_id, title, kind, request_type, created_at)
      values (T, m_choi, t5, m_choi, '성과입력 · 콘텐츠 제작 프로세스 개선 75%', 'checkin', 'approval', now() - interval '3 hours') returning id into ck;
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, value, checkin, created_at)
      values (ck, T, 1, '샘플 3건 리드타임 9일 → 6일', '샘플 3건 리드타임 9일 → 6일', m_choi, 75, jsonb_build_object('type', 'percent', 'value', 75, 'prev', '66%', 'label', '75%'), now() - interval '3 hours');
  exception when others then null;
  end;
end $fn$;
revoke all on function public.seed_demo_team(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.seed_demo_team(uuid, uuid, uuid[]) to service_role;

-- >>>>>>>>>> 20261015000011_org_notes.sql
-- =====================================================================
-- 홈 개편 ④ 조직·전사: '위에서 온 것' 메모 + AI 영향 분석
--   · org_notes — 전략·방향 변경 / 임원 관심사 / 상위 요청 / 유관 부서 / 전사 일정 (팀장만 보고 씀)
--   · ai_kind 'org_impact' — 메모를 팀 목표·과제와 맞춰 본 영향 분석 (코어 AI)
-- =====================================================================
alter type public.ai_kind add value if not exists 'org_impact';

create table if not exists public.org_notes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null default auth.uid(),
  kind        text not null default 'other' check (kind in ('strategy', 'exec', 'request', 'peer', 'calendar', 'other')),
  title       text not null,
  body        text not null default '',
  source      text not null default '',        -- 어디서 들었는지 (예: 본부장 주간회의)
  event_date  date,                             -- 일정·기한 (전사 일정, 상위 요청 마감)
  status      text not null default 'open' check (status in ('open', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists org_notes_team_idx on public.org_notes (team_id, status, created_at desc);

alter table public.org_notes enable row level security;
drop policy if exists org_notes_leader on public.org_notes;
create policy org_notes_leader on public.org_notes for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

create or replace function public.touch_org_note() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists org_notes_touch on public.org_notes;
create trigger org_notes_touch before update on public.org_notes for each row execute function public.touch_org_note();

-- 예약 AI 인사이트 대상 팀: 활동 기록(events)뿐 아니라 목표·진척·요청·위에서 온 것·결과물 활동이 최근 14일에 있으면 포함
create or replace function public.active_ai_teams() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from teams t
  where public.team_has_feature(t.id, 'ai_core')
    and (not t.is_demo or t.created_at > now() - interval '14 days')
    and (
      exists (select 1 from events e where e.team_id = t.id and e.created_at > now() - interval '14 days')
      or exists (select 1 from work_items w where w.team_id = t.id and w.updated_at > now() - interval '14 days')
      or exists (select 1 from work_item_logs l where l.team_id = t.id and l.created_at > now() - interval '14 days')
      or exists (select 1 from team_requests r where r.team_id = t.id and r.created_at > now() - interval '14 days')
      or exists (select 1 from org_notes o where o.team_id = t.id and o.updated_at > now() - interval '14 days')
      or exists (select 1 from submissions s where s.team_id = t.id and s.updated_at > now() - interval '14 days')
    );
$$;
revoke all on function public.active_ai_teams() from public, anon, authenticated;

-- >>>>>>>>>> 20261016000012_people_work.sql
-- =====================================================================
-- 메뉴 재편 (팀목표 · 업무플랫폼 · 팀원관리)에 맞춘 근거 원장 보강
--   · 팀장 요청을 팀원이 완료하면 → 그 팀원의 평가 근거로 자동 기록 (기한 준수 여부 포함)
--   이미 쌓이는 것: 체크인 · 1on1 · 팀장 메모 · 결과물 · 리뷰 피드백 · 관찰 메모 · 업무 완료
-- =====================================================================
create or replace function public.trg_request_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_late int;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    v_late := case when new.due_date is null then null else (coalesce(new.responded_at, now())::date - new.due_date) end;
    perform public.upsert_evidence(new.team_id, new.to_id, 'task', new.id,
      '요청 완료 — ' || new.title
        || case when v_late is null then '' when v_late <= 0 then ' (기한 내)' else ' (' || v_late || '일 늦음)' end
        || case when coalesce(new.response, '') <> '' then ' · 답: ' || left(new.response, 120) else '' end,
      case when v_late is not null and v_late <= 0 then 'positive'::public.polarity else 'neutral'::public.polarity end,
      null, coalesce(new.responded_at, now()));
  end if;
  return new;
end $$;
drop trigger if exists t_request_evidence on public.team_requests;
create trigger t_request_evidence after insert or update of status on public.team_requests
  for each row execute function public.trg_request_evidence();

-- 이미 완료된 요청도 한 번 채워 넣기
insert into public.evidence (team_id, subject_user_id, source, source_id, summary, polarity, occurred_at, provenance)
select r.team_id, r.to_id, 'task', r.id,
       left('요청 완료 — ' || r.title
         || case when r.due_date is null then '' when coalesce(r.responded_at, r.created_at)::date <= r.due_date then ' (기한 내)'
                 else ' (' || (coalesce(r.responded_at, r.created_at)::date - r.due_date) || '일 늦음)' end, 400),
       case when r.due_date is not null and coalesce(r.responded_at, r.created_at)::date <= r.due_date then 'positive'::public.polarity else 'neutral'::public.polarity end,
       coalesce(r.responded_at, r.created_at), 'human'
from public.team_requests r
where r.status = 'done'
on conflict (source, source_id, subject_user_id) where source_id is not null do nothing;

-- =====================================================================
-- 의사결정 보드 — 흩어진 기록에서 모은 '결정할 것·지켜볼 리스크' 카드의 진행 상태
--   카드 자체는 매번 신호·AI 해석에서 계산되고, 여기에는 팀장이 옮긴 상태만 남는다
--   stage: reviewing(검토 중) · promoted(리스크 → 결정으로 올림) · watching(지켜보기로 내림) · dismissed(뺌) · decided(결정 기록함)
-- =====================================================================
create table if not exists public.decision_board (
  team_id     uuid not null references public.teams(id) on delete cascade,
  card_key    text not null,
  title       text not null default '',
  stage       text not null check (stage in ('reviewing', 'promoted', 'watching', 'dismissed', 'decided')),
  note        text not null default '',
  decision_id uuid references public.decisions(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (team_id, card_key)
);
alter table public.decision_board enable row level security;
drop policy if exists decision_board_leader on public.decision_board;
create policy decision_board_leader on public.decision_board for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

-- =====================================================================
-- 팀원관리: 주간 AI 액션 추천 (1on1 · 칭찬 배지 · 관찰 기록 · 육성 · 업무 독려 · 막힘 지원 · 업무 조정)
-- =====================================================================
alter type public.ai_kind add value if not exists 'people_actions';

-- 팀장이 추천 액션을 했는지/건너뛰었는지 (주 단위 키: 주시작:팀원:종류)
create table if not exists public.people_action_status (
  team_id    uuid not null references public.teams(id) on delete cascade,
  action_key text not null,
  status     text not null check (status in ('done', 'skipped')),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (team_id, action_key)
);
alter table public.people_action_status enable row level security;
drop policy if exists people_action_status_leader on public.people_action_status;
create policy people_action_status_leader on public.people_action_status for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

-- 칭찬 배지: 팀원에게 알림으로 가고, 팀장 관찰 기록(칭찬)으로도 남아 평가 근거가 된다
create or replace function public.send_praise(p_team uuid, p_to uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from team_members where team_id = p_team and user_id = p_to and status = 'active') then raise exception 'NOT_MEMBER'; end if;
  insert into observations (team_id, author_id, subject_id, kind, body)
    values (p_team, auth.uid(), p_to, 'praise', '[칭찬 배지] ' || left(coalesce(nullif(trim(p_body), ''), '수고 많았어요'), 300)) returning id into v_id;
  perform public._notify(p_to, p_team, 'praise', '칭찬 배지가 도착했어요', left(p_body, 120), '/');
  return v_id;
end $$;
revoke all on function public.send_praise(uuid, uuid, text) from public, anon;
grant execute on function public.send_praise(uuid, uuid, text) to authenticated;

-- 월요일 07:10 KST 주간 팀원관리 액션 (pg_cron · _invoke_function 이 있는 프로젝트만)
do $$ begin perform cron.unschedule('people-actions-weekly'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('people-actions-weekly', '10 22 * * 0', $c$ select public._invoke_function('ai-people-actions', '{"all": true}') $c$);
exception when others then null; end $$;

-- =====================================================================
-- 업무플랫폼: 팀장이 '완료'로 정리한 결과물은 사람별 카드에서 빠진다 (개인 업무 스페이스에는 남음)
--   새 버전이 올라오면 다시 열린다
-- =====================================================================
alter table public.submissions add column if not exists closed_at timestamptz;
alter table public.submissions add column if not exists closed_by uuid references public.profiles(id) on delete set null;

create or replace function public.trg_submission_reopen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update submissions set closed_at = null, closed_by = null where id = new.submission_id and closed_at is not null;
  return new;
end $$;
drop trigger if exists t_sv_reopen on public.submission_versions;
create trigger t_sv_reopen after insert on public.submission_versions for each row execute function public.trg_submission_reopen();

-- >>>>>>>>>> 20261017000013_ai_guard.sql
-- =====================================================================
-- AI 남용·원가 방어 (과금 v2.1)
--   기존: 기본 AI 월 횟수 한도(Pro 400 · Pro+ 1,000)만 있음 → 하루에 몰아 쓰거나, 같은 걸 계속 다시 만들거나,
--         실패한 호출(파싱 오류)의 비용은 기록되지 않는 구멍이 있었다.
--   추가:
--     ① 시간당 · 하루 호출 상한 (요금제별)
--     ② 같은 대상(같은 결과물 버전 · 같은 기간 인사이트 · 같은 1on1) 다시 만들기는 하루 3번까지
--     ③ 월 AI 원가 상한(USD) — 횟수와 별개로 실제 원가 합계가 넘으면 기본 AI를 멈춤 (체험은 더 낮게)
--     ④ 실패한 호출도 원가를 남김 (reason = 'ai_error', 횟수 한도엔 안 셈)
--   10분 안에 같은 대상을 다시 누르면 AI를 다시 부르지 않고 방금 결과를 돌려준다 (Edge Function 쪽)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter table public.plans add column if not exists ai_hourly_cap int not null default 0;
alter table public.plans add column if not exists ai_daily_cap int not null default 0;
alter table public.plans add column if not exists ai_cost_cap_usd numeric not null default 0;

update public.plans set ai_hourly_cap = 0,  ai_daily_cap = 0,   ai_cost_cap_usd = 0  where id = 'free';
update public.plans set ai_hourly_cap = 30, ai_daily_cap = 80,  ai_cost_cap_usd = 10 where id = 'pro';
update public.plans set ai_hourly_cap = 60, ai_daily_cap = 200, ai_cost_cap_usd = 20 where id = 'pro_plus';

alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('monthly_grant','topup','usage','refund','adjust','core_usage','ai_error'));

create index if not exists ai_outputs_target_idx on public.ai_outputs (team_id, kind, ref_id, period_start, created_at desc);

-- AI를 부르기 직전에 확인 (Edge Function 의 service role 만 호출)
create or replace function public.ai_guard(p_team uuid, p_kind text, p_ref uuid default null,
  p_period date default null, p_subject uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_plan plans; v_bal credit_balances; v_sub subscriptions;
  v_hour int; v_day int; v_cost numeric; v_cap numeric; v_same int;
begin
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then raise exception 'TEAM_NOT_FOUND' using errcode = 'P0001'; end if;
  v_plan := public.effective_plan_for_owner(v_owner);
  v_bal := public._ensure_credit_period(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '24 hours')
    into v_hour, v_day
    from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'usage', 'ai_error') and created_at > now() - interval '24 hours';
  if v_hour >= v_plan.ai_hourly_cap then
    raise exception 'AI_RATE_HOUR' using errcode = 'P0001', hint = v_plan.ai_hourly_cap::text;
  end if;
  if v_day >= v_plan.ai_daily_cap then
    raise exception 'AI_RATE_DAY' using errcode = 'P0001', hint = v_plan.ai_daily_cap::text;
  end if;

  -- 월 원가 상한 (체험 중이면 4달러 ≈ 5,800원)
  v_cap := case when v_sub.status = 'trialing' then least(v_plan.ai_cost_cap_usd, 4) else v_plan.ai_cost_cap_usd end;
  select coalesce(sum(cost_usd), 0) into v_cost from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'ai_error') and created_at >= v_bal.period_start;
  if v_cost >= v_cap then
    raise exception 'AI_COST_CAP' using errcode = 'P0001';
  end if;

  -- 같은 대상 다시 만들기: 24시간에 3번까지
  if p_ref is not null or p_period is not null then
    select count(*) into v_same from ai_outputs
     where team_id = p_team and kind::text = p_kind
       and ref_id is not distinct from p_ref and period_start is not distinct from p_period
       and subject_user_id is not distinct from p_subject
       and created_at > now() - interval '24 hours';
    if v_same >= 3 then raise exception 'AI_REPEAT' using errcode = 'P0001'; end if;
  end if;

  return jsonb_build_object('hour', v_hour, 'day', v_day, 'cost_usd', v_cost, 'cost_cap_usd', v_cap);
end $$;
revoke all on function public.ai_guard(uuid, text, uuid, date, uuid) from public, anon, authenticated;

-- 실패한 호출의 원가 기록 (횟수 한도엔 안 셈, 원가·속도 한도엔 셈)
create or replace function public.log_ai_error(p_team uuid, p_kind text, p_model text, p_in int, p_out int, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from teams where id = p_team;
  insert into credit_ledger (owner_id, team_id, delta, reason, ai_kind, model, input_tokens, output_tokens, cost_usd)
    values (v_owner, p_team, 0, 'ai_error', p_kind, p_model, p_in, p_out, p_cost);
end $$;
revoke all on function public.log_ai_error(uuid, text, text, int, int, numeric) from public, anon, authenticated;

-- 운영용: 팀장별 이번 달 AI 원가 (SQL Editor 에서 확인)
create or replace view public.ai_cost_by_owner as
select l.owner_id, p.full_name,
       count(*) filter (where l.reason = 'core_usage') as core_calls,
       count(*) filter (where l.reason = 'usage') as premium_calls,
       count(*) filter (where l.reason = 'ai_error') as failed_calls,
       round(coalesce(sum(l.cost_usd), 0), 3) as cost_usd,
       round(coalesce(sum(l.cost_usd), 0) * 1450) as cost_krw
  from credit_ledger l left join profiles p on p.id = l.owner_id
 where l.created_at >= date_trunc('month', now()) and l.reason in ('core_usage', 'usage', 'ai_error')
 group by l.owner_id, p.full_name
 order by cost_usd desc;
revoke all on public.ai_cost_by_owner from public, anon, authenticated;

-- >>>>>>>>>> 20261018000014_ateam_advice.sql
-- =====================================================================
-- A·Team의 제안 (주간 운영 컨설팅) + 팀장 관심 지수 + 팀장 셀프 체크
--   · leader_attention(): 최근 N일 팀장 → 팀원 접점(1on1 · 리뷰 코멘트 · 관찰·칭찬 · 요청 · 과제 코멘트)과 리뷰 응답 시간
--   · advice_status: 제안별 채택 · 보류 · 완료 (다음 주 회고의 근거)
--   · leader_selfcheck: 팀장 주 1회 에너지 · 부담 (선택)
--   · 월요일 07:30 KST 자동 생성 (팀원관리 액션 07:10 다음)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'advisor_weekly';

-- 팀장 관심(접점) — 팀장 본인 또는 service role 만
create or replace function public.leader_attention(p_team uuid, p_days int default 28)
returns table (user_id uuid, oo int, comments int, obs int, praise int, reqs int, item_comments int,
               touch numeric, resp_hours numeric, waiting int, last_touch timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz := now() - make_interval(days => p_days); v_leader uuid;
begin
  if not public.is_team_leader(p_team) and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden'; end if;
  select tm.user_id into v_leader from team_members tm where tm.team_id = p_team and tm.role = 'leader' and tm.status = 'active' limit 1;
  return query
  with m as (
    select tm.user_id from team_members tm where tm.team_id = p_team and tm.role = 'member' and tm.status = 'active'
  ), t as (
    select o.member_id as uid, 'oo' as k, coalesce(o.completed_at, o.scheduled_at) as at from one_on_ones o
     where o.team_id = p_team and o.status = 'done' and coalesce(o.completed_at, o.scheduled_at) >= v_since
    union all
    select s.author_id, 'cm', c.created_at from review_comments c join submissions s on s.id = c.submission_id
     where c.team_id = p_team and c.author_id = v_leader and c.created_at >= v_since
    union all
    select ob.subject_id, case when ob.kind = 'praise' then 'pr' else 'ob' end, ob.created_at from observations ob
     where ob.team_id = p_team and ob.author_id = v_leader and ob.created_at >= v_since
    union all
    select r.to_id, 'rq', r.created_at from team_requests r
     where r.team_id = p_team and r.from_id = v_leader and r.created_at >= v_since
    union all
    select w.owner_id, 'ic', c.created_at from work_item_comments c join work_items w on w.id = c.item_id
     where c.team_id = p_team and c.author_id = v_leader and c.created_at >= v_since
  ), resp as (
    -- 팀원이 올린 버전 → 팀장 첫 반응(코멘트 · 승인)까지 시간
    select v.created_by as uid, v.id,
           (select min(x.at) from (
              select c.created_at as at from review_comments c where c.submission_id = v.submission_id and c.author_id = v_leader and c.created_at >= v.created_at
              union all select s.approved_at from submissions s where s.id = v.submission_id and s.approved_at >= v.created_at) x) as first_at,
           v.created_at, s.status as sst
      from submission_versions v join submissions s on s.id = v.submission_id
     where v.team_id = p_team and v.created_at >= v_since and v.created_by <> v_leader
  )
  select m.user_id,
         count(*) filter (where t.k = 'oo')::int,
         count(*) filter (where t.k = 'cm')::int,
         count(*) filter (where t.k = 'ob')::int,
         count(*) filter (where t.k = 'pr')::int,
         count(*) filter (where t.k = 'rq')::int,
         count(*) filter (where t.k = 'ic')::int,
         (3 * count(*) filter (where t.k = 'oo') + count(*) filter (where t.k <> 'oo'))::numeric,
         (select round(avg(extract(epoch from (r.first_at - r.created_at)) / 3600)::numeric, 1) from resp r where r.uid = m.user_id and r.first_at is not null),
         (select count(*)::int from resp r where r.uid = m.user_id and r.first_at is null and r.sst = 'in_review'),
         max(t.at)
    from m left join t on t.uid = m.user_id
   group by m.user_id;
end $$;
revoke all on function public.leader_attention(uuid, int) from public, anon;
grant execute on function public.leader_attention(uuid, int) to authenticated;

-- 제안 상태 (채택 · 보류 · 완료)
create table if not exists public.advice_status (
  team_id    uuid not null references public.teams(id) on delete cascade,
  advice_key text not null,               -- '<주 시작일>:<제안 id>'
  status     text not null check (status in ('adopted', 'held', 'done')),
  note       text,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (team_id, advice_key)
);
alter table public.advice_status enable row level security;
drop policy if exists advice_status_leader on public.advice_status;
create policy advice_status_leader on public.advice_status for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

-- 팀장 셀프 체크 (주 1회, 선택) — 팀장 본인만 보고 쓴다
create table if not exists public.leader_selfcheck (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  week_start date not null,
  energy     int check (energy between 1 and 5),
  burden     int check (burden between 1 and 5),
  note       text,
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id, week_start)
);
alter table public.leader_selfcheck enable row level security;
drop policy if exists leader_selfcheck_own on public.leader_selfcheck;
create policy leader_selfcheck_own on public.leader_selfcheck for all to authenticated
  using (user_id = auth.uid() and public.is_team_leader(team_id)) with check (user_id = auth.uid() and public.is_team_leader(team_id));

-- 월요일 07:30 KST
do $$ begin perform cron.unschedule('advisor-weekly'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('advisor-weekly', '30 22 * * 0', $c$ select public._invoke_function('ai-advisor', '{"all": true}') $c$);
exception when others then null; end $$;

-- >>>>>>>>>> 20261019000015_exec_brief.sql
-- =====================================================================
-- 상향 관리 › 임원 브리핑
--   · executives: 팀장이 관리하는 상위 관리자(여럿) — 직책 · 성향 태그 · 관심사 · 보고 선호
--   · org_notes.exec_id: 위에서 온 것(코멘트·자료·요청·방침)이 어느 관리자에게서 왔는지
--   · ai_kind 'exec_brief': 상위 관리자 시선의 주간 브리핑 (팀장이 누를 때만)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'exec_brief';

create table if not exists public.executives (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null,
  title       text not null default '',          -- 직책 (예: 마케팅본부장)
  style_tags  text[] not null default '{}',      -- 성향 (예: 숫자·근거 중시, 결론 먼저)
  interests   text not null default '',          -- 요즘 관심사·자주 묻는 것
  prefs       text not null default '',          -- 보고 선호 (형식·빈도·채널)
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists executives_team_idx on public.executives (team_id, sort);
alter table public.executives enable row level security;
drop policy if exists executives_leader on public.executives;
create policy executives_leader on public.executives for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

alter table public.org_notes add column if not exists exec_id uuid references public.executives(id) on delete set null;

-- >>>>>>>>>> 20261020000016_leader_notes.sql
-- =====================================================================
-- 내 메모 — 팀장 전용 메모 (팀원에게는 보이지 않음)
--   · 저장은 한 곳, 붙이는 곳은 여러 군데: 팀원 · 목표/과제 · 임원 · 결정 · 1on1 (anchor)
--   · 관찰 메모(observations)와 다름: 평가 근거로 쓰지 않음
--   · ai_allowed: AI가 참고해도 되는 메모 (팀장이 고름) — 1on1 준비 노트 · 팀원 액션 · ATEAM의 제안 · 임원 브리핑이 읽음. 평가 초안은 읽지 않음
--   · anchor_id: 대상 id (팀원·목표·임원은 uuid, 결정 카드는 카드 키) · anchor_label: 붙일 때의 대상 이름(대상이 사라져도 보이게)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
create table if not exists public.leader_notes (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body         text not null,
  kind         text not null default 'note' check (kind in ('note', 'todo')),
  done         boolean not null default false,
  anchor_type  text not null default 'none' check (anchor_type in ('none', 'member', 'item', 'exec', 'decision', 'one_on_one')),
  anchor_id    text,
  anchor_label text not null default '',
  pinned       boolean not null default false,
  ai_allowed   boolean not null default false,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- 예전(1단계) 테이블을 이미 만든 프로젝트용
alter table public.leader_notes add column if not exists anchor_label text not null default '';
alter table public.leader_notes alter column anchor_id type text using anchor_id::text;

create index if not exists leader_notes_owner_idx on public.leader_notes (team_id, owner_id, updated_at desc);
create index if not exists leader_notes_anchor_idx on public.leader_notes (team_id, anchor_type, anchor_id);

alter table public.leader_notes enable row level security;
-- 나만: 쓴 사람만 읽고 쓴다 (같은 팀의 팀장이어도 남의 메모는 안 보임)
drop policy if exists leader_notes_owner on public.leader_notes;
create policy leader_notes_owner on public.leader_notes for all to authenticated
  using (owner_id = auth.uid() and public.is_team_member(team_id))
  with check (owner_id = auth.uid() and public.is_team_member(team_id));

-- 데모 팀: 메모 예시 몇 개 (이미 있으면 건너뜀)
do $$
declare r record; v_jung uuid; v_lee uuid; v_goal uuid; v_exec uuid;
begin
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo loop
    if exists (select 1 from leader_notes where team_id = r.team_id) then continue; end if;
    select tm.user_id into v_jung from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '정우성' limit 1;
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이동욱' limit 1;
    select id into v_goal from work_items where team_id = r.team_id and parent_id is null and title like '제휴%' limit 1;
    select id into v_exec from executives where team_id = r.team_id order by sort limit 1;
    insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, pinned, created_at, updated_at) values
      (r.team_id, r.leader_id, '분기 마감 전 팀 회고는 짧게 30분 — 잘된 것 1개, 바꿀 것 1개만', 'note', 'none', null, true, now() - interval '6 days', now() - interval '6 days'),
      (r.team_id, r.leader_id, '본부장 주간회의 전에 제휴 전망 숫자 다시 확인', 'todo', 'none', null, false, now() - interval '1 day', now() - interval '1 day');
    if v_jung is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '혼자 끙끙 앓는 편. 막히면 먼저 물어봐 주는 게 효과 있음', 'member', v_jung, '정우성', true, now() - interval '9 days', now() - interval '9 days'); end if;
    if v_lee is not null then insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, created_at, updated_at)
      values (r.team_id, r.leader_id, '다음 1on1에서 교육 예산 얘기 꺼내기', 'todo', 'member', v_lee, now() - interval '3 days', now() - interval '3 days'); end if;
    if v_goal is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, 'B사 말고 C사 제휴 가능성도 열어 두기 — 영업본부 박 팀장에게 물어보기', 'item', v_goal, true, now() - interval '2 days', now() - interval '2 days'); end if;
    if v_exec is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '숫자는 항상 지난달 대비로. 표보다 한 줄 결론을 먼저', 'exec', v_exec, true, now() - interval '5 days', now() - interval '5 days'); end if;
  end loop;
end $$;

-- >>>>>>>>>> 20261021000017_coaching.sql
-- =====================================================================
-- ATEAM의 코칭 — 팀장이 누르면 AI가 초안을 쓰고, 팀장이 고쳐서 보내는 개선 코칭
--   · 팀원에게는 'ATEAM의 코칭'으로만 보인다 (보낸 사람 칸을 두지 않음)
--   · 평가 근거로 남지 않는다 (evidence에 쓰지 않음)
--   · 한 팀원에게 7일 동안 2건까지
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'coaching';

create table if not exists public.coaching_notes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  member_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  body        text not null,
  seen_at     timestamptz,
  acked_at    timestamptz,
  helpful     boolean,
  created_at  timestamptz not null default now()
);
create index if not exists coaching_member_idx on public.coaching_notes (team_id, member_id, created_at desc);

alter table public.coaching_notes enable row level security;
drop policy if exists coaching_leader on public.coaching_notes;
create policy coaching_leader on public.coaching_notes for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
drop policy if exists coaching_member_read on public.coaching_notes;
create policy coaching_member_read on public.coaching_notes for select to authenticated
  using (member_id = auth.uid());

-- 팀원: 읽음 · 확인 · 도움됨 (자기 것만)
create or replace function public.coaching_mark(p_id uuid, p_ack boolean default false, p_helpful boolean default null)
returns void language sql security definer set search_path = public as $$
  update coaching_notes set
    seen_at = coalesce(seen_at, now()),
    acked_at = case when p_ack then coalesce(acked_at, now()) else acked_at end,
    helpful = coalesce(p_helpful, helpful)
  where id = p_id and member_id = auth.uid();
$$;
grant execute on function public.coaching_mark(uuid, boolean, boolean) to authenticated;

-- 7일 2건 제한 + 팀원 알림 ('ATEAM의 코칭'으로)
create or replace function public._coaching_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from coaching_notes where team_id = new.team_id and member_id = new.member_id and created_at > now() - interval '7 days') >= 2 then
    raise exception 'COACHING_LIMIT: 한 팀원에게는 7일 동안 2건까지 보낼 수 있습니다';
  end if;
  return new;
end $$;
drop trigger if exists t_coaching_guard on public.coaching_notes;
create trigger t_coaching_guard before insert on public.coaching_notes for each row execute function public._coaching_guard();

create or replace function public._coaching_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, team_id, kind, title, body, link)
  values (new.member_id, new.team_id, 'coaching', 'ATEAM 업무 피드백이 도착했어요', new.title, '/my/one-on-ones?coach=' || new.id);
  return new;
end $$;
drop trigger if exists t_coaching_notify on public.coaching_notes;
create trigger t_coaching_notify after insert on public.coaching_notes for each row execute function public._coaching_notify();

-- 데모: 이동욱 님에게 보낸 코칭 1건 (이미 있으면 건너뜀)
do $$
declare r record; v_lee uuid;
begin
  for r in select t.id team_id from teams t where t.is_demo loop
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이동욱' limit 1;
    if v_lee is null or exists (select 1 from coaching_notes where team_id = r.team_id) then continue; end if;
    alter table coaching_notes disable trigger t_coaching_notify;
    insert into coaching_notes (team_id, member_id, title, body, created_at) values (r.team_id, v_lee,
      'CRM 연계, 진척을 한 번 정리해 볼까요?',
      E'요즘 흐름\n''제휴 유입 고객 CRM 연계''를 혼자 맡아 진행하고 있어요. 계획보다 조금 늦어지고 있고, 최근에는 진척 공유가 뜸해요.\n\n특히 짚고 싶은 것\n· ''제휴 유입 고객 CRM 연계'' — 지금까지 한 것과 남은 것이 기록으로 잘 보이지 않아요\n\n왜 중요해요\n제휴 목표와 이어진 과제라, 진행 상황이 보여야 필요한 도움을 제때 받을 수 있어요.\n\n점검해 볼 것\n· 지금까지 한 것과 남은 것을 짧게 정리할 수 있는지\n· 막힌 부분이 있다면 무엇이 필요한지 정리돼 있는지\n\n권장 시점 · 이번 주 금요일까지',
      now() - interval '2 days');
    -- 김현정: 받은함 예시 (확인 전)
    insert into coaching_notes (team_id, member_id, title, body, created_at)
    select r.team_id, tm.user_id, '기획서, 근거를 한 번 더 받쳐 볼까요?',
      E'요즘 흐름\n''런칭 캠페인 기획'' 결과물을 꾸준히 올리고 있어요. 내용은 충실한데, 주장에 비해 근거가 좀 약하고 구조화가 덜 되어 있어요.\n\n특히 짚고 싶은 것\n· ''하반기 신제품 런칭 캠페인 기획서''의 정가 런칭 이유 부분 — 주장을 받치는 근거가 보이지 않아요\n\n왜 중요해요\n읽는 사람이 근거를 따라갈 수 있어야 내용이 그대로 설득력을 가져요.\n\n점검해 볼 것\n· 핵심 주장마다 근거(숫자 · 사례 · 출처)를 한 줄 붙일 수 있는지\n· 이 장만 읽어도 무엇을 말하려는지 보이는지\n\n권장 시점 · 다음 결과물을 올리기 전',
      now() - interval '1 day'
    from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '김현정' limit 1;
    alter table coaching_notes enable trigger t_coaching_notify;
  end loop;
end $$;

-- >>>>>>>>>> 20261022000018_request_kinds.sql
-- =====================================================================
-- 요청 종류 추가 — 팀원 상세 액션과 맞추기
--   · grow  (성장 제안)  ← [육성]      다음에 맡아 볼 역할·성장 과제를 같이 정하자는 제안
--   · cheer (격려)       ← [지원·격려]  들어 주고 돕겠다는 말. 평가 근거로 남기지 않음
--   ([업무 독려]는 기존 progress(진척 공유)를 씀)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.team_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.team_requests drop constraint %I', c);
  end loop;
end $$;
alter table public.team_requests add constraint team_requests_kind_check
  check (kind in ('plan', 'progress', 'share', 'meeting', 'other', 'grow', 'cheer', 'change'));   -- change: 22_plan_window (다시 Run 대비 미리 허용)

-- 요청 완료 → 평가 근거. 격려(cheer)는 '확인'일 뿐이라 남기지 않는다
create or replace function public.trg_request_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_late int;
begin
  if new.kind = 'cheer' then return new; end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    v_late := case when new.due_date is null then null else (coalesce(new.responded_at, now())::date - new.due_date) end;
    perform public.upsert_evidence(new.team_id, new.to_id, 'task', new.id,
      case when new.kind = 'grow' then '성장 제안 답 — ' else '요청 완료 — ' end || new.title
        || case when v_late is null then '' when v_late <= 0 then ' (기한 내)' else ' (' || v_late || '일 늦음)' end
        || case when coalesce(new.response, '') <> '' then ' · 답: ' || left(new.response, 120) else '' end,
      case when v_late is not null and v_late <= 0 then 'positive'::public.polarity else 'neutral'::public.polarity end,
      null, coalesce(new.responded_at, now()));
  end if;
  return new;
end $$;

-- 알림 문구도 종류에 맞게 (요청 / 성장 제안 / 팀장님 격려)
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case new.kind when 'grow' then '성장 제안: ' when 'cheer' then '팀장님 격려: ' else '요청: ' end || new.title, left(new.body, 120), '/');
    if new.kind = 'plan' and new.item_id is not null then
      update work_items set needs_plan = true where id = new.item_id;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case new.kind when 'grow' then '성장 제안 답: ' when 'cheer' then '격려 확인: ' else '완료: ' end || new.title, left(new.response, 120), '/');
  end if;
  return new;
end $$;

-- >>>>>>>>>> 20261023000019_work_brief.sql
-- =====================================================================
-- 업무플랫폼 Core Insight — AI가 리뷰 대기 결과물을 먼저 읽고 한 줄씩 판단 (ai-work-brief)
-- AI 결과 종류 'work_brief' 추가. 다시 Run 해도 안전합니다.
-- (결과물 1차 검토의 '질 평가 다섯 축'은 AI 결과 안에 담겨 DB 변경이 필요 없습니다)
-- =====================================================================
alter type public.ai_kind add value if not exists 'work_brief';

-- >>>>>>>>>> 20261024000020_member_app.sql
-- =====================================================================
-- 팀원 앱 정비
--   · 팀원이 받은 칭찬 배지를 다시 볼 수 있게 (자기 것 · 칭찬만 읽기)
--   · 팀원 → 팀장 '1on1 요청' (team_requests kind=meeting) — 팀장 알림이 팀원 상세로 이어지고, 팀장에게 평가 근거가 쌓이지 않게
--   · AI 체크인 초안 (ai_kind 'checkin_draft')
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'checkin_draft';

drop policy if exists obs_member_praise on public.observations;
create policy obs_member_praise on public.observations for select to authenticated
  using (subject_id = auth.uid() and kind = 'praise');

-- 알림: 요청 / 성장 제안 / 팀장님 격려 / 팀원의 1on1 요청
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_up boolean;
begin
  v_up := new.to_id = public._team_leader(new.team_id);   -- 팀원 → 팀장
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case when v_up and new.kind = 'meeting' then '1on1 요청: ' when new.kind = 'grow' then '성장 제안: ' when new.kind = 'cheer' then '팀장님 격려: ' else '요청: ' end || new.title,
      left(new.body, 120), case when v_up then '/people/' || new.from_id || '?oo=1' else '/' end);
    if new.kind = 'plan' and new.item_id is not null then
      update work_items set needs_plan = true where id = new.item_id;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case when v_up and new.kind = 'meeting' then '1on1 요청 확인: ' when new.kind = 'grow' then '성장 제안 답: ' when new.kind = 'cheer' then '격려 확인: ' else '완료: ' end || new.title,
      left(new.response, 120), case when v_up then '/my/one-on-ones' else '/' end);
  end if;
  return new;
end $$;

-- 요청 완료 → 평가 근거 (격려, 팀장이 받은 요청은 남기지 않음)
create or replace function public.trg_request_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_late int;
begin
  if new.kind = 'cheer' or new.to_id = public._team_leader(new.team_id) then return new; end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    v_late := case when new.due_date is null then null else (coalesce(new.responded_at, now())::date - new.due_date) end;
    perform public.upsert_evidence(new.team_id, new.to_id, 'task', new.id,
      case when new.kind = 'grow' then '성장 제안 답 — ' else '요청 완료 — ' end || new.title
        || case when v_late is null then '' when v_late <= 0 then ' (기한 내)' else ' (' || v_late || '일 늦음)' end
        || case when coalesce(new.response, '') <> '' then ' · 답: ' || left(new.response, 120) else '' end,
      case when v_late is not null and v_late <= 0 then 'positive'::public.polarity else 'neutral'::public.polarity end,
      null, coalesce(new.responded_at, now()));
  end if;
  return new;
end $$;

-- >>>>>>>>>> 20261025000021_consulting_cards.sql
-- =====================================================================
-- ATEAM · 0021 컨설팅 기준 카드 (기본 제공 노하우)
--   · 모든 팀에 '컨설팅 기준' 카드 21장을 기본으로 넣는다 (knowhow_cards.source = 'consulting')
--   · 팀장 카드와 똑같이 켜고 끄고, 고치고, 지울 수 있다. AI는 팀장 카드를 먼저 읽고 남는 자리에 컨설팅 기준을 싣는다
--   · 평가 시뮬레이션·팀원 액션에는 싣지 않는다 (카드에 evaluation 적용처 없음, 팀원 액션은 함수에서 제외)
--   · 지운 카드는 '내 노하우 › 컨설팅 기준 다시 받기'로 되살릴 수 있다
-- 다시 Run 해도 안전합니다.
-- =====================================================================

alter table public.knowhow_cards add column if not exists source text not null default 'team';
alter table public.knowhow_cards add column if not exists template_key text;
do $$ begin
  alter table public.knowhow_cards add constraint knowhow_cards_source_chk check (source in ('team', 'consulting'));
exception when duplicate_object then null; end $$;
create unique index if not exists knowhow_cards_team_template on public.knowhow_cards (team_id, template_key) where template_key is not null;

-- ---------- 원본 (팀마다 복사되는 기준) ----------
create table if not exists public.knowhow_templates (
  key         text primary key,
  kind        public.knowhow_kind not null,
  title       text not null,
  body        text not null default '',
  rules       jsonb not null default '[]'::jsonb,
  applies_to  text[] not null default '{}',
  keywords    text[] not null default '{}',
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.knowhow_templates enable row level security;
drop policy if exists kt_read on public.knowhow_templates;
create policy kt_read on public.knowhow_templates for select to authenticated using (true);

insert into public.knowhow_templates (key, kind, title, body, rules, applies_to, keywords, sort) values
('goal_state', 'framework', '목표는 이루려는 상태로',
 '목표는 하는 일의 목록이 아니라 이루려는 상태다. 새로 만들 것(Build), 개선할 것(Improve), 다르게 바꿀 것(Innovate) 중 무엇인지가 드러나야 한다. 늘 하던 일, 무난히 되는 수치, 작년과 같은 목표는 목표가 아니다.',
 '["목표 제목에 이루려는 상태를 쓴다", "만들기·개선·혁신 중 성격을 밝힌다", "일상 업무 나열은 목표로 올리지 않는다", "작년 목표의 반복이면 무엇이 다른지 묻는다"]',
 '{plan,strategy}', '{목표,BII,목표수립}', 1),
('goal_check', 'rubric', '목표 점검 네 가지',
 '목표를 세운 뒤 네 가지를 본다. 집중(3~5개로 추렸는가), 정렬(상위 목표·전사 방침과 이어지는가), 도전(최선을 다하면 60~70% 달성할 수준인가), 추적(달성 여부를 무엇으로 알 수 있는가).',
 '["팀 목표는 3~5개", "상위 목표와 연결을 밝힌다", "60~70% 달성 수준으로 도전적으로", "달성 판단 기준이 없으면 붙인다"]',
 '{plan,strategy}', '{목표점검,집중,정렬,도전}', 2),
('measure_outcome', 'rubric', '결과를 재는 지표',
 '달성 지표는 한 일이 아니라 일어난 결과를 잰다. "~실시, ~수행, ~관리"는 과제다. 지표 하나에는 한 가지만 담고, 하위로 갈수록 과정 지표(선행), 팀 목표에는 결과 지표(후행)를 둔다.',
 '["활동이면 과제로 내리고 결과 지표를 찾는다", "지표 하나에 한 가지 내용만", "팀 목표엔 결과, 하위엔 과정 지표", "과정 지표만으로 성과를 판단하지 않는다"]',
 '{plan}', '{KR,지표,측정}', 3),
('kpi_five', 'rubric', '좋은 지표의 다섯 조건',
 '전략과 이어지는가(전략 연계), 자의적으로 부풀릴 수 없는가(객관성), 데이터를 쉽게 얻는가(측정 용이), 담당자가 결과를 움직일 수 있는가(통제 가능), 중요한 업무를 재는가(업무 대표). 통제가 어려운 지표는 기여 정도로 바꿔 잰다.',
 '["다섯 조건 중 빠진 것을 짚는다", "통제 어려운 지표는 기여도로 바꾼다", "질·양·비용·시간 중 두 축 이상"]',
 '{plan,strategy}', '{KPI,지표품질}', 4),
('qual_measure', 'framework', '정성 성과를 재는 다섯 방법',
 '숫자로 안 나오는 성과도 잴 수 있다. 고객·사용자 만족 조사(Survey), 난이도·적시성·완결성 점수(표준화), 수준별 행동 기준(행동기준), 단계별 완료와 가중치(마일스톤), 필수 요소 유무(체크리스트). 어느 방법이든 등급별 판단 기준을 미리 정한다.',
 '["정성 목표엔 측정 방법을 고른다", "등급별 판단 기준을 함께 쓴다", "마일스톤은 단계별 가중치를 둔다"]',
 '{plan}', '{정성지표,마일스톤,측정방식}', 5),
('goal_change', 'principle', '목표 수정은 세 가지 경우에만',
 '목표는 상위 목표가 바뀌었을 때, 업무 분장이 바뀌었을 때, 중대한 새 과업이 생겼을 때 고친다. "달성이 어려워서"는 수정 이유가 아니다. 고칠 때는 이유를 남긴다.',
 '["수정 이유가 세 경우인지 확인한다", "어렵다는 이유로 목표를 낮추지 않는다", "수정할 때 사유를 기록한다"]',
 '{plan,prep,strategy}', '{목표수정,재계획}', 6),
('keep_stop', 'framework', '지속·보완·중단 회고',
 '분기마다 목표를 지속·보완·중단 중 하나로 정한다. 일찍·크게 넘었다면 목표가 쉬웠는지, 실제로 상위 목표에 기여했는지 본다. 통제할 수 없는 이유로 막혔다면 수정·중단을, 순항이면 지속을. 중단할 때는 배운 것을 남긴다.',
 '["초과 달성이면 목표 난이도를 되묻는다", "외부 요인 막힘이면 수정·중단 검토", "중단할 때 배운 점을 기록한다"]',
 '{strategy,briefing}', '{회고,분기점검}', 7),
('task_naming', 'principle', '과제 이름은 효과가 보이게',
 '과제 이름은 "(효과)를 위한 (활동)" 또는 "(활동)을 통한 (효과)"로 쓴다. "검토 철저", "관리 강화"처럼 끝을 알 수 없는 이름은 무엇이 되면 끝인지 드러나게 고친다. 할 일은 담당자가 바로 손댈 수 있는 행동 단위로.',
 '["과제명에 효과와 활동을 함께", "끝이 안 보이는 이름은 고친다", "할 일은 행동 단위로 쪼갠다"]',
 '{plan}', '{과제명,과제설계}', 8),
('depth_scale', 'rubric', '고민의 깊이 눈금',
 '1 지시된 것을 정리해 사실을 나열한다. 2 표준 기준으로 구조화한다(빠짐·겹침 없음). 3 상황에 맞게 해석해 원인과 시사점을 낸다. 4 정답이 없는 문제에서 선택지를 설계·비교하고 권고와 리스크를 밝힌다.',
 '["현상→원인→시사점→권고 중 어디까지 왔는지 본다", "빠진 단계를 보완점으로 짚는다", "대안 비교와 버린 이유가 있으면 높게 본다"]',
 '{review}', '{판단깊이,결과물품질}', 9),
('doc_check', 'rubric', '문서 유형별 점검',
 '기획서: 풀 질문·범위·일정·역할·리스크·성공 기준. 진행 보고: 결론과 요청 먼저, 계획 대비 숫자, 이슈는 원인→영향→대응. 분석: 질문과 가설, 출처·기간·표본, 비교 기준, 한계. 제안: 진단과 처방의 연결, 대안 2개 이상, 실행 계획, 기대 효과.',
 '["문서 유형에 맞는 빠진 요소를 짚는다", "수치와 인용엔 출처가 있는지 본다", "세부 데이터는 참고로 분리했는지 본다"]',
 '{review}', '{기획서,보고서,분석,제안서}', 10),
('upward_report', 'framework', '상향 보고의 순서',
 '첫 줄에 결론과 요청, 그다음 근거 숫자, 마지막에 필요한 결정과 지원. 결정이 필요하면 선택지 두 개 이상을 장단점과 함께. 한 장에 한 메시지, 세부는 참고로 뺀다.',
 '["결론과 요청을 첫 줄에", "결정 사항은 선택지 2개 이상으로", "한 장에 한 메시지"]',
 '{report}', '{보고,임원보고,상향관리}', 11),
('bad_news', 'principle', '나쁜 소식은 먼저, 대응안과 함께',
 '위에서 다른 경로로 듣기 전에 팀장이 먼저 말한다. 원인 → 영향 → 대응안 순서로, 대응안이 여럿이면 권하는 안을 밝힌다. 목표 대비 부족이 구조적이면 추세·바뀐 환경·필요한 자원을 근거로 재협의를 준비한다.',
 '["나쁜 소식은 원인→영향→대응안", "권하는 대응안을 밝힌다", "구조적 부족은 재협의 근거를 준비"]',
 '{report,briefing}', '{리스크보고,에스컬레이션}', 12),
('oo_flow', 'coaching', '1on1 대화 순서',
 '근황과 지난 이후 변화 → 잘된 것과 어려웠던 것(그 원인) → 앞으로의 우선순위와 목표 유지·수정 → 내가 도울 것. 팀장이 지키지 못한 약속이 있으면 그것부터 꺼낸다. 진척 확인은 체크인으로 보고, 1on1에서는 사람과 막힘을 본다.',
 '["밀린 팀장 약속을 첫 안건으로", "마지막 질문은 내가 도울 것", "1on1에서 진척 점검만 하지 않는다"]',
 '{prep}', '{1on1,면담}', 13),
('ask_or_tell', 'coaching', '팀원 수준에 맞춘 대화',
 '스스로 판단할 수 있는 팀원에게는 질문으로 깨닫게 하는 대화를 80%, 아직 기준이 서지 않은 팀원에게는 기대와 방법을 직접 알려 주는 대화를 80%로 한다. 질문은 무엇을·어떻게로 열고, 추궁형(언제까지, 왜 안 했나)은 쓰지 않는다.',
 '["판단 깊이 높으면 질문형으로", "판단 깊이 낮으면 방법과 예시 먼저", "추궁형 질문은 쓰지 않는다"]',
 '{prep,review}', '{코칭,질문}', 14),
('feedback_four', 'coaching', '피드백은 관찰→영향→기대→질문',
 '관찰한 행동을 사실로 말하고, 그 행동이 일이나 팀에 준 영향을 말하고, 기대하는 다음 행동을 말한 뒤, 상대의 생각을 묻는다. "항상, 늘" 같은 일반화와 성격·태도 판단은 쓰지 않는다.',
 '["사실→영향→기대→질문 순서로", "일반화·성격 판단은 쓰지 않는다", "기대는 관찰 가능한 행동으로"]',
 '{prep,review}', '{피드백,SBI}', 15),
('recognition', 'coaching', '인정은 구체적으로, 고르게',
 '인정은 구체적 행동과 그 결과를 짚어 바로 한다. 성과가 있는데 인정이 끊기면 사람은 "내가 뭘 했지"를 느낀다. 인정이 한두 사람에게 몰리지 않게 고르게 나누고, 위로 보고할 때 기여한 사람의 이름을 넣는다.',
 '["행동과 결과를 짚어 칭찬한다", "인정이 몰리지 않게 고르게", "상향 보고에 기여자 이름을 넣는다"]',
 '{prep,briefing}', '{칭찬,인정,동기}', 16),
('demotivation', 'coaching', '동기 저하 원인별 대응',
 '비판에 민감해진 사람에게는 구체적인 기준과 지침을, 소외감을 느끼는 사람에게는 핵심 업무에 참여할 기회를, 일의 의미를 잃은 사람에게는 그 일이 목표와 고객에 어떻게 이어지는지를 준다. 성장하고 싶은 사람에게는 성공 가능성 50~70% 정도의 한 단계 어려운 일을 맡긴다.',
 '["원인을 먼저 구분하고 대응한다", "도전 과제는 성공 가능성 50~70%로", "컨디션이 낮을 때는 독려보다 지원"]',
 '{prep}', '{동기부여,몰입,이탈}', 17),
('work_ecs', 'framework', '업무를 핵심·공통·지원으로 나누기',
 '업무를 중요도와 난이도로 나누면 핵심(강화·집중), 공통(표준화·매뉴얼), 지원(축소·자동화·외부)으로 갈린다. 사람이 아니라 업무 기준으로 본다. 경험 많은 사람이 지원 업무를 오래 들고 있거나, 신입이 핵심 업무에 과부하면 배분을 다시 본다.',
 '["업무를 핵심·공통·지원으로 나눈다", "지원 업무부터 줄이거나 넘긴다", "업무 가치와 담당자 수준을 맞춘다"]',
 '{strategy,scenario,briefing}', '{업무분류,재배분,업무량}', 18),
('delegation', 'principle', '위임 판단 세 가지 축',
 '팀 안에서 끝나는 일인가, 해 본 적 있는 일인가, 실행 성격의 일인가. 셋 다 맞으면 팀원이 결정하게 넘긴다. 처음 하는 일·방향을 정하는 일은 팀장이 쥐고, 돈·법·인사가 걸린 일은 한 단계 위로 올린다. 과제마다 최종 책임자는 한 명이다.',
 '["팀 내·기존·실행 업무는 팀원에게 위임", "신규·기획 업무는 팀장이 쥔다", "과제마다 최종 책임자는 한 명"]',
 '{briefing,strategy}', '{위임,권한,RACI}', 19),
('staffing', 'principle', '충원 요청 전에 먼저 볼 것',
 '충원을 말하기 전에 축소·중단, 재배분, 위임, 프로세스 개선·자동화를 먼저 검토하고 남는 부족분만 요청한다. 요청에는 지금 업무량과 필요한 인원, 늘어난 이유, 내부에서 해 본 것, 선택지(정규·한시·지원), 충원하지 않으면 생길 일을 담는다.',
 '["충원 전에 내부 해소안을 먼저", "부족분은 숫자로 보인다", "미충원 시 영향을 함께 쓴다"]',
 '{briefing,report,scenario}', '{충원,인력운영,채용}', 20),
('meeting_default', 'framework', '회의·지시의 기본값',
 '회의는 결정·공유·논의 중 목적을 정하고, 공유가 목적이면 글로 대신한다. 끝날 때 결정·담당·기한을 남긴다. 지시할 때는 목적, 결과물 모양, 기한, 판단 기준 네 가지를 함께 준다. 같은 결과물이 여러 번 다시 돌아오면 착수 때 결론과 목차를 먼저 맞춘다.',
 '["공유 목적 회의는 글로 대신한다", "회의마다 결정·담당·기한을 남긴다", "지시엔 목적·결과물·기한·기준", "재작업 반복이면 목차부터 합의"]',
 '{briefing}', '{회의,지시,운영체계}', 21)
on conflict (key) do update set kind = excluded.kind, title = excluded.title, body = excluded.body, rules = excluded.rules,
  applies_to = excluded.applies_to, keywords = excluded.keywords, sort = excluded.sort, updated_at = now();

-- ---------- 팀에 넣기 ----------
-- 없는 것만 넣는다 (팀장이 고친 카드는 덮어쓰지 않음)
create or replace function public._install_consulting_cards(p_team uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_n int;
begin
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then return 0; end if;
  insert into knowhow_cards (team_id, owner_id, kind, title, body, rules, applies_to, keywords, active, pinned, shared, provenance, source, template_key)
  select p_team, v_owner, t.kind, t.title, t.body, t.rules, t.applies_to, t.keywords, true, false, false, 'human', 'consulting', t.key
  from knowhow_templates t
  where not exists (select 1 from knowhow_cards c where c.team_id = p_team and c.template_key = t.key)
  order by t.sort;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public._install_consulting_cards(uuid) from public, anon, authenticated;

-- 팀장이 '컨설팅 기준 다시 받기'를 누를 때
create or replace function public.restore_consulting_cards(p_team uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden'; end if;
  return public._install_consulting_cards(p_team);
end $$;
grant execute on function public.restore_consulting_cards(uuid) to authenticated;

-- 새 팀이 만들어지면 자동으로
create or replace function public.trg_team_consulting_cards() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._install_consulting_cards(new.id);
  return new;
end $$;
drop trigger if exists t_team_consulting_cards on public.teams;
create trigger t_team_consulting_cards after insert on public.teams for each row execute function public.trg_team_consulting_cards();

-- 지금 있는 팀 전부
do $$ declare r record; begin
  for r in select id from public.teams loop perform public._install_consulting_cards(r.id); end loop;
end $$;

-- >>>>>>>>>> 20261026000022_plan_window.sql
-- =====================================================================
-- 팀원 목표 수정 켜기·끄기 (팀장이 켜 둘 때만 팀원이 목표·과제를 고친다 · 승인 후 반영)
--   · 목표·과제(1·2단계)  : 팀장이 '팀원 목표 수정'을 켜 둔 동안만 팀원이 만들고 고친다 → 팀장 승인 후 반영
--                           꺼져 있으면 진척·상태만 남기고, 바꿀 게 있으면 [변경 요청](kind 'change')
--                           (검토 대기·수정 요청 중인 제안도 꺼져 있으면 고치거나 거둘 수 없다)
--   · 할 일(3단계 이하)    : 내 과제 아래에서는 언제든 자유롭게 (승인·재계획 기록 없음)
--   · 켜고 끄기: teams.settings.plan_open (true/false) — 팀장이 팀목표 수정 화면의 토글로 바꾼다
--   · 팀장이 '계획 세우기' 요청을 보내면 자동으로 켜진다
--   (이전 '팀원도 자유롭게 편집'(member_free_edit) 설정은 더 이상 쓰지 않는다)
-- 다시 Run 해도 안전합니다.
-- =====================================================================

-- 항목 깊이 (최상위 = 0)
create or replace function public.item_depth(p_id uuid) returns int
language sql stable security definer set search_path = public as $$
  with recursive up(id, parent_id, d) as (
    select id, parent_id, 0 from work_items where id = p_id
    union all
    select w.id, w.parent_id, up.d + 1 from work_items w join up on w.id = up.parent_id where up.d < 20
  )
  select coalesce(max(d), 0) from up;
$$;

-- 지금 팀원 수정이 켜져 있나
create or replace function public.plan_open(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce((settings->>'plan_open')::boolean, false) from teams where id = p_team), false);
$$;
grant execute on function public.item_depth(uuid), public.plan_open(uuid) to authenticated;

-- 항목 저장 전: 권한 정리 · 진척 계산 · 기준선 · 재계획 기록
create or replace function public.trg_work_item_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_leader boolean := coalesce(auth.role(), 'service') <> 'authenticated' or public.is_team_leader(new.team_id);
  v_open boolean;
  v_parent work_items;
  v_depth int;          -- 저장 후 깊이
  v_old_depth int;
  v_plan_changed boolean := false;
  v_skip_replan boolean := false;
  v_lock text := 'PLAN_LOCKED: 지금은 팀원 목표 수정이 꺼져 있습니다. 진척·상태만 남길 수 있어요. 바꿔야 할 게 있으면 팀장님께 변경 요청을 보내 주세요';
begin
  if new.parent_id is not null then
    select * into v_parent from work_items where id = new.parent_id;
    if v_parent.team_id <> new.team_id then raise exception '다른 팀 항목 아래에 둘 수 없습니다'; end if;
    v_depth := public.item_depth(new.parent_id) + 1;
  else
    v_depth := 0;
  end if;

  if not v_leader then
    v_open := public.plan_open(new.team_id);
    if tg_op = 'INSERT' then
      if new.owner_id is distinct from auth.uid() then raise exception '팀원은 본인 담당 항목만 만들 수 있습니다'; end if;
      new.needs_plan := false;
      if v_depth >= 2 then
        -- 할 일: 내 과제 아래라면 언제든, 승인 없이
        if v_parent.owner_id is distinct from auth.uid() then raise exception '할 일은 내 과제 아래에만 만들 수 있습니다'; end if;
        if new.status in ('proposed', 'changes_requested') then new.status := 'active'; end if;
      elsif not v_open then
        raise exception '%', v_lock;
      else
        new.status := 'proposed';                         -- 목표·과제: 팀장 승인 후 진행
      end if;
    else
      v_old_depth := case when old.parent_id is null then 0 else public.item_depth(old.parent_id) + 1 end;
      if new.owner_id is distinct from old.owner_id then raise exception '담당자는 팀장만 바꿀 수 있습니다'; end if;
      if new.parent_id is distinct from old.parent_id
         and not (v_old_depth >= 2 and v_depth >= 2 and v_parent.owner_id = auth.uid()) then
        raise exception '항목 위치는 팀장만 바꿀 수 있습니다';
      end if;
      -- 진척·상태 말고 계획 자체가 바뀌었나
      v_plan_changed := (to_jsonb(new) - array['progress', 'num_current', 'status', 'done_at', 'updated_at', 'change_reason', 'needs_plan', 'sort'])
                     is distinct from (to_jsonb(old) - array['progress', 'num_current', 'status', 'done_at', 'updated_at', 'change_reason', 'needs_plan', 'sort']);
      if v_old_depth >= 2 then
        v_skip_replan := true;                            -- 할 일은 자유: 재계획 기록 안 남김
        if new.status in ('proposed', 'changes_requested') and old.status not in ('proposed', 'changes_requested') then new.status := old.status; end if;
      else
        -- 검토 중인 제안: 꺼져 있으면 상태도 못 바꾼다(거두기 포함)
        if not v_open and old.status in ('proposed', 'changes_requested') and new.status is distinct from old.status then
          raise exception '%', v_lock;
        end if;
        -- 승인은 팀장만: 제안·수정 요청 상태에서 진행 상태로 바로 못 간다
        if old.status in ('proposed', 'changes_requested') and new.status not in ('proposed', 'changes_requested', 'dropped') then
          raise exception '팀장 승인 전에는 진행 상태로 바꿀 수 없습니다';
        end if;
        if new.status = 'dropped' and old.status not in ('proposed', 'changes_requested', 'dropped') then
          raise exception '목표·과제 중단은 팀장님께 변경 요청으로 알려 주세요';
        end if;
        if v_plan_changed then
          if not v_open then raise exception '%', v_lock; end if;
          if old.status in ('active', 'blocked', 'changes_requested') then new.status := 'proposed'; end if;   -- 고친 계획은 다시 승인
        end if;
      end if;
      new.needs_plan := old.needs_plan and not exists (select 1 from work_items c where c.parent_id = new.id);
    end if;
  end if;

  -- 진척 계산
  if new.status = 'done' then
    new.done_at := coalesce(new.done_at, now());
    if new.measure in ('check', 'percent') then new.progress := 100; end if;
  elsif tg_op = 'UPDATE' and old.status = 'done' then
    new.done_at := null;
    if new.measure = 'check' then new.progress := 0; end if;
  end if;
  if new.measure = 'check' then new.progress := case when new.status = 'done' then 100 else 0 end; end if;
  if new.measure = 'number' and new.num_target is not null and new.num_target <> 0 and new.num_current is not null then
    new.progress := greatest(0, least(100, round(
      case when new.higher_is_better then 100 * new.num_current / new.num_target
           else 100 * new.num_target / nullif(new.num_current, 0) end)))::smallint;
  end if;

  -- 기준선: 처음 '진행'이 되는 순간의 계획을 보관
  if new.baselined_at is null and new.status in ('active', 'blocked', 'done') then
    new.base_start := new.start_date; new.base_due := new.due_date; new.base_target := new.num_target;
    new.baselined_at := now();
  elsif tg_op = 'UPDATE' and old.baselined_at is not null and not v_skip_replan then
    if new.due_date is distinct from old.due_date or new.start_date is distinct from old.start_date then
      new.replan_count := old.replan_count + 1;
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'replan',
              jsonb_build_object('start', old.start_date, 'due', old.due_date),
              jsonb_build_object('start', new.start_date, 'due', new.due_date), new.change_reason);
    end if;
    if new.num_target is distinct from old.num_target then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'target', to_jsonb(old.num_target), to_jsonb(new.num_target), new.change_reason);
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(),
              case when old.status in ('proposed', 'changes_requested') and new.status = 'active' then 'approved'
                   when new.status = 'changes_requested' then 'changes_requested' else 'status' end,
              to_jsonb(old.status), to_jsonb(new.status), new.change_reason);
    end if;
    if new.owner_id is distinct from old.owner_id then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'owner', to_jsonb(old.owner_id), to_jsonb(new.owner_id), new.change_reason);
    end if;
  end if;
  new.change_reason := null;
  return new;
end $$;

-- 삭제: 팀장 / 내 할 일 / 아직 승인 안 된 내 제안
drop policy if exists wi_delete on public.work_items;
create policy wi_delete on public.work_items for delete to authenticated
  using (public.is_team_leader(team_id)
         or (owner_id = auth.uid() and (public.item_depth(id) >= 2
             or (status in ('proposed', 'changes_requested') and baselined_at is null and public.plan_open(team_id)))));

-- 요청 종류: 변경 요청(change) — 팀원 → 팀장, 목표·과제를 바꿔 달라는 요청
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.team_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.team_requests drop constraint %I', c);
  end loop;
end $$;
alter table public.team_requests add constraint team_requests_kind_check
  check (kind in ('plan', 'progress', 'share', 'meeting', 'other', 'grow', 'cheer', 'change'));

-- 알림 + 계획 요청 시 팀원 목표 수정 자동으로 켜기
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_up boolean;
begin
  v_up := new.to_id = public._team_leader(new.team_id);   -- 팀원 → 팀장
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case when v_up and new.kind = 'meeting' then '1on1 요청: ' when new.kind = 'change' then '목표 변경 요청: '
           when new.kind = 'grow' then '성장 제안: ' when new.kind = 'cheer' then '팀장님 격려: ' else '요청: ' end || new.title,
      left(new.body, 120),
      case when new.kind = 'change' then '/goals/edit' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/people/' || new.from_id || '?oo=1' else '/' end);
    if new.kind = 'plan' then
      if new.item_id is not null then update work_items set needs_plan = true where id = new.item_id; end if;
      if new.from_id = public._team_leader(new.team_id) then
        update teams set settings = coalesce(settings, '{}'::jsonb) || '{"plan_open": true}'::jsonb
         where id = new.team_id and not public.plan_open(new.team_id);
      end if;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case when v_up and new.kind = 'meeting' then '1on1 요청 확인: ' when new.kind = 'change' then '변경 요청 처리: '
           when new.kind = 'grow' then '성장 제안 답: ' when new.kind = 'cheer' then '격려 확인: ' else '완료: ' end || new.title,
      left(new.response, 120),
      case when new.kind = 'change' then '/my/goals' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/my/one-on-ones' else '/' end);
  end if;
  return new;
end $$;

-- >>>>>>>>>> 20261027000023_work_groups.sql
-- =====================================================================
-- 업무플랫폼 그룹 스페이스 + 대화 첨부
--   · work_groups / work_group_members : 프로젝트·TF 단위로 멤버를 묶는다 (팀원도 만들 수 있고, 팀장은 전부 본다)
--   · submissions.group_id : 그룹에 올린 결과물 — 그룹 멤버 모두와 팀장이 보고 대화한다
--       새 버전은 그룹 멤버 누구나 올릴 수 있다(버전마다 올린 사람 표시). AI 1차 검토는 지금처럼 팀장만 본다
--   · review_comments 첨부(file_path …) : 팀장 피드백·대화에 참고 파일을 붙인다
--   · 알림: 그룹에 새 글·새 버전·대화가 오면 그룹 멤버에게
-- 다시 Run 해도 안전합니다.
-- =====================================================================

create table if not exists public.work_groups (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  item_id    uuid references public.work_items(id) on delete set null,   -- 연결 목표 (선택)
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists work_groups_team_idx on public.work_groups (team_id);

create table if not exists public.work_group_members (
  group_id uuid not null references public.work_groups(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  team_id  uuid not null references public.teams(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists work_group_members_user_idx on public.work_group_members (user_id);

alter table public.submissions add column if not exists group_id uuid references public.work_groups(id) on delete set null;
create index if not exists submissions_group_idx on public.submissions (group_id);
alter table public.review_comments add column if not exists file_path text;
alter table public.review_comments add column if not exists file_name text;
alter table public.review_comments add column if not exists mime_type text;

-- 내가 이 그룹 멤버인가
create or replace function public.in_work_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from work_group_members where group_id = p_group and user_id = auth.uid());
$$;
grant execute on function public.in_work_group(uuid) to authenticated;

-- 결과물 보기: 올린 사람 · 팀장 · (그룹 결과물이면) 그룹 멤버
create or replace function public.can_see_submission(p_submission uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from submissions s
                 where s.id = p_submission
                   and (s.author_id = auth.uid() or public.is_team_leader(s.team_id)
                        or (s.group_id is not null and public.in_work_group(s.group_id))));
$$;

drop policy if exists sub_select on public.submissions;
create policy sub_select on public.submissions for select to authenticated
  using (author_id = auth.uid() or public.is_team_leader(team_id) or (group_id is not null and public.in_work_group(group_id)));
drop policy if exists sub_insert on public.submissions;
create policy sub_insert on public.submissions for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id)
              and (group_id is null or public.in_work_group(group_id) or public.is_team_leader(team_id)));

-- 파일 올리기: 그 결과물을 볼 수 있는 사람이면 (그룹 멤버의 새 버전, 팀장의 피드백 첨부)
drop policy if exists "submissions upload" on storage.objects;
create policy "submissions upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'submissions'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
  and public.can_see_submission(((storage.foldername(name))[2])::uuid)
);

-- 그룹 권한
alter table public.work_groups enable row level security;
alter table public.work_group_members enable row level security;
drop policy if exists wg_select on public.work_groups;
create policy wg_select on public.work_groups for select to authenticated
  using (public.is_team_leader(team_id) or public.in_work_group(id) or created_by = auth.uid());
drop policy if exists wg_insert on public.work_groups;
create policy wg_insert on public.work_groups for insert to authenticated
  with check (public.is_team_member(team_id) and created_by = auth.uid());
drop policy if exists wg_update on public.work_groups;
create policy wg_update on public.work_groups for update to authenticated
  using (public.is_team_leader(team_id) or created_by = auth.uid());
drop policy if exists wg_delete on public.work_groups;
create policy wg_delete on public.work_groups for delete to authenticated
  using (public.is_team_leader(team_id) or created_by = auth.uid());

drop policy if exists wgm_select on public.work_group_members;
create policy wgm_select on public.work_group_members for select to authenticated
  using (public.is_team_leader(team_id) or public.in_work_group(group_id));
drop policy if exists wgm_write on public.work_group_members;
create policy wgm_write on public.work_group_members for all to authenticated
  using (public.is_team_leader(team_id) or exists (select 1 from work_groups g where g.id = group_id and g.created_by = auth.uid()))
  with check (
    (public.is_team_leader(team_id) or exists (select 1 from work_groups g where g.id = group_id and g.created_by = auth.uid()))
    and exists (select 1 from work_groups g where g.id = group_id and g.team_id = work_group_members.team_id)
    and exists (select 1 from team_members m where m.team_id = work_group_members.team_id and m.user_id = work_group_members.user_id and m.status = 'active'));

-- 알림: 팀장 · 올린 사람 + 그룹이면 그룹 멤버에게
create or replace function public.trg_submission_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions; v_actor uuid; v_title text; v_body text; v_kind text;
begin
  select * into v_sub from submissions where id = new.submission_id;
  if tg_table_name = 'submission_versions' then
    v_actor := new.created_by;
    v_kind := 'submission';
    v_title := case v_sub.request_type when 'share' then '공유: ' when 'feedback' then '피드백 요청: ' else '리뷰 요청: ' end || v_sub.title;
    v_body := coalesce((select full_name from profiles where id = v_actor), '');
    perform public._notify(public._team_leader(v_sub.team_id), v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    if v_actor is distinct from v_sub.author_id then
      perform public._notify(v_sub.author_id, v_sub.team_id, v_kind, '새 버전: ' || v_sub.title, v_body, '/work/' || v_sub.id);
    end if;
  else
    v_actor := new.author_id;
    v_kind := case when new.author_id <> v_sub.author_id then 'review.comment' else 'review.reply' end;
    v_title := case when new.author_id <> v_sub.author_id then '코멘트: ' else '답글: ' end || v_sub.title;
    v_body := left(new.body, 120);
    if new.author_id <> v_sub.author_id then
      perform public._notify(v_sub.author_id, v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    end if;
    if not public.is_team_leader(v_sub.team_id) or new.author_id = v_sub.author_id then
      perform public._notify(public._team_leader(v_sub.team_id), v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    end if;
  end if;
  if v_sub.group_id is not null then
    perform public._notify(m.user_id, v_sub.team_id, v_kind, '[' || g.name || '] ' || v_title, v_body, '/work/' || v_sub.id)
      from work_group_members m join work_groups g on g.id = m.group_id
     where m.group_id = v_sub.group_id and m.user_id <> v_actor and m.user_id <> v_sub.author_id
       and m.user_id <> coalesce(public._team_leader(v_sub.team_id), '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  return new;
end $$;

-- >>>>>>>>>> 20261028000024_work_space.sql
-- =====================================================================
-- 업무 스페이스 (채팅형) — 개인 스페이스(나↔팀장) · 그룹방이 같은 화면
--   · submissions.space_id : 개인 스페이스 주인(팀원). 팀장도 팀원 스페이스에 업무 카드를 올릴 수 있다
--   · space_messages       : 그냥 대화(말풍선)와 그 스레드 답글. 과제 태그 선택. 평가 근거로 남기지 않음
--   · space_reads          : 스페이스별 마지막으로 읽은 때 (안 읽음 표시)
--   · 팀장이 올린 업무 카드는 팀원의 평가 근거로 남기지 않는다
-- 18_work_groups.sql 다음에 Run. 다시 Run 해도 안전합니다.
-- =====================================================================

-- ---------- 결과물: 어느 스페이스의 글인가 ----------
alter table public.submissions add column if not exists space_id uuid references public.profiles(id) on delete set null;
create index if not exists submissions_space_idx on public.submissions (team_id, space_id);
update public.submissions set space_id = author_id where space_id is null and group_id is null;

create or replace function public.trg_submission_space() returns trigger
language plpgsql as $$
begin
  if new.space_id is null and new.group_id is null then new.space_id := new.author_id; end if;
  if new.group_id is not null then new.space_id := null; end if;
  return new;
end $$;
drop trigger if exists t_sub_space on public.submissions;
create trigger t_sub_space before insert on public.submissions for each row execute function public.trg_submission_space();

create or replace function public.can_see_submission(p_submission uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from submissions s
                 where s.id = p_submission
                   and (s.author_id = auth.uid() or s.space_id = auth.uid() or public.is_team_leader(s.team_id)
                        or (s.group_id is not null and public.in_work_group(s.group_id))));
$$;

drop policy if exists sub_select on public.submissions;
create policy sub_select on public.submissions for select to authenticated
  using (author_id = auth.uid() or space_id = auth.uid() or public.is_team_leader(team_id)
         or (group_id is not null and public.in_work_group(group_id)));
drop policy if exists sub_insert on public.submissions;
create policy sub_insert on public.submissions for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id)
              and (case when group_id is not null then public.in_work_group(group_id) or public.is_team_leader(team_id)
                        else space_id is null or space_id = auth.uid()
                             or (public.is_team_leader(team_id) and exists (select 1 from team_members m where m.team_id = submissions.team_id and m.user_id = submissions.space_id))
                   end));

-- 팀장이 올린 카드는 평가 근거·리뷰 대기에서 뺀다 (기존 동작은 그대로)
create or replace function public.trg_submission_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions; v_leader boolean;
begin
  select * into v_sub from submissions where id = new.submission_id;
  v_leader := v_sub.author_id = public._team_leader(v_sub.team_id);
  update submissions set status = (case when v_sub.request_type = 'share' or v_leader then 'shared' else 'in_review' end)::submission_status,
                         updated_at = now() where id = new.submission_id;
  perform log_event(new.team_id, 'submission.version', 'submission_versions', new.id, v_sub.author_id, 'human',
                    jsonb_build_object('version', new.version, 'title', v_sub.title, 'kind', v_sub.kind));
  if not v_leader then
    perform upsert_evidence(new.team_id, v_sub.author_id, 'submission', new.id,
      v_sub.title || ' v' || new.version || case when new.note <> '' then ' — ' || new.note else '' end,
      'neutral', null, new.created_at);
  end if;
  if v_sub.kind = 'number' and new.value is not null and v_sub.item_id is not null then
    update work_items set num_current = new.value where id = v_sub.item_id and measure = 'number';
  end if;
  return new;
end $$;

-- 결과물 알림: 팀장 · 올린 사람 · 스페이스 주인 · 그룹 멤버
create or replace function public.trg_submission_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions; v_actor uuid; v_title text; v_body text; v_kind text; v_lead uuid;
begin
  select * into v_sub from submissions where id = new.submission_id;
  v_lead := public._team_leader(v_sub.team_id);
  if tg_table_name = 'submission_versions' then
    v_actor := new.created_by; v_kind := 'submission';
    v_title := case when v_sub.author_id = v_lead then '팀장님 공유: ' when v_sub.request_type = 'share' then '공유: ' when v_sub.request_type = 'feedback' then '피드백 요청: ' else '리뷰 요청: ' end || v_sub.title;
    v_body := coalesce((select full_name from profiles where id = v_actor), '');
    perform public._notify(v_lead, v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    if v_actor is distinct from v_sub.author_id then
      perform public._notify(v_sub.author_id, v_sub.team_id, v_kind, '새 버전: ' || v_sub.title, v_body, '/work/' || v_sub.id);
    end if;
  else
    v_actor := new.author_id;
    v_kind := case when new.author_id <> v_sub.author_id then 'review.comment' else 'review.reply' end;
    v_title := case when new.author_id <> v_sub.author_id then '코멘트: ' else '답글: ' end || v_sub.title;
    v_body := left(new.body, 120);
    if new.author_id <> v_sub.author_id then
      perform public._notify(v_sub.author_id, v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    end if;
    if new.author_id is distinct from v_lead then
      perform public._notify(v_lead, v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    end if;
  end if;
  if v_sub.space_id is not null and v_sub.space_id <> v_sub.author_id and v_sub.space_id is distinct from v_actor then
    perform public._notify(v_sub.space_id, v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
  end if;
  if v_sub.group_id is not null then
    perform public._notify(m.user_id, v_sub.team_id, v_kind, '[' || g.name || '] ' || v_title, v_body, '/work/' || v_sub.id)
      from work_group_members m join work_groups g on g.id = m.group_id
     where m.group_id = v_sub.group_id and m.user_id <> v_actor and m.user_id <> v_sub.author_id
       and m.user_id <> coalesce(v_lead, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  return new;
end $$;

-- ---------- 그냥 대화 ----------
create table if not exists public.space_messages (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  space_user uuid references public.profiles(id) on delete cascade,      -- 개인 스페이스 주인 (그룹이면 null)
  group_id   uuid references public.work_groups(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  parent_id  uuid references public.space_messages(id) on delete cascade, -- 스레드 답글
  item_id    uuid references public.work_items(id) on delete set null,   -- 과제 태그 (선택)
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  check ((space_user is null) <> (group_id is null))
);
create index if not exists space_messages_space_idx on public.space_messages (team_id, space_user, created_at);
create index if not exists space_messages_group_idx on public.space_messages (group_id, created_at);
create index if not exists space_messages_parent_idx on public.space_messages (parent_id);

alter table public.space_messages enable row level security;
drop policy if exists sm_select on public.space_messages;
create policy sm_select on public.space_messages for select to authenticated
  using (public.is_team_leader(team_id) or space_user = auth.uid() or (group_id is not null and public.in_work_group(group_id)));
drop policy if exists sm_insert on public.space_messages;
create policy sm_insert on public.space_messages for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id)
              and (case when group_id is not null then public.in_work_group(group_id) or public.is_team_leader(team_id)
                        else space_user = auth.uid()
                             or (public.is_team_leader(team_id) and exists (select 1 from team_members m where m.team_id = space_messages.team_id and m.user_id = space_messages.space_user))
                   end));
drop policy if exists sm_update on public.space_messages;
create policy sm_update on public.space_messages for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists sm_delete on public.space_messages;
create policy sm_delete on public.space_messages for delete to authenticated using (author_id = auth.uid());

-- 대화 알림: 개인 스페이스는 상대에게, 그룹방 새 글은 멤버에게, 스레드 답글은 그 스레드 참여자에게
create or replace function public.trg_space_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead uuid; v_name text; v_root space_messages; v_g work_groups;
begin
  v_lead := public._team_leader(new.team_id);
  v_name := coalesce((select full_name from profiles where id = new.author_id), '');
  if new.parent_id is not null then
    select * into v_root from space_messages where id = new.parent_id;
    perform public._notify(u.uid, new.team_id, 'space.reply', '답글: ' || v_name, left(new.body, 120),
        case when new.group_id is not null then (case when u.uid = v_lead then '/work/g/' || new.group_id else '/my/submissions?g=' || new.group_id end)
             else (case when u.uid = v_lead then '/work/u/' || new.space_user else '/my/submissions' end) end)
      from (select v_root.author_id as uid union select author_id from space_messages where parent_id = new.parent_id) u
     where u.uid <> new.author_id;
  elsif new.group_id is not null then
    select * into v_g from work_groups where id = new.group_id;
    perform public._notify(m.user_id, new.team_id, 'space.message', '[' || v_g.name || '] ' || v_name, left(new.body, 120), '/my/submissions?g=' || new.group_id)
      from work_group_members m where m.group_id = new.group_id and m.user_id <> new.author_id;
  elsif new.author_id = new.space_user then
    perform public._notify(v_lead, new.team_id, 'space.message', '메시지: ' || v_name, left(new.body, 120), '/work/u/' || new.space_user);
  else
    perform public._notify(new.space_user, new.team_id, 'space.message', '팀장님 메시지', left(new.body, 120), '/my/submissions');
  end if;
  return new;
end $$;
drop trigger if exists t_space_message on public.space_messages;
create trigger t_space_message after insert on public.space_messages for each row execute function public.trg_space_message();

-- ---------- 읽음 표시 ----------
create table if not exists public.space_reads (
  user_id   uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  team_id   uuid not null references public.teams(id) on delete cascade,
  space_key text not null,              -- 'u:<팀원 id>' | 'g:<그룹 id>'
  read_at   timestamptz not null default now(),
  primary key (user_id, space_key)
);
alter table public.space_reads enable row level security;
drop policy if exists sr_all on public.space_reads;
create policy sr_all on public.space_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- >>>>>>>>>> 20261029000025_cost_guard.sql
-- =====================================================================
-- 비용 줄이기
--   · space_unread : 탭 배지(안 읽음 수)를 스페이스마다 여러 번 조회하던 것을 함수 한 번으로
--   · ai_budget    : 이번 달 AI 원가 / 상한 (예외 없이 숫자만) — 자동 1차 검토는 상한의 60%까지만 쓰고
--                    나머지는 팀장이 직접 누르는 AI(코칭·인사이트·직접 검토) 몫으로 남긴다
-- 19_work_space.sql 다음에 Run. 다시 Run 해도 안전합니다.
-- =====================================================================

create or replace function public.space_unread(p_team uuid, p_keys text[]) returns table (space_key text, n int)
language sql stable security definer set search_path = public as $$
  with k as (
    select sk, split_part(sk, ':', 1) as kind, nullif(split_part(sk, ':', 2), '')::uuid as sid from unnest(p_keys) as sk
  ), ok as (
    select k.* from k
     where (k.kind = 'u' and (k.sid = auth.uid() or public.is_team_leader(p_team)))
        or (k.kind = 'g' and (public.in_work_group(k.sid) or public.is_team_leader(p_team)))
  ), r as (
    select ok.*, coalesce((select read_at from space_reads s where s.user_id = auth.uid() and s.space_key = ok.sk), '1970-01-01'::timestamptz) as since from ok
  )
  select r.sk, (
      (select count(*) from space_messages m
        where m.team_id = p_team and ((r.kind = 'u' and m.space_user = r.sid) or (r.kind = 'g' and m.group_id = r.sid))
          and m.author_id <> auth.uid() and m.created_at > r.since)
    + (select count(*) from review_comments c join submissions s on s.id = c.submission_id
        where c.team_id = p_team and ((r.kind = 'u' and s.space_id = r.sid) or (r.kind = 'g' and s.group_id = r.sid))
          and c.author_id <> auth.uid() and c.created_at > r.since)
    + (select count(*) from submission_versions v join submissions s on s.id = v.submission_id
        where v.team_id = p_team and ((r.kind = 'u' and s.space_id = r.sid) or (r.kind = 'g' and s.group_id = r.sid))
          and v.created_by <> auth.uid() and v.created_at > r.since)
    + (select count(*) from team_requests t
        where r.kind = 'u' and t.team_id = p_team and t.to_id = r.sid and t.from_id <> auth.uid()
          and t.kind not in ('meeting', 'change') and t.created_at > r.since)
    )::int
  from r;
$$;
grant execute on function public.space_unread(uuid, text[]) to authenticated;

create index if not exists review_comments_team_created_idx on public.review_comments (team_id, created_at);
create index if not exists space_messages_created_idx on public.space_messages (team_id, created_at);

-- 이번 달 AI 원가와 상한 (Edge Function 의 service role 만)
create or replace function public.ai_budget(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_plan plans; v_bal credit_balances; v_sub subscriptions; v_cost numeric; v_cap numeric;
begin
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then return null; end if;
  v_plan := public.effective_plan_for_owner(v_owner);
  v_bal := public._ensure_credit_period(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  v_cap := case when v_sub.status = 'trialing' then least(v_plan.ai_cost_cap_usd, 4) else v_plan.ai_cost_cap_usd end;
  select coalesce(sum(cost_usd), 0) into v_cost from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'ai_error') and created_at >= v_bal.period_start;
  return jsonb_build_object('cost_usd', v_cost, 'cap_usd', v_cap);
end $$;
revoke all on function public.ai_budget(uuid) from public, anon, authenticated;

-- >>>>>>>>>> 20261030000026_plans_v3.sql
-- =====================================================================
-- 요금제 v3 — 팀원 수로 나눈 세 단계, 모두 팀 1개 (여러 팀은 계정을 따로 결제)
--   Starter 팀원 4명까지 ₩29,000 · Pro 10명까지 ₩49,000 · Pro+ 20명까지 ₩79,000 (월, VAT 별도 / 연간은 10개월 값)
--   · Free 없음 — 체험(14일, Pro+ 전체 · 원가 상한 $5 · 크레딧 30)이 끝나고 결제하지 않으면 '체험 종료'(잠금, 기록은 보관)
--   · Starter 는 평가 시뮬레이션 · 컨설팅 기준 DB(내 노하우의 기본 카드) 제외
--   · 원가 상한은 팀원을 한도까지 채운 팀도 한 달 내내 자동 1차 검토가 돌도록 (자동 검토는 상한의 75%까지)
--   · 기본 AI는 횟수로 막지 않는다 — 월 횟수 상한은 오작동 대비 안전선(보통의 10배)만, 실제 한도는 월 AI 원가 상한 + 하루·시간당 상한
--     팀장 화면에는 숫자 대신 '구독에 포함'과, 원가 상한에 가까워질 때만 안내 (credit_status.ai_usage_pct)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
insert into public.plans (id, name, price_month_krw, price_year_krw, max_members, max_teams, monthly_credits, features, sort, active)
values ('starter', 'Starter', 29000, 290000, 4, 1, 30, array[]::text[], 1, true) on conflict (id) do nothing;

update public.plans set name = 'Starter', price_month_krw = 29000, price_year_krw = 290000, max_members = 4, max_teams = 1,
  monthly_credits = 30, core_monthly_cap = 3000, ai_hourly_cap = 20, ai_daily_cap = 60, ai_cost_cap_usd = 8, sort = 1, active = true,
  features = array['checkin','one_on_one','review_room','goals','requests','knowhow','signals_basic','signals','ai_core','ai_premium','perf_map','forecast','strategy','simulation','insight','care_radar'] where id = 'starter';
update public.plans set name = 'Pro', price_month_krw = 49000, price_year_krw = 490000, max_members = 10, max_teams = 1,
  monthly_credits = 100, core_monthly_cap = 4000, ai_hourly_cap = 30, ai_daily_cap = 80, ai_cost_cap_usd = 14, sort = 2, active = true,
  features = array['checkin','one_on_one','review_room','goals','requests','knowhow','signals_basic','signals','ai_core','ai_premium','perf_map','forecast','strategy','simulation','insight','care_radar','evaluation','consulting_knowhow','history'] where id = 'pro';
update public.plans set name = 'Pro+', price_month_krw = 79000, price_year_krw = 790000, max_members = 20, max_teams = 1,
  monthly_credits = 200, core_monthly_cap = 6000, ai_hourly_cap = 45, ai_daily_cap = 120, ai_cost_cap_usd = 28, sort = 3, active = true,
  features = array['checkin','one_on_one','review_room','goals','requests','knowhow','signals_basic','signals','ai_core','ai_premium','perf_map','forecast','strategy','simulation','insight','care_radar','evaluation','consulting_knowhow','history'] where id = 'pro_plus';
-- 'free' 행은 '체험 종료' 상태로만 쓴다 (요금제 목록에 안 보임 · 모든 기능 잠금 · 초대 불가)
update public.plans set name = '체험 종료', price_month_krw = 0, price_year_krw = 0, max_members = 0, max_teams = 1,
  monthly_credits = 0, core_monthly_cap = 0, ai_hourly_cap = 0, ai_daily_cap = 0, ai_cost_cap_usd = 0, sort = 9, active = false,
  features = array[]::text[] where id = 'free';

-- 진행 중인 체험은 Pro+ 로 (체험은 가장 큰 요금제 전체)
update public.subscriptions set plan_id = 'pro_plus' where status = 'trialing' and plan_id in ('pro', 'free');

-- 이번 달 AI 원가 상한 — 체험은 5달러
create or replace function public.ai_cost_cap(p_owner uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when s.status = 'trialing' then least((public.effective_plan_for_owner(p_owner)).ai_cost_cap_usd, 5)
              else (public.effective_plan_for_owner(p_owner)).ai_cost_cap_usd end
    from (select (select status from subscriptions where owner_id = p_owner) as status) s;
$$;
revoke all on function public.ai_cost_cap(uuid) from public, anon, authenticated;

create or replace function public.ai_guard(p_team uuid, p_kind text, p_ref uuid default null,
  p_period date default null, p_subject uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_plan plans; v_bal credit_balances; v_sub subscriptions;
  v_hour int; v_day int; v_cost numeric; v_cap numeric; v_same int;
begin
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then raise exception 'TEAM_NOT_FOUND' using errcode = 'P0001'; end if;
  v_plan := public.effective_plan_for_owner(v_owner);
  v_bal := public._ensure_credit_period(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '24 hours')
    into v_hour, v_day
    from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'usage', 'ai_error') and created_at > now() - interval '24 hours';
  if v_hour >= v_plan.ai_hourly_cap then
    raise exception 'AI_RATE_HOUR' using errcode = 'P0001', hint = v_plan.ai_hourly_cap::text;
  end if;
  if v_day >= v_plan.ai_daily_cap then
    raise exception 'AI_RATE_DAY' using errcode = 'P0001', hint = v_plan.ai_daily_cap::text;
  end if;

  -- 월 원가 상한 (체험 중이면 5달러 ≈ 7,250원)
  v_cap := public.ai_cost_cap(v_owner);
  select coalesce(sum(cost_usd), 0) into v_cost from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'ai_error') and created_at >= v_bal.period_start;
  if v_cost >= v_cap then
    raise exception 'AI_COST_CAP' using errcode = 'P0001';
  end if;

  -- 같은 대상 다시 만들기: 24시간에 3번까지
  if p_ref is not null or p_period is not null then
    select count(*) into v_same from ai_outputs
     where team_id = p_team and kind::text = p_kind
       and ref_id is not distinct from p_ref and period_start is not distinct from p_period
       and subject_user_id is not distinct from p_subject
       and created_at > now() - interval '24 hours';
    if v_same >= 3 then raise exception 'AI_REPEAT' using errcode = 'P0001'; end if;
  end if;

  return jsonb_build_object('hour', v_hour, 'day', v_day, 'cost_usd', v_cost, 'cost_cap_usd', v_cap);
end $$;
revoke all on function public.ai_guard(uuid, text, uuid, date, uuid) from public, anon, authenticated;

create or replace function public.ai_budget(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_plan plans; v_bal credit_balances; v_sub subscriptions; v_cost numeric; v_cap numeric;
begin
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then return null; end if;
  v_plan := public.effective_plan_for_owner(v_owner);
  v_bal := public._ensure_credit_period(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  v_cap := public.ai_cost_cap(v_owner);
  select coalesce(sum(cost_usd), 0) into v_cost from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'ai_error') and created_at >= v_bal.period_start;
  return jsonb_build_object('cost_usd', v_cost, 'cap_usd', v_cap);
end $$;
revoke all on function public.ai_budget(uuid) from public, anon, authenticated;

-- 새 팀: 체험은 14일, Pro+ 전체
create or replace function public.create_team(p_name text, p_mission text default '', p_job_title text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_plan plans; v_owned int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from subscriptions where owner_id = auth.uid()) then
    insert into subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (auth.uid(), 'pro_plus', 'trialing', now() + interval '14 days', now(), now() + interval '14 days');
  end if;
  v_plan := public.effective_plan_for_owner(auth.uid());
  select count(*) into v_owned from teams where owner_id = auth.uid() and not is_demo;
  if v_owned >= v_plan.max_teams then
    raise exception 'PLAN_LIMIT_TEAMS' using errcode = 'P0001', hint = v_plan.max_teams::text;
  end if;
  insert into teams (name, mission, owner_id, settings) values (p_name, coalesce(p_mission, ''), auth.uid(),
    jsonb_build_object('level_names', '["목표","과제","할 일"]'::jsonb, 'member_free_edit', false)) returning id into v_team;
  insert into team_members (team_id, user_id, role, job_title) values (v_team, auth.uid(), 'leader', coalesce(p_job_title, ''));
  perform log_event(v_team, 'team.created', 'teams', v_team);
  return v_team;
end $$;


-- 요금제 정보에 '체험 종료' 여부
create or replace function public.credit_status(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_bal credit_balances; v_plan plans; v_sub subscriptions; v_core int;
begin
  if not public.is_team_member(p_team) and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select owner_id into v_owner from teams where id = p_team;
  v_bal := public._ensure_credit_period(v_owner);
  v_plan := public.effective_plan_for_owner(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  select count(*) into v_core from credit_ledger where owner_id = v_owner and reason = 'core_usage' and created_at >= v_bal.period_start;
  return jsonb_build_object(
    'plan_id', v_plan.id, 'plan_name', v_plan.name, 'features', to_jsonb(v_plan.features),
    'max_members', v_plan.max_members, 'monthly_credits', v_plan.monthly_credits,
    'monthly_remaining', v_bal.monthly_remaining, 'topup_remaining', v_bal.topup_remaining,
    'core_used', v_core, 'core_cap', v_plan.core_monthly_cap,
    'ai_usage_pct', case when public.ai_cost_cap(v_owner) > 0 then round(100 * (select coalesce(sum(cost_usd), 0) from credit_ledger
       where owner_id = v_owner and reason in ('core_usage', 'ai_error') and created_at >= v_bal.period_start) / public.ai_cost_cap(v_owner)) else 0 end,
    'period_start', v_bal.period_start, 'period_end', v_bal.period_start + interval '1 month',
    'status', case when v_plan.id = 'free' then 'expired' else coalesce(v_sub.status::text, 'expired') end,
    'expired', v_plan.id = 'free',
    'was_trial', v_sub.status = 'trialing' or v_sub.status is null,
    'trial_ends_at', v_sub.trial_ends_at,
    'trial_expired', v_sub.status = 'trialing' and v_sub.trial_ends_at < now(),
    'is_owner', v_owner = auth.uid());
end $$;

-- ---------- 컨설팅 기준 DB 는 Pro 부터 ----------
--   요금제에 consulting_knowhow 가 없으면 컨설팅 기준 카드를 끈다(AI가 읽지 않음). 끄기 전 상태는 locked_active 에 두었다가
--   Pro 이상으로 바뀌면 그대로 되돌린다. 팀장이 고친 카드 내용은 그대로 남는다.
alter table public.knowhow_cards add column if not exists source text not null default 'team';  -- 16_consulting_knowhow 와 같음 (먼저 안 돌렸어도 되게)
alter table public.knowhow_cards add column if not exists locked_active boolean;

-- 잠긴 동안에는 컨설팅 카드를 켤 수 없다 (켜려 하면 '되돌릴 때 켜기'로만 기억)
create or replace function public.trg_consulting_card_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'consulting' and new.active and not public.team_has_feature(new.team_id, 'consulting_knowhow') then
    new.locked_active := true;
    new.active := false;
  end if;
  return new;
end $$;
drop trigger if exists t_consulting_card_lock on public.knowhow_cards;
create trigger t_consulting_card_lock before insert or update on public.knowhow_cards for each row execute function public.trg_consulting_card_lock();

create or replace function public._sync_consulting_lock(p_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from teams where owner_id = p_owner loop
    if public.team_has_feature(r.id, 'consulting_knowhow') then
      update knowhow_cards set active = locked_active, locked_active = null where team_id = r.id and source = 'consulting' and locked_active is not null;
    else
      update knowhow_cards set locked_active = active, active = false where team_id = r.id and source = 'consulting' and locked_active is null;
    end if;
  end loop;
end $$;
revoke all on function public._sync_consulting_lock(uuid) from public, anon, authenticated;

-- 요금제가 바뀔 때마다 (가입 · 변경 · 체험 시작)
create or replace function public.trg_sub_consulting_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._sync_consulting_lock(new.owner_id);
  return new;
end $$;
drop trigger if exists t_sub_consulting_lock on public.subscriptions;
create trigger t_sub_consulting_lock after insert or update of plan_id, status on public.subscriptions
  for each row execute function public.trg_sub_consulting_lock();

-- '컨설팅 기준 다시 받기'는 Pro 부터
create or replace function public.restore_consulting_cards(p_team uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden'; end if;
  if not public.team_has_feature(p_team, 'consulting_knowhow') then raise exception 'PLAN_FEATURE' using errcode = 'P0001'; end if;
  return public._install_consulting_cards(p_team);
end $$;
grant execute on function public.restore_consulting_cards(uuid) to authenticated;

-- 지금 있는 팀장 전부 맞추기
do $$ declare r record; begin
  for r in select distinct owner_id from public.teams loop perform public._sync_consulting_lock(r.owner_id); end loop;
end $$;


-- >>>>>>>>>> 20261031000027_checkin.sql
-- =====================================================================
-- 성과 체크인 — 업무플랫폼에서 목표에 성과를 점찍고, 팀장이 승인하면 팀목표의 공식 값이 된다
--   · submissions.kind = 'checkin' (업무 카드와 같은 흐름: 스레드 · 보완/승인 · 알림 · 성과 근거)
--   · submission_versions.checkin = {type: number|percent|stage|done|note, value, stage, note, prev, evidence[], progress}
--   · 승인되면 그 항목의 현재값 · 진척률 · 단계 · 완료를 바꾼다 → 상위 목표는 기존 계산대로 따라 오른다
--   · 목표·과제(깊이 0~1)의 성과 값은 팀원이 직접 못 바꾼다 (할 일 · 하위 평균 · 막힘 표시는 그대로)
--   · 정성 목표: 측정 방식 'stage'(단계 이름 3~5개 중 어디까지 왔나) + 어떤 목표든 '성과 기록'(note) 체크인
--   · 숫자 공유를 올리면 바로 목표 값이 바뀌던 동작은 없앤다 (승인 후 반영)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.item_measure add value if not exists 'stage';
alter table public.work_items add column if not exists stages text[] not null default '{}';
alter table public.work_items add column if not exists stage_current smallint;
alter table public.submission_versions add column if not exists checkin jsonb;
-- 23_goal_metrics 와 같은 칸 (어느 쪽을 먼저·다시 돌려도 트리거가 같도록)
alter table public.work_items add column if not exists role text;
do $$ begin
  alter table public.work_items add constraint work_items_role_chk check (role in ('goal', 'metric', 'task'));
exception when duplicate_object then null; end $$;

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.submissions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%document%' loop
    execute format('alter table public.submissions drop constraint %I', c);
  end loop;
end $$;
alter table public.submissions add constraint submissions_kind_check check (kind in ('document', 'link', 'image', 'number', 'note', 'checkin'));

-- 항목 저장 전: 단계 진척 계산 + 팀원의 성과 값 직접 수정 막기
create or replace function public.trg_work_item_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_leader boolean := coalesce(auth.role(), 'service') <> 'authenticated' or public.is_team_leader(new.team_id);
  v_open boolean;
  v_parent work_items;
  v_depth int;          -- 저장 후 깊이
  v_old_depth int;
  v_plan_changed boolean := false;
  v_skip_replan boolean := false;
  v_lock text := 'PLAN_LOCKED: 지금은 팀원 목표 수정이 꺼져 있습니다. 진척·상태만 남길 수 있어요. 바꿔야 할 게 있으면 팀장님께 변경 요청을 보내 주세요';
begin
  if new.parent_id is not null then
    select * into v_parent from work_items where id = new.parent_id;
    if v_parent.team_id <> new.team_id then raise exception '다른 팀 항목 아래에 둘 수 없습니다'; end if;
    v_depth := public.item_depth(new.parent_id) + 1;
  else
    v_depth := 0;
  end if;

  -- 역할: 최상위는 목표, 그 아래는 지표(결과를 재는 항목) 또는 과제, 그 아래는 할 일(과제)
  if v_depth = 0 then new.role := 'goal';
  elsif v_depth >= 2 then new.role := 'task';
  elsif new.role is null or new.role = 'goal' then
    new.role := case when new.measure::text in ('number', 'stage') or new.metric_id is not null then 'metric' else 'task' end;
  end if;

  if not v_leader then
    v_open := public.plan_open(new.team_id);
    if tg_op = 'INSERT' then
      if new.owner_id is distinct from auth.uid() then raise exception '팀원은 본인 담당 항목만 만들 수 있습니다'; end if;
      new.needs_plan := false;
      if v_depth >= 2 then
        -- 할 일: 내 과제 아래라면 언제든, 승인 없이
        if v_parent.owner_id is distinct from auth.uid() then raise exception '할 일은 내 과제 아래에만 만들 수 있습니다'; end if;
        if new.status in ('proposed', 'changes_requested') then new.status := 'active'; end if;
      elsif not v_open then
        raise exception '%', v_lock;
      else
        new.status := 'proposed';                         -- 목표·과제: 팀장 승인 후 진행
      end if;
    else
      v_old_depth := case when old.parent_id is null then 0 else public.item_depth(old.parent_id) + 1 end;
      if new.owner_id is distinct from old.owner_id then raise exception '담당자는 팀장만 바꿀 수 있습니다'; end if;
      if new.parent_id is distinct from old.parent_id
         and not (v_old_depth >= 2 and v_depth >= 2 and v_parent.owner_id = auth.uid()) then
        raise exception '항목 위치는 팀장만 바꿀 수 있습니다';
      end if;
      -- 진척·상태 말고 계획 자체가 바뀌었나
      v_plan_changed := (to_jsonb(new) - array['progress', 'num_current', 'stage_current', 'status', 'done_at', 'updated_at', 'change_reason', 'needs_plan', 'sort'])
                     is distinct from (to_jsonb(old) - array['progress', 'num_current', 'stage_current', 'status', 'done_at', 'updated_at', 'change_reason', 'needs_plan', 'sort']);
      -- 목표·과제의 성과 값(숫자·진척률·단계)은 팀장이 승인한 체크인으로만 바뀐다 (하위 항목 평균은 자동 계산이라 예외)
      -- 지표와 숫자를 건 목표의 값만 체크인으로 (과제 진척은 자유)
      if (new.role = 'metric' or (v_old_depth = 0 and new.measure::text in ('number', 'percent', 'stage')))
         and (new.num_current is distinct from old.num_current or new.stage_current is distinct from old.stage_current
              or (new.progress is distinct from old.progress and new.measure::text = 'percent')) then
        raise exception 'CHECKIN_ONLY: 지표 값은 체크인으로 남겨 주세요. 팀장님이 승인하면 반영됩니다';
      end if;
      if v_old_depth >= 2 then
        v_skip_replan := true;                            -- 할 일은 자유: 재계획 기록 안 남김
        if new.status in ('proposed', 'changes_requested') and old.status not in ('proposed', 'changes_requested') then new.status := old.status; end if;
      else
        -- 검토 중인 제안: 꺼져 있으면 상태도 못 바꾼다(거두기 포함)
        if not v_open and old.status in ('proposed', 'changes_requested') and new.status is distinct from old.status then
          raise exception '%', v_lock;
        end if;
        -- 승인은 팀장만: 제안·수정 요청 상태에서 진행 상태로 바로 못 간다
        if old.status in ('proposed', 'changes_requested') and new.status not in ('proposed', 'changes_requested', 'dropped') then
          raise exception '팀장 승인 전에는 진행 상태로 바꿀 수 없습니다';
        end if;
        if new.status = 'dropped' and old.status not in ('proposed', 'changes_requested', 'dropped') then
          raise exception '목표·과제 중단은 팀장님께 변경 요청으로 알려 주세요';
        end if;
        if v_plan_changed then
          if not v_open then raise exception '%', v_lock; end if;
          if old.status in ('active', 'blocked', 'changes_requested') then new.status := 'proposed'; end if;   -- 고친 계획은 다시 승인
        end if;
      end if;
      new.needs_plan := old.needs_plan and not exists (select 1 from work_items c where c.parent_id = new.id);
    end if;
  end if;

  -- 진척 계산
  if new.status = 'done' then
    new.done_at := coalesce(new.done_at, now());
    if new.measure in ('check', 'percent') then new.progress := 100; end if;
  elsif tg_op = 'UPDATE' and old.status = 'done' then
    new.done_at := null;
    if new.measure = 'check' then new.progress := 0; end if;
  end if;
  if new.measure = 'check' then new.progress := case when new.status = 'done' then 100 else 0 end; end if;
  if new.measure::text = 'stage' then
    new.progress := case when coalesce(array_length(new.stages, 1), 0) = 0 then 0
                         else greatest(0, least(100, round(100.0 * coalesce(new.stage_current, 0) / array_length(new.stages, 1))))::smallint end;
  end if;
  if new.measure = 'number' and new.num_target is not null and new.num_target <> 0 and new.num_current is not null then
    new.progress := greatest(0, least(100, round(
      case when new.higher_is_better then 100 * new.num_current / new.num_target
           else 100 * new.num_target / nullif(new.num_current, 0) end)))::smallint;
  end if;

  -- 기준선: 처음 '진행'이 되는 순간의 계획을 보관
  if new.baselined_at is null and new.status in ('active', 'blocked', 'done') then
    new.base_start := new.start_date; new.base_due := new.due_date; new.base_target := new.num_target;
    new.baselined_at := now();
  elsif tg_op = 'UPDATE' and old.baselined_at is not null and not v_skip_replan then
    if new.due_date is distinct from old.due_date or new.start_date is distinct from old.start_date then
      new.replan_count := old.replan_count + 1;
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'replan',
              jsonb_build_object('start', old.start_date, 'due', old.due_date),
              jsonb_build_object('start', new.start_date, 'due', new.due_date), new.change_reason);
    end if;
    if new.num_target is distinct from old.num_target then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'target', to_jsonb(old.num_target), to_jsonb(new.num_target), new.change_reason);
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(),
              case when old.status in ('proposed', 'changes_requested') and new.status = 'active' then 'approved'
                   when new.status = 'changes_requested' then 'changes_requested' else 'status' end,
              to_jsonb(old.status), to_jsonb(new.status), new.change_reason);
    end if;
    if new.owner_id is distinct from old.owner_id then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'owner', to_jsonb(old.owner_id), to_jsonb(new.owner_id), new.change_reason);
    end if;
  end if;
  new.change_reason := null;
  return new;
end $$;



create or replace function public.trg_submission_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions; v_leader boolean;
begin
  select * into v_sub from submissions where id = new.submission_id;
  v_leader := v_sub.author_id = public._team_leader(v_sub.team_id);
  update submissions set status = (case when v_sub.request_type = 'share' or v_leader then 'shared' else 'in_review' end)::submission_status,
                         updated_at = now() where id = new.submission_id;
  perform log_event(new.team_id, 'submission.version', 'submission_versions', new.id, v_sub.author_id, 'human',
                    jsonb_build_object('version', new.version, 'title', v_sub.title, 'kind', v_sub.kind));
  if not v_leader then
    perform upsert_evidence(new.team_id, v_sub.author_id, 'submission', new.id,
      v_sub.title || ' v' || new.version || case when new.note <> '' then ' — ' || new.note else '' end,
      'neutral', null, new.created_at);
  end if;
  -- 숫자는 더 이상 올리는 즉시 반영하지 않는다 — 목표 값은 승인된 체크인으로만 (20261031000027_checkin)
  return new;
end $$;


-- 승인되면 목표에 반영
create or replace function public.trg_checkin_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_c jsonb; v_item work_items; v_t text;
begin
  if new.kind <> 'checkin' or new.item_id is null or new.status <> 'approved' or old.status = 'approved' then return new; end if;
  select checkin into v_c from submission_versions where submission_id = new.id order by version desc limit 1;
  select * into v_item from work_items where id = new.item_id;
  if v_c is null or v_item.id is null then return new; end if;
  if v_item.metric_id is not null then return new; end if;   -- 실적 데이터와 연결된 지표: 값은 실적이 정한다 (체크인은 성과 기록으로만)
  v_t := v_c->>'type';
  if v_t = 'number' and v_c ? 'value' then
    update work_items set num_current = (v_c->>'value')::numeric where id = v_item.id;
  elsif v_t = 'percent' and v_c ? 'value' then
    update work_items set progress = greatest(0, least(100, (v_c->>'value')::numeric))::smallint where id = v_item.id;
  elsif v_t = 'stage' and v_c ? 'stage' then
    update work_items set stage_current = (v_c->>'stage')::smallint where id = v_item.id;
  elsif v_t = 'done' then
    update work_items set status = 'done' where id = v_item.id and status <> 'done';
  elsif v_t = 'note' and v_c ? 'progress' and v_item.measure::text = 'percent' then
    update work_items set progress = greatest(0, least(100, (v_c->>'progress')::numeric))::smallint where id = v_item.id;
  end if;
  return new;
end $$;
drop trigger if exists t_checkin_apply on public.submissions;
create trigger t_checkin_apply after update of status on public.submissions for each row execute function public.trg_checkin_apply();

-- 팀장: 성과 기록(정성) 체크인을 승인하면서 진척률도 함께 정할 때
create or replace function public.approve_checkin(p_sub uuid, p_progress int default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sub submissions; v_ver uuid;
begin
  select * into v_sub from submissions where id = p_sub;
  if v_sub.id is null or v_sub.kind <> 'checkin' then raise exception 'NOT_CHECKIN' using errcode = 'P0001'; end if;
  if not public.is_team_leader(v_sub.team_id) then raise exception 'forbidden'; end if;
  if p_progress is not null then
    select id into v_ver from submission_versions where submission_id = p_sub order by version desc limit 1;
    update submission_versions set checkin = coalesce(checkin, '{}'::jsonb) || jsonb_build_object('progress', greatest(0, least(100, p_progress))) where id = v_ver;
  end if;
  update submissions set status = 'approved', updated_at = now() where id = p_sub;
end $$;
grant execute on function public.approve_checkin(uuid, int) to authenticated;

create index if not exists submissions_checkin_item_idx on public.submissions (item_id, created_at) where kind = 'checkin';

-- >>>>>>>>>> 20261101000028_goal_metrics.sql
-- =====================================================================
-- 목표 = 지표 + 과제 — KPI · OKR 을 고르지 않고 하나의 구조로
--   · work_items.role: goal(최상위) · metric(지표: 결과를 재는 항목) · task(과제 · 할 일)
--   · 목표 진척: 지표가 있으면 지표 평균만 (과제 완료는 넣지 않는다). 지표가 없으면 예전처럼 하위 평균.
--     목표에 숫자를 직접 걸면(KPI형) 그 숫자가 진척.
--   · 지표 · 숫자를 건 목표의 값은 승인된 체크인(또는 연결된 실적)으로만 바뀐다. 과제 진척은 담당자가 자유롭게.
--   · 실적 데이터와 연결된 지표는 체크인이 승인돼도 값을 바꾸지 않는다 (성과 기록으로만 남음)
--   · 기존 항목: 최상위 → goal, 둘째 단계 중 숫자·단계로 재거나 실적과 연결된 것 → metric, 나머지 → task
-- 22_checkin 다음에 Run. 다시 Run 해도 안전합니다.
-- =====================================================================
alter table public.work_items add column if not exists role text;
do $$ begin
  alter table public.work_items add constraint work_items_role_chk check (role in ('goal', 'metric', 'task'));
exception when duplicate_object then null; end $$;

-- 항목 저장 전: 역할 · 단계 진척 · 지표 값은 체크인으로만
create or replace function public.trg_work_item_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_leader boolean := coalesce(auth.role(), 'service') <> 'authenticated' or public.is_team_leader(new.team_id);
  v_open boolean;
  v_parent work_items;
  v_depth int;          -- 저장 후 깊이
  v_old_depth int;
  v_plan_changed boolean := false;
  v_skip_replan boolean := false;
  v_lock text := 'PLAN_LOCKED: 지금은 팀원 목표 수정이 꺼져 있습니다. 진척·상태만 남길 수 있어요. 바꿔야 할 게 있으면 팀장님께 변경 요청을 보내 주세요';
begin
  if new.parent_id is not null then
    select * into v_parent from work_items where id = new.parent_id;
    if v_parent.team_id <> new.team_id then raise exception '다른 팀 항목 아래에 둘 수 없습니다'; end if;
    v_depth := public.item_depth(new.parent_id) + 1;
  else
    v_depth := 0;
  end if;

  -- 역할: 최상위는 목표, 그 아래는 지표(결과를 재는 항목) 또는 과제, 그 아래는 할 일(과제)
  if v_depth = 0 then new.role := 'goal';
  elsif v_depth >= 2 then new.role := 'task';
  elsif new.role is null or new.role = 'goal' then
    new.role := case when new.measure::text in ('number', 'stage') or new.metric_id is not null then 'metric' else 'task' end;
  end if;

  if not v_leader then
    v_open := public.plan_open(new.team_id);
    if tg_op = 'INSERT' then
      if new.owner_id is distinct from auth.uid() then raise exception '팀원은 본인 담당 항목만 만들 수 있습니다'; end if;
      new.needs_plan := false;
      if v_depth >= 2 then
        -- 할 일: 내 과제 아래라면 언제든, 승인 없이
        if v_parent.owner_id is distinct from auth.uid() then raise exception '할 일은 내 과제 아래에만 만들 수 있습니다'; end if;
        if new.status in ('proposed', 'changes_requested') then new.status := 'active'; end if;
      elsif not v_open then
        raise exception '%', v_lock;
      else
        new.status := 'proposed';                         -- 목표·과제: 팀장 승인 후 진행
      end if;
    else
      v_old_depth := case when old.parent_id is null then 0 else public.item_depth(old.parent_id) + 1 end;
      if new.owner_id is distinct from old.owner_id then raise exception '담당자는 팀장만 바꿀 수 있습니다'; end if;
      if new.parent_id is distinct from old.parent_id
         and not (v_old_depth >= 2 and v_depth >= 2 and v_parent.owner_id = auth.uid()) then
        raise exception '항목 위치는 팀장만 바꿀 수 있습니다';
      end if;
      -- 진척·상태 말고 계획 자체가 바뀌었나
      v_plan_changed := (to_jsonb(new) - array['progress', 'num_current', 'stage_current', 'status', 'done_at', 'updated_at', 'change_reason', 'needs_plan', 'sort'])
                     is distinct from (to_jsonb(old) - array['progress', 'num_current', 'stage_current', 'status', 'done_at', 'updated_at', 'change_reason', 'needs_plan', 'sort']);
      -- 목표·과제의 성과 값(숫자·진척률·단계)은 팀장이 승인한 체크인으로만 바뀐다 (하위 항목 평균은 자동 계산이라 예외)
      -- 지표와 숫자를 건 목표의 값만 체크인으로 (과제 진척은 자유)
      if (new.role = 'metric' or (v_old_depth = 0 and new.measure::text in ('number', 'percent', 'stage')))
         and (new.num_current is distinct from old.num_current or new.stage_current is distinct from old.stage_current
              or (new.progress is distinct from old.progress and new.measure::text = 'percent')) then
        raise exception 'CHECKIN_ONLY: 지표 값은 체크인으로 남겨 주세요. 팀장님이 승인하면 반영됩니다';
      end if;
      if v_old_depth >= 2 then
        v_skip_replan := true;                            -- 할 일은 자유: 재계획 기록 안 남김
        if new.status in ('proposed', 'changes_requested') and old.status not in ('proposed', 'changes_requested') then new.status := old.status; end if;
      else
        -- 검토 중인 제안: 꺼져 있으면 상태도 못 바꾼다(거두기 포함)
        if not v_open and old.status in ('proposed', 'changes_requested') and new.status is distinct from old.status then
          raise exception '%', v_lock;
        end if;
        -- 승인은 팀장만: 제안·수정 요청 상태에서 진행 상태로 바로 못 간다
        if old.status in ('proposed', 'changes_requested') and new.status not in ('proposed', 'changes_requested', 'dropped') then
          raise exception '팀장 승인 전에는 진행 상태로 바꿀 수 없습니다';
        end if;
        if new.status = 'dropped' and old.status not in ('proposed', 'changes_requested', 'dropped') then
          raise exception '목표·과제 중단은 팀장님께 변경 요청으로 알려 주세요';
        end if;
        if v_plan_changed then
          if not v_open then raise exception '%', v_lock; end if;
          if old.status in ('active', 'blocked', 'changes_requested') then new.status := 'proposed'; end if;   -- 고친 계획은 다시 승인
        end if;
      end if;
      new.needs_plan := old.needs_plan and not exists (select 1 from work_items c where c.parent_id = new.id);
    end if;
  end if;

  -- 진척 계산
  if new.status = 'done' then
    new.done_at := coalesce(new.done_at, now());
    if new.measure in ('check', 'percent') then new.progress := 100; end if;
  elsif tg_op = 'UPDATE' and old.status = 'done' then
    new.done_at := null;
    if new.measure = 'check' then new.progress := 0; end if;
  end if;
  if new.measure = 'check' then new.progress := case when new.status = 'done' then 100 else 0 end; end if;
  if new.measure::text = 'stage' then
    new.progress := case when coalesce(array_length(new.stages, 1), 0) = 0 then 0
                         else greatest(0, least(100, round(100.0 * coalesce(new.stage_current, 0) / array_length(new.stages, 1))))::smallint end;
  end if;
  if new.measure = 'number' and new.num_target is not null and new.num_target <> 0 and new.num_current is not null then
    new.progress := greatest(0, least(100, round(
      case when new.higher_is_better then 100 * new.num_current / new.num_target
           else 100 * new.num_target / nullif(new.num_current, 0) end)))::smallint;
  end if;

  -- 기준선: 처음 '진행'이 되는 순간의 계획을 보관
  if new.baselined_at is null and new.status in ('active', 'blocked', 'done') then
    new.base_start := new.start_date; new.base_due := new.due_date; new.base_target := new.num_target;
    new.baselined_at := now();
  elsif tg_op = 'UPDATE' and old.baselined_at is not null and not v_skip_replan then
    if new.due_date is distinct from old.due_date or new.start_date is distinct from old.start_date then
      new.replan_count := old.replan_count + 1;
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'replan',
              jsonb_build_object('start', old.start_date, 'due', old.due_date),
              jsonb_build_object('start', new.start_date, 'due', new.due_date), new.change_reason);
    end if;
    if new.num_target is distinct from old.num_target then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'target', to_jsonb(old.num_target), to_jsonb(new.num_target), new.change_reason);
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(),
              case when old.status in ('proposed', 'changes_requested') and new.status = 'active' then 'approved'
                   when new.status = 'changes_requested' then 'changes_requested' else 'status' end,
              to_jsonb(old.status), to_jsonb(new.status), new.change_reason);
    end if;
    if new.owner_id is distinct from old.owner_id then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'owner', to_jsonb(old.owner_id), to_jsonb(new.owner_id), new.change_reason);
    end if;
  end if;
  new.change_reason := null;
  return new;
end $$;



-- 기존 항목 분류 (트리거가 깊이를 보고 정한다)
update public.work_items w set role = case
    when w.parent_id is null then 'goal'
    when public.item_depth(w.id) >= 2 then 'task'
    when w.measure::text in ('number', 'stage') or w.metric_id is not null then 'metric'
    else 'task' end
  where w.role is null;

-- 상위 진척: 지표가 있으면 지표 평균만
create or replace function public._rollup_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_p smallint; v_has_metric boolean;
begin
  select exists (select 1 from work_items c where c.parent_id = p_id and c.role = 'metric' and c.status not in ('dropped', 'proposed', 'changes_requested'))
    into v_has_metric;
  select coalesce(round(avg(case when c.status = 'done' then 100 else c.progress end)), 0)::smallint into v_p
    from work_items c where c.parent_id = p_id and c.status not in ('dropped', 'proposed', 'changes_requested')
      and (not v_has_metric or c.role = 'metric');
  update work_items set progress = v_p where id = p_id and measure = 'children' and progress <> v_p;
end $$;

-- 지금 목표들 다시 계산
do $$ declare r record; begin
  for r in select id from public.work_items where parent_id is null and measure = 'children' loop perform public._rollup_item(r.id); end loop;
end $$;

-- 체크인 승인 반영: 실적 연결 지표는 값을 바꾸지 않음
create or replace function public.trg_checkin_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_c jsonb; v_item work_items; v_t text;
begin
  if new.kind <> 'checkin' or new.item_id is null or new.status <> 'approved' or old.status = 'approved' then return new; end if;
  select checkin into v_c from submission_versions where submission_id = new.id order by version desc limit 1;
  select * into v_item from work_items where id = new.item_id;
  if v_c is null or v_item.id is null then return new; end if;
  if v_item.metric_id is not null then return new; end if;   -- 실적 데이터와 연결된 지표: 값은 실적이 정한다 (체크인은 성과 기록으로만)
  v_t := v_c->>'type';
  if v_t = 'number' and v_c ? 'value' then
    update work_items set num_current = (v_c->>'value')::numeric where id = v_item.id;
  elsif v_t = 'percent' and v_c ? 'value' then
    update work_items set progress = greatest(0, least(100, (v_c->>'value')::numeric))::smallint where id = v_item.id;
  elsif v_t = 'stage' and v_c ? 'stage' then
    update work_items set stage_current = (v_c->>'stage')::smallint where id = v_item.id;
  elsif v_t = 'done' then
    update work_items set status = 'done' where id = v_item.id and status <> 'done';
  elsif v_t = 'note' and v_c ? 'progress' and v_item.measure::text = 'percent' then
    update work_items set progress = greatest(0, least(100, (v_c->>'progress')::numeric))::smallint where id = v_item.id;
  end if;
  return new;
end $$;


-- >>>>>>>>>> 20261102000029_condition.sql
-- =====================================================================
-- 컨디션 공유 + 팀장님과 알림 + 1on1 이름 통일 (예전 '주간 체크인'을 사람의 상태만 남기도록 바꿈)
--   · checkins 에 moods(영향 요인 키 여러 개) · note(메모, 선택) 추가
--     키: rested · energized · good_news · tired · unwell · heavy · personal · need_rest
--   · did · blocked · next(업무 칸)는 지난 기록 보존용으로만 남긴다. 새로 쓰지 않는다.
--   · 컨디션은 평가 근거가 아니다 → 근거 원장(evidence)에 더는 쌓지 않는다. 변경 이력(events)만.
-- 23_goal_metrics 다음에 Run. 다시 Run 해도 안전합니다.
-- =====================================================================
alter table public.checkins add column if not exists moods text[] not null default '{}';
alter table public.checkins add column if not exists note  text   not null default '';

create or replace function public.trg_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_event(new.team_id, case when tg_op = 'INSERT' then 'checkin.created' else 'checkin.updated' end,
                    'checkins', new.id, new.user_id, 'human',
                    jsonb_build_object('week_start', new.week_start, 'condition', new.condition, 'moods', new.moods));
  return new;
end $$;

-- 이미 근거 원장에 들어간 예전 체크인은 평가 근거에서 뺀다 (원본 기록은 checkins 에 그대로 남음)
delete from public.evidence where source = 'checkin';

-- ---------------------------------------------------------------------
-- 팀원 '팀장님과' 개편에 맞춘 알림
--   · 칭찬 배지: 팀원에게 알림 (예전엔 알림이 없어 찾아 들어와야만 보였다)
--   · ATEAM 코칭: 알림 링크를 팀장님과로 (예전 '/?coach=' 는 앱에서 넘겨 준다)
-- ---------------------------------------------------------------------
create or replace function public._praise_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'praise' and new.subject_id is not null and new.subject_id <> new.author_id then
    perform public._notify(new.subject_id, new.team_id, 'praise', '팀장님이 칭찬을 보냈습니다',
      left(regexp_replace(new.body, '^\[칭찬 배지\]\s*', ''), 120), '/my/one-on-ones?praise=' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists t_praise_notify on public.observations;
create trigger t_praise_notify after insert on public.observations for each row execute function public._praise_notify();

do $$ begin
  if to_regclass('public.coaching_notes') is not null then
    create or replace function public._coaching_notify() returns trigger
    language plpgsql security definer set search_path = public as $f$
    begin
      insert into notifications (user_id, team_id, kind, title, body, link)
      values (new.member_id, new.team_id, 'coaching', 'ATEAM의 코칭이 도착했습니다', new.title, '/my/one-on-ones?coach=' || new.id);
      return new;
    end $f$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 이름 통일: 1:1 → 1on1 (알림 문구 · 근거 원장 문구 · 기본 제공 노하우)
-- ---------------------------------------------------------------------
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_up boolean;
begin
  v_up := new.to_id = public._team_leader(new.team_id);   -- 팀원 → 팀장
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case when v_up and new.kind = 'meeting' then '1on1 요청: ' when new.kind = 'change' then '목표 변경 요청: '
           when new.kind = 'grow' then '성장 제안: ' when new.kind = 'cheer' then '팀장님 격려: ' else '요청: ' end || new.title,
      left(new.body, 120),
      case when new.kind = 'change' then '/goals/edit' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/people/' || new.from_id || '?oo=1' else '/' end);
    if new.kind = 'plan' then
      if new.item_id is not null then update work_items set needs_plan = true where id = new.item_id; end if;
      if new.from_id = public._team_leader(new.team_id) then
        update teams set settings = coalesce(settings, '{}'::jsonb) || '{"plan_open": true}'::jsonb
         where id = new.team_id and not public.plan_open(new.team_id);
      end if;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case when v_up and new.kind = 'meeting' then '1on1 요청 확인: ' when new.kind = 'change' then '변경 요청 처리: '
           when new.kind = 'grow' then '성장 제안 답: ' when new.kind = 'cheer' then '격려 확인: ' else '완료: ' end || new.title,
      left(new.response, 120),
      case when new.kind = 'change' then '/my/goals' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/my/one-on-ones' else '/' end);
  end if;
  return new;
end $$;

create or replace function public.trg_one_on_one() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := coalesce(new.completed_at, now());
    perform log_event(new.team_id, 'one_on_one.done', 'one_on_ones', new.id, new.member_id);
    perform upsert_evidence(new.team_id, new.member_id, 'one_on_one', new.id,
      '1on1 — ' || left(new.shared_notes, 300), 'neutral', null, new.scheduled_at);
  end if;
  return new;
end $$;

update public.evidence set summary = replace(summary, '1:1 — ', '1on1 — ') where source = 'one_on_one' and summary like '1:1 — %';
do $$ begin
  if to_regclass('public.knowhow_templates') is not null then
    update public.knowhow_templates set title = replace(title, '1:1', '1on1'), body = replace(body, '1:1', '1on1'),
      rules = replace(rules::text, '1:1', '1on1')::jsonb, keywords = array_replace(keywords, '1:1', '1on1')
    where title like '%1:1%' or body like '%1:1%' or rules::text like '%1:1%' or '1:1' = any(keywords);
    update public.knowhow_cards set title = replace(title, '1:1', '1on1'), body = replace(body, '1:1', '1on1'),
      rules = replace(rules::text, '1:1', '1on1')::jsonb
    where source = 'consulting' and (title like '%1:1%' or body like '%1:1%' or rules::text like '%1:1%');
  end if;
end $$;

-- >>>>>>>>>> 20261103000030_oo_entries.sql
-- =====================================================================
-- 1on1 함께 보는 노트 → 글 쌓기
--   · 한 칸을 같이 고치면 마지막 저장이 앞사람 글을 지웠다. 이제는 각자 한 줄씩 남긴다 (작성자 · 시간)
--   · 내 글만 고치고 지운다. 예전 노트는 '이전 노트' 한 줄로 옮겨 그대로 둔다
--   · one_on_ones.shared_notes 는 이 글들을 이어 붙인 읽기용 사본으로 남긴다
--     (AI 1on1 준비 · 주간 보고 · 근거 원장이 그대로 읽는다 — 앱은 더 이상 직접 쓰지 않음)
-- 24_condition 다음에 Run. 다시 Run 해도 안전합니다 (기존 노트는 한 번만 옮겨짐).
-- =====================================================================
create table if not exists public.one_on_one_entries (
  id             uuid primary key default gen_random_uuid(),
  one_on_one_id  uuid not null references public.one_on_ones(id) on delete cascade,
  team_id        uuid not null references public.teams(id) on delete cascade,
  author_id      uuid references public.profiles(id) on delete set null,
  body           text not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  legacy         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists one_on_one_entries_oo_idx on public.one_on_one_entries (one_on_one_id, created_at);
alter table public.one_on_one_entries enable row level security;

-- 읽기: 그 팀의 팀장 · 그 1on1의 팀원
drop policy if exists ooe_select on public.one_on_one_entries;
create policy ooe_select on public.one_on_one_entries for select to authenticated
  using (public.is_team_leader(team_id) or exists (select 1 from public.one_on_ones o where o.id = one_on_one_id and o.member_id = auth.uid()));
-- 쓰기: 본인 이름으로, 그 1on1의 당사자만
drop policy if exists ooe_insert on public.one_on_one_entries;
create policy ooe_insert on public.one_on_one_entries for insert to authenticated
  with check (author_id = auth.uid() and legacy = false and exists (
    select 1 from public.one_on_ones o where o.id = one_on_one_id and o.team_id = team_id
      and (o.member_id = auth.uid() or o.leader_id = auth.uid() or public.is_team_leader(o.team_id))));
-- 고치기 · 지우기: 내 글만
drop policy if exists ooe_update on public.one_on_one_entries;
create policy ooe_update on public.one_on_one_entries for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists ooe_delete on public.one_on_one_entries;
create policy ooe_delete on public.one_on_one_entries for delete to authenticated
  using (author_id = auth.uid());

create or replace function public._ooe_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.one_on_one_id <> old.one_on_one_id or new.team_id <> old.team_id or new.author_id is distinct from old.author_id then
    raise exception 'ENTRY_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists t_ooe_touch on public.one_on_one_entries;
create trigger t_ooe_touch before update on public.one_on_one_entries for each row execute function public._ooe_touch();

-- 글이 바뀌면 읽기용 사본(shared_notes)과 근거 원장을 다시 만든다
create or replace function public._ooe_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_oo uuid := coalesce(new.one_on_one_id, old.one_on_one_id); v text; r public.one_on_ones;
begin
  select coalesce(string_agg(case when e.legacy then e.body else '[' || coalesce(p.full_name, '') || '] ' || e.body end, E'\n' order by e.created_at), '')
    into v from public.one_on_one_entries e left join public.profiles p on p.id = e.author_id where e.one_on_one_id = v_oo;
  update public.one_on_ones set shared_notes = v where id = v_oo and shared_notes is distinct from v returning * into r;
  if r.id is not null and r.status = 'done' then
    perform public.upsert_evidence(r.team_id, r.member_id, 'one_on_one', r.id, '1on1 — ' || left(v, 300), 'neutral', null, r.scheduled_at);
  end if;
  return null;
end $$;
drop trigger if exists t_ooe_sync on public.one_on_one_entries;
create trigger t_ooe_sync after insert or update or delete on public.one_on_one_entries for each row execute function public._ooe_sync();

-- 노트를 들고 만들어진 1on1(데모 · 예전 방식)은 그 노트를 '이전 노트' 한 줄로
create or replace function public._oo_legacy_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if btrim(coalesce(new.shared_notes, '')) <> '' and not exists (select 1 from public.one_on_one_entries where one_on_one_id = new.id) then
    insert into public.one_on_one_entries (one_on_one_id, team_id, author_id, body, legacy, created_at)
    values (new.id, new.team_id, new.leader_id, left(new.shared_notes, 2000), true, coalesce(new.completed_at, new.scheduled_at, now()));
  end if;
  return null;
end $$;
drop trigger if exists t_oo_legacy_entry on public.one_on_ones;
create trigger t_oo_legacy_entry after insert on public.one_on_ones for each row execute function public._oo_legacy_entry();

-- 기존 노트 옮기기 (다시 Run 해도 한 번만)
insert into public.one_on_one_entries (one_on_one_id, team_id, author_id, body, legacy, created_at)
select o.id, o.team_id, o.leader_id, left(o.shared_notes, 2000), true, coalesce(o.completed_at, o.scheduled_at, o.created_at)
from public.one_on_ones o
where btrim(coalesce(o.shared_notes, '')) <> '' and not exists (select 1 from public.one_on_one_entries e where e.one_on_one_id = o.id);

-- >>>>>>>>>> 20261104000031_perf_input_name.sql
-- =====================================================================
-- 이름 바꾸기: 성과 체크인 → 성과입력 (화면 이름만 — 코드·DB 이름 checkin 은 그대로)
--   · 이미 올라간 성과입력 카드의 제목 머리말 '체크인 · ' → '성과입력 · '
--   · 알림에 남은 같은 머리말도 함께
-- 다시 Run 해도 안전합니다.
-- =====================================================================
update public.submissions set title = regexp_replace(title, '^체크인 · ', '성과입력 · ')
 where kind = 'checkin' and title like '체크인 · %';
update public.notifications set title = replace(title, '체크인 · ', '성과입력 · '), body = replace(body, '체크인 · ', '성과입력 · ')
 where title like '%체크인 · %' or body like '%체크인 · %';

-- >>>>>>>>>> 20261105000032_realtime.sql
-- 27_realtime.sql — 업무 스페이스 실시간 반영
--   상대가 쓴 대화 · 요청 상태 변화 · 업무 카드 변화를 화면에 바로 띄운다.
--   (Supabase Realtime 'supabase_realtime' 발행 목록에 테이블을 추가. 읽기 권한은 기존 RLS 그대로 적용됨)
--   여러 번 실행해도 안전합니다.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['space_messages', 'team_requests', 'submissions'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- >>>>>>>>>> 20261106000033_realtime_ai.sql
-- 28_realtime_ai.sql — AI 1차 분석 완료를 팀장 화면에 바로 반영
--   업무 카드 위 'AI 분석 ●' 표시와 오른쪽 AI 분석 패널이 분석이 끝나는 순간 바뀐다.
--   (supabase_realtime 발행 목록에 ai_outputs 추가. 읽기 권한은 기존 RLS 그대로 — 검토 결과는 팀장만 받음)
--   여러 번 실행해도 안전합니다.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if to_regclass('public.ai_outputs') is not null and not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_outputs'
  ) then
    alter publication supabase_realtime add table public.ai_outputs;
  end if;
end $$;

-- >>>>>>>>>> 20261107000034_playbook.sql
-- =====================================================================
-- ATEAM · 0034 ATEAM 플레이북 (컨설팅 기준 카드 확장 · 2026.11)
--   · 기본 제공 카드를 78장(8개 영역)으로 늘린다: 현장 컨설팅 기준 22 + 글로벌 방법론 56
--     영역: 로지컬 씽킹 · 보고서·문서 · 상사·고객 커뮤니케이션 · 창의적 사고·기획 · 의사결정·실행 · 목표·성과관리 · 코칭·피드백 · 팀 운영
--   · 카드 원본(knowhow_templates)에 화면용 정보를 더한다: 영역 · 대표 여부 · 언제 쓰나 · 왜 효과적인가 · 나쁜 예/좋은 예 · 출처
--   · 팀장이 고치지 않은 기존 카드는 새 문안으로 바꾸고, 고친 카드는 그대로 둔다 (켜기/끄기·반영할 곳·공개 설정도 그대로)
--   · 모든 팀에 새 카드를 넣는다. Starter 팀은 기존 규칙대로 꺼진 채로 들어간다 (Pro부터 AI가 사용)
--   · 데모 팀에는 적용 이력과 AI 검토 기록을 함께 채운다 (seed_demo_playbook)
--   · 내부 이름(source = 'consulting', 기능 consulting_knowhow)은 그대로 둔다 — 화면 이름만 'ATEAM 플레이북'
-- 16_consulting_knowhow.sql 을 실행한 프로젝트에서 Run. 다시 Run 해도 안전합니다.
-- 원본: supabase/playbook/playbook.json → node scripts/build-playbook.mjs
-- =====================================================================

do $$ begin
  if to_regclass('public.knowhow_templates') is null then
    raise exception '먼저 16_consulting_knowhow.sql 을 실행해 주세요 (knowhow_templates 가 없습니다)';
  end if;
end $$;

-- ---------- 원본에 화면용 정보 ----------
alter table public.knowhow_templates add column if not exists domain text not null default 'goal';
alter table public.knowhow_templates add column if not exists tier smallint not null default 2;          -- 1 = 대표 방법론 (AI가 먼저 고려)
alter table public.knowhow_templates add column if not exists situation text not null default '';      -- 언제 쓰나
alter table public.knowhow_templates add column if not exists why text not null default '';            -- 왜 효과적인가
alter table public.knowhow_templates add column if not exists example_bad text not null default '';
alter table public.knowhow_templates add column if not exists example_good text not null default '';
alter table public.knowhow_templates add column if not exists origin text not null default '';         -- 출처·참고
alter table public.knowhow_templates add column if not exists origin_type text not null default 'field'; -- field = 현장 컨설팅 · global = 글로벌 방법론

-- ---------- 새 원본 ----------
drop table if exists pg_temp._pb;
create temp table _pb (
  key text primary key, domain text, kind public.knowhow_kind, tier smallint, title text, body text, rules jsonb,
  applies_to text[], keywords text[], sort int, situation text, why text, example_bad text, example_good text, origin text, origin_type text
);
insert into _pb values
  ('problem_question', 'logic', 'framework'::public.knowhow_kind, 1, '문제를 질문 한 문장으로', '일을 시작하기 전에 풀어야 할 문제를 대상·기한·수준이 담긴 질문 한 문장으로 쓴다. ''매출 개선 방안''이 아니라 ''3분기 안에 신규 고객 매출을 10% 늘리려면 무엇을 바꿔야 하는가''처럼. 질문이 흐리면 분석도 흐려진다.', '["결과물 앞에 풀려는 질문이 있는가 본다","질문에 대상·기한·수준이 있는가 본다","주제명만 있으면 질문으로 바꿔 보게 한다"]'::jsonb, array['review', 'plan', 'strategy']::text[], array['문제정의', '핵심 질문', '기획', '착수', '목적', '과제 정의', '방안']::text[], 101, '일을 받은 첫날, 착수 전', '같은 시간을 써도 질문이 구체적일수록 필요한 분석만 하게 된다. 컨설팅 프로젝트가 첫 주에 ''핵심 질문''부터 합의하는 이유다.', '고객 이탈 현황 분석', '올해 안에 3개월 내 이탈률을 15%에서 10%로 낮추려면 어느 구간부터 손대야 하나?', 'McKinsey 문제 해결 7단계 · 『Bulletproof Problem Solving』', 'global'),
  ('mece', 'logic', 'principle'::public.knowhow_kind, 2, '빠짐없이, 겹치지 않게 (MECE)', '원인이나 대안을 나눌 때 서로 겹치지 않고 합치면 전체가 되게 나눈다. 고객별·채널별·단계별처럼 기준 하나로 자르고, 기준이 섞이면 같은 것을 두 번 세거나 큰 덩어리를 놓친다. ''기타''가 커지면 기준이 잘못된 것이다.', '["분류마다 기준이 하나인가 본다","항목끼리 겹치면 짚는다","빠진 축이 있으면 무엇인지 묻는다","''기타''가 크면 기준을 다시 보게 한다"]'::jsonb, array['review', 'plan', 'strategy']::text[], array['MECE', '분류', '구조화', '누락', '중복', '원인', '항목']::text[], 102, '원인·대안·항목을 나눌 때', '나누는 기준이 섞이면 같은 원인을 두 번 세거나 큰 원인을 통째로 놓친다. 모든 구조화의 기본 단위다.', '원인: 가격, 경쟁 심화, 20대 이탈, 마케팅 부족 (기준이 섞임)', '원인을 유입 감소 · 전환 하락 · 재구매 하락 세 단계로 나눠 각각 숫자로 확인', 'McKinsey · Barbara Minto 『The Pyramid Principle』', 'global'),
  ('issue_tree', 'logic', 'framework'::public.knowhow_kind, 2, '이슈 트리로 쪼갠다', '큰 질문을 하위 질문으로 나무처럼 쪼개, 맨 아래가 바로 확인하거나 실행할 수 있는 크기가 될 때까지 내려간다. 숫자 목표는 ''매출 = 고객 수 × 객단가 × 구매 빈도''처럼 수식으로 쪼개면(드라이버 트리) 어디를 움직일지 보인다.', '["큰 질문이 하위 질문으로 나뉘었는가 본다","맨 아래가 실행 가능한 크기인가 본다","숫자 목표는 수식으로 쪼개 보게 한다"]'::jsonb, array['plan', 'review', 'strategy']::text[], array['이슈트리', '로직트리', '드라이버', '분해', '과제 도출', 'KPI 트리', '매출']::text[], 103, '큰 문제를 과제로 나눌 때', '쪼개야 일을 나눠 맡길 수 있고, 어느 가지가 가장 큰 효과를 내는지 비교할 수 있다.', '''매출 늘리기'' 과제 하나에 할 일 15개를 나열', '매출을 신규·기존 고객으로 나누고, 신규를 유입 × 전환으로 다시 나눠 전환 개선을 1순위로', 'McKinsey 이슈 트리 · 드라이버 트리', 'global'),
  ('hypothesis', 'logic', 'principle'::public.knowhow_kind, 1, '가설부터 세우고 검증한다', '자료를 다 모은 뒤 결론을 내지 말고, 첫날 ''아마 답은 이것''이라는 가설을 세운 뒤 그 가설이 맞는지 판정할 자료만 모은다. 가설마다 ''무엇을 보면 맞다고 할지''를 함께 적고, 틀리면 빨리 버리고 바꾼다.', '["분석에 가설이 먼저 있는가 본다","가설마다 검증 방법이 짝지어 있는가 본다","자료 나열만 있으면 가설을 묻는다"]'::jsonb, array['review', 'plan', 'strategy']::text[], array['가설', '검증', '분석', '조사', '리서치', '데이터', 'FGI']::text[], 104, '분석·조사를 시작할 때', '가설 없이 모은 자료는 끝없이 늘어나고 결론으로 모이지 않는다. 가설이 조사 범위를 줄여 속도를 만든다.', '시장 자료를 최대한 모아 보고 방향을 정하겠습니다', '가설: 이탈은 첫 구매 후 30일 안에 다시 오지 않아서다 → 가입 월별 재방문 데이터로 확인', 'McKinsey ''Day One Answer'' · 가설 주도 문제 해결', 'global'),
  ('so_what', 'logic', 'rubric'::public.knowhow_kind, 1, '그래서? 왜 그런데? (So What / Why So)', '사실을 쓴 뒤에는 ''그래서 무엇을 뜻하는가(So What)''를 한 번 더 써서 시사점까지 간다. 결론을 쓴 뒤에는 ''왜 그렇게 말할 수 있나(Why So)''에 근거로 답한다. 두 질문을 모두 통과한 문장만 남긴다.', '["사실 나열 뒤에 시사점이 있는가 본다","결론마다 근거가 받쳐 주는가 본다","시사점이 없으면 ''그래서?''를 묻는다"]'::jsonb, array['review', 'report']::text[], array['시사점', '인사이트', '결론', '근거', '분석', '현황']::text[], 105, '분석 결과를 정리할 때', '사실만 있으면 읽는 사람이 해석을 대신해야 하고, 결론만 있으면 믿을 근거가 없다. 위아래 논리를 함께 잠근다.', '20대 매출 비중이 작년 32%에서 24%로 줄었다. (끝)', '…24%로 줄었다. 그래서 20대 신규 유입 예산부터 다시 봐야 한다.', 'Barbara Minto 『The Pyramid Principle』 · McKinsey', 'global'),
  ('root_cause', 'logic', 'framework'::public.knowhow_kind, 2, '원인은 다섯 번 묻는다', '눈에 보이는 현상에서 멈추지 말고 ''왜?''를 거듭 물어 손댈 수 있는 원인까지 내려간다. 사람 탓에서 멈추면 원인이 아니다. 그 사람이 그렇게 할 수밖에 없던 구조(절차·정보·도구)를 찾는다. 현상·원인·대책은 따로 쓴다.', '["현상과 원인을 나눠 썼는가 본다","사람 탓에서 멈추면 구조를 묻는다","대책이 원인과 짝지어 있는가 본다"]'::jsonb, array['review', 'report', 'briefing']::text[], array['원인', '5Why', '근본 원인', '재발 방지', '이슈', '장애', '지연', '병목', '개선', '프로세스', '리드타임', '원인 분석']::text[], 106, '문제·사고·지연이 생겼을 때', '현상에 대책을 붙이면 같은 문제가 다른 모양으로 돌아온다. 구조를 고쳐야 재발이 멈춘다.', '담당자 실수로 발송 오류 → 재교육 실시', '발송 전 검수 단계가 없음 → 발송 체크리스트와 2인 확인 도입', 'Toyota 생산방식 ''5 Whys''(오노 다이이치)', 'global'),
  ('pareto', 'logic', 'principle'::public.knowhow_kind, 2, '큰 20%에 집중한다 (80/20)', '결과의 대부분은 소수의 원인에서 나온다. 원인·고객·과제를 영향이 큰 순서로 줄 세워 상위 몇 개에 시간과 자원을 몰고, 나머지는 의도적으로 미룬다. 모두를 조금씩 하면 아무것도 바뀌지 않는다.', '["영향이 큰 순서로 줄 세웠는가 본다","상위 항목에 자원이 몰려 있는가 본다","모든 항목을 같은 무게로 다루면 짚는다"]'::jsonb, array['review', 'strategy', 'briefing', 'plan']::text[], array['파레토', '80/20', '우선순위', '집중', '선택과 집중', '과제 수']::text[], 107, '할 일·원인이 많을 때', '팀의 시간은 한정돼 있다. 효과가 큰 소수를 먼저 고르는 것이 가장 싼 성과 개선이다.', '개선 과제 12개를 동시에 착수', '불량의 78%를 만드는 상위 3개 공정부터 개선, 나머지는 다음 분기', '파레토 법칙 · Joseph Juran ''vital few''', 'global'),
  ('fact_opinion', 'logic', 'rubric'::public.knowhow_kind, 2, '사실·해석·의견을 나눈다', '확인된 사실(데이터·관찰), 그 사실에 대한 해석, 내 의견·제안을 문장 단위로 나눈다. ''고객 불만이 많다''는 해석이고, 사실은 ''지난달 VOC 142건 중 배송 관련 61건''이다. 추정은 추정이라고 밝히고 가정을 함께 쓴다.', '["사실과 의견이 섞인 문장을 짚는다","추정치에는 가정이 있는가 본다","형용사 대신 숫자·사례가 있는가 본다"]'::jsonb, array['review', 'report', 'prep']::text[], array['사실', '의견', '해석', '근거', '객관', '추정', '가정', 'VOC']::text[], 108, '보고·회의록·관찰 메모를 쓸 때', '섞어 쓰면 읽는 사람이 어디까지 믿을지 판단하지 못하고, 논의가 사실 확인 대신 감정 싸움이 된다.', '신규 채널 반응이 매우 좋습니다', '신규 채널 클릭률 3.1%(기존 1.8%). 초기 2주 데이터라 추세 확인이 더 필요합니다', '비판적 사고(Critical Thinking) · 사실 기반 보고', 'global'),
  ('number_sense', 'logic', 'rubric'::public.knowhow_kind, 2, '숫자는 비교해야 의미가 생긴다', '숫자 하나로는 판단할 수 없다. 목표 대비, 지난 기간 대비, 업계·경쟁 대비 중 하나 이상과 비교하고, 비율과 절대값을 함께 본다. 출처·기준 시점·표본 크기를 밝히고, 평균만 보지 말고 분포(상위·하위)를 확인한다.', '["숫자마다 비교 기준이 있는가 본다","출처·기준 시점·표본을 밝혔는가 본다","비율만 있으면 절대값도 묻는다"]'::jsonb, array['review', 'report']::text[], array['숫자', '데이터', '지표', '출처', '비교', '통계', '수치', '점유율', '전환율']::text[], 109, '숫자가 들어간 모든 문서', '''매출 12억''은 좋은지 나쁜지 알 수 없다. 비교 기준이 붙어야 숫자가 메시지가 된다.', '이번 달 신규 가입 4,200명', '신규 가입 4,200명 — 목표 대비 84%, 전월 대비 +12% (사내 CRM, 10/31 기준)', '데이터 리터러시 · 컨설팅 보고 표준', 'global'),
  ('depth_scale', 'logic', 'rubric'::public.knowhow_kind, 2, '고민의 깊이 눈금', '1 지시된 것을 정리해 사실을 나열한다. 2 표준 기준으로 구조화한다(빠짐·겹침 없음). 3 상황에 맞게 해석해 원인과 시사점을 낸다. 4 정답이 없는 문제에서 선택지를 설계·비교하고 권고와 리스크를 밝힌다.', '["현상→원인→시사점→권고 중 어디까지 왔는지 본다","빠진 단계를 보완점으로 짚는다","대안 비교와 버린 이유가 있으면 높게 본다"]'::jsonb, array['review']::text[], array['판단깊이', '결과물품질', '고민', '깊이', '시사점', '권고']::text[], 110, '결과물의 고민 수준을 볼 때', '같은 분량이어도 사실 나열과 권고는 가치가 다르다. 눈금이 있어야 피드백이 ''더 깊게''가 아니라 ''다음 단계''로 구체화된다.', '경쟁사 3곳의 가격표를 정리함 (1단계)', '가격 대안 3개를 비교해 B안을 권고하고, 리스크와 대응을 밝힘 (4단계)', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('pyramid', 'writing', 'framework'::public.knowhow_kind, 1, '결론 먼저, 근거는 그 아래 (피라미드 원칙)', '맨 위에 하나의 결론(주장·요청)을 두고, 그 아래에 결론을 받치는 근거 3개 안팎, 각 근거 아래에 데이터를 둔다. 같은 층의 근거는 같은 종류로 묶고, 위에서 아래로는 ''왜?''에, 아래에서 위로는 ''그래서?''에 답이 되게 한다.', '["첫 문단에 결론이 있는가 본다","근거가 3개 안팎으로 묶였는가 본다","근거 아래에 데이터가 있는가 본다","결론이 뒤에 묻혀 있으면 앞으로 올리게 한다"]'::jsonb, array['review', 'report']::text[], array['피라미드', '두괄식', '결론', '보고서', '구조', '논리', '기획서', '요약', '결론부터', '제안']::text[], 201, '보고서·메일·기획서의 첫 장', '바쁜 상사는 첫 문단에서 읽기를 멈출 수 있다. 결론부터 주면 나머지는 확인 작업이 되어 판단이 빨라진다.', '배경 → 현황 → 분석 → (마지막 장에) 제안', 'B안으로 가야 합니다. 이유는 세 가지입니다 — 비용, 일정, 리스크.', 'Barbara Minto 『The Pyramid Principle』 (McKinsey 보고서 표준)', 'global'),
  ('scqa', 'writing', 'framework'::public.knowhow_kind, 2, '상황-문제-질문-답으로 연다 (SCQA)', '도입부는 모두가 아는 상황(S) → 그 상황을 흔드는 변화나 문제(C) → 그래서 생기는 질문(Q) → 그 질문의 답(A, 곧 결론) 순서로 짧게 쓴다. 상대가 이미 아는 배경은 한 줄로 줄인다.', '["도입부에 상황·문제·질문·답이 있는가 본다","배경 설명이 길면 줄이게 한다","도입부 끝에 답이 나오는가 본다"]'::jsonb, array['review', 'report']::text[], array['SCQA', '스토리라인', '도입부', '발표', '서론', '배경']::text[], 202, '보고서 도입부·발표 첫 장', '읽는 사람이 ''왜 지금 이 얘기를 하지?''를 묻기 전에 맥락과 답을 함께 준다. 설득의 첫 세 문장이다.', '당사는 1998년 설립 이후… 로 시작하는 배경 두 쪽', '온라인 매출이 40%가 됐다(S). 그런데 반품률이 2배가 됐다(C). 무엇부터 고칠까(Q)? 사이즈 안내부터다(A).', 'Barbara Minto 『The Pyramid Principle』', 'global'),
  ('action_title', 'writing', 'rubric'::public.knowhow_kind, 1, '제목은 주제가 아니라 메시지로', '장표와 문단 제목에는 주제(''시장 현황'')가 아니라 그 장이 말하는 결론 문장(''시장은 커지지만 저가 구간만 커진다'')을 쓴다. 제목만 이어 읽어도 전체 이야기가 통해야 하고, 한 장에는 메시지 하나만 담는다.', '["제목이 주제어가 아니라 문장인가 본다","제목만 읽어도 흐름이 이어지는가 본다","한 장에 메시지가 하나인가 본다"]'::jsonb, array['review', 'report']::text[], array['헤드라인', '장표', '슬라이드', '제목', 'PPT', '한 장 한 메시지']::text[], 203, '장표·문단 제목을 달 때', '임원은 제목만 훑는다. 제목이 결론이면 훑기만 해도 설득이 끝난다.', '3. 경쟁사 분석', '경쟁사 3곳 모두 구독형으로 전환 — 단품 판매로는 가격 비교에서 진다', 'McKinsey·BCG 장표 원칙(Action Title · Horizontal Logic)', 'global'),
  ('one_page', 'writing', 'framework'::public.knowhow_kind, 2, '한 장 요약으로 판단하게 한다', '문서가 길어도 맨 앞 한 장에 결론·근거·요청·필요한 결정·리스크를 모은다. 그 한 장만 읽고도 결정할 수 있어야 하고, 본문과 부록은 확인용 자료다. 한 장으로 줄지 않으면 아직 생각이 정리되지 않은 것이다.', '["맨 앞에 한 장 요약이 있는가 본다","요약에 결정 요청이 있는가 본다","세부 데이터는 부록으로 뺐는가 본다"]'::jsonb, array['review', 'report']::text[], array['요약', '한 장', '결재', '임원 보고', 'Executive Summary', '부록']::text[], 204, '결재·임원 보고 문서', '결정권자의 시간이 가장 비싸다. 한 장 요약은 결정 속도를 높이고, 쓰는 사람의 생각도 정리해 준다.', '30쪽 보고서, 요청 사항은 28쪽에', '1쪽: 결론 · 근거 3개 · 요청 2건 · 리스크 / 2쪽부터: 근거 자료', 'Toyota A3 보고서 · Executive Summary', 'global'),
  ('ghost_deck', 'writing', 'framework'::public.knowhow_kind, 1, '쓰기 전에 뼈대부터 맞춘다', '본문을 쓰기 전에 장마다 제목(메시지)만 적은 빈 뼈대를 만들고, 들어갈 차트·표는 손그림 수준으로 표시한다. 이 뼈대를 상사와 먼저 맞춘 뒤 채운다. 뼈대를 바꾸는 데는 10분이 들지만, 완성본을 바꾸는 데는 며칠이 든다.', '["큰 문서는 목차·메시지를 먼저 맞췄는가 본다","재작업이 반복되면 뼈대 합의를 권한다","장마다 넣을 근거가 정해졌는가 본다"]'::jsonb, array['review', 'prep', 'briefing']::text[], array['목차', '뼈대', '스토리보드', '재작업', '착수', '초안']::text[], 205, '큰 문서를 착수할 때', '재작업의 대부분은 내용이 아니라 방향 차이에서 생긴다. 뼈대 단계에서 방향을 맞추면 재작업이 줄어든다.', '2주 동안 완성본을 만든 뒤 첫 보고 → 방향 수정', '이틀째 제목 12장만 들고 10분 확인 → 방향 확정 후 채우기', 'McKinsey·BCG ''Ghost Deck'' · 스토리보딩', 'global'),
  ('chart_message', 'writing', 'rubric'::public.knowhow_kind, 2, '차트 하나에 메시지 하나', '차트는 장식이 아니라 메시지의 증거다. 먼저 하고 싶은 말(비교·추세·구성·분포·상관)을 정하고 그에 맞는 형태를 고른다. 추세는 선, 항목 비교는 막대, 구성은 누적 막대. 강조할 곳 하나에만 색을 쓰고, 제목에 메시지를 쓴다.', '["차트마다 말하려는 메시지가 있는가 본다","메시지에 맞는 형태인가 본다","강조가 한 곳에 모였는가 본다"]'::jsonb, array['review', 'report']::text[], array['차트', '그래프', '시각화', '표', '장표', '대시보드']::text[], 206, '표·그래프를 넣을 때', '같은 숫자도 형태에 따라 3초 만에 읽히기도, 30초가 걸리기도 한다.', '원그래프 4개로 지역별 매출 비교', '막대 하나에 4개 지역, 줄어든 한 곳만 진한 색, 제목 ''동부만 역성장''', 'Gene Zelazny 『Say It With Charts』(McKinsey)', 'global'),
  ('narrative', 'writing', 'principle'::public.knowhow_kind, 2, '문장으로 써 보면 빈틈이 보인다', '중요한 제안은 글머리표만 늘어놓지 말고 완결된 문장과 문단으로 써 본다. 글머리표는 항목 사이의 관계(그래서, 그런데, 왜냐하면)를 숨긴다. 회의 전에 읽을 수 있게 미리 돌리고, 회의 시간은 질문과 결정에 쓴다.', '["핵심 논리가 문장으로 이어지는가 본다","글머리표 사이 인과가 비면 짚는다","중요한 회의는 사전 배포를 권한다"]'::jsonb, array['review', 'briefing']::text[], array['서술', '메모', '내러티브', '기획서', '제안서', '글머리표', '회의 자료']::text[], 207, '중요한 제안·기획을 쓸 때', '문장으로 쓰면 ''그래서''와 ''왜냐하면''을 피할 수 없어 생각의 빈틈이 드러난다.', '· 시장 성장 · 경쟁 심화 · 신규 진입 필요', '시장은 연 8% 크지만 상위 3사가 성장분의 70%를 가져간다. 그래서 정면 경쟁보다 틈새 진입이 낫다.', 'Amazon 6-page Narrative Memo', 'global'),
  ('plain_words', 'writing', 'rubric'::public.knowhow_kind, 2, '쉬운 말, 짧은 문장, 구체적 표현', '한 문장에는 한 가지만 쓰고 두 줄을 넘기지 않는다. ''적극 검토'', ''최적화'', ''고도화''처럼 무엇을 하는지 알 수 없는 말 대신 행동과 숫자를 쓴다. 약어와 내부 용어는 처음 나올 때 풀어 쓰고, 누가 하는지 주어를 밝힌다.', '["뜻이 흐린 말(고도화·적극 검토)을 짚는다","주어와 행동이 분명한가 본다","약어는 처음에 풀어 썼는가 본다"]'::jsonb, array['review', 'report']::text[], array['문장', '글쓰기', '가독성', '표현', '용어', '메일', '고도화']::text[], 208, '모든 글', '어려운 말은 똑똑해 보이지 않고 무언가 숨기는 것처럼 보인다. 쉽게 쓴 글이 더 빨리 결정된다.', '고객 경험 고도화를 위한 다각적 방안을 적극 검토 예정', '다음 달까지 반품 절차를 5단계에서 3단계로 줄이겠습니다(담당 김OO)', 'Plain Language 원칙 · 『The Elements of Style』', 'global'),
  ('doc_check', 'writing', 'rubric'::public.knowhow_kind, 2, '문서 유형별 점검', '기획서: 풀 질문·범위·일정·역할·리스크·성공 기준. 진행 보고: 결론과 요청 먼저, 계획 대비 숫자, 이슈는 원인→영향→대응. 분석: 질문과 가설, 출처·기간·표본, 비교 기준, 한계. 제안: 진단과 처방의 연결, 대안 2개 이상, 실행 계획, 기대 효과.', '["문서 유형에 맞는 빠진 요소를 짚는다","수치와 인용엔 출처가 있는지 본다","세부 데이터는 참고로 분리했는지 본다"]'::jsonb, array['review']::text[], array['기획서', '보고서', '분석', '제안서', '진행 보고', '체크리스트']::text[], 209, '기획서·진행보고·분석·제안을 볼 때', '문서마다 갖춰야 할 요소가 다르다. 유형별 점검표가 있어야 ''어딘가 아쉽다''가 ''이것이 빠졌다''로 바뀐다.', '제안서에 대안이 하나뿐이고 실행 계획이 없음', '제안서: 진단→처방 연결, 대안 2개 비교, 일정·담당, 기대 효과 숫자', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('answer_first', 'comm', 'principle'::public.knowhow_kind, 1, '물으면 답부터, 설명은 그다음', '질문을 받으면 먼저 답(예·아니오, 숫자, 날짜)을 말하고, 그다음에 이유와 상황을 붙인다. 모르면 ''모릅니다, 언제까지 확인하겠습니다''가 답이다. 메일·메신저도 첫 줄에 결론을 쓴다(BLUF: Bottom Line Up Front).', '["질문에 대한 답이 첫 문장에 있는가 본다","모르면 확인 시점을 밝혔는가 본다","메시지 첫 줄에 결론이 있는가 본다"]'::jsonb, array['review', 'report', 'briefing']::text[], array['두괄식', '답변', 'BLUF', '메일', '메신저', '보고', '질문']::text[], 301, '상사·고객의 질문에 답할 때', '상대는 답을 듣기 위해 물었다. 설명이 먼저 나오면 답을 피하는 것처럼 들린다.', '그게 사실 협력사 쪽 사정이 좀 있어서… (2분 뒤) 그래서 하루 늦을 것 같습니다', '하루 늦습니다. 금요일 오전에 드립니다. 이유는 협력사 자료 지연입니다.', '미 육군 BLUF 원칙 · 컨설팅 ''Answer First''', 'global'),
  ('boss_lens', 'comm', 'framework'::public.knowhow_kind, 1, '상사의 관심사로 번역한다', '상사에게도 자기 목표와 위에서 받는 압박, 선호하는 보고 방식이 있다. 보고 전에 이 일이 상사의 어떤 목표에 닿는지, 상사가 위에 무엇을 설명해야 하는지, 숫자·글·대면 중 무엇을 선호하는지 확인하고, 내가 하고 싶은 말을 상사가 결정에 필요한 말로 바꾼다.', '["상위 목표·관심사와 연결했는가 본다","상사가 위에 설명할 문장이 있는가 본다","보고 형식이 받는 사람에 맞는가 본다"]'::jsonb, array['report', 'briefing', 'review']::text[], array['상향 관리', '상사', '임원', '본부장', '보고', '관점', '관심사']::text[], 302, '보고·제안을 준비할 때', '같은 내용도 상사의 목표 언어로 말하면 ''내 일''이 되고, 그렇지 않으면 ''아랫사람의 일''로 남는다.', '저희 팀이 이번에 정말 고생해서 시스템을 바꿨습니다', '본부 과제인 처리 시간 단축에 기여: 건당 12분 → 7분. 분기 보고에 바로 쓰실 수 있습니다', 'Gabarro & Kotter 「Managing Your Boss」(HBR)', 'global'),
  ('clarify_ask', 'comm', 'framework'::public.knowhow_kind, 2, '일을 받을 때 네 가지를 되묻는다', '일을 받으면 그 자리에서 목적(왜, 어디에 쓰나), 결과물 모양(분량·형식·수준), 기한(최종과 중간 점검), 판단 기준(무엇이 되면 잘된 것인가)을 확인하고, 이해한 내용을 한 문장으로 되말한다. 묻지 않고 짐작하면 재작업이 된다.', '["목적·결과물·기한·기준을 확인했는가 본다","이해한 내용을 되말해 확인했는가 본다","쓰임새가 흐리면 묻게 한다"]'::jsonb, array['review', 'prep', 'briefing']::text[], array['업무 지시', '요청', '착수', '재작업', '기대 수준', '되묻기']::text[], 303, '지시·요청을 받을 때', '재작업의 상당수는 실력이 아니라 기대 차이에서 생긴다. 1분의 질문이 하루의 재작업을 막는다.', '넵 알겠습니다 → 사흘 뒤 50쪽 보고서 제출 → ''한 장이면 됐는데''', '임원회의 참고용 한 장, 목요일 오전 초안 확인, 경쟁사 3곳 비교가 핵심 — 맞을까요?', '컨설팅 착수 관행(Kick-off) · 업무 지시 표준', 'global'),
  ('early_check', 'comm', 'principle'::public.knowhow_kind, 1, '중간보고는 일찍, 30% 시점에', '전체 일정의 30% 안팎 시점에 방향과 뼈대만 들고 짧게 확인받는다. 완성도를 높인 뒤 처음 보여 주면 방향이 틀렸을 때 버릴 것이 너무 많다. 상사가 다른 경로로 먼저 듣지 않게(No Surprises) 진행 상황과 이슈는 먼저 알린다.', '["긴 일에 중간 확인 시점이 있는가 본다","완성 전에 방향을 맞췄는가 본다","이슈를 먼저 알렸는가 본다"]'::jsonb, array['review', 'prep', 'briefing', 'report']::text[], array['중간보고', '진척 공유', '방향 확인', '일정', '공유', '지연']::text[], 304, '며칠 이상 걸리는 일', '방향 오류는 늦게 발견할수록 비용이 크게 불어난다. 일찍 보여 주는 것은 실력의 문제가 아니라 위험 관리다.', '마감 전날 처음 공유 → 방향 전환으로 마감 연기', '2주 일정 중 4일째 목차와 핵심 가설만 10분 공유 → 방향 확정', '컨설팅 중간보고 관행 · ''No Surprises'' 원칙', 'global'),
  ('prewire', 'comm', 'framework'::public.knowhow_kind, 2, '회의 전에 핵심 인물과 미리 맞춘다', '결정이 필요한 회의라면 그 전에 결정권자와 반대할 가능성이 큰 사람을 따로 만나 안을 미리 보여 주고 우려를 듣는다. 회의장에서 처음 듣는 사람은 방어적이 된다. 들은 우려는 안에 반영하거나 답을 준비해 간다.', '["결정 회의 전 사전 공유를 했는가 본다","예상 반대와 답이 준비됐는가 본다","회의에서 처음 듣는 핵심 인물이 없게 한다"]'::jsonb, array['briefing', 'report', 'review']::text[], array['사전 조율', '이해관계자', '회의', '설득', '합의', '협의']::text[], 305, '중요한 결정 회의 전', '회의는 결정을 확인하는 자리여야 한다. 사전 조율 없이 회의에서 설득하려 하면 결정이 미뤄진다.', '부서장 회의에서 처음 안을 공개 → 타 부서 반대로 보류', '회의 이틀 전 재무팀장과 15분 사전 공유 → 예산 우려를 반영한 B안으로 통과', 'McKinsey ''Pre-wiring'' 관행', 'global'),
  ('stakeholder', 'comm', 'framework'::public.knowhow_kind, 2, '이해관계자 지도를 그린다', '일에 영향을 주거나 받는 사람을 적고 영향력과 관심도로 나눈다. 둘 다 높으면 함께 설계하고, 영향력만 높으면 핵심만 보고해 만족시키고, 관심만 높으면 자주 알리고, 둘 다 낮으면 결과만 공유한다. 사람마다 얻는 것과 잃는 것을 적어 둔다.', '["관련 부서·사람을 빠짐없이 적었는가 본다","사람마다 소통 방식을 달리했는가 본다","잃는 사람이 있으면 대응을 묻는다"]'::jsonb, array['strategy', 'review', 'briefing']::text[], array['이해관계자', '협업', '부서 간', '조율', '변화 관리', '제휴', '협력사']::text[], 306, '여러 부서가 얽힌 일', '여러 부서가 걸린 일은 논리보다 사람 때문에 막힌다. 누가 무엇을 잃는지 알면 저항을 미리 다룰 수 있다.', '전사 시스템 변경을 IT팀과만 논의 → 현업 반발로 일정 지연', '영향이 큰 영업·재무는 설계 단계부터 참여, 나머지는 격주 소식 공유', '이해관계자 분석(Mendelow 영향력-관심 매트릭스)', 'global'),
  ('real_need', 'comm', 'principle'::public.knowhow_kind, 2, '요청 뒤의 진짜 목적을 찾는다', '요청받은 것(무엇을)과 필요한 것(왜)은 다를 수 있다. ''자료 좀 뽑아 줘''의 목적이 임원 질문에 답하기라면 필요한 것은 원자료가 아니라 한 줄 답이다. 요청의 목적을 확인하고, 목적에 더 맞는 방법이 있으면 대안을 함께 제안한다.', '["요청의 목적을 확인했는가 본다","목적에 더 맞는 대안을 제안했는가 본다","요청만 그대로 수행했으면 목적을 묻는다"]'::jsonb, array['review', 'prep', 'briefing']::text[], array['고객 관점', '니즈', '요청', '목적', '고객', '서비스', '내부 고객']::text[], 307, '고객·상사의 요청을 받을 때', '시킨 일만 하면 기대만큼이고, 목적을 채우면 기대 이상이 된다. ''일 잘한다''는 평판은 대부분 여기서 나온다.', '요청대로 엑셀 원자료 3만 행 전달', '''왜 줄었나''가 질문이라면 원인 3개를 한 장으로 드릴게요. 원자료는 첨부합니다.', '컨설팅 고객 관리 · Jobs to be Done 관점', 'global'),
  ('msg_once', 'comm', 'rubric'::public.knowhow_kind, 2, '메일·메신저는 한 번에 끝나게', '메시지 하나에 용건 하나. 제목이나 첫 줄에 [요청·공유·결정]과 기한을 쓰고, 상대가 할 일을 분명히 적는다. 상대가 다시 물어야 할 정보(파일·링크·배경)는 미리 붙인다. ''잠깐 시간 되세요?'' 대신 용건을 바로 쓴다.', '["첫 줄에 요청과 기한이 있는가 본다","상대가 할 일이 분명한가 본다","필요한 자료를 함께 보냈는가 본다"]'::jsonb, array['review', 'briefing']::text[], array['메일', '메신저', '요청', '협업', '커뮤니케이션', '공유']::text[], 308, '메일·메신저로 요청할 때', '주고받는 횟수가 한 번 늘 때마다 하루가 늦어진다. 한 번에 끝나는 메시지가 팀의 속도다.', '팀장님 혹시 잠깐 시간 되실까요?', '[결정 요청 · 오늘 17시] B사 견적 2안 중 선택 부탁드립니다. 비교표 첨부, 저는 2안을 추천합니다.', '비동기 커뮤니케이션 원칙(BLUF)', 'global'),
  ('upward_report', 'comm', 'framework'::public.knowhow_kind, 2, '상향 보고의 순서', '첫 줄에 결론과 요청, 그다음 근거 숫자, 마지막에 필요한 결정과 지원. 결정이 필요하면 선택지 두 개 이상을 장단점과 함께. 한 장에 한 메시지, 세부는 참고로 뺀다.', '["결론과 요청을 첫 줄에","결정 사항은 선택지 2개 이상으로","한 장에 한 메시지"]'::jsonb, array['report']::text[], array['보고', '임원보고', '상향관리', '결재', '선택지']::text[], 309, '위로 보고할 때', '윗사람의 시간은 결정에 써야 한다. 결론과 요청이 먼저 오면 보고가 결정으로 바로 이어진다.', '이번 주 진행 사항을 순서대로 나열하고 끝', '첫 줄 ''예산 2천만 원 추가 승인 요청'' → 근거 3개 → 선택지 A·B와 추천안', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('bad_news', 'comm', 'principle'::public.knowhow_kind, 2, '나쁜 소식은 먼저, 대응안과 함께', '위에서 다른 경로로 듣기 전에 팀장이 먼저 말한다. 원인 → 영향 → 대응안 순서로, 대응안이 여럿이면 권하는 안을 밝힌다. 목표 대비 부족이 구조적이면 추세·바뀐 환경·필요한 자원을 근거로 재협의를 준비한다.', '["나쁜 소식은 원인→영향→대응안","권하는 대응안을 밝힌다","구조적 부족은 재협의 근거를 준비"]'::jsonb, array['report', 'briefing']::text[], array['리스크보고', '에스컬레이션', '지연', '목표 미달', '이슈']::text[], 310, '일정·성과가 어긋났을 때', '나쁜 소식은 늦을수록 더 나빠진다. 먼저 말하는 사람이 대응의 주도권을 가진다.', '목표 미달을 분기 마감 회의에서 처음 보고', '마감 3주 전: ''3분기 80% 예상 — 원인 2개, 만회안 A(추천)·B''', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('reframe', 'creative', 'framework'::public.knowhow_kind, 1, '문제를 다시 정의해 본다', '주어진 문제를 그대로 풀기 전에 다르게 정의해 본다. ''왜 이걸 해결하려 하나?''를 물어 한 단계 위 목적으로 올라가면 다른 해법이 보이고, ''정확히 무엇이 문제인가?''로 내려가면 손댈 곳이 보인다. 정의를 세 가지 이상 써 보고 하나를 고른다.', '["문제 정의를 다르게 해 봤는가 본다","한 단계 위 목적에서 해법을 찾았는가 본다","첫 정의를 그대로 썼으면 다른 정의를 묻는다"]'::jsonb, array['review', 'strategy', 'plan']::text[], array['리프레이밍', '재정의', '관점', '창의', '기획', '아이디어', '새로운 시도']::text[], 401, '뻔한 답만 나올 때', '잘못 정의한 문제는 아무리 잘 풀어도 소용없다. 정의를 바꾸는 것이 가장 큰 창의성이다.', '엘리베이터가 느리다 → 더 빠른 엘리베이터로 교체(수억 원)', '''기다림이 지루하다''로 재정의 → 거울 설치로 불만 해소', 'Wedell-Wedellsborg 「Are You Solving the Right Problems?」(HBR)', 'global'),
  ('hmw', 'creative', 'framework'::public.knowhow_kind, 2, '''어떻게 하면 ~할까''로 묻는다', '문제를 불평(''고객 문의가 너무 많다'')이 아니라 기회 질문(''어떻게 하면 고객이 묻지 않고도 해결할까?'')으로 바꿔 시작한다. 너무 넓으면 막연하고 너무 좁으면 답이 정해져 있다. 대상과 원하는 변화가 담기게 쓴다.', '["문제를 기회 질문으로 바꿨는가 본다","질문이 너무 넓거나 좁지 않은가 본다","질문에 대상과 원하는 변화가 있는가 본다"]'::jsonb, array['review', 'plan']::text[], array['HMW', '아이디어', '브레인스토밍', '디자인씽킹', '질문', '워크숍']::text[], 402, '아이디어 회의를 시작할 때', '질문의 모양이 답의 범위를 정한다. 열린 질문이 더 많은 아이디어를 끌어낸다.', '콜센터 인력을 어떻게 줄일까?', '어떻게 하면 고객이 전화하기 전에 답을 찾게 할까?', 'IDEO · 디자인 씽킹 ''How Might We''', 'global'),
  ('diverge_converge', 'creative', 'principle'::public.knowhow_kind, 2, '넓히는 시간과 좁히는 시간을 나눈다', '아이디어를 낼 때(발산)는 평가를 미루고 양을 늘리며, 고를 때(수렴)는 기준을 정해 냉정하게 줄인다. 두 단계를 섞으면 첫 아이디어가 평가받는 순간 나머지가 나오지 않는다. 문제 정의와 해결책에서 두 번 반복한다.', '["대안을 충분히 넓힌 뒤 골랐는가 본다","고르는 기준이 밝혀졌는가 본다","대안이 하나뿐이면 발산 단계를 묻는다"]'::jsonb, array['review', 'plan', 'strategy']::text[], array['발산', '수렴', '더블 다이아몬드', '아이디어', '브레인스토밍', '대안']::text[], 403, '아이디어를 내고 고를 때', '좋은 아이디어는 많은 아이디어 속에서 나온다. 평가를 미루면 양이, 기준을 세우면 질이 확보된다.', '회의 첫 아이디어에 ''그건 예산이 안 돼''로 바로 종료', '15분 동안 평가 없이 30개 → 효과·실행 용이성 기준으로 3개 선정', '영국 디자인 카운슬 ''Double Diamond'' · Alex Osborn', 'global'),
  ('first_principles', 'creative', 'principle'::public.knowhow_kind, 2, '당연한 가정을 의심한다', '''원래 그렇게 한다''는 가정을 적어 보고, 각각이 물리적·법적 제약인지 단지 관행인지 구분한다. 관행이면 바꿀 수 있다. 원가와 시간을 가장 작은 요소까지 쪼갠 뒤 ''꼭 필요한 것''에서 다시 쌓아 올린다.', '["전제로 깔린 가정을 밝혔는가 본다","제약과 관행을 구분했는가 본다","''원래 그렇다''가 근거면 짚는다"]'::jsonb, array['strategy', 'review', 'plan']::text[], array['제1원칙', '가정', '관행', '혁신', '원가', '재설계', '리드타임']::text[], 404, '관행·전례가 답을 막을 때', '경쟁사와 같은 가정에서 출발하면 같은 답에 도착한다. 차별화는 대개 아무도 의심하지 않은 가정에서 나온다.', '업계 표준 납기가 4주라 우리도 4주', '4주 중 실제 작업은 6일, 나머지는 대기 → 대기 단계를 없애 1주 납기', '제1원칙 사고(First Principles Thinking)', 'global'),
  ('scamper', 'creative', 'framework'::public.knowhow_kind, 2, '일곱 질문으로 비틀어 본다 (SCAMPER)', '지금 있는 것에 일곱 질문을 던진다. 바꾸면? 합치면? 다른 데서 빌려오면? 키우거나 줄이면? 다른 용도로 쓰면? 빼면? 순서를 뒤집으면? 질문마다 하나 이상 적어 보면 백지에서 생각할 때보다 빨리, 넓게 나온다.', '["개선안이 한 방향뿐이면 다른 질문을 권한다","빼기(없애기)를 검토했는가 본다","아이디어마다 기대 효과를 묻는다"]'::jsonb, array['review', 'plan']::text[], array['SCAMPER', '개선', '아이디어', '혁신', '상품 기획', '프로세스 개선']::text[], 405, '기존 상품·프로세스를 개선할 때', '있는 것을 비트는 편이 백지에서 시작하는 것보다 빠르고, 질문 목록이 생각의 사각지대를 비춘다.', '개선안: 기능 추가 하나', '빼기: 가입 단계 7개 → 3개 / 합치기: 결제와 배송 조회를 한 화면에', 'Bob Eberle SCAMPER (Alex Osborn 체크리스트 기반)', 'global'),
  ('analogy', 'creative', 'principle'::public.knowhow_kind, 2, '다른 업계에서 빌려 온다', '같은 구조의 문제를 이미 푼 다른 업계를 찾는다. 대기 줄 관리는 놀이공원이, 재구매는 구독 서비스가, 현장 표준화는 프랜차이즈가 먼저 풀었다. 겉모습이 아니라 문제의 구조가 같은 사례를 찾아 무엇을 가져올지 적는다.', '["다른 업계·사례를 참고했는가 본다","사례와 우리 상황의 차이를 밝혔는가 본다","경쟁사만 보고 있으면 이종 사례를 권한다"]'::jsonb, array['review', 'strategy', 'plan']::text[], array['벤치마킹', '사례', '유추', '이종 업계', '아이디어', '경쟁사']::text[], 406, '막혔을 때·새 기획', '경쟁사만 보면 따라가게 되고, 다른 업계를 보면 앞서가게 된다.', '경쟁사 A·B의 기능을 비교해 빠진 기능을 추가', '병원 예약 노쇼 문제 → 항공사의 초과 예약·위약금 구조를 응용', '유추적 사고(Analogical Thinking) · 이종 벤치마킹', 'global'),
  ('inversion', 'creative', 'framework'::public.knowhow_kind, 2, '거꾸로 생각한다', '''어떻게 성공할까'' 대신 ''어떻게 하면 확실히 망할까''를 먼저 적는다. 실패를 부르는 행동 목록이 나오면 그것을 하지 않는 것이 첫 전략이 된다. 고객을 떠나게 하는 방법, 프로젝트를 늦추는 방법을 적어 보면 막아야 할 것이 보인다.', '["실패를 부르는 요인을 적어 봤는가 본다","그 요인을 막는 장치가 계획에 있는가 본다"]'::jsonb, array['plan', 'strategy', 'review']::text[], array['역발상', '리스크', '실패 요인', '전략', '고객 이탈']::text[], 407, '방법이 떠오르지 않을 때', '성공 요인은 많고 흐릿하지만 실패 요인은 구체적이다. 피할 것을 먼저 지우면 성공 확률이 오른다.', '고객 만족을 높인다 (막연함)', '고객을 떠나게 하는 법: 늦은 답, 같은 질문 반복 → 응답 4시간 기준, 문의 이력 공유', 'Charlie Munger · Carl Jacobi ''거꾸로 생각하라''', 'global'),
  ('customer_job', 'creative', 'framework'::public.knowhow_kind, 1, '고객이 해결하려는 일을 본다', '고객은 제품을 사는 게 아니라 자기 일을 해결하려고 ''고용''한다. 고객이 어떤 상황에서, 무엇을 끝내려고, 무엇이 불편해서 우리를 찾는지 한 문장으로 쓴다. 타 부서·상사 같은 내부 고객도 같다. 기능이 아니라 해결된 상태를 기획한다.', '["고객의 상황과 해결하려는 일이 있는가 본다","기능 나열이면 고객 관점을 묻는다","고객 근거(인터뷰·데이터)가 있는가 본다"]'::jsonb, array['review', 'plan', 'strategy']::text[], array['고객', 'JTBD', '니즈', '고객 가치', '상품 기획', '타깃', '페르소나']::text[], 408, '상품·서비스·내부 고객 기획', '기능 경쟁은 끝이 없지만, 고객의 일을 더 잘 해결하는 쪽이 선택받는다.', '앱에 AI 추천 기능 추가', '퇴근길 10분 안에 저녁 메뉴를 정하고 싶은 1인 가구 → 3개만 추천', 'Clayton Christensen ''Jobs to be Done''', 'global'),
  ('working_backwards', 'creative', 'framework'::public.knowhow_kind, 1, '끝에서 거꾸로 기획한다', '기획을 시작할 때 ''완성됐을 때 고객(또는 상사)에게 보낼 발표문''을 먼저 쓴다. 누구의 어떤 문제를 어떻게 해결했고 무엇이 달라졌는가. 그다음 예상 질문과 답(FAQ)을 적는다. 발표문이 설득력이 없으면 기획을 고친다.', '["완성 후 모습을 먼저 그렸는가 본다","고객이 얻는 변화가 한 문장으로 되는가 본다","예상 질문과 답을 준비했는가 본다"]'::jsonb, array['plan', 'review', 'strategy']::text[], array['워킹 백워드', 'PR/FAQ', '기획', '신사업', '프로젝트', '런칭', '비전']::text[], 409, '새 기획·프로젝트 착수', '끝을 먼저 쓰면 ''만들 수 있는 것''이 아니라 ''만들 가치가 있는 것''에서 출발하게 된다.', '기술 사양과 일정부터 정리', '''3월, 고객은 가입 2분 만에 첫 견적을 받는다'' 발표문 → 거꾸로 짚은 과제 4개', 'Amazon ''Working Backwards''(PR/FAQ)', 'global'),
  ('small_bet', 'creative', 'principle'::public.knowhow_kind, 2, '작게, 빨리 실험한다', '크게 준비해 한 번에 시작하지 말고, 가장 불확실한 가정 하나를 가장 싸게 검증할 실험부터 한다. 실험마다 ''무엇을 보면 계속하고 무엇을 보면 멈출지''를 미리 정한다. 실패는 비용이 작을 때 해야 배움이 된다.', '["가장 불확실한 가정을 먼저 검증하는가 본다","계속·중단 기준을 미리 정했는가 본다","큰 투자 전에 작은 검증이 있었는가 본다"]'::jsonb, array['plan', 'strategy', 'review']::text[], array['실험', 'MVP', '파일럿', '검증', '테스트', '신사업', '가설']::text[], 410, '확신이 없는 새 시도', '검증 없이 크게 시작하면 틀렸을 때 돌아올 수 없다. 작은 실험이 큰 실패를 막는다.', '6개월 개발 후 전국 출시', '2주간 매장 1곳 파일럿, 재구매율 20%를 넘으면 확대', 'Eric Ries 『The Lean Startup』', 'global'),
  ('door_type', 'decision', 'principle'::public.knowhow_kind, 1, '되돌릴 수 있는 결정은 빨리 한다', '결정을 두 종류로 나눈다. 되돌리기 어려운 결정(큰 투자·채용·구조 변경)은 충분히 검토하고, 되돌릴 수 있는 결정(대부분의 운영 결정)은 빨리 내린 뒤 결과를 보며 고친다. 모든 결정을 무겁게 다루면 팀이 느려진다.', '["되돌릴 수 있는 결정인지 구분했는가 본다","가벼운 결정이 오래 걸리면 짚는다","무거운 결정은 검토 깊이를 묻는다"]'::jsonb, array['briefing', 'strategy', 'scenario', 'review']::text[], array['의사결정', '속도', '결정', '리스크', '실행', '판단', '보류']::text[], 501, '결정이 늘어질 때', 'McKinsey 조사(2019)에서 응답자들은 업무 시간의 37%를 결정에 쓰지만, 61%는 그 시간 대부분이 비효율적이라고 답했다. 결정마다 무게를 달리해야 한다.', '이벤트 문구 하나를 정하는 데 회의 3번', '문구는 담당자가 정하고 A/B 테스트로 조정, 연간 예산 배분은 2주 검토', 'Amazon ''Type 1·Type 2 결정'' · McKinsey 의사결정 조사(2019)', 'global'),
  ('info_70', 'decision', 'principle'::public.knowhow_kind, 2, '정보 70%에서 결정한다', '원하는 정보의 70% 정도가 모이면 결정한다. 90%를 기다리면 대부분 늦다. 대신 결정과 함께 ''어떤 신호가 보이면 다시 판단할지''를 정해 둔다. 틀린 결정을 빨리 알아채고 고치는 힘이 완벽한 결정보다 중요하다.', '["추가 조사가 결정을 바꿀 수 있는가 묻는다","재검토 신호를 함께 정했는가 본다","결정을 미루는 비용을 밝혔는가 본다"]'::jsonb, array['briefing', 'strategy', 'review']::text[], array['결정', '속도', '불확실성', '판단', '정보', '지연', '추가 조사']::text[], 502, '''자료를 더 모으자''가 반복될 때', '기다리는 동안에도 기회·시장·팀 사기의 비용은 쌓인다. 대부분의 결정은 나중에 고칠 수 있다.', '한 달 더 시장 조사 후 결정하겠습니다 (세 번째)', '지금 자료로 B안 결정. 첫 4주 전환율이 2% 미만이면 A안으로 전환', 'Jeff Bezos 2016 주주서한', 'global'),
  ('criteria_first', 'decision', 'framework'::public.knowhow_kind, 1, '기준을 먼저 정하고 대안을 본다', '대안을 보기 전에 판단 기준(효과·비용·속도·리스크 등)과 그 무게를 먼저 정한다. 대안을 먼저 보면 마음에 드는 안에 맞춰 기준이 바뀐다. 대안은 최소 두 개, ''아무것도 안 하기''도 하나의 대안으로 함께 비교한다.', '["판단 기준과 무게가 먼저 있는가 본다","대안이 2개 이상인가 본다","''안 하기''와 비교했는가 본다","버린 대안과 이유를 쓰게 한다"]'::jsonb, array['review', 'strategy', 'report', 'scenario']::text[], array['대안 비교', '의사결정', '평가 기준', '가중치', '선택', '버린 대안', '비교', '검토']::text[], 503, '여러 안 중에서 고를 때', '기준이 먼저 있어야 결정을 설명할 수 있고, 나중에 ''왜 그걸 골랐나''에 답할 수 있다.', 'A안이 좋아 보여서 A안으로 갑니다', '효과 40·비용 30·속도 30 기준 → A 72점, B 81점, 현행 유지 55점 → B안', 'Kepner-Tregoe 의사결정 분석 · 대안 비교 표준', 'global'),
  ('premortem', 'decision', 'framework'::public.knowhow_kind, 1, '시작 전에 실패를 상상한다 (사전 부검)', '실행 전에 ''1년 뒤 이 프로젝트가 크게 실패했다. 왜 실패했나?''를 각자 적게 한다. 이미 일어난 일로 상상하면 위험이 훨씬 잘 보이고, 말하기 어려운 우려도 꺼내기 쉬워진다. 나온 실패 원인 중 큰 것부터 대응책을 계획에 넣는다.', '["실패 시나리오를 미리 검토했는가 본다","주요 리스크마다 대응이 있는가 본다","리스크 항목이 비어 있으면 묻는다"]'::jsonb, array['review', 'strategy', 'plan', 'scenario']::text[], array['프리모템', '리스크', '실패', '사전 점검', '위험 관리', '프로젝트', '대응', '일정', '계획']::text[], 504, '큰 프로젝트·결정 직전', '결과가 이미 일어났다고 상상하면 그 원인을 찾아내는 능력이 약 30% 높아진다는 연구가 있다(Mitchell 외, 1989).', '리스크: 특이사항 없음', '실패 원인 1위 ''협력사 데이터 지연'' → 대체 데이터원 확보, 2주 여유', 'Gary Klein 「Performing a Project Premortem」(HBR, 2007)', 'global'),
  ('devil', 'decision', 'principle'::public.knowhow_kind, 2, '큰 결정엔 반대 논거를 일부러 세운다', '되돌리기 어려운 결정일수록 한 사람에게 반대 역할을 맡겨 가장 강한 반대 논거를 세우게 한다. 반대가 없는 회의는 합의가 아니라 침묵일 수 있다. 핵심 가정마다 ''이게 틀리면 어떻게 되나''를 묻는다.', '["큰 결정에 반대 논거를 검토했는가 본다","핵심 가정이 틀릴 경우를 따졌는가 본다","만장일치면 반론을 한 번 묻는다"]'::jsonb, array['strategy', 'scenario', 'briefing']::text[], array['반대 의견', '집단 사고', '의사결정', '검증', '토론', '가정', '신사업']::text[], 505, '모두가 찬성하는 큰 결정', 'McKinsey 조사(2019)에서 큰 결정에 가정을 반박하고 반대 역할을 두는 등 토론의 질이 높은 조직은 성과가 좋은 조직일 가능성이 2.3배 높았다.', '신사업 진출을 15분 만에 만장일치 승인', '반대 역할이 ''시장 규모 과대평가'' 논거를 제시 → 1단계 파일럿으로 줄여 승인', 'McKinsey 「Decision making in the age of urgency」(2019)', 'global'),
  ('decision_roles', 'decision', 'framework'::public.knowhow_kind, 2, '누가 결정하는지 먼저 정한다', '결정마다 역할을 나눈다. 안을 만드는 사람(추천), 반드시 동의를 받아야 하는 사람(합의), 의견을 내는 사람(의견), 최종 결정하는 사람(결정, 한 명), 실행하는 사람(실행). 결정자가 둘이면 아무도 결정하지 않는다.', '["결정자가 한 명으로 정해졌는가 본다","의견과 합의 대상을 구분했는가 본다","결정이 떠돌면 역할을 묻는다"]'::jsonb, array['briefing', 'strategy', 'review']::text[], array['RAPID', 'RACI', '결정권', '역할', '책임', '협업', '합의']::text[], 506, '여러 사람이 걸린 결정', 'Bain이 1,000개 넘는 기업을 조사한 결과 의사결정 효과성과 사업 성과는 뚜렷하게 함께 움직였다(95% 신뢰수준). 결정이 느린 가장 흔한 이유는 결정권이 흐린 것이다.', '관련 팀들이 협의해서 정하기로', '추천 마케팅 김OO · 합의 재무 · 의견 영업 · 결정 본부장 · 실행 마케팅', 'Bain & Company RAPID® 의사결정 모델', 'global'),
  ('disagree_commit', 'decision', 'principle'::public.knowhow_kind, 2, '반대해도 결정되면 함께 간다', '결정 전에는 반대 의견을 분명히 말하고, 결정이 나면 반대했던 사람도 전력으로 실행한다. 뒤에서 다시 문제 삼거나 소극적으로 실행하면 같은 결정에 비용을 두 번 쓴다. 다시 볼 조건은 결정할 때 함께 정한다.', '["결정 전에 반대 의견을 들었는가 본다","결정 후 실행이 미뤄지면 짚는다","재검토 조건을 정했는가 본다"]'::jsonb, array['briefing', 'prep']::text[], array['실행', '합의', '갈등', '팀워크', '결정', '몰입', '반대']::text[], 507, '결정 후 실행 단계', '결정의 질만큼 실행의 속도가 성과를 가른다. 반대할 권리와 따를 책임은 함께 간다.', '결정 후에도 ''저는 원래 반대였어요'' 하며 실행 지연', '우려는 기록해 두고 4주 뒤 지표로 다시 보죠. 그때까지는 이 안으로 갑니다.', 'Amazon 리더십 원칙 ''Disagree and Commit''', 'global'),
  ('priority_matrix', 'decision', 'framework'::public.knowhow_kind, 2, '중요도와 긴급도로 나눈다', '할 일을 중요도와 긴급도로 나눈다. 중요하고 급한 일은 바로, 중요하지만 급하지 않은 일은 일정에 박아 지키고, 급하지만 중요하지 않은 일은 맡기거나 줄이고, 둘 다 아니면 지운다. 성과는 대부분 ''중요하지만 급하지 않은 일''에서 나온다.', '["일을 중요·긴급으로 나눴는가 본다","중요하지만 급하지 않은 일에 시간이 있는가 본다","급한 일만 하고 있으면 짚는다"]'::jsonb, array['briefing', 'prep', 'plan']::text[], array['우선순위', '시간 관리', '아이젠하워', '업무량', '계획', '일정', '과부하']::text[], 508, '일이 몰릴 때·주간 계획', '급한 일은 스스로 시간을 요구하지만, 중요한 일은 누군가 지켜 주지 않으면 계속 밀린다.', '하루 종일 메신저·요청 대응, 분기 핵심 과제는 3주째 0%', '매주 화·목 오전 2시간은 핵심 과제에 고정, 단순 요청은 오후에 묶어서', '아이젠하워 매트릭스 · Stephen Covey 『성공하는 사람들의 7가지 습관』', 'global'),
  ('stop_doing', 'decision', 'principle'::public.knowhow_kind, 2, '하지 않을 일을 정한다', '새 일을 더할 때는 무엇을 뺄지 함께 정한다. 분기마다 팀이 하는 일을 적고 ''안 하면 누가 언제 알아챌까''를 물어, 아무도 모를 일은 멈춘다. 하지 않을 일 목록은 할 일 목록만큼 중요하다.', '["새 과제와 함께 뺄 일을 정했는가 본다","효과 없는 정례 업무를 짚는다","과제 수가 늘기만 하면 묻는다"]'::jsonb, array['briefing', 'strategy', 'plan', 'scenario']::text[], array['업무 축소', '중단', '선택과 집중', '업무량', '기회비용', '정례 업무']::text[], 509, '새 과제를 받을 때·분기 계획', '팀의 시간은 늘지 않는다. 빼지 않고 더하기만 하면 모든 일이 조금씩 나빠진다.', '신규 과제 3개 추가, 기존 업무는 그대로', '월간 리포트 2종을 대시보드로 대체 → 월 16시간을 신규 과제에 투입', 'Jim Collins ''Stop Doing List'' · Peter Drucker ''계획적 폐기''', 'global'),
  ('goal_state', 'goal', 'framework'::public.knowhow_kind, 1, '목표는 이루려는 상태로', '목표는 하는 일의 목록이 아니라 이루려는 상태다. 새로 만들 것(Build), 개선할 것(Improve), 다르게 바꿀 것(Innovate) 중 무엇인지가 드러나야 한다. 늘 하던 일, 무난히 되는 수치, 작년과 같은 목표는 목표가 아니다.', '["목표 제목에 이루려는 상태를 쓴다","만들기·개선·혁신 중 성격을 밝힌다","일상 업무 나열은 목표로 올리지 않는다","작년 목표의 반복이면 무엇이 다른지 묻는다"]'::jsonb, array['plan', 'strategy']::text[], array['목표', 'BII', '목표수립', '상태', '연간 목표']::text[], 601, '목표를 세울 때', '할 일 목록은 바빠도 성과가 없을 수 있다. 상태로 쓴 목표만 ''다 됐는가''를 판단할 수 있다.', 'SNS 채널 운영 및 콘텐츠 관리', 'SNS 유입이 신규 가입의 30%를 차지하는 채널로 만든다 (Build)', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('goal_check', 'goal', 'rubric'::public.knowhow_kind, 1, '목표 점검 네 가지', '목표를 세운 뒤 네 가지를 본다. 집중(3~5개로 추렸는가), 정렬(상위 목표·전사 방침과 이어지는가), 도전(최선을 다하면 60~70% 달성할 수준인가), 추적(달성 여부를 무엇으로 알 수 있는가).', '["팀 목표는 3~5개","상위 목표와 연결을 밝힌다","60~70% 달성 수준으로 도전적으로","달성 판단 기준이 없으면 붙인다"]'::jsonb, array['plan', 'strategy']::text[], array['목표점검', '집중', '정렬', '도전', '추적']::text[], 602, '목표 초안을 검토할 때', '목표가 많으면 아무것도 중요하지 않고, 정렬이 없으면 열심히 해도 위에서 보이지 않는다.', '팀 목표 9개, 상위 목표와 연결 표시 없음', '팀 목표 4개, 각 목표에 연결되는 본부 과제와 판단 지표를 함께 표시', 'ATEAM 현장 컨설팅 기준 · OKR 원칙', 'field'),
  ('measure_outcome', 'goal', 'rubric'::public.knowhow_kind, 1, '결과를 재는 지표', '달성 지표는 한 일이 아니라 일어난 결과를 잰다. "~실시, ~수행, ~관리"는 과제다. 지표 하나에는 한 가지만 담고, 하위로 갈수록 과정 지표(선행), 팀 목표에는 결과 지표(후행)를 둔다.', '["활동이면 과제로 내리고 결과 지표를 찾는다","지표 하나에 한 가지 내용만","팀 목표엔 결과, 하위엔 과정 지표","과정 지표만으로 성과를 판단하지 않는다"]'::jsonb, array['plan']::text[], array['KR', '지표', '측정', '결과 지표', '선행 지표']::text[], 603, '달성 지표를 정할 때', '활동을 지표로 삼으면 일은 다 했는데 결과는 없는 상태가 성공으로 기록된다.', '지표: 고객 간담회 4회 실시', '지표: 핵심 고객 재계약률 85% (간담회 4회는 과제로)', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('kpi_five', 'goal', 'rubric'::public.knowhow_kind, 2, '좋은 지표의 다섯 조건', '전략과 이어지는가(전략 연계), 자의적으로 부풀릴 수 없는가(객관성), 데이터를 쉽게 얻는가(측정 용이), 담당자가 결과를 움직일 수 있는가(통제 가능), 중요한 업무를 재는가(업무 대표). 통제가 어려운 지표는 기여 정도로 바꿔 잰다.', '["다섯 조건 중 빠진 것을 짚는다","통제 어려운 지표는 기여도로 바꾼다","질·양·비용·시간 중 두 축 이상"]'::jsonb, array['plan', 'strategy']::text[], array['KPI', '지표품질', '통제 가능', '측정']::text[], 604, 'KPI를 고르거나 고칠 때', '나쁜 지표는 사람을 엉뚱한 방향으로 열심히 일하게 만든다.', '마케팅팀 KPI: 전사 매출 (팀이 통제하기 어려움)', '마케팅팀 KPI: 마케팅 기여 신규 고객 수 · 고객 획득 비용', 'ATEAM 현장 컨설팅 기준 · KPI 설계 원칙', 'field'),
  ('qual_measure', 'goal', 'framework'::public.knowhow_kind, 2, '정성 성과를 재는 다섯 방법', '숫자로 안 나오는 성과도 잴 수 있다. 고객·사용자 만족 조사(Survey), 난이도·적시성·완결성 점수(표준화), 수준별 행동 기준(행동기준), 단계별 완료와 가중치(마일스톤), 필수 요소 유무(체크리스트). 어느 방법이든 등급별 판단 기준을 미리 정한다.', '["정성 목표엔 측정 방법을 고른다","등급별 판단 기준을 함께 쓴다","마일스톤은 단계별 가중치를 둔다"]'::jsonb, array['plan']::text[], array['정성지표', '마일스톤', '측정방식', '체크리스트', '정성']::text[], 605, '숫자로 안 나오는 목표', '정성 목표를 재지 않으면 평가 때 인상으로 판단하게 되고, 팀원은 무엇이 잘한 것인지 모른 채 일한다.', '목표: 브랜드 가이드 정비 (측정 방법 없음)', '마일스톤: 초안 30% · 부서 합의 30% · 전사 배포 40%, 기한별 판단 기준 명시', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('baseline_target', 'goal', 'rubric'::public.knowhow_kind, 2, '목표치엔 기준선과 산정 근거', '목표 숫자에는 지금 값(기준선), 목표 값, 그 차이를 무엇으로 메울지(산정 근거)를 함께 쓴다. ''전년 대비 10%''처럼 근거 없는 관행 수치는 도전인지 무리인지 알 수 없다. 기준선이 없으면 첫 달에 먼저 잰다.', '["목표에 지금 값이 있는가 본다","목표치의 산정 근거가 있는가 본다","기준선이 없으면 측정부터 계획하게 한다"]'::jsonb, array['plan', 'strategy', 'review']::text[], array['목표치', '기준선', '베이스라인', '목표 수립', 'KPI', '산정 근거', '리드타임', '측정', '목표']::text[], 606, '목표 숫자를 정할 때', '기준선 없는 목표는 달성 여부를 판단할 수 없고, 근거 없는 목표치는 연말에 협상거리가 된다.', '고객 만족도 향상 (목표 90점) — 지금 점수는 모름', '만족도 72점(9월) → 80점(12월): 응답 시간 단축 +5, 재문의 감소 +3', 'ATEAM 현장 컨설팅 기준 · OKR Key Result 작성 원칙', 'field'),
  ('weekly_rhythm', 'goal', 'framework'::public.knowhow_kind, 2, '목표는 매주 굴린다', '목표는 세우는 것보다 굴리는 것이 어렵다. 매주 같은 시간에 목표별 달성 확신도(높음·보통·낮음), 이번 주 우선순위 3개, 막힌 것을 짧게 점검한다. 확신도가 두 주 연속 내려가면 그때 1on1이나 계획 수정으로 다룬다.', '["목표별 주간 점검 리듬이 있는가 본다","확신도가 떨어진 목표를 먼저 다룬다","분기 말에야 처음 점검하면 짚는다"]'::jsonb, array['briefing', 'plan', 'prep']::text[], array['주간 점검', 'OKR', '체크인', '확신도', '목표 관리', '리듬']::text[], 607, '목표를 세운 다음', '분기 말에 처음 확인하는 목표는 이미 늦다. 짧고 잦은 점검이 목표를 살아 있게 한다.', '1월에 세운 목표를 6월 중간평가 때 처음 다시 열어 봄', '매주 월요일 10분: 목표 4개 확신도 표시, ''낮음'' 1개만 집중 논의', 'John Doerr 『Measure What Matters』 · Intel 주간 점검', 'global'),
  ('goal_change', 'goal', 'principle'::public.knowhow_kind, 2, '목표 수정은 세 가지 경우에만', '목표는 상위 목표가 바뀌었을 때, 업무 분장이 바뀌었을 때, 중대한 새 과업이 생겼을 때 고친다. "달성이 어려워서"는 수정 이유가 아니다. 고칠 때는 이유를 남긴다.', '["수정 이유가 세 경우인지 확인한다","어렵다는 이유로 목표를 낮추지 않는다","수정할 때 사유를 기록한다"]'::jsonb, array['plan', 'prep', 'strategy']::text[], array['목표수정', '재계획', '하향 조정']::text[], 608, '목표를 고치자는 말이 나올 때', '어려울 때마다 목표를 낮추면 목표가 기대가 아니라 예측이 된다.', '3분기 진척이 낮아 연간 목표를 20% 하향', '본부 방침 변경(신사업 보류)으로 목표 2를 수정, 사유와 날짜 기록', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('keep_stop', 'goal', 'framework'::public.knowhow_kind, 2, '지속·보완·중단 회고', '분기마다 목표를 지속·보완·중단 중 하나로 정한다. 일찍·크게 넘었다면 목표가 쉬웠는지, 실제로 상위 목표에 기여했는지 본다. 통제할 수 없는 이유로 막혔다면 수정·중단을, 순항이면 지속을. 중단할 때는 배운 것을 남긴다.', '["초과 달성이면 목표 난이도를 되묻는다","외부 요인 막힘이면 수정·중단 검토","중단할 때 배운 점을 기록한다"]'::jsonb, array['strategy', 'briefing']::text[], array['회고', '분기점검', '중단', '지속']::text[], 609, '분기 점검', '분기 점검이 없으면 이미 의미가 없어진 목표에 연말까지 자원이 계속 들어간다.', '6월에 사실상 멈춘 목표가 연말 평가표에 그대로 남음', '2분기 점검: 목표 3 중단(시장 철수), 배운 점 2줄 기록 → 인력은 목표 1로', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('task_naming', 'goal', 'principle'::public.knowhow_kind, 2, '과제 이름은 효과가 보이게', '과제 이름은 "(효과)를 위한 (활동)" 또는 "(활동)을 통한 (효과)"로 쓴다. "검토 철저", "관리 강화"처럼 끝을 알 수 없는 이름은 무엇이 되면 끝인지 드러나게 고친다. 할 일은 담당자가 바로 손댈 수 있는 행동 단위로.', '["과제명에 효과와 활동을 함께","끝이 안 보이는 이름은 고친다","할 일은 행동 단위로 쪼갠다"]'::jsonb, array['plan']::text[], array['과제명', '과제설계', '할 일']::text[], 610, '과제를 만들 때', '이름에 효과가 없으면 과제가 왜 있는지 잊히고, 끝이 없으면 진척을 잴 수 없다.', '고객 관리 강화', '재구매율 개선을 위한 이탈 고객 3단계 연락 체계 도입', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('oo_flow', 'coach', 'coaching'::public.knowhow_kind, 1, '1on1 대화 순서', '근황과 지난 이후 변화 → 잘된 것과 어려웠던 것(그 원인) → 앞으로의 우선순위와 목표 유지·수정 → 내가 도울 것. 팀장이 지키지 못한 약속이 있으면 그것부터 꺼낸다. 진척 확인은 체크인으로 보고, 1on1에서는 사람과 막힘을 본다.', '["밀린 팀장 약속을 첫 안건으로","마지막 질문은 내가 도울 것","1on1에서 진척 점검만 하지 않는다"]'::jsonb, array['prep']::text[], array['1on1', '면담', '대화', '약속']::text[], 701, '1on1을 준비할 때', '1on1은 팀장의 보고 시간이 아니라 팀원의 시간이다. 순서가 있어야 매번 진척 확인으로 끝나지 않는다.', '과제별 진척을 차례로 묻고 15분 만에 종료', '지난번 약속한 예산 확인부터 → 요즘 막힌 것 → 다음 2주 우선순위 → ''내가 뭘 도우면 될까요?''', 'ATEAM 현장 컨설팅 기준 · Andy Grove 『High Output Management』', 'field'),
  ('ask_or_tell', 'coach', 'coaching'::public.knowhow_kind, 2, '팀원 수준에 맞춘 대화', '스스로 판단할 수 있는 팀원에게는 질문으로 깨닫게 하는 대화를 80%, 아직 기준이 서지 않은 팀원에게는 기대와 방법을 직접 알려 주는 대화를 80%로 한다. 질문은 무엇을·어떻게로 열고, 추궁형(언제까지, 왜 안 했나)은 쓰지 않는다.', '["판단 깊이 높으면 질문형으로","판단 깊이 낮으면 방법과 예시 먼저","추궁형 질문은 쓰지 않는다"]'::jsonb, array['prep', 'review']::text[], array['코칭', '질문', '티칭', '수준']::text[], 702, '코칭 방식을 정할 때', '같은 질문도 경험 많은 사람에겐 성장이 되고, 신입에겐 막막함이 된다. 업무 성숙도에 따라 방식을 바꿔야 한다.', '입사 2개월 차에게 ''어떻게 하면 좋을 것 같아요?''만 반복', '신입에겐 예시 보고서와 순서를 먼저, 5년 차에겐 ''반대하는 사람은 뭘 물을까요?''', '상황적 리더십(Hersey·Blanchard) · Andy Grove ''업무 성숙도''', 'field'),
  ('feedback_four', 'coach', 'coaching'::public.knowhow_kind, 1, '피드백은 관찰→영향→기대→질문', '관찰한 행동을 사실로 말하고, 그 행동이 일이나 팀에 준 영향을 말하고, 기대하는 다음 행동을 말한 뒤, 상대의 생각을 묻는다. "항상, 늘" 같은 일반화와 성격·태도 판단은 쓰지 않는다.', '["사실→영향→기대→질문 순서로","일반화·성격 판단은 쓰지 않는다","기대는 관찰 가능한 행동으로"]'::jsonb, array['prep', 'review']::text[], array['피드백', 'SBI', '관찰', '영향']::text[], 703, '피드백을 줄 때', '사실로 시작하면 방어가 줄고, 기대를 행동으로 말하면 다음에 무엇을 할지 분명해진다.', '요즘 일에 집중을 안 하는 것 같아요', '어제 회의에서 숫자 출처가 없어 질문이 몰렸어요(관찰·영향). 다음엔 각주로 달아 줄래요(기대)? 어떻게 생각해요?', 'CCL(Center for Creative Leadership) SBI 모델 · ATEAM 현장 기준', 'field'),
  ('recognition', 'coach', 'coaching'::public.knowhow_kind, 2, '인정은 구체적으로, 고르게', '인정은 구체적 행동과 그 결과를 짚어 바로 한다. 성과가 있는데 인정이 끊기면 사람은 "내가 뭘 했지"를 느낀다. 인정이 한두 사람에게 몰리지 않게 고르게 나누고, 위로 보고할 때 기여한 사람의 이름을 넣는다.', '["행동과 결과를 짚어 칭찬한다","인정이 몰리지 않게 고르게","상향 보고에 기여자 이름을 넣는다"]'::jsonb, array['prep', 'briefing']::text[], array['칭찬', '인정', '동기']::text[], 704, '성과·기여가 보일 때', '구체적인 인정은 어떤 행동이 이 팀에서 가치 있는지 알려 주는 가장 빠른 신호다.', '다들 수고 많았어요', '서연 님이 채널별 전환율을 다시 뽑아 줘서 예산 재배분 결정이 하루 만에 났어요', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('demotivation', 'coach', 'coaching'::public.knowhow_kind, 2, '동기 저하 원인별 대응', '비판에 민감해진 사람에게는 구체적인 기준과 지침을, 소외감을 느끼는 사람에게는 핵심 업무에 참여할 기회를, 일의 의미를 잃은 사람에게는 그 일이 목표와 고객에 어떻게 이어지는지를 준다. 성장하고 싶은 사람에게는 성공 가능성 50~70% 정도의 한 단계 어려운 일을 맡긴다.', '["원인을 먼저 구분하고 대응한다","도전 과제는 성공 가능성 50~70%로","컨디션이 낮을 때는 독려보다 지원"]'::jsonb, array['prep']::text[], array['동기부여', '몰입', '이탈', '컨디션']::text[], 705, '몰입이 떨어져 보일 때', '원인이 다른데 같은 처방(격려·압박)을 쓰면 오히려 악화된다.', '누구에게나 ''힘내요, 조금만 더''', '소외감 → 다음 런칭 회의에 정식 참여 / 의미 상실 → 고객 VOC를 직접 보여 줌', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('grow', 'coach', 'framework'::public.knowhow_kind, 2, 'GROW로 코칭 대화를 이끈다', '답을 바로 주기 전에 네 단계로 묻는다. 원하는 결과는 무엇인가(Goal), 지금은 어떤 상황인가(Reality), 할 수 있는 방법은 무엇인가(Options), 무엇을 언제 하겠는가(Will). 마지막 단계에서는 팀원이 스스로 다음 행동과 날짜를 말하게 한다.', '["답보다 질문으로 시작하는가 본다","지금 상황을 사실로 확인했는가 본다","팀원이 스스로 다음 행동을 정했는가 본다"]'::jsonb, array['prep']::text[], array['GROW', '코칭', '질문', '1on1', '면담', '성장', '고민']::text[], 706, '팀원이 고민을 가져왔을 때', '스스로 찾은 답은 지시받은 답보다 실행될 가능성이 높고, 다음에 혼자 풀 힘을 기른다.', '그건 이렇게 하면 돼 (2분 만에 정답 지시)', '이번 주까지 어떤 상태면 좋겠어요? … 그중 뭐부터 해 볼래요? 언제까지요?', 'John Whitmore 『Coaching for Performance』', 'global'),
  ('psych_safety', 'coach', 'coaching'::public.knowhow_kind, 1, '말해도 안전한 팀을 만든다', '팀원이 실수·모름·반대를 말해도 불이익이 없다고 믿을 때 문제가 일찍 드러난다. 팀장이 먼저 ''내가 놓친 게 있을까요?''라고 묻고, 나쁜 소식을 가져온 사람에게 고맙다고 말하고, 실수는 사람이 아니라 절차의 문제로 다룬다.', '["나쁜 소식을 가져온 사람을 인정하는가 본다","실수를 사람 탓으로 다루면 짚는다","팀장이 먼저 의견을 구하는가 본다"]'::jsonb, array['prep', 'briefing']::text[], array['심리적 안전감', '팀 문화', '실수', '신뢰', '회의', '막힘', '이슈 공유']::text[], 707, '팀 회의·실수 보고 때', 'Google이 180개 팀을 연구한 Project Aristotle에서 좋은 팀을 가른 첫 번째 요인은 누가 팀에 있느냐가 아니라 심리적 안전감이었다.', '오류를 보고한 팀원에게 ''왜 이제 말해요?'' → 다음부터 보고가 늦어짐', '일찍 말해 줘서 고마워요. 어디서 걸렸는지 같이 보죠.', 'Google re:Work Project Aristotle · Amy Edmondson', 'global'),
  ('care_challenge', 'coach', 'coaching'::public.knowhow_kind, 2, '아끼는 마음으로, 분명하게 말한다', '좋은 피드백은 사람을 아끼는 마음과 분명한 지적을 함께 갖는다. 아끼기만 하고 말하지 않으면 상대는 성장할 기회를 잃고, 지적만 하면 상처만 남는다. 말하기 어려운 피드백일수록 일찍, 직접, 따로 한다.', '["지적이 구체적이고 분명한가 본다","돌려 말해 흐려지면 짚는다","공개 지적보다 따로 말하기를 권한다"]'::jsonb, array['prep', 'review']::text[], array['피드백', '쓴소리', '솔직함', '코칭', '관계', '개선점']::text[], 708, '쓴소리를 해야 할 때', '불편해서 미룬 피드백은 평가 시즌에 ''처음 듣는 나쁜 소식''으로 돌아온다.', '석 달째 같은 문제를 참다가 평가 면담에서 처음 언급', '회의 직후 따로: 발표 좋았어요. 다만 숫자 출처가 없어 질문이 몰렸어요. 다음엔 각주로 달아 봐요.', 'Kim Scott 『Radical Candor』', 'global'),
  ('feedforward', 'coach', 'coaching'::public.knowhow_kind, 2, '지난 일보다 다음 행동을 말한다', '이미 지난 일을 따지기보다 다음에 무엇을 다르게 할지에 대화를 쓴다. ''왜 그랬어요?'' 대신 ''다음엔 어떻게 해 볼까요?''로 묻고, 제안은 하나나 둘로 좁힌다. 상대가 방어하지 않고 바로 써먹을 수 있게 한다.', '["피드백이 다음 행동으로 끝나는가 본다","제안을 1~2개로 좁혔는가 본다","과거 추궁형 질문을 짚는다"]'::jsonb, array['prep', 'review']::text[], array['피드포워드', '피드백', '코칭', '개선', '성장', '다음 행동']::text[], 709, '개선점을 전할 때', '과거는 바꿀 수 없지만 다음 행동은 바꿀 수 있다. 미래를 말하면 방어 대신 아이디어가 나온다.', '지난번 보고서 왜 그렇게 썼어요?', '다음 보고서는 첫 문단에 결론 두 줄을 먼저 써 보면 어때요?', 'Marshall Goldsmith ''Feedforward''', 'global'),
  ('growth_talk', 'coach', 'coaching'::public.knowhow_kind, 2, '분기에 한 번, 성장 대화', '업무 점검과 따로 분기에 한 번은 성장만 이야기한다. 요즘 가장 몰입한 일, 강점이 잘 쓰인 장면, 더 해 보고 싶은 일, 1년 뒤 되고 싶은 모습. 들은 것 중 하나를 다음 분기 업무 배정에 실제로 반영한다.', '["업무 점검과 성장 대화를 구분하는가 본다","팀원의 바람을 업무 배정에 반영했는가 본다","성장 대화가 6개월 넘게 없으면 짚는다"]'::jsonb, array['prep', 'briefing']::text[], array['경력 개발', '성장', '커리어', '1on1', '육성', '동기', '강점']::text[], 710, '분기 1on1·평가 전후', 'Google Project Oxygen이 꼽은 좋은 매니저의 행동에 ''경력 개발을 돕고 성과를 이야기한다''가 들어 있다. 성장 대화가 없는 팀에서는 이탈 신호가 늦게 보인다.', '1on1이 매번 진척 확인으로만 끝남', '해 보고 싶다던 데이터 분석, 다음 프로젝트 지표 설계를 맡아 볼래요?', 'Google Project Oxygen · Career Conversation', 'global'),
  ('work_ecs', 'team', 'framework'::public.knowhow_kind, 2, '업무를 핵심·공통·지원으로 나누기', '업무를 중요도와 난이도로 나누면 핵심(강화·집중), 공통(표준화·매뉴얼), 지원(축소·자동화·외부)으로 갈린다. 사람이 아니라 업무 기준으로 본다. 경험 많은 사람이 지원 업무를 오래 들고 있거나, 신입이 핵심 업무에 과부하면 배분을 다시 본다.', '["업무를 핵심·공통·지원으로 나눈다","지원 업무부터 줄이거나 넘긴다","업무 가치와 담당자 수준을 맞춘다"]'::jsonb, array['strategy', 'scenario', 'briefing']::text[], array['업무분류', '재배분', '업무량', '과부하']::text[], 801, '업무 배분·업무량을 볼 때', '업무 가치와 담당자 수준이 어긋나면 비싼 사람이 싼 일을 하고, 성장해야 할 사람은 버거운 일에 묶인다.', '8년 차가 주간 데이터 취합을 2년째 담당', '데이터 취합은 자동화·신입에게, 8년 차는 신규 제휴 기획에 집중', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('delegation', 'team', 'principle'::public.knowhow_kind, 1, '위임 판단 세 가지 축', '팀 안에서 끝나는 일인가, 해 본 적 있는 일인가, 실행 성격의 일인가. 셋 다 맞으면 팀원이 결정하게 넘긴다. 처음 하는 일·방향을 정하는 일은 팀장이 쥐고, 돈·법·인사가 걸린 일은 한 단계 위로 올린다. 과제마다 최종 책임자는 한 명이다.', '["팀 내·기존·실행 업무는 팀원에게 위임","신규·기획 업무는 팀장이 쥔다","과제마다 최종 책임자는 한 명"]'::jsonb, array['briefing', 'strategy']::text[], array['위임', '권한', 'RACI', '책임자']::text[], 802, '누가 결정할지 정할 때', '팀장이 모든 결정을 쥐면 팀장이 병목이 되고, 아무 기준 없이 넘기면 사고가 난다.', '모든 견적 승인을 팀장이 직접 → 평균 사흘 대기', '500만 원 이하·기존 거래처 견적은 담당자 결정, 신규 거래처만 팀장 승인', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('context_not_control', 'team', 'principle'::public.knowhow_kind, 1, '통제보다 맥락을 준다', '방법을 하나하나 지시하는 대신 왜 하는지, 무엇이 성공인지, 넘지 말아야 할 선(예산·일정·품질 하한)을 분명히 주고 방법은 맡긴다. 결과가 기대와 다르면 팀원을 탓하기 전에 내가 맥락을 충분히 줬는지 먼저 본다.', '["목적·성공 기준·제약을 함께 줬는가 본다","방법까지 세세히 지시하면 짚는다","결과가 빗나가면 맥락 전달을 먼저 본다"]'::jsonb, array['briefing', 'prep', 'strategy']::text[], array['권한 위임', '맥락', '자율', '마이크로매니징', '지시', '위임']::text[], 803, '일을 맡길 때', '맥락을 받은 팀원은 예상 밖 상황에서도 스스로 판단할 수 있다. 통제는 팀장을 병목으로 만든다.', '폰트는 12pt, 표는 3개, 순서는 이렇게…', '목적은 본부장 예산 승인, 성공은 2천만 원 확보, 금요일까지, 형식은 자유', 'Netflix ''Context, not Control'' · Google Project Oxygen', 'global'),
  ('staffing', 'team', 'principle'::public.knowhow_kind, 2, '충원 요청 전에 먼저 볼 것', '충원을 말하기 전에 축소·중단, 재배분, 위임, 프로세스 개선·자동화를 먼저 검토하고 남는 부족분만 요청한다. 요청에는 지금 업무량과 필요한 인원, 늘어난 이유, 내부에서 해 본 것, 선택지(정규·한시·지원), 충원하지 않으면 생길 일을 담는다.', '["충원 전에 내부 해소안을 먼저","부족분은 숫자로 보인다","미충원 시 영향을 함께 쓴다"]'::jsonb, array['briefing', 'report', 'scenario']::text[], array['충원', '인력운영', '채용', '인력']::text[], 804, '인력이 부족하다고 느낄 때', '내부 해소안 없이 올린 충원 요청은 대부분 ''먼저 해 보라''로 돌아온다.', '업무가 많아 1명 충원이 필요합니다', '주 52시간 기준 1.4명분 초과. 리포트 축소로 0.4명 해소, 남은 1명은 6개월 한시 요청', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('meeting_default', 'team', 'framework'::public.knowhow_kind, 2, '회의·지시의 기본값', '회의는 결정·공유·논의 중 목적을 정하고, 공유가 목적이면 글로 대신한다. 끝날 때 결정·담당·기한을 남긴다. 지시할 때는 목적, 결과물 모양, 기한, 판단 기준 네 가지를 함께 준다. 같은 결과물이 여러 번 다시 돌아오면 착수 때 결론과 목차를 먼저 맞춘다.', '["공유 목적 회의는 글로 대신한다","회의마다 결정·담당·기한을 남긴다","지시엔 목적·결과물·기한·기준","재작업 반복이면 목차부터 합의"]'::jsonb, array['briefing']::text[], array['회의', '지시', '운영체계', '재작업']::text[], 805, '회의를 열거나 일을 줄 때', '목적 없는 회의와 기준 없는 지시는 팀의 시간을 가장 크게 새게 하는 두 구멍이다.', '주간 회의 1시간 — 각자 진행 상황 읽기', '진행 공유는 전날 글로, 회의 30분은 결정 2건만. 끝나면 결정·담당·기한 기록', 'ATEAM 현장 컨설팅 기준', 'field'),
  ('team_norms', 'team', 'framework'::public.knowhow_kind, 2, '팀 규칙은 말로 정해 둔다', '응답 기대 시간, 보고 채널(급한 일·일반 공유), 회의 없는 시간, 문서 저장 위치, 부재 공유 방식처럼 매번 부딪히는 것들을 팀이 함께 정해 적어 둔다. 분기에 한 번 다시 보고 맞지 않는 규칙은 고친다.', '["반복되는 마찰이 규칙이 없어서인지 본다","채널·응답 시간 기준이 있는가 본다","규칙을 팀이 함께 정했는가 본다"]'::jsonb, array['briefing']::text[], array['팀 규칙', '그라운드 룰', '협업 방식', '소통', '팀 문화', '응답 시간']::text[], 806, '팀 셋업·같은 마찰이 반복될 때', '암묵적인 규칙은 사람마다 다르게 읽힌다. 적어 둔 규칙은 갈등을 사람 문제에서 방식 문제로 바꾼다.', '밤 10시 메신저에 답이 없다고 다음 날 서운함 표현', '급한 건 전화, 일반은 메신저(당일 답), 18시 이후는 다음 날 답', 'Working Agreement · Google re:Work ''구조와 명확성''', 'global'),
  ('aar', 'team', 'framework'::public.knowhow_kind, 1, '끝나면 네 가지를 돌아본다 (AAR)', '일이 끝나면 짧게 네 가지를 묻는다. 원래 무엇을 하려 했나, 실제로 무슨 일이 있었나, 왜 차이가 났나, 다음에 무엇을 유지하고 무엇을 바꿀까. 누구 잘못인지가 아니라 무엇을 배웠는지에 집중하고, 배운 점은 다음 계획에 실제로 넣는다.', '["계획과 실제의 차이를 짚었는가 본다","책임 추궁이 아닌 배움 중심인가 본다","배운 점이 다음 계획에 반영됐는가 본다"]'::jsonb, array['briefing', 'strategy', 'review']::text[], array['회고', 'AAR', '레슨런', '사후 검토', '개선', '프로젝트 종료', '결과 보고']::text[], 807, '프로젝트·행사·분기 종료', '같은 실수가 반복되는 팀은 돌아보지 않는 팀이다. 15분 회고가 다음 프로젝트의 몇 주를 아낀다.', '프로젝트 종료 후 바로 다음 일 착수, 같은 일정 지연 반복', '계획 6주 → 실제 8주. 원인: 법무 검토를 늦게 요청. 다음엔 착수 주에 법무 미팅', '미 육군 After Action Review · 애자일 회고', 'global'),
  ('dod', 'team', 'rubric'::public.knowhow_kind, 2, '''다 됐다''의 기준을 먼저 정한다', '시작할 때 ''완료''의 조건을 적어 둔다. 어떤 결과물이, 누구의 확인을 거쳐, 어디에 올라가 있으면 끝인가. ''거의 다 됐어요''가 반복되면 완료 기준이 없는 것이다. 완료 기준에는 검증(검수·테스트·승인)을 포함한다.', '["과제에 완료 기준이 있는가 본다","완료에 검증 단계가 들어 있는가 본다","''거의 다 됨''이 반복되면 기준을 묻는다"]'::jsonb, array['plan', 'review', 'briefing']::text[], array['완료 기준', '마감', '품질', '검수', '과제 관리', '진척률']::text[], 808, '일을 맡기거나 마감할 때', '사람마다 ''끝''의 정의가 다르면 진척률 90%에서 몇 주가 흐른다.', '진척률 90%로 3주째 그대로', '완료 = 최종본 공유 폴더 업로드 + 법무 검토 회신 + 팀장 승인', '애자일 ''Definition of Done''', 'global'),
  ('focus_time', 'team', 'principle'::public.knowhow_kind, 2, '몰입 시간을 지켜 준다', '깊이 생각해야 하는 일에는 두 시간 이상 끊기지 않는 시간이 필요하다. 팀 차원에서 회의 없는 시간대를 정하고, 회의와 단순 요청은 특정 시간에 묶는다. 팀장의 즉흥 요청이 팀원의 몰입을 가장 많이 깬다.', '["팀에 회의 없는 시간이 있는가 본다","회의가 하루에 흩어져 있으면 짚는다","즉흥 요청을 묶어서 하는가 본다"]'::jsonb, array['briefing', 'scenario']::text[], array['몰입', '딥워크', '회의', '생산성', '집중', '시간 관리']::text[], 809, '회의·요청이 많을 때', '한 번 끊긴 집중을 되찾는 데는 생각보다 오래 걸린다. 잘게 쪼개진 하루로는 깊은 결과물이 나오지 않는다.', '오전 10시·11시, 오후 2시·4시에 30분 회의 4개', '화·목 오전은 회의 없는 시간, 팀 회의는 월요일 오후에 몰아서', 'Cal Newport 『Deep Work』 · Paul Graham ''Maker''s Schedule''', 'global'),
  ('onboarding', 'team', 'framework'::public.knowhow_kind, 2, '새 팀원의 첫 30일을 설계한다', '새 팀원에게 첫 30일 계획을 준다. 1주차 사람·도구·맥락 익히기, 2~3주차 작은 일 하나 끝내 보기, 4주차 첫 성과 공유. 도와줄 동료(버디)를 한 명 붙이고, 주 1회 짧은 1on1로 막힌 것을 묻는다. 첫 작은 성공을 의도적으로 만든다.', '["새 팀원에게 30일 계획이 있는가 본다","버디가 정해졌는가 본다","첫 달에 끝낼 수 있는 작은 과제를 줬는가 본다"]'::jsonb, array['prep', 'briefing', 'plan']::text[], array['온보딩', '신규 입사', '적응', '버디', '신입', '전입', '신규']::text[], 810, '신규 입사·전입', '첫 달의 경험이 이후의 몰입과 이탈을 크게 좌우한다. 방치된 새 팀원은 일보다 눈치를 먼저 배운다.', '첫 주에 자료 폴더만 공유하고 ''일단 보고 있어요''', '30일 계획표 + 버디 + 3주차 ''고객 VOC 요약'' 같은 작은 과제', '30-60-90일 온보딩 · Google re:Work', 'global');

-- ① 팀장이 고치지 않은 카드(지금 원본과 글자까지 같은 카드)만 새 문안으로
update public.knowhow_cards c
   set title = p.title, body = p.body, rules = p.rules
  from public.knowhow_templates t
  join _pb p on p.key = t.key
 where c.source = 'consulting' and c.template_key = t.key
   and c.title = t.title and c.body = t.body and c.rules = t.rules
   and (c.title, c.body, c.rules) is distinct from (p.title, p.body, p.rules);
-- 키워드는 화면에 보이지 않고 AI가 상황에 맞는 카드를 고를 때만 쓴다 → 늘 최신으로
update public.knowhow_cards c set keywords = p.keywords
  from _pb p where c.source = 'consulting' and c.template_key = p.key and c.keywords is distinct from p.keywords;

-- ② 원본 갱신
insert into public.knowhow_templates (key, kind, title, body, rules, applies_to, keywords, sort, domain, tier, situation, why, example_bad, example_good, origin, origin_type, updated_at)
select key, kind, title, body, rules, applies_to, keywords, sort, domain, tier, situation, why, example_bad, example_good, origin, origin_type, now() from _pb
on conflict (key) do update set kind = excluded.kind, title = excluded.title, body = excluded.body, rules = excluded.rules,
  applies_to = excluded.applies_to, keywords = excluded.keywords, sort = excluded.sort, domain = excluded.domain, tier = excluded.tier,
  situation = excluded.situation, why = excluded.why, example_bad = excluded.example_bad, example_good = excluded.example_good,
  origin = excluded.origin, origin_type = excluded.origin_type, updated_at = now();
drop table if exists pg_temp._pb;

-- ③ 모든 팀에 새 카드 (없는 것만 · 고친 카드는 건드리지 않음)
do $$ declare r record; begin
  for r in select id from public.teams loop perform public._install_consulting_cards(r.id); end loop;
end $$;

-- ---------- 데모 팀: 플레이북이 실제로 쓰인 모습 ----------
create or replace function public.seed_demo_playbook(p_team uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v1 uuid; v2 uuid;
  k_concl uuid; k_plan uuid; k_num uuid;
  p_hyp uuid; p_pre uuid; p_pyr uuid; p_base uuid; p_root uuid; p_crit uuid;
  pick uuid; con jsonb;
begin
  if not exists (select 1 from teams where id = p_team and is_demo) then return; end if;
  perform public._install_consulting_cards(p_team);

  -- AI 결과에 반영된 횟수 (6개월 운영한 팀처럼)
  update knowhow_cards c set use_count = v.n, last_used_at = now() - make_interval(days => v.d)
  from (values ('pyramid', 23, 0), ('so_what', 14, 1), ('action_title', 12, 2), ('feedback_four', 11, 1), ('upward_report', 10, 3),
               ('hypothesis', 9, 0), ('number_sense', 9, 2), ('oo_flow', 9, 1), ('criteria_first', 8, 0), ('mece', 7, 4),
               ('early_check', 7, 2), ('grow', 7, 1), ('premortem', 6, 0), ('ghost_deck', 6, 5), ('recognition', 6, 3),
               ('psych_safety', 5, 6), ('work_ecs', 5, 7), ('customer_job', 5, 9), ('door_type', 4, 4), ('small_bet', 4, 8),
               ('onboarding', 4, 2), ('baseline_target', 3, 1), ('root_cause', 3, 1), ('clarify_ask', 3, 6), ('priority_matrix', 2, 10))
       as v(k, n, d)
  where c.team_id = p_team and c.template_key = v.k;
  -- 팀원에게 공개 (팀원 화면의 '팀장 가이드')
  update knowhow_cards set shared = true
  where team_id = p_team and source = 'consulting' and template_key in ('pyramid', 'action_title', 'clarify_ask', 'early_check', 'hypothesis');

  -- 업무플랫폼 AI 1차 검토: 내 노하우 + 플레이북을 함께 적용한 기록
  select id into k_concl from knowhow_cards where team_id = p_team and source = 'team' and title = '결론부터, 한 장으로' limit 1;
  select id into k_plan from knowhow_cards where team_id = p_team and source = 'team' and title = '좋은 기획서의 조건' limit 1;
  select id into k_num from knowhow_cards where team_id = p_team and source = 'team' and title = '숫자에는 출처와 비교 기준' limit 1;
  select id into p_hyp from knowhow_cards where team_id = p_team and template_key = 'hypothesis';
  select id into p_pre from knowhow_cards where team_id = p_team and template_key = 'premortem';
  select id into p_pyr from knowhow_cards where team_id = p_team and template_key = 'pyramid';
  select id into p_base from knowhow_cards where team_id = p_team and template_key = 'baseline_target';
  select id into p_root from knowhow_cards where team_id = p_team and template_key = 'root_cause';
  select id into p_crit from knowhow_cards where team_id = p_team and template_key = 'criteria_first';

  select sv.id into v1 from submission_versions sv join submissions s on s.id = sv.submission_id
    where s.team_id = p_team and s.title = '하반기 신제품 런칭 캠페인 기획서' order by sv.version desc limit 1;
  select sv.id into v2 from submission_versions sv join submissions s on s.id = sv.submission_id
    where s.team_id = p_team and s.title = '콘텐츠 제작 프로세스 개선안' order by sv.version desc limit 1;

  if v1 is not null then
    update ai_outputs set
      sources = jsonb_build_array(
        jsonb_build_object('tag', 'E1', 'type', 'knowhow', 'id', k_concl, 'label', '내 노하우 · 결론부터, 한 장으로'),
        jsonb_build_object('tag', 'E2', 'type', 'knowhow', 'id', k_plan, 'label', '내 노하우 · 좋은 기획서의 조건'),
        jsonb_build_object('tag', 'E3', 'type', 'knowhow', 'id', k_num, 'label', '내 노하우 · 숫자에는 출처와 비교 기준'),
        jsonb_build_object('tag', 'E4', 'type', 'consulting', 'id', p_hyp, 'label', 'ATEAM Method™ · 가설부터 세우고 검증한다'),
        jsonb_build_object('tag', 'E5', 'type', 'consulting', 'id', p_pre, 'label', 'ATEAM Method™ · 시작 전에 실패를 상상한다 (사전 부검)'),
        jsonb_build_object('tag', 'E6', 'type', 'submission', 'id', null, 'label', '이전 버전 v2')),
      content = content || jsonb_build_object('criteria_check', jsonb_build_array(
        jsonb_build_object('criterion', '결론부터, 한 장으로', 'met', false, 'note', '§1 시장 분석으로 시작해 결론(얼리버드 할인)이 §2에 묻혀 있습니다.', 'tag', 'E1'),
        jsonb_build_object('criterion', '좋은 기획서의 조건', 'met', true, 'note', '§2에서 정가 런칭·상시 할인을 비교하고 버린 이유를 밝혔습니다.', 'tag', 'E2'),
        jsonb_build_object('criterion', '숫자에는 출처와 비교 기준', 'met', true, 'note', '시장 규모·성장률·점유율에 수치를 달았습니다. 출처 표기는 보완하면 좋습니다.', 'tag', 'E3'),
        jsonb_build_object('criterion', '가설부터 세우고 검증한다', 'met', true, 'note', '가설마다 검증 방법(예약 페이지 데이터, FGI 12명)을 짝지었습니다.', 'tag', 'E4'),
        jsonb_build_object('criterion', '사전 부검', 'met', false, 'note', 'B사 데이터가 늦어질 때 같은 실패 시나리오와 대응이 없습니다.', 'tag', 'E5')))
    where team_id = p_team and kind = 'review' and ref_table = 'submission_versions' and ref_id = v1;
  end if;
  if v2 is not null then
    update ai_outputs set
      sources = jsonb_build_array(
        jsonb_build_object('tag', 'E1', 'type', 'knowhow', 'id', k_concl, 'label', '내 노하우 · 결론부터, 한 장으로'),
        jsonb_build_object('tag', 'E2', 'type', 'knowhow', 'id', k_plan, 'label', '내 노하우 · 좋은 기획서의 조건'),
        jsonb_build_object('tag', 'E3', 'type', 'consulting', 'id', p_base, 'label', 'ATEAM Method™ · 목표치엔 기준선과 산정 근거'),
        jsonb_build_object('tag', 'E4', 'type', 'consulting', 'id', p_root, 'label', 'ATEAM Method™ · 원인은 다섯 번 묻는다'),
        jsonb_build_object('tag', 'E5', 'type', 'consulting', 'id', p_crit, 'label', 'ATEAM Method™ · 기준을 먼저 정하고 대안을 본다')),
      content = content || jsonb_build_object('criteria_check', jsonb_build_array(
        jsonb_build_object('criterion', '결론부터, 한 장으로', 'met', true, 'note', '첫 줄에 개선안 세 가지를 먼저 밝혔습니다.', 'tag', 'E1'),
        jsonb_build_object('criterion', '좋은 기획서의 조건', 'met', false, 'note', '다른 개선 방법과 비교하거나 버린 이유가 없습니다.', 'tag', 'E2'),
        jsonb_build_object('criterion', '목표치엔 기준선과 산정 근거', 'met', false, 'note', '기준선(리드타임 3주)은 있지만 목표치와 개선별 단축 효과 추정이 없습니다.', 'tag', 'E3'),
        jsonb_build_object('criterion', '원인은 다섯 번 묻는다', 'met', false, 'note', '리드타임이 긴 원인을 단계별로 짚지 않고 일반적인 개선책으로 바로 갔습니다.', 'tag', 'E4')))
    where team_id = p_team and kind = 'review' and ref_table = 'submission_versions' and ref_id = v2;
  end if;

  -- 다른 AI 결과에도 '적용한 기준'이 남게 (가장 최근 것 하나씩, 이미 있으면 건너뜀)
  for pick, con in
    select o.id, x.c from (values
        ('one_on_one_prep', '[["oo_flow","1on1 대화 순서"],["grow","GROW로 코칭 대화를 이끈다"],["recognition","인정은 구체적으로, 고르게"]]'),
        ('weekly_report', '[["pyramid","결론 먼저, 근거는 그 아래 (피라미드 원칙)"],["upward_report","상향 보고의 순서"]]'),
        ('exec_brief', '[["boss_lens","상사의 관심사로 번역한다"],["answer_first","물으면 답부터, 설명은 그다음"],["bad_news","나쁜 소식은 먼저, 대응안과 함께"]]'),
        ('advisor_weekly', '[["work_ecs","업무를 핵심·공통·지원으로 나누기"],["priority_matrix","중요도와 긴급도로 나눈다"],["onboarding","새 팀원의 첫 30일을 설계한다"]]'),
        ('insight_weekly', '[["weekly_rhythm","목표는 매주 굴린다"],["psych_safety","말해도 안전한 팀을 만든다"]]'))
      as x(k, c)
    cross join lateral (select id from ai_outputs where team_id = p_team and kind::text = x.k order by created_at desc limit 1) o
  loop
    update ai_outputs a set sources = (case when jsonb_typeof(a.sources) = 'array' then a.sources else '[]'::jsonb end) || (
        select coalesce(jsonb_agg(jsonb_build_object('tag', 'E' || (90 + e.ord), 'type', 'consulting', 'id', kc.id, 'label', 'ATEAM Method™ · ' || (e.v ->> 1)) order by e.ord), '[]'::jsonb)
        from jsonb_array_elements(con::jsonb) with ordinality as e(v, ord)
        left join knowhow_cards kc on kc.team_id = p_team and kc.template_key = e.v ->> 0)
    where a.id = pick and not (coalesce(a.sources, '[]'::jsonb) @> '[{"type": "consulting"}]'::jsonb);
  end loop;
end $fn$;
revoke all on function public.seed_demo_playbook(uuid) from public, anon, authenticated;

do $$ declare r record; begin
  for r in select id from public.teams where is_demo loop perform public.seed_demo_playbook(r.id); end loop;
end $$;

-- >>>>>>>>>> 20261108000035_history.sql
-- =====================================================================
-- 30_history.sql — 히스토리 관리 (Pro부터)
--   과제마다 '살아 있는 히스토리' 한 장: 매주 새 기록을 기존 히스토리에 합치고 묶고 연결해서 고쳐 쓴다 (ai-task-history)
--   팀장이 고정·숨김·고친 줄은 다음 업데이트에서도 그대로 (edits)
--   팀장 → 팀원 '전달': 보낸 순간의 히스토리를 사본(snapshot)으로 남긴다. 팀원은 받은 사본만 본다
--   전달마다 확인 · 질문/답변 — 질문과 답은 다음 업데이트에 그 과제 히스토리로 들어간다
--   넣지 않는 것: 1on1 · 컨디션 · 팀장 메모(AI 허용 안 한 것) · 평가 · 코칭
-- 다시 Run 해도 안전합니다.
-- =====================================================================

-- AI 종류
alter type public.ai_kind add value if not exists 'task_history';

-- ---------- 과제 히스토리 (팀장만) ----------
create table if not exists public.task_histories (
  item_id      uuid primary key references public.work_items(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  content      jsonb not null default '{}'::jsonb,   -- AI 정리 (현황 · 줄기 · 사건 · 관계자 · 확정/미결/이전 시도/리스크/확인 필요 · 관련 과제 · 진척)
  edits        jsonb not null default '{}'::jsonb,   -- 팀장 손질 { pinned: [id], hidden: [id], text: { id: '고친 문장' } }
  synced_at    timestamptz,                          -- 이 시각까지의 기록을 반영
  record_count int not null default 0,               -- 지금까지 반영한 기록 수
  new_count    int not null default 0,               -- 마지막 업데이트에서 새로 반영한 기록 수
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists task_histories_team_idx on public.task_histories (team_id, updated_at desc);

alter table public.task_histories enable row level security;
drop policy if exists th_select on public.task_histories;
create policy th_select on public.task_histories for select to authenticated using (public.is_team_leader(team_id));
drop policy if exists th_update on public.task_histories;
create policy th_update on public.task_histories for update to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
-- 만들기·AI 업데이트는 서버(service_role)만

-- ---------- 전달 (팀장 → 팀원) · 요청 (팀원 → 팀장) ----------
create table if not exists public.history_shares (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  item_id    uuid not null references public.work_items(id) on delete cascade,
  from_id    uuid references public.profiles(id) on delete set null,          -- 보낸 팀장 (요청이면 받을 팀장)
  to_id      uuid not null references public.profiles(id) on delete cascade,  -- 받는 팀원 (요청이면 요청한 팀원)
  note       text not null default '',                                        -- 팀장 한마디 / 요청 사유
  snapshot   jsonb not null default '{}'::jsonb,                              -- 보낸 순간의 히스토리 (팀장 손질 반영본)
  status     text not null default 'sent' check (status in ('requested', 'sent', 'read', 'declined')),
  sent_at    timestamptz,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists history_shares_to_idx on public.history_shares (to_id, created_at desc);
create index if not exists history_shares_item_idx on public.history_shares (item_id, created_at desc);

alter table public.history_shares enable row level security;
drop policy if exists hs_select on public.history_shares;
create policy hs_select on public.history_shares for select to authenticated
  using (to_id = auth.uid() or from_id = auth.uid() or public.is_team_leader(team_id));
-- 팀장: 전달 / 팀원: 내 과제가 아니어도 '요청'만
drop policy if exists hs_insert on public.history_shares;
create policy hs_insert on public.history_shares for insert to authenticated
  with check (
    (public.is_team_leader(team_id) and status = 'sent')
    or (to_id = auth.uid() and status = 'requested' and public.is_team_member(team_id))
  );
drop policy if exists hs_update on public.history_shares;
create policy hs_update on public.history_shares for update to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
drop policy if exists hs_delete on public.history_shares;
create policy hs_delete on public.history_shares for delete to authenticated
  using (public.is_team_leader(team_id) or (to_id = auth.uid() and status = 'requested'));

-- 팀원이 '확인했어요' (상태만 바꾼다)
create or replace function public.history_mark_read(p_share uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update history_shares set status = 'read', read_at = now(), updated_at = now()
   where id = p_share and to_id = auth.uid() and status = 'sent';
end $$;
revoke all on function public.history_mark_read(uuid) from public, anon;
grant execute on function public.history_mark_read(uuid) to authenticated;

-- ---------- 질문 · 답변 ----------
create table if not exists public.history_messages (
  id         uuid primary key default gen_random_uuid(),
  share_id   uuid not null references public.history_shares(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists history_messages_share_idx on public.history_messages (share_id, created_at);

alter table public.history_messages enable row level security;
drop policy if exists hm_select on public.history_messages;
create policy hm_select on public.history_messages for select to authenticated
  using (exists (select 1 from history_shares s where s.id = history_messages.share_id
                  and (s.to_id = auth.uid() or s.from_id = auth.uid() or public.is_team_leader(s.team_id))));
drop policy if exists hm_insert on public.history_messages;
create policy hm_insert on public.history_messages for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from history_shares s where s.id = history_messages.share_id and s.team_id = history_messages.team_id
                  and s.status <> 'requested' and (s.to_id = auth.uid() or public.is_team_leader(s.team_id))));
drop policy if exists hm_delete on public.history_messages;
create policy hm_delete on public.history_messages for delete to authenticated using (author_id = auth.uid());

-- ---------- 알림 ----------
create or replace function public._history_share_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  select title into v_title from work_items where id = new.item_id;
  if tg_op = 'INSERT' and new.status = 'sent' then
    perform public._notify(new.to_id, new.team_id, 'history', '팀장님이 과제 히스토리를 전달했습니다', coalesce(v_title, ''), '/my/history?id=' || new.id);
  elsif tg_op = 'INSERT' and new.status = 'requested' then
    perform public._notify(public._team_leader(new.team_id), new.team_id, 'history_request', '히스토리 요청: ' || coalesce(v_title, ''),
      coalesce((select full_name from profiles where id = new.to_id), '') || case when new.note <> '' then ' · ' || new.note else '' end,
      '/history?item=' || new.item_id || '&request=' || new.id);
  elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'sent' then
    perform public._notify(new.to_id, new.team_id, 'history', '요청한 히스토리가 도착했습니다', coalesce(v_title, ''), '/my/history?id=' || new.id);
  elsif tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'read' then
    perform public._notify(new.from_id, new.team_id, 'history_read', '전달한 히스토리를 확인했습니다',
      coalesce((select full_name from profiles where id = new.to_id), '') || ' · ' || coalesce(v_title, ''), '/history?item=' || new.item_id);
  end if;
  return new;
end $$;
drop trigger if exists t_history_share_notify on public.history_shares;
create trigger t_history_share_notify after insert or update on public.history_shares
  for each row execute function public._history_share_notify();

create or replace function public._history_message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s history_shares; v_title text;
begin
  select * into s from history_shares where id = new.share_id;
  select title into v_title from work_items where id = s.item_id;
  if new.author_id = s.to_id then
    perform public._notify(coalesce(s.from_id, public._team_leader(s.team_id)), s.team_id, 'history_question',
      '히스토리 질문: ' || coalesce(v_title, ''), left(new.body, 120), '/history?item=' || s.item_id || '&share=' || s.id);
  else
    perform public._notify(s.to_id, s.team_id, 'history_answer', '팀장님이 답했습니다: ' || coalesce(v_title, ''), left(new.body, 120), '/my/history?id=' || s.id);
  end if;
  update history_shares set updated_at = now() where id = new.share_id;
  return new;
end $$;
drop trigger if exists t_history_message_notify on public.history_messages;
create trigger t_history_message_notify after insert on public.history_messages
  for each row execute function public._history_message_notify();

-- ---------- 요금제: Pro · Pro+ ----------
update public.plans set features = array_append(features, 'history')
 where id in ('pro', 'pro_plus') and not ('history' = any(features));

-- ---------- 실시간 (받은 히스토리 · 질문 바로 반영) ----------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['history_shares', 'history_messages', 'task_histories'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- 매주 월요일 06:00 (KST) 자동 업데이트 ----------
--   히스토리를 켠(한 번이라도 만든) 팀마다 따로 부른다 — 팀 하나가 오래 걸려도 다른 팀은 영향 없게 (pg_net 비동기)
--   02_schedules.sql(예약 작업)을 실행한 프로젝트에서만 등록된다. 아니면 '지금 업데이트' 버튼으로 동작.
create or replace function public._history_weekly() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct team_id from task_histories loop
    if public.team_has_feature(r.team_id, 'history') then
      perform public._invoke_function('ai-task-history', jsonb_build_object('team_id', r.team_id, 'weekly', true));
    end if;
  end loop;
end $$;
revoke all on function public._history_weekly() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_proc where proname = '_invoke_function') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'task-history-weekly';
    perform cron.schedule('task-history-weekly', '0 21 * * 0', $c$ select public._history_weekly() $c$);
  end if;
end $$;

-- >>>>>>>>>> 20261109000036_invite_email.sql
-- =====================================================================
-- 31_invite_email.sql — 초대받은 메일로만 합류
--   · accept_invitation: 로그인한 계정 메일 ≠ 초대 메일이면 막는다 (INVITE_EMAIL_MISMATCH)
--     (메일 없이 만든 예전 초대는 그대로 허용)
--   · invitation_preview: 로그인 전에도 링크를 가진 사람은 팀 이름 · 초대 메일을 본다
--     → 가입 화면에서 초대 메일을 미리 채우고 고정
-- 다시 Run 해도 안전합니다.
-- =====================================================================

create or replace function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv invitations; v_usage jsonb; v_mail text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invitations where token = p_token for update;
  if not found then raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_inv.accepted_at is not null and v_inv.accepted_by <> auth.uid() then raise exception 'INVITE_USED' using errcode = 'P0001'; end if;
  if v_inv.expires_at < now() then raise exception 'INVITE_EXPIRED' using errcode = 'P0001'; end if;
  -- 초대받은 메일로 로그인해야 합류
  select lower(coalesce(u.email, '')) into v_mail from auth.users u where u.id = auth.uid();
  if coalesce(trim(v_inv.email), '') <> '' and lower(trim(v_inv.email)) <> coalesce(v_mail, '') then
    raise exception 'INVITE_EMAIL_MISMATCH' using errcode = 'P0001', hint = v_inv.email;
  end if;
  if v_inv.role = 'member' then
    v_usage := public.team_seat_usage(v_inv.team_id);
    if (v_usage->>'members')::int >= (v_usage->>'max_members')::int then
      raise exception 'PLAN_LIMIT_MEMBERS' using errcode = 'P0001';
    end if;
  end if;
  insert into team_members (team_id, user_id, role, job_title)
  values (v_inv.team_id, auth.uid(), v_inv.role, v_inv.job_title)
  on conflict (team_id, user_id) do update set status = 'active', role = excluded.role;
  update invitations set accepted_at = coalesce(accepted_at, now()), accepted_by = auth.uid() where id = v_inv.id;
  perform log_event(v_inv.team_id, 'member.joined', 'team_members', null, auth.uid());
  return v_inv.team_id;
end $$;

-- 링크(추측할 수 없는 토큰)를 가진 사람은 로그인 전에도 미리보기
grant execute on function public.invitation_preview(uuid) to anon, authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- >>>>>>>>>> 20261110000037_review_fixes.sql
-- =====================================================================
-- 32_review_fixes.sql — 전체 검토에서 나온 서버 쪽 수정
--   ① 요청 알림: 종류별로 실제 보이는 곳으로 링크 · 화면과 같은 이름(육성 · 지원·격려 · 업무 독려)
--   ② ATEAM 업무 피드백 알림 이름 · 히스토리 알림 링크 · 히스토리 요청 보류 알림
--   ③ 팀 확인: 히스토리 전달·요청 · 요청의 과제 · 코칭 대상이 같은 팀인지
--   ④ 내 메모(leader_notes)는 팀장만 쓴다 (팀원이 '팀장 메모'로 히스토리에 끼어들지 못하게)
--   ⑤ 초대: 팀장이 팀원 초대를 받아도 팀장 그대로 · 끝난 초대는 미리보기에 메일을 안 보여 줌
--   ⑥ 요금제 기능에 history 다시 확인 (21_plans_v3 를 다시 Run 해도 꺼지지 않게 — 21 파일도 함께 고침)
-- 다시 Run 해도 안전합니다.
-- =====================================================================

-- ---------- ① 요청 알림 ----------
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_up boolean; v_fb boolean;
begin
  v_up := new.to_id = public._team_leader(new.team_id);   -- 팀원 → 팀장
  -- 팀장 액션(매니징 보드 Feedback에 보이는 것): 육성 · 지원·격려 · 과제 없는 업무 독려
  v_fb := new.kind in ('grow', 'cheer') or (new.kind = 'progress' and new.item_id is null);
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case when v_up and new.kind = 'meeting' then '1on1 요청: ' when new.kind = 'change' then '목표 변경 요청: '
           when new.kind = 'meeting' then '1on1 요청: '
           when new.kind = 'grow' then '육성: ' when new.kind = 'cheer' then '지원·격려: '
           when new.kind = 'progress' and new.item_id is null then '업무 독려: '
           when new.kind = 'progress' then '성과입력 요청: ' when new.kind = 'plan' then '계획 요청: '
           else '요청: ' end || new.title,
      left(new.body, 120),
      case when new.kind = 'change' then '/goals/edit' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/people/' || new.from_id || '?oo=1'
           when v_fb then '/my/one-on-ones?req=' || new.id
           when new.kind = 'meeting' then '/my/one-on-ones'
           else '/my/submissions' end);
    if new.kind = 'plan' then
      if new.item_id is not null then update work_items set needs_plan = true where id = new.item_id and team_id = new.team_id; end if;
      if new.from_id = public._team_leader(new.team_id) then
        update teams set settings = coalesce(settings, '{}'::jsonb) || '{"plan_open": true}'::jsonb
         where id = new.team_id and not public.plan_open(new.team_id);
      end if;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case when v_up and new.kind = 'meeting' then '1on1 요청 확인: ' when new.kind = 'change' then '변경 요청 처리: '
           when new.kind = 'grow' then '육성 답: ' when new.kind = 'cheer' then '지원·격려 확인: '
           when new.kind = 'progress' and new.item_id is null then '업무 독려 답: '
           else '완료: ' end || new.title,
      left(new.response, 120),
      case when new.kind = 'change' then '/my/goals' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/my/one-on-ones'
           when v_fb then '/people?sent=1'
           when new.kind = 'meeting' then '/people/' || new.to_id || '?oo=1'
           else '/work/u/' || new.to_id end);
  end if;
  return new;
end $$;

-- 요청의 과제는 같은 팀 것만
drop policy if exists rq_insert on public.team_requests;
create policy rq_insert on public.team_requests for insert to authenticated
  with check (from_id = auth.uid() and public.is_team_member(team_id)
              and exists (select 1 from team_members m where m.team_id = team_requests.team_id and m.user_id = to_id and m.status = 'active')
              and (item_id is null or exists (select 1 from work_items w where w.id = team_requests.item_id and w.team_id = team_requests.team_id)));

-- ---------- ② 알림 이름 · 링크 ----------
do $$
begin
  if to_regclass('public.coaching_notes') is not null then
    create or replace function public._coaching_notify() returns trigger
    language plpgsql security definer set search_path = public as $f$
    begin
      insert into notifications (user_id, team_id, kind, title, body, link)
      values (new.member_id, new.team_id, 'coaching', 'ATEAM 업무 피드백이 도착했어요', new.title, '/my/one-on-ones?coach=' || new.id);
      return new;
    end $f$;
    -- 코칭 대상은 같은 팀의 팀원만
    drop policy if exists coaching_leader on public.coaching_notes;
    create policy coaching_leader on public.coaching_notes for all to authenticated
      using (public.is_team_leader(team_id))
      with check (public.is_team_leader(team_id)
                  and exists (select 1 from team_members m where m.team_id = coaching_notes.team_id and m.user_id = coaching_notes.member_id and m.status = 'active'));
  end if;
end $$;

do $$
begin
  if to_regclass('public.history_shares') is null then return; end if;

  create or replace function public._history_share_notify() returns trigger
  language plpgsql security definer set search_path = public as $f$
  declare v_title text;
  begin
    select title into v_title from work_items where id = new.item_id;
    if tg_op = 'INSERT' and new.status = 'sent' then
      perform public._notify(new.to_id, new.team_id, 'history', '팀장님이 과제 히스토리를 전달했습니다', coalesce(v_title, ''), '/my/one-on-ones?history=' || new.id);
    elsif tg_op = 'INSERT' and new.status = 'requested' then
      perform public._notify(public._team_leader(new.team_id), new.team_id, 'history_request', '히스토리 요청: ' || coalesce(v_title, ''),
        coalesce((select full_name from profiles where id = new.to_id), '') || case when new.note <> '' then ' · ' || new.note else '' end,
        '/history?item=' || new.item_id || '&request=' || new.id);
    elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'sent' then
      perform public._notify(new.to_id, new.team_id, 'history', '요청한 히스토리가 도착했습니다', coalesce(v_title, ''), '/my/one-on-ones?history=' || new.id);
    elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'declined' then
      perform public._notify(new.to_id, new.team_id, 'history', '히스토리 요청이 보류됐습니다', coalesce(v_title, '') || ' · 필요하면 팀장님께 직접 물어봐 주세요', '/my/one-on-ones');
    elsif tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'read' then
      perform public._notify(new.from_id, new.team_id, 'history_read', '전달한 히스토리를 확인했습니다',
        coalesce((select full_name from profiles where id = new.to_id), '') || ' · ' || coalesce(v_title, ''), '/history?item=' || new.item_id);
    end if;
    return new;
  end $f$;

  create or replace function public._history_message_notify() returns trigger
  language plpgsql security definer set search_path = public as $f$
  declare s history_shares; v_title text;
  begin
    select * into s from history_shares where id = new.share_id;
    select title into v_title from work_items where id = s.item_id;
    if new.author_id = s.to_id then
      perform public._notify(coalesce(s.from_id, public._team_leader(s.team_id)), s.team_id, 'history_question',
        '히스토리 질문: ' || coalesce(v_title, ''), left(new.body, 120), '/history?item=' || s.item_id || '&share=' || s.id);
    else
      perform public._notify(s.to_id, s.team_id, 'history_answer', '팀장님이 답했습니다: ' || coalesce(v_title, ''), left(new.body, 120), '/my/one-on-ones?history=' || s.id);
    end if;
    update history_shares set updated_at = now() where id = new.share_id;
    return new;
  end $f$;

  -- ③ 전달·요청은 같은 팀 과제 · 같은 팀 사람만, 팀원 요청은 히스토리 기능이 있는 팀에서만 (보낸 사람 칸은 비워 둔다)
  drop policy if exists hs_insert on public.history_shares;
  create policy hs_insert on public.history_shares for insert to authenticated
    with check (
      exists (select 1 from work_items w where w.id = history_shares.item_id and w.team_id = history_shares.team_id)
      and (
        (public.is_team_leader(team_id) and status = 'sent'
          and exists (select 1 from team_members m where m.team_id = history_shares.team_id and m.user_id = history_shares.to_id and m.status = 'active'))
        or (to_id = auth.uid() and status = 'requested' and from_id is null and public.is_team_member(team_id)
          and public.team_has_feature(team_id, 'history'))
      ));
end $$;

-- ---------- ④ 내 메모는 팀장만 쓴다 (읽기·지우기는 쓴 사람 그대로) ----------
do $$
begin
  if to_regclass('public.leader_notes') is null then return; end if;
  drop policy if exists leader_notes_owner on public.leader_notes;
  create policy leader_notes_owner on public.leader_notes for all to authenticated
    using (owner_id = auth.uid() and public.is_team_member(team_id))
    with check (owner_id = auth.uid() and public.is_team_leader(team_id));
end $$;

-- ---------- ⑤ 초대 ----------
create or replace function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv invitations; v_usage jsonb; v_mail text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invitations where token = p_token for update;
  if not found then raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_inv.accepted_at is not null and v_inv.accepted_by <> auth.uid() then raise exception 'INVITE_USED' using errcode = 'P0001'; end if;
  if v_inv.expires_at < now() then raise exception 'INVITE_EXPIRED' using errcode = 'P0001'; end if;
  -- 초대받은 메일로 로그인해야 합류
  select lower(coalesce(u.email, '')) into v_mail from auth.users u where u.id = auth.uid();
  if coalesce(trim(v_inv.email), '') <> '' and lower(trim(v_inv.email)) <> coalesce(v_mail, '') then
    raise exception 'INVITE_EMAIL_MISMATCH' using errcode = 'P0001', hint = v_inv.email;
  end if;
  if v_inv.role = 'member' then
    v_usage := public.team_seat_usage(v_inv.team_id);
    if (v_usage->>'members')::int >= (v_usage->>'max_members')::int
       and not exists (select 1 from team_members where team_id = v_inv.team_id and user_id = auth.uid() and status = 'active') then
      raise exception 'PLAN_LIMIT_MEMBERS' using errcode = 'P0001';
    end if;
  end if;
  insert into team_members (team_id, user_id, role, job_title)
  values (v_inv.team_id, auth.uid(), v_inv.role, v_inv.job_title)
  on conflict (team_id, user_id) do update
    set status = 'active', role = case when team_members.role = 'leader' then team_members.role else excluded.role end;
  update invitations set accepted_at = coalesce(accepted_at, now()), accepted_by = auth.uid() where id = v_inv.id;
  perform log_event(v_inv.team_id, 'member.joined', 'team_members', null, auth.uid());
  return v_inv.team_id;
end $$;

-- 끝난(합류·만료) 초대는 메일을 보여 주지 않는다 — 로그인 전에도 열리는 미리보기
create or replace function public.invitation_preview(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('team_name', t.name, 'inviter', p.full_name,
                            'email', case when i.accepted_at is null and i.expires_at >= now() then i.email else '' end,
                            'expired', i.expires_at < now(), 'accepted', i.accepted_at is not null)
  from invitations i join teams t on t.id = i.team_id join profiles p on p.id = i.invited_by
  where i.token = p_token;
$$;
grant execute on function public.invitation_preview(uuid) to anon, authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- ---------- ⑥ 요금제: Pro · Pro+ 에 history ----------
update public.plans set features = array_append(features, 'history')
 where id in ('pro', 'pro_plus') and not ('history' = any(features));

-- >>>>>>>>>> 20261111000038_plans_price.sql
-- =====================================================================
-- 요금제 가격 조정 — Starter ₩29,000 · Pro ₩49,000 · Pro+ ₩79,000 (월, VAT 별도 / 연간은 10개월 값)
--   모든 AI를 Sonnet 5.5로 돌리는 기준으로 월 AI 원가 상한도 함께 조정: $8 · $14 · $28
--   팀원 수 · 크레딧 · 기능은 그대로. 이미 결제 중인 구독은 다음 결제일부터 새 가격으로 청구됩니다.
-- 다시 Run 해도 안전합니다.
-- =====================================================================
update public.plans set price_month_krw = 29000, price_year_krw = 290000, ai_cost_cap_usd = 8  where id = 'starter';
update public.plans set price_month_krw = 49000, price_year_krw = 490000, ai_cost_cap_usd = 14 where id = 'pro';
update public.plans set price_month_krw = 79000, price_year_krw = 790000, ai_cost_cap_usd = 28 where id = 'pro_plus';

-- >>>>>>>>>> 20261112000039_invite_note.sql
-- =====================================================================
-- 초대할 때 적은 팀원 메모(강점·보완할 점) → 합류하면 팀장 개인 메모로
--   · invitations.leader_note: 초대할 때 팀장이 적은 강점·보완할 점 (팀장만 봄)
--   · accept_invitation: 팀원이 합류하는 순간, 그 팀원에게 붙은 팀장 메모(leader_notes, AI 참고 켜짐)로 옮긴다
--     → 1on1 준비 노트 · 팀원관리 추천 · ATEAM AI의 제안이 참고한다. 평가 초안에는 쓰지 않는다. 팀원에게는 보이지 않는다.
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter table public.invitations add column if not exists leader_note text not null default '';

create or replace function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv invitations; v_usage jsonb; v_mail text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invitations where token = p_token for update;
  if not found then raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_inv.accepted_at is not null and v_inv.accepted_by <> auth.uid() then raise exception 'INVITE_USED' using errcode = 'P0001'; end if;
  if v_inv.expires_at < now() then raise exception 'INVITE_EXPIRED' using errcode = 'P0001'; end if;
  -- 초대받은 메일로 로그인해야 합류
  select lower(coalesce(u.email, '')) into v_mail from auth.users u where u.id = auth.uid();
  if coalesce(trim(v_inv.email), '') <> '' and lower(trim(v_inv.email)) <> coalesce(v_mail, '') then
    raise exception 'INVITE_EMAIL_MISMATCH' using errcode = 'P0001', hint = v_inv.email;
  end if;
  if v_inv.role = 'member' then
    v_usage := public.team_seat_usage(v_inv.team_id);
    if (v_usage->>'members')::int >= (v_usage->>'max_members')::int
       and not exists (select 1 from team_members where team_id = v_inv.team_id and user_id = auth.uid() and status = 'active') then
      raise exception 'PLAN_LIMIT_MEMBERS' using errcode = 'P0001';
    end if;
  end if;
  insert into team_members (team_id, user_id, role, job_title)
  values (v_inv.team_id, auth.uid(), v_inv.role, v_inv.job_title)
  on conflict (team_id, user_id) do update
    set status = 'active', role = case when team_members.role = 'leader' then team_members.role else excluded.role end;
  -- 초대할 때 적은 메모 → 초대한 팀장의 개인 메모 (한 번만)
  if coalesce(trim(v_inv.leader_note), '') <> '' and v_inv.invited_by is not null and v_inv.accepted_at is null then
    insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, tags)
    values (v_inv.team_id, v_inv.invited_by, left(trim(v_inv.leader_note), 2000), 'member', auth.uid()::text,
            coalesce((select full_name from profiles where id = auth.uid()), ''), true, array['초대 메모']);
  end if;
  update invitations set accepted_at = coalesce(accepted_at, now()), accepted_by = auth.uid() where id = v_inv.id;
  perform log_event(v_inv.team_id, 'member.joined', 'team_members', null, auth.uid());
  return v_inv.team_id;
end $$;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- 데모 팀: 초대할 때 적은 메모 예시 (최다은) — 이미 있으면 건너뜀
do $$
declare r record; v_choi uuid;
begin
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo loop
    select tm.user_id into v_choi from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '최다은' limit 1;
    if v_choi is null or exists (select 1 from leader_notes where team_id = r.team_id and '초대 메모' = any(tags)) then continue; end if;
    insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, tags, created_at, updated_at)
    values (r.team_id, r.leader_id, E'강점: 콘텐츠 기획이 빠르고 아이디어가 많음\n보완할 점: 일정이 밀릴 때 공유가 늦음', 'member', v_choi::text, '최다은', true,
            array['초대 메모'], now() - interval '40 days', now() - interval '40 days');
  end loop;
end $$;

-- >>>>>>>>>> 20261113000040_autopilot.sql
-- =====================================================================
-- AUTOPILOT (자율주행) — 팀장이 버튼을 누르면 핵심 질문 7개를 진단하고, 바로 보낼 액션까지 준비한다
--   · 실행 횟수: 체험 14일 동안 1번 · Starter 월 3회 · Pro 월 5회 · Pro+ 월 8회 (매월 1일 KST 초기화)
--   · 모드(teams.settings.autopilot): direct(기본, 아무것도 자동 발송 안 함) · semi(허용한 액션만) · auto(전부)
--     모드는 '다음 실행부터' 적용된다 — 실행할 때의 모드가 autopilot_runs.mode 에 남는다
--   · 자동으로 보낸 것은 via_autopilot = true → 팀원 화면에 "팀장님 설정에 따라 ATEAM이 보냄"
--   · 보낸 뒤 10분 안에는 되돌릴 수 있다 (autopilot_undo)
--   · 매주 자동으로 만들던 'ATEAM AI의 제안'(advisor-weekly)은 끈다
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'autopilot';

alter table public.plans add column if not exists autopilot_monthly int not null default 0;
update public.plans set autopilot_monthly = 3 where id = 'starter';
update public.plans set autopilot_monthly = 5 where id = 'pro';
update public.plans set autopilot_monthly = 8 where id = 'pro_plus';
update public.plans set autopilot_monthly = 0 where id = 'free';

alter table public.team_requests   add column if not exists via_autopilot boolean not null default false;
alter table public.observations    add column if not exists via_autopilot boolean not null default false;
alter table public.review_comments add column if not exists via_autopilot boolean not null default false;

create table if not exists public.autopilot_runs (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  leader_id   uuid not null references public.profiles(id) on delete cascade,
  mode        text not null default 'direct' check (mode in ('direct', 'semi', 'auto')),
  allow       jsonb not null default '{}'::jsonb,          -- 실행 시점의 액션별 허용값 (semi 일 때)
  status      text not null default 'running' check (status in ('running', 'done', 'failed')),
  step        int not null default 0,                      -- 0: 데이터 읽는 중 · 1~7: 질문 · 8: 정리
  output      jsonb,                                       -- 진단 · 시뮬레이션 · 액션 (액션마다 key)
  actions     jsonb not null default '{}'::jsonb,          -- key → { status: sent|skip, ref_table, ref_id, at, auto }
  ai_output_id uuid references public.ai_outputs(id) on delete set null,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists autopilot_runs_team_idx on public.autopilot_runs (team_id, created_at desc);
-- 한 팀에 진행 중인 실행은 하나만 (두 탭 · 두 번 누르기로 중복 실행 · 중복 발송되지 않게)
create unique index if not exists autopilot_runs_one_running on public.autopilot_runs (team_id) where status = 'running';
alter table public.autopilot_runs enable row level security;
drop policy if exists autopilot_runs_leader_read on public.autopilot_runs;
create policy autopilot_runs_leader_read on public.autopilot_runs for select using (public.is_team_leader(team_id));

-- 이번 기간 실행 가능 횟수
create or replace function public.autopilot_quota(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_plan plans; v_sub subscriptions; v_from timestamptz; v_limit int; v_used int; v_trial boolean;
begin
  if auth.uid() is not null and not public.is_team_leader(p_team) then raise exception 'forbidden' using errcode = '42501'; end if;
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then return null; end if;
  -- 10분 넘게 '진행 중'인 실행은 멈춘 것으로 보고 실패 처리 (횟수에서 빠진다)
  update autopilot_runs set status = 'failed', error = coalesce(error, '시간 안에 끝나지 않았습니다'), finished_at = now()
   where team_id = p_team and status = 'running' and created_at < now() - interval '10 minutes';
  v_plan := public.effective_plan_for_owner(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  v_trial := v_sub.status = 'trialing' and coalesce(v_sub.trial_ends_at, now() + interval '1 day') > now();
  if v_trial then
    v_limit := 1;
    v_from := coalesce(v_sub.current_period_start, v_sub.trial_ends_at - interval '14 days', now() - interval '14 days');
  else
    v_limit := coalesce(v_plan.autopilot_monthly, 0);
    v_from := (date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul';
  end if;
  select count(*) into v_used from autopilot_runs where team_id = p_team and status <> 'failed' and created_at >= v_from;
  return jsonb_build_object('limit', v_limit, 'used', v_used, 'remaining', greatest(0, v_limit - v_used), 'trial', v_trial,
    'resets_at', case when v_trial then null else ((date_trunc('month', now() at time zone 'Asia/Seoul') + interval '1 month') at time zone 'Asia/Seoul') end);
end $$;
revoke all on function public.autopilot_quota(uuid) from public, anon;
grant execute on function public.autopilot_quota(uuid) to authenticated;

-- 실행 시작 (서비스 전용) — 팀 단위 잠금 안에서 진행 중 확인 · 횟수 확인 · 기록을 한 번에
create or replace function public.autopilot_start(p_team uuid, p_leader uuid, p_mode text, p_allow jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q jsonb; v_id uuid;
begin
  if auth.uid() is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('autopilot:' || p_team::text));
  v_q := public.autopilot_quota(p_team);
  select id into v_id from autopilot_runs where team_id = p_team and status = 'running' limit 1;
  if v_id is not null then return jsonb_build_object('run_id', v_id, 'existing', true); end if;
  if coalesce((v_q ->> 'remaining')::int, 0) <= 0 then
    raise exception 'AUTOPILOT_LIMIT' using errcode = 'P0001', hint = case when (v_q ->> 'trial')::boolean then 'trial' else 'month' end;
  end if;
  insert into autopilot_runs (team_id, leader_id, mode, allow) values (p_team, p_leader, coalesce(p_mode, 'direct'), coalesce(p_allow, '{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('run_id', v_id, 'existing', false);
end $$;
revoke all on function public.autopilot_start(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- 설정 저장 — autopilot 키만 바꾼다 (다른 설정을 덮어쓰지 않게)
create or replace function public.autopilot_save_settings(p_team uuid, p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_settings ->> 'mode', '') not in ('direct', 'semi', 'auto') then raise exception 'BAD_MODE'; end if;
  update teams set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('autopilot',
    jsonb_build_object('mode', p_settings ->> 'mode', 'allow', coalesce(p_settings -> 'allow', '{}'::jsonb))) where id = p_team;
end $$;
revoke all on function public.autopilot_save_settings(uuid, jsonb) from public, anon;
grant execute on function public.autopilot_save_settings(uuid, jsonb) to authenticated;

-- 액션 하나 보내기 — 결과 화면에서 팀장이 [보내기](p_auto=false) · 실행 직후 자동 발송(서비스, p_auto=true)
--   p_body 가 있으면 고쳐 쓴 문구로 보낸다. 이미 보낸 것은 다시 보내지 않는다.
create or replace function public.autopilot_send(p_run uuid, p_key text, p_body text default null, p_auto boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r autopilot_runs; a jsonb; v_type text; v_to uuid; v_body text; v_item uuid; v_sub uuid; v_ver uuid; v_id uuid; v_tbl text; v_title text; v_by uuid;
begin
  select * into r from autopilot_runs where id = p_run for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if auth.uid() is not null then
    if not public.is_team_leader(r.team_id) then raise exception 'forbidden' using errcode = '42501'; end if;
    p_auto := false;
  end if;
  if coalesce(r.actions -> p_key ->> 'status', '') = 'sent' then return r.actions -> p_key; end if;
  select x into a from jsonb_array_elements(coalesce(r.output -> 'actions', '[]'::jsonb)) x where x ->> 'key' = p_key;
  if a is null then raise exception 'NO_ACTION'; end if;
  -- 민감 내용은 어떤 경우에도 자동으로 보내지 않는다
  if p_auto and coalesce(a ->> 'sensitive', '') <> '' then raise exception 'SENSITIVE'; end if;
  v_by := coalesce(auth.uid(), r.leader_id);
  v_type := a ->> 'type';
  v_to := nullif(a ->> 'member_id', '')::uuid;
  v_body := left(coalesce(nullif(trim(p_body), ''), a ->> 'message'), 600);
  v_item := nullif(a ->> 'item_id', '')::uuid;
  v_sub := nullif(a ->> 'submission_id', '')::uuid;
  if v_to is null or not exists (select 1 from team_members where team_id = r.team_id and user_id = v_to and status = 'active') then raise exception 'NOT_MEMBER'; end if;
  if v_item is not null and not exists (select 1 from work_items where id = v_item and team_id = r.team_id) then v_item := null; end if;

  if v_type = 'praise' then
    insert into observations (team_id, author_id, subject_id, kind, body, via_autopilot)
      values (r.team_id, v_by, v_to, 'praise', '[칭찬 배지] ' || v_body, p_auto) returning id into v_id;   -- 알림은 t_praise_notify 가 보낸다
    v_tbl := 'observations';
  elsif v_type = 'memo' then
    insert into observations (team_id, author_id, subject_id, kind, body, via_autopilot)
      values (r.team_id, v_by, v_to, 'note', v_body, p_auto) returning id into v_id;
    v_tbl := 'observations';
  elsif v_type in ('cheer', 'grow', 'push', 'progress', 'plan', 'oo') then
    v_title := left(split_part(v_body, E'\n', 1), 200);
    insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, via_autopilot)
      values (r.team_id, v_by, v_to,
        case v_type when 'cheer' then 'cheer' when 'grow' then 'grow' when 'plan' then 'plan' when 'oo' then 'meeting' else 'progress' end,
        case when v_type in ('progress', 'plan') then v_item else null end,
        v_title, case when length(v_body) > length(v_title) then v_body else '' end, p_auto)
      returning id into v_id;
    v_tbl := 'team_requests';
  elsif v_type in ('thread', 'rework') then
    if v_sub is null or not exists (select 1 from submissions where id = v_sub and team_id = r.team_id) then raise exception 'NO_SUBMISSION'; end if;
    select id into v_ver from submission_versions where submission_id = v_sub order by version desc limit 1;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, via_autopilot)
      values (v_sub, v_ver, r.team_id, v_by, v_body, p_auto) returning id into v_id;
    v_tbl := 'review_comments';
  else
    raise exception 'BAD_TYPE';
  end if;

  -- 자동으로 보낸 칭찬·관찰 메모는 평가 근거에서 'AI가 쓴 것'으로 남긴다
  if p_auto and v_tbl = 'observations' then update evidence set provenance = 'ai' where source_id = v_id; end if;

  update autopilot_runs set actions = actions || jsonb_build_object(p_key,
    jsonb_build_object('status', 'sent', 'ref_table', v_tbl, 'ref_id', v_id, 'at', now(), 'auto', p_auto, 'body', v_body))
   where id = p_run;
  return jsonb_build_object('status', 'sent', 'ref_table', v_tbl, 'ref_id', v_id, 'at', now(), 'auto', p_auto);
end $$;
revoke all on function public.autopilot_send(uuid, text, text, boolean) from public, anon;
grant execute on function public.autopilot_send(uuid, text, text, boolean) to authenticated;

-- 보낸 지 10분 안이면 되돌리기 (보낸 기록을 지운다)
create or replace function public.autopilot_undo(p_run uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r autopilot_runs; s jsonb; v_ref uuid; v_req team_requests;
begin
  select * into r from autopilot_runs where id = p_run for update;
  if r.id is null or not public.is_team_leader(r.team_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  s := r.actions -> p_key;
  if coalesce(s ->> 'status', '') <> 'sent' then raise exception 'NOT_SENT'; end if;
  -- 자동으로 보낸 것은 결과가 나온 때부터 10분
  if greatest((s ->> 'at')::timestamptz, case when (s ->> 'auto')::boolean then coalesce(r.finished_at, now()) else (s ->> 'at')::timestamptz end) < now() - interval '10 minutes' then
    raise exception 'UNDO_EXPIRED';
  end if;
  v_ref := (s ->> 'ref_id')::uuid;
  if s ->> 'ref_table' = 'observations' then delete from observations where id = v_ref and team_id = r.team_id;
  elsif s ->> 'ref_table' = 'team_requests' then
    select * into v_req from team_requests where id = v_ref and team_id = r.team_id;
    delete from team_requests where id = v_ref and team_id = r.team_id;
    -- 계획 요청으로 켜진 '계획 필요' 표시는 다른 열린 계획 요청이 없으면 끈다
    if v_req.kind = 'plan' and v_req.item_id is not null and not exists (select 1 from team_requests where item_id = v_req.item_id and kind = 'plan' and status = 'open') then
      update work_items set needs_plan = false where id = v_req.item_id;
    end if;
  elsif s ->> 'ref_table' = 'review_comments' then delete from review_comments where id = v_ref and team_id = r.team_id;
  end if;
  -- 함께 생긴 평가 근거 · 팀원 알림도 지운다 (같은 트랜잭션에서 생겨 시각이 같다)
  delete from evidence where source_id = v_ref;
  delete from notifications where team_id = r.team_id and created_at = (s ->> 'at')::timestamptz
    and user_id = (select (x ->> 'member_id')::uuid from jsonb_array_elements(coalesce(r.output -> 'actions', '[]'::jsonb)) x where x ->> 'key' = p_key);
  update autopilot_runs set actions = actions - p_key where id = p_run;
  return jsonb_build_object('status', 'wait');
end $$;
revoke all on function public.autopilot_undo(uuid, text) from public, anon;
grant execute on function public.autopilot_undo(uuid, text) to authenticated;

-- 건너뛰기 · 다시 보기 (기록만)
create or replace function public.autopilot_mark(p_run uuid, p_key text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r autopilot_runs;
begin
  select * into r from autopilot_runs where id = p_run for update;
  if r.id is null or not public.is_team_leader(r.team_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(r.actions -> p_key ->> 'status', '') = 'sent' then return; end if;
  if p_status = 'skip' then update autopilot_runs set actions = actions || jsonb_build_object(p_key, jsonb_build_object('status', 'skip', 'at', now())) where id = p_run;
  else update autopilot_runs set actions = actions - p_key where id = p_run; end if;
end $$;
revoke all on function public.autopilot_mark(uuid, text, text) from public, anon;
grant execute on function public.autopilot_mark(uuid, text, text) to authenticated;

-- 매주 자동으로 만들던 'ATEAM AI의 제안'은 끈다 (자율주행은 팀장이 직접 실행)
do $$ begin perform cron.unschedule('advisor-weekly'); exception when others then null; end $$;
