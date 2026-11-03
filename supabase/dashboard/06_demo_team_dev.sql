-- =====================================================================
-- ATEAM 데모 — 제품개발팀 (데모) · 팀장 백승우 + 팀원 6 · 약 6개월치 기록
-- 06_demo_accounts.sql(마케팅기획팀)을 먼저 Run 한 프로젝트에서 Run. 다시 Run 하면 이 팀만 처음 상태로 돌아갑니다.
-- 계정: demo_dev@ateam.com · demo_dev_p1~p6@ateam.com (비밀번호는 06 과 같음) — 자동 생성 파일 (scripts/build-demo-teams.py)
-- =====================================================================
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

  update teams set name = '제품개발팀 (데모)', mission = '사용자 데이터를 근거로 기능을 빠르게 검증해, 안정적인 출시와 사용자 성장을 함께 이룬다',
    parent_link = '2026 회사 전략 목표 「신규 사용자 30만 명 확보」 · 기여 비중 40%' where id = T;
  insert into team_members (team_id, user_id, role, job_title, joined_at) values (T, L, 'leader', '팀장', now() - interval '200 days')
    on conflict (team_id, user_id) do update set role = 'leader', status = 'active', joined_at = now() - interval '200 days';
  insert into team_members (team_id, user_id, role, job_title, joined_at) values
    (T, m_kim, 'member', '모바일 앱 개발', now() - interval '190 days'),
    (T, m_park, 'member', 'SRE · 인프라', now() - interval '190 days'),
    (T, m_choi, 'member', 'DevOps · 배포', now() - interval '180 days'),
    (T, m_jung, 'member', '결제 · 파트너 연동', now() - interval '180 days'),
    (T, m_lee, 'member', '백엔드 · 데이터', now() - interval '150 days'),
    (T, m_han, 'member', '제품 개발 (신규)', now() - interval '42 days');

  -- 목표·과제 (자유 계층)
  update teams set settings = settings || '{"level_names":["목표","과제","할 일"],"member_free_edit":false}'::jsonb
    || '{"plan_open": false}'::jsonb where id = T;   -- 팀원 목표 수정은 잠금이 기본 (데모 끝에서 한 번 더 잠근다)
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '하반기 앱 메이저 릴리스 성공', 'children', 1, current_date - 60, current_date + 80, 5, now() - interval '60 days') returning id into g1;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '파트너 API 연동 확대', 'children', 2, current_date - 90, current_date + 70, 5, now() - interval '90 days') returning id into g2;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '개발 운영 효율화', 'children', 3, current_date - 60, current_date + 100, 3, now() - interval '60 days') returning id into g3;
  insert into hypotheses (team_id, item_id, statement, signal) values
    (T, g1, '베타 선공개로 베타 신청 전환율 20% 이상', '사용성 테스트 12명 중 새 버전 선호 7명'),
    (T, g2, 'B사 결제 API 연동으로 연내 신규 사용자 8만 명', 'B사 결제 API 스펙 회신 2주째 지연'),
    (T, g3, '기능 배포 리드타임 3주 → 2주', '최근 4건 평균 2.6주');
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '메이저 릴리스 설계', m_kim, 1, 5, 16, 'children', 0, current_date - 45, current_date + 40, 1, now() - interval '45 days') returning id into t1;
  insert into work_items (team_id, parent_id, owner_id, title, measure, status, due_date, sort) values
    (T, t1, m_kim, '핵심 사용자 정의', 'check', 'done', current_date - 30, 1),
    (T, t1, m_kim, '경쟁 앱 기능 분석', 'check', 'done', current_date - 10, 2),
    (T, t1, m_kim, '새 홈 화면 시안 3안', 'check', 'active', current_date + 10, 3),
    (T, t1, m_han, '사용성 테스트 12명', 'check', 'active', current_date + 20, 4),
    (T, t1, m_kim, '임원 보고', 'check', 'active', current_date + 38, 5);
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '릴리스 출시 방식 확정', m_kim, 1, 4, 8, 'percent', 85, current_date - 60, current_date - 5, 2, now() - interval '60 days') returning id into t2;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, status, start_date, due_date, sort, created_at) values
    (T, g2, '파트너 결제 연동 설계서', m_jung, 1, 5, 6, 'percent', 30, 'blocked', current_date - 30, current_date + 20, 1, now() - interval '30 days') returning id into t3;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g2, '파트너 가입 사용자 계정 연동', m_lee, 2, 4, 6, 'percent', 35, current_date - 40, current_date + 50, 2, now() - interval '40 days') returning id into t4;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '배포 프로세스 개선', m_choi, 2, 4, 10, 'percent', 66, current_date - 50, current_date + 30, 1, now() - interval '50 days') returning id into t5;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '서비스별 모니터링 체계 정비', m_jung, 3, 1, 18, 'percent', 40, current_date - 90, current_date + 60, 2, now() - interval '90 days') returning id into t6;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, recur, sort, created_at) values
    (T, g3, '월간 장애 · 성능 리포트 운영', m_park, 3, 2, 12, 'recurring', 'monthly', 3, now() - interval '120 days') returning id into t7;
  insert into work_item_logs (item_id, team_id, author_id, kind, period, done) values
    (t7, T, m_park, 'recurring', (v_month - interval '3 months')::date, true), (t7, T, m_park, 'recurring', (v_month - interval '2 months')::date, true),
    (t7, T, m_park, 'recurring', (v_month - interval '1 months')::date, false);
  -- 일정 변경 이력 (재계획 2회)
  update work_items set due_date = current_date + 5, change_reason = '경쟁 앱 업데이트 일정 추가 확인' where id = t2;
  update work_items set due_date = current_date + 10, change_reason = '임원 일정' where id = t2;
  -- 진척 기록 (최근 3주 속도)
  insert into work_item_logs (item_id, team_id, author_id, kind, period, value) values
    (t3, T, m_jung, 'progress', current_date - 21, 22), (t3, T, m_jung, 'progress', current_date - 14, 26), (t3, T, m_jung, 'progress', current_date - 7, 28),
    (t4, T, m_lee, 'progress', current_date - 21, 20), (t4, T, m_lee, 'progress', current_date - 14, 27),
    (t5, T, m_choi, 'progress', current_date - 21, 45), (t5, T, m_choi, 'progress', current_date - 14, 55)
    on conflict do nothing;
  -- 팀원이 올린 계획(검토 대기) + 팀장 요청
  insert into work_items (team_id, parent_id, owner_id, title, note, measure, status, start_date, due_date, sort)
    values (T, g2, m_lee, '파트너 가입 사용자 온보딩 A/B 테스트', '2개 문구 × 2주, 재방문율 비교', 'percent', 'proposed', current_date + 3, current_date + 35, 3);
  insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, due_date)
    values (T, L, m_jung, 'plan', g2, '파트너 API 연동 확대 — 하위 과제 계획 세워 주세요', '설계서 이후 개발 단계까지 포함해서요', current_date + 3);
  insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, due_date) values
    (T, L, m_park, 'share', t7, '성능 대시보드 개편 화면 캡처 공유해 주세요', '지난주 말씀하신 1차 배포 화면이요. 승인까지는 필요 없습니다.', current_date + 2),
    (T, L, m_han, 'progress', t1, '사용성 테스트 진행 상황 업데이트 부탁해요', '몇 명 했는지, 막히는 게 있는지만 짧게요', current_date + 1);
  -- 팀원 상세 액션: 지원·격려 / 육성 (요청 종류 추가 14_request_kinds 이후에만 들어감)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, title, body, created_at) values
      (T, L, m_lee, 'cheer', '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 같이 볼게요.', '', now() - interval '1 day'),
      (T, L, m_choi, 'grow', '다음 분기에 배포 운영 전체를 맡아 보면 어때요? 해 보고 싶은 범위를 알려 줘요', '', now() - interval '2 days');
    -- 팀원 → 팀장 1on1 요청 (팀원 앱에서 '1on1 요청하기')
    insert into team_requests (team_id, from_id, to_id, kind, title, body, created_at) values
      (T, m_lee, L, 'meeting', '계정 연동 방향이 맞는지 한번 같이 보고 싶어요', '', now() - interval '5 hours');
  exception when others then null;
  end;
  -- 김현정: '팀장님과' 받은함 예시 (열린 것 · 답한 것이 섞이게)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, title, body, due_date, created_at) values
      (T, L, m_kim, 'other', '목요일 30분, 릴리스 UT 결과 같이 봐요', '정리 안 된 상태로 가져와도 됩니다', current_date + 2, now() - interval '6 hours'),
      (T, L, m_kim, 'grow', '내년 신규 서비스 개발을 리드해 보면 어때요? 해 보고 싶은 범위를 알려 줘요', '', null, now() - interval '3 days'),
      (T, L, m_kim, 'progress', '진행 상황과 막힌 점 공유 부탁해요', '지금까지 한 것과 남은 것만 짧게요', current_date + 3, now() - interval '1 day');   -- 업무 독려 (과제 없이 → 매니징 보드 Feedback)
    insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, status, response, responded_at, created_at) values
      (T, L, m_kim, 'share', t1, '릴리스 설계서 v2 올려 주세요', '임원 보고 전에 한 번 보고 싶어요', 'done', '업무플랫폼에 v2 올렸습니다', now() - interval '19 days', now() - interval '20 days'),
      (T, L, m_kim, 'cheer', null, '임원 보고 준비하느라 고생 많았어요. 이번 주는 조금 쉬어 가요', '', 'done', '감사합니다. 금요일 오후 반차 쓰겠습니다', now() - interval '9 days', now() - interval '10 days');
  exception when others then null;
  end;
  -- 팀원 → 팀장 목표 변경 요청 (22_plan_window 이후에만 들어감)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, created_at) values
      (T, m_choi, L, 'change', t5, '배포 프로세스 개선 — 마감 2주 연장 요청',
       'CI 도구 업체 교체로 파이프라인 정비가 늦어졌습니다. 마감을 2주 미루고, 목표 범위에서 롤백 가이드는 다음 분기로 넘기고 싶어요.', now() - interval '1 day');
  exception when others then null;
  end;
  insert into work_item_allocations (item_id, user_id, team_id, share_pct) values
    (t1, m_kim, T, 40), (t1, m_han, T, 30), (t2, m_kim, T, 20), (t3, m_jung, T, 15), (t4, m_lee, T, 20),
    (t5, m_choi, T, 30), (t6, m_jung, T, 45), (t6, m_park, T, 10), (t7, m_park, T, 30);

  insert into metrics (team_id, item_id, name, unit, target, period_start, period_end, cumulative)
    values (T, g2, '파트너 연동 신규 사용자', '만 명', 20, (v_month - interval '3 months')::date, (v_month + interval '2 months')::date, true) returning id into mt;
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_target, unit, metric_id, sort)
    values (T, g2, m_lee, '파트너 연동 신규 사용자', 'number', 20, '만 명', mt, 4);
  -- 목표마다 지표(결과를 재는 항목) — 목표 진척은 지표 평균 (23_goal_metrics)
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_current, num_target, unit, sort, start_date, due_date) values
    (T, g1, m_kim, '릴리스 베타 신청 누적', 'number', 1840, 5000, '건', 0, current_date - 45, current_date + 40),
    (T, g2, m_lee, '연동 사용자 30일 재방문율', 'number', 22, 35, '%', 5, current_date - 40, current_date + 50);
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_current, num_target, unit, higher_is_better, sort, start_date, due_date)
    values (T, g3, m_choi, '기능 배포 리드타임', 'number', 6, 5, '일', false, 0, current_date - 50, current_date + 30);
  begin
    execute $q$insert into work_items (team_id, parent_id, owner_id, title, measure, stages, stage_current, sort, start_date, due_date)
      values ($1, $2, $3, '모니터링 체계 표준화', 'stage', array['착수', '초안', '검증', '확정', '확산'], 2, 1, current_date - 60, current_date + 60)$q$ using T, g3, m_jung;
  exception when others then null;
  end;
  insert into metric_values (metric_id, team_id, period, value) values
    (mt, T, (v_month - interval '3 months')::date, 3.4), (mt, T, (v_month - interval '2 months')::date, 3.6), (mt, T, (v_month - interval '1 months')::date, 4.2);
  insert into metric_pipeline (metric_id, team_id, label, amount, probability, expected_close) values
    (mt, T, 'B사 결제 API 연동', 4, 0.4, v_month + 45), (mt, T, 'C사 간편결제 연동 갱신', 2.5, 0.6, v_month + 30), (mt, T, 'D사 멤버십 API 연동', 1.5, 0.3, v_month + 50);

  -- 컨디션 공유 26주 (업무 칸은 비움 — 컨디션 · 영향 요인 · 메모만)
  for i in 1..26 loop
    wk := this_mon - (i * 7);
    insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
      (T, m_kim, wk, '', '', '', case when i <= 1 then 3 else 4 end),
      (T, m_park, wk, '', '', '', 4),
      (T, m_choi, wk, '', '', '', case when i % 5 = 0 then 3 else 4 end),
      (T, m_jung, wk, '', '', '', case when i <= 2 then 3 else 4 end);
    if i <= 20 then
      insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
        (T, m_lee, wk, '', '', '', case i when 1 then 2 when 2 then 3 when 3 then 4 else 4 end);
    end if;
    if i <= 5 then
      insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
        (T, m_han, wk, '', '', '', 4);
    end if;
  end loop;
  -- 지난 기록의 작성 시각을 그 주 금요일로
  update checkins set created_at = week_start + interval '4 days 17 hours', updated_at = week_start + interval '4 days 17 hours' where team_id = T;
  -- 이번 주: 이동욱만 미공유
  insert into checkins (team_id, user_id, week_start, did, blocked, next, condition) values
    (T, m_kim, this_mon, '', '', '', 3),
    (T, m_park, this_mon, '', '', '', 4),
    (T, m_choi, this_mon, '', '', '', 4),
    (T, m_jung, this_mon, '', '', '', 2),
    (T, m_han, this_mon, '', '', '', 4);
  -- 영향 요인 · 메모 (24_condition 의 moods · note 칸 — 아직 없으면 건너뜀)
  begin
    execute $q$update checkins set moods = array['rested'] where team_id = $1 and condition >= 4 and (extract(week from week_start)::int % 4) = 0$q$ using T;
    execute $q$update checkins set moods = array['energized'] where team_id = $1 and condition >= 4 and (extract(week from week_start)::int % 4) = 2$q$ using T;
    for u in select * from (values
        (m_kim, 0, array['tired']::text[], ''), (m_kim, 1, array['tired']::text[], ''),
        (m_park, 0, array['rested', 'energized']::text[], ''),
        (m_choi, 0, array['rested']::text[], ''),
        (m_jung, 0, array['personal', 'tired']::text[], '이번 주 이사 일정으로 오후 시간이 유동적입니다'),
        (m_jung, 1, array['personal']::text[], ''), (m_jung, 2, array['heavy']::text[], ''),
        (m_lee, 1, array['heavy', 'need_rest']::text[], ''), (m_lee, 2, array['tired']::text[], ''),
        (m_han, 0, array['energized']::text[], '')) as x(uid, ago, moods, note)
    loop
      execute 'update checkins set moods = $1, note = $2 where team_id = $3 and user_id = $4 and week_start = $5' using u.moods, u.note, T, u.uid, this_mon - u.ago * 7;
    end loop;
  exception when undefined_column then null;
  end;

  -- 1on1 (격주, 완료)
  for u in select * from (values (m_kim, 12), (m_park, 11), (m_choi, 10), (m_jung, 9), (m_lee, 5), (m_han, 3)) as x(uid, n) loop
    for i in 1..u.n loop
      insert into one_on_ones (team_id, leader_id, member_id, scheduled_at, status, shared_notes, completed_at)
      values (T, L, u.uid, now() - ((case when u.uid = m_lee then 21 else 7 end) + (i - 1) * 14) * interval '1 day', 'done',
              case when u.uid = m_kim and i = 1 then '메이저 릴리스를 베타 선공개 중심으로 바꾸는 방향에 합의. 2번 가설은 사용성 테스트로 검증하기로 함.'
                   else '진행 상황 공유, 다음 2주 우선순위 확인' end,
              now() - ((case when u.uid = m_lee then 21 else 7 end) + (i - 1) * 14) * interval '1 day');
    end loop;
  end loop;
  insert into one_on_ones (team_id, leader_id, member_id, scheduled_at) values
    (T, L, m_kim, date_trunc('day', now()) + interval '14 hours'),
    (T, L, m_park, date_trunc('week', now()) + interval '3 days 10 hours');
  insert into action_items (team_id, owner_id, title, due_date, created_by) values
    (T, L, '경쟁 앱 기능 분석 리포트 공유', current_date - 7, L),
    (T, m_kim, 'UT 설계안 초안', current_date + 2, L),
    (T, L, '4분기 서버 예산 재배분 확인', current_date + 4, L);

  -- 팀장 노하우: 일 잘하는 방식 · 좋은 결과물의 기준 (AI 검토 · 코칭 · 1on1 준비 · 보고가 읽는다)
  begin
    insert into knowhow_cards (team_id, owner_id, kind, title, body, rules, applies_to, keywords, pinned, shared, provenance, use_count, last_used_at, created_at) values
      (T, L, 'principle', '결론부터, 한 장으로', '보고는 첫 줄에 결론(무엇을 하자는지, 무엇을 정해 달라는지)을 쓰고 근거는 그 아래에 둔다. 첫 장만 읽어도 판단할 수 있어야 한다.',
        '["첫 줄에 결론과 요청 사항", "근거는 3개 이내로", "첫 장만 보고 결정할 수 있게"]'::jsonb, '{review,report,briefing}', '{결론,보고,한장}', true, true, 'human', 14, now() - interval '1 day', now() - interval '120 days'),
      (T, L, 'rubric', '좋은 설계서의 조건', '정보를 모은 것과 설계는 다르다. 내가 무엇을 문제로 보는지, 왜 이 안을 골랐는지가 보여야 한다.',
        '["문제 정의를 본인 언어로", "대안 2개 이상 비교하고 버린 이유", "리스크와 대응", "다음 행동·담당·일정까지"]'::jsonb, '{review,evaluation}', '{기획서,대안,리스크}', true, true, 'human', 11, now() - interval '2 days', now() - interval '110 days'),
      (T, L, 'principle', '숫자에는 출처와 비교 기준', '숫자만 있으면 판단이 안 된다. 어디서 나온 숫자인지, 무엇과 비교해 좋은지 나쁜지가 함께 있어야 한다.',
        '["숫자마다 출처", "지난달·목표 대비로 쓴다", "추정치는 가정을 함께"]'::jsonb, '{review,report}', '{숫자,출처,근거}', false, true, 'human', 9, now() - interval '3 days', now() - interval '100 days'),
      (T, L, 'rubric', '올리기 전 완성도 점검 3가지', '초안이어도 괜찮지만, 아래 세 가지는 비워 두지 않는다.',
        '["미정·TBD로 남긴 곳이 없는가", "요청받은 질문에 다 답했는가", "다음 행동과 날짜가 있는가"]'::jsonb, '{review}', '{완성도,점검}', false, true, 'human', 6, now() - interval '4 days', now() - interval '60 days'),
      (T, L, 'framework', '보고서 기본 구조', '결론 → 배경 → 대안 비교 → 리스크 → 다음 행동 순서. 분량보다 이 순서를 지키는 것이 중요하다.',
        '["결론 → 배경 → 대안 → 리스크 → 다음 행동"]'::jsonb, '{review,report}', '{구조,양식}', false, true, 'human', 7, now() - interval '6 days', now() - interval '90 days'),
      (T, L, 'principle', '막히면 이틀 안에 말한다', '혼자 오래 붙들수록 손해다. 막힌 지 이틀이 되면 무엇이 필요한지 한 줄로 공유한다. 도움을 청하는 건 약점이 아니다.',
        '["막힘은 2일 안에 공유", "무엇이 필요한지 함께 쓴다"]'::jsonb, '{review,prep,briefing}', '{막힘,공유}', false, true, 'human', 5, now() - interval '5 days', now() - interval '80 days'),
      (T, L, 'coaching', '1on1은 사람 먼저', '1on1 첫 10분은 업무가 아니라 컨디션과 어려움을 묻는다. 해결책보다 먼저 듣고, 약속은 하나만 정한다.',
        '["첫 10분은 사람 이야기", "약속은 하나만, 날짜와 함께"]'::jsonb, '{prep}', '{1on1,코칭}', false, false, 'human', 8, now() - interval '2 days', now() - interval '70 days'),
      (T, L, 'context', '하반기 우리 팀 우선순위', '하반기 최우선은 앱 메이저 릴리스와 파트너 API 연동 확대. 전사 비용 15% 절감 방침이 있어, 예산이 드는 안은 단위 비용 근거를 함께 낸다.',
        '["릴리스·연동이 최우선", "예산 안에는 단위 비용 근거"]'::jsonb, '{review,strategy,briefing,prep}', '{우선순위,예산,비용}', true, false, 'human', 10, now() - interval '1 day', now() - interval '40 days');
  exception when others then null;
  end;

  -- 결과물: 김현정 기획서 v1~v3 (리뷰 중)
  insert into submissions (team_id, author_id, item_id, title, status, created_at) values (T, m_kim, t1, '하반기 앱 메이저 릴리스 설계서', 'in_review', now() - interval '30 days') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 1, E'1. 사용자·현황\n타깃 2030 직장인, 월 활성 사용자 120만 명 연 8% 성장.\n\n2. 출시 방식 — 일괄 출시\n베타 없이 전체 사용자에게 한 번에 내보내 새 버전의 경험 통일을 우선한다.', '초안', m_kim, now() - interval '30 days'),
    (sub, T, 2, E'1. 사용자·현황\n타깃 2030 직장인, 월 활성 사용자 120만 명 연 8% 성장. 주요 경쟁 앱 3곳.\n\n2. 출시 방식 — 일괄 출시\n사용자 설문 조사 결과 반영 예정.\n\n3. 배포 계획\n앱 내 배너·스토어 소개 중심, 베타 신청 페이지.', '배포 계획 추가', m_kim, now() - interval '16 days');
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 3, E'1. 사용자·현황\n타깃 2030 직장인, 월 활성 사용자 120만 명 연 8% 성장. 주요 경쟁 앱 3곳의 점유율 합계 61%.\n\n2. 출시 방식 — 베타 선공개\n경쟁 앱 출시 재분석 결과, 큰 개편을 한 번에 내보내면 초기 장애와 이탈을 막기 어렵다고 판단했다. 베타 신청 사용자 15%에게 먼저 공개하고, 6주 뒤 전체 출시로 전환한다. 버린 대안: 일괄 출시(장애 위험), 상시 베타(버전 파편화).\n\n3. 배포 계획\n앱 내 배너·스토어 소개 중심 베타 신청 → 출시 후 파트너 연동(B사 결제) 확대.\n\n4. 가설별 검증 계획\n가설 1: 베타 선공개로 베타 신청 전환율 20% 이상 — 신청 페이지 데이터로 검증\n가설 2: 3040 직장인도 주 사용자 — 사용성 테스트 12명으로 검증 (데이터 보강 필요)',
     '출시 방식을 베타 선공개로 전면 수정', m_kim, now() - interval '4 days') returning id into ver;
  insert into review_comments (submission_id, version_id, team_id, author_id, section_ref, body, created_at) values
    (sub, ver, T, L, '§2 출시 방식', '근거가 좋아요. 다만 2번 가설은 데이터가 더 필요해 보입니다.', now() - interval '3 days');
  insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at, parent_id)
    select sub, ver, T, m_kim, '다음 주 사용성 테스트로 보강하겠습니다.', now() - interval '3 days', id from review_comments where submission_id = sub limit 1;

  insert into submissions (team_id, author_id, item_id, title, status) values (T, m_choi, t5, '배포 프로세스 개선안', 'in_review') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by) values
    (sub, T, 1, E'배포 프로세스 개선안\n1. 현황: 기능 1건 배포 리드타임 평균 3주\n2. 개선: 배포 체크리스트 템플릿, QA팀 주간 고정 슬롯', '초안', m_choi),
    (sub, T, 2, E'배포 프로세스 개선안\n1. 현황: 기능 1건 배포 리드타임 평균 3주 (최근 10건 기준)\n2. 개선: 배포 체크리스트 템플릿, QA팀 주간 고정 슬롯, 승인 단계 1회로 축소\n3. 측정: 월 배포 건수, 리드타임', '측정 지표 추가', m_choi);

  -- 지난 결과물 (승인 13건) + 판단 깊이 기록
  for i in 1..13 loop
    insert into submissions (team_id, author_id, title, created_at)
    values (T, (array[m_kim, m_park, m_choi, m_jung, m_kim, m_park, m_choi, m_kim, m_jung, m_park, m_choi, m_kim, m_lee])[i],
            (array['사용자 세그먼트 분석','API 응답 성능 진단','앱 리뷰 대응 운영안','파트너사 후보 리스트','경쟁 앱 출시 동향','성능 모니터링 대시보드 설계','코드 리뷰 가이드라인','사용자 페르소나 정의','파트너 연동 조건 비교','리포트 자동화 계획','API 네이밍 규칙 정리','로딩 속도 민감도 분석','온보딩 메시지 개편'])[i],
            now() - (170 - i * 11) * interval '1 day')
    returning id into sub;
    insert into submission_versions (submission_id, team_id, version, extracted_text, created_by, created_at)
    values (sub, T, 1, (array[
      E'사용자 세그먼트 분석\n1. 사용 로그 기준 4개 세그먼트: 가벼운 사용형 34%, 탐색형 27%, 충성형 22%, 이탈 위험 17%\n2. 새 버전 1차 타깃: 탐색형 — 세션 시간 상위 30%, 푸시 유입 비중 62%\n3. 다음: 탐색형 대상 화면 테스트',
      E'API 응답 성능 진단\n1. 3분기 평균 응답 시간 290ms (전 분기 대비 +12%)\n2. 원인: 검색 API 캐시 설정 — 같은 설정 6주 이상 방치\n3. 제안: 캐시 점검 주기 3주로 단축, 파트너 게이트웨이 테스트 예산 10% 배정',
      E'앱 리뷰 대응 운영안\n1. 목표: 출시 전 스토어 리뷰 3만 → 5만\n2. 주 3회 리뷰 답변 + 월 1회 사용자 간담회\n3. 성과 지표: 재설치 수·추천 수 중심 (별점 제외)',
      E'파트너사 후보 리스트\n1. 후보 6곳: 가입자 규모·사용자 겹침·API 제공 수준으로 비교\n2. 1순위 B사(가입자 120만, 겹침 38%), 2순위 A사, 3순위 C사\n3. B사는 스펙 제공 일정이 불확실 — 대안 확보 필요',
      E'경쟁 앱 출시 동향\n1. 주요 3사 모두 큰 개편 때 단계적 공개(10~20%) 사용\n2. 일괄 출시 사례는 사용자 상위 앱뿐\n3. 시사점: 우리 규모에서는 단계적 공개 검토 필요',
      E'성능 모니터링 대시보드 설계\n1. 보는 사람별 화면: 팀장(주간 장애·응답 시간), 실무(API별 성능)\n2. 데이터 소스 3곳 자동 연동, 매일 오전 7시 갱신\n3. 1차 배포 범위: 서비스별 장애 시간·응답 시간',
      E'코드 리뷰 가이드라인\n1. 톤: 친근하지만 모호함 없이, 지적은 근거와 함께\n2. 범위: PR 1건 400줄 이하, 기능 단위로 분리\n3. 금지 패턴 12개와 대체 패턴 정리',
      E'사용자 페르소나 정의\n1. 핵심 페르소나: 31세 직장인, 퇴근길 10분 앱 사용, 푸시로 기능 발견\n2. 이탈 요인: 기능 부족보다 ”어디 있는지” 찾기 어려움\n3. 화면 방향: 자주 쓰는 기능 위주',
      E'파트너 연동 조건 비교\n1. A사: 수수료 2.8%, 정산 월 1회 / B사: 수수료 3.0%, API 실시간(스펙 미정) / C사: 수수료 2.7%, API 없음\n2. 추천: B사 우선 협의, A사 병행',
      E'리포트 자동화 계획\n1. 주간 리포트 작성 시간 4시간 → 30분 목표\n2. 대시보드 연동 후 자동 요약, 코멘트만 작성\n3. 일정: 3주, 1주차 데이터 정리',
      E'API 네이밍 규칙 정리\n1. 원칙: 명확함·일관성·짧음\n2. 영역별 차이: 내부 API는 간결하게, 외부 공개 API는 설명 중심\n3. 예시 엔드포인트 20개',
      E'로딩 속도 민감도 분석\n1. 로그 40만 세션: 적정 로딩 1.2~1.8초\n2. 2초 이상에서 이탈 급증(+41%)\n3. 제안: 상한 1.9초, 핵심 화면은 1.3초대 체험',
      E'온보딩 메시지 개편\n1. 현재 가입 안내 푸시 열람률 22% — 업계 평균 35%\n2. 개편: 첫 메시지에 기능 1개만, 발송 시점 가입 직후 → 다음 날 오전\n3. 4주 뒤 열람률·첫 결제 전환 비교'])[i], (select author_id from submissions where id = sub), now() - (170 - i * 11) * interval '1 day') returning id into ver;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
    values (sub, ver, T, L, (array[
      '세그먼트 나눈 기준이 분명해서 좋아요. 다음엔 결론(어느 세그먼트부터)을 첫 줄로 올려 주세요.',
      '응답 시간 숫자에 출처랑 지난 분기 비교가 있어서 판단이 쉬웠어요. 이대로 진행하죠.',
      '좋습니다. 다만 성과 지표를 왜 재설치·추천으로 골랐는지 한 줄 근거가 있으면 더 좋겠어요.',
      '후보 비교 좋아요. B사 스펙 일정이 불확실하면 대안도 같이 적어 주세요 — 리스크는 미리.',
      '시사점까지 정리해 줘서 좋아요. 이대로 진행하죠.',
      '화면 구성 좋아요. 1차 범위 밖은 언제 하는지 다음 행동·날짜까지 적어 주세요.',
      '좋습니다. 금지 패턴 정리가 특히 실용적이에요.',
      '페르소나 좋아요. 이 근거가 어느 데이터에서 나왔는지 출처를 달아 주세요.',
      '조건 비교표 좋아요. 추천 이유를 결론 쪽으로 올리면 첫 장만 봐도 판단돼요.',
      '좋습니다. 일정에 담당자까지 넣어 주면 완성이에요.',
      '규칙 정리 좋아요. 이대로 진행하죠.',
      '로그 숫자 좋아요. 상한 1.9초로 정한 이유를 대안(1.5초)과 비교해서 한 줄 넣어 주세요.',
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
    (T, L, m_kim, 'praise', '커뮤니케이션', '임원 보고에서 출시 전략 질문에 근거를 들어 침착하게 답변함', current_date - 6),
    (T, L, m_kim, 'praise', '문제 정의', '일괄 출시 가정을 스스로 뒤집고 경쟁 앱 출시 재분석을 제안함', current_date - 20),
    (T, L, m_kim, 'concern', '실행 관리', '마감 전 야근이 반복됨. 일정 분산 필요', current_date - 12),
    (T, L, m_kim, 'note', '데이터 분석', '경쟁 앱 분석은 수치 나열에 그치는 경향', current_date - 60),
    (T, L, m_park, 'praise', '데이터 분석', '장애 지표 정의를 CS팀과 맞춰 정리함', current_date - 15),
    (T, L, m_park, 'praise', '협업', '다른 팀 데이터 요청을 우선순위 기준으로 조율', current_date - 40),
    (T, L, m_choi, 'praise', '문제 정의', '배포 지연 문제를 리드타임 지표로 정의', current_date - 25),
    (T, L, m_jung, 'note', '협업', '결제사 스펙 회신 지연을 혼자 해결하려 함', current_date - 9),
    (T, L, m_jung, 'praise', '커뮤니케이션', '결제사 미팅 정리가 명확함', current_date - 45),
    (T, L, m_lee, 'concern', null, '최근 회의에서 발언이 줄어듦', current_date - 10);

  -- 의사결정 (결과 기록 7건)
  insert into decisions (team_id, title, rationale, expected_outcome, outcome, outcome_rating, decided_by, decided_at) values
    (T, '메이저 릴리스를 베타 선공개로 확정', '경쟁 앱 출시 재분석', '베타 신청 전환율 20%', null, null, L, now() - interval '14 days'),
    (T, 'UT 대상 8명 → 12명 확대', '2번 가설 데이터 부족', '가설 검증 가능', null, null, L, now() - interval '1 day'),
    (T, '파일럿 서버 리전 2곳 선정', '응답 지연', '6주 내 응답 시간 목표 달성', '5주 만에 달성', 'hit', L, now() - interval '120 days'),
    (T, '장애 리포트 자동화 우선 착수', '반복 업무 30%', '주 6시간 절감', '주 5시간 절감', 'hit', L, now() - interval '100 days'),
    (T, '파트너 후보 5곳으로 압축', '조건 비교', '2곳 협상 진입', '1곳만 진입', 'partial', L, now() - interval '90 days'),
    (T, '배포 체크리스트 템플릿 시범 운영', '배포 지연', '리드타임 3주 → 2.5주', '2.4주', 'hit', L, now() - interval '80 days'),
    (T, 'CS팀 VOC 공유 주간 회의 신설', '정보 공유', 'VOC 반영 +10%', '변화 없음', 'miss', L, now() - interval '70 days'),
    (T, '배포 알림 일부 자동화', '시간 절감', '주 4시간 절감', '주 4시간 절감', 'hit', L, now() - interval '60 days'),
    (T, '서버 증설 상반기 집중', '트래픽 피크 대비', '피크 대응 여유 30%', '32%', 'hit', L, now() - interval '50 days');

  -- 돌아볼 결정 (결과 기록 시점이 지난 것)
  update decisions set review_on = current_date - 1 where team_id = T and title = '메이저 릴리스를 베타 선공개로 확정';

  -- 조직·전사: 위에서 온 것 (org_notes 가 있을 때만)
  if to_regclass('public.org_notes') is not null then
    execute $q$insert into public.org_notes (team_id, author_id, kind, title, body, source, event_date, created_at) values
      ($1, $2, 'exec', '본부장 관심사: 파트너 연동 성과와 단위 비용 개선 속도',
        E'본부장 주간회의에서 두 번 연속 질문.\n”파트너 연동 신규 사용자가 언제 숫자로 보이냐”\n”서비스별 단위 비용 비교표를 다음 보고에 넣어 달라”', '본부장 주간회의', null, now() - interval '6 days'),
      ($1, $2, 'request', '본부 4분기 개발 실행계획 초안 제출', '비용 15% 절감 반영, 서비스별 단위 비용 목표 포함', '경영기획팀', current_date + 6, now() - interval '2 days'),
      ($1, $2, 'calendar', '하반기 평가 시즌 시작 (자기평가 오픈)', '팀장 평가 의견 작성 기간 2주', 'HR팀 공지', current_date + 34, now() - interval '10 days'),
      ($1, $2, 'peer', 'CS팀 VOC 공유 회의 격주 → 월 1회로 변경', '파트너 연동 사용자 문의 대응이 늦어질 수 있음', 'CS팀', null, now() - interval '9 days')$q$
      using T, L;
    execute $q$insert into public.org_notes (team_id, author_id, kind, title, body, source, created_at) values
      ($1, $2, 'strategy', '4분기 전사 방침: 인프라 비용 15% 절감, 처리 효율(단위 비용) 중심',
        E'전사 경영회의 결정 사항\n- 4분기 인프라 비용 전년 대비 15% 절감\n- 서비스 평가 기준을 트래픽·가용 시간에서 단위 비용(1만 건 처리 비용)으로 변경\n- 단위 비용이 낮은 구간(파트너 게이트웨이 등)에 예산 우선 배정', '전사 경영회의', now() - interval '3 days') returning id$q$
      into sub using T, L;
    -- 영향 분석 예시 1건 (ai_kind 'org_impact' 가 같은 실행에서 막 추가된 경우엔 건너뜀)
    begin
      execute $q$insert into public.ai_outputs (team_id, kind, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
        values ($1, 'org_impact', 'org_notes', $2, 'draft', 'leader', 'L2', 2, $3, '[]'::jsonb, $4, now() - interval '3 days')$q$
      using T, sub, jsonb_build_object(
        'summary', '비용 15% 절감 방침이 메이저 릴리스의 서버 증설 계획과 부딪히고, 파트너 연동 목표에는 힘이 실립니다.',
        'level', 'high',
        'affected', jsonb_build_array(
          jsonb_build_object('item_id', g1, 'title', '하반기 앱 메이저 릴리스 성공', 'how', '레거시 서버 비중이 커서 비용 절감의 첫 대상이 될 수 있습니다'),
          jsonb_build_object('item_id', g2, 'title', '파트너 API 연동 확대', 'how', '단위 비용이 낮은 구간 우선 배정 방침과 맞아 예산을 더 요청할 근거가 됩니다')),
        'actions', jsonb_build_array(
          jsonb_build_object('label', '메이저 릴리스 서버 예산을 단위 비용 기준으로 다시 배분', 'kind', 'replan'),
          jsonb_build_object('label', '서비스별 단위 비용 비교표를 이번 주간보고에 추가', 'kind', 'report'),
          jsonb_build_object('label', '권나윤 님과 B사 스펙 막힘 해소 일정 확정 — 파트너 연동이 방침의 수혜 영역', 'kind', 'discuss')),
        'report_line', '전사 비용 절감 방침에 맞춰 메이저 릴리스 서버 예산을 단위 비용 기준으로 다시 나누고, 파트너 게이트웨이 비중을 늘리겠습니다.'), L;
    exception when others then null;
    end;
  end if;

  -- AI 인사이트 예시 (오늘·이번 주·이번 달) — 데모 팀은 날짜가 지나도 이 해석을 보여줌
  declare c jsonb;
  begin
    c := $j${
      "headline": "실행은 순항과 정체로 갈렸고, 관리는 운영 리듬이 느슨해진 상태입니다 — 외부 의존 하나가 성과와 사람 양쪽의 병목입니다.",
      "sections": {
        "risk": {"summary": "리스크가 한 곳으로 몰리는 구조입니다 — 외부 스펙 의존 하나가 목표·일정·담당자 컨디션을 동시에 끌어내리고 있어, 이 의존을 풀지 않으면 다른 조치가 효과를 내기 어렵습니다.", "items": [
          {"type": "risk", "severity": 3, "title": "파트너 연동: 스펙 막힘 → 설계서 지연 → 달성 가능성 12%", "body": "원인이 하나라 풀리면 세 가지가 같이 풀립니다.", "action": "B사 스펙 대체안 이번 주 확정", "link": "goals"},
          {"type": "risk", "severity": 2, "title": "홍재원 님 이탈 신호", "body": "컨디션 3주 하락과 1on1 공백이 겹칩니다.", "action": "이번 주 1on1", "link": "one_on_ones"}]},
        "decide": {"summary": "결정이 미뤄지며 비용이 쌓이는 국면입니다 — 목표를 지킬지 조정할지 정하지 않은 채 실행만 이어지고 있어, 이번 주 판단이 분기 결과를 가릅니다.", "items": [
          {"type": "risk", "severity": 3, "title": "파트너 연동 목표(20만 명)를 조정할지, 스펙 지원을 요청해 지킬지", "body": "설계서 막힘이 목표 전망을 끌어내립니다. 전사 비용 절감 방침상 파트너 연동은 예산 우선 대상이라 지원 요청의 명분이 있습니다.", "action": "이번 주 안에 결정, 권나윤 님과 15분", "link": "sim",
            "options": ["사업개발본부에 B사 스펙 협조를 공식 요청해 목표 유지", "목표를 16만 명으로 낮추고 메이저 릴리스에 인력 집중", "설계 범위를 B사 제외 2개사로 줄여 일정 우선"],
            "impact": "기말 전망 18.6만 명 → 목표 20만 명과의 차이를 메우는 유일한 경로입니다."},
          {"type": "pattern", "severity": 2, "title": "메이저 릴리스 서버 예산을 단위 비용 기준으로 다시 나눌지", "body": "전사 비용 15% 절감 방침이 메이저 릴리스 서버 증설과 부딪힙니다.", "action": "4분기 실행계획 초안 전에 결정", "link": "org",
            "options": ["레거시 서버 비중을 줄이고 파트너 게이트웨이로 이동", "베타 선공개 기간을 줄여 비용 확보"],
            "impact": "릴리스 목표(달성 가능성 94%)는 지키면서 파트너 연동 목표에 예산을 돌릴 수 있습니다."},
          {"type": "pattern", "severity": 2, "title": "모니터링 체계 정비에 들어가는 팀 시간을 줄일지", "body": "기여도가 낮은 과제에 팀 시간 35%가 들어가고, 그중 권나윤 님 몫이 45%입니다.", "action": "다음 주 계획 회의에서 결정", "link": "strategy",
            "options": ["모니터링 체계 정비를 다음 분기로 미루고 권나윤 님을 파트너 연동에 집중", "문가은 님에게 리포트 운영을 넘겨 시간 분산"],
            "impact": "권나윤 님 시간이 연동 설계서로 옮겨 가면 막힘 해소 속도가 빨라집니다."}]},
        "perf": {"summary": "성과는 순항과 정체로 갈려 있습니다 — 문제는 실행력보다 외부에 기대는 과제에 대체 경로가 없는 계획 구조이고, 그 한 축이 팀 전망 평균을 끌어내립니다.", "items": [
          {"type": "forecast", "severity": 2, "title": "설계서 지연이 파트너 연동 목표 전망의 핵심 원인", "body": "최근 3주 진척 속도가 거의 0입니다.", "action": "B사 스펙 대체안으로 범위 축소", "link": "goals"},
          {"type": "good", "severity": 1, "title": "메이저 릴리스 달성 가능성 94%", "body": "UT·베타 신청 페이지가 일정대로 갑니다.", "link": "goals"}]},
        "people": {"summary": "팀원관리가 흔들리는 건 개인 문제보다 운영 리듬 때문입니다 — 1on1 간격이 벌어진 시기에 막힘을 혼자 끌어안는 패턴이 겹쳐 컨디션이 같이 꺾였고, 성장·인정은 일부에게만 몰려 있습니다.", "items": [
          {"type": "risk", "severity": 3, "title": "홍재원 님 3주 연속 컨디션 하락 (4 → 3 → 2)", "body": "1on1이 3주 넘게 없고, 계정 연동 과제는 혼자 맡고 있습니다. 업무량보다 방향 불확실이 원인일 수 있습니다.", "action": "이번 주 안에 1on1 — 과제 우선순위부터 물어보기", "link": "one_on_ones"},
          {"type": "risk", "severity": 2, "title": "권나윤 님 2주째 같은 문제로 막힘", "body": "본인 힘으로 풀 수 없는 외부 스펙 문제라, 팀장이 위로 올려 줘야 풀립니다.", "action": "사업개발본부 협조 요청을 대신 올리기", "link": "one_on_ones"},
          {"type": "good", "severity": 1, "title": "류지훈·문가은 님 판단 깊이 상승", "body": "결과물 검토 점수와 결과 지표가 함께 올랐습니다. 지금 인정하면 효과가 큽니다.", "action": "관찰 메모로 남기기", "link": "team"},
          {"type": "data", "severity": 1, "title": "안소율 님 평가 근거 부족", "body": "입사 6주 차로 결과물·관찰 기록이 적습니다. 평가 시즌(D-33) 전에 근거를 쌓아야 합니다.", "action": "UT 결과물 리뷰를 근거로 남기기", "link": "reviews"}]},
        "org": {"summary": "위와의 정렬이 늦어지고 있습니다 — 전사 기준은 비용·처리 효율로 바뀌었는데 팀 계획과 보고는 아직 이전 기준이라, 임원 질문에 답할 근거가 비어 있습니다.", "items": [
          {"type": "forecast", "severity": 2, "title": "4분기 실행계획 제출 D-6", "body": "비용 15% 절감 반영이 필요합니다.", "action": "메이저 릴리스 서버 예산 재배분안부터 준비", "link": "org"}]}
      },
      "watch_next": "다음 주 결제사 스펙이 들어오는지, 홍재원 님 컨디션이 반등하는지"
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
      values (T, L, '앱 v4.0 전면 개편 출시', 'children', 'done', 100, 1, make_date(py, 3, 1), make_date(py, 9, 30), make_date(py, 3, 1), make_date(py, 8, 31), make_date(py, 9, 30), 5, make_date(py, 2, 20), make_date(py, 9, 30)) returning id into pg;
    insert into work_items (team_id, parent_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, created_at, updated_at) values
      (T, pg, m_kim, '개편 설계·화면 구조', 'check', 'done', 100, 1, make_date(py, 3, 1), make_date(py, 5, 15), make_date(py, 3, 1), make_date(py, 4, 30), make_date(py, 5, 15), make_date(py, 2, 20), make_date(py, 5, 15)),
      (T, pg, m_choi, '출시 화면 20종 개발', 'check', 'done', 100, 2, make_date(py, 5, 1), make_date(py, 8, 31), make_date(py, 5, 1), make_date(py, 8, 15), make_date(py, 8, 31), make_date(py, 2, 20), make_date(py, 8, 31)),
      (T, pg, m_park, '출시 배포 운영', 'check', 'done', 100, 3, make_date(py, 8, 1), make_date(py, 9, 30), make_date(py, 8, 1), make_date(py, 8, 31), make_date(py, 9, 30), make_date(py, 2, 20), make_date(py, 9, 30));
    insert into work_items (team_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, contribution, created_at, updated_at)
      values (T, L, '신규 사용자 10만 명 확보', 'children', 'done', 82, 2, make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 12, 31), 5, make_date(py, 1, 2), make_date(py, 12, 31)) returning id into pg;
    insert into work_items (team_id, parent_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, created_at, updated_at) values
      (T, pg, m_park, '자체 채널 신규 6만 명', 'percent', 'done', 95, 1, make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31)),
      (T, pg, m_jung, '파트너 연동 신규 4만 명', 'percent', 'done', 62, 2, make_date(py, 3, 1), make_date(py, 12, 31), make_date(py, 3, 1), make_date(py, 11, 30), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31));
  exception when others then null;
  end;

  -- 업무플랫폼: 리뷰 대기 결과물 2건의 AI 1차 검토 + 다가오는 1on1의 AI 준비 노트
  declare v1 uuid; v2 uuid; o1 uuid;
  begin
    select sv.id into v1 from submission_versions sv join submissions s on s.id = sv.submission_id
      where s.team_id = T and s.title = '하반기 앱 메이저 릴리스 설계서' order by sv.version desc limit 1;
    select sv.id into v2 from submission_versions sv join submissions s on s.id = sv.submission_id
      where s.team_id = T and s.title = '배포 프로세스 개선안' order by sv.version desc limit 1;
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at) values
      (T, 'review', m_kim, 'submission_versions', v1, 'draft', 'leader', 'L1', 1, $j${
        "depth_score": 3.0,
        "summary": "일괄 출시를 버린 이유와 대안 비교가 분명해 논리가 탄탄하고, 가설마다 검증 방법까지 붙여 완성도도 높아졌습니다. 다만 결론이 §2에 묻혀 있어 첫 장만 봐서는 무엇을 하자는지 바로 보이지 않고, 가설 2(3040 사용자)는 아직 주장 수준입니다.",
        "brief": {"tone": "good", "text": "류지훈 님이 올린 ’하반기 앱 메이저 릴리스 설계서’는 논리가 탄탄해 보입니다", "why": "버린 대안과 이유까지 비교함 · 결론은 뒤에 있음"},
        "decisions": ["베타 15% 선공개 적용", "B사 결제 연동 확대 시점"],
        "strengths": [{"section": "§2 출시 방식", "text": "경쟁 앱 재분석으로 일괄 출시를 버린 이유와 대안 2개를 비교해 밝혔습니다."},
                      {"section": "§4 가설", "text": "가설마다 검증 방법(신청 데이터, UT)을 붙였습니다."}],
        "gaps": [{"section": "§4 가설 2", "text": "3040 직장인이 주 사용자라는 근거가 UT 계획뿐이라 아직 주장 수준입니다."},
                 {"section": "§3 배포", "text": "파트너 연동(B사) 확대가 스펙 회신 지연과 어떻게 맞물리는지 빠져 있습니다."}],
        "questions": ["베타 15% 선공개가 베타 신청 전환율 20%로 이어진다는 근거는?", "B사 스펙이 늦어지면 3단계 배포 계획은 어떻게 바뀌나요?"],
        "change_from_previous": "일괄 출시에서 베타 선공개로 바꾸고, 버린 대안과 이유를 새로 적었습니다.",
        "criteria_check": [{"criterion": "결론부터 쓴다", "met": false, "note": "§1 사용자 현황으로 시작해 결론이 뒤에 있습니다."},
                           {"criterion": "대안 비교", "met": true, "note": "§2에서 일괄 출시·상시 베타를 비교했습니다."},
                           {"criterion": "숫자와 출처", "met": true, "note": "사용자 규모·점유율에 수치를 달았습니다."}]
      }$j$::jsonb, '[]'::jsonb, m_kim, now() - interval '4 days'),
      (T, 'review', m_choi, 'submission_versions', v2, 'draft', 'leader', 'L1', 1, $j${
        "depth_score": 2.0,
        "summary": "현황 수치와 측정 지표를 붙여 실행 가능한 모양은 갖췄지만, 목표치가 없고 세 가지 개선이 각각 리드타임을 얼마나 줄이는지 추정이 비어 있어 완결성이 낮습니다. 개선안도 일반적인 방법을 옮긴 수준이라 이 팀만의 병목을 짚은 관점이 약합니다.",
        "brief": {"tone": "watch", "text": "서태민 님이 올린 ’배포 프로세스 개선안’은 완결성이 낮아 보입니다", "why": "목표치가 없고 개선 효과 추정이 비어 있음"},
        "decisions": [],
        "strengths": [{"section": "1. 현황", "text": "최근 10건 기준 리드타임 3주로 기준선을 잡았습니다."}],
        "gaps": [{"section": "2. 개선", "text": "체크리스트 템플릿·고정 슬롯이 각각 며칠을 줄이는지 추정이 없습니다."},
                 {"section": "3. 측정", "text": "목표치(예: 2주)가 없어 성공 여부를 판단하기 어렵습니다."}],
        "questions": ["세 가지 개선 중 리드타임을 가장 많이 줄이는 건 무엇이라고 보나요?", "QA팀 고정 슬롯은 QA팀과 합의됐나요?"],
        "change_from_previous": "측정 지표(월 배포 건수, 리드타임)를 추가했습니다.",
        "criteria_check": [{"criterion": "결론부터 쓴다", "met": true, "note": "첫 줄에 개선안을 밝혔습니다."},
                           {"criterion": "대안 비교", "met": false, "note": "다른 개선 방법과 비교가 없습니다."}]
      }$j$::jsonb, '[]'::jsonb, m_choi, now() - interval '1 day');
    -- 김현정 기획서 v1 · v2 의 AI 검토 (버전마다 검토가 쌓이는 흐름)
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
    select T, 'review', m_kim, 'submission_versions', sv.id, 'draft', 'leader', 'L1', 1, x.c::jsonb, '[]'::jsonb, m_kim, sv.created_at + interval '5 minutes'
    from submission_versions sv join submissions s on s.id = sv.submission_id
    join (values
      (1, $j${
        "depth_score": 2.0,
        "summary": "타깃과 사용자 규모는 잡았지만, 일괄 출시를 택한 이유가 ’경험 통일’ 한 줄뿐이라 근거가 비어 있습니다. 다른 출시 방식과 비교하지 않았고 배포·일정 등 실행 부분이 아직 없습니다.",
        "brief": {"tone": "risk", "text": "류지훈 님이 올린 ’하반기 앱 메이저 릴리스 설계서’는 근거가 비어 보입니다", "why": "일괄 출시 이유가 ’경험 통일’ 한 줄뿐"},
        "decisions": [],
        "strengths": [{"section": "1. 사용자·현황", "text": "타깃과 사용자 규모·성장률을 숫자로 먼저 밝혔습니다."}],
        "gaps": [{"section": "2. 출시 방식", "text": "일괄 출시가 큰 개편인 지금 맞는지, 단계적 공개와 비교한 근거가 없습니다."},
                 {"section": "전체", "text": "배포·일정 등 실행 계획이 빠져 있어 초안 단계입니다."}],
        "questions": ["큰 개편을 한 번에 내보내면 초기 장애를 막기 어렵지 않을까요?", "경쟁 앱들은 큰 개편 때 어떻게 했나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      (2, $j${
        "depth_score": 2.0,
        "summary": "배포 계획과 경쟁 앱 수가 추가돼 분량은 늘었지만, v1에서 비었던 일괄 출시의 근거는 ’조사 결과 반영 예정’으로 미뤄져 고민의 깊이는 그대로입니다.",
        "brief": {"tone": "watch", "text": "류지훈 님이 올린 ’하반기 앱 메이저 릴리스 설계서’는 고민의 깊이가 그대로로 보입니다", "why": "배포 계획은 늘었지만 일괄 출시 근거는 ’반영 예정’"},
        "decisions": [],
        "strengths": [{"section": "3. 배포 계획", "text": "베타 신청 페이지까지 이어지는 배포 흐름을 새로 잡았습니다."}],
        "gaps": [{"section": "2. 출시 방식", "text": "핵심 판단(일괄 출시)의 근거가 아직 ’예정’으로 남아 있습니다."}],
        "questions": ["사용자 설문 조사는 언제 나오고, 결과에 따라 출시 방식이 바뀔 수 있나요?"],
        "change_from_previous": "배포 계획(앱 내 배너·스토어 소개, 베타 신청 페이지)과 경쟁 앱 수를 추가했습니다.", "trend_note": "", "criteria_check": []
      }$j$)
    ) as x(ver, c) on sv.version = x.ver
    where s.team_id = T and s.title = '하반기 앱 메이저 릴리스 설계서';
    select id into o1 from one_on_ones where team_id = T and member_id = m_kim and status = 'scheduled' order by scheduled_at limit 1;
    if o1 is not null then
      insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
      values (T, 'one_on_one_prep', m_kim, 'one_on_ones', o1, 'draft', 'leader', 'L2', 2, $j${
        "last_time": "메이저 릴리스를 베타 선공개 중심으로 바꾸는 방향에 합의했고, 2번 가설은 사용성 테스트로 검증하기로 했습니다.",
        "since": [{"text": "설계서 v3 제출 — 베타 선공개로 전면 수정"}, {"text": "판단 깊이 2.0 → 3.0으로 상승"}],
        "open_promises": [{"owner": "팀장", "text": "경쟁 앱 기능 분석 리포트 공유", "overdue": true}, {"owner": "팀원", "text": "UT 설계안 초안", "overdue": false}],
        "recent_work": "설계서 v3에서 대안 비교와 가설별 검증 계획이 뚜렷해졌습니다.",
        "watch": "판단 깊이가 눈에 띄게 올랐습니다. 지금 인정하고, UT 일정이 B사 스펙 지연과 겹치지 않는지 확인하세요.",
        "questions": ["베타 선공개를 결정한 가장 결정적인 근거는 무엇이었나요?", "UT에서 꼭 확인하고 싶은 것 하나만 꼽는다면?", "제가 먼저 풀어 줘야 할 막힘이 있나요?"]
      }$j$::jsonb, '[]'::jsonb, L, now() - interval '2 hours');
    end if;
  exception when others then null;
  end;

  -- 팀원관리: 이번 주 AI 액션 추천 + 팀원별 업무 판단
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'people_actions', 'draft', 'leader', 'L2', 2, $2, '[]'::jsonb, $3, now() - interval '30 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, jsonb_build_object(
      'summary', '이번 주는 홍재원 님 1on1과 권나윤 님 막힘 해소가 먼저이고, 류지훈 님은 지금 인정할 타이밍입니다.',
      'actions', jsonb_build_array(
        jsonb_build_object('user_id', m_lee, 'type', 'one_on_one', 'urgency', 3, 'title', '홍재원 님과 1on1 — 이번 주 안에',
          'why', '컨디션이 3주 연속 떨어졌고(4 → 3 → 2) 마지막 1on1이 3주 전입니다.', 'opener', '요즘 일하면서 에너지가 가장 떨어지는 순간이 언제예요?'),
        jsonb_build_object('user_id', m_jung, 'type', 'support', 'urgency', 3, 'title', '권나윤 님 챙기기 — 어려운 점 들어 주기',
          'why', '같은 막힘이 2주째 이어지고, 이번 주 컨디션 공유에서 개인 사정과 피로를 골랐습니다.', 'request', '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 제가 도울 수 있는 건 같이 할게요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'praise', 'urgency', 2, 'title', '류지훈 님께 칭찬 배지',
          'why', '최근 결과물의 판단 깊이가 꾸준히 올랐고(2.0 → 3.0), 대안을 비교하고 근거를 남기는 방식이 자리 잡았습니다.', 'message', '요즘 결과물마다 대안을 따져 보고 근거를 남기는 게 보여서 든든해요. 고마워요!'),
        jsonb_build_object('user_id', m_han, 'type', 'observe', 'urgency', 2, 'title', '안소율 님 관찰 기록 남기기',
          'why', '입사 6주 차로 평가 근거가 기준에 못 미칩니다. 이번 주 일하는 모습을 보고 한 줄 남겨 두세요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'develop', 'urgency', 1, 'title', '류지훈 님께 더 큰 역할 제안하기',
          'why', '판단 깊이가 꾸준히 올라 다음 단계 역할을 이야기할 시점입니다.', 'request', '다음 분기에는 더 넓은 범위를 직접 리드해 보면 좋겠어요. 어떤 걸 맡아 보고 싶은지 이야기해 봐요.'),
        jsonb_build_object('user_id', m_choi, 'type', 'push', 'urgency', 1, 'title', '서태민 님과 진행 공유 리듬 맞추기',
          'why', '결과물이 리뷰 단계에 머물러 있고 최근 진행 공유 간격이 길어졌습니다.', 'request', '이번 주부터 금요일마다 진행 상황을 한 줄로 공유해 줄래요? 막히는 게 있으면 같이 봐요.'),
        jsonb_build_object('user_id', m_park, 'type', 'praise', 'urgency', 1, 'title', '문가은 님께 꾸준함 인정하기',
          'why', '정기 업무를 빠짐없이 운영하고 결과물이 대부분 한 번에 통과했습니다.', 'message', '매달 빠짐없이 챙겨 주는 꾸준함 덕분에 팀이 숫자를 믿고 움직여요. 고마워요!')),
      'members', jsonb_build_array(
        jsonb_build_object('user_id', m_kim, 'work_status', 'good', 'work_view', '릴리스 설계가 계획보다 조금 늦지만 결과물 품질이 뚜렷이 올랐습니다. 핵심 과제를 안정적으로 끌고 갑니다.', 'flight_risk', 'low', 'flight_note', '컨디션이 안정적이고 1on1이 꾸준합니다.'),
        jsonb_build_object('user_id', m_park, 'work_status', 'good', 'work_view', '정기 리포트를 빠짐없이 운영하고 결과물도 한 번에 통과하는 편입니다. 다만 업무가 겹쳐 시간이 빠듯합니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_choi, 'work_status', 'good', 'work_view', '프로세스 개선이 계획대로 가고, 개선안에 측정 지표를 붙이는 등 결과물이 나아지고 있습니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_jung, 'work_status', 'support', 'work_view', '설계서가 외부 스펙 막힘으로 계획보다 크게 늦고, 모니터링 체계 정비도 진척이 더딥니다. 본인 역량보다 외부 의존이 원인입니다.', 'flight_risk', 'medium', 'flight_note', '같은 막힘이 2주째 반복되고 일이 몰려 있습니다.'),
        jsonb_build_object('user_id', m_lee, 'work_status', 'watch', 'work_view', '계정 연동 과제가 계획보다 조금 늦지만 큰 이탈은 없습니다. 혼자 맡은 과제라 방향 확인이 필요합니다.', 'flight_risk', 'high', 'flight_note', '컨디션 3주 연속 하락과 1on1 공백이 겹칩니다.'),
        jsonb_build_object('user_id', m_han, 'work_status', 'good', 'work_view', 'UT 준비를 일정대로 진행 중이나 아직 올린 결과물이 적어 판단 근거가 얇습니다.', 'flight_risk', 'low', 'flight_note', '신규 입사자로 적응 중입니다.'))
    ), L;
  exception when others then null;
  end;

  -- A·Team의 제안: 이번 주 + 지난주(회고용) + 지난주 제안 상태 + 팀장 셀프 체크
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 2, $2, '[]'::jsonb, $3, now() - interval '7 days 20 minutes', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date - 1)$q$
    using T, $j${"headline": "실행은 순항하지만 사람 관리의 리듬이 느슨해지고 있습니다 — 1on1과 기준 공유로 다시 조이는 주입니다.", "focus": "파트너 연동 목표 — 결제사 스펙 회신이 공식 경로로 요청되지 않았습니다.", "levers": {"exec": {"state": "watch", "note": "연동 과제가 2주째 같은 막힘입니다."}, "staffing": {"state": "good", "note": "부하는 고른 편입니다."}, "people": {"state": "act", "note": "1on1 간격이 평균 19일로 벌어졌습니다."}, "external": {"state": "watch", "note": "스펙 회신이 비공식 경로에만 의존합니다."}, "self": {"state": "good", "note": "특이 신호 없음."}, "system": {"state": "watch", "note": "결과물 보완점이 같은 주제로 반복됩니다."}}, "advice": [{"id": "a1", "lever": "people", "urgency": 3, "effort": "low", "title": "1on1 간격을 2주 이내로 되돌리세요", "why": "1on1 평균 간격이 19일로 벌어졌습니다.", "effect": "막힘을 일찍 듣게 됩니다.", "if_not": "컨디션 하락을 늦게 알게 됩니다.", "route": "one_on_one", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "system", "urgency": 2, "effort": "mid", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "why": "보완점이 같은 주제로 반복됩니다.", "effect": "수정 횟수가 줄어듭니다.", "if_not": "리뷰 시간이 계속 늘어납니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a3", "lever": "external", "urgency": 2, "effort": "low", "title": "결제사 스펙 회신을 사업개발본부에 공식 요청하세요", "why": "비공식 경로로 2주를 기다렸습니다.", "effect": "회신 날짜가 정해집니다.", "if_not": "막힘이 계속됩니다.", "route": "report", "target_user_id": "", "script": ""}], "review": [], "watch_next": "홍재원 님 컨디션."}$j$::jsonb, L;
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 3, $2, '[]'::jsonb, $3, now() - interval '20 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, replace($j${"headline": "성과는 외부 의존 하나에 묶여 있고, 운영은 팀장 시간이 순항하는 사람 쪽으로 쏠려 있습니다 — 이번 주는 ’막힌 곳으로 사람과 시간을 옮기는 주’입니다.", "focus": "파트너 연동 목표(20만 명) — 결제사 스펙 회신이 풀리지 않으면 4분기 전망이 18.6만 명 근처에서 멈춥니다.", "levers": {"exec": {"state": "act", "note": "연동 과제가 3주째 같은 막힘(결제사 스펙)으로 멈춰 있고, 계획에 대체 경로가 없습니다."}, "staffing": {"state": "watch", "note": "파트너 연동 목표의 하위 일 3건이 모두 권나윤 님 한 사람에게 있고, 류지훈 님은 가용 시간의 70%만 쓰고 있습니다."}, "people": {"state": "watch", "note": "최근 4주 칭찬·관찰이 류지훈·문가은 님에게 몰렸고, 홍재원 님은 컨디션이 3주째 내려가는데 팀장 접점이 가장 적습니다."}, "external": {"state": "act", "note": "전사 비용 15% 절감 방침이 메이저 릴리스 서버 예산과 부딪히는데, 아직 위로 방향을 확인하지 않았습니다."}, "self": {"state": "watch", "note": "리뷰 대기 6건(가장 오래 5일)과 검토 중 결정 3건이 겹쳐 있고, 최근 2주 앱 활동의 31%가 밤 10시 이후·주말입니다."}, "system": {"state": "good", "note": "체크인 제출 5/6명으로 주간 리듬은 유지됩니다. 다만 결과물 보완점이 ’근거·데이터’에 반복됩니다."}}, "advice": [{"id": "a1", "lever": "exec", "urgency": 3, "effort": "low", "title": "연동 과제에 ’대체 연동 경로’를 이번 주 안에 계획으로 넣으세요 — 결제사 스펙을 기다리는 동안 공개 API 문서와 샌드박스 2곳으로 1차안을 만들게 하세요.", "why": "같은 막힘이 3주째 체크인에 반복되고, 파트너 연동 목표 달성 가능성이 12%까지 내려왔습니다.", "effect": "스펙 회신이 늦어져도 11월 첫 주에 1차 설계가 가능해지고, 목표 전망의 바닥이 올라갑니다.", "if_not": "회신이 2주 더 밀리면 4분기 파트너 연동 목표는 조정이 불가피합니다.", "route": "decide", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "staffing", "urgency": 2, "effort": "mid", "title": "연동 과제의 ’테스트 코드 정리’ 1건을 류지훈 님에게 옮겨 권나윤 님 한 사람 의존을 푸세요.", "why": "연동 하위 일 3건이 한 사람에게 몰려 있고(주 46시간/가용 40시간), 류지훈 님은 여유가 있습니다.", "effect": "권나윤 님은 결제사 협의에 집중하고, 막힘이 한 곳에서 전체로 번지는 걸 막습니다.", "if_not": "권나윤 님 과부하가 이어지면 이탈 주의 신호가 ’높음’으로 올라갈 수 있습니다.", "route": "request", "target_user_id": "{{KIM}}", "script": "지훈 씨, 연동 설계서의 테스트 코드 정리 파트를 이번 주부터 맡아 줄 수 있을까요? 나윤 씨가 결제사 협의에 집중할 수 있게 하려는 거예요. 필요한 시간은 같이 조정할게요."}, {"id": "a3", "lever": "external", "urgency": 3, "effort": "low", "title": "비용 절감 방침과 릴리스 예산의 충돌을 이번 주 본부장 보고에 먼저 올리세요 — 결정권은 위에 있습니다.", "why": "전사 방침(비용 15% 절감)이 메이저 릴리스 서버 증설과 부딪히는데, 팀 안에서 결론을 내기 어려운 사안입니다.", "effect": "예산 축소 범위가 일찍 정해지면 4분기 실행계획 초안을 다시 쓰지 않아도 됩니다.", "if_not": "실행계획 확정 직전에 예산이 깎이면 릴리스 일정 전체가 밀립니다.", "route": "report", "target_user_id": "", "script": "전사 비용 15% 절감 방침에 맞춰 메이저 릴리스 서버 예산을 단위 비용 기준으로 재배분하려 합니다. 다만 파트너 연동 목표(20만 명)에 필요한 최소 예산은 유지가 필요해, 이번 주 안에 방향 확인 부탁드립니다."}, {"id": "a4", "lever": "self", "urgency": 2, "effort": "low", "title": "리뷰 대기 6건 중 정기 보고 2건은 문가은 님에게 1차 리뷰를 맡기고, 아낀 시간을 홍재원·권나윤 님에게 쓰세요.", "why": "최근 4주 팀장 접점의 48%가 류지훈·문가은 님 두 사람에게 갔고, 필요도가 높은 홍재원 님은 팀 평균의 0.6배입니다.", "effect": "리뷰 적체가 절반으로 줄고, 이탈 주의 두 사람에게 이번 주 1on1 시간이 생깁니다.", "if_not": "적체와 늦은 시간 작업이 이어지면 결정이 더 미뤄지는 악순환이 됩니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a5", "lever": "people", "urgency": 1, "effort": "low", "title": "이번 주 금요일 점심을 ’릴리스 준비 중간 점검 + 류지훈 님 설계서 통과 축하’ 자리로 잡으세요.", "why": "팀 컨디션이 3.6으로 내려가는 중이고, 인정이 일부에게만 보이는 상태입니다.", "effect": "짧고 부담 없는 자리로 팀 전체가 진척을 함께 보고, 인정이 팀 전체의 이야기가 됩니다.", "if_not": "막힌 사람과 순항하는 사람 사이의 온도 차가 커집니다.", "route": "calendar", "target_user_id": "", "script": "금요일 점심은 다 같이 먹어요 — 릴리스 준비 중간 점검 겸, 지훈 씨 설계서 통과도 축하해요."}], "review": [{"id": "a1", "title": "1on1 간격을 2주 이내로 되돌리세요", "verdict": "partial", "observed": "권나윤·안소율 님과는 1on1을 했지만, 홍재원 님은 아직 3주째 1on1이 없습니다."}, {"id": "a2", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "verdict": "not_done", "observed": "기준 카드가 공개되지 않았고, 이번 주에도 보완점 2건이 ’근거·데이터’였습니다."}, {"id": "a3", "title": "결제사 스펙 회신을 사업개발본부에 공식 요청하세요", "verdict": "done", "observed": "사업개발본부 요청이 기록됐고, 결제사 회신은 ’11월 둘째 주 이후 가능’으로 왔습니다."}], "watch_next": "결제사 스펙 회신 날짜와 홍재원 님 다음 체크인의 컨디션.", "perspective": {"big": {"lens": "목표 구성 · 다가오는 시기", "text": "팀 목표 중 새로 만드는 일은 앱 메이저 릴리스 하나이고, 나머지는 지금 하는 일을 지키고 넓히는 목표입니다. 릴리스가 끝나는 11월 이후 팀의 다음 성장 축이 비어 있습니다.", "why": "11~12월은 평가와 내년 목표 수립이 겹치는 시기입니다. 내년 목표에 넣을 ’새로 만들 일’ 후보를 지금부터 모아 두면 목표를 서둘러 정하지 않게 됩니다."}, "reframe": {"lens": "관심과 기회의 쏠림", "text": "일의 배분이 곧 동기의 배분이 되고 있습니다 — 릴리스·설계처럼 성장이 보이는 일은 류지훈·문가은 님에게, 막힌 일은 권나윤·홍재원 님에게 가 있습니다.", "why": "최근 4주 칭찬·관찰도 같은 두 사람에게 몰렸습니다. 막힌 사람에게 시간을 더 쓰는 것과 별개로, 다음 배분 때 ’보이는 일’을 한 번 돌려 볼 만합니다."}, "experiment": {"title": "주간 회의 첫 10분을 ’막힌 것만’ 말하는 시간으로 바꿔 보기", "how": "진행 보고는 업무플랫폼에 미리 올리고, 회의에서는 한 사람씩 막힌 것 하나와 필요한 도움만 말합니다. 팀장은 답보다 ’누가 도울 수 있나’를 먼저 묻습니다.", "check": "2주 뒤 막힘이 공유되기까지 걸린 날짜와 회의 시간"}, "question": "내년 이맘때 우리 팀이 ’그때 시작하길 잘했다’고 말할 일은 무엇일까요?"}}$j$, '{{KIM}}', m_kim::text)::jsonb, L;
    execute $q$insert into public.advice_status (team_id, advice_key, status, updated_by) values
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a1', 'adopted', $2),
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a2', 'held', $2),
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a3', 'done', $2) on conflict do nothing$q$ using T, L;
    execute $q$insert into public.leader_selfcheck (team_id, user_id, week_start, energy, burden, note) values
      ($1, $2, date_trunc('week', current_date)::date - 14, 4, 3, ''),
      ($1, $2, date_trunc('week', current_date)::date - 7, 3, 4, '릴리스·연동이 겹쳐 리뷰가 밀림') on conflict do nothing$q$ using T, L;
  exception when others then null;
  end;

  -- 상향 관리: 상위 관리자 2명 + 위에서 온 것 연결 + 임원 브리핑
  declare e1 uuid; e2 uuid;
  begin
    execute $q$insert into public.executives (team_id, name, title, style_tags, interests, prefs, sort) values ($1, '도정환', '제품본부장', array['숫자·근거 중시','결론 먼저','비용·효율'],
      '파트너 연동 성과와 단위 비용 개선 속도. 지난달 대비 숫자로 물음', '월요일 본부 주간회의 · 1페이지 · 결론 먼저', 0) returning id$q$ into e1 using T;
    execute $q$insert into public.executives (team_id, name, title, style_tags, interests, prefs, sort) values ($1, '차미영', '전략기획 상무', array['리스크 민감','사용자 관점','디테일 확인'],
      '4분기 실행계획의 리스크와 대안, 릴리스 일정', '격주 · 이슈 중심 · 대안 2개 이상', 1) returning id$q$ into e2 using T;
    execute $q$update public.org_notes set exec_id = $2 where team_id = $1 and kind = 'exec'$q$ using T, e1;
    execute $q$update public.org_notes set exec_id = $2 where team_id = $1 and kind = 'request'$q$ using T, e2;
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'exec_brief', 'draft', 'leader', 'L3', 3, $2, '[]'::jsonb, $3, now() - interval '40 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, replace(replace(replace($j${"headline": "위에서 보면 우리 팀은 ’릴리스는 순항, 연동은 숫자가 안 보이는 팀’입니다 — 이번 주 질문은 파트너 연동과 단위 비용에 몰릴 가능성이 큽니다.", "execs": [{"exec_id": "{{E1}}", "name": "도정환", "lens": "비용 15% 절감 방침 아래에서 ’파트너 연동이 단위 비용을 낮추는 근거가 숫자로 보이는가’", "opener": "파트너 연동은 아직 목표 대비 56%지만, 단위 비용은 1.1만 원으로 서비스 중 가장 낮습니다 — 남은 변수는 B사 스펙 하나입니다.", "questions": [{"q": "파트너 연동 신규 사용자가 언제 숫자로 보이나?", "why": "주간회의에서 두 번 연속 물었고, 현재 누적 11.2만 명으로 목표 20만 명의 56%입니다.", "prep": "기준 전망 18.6만 명(93%) · B사 스펙이 11월 둘째 주 이후 → 대체 경로(공개 API 문서·샌드박스 2곳)로 11월 첫 주 1차 설계 가능"}, {"q": "서비스별 단위 비용 비교표는 준비됐나?", "why": "지난 회의에서 다음 보고에 넣어 달라고 요청했습니다.", "prep": "10월 장애 · 성능 리포트 기준 레거시 서버 3.2만 · 앱 서버 2.6만 · 파트너 게이트웨이 1.1만 원 — 문가은 님 리포트에서 바로 가져올 수 있음"}, {"q": "비용 15% 절감은 어디서 줄이나?", "why": "전사 방침의 첫 대상이 서버 증설입니다.", "prep": "레거시 서버 예산 20%를 게이트웨이로 이동하는 안 (10월 리포트 제안) — 베타 신청 전환율 18%는 유지"}], "challenges": [{"point": "파트너 연동 목표 달성 가능성 12%", "why": "같은 막힘이 3주째 반복되고 계획에 대체 경로가 없습니다.", "prep": "인정: 외부 스펙 의존을 늦게 다뤘다. 대안: 대체 연동 경로를 이번 주 계획에 넣고, 목표 조정 여부를 11월 첫 주에 판단"}, {"point": "모니터링 체계 정비가 계속 밀림", "why": "계획 변경 2회, 진척 정체.", "prep": "범위를 대시보드 1차 화면으로 줄이고 나머지는 1월로"}]}, {"exec_id": "{{E2}}", "name": "차미영", "lens": "4분기 실행계획이 ’최악의 경우’까지 대비돼 있는가", "opener": "실행계획 초안은 결제사 스펙 지연을 가장 큰 리스크로 두고, 대체 경로까지 넣어 6일 뒤 제출하겠습니다.", "questions": [{"q": "실행계획 초안은 기한(D-6) 안에 나오나?", "why": "경영기획팀 요청 기한이 다가옵니다.", "prep": "초안 골격 완료 · 서비스별 단위 비용 목표만 남음 — 금요일 내부 리뷰 후 제출"}, {"q": "B사 스펙이 안 들어오면 어떻게 되나?", "why": "리스크 중심으로 보는 분이고 외부 의존이 가장 큰 변수입니다.", "prep": "최악: 4분기 파트너 연동 목표 약 18만 명에서 멈춤 → 대체 파트너 2곳으로 1.4만 명 보완안"}], "challenges": [{"point": "릴리스와 연동이 같은 사람·같은 시기에 겹침", "why": "연동 하위 과제 3건이 한 사람에게 몰려 있습니다.", "prep": "테스트 코드 정리 1건을 류지훈 님에게 옮기는 재배분 계획을 함께 보고"}]}], "requests": [{"note_id": "", "title": "본부 4분기 개발 실행계획 초안 제출", "due": "{{D6}}", "status": "진행 중", "reply": "4분기 실행계획 초안은 비용 15% 절감과 서비스별 단위 비용 목표를 반영해 기한 안에 제출하겠습니다. 결제사 스펙 지연에 대비한 대체 경로도 함께 넣었습니다."}, {"note_id": "", "title": "서비스별 단위 비용 비교표를 다음 보고에 추가", "due": "", "status": "미답", "reply": "서비스별 단위 비용은 레거시 서버 3.2만 · 앱 서버 2.6만 · 파트너 게이트웨이 1.1만 원입니다. 다음 주간회의에 비교표로 정리해 가겠습니다."}], "share_first": [{"title": "B사 스펙은 11월 둘째 주 이후 — 파트너 연동 목표 일정에 영향", "why": "다른 경로로 들으면 ’왜 미리 말 안 했나’가 됩니다.", "tone": "bad"}, {"title": "베타 신청 1,840명 · 전환율 18%", "why": "본부장 관심사(효율)에 바로 답이 되는 좋은 숫자입니다.", "tone": "good"}], "watch": "B사 회신 날짜, 실행계획 제출 후 예산 배분 결정."}$j$, '{{E1}}', e1::text), '{{E2}}', e2::text), '{{D6}}', (current_date + 6)::text)::jsonb, L;
  exception when others then null;
  end;

  -- 팀원 평가: 김현정 님 예상 등급(시뮬레이션) + 의견 초안
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, subject_user_id, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'evaluation_draft', $2, 'draft', 'leader', 'L3', 3, $3, '[]'::jsonb, $4, now() - interval '1 day',
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 7 else 1 end, 1),
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 12 else 6 end, case when extract(month from current_date) >= 7 then 31 else 30 end))$q$
    using T, m_kim, $j${"grade": {"expected": "A", "range": ["B", "A"], "confidence": "medium", "rationale": "핵심 과제(메이저 릴리스 설계)를 끌고 가면서 결과물의 판단 깊이가 2.0에서 3.0으로 뚜렷이 올랐고, 결과물 대부분이 한 번에 승인됐습니다. 다만 릴리스 일정은 계획보다 조금 늦습니다.", "up": [{"text": "출시 전략을 데이터로 스스로 뒤집고, 버린 대안과 이유를 남김 (설계서 v3)", "evidence": []}, {"text": "결과물 8건 중 6건 승인, 그중 4건이 한 번에 통과", "evidence": []}, {"text": "본부장 질의에 근거를 들어 답함 (1on1 기록)", "evidence": []}], "down": [{"text": "경쟁 앱 분석처럼 정형 업무에서는 자기 관점이 약하다는 보완점이 두 번 반복", "evidence": []}], "missing": "실행 관리(일정 준수) 근거가 아직 적어 A로 확정하기는 이릅니다. 11월 릴리스 결과를 보면 확실해집니다."}, "overall": "문제를 끝까지 붙들고 방향을 다시 잡는 힘이 이번 기간 가장 두드러졌습니다. 메이저 릴리스 출시 전략에서 처음 가정을 데이터로 뒤집고 대안을 비교해 남긴 과정이 대표적입니다. 결과물의 판단 깊이가 꾸준히 올라 팀의 핵심 과제를 맡길 수 있는 수준입니다. 다만 정해진 틀을 채우는 작업에서는 자기 관점이 덜 드러납니다.", "strengths": [{"title": "근거 기반의 방향 전환", "detail": "초기 가정을 고집하지 않고 데이터를 보고 전략을 고쳤습니다.", "evidence": []}, {"title": "결과물 품질의 꾸준한 상승", "detail": "판단 깊이 2.0 → 3.0, 대부분 한 번에 승인됐습니다.", "evidence": []}], "growth": [{"title": "정형 업무에서의 자기 관점", "detail": "경쟁 앱 분석 등에서 일반적 정리에 머무는 경우가 있습니다.", "evidence": []}, {"title": "일정 관리", "detail": "릴리스 설계가 계획보다 조금 늦습니다.", "evidence": []}], "competencies": [{"name": "문제 정의", "signal": "강함", "evidence": []}, {"name": "데이터 분석", "signal": "보통", "evidence": []}, {"name": "커뮤니케이션", "signal": "강함", "evidence": []}, {"name": "실행 관리", "signal": "근거 부족", "evidence": []}], "coaching": "다음 기간에는 일정이 분명한 과제를 맡기고 2주 단위로 진척을 함께 점검해 실행 관리 근거를 쌓으세요."}$j$::jsonb, L;
  exception when others then null;
  end;

  -- 업무플랫폼: 최근에 올라온 다양한 업무 (컨펌·의견·공유 / 보고서·링크·캡처·메모·숫자)
  declare r record; sid uuid;
  begin
    for r in select * from (values
      (m_jung, t3, '연동 설계서 — B사 제외 2개사 안, 의견 부탁드려요', 'note', 'feedback', null::text, E'B사 스펙이 이번 달 안에 들어오기 어려워 보여서, A사·C사 두 곳으로 범위를 줄인 안을 만들었습니다. 목표 영향은 약 -1.4만 명으로 봅니다. 이 방향으로 가도 될지 의견 부탁드려요.', 2),
      (m_jung, t3, 'B사 스펙 회신 지연 현황 (메일 캡처)', 'image', 'share', null, '결제사 회신 메일 캡처 — 11월 둘째 주 이후 가능', 1),
      (m_park, t7, '10월 장애 · 성능 리포트', 'document', 'approval', null, E'10월 장애 · 성능 리포트\n1. 서비스별 단위 비용: 레거시 서버 3.2만 원, 앱 서버 2.6만 원, 파트너 게이트웨이 1.1만 원\n2. 베타 신청 전환율 18%\n3. 11월 제안: 레거시 서버 예산 20% 게이트웨이로 이동', 0),
      (m_park, t7, '성능 대시보드 개편 1차 화면', 'link', 'share', 'https://example.com/dashboard-v1', '요청하신 1차 배포 화면 링크입니다', 3),
      (m_lee, t4, '온보딩 메시지 A/B안', 'document', 'feedback', null, E'A안: 혜택 중심 (첫 결제 15% 적립)\nB안: 기능 안내 중심\n파트너 가입 사용자 대상, 2주 테스트 예정. 어느 쪽이 나을지 의견 주세요.', 1),
      (m_han, t1, 'UT 1차 4명 결과 메모', 'note', 'share', null, E'4명 중 3명이 베타 선공개에 긍정적. 3040 직장인 2명은 새 화면보다 로딩 속도를 더 중요하게 봄.', 4),
      (m_choi, t5, '11월 배포 캘린더', 'link', 'feedback', 'https://example.com/content-calendar-11', '릴리스 주간에 배포를 몰았는데 괜찮을지 봐 주세요', 2),
      (m_kim, t1, '베타 신청 누적 수', 'number', 'share', null, '베타 신청 누적', 0)
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
      ('연동 설계서 — B사 제외 2개사 안, 의견 부탁드려요', $j${
        "depth_score": 1.5,
        "summary": "B사 스펙 회신 지연이라는 문제는 분명히 짚었지만, 범위를 줄이는 것 말고 다른 길(샌드박스·공개 API 문서)을 비교하지 않았고 A사·C사를 고른 근거도 없습니다. 목표 영향 -1.4만 명이 어떻게 나왔는지도 빠져 있습니다.",
        "brief": {"tone": "risk", "text": "권나윤 님이 올린 ’연동 설계서 — B사 제외 2개사 안’은 고민의 깊이가 낮아 보입니다", "why": "범위만 줄이고 대안 비교·선정 근거가 없음"},
        "decisions": [],
        "strengths": [{"section": "본문", "text": "막힌 원인(B사 스펙 회신 지연)과 목표 영향을 먼저 밝혔습니다."}],
        "gaps": [{"section": "본문", "text": "범위 축소 외에 샌드박스·공개 API 문서로 1차안을 만드는 길을 검토하지 않았습니다."},
                 {"section": "본문", "text": "A사·C사를 고른 이유와 -1.4만 명 추정 근거가 없습니다."}],
        "questions": ["B사를 빼지 않고 1차안을 먼저 내는 방법은 검토해 봤나요?", "-1.4만 명은 어떤 가정으로 나온 숫자인가요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      ('10월 장애 · 성능 리포트', $j${
        "depth_score": 3.0,
        "summary": "서비스별 단위 비용을 나란히 놓고 파트너 게이트웨이가 가장 효율적이라는 결론까지 짧고 분명하게 전달합니다. 승인 요청이라 팀장님이 정할 것이 있습니다 — 레거시 서버 예산 20% 이동은 릴리스 주간 트래픽과 맞물려 있어 판단이 필요합니다.",
        "brief": {"tone": "risk", "text": "문가은 님이 요청한 ’10월 장애 · 성능 리포트’에 팀장님이 결정할 사항이 있습니다", "why": "11월 레거시 서버 예산 20%를 게이트웨이로 옮길지"},
        "decisions": ["11월 레거시 서버 예산 20% → 게이트웨이 이동", "릴리스 주간 레거시 서버 예산 예외 여부"],
        "strengths": [{"section": "1. 서비스별 단위 비용", "text": "세 서비스 단위 비용을 같은 기준으로 비교해 결론이 바로 보입니다."}],
        "gaps": [{"section": "3. 11월 제안", "text": "예산 이동이 릴리스 주간 트래픽(레거시 서버 경유)에 주는 영향 추정이 없습니다."}],
        "questions": ["릴리스 주간에도 레거시 서버 예산을 20% 줄이나요?", "게이트웨이 단위 비용 1.1만 원은 B사 연동 이후에도 유지되나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      ('온보딩 메시지 A/B안', $j${
        "depth_score": 2.5,
        "summary": "두 안의 방향(혜택 vs 기능 안내)과 테스트 기간은 정리됐지만, 본인은 어느 안을 권하는지와 무엇으로 승부를 볼지(재방문율·첫 결제) 기준이 없어 결론이 잘 보이지 않습니다.",
        "brief": {"tone": "watch", "text": "홍재원 님이 올린 ’온보딩 메시지 A/B안’은 결론이 잘 안 보입니다", "why": "어느 안을 권하는지·판단 기준이 없음"},
        "decisions": [],
        "strengths": [{"section": "본문", "text": "대상(파트너 가입 사용자)과 테스트 기간을 분명히 했습니다."}],
        "gaps": [{"section": "본문", "text": "성공 지표와 본인 추천안이 빠져 있어 의견을 주기 어렵습니다."}],
        "questions": ["둘 중 어느 쪽이 나을 거라고 보나요, 이유는?", "2주 뒤 무엇을 보고 승자를 정하나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$)
    ) as x(title, c)
    join submissions s on s.team_id = T and s.title = x.title
    join submission_versions v on v.submission_id = s.id and v.version = 1;
    -- 최다은 11월 콘텐츠 캘린더: 보완 요청 (팀원 홈 '지금 할 일'에 뜬다)
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
    select s.id, v.id, T, L, '릴리스 주간에 몰린 건 좋은데, 그 주 QA팀 슬롯이 이미 찼어요. 2건은 앞 주로 당기고, 일정이랑 담당까지 표로 다시 올려 주세요.', now() - interval '20 hours'
    from submissions s join submission_versions v on v.submission_id = s.id where s.team_id = T and s.title = '11월 배포 캘린더';
    update submissions set status = 'needs_work' where team_id = T and title = '11월 배포 캘린더';
  exception when others then null;
  end;
  -- 그룹 스페이스 (23_work_groups 이후에만 들어감): 신제품 런칭 TF · 제휴 채널 확대
  declare wg1 uuid; wg2 uuid; gs uuid; gv1 uuid; gv2 uuid; c1 uuid;
  begin
    insert into work_groups (team_id, name, item_id, created_by, created_at) values (T, '메이저 릴리스 TF', g1, m_kim, now() - interval '20 days') returning id into wg1;
    insert into work_groups (team_id, name, item_id, created_by, created_at) values (T, '파트너 연동 확대', g2, L, now() - interval '15 days') returning id into wg2;
    insert into work_group_members (group_id, user_id, team_id) values (wg1, m_kim, T), (wg1, m_han, T), (wg1, m_choi, T), (wg2, m_jung, T), (wg2, m_lee, T);
    -- TF: 김현정·한수진이 같이 다듬는 키비주얼 시안 (v1 김현정 → v2 한수진)
    insert into submissions (team_id, author_id, item_id, group_id, title, kind, request_type, created_at)
      values (T, m_kim, t1, wg1, '메이저 릴리스 새 홈 화면 시안', 'document', 'feedback', now() - interval '3 days') returning id into gs;
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
      (gs, T, 1, E'홈 화면 시안 2종\nA안: 카드형 + 다크 톤 (정보 밀도)\nB안: 피드형 + 밝은 톤 (2030 공감)\n문구: ”한 화면에 다 보이는 첫 경험”', 'A/B 두 안', m_kim, now() - interval '3 days') returning id into gv1;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at) values
      (gs, gv1, T, m_han, 'UT에서 2030은 B안 같은 피드형에 더 반응했어요. B안 색감을 조금 더 살려 보면 어떨까요?', now() - interval '2 days 20 hours') returning id into c1;
    insert into review_comments (submission_id, version_id, team_id, author_id, parent_id, body, created_at) values
      (gs, gv1, T, m_kim, c1, '좋아요. 그럼 B안 기준으로 톤 올려서 v2 만들어 볼게요.', now() - interval '2 days 18 hours'),
      (gs, gv1, T, m_choi, c1, '배포 쪽에서도 B안이 공통 컴포넌트로 쓰기 편해요.', now() - interval '2 days 16 hours');
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
      (gs, T, 2, E'홈 화면 시안 — B안 발전\n피드형 구성, 밝은 톤을 한 단계 올림\n태블릿 레이아웃 버전 포함 (가로, 세로)\n문구: ”한 화면에 다 보이는 첫 경험”', 'B안 톤 보강 · 태블릿 레이아웃 추가 (안소율)', m_han, now() - interval '1 day') returning id into gv2;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at) values
      (gs, gv2, T, L, '방향 좋습니다. 베타 안내 첫 화면에도 같은 구성을 쓸 수 있는지 QA팀과 확인해 주세요.', now() - interval '20 hours'),
      (gs, gv2, T, m_kim, '확인해서 내일까지 답 드릴게요.', now() - interval '6 hours');
    update submissions set status = 'in_review' where id = gs;
    -- 제휴: 공유만
    insert into submissions (team_id, author_id, item_id, group_id, title, kind, request_type, created_at)
      values (T, m_jung, t3, wg2, '파트너 연동 오픈 일정', 'note', 'share', now() - interval '2 days') returning id into gs;
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
      (gs, T, 1, E'A사 11/12~11/25, C사 11/19~12/2 연동 오픈\n가입 사용자 온보딩 메시지는 11/10까지 확정 필요', '', m_jung, now() - interval '2 days');
    insert into review_comments (submission_id, team_id, author_id, body, created_at) values
      (gs, T, m_lee, '온보딩 메시지는 A/B 결과 보고 11/8까지 확정할게요.', now() - interval '1 day');
  exception when others then null;
  end;
  -- 업무 스페이스 대화 (24_work_space 이후에만 들어감)
  declare c1 uuid; wg uuid;
  begin
    select id into wg from work_groups where team_id = T and name = '메이저 릴리스 TF';
    insert into space_messages (team_id, space_user, author_id, item_id, body, created_at)
      values (T, m_choi, m_choi, t5, 'QA팀 주간 고정 슬롯 확정됐어요 — 매주 화 오후 2시간', now() - interval '26 hours') returning id into c1;
    insert into space_messages (team_id, space_user, author_id, parent_id, body, created_at)
      values (T, m_choi, L, c1, '좋아요, 이걸로 리드타임이 얼마나 줄지 다음 주에 같이 봐요.', now() - interval '25 hours');
    insert into space_messages (team_id, space_user, author_id, body, created_at) values
      (T, m_choi, L, '내일 오전 주간회의 10시로 당겨졌어요. 참고하세요!', now() - interval '22 hours'),
      (T, m_choi, m_choi, '네 확인했습니다 👍', now() - interval '21 hours'),
      (T, m_jung, L, 'B사 회신 오면 바로 알려 줘요. 급하면 메시지로 먼저 줘도 됩니다.', now() - interval '30 hours');
    if wg is not null then
      insert into space_messages (team_id, group_id, author_id, item_id, body, created_at)
        values (T, wg, m_han, t1, 'UT 2차 4명 다음 주 화요일로 확정됐어요. 홈 화면 B안도 같이 보여 줄게요.', now() - interval '28 hours') returning id into c1;
      insert into space_messages (team_id, group_id, author_id, parent_id, body, created_at) values
        (T, wg, m_kim, c1, '좋아요! 반응 좋으면 B안으로 바로 굳히죠.', now() - interval '27 hours'),
        (T, wg, m_choi, c1, '태블릿 레이아웃도 같이 보여 주면 좋을 것 같아요.', now() - interval '26 hours');
      insert into space_messages (team_id, group_id, author_id, body, created_at) values
        (T, wg, m_choi, '베타 신청 페이지 문구 초안은 이번 주 금요일까지 올릴게요.', now() - interval '5 hours');
    end if;
  exception when others then null;
  end;
  -- 히스토리 관리 (30_history 이후에만 들어감): 과제 3개 히스토리 + 한수진 님에게 전달 1건 · 질문/답
  declare h_tmpl text; h_txt text; h_m text; h_sh uuid;
  begin
    for h_tmpl in select x from (values
      -- 제휴 프로모션 제안서 (정우성)
      (t3::text || '|' || $j${"summary":"3개사 연동으로 시작했다가 B사 결제 API 스펙 회신 지연으로 A·C 2개사 축소안 검토 중. 범위 결정과 온보딩 메시지 확정이 다음 단계.",
 "lanes":[{"id":"L1","title":"연동 범위"},{"id":"L2","title":"B사 스펙"},{"id":"L3","title":"A·C 연동 오픈"},{"id":"L4","title":"계정 연동"}],
 "events":[{"id":"V1","lane":"L1","date":"@-30","title":"설계서 v1","kind":"doc","detail":"A·B·C 3개사 API 연동 설계서 초안."},
  {"id":"V2","lane":"L1","date":"@-27","title":"보완: 숫자로","kind":"feedback","detail":"팀장 피드백 — 사별 기대 신규 사용자를 숫자로 제시할 것."},
  {"id":"V3","lane":"L1","date":"@-20","title":"3개사 확정","kind":"decision","detail":"v2 승인. 3개사 동시 진행으로 확정."},
  {"id":"V4","lane":"L2","date":"@-14","title":"스펙 지연","kind":"issue","detail":"B사 결제 API 스펙 회신이 11월 둘째 주 이후로 밀림 (메일 캡처 공유)."},
  {"id":"V5","lane":"L1","date":"@-7","title":"2개사 축소안","kind":"doc","detail":"B사 제외, A·C 2개사로 범위를 줄인 안. 목표 영향 약 −1.4만 명."},
  {"id":"V6","lane":"L3","date":"@-2","title":"일정 공유","kind":"doc","detail":"A사 11/12~25, C사 11/19~12/2 연동 오픈 일정 공유."},
  {"id":"V7","lane":"L4","date":"@-1","title":"온보딩 확정 필요","kind":"issue","detail":"온보딩 메시지를 A/B 결과 보고 11/8까지 확정 (홍재원)."},
  {"id":"V8","lane":"L1","date":"@7","title":"범위 결정","kind":"decision","future":true,"detail":"축소안 채택 여부와 목표치 조정을 함께 결정."},
  {"id":"V9","lane":"L3","date":"@21","title":"A사 오픈","kind":"plan","future":true}],
 "links":[{"from":"V4","to":"V5","label":"지연 → 축소안"},{"from":"V7","to":"V9","label":"시작 조건"}],
 "people":[{"id":"P1","name":"권나윤","org":"결제 · 파트너 연동","scope":"team","role":"담당 · 설계서 작성"},
  {"id":"P2","name":"홍재원","org":"백엔드 · 데이터","scope":"team","role":"온보딩 메시지 확정"},
  {"id":"P3","name":"B사","org":"파트너사","scope":"external","role":"API 스펙 지연","check":true},
  {"id":"P4","name":"A사 연동팀","org":"파트너사","scope":"external","role":"연동 오픈 11/12~"},
  {"id":"P5","name":"C사 개발팀","org":"파트너사","scope":"external","role":"연동 오픈 11/19~","check":true}],
 "fixed":[{"id":"F1","text":"연동 보고는 사별 기대 사용자·비용·리스크를 첫 장에","detail":"설계서 v1 피드백에서 팀장이 정한 보고 기준.","since":"@-27"},
  {"id":"F2","text":"A사 11/12~25, C사 11/19~12/2 연동 오픈","since":"@-2"}],
 "open":[{"id":"O1","text":"진행 범위(A·C 2개사) — 목표치 조정과 함께 결정","detail":"축소안을 채택하면 연내 목표 8만 명 중 약 1.4만 명이 빠짐."},
  {"id":"O2","text":"온보딩 메시지 확정 — A사 오픈 조건"}],
 "risks":[{"id":"K1","text":"B사 스펙 추가 지연 시 2차 합류 불가","detail":"11월 둘째 주 이후에도 수급이 안 되면 연내 합류가 어려움."}],
 "tried":[{"id":"T1","text":"3개사 동시 진행 — B사 스펙 의존이 커서 일정 리스크"}],
 "gaps":[{"id":"G1","text":"B사와 지연 이후 합의 내용 — 기록 없음 → 권나윤 님께 확인"},{"id":"G2","text":"C사 비용 분담 비율 — 기록 없음"}],
 "related":[{"item_id":"@t4","title":"파트너 가입 사용자 계정 연동","why":"온보딩 메시지가 시작 조건"}],
 "progress":{"measure":"percent","unit":"%","target":100,"points":[{"date":"@-30","value":0},{"date":"@-21","value":22},{"date":"@-14","value":26},{"date":"@-7","value":28},{"date":"@0","value":30}]},
 "owner":{"id":null,"name":"권나윤","previous":[]}}$j$),
      -- 런칭 캠페인 기획 (김현정)
      (t1::text || '|' || $j${"summary":"홈 화면은 UT 반응을 근거로 B안(피드형·밝은 톤)으로 좁히는 중. UT 2차와 임원 보고가 다음 고비.",
 "lanes":[{"id":"L1","title":"홈 화면 시안"},{"id":"L2","title":"사용성 테스트"},{"id":"L3","title":"임원 보고"}],
 "events":[{"id":"V1","lane":"L2","date":"@-30","title":"타깃 정의","kind":"decision","detail":"2030 직장인 · 첫 결제 사용자로 타깃 확정."},
  {"id":"V2","lane":"L2","date":"@-10","title":"UT 1차 4명","kind":"doc","detail":"4명 중 3명이 베타 선공개에 긍정적. 3040은 로딩 속도를 더 중요하게 봄."},
  {"id":"V3","lane":"L1","date":"@-3","title":"시안 A/B","kind":"doc","detail":"A안 카드형·다크 톤, B안 피드형·밝은 톤."},
  {"id":"V4","lane":"L1","date":"@-2","title":"B안 기울기","kind":"feedback","detail":"UT에서 2030이 B안에 더 반응 — B안 기준으로 v2."},
  {"id":"V5","lane":"L1","date":"@-1","title":"v2 · 태블릿 레이아웃","kind":"doc","detail":"B안 톤 보강, 태블릿 레이아웃(가로, 세로) 추가."},
  {"id":"V6","lane":"L2","date":"@6","title":"UT 2차","kind":"plan","future":true},
  {"id":"V7","lane":"L3","date":"@38","title":"임원 보고","kind":"plan","future":true}],
 "links":[{"from":"V2","to":"V4","label":"UT 반응 → B안"}],
 "people":[{"id":"P1","name":"류지훈","org":"모바일 앱 개발","scope":"team","role":"담당 · 홈 화면 시안"},
  {"id":"P2","name":"안소율","org":"제품 개발","scope":"team","role":"UT 진행"},
  {"id":"P3","name":"서태민","org":"DevOps · 배포","scope":"team","role":"공통 컴포넌트 반영"},
  {"id":"P4","name":"QA팀","org":"QA","scope":"dept","role":"베타 첫 화면 회귀 테스트","check":true}],
 "fixed":[{"id":"F1","text":"타깃: 2030 직장인 · 첫 결제 사용자","since":"@-30"},{"id":"F2","text":"홈 화면은 B안 기준으로 발전","since":"@-2"}],
 "open":[{"id":"O1","text":"베타 안내 첫 화면에 같은 구성 사용 여부 — QA팀 확인"},{"id":"O2","text":"UT 2차 결과로 B안 확정"}],
 "tried":[{"id":"T1","text":"다크 톤 카드형 A안 — 2030 반응 약함"}],
 "gaps":[{"id":"G1","text":"임원 보고 형식·참석자 — 기록 없음 → 팀장님께 확인"}],
 "progress":{"measure":"children","unit":"%","target":100,"points":[{"date":"@-30","value":20},{"date":"@-10","value":40},{"date":"@0","value":40}]},
 "owner":{"id":null,"name":"류지훈","previous":[]}}$j$),
      -- 콘텐츠 제작 프로세스 개선 (최다은)
      (t5::text || '|' || $j${"summary":"QA팀 고정 슬롯 확보 후 리드타임 측정 시작. 평균 2.6주로 목표 2주까지 남은 구간.",
 "lanes":[{"id":"L1","title":"프로세스"},{"id":"L2","title":"측정"}],
 "events":[{"id":"V1","lane":"L1","date":"@-21","title":"고정 슬롯","kind":"decision","detail":"QA팀 주간 고정 슬롯 확정 (화 오후 2시간)."},
  {"id":"V2","lane":"L2","date":"@-14","title":"리드타임 측정","kind":"doc","detail":"측정 시작 — 평균 9일."},
  {"id":"V3","lane":"L2","date":"@-5","title":"월 배포 건수","kind":"doc","detail":"지표 추가, 4건 시범 적용."},
  {"id":"V4","lane":"L1","date":"@20","title":"마감 연장 요청","kind":"plan","future":true,"detail":"CI 도구 업체 교체로 2주 연장 요청."}],
 "people":[{"id":"P1","name":"서태민","org":"DevOps · 배포","scope":"team","role":"담당"},{"id":"P2","name":"QA팀","org":"QA","scope":"dept","role":"주간 고정 슬롯"},{"id":"P3","name":"CI 도구 업체","scope":"external","role":"교체 중","check":true}],
 "fixed":[{"id":"F1","text":"QA팀 주간 고정 슬롯 (화 오후 2시간)","since":"@-21"}],
 "open":[{"id":"O1","text":"마감 2주 연장 · 롤백 가이드 다음 분기 이관 여부"}],
 "risks":[{"id":"K1","text":"CI 도구 업체 교체로 파이프라인 정비 지연"}],
 "gaps":[],
 "progress":{"measure":"percent","unit":"%","target":100,"points":[{"date":"@-21","value":45},{"date":"@-14","value":55},{"date":"@-5","value":66}]},
 "owner":{"id":null,"name":"서태민","previous":[]}}$j$)
    ) v(x) loop
      h_txt := split_part(h_tmpl, '|', 2);
      for h_m in select m from (select distinct (regexp_matches(h_txt, '@(-?\d+)', 'g'))[1] m) z order by length(m) desc loop
        h_txt := replace(h_txt, '@' || h_m, to_char(current_date + h_m::int, 'YYYY-MM-DD'));
      end loop;
      h_txt := replace(h_txt, '@t4', t4::text);
      insert into task_histories (item_id, team_id, content, synced_at, record_count, new_count, updated_at)
        values (split_part(h_tmpl, '|', 1)::uuid, T, h_txt::jsonb, now() - interval '2 days', 24, 3, now() - interval '2 days')
        on conflict (item_id) do nothing;
    end loop;
    update task_histories set edits = '{"pinned":["F1"]}'::jsonb where item_id = t3;
    -- 런칭 캠페인 기획 → 한수진 (FGI 진행을 함께 맡음)
    insert into history_shares (team_id, item_id, from_id, to_id, note, snapshot, status, sent_at, created_at)
      select T, t1, L, m_han, '소율 님, UT 2차부터 같이 봐 주세요. 홈 화면은 B안으로 기울어 있으니 그 기준으로 질문지를 다듬으면 됩니다.', content, 'sent', now() - interval '1 day', now() - interval '1 day'
        from task_histories where item_id = t1 returning id into h_sh;
    insert into history_messages (share_id, team_id, author_id, body, created_at) values
      (h_sh, T, m_han, 'UT 2차도 4명으로 하나요? 3040 비중을 늘릴지 궁금합니다.', now() - interval '20 hours'),
      (h_sh, T, L, '4명 유지하고 3040을 2명으로 맞춰 주세요. 로딩 속도 질문은 꼭 넣어 주세요.', now() - interval '18 hours');
    -- 김현정 님이 요청한 히스토리 (팀장 확인 대기)
    insert into history_shares (team_id, item_id, to_id, note, status, created_at)
      values (T, t3, m_kim, '파트너 연동과 릴리스 일정이 겹쳐서 흐름을 알고 싶어요', 'requested', now() - interval '3 hours');
  exception when others then null;
  end;
  -- 성과 체크인 (22_checkin 이후에만 들어감): 최다은 '배포 프로세스 개선' 승인 3건 + 승인 대기 1건
  declare ck uuid; r record;
  begin
    for r in select * from (values (45, '30%', 21, 'QA팀 고정 슬롯 확보, 1차 프로세스 문서 공유'), (55, '45%', 14, '리드타임 측정 시작 — 평균 9일'), (66, '55%', 5, '월 배포 건수 지표 추가, 4건 시범 적용'))
                    as x(v, prev, ago, note) loop
      insert into submissions (team_id, author_id, item_id, space_id, title, kind, request_type, created_at)
        values (T, m_choi, t5, m_choi, '성과입력 · 배포 프로세스 개선 ' || r.v || '%', 'checkin', 'approval', now() - (r.ago || ' days')::interval) returning id into ck;
      insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, value, checkin, created_at)
        values (ck, T, 1, r.note, r.note, m_choi, r.v, jsonb_build_object('type', 'percent', 'value', r.v, 'prev', r.prev, 'label', r.v || '%'), now() - (r.ago || ' days')::interval);
      update submissions set status = 'approved', approved_by = L, updated_at = now() - (r.ago || ' days')::interval + interval '4 hours' where id = ck;
    end loop;
    insert into submissions (team_id, author_id, item_id, space_id, title, kind, request_type, created_at)
      values (T, m_choi, t5, m_choi, '성과입력 · 배포 프로세스 개선 75%', 'checkin', 'approval', now() - interval '3 hours') returning id into ck;
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, value, checkin, created_at)
      values (ck, T, 1, '샘플 3건 리드타임 9일 → 6일', '샘플 3건 리드타임 9일 → 6일', m_choi, 75, jsonb_build_object('type', 'percent', 'value', 75, 'prev', '66%', 'label', '75%'), now() - interval '3 hours');
  exception when others then null;
  end;
end $fn$;
revoke all on function public.seed_demo_team(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.seed_demo_team(uuid, uuid, uuid[]) to service_role;















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
  pw   text := 'demo123';   -- ← 비밀번호
  dom  text := 'ateam.com';
  cast_ text[][] := array[['demo_dev','백승우'], ['demo_dev_p1','류지훈'], ['demo_dev_p2','문가은'], ['demo_dev_p3','서태민'], ['demo_dev_p4','권나윤'], ['demo_dev_p5','홍재원'], ['demo_dev_p6','안소율']];
  ids  uuid[] := '{}';
  uid  uuid;
  L    uuid;
  members uuid[] := '{}';
  T    uuid;
  col  text;
  i    int;
  keep_ boolean := false;
  pass int;
  r    record;
begin
  perform set_config('search_path', 'public, extensions', true);

  -- 0-a) 계정 7개가 다 있으면: 계정은 두고 기록만 지운다 (데모 팀 ID도 다시 쓴다)
  select count(*) = array_length(cast_, 1) into keep_ from generate_series(1, array_length(cast_, 1)) g join auth.users u on u.email = cast_[g][1] || '@' || dom;
  if keep_ then
    select array_agg(u.id order by g) into ids from generate_series(1, array_length(cast_, 1)) g join auth.users u on u.email = cast_[g][1] || '@' || dom;
    L := ids[1];
    select id into T from public.teams where owner_id = L and is_demo order by created_at limit 1;
    delete from public.teams where owner_id = any(ids) or (is_demo and id in (select team_id from public.team_members where user_id = any(ids)));
    -- 팀에 묶이지 않은 개인 기록도 지운다 (구독 · 결제 · 원가 기록 · 관리자 등록은 둔다)
    for pass in 1..4 loop
      for r in
        select c.conrelid::regclass as tbl, a.attname as col_
        from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
          and c.conrelid::regclass::text not in ('subscriptions', 'credit_balances', 'credit_ledger', 'payments', 'app_admins', 'public.subscriptions', 'public.credit_balances', 'public.credit_ledger', 'public.payments', 'public.app_admins')
      loop
        begin
          execute format('delete from %s where %I = any($1)', r.tbl, r.col_) using ids;
        exception when foreign_key_violation then null;
        end;
      end loop;
    end loop;
    delete from public.subscriptions where owner_id = L;
  end if;

  -- 0) 이전 데모 정리 (이 스크립트로 만든 계정 + 예전 '데모 팀 만들기' 기능으로 만든 것) — 계정을 새로 만들 때만
  if not keep_ then
  --    데모 주소만 정확히 고른다 (같은 도메인의 실제 사용자는 건드리지 않음) + 예전 @demo.ateam 계정
  select coalesce(array_agg(id), '{}') into ids from auth.users
    where email = 'demo_dev@' || dom or email ~ ('^demo_dev_p[0-9]+@' || replace(dom, '.', '\.') || '$') ;
  if to_regclass('public.demo_accounts') is not null then
    execute 'select coalesce(array_agg(user_id), ''{}'') from public.demo_accounts' into members;
    ids := ids || members;
    members := '{}';
  end if;
  perform pg_temp.purge_demo_users(ids);
  drop table if exists public.demo_accounts;
  ids := '{}'; L := null; T := null;
  end if;

  -- 1) 계정 (이메일 확인 완료, 비밀번호 로그인) — 이미 다 있으면 그대로 쓴다 (위 0)에서 지우지 않았다)
  if L is not null then
    for i in 1..array_length(cast_, 1) loop
      select id into uid from auth.users where email = cast_[i][1] || '@' || dom;
      update auth.users set encrypted_password = crypt(pw, gen_salt('bf')), raw_user_meta_data = jsonb_build_object('full_name', cast_[i][2]), updated_at = now() where id = uid;
      update public.profiles set full_name = cast_[i][2] where id = uid;
      if i > 1 then members := members || uid; end if;
    end loop;
  else
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
  end if;
  -- 로그인 서버는 토큰 칸이 NULL이면 오류를 내므로 빈 문자열로 (버전에 따라 있는 칸만)
  for col in select column_name from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and is_nullable = 'YES'
               and column_name in ('email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %I = '''' where (email = $1 or email ~ $2) and %I is null', col, col) using 'demo_dev@' || dom, '^demo_dev_p[0-9]+@' || replace(dom, '.', '\.') || '$';
  end loop;

  -- 2) 팀장 구독 (Pro, 1년) + 데모 팀 + 기록
  insert into public.subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (L, 'pro', 'active', null, now(), now() + interval '1 year');
  -- 팀 ID는 예전 것을 다시 쓴다 (보고 있던 화면의 팀 선택이 그대로 맞도록)
  insert into public.teams (id, name, owner_id, is_demo) values (coalesce(T, gen_random_uuid()), '제품개발팀 (데모)', L, true) returning id into T;
  perform public.seed_demo_team(T, L, members);
end $$;

select u.email as "데모 계정", p.full_name as "이름", tm.role as "역할", tm.job_title as "직무"
from auth.users u join public.profiles p on p.id = u.id join public.team_members tm on tm.user_id = u.id
where u.email = 'demo_dev@ateam.com' or u.email ~ '^demo_dev_p[0-9]+@ateam\.com$' order by tm.role = 'leader' desc, tm.joined_at;


do $$
declare r record; v_jung uuid; v_lee uuid; v_goal uuid; v_exec uuid;
begin
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo and t.name = '제품개발팀 (데모)' loop
    if exists (select 1 from leader_notes where team_id = r.team_id) then continue; end if;
    select tm.user_id into v_jung from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '권나윤' limit 1;
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '홍재원' limit 1;
    select id into v_goal from work_items where team_id = r.team_id and parent_id is null and title like '파트너%' limit 1;
    select id into v_exec from executives where team_id = r.team_id order by sort limit 1;
    insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, pinned, created_at, updated_at) values
      (r.team_id, r.leader_id, '분기 마감 전 팀 회고는 짧게 30분 — 잘된 것 1개, 바꿀 것 1개만', 'note', 'none', null, true, now() - interval '6 days', now() - interval '6 days'),
      (r.team_id, r.leader_id, '본부장 주간회의 전에 파트너 연동 전망 숫자 다시 확인', 'todo', 'none', null, false, now() - interval '1 day', now() - interval '1 day');
    if v_jung is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '혼자 끙끙 앓는 편. 막히면 먼저 물어봐 주는 게 효과 있음', 'member', v_jung, '권나윤', true, now() - interval '9 days', now() - interval '9 days'); end if;
    if v_lee is not null then insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, created_at, updated_at)
      values (r.team_id, r.leader_id, '다음 1on1에서 교육 예산 얘기 꺼내기', 'todo', 'member', v_lee, now() - interval '3 days', now() - interval '3 days'); end if;
    if v_goal is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, 'B사 말고 C사 연동 가능성도 열어 두기 — 사업개발본부 박 팀장에게 물어보기', 'item', v_goal, true, now() - interval '2 days', now() - interval '2 days'); end if;
    if v_exec is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '숫자는 항상 지난달 대비로. 표보다 한 줄 결론을 먼저', 'exec', v_exec, true, now() - interval '5 days', now() - interval '5 days'); end if;
  end loop;
end $$;

do $$
declare r record; v_lee uuid;
begin
  for r in select t.id team_id from teams t where t.is_demo and t.name = '제품개발팀 (데모)' loop
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '홍재원' limit 1;
    if v_lee is null or exists (select 1 from coaching_notes where team_id = r.team_id) then continue; end if;
    alter table coaching_notes disable trigger t_coaching_notify;
    insert into coaching_notes (team_id, member_id, title, body, created_at) values (r.team_id, v_lee,
      '계정 연동, 진척을 한 번 정리해 볼까요?',
      E'요즘 흐름\n’파트너 가입 사용자 계정 연동’을 혼자 맡아 진행하고 있어요. 계획보다 조금 늦어지고 있고, 최근에는 진척 공유가 뜸해요.\n\n특히 짚고 싶은 것\n· ’파트너 가입 사용자 계정 연동’ — 지금까지 한 것과 남은 것이 기록으로 잘 보이지 않아요\n\n왜 중요해요\n파트너 연동 목표와 이어진 과제라, 진행 상황이 보여야 필요한 도움을 제때 받을 수 있어요.\n\n점검해 볼 것\n· 지금까지 한 것과 남은 것을 짧게 정리할 수 있는지\n· 막힌 부분이 있다면 무엇이 필요한지 정리돼 있는지\n\n권장 시점 · 이번 주 금요일까지',
      now() - interval '2 days');
    -- 김현정: 받은함 예시 (확인 전)
    insert into coaching_notes (team_id, member_id, title, body, created_at)
    select r.team_id, tm.user_id, '설계서, 근거를 한 번 더 받쳐 볼까요?',
      E'요즘 흐름\n’메이저 릴리스 설계’ 결과물을 꾸준히 올리고 있어요. 내용은 충실한데, 주장에 비해 근거가 좀 약하고 구조화가 덜 되어 있어요.\n\n특히 짚고 싶은 것\n· ’하반기 앱 메이저 릴리스 설계서’의 일괄 출시 이유 부분 — 주장을 받치는 근거가 보이지 않아요\n\n왜 중요해요\n읽는 사람이 근거를 따라갈 수 있어야 내용이 그대로 설득력을 가져요.\n\n점검해 볼 것\n· 핵심 주장마다 근거(숫자 · 사례 · 출처)를 한 줄 붙일 수 있는지\n· 이 장만 읽어도 무엇을 말하려는지 보이는지\n\n권장 시점 · 다음 결과물을 올리기 전',
      now() - interval '1 day'
    from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '류지훈' limit 1;
    alter table coaching_notes enable trigger t_coaching_notify;
  end loop;
end $$;

do $$
declare r record; v_choi uuid;
begin
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo and t.name = '제품개발팀 (데모)' loop
    select tm.user_id into v_choi from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '서태민' limit 1;
    if v_choi is null or exists (select 1 from leader_notes where team_id = r.team_id and '초대 메모' = any(tags)) then continue; end if;
    insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, tags, created_at, updated_at)
    values (r.team_id, r.leader_id, E'강점: 배포 자동화가 빠르고 아이디어가 많음\n보완할 점: 일정이 밀릴 때 공유가 늦음', 'member', v_choi::text, '서태민', true,
            array['초대 메모'], now() - interval '40 days', now() - interval '40 days');
  end loop;
end $$;












do $$
declare
  r record; v_users uuid[]; s record; n int; v_quarter jsonb; v_ways jsonb; v_kh text := '보고서 한 장 요약 양식';
  v_kim uuid; v_choi uuid; v_han uuid; v_jung uuid; t0 timestamptz; v_msg uuid; v_item uuid;
  asks text[] := array[
    '팀장님, 연동 설계서 B사 스펙이 계속 안 와서요. B사를 빼고 A·C 2개사 안으로 먼저 낼지, 스펙 올 때까지 일주일 더 기다릴지 정해 주시면 그에 맞춰 일정 다시 잡겠습니다.',
    '베타 신청이 목표 대비 37%라서 외부 QA 예산 일부를 베타 모집 인앱 이벤트 개발로 옮기면 어떨까 싶어요. 300만 원 정도 옮겨도 될지 금요일까지 컨펌 부탁드려요.'];
  fb text[] := array[
    '내용은 충실한데 결론이 3페이지에 있어서 찾느라 시간이 걸렸어요. 첫 문단에 결론부터 써 주세요.',
    '전환율 수치가 언제 기준인지 빠져 있어요. 출처랑 기준일을 같이 적어 주세요.',
    '방향은 동의해요. 다만 왜 이 방식인지 근거 데이터를 한 장 붙여 주면 위에 올리기 쉬워요.',
    '이건 CS팀 일정이랑 겹칠 수 있어요. 올리기 전에 CS팀과 먼저 맞춰 주세요.'];
begin
  if to_regclass('public.simbox_messages') is null then raise notice '36_workspace_plus 를 먼저 Run 하세요 — 데모 확장 기록은 건너뜁니다'; return; end if;
  for r in select t.id team_id, t.name, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo and t.name = '제품개발팀 (데모)' loop
    select tm.user_id into v_kim  from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '류지훈' limit 1;
    select tm.user_id into v_choi from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '서태민' limit 1;
    select tm.user_id into v_jung from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '권나윤' limit 1;
    select tm.user_id into v_han  from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '안소율' limit 1;

    -- 0) 이 블록이 전에 넣은 것 지우기
    delete from review_comments where team_id = r.team_id and author_id = r.leader_id and body = any(fb);
    delete from knowhow_cards where team_id = r.team_id and title = v_kh;
    delete from team_directions where team_id = r.team_id;
    delete from simbox_messages where team_id = r.team_id;
    delete from simbox_usage where team_id = r.team_id;
    delete from simbox_tags where team_id = r.team_id;
    delete from space_messages where team_id = r.team_id and body = any(asks);
    if to_regclass('public.decision_asks') is not null then execute 'delete from decision_asks where team_id = $1' using r.team_id; end if;

    -- 1) 팀장 결과물 의견 4건 (서로 다른 결과물) → '팀장님이 일하는 방식'이 실제 데이터로도 2번 이상
    n := 0;
    for s in
      select sb.id, (select v.id from submission_versions v where v.submission_id = sb.id order by v.version desc limit 1) ver
        from submissions sb
       where sb.team_id = r.team_id and sb.author_id <> r.leader_id
         and not exists (select 1 from review_comments c where c.submission_id = sb.id and c.author_id = r.leader_id)
       order by sb.created_at desc limit 4
    loop
      n := n + 1;
      insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
      values (s.id, s.ver, r.team_id, r.leader_id, fb[n], now() - make_interval(days => 6 + n * 9));
    end loop;

    -- 2) 새로 공유된 팀 노하우 (3일 전) → 팀 방향 '최근 바뀐 것' · NEW
    insert into knowhow_cards (team_id, owner_id, kind, title, body, rules, applies_to, keywords, pinned, shared, provenance, use_count, created_at)
    values (r.team_id, r.leader_id, 'framework', v_kh,
      '팀장님께 올리는 보고서는 첫 장을 한 장 요약으로 시작한다. 요약에는 결론 · 숫자 3개(기준일 포함) · 정해 줬으면 하는 것 · 다음 단계를 넣는다.',
      '["결론 한 줄", "핵심 숫자 3개와 기준일", "정해 줬으면 하는 것", "다음 단계와 날짜"]'::jsonb, '{report,review}', '{보고,요약,한장}', false, true, 'human', 0, now() - interval '3 days');

    -- 3) 팀 방향 (허용 목록 방식과 같은 모양)
    select coalesce(jsonb_agg(jsonb_build_object('text', g.title, 'why', coalesce(g.sub, ''), 'source', '팀 목표',
             'date', to_char(g.updated_at, 'YYYY-MM-DD'), 'repeat', 1, 'new', false) order by g.pr, g.sort), '[]'::jsonb)
      into v_quarter
      from (select w.title, w.updated_at, w.sort, coalesce(w.priority, 9) pr,
                   (select string_agg(m.title || coalesce(' ' || to_char(m.num_target, 'FM999,999,990.##') || coalesce(m.unit, ''), ''), ' · ')
                      from (select * from work_items k where k.parent_id = w.id and k.role = 'metric' and k.status <> 'dropped' order by k.sort limit 3) m) sub
              from work_items w
             where w.team_id = r.team_id and w.parent_id is null and w.status not in ('done', 'dropped', 'proposed')
             order by coalesce(w.priority, 9), w.sort limit 4) g;
    v_ways := jsonb_build_array(
      jsonb_build_object('text', '주장에는 근거 자료를 붙여 주세요', 'why', '왜 그렇게 판단했는지 바로 확인할 수 있게', 'source', '보고 · 문서', 'date', to_char(current_date - 15, 'YYYY-MM-DD'), 'repeat', 3, 'new', false),
      jsonb_build_object('text', '결론을 첫 문단에 써 주세요', 'why', '읽는 사람이 가장 먼저 알아야 할 것부터 보이게', 'source', '보고 · 문서', 'date', to_char(current_date - 15, 'YYYY-MM-DD'), 'repeat', 2, 'new', false),
      jsonb_build_object('text', '숫자에는 출처와 기준일을 함께 적어 주세요', 'why', '숫자를 믿고 바로 쓸 수 있게', 'source', '보고 · 문서', 'date', to_char(current_date - 24, 'YYYY-MM-DD'), 'repeat', 2, 'new', false),
      jsonb_build_object('text', '유관부서와 미리 맞춰 주세요', 'why', '마지막에 뒤집히는 일을 줄이려고', 'source', '소통', 'date', to_char(current_date - 6, 'YYYY-MM-DD'), 'repeat', 2, 'new', false));
    insert into team_directions (team_id, status, updated_at, content)
    values (r.team_id, 'ready', now(), jsonb_build_object(
      'title', replace(r.name, ' (데모)', '') || ' — 지금 중요하게 보는 것',
      'generated_at', now(),
      'sections', jsonb_build_array(
        jsonb_build_object('key', 'quarter', 'title', '이번 분기 방향', 'sub', '팀 목표', 'items', v_quarter),
        jsonb_build_object('key', 'ways', 'title', '팀장님이 일하는 방식', 'sub', '결과물 의견 · 요청에서 2번 이상 나온 기준', 'items', v_ways),
        jsonb_build_object('key', 'changes', 'title', '최근 바뀐 것', 'sub', '2주 안에 새로 생긴 목표 · 노하우', 'items', jsonb_build_array(
          jsonb_build_object('text', v_kh, 'why', '팀 노하우로 공유됐습니다', 'source', '팀 노하우', 'date', to_char(current_date - 3, 'YYYY-MM-DD'), 'repeat', 1, 'new', true))))));

    -- 4) Sim.Box 예시 대화 (각자 본인만 보임 · 사람 이름 없음)
    if v_jung is not null then   -- 막힌 일 도움 요청 (팀원 화면 기본 계정)
      t0 := now() - interval '3 hours';
      insert into simbox_messages (team_id, user_id, role, body, attachment, meta, created_at) values
      (r.team_id, v_jung, 'user', '결제사 API 스펙이 2주째 안 와서 연동 설계서가 멈춰 있어요. 혼자 더 붙잡고 있어야 할지, 팀장님께 도움을 요청해야 할지 모르겠어요. 요청한다면 어떻게 말씀드리면 좋을까요?', null, null, t0),
      (r.team_id, v_jung, 'assistant',
       '2주째 같은 이유로 막혀 있다면 지금 요청하는 게 맞아요. 팀 방향의 일하는 방식에도 막히면 일찍 공유하라는 기준이 있어요. 외부 스펙 문제는 혼자 풀기 어려운 일이라, 늦게 꺼낼수록 일정만 더 밀려요. 말씀드릴 때는 지금 상태와 영향, 이미 해 본 것, 팀장님께 바라는 것 한 가지 순서로 짧게 정리해 보세요. 스펙 없이 먼저 진행할 수 있는 부분이 있는지도 함께 제안하면, 도움 요청이 아니라 해결안 보고로 받아들여져요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('요청 메시지 초안 써 줘', '스펙 없이 먼저 할 수 있는 일 정리해 줘'),
         'panel', jsonb_build_object('title', '도움 요청 — 연동 설계서 막힘',
           'questions', jsonb_build_array(
             jsonb_build_object('q', '언제부터, 무엇 때문에 멈춰 있나요?', 'tip', '요청한 날짜 · 받기로 한 날짜 · 지금까지 연락한 횟수'),
             jsonb_build_object('q', '이대로면 목표에 어떤 영향이 있나요?', 'tip', '설계서 일정이 밀릴 때 신규 사용자 목표에 생기는 차이'),
             jsonb_build_object('q', '팀장님이 무엇을 해 주시면 풀리나요?', 'tip', '윗선 협조 요청 · 일정 조정 · 대체 연동 경로 중 하나로')),
           'fixes', jsonb_build_array(
             jsonb_build_object('t', '바라는 것을 하나로', 'd', '여러 가지를 늘어놓기보다 가장 필요한 한 가지를 먼저'),
             jsonb_build_object('t', '먼저 할 수 있는 일 함께', 'd', '스펙 없이 진행 가능한 부분과 그 일정')),
           'good', jsonb_build_array(jsonb_build_object('t', '막힌 이유가 분명함', 'd', '본인 일정 문제가 아니라 외부 의존이라는 점이 드러남')))),
       t0 + interval '18 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_jung, t0);
    end if;

    if v_choi is not null then   -- 결과물 검토 (파일 + 오른쪽 짚어 볼 포인트)
      t0 := now() - interval '2 days 3 hours';
      insert into simbox_messages (team_id, user_id, role, body, attachment, meta, created_at) values
      (r.team_id, v_choi, 'user', '11월 배포 캘린더 초안이에요. 팀장님께 올리기 전에 한번 봐 주세요.',
       jsonb_build_object('name', '11월_배포캘린더_v2.xlsx', 'kind', 'text',
         'digest', '11월 배포 12건 일정. 릴리스 주간(3주차)에 6건 집중. 건당 담당 · 서비스 · 목표 지표(배포 시간 · 롤백률) 표기. QA팀 슬롯 표시 없음. 지난달 실적 비교 없음.'),
       null, t0),
      (r.team_id, v_choi, 'assistant',
       '전체 구성은 탄탄해요. 다만 릴리스 주간에 6건이 몰려 있는데 QA 작업이 가능한지 표시가 없어서, 일정 질문이 먼저 나올 가능성이 높아요. 팀 방향의 일하는 방식에 유관부서와 미리 맞추라는 기준이 있으니 QA팀 확인 여부를 한 줄 넣어 두면 좋겠어요. 목표 지표를 왜 배포 시간 · 롤백률로 잡았는지도 지난달 숫자와 함께 짧게 붙이면 판단이 쉬워져요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('일정 분산안 같이 짜 줘', '지표 근거 한 줄로 써 줘'),
         'panel', jsonb_build_object('title', '11월 배포 캘린더 v2',
           'questions', jsonb_build_array(
             jsonb_build_object('q', '릴리스 주간 6건, QA 작업 가능한가요?', 'tip', 'QA팀 슬롯 확인 결과나 앞 주로 당길 건 표시'),
             jsonb_build_object('q', '배포 시간 · 롤백률을 목표 지표로 잡은 이유는요?', 'tip', '지난달 건당 배포 시간 · 롤백률과 비교')),
           'fixes', jsonb_build_array(
             jsonb_build_object('t', '맨 위에 한 줄 요약', 'd', '몇 건 · 언제 집중 · 기대 효과를 첫 줄에'),
             jsonb_build_object('t', '지난달 실적 열 추가', 'd', '같은 서비스 지난달 숫자와 기준일')),
           'good', jsonb_build_array(jsonb_build_object('t', '건마다 담당 · 서비스가 분명함', 'd', '바로 실행할 수 있는 수준')))),
       t0 + interval '20 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_choi, t0);
    end if;

    if v_kim is not null then    -- 보고 방법 · 타이밍
      t0 := now() - interval '1 day 5 hours';
      insert into simbox_messages (team_id, user_id, role, body, attachment, meta, created_at) values
      (r.team_id, v_kim, 'user', '베타 신청이 목표 대비 많이 밀려 있어요. 이번 주 주간 보고에서 어떻게 꺼내면 좋을까요?', null, null, t0),
      (r.team_id, v_kim, 'assistant',
       '밀린 상황은 숨기기보다 먼저 꺼내는 게 좋아요. 팀 방향의 일하는 방식에 막히면 일찍 공유하고, 숫자에는 기준일을 붙이라는 기준이 있어서 그 순서로 짜 보면 자연스러워요. 첫 줄에 현재 누적과 목표 대비 비율, 다음 줄에 밀린 이유 한두 가지, 마지막에 만회 방안과 팀장님이 정해 주셨으면 하는 것을 두세요. 만회 방안은 하나보다 두 가지를 놓고 고르게 하면 대화가 빨라져요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('보고 첫 문단 같이 써 줘', '만회 방안 두 가지 정리해 줘'),
         'panel', jsonb_build_object('title', '주간 보고 — 베타 신청 현황',
           'questions', jsonb_build_array(
             jsonb_build_object('q', '언제까지 얼마나 따라잡을 수 있나요?', 'tip', '주차별 만회 계획 숫자'),
             jsonb_build_object('q', '유입 경로별로 어디가 제일 약한가요?', 'tip', '앱 배너 · 파트너 유입 비중과 지난주 대비')),
           'fixes', jsonb_build_array(
             jsonb_build_object('t', '결론 먼저', 'd', '누적 · 목표 대비 비율 · 만회 가능 여부를 첫 줄에'),
             jsonb_build_object('t', '정해 줬으면 하는 것 명시', 'd', '예산 추가 · 일정 조정 중 무엇이 필요한지')),
           'good', jsonb_build_array())),
       t0 + interval '15 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_kim, t0);
    end if;

    if v_han is not null then    -- 신규 팀원 · 팀장님 관심사 (자료로 말할 수 있는 만큼만)
      t0 := now() - interval '5 hours';
      insert into simbox_messages (team_id, user_id, role, body, attachment, meta, created_at) values
      (r.team_id, v_han, 'user', '최근 팀장님의 주 관심사는 뭔가요? 합류한 지 얼마 안 돼서 감을 잡고 싶어요.', null, null, t0),
      (r.team_id, v_han, 'assistant',
       '팀 방향과 팀 목표로 보면 지금은 앱 메이저 릴리스가 가장 앞에 있고, 파트너 API 연동 확대와 운영 효율화가 뒤를 잇고 있어요. 일하는 방식에서는 근거 자료를 붙이는 것과 결론을 먼저 쓰는 것이 여러 번 강조됐어요. 다만 팀장님 개인의 생각까지는 자료로 알 수 없어서, 확실하지 않은 부분은 1on1에서 직접 여쭤보는 걸 권해요. 최근에 공유된 보고서 한 장 요약 양식을 먼저 익혀 두면 첫 보고가 한결 수월할 거예요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('1on1에서 물어볼 질문 추려 줘', '한 장 요약 양식으로 연습해 볼래'), 'panel', null),
       t0 + interval '12 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_han, t0);
    end if;

    -- 6) 의사결정 보드 '팀원 요청' — 팀원이 대화에서 물은 결정 (45_decision_asks 이후에만 카드가 된다)
    if v_jung is not null then
      select id into v_item from work_items where team_id = r.team_id and title = '파트너 결제 연동 설계서' limit 1;
      insert into space_messages (team_id, space_user, author_id, item_id, body, created_at)
        values (r.team_id, v_jung, v_jung, v_item, asks[1], now() - interval '2 days 2 hours') returning id into v_msg;
      if to_regclass('public.decision_asks') is not null then
        execute $q$update decision_asks set status = 'ask', classified_at = now(),
          ai = '{"title": "연동 설계서를 B사 빼고 2개사 안으로 먼저 낼지", "options": ["B사 빼고 A·C 2개사 안으로 먼저 제출", "B사 스펙 올 때까지 일주일 더 기다림"], "due": null}'::jsonb
          where src_id = $1$q$ using v_msg;
      end if;
    end if;
    if v_kim is not null then
      select id into v_item from work_items where team_id = r.team_id and title = '릴리스 출시 방식 확정' limit 1;
      insert into space_messages (team_id, space_user, author_id, item_id, body, created_at)
        values (r.team_id, v_kim, v_kim, v_item, asks[2], now() - interval '20 hours') returning id into v_msg;
      if to_regclass('public.decision_asks') is not null then
        execute $q$update decision_asks set status = 'ask', classified_at = now(),
          ai = '{"title": "외부 QA 예산 300만 원을 인앱 이벤트로 옮길지", "options": ["300만 원을 인앱 이벤트 개발로 이동", "옮기지 않고 지금 계획 유지"], "due": "금요일까지"}'::jsonb
          where src_id = $1$q$ using v_msg;
      end if;
    end if;
    -- 다른 데모 대화에서 표현만 걸린 후보는 판별 없이 '아님'으로 (데모에서 AI를 부르지 않게)
    if to_regclass('public.decision_asks') is not null then
      execute $q$update decision_asks set status = 'not', classified_at = now() where team_id = $1 and status = 'candidate'$q$ using r.team_id;
    end if;

    -- 5) 팀장 화면 'Sim.Box 팀 경향' — 이름 · 내용 없이 분류만 (팀원 5명, 분류마다 3명 이상)
    select array_agg(user_id order by joined_at) into v_users
      from (select tm.user_id, tm.joined_at from team_members tm where tm.team_id = r.team_id and tm.role = 'member' and tm.status = 'active' order by tm.joined_at limit 5) x;
    if coalesce(array_length(v_users, 1), 0) >= 5 then
      insert into simbox_tags (team_id, user_id, category, created_at)
      select r.team_id, v_users[u], c.cat, now() - make_interval(days => (u * 3 + c.k * 2) % 27 + 1)
        from (values ('evidence', 1, 5), ('structure', 2, 4), ('reporting', 3, 4), ('stakeholder', 4, 3), ('priority', 5, 3)) c(cat, k, users)
        cross join generate_series(1, 5) u
       where u <= c.users;
      insert into simbox_tags (team_id, user_id, category, created_at)
      select r.team_id, v_users[u], 'evidence', now() - make_interval(days => u + 10) from generate_series(1, 3) u;
    end if;
  end loop;
  -- 팀원 목표 수정 잠금이 기본 — 계획 요청 시드가 자동으로 열어 둔 것을 다시 잠근다
  update teams set settings = coalesce(settings, '{}'::jsonb) || '{"plan_open": false}'::jsonb where is_demo and name = '제품개발팀 (데모)';
end $$;









do $$
declare
  r record; c1 uuid; c2 uuid; v_jung uuid; v_item uuid; t text;
  ch jsonb;
begin
  if to_regclass('public.core_works') is null then raise notice '46_core_works 를 먼저 Run 하세요 — 데모 핵심 업무는 건너뜁니다'; return; end if;
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo and t.name = '제품개발팀 (데모)' loop
    delete from history_shares where team_id = r.team_id and core_work_id is not null;
    delete from core_work_chapters where team_id = r.team_id;
    delete from core_works where team_id = r.team_id;   -- core_work_items 는 함께 지워진다
    delete from core_work_state where team_id = r.team_id;
    select tm.user_id into v_jung from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '권나윤' limit 1;

    -- ---------- 1) 제휴사 파트너십 운영 ----------
    insert into core_works (team_id, title, summary, since_year, dirty, synced_at, updated_at, content) values (r.team_id, '결제 시스템 운영',
      '7년째 A · C사 중심으로 운영 중인 결제 연동. 2021년 B사 정산 분쟁 이후 연동 계약 기준이 정해졌고, 지금은 B사 스펙 회신 지연으로 2026 연동 설계가 막혀 있음.',
      2019, false, now(), now(), $j${
        "eras": [{"name": "탁경훈", "from": "2019-01", "to": "2020-12"}, {"name": "염지수", "from": "2021-01", "to": "2022-05"}, {"name": "문가은", "from": "2022-06", "to": "2024-07"},
                 {"name": "류지훈", "from": "2024-08", "to": "2025-03"}, {"name": "권나윤", "from": "2025-04", "to": null}],
        "principles": [{"text": "정산은 월 1회 · 익월 10일", "year": 2020}, {"text": "계약서에 정산 지연 이자 조항 (B사 분쟁 이후)", "year": 2021},
                       {"text": "결제사에 분기마다 장애 리포트 공유", "year": 2022}, {"text": "결제 데이터는 비식별 집계만 공유", "year": 2024}],
        "recurring": [{"text": "A · C사 재계약 협의 — 2월 말까지 장애 리포트 준비", "when": "매년 3월"}, {"text": "결제사 장애 리포트 발송", "when": "매 분기"},
                      {"text": "다음 해 연동 버전 업그레이드 일정 확정", "when": "매년 11월"}],
        "tried": [{"text": "소규모 결제사 10곳 동시 연동 → 유지보수 부담으로 8곳 종료", "year": 2023}, {"text": "B사 수수료 인상 협상 → API 스펙 공유 조항과 맞바꿔 동결", "year": 2024}],
        "people": [{"text": "A사 연동팀 — 기술 창구 3번 바뀜", "since": 2019}, {"text": "C사 개발본부 — 간편결제 연동 파트너", "since": 2020},
                   {"text": "B사 — 정산 분쟁 이력 · 스펙 회신 느림", "since": 2021}, {"text": "재무팀 — 정산 · 계약 검토", "since": 2021}],
        "open": [{"text": "B사 스펙 공유 주기 — 계약엔 있지만 지켜진 적 드묾", "since": 2024}, {"text": "2개사 축소안으로 연동 먼저 갈지", "since": 2026}],
        "cautions": [{"text": "B사와 정산 이야기는 메일로만 — 2021년 구두 합의가 분쟁 원인"}, {"text": "3월 재계약 전에 담당이 바뀌면 리포트 준비가 밀림"}],
        "gaps": [{"text": "2019 시범 종료 이유 — 기록 없음 → 탁경훈 님(전 담당)에게 확인"}]
      }$j$::jsonb) returning id into c1;

    for ch in select * from jsonb_array_elements($j$[
      {"y": 2019, "t": "결제 연동 첫 시범", "o": "탁경훈", "p": "2019-03 ~ 2019-08", "c": {"summary": "자체 결제 가능성을 보려 3개월 시범", "key": "시범 3개월 · 결제 실패율 2.1%", "decisions": ["A사 1곳으로 시범 시작 — 리스크를 줄이려고"], "results": "실패율 2.1%, 정식 계약 검토로 넘어감", "lessons": ["정산 기준 없이 시작해 월말 정산이 매번 늦어짐"], "carried": ["정산 기준 정하기"], "people": ["A사 연동팀 — 첫 파트너"]}},
      {"y": 2020, "t": "A사 · C사 정식 계약", "o": "탁경훈", "p": "2020-01 ~ 2020-06", "c": {"summary": "A · C사와 1년 단위 정식 계약", "key": "정산 월 1회로 확정", "decisions": ["정산 월 1회 · 익월 10일로 확정 — 재무팀 요청"], "results": "2개사 계약, 월 결제 3천 건", "lessons": [], "carried": ["B사 추가 검토"], "people": ["C사 개발본부 — 간편결제 연동", "재무팀 — 정산 기준"]}},
      {"y": 2021, "t": "B사 정산 분쟁 대응", "o": "염지수", "p": "2021-02 ~ 2021-07", "c": {"summary": "B사 정산 지연 3개월 · 구두 합의 해석 차이로 분쟁", "key": "B사 정산 지연 → 지연 이자 조항", "decisions": ["계약서에 정산 지연 이자 조항 추가", "정산 관련 합의는 메일로만"], "results": "미정산금 회수, 계약 유지", "lessons": ["구두 합의가 분쟁 원인"], "carried": ["계약서 표준화"], "people": ["B사 — 정산 담당 교체 잦음", "재무팀 · 법무팀 — 계약 검토"]}},
      {"y": 2021, "t": "결제 연동 규격 표준화", "o": "염지수", "p": "2021-08 ~ 2021-12", "c": {"summary": "결제사 공통 연동 규격 정리", "decisions": ["공통 어댑터 + 결제사별 모듈"], "results": "신규 연동 기간 3주 → 1주", "lessons": [], "carried": [], "people": ["법무팀"]}},
      {"y": 2022, "t": "결제사 장애 리포트 도입", "o": "문가은", "p": "2022-06 ~ 2022-12", "c": {"summary": "결제사에 분기 장애 리포트를 보내기 시작", "key": "분기 리포트로 관계 안정", "decisions": ["분기마다 리포트 공유"], "results": "재계약 협의가 숫자 중심으로 바뀜", "lessons": [], "carried": ["리포트 준비를 재계약 일정에 맞추기"], "people": ["A사 연동팀 — 창구 교체"]}},
      {"y": 2023, "t": "신규 결제수단 확대", "o": "문가은", "p": "2023-02 ~ 2023-11", "c": {"summary": "결제수단을 늘리려 12곳 접촉", "key": "후보 12곳 중 2곳만 계약", "decisions": ["소규모 10곳 동시 연동 시도"], "results": "유지보수 부담으로 8곳 종료, 2곳만 유지", "lessons": ["소규모 다수 연동은 유지보수 비용이 큼"], "carried": [], "people": []}},
      {"y": 2024, "t": "B사 재계약", "o": "문가은", "p": "2024-01 ~ 2024-04", "c": {"summary": "B사 수수료 인상 요구 속 재계약", "key": "수수료 동결 · 스펙 공유 조항", "decisions": ["수수료 동결 대신 API 스펙 공유 조항 추가", "결제 데이터는 비식별 집계만"], "results": "재계약, 스펙 공유 주기는 계약상 월 1회", "lessons": ["수수료 협상은 스펙 조항과 맞바꾸는 쪽이 통함"], "carried": ["B사 스펙 공유 주기 지키기"], "people": ["B사 — 협상 창구 바뀜"]}},
      {"y": 2024, "t": "결제 계정 연동 1차", "o": "류지훈", "p": "2024-08 ~ 2024-12", "c": {"summary": "결제 사용자를 회원 계정에 처음 연결", "decisions": ["A · C사부터 연동"], "results": "결제 사용자 재방문율 측정 시작", "lessons": [], "carried": ["B사 연동은 스펙 문제로 보류"], "people": ["계정 연동 담당 — 홍재원"]}},
      {"y": 2025, "t": "원클릭 결제 도입", "o": "권나윤", "p": "2025-04 ~ 2025-12", "c": {"summary": "간편결제 사용자 전용 원클릭 결제 운영", "key": "원클릭 결제 · 결제 1.8배", "decisions": ["원클릭 결제 기본 적용"], "results": "결제 건수 1.8배, 신규 4만 명 달성", "lessons": [], "carried": ["2026 파트너 API 연동 확대 제안"], "people": ["C사 — 연동 확대 의향"]}}
    ]$j$::jsonb) loop
      insert into core_work_chapters (team_id, core_work_id, year, title, owner_name, period, content)
      values (r.team_id, c1, (ch->>'y')::int, ch->>'t', ch->>'o', ch->>'p', ch->'c');
    end loop;
    foreach t in array array['파트너 결제 연동 설계서', '파트너 가입 사용자 계정 연동'] loop
      select id into v_item from work_items where team_id = r.team_id and title = t and status <> 'dropped' order by created_at desc limit 1;
      if v_item is not null then
        insert into core_work_items (item_id, core_work_id, team_id, reason)
        values (v_item, c1, r.team_id, case when t = '파트너 결제 연동 설계서' then '관계자 B사 · A사, 지표 ’파트너 신규 사용자’가 같음' else '관계자 B사 · 계정 연동이 2024년 장에서 이어짐' end)
        on conflict (item_id) do update set core_work_id = excluded.core_work_id, reason = excluded.reason;
      end if;
    end loop;

    -- ---------- 2) 신제품 런칭 운영 ----------
    insert into core_works (team_id, title, summary, since_year, dirty, synced_at, updated_at, content) values (r.team_id, '정기 릴리스 운영',
      '해마다 한두 번 메이저 릴리스를 운영. 2024년부터 베타를 먼저 열고 반응을 본 뒤 전체 배포하는 순서가 굳어짐.',
      2023, false, now(), now(), $j${
        "eras": [{"name": "문가은", "from": "2023-03", "to": "2024-06"}, {"name": "류지훈", "from": "2024-07", "to": null}],
        "principles": [{"text": "베타를 먼저 열고 반응을 본 뒤 전체 배포", "year": 2024}, {"text": "1차 공개는 15%를 넘지 않음", "year": 2025}],
        "recurring": [{"text": "출시 6주 전 사용성 테스트", "when": "릴리스마다"}, {"text": "CS팀 FAQ 반영 확인", "when": "출시 2주 전"}],
        "tried": [{"text": "출시 첫 주 일괄 배포 → 초반 장애가 몰리고 평점 급락", "year": 2023}],
        "people": [{"text": "QA팀 — 회귀 테스트 · 주간 고정 슬롯", "since": 2023}, {"text": "CS팀 — FAQ · 일정 충돌 잦음", "since": 2024}],
        "open": [{"text": "베타 신청 목표 대비 37% — 만회 방안", "since": 2026}],
        "cautions": [{"text": "CS팀 FAQ가 늦게 나오면 출시 일정을 확정할 수 없음"}],
        "gaps": []
      }$j$::jsonb) returning id into c2;
    for ch in select * from jsonb_array_elements($j$[
      {"y": 2023, "t": "봄 정기 릴리스", "o": "문가은", "p": "2023-03 ~ 2023-05", "c": {"summary": "봄 정기 릴리스", "key": "첫 주 일괄 배포 → 장애 몰림", "decisions": ["출시 첫 주에 전체 사용자 100% 배포"], "results": "목표 대비 82%", "lessons": ["일괄 배포보다 베타로 반응을 먼저 보는 게 나음"], "carried": ["베타 선공개 도입"], "people": ["QA팀"]}},
      {"y": 2024, "t": "하반기 정기 릴리스", "o": "류지훈", "p": "2024-08 ~ 2024-11", "c": {"summary": "베타를 먼저 연 첫 릴리스", "key": "베타 먼저 · 목표 108%", "decisions": ["베타 4주 → 반응 보고 전체 배포"], "results": "목표 대비 108%", "lessons": [], "carried": [], "people": ["CS팀 — FAQ 지연"]}},
      {"y": 2025, "t": "앱 v4.0 전면 개편 출시", "o": "류지훈", "p": "2025-03 ~ 2025-07", "c": {"summary": "v4.0 전면 개편과 함께한 릴리스", "key": "1차 공개 15% 상한 정함", "decisions": ["1차 공개는 15%를 넘지 않음 — 장애 영향 기준"], "results": "목표 달성", "lessons": [], "carried": [], "people": []}}
    ]$j$::jsonb) loop
      insert into core_work_chapters (team_id, core_work_id, year, title, owner_name, period, content)
      values (r.team_id, c2, (ch->>'y')::int, ch->>'t', ch->>'o', ch->>'p', ch->'c');
    end loop;
    foreach t in array array['메이저 릴리스 설계', '릴리스 출시 방식 확정'] loop
      select id into v_item from work_items where team_id = r.team_id and title = t and status <> 'dropped' order by created_at desc limit 1;
      if v_item is not null then
        insert into core_work_items (item_id, core_work_id, team_id, reason) values (v_item, c2, r.team_id, '릴리스마다 반복되는 베타 신청 · UT · CS팀 FAQ가 같음')
        on conflict (item_id) do update set core_work_id = excluded.core_work_id, reason = excluded.reason;
      end if;
    end loop;

    -- ---------- AI가 한 일 · 전달 ----------
    insert into core_work_state (team_id, status, finished_at, actions) values (r.team_id, 'ready', now(), jsonb_build_array(
      jsonb_build_object('at', now(), 'core_work_id', c1, 'text', '2026 ’파트너 결제 연동 설계서’를 ’결제 시스템 운영’에 묶음 (관계자 B사 · A사, 지표 ’파트너 신규 사용자’가 같음)'),
      jsonb_build_object('at', now(), 'core_work_id', c1, 'text', '2025 ’원클릭 결제 도입’을 장으로 접어 고정'),
      jsonb_build_object('at', now(), 'core_work_id', c1, 'text', '’결제 시스템 운영’ 흐름을 다시 정리 (장 9개 · 진행 중 과제 2개)'),
      jsonb_build_object('at', now(), 'core_work_id', c2, 'text', '2026 ’메이저 릴리스 설계’를 ’정기 릴리스 운영’에 묶음 (베타 신청 · UT · CS팀 FAQ가 같음)')));

    if v_jung is not null then
      insert into history_shares (team_id, core_work_id, from_id, to_id, note, status, sent_at, created_at, snapshot)
      select r.team_id, c1, r.leader_id, v_jung, '결제 쪽은 2021년 B사 건만 알면 반은 이해한 거예요. 3월 재계약 전에 같이 한 번 봐요.', 'sent', now() - interval '1 day', now() - interval '1 day',
             jsonb_build_object('kind', 'core', 'title', w.title, 'summary', w.summary, 'since_year', w.since_year, 'content', w.content || jsonb_build_object('summary', w.summary),
               'tasks', (select coalesce(jsonb_agg(x order by (x->>'year')::int), '[]'::jsonb) from (
                  select jsonb_build_object('year', c.year, 'title', c.title, 'status', 'done', 'key', c.content->>'key') x from core_work_chapters c where c.core_work_id = w.id
                  union all
                  select jsonb_build_object('year', extract(year from coalesce(i.start_date, i.due_date, i.created_at::date))::int, 'title', i.title, 'status', case when i.status = 'blocked' then 'blocked' else 'active' end)
                    from core_work_items l join work_items i on i.id = l.item_id where l.core_work_id = w.id) s))
        from core_works w where w.id = c1;
    end if;
  end loop;
end $$;


-- 데모 팀 표시 (데모 띠의 팀 고르기 · 직급 · 팀원 화면 기본 계정)
update public.teams set settings = coalesce(settings, '{}'::jsonb) || '{"demo_key": "dev", "demo_label": "개발", "demo_ranks": {"류지훈": "차장", "문가은": "과장", "서태민": "대리", "권나윤": "과장", "홍재원": "대리", "안소율": "사원"}, "demo_default_member": "권나윤"}'::jsonb where is_demo and name = '제품개발팀 (데모)';
