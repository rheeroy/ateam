-- ATEAM 팀원 앱 정비 (받은 칭찬 보기 · 팀원 1:1 요청 · AI 체크인 초안) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)

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
