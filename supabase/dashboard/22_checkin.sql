-- ATEAM 성과 체크인 (업무플랫폼에서 목표에 성과를 점찍고 팀장 승인 → 팀목표 공식 값 · 정성 '단계' 측정 · 숫자 즉시 반영 없앰) — 21 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

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
      if v_old_depth < 2 and (new.num_current is distinct from old.num_current or new.stage_current is distinct from old.stage_current
                              or (new.progress is distinct from old.progress and new.measure::text = 'percent')) then
        raise exception 'CHECKIN_ONLY: 목표·과제의 성과 값은 체크인으로 남겨 주세요. 팀장님이 승인하면 반영됩니다';
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
