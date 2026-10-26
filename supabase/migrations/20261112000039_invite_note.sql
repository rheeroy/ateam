-- =====================================================================
-- 초대할 때 적은 팀원 메모(강점·보완할 점) → 합류하면 팀장 개인 메모로
--   · invitations.leader_note: 초대할 때 팀장이 적은 강점·보완할 점 (팀장만 봄)
--   · accept_invitation: 팀원이 합류하는 순간, 그 팀원에게 붙은 팀장 메모(leader_notes, AI 참고 켜짐)로 옮긴다
--     → 1on1 준비 노트 · 팀원관리 추천 · ATEAM AI의 제안이 참고한다. 평가 초안에는 쓰지 않는다. 팀원에게는 보이지 않는다.
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter table public.invitations add column if not exists leader_note text not null default '';

create or replace function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv invitations; v_usage jsonb; v_mail text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invitations where token = p_token for update;
  if not found then raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_inv.accepted_at is not null and v_inv.accepted_by <> auth.uid() then raise exception 'INVITE_USED' using errcode = 'P0001'; end if;
  if v_inv.expires_at < now() then raise exception 'INVITE_EXPIRED' using errcode = 'P0001'; end if;
  -- 초대받은 메일로 로그인해야 합류
  select lower(coalesce(u.email, '')) into v_mail from auth.users u where u.id = auth.uid();
  if coalesce(trim(v_inv.email), '') <> '' and lower(trim(v_inv.email)) <> coalesce(v_mail, '') then
    raise exception 'INVITE_EMAIL_MISMATCH' using errcode = 'P0001', hint = v_inv.email;
  end if;
  if v_inv.role = 'member' then
    v_usage := public.team_seat_usage(v_inv.team_id);
    if (v_usage->>'members')::int >= (v_usage->>'max_members')::int
       and not exists (select 1 from team_members where team_id = v_inv.team_id and user_id = auth.uid() and status = 'active') then
      raise exception 'PLAN_LIMIT_MEMBERS' using errcode = 'P0001';
    end if;
  end if;
  insert into team_members (team_id, user_id, role, job_title)
  values (v_inv.team_id, auth.uid(), v_inv.role, v_inv.job_title)
  on conflict (team_id, user_id) do update
    set status = 'active', role = case when team_members.role = 'leader' then team_members.role else excluded.role end;
  -- 초대할 때 적은 메모 → 초대한 팀장의 개인 메모 (한 번만)
  if coalesce(trim(v_inv.leader_note), '') <> '' and v_inv.invited_by is not null and v_inv.accepted_at is null then
    insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, tags)
    values (v_inv.team_id, v_inv.invited_by, left(trim(v_inv.leader_note), 2000), 'member', auth.uid()::text,
            coalesce((select full_name from profiles where id = auth.uid()), ''), true, array['초대 메모']);
  end if;
  update invitations set accepted_at = coalesce(accepted_at, now()), accepted_by = auth.uid() where id = v_inv.id;
  perform log_event(v_inv.team_id, 'member.joined', 'team_members', null, auth.uid());
  return v_inv.team_id;
end $$;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- 데모 팀: 초대할 때 적은 메모 예시 (최다은) — 이미 있으면 건너뜀
do $$
declare r record; v_choi uuid;
begin
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo loop
    select tm.user_id into v_choi from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '최다은' limit 1;
    if v_choi is null or exists (select 1 from leader_notes where team_id = r.team_id and '초대 메모' = any(tags)) then continue; end if;
    insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, tags, created_at, updated_at)
    values (r.team_id, r.leader_id, E'강점: 콘텐츠 기획이 빠르고 아이디어가 많음\n보완할 점: 일정이 밀릴 때 공유가 늦음', 'member', v_choi::text, '최다은', true,
            array['초대 메모'], now() - interval '40 days', now() - interval '40 days');
  end loop;
end $$;
