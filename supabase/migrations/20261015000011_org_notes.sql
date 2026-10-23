-- =====================================================================
-- 홈 개편 ④ 조직·전사: '위에서 온 것' 메모 + AI 영향 분석
--   · org_notes — 전략·방향 변경 / 임원 관심사 / 상위 요청 / 유관 부서 / 전사 일정 (팀장만 보고 씀)
--   · ai_kind 'org_impact' — 메모를 팀 목표·과제와 맞춰 본 영향 분석 (코어 AI)
-- =====================================================================
alter type public.ai_kind add value if not exists 'org_impact';

create table if not exists public.org_notes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null default auth.uid(),
  kind        text not null default 'other' check (kind in ('strategy', 'exec', 'request', 'peer', 'calendar', 'other')),
  title       text not null,
  body        text not null default '',
  source      text not null default '',        -- 어디서 들었는지 (예: 본부장 주간회의)
  event_date  date,                             -- 일정·기한 (전사 일정, 상위 요청 마감)
  status      text not null default 'open' check (status in ('open', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists org_notes_team_idx on public.org_notes (team_id, status, created_at desc);

alter table public.org_notes enable row level security;
drop policy if exists org_notes_leader on public.org_notes;
create policy org_notes_leader on public.org_notes for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

create or replace function public.touch_org_note() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists org_notes_touch on public.org_notes;
create trigger org_notes_touch before update on public.org_notes for each row execute function public.touch_org_note();

-- 예약 AI 인사이트 대상 팀: 활동 기록(events)뿐 아니라 목표·진척·요청·위에서 온 것·결과물 활동이 최근 14일에 있으면 포함
create or replace function public.active_ai_teams() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from teams t
  where public.team_has_feature(t.id, 'ai_core')
    and (not t.is_demo or t.created_at > now() - interval '14 days')
    and (
      exists (select 1 from events e where e.team_id = t.id and e.created_at > now() - interval '14 days')
      or exists (select 1 from work_items w where w.team_id = t.id and w.updated_at > now() - interval '14 days')
      or exists (select 1 from work_item_logs l where l.team_id = t.id and l.created_at > now() - interval '14 days')
      or exists (select 1 from team_requests r where r.team_id = t.id and r.created_at > now() - interval '14 days')
      or exists (select 1 from org_notes o where o.team_id = t.id and o.updated_at > now() - interval '14 days')
      or exists (select 1 from submissions s where s.team_id = t.id and s.updated_at > now() - interval '14 days')
    );
$$;
revoke all on function public.active_ai_teams() from public, anon, authenticated;
