-- =====================================================================
-- AUTOPILOT (자율주행) — 팀장이 버튼을 누르면 핵심 질문 7개를 진단하고, 바로 보낼 액션까지 준비한다
--   · 실행 횟수: 체험 14일 동안 1번 · Starter 월 3회 · Pro 월 5회 · Pro+ 월 8회 (매월 1일 KST 초기화)
--   · 모드(teams.settings.autopilot): direct(기본, 아무것도 자동 발송 안 함) · semi(허용한 액션만) · auto(전부)
--     모드는 '다음 실행부터' 적용된다 — 실행할 때의 모드가 autopilot_runs.mode 에 남는다
--   · 자동으로 보낸 것은 via_autopilot = true → 팀원 화면에 "팀장님 설정에 따라 ATEAM이 보냄"
--   · 보낸 뒤 10분 안에는 되돌릴 수 있다 (autopilot_undo)
--   · 매주 자동으로 만들던 'ATEAM AI의 제안'(advisor-weekly)은 끈다
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'autopilot';

alter table public.plans add column if not exists autopilot_monthly int not null default 0;
update public.plans set autopilot_monthly = 3 where id = 'starter';
update public.plans set autopilot_monthly = 5 where id = 'pro';
update public.plans set autopilot_monthly = 8 where id = 'pro_plus';
update public.plans set autopilot_monthly = 0 where id = 'free';

alter table public.team_requests   add column if not exists via_autopilot boolean not null default false;
alter table public.observations    add column if not exists via_autopilot boolean not null default false;
alter table public.review_comments add column if not exists via_autopilot boolean not null default false;

create table if not exists public.autopilot_runs (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  leader_id   uuid not null references public.profiles(id) on delete cascade,
  mode        text not null default 'direct' check (mode in ('direct', 'semi', 'auto')),
  allow       jsonb not null default '{}'::jsonb,          -- 실행 시점의 액션별 허용값 (semi 일 때)
  status      text not null default 'running' check (status in ('running', 'done', 'failed')),
  step        int not null default 0,                      -- 0: 데이터 읽는 중 · 1~7: 질문 · 8: 정리
  output      jsonb,                                       -- 진단 · 시뮬레이션 · 액션 (액션마다 key)
  actions     jsonb not null default '{}'::jsonb,          -- key → { status: sent|skip, ref_table, ref_id, at, auto }
  ai_output_id uuid references public.ai_outputs(id) on delete set null,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists autopilot_runs_team_idx on public.autopilot_runs (team_id, created_at desc);
-- 한 팀에 진행 중인 실행은 하나만 (두 탭 · 두 번 누르기로 중복 실행 · 중복 발송되지 않게)
create unique index if not exists autopilot_runs_one_running on public.autopilot_runs (team_id) where status = 'running';
alter table public.autopilot_runs enable row level security;
drop policy if exists autopilot_runs_leader_read on public.autopilot_runs;
create policy autopilot_runs_leader_read on public.autopilot_runs for select using (public.is_team_leader(team_id));

-- 이번 기간 실행 가능 횟수
create or replace function public.autopilot_quota(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_plan plans; v_sub subscriptions; v_from timestamptz; v_limit int; v_used int; v_trial boolean;
begin
  if auth.uid() is not null and not public.is_team_leader(p_team) then raise exception 'forbidden' using errcode = '42501'; end if;
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then return null; end if;
  -- 10분 넘게 '진행 중'인 실행은 멈춘 것으로 보고 실패 처리 (횟수에서 빠진다)
  update autopilot_runs set status = 'failed', error = coalesce(error, '시간 안에 끝나지 않았습니다'), finished_at = now()
   where team_id = p_team and status = 'running' and created_at < now() - interval '10 minutes';
  v_plan := public.effective_plan_for_owner(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  v_trial := v_sub.status = 'trialing' and coalesce(v_sub.trial_ends_at, now() + interval '1 day') > now();
  if v_trial then
    v_limit := 1;
    v_from := coalesce(v_sub.current_period_start, v_sub.trial_ends_at - interval '14 days', now() - interval '14 days');
  else
    v_limit := coalesce(v_plan.autopilot_monthly, 0);
    v_from := (date_trunc('month', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul';
  end if;
  select count(*) into v_used from autopilot_runs where team_id = p_team and status <> 'failed' and created_at >= v_from;
  return jsonb_build_object('limit', v_limit, 'used', v_used, 'remaining', greatest(0, v_limit - v_used), 'trial', v_trial,
    'resets_at', case when v_trial then null else ((date_trunc('month', now() at time zone 'Asia/Seoul') + interval '1 month') at time zone 'Asia/Seoul') end);
end $$;
revoke all on function public.autopilot_quota(uuid) from public, anon;
grant execute on function public.autopilot_quota(uuid) to authenticated;

-- 실행 시작 (서비스 전용) — 팀 단위 잠금 안에서 진행 중 확인 · 횟수 확인 · 기록을 한 번에
create or replace function public.autopilot_start(p_team uuid, p_leader uuid, p_mode text, p_allow jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q jsonb; v_id uuid;
begin
  if auth.uid() is not null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('autopilot:' || p_team::text));
  v_q := public.autopilot_quota(p_team);
  select id into v_id from autopilot_runs where team_id = p_team and status = 'running' limit 1;
  if v_id is not null then return jsonb_build_object('run_id', v_id, 'existing', true); end if;
  if coalesce((v_q ->> 'remaining')::int, 0) <= 0 then
    raise exception 'AUTOPILOT_LIMIT' using errcode = 'P0001', hint = case when (v_q ->> 'trial')::boolean then 'trial' else 'month' end;
  end if;
  insert into autopilot_runs (team_id, leader_id, mode, allow) values (p_team, p_leader, coalesce(p_mode, 'direct'), coalesce(p_allow, '{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('run_id', v_id, 'existing', false);
end $$;
revoke all on function public.autopilot_start(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- 설정 저장 — autopilot 키만 바꾼다 (다른 설정을 덮어쓰지 않게)
create or replace function public.autopilot_save_settings(p_team uuid, p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_settings ->> 'mode', '') not in ('direct', 'semi', 'auto') then raise exception 'BAD_MODE'; end if;
  update teams set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('autopilot',
    jsonb_build_object('mode', p_settings ->> 'mode', 'allow', coalesce(p_settings -> 'allow', '{}'::jsonb))) where id = p_team;
end $$;
revoke all on function public.autopilot_save_settings(uuid, jsonb) from public, anon;
grant execute on function public.autopilot_save_settings(uuid, jsonb) to authenticated;

-- 액션 하나 보내기 — 결과 화면에서 팀장이 [보내기](p_auto=false) · 실행 직후 자동 발송(서비스, p_auto=true)
--   p_body 가 있으면 고쳐 쓴 문구로 보낸다. 이미 보낸 것은 다시 보내지 않는다.
create or replace function public.autopilot_send(p_run uuid, p_key text, p_body text default null, p_auto boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r autopilot_runs; a jsonb; v_type text; v_to uuid; v_body text; v_item uuid; v_sub uuid; v_ver uuid; v_id uuid; v_tbl text; v_title text; v_by uuid;
begin
  select * into r from autopilot_runs where id = p_run for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if auth.uid() is not null then
    if not public.is_team_leader(r.team_id) then raise exception 'forbidden' using errcode = '42501'; end if;
    p_auto := false;
  end if;
  if coalesce(r.actions -> p_key ->> 'status', '') = 'sent' then return r.actions -> p_key; end if;
  select x into a from jsonb_array_elements(coalesce(r.output -> 'actions', '[]'::jsonb)) x where x ->> 'key' = p_key;
  if a is null then raise exception 'NO_ACTION'; end if;
  -- 민감 내용은 어떤 경우에도 자동으로 보내지 않는다
  if p_auto and coalesce(a ->> 'sensitive', '') <> '' then raise exception 'SENSITIVE'; end if;
  v_by := coalesce(auth.uid(), r.leader_id);
  v_type := a ->> 'type';
  v_to := nullif(a ->> 'member_id', '')::uuid;
  v_body := left(coalesce(nullif(trim(p_body), ''), a ->> 'message'), 600);
  v_item := nullif(a ->> 'item_id', '')::uuid;
  v_sub := nullif(a ->> 'submission_id', '')::uuid;
  if v_to is null or not exists (select 1 from team_members where team_id = r.team_id and user_id = v_to and status = 'active') then raise exception 'NOT_MEMBER'; end if;
  if v_item is not null and not exists (select 1 from work_items where id = v_item and team_id = r.team_id) then v_item := null; end if;

  if v_type = 'praise' then
    insert into observations (team_id, author_id, subject_id, kind, body, via_autopilot)
      values (r.team_id, v_by, v_to, 'praise', '[칭찬 배지] ' || v_body, p_auto) returning id into v_id;   -- 알림은 t_praise_notify 가 보낸다
    v_tbl := 'observations';
  elsif v_type = 'memo' then
    insert into observations (team_id, author_id, subject_id, kind, body, via_autopilot)
      values (r.team_id, v_by, v_to, 'note', v_body, p_auto) returning id into v_id;
    v_tbl := 'observations';
  elsif v_type in ('cheer', 'grow', 'push', 'progress', 'plan', 'oo') then
    v_title := left(split_part(v_body, E'\n', 1), 200);
    insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, via_autopilot)
      values (r.team_id, v_by, v_to,
        case v_type when 'cheer' then 'cheer' when 'grow' then 'grow' when 'plan' then 'plan' when 'oo' then 'meeting' else 'progress' end,
        case when v_type in ('progress', 'plan') then v_item else null end,
        v_title, case when length(v_body) > length(v_title) then v_body else '' end, p_auto)
      returning id into v_id;
    v_tbl := 'team_requests';
  elsif v_type in ('thread', 'rework') then
    if v_sub is null or not exists (select 1 from submissions where id = v_sub and team_id = r.team_id) then raise exception 'NO_SUBMISSION'; end if;
    select id into v_ver from submission_versions where submission_id = v_sub order by version desc limit 1;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, via_autopilot)
      values (v_sub, v_ver, r.team_id, v_by, v_body, p_auto) returning id into v_id;
    v_tbl := 'review_comments';
  else
    raise exception 'BAD_TYPE';
  end if;

  -- 자동으로 보낸 칭찬·관찰 메모는 평가 근거에서 'AI가 쓴 것'으로 남긴다
  if p_auto and v_tbl = 'observations' then update evidence set provenance = 'ai' where source_id = v_id; end if;

  update autopilot_runs set actions = actions || jsonb_build_object(p_key,
    jsonb_build_object('status', 'sent', 'ref_table', v_tbl, 'ref_id', v_id, 'at', now(), 'auto', p_auto, 'body', v_body))
   where id = p_run;
  return jsonb_build_object('status', 'sent', 'ref_table', v_tbl, 'ref_id', v_id, 'at', now(), 'auto', p_auto);
end $$;
revoke all on function public.autopilot_send(uuid, text, text, boolean) from public, anon;
grant execute on function public.autopilot_send(uuid, text, text, boolean) to authenticated;

-- 보낸 지 10분 안이면 되돌리기 (보낸 기록을 지운다)
create or replace function public.autopilot_undo(p_run uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r autopilot_runs; s jsonb; v_ref uuid; v_req team_requests;
begin
  select * into r from autopilot_runs where id = p_run for update;
  if r.id is null or not public.is_team_leader(r.team_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  s := r.actions -> p_key;
  if coalesce(s ->> 'status', '') <> 'sent' then raise exception 'NOT_SENT'; end if;
  -- 자동으로 보낸 것은 결과가 나온 때부터 10분
  if greatest((s ->> 'at')::timestamptz, case when (s ->> 'auto')::boolean then coalesce(r.finished_at, now()) else (s ->> 'at')::timestamptz end) < now() - interval '10 minutes' then
    raise exception 'UNDO_EXPIRED';
  end if;
  v_ref := (s ->> 'ref_id')::uuid;
  if s ->> 'ref_table' = 'observations' then delete from observations where id = v_ref and team_id = r.team_id;
  elsif s ->> 'ref_table' = 'team_requests' then
    select * into v_req from team_requests where id = v_ref and team_id = r.team_id;
    delete from team_requests where id = v_ref and team_id = r.team_id;
    -- 계획 요청으로 켜진 '계획 필요' 표시는 다른 열린 계획 요청이 없으면 끈다
    if v_req.kind = 'plan' and v_req.item_id is not null and not exists (select 1 from team_requests where item_id = v_req.item_id and kind = 'plan' and status = 'open') then
      update work_items set needs_plan = false where id = v_req.item_id;
    end if;
  elsif s ->> 'ref_table' = 'review_comments' then delete from review_comments where id = v_ref and team_id = r.team_id;
  end if;
  -- 함께 생긴 평가 근거 · 팀원 알림도 지운다 (같은 트랜잭션에서 생겨 시각이 같다)
  delete from evidence where source_id = v_ref;
  delete from notifications where team_id = r.team_id and created_at = (s ->> 'at')::timestamptz
    and user_id = (select (x ->> 'member_id')::uuid from jsonb_array_elements(coalesce(r.output -> 'actions', '[]'::jsonb)) x where x ->> 'key' = p_key);
  update autopilot_runs set actions = actions - p_key where id = p_run;
  return jsonb_build_object('status', 'wait');
end $$;
revoke all on function public.autopilot_undo(uuid, text) from public, anon;
grant execute on function public.autopilot_undo(uuid, text) to authenticated;

-- 건너뛰기 · 다시 보기 (기록만)
create or replace function public.autopilot_mark(p_run uuid, p_key text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r autopilot_runs;
begin
  select * into r from autopilot_runs where id = p_run for update;
  if r.id is null or not public.is_team_leader(r.team_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(r.actions -> p_key ->> 'status', '') = 'sent' then return; end if;
  if p_status = 'skip' then update autopilot_runs set actions = actions || jsonb_build_object(p_key, jsonb_build_object('status', 'skip', 'at', now())) where id = p_run;
  else update autopilot_runs set actions = actions - p_key where id = p_run; end if;
end $$;
revoke all on function public.autopilot_mark(uuid, text, text) from public, anon;
grant execute on function public.autopilot_mark(uuid, text, text) to authenticated;

-- 매주 자동으로 만들던 'ATEAM AI의 제안'은 끈다 (자율주행은 팀장이 직접 실행)
do $$ begin perform cron.unschedule('advisor-weekly'); exception when others then null; end $$;
