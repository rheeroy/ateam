-- ATEAM 내 메모 (팀장 전용 메모 · 팀원·목표·임원에 붙이기) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 내 메모 — 팀장 전용 메모 (팀원에게는 보이지 않음)
--   · 저장은 한 곳, 붙이는 곳은 여러 군데: 팀원 · 목표/과제 · 임원 · 결정 · 1on1 (anchor)
--   · 관찰 메모(observations)와 다름: 평가 근거로 쓰지 않음
--   · ai_allowed: AI가 참고해도 되는 메모 (팀장이 고름) — 1on1 준비 노트 · 팀원 액션 · ATEAM의 제안 · 임원 브리핑이 읽음. 평가 초안은 읽지 않음
--   · anchor_id: 대상 id (팀원·목표·임원은 uuid, 결정 카드는 카드 키) · anchor_label: 붙일 때의 대상 이름(대상이 사라져도 보이게)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
create table if not exists public.leader_notes (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body         text not null,
  kind         text not null default 'note' check (kind in ('note', 'todo')),
  done         boolean not null default false,
  anchor_type  text not null default 'none' check (anchor_type in ('none', 'member', 'item', 'exec', 'decision', 'one_on_one')),
  anchor_id    text,
  anchor_label text not null default '',
  pinned       boolean not null default false,
  ai_allowed   boolean not null default false,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- 예전(1단계) 테이블을 이미 만든 프로젝트용
alter table public.leader_notes add column if not exists anchor_label text not null default '';
alter table public.leader_notes alter column anchor_id type text using anchor_id::text;

create index if not exists leader_notes_owner_idx on public.leader_notes (team_id, owner_id, updated_at desc);
create index if not exists leader_notes_anchor_idx on public.leader_notes (team_id, anchor_type, anchor_id);

alter table public.leader_notes enable row level security;
-- 나만: 쓴 사람만 읽고 쓴다 (같은 팀의 팀장이어도 남의 메모는 안 보임)
drop policy if exists leader_notes_owner on public.leader_notes;
create policy leader_notes_owner on public.leader_notes for all to authenticated
  using (owner_id = auth.uid() and public.is_team_member(team_id))
  with check (owner_id = auth.uid() and public.is_team_member(team_id));

-- 데모 팀: 메모 예시 몇 개 (이미 있으면 건너뜀)
do $$
declare r record; v_jung uuid; v_lee uuid; v_goal uuid; v_exec uuid;
begin
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo loop
    if exists (select 1 from leader_notes where team_id = r.team_id) then continue; end if;
    select tm.user_id into v_jung from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '정우성' limit 1;
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이동욱' limit 1;
    select id into v_goal from work_items where team_id = r.team_id and parent_id is null and title like '제휴%' limit 1;
    select id into v_exec from executives where team_id = r.team_id order by sort limit 1;
    insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, pinned, created_at, updated_at) values
      (r.team_id, r.leader_id, '분기 마감 전 팀 회고는 짧게 30분 — 잘된 것 1개, 바꿀 것 1개만', 'note', 'none', null, true, now() - interval '6 days', now() - interval '6 days'),
      (r.team_id, r.leader_id, '본부장 주간회의 전에 제휴 전망 숫자 다시 확인', 'todo', 'none', null, false, now() - interval '1 day', now() - interval '1 day');
    if v_jung is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '혼자 끙끙 앓는 편. 막히면 먼저 물어봐 주는 게 효과 있음', 'member', v_jung, '정우성', true, now() - interval '9 days', now() - interval '9 days'); end if;
    if v_lee is not null then insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, created_at, updated_at)
      values (r.team_id, r.leader_id, '다음 1on1에서 교육 예산 얘기 꺼내기', 'todo', 'member', v_lee, now() - interval '3 days', now() - interval '3 days'); end if;
    if v_goal is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, 'B사 말고 C사 제휴 가능성도 열어 두기 — 영업본부 박 팀장에게 물어보기', 'item', v_goal, true, now() - interval '2 days', now() - interval '2 days'); end if;
    if v_exec is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '숫자는 항상 지난달 대비로. 표보다 한 줄 결론을 먼저', 'exec', v_exec, true, now() - interval '5 days', now() - interval '5 days'); end if;
  end loop;
end $$;
