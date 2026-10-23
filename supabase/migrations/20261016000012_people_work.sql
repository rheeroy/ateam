-- =====================================================================
-- 메뉴 재편 (팀목표 · 업무플랫폼 · 팀원관리)에 맞춘 근거 원장 보강
--   · 팀장 요청을 팀원이 완료하면 → 그 팀원의 평가 근거로 자동 기록 (기한 준수 여부 포함)
--   이미 쌓이는 것: 체크인 · 1on1 · 팀장 메모 · 결과물 · 리뷰 피드백 · 관찰 메모 · 업무 완료
-- =====================================================================
create or replace function public.trg_request_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_late int;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    v_late := case when new.due_date is null then null else (coalesce(new.responded_at, now())::date - new.due_date) end;
    perform public.upsert_evidence(new.team_id, new.to_id, 'task', new.id,
      '요청 완료 — ' || new.title
        || case when v_late is null then '' when v_late <= 0 then ' (기한 내)' else ' (' || v_late || '일 늦음)' end
        || case when coalesce(new.response, '') <> '' then ' · 답: ' || left(new.response, 120) else '' end,
      case when v_late is not null and v_late <= 0 then 'positive'::public.polarity else 'neutral'::public.polarity end,
      null, coalesce(new.responded_at, now()));
  end if;
  return new;
end $$;
drop trigger if exists t_request_evidence on public.team_requests;
create trigger t_request_evidence after insert or update of status on public.team_requests
  for each row execute function public.trg_request_evidence();

-- 이미 완료된 요청도 한 번 채워 넣기
insert into public.evidence (team_id, subject_user_id, source, source_id, summary, polarity, occurred_at, provenance)
select r.team_id, r.to_id, 'task', r.id,
       left('요청 완료 — ' || r.title
         || case when r.due_date is null then '' when coalesce(r.responded_at, r.created_at)::date <= r.due_date then ' (기한 내)'
                 else ' (' || (coalesce(r.responded_at, r.created_at)::date - r.due_date) || '일 늦음)' end, 400),
       case when r.due_date is not null and coalesce(r.responded_at, r.created_at)::date <= r.due_date then 'positive'::public.polarity else 'neutral'::public.polarity end,
       coalesce(r.responded_at, r.created_at), 'human'
from public.team_requests r
where r.status = 'done'
on conflict (source, source_id, subject_user_id) where source_id is not null do nothing;

-- =====================================================================
-- 의사결정 보드 — 흩어진 기록에서 모은 '결정할 것·지켜볼 리스크' 카드의 진행 상태
--   카드 자체는 매번 신호·AI 해석에서 계산되고, 여기에는 팀장이 옮긴 상태만 남는다
--   stage: reviewing(검토 중) · promoted(리스크 → 결정으로 올림) · watching(지켜보기로 내림) · dismissed(뺌) · decided(결정 기록함)
-- =====================================================================
create table if not exists public.decision_board (
  team_id     uuid not null references public.teams(id) on delete cascade,
  card_key    text not null,
  title       text not null default '',
  stage       text not null check (stage in ('reviewing', 'promoted', 'watching', 'dismissed', 'decided')),
  note        text not null default '',
  decision_id uuid references public.decisions(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (team_id, card_key)
);
alter table public.decision_board enable row level security;
drop policy if exists decision_board_leader on public.decision_board;
create policy decision_board_leader on public.decision_board for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

-- =====================================================================
-- 팀원관리: 주간 AI 액션 추천 (1on1 · 칭찬 배지 · 관찰 기록 · 육성 · 업무 독려 · 막힘 지원 · 업무 조정)
-- =====================================================================
alter type public.ai_kind add value if not exists 'people_actions';

-- 팀장이 추천 액션을 했는지/건너뛰었는지 (주 단위 키: 주시작:팀원:종류)
create table if not exists public.people_action_status (
  team_id    uuid not null references public.teams(id) on delete cascade,
  action_key text not null,
  status     text not null check (status in ('done', 'skipped')),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (team_id, action_key)
);
alter table public.people_action_status enable row level security;
drop policy if exists people_action_status_leader on public.people_action_status;
create policy people_action_status_leader on public.people_action_status for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

-- 칭찬 배지: 팀원에게 알림으로 가고, 팀장 관찰 기록(칭찬)으로도 남아 평가 근거가 된다
create or replace function public.send_praise(p_team uuid, p_to uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from team_members where team_id = p_team and user_id = p_to and status = 'active') then raise exception 'NOT_MEMBER'; end if;
  insert into observations (team_id, author_id, subject_id, kind, body)
    values (p_team, auth.uid(), p_to, 'praise', '[칭찬 배지] ' || left(coalesce(nullif(trim(p_body), ''), '수고 많았어요'), 300)) returning id into v_id;
  perform public._notify(p_to, p_team, 'praise', '칭찬 배지가 도착했어요', left(p_body, 120), '/');
  return v_id;
end $$;
revoke all on function public.send_praise(uuid, uuid, text) from public, anon;
grant execute on function public.send_praise(uuid, uuid, text) to authenticated;

-- 월요일 07:10 KST 주간 팀원관리 액션 (pg_cron · _invoke_function 이 있는 프로젝트만)
do $$ begin perform cron.unschedule('people-actions-weekly'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('people-actions-weekly', '10 22 * * 0', $c$ select public._invoke_function('ai-people-actions', '{"all": true}') $c$);
exception when others then null; end $$;

-- =====================================================================
-- 업무플랫폼: 팀장이 '완료'로 정리한 결과물은 사람별 카드에서 빠진다 (개인 업무 스페이스에는 남음)
--   새 버전이 올라오면 다시 열린다
-- =====================================================================
alter table public.submissions add column if not exists closed_at timestamptz;
alter table public.submissions add column if not exists closed_by uuid references public.profiles(id) on delete set null;

create or replace function public.trg_submission_reopen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update submissions set closed_at = null, closed_by = null where id = new.submission_id and closed_at is not null;
  return new;
end $$;
drop trigger if exists t_sv_reopen on public.submission_versions;
create trigger t_sv_reopen after insert on public.submission_versions for each row execute function public.trg_submission_reopen();
