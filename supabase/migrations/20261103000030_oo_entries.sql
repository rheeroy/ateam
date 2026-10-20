-- =====================================================================
-- 1on1 함께 보는 노트 → 글 쌓기
--   · 한 칸을 같이 고치면 마지막 저장이 앞사람 글을 지웠다. 이제는 각자 한 줄씩 남긴다 (작성자 · 시간)
--   · 내 글만 고치고 지운다. 예전 노트는 '이전 노트' 한 줄로 옮겨 그대로 둔다
--   · one_on_ones.shared_notes 는 이 글들을 이어 붙인 읽기용 사본으로 남긴다
--     (AI 1on1 준비 · 주간 보고 · 근거 원장이 그대로 읽는다 — 앱은 더 이상 직접 쓰지 않음)
-- 24_condition 다음에 Run. 다시 Run 해도 안전합니다 (기존 노트는 한 번만 옮겨짐).
-- =====================================================================
create table if not exists public.one_on_one_entries (
  id             uuid primary key default gen_random_uuid(),
  one_on_one_id  uuid not null references public.one_on_ones(id) on delete cascade,
  team_id        uuid not null references public.teams(id) on delete cascade,
  author_id      uuid references public.profiles(id) on delete set null,
  body           text not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  legacy         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists one_on_one_entries_oo_idx on public.one_on_one_entries (one_on_one_id, created_at);
alter table public.one_on_one_entries enable row level security;

-- 읽기: 그 팀의 팀장 · 그 1on1의 팀원
drop policy if exists ooe_select on public.one_on_one_entries;
create policy ooe_select on public.one_on_one_entries for select to authenticated
  using (public.is_team_leader(team_id) or exists (select 1 from public.one_on_ones o where o.id = one_on_one_id and o.member_id = auth.uid()));
-- 쓰기: 본인 이름으로, 그 1on1의 당사자만
drop policy if exists ooe_insert on public.one_on_one_entries;
create policy ooe_insert on public.one_on_one_entries for insert to authenticated
  with check (author_id = auth.uid() and legacy = false and exists (
    select 1 from public.one_on_ones o where o.id = one_on_one_id and o.team_id = team_id
      and (o.member_id = auth.uid() or o.leader_id = auth.uid() or public.is_team_leader(o.team_id))));
-- 고치기 · 지우기: 내 글만
drop policy if exists ooe_update on public.one_on_one_entries;
create policy ooe_update on public.one_on_one_entries for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists ooe_delete on public.one_on_one_entries;
create policy ooe_delete on public.one_on_one_entries for delete to authenticated
  using (author_id = auth.uid());

create or replace function public._ooe_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.one_on_one_id <> old.one_on_one_id or new.team_id <> old.team_id or new.author_id is distinct from old.author_id then
    raise exception 'ENTRY_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists t_ooe_touch on public.one_on_one_entries;
create trigger t_ooe_touch before update on public.one_on_one_entries for each row execute function public._ooe_touch();

-- 글이 바뀌면 읽기용 사본(shared_notes)과 근거 원장을 다시 만든다
create or replace function public._ooe_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_oo uuid := coalesce(new.one_on_one_id, old.one_on_one_id); v text; r public.one_on_ones;
begin
  select coalesce(string_agg(case when e.legacy then e.body else '[' || coalesce(p.full_name, '') || '] ' || e.body end, E'\n' order by e.created_at), '')
    into v from public.one_on_one_entries e left join public.profiles p on p.id = e.author_id where e.one_on_one_id = v_oo;
  update public.one_on_ones set shared_notes = v where id = v_oo and shared_notes is distinct from v returning * into r;
  if r.id is not null and r.status = 'done' then
    perform public.upsert_evidence(r.team_id, r.member_id, 'one_on_one', r.id, '1on1 — ' || left(v, 300), 'neutral', null, r.scheduled_at);
  end if;
  return null;
end $$;
drop trigger if exists t_ooe_sync on public.one_on_one_entries;
create trigger t_ooe_sync after insert or update or delete on public.one_on_one_entries for each row execute function public._ooe_sync();

-- 노트를 들고 만들어진 1on1(데모 · 예전 방식)은 그 노트를 '이전 노트' 한 줄로
create or replace function public._oo_legacy_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if btrim(coalesce(new.shared_notes, '')) <> '' and not exists (select 1 from public.one_on_one_entries where one_on_one_id = new.id) then
    insert into public.one_on_one_entries (one_on_one_id, team_id, author_id, body, legacy, created_at)
    values (new.id, new.team_id, new.leader_id, left(new.shared_notes, 2000), true, coalesce(new.completed_at, new.scheduled_at, now()));
  end if;
  return null;
end $$;
drop trigger if exists t_oo_legacy_entry on public.one_on_ones;
create trigger t_oo_legacy_entry after insert on public.one_on_ones for each row execute function public._oo_legacy_entry();

-- 기존 노트 옮기기 (다시 Run 해도 한 번만)
insert into public.one_on_one_entries (one_on_one_id, team_id, author_id, body, legacy, created_at)
select o.id, o.team_id, o.leader_id, left(o.shared_notes, 2000), true, coalesce(o.completed_at, o.scheduled_at, o.created_at)
from public.one_on_ones o
where btrim(coalesce(o.shared_notes, '')) <> '' and not exists (select 1 from public.one_on_one_entries e where e.one_on_one_id = o.id);
