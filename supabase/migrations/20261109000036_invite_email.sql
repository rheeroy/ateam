-- =====================================================================
-- 31_invite_email.sql — 초대받은 메일로만 합류
--   · accept_invitation: 로그인한 계정 메일 ≠ 초대 메일이면 막는다 (INVITE_EMAIL_MISMATCH)
--     (메일 없이 만든 예전 초대는 그대로 허용)
--   · invitation_preview: 로그인 전에도 링크를 가진 사람은 팀 이름 · 초대 메일을 본다
--     → 가입 화면에서 초대 메일을 미리 채우고 고정
-- 다시 Run 해도 안전합니다.
-- =====================================================================

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
    if (v_usage->>'members')::int >= (v_usage->>'max_members')::int then
      raise exception 'PLAN_LIMIT_MEMBERS' using errcode = 'P0001';
    end if;
  end if;
  insert into team_members (team_id, user_id, role, job_title)
  values (v_inv.team_id, auth.uid(), v_inv.role, v_inv.job_title)
  on conflict (team_id, user_id) do update set status = 'active', role = excluded.role;
  update invitations set accepted_at = coalesce(accepted_at, now()), accepted_by = auth.uid() where id = v_inv.id;
  perform log_event(v_inv.team_id, 'member.joined', 'team_members', null, auth.uid());
  return v_inv.team_id;
end $$;

-- 링크(추측할 수 없는 토큰)를 가진 사람은 로그인 전에도 미리보기
grant execute on function public.invitation_preview(uuid) to anon, authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
