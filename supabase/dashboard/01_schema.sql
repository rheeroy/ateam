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
--   · 코어 AI (브리핑·인사이트·1차 검토·1:1 준비·주간보고·계획 수정·셀프 점검)는 구독에 포함, 공정 사용 한도만
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
    values (auth.uid(), 'pro', 'trialing', now() + interval '30 days', now(), now() + interval '30 days');
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

-- 마케팅기획팀. p_members 순서: 김도현(브랜드) · 박서연(퍼포먼스) · 최민아(콘텐츠) · 정우성(제휴) · 이정규(CRM) · 한수진(신규)
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
    -- 팀원 → 팀장 1:1 요청 (팀원 앱에서 '1:1 요청하기')
    insert into team_requests (team_id, from_id, to_id, kind, title, body, created_at) values
      (T, m_lee, L, 'meeting', 'CRM 연계 방향이 맞는지 한번 같이 보고 싶어요', '', now() - interval '5 hours');
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
  insert into metric_values (metric_id, team_id, period, value) values
    (mt, T, (v_month - interval '3 months')::date, 3.4), (mt, T, (v_month - interval '2 months')::date, 3.6), (mt, T, (v_month - interval '1 months')::date, 4.2);
  insert into metric_pipeline (metric_id, team_id, label, amount, probability, expected_close) values
    (mt, T, 'B사 멤버십 제휴', 4, 0.4, v_month + 45), (mt, T, 'C사 카드 프로모션 재계약', 2.5, 0.6, v_month + 30), (mt, T, 'D사 앱 공동 이벤트', 1.5, 0.3, v_month + 50);

  -- 체크인 26주
  for i in 1..26 loop
    wk := this_mon - (i * 7);
    insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
      (T, m_kim, wk, case when i = 1 then '런칭 캠페인 기획서 v3 제출, FGI 설계 착수' when i = 2 then '프로모션 전략 전면 수정' else '런칭 캠페인 기획·경쟁사 캠페인 분석' end,
         case when i = 2 then '경쟁사 할인 데이터 확보' else '' end, '고객 FGI 진행', case when i <= 1 then 3 else 4 end),
      (T, m_park, wk, '광고 성과 대시보드 개선, 월간 리포트 운영', '', '리포트 자동화', 4),
      (T, m_choi, wk, '콘텐츠 캘린더 운영, 제작 프로세스 개선안 작성', '', '디자인팀 인터뷰', case when i % 5 = 0 then 3 else 4 end),
      (T, m_jung, wk, case when i <= 2 then '제휴 프로모션 제안서 작성' else '채널 성과 보고 정비, 파트너사 미팅' end,
         case when i <= 2 then '파트너사 회원 데이터 수급이 안 됨' else '' end, '제안서 마무리', case when i <= 2 then 3 else 4 end);
    if i <= 20 then
      insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
        (T, m_lee, wk, 'CRM 캠페인 운영, 휴면 고객 재활성화 메시지', '', 'CRM 성과 분석', case i when 1 then 2 when 2 then 3 when 3 then 4 else 4 end);
    end if;
    if i <= 5 then
      insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
        (T, m_han, wk, '온보딩 과제 수행, 런칭 캠페인 리서치 보조', '', '리서치 정리', 4);
    end if;
  end loop;
  -- 이번 주: 이정규만 미제출
  -- 지난 체크인의 작성 시각을 그 주 금요일로
  update checkins set created_at = week_start + interval '4 days 17 hours', updated_at = week_start + interval '4 days 17 hours' where team_id = T;
  insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
    (T, m_kim, this_mon, '고객 FGI 설계, 임원 보고 장표 보완', '', 'FGI 8명 진행', 3),
    (T, m_park, this_mon, '리포트 자동화 1차', '', '대시보드 배포', 4),
    (T, m_choi, this_mon, '제작 프로세스 개선안 v2', '', '디자인팀 피드백 반영', 4),
    (T, m_jung, this_mon, '제휴 프로모션 제안서 초안', '파트너사 회원 데이터 수급이 안 됨', 'B사 데이터 대체안', 3),
    (T, m_han, this_mon, '경쟁사 프로모션 조사', '', 'FGI 보조', 4);

  -- 1:1 (격주, 완료)
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

  -- 팀장 노하우: 일 잘하는 방식 · 좋은 결과물의 기준 (AI 검토 · 코칭 · 1:1 준비 · 보고가 읽는다)
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
      (T, L, 'coaching', '1:1은 사람 먼저', '1:1 첫 10분은 업무가 아니라 컨디션과 어려움을 묻는다. 해결책보다 먼저 듣고, 약속은 하나만 정한다.',
        '["첫 10분은 사람 이야기", "약속은 하나만, 날짜와 함께"]'::jsonb, '{prep}', '{1:1,코칭}', false, false, 'human', 8, now() - interval '2 days', now() - interval '70 days'),
      (T, L, 'context', '하반기 우리 팀 우선순위', '하반기 최우선은 신제품 런칭과 제휴 채널 확대. 전사 비용 15% 절감 방침이 있어, 예산이 드는 안은 CAC 근거를 함께 낸다.',
        '["런칭·제휴가 최우선", "예산 안에는 CAC 근거"]'::jsonb, '{review,strategy,briefing,prep}', '{우선순위,예산,CAC}', true, false, 'human', 10, now() - interval '1 day', now() - interval '40 days');
  exception when others then null;
  end;

  -- 결과물: 김도현 기획서 v1~v3 (리뷰 중)
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
          {"type": "risk", "severity": 2, "title": "이정규 님 이탈 신호", "body": "컨디션 3주 하락과 1:1 공백이 겹칩니다.", "action": "이번 주 1:1", "link": "one_on_ones"}]},
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
        "people": {"summary": "팀원관리가 흔들리는 건 개인 문제보다 운영 리듬 때문입니다 — 1:1 간격이 벌어진 시기에 막힘을 혼자 끌어안는 패턴이 겹쳐 컨디션이 같이 꺾였고, 성장·인정은 일부에게만 몰려 있습니다.", "items": [
          {"type": "risk", "severity": 3, "title": "이정규 님 3주 연속 컨디션 하락 (4 → 3 → 2)", "body": "1:1이 3주 넘게 없고, CRM 자동화 과제는 혼자 맡고 있습니다. 업무량보다 방향 불확실이 원인일 수 있습니다.", "action": "이번 주 안에 1:1 — 과제 우선순위부터 물어보기", "link": "one_on_ones"},
          {"type": "risk", "severity": 2, "title": "정우성 님 2주째 같은 문제로 막힘", "body": "본인 힘으로 풀 수 없는 외부 데이터 문제라, 팀장이 위로 올려 줘야 풀립니다.", "action": "영업본부 협조 요청을 대신 올리기", "link": "one_on_ones"},
          {"type": "good", "severity": 1, "title": "김도현·박서연 님 판단 깊이 상승", "body": "결과물 검토 점수와 결과 지표가 함께 올랐습니다. 지금 인정하면 효과가 큽니다.", "action": "관찰 메모로 남기기", "link": "team"},
          {"type": "data", "severity": 1, "title": "한수진 님 평가 근거 부족", "body": "입사 6주 차로 결과물·관찰 기록이 적습니다. 평가 시즌(D-33) 전에 근거를 쌓아야 합니다.", "action": "FGI 결과물 리뷰를 근거로 남기기", "link": "reviews"}]},
        "org": {"summary": "위와의 정렬이 늦어지고 있습니다 — 전사 기준은 비용·고객 획득 효율로 바뀌었는데 팀 계획과 보고는 아직 이전 기준이라, 임원 질문에 답할 근거가 비어 있습니다.", "items": [
          {"type": "forecast", "severity": 2, "title": "4분기 실행계획 제출 D-6", "body": "비용 15% 절감 반영이 필요합니다.", "action": "런칭 캠페인 예산 재배분안부터 준비", "link": "org"}]}
      },
      "watch_next": "다음 주 파트너 데이터가 들어오는지, 이정규 님 컨디션이 반등하는지"
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

  -- 업무플랫폼: 리뷰 대기 결과물 2건의 AI 1차 검토 + 다가오는 1:1의 AI 준비 노트
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
        "brief": {"tone": "good", "text": "김도현 님이 올린 '하반기 신제품 런칭 캠페인 기획서'는 논리가 탄탄해 보입니다", "why": "버린 대안과 이유까지 비교함 · 결론은 뒤에 있음"},
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
        "brief": {"tone": "watch", "text": "최민아 님이 올린 '콘텐츠 제작 프로세스 개선안'은 완결성이 낮아 보입니다", "why": "목표치가 없고 개선 효과 추정이 비어 있음"},
        "decisions": [],
        "strengths": [{"section": "1. 현황", "text": "최근 10건 기준 리드타임 3주로 기준선을 잡았습니다."}],
        "gaps": [{"section": "2. 개선", "text": "브리프 템플릿·고정 슬롯이 각각 며칠을 줄이는지 추정이 없습니다."},
                 {"section": "3. 측정", "text": "목표치(예: 2주)가 없어 성공 여부를 판단하기 어렵습니다."}],
        "questions": ["세 가지 개선 중 리드타임을 가장 많이 줄이는 건 무엇이라고 보나요?", "디자인팀 고정 슬롯은 디자인팀과 합의됐나요?"],
        "change_from_previous": "측정 지표(월 제작 건수, 리드타임)를 추가했습니다.",
        "criteria_check": [{"criterion": "결론부터 쓴다", "met": true, "note": "첫 줄에 개선안을 밝혔습니다."},
                           {"criterion": "대안 비교", "met": false, "note": "다른 개선 방법과 비교가 없습니다."}]
      }$j$::jsonb, '[]'::jsonb, m_choi, now() - interval '1 day');
    -- 김도현 기획서 v1 · v2 의 AI 검토 (버전마다 검토가 쌓이는 흐름)
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
    select T, 'review', m_kim, 'submission_versions', sv.id, 'draft', 'leader', 'L1', 1, x.c::jsonb, '[]'::jsonb, m_kim, sv.created_at + interval '5 minutes'
    from submission_versions sv join submissions s on s.id = sv.submission_id
    join (values
      (1, $j${
        "depth_score": 2.0,
        "summary": "타깃과 시장 규모는 잡았지만, 정가 런칭을 택한 이유가 '프리미엄 이미지' 한 줄뿐이라 근거가 비어 있습니다. 다른 프로모션 방식과 비교하지 않았고 채널·일정 등 실행 부분이 아직 없습니다.",
        "brief": {"tone": "risk", "text": "김도현 님이 올린 '하반기 신제품 런칭 캠페인 기획서'는 근거가 비어 보입니다", "why": "정가 런칭 이유가 '프리미엄 이미지' 한 줄뿐"},
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
        "brief": {"tone": "watch", "text": "김도현 님이 올린 '하반기 신제품 런칭 캠페인 기획서'는 고민의 깊이가 그대로로 보입니다", "why": "채널 계획은 늘었지만 정가 근거는 '반영 예정'"},
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
      'summary', '이번 주는 이정규 님 1:1과 정우성 님 막힘 해소가 먼저이고, 김도현 님은 지금 인정할 타이밍입니다.',
      'actions', jsonb_build_array(
        jsonb_build_object('user_id', m_lee, 'type', 'one_on_one', 'urgency', 3, 'title', '이정규 님과 1:1 — 이번 주 안에',
          'why', '컨디션이 3주 연속 떨어졌고(4 → 3 → 2) 마지막 1:1이 3주 전입니다.', 'opener', '요즘 일하면서 에너지가 가장 떨어지는 순간이 언제예요?'),
        jsonb_build_object('user_id', m_jung, 'type', 'support', 'urgency', 3, 'title', '정우성 님 챙기기 — 어려운 점 들어 주기',
          'why', '2주째 같은 막힘이 체크인에 반복돼 지쳐 있을 수 있습니다.', 'request', '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 제가 도울 수 있는 건 같이 할게요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'praise', 'urgency', 2, 'title', '김도현 님께 칭찬 배지',
          'why', '최근 결과물의 판단 깊이가 꾸준히 올랐고(2.0 → 3.0), 대안을 비교하고 근거를 남기는 방식이 자리 잡았습니다.', 'message', '요즘 결과물마다 대안을 따져 보고 근거를 남기는 게 보여서 든든해요. 고마워요!'),
        jsonb_build_object('user_id', m_han, 'type', 'observe', 'urgency', 2, 'title', '한수진 님 관찰 기록 남기기',
          'why', '입사 6주 차로 평가 근거가 기준에 못 미칩니다. 이번 주 일하는 모습을 보고 한 줄 남겨 두세요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'develop', 'urgency', 1, 'title', '김도현 님께 더 큰 역할 제안하기',
          'why', '판단 깊이가 꾸준히 올라 다음 단계 역할을 이야기할 시점입니다.', 'request', '다음 분기에는 더 넓은 범위를 직접 리드해 보면 좋겠어요. 어떤 걸 맡아 보고 싶은지 이야기해 봐요.'),
        jsonb_build_object('user_id', m_choi, 'type', 'push', 'urgency', 1, 'title', '최민아 님과 진행 공유 리듬 맞추기',
          'why', '결과물이 리뷰 단계에 머물러 있고 최근 진행 공유 간격이 길어졌습니다.', 'request', '이번 주부터 금요일마다 진행 상황을 한 줄로 공유해 줄래요? 막히는 게 있으면 같이 봐요.'),
        jsonb_build_object('user_id', m_park, 'type', 'praise', 'urgency', 1, 'title', '박서연 님께 꾸준함 인정하기',
          'why', '정기 업무를 빠짐없이 운영하고 결과물이 대부분 한 번에 통과했습니다.', 'message', '매달 빠짐없이 챙겨 주는 꾸준함 덕분에 팀이 숫자를 믿고 움직여요. 고마워요!')),
      'members', jsonb_build_array(
        jsonb_build_object('user_id', m_kim, 'work_status', 'good', 'work_view', '런칭 기획이 계획보다 조금 늦지만 결과물 품질이 뚜렷이 올랐습니다. 핵심 과제를 안정적으로 끌고 갑니다.', 'flight_risk', 'low', 'flight_note', '컨디션이 안정적이고 1:1이 꾸준합니다.'),
        jsonb_build_object('user_id', m_park, 'work_status', 'good', 'work_view', '정기 리포트를 빠짐없이 운영하고 결과물도 한 번에 통과하는 편입니다. 다만 업무가 겹쳐 시간이 빠듯합니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_choi, 'work_status', 'good', 'work_view', '프로세스 개선이 계획대로 가고, 개선안에 측정 지표를 붙이는 등 결과물이 나아지고 있습니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_jung, 'work_status', 'support', 'work_view', '제안서가 외부 데이터 막힘으로 계획보다 크게 늦고, 보고 체계 정비도 진척이 더딥니다. 본인 역량보다 외부 의존이 원인입니다.', 'flight_risk', 'medium', 'flight_note', '같은 막힘이 2주째 반복되고 일이 몰려 있습니다.'),
        jsonb_build_object('user_id', m_lee, 'work_status', 'watch', 'work_view', 'CRM 연계 과제가 계획보다 조금 늦지만 큰 이탈은 없습니다. 혼자 맡은 과제라 방향 확인이 필요합니다.', 'flight_risk', 'high', 'flight_note', '컨디션 3주 연속 하락과 1:1 공백이 겹칩니다.'),
        jsonb_build_object('user_id', m_han, 'work_status', 'good', 'work_view', 'FGI 준비를 일정대로 진행 중이나 아직 올린 결과물이 적어 판단 근거가 얇습니다.', 'flight_risk', 'low', 'flight_note', '신규 입사자로 적응 중입니다.'))
    ), L;
  exception when others then null;
  end;

  -- A·Team의 제안: 이번 주 + 지난주(회고용) + 지난주 제안 상태 + 팀장 셀프 체크
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 2, $2, '[]'::jsonb, $3, now() - interval '7 days 20 minutes', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date - 1)$q$
    using T, $j${"headline": "실행은 순항하지만 사람 관리의 리듬이 느슨해지고 있습니다 — 1:1과 기준 공유로 다시 조이는 주입니다.", "focus": "제휴 목표 — 고객사 데이터 수급이 공식 경로로 요청되지 않았습니다.", "levers": {"exec": {"state": "watch", "note": "제휴 과제가 2주째 같은 막힘입니다."}, "staffing": {"state": "good", "note": "부하는 고른 편입니다."}, "people": {"state": "act", "note": "1:1 간격이 평균 19일로 벌어졌습니다."}, "external": {"state": "watch", "note": "데이터 수급이 비공식 경로에만 의존합니다."}, "self": {"state": "good", "note": "특이 신호 없음."}, "system": {"state": "watch", "note": "결과물 보완점이 같은 주제로 반복됩니다."}}, "advice": [{"id": "a1", "lever": "people", "urgency": 3, "effort": "low", "title": "1:1 간격을 2주 이내로 되돌리세요", "why": "1:1 평균 간격이 19일로 벌어졌습니다.", "effect": "막힘을 일찍 듣게 됩니다.", "if_not": "컨디션 하락을 늦게 알게 됩니다.", "route": "one_on_one", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "system", "urgency": 2, "effort": "mid", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "why": "보완점이 같은 주제로 반복됩니다.", "effect": "수정 횟수가 줄어듭니다.", "if_not": "리뷰 시간이 계속 늘어납니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a3", "lever": "external", "urgency": 2, "effort": "low", "title": "제휴 데이터 수급을 영업본부에 공식 요청하세요", "why": "비공식 경로로 2주를 기다렸습니다.", "effect": "회신 날짜가 정해집니다.", "if_not": "막힘이 계속됩니다.", "route": "report", "target_user_id": "", "script": ""}], "review": [], "watch_next": "이정규 님 컨디션."}$j$::jsonb, L;
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 3, $2, '[]'::jsonb, $3, now() - interval '20 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, replace($j${"headline": "성과는 외부 의존 하나에 묶여 있고, 운영은 팀장 시간이 순항하는 사람 쪽으로 쏠려 있습니다 — 이번 주는 '막힌 곳으로 사람과 시간을 옮기는 주'입니다.", "focus": "제휴 목표(20만 명) — 고객사 데이터 수급이 풀리지 않으면 4분기 전망이 18.6만 명 근처에서 멈춥니다.", "levers": {"exec": {"state": "act", "note": "제휴 과제가 3주째 같은 막힘(고객사 데이터)으로 멈춰 있고, 계획에 대체 경로가 없습니다."}, "staffing": {"state": "watch", "note": "제휴 목표의 하위 일 3건이 모두 정우성 님 한 사람에게 있고, 김도현 님은 가용 시간의 70%만 쓰고 있습니다."}, "people": {"state": "watch", "note": "최근 4주 칭찬·관찰이 김도현·박서연 님에게 몰렸고, 이정규 님은 컨디션이 3주째 내려가는데 팀장 접점이 가장 적습니다."}, "external": {"state": "act", "note": "전사 비용 15% 절감 방침이 런칭 캠페인 예산과 부딪히는데, 아직 위로 방향을 확인하지 않았습니다."}, "self": {"state": "watch", "note": "리뷰 대기 6건(가장 오래 5일)과 검토 중 결정 3건이 겹쳐 있고, 최근 2주 앱 활동의 31%가 밤 10시 이후·주말입니다."}, "system": {"state": "good", "note": "체크인 제출 5/6명으로 주간 리듬은 유지됩니다. 다만 결과물 보완점이 '근거·데이터'에 반복됩니다."}}, "advice": [{"id": "a1", "lever": "exec", "urgency": 3, "effort": "low", "title": "제휴 과제에 '대체 데이터 경로'를 이번 주 안에 계획으로 넣으세요 — 고객사 데이터를 기다리는 동안 공개 데이터와 파일럿 고객 2곳으로 1차안을 만들게 하세요.", "why": "같은 막힘이 3주째 체크인에 반복되고, 제휴 목표 달성 가능성이 12%까지 내려왔습니다.", "effect": "데이터 회신이 늦어져도 11월 첫 주에 1차 제안이 가능해지고, 목표 전망의 바닥이 올라갑니다.", "if_not": "회신이 2주 더 밀리면 4분기 제휴 목표는 조정이 불가피합니다.", "route": "decide", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "staffing", "urgency": 2, "effort": "mid", "title": "제휴 과제의 '데이터 정리' 1건을 김도현 님에게 옮겨 정우성 님 한 사람 의존을 푸세요.", "why": "제휴 하위 일 3건이 한 사람에게 몰려 있고(주 46시간/가용 40시간), 김도현 님은 여유가 있습니다.", "effect": "정우성 님은 파트너 협상에 집중하고, 막힘이 한 곳에서 전체로 번지는 걸 막습니다.", "if_not": "정우성 님 과부하가 이어지면 이탈 주의 신호가 '높음'으로 올라갈 수 있습니다.", "route": "request", "target_user_id": "{{KIM}}", "script": "도현 님, 제휴 제안서의 데이터 정리 파트를 이번 주부터 맡아 줄 수 있을까요? 우성 님이 파트너 협상에 집중할 수 있게 하려는 거예요. 필요한 시간은 같이 조정할게요."}, {"id": "a3", "lever": "external", "urgency": 3, "effort": "low", "title": "비용 절감 방침과 런칭 예산의 충돌을 이번 주 본부장 보고에 먼저 올리세요 — 결정권은 위에 있습니다.", "why": "전사 방침(비용 15% 절감)이 런칭 캠페인 광고 집행과 부딪히는데, 팀 안에서 결론을 내기 어려운 사안입니다.", "effect": "예산 축소 범위가 일찍 정해지면 4분기 실행계획 초안을 다시 쓰지 않아도 됩니다.", "if_not": "실행계획 확정 직전에 예산이 깎이면 런칭 일정 전체가 밀립니다.", "route": "report", "target_user_id": "", "script": "전사 비용 15% 절감 방침에 맞춰 런칭 캠페인 광고 예산을 CAC 기준으로 재배분하려 합니다. 다만 제휴 목표(20만 명)에 필요한 최소 예산은 유지가 필요해, 이번 주 안에 방향 확인 부탁드립니다."}, {"id": "a4", "lever": "self", "urgency": 2, "effort": "low", "title": "리뷰 대기 6건 중 정기 보고 2건은 박서연 님에게 1차 리뷰를 맡기고, 아낀 시간을 이정규·정우성 님에게 쓰세요.", "why": "최근 4주 팀장 접점의 48%가 김도현·박서연 님 두 사람에게 갔고, 필요도가 높은 이정규 님은 팀 평균의 0.6배입니다.", "effect": "리뷰 적체가 절반으로 줄고, 이탈 주의 두 사람에게 이번 주 1:1 시간이 생깁니다.", "if_not": "적체와 늦은 시간 작업이 이어지면 결정이 더 미뤄지는 악순환이 됩니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a5", "lever": "people", "urgency": 1, "effort": "low", "title": "이번 주 금요일 점심을 '런칭 준비 중간 점검 + 김도현 님 기획서 통과 축하' 자리로 잡으세요.", "why": "팀 컨디션이 3.6으로 내려가는 중이고, 인정이 일부에게만 보이는 상태입니다.", "effect": "짧고 부담 없는 자리로 팀 전체가 진척을 함께 보고, 인정이 팀 전체의 이야기가 됩니다.", "if_not": "막힌 사람과 순항하는 사람 사이의 온도 차가 커집니다.", "route": "calendar", "target_user_id": "", "script": "금요일 점심은 다 같이 먹어요 — 런칭 준비 중간 점검 겸, 도현 님 기획서 통과도 축하해요."}], "review": [{"id": "a1", "title": "1:1 간격을 2주 이내로 되돌리세요", "verdict": "partial", "observed": "정우성·한수진 님과는 1:1을 했지만, 이정규 님은 아직 3주째 1:1이 없습니다."}, {"id": "a2", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "verdict": "not_done", "observed": "기준 카드가 공개되지 않았고, 이번 주에도 보완점 2건이 '근거·데이터'였습니다."}, {"id": "a3", "title": "제휴 데이터 수급을 영업본부에 공식 요청하세요", "verdict": "done", "observed": "영업본부 요청이 기록됐고, 파트너사 회신은 '11월 둘째 주 이후 가능'으로 왔습니다."}], "watch_next": "고객사 데이터 회신 날짜와 이정규 님 다음 체크인의 컨디션."}$j$, '{{KIM}}', m_kim::text)::jsonb, L;
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
    using T, replace(replace(replace($j${"headline": "위에서 보면 우리 팀은 '런칭은 순항, 제휴는 숫자가 안 보이는 팀'입니다 — 이번 주 질문은 제휴 채널과 CAC에 몰릴 가능성이 큽니다.", "execs": [{"exec_id": "{{E1}}", "name": "김정훈", "lens": "비용 15% 절감 방침 아래에서 '제휴 채널이 CAC를 낮추는 근거가 숫자로 보이는가'", "opener": "제휴 채널은 아직 목표 대비 56%지만, CAC는 1.1만 원으로 채널 중 가장 낮습니다 — 남은 변수는 B사 데이터 하나입니다.", "questions": [{"q": "제휴 신규 고객이 언제 숫자로 보이나?", "why": "주간회의에서 두 번 연속 물었고, 현재 누적 11.2만 명으로 목표 20만 명의 56%입니다.", "prep": "기준 전망 18.6만 명(93%) · B사 데이터가 11월 둘째 주 이후 → 대체 경로(공개 데이터·파일럿 2곳)로 11월 첫 주 1차 제안 가능"}, {"q": "채널별 CAC 비교표는 준비됐나?", "why": "지난 회의에서 다음 보고에 넣어 달라고 요청했습니다.", "prep": "10월 광고 성과 리포트 기준 유튜브 3.2만 · 인스타그램 2.6만 · 제휴 1.1만 원 — 박서연 님 리포트에서 바로 가져올 수 있음"}, {"q": "비용 15% 절감은 어디서 줄이나?", "why": "전사 방침의 첫 대상이 광고 집행입니다.", "prep": "유튜브 예산 20%를 제휴로 이동하는 안 (10월 리포트 제안) — 런칭 사전 예약 전환율 18%는 유지"}], "challenges": [{"point": "제휴 목표 달성 가능성 12%", "why": "같은 막힘이 3주째 반복되고 계획에 대체 경로가 없습니다.", "prep": "인정: 외부 데이터 의존을 늦게 다뤘다. 대안: 대체 데이터 경로를 이번 주 계획에 넣고, 목표 조정 여부를 11월 첫 주에 판단"}, {"point": "보고 체계 정비가 계속 밀림", "why": "계획 변경 2회, 진척 정체.", "prep": "범위를 대시보드 1차 화면으로 줄이고 나머지는 1월로"}]}, {"exec_id": "{{E2}}", "name": "이수경", "lens": "4분기 실행계획이 '최악의 경우'까지 대비돼 있는가", "opener": "실행계획 초안은 제휴 데이터 지연을 가장 큰 리스크로 두고, 대체 경로까지 넣어 6일 뒤 제출하겠습니다.", "questions": [{"q": "실행계획 초안은 기한(D-6) 안에 나오나?", "why": "경영기획팀 요청 기한이 다가옵니다.", "prep": "초안 골격 완료 · 채널별 CAC 목표만 남음 — 금요일 내부 리뷰 후 제출"}, {"q": "B사 데이터가 안 들어오면 어떻게 되나?", "why": "리스크 중심으로 보는 분이고 외부 의존이 가장 큰 변수입니다.", "prep": "최악: 4분기 제휴 목표 약 18만 명에서 멈춤 → 대체 채널 2곳으로 1.4만 명 보완안"}], "challenges": [{"point": "런칭과 제휴가 같은 사람·같은 시기에 겹침", "why": "제휴 하위 과제 3건이 한 사람에게 몰려 있습니다.", "prep": "데이터 정리 1건을 김도현 님에게 옮기는 재배분 계획을 함께 보고"}]}], "requests": [{"note_id": "", "title": "본부 4분기 마케팅 실행계획 초안 제출", "due": "{{D6}}", "status": "진행 중", "reply": "4분기 실행계획 초안은 비용 15% 절감과 채널별 CAC 목표를 반영해 기한 안에 제출하겠습니다. 제휴 데이터 지연에 대비한 대체 경로도 함께 넣었습니다."}, {"note_id": "", "title": "채널별 CAC 비교표를 다음 보고에 추가", "due": "", "status": "미답", "reply": "채널별 CAC는 유튜브 3.2만 · 인스타그램 2.6만 · 제휴 1.1만 원입니다. 다음 주간회의에 비교표로 정리해 가겠습니다."}], "share_first": [{"title": "B사 데이터는 11월 둘째 주 이후 — 제휴 목표 일정에 영향", "why": "다른 경로로 들으면 '왜 미리 말 안 했나'가 됩니다.", "tone": "bad"}, {"title": "런칭 사전 예약 1,840명 · 전환율 18%", "why": "본부장 관심사(효율)에 바로 답이 되는 좋은 숫자입니다.", "tone": "good"}], "watch": "B사 회신 날짜, 실행계획 제출 후 예산 배분 결정."}$j$, '{{E1}}', e1::text), '{{E2}}', e2::text), '{{D6}}', (current_date + 6)::text)::jsonb, L;
  exception when others then null;
  end;

  -- 팀원 평가: 김도현 님 예상 등급(시뮬레이션) + 의견 초안
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, subject_user_id, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'evaluation_draft', $2, 'draft', 'leader', 'L3', 3, $3, '[]'::jsonb, $4, now() - interval '1 day',
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 7 else 1 end, 1),
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 12 else 6 end, case when extract(month from current_date) >= 7 then 31 else 30 end))$q$
    using T, m_kim, $j${"grade": {"expected": "A", "range": ["B", "A"], "confidence": "medium", "rationale": "핵심 과제(신제품 런칭 기획)를 끌고 가면서 결과물의 판단 깊이가 2.0에서 3.0으로 뚜렷이 올랐고, 결과물 대부분이 한 번에 승인됐습니다. 다만 런칭 일정은 계획보다 조금 늦습니다.", "up": [{"text": "가격 전략을 데이터로 스스로 뒤집고, 버린 대안과 이유를 남김 (기획서 v3)", "evidence": []}, {"text": "결과물 8건 중 6건 승인, 그중 4건이 한 번에 통과", "evidence": []}, {"text": "본부장 질의에 근거를 들어 답함 (1:1 기록)", "evidence": []}], "down": [{"text": "시장 분석처럼 정형 업무에서는 자기 관점이 약하다는 보완점이 두 번 반복", "evidence": []}], "missing": "실행 관리(일정 준수) 근거가 아직 적어 A로 확정하기는 이릅니다. 11월 런칭 결과를 보면 확실해집니다."}, "overall": "문제를 끝까지 붙들고 방향을 다시 잡는 힘이 이번 기간 가장 두드러졌습니다. 신제품 가격 전략에서 처음 가정을 데이터로 뒤집고 대안을 비교해 남긴 과정이 대표적입니다. 결과물의 판단 깊이가 꾸준히 올라 팀의 핵심 과제를 맡길 수 있는 수준입니다. 다만 정해진 틀을 채우는 작업에서는 자기 관점이 덜 드러납니다.", "strengths": [{"title": "근거 기반의 방향 전환", "detail": "초기 가정을 고집하지 않고 데이터를 보고 전략을 고쳤습니다.", "evidence": []}, {"title": "결과물 품질의 꾸준한 상승", "detail": "판단 깊이 2.0 → 3.0, 대부분 한 번에 승인됐습니다.", "evidence": []}], "growth": [{"title": "정형 업무에서의 자기 관점", "detail": "시장 분석 등에서 일반적 정리에 머무는 경우가 있습니다.", "evidence": []}, {"title": "일정 관리", "detail": "런칭 기획이 계획보다 조금 늦습니다.", "evidence": []}], "competencies": [{"name": "문제 정의", "signal": "강함", "evidence": []}, {"name": "데이터 분석", "signal": "보통", "evidence": []}, {"name": "커뮤니케이션", "signal": "강함", "evidence": []}, {"name": "실행 관리", "signal": "근거 부족", "evidence": []}], "coaching": "다음 기간에는 일정이 분명한 과제를 맡기고 2주 단위로 진척을 함께 점검해 실행 관리 근거를 쌓으세요."}$j$::jsonb, L;
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
        "brief": {"tone": "watch", "text": "이정규 님이 올린 'CRM 웰컴 메시지 A/B안'은 결론이 잘 안 보입니다", "why": "어느 안을 권하는지·판단 기준이 없음"},
        "decisions": [],
        "strengths": [{"section": "본문", "text": "대상(제휴 유입 고객)과 테스트 기간을 분명히 했습니다."}],
        "gaps": [{"section": "본문", "text": "성공 지표와 본인 추천안이 빠져 있어 의견을 주기 어렵습니다."}],
        "questions": ["둘 중 어느 쪽이 나을 거라고 보나요, 이유는?", "2주 뒤 무엇을 보고 승자를 정하나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$)
    ) as x(title, c)
    join submissions s on s.team_id = T and s.title = x.title
    join submission_versions v on v.submission_id = s.id and v.version = 1;
    -- 최민아 11월 콘텐츠 캘린더: 보완 요청 (팀원 홈 '지금 할 일'에 뜬다)
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
    -- TF: 김도현·한수진이 같이 다듬는 키비주얼 시안 (v1 김도현 → v2 한수진)
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
--   이미 쌓이는 것: 체크인 · 1:1 · 팀장 메모 · 결과물 · 리뷰 피드백 · 관찰 메모 · 업무 완료
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
-- 팀원관리: 주간 AI 액션 추천 (1:1 · 칭찬 배지 · 관찰 기록 · 육성 · 업무 독려 · 막힘 지원 · 업무 조정)
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
--     ② 같은 대상(같은 결과물 버전 · 같은 기간 인사이트 · 같은 1:1) 다시 만들기는 하루 3번까지
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
--   · leader_attention(): 최근 N일 팀장 → 팀원 접점(1:1 · 리뷰 코멘트 · 관찰·칭찬 · 요청 · 과제 코멘트)과 리뷰 응답 시간
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
--   · 저장은 한 곳, 붙이는 곳은 여러 군데: 팀원 · 목표/과제 · 임원 · 결정 · 1:1 (anchor)
--   · 관찰 메모(observations)와 다름: 평가 근거로 쓰지 않음
--   · ai_allowed: AI가 참고해도 되는 메모 (팀장이 고름) — 1:1 준비 노트 · 팀원 액션 · ATEAM의 제안 · 임원 브리핑이 읽음. 평가 초안은 읽지 않음
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
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이정규' limit 1;
    select id into v_goal from work_items where team_id = r.team_id and parent_id is null and title like '제휴%' limit 1;
    select id into v_exec from executives where team_id = r.team_id order by sort limit 1;
    insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, pinned, created_at, updated_at) values
      (r.team_id, r.leader_id, '분기 마감 전 팀 회고는 짧게 30분 — 잘된 것 1개, 바꿀 것 1개만', 'note', 'none', null, true, now() - interval '6 days', now() - interval '6 days'),
      (r.team_id, r.leader_id, '본부장 주간회의 전에 제휴 전망 숫자 다시 확인', 'todo', 'none', null, false, now() - interval '1 day', now() - interval '1 day');
    if v_jung is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '혼자 끙끙 앓는 편. 막히면 먼저 물어봐 주는 게 효과 있음', 'member', v_jung, '정우성', true, now() - interval '9 days', now() - interval '9 days'); end if;
    if v_lee is not null then insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, created_at, updated_at)
      values (r.team_id, r.leader_id, '다음 1:1에서 교육 예산 얘기 꺼내기', 'todo', 'member', v_lee, now() - interval '3 days', now() - interval '3 days'); end if;
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
  values (new.member_id, new.team_id, 'coaching', 'ATEAM의 코칭이 도착했어요', new.title, '/?coach=' || new.id);
  return new;
end $$;
drop trigger if exists t_coaching_notify on public.coaching_notes;
create trigger t_coaching_notify after insert on public.coaching_notes for each row execute function public._coaching_notify();

-- 데모: 이정규 님에게 보낸 코칭 1건 (이미 있으면 건너뜀)
do $$
declare r record; v_lee uuid;
begin
  for r in select t.id team_id from teams t where t.is_demo loop
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이정규' limit 1;
    if v_lee is null or exists (select 1 from coaching_notes where team_id = r.team_id) then continue; end if;
    alter table coaching_notes disable trigger t_coaching_notify;
    insert into coaching_notes (team_id, member_id, title, body, created_at) values (r.team_id, v_lee,
      'CRM 연계, 방향을 한 번 맞추고 가면 훨씬 수월해져요',
      E'지금 보이는 것\n· ''제휴 유입 고객 CRM 연계''가 계획보다 조금 늦어지고 있어요\n· 혼자 맡은 과제인데 최근 3주 동안 진척 공유가 없었어요\n\n왜 중요해요\n제휴 목표와 이어진 과제라, 방향이 한 번 어긋나면 되돌리는 데 시간이 많이 들어요.\n\n이렇게 해 보세요\n· 이번 주에 지금까지 한 것과 남은 것을 3줄로 진척 공유하기\n· 막힌 부분이 있으면 ''무엇이 필요한지''를 한 줄로 같이 적기\n· 다음 결과물은 초안 단계에서 한 번 먼저 올려 방향 확인받기\n\n권장 시점 · 이번 주 금요일까지',
      now() - interval '2 days');
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
--   · 팀원 → 팀장 '1:1 요청' (team_requests kind=meeting) — 팀장 알림이 팀원 상세로 이어지고, 팀장에게 평가 근거가 쌓이지 않게
--   · AI 체크인 초안 (ai_kind 'checkin_draft')
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'checkin_draft';

drop policy if exists obs_member_praise on public.observations;
create policy obs_member_praise on public.observations for select to authenticated
  using (subject_id = auth.uid() and kind = 'praise');

-- 알림: 요청 / 성장 제안 / 팀장님 격려 / 팀원의 1:1 요청
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_up boolean;
begin
  v_up := new.to_id = public._team_leader(new.team_id);   -- 팀원 → 팀장
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case when v_up and new.kind = 'meeting' then '1:1 요청: ' when new.kind = 'grow' then '성장 제안: ' when new.kind = 'cheer' then '팀장님 격려: ' else '요청: ' end || new.title,
      left(new.body, 120), case when v_up then '/people/' || new.from_id || '?oo=1' else '/' end);
    if new.kind = 'plan' and new.item_id is not null then
      update work_items set needs_plan = true where id = new.item_id;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case when v_up and new.kind = 'meeting' then '1:1 요청 확인: ' when new.kind = 'grow' then '성장 제안 답: ' when new.kind = 'cheer' then '격려 확인: ' else '완료: ' end || new.title,
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
('oo_flow', 'coaching', '1:1 대화 순서',
 '근황과 지난 이후 변화 → 잘된 것과 어려웠던 것(그 원인) → 앞으로의 우선순위와 목표 유지·수정 → 내가 도울 것. 팀장이 지키지 못한 약속이 있으면 그것부터 꺼낸다. 진척 확인은 체크인으로 보고, 1:1에서는 사람과 막힘을 본다.',
 '["밀린 팀장 약속을 첫 안건으로", "마지막 질문은 내가 도울 것", "1:1에서 진척 점검만 하지 않는다"]',
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
      case when v_up and new.kind = 'meeting' then '1:1 요청: ' when new.kind = 'change' then '목표 변경 요청: '
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
      case when v_up and new.kind = 'meeting' then '1:1 요청 확인: ' when new.kind = 'change' then '변경 요청 처리: '
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
