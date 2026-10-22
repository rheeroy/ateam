-- =====================================================================
-- 30_history.sql — 히스토리 관리 (Pro부터)
--   과제마다 '살아 있는 히스토리' 한 장: 매주 새 기록을 기존 히스토리에 합치고 묶고 연결해서 고쳐 쓴다 (ai-task-history)
--   팀장이 고정·숨김·고친 줄은 다음 업데이트에서도 그대로 (edits)
--   팀장 → 팀원 '전달': 보낸 순간의 히스토리를 사본(snapshot)으로 남긴다. 팀원은 받은 사본만 본다
--   전달마다 확인 · 질문/답변 — 질문과 답은 다음 업데이트에 그 과제 히스토리로 들어간다
--   넣지 않는 것: 1on1 · 컨디션 · 팀장 메모(AI 허용 안 한 것) · 평가 · 코칭
-- 다시 Run 해도 안전합니다.
-- =====================================================================

-- AI 종류
alter type public.ai_kind add value if not exists 'task_history';

-- ---------- 과제 히스토리 (팀장만) ----------
create table if not exists public.task_histories (
  item_id      uuid primary key references public.work_items(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  content      jsonb not null default '{}'::jsonb,   -- AI 정리 (현황 · 줄기 · 사건 · 관계자 · 확정/미결/이전 시도/리스크/확인 필요 · 관련 과제 · 진척)
  edits        jsonb not null default '{}'::jsonb,   -- 팀장 손질 { pinned: [id], hidden: [id], text: { id: '고친 문장' } }
  synced_at    timestamptz,                          -- 이 시각까지의 기록을 반영
  record_count int not null default 0,               -- 지금까지 반영한 기록 수
  new_count    int not null default 0,               -- 마지막 업데이트에서 새로 반영한 기록 수
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists task_histories_team_idx on public.task_histories (team_id, updated_at desc);

alter table public.task_histories enable row level security;
drop policy if exists th_select on public.task_histories;
create policy th_select on public.task_histories for select to authenticated using (public.is_team_leader(team_id));
drop policy if exists th_update on public.task_histories;
create policy th_update on public.task_histories for update to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
-- 만들기·AI 업데이트는 서버(service_role)만

-- ---------- 전달 (팀장 → 팀원) · 요청 (팀원 → 팀장) ----------
create table if not exists public.history_shares (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  item_id    uuid not null references public.work_items(id) on delete cascade,
  from_id    uuid references public.profiles(id) on delete set null,          -- 보낸 팀장 (요청이면 받을 팀장)
  to_id      uuid not null references public.profiles(id) on delete cascade,  -- 받는 팀원 (요청이면 요청한 팀원)
  note       text not null default '',                                        -- 팀장 한마디 / 요청 사유
  snapshot   jsonb not null default '{}'::jsonb,                              -- 보낸 순간의 히스토리 (팀장 손질 반영본)
  status     text not null default 'sent' check (status in ('requested', 'sent', 'read', 'declined')),
  sent_at    timestamptz,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists history_shares_to_idx on public.history_shares (to_id, created_at desc);
create index if not exists history_shares_item_idx on public.history_shares (item_id, created_at desc);

alter table public.history_shares enable row level security;
drop policy if exists hs_select on public.history_shares;
create policy hs_select on public.history_shares for select to authenticated
  using (to_id = auth.uid() or from_id = auth.uid() or public.is_team_leader(team_id));
-- 팀장: 전달 / 팀원: 내 과제가 아니어도 '요청'만
drop policy if exists hs_insert on public.history_shares;
create policy hs_insert on public.history_shares for insert to authenticated
  with check (
    (public.is_team_leader(team_id) and status = 'sent')
    or (to_id = auth.uid() and status = 'requested' and public.is_team_member(team_id))
  );
drop policy if exists hs_update on public.history_shares;
create policy hs_update on public.history_shares for update to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
drop policy if exists hs_delete on public.history_shares;
create policy hs_delete on public.history_shares for delete to authenticated
  using (public.is_team_leader(team_id) or (to_id = auth.uid() and status = 'requested'));

-- 팀원이 '확인했어요' (상태만 바꾼다)
create or replace function public.history_mark_read(p_share uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update history_shares set status = 'read', read_at = now(), updated_at = now()
   where id = p_share and to_id = auth.uid() and status = 'sent';
end $$;
revoke all on function public.history_mark_read(uuid) from public, anon;
grant execute on function public.history_mark_read(uuid) to authenticated;

-- ---------- 질문 · 답변 ----------
create table if not exists public.history_messages (
  id         uuid primary key default gen_random_uuid(),
  share_id   uuid not null references public.history_shares(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists history_messages_share_idx on public.history_messages (share_id, created_at);

alter table public.history_messages enable row level security;
drop policy if exists hm_select on public.history_messages;
create policy hm_select on public.history_messages for select to authenticated
  using (exists (select 1 from history_shares s where s.id = history_messages.share_id
                  and (s.to_id = auth.uid() or s.from_id = auth.uid() or public.is_team_leader(s.team_id))));
drop policy if exists hm_insert on public.history_messages;
create policy hm_insert on public.history_messages for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from history_shares s where s.id = history_messages.share_id and s.team_id = history_messages.team_id
                  and s.status <> 'requested' and (s.to_id = auth.uid() or public.is_team_leader(s.team_id))));
drop policy if exists hm_delete on public.history_messages;
create policy hm_delete on public.history_messages for delete to authenticated using (author_id = auth.uid());

-- ---------- 알림 ----------
create or replace function public._history_share_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  select title into v_title from work_items where id = new.item_id;
  if tg_op = 'INSERT' and new.status = 'sent' then
    perform public._notify(new.to_id, new.team_id, 'history', '팀장님이 과제 히스토리를 전달했습니다', coalesce(v_title, ''), '/my/history?id=' || new.id);
  elsif tg_op = 'INSERT' and new.status = 'requested' then
    perform public._notify(public._team_leader(new.team_id), new.team_id, 'history_request', '히스토리 요청: ' || coalesce(v_title, ''),
      coalesce((select full_name from profiles where id = new.to_id), '') || case when new.note <> '' then ' · ' || new.note else '' end,
      '/history?item=' || new.item_id || '&request=' || new.id);
  elsif tg_op = 'UPDATE' and old.status = 'requested' and new.status = 'sent' then
    perform public._notify(new.to_id, new.team_id, 'history', '요청한 히스토리가 도착했습니다', coalesce(v_title, ''), '/my/history?id=' || new.id);
  elsif tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'read' then
    perform public._notify(new.from_id, new.team_id, 'history_read', '전달한 히스토리를 확인했습니다',
      coalesce((select full_name from profiles where id = new.to_id), '') || ' · ' || coalesce(v_title, ''), '/history?item=' || new.item_id);
  end if;
  return new;
end $$;
drop trigger if exists t_history_share_notify on public.history_shares;
create trigger t_history_share_notify after insert or update on public.history_shares
  for each row execute function public._history_share_notify();

create or replace function public._history_message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s history_shares; v_title text;
begin
  select * into s from history_shares where id = new.share_id;
  select title into v_title from work_items where id = s.item_id;
  if new.author_id = s.to_id then
    perform public._notify(coalesce(s.from_id, public._team_leader(s.team_id)), s.team_id, 'history_question',
      '히스토리 질문: ' || coalesce(v_title, ''), left(new.body, 120), '/history?item=' || s.item_id || '&share=' || s.id);
  else
    perform public._notify(s.to_id, s.team_id, 'history_answer', '팀장님이 답했습니다: ' || coalesce(v_title, ''), left(new.body, 120), '/my/history?id=' || s.id);
  end if;
  update history_shares set updated_at = now() where id = new.share_id;
  return new;
end $$;
drop trigger if exists t_history_message_notify on public.history_messages;
create trigger t_history_message_notify after insert on public.history_messages
  for each row execute function public._history_message_notify();

-- ---------- 요금제: Pro · Pro+ ----------
update public.plans set features = array_append(features, 'history')
 where id in ('pro', 'pro_plus') and not ('history' = any(features));

-- ---------- 실시간 (받은 히스토리 · 질문 바로 반영) ----------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['history_shares', 'history_messages', 'task_histories'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- 매주 월요일 06:00 (KST) 자동 업데이트 ----------
--   히스토리를 켠(한 번이라도 만든) 팀마다 따로 부른다 — 팀 하나가 오래 걸려도 다른 팀은 영향 없게 (pg_net 비동기)
--   02_schedules.sql(예약 작업)을 실행한 프로젝트에서만 등록된다. 아니면 '지금 업데이트' 버튼으로 동작.
create or replace function public._history_weekly() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct team_id from task_histories loop
    if public.team_has_feature(r.team_id, 'history') then
      perform public._invoke_function('ai-task-history', jsonb_build_object('team_id', r.team_id, 'weekly', true));
    end if;
  end loop;
end $$;
revoke all on function public._history_weekly() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_proc where proname = '_invoke_function') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'task-history-weekly';
    perform cron.schedule('task-history-weekly', '0 21 * * 0', $c$ select public._history_weekly() $c$);
  end if;
end $$;
