-- ATEAM 컨디션 공유 (영향 요인 · 메모 칸 추가 · 업무 칸은 보존만 · 컨디션을 평가 근거에서 제외) — 23_goal_metrics 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 컨디션 공유 (예전 '주간 체크인'을 사람의 상태만 남기도록 바꿈)
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
