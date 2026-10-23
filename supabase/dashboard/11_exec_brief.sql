-- ATEAM 상향 관리 › 임원 브리핑 (상위 관리자 프로필 · 위에서 온 것 연결 · AI 브리핑) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 상향 관리 › 임원 브리핑
--   · executives: 팀장이 관리하는 상위 관리자(여럿) — 직책 · 성향 태그 · 관심사 · 보고 선호
--   · org_notes.exec_id: 위에서 온 것(코멘트·자료·요청·방침)이 어느 관리자에게서 왔는지
--   · ai_kind 'exec_brief': 상위 관리자 시선의 주간 브리핑 (팀장이 누를 때만)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'exec_brief';

create table if not exists public.executives (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null,
  title       text not null default '',          -- 직책 (예: 마케팅본부장)
  style_tags  text[] not null default '{}',      -- 성향 (예: 숫자·근거 중시, 결론 먼저)
  interests   text not null default '',          -- 요즘 관심사·자주 묻는 것
  prefs       text not null default '',          -- 보고 선호 (형식·빈도·채널)
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists executives_team_idx on public.executives (team_id, sort);
alter table public.executives enable row level security;
drop policy if exists executives_leader on public.executives;
create policy executives_leader on public.executives for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

alter table public.org_notes add column if not exists exec_id uuid references public.executives(id) on delete set null;
