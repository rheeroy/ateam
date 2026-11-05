-- =====================================================================
-- 팀원 활동 지수 — 팀원이 앱에 남긴 업무 기록을 주 단위로 센다 (팀장 본인 또는 service role 만)
--   대화(업무 스페이스 글) · 결과물(올린 버전) · 업데이트(진척 기록 · 과제 상태·일정 변경) · 응답(리뷰 코멘트 · 과제 코멘트 · 요청 답 · 1on1 글) · 컨디션 공유
--   시간외 = 한국 시간 21시~7시 또는 토·일
--   접속 · 열람 같은 행동은 세지 않는다 (감시 도구가 아니라 업무 흐름의 변화를 보는 지표)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
create or replace function public.member_activity(p_team uuid, p_weeks int default 8)
returns table (user_id uuid, week_start date, total int, off_hours int, talk int, output int, updates int, replies int, checkin int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_from date := (date_trunc('week', (now() at time zone 'Asia/Seoul'))::date - (greatest(1, least(p_weeks, 26)) - 1) * 7);
  v_since timestamptz := (v_from::timestamp at time zone 'Asia/Seoul');
begin
  if not public.is_team_leader(p_team) and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden'; end if;
  return query
  with m as (
    select tm.user_id uid from team_members tm where tm.team_id = p_team and tm.role = 'member' and tm.status = 'active'
  ), e as (
    select s.author_id uid, 'talk' k, s.created_at at from space_messages s where s.team_id = p_team and s.created_at >= v_since
    union all select v.created_by, 'output', v.created_at from submission_versions v where v.team_id = p_team and v.created_at >= v_since
    union all select l.author_id, 'update', l.created_at from work_item_logs l where l.team_id = p_team and l.created_at >= v_since
    union all select ev.actor_id, 'update', ev.created_at from work_item_events ev where ev.team_id = p_team and ev.created_at >= v_since and ev.kind in ('status', 'replan', 'created')
    union all select c.author_id, 'reply', c.created_at from review_comments c where c.team_id = p_team and c.created_at >= v_since
    union all select c.author_id, 'reply', c.created_at from work_item_comments c where c.team_id = p_team and c.created_at >= v_since
    union all select r.to_id, 'reply', r.responded_at from team_requests r where r.team_id = p_team and r.responded_at >= v_since
    union all select x.author_id, 'reply', x.created_at from one_on_one_entries x where x.team_id = p_team and x.created_at >= v_since
    union all select ci.user_id, 'checkin', ci.created_at from checkins ci where ci.team_id = p_team and ci.created_at >= v_since
  ), k as (
    select e.uid, e.k, (e.at at time zone 'Asia/Seoul') lt from e join m on m.uid = e.uid
  )
  select k.uid, date_trunc('week', k.lt)::date,
         count(*)::int,
         count(*) filter (where extract(hour from k.lt) >= 21 or extract(hour from k.lt) < 7 or extract(isodow from k.lt) >= 6)::int,
         count(*) filter (where k.k = 'talk')::int, count(*) filter (where k.k = 'output')::int,
         count(*) filter (where k.k = 'update')::int, count(*) filter (where k.k = 'reply')::int,
         count(*) filter (where k.k = 'checkin')::int
    from k group by 1, 2 order by 1, 2;
end $$;
revoke all on function public.member_activity(uuid, int) from public, anon;
grant execute on function public.member_activity(uuid, int) to authenticated;
