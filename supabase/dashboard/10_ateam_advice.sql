-- ATEAM A·Team의 제안(주간 운영 컨설팅) + 팀장 관심 지수 + 팀장 셀프 체크 — SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- A·Team의 제안 (주간 운영 컨설팅) + 팀장 관심 지수 + 팀장 셀프 체크
--   · leader_attention(): 최근 N일 팀장 → 팀원 접점(1on1 · 리뷰 코멘트 · 관찰·칭찬 · 요청 · 과제 코멘트)과 리뷰 응답 시간
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
