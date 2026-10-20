-- ATEAM 컨디션 공유 + 팀장님과 개편 + 1on1 이름 통일 (영향 요인 · 메모 칸 · 컨디션을 평가 근거에서 제외 · 칭찬 알림 · 코칭 알림 링크 · 알림 문구 1on1) — 23_goal_metrics 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

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
