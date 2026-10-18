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
