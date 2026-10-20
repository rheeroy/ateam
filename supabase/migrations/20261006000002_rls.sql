-- =====================================================================
-- ATEAM · 0002 row level security
-- 기본: 팀원은 팀 공용 객체를 보고, 사람에 관한 기록(근거·관찰·평가)은 팀장만.
-- AI 출력은 visibility 에 따라 leader / subject / team.
-- =====================================================================

create or replace function public.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members
                 where team_id = p_team and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_team_leader(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members
                 where team_id = p_team and user_id = auth.uid() and role = 'leader' and status = 'active');
$$;

create or replace function public.shares_team(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members a join team_members b on a.team_id = b.team_id
                 where a.user_id = auth.uid() and b.user_id = p_user);
$$;

create or replace function public.can_see_submission(p_submission uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from submissions s
                 where s.id = p_submission
                   and (s.author_id = auth.uid() or public.is_team_leader(s.team_id)));
$$;

grant execute on function public.is_team_member(uuid), public.is_team_leader(uuid),
  public.shares_team(uuid), public.can_see_submission(uuid) to authenticated;

-- enable RLS everywhere
do $$ declare t text; begin
  foreach t in array array['profiles','teams','team_members','invitations','competencies','strategic_goals',
    'hypotheses','tasks','milestones','checkins','one_on_ones','one_on_one_private','action_items','observations',
    'submissions','submission_versions','review_comments','judgment_scores','metrics','metric_values',
    'metric_pipeline','task_allocations','scenarios','decisions','ai_outputs','events','evidence',
    'notifications','integrations'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- profiles ----------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_team(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- teams ----------
create policy teams_select on public.teams for select to authenticated using (public.is_team_member(id));
create policy teams_update on public.teams for update to authenticated using (public.is_team_leader(id));
-- 팀 생성은 create_team() RPC로만 (구독·멤버십을 같이 만들기 위해)

-- ---------- team_members ----------
create policy tm_select on public.team_members for select to authenticated using (public.is_team_member(team_id));
create policy tm_update on public.team_members for update to authenticated using (public.is_team_leader(team_id));
create policy tm_delete on public.team_members for delete to authenticated
  using (public.is_team_leader(team_id) and user_id <> auth.uid());

-- ---------- invitations ----------
create policy inv_all on public.invitations for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and invited_by = auth.uid());

-- ---------- competencies ----------
create policy comp_select on public.competencies for select to authenticated
  using (team_id is null or public.is_team_member(team_id));
create policy comp_write on public.competencies for all to authenticated
  using (team_id is not null and public.is_team_leader(team_id))
  with check (team_id is not null and public.is_team_leader(team_id));

-- ---------- 팀 공용 객체: 팀원 읽기, 팀장 쓰기 ----------
do $$ declare t text; begin
  foreach t in array array['strategic_goals','hypotheses','metrics','metric_values','metric_pipeline',
                           'task_allocations','scenarios','decisions'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_team_member(team_id))', t);
    execute format('create policy %1$s_write on public.%1$I for all to authenticated using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id))', t);
  end loop;
end $$;

-- tasks: 팀원 읽기, 팀장 쓰기, 담당자는 진척·상태 갱신
create policy tasks_select on public.tasks for select to authenticated using (public.is_team_member(team_id));
create policy tasks_leader on public.tasks for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
create policy tasks_owner_update on public.tasks for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy ms_select on public.milestones for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and public.is_team_member(t.team_id)));
create policy ms_write on public.milestones for all to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and (public.is_team_leader(t.team_id) or t.owner_id = auth.uid())))
  with check (exists (select 1 from tasks t where t.id = task_id and (public.is_team_leader(t.team_id) or t.owner_id = auth.uid())));

-- ---------- checkins: 본인 + 팀장 ----------
create policy ci_select on public.checkins for select to authenticated
  using (user_id = auth.uid() or public.is_team_leader(team_id));
create policy ci_insert on public.checkins for insert to authenticated
  with check (user_id = auth.uid() and public.is_team_member(team_id));
create policy ci_update on public.checkins for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 1on1 ----------
create policy oo_select on public.one_on_ones for select to authenticated
  using (public.is_team_leader(team_id) or member_id = auth.uid());
create policy oo_leader on public.one_on_ones for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and leader_id = auth.uid());
create policy oo_member_update on public.one_on_ones for update to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

-- 팀원은 shared_notes 만 바꿀 수 있다
create or replace function public.guard_one_on_one_member_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_leader(old.team_id) then
    if new.leader_id <> old.leader_id or new.member_id <> old.member_id or new.team_id <> old.team_id
       or new.scheduled_at <> old.scheduled_at or new.status <> old.status
       or new.duration_min <> old.duration_min then
      raise exception '팀원은 함께 보는 노트만 수정할 수 있습니다';
    end if;
  end if;
  return new;
end $$;
create trigger t_guard_oo before update on public.one_on_ones
  for each row execute function public.guard_one_on_one_member_update();

create policy oop_all on public.one_on_one_private for all to authenticated
  using (leader_id = auth.uid() and public.is_team_leader(team_id))
  with check (leader_id = auth.uid() and public.is_team_leader(team_id));

create policy ai_items_select on public.action_items for select to authenticated
  using (owner_id = auth.uid() or created_by = auth.uid() or public.is_team_leader(team_id)
         or exists (select 1 from one_on_ones o where o.id = one_on_one_id and o.member_id = auth.uid()));
create policy ai_items_insert on public.action_items for insert to authenticated
  with check (created_by = auth.uid() and public.is_team_member(team_id));
create policy ai_items_update on public.action_items for update to authenticated
  using (owner_id = auth.uid() or created_by = auth.uid() or public.is_team_leader(team_id));
create policy ai_items_delete on public.action_items for delete to authenticated
  using (created_by = auth.uid() or public.is_team_leader(team_id));

-- ---------- 관찰 메모: 팀장만 ----------
create policy obs_all on public.observations for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id) and author_id = auth.uid());

-- ---------- 결과물 / 리뷰 ----------
create policy sub_select on public.submissions for select to authenticated
  using (author_id = auth.uid() or public.is_team_leader(team_id));
create policy sub_insert on public.submissions for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id));
create policy sub_update on public.submissions for update to authenticated
  using (author_id = auth.uid() or public.is_team_leader(team_id));

create policy sv_select on public.submission_versions for select to authenticated
  using (public.can_see_submission(submission_id));
create policy sv_insert on public.submission_versions for insert to authenticated
  with check (created_by = auth.uid() and public.can_see_submission(submission_id));

create policy rc_select on public.review_comments for select to authenticated
  using (public.can_see_submission(submission_id));
create policy rc_insert on public.review_comments for insert to authenticated
  with check (author_id = auth.uid() and provenance = 'human' and public.can_see_submission(submission_id));
create policy rc_delete on public.review_comments for delete to authenticated
  using (author_id = auth.uid());

create policy js_select on public.judgment_scores for select to authenticated using (public.is_team_leader(team_id));

-- ---------- AI 출력 ----------
create policy aio_select on public.ai_outputs for select to authenticated
  using (public.is_team_leader(team_id)
         or (visibility = 'team' and public.is_team_member(team_id))
         or (visibility = 'subject' and subject_user_id = auth.uid() and status = 'final'));
-- 생성은 Edge Function(service_role)만. 팀장은 수정·확정만.
create policy aio_update on public.ai_outputs for update to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

create or replace function public.guard_ai_output_update() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' then
    -- AI 원본·근거·모델 정보는 바꿀 수 없다
    new.content := old.content; new.sources := old.sources; new.model := old.model;
    new.kind := old.kind; new.team_id := old.team_id; new.created_at := old.created_at;
    new.input_tokens := old.input_tokens; new.output_tokens := old.output_tokens;
    if new.edited_content is distinct from old.edited_content then
      new.edited_by := auth.uid(); new.edited_at := now();
      if new.status = 'draft' then new.status := 'edited'; end if;
    end if;
    if new.status = 'final' and old.status <> 'final' then
      new.finalized_by := auth.uid(); new.finalized_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger t_guard_aio before update on public.ai_outputs
  for each row execute function public.guard_ai_output_update();

-- ---------- 이벤트·근거: 팀장 읽기 (쓰기는 트리거/서비스) ----------
create policy ev_select on public.events for select to authenticated using (public.is_team_leader(team_id));
create policy evd_select on public.evidence for select to authenticated using (public.is_team_leader(team_id));
create policy evd_leader_insert on public.evidence for insert to authenticated
  with check (public.is_team_leader(team_id) and source = 'leader_note' and created_by = auth.uid());

-- ---------- 알림 / 연동 ----------
create policy nt_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy nt_read on public.notifications for update to authenticated using (user_id = auth.uid());
create policy int_leader on public.integrations for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
