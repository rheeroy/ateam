-- 로컬 검증용 시나리오 테스트: psql -v ON_ERROR_STOP=1 -f tests/behavior.sql
\set L '11111111-1111-1111-1111-111111111111'
\set A '22222222-2222-2222-2222-222222222222'
\set B '33333333-3333-3333-3333-333333333333'
insert into auth.users (id, email, raw_user_meta_data) values
 (:'L', 'leader@x.com', '{"full_name":"이경훈"}'), (:'A', 'a@x.com', '{"full_name":"김도현"}'), (:'B', 'b@y.com', '{}');

create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, false), set_config('request.jwt.claim.role', 'authenticated', false) $$;

-- leader creates team, invites A
select pg_temp.as_user(:'L'); set role authenticated;
select public.create_team('전략기획팀', '신사업 검증', '팀장') as team \gset
select public.create_invitation(:'team', 'a@x.com', '기획') as tok \gset
reset role;
select pg_temp.as_user(:'A'); set role authenticated;
select public.invitation_preview(:'tok');
select public.accept_invitation(:'tok') = :'team'::uuid as joined;
insert into checkins (team_id, user_id, week_start, did, blocked, condition)
  values (:'team', :'A', date_trunc('week', now())::date, '기획서 v3', '경쟁사 데이터', 3);
insert into submissions (team_id, author_id, title) values (:'team', :'A', '신제품 진입 기획서') returning id as sub \gset
insert into submission_versions (submission_id, team_id, version, extracted_text, created_by) values (:'sub', :'team', 1, '본문', :'A') returning id as ver \gset
select count(*) = 0 as a_cannot_see_observations from observations;
reset role;

select pg_temp.as_user(:'L'); set role authenticated;
select count(*) = 1 as leader_sees_checkin from checkins;
insert into observations (team_id, author_id, subject_id, kind, body) values (:'team', :'L', :'A', 'praise', '임원 보고 침착');
insert into one_on_ones (team_id, leader_id, member_id, scheduled_at) values (:'team', :'L', :'A', now()) returning id as oo \gset
insert into one_on_one_private (one_on_one_id, team_id, leader_id, notes) values (:'oo', :'team', :'L', 'PM 후보');
insert into review_comments (submission_id, version_id, team_id, author_id, section_ref, body) values (:'sub', :'ver', :'team', :'L', '§2', '근거 좋아요');
update one_on_ones set status = 'done', shared_notes = '가격 전략 합의' where id = :'oo';
select count(*) as evidence_rows from evidence;
select public.seed_sample_strategy(:'team');
select title, progress, probability, basis from public.goal_outlook(:'team');
select (public.metric_forecast(id) - 'series') as fc from metrics;
select title, share_pct, mission_contribution from public.task_portfolio(:'team') limit 3;
select * from public.care_radar(:'team');
select * from public.member_data_depth(:'team');
select public.team_insight_level(:'team')->'level' as level, public.team_insight_level(:'team')->'next_progress' as next;
select full_name, x, y, prev_x, evidence, withheld from public.team_performance_map(:'team');
select public.credit_status(:'team') - 'features' as credits;
reset role;

select pg_temp.as_user(:'A'); set role authenticated;
select count(*) = 0 as a_cannot_see_private from one_on_one_private;
update one_on_ones set shared_notes = '팀원 추가 메모' where id = :'oo';
do $$ begin
  begin update one_on_ones set status = 'canceled'; raise exception 'should fail';
  exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok member cannot change status: %', sqlerrm; end;
end $$;
select count(*) = 0 as a_cannot_see_evidence from evidence;
reset role;

select pg_temp.as_user(:'B'); set role authenticated;
select count(*) = 0 as outsider_sees_nothing from checkins;
select count(*) = 0 as outsider_no_team from teams;
reset role;

-- service role: AI output + credits
select set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false);
insert into ai_outputs (team_id, kind, content, sources, level, depth) values (:'team', 'weekly_report', '{"text":"초안"}', '[]', 'L1', 2) returning id as aio \gset
select public.consume_credits(:'team', 2, 'weekly_report', :'aio', 'claude-sonnet-5-5', 1000, 200, 0.004);
select pg_temp.as_user(:'L'); set role authenticated;
update ai_outputs set edited_content = '{"text":"수정본"}', content = '{"text":"해킹"}' where id = :'aio';
select status, content->>'text' as original, edited_content->>'text' as edited from ai_outputs where id = :'aio';
update ai_outputs set status = 'final' where id = :'aio';
select status, finalized_by is not null as finalized from ai_outputs where id = :'aio';
select (public.credit_status(:'team')->>'monthly_remaining') as remaining;
select kind, provenance from events order by id;
reset role;

-- ---------- 0007 노하우 ----------
select pg_temp.as_user(:'L'); set role authenticated;
insert into knowhow_sources (team_id, owner_id, title, raw_text) values (:'team', :'L', '보고 원칙', '숫자 없는 보고는 받지 않는다') returning id as ks \gset
insert into knowhow_cards (team_id, owner_id, source_id, kind, title, body, rules, applies_to, shared)
  values (:'team', :'L', :'ks', 'principle', '결론부터', '보고는 결론부터', '["첫 문장에 결론"]', '{review,report}', true) returning id as kc \gset
insert into knowhow_cards (team_id, owner_id, kind, title, applies_to) values (:'team', :'L', 'coaching', '비공개 카드', '{prep}');
update knowhow_cards set body = '보고는 결론부터, 숫자로' where id = :'kc';
select provenance = 'human_edit' as edited_marked from knowhow_cards where id = :'kc';
reset role;
select pg_temp.as_user(:'A'); set role authenticated;
select count(*) = 1 as member_sees_only_shared from knowhow_cards;
select count(*) = 0 as member_no_sources from knowhow_sources;
reset role;
select pg_temp.as_user(:'B'); set role authenticated;
select count(*) = 0 as outsider_no_cards from knowhow_cards;
reset role;
select 'knowhow' = any(features) as knowhow_in_free from plans where id = 'free';
