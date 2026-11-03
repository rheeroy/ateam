-- ATEAM 핵심 업무 (해마다 이름이 다른 과제를 AI가 묶고 여러 해 흐름을 정리) — 39_decision_asks 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 핵심 업무 — 해마다 이름이 다른 과제들을 AI가 '같은 일의 연속'으로 묶고, 여러 해의 흐름을 정리한다 (Pro부터 · 히스토리 관리 안)
--   · core_works          : 핵심 업무 한 줄 (AI 정리: 현황 · 담당 시기 · 해마다 한 줄 · 지켜 온 원칙 · 반복되는 일 · 해 봤는데 안 된 것 ·
--                           오래 이어진 관계자 · 열린 숙제 · 조심할 것 · 확인 필요)
--   · core_work_items     : 어느 과제가 어느 핵심 업무에 묶였는지 (AI가 묶고 옮긴다 · 팀장 승인 없음 · 이유를 남긴다)
--   · core_work_chapters  : 끝난 과제(또는 해가 지난 과제)를 한 장으로 접어 고정한 것 — 핵심 업무 정리는 원본 대신 이 장들을 읽는다
--   · core_work_state     : 팀별 마지막 정리 상태 · 'AI가 한 일' 기록
--   · history_shares      : 핵심 업무도 전달할 수 있게 (item_id 대신 core_work_id)
--   매주 월요일 06:30 (KST) 자동 — 과제 히스토리 업데이트(06:00) 다음. 팀장은 [지금 정리]도 가능
-- 30_history.sql 다음에 Run. 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'core_work';

create table if not exists public.core_works (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  title       text not null,
  summary     text not null default '',
  content     jsonb not null default '{}'::jsonb,
  since_year  int,
  dirty       boolean not null default true,          -- 묶인 과제 · 장이 바뀌어 다시 정리할 때
  synced_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists core_works_team_idx on public.core_works (team_id, updated_at desc);

create table if not exists public.core_work_items (
  item_id      uuid primary key references public.work_items(id) on delete cascade,
  core_work_id uuid not null references public.core_works(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  reason       text not null default '',
  linked_at    timestamptz not null default now()
);
create index if not exists core_work_items_core_idx on public.core_work_items (core_work_id);

create table if not exists public.core_work_chapters (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  core_work_id uuid references public.core_works(id) on delete set null,
  item_id      uuid unique references public.work_items(id) on delete set null,   -- 앱 밖 옛 과제(데모 등)는 비어 있다
  year         int not null,
  title        text not null,
  owner_name   text not null default '',
  period       text not null default '',              -- 'YYYY-MM ~ YYYY-MM'
  content      jsonb not null default '{}'::jsonb,    -- { summary, key, decisions[], results, lessons[], carried[], people[] }
  created_at   timestamptz not null default now()
);
create index if not exists core_work_chapters_core_idx on public.core_work_chapters (core_work_id, year);

create table if not exists public.core_work_state (
  team_id     uuid primary key references public.teams(id) on delete cascade,
  status      text not null default 'ready' check (status in ('ready', 'running', 'failed')),
  started_at  timestamptz,
  finished_at timestamptz,
  actions     jsonb not null default '[]'::jsonb      -- [{ at, core_work_id, text }] 최근 것 앞, 최대 40
);

alter table public.core_works enable row level security;
alter table public.core_work_items enable row level security;
alter table public.core_work_chapters enable row level security;
alter table public.core_work_state enable row level security;
drop policy if exists cw_select on public.core_works;
create policy cw_select on public.core_works for select to authenticated using (public.is_team_leader(team_id));
drop policy if exists cwi_select on public.core_work_items;
create policy cwi_select on public.core_work_items for select to authenticated using (public.is_team_leader(team_id));
drop policy if exists cwc_select on public.core_work_chapters;
create policy cwc_select on public.core_work_chapters for select to authenticated using (public.is_team_leader(team_id));
drop policy if exists cws_select on public.core_work_state;
create policy cws_select on public.core_work_state for select to authenticated using (public.is_team_leader(team_id));
-- 만들기 · 묶기 · 정리는 서버(ai-core-works)만

-- 정리 시작 (서비스 전용) — 팀 단위 잠금 (진행 중이 10분 넘었으면 다시 시작)
create or replace function public.core_work_claim(p_team uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare r core_work_state;
begin
  insert into core_work_state (team_id) values (p_team) on conflict (team_id) do nothing;
  select * into r from core_work_state where team_id = p_team for update;
  if r.status = 'running' and r.started_at > now() - interval '10 minutes' then return false; end if;
  update core_work_state set status = 'running', started_at = now() where team_id = p_team;
  return true;
end $$;
revoke all on function public.core_work_claim(uuid) from public, anon, authenticated;

-- ---------- 전달: 핵심 업무도 ----------
alter table public.history_shares add column if not exists core_work_id uuid references public.core_works(id) on delete cascade;
alter table public.history_shares alter column item_id drop not null;
do $$ begin
  alter table public.history_shares add constraint history_shares_target check (item_id is not null or core_work_id is not null);
exception when duplicate_object then null; end $$;

create or replace function public._history_share_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text; v_link text;
begin
  select coalesce((select title from work_items where id = new.item_id), (select title from core_works where id = new.core_work_id)) into v_title;
  v_link := case when new.core_work_id is not null then '/history?core=' || new.core_work_id else '/history?item=' || new.item_id end;
  if tg_op = 'INSERT' and new.status = 'sent' then
    perform public._notify(new.to_id, new.team_id, 'history', case when new.core_work_id is not null then '팀장님이 핵심 업무 히스토리를 전달했습니다' else '팀장님이 과제 히스토리를 전달했습니다' end, coalesce(v_title, ''), '/my/history?id=' || new.id);
  elsif tg_op = 'INSERT' and new.status = 'requested' then
    perform public._notify(public._team_leader(new.team_id), new.team_id, 'history_request', '히스토리 요청: ' || coalesce(v_title, ''),
      coalesce((select full_name from profiles where id = new.to_id), '') || case when new.note <> '' then ' · ' || new.note else '' end,
      v_link || '&request=' || new.id);
  elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'sent' then
    perform public._notify(new.to_id, new.team_id, 'history', '요청한 히스토리가 도착했습니다', coalesce(v_title, ''), '/my/history?id=' || new.id);
  elsif tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'read' then
    perform public._notify(new.from_id, new.team_id, 'history_read', '전달한 히스토리를 확인했습니다',
      coalesce((select full_name from profiles where id = new.to_id), '') || ' · ' || coalesce(v_title, ''), v_link);
  end if;
  return new;
end $$;

create or replace function public._history_message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s history_shares; v_title text; v_link text;
begin
  select * into s from history_shares where id = new.share_id;
  select coalesce((select title from work_items where id = s.item_id), (select title from core_works where id = s.core_work_id)) into v_title;
  v_link := case when s.core_work_id is not null then '/history?core=' || s.core_work_id else '/history?item=' || s.item_id end;
  if new.author_id = s.to_id then
    perform public._notify(coalesce(s.from_id, public._team_leader(s.team_id)), s.team_id, 'history_question',
      '히스토리 질문: ' || coalesce(v_title, ''), left(new.body, 120), v_link || '&share=' || s.id);
  else
    perform public._notify(s.to_id, s.team_id, 'history_answer', '팀장님이 답했습니다: ' || coalesce(v_title, ''), left(new.body, 120), '/my/history?id=' || s.id);
  end if;
  update history_shares set updated_at = now() where id = new.share_id;
  return new;
end $$;

-- ---------- 매주 월요일 06:30 (KST) ----------
create or replace function public._core_works_weekly() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct team_id from task_histories loop
    if public.team_has_feature(r.team_id, 'history') then
      perform public._invoke_function('ai-core-works', jsonb_build_object('team_id', r.team_id, 'weekly', true));
    end if;
  end loop;
end $$;
revoke all on function public._core_works_weekly() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_proc where proname = '_invoke_function') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'core-works-weekly';
    perform cron.schedule('core-works-weekly', '30 21 * * 0', $c$ select public._core_works_weekly() $c$);
  end if;
end $$;
