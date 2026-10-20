-- ATEAM v2 업그레이드 — 예전 01_schema.sql 을 이미 실행한 프로젝트에서 한 번 Run (새 프로젝트는 01에 포함되어 있으니 건너뜀)
-- 기존 전략 목표·과제·마일스톤 데이터는 새 구조(work_items)로 옮겨집니다.

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
