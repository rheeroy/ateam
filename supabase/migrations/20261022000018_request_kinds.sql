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
  check (kind in ('plan', 'progress', 'share', 'meeting', 'other', 'grow', 'cheer'));

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
