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

-- ---------- 1:1 ----------
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

-- 1:1 완료
create or replace function public.trg_one_on_one() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := coalesce(new.completed_at, now());
    perform log_event(new.team_id, 'one_on_one.done', 'one_on_ones', new.id, new.member_id);
    perform upsert_evidence(new.team_id, new.member_id, 'one_on_one', new.id,
      '1:1 — ' || left(new.shared_notes, 300), 'neutral', null, new.scheduled_at);
  end if;
  return new;
end $$;
create trigger t_oo_log before insert or update on public.one_on_ones for each row execute function public.trg_one_on_one();

-- 팀장 메모 (1:1 비공개)
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
             then jsonb_build_object('type', 'no_one_on_one', 'label', '1:1 ' || extract(day from now() - coalesce(oo.last_at, m.joined_at))::int || '일째 없음') end,
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

-- 판단 근거 = 결과물·관찰·리뷰 코멘트·팀장 메모 (체크인·1:1 기록은 맥락)
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
      jsonb_build_object('label', '완료된 1:1', 'current', v_oo, 'target', 2 * v_members, 'unit', '회'))),
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
-- 팀장이 확인한 카드는 리뷰·1:1 준비·주간보고·평가·전략 점검에 자동으로 반영된다.
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
