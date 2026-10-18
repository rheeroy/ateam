-- ATEAM 데모 계정 — v2(04)를 적용한 프로젝트의 SQL Editor에서 Run. 다시 Run하면 데모가 처음 상태로 초기화됩니다.

-- =====================================================================
-- 데모 팀: 팀장·팀원 데모 계정으로 로그인해 체험하는 가상 팀
--   · teams.is_demo — 요금제의 팀 수 한도에서 빠짐, 예약 AI 인사이트는 만든 뒤 14일만
--   · seed_demo_team() — 약 6개월치 기록을 채움 (SQL Editor·service_role 전용)
--   · 계정 만들기는 supabase/demo_accounts.sql (대시보드 06_demo_accounts.sql)
-- =====================================================================
alter table public.teams add column if not exists is_demo boolean not null default false;

-- 팀 수 한도는 데모 팀을 세지 않는다
create or replace function public.create_team(p_name text, p_mission text default '', p_job_title text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_plan plans; v_owned int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from subscriptions where owner_id = auth.uid()) then
    insert into subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (auth.uid(), 'pro', 'trialing', now() + interval '30 days', now(), now() + interval '30 days');
  end if;
  v_plan := public.effective_plan_for_owner(auth.uid());
  select count(*) into v_owned from teams where owner_id = auth.uid() and not is_demo;
  if v_owned >= v_plan.max_teams then
    raise exception 'PLAN_LIMIT_TEAMS' using errcode = 'P0001', hint = v_plan.max_teams::text;
  end if;
  insert into teams (name, mission, owner_id, settings) values (p_name, coalesce(p_mission, ''), auth.uid(),
    jsonb_build_object('level_names', '["목표","과제","할 일"]'::jsonb, 'member_free_edit', false)) returning id into v_team;
  insert into team_members (team_id, user_id, role, job_title) values (v_team, auth.uid(), 'leader', coalesce(p_job_title, ''));
  perform log_event(v_team, 'team.created', 'teams', v_team);
  return v_team;
end $$;

-- 예약 인사이트: 데모 팀은 만든 뒤 14일만 (원가)
create or replace function public.active_ai_teams() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from teams t
  where public.team_has_feature(t.id, 'ai_core')
    and (not t.is_demo or t.created_at > now() - interval '14 days')
    and exists (select 1 from events e where e.team_id = t.id and e.created_at > now() - interval '14 days');
$$;
revoke all on function public.active_ai_teams() from public, anon, authenticated;

-- 마케팅기획팀. p_members 순서: 김도현(브랜드) · 박서연(퍼포먼스) · 최민아(콘텐츠) · 정우성(제휴) · 이정규(CRM) · 한수진(신규)
create or replace function public.seed_demo_team(p_team uuid, p_leader uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  L uuid := p_leader;
  m_kim uuid := p_members[1];
  m_park uuid := p_members[2];
  m_choi uuid := p_members[3];
  m_jung uuid := p_members[4];
  m_lee uuid := p_members[5];
  m_han uuid := p_members[6];
  T uuid := p_team;
  g1 uuid; g2 uuid; g3 uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; mt uuid;
  sub uuid; ver uuid; oo uuid;
  wk date; i int; u record; v_month date := date_trunc('month', current_date)::date;
  this_mon date := date_trunc('week', current_date)::date;
begin
  if coalesce(array_length(p_members, 1), 0) <> 6 then raise exception 'seed_demo_team: 팀원 6명이 필요합니다'; end if;
  if not exists (select 1 from teams where id = T and is_demo and owner_id = L) then raise exception 'seed_demo_team: 데모 팀이 아닙니다'; end if;

  update teams set name = '마케팅기획팀 (데모)', mission = '고객 데이터를 근거로 캠페인을 빠르게 검증해, 신규 고객 획득과 재구매를 함께 늘린다',
    parent_link = '2026 회사 전략 목표 「신규 고객 30만 명 확보」 · 기여 비중 40%' where id = T;
  insert into team_members (team_id, user_id, role, job_title, joined_at) values (T, L, 'leader', '팀장', now() - interval '200 days')
    on conflict (team_id, user_id) do update set role = 'leader', status = 'active', joined_at = now() - interval '200 days';
  insert into team_members (team_id, user_id, role, job_title, joined_at) values
    (T, m_kim, 'member', '브랜드 마케팅', now() - interval '190 days'),
    (T, m_park, 'member', '퍼포먼스 마케팅', now() - interval '190 days'),
    (T, m_choi, 'member', '콘텐츠 마케팅', now() - interval '180 days'),
    (T, m_jung, 'member', '제휴 마케팅', now() - interval '180 days'),
    (T, m_lee, 'member', 'CRM 마케팅', now() - interval '150 days'),
    (T, m_han, 'member', '마케팅 기획 (신규)', now() - interval '42 days');

  -- 목표·과제 (자유 계층)
  update teams set settings = settings || '{"level_names":["목표","과제","할 일"],"member_free_edit":false}'::jsonb
    || jsonb_build_object('plan_open_until', to_char(current_date + 3, 'YYYY-MM-DD')) where id = T;   -- 정우성 계획 요청 기한까지 팀원 수정 기간
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '하반기 신제품 런칭 캠페인 성공', 'children', 1, current_date - 60, current_date + 80, 5, now() - interval '60 days') returning id into g1;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '제휴 채널 신규 고객 확대', 'children', 2, current_date - 90, current_date + 70, 5, now() - interval '90 days') returning id into g2;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '마케팅 운영 효율화', 'children', 3, current_date - 60, current_date + 100, 3, now() - interval '60 days') returning id into g3;
  insert into hypotheses (team_id, item_id, statement, signal) values
    (T, g1, '얼리버드 할인으로 사전 예약 전환율 20% 이상', '고객 FGI 12명 중 구매 의향 7명'),
    (T, g2, 'B사 멤버십 제휴로 연내 신규 고객 8만 명', 'B사 회원 데이터 수급 2주째 지연'),
    (T, g3, '콘텐츠 제작 리드타임 3주 → 2주', '최근 4건 평균 2.6주');
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '런칭 캠페인 기획', m_kim, 1, 5, 16, 'children', 0, current_date - 45, current_date + 40, 1, now() - interval '45 days') returning id into t1;
  insert into work_items (team_id, parent_id, owner_id, title, measure, status, due_date, sort) values
    (T, t1, m_kim, '타깃 고객 정의', 'check', 'done', current_date - 30, 1),
    (T, t1, m_kim, '경쟁사 캠페인 분석', 'check', 'done', current_date - 10, 2),
    (T, t1, m_kim, '크리에이티브 시안 3안', 'check', 'active', current_date + 10, 3),
    (T, t1, m_han, '고객 FGI 12명', 'check', 'active', current_date + 20, 4),
    (T, t1, m_kim, '임원 보고', 'check', 'active', current_date + 38, 5);
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '런칭 프로모션 정책 확정', m_kim, 1, 4, 8, 'percent', 85, current_date - 60, current_date - 5, 2, now() - interval '60 days') returning id into t2;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, status, start_date, due_date, sort, created_at) values
    (T, g2, '제휴 프로모션 제안서', m_jung, 1, 5, 6, 'percent', 30, 'blocked', current_date - 30, current_date + 20, 1, now() - interval '30 days') returning id into t3;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g2, '제휴 유입 고객 CRM 연계', m_lee, 2, 4, 6, 'percent', 35, current_date - 40, current_date + 50, 2, now() - interval '40 days') returning id into t4;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '콘텐츠 제작 프로세스 개선', m_choi, 2, 4, 10, 'percent', 66, current_date - 50, current_date + 30, 1, now() - interval '50 days') returning id into t5;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '채널별 성과 보고 체계 정비', m_jung, 3, 1, 18, 'percent', 40, current_date - 90, current_date + 60, 2, now() - interval '90 days') returning id into t6;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, recur, sort, created_at) values
    (T, g3, '월간 광고 성과 리포트 운영', m_park, 3, 2, 12, 'recurring', 'monthly', 3, now() - interval '120 days') returning id into t7;
  insert into work_item_logs (item_id, team_id, author_id, kind, period, done) values
    (t7, T, m_park, 'recurring', (v_month - interval '3 months')::date, true), (t7, T, m_park, 'recurring', (v_month - interval '2 months')::date, true),
    (t7, T, m_park, 'recurring', (v_month - interval '1 months')::date, false);
  -- 일정 변경 이력 (재계획 2회)
  update work_items set due_date = current_date + 5, change_reason = '경쟁사 할인 행사 추가 확인' where id = t2;
  update work_items set due_date = current_date + 10, change_reason = '임원 일정' where id = t2;
  -- 진척 기록 (최근 3주 속도)
  insert into work_item_logs (item_id, team_id, author_id, kind, period, value) values
    (t3, T, m_jung, 'progress', current_date - 21, 22), (t3, T, m_jung, 'progress', current_date - 14, 26), (t3, T, m_jung, 'progress', current_date - 7, 28),
    (t4, T, m_lee, 'progress', current_date - 21, 20), (t4, T, m_lee, 'progress', current_date - 14, 27),
    (t5, T, m_choi, 'progress', current_date - 21, 45), (t5, T, m_choi, 'progress', current_date - 14, 55)
    on conflict do nothing;
  -- 팀원이 올린 계획(검토 대기) + 팀장 요청
  insert into work_items (team_id, parent_id, owner_id, title, note, measure, status, start_date, due_date, sort)
    values (T, g2, m_lee, '제휴 고객 웰컴 메시지 A/B 테스트', '2개 문구 × 2주, 재방문율 비교', 'percent', 'proposed', current_date + 3, current_date + 35, 3);
  insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, due_date)
    values (T, L, m_jung, 'plan', g2, '제휴 채널 신규 고객 확대 — 하위 과제 계획 세워 주세요', '제안서 이후 실행 단계까지 포함해서요', current_date + 3);
  insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, due_date) values
    (T, L, m_park, 'share', t7, '광고 성과 대시보드 개편 화면 캡처 공유해 주세요', '지난주 말씀하신 1차 배포 화면이요. 승인까지는 필요 없습니다.', current_date + 2),
    (T, L, m_han, 'progress', t1, '고객 FGI 진행 상황 업데이트 부탁해요', '몇 명 했는지, 막히는 게 있는지만 짧게요', current_date + 1);
  -- 팀원 상세 액션: 지원·격려 / 육성 (요청 종류 추가 14_request_kinds 이후에만 들어감)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, title, body, created_at) values
      (T, L, m_lee, 'cheer', '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 같이 볼게요.', '', now() - interval '1 day'),
      (T, L, m_choi, 'grow', '다음 분기에 콘텐츠 운영 전체를 맡아 보면 어때요? 해 보고 싶은 범위를 알려 줘요', '', now() - interval '2 days');
    -- 팀원 → 팀장 1:1 요청 (팀원 앱에서 '1:1 요청하기')
    insert into team_requests (team_id, from_id, to_id, kind, title, body, created_at) values
      (T, m_lee, L, 'meeting', 'CRM 연계 방향이 맞는지 한번 같이 보고 싶어요', '', now() - interval '5 hours');
  exception when others then null;
  end;
  -- 팀원 → 팀장 목표 변경 요청 (22_plan_window 이후에만 들어감)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, created_at) values
      (T, m_choi, L, 'change', t5, '콘텐츠 제작 프로세스 개선 — 마감 2주 연장 요청',
       '외주 제작사 교체로 템플릿 정비가 늦어졌습니다. 마감을 2주 미루고, 목표 범위에서 영상 가이드는 다음 분기로 넘기고 싶어요.', now() - interval '1 day');
  exception when others then null;
  end;
  insert into work_item_allocations (item_id, user_id, team_id, share_pct) values
    (t1, m_kim, T, 40), (t1, m_han, T, 30), (t2, m_kim, T, 20), (t3, m_jung, T, 15), (t4, m_lee, T, 20),
    (t5, m_choi, T, 30), (t6, m_jung, T, 45), (t6, m_park, T, 10), (t7, m_park, T, 30);

  insert into metrics (team_id, item_id, name, unit, target, period_start, period_end, cumulative)
    values (T, g2, '제휴 채널 신규 고객', '만 명', 20, (v_month - interval '3 months')::date, (v_month + interval '2 months')::date, true) returning id into mt;
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_target, unit, metric_id, sort)
    values (T, g2, m_lee, '제휴 채널 신규 고객', 'number', 20, '만 명', mt, 4);
  insert into metric_values (metric_id, team_id, period, value) values
    (mt, T, (v_month - interval '3 months')::date, 3.4), (mt, T, (v_month - interval '2 months')::date, 3.6), (mt, T, (v_month - interval '1 months')::date, 4.2);
  insert into metric_pipeline (metric_id, team_id, label, amount, probability, expected_close) values
    (mt, T, 'B사 멤버십 제휴', 4, 0.4, v_month + 45), (mt, T, 'C사 카드 프로모션 재계약', 2.5, 0.6, v_month + 30), (mt, T, 'D사 앱 공동 이벤트', 1.5, 0.3, v_month + 50);

  -- 체크인 26주
  for i in 1..26 loop
    wk := this_mon - (i * 7);
    insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
      (T, m_kim, wk, case when i = 1 then '런칭 캠페인 기획서 v3 제출, FGI 설계 착수' when i = 2 then '프로모션 전략 전면 수정' else '런칭 캠페인 기획·경쟁사 캠페인 분석' end,
         case when i = 2 then '경쟁사 할인 데이터 확보' else '' end, '고객 FGI 진행', case when i <= 1 then 3 else 4 end),
      (T, m_park, wk, '광고 성과 대시보드 개선, 월간 리포트 운영', '', '리포트 자동화', 4),
      (T, m_choi, wk, '콘텐츠 캘린더 운영, 제작 프로세스 개선안 작성', '', '디자인팀 인터뷰', case when i % 5 = 0 then 3 else 4 end),
      (T, m_jung, wk, case when i <= 2 then '제휴 프로모션 제안서 작성' else '채널 성과 보고 정비, 파트너사 미팅' end,
         case when i <= 2 then '파트너사 회원 데이터 수급이 안 됨' else '' end, '제안서 마무리', case when i <= 2 then 3 else 4 end);
    if i <= 20 then
      insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
        (T, m_lee, wk, 'CRM 캠페인 운영, 휴면 고객 재활성화 메시지', '', 'CRM 성과 분석', case i when 1 then 2 when 2 then 3 when 3 then 4 else 4 end);
    end if;
    if i <= 5 then
      insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
        (T, m_han, wk, '온보딩 과제 수행, 런칭 캠페인 리서치 보조', '', '리서치 정리', 4);
    end if;
  end loop;
  -- 이번 주: 이정규만 미제출
  -- 지난 체크인의 작성 시각을 그 주 금요일로
  update checkins set created_at = week_start + interval '4 days 17 hours', updated_at = week_start + interval '4 days 17 hours' where team_id = T;
  insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
    (T, m_kim, this_mon, '고객 FGI 설계, 임원 보고 장표 보완', '', 'FGI 8명 진행', 3),
    (T, m_park, this_mon, '리포트 자동화 1차', '', '대시보드 배포', 4),
    (T, m_choi, this_mon, '제작 프로세스 개선안 v2', '', '디자인팀 피드백 반영', 4),
    (T, m_jung, this_mon, '제휴 프로모션 제안서 초안', '파트너사 회원 데이터 수급이 안 됨', 'B사 데이터 대체안', 3),
    (T, m_han, this_mon, '경쟁사 프로모션 조사', '', 'FGI 보조', 4);

  -- 1:1 (격주, 완료)
  for u in select * from (values (m_kim, 12), (m_park, 11), (m_choi, 10), (m_jung, 9), (m_lee, 5), (m_han, 3)) as x(uid, n) loop
    for i in 1..u.n loop
      insert into one_on_ones (team_id, leader_id, member_id, scheduled_at, status, shared_notes, completed_at)
      values (T, L, u.uid, now() - ((case when u.uid = m_lee then 21 else 7 end) + (i - 1) * 14) * interval '1 day', 'done',
              case when u.uid = m_kim and i = 1 then '런칭 프로모션을 얼리버드 할인 중심으로 바꾸는 방향에 합의. 2번 가설은 고객 FGI로 검증하기로 함.'
                   else '진행 상황 공유, 다음 2주 우선순위 확인' end,
              now() - ((case when u.uid = m_lee then 21 else 7 end) + (i - 1) * 14) * interval '1 day');
    end loop;
  end loop;
  insert into one_on_ones (team_id, leader_id, member_id, scheduled_at) values
    (T, L, m_kim, date_trunc('day', now()) + interval '14 hours'),
    (T, L, m_park, date_trunc('week', now()) + interval '3 days 10 hours');
  insert into action_items (team_id, owner_id, title, due_date, created_by) values
    (T, L, '경쟁사 캠페인 분석 리포트 공유', current_date - 7, L),
    (T, m_kim, 'FGI 설계안 초안', current_date + 2, L),
    (T, L, '4분기 광고 예산 재배분 확인', current_date + 4, L);

  -- 팀장 노하우: 일 잘하는 방식 · 좋은 결과물의 기준 (AI 검토 · 코칭 · 1:1 준비 · 보고가 읽는다)
  begin
    insert into knowhow_cards (team_id, owner_id, kind, title, body, rules, applies_to, keywords, pinned, shared, provenance, use_count, last_used_at, created_at) values
      (T, L, 'principle', '결론부터, 한 장으로', '보고는 첫 줄에 결론(무엇을 하자는지, 무엇을 정해 달라는지)을 쓰고 근거는 그 아래에 둔다. 첫 장만 읽어도 판단할 수 있어야 한다.',
        '["첫 줄에 결론과 요청 사항", "근거는 3개 이내로", "첫 장만 보고 결정할 수 있게"]'::jsonb, '{review,report,briefing}', '{결론,보고,한장}', true, true, 'human', 14, now() - interval '1 day', now() - interval '120 days'),
      (T, L, 'rubric', '좋은 기획서의 조건', '정보를 모은 것과 기획은 다르다. 내가 무엇을 문제로 보는지, 왜 이 안을 골랐는지가 보여야 한다.',
        '["문제 정의를 본인 언어로", "대안 2개 이상 비교하고 버린 이유", "리스크와 대응", "다음 행동·담당·일정까지"]'::jsonb, '{review,evaluation}', '{기획서,대안,리스크}', true, true, 'human', 11, now() - interval '2 days', now() - interval '110 days'),
      (T, L, 'principle', '숫자에는 출처와 비교 기준', '숫자만 있으면 판단이 안 된다. 어디서 나온 숫자인지, 무엇과 비교해 좋은지 나쁜지가 함께 있어야 한다.',
        '["숫자마다 출처", "지난달·목표 대비로 쓴다", "추정치는 가정을 함께"]'::jsonb, '{review,report}', '{숫자,출처,근거}', false, true, 'human', 9, now() - interval '3 days', now() - interval '100 days'),
      (T, L, 'rubric', '올리기 전 완성도 점검 3가지', '초안이어도 괜찮지만, 아래 세 가지는 비워 두지 않는다.',
        '["미정·TBD로 남긴 곳이 없는가", "요청받은 질문에 다 답했는가", "다음 행동과 날짜가 있는가"]'::jsonb, '{review}', '{완성도,점검}', false, true, 'human', 6, now() - interval '4 days', now() - interval '60 days'),
      (T, L, 'framework', '보고서 기본 구조', '결론 → 배경 → 대안 비교 → 리스크 → 다음 행동 순서. 분량보다 이 순서를 지키는 것이 중요하다.',
        '["결론 → 배경 → 대안 → 리스크 → 다음 행동"]'::jsonb, '{review,report}', '{구조,양식}', false, true, 'human', 7, now() - interval '6 days', now() - interval '90 days'),
      (T, L, 'principle', '막히면 이틀 안에 말한다', '혼자 오래 붙들수록 손해다. 막힌 지 이틀이 되면 무엇이 필요한지 한 줄로 공유한다. 도움을 청하는 건 약점이 아니다.',
        '["막힘은 2일 안에 공유", "무엇이 필요한지 함께 쓴다"]'::jsonb, '{review,prep,briefing}', '{막힘,공유}', false, true, 'human', 5, now() - interval '5 days', now() - interval '80 days'),
      (T, L, 'coaching', '1:1은 사람 먼저', '1:1 첫 10분은 업무가 아니라 컨디션과 어려움을 묻는다. 해결책보다 먼저 듣고, 약속은 하나만 정한다.',
        '["첫 10분은 사람 이야기", "약속은 하나만, 날짜와 함께"]'::jsonb, '{prep}', '{1:1,코칭}', false, false, 'human', 8, now() - interval '2 days', now() - interval '70 days'),
      (T, L, 'context', '하반기 우리 팀 우선순위', '하반기 최우선은 신제품 런칭과 제휴 채널 확대. 전사 비용 15% 절감 방침이 있어, 예산이 드는 안은 CAC 근거를 함께 낸다.',
        '["런칭·제휴가 최우선", "예산 안에는 CAC 근거"]'::jsonb, '{review,strategy,briefing,prep}', '{우선순위,예산,CAC}', true, false, 'human', 10, now() - interval '1 day', now() - interval '40 days');
  exception when others then null;
  end;

  -- 결과물: 김도현 기획서 v1~v3 (리뷰 중)
  insert into submissions (team_id, author_id, item_id, title, status, created_at) values (T, m_kim, t1, '하반기 신제품 런칭 캠페인 기획서', 'in_review', now() - interval '30 days') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 1, E'1. 시장·고객\n타깃 2030 직장인, 관련 시장 1.2조 연 8% 성장.\n\n2. 프로모션 — 정가 런칭\n할인 없이 정가로 런칭해 프리미엄 브랜드 이미지를 우선한다.', '초안', m_kim, now() - interval '30 days'),
    (sub, T, 2, E'1. 시장·고객\n타깃 2030 직장인, 관련 시장 1.2조 연 8% 성장. 주요 경쟁사 3곳.\n\n2. 프로모션 — 정가 런칭\n브랜드 인지도 조사 결과 반영 예정.\n\n3. 채널 계획\n유튜브·인스타그램 중심, 사전 예약 페이지.', '채널 계획 추가', m_kim, now() - interval '16 days');
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 3, E'1. 시장·고객\n타깃 2030 직장인, 관련 시장 1.2조 연 8% 성장. 주요 경쟁사 3곳의 점유율 합계 61%.\n\n2. 프로모션 — 얼리버드 할인\n경쟁사 캠페인 재분석 결과, 브랜드 인지도가 낮은 상태에서 정가 런칭은 초기 전환을 막는다고 판단했다. 사전 예약 고객에게 15% 얼리버드 할인을 주고, 런칭 6주 뒤 정가로 전환한다. 버린 대안: 정가 런칭(인지도 부족), 상시 할인(브랜드 훼손).\n\n3. 채널 계획\n유튜브·인스타그램 중심 사전 예약 → 런칭 후 제휴 채널(B사 멤버십) 확대.\n\n4. 가설별 검증 계획\n가설 1: 얼리버드 할인으로 사전 예약 전환율 20% 이상 — 예약 페이지 데이터로 검증\n가설 2: 3040 직장인도 주 고객 — 고객 FGI 12명으로 검증 (데이터 보강 필요)',
     '프로모션을 얼리버드 할인으로 전면 수정', m_kim, now() - interval '4 days') returning id into ver;
  insert into review_comments (submission_id, version_id, team_id, author_id, section_ref, body, created_at) values
    (sub, ver, T, L, '§2 프로모션', '근거가 좋아요. 다만 2번 가설은 데이터가 더 필요해 보입니다.', now() - interval '3 days');
  insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at, parent_id)
    select sub, ver, T, m_kim, '다음 주 고객 FGI로 보강하겠습니다.', now() - interval '3 days', id from review_comments where submission_id = sub limit 1;

  insert into submissions (team_id, author_id, item_id, title, status) values (T, m_choi, t5, '콘텐츠 제작 프로세스 개선안', 'in_review') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by) values
    (sub, T, 1, E'콘텐츠 제작 프로세스 개선안\n1. 현황: 콘텐츠 1건 제작 리드타임 평균 3주\n2. 개선: 브리프 템플릿, 디자인팀 주간 고정 슬롯', '초안', m_choi),
    (sub, T, 2, E'콘텐츠 제작 프로세스 개선안\n1. 현황: 콘텐츠 1건 제작 리드타임 평균 3주 (최근 10건 기준)\n2. 개선: 브리프 템플릿, 디자인팀 주간 고정 슬롯, 중간 리뷰 1회로 축소\n3. 측정: 월 제작 건수, 리드타임', '측정 지표 추가', m_choi);

  -- 지난 결과물 (승인 13건) + 판단 깊이 기록
  for i in 1..13 loop
    insert into submissions (team_id, author_id, title, created_at)
    values (T, (array[m_kim, m_park, m_choi, m_jung, m_kim, m_park, m_choi, m_kim, m_jung, m_park, m_choi, m_kim, m_lee])[i],
            (array['고객 세그먼트 분석','광고 성과 진단','SNS 채널 운영안','제휴사 후보 리스트','경쟁사 캠페인 동향','광고 성과 대시보드 설계','콘텐츠 가이드라인','고객 페르소나 정의','제휴 조건 비교','리포트 자동화 계획','브랜드 톤앤매너 정리','가격 민감도 분석','CRM 메시지 개편'])[i],
            now() - (170 - i * 11) * interval '1 day')
    returning id into sub;
    insert into submission_versions (submission_id, team_id, version, extracted_text, created_by, created_at)
    values (sub, T, 1, (array[
      E'고객 세그먼트 분석\n1. 구매 데이터 기준 4개 세그먼트: 가성비형 34%, 트렌드형 27%, 충성형 22%, 이탈 위험 17%\n2. 신제품 1차 타깃: 트렌드형 — 객단가 상위 30%, SNS 유입 비중 62%\n3. 다음: 트렌드형 대상 메시지 테스트',
      E'광고 성과 진단\n1. 3분기 CAC 2.9만 원 (전 분기 대비 +12%)\n2. 원인: 인스타그램 소재 피로도 — 같은 소재 6주 이상 집행\n3. 제안: 소재 교체 주기 3주로 단축, 제휴 채널 테스트 예산 10% 배정',
      E'SNS 채널 운영안\n1. 목표: 런칭 전 팔로워 3만 → 5만\n2. 주 3회 정기 콘텐츠 + 월 1회 협업 라이브\n3. 성과 지표: 저장 수·공유 수 중심 (좋아요 제외)',
      E'제휴사 후보 리스트\n1. 후보 6곳: 멤버십 규모·고객 겹침·데이터 제공 가능 여부로 비교\n2. 1순위 B사(멤버십 120만, 겹침 38%), 2순위 A사, 3순위 C사\n3. B사는 데이터 제공 일정이 불확실 — 대안 확보 필요',
      E'경쟁사 캠페인 동향\n1. 주요 3사 모두 런칭 초기 할인(10~20%) 사용\n2. 정가 런칭 사례는 인지도 상위 브랜드뿐\n3. 시사점: 우리 인지도에서는 초기 할인 검토 필요',
      E'광고 성과 대시보드 설계\n1. 보는 사람별 화면: 팀장(주간 CAC·전환), 실무(소재별 성과)\n2. 데이터 소스 3곳 자동 연동, 매일 오전 7시 갱신\n3. 1차 배포 범위: 채널별 CAC·전환율',
      E'콘텐츠 가이드라인\n1. 톤: 친근하지만 과장 없이, 숫자는 출처와 함께\n2. 이미지: 제품 단독 컷 금지, 사용 장면 위주\n3. 금지 표현 12개와 대체 표현 정리',
      E'고객 페르소나 정의\n1. 핵심 페르소나: 31세 직장인, 퇴근 후 30분 자기관리, SNS로 제품 탐색\n2. 구매 장벽: 가격보다 "나한테 맞을지" 확신 부족\n3. 메시지 방향: 후기·체험 중심',
      E'제휴 조건 비교\n1. A사: 수수료 8%, 데이터 월 1회 / B사: 수수료 10%, 데이터 실시간(일정 미정) / C사: 수수료 7%, 데이터 없음\n2. 추천: B사 우선 협상, A사 병행',
      E'리포트 자동화 계획\n1. 주간 리포트 작성 시간 4시간 → 30분 목표\n2. 대시보드 연동 후 자동 요약, 코멘트만 작성\n3. 일정: 3주, 1주차 데이터 정리',
      E'브랜드 톤앤매너 정리\n1. 키워드: 정직함·가벼움·실용\n2. 채널별 톤 차이: 인스타그램은 가볍게, 상세 페이지는 근거 중심\n3. 예시 문구 20개',
      E'가격 민감도 분석\n1. 설문 400명: 적정 가격 3.2만~3.8만 원\n2. 4만 원 이상에서 구매 의향 급감(−41%)\n3. 제안: 정가 3.9만 원, 런칭 할인으로 3.3만 원대 체험',
      E'CRM 메시지 개편\n1. 현재 웰컴 메시지 열람률 22% — 업계 평균 35%\n2. 개편: 첫 메시지에 혜택 1개만, 발송 시점 가입 직후 → 다음 날 오전\n3. 4주 뒤 열람률·첫 구매 전환 비교'])[i], (select author_id from submissions where id = sub), now() - (170 - i * 11) * interval '1 day') returning id into ver;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
    values (sub, ver, T, L, (array[
      '세그먼트 나눈 기준이 분명해서 좋아요. 다음엔 결론(어느 세그먼트부터)을 첫 줄로 올려 주세요.',
      'CAC 숫자에 출처랑 지난 분기 비교가 있어서 판단이 쉬웠어요. 이대로 진행하죠.',
      '좋습니다. 다만 성과 지표를 왜 저장·공유로 골랐는지 한 줄 근거가 있으면 더 좋겠어요.',
      '후보 비교 좋아요. B사 데이터 일정이 불확실하면 대안도 같이 적어 주세요 — 리스크는 미리.',
      '시사점까지 정리해 줘서 좋아요. 이대로 진행하죠.',
      '화면 구성 좋아요. 1차 범위 밖은 언제 하는지 다음 행동·날짜까지 적어 주세요.',
      '좋습니다. 금지 표현 정리가 특히 실용적이에요.',
      '페르소나 좋아요. 이 근거가 어느 데이터에서 나왔는지 출처를 달아 주세요.',
      '조건 비교표 좋아요. 추천 이유를 결론 쪽으로 올리면 첫 장만 봐도 판단돼요.',
      '좋습니다. 일정에 담당자까지 넣어 주면 완성이에요.',
      '톤 정리 좋아요. 이대로 진행하죠.',
      '설문 숫자 좋아요. 정가 3.9만 원으로 정한 이유를 대안(3.5만 원)과 비교해서 한 줄 넣어 주세요.',
      '열람률 기준선 잡은 거 좋아요. 4주 뒤 무엇을 보면 성공인지 목표치까지 적어 주세요.'])[i], now() - (166 - i * 11) * interval '1 day');
    -- 버전 업로드 트리거가 '리뷰 중'으로 돌려놓으므로, 승인은 그 뒤에
    update submissions set status = 'approved' where id = sub;
    update submissions set approved_at = now() - (165 - i * 11) * interval '1 day', updated_at = now() - (165 - i * 11) * interval '1 day' where id = sub;
  end loop;
  insert into judgment_scores (team_id, user_id, score, scored_at) values
    (T, m_kim, 1.8, now() - interval '150 days'), (T, m_kim, 2.0, now() - interval '110 days'), (T, m_kim, 2.0, now() - interval '80 days'),
    (T, m_kim, 2.2, now() - interval '50 days'), (T, m_kim, 2.0, now() - interval '30 days'), (T, m_kim, 2.5, now() - interval '4 days'),
    (T, m_park, 2.5, now() - interval '100 days'), (T, m_park, 2.8, now() - interval '40 days'),
    (T, m_choi, 2.0, now() - interval '90 days'), (T, m_choi, 2.5, now() - interval '20 days'),
    (T, m_jung, 2.2, now() - interval '120 days'), (T, m_jung, 2.0, now() - interval '30 days'),
    (T, m_lee, 1.5, now() - interval '60 days');

  -- 관찰 메모
  insert into observations (team_id, author_id, subject_id, kind, competency, body, occurred_at) values
    (T, L, m_kim, 'praise', '커뮤니케이션', '임원 보고에서 프로모션 전략 질문에 근거를 들어 침착하게 답변함', current_date - 6),
    (T, L, m_kim, 'praise', '문제 정의', '정가 런칭 가정을 스스로 뒤집고 경쟁사 캠페인 재분석을 제안함', current_date - 20),
    (T, L, m_kim, 'concern', '실행 관리', '마감 전 야근이 반복됨. 일정 분산 필요', current_date - 12),
    (T, L, m_kim, 'note', '데이터 분석', '시장 분석은 수치 나열에 그치는 경향', current_date - 60),
    (T, L, m_park, 'praise', '데이터 분석', '광고 지표 정의를 영업팀과 맞춰 정리함', current_date - 15),
    (T, L, m_park, 'praise', '협업', '다른 팀 데이터 요청을 우선순위 기준으로 조율', current_date - 40),
    (T, L, m_choi, 'praise', '문제 정의', '제작 지연 문제를 리드타임 지표로 정의', current_date - 25),
    (T, L, m_jung, 'note', '협업', '파트너사 데이터 수급 지연을 혼자 해결하려 함', current_date - 9),
    (T, L, m_jung, 'praise', '커뮤니케이션', '파트너 미팅 정리가 명확함', current_date - 45),
    (T, L, m_lee, 'concern', null, '최근 회의에서 발언이 줄어듦', current_date - 10);

  -- 의사결정 (결과 기록 7건)
  insert into decisions (team_id, title, rationale, expected_outcome, outcome, outcome_rating, decided_by, decided_at) values
    (T, '런칭 프로모션을 얼리버드 할인으로 확정', '경쟁사 캠페인 재분석', '사전 예약 전환율 20%', null, null, L, now() - interval '14 days'),
    (T, 'FGI 대상 8명 → 12명 확대', '2번 가설 데이터 부족', '가설 검증 가능', null, null, L, now() - interval '1 day'),
    (T, '파일럿 광고 채널 2곳 선정', '타깃 도달률', '6주 내 CPA 목표 달성', '5주 만에 달성', 'hit', L, now() - interval '120 days'),
    (T, '광고 리포트 자동화 우선 착수', '반복 업무 30%', '주 6시간 절감', '주 5시간 절감', 'hit', L, now() - interval '100 days'),
    (T, '제휴 후보 5곳으로 압축', '조건 비교', '2곳 협상 진입', '1곳만 진입', 'partial', L, now() - interval '90 days'),
    (T, '콘텐츠 브리프 템플릿 시범 운영', '제작 지연', '리드타임 3주 → 2.5주', '2.4주', 'hit', L, now() - interval '80 days'),
    (T, '영업팀 리드 공유 주간 회의 신설', '정보 공유', '리드 전환 +10%', '변화 없음', 'miss', L, now() - interval '70 days'),
    (T, 'SNS 운영 일부 자동화', '시간 절감', '주 4시간 절감', '주 4시간 절감', 'hit', L, now() - interval '60 days'),
    (T, '광고 예산 상반기 집중', '신제품 사전 인지', '사전 인지도 30%', '32%', 'hit', L, now() - interval '50 days');

  -- 돌아볼 결정 (결과 기록 시점이 지난 것)
  update decisions set review_on = current_date - 1 where team_id = T and title = '런칭 프로모션을 얼리버드 할인으로 확정';

  -- 조직·전사: 위에서 온 것 (org_notes 가 있을 때만)
  if to_regclass('public.org_notes') is not null then
    execute $q$insert into public.org_notes (team_id, author_id, kind, title, body, source, event_date, created_at) values
      ($1, $2, 'exec', '본부장 관심사: 제휴 채널 성과와 CAC 개선 속도',
        E'본부장 주간회의에서 두 번 연속 질문.\n"제휴 채널 신규 고객이 언제 숫자로 보이냐"\n"채널별 CAC 비교표를 다음 보고에 넣어 달라"', '본부장 주간회의', null, now() - interval '6 days'),
      ($1, $2, 'request', '본부 4분기 마케팅 실행계획 초안 제출', '비용 15% 절감 반영, 채널별 CAC 목표 포함', '경영기획팀', current_date + 6, now() - interval '2 days'),
      ($1, $2, 'calendar', '하반기 평가 시즌 시작 (자기평가 오픈)', '팀장 평가 의견 작성 기간 2주', 'HR팀 공지', current_date + 34, now() - interval '10 days'),
      ($1, $2, 'peer', '영업팀 리드 공유 회의 격주 → 월 1회로 변경', '제휴로 들어온 고객 후속 연락이 늦어질 수 있음', '영업팀', null, now() - interval '9 days')$q$
      using T, L;
    execute $q$insert into public.org_notes (team_id, author_id, kind, title, body, source, created_at) values
      ($1, $2, 'strategy', '4분기 전사 방침: 마케팅 비용 15% 절감, 고객 획득 효율(CAC) 중심',
        E'전사 경영회의 결정 사항\n- 4분기 마케팅 비용 전년 대비 15% 절감\n- 채널 평가 기준을 노출·도달에서 CAC(고객 1명 획득 비용)로 변경\n- CAC가 낮은 채널(제휴 등)에 예산 우선 배정', '전사 경영회의', now() - interval '3 days') returning id$q$
      into sub using T, L;
    -- 영향 분석 예시 1건 (ai_kind 'org_impact' 가 같은 실행에서 막 추가된 경우엔 건너뜀)
    begin
      execute $q$insert into public.ai_outputs (team_id, kind, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
        values ($1, 'org_impact', 'org_notes', $2, 'draft', 'leader', 'L2', 2, $3, '[]'::jsonb, $4, now() - interval '3 days')$q$
      using T, sub, jsonb_build_object(
        'summary', '비용 15% 절감 방침이 런칭 캠페인의 광고 집행 계획과 부딪히고, 제휴 채널 목표에는 힘이 실립니다.',
        'level', 'high',
        'affected', jsonb_build_array(
          jsonb_build_object('item_id', g1, 'title', '하반기 신제품 런칭 캠페인 성공', 'how', '유튜브·인스타그램 광고 비중이 커서 비용 절감의 첫 대상이 될 수 있습니다'),
          jsonb_build_object('item_id', g2, 'title', '제휴 채널 신규 고객 확대', 'how', 'CAC가 낮은 채널 우선 배정 방침과 맞아 예산을 더 요청할 근거가 됩니다')),
        'actions', jsonb_build_array(
          jsonb_build_object('label', '런칭 캠페인 광고 예산을 CAC 기준으로 다시 배분', 'kind', 'replan'),
          jsonb_build_object('label', '채널별 CAC 비교표를 이번 주간보고에 추가', 'kind', 'report'),
          jsonb_build_object('label', '정우성 님과 B사 데이터 막힘 해소 일정 확정 — 제휴 채널이 방침의 수혜 영역', 'kind', 'discuss')),
        'report_line', '전사 비용 절감 방침에 맞춰 런칭 캠페인 광고 예산을 CAC 기준으로 다시 나누고, 제휴 채널 비중을 늘리겠습니다.'), L;
    exception when others then null;
    end;
  end if;

  -- AI 인사이트 예시 (오늘·이번 주·이번 달) — 데모 팀은 날짜가 지나도 이 해석을 보여줌
  declare c jsonb;
  begin
    c := $j${
      "headline": "실행은 순항과 정체로 갈렸고, 관리는 운영 리듬이 느슨해진 상태입니다 — 외부 의존 하나가 성과와 사람 양쪽의 병목입니다.",
      "sections": {
        "risk": {"summary": "리스크가 한 곳으로 몰리는 구조입니다 — 외부 데이터 의존 하나가 목표·일정·담당자 컨디션을 동시에 끌어내리고 있어, 이 의존을 풀지 않으면 다른 조치가 효과를 내기 어렵습니다.", "items": [
          {"type": "risk", "severity": 3, "title": "제휴 채널: 데이터 막힘 → 제안서 지연 → 달성 가능성 12%", "body": "원인이 하나라 풀리면 세 가지가 같이 풀립니다.", "action": "B사 데이터 대체안 이번 주 확정", "link": "goals"},
          {"type": "risk", "severity": 2, "title": "이정규 님 이탈 신호", "body": "컨디션 3주 하락과 1:1 공백이 겹칩니다.", "action": "이번 주 1:1", "link": "one_on_ones"}]},
        "decide": {"summary": "결정이 미뤄지며 비용이 쌓이는 국면입니다 — 목표를 지킬지 조정할지 정하지 않은 채 실행만 이어지고 있어, 이번 주 판단이 분기 결과를 가릅니다.", "items": [
          {"type": "risk", "severity": 3, "title": "제휴 목표(20만 명)를 조정할지, 데이터 지원을 요청해 지킬지", "body": "제안서 막힘이 목표 전망을 끌어내립니다. 전사 비용 절감 방침상 제휴 채널은 예산 우선 대상이라 지원 요청의 명분이 있습니다.", "action": "이번 주 안에 결정, 정우성 님과 15분", "link": "sim",
            "options": ["영업본부에 B사 데이터 협조를 공식 요청해 목표 유지", "목표를 16만 명으로 낮추고 런칭 캠페인에 인력 집중", "제안서 범위를 B사 제외 2개사로 줄여 일정 우선"],
            "impact": "기말 전망 18.6만 명 → 목표 20만 명과의 차이를 메우는 유일한 경로입니다."},
          {"type": "pattern", "severity": 2, "title": "런칭 캠페인 광고 예산을 CAC 기준으로 다시 나눌지", "body": "전사 비용 15% 절감 방침이 런칭 캠페인 광고 집행과 부딪힙니다.", "action": "4분기 실행계획 초안 전에 결정", "link": "org",
            "options": ["유튜브 비중을 줄이고 제휴 채널로 이동", "얼리버드 할인 기간을 줄여 비용 확보"],
            "impact": "런칭 목표(달성 가능성 94%)는 지키면서 제휴 목표에 예산을 돌릴 수 있습니다."},
          {"type": "pattern", "severity": 2, "title": "보고 체계 정비에 들어가는 팀 시간을 줄일지", "body": "기여도가 낮은 과제에 팀 시간 35%가 들어가고, 그중 정우성 님 몫이 45%입니다.", "action": "다음 주 계획 회의에서 결정", "link": "strategy",
            "options": ["보고 체계 정비를 다음 분기로 미루고 정우성 님을 제휴에 집중", "박서연 님에게 리포트 운영을 넘겨 시간 분산"],
            "impact": "정우성 님 시간이 제휴 제안서로 옮겨 가면 막힘 해소 속도가 빨라집니다."}]},
        "perf": {"summary": "성과는 순항과 정체로 갈려 있습니다 — 문제는 실행력보다 외부에 기대는 과제에 대체 경로가 없는 계획 구조이고, 그 한 축이 팀 전망 평균을 끌어내립니다.", "items": [
          {"type": "forecast", "severity": 2, "title": "제안서 지연이 제휴 목표 전망의 핵심 원인", "body": "최근 3주 진척 속도가 거의 0입니다.", "action": "B사 데이터 대체안으로 범위 축소", "link": "goals"},
          {"type": "good", "severity": 1, "title": "런칭 캠페인 달성 가능성 94%", "body": "FGI·랜딩 페이지가 일정대로 갑니다.", "link": "goals"}]},
        "people": {"summary": "팀원관리가 흔들리는 건 개인 문제보다 운영 리듬 때문입니다 — 1:1 간격이 벌어진 시기에 막힘을 혼자 끌어안는 패턴이 겹쳐 컨디션이 같이 꺾였고, 성장·인정은 일부에게만 몰려 있습니다.", "items": [
          {"type": "risk", "severity": 3, "title": "이정규 님 3주 연속 컨디션 하락 (4 → 3 → 2)", "body": "1:1이 3주 넘게 없고, CRM 자동화 과제는 혼자 맡고 있습니다. 업무량보다 방향 불확실이 원인일 수 있습니다.", "action": "이번 주 안에 1:1 — 과제 우선순위부터 물어보기", "link": "one_on_ones"},
          {"type": "risk", "severity": 2, "title": "정우성 님 2주째 같은 문제로 막힘", "body": "본인 힘으로 풀 수 없는 외부 데이터 문제라, 팀장이 위로 올려 줘야 풀립니다.", "action": "영업본부 협조 요청을 대신 올리기", "link": "one_on_ones"},
          {"type": "good", "severity": 1, "title": "김도현·박서연 님 판단 깊이 상승", "body": "결과물 검토 점수와 결과 지표가 함께 올랐습니다. 지금 인정하면 효과가 큽니다.", "action": "관찰 메모로 남기기", "link": "team"},
          {"type": "data", "severity": 1, "title": "한수진 님 평가 근거 부족", "body": "입사 6주 차로 결과물·관찰 기록이 적습니다. 평가 시즌(D-33) 전에 근거를 쌓아야 합니다.", "action": "FGI 결과물 리뷰를 근거로 남기기", "link": "reviews"}]},
        "org": {"summary": "위와의 정렬이 늦어지고 있습니다 — 전사 기준은 비용·고객 획득 효율로 바뀌었는데 팀 계획과 보고는 아직 이전 기준이라, 임원 질문에 답할 근거가 비어 있습니다.", "items": [
          {"type": "forecast", "severity": 2, "title": "4분기 실행계획 제출 D-6", "body": "비용 15% 절감 반영이 필요합니다.", "action": "런칭 캠페인 예산 재배분안부터 준비", "link": "org"}]}
      },
      "watch_next": "다음 주 파트너 데이터가 들어오는지, 이정규 님 컨디션이 반등하는지"
    }$j$::jsonb;
    insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
    select T, k::public.ai_kind, 'draft', 'leader', 'L2', 2,
           c || jsonb_build_object('period', p), '[]'::jsonb, L, now() - interval '10 minutes', current_date - d, current_date
    from (values ('insight_daily', 'daily', 0), ('insight_weekly', 'weekly', 6), ('insight_monthly', 'monthly', 30)) v(k, p, d);
  exception when others then null;
  end;

  -- 지난해 목표 (팀목표 '연도별 기록' 예시) — 모두 끝난 상태
  declare py int := extract(year from current_date)::int - 1; pg uuid;
  begin
    insert into work_items (team_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, contribution, created_at, updated_at)
      values (T, L, '브랜드 리뉴얼 캠페인 런칭', 'children', 'done', 100, 1, make_date(py, 3, 1), make_date(py, 9, 30), make_date(py, 3, 1), make_date(py, 8, 31), make_date(py, 9, 30), 5, make_date(py, 2, 20), make_date(py, 9, 30)) returning id into pg;
    insert into work_items (team_id, parent_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, created_at, updated_at) values
      (T, pg, m_kim, '리뉴얼 콘셉트·네이밍', 'check', 'done', 100, 1, make_date(py, 3, 1), make_date(py, 5, 15), make_date(py, 3, 1), make_date(py, 4, 30), make_date(py, 5, 15), make_date(py, 2, 20), make_date(py, 5, 15)),
      (T, pg, m_choi, '런칭 콘텐츠 20종 제작', 'check', 'done', 100, 2, make_date(py, 5, 1), make_date(py, 8, 31), make_date(py, 5, 1), make_date(py, 8, 15), make_date(py, 8, 31), make_date(py, 2, 20), make_date(py, 8, 31)),
      (T, pg, m_park, '런칭 광고 집행', 'check', 'done', 100, 3, make_date(py, 8, 1), make_date(py, 9, 30), make_date(py, 8, 1), make_date(py, 8, 31), make_date(py, 9, 30), make_date(py, 2, 20), make_date(py, 9, 30));
    insert into work_items (team_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, contribution, created_at, updated_at)
      values (T, L, '신규 고객 10만 명 확보', 'children', 'done', 82, 2, make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 12, 31), 5, make_date(py, 1, 2), make_date(py, 12, 31)) returning id into pg;
    insert into work_items (team_id, parent_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, created_at, updated_at) values
      (T, pg, m_park, '퍼포먼스 채널 신규 6만 명', 'percent', 'done', 95, 1, make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31)),
      (T, pg, m_jung, '제휴 채널 신규 4만 명', 'percent', 'done', 62, 2, make_date(py, 3, 1), make_date(py, 12, 31), make_date(py, 3, 1), make_date(py, 11, 30), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31));
  exception when others then null;
  end;

  -- 업무플랫폼: 리뷰 대기 결과물 2건의 AI 1차 검토 + 다가오는 1:1의 AI 준비 노트
  declare v1 uuid; v2 uuid; o1 uuid;
  begin
    select sv.id into v1 from submission_versions sv join submissions s on s.id = sv.submission_id
      where s.team_id = T and s.title = '하반기 신제품 런칭 캠페인 기획서' order by sv.version desc limit 1;
    select sv.id into v2 from submission_versions sv join submissions s on s.id = sv.submission_id
      where s.team_id = T and s.title = '콘텐츠 제작 프로세스 개선안' order by sv.version desc limit 1;
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at) values
      (T, 'review', m_kim, 'submission_versions', v1, 'draft', 'leader', 'L1', 1, $j${
        "depth_score": 3.0,
        "summary": "정가 런칭을 버린 이유와 대안 비교가 분명해 논리가 탄탄하고, 가설마다 검증 방법까지 붙여 완성도도 높아졌습니다. 다만 결론이 §2에 묻혀 있어 첫 장만 봐서는 무엇을 하자는지 바로 보이지 않고, 가설 2(3040 고객)는 아직 주장 수준입니다.",
        "brief": {"tone": "good", "text": "김도현 님이 올린 '하반기 신제품 런칭 캠페인 기획서'는 논리가 탄탄해 보입니다", "why": "버린 대안과 이유까지 비교함 · 결론은 뒤에 있음"},
        "decisions": ["얼리버드 15% 할인 적용", "B사 제휴 채널 확대 시점"],
        "strengths": [{"section": "§2 프로모션", "text": "경쟁사 재분석으로 정가 런칭을 버린 이유와 대안 2개를 비교해 밝혔습니다."},
                      {"section": "§4 가설", "text": "가설마다 검증 방법(예약 데이터, FGI)을 붙였습니다."}],
        "gaps": [{"section": "§4 가설 2", "text": "3040 직장인이 주 고객이라는 근거가 FGI 계획뿐이라 아직 주장 수준입니다."},
                 {"section": "§3 채널", "text": "제휴 채널(B사) 확대가 데이터 수급 지연과 어떻게 맞물리는지 빠져 있습니다."}],
        "questions": ["얼리버드 15%가 사전 예약 전환율 20%로 이어진다는 근거는?", "B사 데이터가 늦어지면 3단계 채널 계획은 어떻게 바뀌나요?"],
        "change_from_previous": "정가 런칭에서 얼리버드 할인으로 바꾸고, 버린 대안과 이유를 새로 적었습니다.",
        "criteria_check": [{"criterion": "결론부터 쓴다", "met": false, "note": "§1 시장 분석으로 시작해 결론이 뒤에 있습니다."},
                           {"criterion": "대안 비교", "met": true, "note": "§2에서 정가·상시 할인을 비교했습니다."},
                           {"criterion": "숫자와 출처", "met": true, "note": "시장 규모·점유율에 수치를 달았습니다."}]
      }$j$::jsonb, '[]'::jsonb, m_kim, now() - interval '4 days'),
      (T, 'review', m_choi, 'submission_versions', v2, 'draft', 'leader', 'L1', 1, $j${
        "depth_score": 2.0,
        "summary": "현황 수치와 측정 지표를 붙여 실행 가능한 모양은 갖췄지만, 목표치가 없고 세 가지 개선이 각각 리드타임을 얼마나 줄이는지 추정이 비어 있어 완결성이 낮습니다. 개선안도 일반적인 방법을 옮긴 수준이라 이 팀만의 병목을 짚은 관점이 약합니다.",
        "brief": {"tone": "watch", "text": "최민아 님이 올린 '콘텐츠 제작 프로세스 개선안'은 완결성이 낮아 보입니다", "why": "목표치가 없고 개선 효과 추정이 비어 있음"},
        "decisions": [],
        "strengths": [{"section": "1. 현황", "text": "최근 10건 기준 리드타임 3주로 기준선을 잡았습니다."}],
        "gaps": [{"section": "2. 개선", "text": "브리프 템플릿·고정 슬롯이 각각 며칠을 줄이는지 추정이 없습니다."},
                 {"section": "3. 측정", "text": "목표치(예: 2주)가 없어 성공 여부를 판단하기 어렵습니다."}],
        "questions": ["세 가지 개선 중 리드타임을 가장 많이 줄이는 건 무엇이라고 보나요?", "디자인팀 고정 슬롯은 디자인팀과 합의됐나요?"],
        "change_from_previous": "측정 지표(월 제작 건수, 리드타임)를 추가했습니다.",
        "criteria_check": [{"criterion": "결론부터 쓴다", "met": true, "note": "첫 줄에 개선안을 밝혔습니다."},
                           {"criterion": "대안 비교", "met": false, "note": "다른 개선 방법과 비교가 없습니다."}]
      }$j$::jsonb, '[]'::jsonb, m_choi, now() - interval '1 day');
    -- 김도현 기획서 v1 · v2 의 AI 검토 (버전마다 검토가 쌓이는 흐름)
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
    select T, 'review', m_kim, 'submission_versions', sv.id, 'draft', 'leader', 'L1', 1, x.c::jsonb, '[]'::jsonb, m_kim, sv.created_at + interval '5 minutes'
    from submission_versions sv join submissions s on s.id = sv.submission_id
    join (values
      (1, $j${
        "depth_score": 2.0,
        "summary": "타깃과 시장 규모는 잡았지만, 정가 런칭을 택한 이유가 '프리미엄 이미지' 한 줄뿐이라 근거가 비어 있습니다. 다른 프로모션 방식과 비교하지 않았고 채널·일정 등 실행 부분이 아직 없습니다.",
        "brief": {"tone": "risk", "text": "김도현 님이 올린 '하반기 신제품 런칭 캠페인 기획서'는 근거가 비어 보입니다", "why": "정가 런칭 이유가 '프리미엄 이미지' 한 줄뿐"},
        "decisions": [],
        "strengths": [{"section": "1. 시장·고객", "text": "타깃과 시장 규모·성장률을 숫자로 먼저 밝혔습니다."}],
        "gaps": [{"section": "2. 프로모션", "text": "정가 런칭이 인지도가 낮은 지금 맞는지, 할인과 비교한 근거가 없습니다."},
                 {"section": "전체", "text": "채널·일정 등 실행 계획이 빠져 있어 초안 단계입니다."}],
        "questions": ["인지도가 낮은 상태에서 정가 런칭이 초기 전환을 막지 않을까요?", "경쟁사들은 런칭 때 어떻게 했나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      (2, $j${
        "depth_score": 2.0,
        "summary": "채널 계획과 경쟁사 수가 추가돼 분량은 늘었지만, v1에서 비었던 정가 런칭의 근거는 '조사 결과 반영 예정'으로 미뤄져 고민의 깊이는 그대로입니다.",
        "brief": {"tone": "watch", "text": "김도현 님이 올린 '하반기 신제품 런칭 캠페인 기획서'는 고민의 깊이가 그대로로 보입니다", "why": "채널 계획은 늘었지만 정가 근거는 '반영 예정'"},
        "decisions": [],
        "strengths": [{"section": "3. 채널 계획", "text": "사전 예약 페이지까지 이어지는 채널 흐름을 새로 잡았습니다."}],
        "gaps": [{"section": "2. 프로모션", "text": "핵심 판단(정가 런칭)의 근거가 아직 '예정'으로 남아 있습니다."}],
        "questions": ["브랜드 인지도 조사는 언제 나오고, 결과에 따라 프로모션이 바뀔 수 있나요?"],
        "change_from_previous": "채널 계획(유튜브·인스타그램, 사전 예약 페이지)과 경쟁사 수를 추가했습니다.", "trend_note": "", "criteria_check": []
      }$j$)
    ) as x(ver, c) on sv.version = x.ver
    where s.team_id = T and s.title = '하반기 신제품 런칭 캠페인 기획서';
    select id into o1 from one_on_ones where team_id = T and member_id = m_kim and status = 'scheduled' order by scheduled_at limit 1;
    if o1 is not null then
      insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
      values (T, 'one_on_one_prep', m_kim, 'one_on_ones', o1, 'draft', 'leader', 'L2', 2, $j${
        "last_time": "런칭 프로모션을 얼리버드 할인 중심으로 바꾸는 방향에 합의했고, 2번 가설은 고객 FGI로 검증하기로 했습니다.",
        "since": [{"text": "기획서 v3 제출 — 얼리버드 할인으로 전면 수정"}, {"text": "판단 깊이 2.0 → 3.0으로 상승"}],
        "open_promises": [{"owner": "팀장", "text": "경쟁사 캠페인 분석 리포트 공유", "overdue": true}, {"owner": "팀원", "text": "FGI 설계안 초안", "overdue": false}],
        "recent_work": "기획서 v3에서 대안 비교와 가설별 검증 계획이 뚜렷해졌습니다.",
        "watch": "판단 깊이가 눈에 띄게 올랐습니다. 지금 인정하고, FGI 일정이 B사 데이터 지연과 겹치지 않는지 확인하세요.",
        "questions": ["얼리버드 할인을 결정한 가장 결정적인 근거는 무엇이었나요?", "FGI에서 꼭 확인하고 싶은 것 하나만 꼽는다면?", "제가 먼저 풀어 줘야 할 막힘이 있나요?"]
      }$j$::jsonb, '[]'::jsonb, L, now() - interval '2 hours');
    end if;
  exception when others then null;
  end;

  -- 팀원관리: 이번 주 AI 액션 추천 + 팀원별 업무 판단
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'people_actions', 'draft', 'leader', 'L2', 2, $2, '[]'::jsonb, $3, now() - interval '30 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, jsonb_build_object(
      'summary', '이번 주는 이정규 님 1:1과 정우성 님 막힘 해소가 먼저이고, 김도현 님은 지금 인정할 타이밍입니다.',
      'actions', jsonb_build_array(
        jsonb_build_object('user_id', m_lee, 'type', 'one_on_one', 'urgency', 3, 'title', '이정규 님과 1:1 — 이번 주 안에',
          'why', '컨디션이 3주 연속 떨어졌고(4 → 3 → 2) 마지막 1:1이 3주 전입니다.', 'opener', '요즘 일하면서 에너지가 가장 떨어지는 순간이 언제예요?'),
        jsonb_build_object('user_id', m_jung, 'type', 'support', 'urgency', 3, 'title', '정우성 님 챙기기 — 어려운 점 들어 주기',
          'why', '2주째 같은 막힘이 체크인에 반복돼 지쳐 있을 수 있습니다.', 'request', '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 제가 도울 수 있는 건 같이 할게요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'praise', 'urgency', 2, 'title', '김도현 님께 칭찬 배지',
          'why', '최근 결과물의 판단 깊이가 꾸준히 올랐고(2.0 → 3.0), 대안을 비교하고 근거를 남기는 방식이 자리 잡았습니다.', 'message', '요즘 결과물마다 대안을 따져 보고 근거를 남기는 게 보여서 든든해요. 고마워요!'),
        jsonb_build_object('user_id', m_han, 'type', 'observe', 'urgency', 2, 'title', '한수진 님 관찰 기록 남기기',
          'why', '입사 6주 차로 평가 근거가 기준에 못 미칩니다. 이번 주 일하는 모습을 보고 한 줄 남겨 두세요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'develop', 'urgency', 1, 'title', '김도현 님께 더 큰 역할 제안하기',
          'why', '판단 깊이가 꾸준히 올라 다음 단계 역할을 이야기할 시점입니다.', 'request', '다음 분기에는 더 넓은 범위를 직접 리드해 보면 좋겠어요. 어떤 걸 맡아 보고 싶은지 이야기해 봐요.'),
        jsonb_build_object('user_id', m_choi, 'type', 'push', 'urgency', 1, 'title', '최민아 님과 진행 공유 리듬 맞추기',
          'why', '결과물이 리뷰 단계에 머물러 있고 최근 진행 공유 간격이 길어졌습니다.', 'request', '이번 주부터 금요일마다 진행 상황을 한 줄로 공유해 줄래요? 막히는 게 있으면 같이 봐요.'),
        jsonb_build_object('user_id', m_park, 'type', 'praise', 'urgency', 1, 'title', '박서연 님께 꾸준함 인정하기',
          'why', '정기 업무를 빠짐없이 운영하고 결과물이 대부분 한 번에 통과했습니다.', 'message', '매달 빠짐없이 챙겨 주는 꾸준함 덕분에 팀이 숫자를 믿고 움직여요. 고마워요!')),
      'members', jsonb_build_array(
        jsonb_build_object('user_id', m_kim, 'work_status', 'good', 'work_view', '런칭 기획이 계획보다 조금 늦지만 결과물 품질이 뚜렷이 올랐습니다. 핵심 과제를 안정적으로 끌고 갑니다.', 'flight_risk', 'low', 'flight_note', '컨디션이 안정적이고 1:1이 꾸준합니다.'),
        jsonb_build_object('user_id', m_park, 'work_status', 'good', 'work_view', '정기 리포트를 빠짐없이 운영하고 결과물도 한 번에 통과하는 편입니다. 다만 업무가 겹쳐 시간이 빠듯합니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_choi, 'work_status', 'good', 'work_view', '프로세스 개선이 계획대로 가고, 개선안에 측정 지표를 붙이는 등 결과물이 나아지고 있습니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_jung, 'work_status', 'support', 'work_view', '제안서가 외부 데이터 막힘으로 계획보다 크게 늦고, 보고 체계 정비도 진척이 더딥니다. 본인 역량보다 외부 의존이 원인입니다.', 'flight_risk', 'medium', 'flight_note', '같은 막힘이 2주째 반복되고 일이 몰려 있습니다.'),
        jsonb_build_object('user_id', m_lee, 'work_status', 'watch', 'work_view', 'CRM 연계 과제가 계획보다 조금 늦지만 큰 이탈은 없습니다. 혼자 맡은 과제라 방향 확인이 필요합니다.', 'flight_risk', 'high', 'flight_note', '컨디션 3주 연속 하락과 1:1 공백이 겹칩니다.'),
        jsonb_build_object('user_id', m_han, 'work_status', 'good', 'work_view', 'FGI 준비를 일정대로 진행 중이나 아직 올린 결과물이 적어 판단 근거가 얇습니다.', 'flight_risk', 'low', 'flight_note', '신규 입사자로 적응 중입니다.'))
    ), L;
  exception when others then null;
  end;

  -- A·Team의 제안: 이번 주 + 지난주(회고용) + 지난주 제안 상태 + 팀장 셀프 체크
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 2, $2, '[]'::jsonb, $3, now() - interval '7 days 20 minutes', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date - 1)$q$
    using T, $j${"headline": "실행은 순항하지만 사람 관리의 리듬이 느슨해지고 있습니다 — 1:1과 기준 공유로 다시 조이는 주입니다.", "focus": "제휴 목표 — 고객사 데이터 수급이 공식 경로로 요청되지 않았습니다.", "levers": {"exec": {"state": "watch", "note": "제휴 과제가 2주째 같은 막힘입니다."}, "staffing": {"state": "good", "note": "부하는 고른 편입니다."}, "people": {"state": "act", "note": "1:1 간격이 평균 19일로 벌어졌습니다."}, "external": {"state": "watch", "note": "데이터 수급이 비공식 경로에만 의존합니다."}, "self": {"state": "good", "note": "특이 신호 없음."}, "system": {"state": "watch", "note": "결과물 보완점이 같은 주제로 반복됩니다."}}, "advice": [{"id": "a1", "lever": "people", "urgency": 3, "effort": "low", "title": "1:1 간격을 2주 이내로 되돌리세요", "why": "1:1 평균 간격이 19일로 벌어졌습니다.", "effect": "막힘을 일찍 듣게 됩니다.", "if_not": "컨디션 하락을 늦게 알게 됩니다.", "route": "one_on_one", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "system", "urgency": 2, "effort": "mid", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "why": "보완점이 같은 주제로 반복됩니다.", "effect": "수정 횟수가 줄어듭니다.", "if_not": "리뷰 시간이 계속 늘어납니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a3", "lever": "external", "urgency": 2, "effort": "low", "title": "제휴 데이터 수급을 영업본부에 공식 요청하세요", "why": "비공식 경로로 2주를 기다렸습니다.", "effect": "회신 날짜가 정해집니다.", "if_not": "막힘이 계속됩니다.", "route": "report", "target_user_id": "", "script": ""}], "review": [], "watch_next": "이정규 님 컨디션."}$j$::jsonb, L;
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 3, $2, '[]'::jsonb, $3, now() - interval '20 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, replace($j${"headline": "성과는 외부 의존 하나에 묶여 있고, 운영은 팀장 시간이 순항하는 사람 쪽으로 쏠려 있습니다 — 이번 주는 '막힌 곳으로 사람과 시간을 옮기는 주'입니다.", "focus": "제휴 목표(20만 명) — 고객사 데이터 수급이 풀리지 않으면 4분기 전망이 18.6만 명 근처에서 멈춥니다.", "levers": {"exec": {"state": "act", "note": "제휴 과제가 3주째 같은 막힘(고객사 데이터)으로 멈춰 있고, 계획에 대체 경로가 없습니다."}, "staffing": {"state": "watch", "note": "제휴 목표의 하위 일 3건이 모두 정우성 님 한 사람에게 있고, 김도현 님은 가용 시간의 70%만 쓰고 있습니다."}, "people": {"state": "watch", "note": "최근 4주 칭찬·관찰이 김도현·박서연 님에게 몰렸고, 이정규 님은 컨디션이 3주째 내려가는데 팀장 접점이 가장 적습니다."}, "external": {"state": "act", "note": "전사 비용 15% 절감 방침이 런칭 캠페인 예산과 부딪히는데, 아직 위로 방향을 확인하지 않았습니다."}, "self": {"state": "watch", "note": "리뷰 대기 6건(가장 오래 5일)과 검토 중 결정 3건이 겹쳐 있고, 최근 2주 앱 활동의 31%가 밤 10시 이후·주말입니다."}, "system": {"state": "good", "note": "체크인 제출 5/6명으로 주간 리듬은 유지됩니다. 다만 결과물 보완점이 '근거·데이터'에 반복됩니다."}}, "advice": [{"id": "a1", "lever": "exec", "urgency": 3, "effort": "low", "title": "제휴 과제에 '대체 데이터 경로'를 이번 주 안에 계획으로 넣으세요 — 고객사 데이터를 기다리는 동안 공개 데이터와 파일럿 고객 2곳으로 1차안을 만들게 하세요.", "why": "같은 막힘이 3주째 체크인에 반복되고, 제휴 목표 달성 가능성이 12%까지 내려왔습니다.", "effect": "데이터 회신이 늦어져도 11월 첫 주에 1차 제안이 가능해지고, 목표 전망의 바닥이 올라갑니다.", "if_not": "회신이 2주 더 밀리면 4분기 제휴 목표는 조정이 불가피합니다.", "route": "decide", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "staffing", "urgency": 2, "effort": "mid", "title": "제휴 과제의 '데이터 정리' 1건을 김도현 님에게 옮겨 정우성 님 한 사람 의존을 푸세요.", "why": "제휴 하위 일 3건이 한 사람에게 몰려 있고(주 46시간/가용 40시간), 김도현 님은 여유가 있습니다.", "effect": "정우성 님은 파트너 협상에 집중하고, 막힘이 한 곳에서 전체로 번지는 걸 막습니다.", "if_not": "정우성 님 과부하가 이어지면 이탈 주의 신호가 '높음'으로 올라갈 수 있습니다.", "route": "request", "target_user_id": "{{KIM}}", "script": "도현 님, 제휴 제안서의 데이터 정리 파트를 이번 주부터 맡아 줄 수 있을까요? 우성 님이 파트너 협상에 집중할 수 있게 하려는 거예요. 필요한 시간은 같이 조정할게요."}, {"id": "a3", "lever": "external", "urgency": 3, "effort": "low", "title": "비용 절감 방침과 런칭 예산의 충돌을 이번 주 본부장 보고에 먼저 올리세요 — 결정권은 위에 있습니다.", "why": "전사 방침(비용 15% 절감)이 런칭 캠페인 광고 집행과 부딪히는데, 팀 안에서 결론을 내기 어려운 사안입니다.", "effect": "예산 축소 범위가 일찍 정해지면 4분기 실행계획 초안을 다시 쓰지 않아도 됩니다.", "if_not": "실행계획 확정 직전에 예산이 깎이면 런칭 일정 전체가 밀립니다.", "route": "report", "target_user_id": "", "script": "전사 비용 15% 절감 방침에 맞춰 런칭 캠페인 광고 예산을 CAC 기준으로 재배분하려 합니다. 다만 제휴 목표(20만 명)에 필요한 최소 예산은 유지가 필요해, 이번 주 안에 방향 확인 부탁드립니다."}, {"id": "a4", "lever": "self", "urgency": 2, "effort": "low", "title": "리뷰 대기 6건 중 정기 보고 2건은 박서연 님에게 1차 리뷰를 맡기고, 아낀 시간을 이정규·정우성 님에게 쓰세요.", "why": "최근 4주 팀장 접점의 48%가 김도현·박서연 님 두 사람에게 갔고, 필요도가 높은 이정규 님은 팀 평균의 0.6배입니다.", "effect": "리뷰 적체가 절반으로 줄고, 이탈 주의 두 사람에게 이번 주 1:1 시간이 생깁니다.", "if_not": "적체와 늦은 시간 작업이 이어지면 결정이 더 미뤄지는 악순환이 됩니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a5", "lever": "people", "urgency": 1, "effort": "low", "title": "이번 주 금요일 점심을 '런칭 준비 중간 점검 + 김도현 님 기획서 통과 축하' 자리로 잡으세요.", "why": "팀 컨디션이 3.6으로 내려가는 중이고, 인정이 일부에게만 보이는 상태입니다.", "effect": "짧고 부담 없는 자리로 팀 전체가 진척을 함께 보고, 인정이 팀 전체의 이야기가 됩니다.", "if_not": "막힌 사람과 순항하는 사람 사이의 온도 차가 커집니다.", "route": "calendar", "target_user_id": "", "script": "금요일 점심은 다 같이 먹어요 — 런칭 준비 중간 점검 겸, 도현 님 기획서 통과도 축하해요."}], "review": [{"id": "a1", "title": "1:1 간격을 2주 이내로 되돌리세요", "verdict": "partial", "observed": "정우성·한수진 님과는 1:1을 했지만, 이정규 님은 아직 3주째 1:1이 없습니다."}, {"id": "a2", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "verdict": "not_done", "observed": "기준 카드가 공개되지 않았고, 이번 주에도 보완점 2건이 '근거·데이터'였습니다."}, {"id": "a3", "title": "제휴 데이터 수급을 영업본부에 공식 요청하세요", "verdict": "done", "observed": "영업본부 요청이 기록됐고, 파트너사 회신은 '11월 둘째 주 이후 가능'으로 왔습니다."}], "watch_next": "고객사 데이터 회신 날짜와 이정규 님 다음 체크인의 컨디션."}$j$, '{{KIM}}', m_kim::text)::jsonb, L;
    execute $q$insert into public.advice_status (team_id, advice_key, status, updated_by) values
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a1', 'adopted', $2),
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a2', 'held', $2),
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a3', 'done', $2) on conflict do nothing$q$ using T, L;
    execute $q$insert into public.leader_selfcheck (team_id, user_id, week_start, energy, burden, note) values
      ($1, $2, date_trunc('week', current_date)::date - 14, 4, 3, ''),
      ($1, $2, date_trunc('week', current_date)::date - 7, 3, 4, '런칭·제휴가 겹쳐 리뷰가 밀림') on conflict do nothing$q$ using T, L;
  exception when others then null;
  end;

  -- 상향 관리: 상위 관리자 2명 + 위에서 온 것 연결 + 임원 브리핑
  declare e1 uuid; e2 uuid;
  begin
    execute $q$insert into public.executives (team_id, name, title, style_tags, interests, prefs, sort) values ($1, '김정훈', '마케팅본부장', array['숫자·근거 중시','결론 먼저','비용·효율'],
      '제휴 채널 성과와 CAC 개선 속도. 지난달 대비 숫자로 물음', '월요일 본부 주간회의 · 1페이지 · 결론 먼저', 0) returning id$q$ into e1 using T;
    execute $q$insert into public.executives (team_id, name, title, style_tags, interests, prefs, sort) values ($1, '이수경', '전략기획 상무', array['리스크 민감','고객 관점','디테일 확인'],
      '4분기 실행계획의 리스크와 대안, 런칭 일정', '격주 · 이슈 중심 · 대안 2개 이상', 1) returning id$q$ into e2 using T;
    execute $q$update public.org_notes set exec_id = $2 where team_id = $1 and kind = 'exec'$q$ using T, e1;
    execute $q$update public.org_notes set exec_id = $2 where team_id = $1 and kind = 'request'$q$ using T, e2;
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'exec_brief', 'draft', 'leader', 'L3', 3, $2, '[]'::jsonb, $3, now() - interval '40 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, replace(replace(replace($j${"headline": "위에서 보면 우리 팀은 '런칭은 순항, 제휴는 숫자가 안 보이는 팀'입니다 — 이번 주 질문은 제휴 채널과 CAC에 몰릴 가능성이 큽니다.", "execs": [{"exec_id": "{{E1}}", "name": "김정훈", "lens": "비용 15% 절감 방침 아래에서 '제휴 채널이 CAC를 낮추는 근거가 숫자로 보이는가'", "opener": "제휴 채널은 아직 목표 대비 56%지만, CAC는 1.1만 원으로 채널 중 가장 낮습니다 — 남은 변수는 B사 데이터 하나입니다.", "questions": [{"q": "제휴 신규 고객이 언제 숫자로 보이나?", "why": "주간회의에서 두 번 연속 물었고, 현재 누적 11.2만 명으로 목표 20만 명의 56%입니다.", "prep": "기준 전망 18.6만 명(93%) · B사 데이터가 11월 둘째 주 이후 → 대체 경로(공개 데이터·파일럿 2곳)로 11월 첫 주 1차 제안 가능"}, {"q": "채널별 CAC 비교표는 준비됐나?", "why": "지난 회의에서 다음 보고에 넣어 달라고 요청했습니다.", "prep": "10월 광고 성과 리포트 기준 유튜브 3.2만 · 인스타그램 2.6만 · 제휴 1.1만 원 — 박서연 님 리포트에서 바로 가져올 수 있음"}, {"q": "비용 15% 절감은 어디서 줄이나?", "why": "전사 방침의 첫 대상이 광고 집행입니다.", "prep": "유튜브 예산 20%를 제휴로 이동하는 안 (10월 리포트 제안) — 런칭 사전 예약 전환율 18%는 유지"}], "challenges": [{"point": "제휴 목표 달성 가능성 12%", "why": "같은 막힘이 3주째 반복되고 계획에 대체 경로가 없습니다.", "prep": "인정: 외부 데이터 의존을 늦게 다뤘다. 대안: 대체 데이터 경로를 이번 주 계획에 넣고, 목표 조정 여부를 11월 첫 주에 판단"}, {"point": "보고 체계 정비가 계속 밀림", "why": "계획 변경 2회, 진척 정체.", "prep": "범위를 대시보드 1차 화면으로 줄이고 나머지는 1월로"}]}, {"exec_id": "{{E2}}", "name": "이수경", "lens": "4분기 실행계획이 '최악의 경우'까지 대비돼 있는가", "opener": "실행계획 초안은 제휴 데이터 지연을 가장 큰 리스크로 두고, 대체 경로까지 넣어 6일 뒤 제출하겠습니다.", "questions": [{"q": "실행계획 초안은 기한(D-6) 안에 나오나?", "why": "경영기획팀 요청 기한이 다가옵니다.", "prep": "초안 골격 완료 · 채널별 CAC 목표만 남음 — 금요일 내부 리뷰 후 제출"}, {"q": "B사 데이터가 안 들어오면 어떻게 되나?", "why": "리스크 중심으로 보는 분이고 외부 의존이 가장 큰 변수입니다.", "prep": "최악: 4분기 제휴 목표 약 18만 명에서 멈춤 → 대체 채널 2곳으로 1.4만 명 보완안"}], "challenges": [{"point": "런칭과 제휴가 같은 사람·같은 시기에 겹침", "why": "제휴 하위 과제 3건이 한 사람에게 몰려 있습니다.", "prep": "데이터 정리 1건을 김도현 님에게 옮기는 재배분 계획을 함께 보고"}]}], "requests": [{"note_id": "", "title": "본부 4분기 마케팅 실행계획 초안 제출", "due": "{{D6}}", "status": "진행 중", "reply": "4분기 실행계획 초안은 비용 15% 절감과 채널별 CAC 목표를 반영해 기한 안에 제출하겠습니다. 제휴 데이터 지연에 대비한 대체 경로도 함께 넣었습니다."}, {"note_id": "", "title": "채널별 CAC 비교표를 다음 보고에 추가", "due": "", "status": "미답", "reply": "채널별 CAC는 유튜브 3.2만 · 인스타그램 2.6만 · 제휴 1.1만 원입니다. 다음 주간회의에 비교표로 정리해 가겠습니다."}], "share_first": [{"title": "B사 데이터는 11월 둘째 주 이후 — 제휴 목표 일정에 영향", "why": "다른 경로로 들으면 '왜 미리 말 안 했나'가 됩니다.", "tone": "bad"}, {"title": "런칭 사전 예약 1,840명 · 전환율 18%", "why": "본부장 관심사(효율)에 바로 답이 되는 좋은 숫자입니다.", "tone": "good"}], "watch": "B사 회신 날짜, 실행계획 제출 후 예산 배분 결정."}$j$, '{{E1}}', e1::text), '{{E2}}', e2::text), '{{D6}}', (current_date + 6)::text)::jsonb, L;
  exception when others then null;
  end;

  -- 팀원 평가: 김도현 님 예상 등급(시뮬레이션) + 의견 초안
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, subject_user_id, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'evaluation_draft', $2, 'draft', 'leader', 'L3', 3, $3, '[]'::jsonb, $4, now() - interval '1 day',
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 7 else 1 end, 1),
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 12 else 6 end, case when extract(month from current_date) >= 7 then 31 else 30 end))$q$
    using T, m_kim, $j${"grade": {"expected": "A", "range": ["B", "A"], "confidence": "medium", "rationale": "핵심 과제(신제품 런칭 기획)를 끌고 가면서 결과물의 판단 깊이가 2.0에서 3.0으로 뚜렷이 올랐고, 결과물 대부분이 한 번에 승인됐습니다. 다만 런칭 일정은 계획보다 조금 늦습니다.", "up": [{"text": "가격 전략을 데이터로 스스로 뒤집고, 버린 대안과 이유를 남김 (기획서 v3)", "evidence": []}, {"text": "결과물 8건 중 6건 승인, 그중 4건이 한 번에 통과", "evidence": []}, {"text": "본부장 질의에 근거를 들어 답함 (1:1 기록)", "evidence": []}], "down": [{"text": "시장 분석처럼 정형 업무에서는 자기 관점이 약하다는 보완점이 두 번 반복", "evidence": []}], "missing": "실행 관리(일정 준수) 근거가 아직 적어 A로 확정하기는 이릅니다. 11월 런칭 결과를 보면 확실해집니다."}, "overall": "문제를 끝까지 붙들고 방향을 다시 잡는 힘이 이번 기간 가장 두드러졌습니다. 신제품 가격 전략에서 처음 가정을 데이터로 뒤집고 대안을 비교해 남긴 과정이 대표적입니다. 결과물의 판단 깊이가 꾸준히 올라 팀의 핵심 과제를 맡길 수 있는 수준입니다. 다만 정해진 틀을 채우는 작업에서는 자기 관점이 덜 드러납니다.", "strengths": [{"title": "근거 기반의 방향 전환", "detail": "초기 가정을 고집하지 않고 데이터를 보고 전략을 고쳤습니다.", "evidence": []}, {"title": "결과물 품질의 꾸준한 상승", "detail": "판단 깊이 2.0 → 3.0, 대부분 한 번에 승인됐습니다.", "evidence": []}], "growth": [{"title": "정형 업무에서의 자기 관점", "detail": "시장 분석 등에서 일반적 정리에 머무는 경우가 있습니다.", "evidence": []}, {"title": "일정 관리", "detail": "런칭 기획이 계획보다 조금 늦습니다.", "evidence": []}], "competencies": [{"name": "문제 정의", "signal": "강함", "evidence": []}, {"name": "데이터 분석", "signal": "보통", "evidence": []}, {"name": "커뮤니케이션", "signal": "강함", "evidence": []}, {"name": "실행 관리", "signal": "근거 부족", "evidence": []}], "coaching": "다음 기간에는 일정이 분명한 과제를 맡기고 2주 단위로 진척을 함께 점검해 실행 관리 근거를 쌓으세요."}$j$::jsonb, L;
  exception when others then null;
  end;

  -- 업무플랫폼: 최근에 올라온 다양한 업무 (컨펌·의견·공유 / 보고서·링크·캡처·메모·숫자)
  declare r record; sid uuid;
  begin
    for r in select * from (values
      (m_jung, t3, '제휴 제안서 — B사 제외 2개사 안, 의견 부탁드려요', 'note', 'feedback', null::text, E'B사 데이터가 이번 달 안에 들어오기 어려워 보여서, A사·C사 두 곳으로 범위를 줄인 안을 만들었습니다. 목표 영향은 약 -1.4만 명으로 봅니다. 이 방향으로 가도 될지 의견 부탁드려요.', 2),
      (m_jung, t3, 'B사 데이터 수급 지연 현황 (메일 캡처)', 'image', 'share', null, '파트너사 회신 메일 캡처 — 11월 둘째 주 이후 가능', 1),
      (m_park, t7, '10월 광고 성과 리포트', 'document', 'approval', null, E'10월 광고 성과 리포트\n1. 채널별 CAC: 유튜브 3.2만 원, 인스타그램 2.6만 원, 제휴 1.1만 원\n2. 런칭 사전 예약 전환율 18%\n3. 11월 제안: 유튜브 예산 20% 제휴로 이동', 0),
      (m_park, t7, '광고 성과 대시보드 개편 1차 화면', 'link', 'share', 'https://example.com/dashboard-v1', '요청하신 1차 배포 화면 링크입니다', 3),
      (m_lee, t4, 'CRM 웰컴 메시지 A/B안', 'document', 'feedback', null, E'A안: 혜택 중심 (첫 구매 15%)\nB안: 브랜드 스토리 중심\n제휴 유입 고객 대상, 2주 테스트 예정. 어느 쪽이 나을지 의견 주세요.', 1),
      (m_han, t1, 'FGI 1차 4명 결과 메모', 'note', 'share', null, E'4명 중 3명이 얼리버드 할인에 긍정적. 3040 직장인 2명은 가격보다 배송 속도를 더 중요하게 봄.', 4),
      (m_choi, t5, '11월 콘텐츠 캘린더', 'link', 'feedback', 'https://example.com/content-calendar-11', '런칭 주간에 콘텐츠를 몰았는데 괜찮을지 봐 주세요', 2),
      (m_kim, t1, '런칭 사전 예약 누적 수', 'number', 'share', null, '사전 예약 누적', 0)
    ) as x(author, item, title, kind, rtype, link, body, ago) loop
      insert into submissions (team_id, author_id, item_id, title, kind, request_type, link_url, created_at)
        values (T, r.author, r.item, r.title, r.kind, r.rtype, r.link, now() - (r.ago || ' days')::interval - interval '3 hours') returning id into sid;
      insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at, value)
        values (sid, T, 1, r.body, '', r.author, now() - (r.ago || ' days')::interval - interval '3 hours', case when r.kind = 'number' then 1840 else null end);
    end loop;
    -- 리뷰 대기 결과물의 AI 1차 검토 (업무플랫폼 Core Insight 한 줄 포함)
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
    select T, 'review', s.author_id, 'submission_versions', v.id, 'draft', 'leader', 'L1', 1, x.c::jsonb, '[]'::jsonb, s.author_id, now() - interval '2 hours'
    from (values
      ('제휴 제안서 — B사 제외 2개사 안, 의견 부탁드려요', $j${
        "depth_score": 1.5,
        "summary": "B사 데이터 지연이라는 문제는 분명히 짚었지만, 범위를 줄이는 것 말고 다른 길(파일럿·공개 데이터)을 비교하지 않았고 A사·C사를 고른 근거도 없습니다. 목표 영향 -1.4만 명이 어떻게 나왔는지도 빠져 있습니다.",
        "brief": {"tone": "risk", "text": "정우성 님이 올린 '제휴 제안서 — B사 제외 2개사 안'은 고민의 깊이가 낮아 보입니다", "why": "범위만 줄이고 대안 비교·선정 근거가 없음"},
        "decisions": [],
        "strengths": [{"section": "본문", "text": "막힌 원인(B사 데이터 회신 지연)과 목표 영향을 먼저 밝혔습니다."}],
        "gaps": [{"section": "본문", "text": "범위 축소 외에 파일럿 고객·공개 데이터로 1차안을 만드는 길을 검토하지 않았습니다."},
                 {"section": "본문", "text": "A사·C사를 고른 이유와 -1.4만 명 추정 근거가 없습니다."}],
        "questions": ["B사를 빼지 않고 1차안을 먼저 내는 방법은 검토해 봤나요?", "-1.4만 명은 어떤 가정으로 나온 숫자인가요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      ('10월 광고 성과 리포트', $j${
        "depth_score": 3.0,
        "summary": "채널별 CAC를 나란히 놓고 제휴 채널이 가장 효율적이라는 결론까지 짧고 분명하게 전달합니다. 승인 요청이라 팀장님이 정할 것이 있습니다 — 유튜브 예산 20% 이동은 런칭 주간 노출과 맞물려 있어 판단이 필요합니다.",
        "brief": {"tone": "risk", "text": "박서연 님이 요청한 '10월 광고 성과 리포트'에 팀장님이 결정할 사항이 있습니다", "why": "11월 유튜브 예산 20%를 제휴로 옮길지"},
        "decisions": ["11월 유튜브 예산 20% → 제휴 이동", "런칭 주간 유튜브 예산 예외 여부"],
        "strengths": [{"section": "1. 채널별 CAC", "text": "세 채널 CAC를 같은 기준으로 비교해 결론이 바로 보입니다."}],
        "gaps": [{"section": "3. 11월 제안", "text": "예산 이동이 런칭 사전 예약(유튜브 유입)에 주는 영향 추정이 없습니다."}],
        "questions": ["런칭 주간에도 유튜브 예산을 20% 줄이나요?", "제휴 채널 CAC 1.1만 원은 B사 지연 이후에도 유지되나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      ('CRM 웰컴 메시지 A/B안', $j${
        "depth_score": 2.5,
        "summary": "두 안의 방향(혜택 vs 브랜드)과 테스트 기간은 정리됐지만, 본인은 어느 안을 권하는지와 무엇으로 승부를 볼지(재방문율·구매 전환) 기준이 없어 결론이 잘 보이지 않습니다.",
        "brief": {"tone": "watch", "text": "이정규 님이 올린 'CRM 웰컴 메시지 A/B안'은 결론이 잘 안 보입니다", "why": "어느 안을 권하는지·판단 기준이 없음"},
        "decisions": [],
        "strengths": [{"section": "본문", "text": "대상(제휴 유입 고객)과 테스트 기간을 분명히 했습니다."}],
        "gaps": [{"section": "본문", "text": "성공 지표와 본인 추천안이 빠져 있어 의견을 주기 어렵습니다."}],
        "questions": ["둘 중 어느 쪽이 나을 거라고 보나요, 이유는?", "2주 뒤 무엇을 보고 승자를 정하나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$)
    ) as x(title, c)
    join submissions s on s.team_id = T and s.title = x.title
    join submission_versions v on v.submission_id = s.id and v.version = 1;
    -- 최민아 11월 콘텐츠 캘린더: 보완 요청 (팀원 홈 '지금 할 일'에 뜬다)
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
    select s.id, v.id, T, L, '런칭 주간에 몰린 건 좋은데, 그 주 디자인팀 슬롯이 이미 찼어요. 2편은 앞 주로 당기고, 일정이랑 담당까지 표로 다시 올려 주세요.', now() - interval '20 hours'
    from submissions s join submission_versions v on v.submission_id = s.id where s.team_id = T and s.title = '11월 콘텐츠 캘린더';
    update submissions set status = 'needs_work' where team_id = T and title = '11월 콘텐츠 캘린더';
  exception when others then null;
  end;
end $fn$;
revoke all on function public.seed_demo_team(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.seed_demo_team(uuid, uuid, uuid[]) to service_role;

-- =====================================================================
-- 홈 개편 ④ 조직·전사: '위에서 온 것' 메모 + AI 영향 분석
--   · org_notes — 전략·방향 변경 / 임원 관심사 / 상위 요청 / 유관 부서 / 전사 일정 (팀장만 보고 씀)
--   · ai_kind 'org_impact' — 메모를 팀 목표·과제와 맞춰 본 영향 분석 (코어 AI)
-- =====================================================================
alter type public.ai_kind add value if not exists 'org_impact';

create table if not exists public.org_notes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null default auth.uid(),
  kind        text not null default 'other' check (kind in ('strategy', 'exec', 'request', 'peer', 'calendar', 'other')),
  title       text not null,
  body        text not null default '',
  source      text not null default '',        -- 어디서 들었는지 (예: 본부장 주간회의)
  event_date  date,                             -- 일정·기한 (전사 일정, 상위 요청 마감)
  status      text not null default 'open' check (status in ('open', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists org_notes_team_idx on public.org_notes (team_id, status, created_at desc);

alter table public.org_notes enable row level security;
drop policy if exists org_notes_leader on public.org_notes;
create policy org_notes_leader on public.org_notes for all to authenticated
  using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));

create or replace function public.touch_org_note() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists org_notes_touch on public.org_notes;
create trigger org_notes_touch before update on public.org_notes for each row execute function public.touch_org_note();

-- 예약 AI 인사이트 대상 팀: 활동 기록(events)뿐 아니라 목표·진척·요청·위에서 온 것·결과물 활동이 최근 14일에 있으면 포함
create or replace function public.active_ai_teams() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from teams t
  where public.team_has_feature(t.id, 'ai_core')
    and (not t.is_demo or t.created_at > now() - interval '14 days')
    and (
      exists (select 1 from events e where e.team_id = t.id and e.created_at > now() - interval '14 days')
      or exists (select 1 from work_items w where w.team_id = t.id and w.updated_at > now() - interval '14 days')
      or exists (select 1 from work_item_logs l where l.team_id = t.id and l.created_at > now() - interval '14 days')
      or exists (select 1 from team_requests r where r.team_id = t.id and r.created_at > now() - interval '14 days')
      or exists (select 1 from org_notes o where o.team_id = t.id and o.updated_at > now() - interval '14 days')
      or exists (select 1 from submissions s where s.team_id = t.id and s.updated_at > now() - interval '14 days')
    );
$$;
revoke all on function public.active_ai_teams() from public, anon, authenticated;

-- =====================================================================
-- 요청 종류 추가 — 팀원 상세 액션과 맞추기
--   · grow  (성장 제안)  ← [육성]      다음에 맡아 볼 역할·성장 과제를 같이 정하자는 제안
--   · cheer (격려)       ← [지원·격려]  들어 주고 돕겠다는 말. 평가 근거로 남기지 않음
--   ([업무 독려]는 기존 progress(진척 공유)를 씀)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.team_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.team_requests drop constraint %I', c);
  end loop;
end $$;
alter table public.team_requests add constraint team_requests_kind_check
  check (kind in ('plan', 'progress', 'share', 'meeting', 'other', 'grow', 'cheer'));

-- 요청 완료 → 평가 근거. 격려(cheer)는 '확인'일 뿐이라 남기지 않는다
create or replace function public.trg_request_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_late int;
begin
  if new.kind = 'cheer' then return new; end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    v_late := case when new.due_date is null then null else (coalesce(new.responded_at, now())::date - new.due_date) end;
    perform public.upsert_evidence(new.team_id, new.to_id, 'task', new.id,
      case when new.kind = 'grow' then '성장 제안 답 — ' else '요청 완료 — ' end || new.title
        || case when v_late is null then '' when v_late <= 0 then ' (기한 내)' else ' (' || v_late || '일 늦음)' end
        || case when coalesce(new.response, '') <> '' then ' · 답: ' || left(new.response, 120) else '' end,
      case when v_late is not null and v_late <= 0 then 'positive'::public.polarity else 'neutral'::public.polarity end,
      null, coalesce(new.responded_at, now()));
  end if;
  return new;
end $$;

-- 알림 문구도 종류에 맞게 (요청 / 성장 제안 / 팀장님 격려)
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case new.kind when 'grow' then '성장 제안: ' when 'cheer' then '팀장님 격려: ' else '요청: ' end || new.title, left(new.body, 120), '/');
    if new.kind = 'plan' and new.item_id is not null then
      update work_items set needs_plan = true where id = new.item_id;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case new.kind when 'grow' then '성장 제안 답: ' when 'cheer' then '격려 확인: ' else '완료: ' end || new.title, left(new.response, 120), '/');
  end if;
  return new;
end $$;

-- =====================================================================
-- 팀원 앱 정비
--   · 팀원이 받은 칭찬 배지를 다시 볼 수 있게 (자기 것 · 칭찬만 읽기)
--   · 팀원 → 팀장 '1:1 요청' (team_requests kind=meeting) — 팀장 알림이 팀원 상세로 이어지고, 팀장에게 평가 근거가 쌓이지 않게
--   · AI 체크인 초안 (ai_kind 'checkin_draft')
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter type public.ai_kind add value if not exists 'checkin_draft';

drop policy if exists obs_member_praise on public.observations;
create policy obs_member_praise on public.observations for select to authenticated
  using (subject_id = auth.uid() and kind = 'praise');

-- 알림: 요청 / 성장 제안 / 팀장님 격려 / 팀원의 1:1 요청
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_up boolean;
begin
  v_up := new.to_id = public._team_leader(new.team_id);   -- 팀원 → 팀장
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case when v_up and new.kind = 'meeting' then '1:1 요청: ' when new.kind = 'grow' then '성장 제안: ' when new.kind = 'cheer' then '팀장님 격려: ' else '요청: ' end || new.title,
      left(new.body, 120), case when v_up then '/people/' || new.from_id || '?oo=1' else '/' end);
    if new.kind = 'plan' and new.item_id is not null then
      update work_items set needs_plan = true where id = new.item_id;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case when v_up and new.kind = 'meeting' then '1:1 요청 확인: ' when new.kind = 'grow' then '성장 제안 답: ' when new.kind = 'cheer' then '격려 확인: ' else '완료: ' end || new.title,
      left(new.response, 120), case when v_up then '/my/one-on-ones' else '/' end);
  end if;
  return new;
end $$;

-- 요청 완료 → 평가 근거 (격려, 팀장이 받은 요청은 남기지 않음)
create or replace function public.trg_request_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_late int;
begin
  if new.kind = 'cheer' or new.to_id = public._team_leader(new.team_id) then return new; end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    v_late := case when new.due_date is null then null else (coalesce(new.responded_at, now())::date - new.due_date) end;
    perform public.upsert_evidence(new.team_id, new.to_id, 'task', new.id,
      case when new.kind = 'grow' then '성장 제안 답 — ' else '요청 완료 — ' end || new.title
        || case when v_late is null then '' when v_late <= 0 then ' (기한 내)' else ' (' || v_late || '일 늦음)' end
        || case when coalesce(new.response, '') <> '' then ' · 답: ' || left(new.response, 120) else '' end,
      case when v_late is not null and v_late <= 0 then 'positive'::public.polarity else 'neutral'::public.polarity end,
      null, coalesce(new.responded_at, now()));
  end if;
  return new;
end $$;

-- =====================================================================
-- 목표 수정 기간 (팀장이 열어 둘 때만 팀원이 목표·과제를 고친다)
--   · 목표·과제(1·2단계)  : 팀장이 '수정 기간'을 열어 둔 동안만 팀원이 만들고 고친다 → 팀장 승인 후 반영
--                           기간이 닫혀 있으면 진척·상태만 남기고, 바꿀 게 있으면 [변경 요청](kind 'change')
--                           (검토 대기·수정 요청 중인 제안도 기간이 닫혀 있으면 고치거나 거둘 수 없다)
--   · 할 일(3단계 이하)    : 내 과제 아래에서는 언제든 자유롭게 (승인·재계획 기록 없음)
--   · 기간: teams.settings.plan_open_until (YYYY-MM-DD, 그날까지 열림 · 한국 날짜 기준)
--   · 팀장이 '계획 세우기' 요청을 보내면 기한(없으면 2주 뒤)까지 자동으로 열린다
--   (이전 '팀원도 자유롭게 편집'(member_free_edit) 설정은 더 이상 쓰지 않는다)
-- 다시 Run 해도 안전합니다.
-- =====================================================================

-- 항목 깊이 (최상위 = 0)
create or replace function public.item_depth(p_id uuid) returns int
language sql stable security definer set search_path = public as $$
  with recursive up(id, parent_id, d) as (
    select id, parent_id, 0 from work_items where id = p_id
    union all
    select w.id, w.parent_id, up.d + 1 from work_items w join up on w.id = up.parent_id where up.d < 20
  )
  select coalesce(max(d), 0) from up;
$$;

-- 지금 팀원 수정 기간인가
create or replace function public.plan_open(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(settings->>'plan_open_until', '')::date >= (now() at time zone 'Asia/Seoul')::date
                   from teams where id = p_team), false);
$$;
grant execute on function public.item_depth(uuid), public.plan_open(uuid) to authenticated;

-- 항목 저장 전: 권한 정리 · 진척 계산 · 기준선 · 재계획 기록
create or replace function public.trg_work_item_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_leader boolean := coalesce(auth.role(), 'service') <> 'authenticated' or public.is_team_leader(new.team_id);
  v_open boolean;
  v_parent work_items;
  v_depth int;          -- 저장 후 깊이
  v_old_depth int;
  v_plan_changed boolean := false;
  v_skip_replan boolean := false;
  v_lock text := 'PLAN_LOCKED: 지금은 목표·과제 수정 기간이 아닙니다. 진척·상태만 남길 수 있어요. 바꿔야 할 게 있으면 팀장님께 변경 요청을 보내 주세요';
begin
  if new.parent_id is not null then
    select * into v_parent from work_items where id = new.parent_id;
    if v_parent.team_id <> new.team_id then raise exception '다른 팀 항목 아래에 둘 수 없습니다'; end if;
    v_depth := public.item_depth(new.parent_id) + 1;
  else
    v_depth := 0;
  end if;

  if not v_leader then
    v_open := public.plan_open(new.team_id);
    if tg_op = 'INSERT' then
      if new.owner_id is distinct from auth.uid() then raise exception '팀원은 본인 담당 항목만 만들 수 있습니다'; end if;
      new.needs_plan := false;
      if v_depth >= 2 then
        -- 할 일: 내 과제 아래라면 언제든, 승인 없이
        if v_parent.owner_id is distinct from auth.uid() then raise exception '할 일은 내 과제 아래에만 만들 수 있습니다'; end if;
        if new.status in ('proposed', 'changes_requested') then new.status := 'active'; end if;
      elsif not v_open then
        raise exception '%', v_lock;
      else
        new.status := 'proposed';                         -- 목표·과제: 팀장 승인 후 진행
      end if;
    else
      v_old_depth := case when old.parent_id is null then 0 else public.item_depth(old.parent_id) + 1 end;
      if new.owner_id is distinct from old.owner_id then raise exception '담당자는 팀장만 바꿀 수 있습니다'; end if;
      if new.parent_id is distinct from old.parent_id
         and not (v_old_depth >= 2 and v_depth >= 2 and v_parent.owner_id = auth.uid()) then
        raise exception '항목 위치는 팀장만 바꿀 수 있습니다';
      end if;
      -- 진척·상태 말고 계획 자체가 바뀌었나
      v_plan_changed := (to_jsonb(new) - array['progress', 'num_current', 'status', 'done_at', 'updated_at', 'change_reason', 'needs_plan', 'sort'])
                     is distinct from (to_jsonb(old) - array['progress', 'num_current', 'status', 'done_at', 'updated_at', 'change_reason', 'needs_plan', 'sort']);
      if v_old_depth >= 2 then
        v_skip_replan := true;                            -- 할 일은 자유: 재계획 기록 안 남김
        if new.status in ('proposed', 'changes_requested') and old.status not in ('proposed', 'changes_requested') then new.status := old.status; end if;
      else
        -- 검토 중인 제안: 기간이 닫혀 있으면 상태도 못 바꾼다(거두기 포함)
        if not v_open and old.status in ('proposed', 'changes_requested') and new.status is distinct from old.status then
          raise exception '%', v_lock;
        end if;
        -- 승인은 팀장만: 제안·수정 요청 상태에서 진행 상태로 바로 못 간다
        if old.status in ('proposed', 'changes_requested') and new.status not in ('proposed', 'changes_requested', 'dropped') then
          raise exception '팀장 승인 전에는 진행 상태로 바꿀 수 없습니다';
        end if;
        if new.status = 'dropped' and old.status not in ('proposed', 'changes_requested', 'dropped') then
          raise exception '목표·과제 중단은 팀장님께 변경 요청으로 알려 주세요';
        end if;
        if v_plan_changed then
          if not v_open then raise exception '%', v_lock; end if;
          if old.status in ('active', 'blocked', 'changes_requested') then new.status := 'proposed'; end if;   -- 고친 계획은 다시 승인
        end if;
      end if;
      new.needs_plan := old.needs_plan and not exists (select 1 from work_items c where c.parent_id = new.id);
    end if;
  end if;

  -- 진척 계산
  if new.status = 'done' then
    new.done_at := coalesce(new.done_at, now());
    if new.measure in ('check', 'percent') then new.progress := 100; end if;
  elsif tg_op = 'UPDATE' and old.status = 'done' then
    new.done_at := null;
    if new.measure = 'check' then new.progress := 0; end if;
  end if;
  if new.measure = 'check' then new.progress := case when new.status = 'done' then 100 else 0 end; end if;
  if new.measure = 'number' and new.num_target is not null and new.num_target <> 0 and new.num_current is not null then
    new.progress := greatest(0, least(100, round(
      case when new.higher_is_better then 100 * new.num_current / new.num_target
           else 100 * new.num_target / nullif(new.num_current, 0) end)))::smallint;
  end if;

  -- 기준선: 처음 '진행'이 되는 순간의 계획을 보관
  if new.baselined_at is null and new.status in ('active', 'blocked', 'done') then
    new.base_start := new.start_date; new.base_due := new.due_date; new.base_target := new.num_target;
    new.baselined_at := now();
  elsif tg_op = 'UPDATE' and old.baselined_at is not null and not v_skip_replan then
    if new.due_date is distinct from old.due_date or new.start_date is distinct from old.start_date then
      new.replan_count := old.replan_count + 1;
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'replan',
              jsonb_build_object('start', old.start_date, 'due', old.due_date),
              jsonb_build_object('start', new.start_date, 'due', new.due_date), new.change_reason);
    end if;
    if new.num_target is distinct from old.num_target then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'target', to_jsonb(old.num_target), to_jsonb(new.num_target), new.change_reason);
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(),
              case when old.status in ('proposed', 'changes_requested') and new.status = 'active' then 'approved'
                   when new.status = 'changes_requested' then 'changes_requested' else 'status' end,
              to_jsonb(old.status), to_jsonb(new.status), new.change_reason);
    end if;
    if new.owner_id is distinct from old.owner_id then
      insert into work_item_events (item_id, team_id, actor_id, kind, old, new, reason)
      values (new.id, new.team_id, auth.uid(), 'owner', to_jsonb(old.owner_id), to_jsonb(new.owner_id), new.change_reason);
    end if;
  end if;
  new.change_reason := null;
  return new;
end $$;

-- 삭제: 팀장 / 내 할 일 / 아직 승인 안 된 내 제안
drop policy if exists wi_delete on public.work_items;
create policy wi_delete on public.work_items for delete to authenticated
  using (public.is_team_leader(team_id)
         or (owner_id = auth.uid() and (public.item_depth(id) >= 2
             or (status in ('proposed', 'changes_requested') and baselined_at is null and public.plan_open(team_id)))));

-- 요청 종류: 변경 요청(change) — 팀원 → 팀장, 목표·과제를 바꿔 달라는 요청
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.team_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.team_requests drop constraint %I', c);
  end loop;
end $$;
alter table public.team_requests add constraint team_requests_kind_check
  check (kind in ('plan', 'progress', 'share', 'meeting', 'other', 'grow', 'cheer', 'change'));

-- 알림 + 계획 요청 시 수정 기간 자동으로 열기
create or replace function public.trg_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_up boolean; v_until date;
begin
  v_up := new.to_id = public._team_leader(new.team_id);   -- 팀원 → 팀장
  if tg_op = 'INSERT' then
    perform public._notify(new.to_id, new.team_id, 'request',
      case when v_up and new.kind = 'meeting' then '1:1 요청: ' when new.kind = 'change' then '목표 변경 요청: '
           when new.kind = 'grow' then '성장 제안: ' when new.kind = 'cheer' then '팀장님 격려: ' else '요청: ' end || new.title,
      left(new.body, 120),
      case when new.kind = 'change' then '/goals/edit' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/people/' || new.from_id || '?oo=1' else '/' end);
    if new.kind = 'plan' then
      if new.item_id is not null then update work_items set needs_plan = true where id = new.item_id; end if;
      if new.from_id = public._team_leader(new.team_id) then
        v_until := coalesce(new.due_date, (now() at time zone 'Asia/Seoul')::date + 14);
        update teams set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('plan_open_until', to_char(v_until, 'YYYY-MM-DD'))
         where id = new.team_id
           and coalesce(nullif(settings->>'plan_open_until', '')::date, '1900-01-01'::date) < v_until;
      end if;
    end if;
  elsif new.status is distinct from old.status and new.status = 'done' then
    new.responded_at := coalesce(new.responded_at, now());
    perform public._notify(new.from_id, new.team_id, 'request.done',
      case when v_up and new.kind = 'meeting' then '1:1 요청 확인: ' when new.kind = 'change' then '변경 요청 처리: '
           when new.kind = 'grow' then '성장 제안 답: ' when new.kind = 'cheer' then '격려 확인: ' else '완료: ' end || new.title,
      left(new.response, 120),
      case when new.kind = 'change' then '/my/goals' || case when new.item_id is not null then '?item=' || new.item_id else '' end
           when v_up then '/my/one-on-ones' else '/' end);
  end if;
  return new;
end $$;

-- =====================================================================
-- ATEAM 데모 계정 — 팀장 1 + 팀원 6, 약 6개월치 기록이 있는 '마케팅기획팀 (데모)'
-- SQL Editor에서 Run. 다시 Run하면 데모 계정·데이터가 처음 상태로 초기화됩니다.
-- 로그인: 앱 로그인 화면 → 이메일 + 비밀번호
--   팀장  leader@demo.ateam
--   팀원  jung@ / park@ / lee@ / kim@ / han@ / choi@demo.ateam
--   비밀번호는 아래 pw 값 (모든 계정 같음) — 공개 주소이니 바꿔서 쓰세요
-- 메일은 보내지 않습니다 (이메일 확인 완료 상태로 생성)
-- =====================================================================

-- 데모 계정과 그 계정이 남긴 기록을 지운다 (다시 Run할 때 초기화용)
create or replace function pg_temp.purge_demo_users(p_ids uuid[]) returns void language plpgsql as $f$
declare r record; pass int;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then return; end if;
  delete from public.teams where owner_id = any(p_ids)
     or (is_demo and id in (select team_id from public.team_members where user_id = any(p_ids)));
  for pass in 1..4 loop
    for r in
      select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype in ('a', 'r')
    loop
      begin
        execute format('delete from %s where %I = any($1)', r.tbl, r.col) using p_ids;
      exception when foreign_key_violation then null;
      end;
    end loop;
  end loop;
  delete from auth.users where id = any(p_ids);
end $f$;

do $$
declare
  pw   text := 'ateam-demo-2026';   -- ← 비밀번호
  dom  text := 'demo.ateam';
  cast_ text[][] := array[['leader','박준호'], ['kim','김도현'], ['park','박서연'], ['choi','최민아'], ['jung','정우성'], ['lee','이정규'], ['han','한수진']];
  ids  uuid[] := '{}';
  uid  uuid;
  L    uuid;
  members uuid[] := '{}';
  T    uuid;
  col  text;
  i    int;
begin
  perform set_config('search_path', 'public, extensions', true);

  -- 0) 이전 데모 정리 (이 스크립트로 만든 계정 + 예전 '데모 팀 만들기' 기능으로 만든 것)
  select coalesce(array_agg(id), '{}') into ids from auth.users where email like '%@' || dom;
  if to_regclass('public.demo_accounts') is not null then
    execute 'select coalesce(array_agg(user_id), ''{}'') from public.demo_accounts' into members;
    ids := ids || members;
    members := '{}';
  end if;
  perform pg_temp.purge_demo_users(ids);
  drop table if exists public.demo_accounts;

  -- 1) 계정 (이메일 확인 완료, 비밀번호 로그인)
  for i in 1..array_length(cast_, 1) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data,
                            confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            cast_[i][1] || '@' || dom, crypt(pw, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', cast_[i][2]),
            '', '', '', '', now(), now())
    returning id into uid;
    if to_regclass('auth.identities') is not null then
      execute $q$insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
               values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true), 'email', now(), now(), now())$q$
        using uid, cast_[i][1] || '@' || dom;
    end if;
    update public.profiles set full_name = cast_[i][2] where id = uid;
    if i = 1 then L := uid; else members := members || uid; end if;
  end loop;
  -- 로그인 서버는 토큰 칸이 NULL이면 오류를 내므로 빈 문자열로 (버전에 따라 있는 칸만)
  for col in select column_name from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and is_nullable = 'YES'
               and column_name in ('email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %I = '''' where email like $1 and %I is null', col, col) using '%@' || dom;
  end loop;

  -- 2) 팀장 구독 (Pro, 1년) + 데모 팀 + 기록
  insert into public.subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (L, 'pro', 'active', null, now(), now() + interval '1 year');
  insert into public.teams (name, owner_id, is_demo) values ('마케팅기획팀 (데모)', L, true) returning id into T;
  perform public.seed_demo_team(T, L, members);
end $$;

select u.email as "데모 계정", p.full_name as "이름", tm.role as "역할", tm.job_title as "직무"
from auth.users u join public.profiles p on p.id = u.id join public.team_members tm on tm.user_id = u.id
where u.email like '%@demo.ateam' order by tm.role = 'leader' desc, tm.joined_at;

-- =====================================================================
-- 내 메모 — 팀장 전용 메모 (팀원에게는 보이지 않음)
--   · 저장은 한 곳, 붙이는 곳은 여러 군데: 팀원 · 목표/과제 · 임원 · 결정 · 1:1 (anchor)
--   · 관찰 메모(observations)와 다름: 평가 근거로 쓰지 않음
--   · ai_allowed: AI가 참고해도 되는 메모 (팀장이 고름) — 1:1 준비 노트 · 팀원 액션 · ATEAM의 제안 · 임원 브리핑이 읽음. 평가 초안은 읽지 않음
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
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이정규' limit 1;
    select id into v_goal from work_items where team_id = r.team_id and parent_id is null and title like '제휴%' limit 1;
    select id into v_exec from executives where team_id = r.team_id order by sort limit 1;
    insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, pinned, created_at, updated_at) values
      (r.team_id, r.leader_id, '분기 마감 전 팀 회고는 짧게 30분 — 잘된 것 1개, 바꿀 것 1개만', 'note', 'none', null, true, now() - interval '6 days', now() - interval '6 days'),
      (r.team_id, r.leader_id, '본부장 주간회의 전에 제휴 전망 숫자 다시 확인', 'todo', 'none', null, false, now() - interval '1 day', now() - interval '1 day');
    if v_jung is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '혼자 끙끙 앓는 편. 막히면 먼저 물어봐 주는 게 효과 있음', 'member', v_jung, '정우성', true, now() - interval '9 days', now() - interval '9 days'); end if;
    if v_lee is not null then insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, created_at, updated_at)
      values (r.team_id, r.leader_id, '다음 1:1에서 교육 예산 얘기 꺼내기', 'todo', 'member', v_lee, now() - interval '3 days', now() - interval '3 days'); end if;
    if v_goal is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, 'B사 말고 C사 제휴 가능성도 열어 두기 — 영업본부 박 팀장에게 물어보기', 'item', v_goal, true, now() - interval '2 days', now() - interval '2 days'); end if;
    if v_exec is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '숫자는 항상 지난달 대비로. 표보다 한 줄 결론을 먼저', 'exec', v_exec, true, now() - interval '5 days', now() - interval '5 days'); end if;
  end loop;
end $$;

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

-- 데모: 이정규 님에게 보낸 코칭 1건 (이미 있으면 건너뜀)
do $$
declare r record; v_lee uuid;
begin
  for r in select t.id team_id from teams t where t.is_demo loop
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이정규' limit 1;
    if v_lee is null or exists (select 1 from coaching_notes where team_id = r.team_id) then continue; end if;
    alter table coaching_notes disable trigger t_coaching_notify;
    insert into coaching_notes (team_id, member_id, title, body, created_at) values (r.team_id, v_lee,
      'CRM 연계, 방향을 한 번 맞추고 가면 훨씬 수월해져요',
      E'지금 보이는 것\n· ''제휴 유입 고객 CRM 연계''가 계획보다 조금 늦어지고 있어요\n· 혼자 맡은 과제인데 최근 3주 동안 진척 공유가 없었어요\n\n왜 중요해요\n제휴 목표와 이어진 과제라, 방향이 한 번 어긋나면 되돌리는 데 시간이 많이 들어요.\n\n이렇게 해 보세요\n· 이번 주에 지금까지 한 것과 남은 것을 3줄로 진척 공유하기\n· 막힌 부분이 있으면 ''무엇이 필요한지''를 한 줄로 같이 적기\n· 다음 결과물은 초안 단계에서 한 번 먼저 올려 방향 확인받기\n\n권장 시점 · 이번 주 금요일까지',
      now() - interval '2 days');
    alter table coaching_notes enable trigger t_coaching_notify;
  end loop;
end $$;
