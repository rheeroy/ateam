-- ATEAM 업무플랫폼 그룹 스페이스 + 대화 첨부 (그룹 멤버가 함께 보고 대화 · 새 버전 · 그룹 알림) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 업무플랫폼 그룹 스페이스 + 대화 첨부
--   · work_groups / work_group_members : 프로젝트·TF 단위로 멤버를 묶는다 (팀원도 만들 수 있고, 팀장은 전부 본다)
--   · submissions.group_id : 그룹에 올린 결과물 — 그룹 멤버 모두와 팀장이 보고 대화한다
--       새 버전은 그룹 멤버 누구나 올릴 수 있다(버전마다 올린 사람 표시). AI 1차 검토는 지금처럼 팀장만 본다
--   · review_comments 첨부(file_path …) : 팀장 피드백·대화에 참고 파일을 붙인다
--   · 알림: 그룹에 새 글·새 버전·대화가 오면 그룹 멤버에게
-- 다시 Run 해도 안전합니다.
-- =====================================================================

create table if not exists public.work_groups (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  item_id    uuid references public.work_items(id) on delete set null,   -- 연결 목표 (선택)
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists work_groups_team_idx on public.work_groups (team_id);

create table if not exists public.work_group_members (
  group_id uuid not null references public.work_groups(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  team_id  uuid not null references public.teams(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists work_group_members_user_idx on public.work_group_members (user_id);

alter table public.submissions add column if not exists group_id uuid references public.work_groups(id) on delete set null;
create index if not exists submissions_group_idx on public.submissions (group_id);
alter table public.review_comments add column if not exists file_path text;
alter table public.review_comments add column if not exists file_name text;
alter table public.review_comments add column if not exists mime_type text;

-- 내가 이 그룹 멤버인가
create or replace function public.in_work_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from work_group_members where group_id = p_group and user_id = auth.uid());
$$;
grant execute on function public.in_work_group(uuid) to authenticated;

-- 결과물 보기: 올린 사람 · 팀장 · (그룹 결과물이면) 그룹 멤버
create or replace function public.can_see_submission(p_submission uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from submissions s
                 where s.id = p_submission
                   and (s.author_id = auth.uid() or public.is_team_leader(s.team_id)
                        or (s.group_id is not null and public.in_work_group(s.group_id))));
$$;

drop policy if exists sub_select on public.submissions;
create policy sub_select on public.submissions for select to authenticated
  using (author_id = auth.uid() or public.is_team_leader(team_id) or (group_id is not null and public.in_work_group(group_id)));
drop policy if exists sub_insert on public.submissions;
create policy sub_insert on public.submissions for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id)
              and (group_id is null or public.in_work_group(group_id) or public.is_team_leader(team_id)));

-- 파일 올리기: 그 결과물을 볼 수 있는 사람이면 (그룹 멤버의 새 버전, 팀장의 피드백 첨부)
drop policy if exists "submissions upload" on storage.objects;
create policy "submissions upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'submissions'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
  and public.can_see_submission(((storage.foldername(name))[2])::uuid)
);

-- 그룹 권한
alter table public.work_groups enable row level security;
alter table public.work_group_members enable row level security;
drop policy if exists wg_select on public.work_groups;
create policy wg_select on public.work_groups for select to authenticated
  using (public.is_team_leader(team_id) or public.in_work_group(id) or created_by = auth.uid());
drop policy if exists wg_insert on public.work_groups;
create policy wg_insert on public.work_groups for insert to authenticated
  with check (public.is_team_member(team_id) and created_by = auth.uid());
drop policy if exists wg_update on public.work_groups;
create policy wg_update on public.work_groups for update to authenticated
  using (public.is_team_leader(team_id) or created_by = auth.uid());
drop policy if exists wg_delete on public.work_groups;
create policy wg_delete on public.work_groups for delete to authenticated
  using (public.is_team_leader(team_id) or created_by = auth.uid());

drop policy if exists wgm_select on public.work_group_members;
create policy wgm_select on public.work_group_members for select to authenticated
  using (public.is_team_leader(team_id) or public.in_work_group(group_id));
drop policy if exists wgm_write on public.work_group_members;
create policy wgm_write on public.work_group_members for all to authenticated
  using (public.is_team_leader(team_id) or exists (select 1 from work_groups g where g.id = group_id and g.created_by = auth.uid()))
  with check (
    (public.is_team_leader(team_id) or exists (select 1 from work_groups g where g.id = group_id and g.created_by = auth.uid()))
    and exists (select 1 from work_groups g where g.id = group_id and g.team_id = work_group_members.team_id)
    and exists (select 1 from team_members m where m.team_id = work_group_members.team_id and m.user_id = work_group_members.user_id and m.status = 'active'));

-- 알림: 팀장 · 올린 사람 + 그룹이면 그룹 멤버에게
create or replace function public.trg_submission_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions; v_actor uuid; v_title text; v_body text; v_kind text;
begin
  select * into v_sub from submissions where id = new.submission_id;
  if tg_table_name = 'submission_versions' then
    v_actor := new.created_by;
    v_kind := 'submission';
    v_title := case v_sub.request_type when 'share' then '공유: ' when 'feedback' then '피드백 요청: ' else '리뷰 요청: ' end || v_sub.title;
    v_body := coalesce((select full_name from profiles where id = v_actor), '');
    perform public._notify(public._team_leader(v_sub.team_id), v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    if v_actor is distinct from v_sub.author_id then
      perform public._notify(v_sub.author_id, v_sub.team_id, v_kind, '새 버전: ' || v_sub.title, v_body, '/work/' || v_sub.id);
    end if;
  else
    v_actor := new.author_id;
    v_kind := case when new.author_id <> v_sub.author_id then 'review.comment' else 'review.reply' end;
    v_title := case when new.author_id <> v_sub.author_id then '코멘트: ' else '답글: ' end || v_sub.title;
    v_body := left(new.body, 120);
    if new.author_id <> v_sub.author_id then
      perform public._notify(v_sub.author_id, v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    end if;
    if not public.is_team_leader(v_sub.team_id) or new.author_id = v_sub.author_id then
      perform public._notify(public._team_leader(v_sub.team_id), v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    end if;
  end if;
  if v_sub.group_id is not null then
    perform public._notify(m.user_id, v_sub.team_id, v_kind, '[' || g.name || '] ' || v_title, v_body, '/work/' || v_sub.id)
      from work_group_members m join work_groups g on g.id = m.group_id
     where m.group_id = v_sub.group_id and m.user_id <> v_actor and m.user_id <> v_sub.author_id
       and m.user_id <> coalesce(public._team_leader(v_sub.team_id), '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  return new;
end $$;
