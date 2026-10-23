-- ATEAM 목표 = 지표 + 과제 (지표가 있으면 목표 진척은 지표 평균 · 지표 값은 체크인/실적으로만 · 기존 항목 자동 분류) — 22 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

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

