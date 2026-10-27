-- ATEAM의 코칭 (팀장이 누르면 AI 초안 → 팀장이 고쳐 보내는 개선 코칭, 보낸 사람 비표시) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- ATEAM의 코칭 — 팀장이 누르면 AI가 초안을 쓰고, 팀장이 고쳐서 보내는 개선 코칭
--   · 팀원에게는 'ATEAM의 코칭'으로만 보인다 (보낸 사람 칸을 두지 않음)
--   · 평가 근거로 남지 않는다 (evidence에 쓰지 않음)
--   · 한 팀원에게 7일 동안 2건까지
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'coaching';

create table if not exists public.coaching_notes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  member_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  body        text not null,
  seen_at     timestamptz,
  acked_at    timestamptz,
  helpful     boolean,
  created_at  timestamptz not null default now()
);
create index if not exists coaching_member_idx on public.coaching_notes (team_id, member_id, created_at desc);

alter table public.coaching_notes enable row level security;
drop policy if exists coaching_leader on public.coaching_notes;
create policy coaching_leader on public.coaching_notes for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
drop policy if exists coaching_member_read on public.coaching_notes;
create policy coaching_member_read on public.coaching_notes for select to authenticated
  using (member_id = auth.uid());

-- 팀원: 읽음 · 확인 · 도움됨 (자기 것만)
create or replace function public.coaching_mark(p_id uuid, p_ack boolean default false, p_helpful boolean default null)
returns void language sql security definer set search_path = public as $$
  update coaching_notes set
    seen_at = coalesce(seen_at, now()),
    acked_at = case when p_ack then coalesce(acked_at, now()) else acked_at end,
    helpful = coalesce(p_helpful, helpful)
  where id = p_id and member_id = auth.uid();
$$;
grant execute on function public.coaching_mark(uuid, boolean, boolean) to authenticated;

-- 7일 2건 제한 + 팀원 알림 ('ATEAM의 코칭'으로)
create or replace function public._coaching_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from coaching_notes where team_id = new.team_id and member_id = new.member_id and created_at > now() - interval '7 days') >= 2 then
    raise exception 'COACHING_LIMIT: 한 팀원에게는 7일 동안 2건까지 보낼 수 있습니다';
  end if;
  return new;
end $$;
drop trigger if exists t_coaching_guard on public.coaching_notes;
create trigger t_coaching_guard before insert on public.coaching_notes for each row execute function public._coaching_guard();

create or replace function public._coaching_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, team_id, kind, title, body, link)
  values (new.member_id, new.team_id, 'coaching', 'ATEAM 업무 피드백이 도착했어요', new.title, '/my/one-on-ones?coach=' || new.id);
  return new;
end $$;
drop trigger if exists t_coaching_notify on public.coaching_notes;
create trigger t_coaching_notify after insert on public.coaching_notes for each row execute function public._coaching_notify();

-- 데모: 이동욱 님에게 보낸 코칭 1건 (이미 있으면 건너뜀)
do $$
declare r record; v_lee uuid;
begin
  for r in select t.id team_id from teams t where t.is_demo loop
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이동욱' limit 1;
    if v_lee is null or exists (select 1 from coaching_notes where team_id = r.team_id) then continue; end if;
    alter table coaching_notes disable trigger t_coaching_notify;
    insert into coaching_notes (team_id, member_id, title, body, created_at) values (r.team_id, v_lee,
      'CRM 연계, 진척을 한 번 정리해 볼까요?',
      E'요즘 흐름\n''제휴 유입 고객 CRM 연계''를 혼자 맡아 진행하고 있어요. 계획보다 조금 늦어지고 있고, 최근에는 진척 공유가 뜸해요.\n\n특히 짚고 싶은 것\n· ''제휴 유입 고객 CRM 연계'' — 지금까지 한 것과 남은 것이 기록으로 잘 보이지 않아요\n\n왜 중요해요\n제휴 목표와 이어진 과제라, 진행 상황이 보여야 필요한 도움을 제때 받을 수 있어요.\n\n점검해 볼 것\n· 지금까지 한 것과 남은 것을 짧게 정리할 수 있는지\n· 막힌 부분이 있다면 무엇이 필요한지 정리돼 있는지\n\n권장 시점 · 이번 주 금요일까지',
      now() - interval '2 days');
    -- 김현정: 받은함 예시 (확인 전)
    insert into coaching_notes (team_id, member_id, title, body, created_at)
    select r.team_id, tm.user_id, '기획서, 근거를 한 번 더 받쳐 볼까요?',
      E'요즘 흐름\n''런칭 캠페인 기획'' 결과물을 꾸준히 올리고 있어요. 내용은 충실한데, 주장에 비해 근거가 좀 약하고 구조화가 덜 되어 있어요.\n\n특히 짚고 싶은 것\n· ''하반기 신제품 런칭 캠페인 기획서''의 정가 런칭 이유 부분 — 주장을 받치는 근거가 보이지 않아요\n\n왜 중요해요\n읽는 사람이 근거를 따라갈 수 있어야 내용이 그대로 설득력을 가져요.\n\n점검해 볼 것\n· 핵심 주장마다 근거(숫자 · 사례 · 출처)를 한 줄 붙일 수 있는지\n· 이 장만 읽어도 무엇을 말하려는지 보이는지\n\n권장 시점 · 다음 결과물을 올리기 전',
      now() - interval '1 day'
    from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '김현정' limit 1;
    alter table coaching_notes enable trigger t_coaching_notify;
  end loop;
end $$;

-- =====================================================================
-- 32_review_fixes.sql — 전체 검토에서 나온 서버 쪽 수정
--   ① 요청 알림: 종류별로 실제 보이는 곳으로 링크 · 화면과 같은 이름(육성 · 지원·격려 · 업무 독려)
--   ② ATEAM 업무 피드백 알림 이름 · 히스토리 알림 링크 · 히스토리 요청 보류 알림
--   ③ 팀 확인: 히스토리 전달·요청 · 요청의 과제 · 코칭 대상이 같은 팀인지
--   ④ 내 메모(leader_notes)는 팀장만 쓴다 (팀원이 '팀장 메모'로 히스토리에 끼어들지 못하게)
--   ⑤ 초대: 팀장이 팀원 초대를 받아도 팀장 그대로 · 끝난 초대는 미리보기에 메일을 안 보여 줌
--   ⑥ 요금제 기능에 history 다시 확인 (21_plans_v3 를 다시 Run 해도 꺼지지 않게 — 21 파일도 함께 고침)
-- 다시 Run 해도 안전합니다.
-- =====================================================================

-- ---------- ① 요청 알림 ----------
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_up boolean; v_fb boolean;
begin
  v_up := new.to_id = public._team_leader(new.team_id);   -- 팀원 → 팀장
  -- 팀장 액션(매니징 보드 Feedback에 보이는 것): 육성 · 지원·격려 · 과제 없는 업무 독려
  v_fb := new.kind in ('grow', 'cheer') or (new.kind = 'progress' and new.item_id is null);
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case when v_up and new.kind = 'meeting' then '1on1 요청: ' when new.kind = 'change' then '목표 변경 요청: '
           when new.kind = 'meeting' then '1on1 요청: '
           when new.kind = 'grow' then '육성: ' when new.kind = 'cheer' then '지원·격려: '
           when new.kind = 'progress' and new.item_id is null then '업무 독려: '
           when new.kind = 'progress' then '성과입력 요청: ' when new.kind = 'plan' then '계획 요청: '
           else '요청: ' end || new.title,
      left(new.body, 120),
      case when new.kind = 'change' then '/goals/edit' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/people/' || new.from_id || '?oo=1'
           when v_fb then '/my/one-on-ones?req=' || new.id
           when new.kind = 'meeting' then '/my/one-on-ones'
           else '/my/submissions' end);
    if new.kind = 'plan' then
      if new.item_id is not null then update work_items set needs_plan = true where id = new.item_id and team_id = new.team_id; end if;
      if new.from_id = public._team_leader(new.team_id) then
        update teams set settings = coalesce(settings, '{}'::jsonb) || '{"plan_open": true}'::jsonb
         where id = new.team_id and not public.plan_open(new.team_id);
      end if;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case when v_up and new.kind = 'meeting' then '1on1 요청 확인: ' when new.kind = 'change' then '변경 요청 처리: '
           when new.kind = 'grow' then '육성 답: ' when new.kind = 'cheer' then '지원·격려 확인: '
           when new.kind = 'progress' and new.item_id is null then '업무 독려 답: '
           else '완료: ' end || new.title,
      left(new.response, 120),
      case when new.kind = 'change' then '/my/goals' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/my/one-on-ones'
           when v_fb then '/people?sent=1'
           when new.kind = 'meeting' then '/people/' || new.to_id || '?oo=1'
           else '/work/u/' || new.to_id end);
  end if;
  return new;
end $$;

-- 요청의 과제는 같은 팀 것만
drop policy if exists rq_insert on public.team_requests;
create policy rq_insert on public.team_requests for insert to authenticated
  with check (from_id = auth.uid() and public.is_team_member(team_id)
              and exists (select 1 from team_members m where m.team_id = team_requests.team_id and m.user_id = to_id and m.status = 'active')
              and (item_id is null or exists (select 1 from work_items w where w.id = team_requests.item_id and w.team_id = team_requests.team_id)));

-- ---------- ② 알림 이름 · 링크 ----------
do $$
begin
  if to_regclass('public.coaching_notes') is not null then
    create or replace function public._coaching_notify() returns trigger
    language plpgsql security definer set search_path = public as $f$
    begin
      insert into notifications (user_id, team_id, kind, title, body, link)
      values (new.member_id, new.team_id, 'coaching', 'ATEAM 업무 피드백이 도착했어요', new.title, '/my/one-on-ones?coach=' || new.id);
      return new;
    end $f$;
    -- 코칭 대상은 같은 팀의 팀원만
    drop policy if exists coaching_leader on public.coaching_notes;
    create policy coaching_leader on public.coaching_notes for all to authenticated
      using (public.is_team_leader(team_id))
      with check (public.is_team_leader(team_id)
                  and exists (select 1 from team_members m where m.team_id = coaching_notes.team_id and m.user_id = coaching_notes.member_id and m.status = 'active'));
  end if;
end $$;

do $$
begin
  if to_regclass('public.history_shares') is null then return; end if;

  create or replace function public._history_share_notify() returns trigger
  language plpgsql security definer set search_path = public as $f$
  declare v_title text;
  begin
    select title into v_title from work_items where id = new.item_id;
    if tg_op = 'INSERT' and new.status = 'sent' then
      perform public._notify(new.to_id, new.team_id, 'history', '팀장님이 과제 히스토리를 전달했습니다', coalesce(v_title, ''), '/my/one-on-ones?history=' || new.id);
    elsif tg_op = 'INSERT' and new.status = 'requested' then
      perform public._notify(public._team_leader(new.team_id), new.team_id, 'history_request', '히스토리 요청: ' || coalesce(v_title, ''),
        coalesce((select full_name from profiles where id = new.to_id), '') || case when new.note <> '' then ' · ' || new.note else '' end,
        '/history?item=' || new.item_id || '&request=' || new.id);
    elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'sent' then
      perform public._notify(new.to_id, new.team_id, 'history', '요청한 히스토리가 도착했습니다', coalesce(v_title, ''), '/my/one-on-ones?history=' || new.id);
    elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'declined' then
      perform public._notify(new.to_id, new.team_id, 'history', '히스토리 요청이 보류됐습니다', coalesce(v_title, '') || ' · 필요하면 팀장님께 직접 물어봐 주세요', '/my/one-on-ones');
    elsif tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'read' then
      perform public._notify(new.from_id, new.team_id, 'history_read', '전달한 히스토리를 확인했습니다',
        coalesce((select full_name from profiles where id = new.to_id), '') || ' · ' || coalesce(v_title, ''), '/history?item=' || new.item_id);
    end if;
    return new;
  end $f$;

  create or replace function public._history_message_notify() returns trigger
  language plpgsql security definer set search_path = public as $f$
  declare s history_shares; v_title text;
  begin
    select * into s from history_shares where id = new.share_id;
    select title into v_title from work_items where id = s.item_id;
    if new.author_id = s.to_id then
      perform public._notify(coalesce(s.from_id, public._team_leader(s.team_id)), s.team_id, 'history_question',
        '히스토리 질문: ' || coalesce(v_title, ''), left(new.body, 120), '/history?item=' || s.item_id || '&share=' || s.id);
    else
      perform public._notify(s.to_id, s.team_id, 'history_answer', '팀장님이 답했습니다: ' || coalesce(v_title, ''), left(new.body, 120), '/my/one-on-ones?history=' || s.id);
    end if;
    update history_shares set updated_at = now() where id = new.share_id;
    return new;
  end $f$;

  -- ③ 전달·요청은 같은 팀 과제 · 같은 팀 사람만, 팀원 요청은 히스토리 기능이 있는 팀에서만 (보낸 사람 칸은 비워 둔다)
  drop policy if exists hs_insert on public.history_shares;
  create policy hs_insert on public.history_shares for insert to authenticated
    with check (
      exists (select 1 from work_items w where w.id = history_shares.item_id and w.team_id = history_shares.team_id)
      and (
        (public.is_team_leader(team_id) and status = 'sent'
          and exists (select 1 from team_members m where m.team_id = history_shares.team_id and m.user_id = history_shares.to_id and m.status = 'active'))
        or (to_id = auth.uid() and status = 'requested' and from_id is null and public.is_team_member(team_id)
          and public.team_has_feature(team_id, 'history'))
      ));
end $$;

-- ---------- ④ 내 메모는 팀장만 쓴다 (읽기·지우기는 쓴 사람 그대로) ----------
do $$
begin
  if to_regclass('public.leader_notes') is null then return; end if;
  drop policy if exists leader_notes_owner on public.leader_notes;
  create policy leader_notes_owner on public.leader_notes for all to authenticated
    using (owner_id = auth.uid() and public.is_team_member(team_id))
    with check (owner_id = auth.uid() and public.is_team_leader(team_id));
end $$;

-- ---------- ⑤ 초대 ----------
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
  update invitations set accepted_at = coalesce(accepted_at, now()), accepted_by = auth.uid() where id = v_inv.id;
  perform log_event(v_inv.team_id, 'member.joined', 'team_members', null, auth.uid());
  return v_inv.team_id;
end $$;

-- 끝난(합류·만료) 초대는 메일을 보여 주지 않는다 — 로그인 전에도 열리는 미리보기
create or replace function public.invitation_preview(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('team_name', t.name, 'inviter', p.full_name,
                            'email', case when i.accepted_at is null and i.expires_at >= now() then i.email else '' end,
                            'expired', i.expires_at < now(), 'accepted', i.accepted_at is not null)
  from invitations i join teams t on t.id = i.team_id join profiles p on p.id = i.invited_by
  where i.token = p_token;
$$;
grant execute on function public.invitation_preview(uuid) to anon, authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- ---------- ⑥ 요금제: Pro · Pro+ 에 history ----------
update public.plans set features = array_append(features, 'history')
 where id in ('pro', 'pro_plus') and not ('history' = any(features));
