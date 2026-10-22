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
  values (new.member_id, new.team_id, 'coaching', 'ATEAM의 코칭이 도착했어요', new.title, '/?coach=' || new.id);
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
