-- ATEAM 업무 스페이스 채팅형 (스페이스 칸 · 대화 메시지 · 읽음 표시 · 팀장 글) — 18 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 업무 스페이스 (채팅형) — 개인 스페이스(나↔팀장) · 그룹방이 같은 화면
--   · submissions.space_id : 개인 스페이스 주인(팀원). 팀장도 팀원 스페이스에 업무 카드를 올릴 수 있다
--   · space_messages       : 그냥 대화(말풍선)와 그 스레드 답글. 과제 태그 선택. 평가 근거로 남기지 않음
--   · space_reads          : 스페이스별 마지막으로 읽은 때 (안 읽음 표시)
--   · 팀장이 올린 업무 카드는 팀원의 평가 근거로 남기지 않는다
-- 18_work_groups.sql 다음에 Run. 다시 Run 해도 안전합니다.
-- =====================================================================

-- ---------- 결과물: 어느 스페이스의 글인가 ----------
alter table public.submissions add column if not exists space_id uuid references public.profiles(id) on delete set null;
create index if not exists submissions_space_idx on public.submissions (team_id, space_id);
update public.submissions set space_id = author_id where space_id is null and group_id is null;

create or replace function public.trg_submission_space() returns trigger
language plpgsql as $$
begin
  if new.space_id is null and new.group_id is null then new.space_id := new.author_id; end if;
  if new.group_id is not null then new.space_id := null; end if;
  return new;
end $$;
drop trigger if exists t_sub_space on public.submissions;
create trigger t_sub_space before insert on public.submissions for each row execute function public.trg_submission_space();

create or replace function public.can_see_submission(p_submission uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from submissions s
                 where s.id = p_submission
                   and (s.author_id = auth.uid() or s.space_id = auth.uid() or public.is_team_leader(s.team_id)
                        or (s.group_id is not null and public.in_work_group(s.group_id))));
$$;

drop policy if exists sub_select on public.submissions;
create policy sub_select on public.submissions for select to authenticated
  using (author_id = auth.uid() or space_id = auth.uid() or public.is_team_leader(team_id)
         or (group_id is not null and public.in_work_group(group_id)));
drop policy if exists sub_insert on public.submissions;
create policy sub_insert on public.submissions for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id)
              and (case when group_id is not null then public.in_work_group(group_id) or public.is_team_leader(team_id)
                        else space_id is null or space_id = auth.uid()
                             or (public.is_team_leader(team_id) and exists (select 1 from team_members m where m.team_id = submissions.team_id and m.user_id = submissions.space_id))
                   end));

-- 팀장이 올린 카드는 평가 근거·리뷰 대기에서 뺀다 (기존 동작은 그대로)
create or replace function public.trg_submission_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions; v_leader boolean;
begin
  select * into v_sub from submissions where id = new.submission_id;
  v_leader := v_sub.author_id = public._team_leader(v_sub.team_id);
  update submissions set status = (case when v_sub.request_type = 'share' or v_leader then 'shared' else 'in_review' end)::submission_status,
                         updated_at = now() where id = new.submission_id;
  perform log_event(new.team_id, 'submission.version', 'submission_versions', new.id, v_sub.author_id, 'human',
                    jsonb_build_object('version', new.version, 'title', v_sub.title, 'kind', v_sub.kind));
  if not v_leader then
    perform upsert_evidence(new.team_id, v_sub.author_id, 'submission', new.id,
      v_sub.title || ' v' || new.version || case when new.note <> '' then ' — ' || new.note else '' end,
      'neutral', null, new.created_at);
  end if;
  if v_sub.kind = 'number' and new.value is not null and v_sub.item_id is not null then
    update work_items set num_current = new.value where id = v_sub.item_id and measure = 'number';
  end if;
  return new;
end $$;

-- 결과물 알림: 팀장 · 올린 사람 · 스페이스 주인 · 그룹 멤버
create or replace function public.trg_submission_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sub submissions; v_actor uuid; v_title text; v_body text; v_kind text; v_lead uuid;
begin
  select * into v_sub from submissions where id = new.submission_id;
  v_lead := public._team_leader(v_sub.team_id);
  if tg_table_name = 'submission_versions' then
    v_actor := new.created_by; v_kind := 'submission';
    v_title := case when v_sub.author_id = v_lead then '팀장님 공유: ' when v_sub.request_type = 'share' then '공유: ' when v_sub.request_type = 'feedback' then '피드백 요청: ' else '리뷰 요청: ' end || v_sub.title;
    v_body := coalesce((select full_name from profiles where id = v_actor), '');
    perform public._notify(v_lead, v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
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
    if new.author_id is distinct from v_lead then
      perform public._notify(v_lead, v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
    end if;
  end if;
  if v_sub.space_id is not null and v_sub.space_id <> v_sub.author_id and v_sub.space_id is distinct from v_actor then
    perform public._notify(v_sub.space_id, v_sub.team_id, v_kind, v_title, v_body, '/work/' || v_sub.id);
  end if;
  if v_sub.group_id is not null then
    perform public._notify(m.user_id, v_sub.team_id, v_kind, '[' || g.name || '] ' || v_title, v_body, '/work/' || v_sub.id)
      from work_group_members m join work_groups g on g.id = m.group_id
     where m.group_id = v_sub.group_id and m.user_id <> v_actor and m.user_id <> v_sub.author_id
       and m.user_id <> coalesce(v_lead, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  return new;
end $$;

-- ---------- 그냥 대화 ----------
create table if not exists public.space_messages (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  space_user uuid references public.profiles(id) on delete cascade,      -- 개인 스페이스 주인 (그룹이면 null)
  group_id   uuid references public.work_groups(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  parent_id  uuid references public.space_messages(id) on delete cascade, -- 스레드 답글
  item_id    uuid references public.work_items(id) on delete set null,   -- 과제 태그 (선택)
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  check ((space_user is null) <> (group_id is null))
);
create index if not exists space_messages_space_idx on public.space_messages (team_id, space_user, created_at);
create index if not exists space_messages_group_idx on public.space_messages (group_id, created_at);
create index if not exists space_messages_parent_idx on public.space_messages (parent_id);

alter table public.space_messages enable row level security;
drop policy if exists sm_select on public.space_messages;
create policy sm_select on public.space_messages for select to authenticated
  using (public.is_team_leader(team_id) or space_user = auth.uid() or (group_id is not null and public.in_work_group(group_id)));
drop policy if exists sm_insert on public.space_messages;
create policy sm_insert on public.space_messages for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id)
              and (case when group_id is not null then public.in_work_group(group_id) or public.is_team_leader(team_id)
                        else space_user = auth.uid()
                             or (public.is_team_leader(team_id) and exists (select 1 from team_members m where m.team_id = space_messages.team_id and m.user_id = space_messages.space_user))
                   end));
drop policy if exists sm_update on public.space_messages;
create policy sm_update on public.space_messages for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists sm_delete on public.space_messages;
create policy sm_delete on public.space_messages for delete to authenticated using (author_id = auth.uid());

-- 대화 알림: 개인 스페이스는 상대에게, 그룹방 새 글은 멤버에게, 스레드 답글은 그 스레드 참여자에게
create or replace function public.trg_space_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead uuid; v_name text; v_root space_messages; v_g work_groups;
begin
  v_lead := public._team_leader(new.team_id);
  v_name := coalesce((select full_name from profiles where id = new.author_id), '');
  if new.parent_id is not null then
    select * into v_root from space_messages where id = new.parent_id;
    perform public._notify(u.uid, new.team_id, 'space.reply', '답글: ' || v_name, left(new.body, 120),
        case when new.group_id is not null then (case when u.uid = v_lead then '/work/g/' || new.group_id else '/my/submissions?g=' || new.group_id end)
             else (case when u.uid = v_lead then '/work/u/' || new.space_user else '/my/submissions' end) end)
      from (select v_root.author_id as uid union select author_id from space_messages where parent_id = new.parent_id) u
     where u.uid <> new.author_id;
  elsif new.group_id is not null then
    select * into v_g from work_groups where id = new.group_id;
    perform public._notify(m.user_id, new.team_id, 'space.message', '[' || v_g.name || '] ' || v_name, left(new.body, 120), '/my/submissions?g=' || new.group_id)
      from work_group_members m where m.group_id = new.group_id and m.user_id <> new.author_id;
  elsif new.author_id = new.space_user then
    perform public._notify(v_lead, new.team_id, 'space.message', '메시지: ' || v_name, left(new.body, 120), '/work/u/' || new.space_user);
  else
    perform public._notify(new.space_user, new.team_id, 'space.message', '팀장님 메시지', left(new.body, 120), '/my/submissions');
  end if;
  return new;
end $$;
drop trigger if exists t_space_message on public.space_messages;
create trigger t_space_message after insert on public.space_messages for each row execute function public.trg_space_message();

-- ---------- 읽음 표시 ----------
create table if not exists public.space_reads (
  user_id   uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  team_id   uuid not null references public.teams(id) on delete cascade,
  space_key text not null,              -- 'u:<팀원 id>' | 'g:<그룹 id>'
  read_at   timestamptz not null default now(),
  primary key (user_id, space_key)
);
alter table public.space_reads enable row level security;
drop policy if exists sr_all on public.space_reads;
create policy sr_all on public.space_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
