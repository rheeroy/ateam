#!/bin/sh
# 0007까지 적용된 DB(옛 목표·과제 데이터 포함)에 0008을 적용해 이전이 맞는지 확인
set -e
P="psql -h /var/tmp -p 5499 -U postgres"
$P -q -c "drop database if exists tm" -c "create database tm"
$P -d tm -v ON_ERROR_STOP=1 -q -f tests/_supabase_stub.sql 2>/dev/null
for f in migrations/*.sql; do
  case "$f" in *_schedules.sql|*0008*|*_work_items.sql) continue;; esac
  $P -d tm -v ON_ERROR_STOP=1 -q -f "$f"
done
$P -d tm -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111', 'l@x.com', '{"full_name":"팀장"}');
insert into teams (id, name, owner_id) values ('aaaaaaaa-0000-0000-0000-000000000001', '팀', '11111111-1111-1111-1111-111111111111');
insert into team_members (team_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'leader');
insert into strategic_goals (id, team_id, title) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '목표A');
insert into tasks (id, team_id, goal_id, title, owner_id, progress, status, due_date) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '과제1', '11111111-1111-1111-1111-111111111111', 40, 'in_progress', current_date + 10),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', null, '과제2', null, 0, 'planned', null);
insert into milestones (task_id, title, done_at) values ('cccccccc-0000-0000-0000-000000000001', 'M1', now()), ('cccccccc-0000-0000-0000-000000000001', 'M2', null);
insert into task_allocations (task_id, user_id, team_id, share_pct) values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 50);
insert into metrics (team_id, goal_id, name, period_start, period_end) values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '매출', current_date, current_date + 90);
insert into submissions (team_id, author_id, task_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001', '보고서');
SQL
$P -d tm -1 -v ON_ERROR_STOP=1 -q -f dashboard/04_upgrade_v2.sql
$P -d tm -At <<'SQL'
select 'items=' || count(*) from work_items;
select 'task1_measure=' || measure || ' progress=' || progress from work_items where title = '과제1';
select 'goal_progress=' || progress from work_items where title = '목표A';
select 'orphan_task_top=' || (parent_id is null) from work_items where title = '과제2';
select 'alloc_mapped=' || count(*) from work_item_allocations a join work_items w on w.id = a.item_id;
select 'metric_mapped=' || (item_id is not null) from metrics;
select 'sub_mapped=' || (item_id is not null) from submissions;
select 'old_tables_gone=' || (to_regclass('public.tasks') is null and to_regclass('public.strategic_goals') is null);
SQL
