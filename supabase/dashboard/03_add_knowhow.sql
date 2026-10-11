-- =====================================================================
-- ATEAM · 0007 팀장 노하우 (Leader Knowhow)
-- 팀장이 자기 기준·프레임워크·자료·맥락을 '던져 넣으면' AI가 카드로 정리하고,
-- 팀장이 확인한 카드는 리뷰·1:1 준비·주간보고·평가·전략 점검에 자동으로 반영된다.
--   knowhow_sources : 던져 넣은 원본 (텍스트 붙여넣기 / 파일)
--   knowhow_cards   : AI가 정리했거나 팀장이 직접 쓴 카드 (AI가 실제로 읽는 단위)
-- =====================================================================

create type public.knowhow_kind as enum ('principle', 'rubric', 'framework', 'context', 'coaching', 'glossary');

create table public.knowhow_sources (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id),
  title       text not null default '',
  raw_text    text not null default '',          -- 붙여넣은 글 또는 파일에서 뽑은 본문
  file_path   text,                              -- storage: knowhow/{team_id}/{source_id}-{name}
  file_name   text,
  mime_type   text,
  status      text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  error       text,
  summary     text,                              -- AI가 쓴 '이 자료는 무엇인가' 한두 문장
  card_count  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.knowhow_sources (team_id, created_at desc);

create table public.knowhow_cards (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id),
  source_id   uuid references public.knowhow_sources(id) on delete set null,
  kind        public.knowhow_kind not null,
  title       text not null,
  body        text not null default '',
  rules       jsonb not null default '[]'::jsonb,        -- AI가 그대로 적용할 짧은 규칙들
  applies_to  text[] not null default '{}',               -- review, prep, report, evaluation, briefing, strategy, scenario
  keywords    text[] not null default '{}',
  active      boolean not null default true,              -- 끄면 AI가 읽지 않는다
  pinned      boolean not null default false,             -- 항상 먼저 반영
  shared      boolean not null default false,             -- 팀원에게 '팀장 가이드'로 공개
  provenance  public.provenance not null default 'ai',    -- ai / human / human_edit
  use_count   int not null default 0,                     -- AI 결과에 반영된 횟수
  last_used_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.knowhow_cards (team_id, active);
create index on public.knowhow_cards using gin (applies_to);

create trigger t_touch before update on public.knowhow_sources for each row execute function public.touch_updated_at();
create trigger t_touch before update on public.knowhow_cards   for each row execute function public.touch_updated_at();

-- 팀장이 AI 카드를 고치면 출처가 '팀장 수정'으로 바뀐다
create or replace function public.trg_knowhow_card() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' and old.provenance = 'ai'
     and (new.title <> old.title or new.body <> old.body or new.rules <> old.rules) then
    new.provenance := 'human_edit';
  end if;
  return new;
end $$;
create trigger t_knowhow_card before update on public.knowhow_cards for each row execute function public.trg_knowhow_card();

-- ---------- RLS ----------
alter table public.knowhow_sources enable row level security;
alter table public.knowhow_cards   enable row level security;

create policy ks_leader on public.knowhow_sources for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and owner_id = auth.uid());

create policy kc_leader on public.knowhow_cards for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and owner_id = auth.uid());
-- 팀원은 팀장이 공개한 카드만 읽는다
create policy kc_member_shared on public.knowhow_cards for select to authenticated
  using (shared and active and public.is_team_member(team_id));

-- ---------- 스토리지: 팀장만 ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('knowhow', 'knowhow', false, 26214400)
on conflict (id) do nothing;

create policy "knowhow read" on storage.objects for select to authenticated
using (bucket_id = 'knowhow' and public.is_team_leader(((storage.foldername(name))[1])::uuid));
create policy "knowhow upload" on storage.objects for insert to authenticated
with check (bucket_id = 'knowhow' and public.is_team_leader(((storage.foldername(name))[1])::uuid));
create policy "knowhow delete" on storage.objects for delete to authenticated
using (bucket_id = 'knowhow' and public.is_team_leader(((storage.foldername(name))[1])::uuid));

-- ---------- AI가 카드를 썼다는 기록 (service_role 전용) ----------
create or replace function public.mark_knowhow_used(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update knowhow_cards set use_count = use_count + 1, last_used_at = now() where id = any(p_ids);
$$;
revoke all on function public.mark_knowhow_used(uuid[]) from public, anon, authenticated;

-- 모든 요금제에서 쓸 수 있다 (첫날부터 혼자 쓰는 가치)
update public.plans set features = array_append(features, 'knowhow') where not ('knowhow' = any(features));
