-- =====================================================================
-- ATEAM 데모 — 연구개발팀 (데모) · 팀장 서정민 + 팀원 6 · 약 6개월치 기록
-- 06_demo_accounts.sql(마케팅기획팀)을 먼저 Run 한 프로젝트에서 Run. 다시 Run 하면 이 팀만 처음 상태로 돌아갑니다.
-- 계정: demo_rnd@ateam.com · demo_rnd_p1~p6@ateam.com (비밀번호는 06 과 같음) — 자동 생성 파일 (scripts/build-demo-teams.py)
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

  update teams set name = '연구개발팀 (데모)', mission = '시험 데이터를 근거로 소재 개발을 빠르게 검증해, 신규 시제품과 기술 자산을 함께 늘린다',
    parent_link = '2026 회사 전략 목표 「신소재 매출 비중 30% 달성」 · 기여 비중 40%' where id = T;
  insert into team_members (team_id, user_id, role, job_title, joined_at) values (T, L, 'leader', '팀장', now() - interval '200 days')
    on conflict (team_id, user_id) do update set role = 'leader', status = 'active', joined_at = now() - interval '200 days';
  insert into team_members (team_id, user_id, role, job_title, joined_at) values
    (T, m_kim, 'member', '소재 개발', now() - interval '190 days'),
    (T, m_park, 'member', '연구 기획 · 예산', now() - interval '190 days'),
    (T, m_choi, 'member', '연구 과제 관리', now() - interval '180 days'),
    (T, m_jung, 'member', '산학 협력', now() - interval '180 days'),
    (T, m_lee, 'member', '연구 데이터 · LIMS', now() - interval '150 days'),
    (T, m_han, 'member', '소재 개발 (신규)', now() - interval '42 days');

  -- 목표·과제 (자유 계층)
  update teams set settings = settings || '{"level_names":["목표","과제","할 일"],"member_free_edit":false}'::jsonb
    || '{"plan_open": false}'::jsonb where id = T;   -- 팀원 목표 수정은 잠금이 기본 (데모 끝에서 한 번 더 잠근다)
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '하반기 신소재 시제품 개발 성공', 'children', 1, current_date - 60, current_date + 80, 5, now() - interval '60 days') returning id into g1;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '산학 공동연구 확대', 'children', 2, current_date - 90, current_date + 70, 5, now() - interval '90 days') returning id into g2;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '연구 과제 관리 효율화', 'children', 3, current_date - 60, current_date + 100, 3, now() - interval '60 days') returning id into g3;
  insert into hypotheses (team_id, item_id, statement, signal) values
    (T, g1, '표면 코팅으로 내열 성능 20% 이상 향상', '수요처 인터뷰 12곳 중 적용 의향 7곳'),
    (T, g2, 'B대학 공동연구로 연내 과제 수주 8억 원', 'B대학 시험 데이터 회신 2주째 지연'),
    (T, g3, '단계 심사 리드타임 3주 → 2주', '최근 4건 평균 2.6주');
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '시제품 개발 계획', m_kim, 1, 5, 16, 'children', 0, current_date - 45, current_date + 40, 1, now() - interval '45 days') returning id into t1;
  insert into work_items (team_id, parent_id, owner_id, title, measure, status, due_date, sort) values
    (T, t1, m_kim, '타깃 적용처 정의', 'check', 'done', current_date - 30, 1),
    (T, t1, m_kim, '경쟁사 특허 분석', 'check', 'done', current_date - 10, 2),
    (T, t1, m_kim, '시제품 배합 시안 3안', 'check', 'active', current_date + 10, 3),
    (T, t1, m_han, '수요처 인터뷰 12곳', 'check', 'active', current_date + 20, 4),
    (T, t1, m_kim, '임원 보고', 'check', 'active', current_date + 38, 5);
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '시제품 코팅 사양 확정', m_kim, 1, 4, 8, 'percent', 85, current_date - 60, current_date - 5, 2, now() - interval '60 days') returning id into t2;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, status, start_date, due_date, sort, created_at) values
    (T, g2, '공동연구 과제 제안서', m_jung, 1, 5, 6, 'percent', 30, 'blocked', current_date - 30, current_date + 20, 1, now() - interval '30 days') returning id into t3;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g2, '공동연구 데이터 LIMS 연계', m_lee, 2, 4, 6, 'percent', 35, current_date - 40, current_date + 50, 2, now() - interval '40 days') returning id into t4;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '단계 심사 프로세스 개선', m_choi, 2, 4, 10, 'percent', 66, current_date - 50, current_date + 30, 1, now() - interval '50 days') returning id into t5;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '특허 · 인증 관리 체계 정비', m_jung, 3, 1, 18, 'percent', 40, current_date - 90, current_date + 60, 2, now() - interval '90 days') returning id into t6;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, recur, sort, created_at) values
    (T, g3, '월간 연구 진척 · 예산 리포트 운영', m_park, 3, 2, 12, 'recurring', 'monthly', 3, now() - interval '120 days') returning id into t7;
  insert into work_item_logs (item_id, team_id, author_id, kind, period, done) values
    (t7, T, m_park, 'recurring', (v_month - interval '3 months')::date, true), (t7, T, m_park, 'recurring', (v_month - interval '2 months')::date, true),
    (t7, T, m_park, 'recurring', (v_month - interval '1 months')::date, false);
  -- 일정 변경 이력 (재계획 2회)
  update work_items set due_date = current_date + 5, change_reason = '경쟁사 특허 추가 확인' where id = t2;
  update work_items set due_date = current_date + 10, change_reason = '임원 일정' where id = t2;
  -- 진척 기록 (최근 3주 속도)
  insert into work_item_logs (item_id, team_id, author_id, kind, period, value) values
    (t3, T, m_jung, 'progress', current_date - 21, 22), (t3, T, m_jung, 'progress', current_date - 14, 26), (t3, T, m_jung, 'progress', current_date - 7, 28),
    (t4, T, m_lee, 'progress', current_date - 21, 20), (t4, T, m_lee, 'progress', current_date - 14, 27),
    (t5, T, m_choi, 'progress', current_date - 21, 45), (t5, T, m_choi, 'progress', current_date - 14, 55)
    on conflict do nothing;
  -- 팀원이 올린 계획(검토 대기) + 팀장 요청
  insert into work_items (team_id, parent_id, owner_id, title, note, measure, status, start_date, due_date, sort)
    values (T, g2, m_lee, '공동연구 데이터 양식 A/B 시범 적용', '2개 양식 × 2주, 표준 등록률 비교', 'percent', 'proposed', current_date + 3, current_date + 35, 3);
  insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, due_date)
    values (T, L, m_jung, 'plan', g2, '산학 공동연구 확대 — 하위 과제 계획 세워 주세요', '제안서 이후 실행 단계까지 포함해서요', current_date + 3);
  insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, due_date) values
    (T, L, m_park, 'share', t7, '연구 예산 대시보드 개편 화면 캡처 공유해 주세요', '지난주 말씀하신 1차 배포 화면이요. 승인까지는 필요 없습니다.', current_date + 2),
    (T, L, m_han, 'progress', t1, '수요처 인터뷰 진행 상황 업데이트 부탁해요', '몇 곳 했는지, 막히는 게 있는지만 짧게요', current_date + 1);
  -- 팀원 상세 액션: 지원·격려 / 육성 (요청 종류 추가 14_request_kinds 이후에만 들어감)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, title, body, created_at) values
      (T, L, m_lee, 'cheer', '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 같이 볼게요.', '', now() - interval '1 day'),
      (T, L, m_choi, 'grow', '다음 분기에 단계 심사 운영 전체를 맡아 보면 어때요? 해 보고 싶은 범위를 알려 줘요', '', now() - interval '2 days');
    -- 팀원 → 팀장 1on1 요청 (팀원 앱에서 '1on1 요청하기')
    insert into team_requests (team_id, from_id, to_id, kind, title, body, created_at) values
      (T, m_lee, L, 'meeting', 'LIMS 연계 방향이 맞는지 한번 같이 보고 싶어요', '', now() - interval '5 hours');
  exception when others then null;
  end;
  -- 김현정: '팀장님과' 받은함 예시 (열린 것 · 답한 것이 섞이게)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, title, body, due_date, created_at) values
      (T, L, m_kim, 'other', '목요일 30분, 수요처 인터뷰 결과 같이 봐요', '정리 안 된 상태로 가져와도 됩니다', current_date + 2, now() - interval '6 hours'),
      (T, L, m_kim, 'grow', '하반기 신규 소재 과제를 리드해 보면 어때요? 해 보고 싶은 범위를 알려 줘요', '', null, now() - interval '3 days'),
      (T, L, m_kim, 'progress', '진행 상황과 막힌 점 공유 부탁해요', '지금까지 한 것과 남은 것만 짧게요', current_date + 3, now() - interval '1 day');   -- 업무 독려 (과제 없이 → 매니징 보드 Feedback)
    insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, status, response, responded_at, created_at) values
      (T, L, m_kim, 'share', t1, '시제품 개발 계획서 v2 올려 주세요', '임원 보고 전에 한 번 보고 싶어요', 'done', '업무플랫폼에 v2 올렸습니다', now() - interval '19 days', now() - interval '20 days'),
      (T, L, m_kim, 'cheer', null, '임원 보고 준비하느라 고생 많았어요. 이번 주는 조금 쉬어 가요', '', 'done', '감사합니다. 금요일 오후 반차 쓰겠습니다', now() - interval '9 days', now() - interval '10 days');
  exception when others then null;
  end;
  -- 팀원 → 팀장 목표 변경 요청 (22_plan_window 이후에만 들어감)
  begin
    insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, created_at) values
      (T, m_choi, L, 'change', t5, '단계 심사 프로세스 개선 — 마감 2주 연장 요청',
       '외부 분석 기관 교체로 템플릿 정비가 늦어졌습니다. 마감을 2주 미루고, 목표 범위에서 특허 연계 가이드는 다음 분기로 넘기고 싶어요.', now() - interval '1 day');
  exception when others then null;
  end;
  insert into work_item_allocations (item_id, user_id, team_id, share_pct) values
    (t1, m_kim, T, 40), (t1, m_han, T, 30), (t2, m_kim, T, 20), (t3, m_jung, T, 15), (t4, m_lee, T, 20),
    (t5, m_choi, T, 30), (t6, m_jung, T, 45), (t6, m_park, T, 10), (t7, m_park, T, 30);

  insert into metrics (team_id, item_id, name, unit, target, period_start, period_end, cumulative)
    values (T, g2, '산학 공동과제 수주액', '억 원', 20, (v_month - interval '3 months')::date, (v_month + interval '2 months')::date, true) returning id into mt;
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_target, unit, metric_id, sort)
    values (T, g2, m_lee, '산학 공동과제 수주액', 'number', 20, '억 원', mt, 4);
  -- 목표마다 지표(결과를 재는 항목) — 목표 진척은 지표 평균 (23_goal_metrics)
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_current, num_target, unit, sort, start_date, due_date) values
    (T, g1, m_kim, '시제품 내구 시험 누적', 'number', 1840, 5000, '회', 0, current_date - 45, current_date + 40),
    (T, g2, m_lee, '공동연구 데이터 표준 등록률', 'number', 22, 35, '%', 5, current_date - 40, current_date + 50);
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_current, num_target, unit, higher_is_better, sort, start_date, due_date)
    values (T, g3, m_choi, '단계 심사 리드타임', 'number', 6, 5, '일', false, 0, current_date - 50, current_date + 30);
  begin
    execute $q$insert into work_items (team_id, parent_id, owner_id, title, measure, stages, stage_current, sort, start_date, due_date)
      values ($1, $2, $3, '특허 관리 체계 표준화', 'stage', array['착수', '초안', '검증', '확정', '확산'], 2, 1, current_date - 60, current_date + 60)$q$ using T, g3, m_jung;
  exception when others then null;
  end;
  insert into metric_values (metric_id, team_id, period, value) values
    (mt, T, (v_month - interval '3 months')::date, 3.4), (mt, T, (v_month - interval '2 months')::date, 3.6), (mt, T, (v_month - interval '1 months')::date, 4.2);
  insert into metric_pipeline (metric_id, team_id, label, amount, probability, expected_close) values
    (mt, T, 'B대학 소재 물성 공동연구', 4, 0.4, v_month + 45), (mt, T, 'C대학 분석 협약 재계약', 2.5, 0.6, v_month + 30), (mt, T, 'D기술원 공동 실증 과제', 1.5, 0.3, v_month + 50);

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
              case when u.uid = m_kim and i = 1 then '1차 시제품을 표면 코팅 중심으로 바꾸는 방향에 합의. 2번 가설은 수요처 인터뷰로 검증하기로 함.'
                   else '진행 상황 공유, 다음 2주 우선순위 확인' end,
              now() - ((case when u.uid = m_lee then 21 else 7 end) + (i - 1) * 14) * interval '1 day');
    end loop;
  end loop;
  insert into one_on_ones (team_id, leader_id, member_id, scheduled_at) values
    (T, L, m_kim, date_trunc('day', now()) + interval '14 hours'),
    (T, L, m_park, date_trunc('week', now()) + interval '3 days 10 hours');
  insert into action_items (team_id, owner_id, title, due_date, created_by) values
    (T, L, '경쟁사 특허 분석 리포트 공유', current_date - 7, L),
    (T, m_kim, '인터뷰 설계안 초안', current_date + 2, L),
    (T, L, '4분기 연구 예산 재배분 확인', current_date + 4, L);

  -- 팀장 노하우: 일 잘하는 방식 · 좋은 결과물의 기준 (AI 검토 · 코칭 · 1on1 준비 · 보고가 읽는다)
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
      (T, L, 'coaching', '1on1은 사람 먼저', '1on1 첫 10분은 업무가 아니라 컨디션과 어려움을 묻는다. 해결책보다 먼저 듣고, 약속은 하나만 정한다.',
        '["첫 10분은 사람 이야기", "약속은 하나만, 날짜와 함께"]'::jsonb, '{prep}', '{1on1,코칭}', false, false, 'human', 8, now() - interval '2 days', now() - interval '70 days'),
      (T, L, 'context', '하반기 우리 팀 우선순위', '하반기 최우선은 신소재 시제품과 산학 공동연구 확대. 전사 비용 15% 절감 방침이 있어, 예산이 드는 안은 시험 단가 근거를 함께 낸다.',
        '["시제품·공동연구가 최우선", "예산 안에는 시험 단가 근거"]'::jsonb, '{review,strategy,briefing,prep}', '{우선순위,예산,비용}', true, false, 'human', 10, now() - interval '1 day', now() - interval '40 days');
  exception when others then null;
  end;

  -- 결과물: 김현정 기획서 v1~v3 (리뷰 중)
  insert into submissions (team_id, author_id, item_id, title, status, created_at) values (T, m_kim, t1, '하반기 신소재 시제품 개발 계획서', 'in_review', now() - interval '30 days') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 1, E'1. 시장·적용처\n타깃 전기차 배터리 모듈, 관련 시장 1.2조 연 8% 성장.\n\n2. 개발 방식 — 신규 배합 단독\n기존 소재 개량 없이 신규 배합으로 개발해 최고 성능을 우선한다.', '초안', m_kim, now() - interval '30 days'),
    (sub, T, 2, E'1. 시장·적용처\n타깃 전기차 배터리 모듈, 관련 시장 1.2조 연 8% 성장. 주요 경쟁사 3곳.\n\n2. 개발 방식 — 신규 배합 단독\n선행 특허 조사 결과 반영 예정.\n\n3. 시험 계획\n위탁·자체 시험 중심, 내구 시험 라인.', '시험 계획 추가', m_kim, now() - interval '16 days');
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 3, E'1. 시장·적용처\n타깃 전기차 배터리 모듈, 관련 시장 1.2조 연 8% 성장. 주요 경쟁사 3곳의 점유율 합계 61%.\n\n2. 개발 방식 — 표면 코팅 우선\n경쟁사 특허 재분석 결과, 회피 설계가 확보되지 않은 상태에서 신규 배합 단독 개발은 초기 검증을 막는다고 판단했다. 1차 시제품은 기존 소재에 15μm 표면 코팅을 적용하고, 6주 뒤 신규 배합으로 전환한다. 버린 대안: 신규 배합 단독(특허 회피 미확보), 기존 소재 유지(성능 미달).\n\n3. 시험 계획\n위탁·자체 시험 중심 내구 시험 → 1차 검증 후 공동연구(B대학) 확대.\n\n4. 가설별 검증 계획\n가설 1: 표면 코팅으로 내열 성능 20% 이상 향상 — 내구 시험 데이터로 검증\n가설 2: ESS 업체도 주 수요처 — 수요처 인터뷰 12곳으로 검증 (데이터 보강 필요)',
     '개발 방식을 표면 코팅으로 전면 수정', m_kim, now() - interval '4 days') returning id into ver;
  insert into review_comments (submission_id, version_id, team_id, author_id, section_ref, body, created_at) values
    (sub, ver, T, L, '§2 개발 방식', '근거가 좋아요. 다만 2번 가설은 데이터가 더 필요해 보입니다.', now() - interval '3 days');
  insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at, parent_id)
    select sub, ver, T, m_kim, '다음 주 수요처 인터뷰로 보강하겠습니다.', now() - interval '3 days', id from review_comments where submission_id = sub limit 1;

  insert into submissions (team_id, author_id, item_id, title, status) values (T, m_choi, t5, '단계 심사 프로세스 개선안', 'in_review') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by) values
    (sub, T, 1, E'단계 심사 프로세스 개선안\n1. 현황: 과제 1건 단계 심사 리드타임 평균 3주\n2. 개선: 심사 자료 템플릿, 분석센터 주간 고정 슬롯', '초안', m_choi),
    (sub, T, 2, E'단계 심사 프로세스 개선안\n1. 현황: 과제 1건 단계 심사 리드타임 평균 3주 (최근 10건 기준)\n2. 개선: 심사 자료 템플릿, 분석센터 주간 고정 슬롯, 중간 리뷰 1회로 축소\n3. 측정: 월 심사 건수, 리드타임', '측정 지표 추가', m_choi);

  -- 지난 결과물 (승인 13건) + 판단 깊이 기록
  for i in 1..13 loop
    insert into submissions (team_id, author_id, title, created_at)
    values (T, (array[m_kim, m_park, m_choi, m_jung, m_kim, m_park, m_choi, m_kim, m_jung, m_park, m_choi, m_kim, m_lee])[i],
            (array['적용처 세그먼트 분석','시험 비용 진단','기술 세미나 운영안','공동연구 기관 후보 리스트','경쟁사 기술 동향','연구 예산 대시보드 설계','연구노트 작성 가이드라인','수요처 요구 정의','협력 조건 비교','리포트 자동화 계획','시험 보고서 표준 정리','원가 민감도 분석','LIMS 입력 양식 개편'])[i],
            now() - (170 - i * 11) * interval '1 day')
    returning id into sub;
    insert into submission_versions (submission_id, team_id, version, extracted_text, created_by, created_at)
    values (sub, T, 1, (array[
      E'적용처 세그먼트 분석\n1. 수요 데이터 기준 4개 세그먼트: 배터리 34%, 전장 27%, ESS 22%, 기타 17%\n2. 신소재 1차 타깃: 배터리 모듈 — 단가 상위 30%, 내열 요구 비중 62%\n3. 다음: 배터리 모듈 대상 시편 테스트',
      E'시험 비용 진단\n1. 3분기 시험 단가 2.9만 원 (전 분기 대비 +12%)\n2. 원인: 위탁 시험 재의뢰 — 같은 항목 6회 이상 반복\n3. 제안: 시험 항목 통합 주기 3주로 단축, 공동연구 시험 예산 10% 배정',
      E'기술 세미나 운영안\n1. 목표: 시제품 전 참여 연구원 30명 → 50명\n2. 주 1회 기술 공유 + 월 1회 외부 연사 세미나\n3. 성과 지표: 후속 제안 수·자료 재사용 수 중심 (참석자 수 제외)',
      E'공동연구 기관 후보 리스트\n1. 후보 6곳: 연구 역량·장비 보유·데이터 제공 가능 여부로 비교\n2. 1순위 B대학(관련 논문 120편, 장비 겹침 38%), 2순위 A연구원, 3순위 C대학\n3. B대학은 데이터 제공 일정이 불확실 — 대안 확보 필요',
      E'경쟁사 기술 동향\n1. 주요 3사 모두 초기 시제품에 표면 코팅(10~20μm) 사용\n2. 신규 배합 단독 사례는 특허 상위 기업뿐\n3. 시사점: 우리 특허 포지션에서는 코팅 방식 우선 검토 필요',
      E'연구 예산 대시보드 설계\n1. 보는 사람별 화면: 팀장(주간 시험 단가·진척), 실무(과제별 집행)\n2. 데이터 소스 3곳 자동 연동, 매일 오전 7시 갱신\n3. 1차 배포 범위: 과제별 집행률·시험 단가',
      E'연구노트 작성 가이드라인\n1. 원칙: 사실 위주로 과장 없이, 숫자는 출처와 함께\n2. 데이터: 결과만 기록 금지, 시험 조건 함께\n3. 금지 표현 12개와 대체 표현 정리',
      E'수요처 요구 정의\n1. 핵심 수요처: 배터리 모듈 제조사, 연 2회 소재 교체 검토, 시편 평가로 소재 탐색\n2. 채택 장벽: 단가보다 ”우리 공정에 맞을지” 확신 부족\n3. 대응 방향: 시편·공정 테스트 중심',
      E'협력 조건 비교\n1. A연구원: 간접비 8%, 데이터 월 1회 / B대학: 간접비 10%, 데이터 실시간(일정 미정) / C대학: 간접비 7%, 데이터 없음\n2. 추천: B대학 우선 협의, A연구원 병행',
      E'리포트 자동화 계획\n1. 주간 리포트 작성 시간 4시간 → 30분 목표\n2. 대시보드 연동 후 자동 요약, 코멘트만 작성\n3. 일정: 3주, 1주차 데이터 정리',
      E'시험 보고서 표준 정리\n1. 키워드: 정확함·간결함·재현성\n2. 문서별 차이: 내부 메모는 간단히, 고객사 제출본은 근거 중심\n3. 예시 문구 20개',
      E'원가 민감도 분석\n1. 수요처 설문 40곳: 적정 단가 3.2만~3.8만 원/kg\n2. 4만 원 이상에서 채택 의향 급감(−41%)\n3. 제안: 목표 원가 3.9만 원, 코팅 공정 개선으로 3.3만 원대 시험 공급',
      E'LIMS 입력 양식 개편\n1. 현재 표준 양식 등록률 22% — 사내 목표 35%\n2. 개편: 첫 화면에 필수 항목 1개만, 입력 시점 시험 직후 → 다음 날 오전\n3. 4주 뒤 등록률·재사용률 비교'])[i], (select author_id from submissions where id = sub), now() - (170 - i * 11) * interval '1 day') returning id into ver;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
    values (sub, ver, T, L, (array[
      '세그먼트 나눈 기준이 분명해서 좋아요. 다음엔 결론(어느 세그먼트부터)을 첫 줄로 올려 주세요.',
      '시험 단가 숫자에 출처랑 지난 분기 비교가 있어서 판단이 쉬웠어요. 이대로 진행하죠.',
      '좋습니다. 다만 성과 지표를 왜 후속 제안·재사용으로 골랐는지 한 줄 근거가 있으면 더 좋겠어요.',
      '후보 비교 좋아요. B대학 데이터 일정이 불확실하면 대안도 같이 적어 주세요 — 리스크는 미리.',
      '시사점까지 정리해 줘서 좋아요. 이대로 진행하죠.',
      '화면 구성 좋아요. 1차 범위 밖은 언제 하는지 다음 행동·날짜까지 적어 주세요.',
      '좋습니다. 금지 표현 정리가 특히 실용적이에요.',
      '요구 정의 좋아요. 이 근거가 어느 데이터에서 나왔는지 출처를 달아 주세요.',
      '조건 비교표 좋아요. 추천 이유를 결론 쪽으로 올리면 첫 장만 봐도 판단돼요.',
      '좋습니다. 일정에 담당자까지 넣어 주면 완성이에요.',
      '표준 정리 좋아요. 이대로 진행하죠.',
      '설문 숫자 좋아요. 목표 원가 3.9만 원으로 정한 이유를 대안(3.5만 원)과 비교해서 한 줄 넣어 주세요.',
      '등록률 기준선 잡은 거 좋아요. 4주 뒤 무엇을 보면 성공인지 목표치까지 적어 주세요.'])[i], now() - (166 - i * 11) * interval '1 day');
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
    (T, L, m_kim, 'praise', '커뮤니케이션', '임원 보고에서 개발 방식 질문에 근거를 들어 침착하게 답변함', current_date - 6),
    (T, L, m_kim, 'praise', '문제 정의', '신규 배합 단독 가정을 스스로 뒤집고 경쟁사 특허 재분석을 제안함', current_date - 20),
    (T, L, m_kim, 'concern', '실행 관리', '마감 전 야근이 반복됨. 일정 분산 필요', current_date - 12),
    (T, L, m_kim, 'note', '데이터 분석', '기술 동향 분석은 수치 나열에 그치는 경향', current_date - 60),
    (T, L, m_park, 'praise', '데이터 분석', '시험 지표 정의를 생산기술팀과 맞춰 정리함', current_date - 15),
    (T, L, m_park, 'praise', '협업', '다른 팀 데이터 요청을 우선순위 기준으로 조율', current_date - 40),
    (T, L, m_choi, 'praise', '문제 정의', '심사 지연 문제를 리드타임 지표로 정의', current_date - 25),
    (T, L, m_jung, 'note', '협업', '협력 기관 데이터 회신 지연을 혼자 해결하려 함', current_date - 9),
    (T, L, m_jung, 'praise', '커뮤니케이션', '협력 기관 미팅 정리가 명확함', current_date - 45),
    (T, L, m_lee, 'concern', null, '최근 회의에서 발언이 줄어듦', current_date - 10);

  -- 의사결정 (결과 기록 7건)
  insert into decisions (team_id, title, rationale, expected_outcome, outcome, outcome_rating, decided_by, decided_at) values
    (T, '1차 시제품을 표면 코팅 방식으로 확정', '경쟁사 특허 재분석', '내열 성능 20% 향상', null, null, L, now() - interval '14 days'),
    (T, '인터뷰 대상 8곳 → 12곳 확대', '2번 가설 데이터 부족', '가설 검증 가능', null, null, L, now() - interval '1 day'),
    (T, '파일럿 위탁 시험 기관 2곳 선정', '시험 납기 준수율', '6주 내 단가 목표 달성', '5주 만에 달성', 'hit', L, now() - interval '120 days'),
    (T, '예산 리포트 자동화 우선 착수', '반복 업무 30%', '주 6시간 절감', '주 5시간 절감', 'hit', L, now() - interval '100 days'),
    (T, '공동연구 후보 5곳으로 압축', '조건 비교', '2곳 협상 진입', '1곳만 진입', 'partial', L, now() - interval '90 days'),
    (T, '심사 자료 템플릿 시범 운영', '심사 지연', '리드타임 3주 → 2.5주', '2.4주', 'hit', L, now() - interval '80 days'),
    (T, '생산기술팀 이관 공유 주간 회의 신설', '정보 공유', '양산 이관 +10%', '변화 없음', 'miss', L, now() - interval '70 days'),
    (T, '연구노트 정리 일부 자동화', '시간 절감', '주 4시간 절감', '주 4시간 절감', 'hit', L, now() - interval '60 days'),
    (T, '시험 예산 상반기 집중', '시제품 조기 검증', '조기 검증률 30%', '32%', 'hit', L, now() - interval '50 days');

  -- 돌아볼 결정 (결과 기록 시점이 지난 것)
  update decisions set review_on = current_date - 1 where team_id = T and title = '1차 시제품을 표면 코팅 방식으로 확정';

  -- 조직·전사: 위에서 온 것 (org_notes 가 있을 때만)
  if to_regclass('public.org_notes') is not null then
    execute $q$insert into public.org_notes (team_id, author_id, kind, title, body, source, event_date, created_at) values
      ($1, $2, 'exec', '연구소장 관심사: 공동연구 성과와 시험 단가 개선 속도',
        E'연구소 주간회의에서 두 번 연속 질문.\n”공동과제 수주액이 언제 숫자로 보이냐”\n”경로별 시험 단가 비교표를 다음 보고에 넣어 달라”', '연구소 주간회의', null, now() - interval '6 days'),
      ($1, $2, 'request', '연구소 4분기 연구 실행계획 초안 제출', '비용 15% 절감 반영, 경로별 시험 단가 목표 포함', '경영기획팀', current_date + 6, now() - interval '2 days'),
      ($1, $2, 'calendar', '하반기 평가 시즌 시작 (자기평가 오픈)', '팀장 평가 의견 작성 기간 2주', 'HR팀 공지', current_date + 34, now() - interval '10 days'),
      ($1, $2, 'peer', '생산기술팀 이관 공유 회의 격주 → 월 1회로 변경', '공동연구로 나온 결과의 양산 검토가 늦어질 수 있음', '생산기술팀', null, now() - interval '9 days')$q$
      using T, L;
    execute $q$insert into public.org_notes (team_id, author_id, kind, title, body, source, created_at) values
      ($1, $2, 'strategy', '4분기 전사 방침: 연구개발 비용 15% 절감, 시험 단가 효율 중심',
        E'전사 경영회의 결정 사항\n- 4분기 연구개발 비용 전년 대비 15% 절감\n- 과제 평가 기준을 시험 건수에서 시험 단가(시험 1건당 비용)로 변경\n- 시험 단가가 낮은 경로(공동연구 등)에 예산 우선 배정', '전사 경영회의', now() - interval '3 days') returning id$q$
      into sub using T, L;
    -- 영향 분석 예시 1건 (ai_kind 'org_impact' 가 같은 실행에서 막 추가된 경우엔 건너뜀)
    begin
      execute $q$insert into public.ai_outputs (team_id, kind, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
        values ($1, 'org_impact', 'org_notes', $2, 'draft', 'leader', 'L2', 2, $3, '[]'::jsonb, $4, now() - interval '3 days')$q$
      using T, sub, jsonb_build_object(
        'summary', '비용 15% 절감 방침이 시제품 개발의 위탁 시험 계획과 부딪히고, 공동연구 목표에는 힘이 실립니다.',
        'level', 'high',
        'affected', jsonb_build_array(
          jsonb_build_object('item_id', g1, 'title', '하반기 신소재 시제품 개발 성공', 'how', '외부 위탁 시험 비중이 커서 비용 절감의 첫 대상이 될 수 있습니다'),
          jsonb_build_object('item_id', g2, 'title', '산학 공동연구 확대', 'how', '시험 단가가 낮은 경로 우선 배정 방침과 맞아 예산을 더 요청할 근거가 됩니다')),
        'actions', jsonb_build_array(
          jsonb_build_object('label', '시제품 위탁 시험 예산을 시험 단가 기준으로 다시 배분', 'kind', 'replan'),
          jsonb_build_object('label', '경로별 시험 단가 비교표를 이번 주간보고에 추가', 'kind', 'report'),
          jsonb_build_object('label', '정예슬 님과 B대학 데이터 막힘 해소 일정 확정 — 공동연구가 방침의 수혜 영역', 'kind', 'discuss')),
        'report_line', '전사 비용 절감 방침에 맞춰 시제품 위탁 시험 예산을 시험 단가 기준으로 다시 나누고, 공동연구 비중을 늘리겠습니다.'), L;
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
          {"type": "risk", "severity": 3, "title": "공동연구: 데이터 막힘 → 제안서 지연 → 달성 가능성 12%", "body": "원인이 하나라 풀리면 세 가지가 같이 풀립니다.", "action": "B대학 데이터 대체안 이번 주 확정", "link": "goals"},
          {"type": "risk", "severity": 2, "title": "최원석 님 이탈 신호", "body": "컨디션 3주 하락과 1on1 공백이 겹칩니다.", "action": "이번 주 1on1", "link": "one_on_ones"}]},
        "decide": {"summary": "결정이 미뤄지며 비용이 쌓이는 국면입니다 — 목표를 지킬지 조정할지 정하지 않은 채 실행만 이어지고 있어, 이번 주 판단이 분기 결과를 가릅니다.", "items": [
          {"type": "risk", "severity": 3, "title": "공동연구 목표(20억 원)를 조정할지, 데이터 지원을 요청해 지킬지", "body": "제안서 막힘이 목표 전망을 끌어내립니다. 전사 비용 절감 방침상 공동연구는 예산 우선 대상이라 지원 요청의 명분이 있습니다.", "action": "이번 주 안에 결정, 정예슬 님과 15분", "link": "sim",
            "options": ["대외협력실에 B대학 데이터 협조를 공식 요청해 목표 유지", "목표를 16억 원으로 낮추고 시제품 개발에 인력 집중", "제안서 범위를 B대학 제외 2개 기관으로 줄여 일정 우선"],
            "impact": "기말 전망 18.6억 원 → 목표 20억 원과의 차이를 메우는 유일한 경로입니다."},
          {"type": "pattern", "severity": 2, "title": "시제품 위탁 시험 예산을 시험 단가 기준으로 다시 나눌지", "body": "전사 비용 15% 절감 방침이 시제품 위탁 시험 집행과 부딪힙니다.", "action": "4분기 실행계획 초안 전에 결정", "link": "org",
            "options": ["위탁 시험 비중을 줄이고 공동연구로 이동", "코팅 시험 기간을 줄여 비용 확보"],
            "impact": "시제품 목표(달성 가능성 94%)는 지키면서 공동연구 목표에 예산을 돌릴 수 있습니다."},
          {"type": "pattern", "severity": 2, "title": "특허 관리 체계 정비에 들어가는 팀 시간을 줄일지", "body": "기여도가 낮은 과제에 팀 시간 35%가 들어가고, 그중 정예슬 님 몫이 45%입니다.", "action": "다음 주 계획 회의에서 결정", "link": "strategy",
            "options": ["특허 관리 체계 정비를 다음 분기로 미루고 정예슬 님을 공동연구에 집중", "김소희 님에게 리포트 운영을 넘겨 시간 분산"],
            "impact": "정예슬 님 시간이 공동연구 제안서로 옮겨 가면 막힘 해소 속도가 빨라집니다."}]},
        "perf": {"summary": "성과는 순항과 정체로 갈려 있습니다 — 문제는 실행력보다 외부에 기대는 과제에 대체 경로가 없는 계획 구조이고, 그 한 축이 팀 전망 평균을 끌어내립니다.", "items": [
          {"type": "forecast", "severity": 2, "title": "제안서 지연이 공동연구 목표 전망의 핵심 원인", "body": "최근 3주 진척 속도가 거의 0입니다.", "action": "B대학 데이터 대체안으로 범위 축소", "link": "goals"},
          {"type": "good", "severity": 1, "title": "시제품 개발 달성 가능성 94%", "body": "수요처 인터뷰·내구 시험이 일정대로 갑니다.", "link": "goals"}]},
        "people": {"summary": "팀원관리가 흔들리는 건 개인 문제보다 운영 리듬 때문입니다 — 1on1 간격이 벌어진 시기에 막힘을 혼자 끌어안는 패턴이 겹쳐 컨디션이 같이 꺾였고, 성장·인정은 일부에게만 몰려 있습니다.", "items": [
          {"type": "risk", "severity": 3, "title": "최원석 님 3주 연속 컨디션 하락 (4 → 3 → 2)", "body": "1on1이 3주 넘게 없고, LIMS 연계 과제는 혼자 맡고 있습니다. 업무량보다 방향 불확실이 원인일 수 있습니다.", "action": "이번 주 안에 1on1 — 과제 우선순위부터 물어보기", "link": "one_on_ones"},
          {"type": "risk", "severity": 2, "title": "정예슬 님 2주째 같은 문제로 막힘", "body": "본인 힘으로 풀 수 없는 외부 데이터 문제라, 팀장이 위로 올려 줘야 풀립니다.", "action": "대외협력실 협조 요청을 대신 올리기", "link": "one_on_ones"},
          {"type": "good", "severity": 1, "title": "이재혁·김소희 님 판단 깊이 상승", "body": "결과물 검토 점수와 결과 지표가 함께 올랐습니다. 지금 인정하면 효과가 큽니다.", "action": "관찰 메모로 남기기", "link": "team"},
          {"type": "data", "severity": 1, "title": "윤채원 님 평가 근거 부족", "body": "입사 6주 차로 결과물·관찰 기록이 적습니다. 평가 시즌(D-33) 전에 근거를 쌓아야 합니다.", "action": "수요처 인터뷰 결과물 리뷰를 근거로 남기기", "link": "reviews"}]},
        "org": {"summary": "위와의 정렬이 늦어지고 있습니다 — 전사 기준은 비용·시험 단가 효율로 바뀌었는데 팀 계획과 보고는 아직 이전 기준이라, 임원 질문에 답할 근거가 비어 있습니다.", "items": [
          {"type": "forecast", "severity": 2, "title": "4분기 실행계획 제출 D-6", "body": "비용 15% 절감 반영이 필요합니다.", "action": "시제품 위탁 시험 예산 재배분안부터 준비", "link": "org"}]}
      },
      "watch_next": "다음 주 협력 기관 데이터가 들어오는지, 최원석 님 컨디션이 반등하는지"
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
      values (T, L, '경량 소재 시제품 인증 획득', 'children', 'done', 100, 1, make_date(py, 3, 1), make_date(py, 9, 30), make_date(py, 3, 1), make_date(py, 8, 31), make_date(py, 9, 30), 5, make_date(py, 2, 20), make_date(py, 9, 30)) returning id into pg;
    insert into work_items (team_id, parent_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, created_at, updated_at) values
      (T, pg, m_kim, '소재 콘셉트·배합 설계', 'check', 'done', 100, 1, make_date(py, 3, 1), make_date(py, 5, 15), make_date(py, 3, 1), make_date(py, 4, 30), make_date(py, 5, 15), make_date(py, 2, 20), make_date(py, 5, 15)),
      (T, pg, m_choi, '인증 시편 20종 제작', 'check', 'done', 100, 2, make_date(py, 5, 1), make_date(py, 8, 31), make_date(py, 5, 1), make_date(py, 8, 15), make_date(py, 8, 31), make_date(py, 2, 20), make_date(py, 8, 31)),
      (T, pg, m_park, '인증 시험 의뢰', 'check', 'done', 100, 3, make_date(py, 8, 1), make_date(py, 9, 30), make_date(py, 8, 1), make_date(py, 8, 31), make_date(py, 9, 30), make_date(py, 2, 20), make_date(py, 9, 30));
    insert into work_items (team_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, contribution, created_at, updated_at)
      values (T, L, '외부 연구비 10억 원 확보', 'children', 'done', 82, 2, make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 12, 31), 5, make_date(py, 1, 2), make_date(py, 12, 31)) returning id into pg;
    insert into work_items (team_id, parent_id, owner_id, title, measure, status, progress, sort, start_date, due_date, base_start, base_due, done_at, created_at, updated_at) values
      (T, pg, m_park, '국책과제 수주 6억 원', 'percent', 'done', 95, 1, make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31)),
      (T, pg, m_jung, '공동연구 수주 4억 원', 'percent', 'done', 62, 2, make_date(py, 3, 1), make_date(py, 12, 31), make_date(py, 3, 1), make_date(py, 11, 30), make_date(py, 12, 31), make_date(py, 1, 2), make_date(py, 12, 31));
  exception when others then null;
  end;

  -- 업무플랫폼: 리뷰 대기 결과물 2건의 AI 1차 검토 + 다가오는 1on1의 AI 준비 노트
  declare v1 uuid; v2 uuid; o1 uuid;
  begin
    select sv.id into v1 from submission_versions sv join submissions s on s.id = sv.submission_id
      where s.team_id = T and s.title = '하반기 신소재 시제품 개발 계획서' order by sv.version desc limit 1;
    select sv.id into v2 from submission_versions sv join submissions s on s.id = sv.submission_id
      where s.team_id = T and s.title = '단계 심사 프로세스 개선안' order by sv.version desc limit 1;
    insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at) values
      (T, 'review', m_kim, 'submission_versions', v1, 'draft', 'leader', 'L1', 1, $j${
        "depth_score": 3.0,
        "summary": "신규 배합 단독을 버린 이유와 대안 비교가 분명해 논리가 탄탄하고, 가설마다 검증 방법까지 붙여 완성도도 높아졌습니다. 다만 결론이 §2에 묻혀 있어 첫 장만 봐서는 무엇을 하자는지 바로 보이지 않고, 가설 2(ESS 수요처)는 아직 주장 수준입니다.",
        "brief": {"tone": "good", "text": "이재혁 님이 올린 ’하반기 신소재 시제품 개발 계획서’는 논리가 탄탄해 보입니다", "why": "버린 대안과 이유까지 비교함 · 결론은 뒤에 있음"},
        "decisions": ["표면 코팅 15μm 적용", "B대학 공동연구 확대 시점"],
        "strengths": [{"section": "§2 개발 방식", "text": "경쟁사 특허 재분석으로 신규 배합 단독을 버린 이유와 대안 2개를 비교해 밝혔습니다."},
                      {"section": "§4 가설", "text": "가설마다 검증 방법(내구 시험 데이터, 인터뷰)을 붙였습니다."}],
        "gaps": [{"section": "§4 가설 2", "text": "ESS 업체가 주 수요처라는 근거가 인터뷰 계획뿐이라 아직 주장 수준입니다."},
                 {"section": "§3 시험", "text": "공동연구(B대학) 확대가 데이터 회신 지연과 어떻게 맞물리는지 빠져 있습니다."}],
        "questions": ["코팅 15μm가 내열 성능 20% 향상으로 이어진다는 근거는?", "B대학 데이터가 늦어지면 3단계 시험 계획은 어떻게 바뀌나요?"],
        "change_from_previous": "신규 배합 단독에서 표면 코팅으로 바꾸고, 버린 대안과 이유를 새로 적었습니다.",
        "criteria_check": [{"criterion": "결론부터 쓴다", "met": false, "note": "§1 시장 분석으로 시작해 결론이 뒤에 있습니다."},
                           {"criterion": "대안 비교", "met": true, "note": "§2에서 신규 배합 단독·기존 소재 유지를 비교했습니다."},
                           {"criterion": "숫자와 출처", "met": true, "note": "시장 규모·점유율에 수치를 달았습니다."}]
      }$j$::jsonb, '[]'::jsonb, m_kim, now() - interval '4 days'),
      (T, 'review', m_choi, 'submission_versions', v2, 'draft', 'leader', 'L1', 1, $j${
        "depth_score": 2.0,
        "summary": "현황 수치와 측정 지표를 붙여 실행 가능한 모양은 갖췄지만, 목표치가 없고 세 가지 개선이 각각 리드타임을 얼마나 줄이는지 추정이 비어 있어 완결성이 낮습니다. 개선안도 일반적인 방법을 옮긴 수준이라 이 팀만의 병목을 짚은 관점이 약합니다.",
        "brief": {"tone": "watch", "text": "박민규 님이 올린 ’단계 심사 프로세스 개선안’은 완결성이 낮아 보입니다", "why": "목표치가 없고 개선 효과 추정이 비어 있음"},
        "decisions": [],
        "strengths": [{"section": "1. 현황", "text": "최근 10건 기준 리드타임 3주로 기준선을 잡았습니다."}],
        "gaps": [{"section": "2. 개선", "text": "심사 자료 템플릿·고정 슬롯이 각각 며칠을 줄이는지 추정이 없습니다."},
                 {"section": "3. 측정", "text": "목표치(예: 2주)가 없어 성공 여부를 판단하기 어렵습니다."}],
        "questions": ["세 가지 개선 중 리드타임을 가장 많이 줄이는 건 무엇이라고 보나요?", "분석센터 고정 슬롯은 분석센터와 합의됐나요?"],
        "change_from_previous": "측정 지표(월 심사 건수, 리드타임)를 추가했습니다.",
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
        "summary": "타깃과 시장 규모는 잡았지만, 신규 배합 단독을 택한 이유가 ’최고 성능’ 한 줄뿐이라 근거가 비어 있습니다. 다른 개발 방식과 비교하지 않았고 시험·일정 등 실행 부분이 아직 없습니다.",
        "brief": {"tone": "risk", "text": "이재혁 님이 올린 ’하반기 신소재 시제품 개발 계획서’는 근거가 비어 보입니다", "why": "신규 배합 단독 이유가 ’최고 성능’ 한 줄뿐"},
        "decisions": [],
        "strengths": [{"section": "1. 시장·적용처", "text": "타깃과 시장 규모·성장률을 숫자로 먼저 밝혔습니다."}],
        "gaps": [{"section": "2. 개발 방식", "text": "신규 배합 단독이 특허 포지션이 약한 지금 맞는지, 코팅 방식과 비교한 근거가 없습니다."},
                 {"section": "전체", "text": "시험·일정 등 실행 계획이 빠져 있어 초안 단계입니다."}],
        "questions": ["회피 설계 없이 신규 배합 단독으로 가면 초기 검증이 막히지 않을까요?", "경쟁사들은 초기 시제품을 어떻게 만들었나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      (2, $j${
        "depth_score": 2.0,
        "summary": "시험 계획과 경쟁사 수가 추가돼 분량은 늘었지만, v1에서 비었던 신규 배합 단독의 근거는 ’조사 결과 반영 예정’으로 미뤄져 고민의 깊이는 그대로입니다.",
        "brief": {"tone": "watch", "text": "이재혁 님이 올린 ’하반기 신소재 시제품 개발 계획서’는 고민의 깊이가 그대로로 보입니다", "why": "시험 계획은 늘었지만 배합 근거는 ’반영 예정’"},
        "decisions": [],
        "strengths": [{"section": "3. 시험 계획", "text": "내구 시험 라인까지 이어지는 시험 흐름을 새로 잡았습니다."}],
        "gaps": [{"section": "2. 개발 방식", "text": "핵심 판단(신규 배합 단독)의 근거가 아직 ’예정’으로 남아 있습니다."}],
        "questions": ["선행 특허 조사는 언제 나오고, 결과에 따라 개발 방식이 바뀔 수 있나요?"],
        "change_from_previous": "시험 계획(위탁·자체 시험, 내구 시험 라인)과 경쟁사 수를 추가했습니다.", "trend_note": "", "criteria_check": []
      }$j$)
    ) as x(ver, c) on sv.version = x.ver
    where s.team_id = T and s.title = '하반기 신소재 시제품 개발 계획서';
    select id into o1 from one_on_ones where team_id = T and member_id = m_kim and status = 'scheduled' order by scheduled_at limit 1;
    if o1 is not null then
      insert into public.ai_outputs (team_id, kind, subject_user_id, ref_table, ref_id, status, visibility, level, depth, content, sources, created_by, created_at)
      values (T, 'one_on_one_prep', m_kim, 'one_on_ones', o1, 'draft', 'leader', 'L2', 2, $j${
        "last_time": "1차 시제품을 표면 코팅 중심으로 바꾸는 방향에 합의했고, 2번 가설은 수요처 인터뷰로 검증하기로 했습니다.",
        "since": [{"text": "계획서 v3 제출 — 표면 코팅으로 전면 수정"}, {"text": "판단 깊이 2.0 → 3.0으로 상승"}],
        "open_promises": [{"owner": "팀장", "text": "경쟁사 특허 분석 리포트 공유", "overdue": true}, {"owner": "팀원", "text": "인터뷰 설계안 초안", "overdue": false}],
        "recent_work": "계획서 v3에서 대안 비교와 가설별 검증 계획이 뚜렷해졌습니다.",
        "watch": "판단 깊이가 눈에 띄게 올랐습니다. 지금 인정하고, 인터뷰 일정이 B대학 데이터 지연과 겹치지 않는지 확인하세요.",
        "questions": ["표면 코팅을 결정한 가장 결정적인 근거는 무엇이었나요?", "인터뷰에서 꼭 확인하고 싶은 것 하나만 꼽는다면?", "제가 먼저 풀어 줘야 할 막힘이 있나요?"]
      }$j$::jsonb, '[]'::jsonb, L, now() - interval '2 hours');
    end if;
  exception when others then null;
  end;

  -- 팀원관리: 이번 주 AI 액션 추천 + 팀원별 업무 판단
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'people_actions', 'draft', 'leader', 'L2', 2, $2, '[]'::jsonb, $3, now() - interval '30 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, jsonb_build_object(
      'summary', '이번 주는 최원석 님 1on1과 정예슬 님 막힘 해소가 먼저이고, 이재혁 님은 지금 인정할 타이밍입니다.',
      'actions', jsonb_build_array(
        jsonb_build_object('user_id', m_lee, 'type', 'one_on_one', 'urgency', 3, 'title', '최원석 님과 1on1 — 이번 주 안에',
          'why', '컨디션이 3주 연속 떨어졌고(4 → 3 → 2) 마지막 1on1이 3주 전입니다.', 'opener', '요즘 일하면서 에너지가 가장 떨어지는 순간이 언제예요?'),
        jsonb_build_object('user_id', m_jung, 'type', 'support', 'urgency', 3, 'title', '정예슬 님 챙기기 — 어려운 점 들어 주기',
          'why', '같은 막힘이 2주째 이어지고, 이번 주 컨디션 공유에서 개인 사정과 피로를 골랐습니다.', 'request', '요즘 혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 제가 도울 수 있는 건 같이 할게요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'praise', 'urgency', 2, 'title', '이재혁 님께 칭찬 배지',
          'why', '최근 결과물의 판단 깊이가 꾸준히 올랐고(2.0 → 3.0), 대안을 비교하고 근거를 남기는 방식이 자리 잡았습니다.', 'message', '요즘 결과물마다 대안을 따져 보고 근거를 남기는 게 보여서 든든해요. 고마워요!'),
        jsonb_build_object('user_id', m_han, 'type', 'observe', 'urgency', 2, 'title', '윤채원 님 관찰 기록 남기기',
          'why', '입사 6주 차로 평가 근거가 기준에 못 미칩니다. 이번 주 일하는 모습을 보고 한 줄 남겨 두세요.'),
        jsonb_build_object('user_id', m_kim, 'type', 'develop', 'urgency', 1, 'title', '이재혁 님께 더 큰 역할 제안하기',
          'why', '판단 깊이가 꾸준히 올라 다음 단계 역할을 이야기할 시점입니다.', 'request', '다음 분기에는 더 넓은 범위를 직접 리드해 보면 좋겠어요. 어떤 걸 맡아 보고 싶은지 이야기해 봐요.'),
        jsonb_build_object('user_id', m_choi, 'type', 'push', 'urgency', 1, 'title', '박민규 님과 진행 공유 리듬 맞추기',
          'why', '결과물이 리뷰 단계에 머물러 있고 최근 진행 공유 간격이 길어졌습니다.', 'request', '이번 주부터 금요일마다 진행 상황을 한 줄로 공유해 줄래요? 막히는 게 있으면 같이 봐요.'),
        jsonb_build_object('user_id', m_park, 'type', 'praise', 'urgency', 1, 'title', '김소희 님께 꾸준함 인정하기',
          'why', '정기 업무를 빠짐없이 운영하고 결과물이 대부분 한 번에 통과했습니다.', 'message', '매달 빠짐없이 챙겨 주는 꾸준함 덕분에 팀이 숫자를 믿고 움직여요. 고마워요!')),
      'members', jsonb_build_array(
        jsonb_build_object('user_id', m_kim, 'work_status', 'good', 'work_view', '시제품 개발이 계획보다 조금 늦지만 결과물 품질이 뚜렷이 올랐습니다. 핵심 과제를 안정적으로 끌고 갑니다.', 'flight_risk', 'low', 'flight_note', '컨디션이 안정적이고 1on1이 꾸준합니다.'),
        jsonb_build_object('user_id', m_park, 'work_status', 'good', 'work_view', '정기 리포트를 빠짐없이 운영하고 결과물도 한 번에 통과하는 편입니다. 다만 업무가 겹쳐 시간이 빠듯합니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_choi, 'work_status', 'good', 'work_view', '프로세스 개선이 계획대로 가고, 개선안에 측정 지표를 붙이는 등 결과물이 나아지고 있습니다.', 'flight_risk', 'low', 'flight_note', '특이 신호가 없습니다.'),
        jsonb_build_object('user_id', m_jung, 'work_status', 'support', 'work_view', '제안서가 외부 데이터 막힘으로 계획보다 크게 늦고, 특허 관리 체계 정비도 진척이 더딥니다. 본인 역량보다 외부 의존이 원인입니다.', 'flight_risk', 'medium', 'flight_note', '같은 막힘이 2주째 반복되고 일이 몰려 있습니다.'),
        jsonb_build_object('user_id', m_lee, 'work_status', 'watch', 'work_view', 'LIMS 연계 과제가 계획보다 조금 늦지만 큰 이탈은 없습니다. 혼자 맡은 과제라 방향 확인이 필요합니다.', 'flight_risk', 'high', 'flight_note', '컨디션 3주 연속 하락과 1on1 공백이 겹칩니다.'),
        jsonb_build_object('user_id', m_han, 'work_status', 'good', 'work_view', '수요처 인터뷰 준비를 일정대로 진행 중이나 아직 올린 결과물이 적어 판단 근거가 얇습니다.', 'flight_risk', 'low', 'flight_note', '신규 입사자로 적응 중입니다.'))
    ), L;
  exception when others then null;
  end;

  -- A·Team의 제안: 이번 주 + 지난주(회고용) + 지난주 제안 상태 + 팀장 셀프 체크
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 2, $2, '[]'::jsonb, $3, now() - interval '7 days 20 minutes', date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date - 1)$q$
    using T, $j${"headline": "실행은 순항하지만 사람 관리의 리듬이 느슨해지고 있습니다 — 1on1과 기준 공유로 다시 조이는 주입니다.", "focus": "공동연구 목표 — 협력 기관 데이터 회신이 공식 경로로 요청되지 않았습니다.", "levers": {"exec": {"state": "watch", "note": "공동연구 과제가 2주째 같은 막힘입니다."}, "staffing": {"state": "good", "note": "부하는 고른 편입니다."}, "people": {"state": "act", "note": "1on1 간격이 평균 19일로 벌어졌습니다."}, "external": {"state": "watch", "note": "데이터 회신이 비공식 경로에만 의존합니다."}, "self": {"state": "good", "note": "특이 신호 없음."}, "system": {"state": "watch", "note": "결과물 보완점이 같은 주제로 반복됩니다."}}, "advice": [{"id": "a1", "lever": "people", "urgency": 3, "effort": "low", "title": "1on1 간격을 2주 이내로 되돌리세요", "why": "1on1 평균 간격이 19일로 벌어졌습니다.", "effect": "막힘을 일찍 듣게 됩니다.", "if_not": "컨디션 하락을 늦게 알게 됩니다.", "route": "one_on_one", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "system", "urgency": 2, "effort": "mid", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "why": "보완점이 같은 주제로 반복됩니다.", "effect": "수정 횟수가 줄어듭니다.", "if_not": "리뷰 시간이 계속 늘어납니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a3", "lever": "external", "urgency": 2, "effort": "low", "title": "공동연구 데이터 회신을 대외협력실에 공식 요청하세요", "why": "비공식 경로로 2주를 기다렸습니다.", "effect": "회신 날짜가 정해집니다.", "if_not": "막힘이 계속됩니다.", "route": "report", "target_user_id": "", "script": ""}], "review": [], "watch_next": "최원석 님 컨디션."}$j$::jsonb, L;
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'advisor_weekly', 'draft', 'leader', 'L3', 3, $2, '[]'::jsonb, $3, now() - interval '20 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, replace($j${"headline": "성과는 외부 의존 하나에 묶여 있고, 운영은 팀장 시간이 순항하는 사람 쪽으로 쏠려 있습니다 — 이번 주는 ’막힌 곳으로 사람과 시간을 옮기는 주’입니다.", "focus": "공동연구 목표(20억 원) — 협력 기관 데이터 회신이 풀리지 않으면 4분기 전망이 18.6억 원 근처에서 멈춥니다.", "levers": {"exec": {"state": "act", "note": "공동연구 과제가 3주째 같은 막힘(협력 기관 데이터)으로 멈춰 있고, 계획에 대체 경로가 없습니다."}, "staffing": {"state": "watch", "note": "공동연구 목표의 하위 일 3건이 모두 정예슬 님 한 사람에게 있고, 이재혁 님은 가용 시간의 70%만 쓰고 있습니다."}, "people": {"state": "watch", "note": "최근 4주 칭찬·관찰이 이재혁·김소희 님에게 몰렸고, 최원석 님은 컨디션이 3주째 내려가는데 팀장 접점이 가장 적습니다."}, "external": {"state": "act", "note": "전사 비용 15% 절감 방침이 시제품 위탁 시험 예산과 부딪히는데, 아직 위로 방향을 확인하지 않았습니다."}, "self": {"state": "watch", "note": "리뷰 대기 6건(가장 오래 5일)과 검토 중 결정 3건이 겹쳐 있고, 최근 2주 앱 활동의 31%가 밤 10시 이후·주말입니다."}, "system": {"state": "good", "note": "체크인 제출 5/6명으로 주간 리듬은 유지됩니다. 다만 결과물 보완점이 ’근거·데이터’에 반복됩니다."}}, "advice": [{"id": "a1", "lever": "exec", "urgency": 3, "effort": "low", "title": "공동연구 과제에 ’대체 데이터 경로’를 이번 주 안에 계획으로 넣으세요 — 협력 기관 데이터를 기다리는 동안 공개 물성 데이터와 파일럿 기관 2곳으로 1차안을 만들게 하세요.", "why": "같은 막힘이 3주째 체크인에 반복되고, 공동연구 목표 달성 가능성이 12%까지 내려왔습니다.", "effect": "데이터 회신이 늦어져도 11월 첫 주에 1차 제안이 가능해지고, 목표 전망의 바닥이 올라갑니다.", "if_not": "회신이 2주 더 밀리면 4분기 공동연구 목표는 조정이 불가피합니다.", "route": "decide", "target_user_id": "", "script": ""}, {"id": "a2", "lever": "staffing", "urgency": 2, "effort": "mid", "title": "공동연구 과제의 ’데이터 정리’ 1건을 이재혁 님에게 옮겨 정예슬 님 한 사람 의존을 푸세요.", "why": "공동연구 하위 일 3건이 한 사람에게 몰려 있고(주 46시간/가용 40시간), 이재혁 님은 여유가 있습니다.", "effect": "정예슬 님은 기관 협의에 집중하고, 막힘이 한 곳에서 전체로 번지는 걸 막습니다.", "if_not": "정예슬 님 과부하가 이어지면 이탈 주의 신호가 ’높음’으로 올라갈 수 있습니다.", "route": "request", "target_user_id": "{{KIM}}", "script": "재혁 씨, 공동연구 제안서의 데이터 정리 파트를 이번 주부터 맡아 줄 수 있을까요? 예슬 씨가 기관 협의에 집중할 수 있게 하려는 거예요. 필요한 시간은 같이 조정할게요."}, {"id": "a3", "lever": "external", "urgency": 3, "effort": "low", "title": "비용 절감 방침과 시제품 예산의 충돌을 이번 주 연구소장 보고에 먼저 올리세요 — 결정권은 위에 있습니다.", "why": "전사 방침(비용 15% 절감)이 시제품 위탁 시험 집행과 부딪히는데, 팀 안에서 결론을 내기 어려운 사안입니다.", "effect": "예산 축소 범위가 일찍 정해지면 4분기 실행계획 초안을 다시 쓰지 않아도 됩니다.", "if_not": "실행계획 확정 직전에 예산이 깎이면 시제품 일정 전체가 밀립니다.", "route": "report", "target_user_id": "", "script": "전사 비용 15% 절감 방침에 맞춰 시제품 위탁 시험 예산을 시험 단가 기준으로 재배분하려 합니다. 다만 공동연구 목표(20억 원)에 필요한 최소 예산은 유지가 필요해, 이번 주 안에 방향 확인 부탁드립니다."}, {"id": "a4", "lever": "self", "urgency": 2, "effort": "low", "title": "리뷰 대기 6건 중 정기 보고 2건은 김소희 님에게 1차 리뷰를 맡기고, 아낀 시간을 최원석·정예슬 님에게 쓰세요.", "why": "최근 4주 팀장 접점의 48%가 이재혁·김소희 님 두 사람에게 갔고, 필요도가 높은 최원석 님은 팀 평균의 0.6배입니다.", "effect": "리뷰 적체가 절반으로 줄고, 이탈 주의 두 사람에게 이번 주 1on1 시간이 생깁니다.", "if_not": "적체와 늦은 시간 작업이 이어지면 결정이 더 미뤄지는 악순환이 됩니다.", "route": "none", "target_user_id": "", "script": ""}, {"id": "a5", "lever": "people", "urgency": 1, "effort": "low", "title": "이번 주 금요일 점심을 ’시제품 준비 중간 점검 + 이재혁 님 계획서 통과 축하’ 자리로 잡으세요.", "why": "팀 컨디션이 3.6으로 내려가는 중이고, 인정이 일부에게만 보이는 상태입니다.", "effect": "짧고 부담 없는 자리로 팀 전체가 진척을 함께 보고, 인정이 팀 전체의 이야기가 됩니다.", "if_not": "막힌 사람과 순항하는 사람 사이의 온도 차가 커집니다.", "route": "calendar", "target_user_id": "", "script": "금요일 점심은 다 같이 먹어요 — 시제품 준비 중간 점검 겸, 재혁 씨 계획서 통과도 축하해요."}], "review": [{"id": "a1", "title": "1on1 간격을 2주 이내로 되돌리세요", "verdict": "partial", "observed": "정예슬·윤채원 님과는 1on1을 했지만, 최원석 님은 아직 3주째 1on1이 없습니다."}, {"id": "a2", "title": "결과물 작성 기준(결론 먼저 · 근거 출처)을 한 장으로 공유하세요", "verdict": "not_done", "observed": "기준 카드가 공개되지 않았고, 이번 주에도 보완점 2건이 ’근거·데이터’였습니다."}, {"id": "a3", "title": "공동연구 데이터 회신을 대외협력실에 공식 요청하세요", "verdict": "done", "observed": "대외협력실 요청이 기록됐고, 협력 기관 회신은 ’11월 둘째 주 이후 가능’으로 왔습니다."}], "watch_next": "협력 기관 데이터 회신 날짜와 최원석 님 다음 체크인의 컨디션.", "perspective": {"big": {"lens": "목표 구성 · 다가오는 시기", "text": "팀 목표 중 새로 만드는 일은 신소재 시제품 하나이고, 나머지는 지금 하는 일을 지키고 넓히는 목표입니다. 시제품이 끝나는 11월 이후 팀의 다음 성장 축이 비어 있습니다.", "why": "11~12월은 평가와 내년 목표 수립이 겹치는 시기입니다. 내년 목표에 넣을 ’새로 만들 일’ 후보를 지금부터 모아 두면 목표를 서둘러 정하지 않게 됩니다."}, "reframe": {"lens": "관심과 기회의 쏠림", "text": "일의 배분이 곧 동기의 배분이 되고 있습니다 — 시제품·계획처럼 성장이 보이는 일은 이재혁·김소희 님에게, 막힌 일은 정예슬·최원석 님에게 가 있습니다.", "why": "최근 4주 칭찬·관찰도 같은 두 사람에게 몰렸습니다. 막힌 사람에게 시간을 더 쓰는 것과 별개로, 다음 배분 때 ’보이는 일’을 한 번 돌려 볼 만합니다."}, "experiment": {"title": "주간 회의 첫 10분을 ’막힌 것만’ 말하는 시간으로 바꿔 보기", "how": "진행 보고는 업무플랫폼에 미리 올리고, 회의에서는 한 사람씩 막힌 것 하나와 필요한 도움만 말합니다. 팀장은 답보다 ’누가 도울 수 있나’를 먼저 묻습니다.", "check": "2주 뒤 막힘이 공유되기까지 걸린 날짜와 회의 시간"}, "question": "내년 이맘때 우리 팀이 ’그때 시작하길 잘했다’고 말할 일은 무엇일까요?"}}$j$, '{{KIM}}', m_kim::text)::jsonb, L;
    execute $q$insert into public.advice_status (team_id, advice_key, status, updated_by) values
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a1', 'adopted', $2),
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a2', 'held', $2),
      ($1, (date_trunc('week', current_date)::date - 7)::text || ':a3', 'done', $2) on conflict do nothing$q$ using T, L;
    execute $q$insert into public.leader_selfcheck (team_id, user_id, week_start, energy, burden, note) values
      ($1, $2, date_trunc('week', current_date)::date - 14, 4, 3, ''),
      ($1, $2, date_trunc('week', current_date)::date - 7, 3, 4, '시제품·공동연구가 겹쳐 리뷰가 밀림') on conflict do nothing$q$ using T, L;
  exception when others then null;
  end;

  -- 상향 관리: 상위 관리자 2명 + 위에서 온 것 연결 + 임원 브리핑
  declare e1 uuid; e2 uuid;
  begin
    execute $q$insert into public.executives (team_id, name, title, style_tags, interests, prefs, sort) values ($1, '장태수', '기술연구소장', array['숫자·근거 중시','결론 먼저','비용·효율'],
      '공동연구 성과와 시험 단가 개선 속도. 지난달 대비 숫자로 물음', '월요일 연구소 주간회의 · 1페이지 · 결론 먼저', 0) returning id$q$ into e1 using T;
    execute $q$insert into public.executives (team_id, name, title, style_tags, interests, prefs, sort) values ($1, '문혜란', '전략기획 상무', array['리스크 민감','사업화 관점','디테일 확인'],
      '4분기 실행계획의 리스크와 대안, 시제품 일정', '격주 · 이슈 중심 · 대안 2개 이상', 1) returning id$q$ into e2 using T;
    execute $q$update public.org_notes set exec_id = $2 where team_id = $1 and kind = 'exec'$q$ using T, e1;
    execute $q$update public.org_notes set exec_id = $2 where team_id = $1 and kind = 'request'$q$ using T, e2;
    execute $q$insert into public.ai_outputs (team_id, kind, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'exec_brief', 'draft', 'leader', 'L3', 3, $2, '[]'::jsonb, $3, now() - interval '40 minutes', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6)$q$
    using T, replace(replace(replace($j${"headline": "위에서 보면 우리 팀은 ’시제품은 순항, 공동연구는 숫자가 안 보이는 팀’입니다 — 이번 주 질문은 공동연구와 시험 단가에 몰릴 가능성이 큽니다.", "execs": [{"exec_id": "{{E1}}", "name": "장태수", "lens": "비용 15% 절감 방침 아래에서 ’공동연구가 시험 단가를 낮추는 근거가 숫자로 보이는가’", "opener": "공동연구는 아직 목표 대비 56%지만, 시험 단가는 1.1만 원으로 경로 중 가장 낮습니다 — 남은 변수는 B대학 데이터 하나입니다.", "questions": [{"q": "공동과제 수주액이 언제 숫자로 보이나?", "why": "주간회의에서 두 번 연속 물었고, 현재 누적 11.2억 원으로 목표 20억 원의 56%입니다.", "prep": "기준 전망 18.6억 원(93%) · B대학 데이터가 11월 둘째 주 이후 → 대체 경로(공개 데이터·파일럿 2곳)로 11월 첫 주 1차 제안 가능"}, {"q": "경로별 시험 단가 비교표는 준비됐나?", "why": "지난 회의에서 다음 보고에 넣어 달라고 요청했습니다.", "prep": "10월 연구 진척 · 예산 리포트 기준 위탁 3.2만 · 자체 2.6만 · 공동연구 1.1만 원 — 김소희 님 리포트에서 바로 가져올 수 있음"}, {"q": "비용 15% 절감은 어디서 줄이나?", "why": "전사 방침의 첫 대상이 위탁 시험 집행입니다.", "prep": "위탁 시험 예산 20%를 공동연구로 이동하는 안 (10월 리포트 제안) — 시제품 내열 성능 향상 18%는 유지"}], "challenges": [{"point": "공동연구 목표 달성 가능성 12%", "why": "같은 막힘이 3주째 반복되고 계획에 대체 경로가 없습니다.", "prep": "인정: 외부 데이터 의존을 늦게 다뤘다. 대안: 대체 데이터 경로를 이번 주 계획에 넣고, 목표 조정 여부를 11월 첫 주에 판단"}, {"point": "특허 관리 체계 정비가 계속 밀림", "why": "계획 변경 2회, 진척 정체.", "prep": "범위를 특허 현황판 1차 화면으로 줄이고 나머지는 1월로"}]}, {"exec_id": "{{E2}}", "name": "문혜란", "lens": "4분기 실행계획이 ’최악의 경우’까지 대비돼 있는가", "opener": "실행계획 초안은 공동연구 데이터 지연을 가장 큰 리스크로 두고, 대체 경로까지 넣어 6일 뒤 제출하겠습니다.", "questions": [{"q": "실행계획 초안은 기한(D-6) 안에 나오나?", "why": "경영기획팀 요청 기한이 다가옵니다.", "prep": "초안 골격 완료 · 경로별 시험 단가 목표만 남음 — 금요일 내부 리뷰 후 제출"}, {"q": "B대학 데이터가 안 들어오면 어떻게 되나?", "why": "리스크 중심으로 보는 분이고 외부 의존이 가장 큰 변수입니다.", "prep": "최악: 4분기 공동연구 목표 약 18억 원에서 멈춤 → 대체 기관 2곳으로 1.4억 원 보완안"}], "challenges": [{"point": "시제품과 공동연구가 같은 사람·같은 시기에 겹침", "why": "공동연구 하위 과제 3건이 한 사람에게 몰려 있습니다.", "prep": "데이터 정리 1건을 이재혁 님에게 옮기는 재배분 계획을 함께 보고"}]}], "requests": [{"note_id": "", "title": "연구소 4분기 연구 실행계획 초안 제출", "due": "{{D6}}", "status": "진행 중", "reply": "4분기 실행계획 초안은 비용 15% 절감과 경로별 시험 단가 목표를 반영해 기한 안에 제출하겠습니다. 공동연구 데이터 지연에 대비한 대체 경로도 함께 넣었습니다."}, {"note_id": "", "title": "경로별 시험 단가 비교표를 다음 보고에 추가", "due": "", "status": "미답", "reply": "경로별 시험 단가는 위탁 3.2만 · 자체 2.6만 · 공동연구 1.1만 원입니다. 다음 주간회의에 비교표로 정리해 가겠습니다."}], "share_first": [{"title": "B대학 데이터는 11월 둘째 주 이후 — 공동연구 목표 일정에 영향", "why": "다른 경로로 들으면 ’왜 미리 말 안 했나’가 됩니다.", "tone": "bad"}, {"title": "시제품 내구 시험 1,840회 · 성능 향상 18%", "why": "연구소장 관심사(효율)에 바로 답이 되는 좋은 숫자입니다.", "tone": "good"}], "watch": "B대학 회신 날짜, 실행계획 제출 후 예산 배분 결정."}$j$, '{{E1}}', e1::text), '{{E2}}', e2::text), '{{D6}}', (current_date + 6)::text)::jsonb, L;
  exception when others then null;
  end;

  -- 팀원 평가: 김현정 님 예상 등급(시뮬레이션) + 의견 초안
  begin
    execute $q$insert into public.ai_outputs (team_id, kind, subject_user_id, status, visibility, level, depth, content, sources, created_by, created_at, period_start, period_end)
      values ($1, 'evaluation_draft', $2, 'draft', 'leader', 'L3', 3, $3, '[]'::jsonb, $4, now() - interval '1 day',
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 7 else 1 end, 1),
        make_date(extract(year from current_date)::int, case when extract(month from current_date) >= 7 then 12 else 6 end, case when extract(month from current_date) >= 7 then 31 else 30 end))$q$
    using T, m_kim, $j${"grade": {"expected": "A", "range": ["B", "A"], "confidence": "medium", "rationale": "핵심 과제(신소재 시제품 개발)를 끌고 가면서 결과물의 판단 깊이가 2.0에서 3.0으로 뚜렷이 올랐고, 결과물 대부분이 한 번에 승인됐습니다. 다만 시제품 일정은 계획보다 조금 늦습니다.", "up": [{"text": "개발 방식을 데이터로 스스로 뒤집고, 버린 대안과 이유를 남김 (계획서 v3)", "evidence": []}, {"text": "결과물 8건 중 6건 승인, 그중 4건이 한 번에 통과", "evidence": []}, {"text": "연구소장 질의에 근거를 들어 답함 (1on1 기록)", "evidence": []}], "down": [{"text": "기술 동향 분석처럼 정형 업무에서는 자기 관점이 약하다는 보완점이 두 번 반복", "evidence": []}], "missing": "실행 관리(일정 준수) 근거가 아직 적어 A로 확정하기는 이릅니다. 11월 시제품 결과를 보면 확실해집니다."}, "overall": "문제를 끝까지 붙들고 방향을 다시 잡는 힘이 이번 기간 가장 두드러졌습니다. 시제품 개발 방식에서 처음 가정을 데이터로 뒤집고 대안을 비교해 남긴 과정이 대표적입니다. 결과물의 판단 깊이가 꾸준히 올라 팀의 핵심 과제를 맡길 수 있는 수준입니다. 다만 정해진 틀을 채우는 작업에서는 자기 관점이 덜 드러납니다.", "strengths": [{"title": "근거 기반의 방향 전환", "detail": "초기 가정을 고집하지 않고 데이터를 보고 전략을 고쳤습니다.", "evidence": []}, {"title": "결과물 품질의 꾸준한 상승", "detail": "판단 깊이 2.0 → 3.0, 대부분 한 번에 승인됐습니다.", "evidence": []}], "growth": [{"title": "정형 업무에서의 자기 관점", "detail": "기술 동향 분석 등에서 일반적 정리에 머무는 경우가 있습니다.", "evidence": []}, {"title": "일정 관리", "detail": "시제품 개발이 계획보다 조금 늦습니다.", "evidence": []}], "competencies": [{"name": "문제 정의", "signal": "강함", "evidence": []}, {"name": "데이터 분석", "signal": "보통", "evidence": []}, {"name": "커뮤니케이션", "signal": "강함", "evidence": []}, {"name": "실행 관리", "signal": "근거 부족", "evidence": []}], "coaching": "다음 기간에는 일정이 분명한 과제를 맡기고 2주 단위로 진척을 함께 점검해 실행 관리 근거를 쌓으세요."}$j$::jsonb, L;
  exception when others then null;
  end;

  -- 업무플랫폼: 최근에 올라온 다양한 업무 (컨펌·의견·공유 / 보고서·링크·캡처·메모·숫자)
  declare r record; sid uuid;
  begin
    for r in select * from (values
      (m_jung, t3, '공동연구 제안서 — B대학 제외 2개 기관 안, 의견 부탁드려요', 'note', 'feedback', null::text, E'B대학 데이터가 이번 달 안에 들어오기 어려워 보여서, A연구원·C대학 두 곳으로 범위를 줄인 안을 만들었습니다. 목표 영향은 약 -1.4억 원으로 봅니다. 이 방향으로 가도 될지 의견 부탁드려요.', 2),
      (m_jung, t3, 'B대학 시험 데이터 회신 지연 현황 (메일 캡처)', 'image', 'share', null, '협력 기관 회신 메일 캡처 — 11월 둘째 주 이후 가능', 1),
      (m_park, t7, '10월 연구 진척 · 예산 리포트', 'document', 'approval', null, E'10월 연구 진척 · 예산 리포트\n1. 경로별 시험 단가: 위탁 3.2만 원, 자체 2.6만 원, 공동연구 1.1만 원\n2. 시제품 내열 성능 향상 18%\n3. 11월 제안: 위탁 시험 예산 20% 공동연구로 이동', 0),
      (m_park, t7, '연구 예산 대시보드 개편 1차 화면', 'link', 'share', 'https://example.com/dashboard-v1', '요청하신 1차 배포 화면 링크입니다', 3),
      (m_lee, t4, 'LIMS 데이터 양식 A/B안', 'document', 'feedback', null, E'A안: 시험 항목 중심 (필수 15개)\nB안: 시료 이력 중심\n공동연구 데이터 대상, 2주 시범 적용 예정. 어느 쪽이 나을지 의견 주세요.', 1),
      (m_han, t1, '수요처 인터뷰 1차 4곳 결과 메모', 'note', 'share', null, E'4곳 중 3곳이 표면 코팅 방식에 긍정적. ESS 업체 2곳은 내열 성능보다 공급 단가를 더 중요하게 봄.', 4),
      (m_choi, t5, '11월 시험 일정표', 'link', 'feedback', 'https://example.com/content-calendar-11', '시제품 확정 주간에 시험을 몰았는데 괜찮을지 봐 주세요', 2),
      (m_kim, t1, '시제품 내구 시험 누적 수', 'number', 'share', null, '내구 시험 누적', 0)
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
      ('공동연구 제안서 — B대학 제외 2개 기관 안, 의견 부탁드려요', $j${
        "depth_score": 1.5,
        "summary": "B대학 데이터 지연이라는 문제는 분명히 짚었지만, 범위를 줄이는 것 말고 다른 길(파일럿·공개 데이터)을 비교하지 않았고 A연구원·C대학을 고른 근거도 없습니다. 목표 영향 -1.4억 원이 어떻게 나왔는지도 빠져 있습니다.",
        "brief": {"tone": "risk", "text": "정예슬 님이 올린 ’공동연구 제안서 — B대학 제외 2개 기관 안’은 고민의 깊이가 낮아 보입니다", "why": "범위만 줄이고 대안 비교·선정 근거가 없음"},
        "decisions": [],
        "strengths": [{"section": "본문", "text": "막힌 원인(B대학 데이터 회신 지연)과 목표 영향을 먼저 밝혔습니다."}],
        "gaps": [{"section": "본문", "text": "범위 축소 외에 파일럿 기관·공개 데이터로 1차안을 만드는 길을 검토하지 않았습니다."},
                 {"section": "본문", "text": "A연구원·C대학을 고른 이유와 -1.4억 원 추정 근거가 없습니다."}],
        "questions": ["B대학을 빼지 않고 1차안을 먼저 내는 방법은 검토해 봤나요?", "-1.4억 원은 어떤 가정으로 나온 숫자인가요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      ('10월 연구 진척 · 예산 리포트', $j${
        "depth_score": 3.0,
        "summary": "경로별 시험 단가를 나란히 놓고 공동연구가 가장 효율적이라는 결론까지 짧고 분명하게 전달합니다. 승인 요청이라 팀장님이 정할 것이 있습니다 — 위탁 시험 예산 20% 이동은 시제품 확정 주간 시험과 맞물려 있어 판단이 필요합니다.",
        "brief": {"tone": "risk", "text": "김소희 님이 요청한 ’10월 연구 진척 · 예산 리포트’에 팀장님이 결정할 사항이 있습니다", "why": "11월 위탁 시험 예산 20%를 공동연구로 옮길지"},
        "decisions": ["11월 위탁 시험 예산 20% → 공동연구 이동", "시제품 확정 주간 위탁 시험 예외 여부"],
        "strengths": [{"section": "1. 경로별 시험 단가", "text": "세 경로 시험 단가를 같은 기준으로 비교해 결론이 바로 보입니다."}],
        "gaps": [{"section": "3. 11월 제안", "text": "예산 이동이 시제품 내구 시험(위탁 의뢰분)에 주는 영향 추정이 없습니다."}],
        "questions": ["시제품 확정 주간에도 위탁 시험 예산을 20% 줄이나요?", "공동연구 시험 단가 1.1만 원은 B대학 지연 이후에도 유지되나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$),
      ('LIMS 데이터 양식 A/B안', $j${
        "depth_score": 2.5,
        "summary": "두 안의 방향(시험 항목 vs 시료 이력)과 시범 기간은 정리됐지만, 본인은 어느 안을 권하는지와 무엇으로 승부를 볼지(등록률·재사용률) 기준이 없어 결론이 잘 보이지 않습니다.",
        "brief": {"tone": "watch", "text": "최원석 님이 올린 ’LIMS 데이터 양식 A/B안’은 결론이 잘 안 보입니다", "why": "어느 안을 권하는지·판단 기준이 없음"},
        "decisions": [],
        "strengths": [{"section": "본문", "text": "대상(공동연구 데이터)과 시범 기간을 분명히 했습니다."}],
        "gaps": [{"section": "본문", "text": "성공 지표와 본인 추천안이 빠져 있어 의견을 주기 어렵습니다."}],
        "questions": ["둘 중 어느 쪽이 나을 거라고 보나요, 이유는?", "2주 뒤 무엇을 보고 승자를 정하나요?"],
        "change_from_previous": "", "trend_note": "", "criteria_check": []
      }$j$)
    ) as x(title, c)
    join submissions s on s.team_id = T and s.title = x.title
    join submission_versions v on v.submission_id = s.id and v.version = 1;
    -- 최다은 11월 콘텐츠 캘린더: 보완 요청 (팀원 홈 '지금 할 일'에 뜬다)
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
    select s.id, v.id, T, L, '확정 주간에 몰린 건 좋은데, 그 주 분석센터 슬롯이 이미 찼어요. 2건은 앞 주로 당기고, 일정이랑 담당까지 표로 다시 올려 주세요.', now() - interval '20 hours'
    from submissions s join submission_versions v on v.submission_id = s.id where s.team_id = T and s.title = '11월 시험 일정표';
    update submissions set status = 'needs_work' where team_id = T and title = '11월 시험 일정표';
  exception when others then null;
  end;
  -- 그룹 스페이스 (23_work_groups 이후에만 들어감): 신제품 런칭 TF · 제휴 채널 확대
  declare wg1 uuid; wg2 uuid; gs uuid; gv1 uuid; gv2 uuid; c1 uuid;
  begin
    insert into work_groups (team_id, name, item_id, created_by, created_at) values (T, '신소재 시제품 TF', g1, m_kim, now() - interval '20 days') returning id into wg1;
    insert into work_groups (team_id, name, item_id, created_by, created_at) values (T, '공동연구 확대', g2, L, now() - interval '15 days') returning id into wg2;
    insert into work_group_members (group_id, user_id, team_id) values (wg1, m_kim, T), (wg1, m_han, T), (wg1, m_choi, T), (wg2, m_jung, T), (wg2, m_lee, T);
    -- TF: 김현정·한수진이 같이 다듬는 키비주얼 시안 (v1 김현정 → v2 한수진)
    insert into submissions (team_id, author_id, item_id, group_id, title, kind, request_type, created_at)
      values (T, m_kim, t1, wg1, '시제품 배합 시안', 'document', 'feedback', now() - interval '3 days') returning id into gs;
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
      (gs, T, 1, E'배합 시안 2종\nA안: 세라믹 고함량 + 고밀도 (고강도)\nB안: 경량 필러 + 저밀도 (배터리 모듈 적합)\n개발 콘셉트: ”가볍고 오래가는 첫 소재”', 'A/B 두 안', m_kim, now() - interval '3 days') returning id into gv1;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at) values
      (gs, gv1, T, m_han, '인터뷰에서 배터리 업체는 B안 같은 경량 배합에 더 반응했어요. B안 밀도를 조금 더 낮춰 보면 어떨까요?', now() - interval '2 days 20 hours') returning id into c1;
    insert into review_comments (submission_id, version_id, team_id, author_id, parent_id, body, created_at) values
      (gs, gv1, T, m_kim, c1, '좋아요. 그럼 B안 기준으로 밀도 낮춰서 v2 만들어 볼게요.', now() - interval '2 days 18 hours'),
      (gs, gv1, T, m_choi, c1, '심사 쪽에서도 B안이 시편으로 가공하기 편해요.', now() - interval '2 days 16 hours');
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
      (gs, T, 2, E'배합 시안 — B안 발전\n경량 필러, 밀도를 한 단계 낮춤\n두께별 시편 버전 포함 (1mm, 2mm)\n개발 콘셉트: ”가볍고 오래가는 첫 소재”', 'B안 밀도 보강 · 두께별 시편 추가 (윤채원)', m_han, now() - interval '1 day') returning id into gv2;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at) values
      (gs, gv2, T, L, '방향 좋습니다. 수요처 제출용 샘플에도 같은 배합을 쓸 수 있는지 분석센터와 확인해 주세요.', now() - interval '20 hours'),
      (gs, gv2, T, m_kim, '확인해서 내일까지 답 드릴게요.', now() - interval '6 hours');
    update submissions set status = 'in_review' where id = gs;
    -- 제휴: 공유만
    insert into submissions (team_id, author_id, item_id, group_id, title, kind, request_type, created_at)
      values (T, m_jung, t3, wg2, '협력 기관 공동 시험 일정', 'note', 'share', now() - interval '2 days') returning id into gs;
    insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
      (gs, T, 1, E'A연구원 11/12~11/25, C대학 11/19~12/2 공동 시험\nLIMS 데이터 양식은 11/10까지 확정 필요', '', m_jung, now() - interval '2 days');
    insert into review_comments (submission_id, team_id, author_id, body, created_at) values
      (gs, T, m_lee, '데이터 양식은 A/B 결과 보고 11/8까지 확정할게요.', now() - interval '1 day');
  exception when others then null;
  end;
  -- 업무 스페이스 대화 (24_work_space 이후에만 들어감)
  declare c1 uuid; wg uuid;
  begin
    select id into wg from work_groups where team_id = T and name = '신소재 시제품 TF';
    insert into space_messages (team_id, space_user, author_id, item_id, body, created_at)
      values (T, m_choi, m_choi, t5, '분석센터 주간 고정 슬롯 확정됐어요 — 매주 화 오후 2시간', now() - interval '26 hours') returning id into c1;
    insert into space_messages (team_id, space_user, author_id, parent_id, body, created_at)
      values (T, m_choi, L, c1, '좋아요, 이걸로 리드타임이 얼마나 줄지 다음 주에 같이 봐요.', now() - interval '25 hours');
    insert into space_messages (team_id, space_user, author_id, body, created_at) values
      (T, m_choi, L, '내일 오전 주간회의 10시로 당겨졌어요. 참고하세요!', now() - interval '22 hours'),
      (T, m_choi, m_choi, '네 확인했습니다 👍', now() - interval '21 hours'),
      (T, m_jung, L, 'B대학 회신 오면 바로 알려 줘요. 급하면 메시지로 먼저 줘도 됩니다.', now() - interval '30 hours');
    if wg is not null then
      insert into space_messages (team_id, group_id, author_id, item_id, body, created_at)
        values (T, wg, m_han, t1, '수요처 인터뷰 2차 4곳 다음 주 화요일로 확정됐어요. 배합 시안 B안도 같이 보여 줄게요.', now() - interval '28 hours') returning id into c1;
      insert into space_messages (team_id, group_id, author_id, parent_id, body, created_at) values
        (T, wg, m_kim, c1, '좋아요! 반응 좋으면 B안으로 바로 굳히죠.', now() - interval '27 hours'),
        (T, wg, m_choi, c1, '두께별 시편도 같이 보여 주면 좋을 것 같아요.', now() - interval '26 hours');
      insert into space_messages (team_id, group_id, author_id, body, created_at) values
        (T, wg, m_choi, '시제품 시험 계획서 초안은 이번 주 금요일까지 올릴게요.', now() - interval '5 hours');
    end if;
  exception when others then null;
  end;
  -- 히스토리 관리 (30_history 이후에만 들어감): 과제 3개 히스토리 + 한수진 님에게 전달 1건 · 질문/답
  declare h_tmpl text; h_txt text; h_m text; h_sh uuid;
  begin
    for h_tmpl in select x from (values
      -- 제휴 프로모션 제안서 (정우성)
      (t3::text || '|' || $j${"summary":"3개 기관 공동연구로 시작했다가 B대학 시험 데이터 회신 지연으로 A·C 2개 기관 축소안 검토 중. 범위 결정과 LIMS 데이터 양식 확정이 다음 단계.",
 "lanes":[{"id":"L1","title":"공동연구 범위"},{"id":"L2","title":"B대학 데이터"},{"id":"L3","title":"A·C 공동 시험"},{"id":"L4","title":"LIMS 연계"}],
 "events":[{"id":"V1","lane":"L1","date":"@-30","title":"제안서 v1","kind":"doc","detail":"A·B·C 3개 기관 공동연구 제안서 초안."},
  {"id":"V2","lane":"L1","date":"@-27","title":"보완: 숫자로","kind":"feedback","detail":"팀장 피드백 — 기관별 기대 수주액을 숫자로 제시할 것."},
  {"id":"V3","lane":"L1","date":"@-20","title":"3개 기관 확정","kind":"decision","detail":"v2 승인. 3개 기관 동시 진행으로 확정."},
  {"id":"V4","lane":"L2","date":"@-14","title":"데이터 지연","kind":"issue","detail":"B대학 시험 데이터 회신이 11월 둘째 주 이후로 밀림 (메일 캡처 공유)."},
  {"id":"V5","lane":"L1","date":"@-7","title":"2개 기관 축소안","kind":"doc","detail":"B대학 제외, A·C 2개 기관으로 범위를 줄인 안. 목표 영향 약 −1.4억 원."},
  {"id":"V6","lane":"L3","date":"@-2","title":"일정 공유","kind":"doc","detail":"A연구원 11/12~25, C대학 11/19~12/2 공동 시험 일정 공유."},
  {"id":"V7","lane":"L4","date":"@-1","title":"양식 확정 필요","kind":"issue","detail":"LIMS 데이터 양식을 A/B 결과 보고 11/8까지 확정 (최원석)."},
  {"id":"V8","lane":"L1","date":"@7","title":"범위 결정","kind":"decision","future":true,"detail":"축소안 채택 여부와 목표치 조정을 함께 결정."},
  {"id":"V9","lane":"L3","date":"@21","title":"A연구원 시작","kind":"plan","future":true}],
 "links":[{"from":"V4","to":"V5","label":"지연 → 축소안"},{"from":"V7","to":"V9","label":"시작 조건"}],
 "people":[{"id":"P1","name":"정예슬","org":"산학 협력","scope":"team","role":"담당 · 제안서 작성"},
  {"id":"P2","name":"최원석","org":"연구 데이터 · LIMS","scope":"team","role":"데이터 양식 확정"},
  {"id":"P3","name":"B대학","org":"협력 기관","scope":"external","role":"시험 데이터 지연","check":true},
  {"id":"P4","name":"A연구원 소재팀","org":"협력 기관","scope":"external","role":"공동 시험 11/12~"},
  {"id":"P5","name":"C대학 재료공학과","org":"협력 기관","scope":"external","role":"공동 시험 11/19~","check":true}],
 "fixed":[{"id":"F1","text":"공동연구 보고는 기관별 기대 수주액·비용·리스크를 첫 장에","detail":"제안서 v1 피드백에서 팀장이 정한 보고 기준.","since":"@-27"},
  {"id":"F2","text":"A연구원 11/12~25, C대학 11/19~12/2 공동 시험","since":"@-2"}],
 "open":[{"id":"O1","text":"진행 범위(A·C 2개 기관) — 목표치 조정과 함께 결정","detail":"축소안을 채택하면 연내 목표 8억 원 중 약 1.4억 원이 빠짐."},
  {"id":"O2","text":"LIMS 데이터 양식 확정 — A연구원 시작 조건"}],
 "risks":[{"id":"K1","text":"B대학 데이터 추가 지연 시 2차 합류 불가","detail":"11월 둘째 주 이후에도 수급이 안 되면 연내 합류가 어려움."}],
 "tried":[{"id":"T1","text":"3개 기관 동시 진행 — B대학 데이터 의존이 커서 일정 리스크"}],
 "gaps":[{"id":"G1","text":"B대학과 지연 이후 합의 내용 — 기록 없음 → 정예슬 님께 확인"},{"id":"G2","text":"C대학 비용 분담 비율 — 기록 없음"}],
 "related":[{"item_id":"@t4","title":"공동연구 데이터 LIMS 연계","why":"데이터 양식이 시작 조건"}],
 "progress":{"measure":"percent","unit":"%","target":100,"points":[{"date":"@-30","value":0},{"date":"@-21","value":22},{"date":"@-14","value":26},{"date":"@-7","value":28},{"date":"@0","value":30}]},
 "owner":{"id":null,"name":"정예슬","previous":[]}}$j$),
      -- 런칭 캠페인 기획 (김현정)
      (t1::text || '|' || $j${"summary":"배합 시안은 수요처 인터뷰 반응을 근거로 B안(경량 필러·저밀도)으로 좁히는 중. 인터뷰 2차와 임원 보고가 다음 고비.",
 "lanes":[{"id":"L1","title":"배합 시안"},{"id":"L2","title":"수요처 인터뷰"},{"id":"L3","title":"임원 보고"}],
 "events":[{"id":"V1","lane":"L2","date":"@-30","title":"적용처 정의","kind":"decision","detail":"전기차 배터리 모듈 · 첫 채택 고객사로 타깃 확정."},
  {"id":"V2","lane":"L2","date":"@-10","title":"인터뷰 1차 4곳","kind":"doc","detail":"4곳 중 3곳이 표면 코팅 방식에 긍정적. ESS 업체는 공급 단가를 더 중요하게 봄."},
  {"id":"V3","lane":"L1","date":"@-3","title":"시안 A/B","kind":"doc","detail":"A안 세라믹 고함량·고밀도, B안 경량 필러·저밀도."},
  {"id":"V4","lane":"L1","date":"@-2","title":"B안 기울기","kind":"feedback","detail":"인터뷰에서 배터리 업체가 B안에 더 반응 — B안 기준으로 v2."},
  {"id":"V5","lane":"L1","date":"@-1","title":"v2 · 두께별 시편","kind":"doc","detail":"B안 밀도 보강, 두께별 시편(1mm, 2mm) 추가."},
  {"id":"V6","lane":"L2","date":"@6","title":"인터뷰 2차","kind":"plan","future":true},
  {"id":"V7","lane":"L3","date":"@38","title":"임원 보고","kind":"plan","future":true}],
 "links":[{"from":"V2","to":"V4","label":"인터뷰 반응 → B안"}],
 "people":[{"id":"P1","name":"이재혁","org":"소재 개발","scope":"team","role":"담당 · 배합 시안"},
  {"id":"P2","name":"윤채원","org":"소재 개발","scope":"team","role":"인터뷰 진행"},
  {"id":"P3","name":"박민규","org":"연구 과제 관리","scope":"team","role":"시편 가공 활용"},
  {"id":"P4","name":"분석센터","org":"분석","scope":"dept","role":"수요처 제출용 샘플","check":true}],
 "fixed":[{"id":"F1","text":"타깃: 전기차 배터리 모듈 · 첫 채택 고객사","since":"@-30"},{"id":"F2","text":"배합 시안은 B안 기준으로 발전","since":"@-2"}],
 "open":[{"id":"O1","text":"수요처 제출 샘플에 같은 배합 사용 여부 — 분석센터 확인"},{"id":"O2","text":"인터뷰 2차 결과로 B안 확정"}],
 "tried":[{"id":"T1","text":"세라믹 고함량 A안 — 배터리 업체 반응 약함"}],
 "gaps":[{"id":"G1","text":"임원 보고 형식·참석자 — 기록 없음 → 팀장님께 확인"}],
 "progress":{"measure":"children","unit":"%","target":100,"points":[{"date":"@-30","value":20},{"date":"@-10","value":40},{"date":"@0","value":40}]},
 "owner":{"id":null,"name":"이재혁","previous":[]}}$j$),
      -- 콘텐츠 제작 프로세스 개선 (최다은)
      (t5::text || '|' || $j${"summary":"분석센터 고정 슬롯 확보 후 리드타임 측정 시작. 평균 2.6주로 목표 2주까지 남은 구간.",
 "lanes":[{"id":"L1","title":"프로세스"},{"id":"L2","title":"측정"}],
 "events":[{"id":"V1","lane":"L1","date":"@-21","title":"고정 슬롯","kind":"decision","detail":"분석센터 주간 고정 슬롯 확정 (화 오후 2시간)."},
  {"id":"V2","lane":"L2","date":"@-14","title":"리드타임 측정","kind":"doc","detail":"측정 시작 — 평균 9일."},
  {"id":"V3","lane":"L2","date":"@-5","title":"월 심사 건수","kind":"doc","detail":"지표 추가, 4건 시범 적용."},
  {"id":"V4","lane":"L1","date":"@20","title":"마감 연장 요청","kind":"plan","future":true,"detail":"외부 분석 기관 교체로 2주 연장 요청."}],
 "people":[{"id":"P1","name":"박민규","org":"연구 과제 관리","scope":"team","role":"담당"},{"id":"P2","name":"분석센터","org":"분석","scope":"dept","role":"주간 고정 슬롯"},{"id":"P3","name":"외부 분석 기관","scope":"external","role":"교체 중","check":true}],
 "fixed":[{"id":"F1","text":"분석센터 주간 고정 슬롯 (화 오후 2시간)","since":"@-21"}],
 "open":[{"id":"O1","text":"마감 2주 연장 · 특허 연계 가이드 다음 분기 이관 여부"}],
 "risks":[{"id":"K1","text":"외부 분석 기관 교체로 템플릿 정비 지연"}],
 "gaps":[],
 "progress":{"measure":"percent","unit":"%","target":100,"points":[{"date":"@-21","value":45},{"date":"@-14","value":55},{"date":"@-5","value":66}]},
 "owner":{"id":null,"name":"박민규","previous":[]}}$j$)
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
      select T, t1, L, m_han, '채원 님, 인터뷰 2차부터 같이 봐 주세요. 배합 시안은 B안으로 기울어 있으니 그 기준으로 질문지를 다듬으면 됩니다.', content, 'sent', now() - interval '1 day', now() - interval '1 day'
        from task_histories where item_id = t1 returning id into h_sh;
    insert into history_messages (share_id, team_id, author_id, body, created_at) values
      (h_sh, T, m_han, '인터뷰 2차도 4곳으로 하나요? ESS 업체 비중을 늘릴지 궁금합니다.', now() - interval '20 hours'),
      (h_sh, T, L, '4곳 유지하고 ESS 업체를 2곳으로 맞춰 주세요. 공급 단가 질문은 꼭 넣어 주세요.', now() - interval '18 hours');
    -- 김현정 님이 요청한 히스토리 (팀장 확인 대기)
    insert into history_shares (team_id, item_id, to_id, note, status, created_at)
      values (T, t3, m_kim, '공동연구와 시제품 일정이 겹쳐서 흐름을 알고 싶어요', 'requested', now() - interval '3 hours');
  exception when others then null;
  end;
  -- 성과 체크인 (22_checkin 이후에만 들어감): 최다은 '단계 심사 프로세스 개선' 승인 3건 + 승인 대기 1건
  declare ck uuid; r record;
  begin
    for r in select * from (values (45, '30%', 21, '분석센터 고정 슬롯 확보, 1차 프로세스 문서 공유'), (55, '45%', 14, '리드타임 측정 시작 — 평균 9일'), (66, '55%', 5, '월 심사 건수 지표 추가, 4건 시범 적용'))
                    as x(v, prev, ago, note) loop
      insert into submissions (team_id, author_id, item_id, space_id, title, kind, request_type, created_at)
        values (T, m_choi, t5, m_choi, '성과입력 · 단계 심사 프로세스 개선 ' || r.v || '%', 'checkin', 'approval', now() - (r.ago || ' days')::interval) returning id into ck;
      insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, value, checkin, created_at)
        values (ck, T, 1, r.note, r.note, m_choi, r.v, jsonb_build_object('type', 'percent', 'value', r.v, 'prev', r.prev, 'label', r.v || '%'), now() - (r.ago || ' days')::interval);
      update submissions set status = 'approved', approved_by = L, updated_at = now() - (r.ago || ' days')::interval + interval '4 hours' where id = ck;
    end loop;
    insert into submissions (team_id, author_id, item_id, space_id, title, kind, request_type, created_at)
      values (T, m_choi, t5, m_choi, '성과입력 · 단계 심사 프로세스 개선 75%', 'checkin', 'approval', now() - interval '3 hours') returning id into ck;
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
  cast_ text[][] := array[['demo_rnd','서정민'], ['demo_rnd_p1','이재혁'], ['demo_rnd_p2','김소희'], ['demo_rnd_p3','박민규'], ['demo_rnd_p4','정예슬'], ['demo_rnd_p5','최원석'], ['demo_rnd_p6','윤채원']];
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
    where email = 'demo_rnd@' || dom or email ~ ('^demo_rnd_p[0-9]+@' || replace(dom, '.', '\.') || '$') ;
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
    execute format('update auth.users set %I = '''' where (email = $1 or email ~ $2) and %I is null', col, col) using 'demo_rnd@' || dom, '^demo_rnd_p[0-9]+@' || replace(dom, '.', '\.') || '$';
  end loop;

  -- 2) 팀장 구독 (Pro, 1년) + 데모 팀 + 기록
  insert into public.subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (L, 'pro', 'active', null, now(), now() + interval '1 year');
  -- 팀 ID는 예전 것을 다시 쓴다 (보고 있던 화면의 팀 선택이 그대로 맞도록)
  insert into public.teams (id, name, owner_id, is_demo) values (coalesce(T, gen_random_uuid()), '연구개발팀 (데모)', L, true) returning id into T;
  perform public.seed_demo_team(T, L, members);
end $$;

select u.email as "데모 계정", p.full_name as "이름", tm.role as "역할", tm.job_title as "직무"
from auth.users u join public.profiles p on p.id = u.id join public.team_members tm on tm.user_id = u.id
where u.email = 'demo_rnd@ateam.com' or u.email ~ '^demo_rnd_p[0-9]+@ateam\.com$' order by tm.role = 'leader' desc, tm.joined_at;


do $$
declare r record; v_jung uuid; v_lee uuid; v_goal uuid; v_exec uuid;
begin
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo and t.name = '연구개발팀 (데모)' loop
    if exists (select 1 from leader_notes where team_id = r.team_id) then continue; end if;
    select tm.user_id into v_jung from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '정예슬' limit 1;
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '최원석' limit 1;
    select id into v_goal from work_items where team_id = r.team_id and parent_id is null and title like '산학%' limit 1;
    select id into v_exec from executives where team_id = r.team_id order by sort limit 1;
    insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, pinned, created_at, updated_at) values
      (r.team_id, r.leader_id, '분기 마감 전 팀 회고는 짧게 30분 — 잘된 것 1개, 바꿀 것 1개만', 'note', 'none', null, true, now() - interval '6 days', now() - interval '6 days'),
      (r.team_id, r.leader_id, '연구소장 주간회의 전에 공동연구 전망 숫자 다시 확인', 'todo', 'none', null, false, now() - interval '1 day', now() - interval '1 day');
    if v_jung is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '혼자 끙끙 앓는 편. 막히면 먼저 물어봐 주는 게 효과 있음', 'member', v_jung, '정예슬', true, now() - interval '9 days', now() - interval '9 days'); end if;
    if v_lee is not null then insert into leader_notes (team_id, owner_id, body, kind, anchor_type, anchor_id, created_at, updated_at)
      values (r.team_id, r.leader_id, '다음 1on1에서 교육 예산 얘기 꺼내기', 'todo', 'member', v_lee, now() - interval '3 days', now() - interval '3 days'); end if;
    if v_goal is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, 'B대학 말고 C대학 공동연구 가능성도 열어 두기 — 대외협력실 박 팀장에게 물어보기', 'item', v_goal, true, now() - interval '2 days', now() - interval '2 days'); end if;
    if v_exec is not null then insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, ai_allowed, created_at, updated_at)
      values (r.team_id, r.leader_id, '숫자는 항상 지난달 대비로. 표보다 한 줄 결론을 먼저', 'exec', v_exec, true, now() - interval '5 days', now() - interval '5 days'); end if;
  end loop;
end $$;

do $$
declare r record; v_lee uuid;
begin
  for r in select t.id team_id from teams t where t.is_demo and t.name = '연구개발팀 (데모)' loop
    select tm.user_id into v_lee from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '최원석' limit 1;
    if v_lee is null or exists (select 1 from coaching_notes where team_id = r.team_id) then continue; end if;
    alter table coaching_notes disable trigger t_coaching_notify;
    insert into coaching_notes (team_id, member_id, title, body, created_at) values (r.team_id, v_lee,
      'LIMS 연계, 진척을 한 번 정리해 볼까요?',
      E'요즘 흐름\n’공동연구 데이터 LIMS 연계’를 혼자 맡아 진행하고 있어요. 계획보다 조금 늦어지고 있고, 최근에는 진척 공유가 뜸해요.\n\n특히 짚고 싶은 것\n· ’공동연구 데이터 LIMS 연계’ — 지금까지 한 것과 남은 것이 기록으로 잘 보이지 않아요\n\n왜 중요해요\n공동연구 목표와 이어진 과제라, 진행 상황이 보여야 필요한 도움을 제때 받을 수 있어요.\n\n점검해 볼 것\n· 지금까지 한 것과 남은 것을 짧게 정리할 수 있는지\n· 막힌 부분이 있다면 무엇이 필요한지 정리돼 있는지\n\n권장 시점 · 이번 주 금요일까지',
      now() - interval '2 days');
    -- 김현정: 받은함 예시 (확인 전)
    insert into coaching_notes (team_id, member_id, title, body, created_at)
    select r.team_id, tm.user_id, '계획서, 근거를 한 번 더 받쳐 볼까요?',
      E'요즘 흐름\n’시제품 개발 계획’ 결과물을 꾸준히 올리고 있어요. 내용은 충실한데, 주장에 비해 근거가 좀 약하고 구조화가 덜 되어 있어요.\n\n특히 짚고 싶은 것\n· ’하반기 신소재 시제품 개발 계획서’의 신규 배합 단독 이유 부분 — 주장을 받치는 근거가 보이지 않아요\n\n왜 중요해요\n읽는 사람이 근거를 따라갈 수 있어야 내용이 그대로 설득력을 가져요.\n\n점검해 볼 것\n· 핵심 주장마다 근거(숫자 · 사례 · 출처)를 한 줄 붙일 수 있는지\n· 이 장만 읽어도 무엇을 말하려는지 보이는지\n\n권장 시점 · 다음 결과물을 올리기 전',
      now() - interval '1 day'
    from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이재혁' limit 1;
    alter table coaching_notes enable trigger t_coaching_notify;
  end loop;
end $$;

do $$
declare r record; v_choi uuid;
begin
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo and t.name = '연구개발팀 (데모)' loop
    select tm.user_id into v_choi from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '박민규' limit 1;
    if v_choi is null or exists (select 1 from leader_notes where team_id = r.team_id and '초대 메모' = any(tags)) then continue; end if;
    insert into leader_notes (team_id, owner_id, body, anchor_type, anchor_id, anchor_label, ai_allowed, tags, created_at, updated_at)
    values (r.team_id, r.leader_id, E'강점: 시험 설계가 빠르고 아이디어가 많음\n보완할 점: 일정이 밀릴 때 공유가 늦음', 'member', v_choi::text, '박민규', true,
            array['초대 메모'], now() - interval '40 days', now() - interval '40 days');
  end loop;
end $$;












do $$
declare
  r record; v_users uuid[]; s record; n int; v_quarter jsonb; v_ways jsonb; v_kh text := '보고서 한 장 요약 양식';
  v_kim uuid; v_choi uuid; v_han uuid; v_jung uuid; t0 timestamptz; v_msg uuid; v_item uuid;
  asks text[] := array[
    '팀장님, 공동연구 제안서 B대학 데이터가 계속 안 와서요. B대학을 빼고 A·C 2개 기관 안으로 먼저 낼지, 데이터 올 때까지 일주일 더 기다릴지 정해 주시면 그에 맞춰 일정 다시 잡겠습니다.',
    '내구 시험이 목표 대비 37%라서 코팅 재료 예산 일부를 외부 위탁 시험으로 옮기면 어떨까 싶어요. 300만 원 정도 옮겨도 될지 금요일까지 컨펌 부탁드려요.'];
  fb text[] := array[
    '내용은 충실한데 결론이 3페이지에 있어서 찾느라 시간이 걸렸어요. 첫 문단에 결론부터 써 주세요.',
    '성능 수치가 언제 기준인지 빠져 있어요. 출처랑 기준일을 같이 적어 주세요.',
    '방향은 동의해요. 다만 왜 이 시험 경로인지 근거 데이터를 한 장 붙여 주면 위에 올리기 쉬워요.',
    '이건 생산기술팀 일정이랑 겹칠 수 있어요. 올리기 전에 생산기술팀과 먼저 맞춰 주세요.'];
begin
  if to_regclass('public.simbox_messages') is null then raise notice '36_workspace_plus 를 먼저 Run 하세요 — 데모 확장 기록은 건너뜁니다'; return; end if;
  for r in select t.id team_id, t.name, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo and t.name = '연구개발팀 (데모)' loop
    select tm.user_id into v_kim  from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '이재혁' limit 1;
    select tm.user_id into v_choi from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '박민규' limit 1;
    select tm.user_id into v_jung from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '정예슬' limit 1;
    select tm.user_id into v_han  from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '윤채원' limit 1;

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
      (r.team_id, v_jung, 'user', '협력 기관 데이터가 2주째 안 들어와서 공동연구 제안서가 멈춰 있어요. 혼자 더 붙잡고 있어야 할지, 팀장님께 도움을 요청해야 할지 모르겠어요. 요청한다면 어떻게 말씀드리면 좋을까요?', null, null, t0),
      (r.team_id, v_jung, 'assistant',
       '2주째 같은 이유로 막혀 있다면 지금 요청하는 게 맞아요. 팀 방향의 일하는 방식에도 막히면 일찍 공유하라는 기준이 있어요. 외부 데이터 문제는 혼자 풀기 어려운 일이라, 늦게 꺼낼수록 일정만 더 밀려요. 말씀드릴 때는 지금 상태와 영향, 이미 해 본 것, 팀장님께 바라는 것 한 가지 순서로 짧게 정리해 보세요. 데이터 없이 먼저 진행할 수 있는 부분이 있는지도 함께 제안하면, 도움 요청이 아니라 해결안 보고로 받아들여져요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('요청 메시지 초안 써 줘', '데이터 없이 먼저 할 수 있는 일 정리해 줘'),
         'panel', jsonb_build_object('title', '도움 요청 — 공동연구 제안서 막힘',
           'questions', jsonb_build_array(
             jsonb_build_object('q', '언제부터, 무엇 때문에 멈춰 있나요?', 'tip', '요청한 날짜 · 받기로 한 날짜 · 지금까지 연락한 횟수'),
             jsonb_build_object('q', '이대로면 목표에 어떤 영향이 있나요?', 'tip', '제안서 일정이 밀릴 때 공동과제 수주 목표에 생기는 차이'),
             jsonb_build_object('q', '팀장님이 무엇을 해 주시면 풀리나요?', 'tip', '윗선 협조 요청 · 일정 조정 · 대체 데이터 중 하나로')),
           'fixes', jsonb_build_array(
             jsonb_build_object('t', '바라는 것을 하나로', 'd', '여러 가지를 늘어놓기보다 가장 필요한 한 가지를 먼저'),
             jsonb_build_object('t', '먼저 할 수 있는 일 함께', 'd', '데이터 없이 진행 가능한 부분과 그 일정')),
           'good', jsonb_build_array(jsonb_build_object('t', '막힌 이유가 분명함', 'd', '본인 일정 문제가 아니라 외부 의존이라는 점이 드러남')))),
       t0 + interval '18 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_jung, t0);
    end if;

    if v_choi is not null then   -- 결과물 검토 (파일 + 오른쪽 짚어 볼 포인트)
      t0 := now() - interval '2 days 3 hours';
      insert into simbox_messages (team_id, user_id, role, body, attachment, meta, created_at) values
      (r.team_id, v_choi, 'user', '11월 시험 일정표 초안이에요. 팀장님께 올리기 전에 한번 봐 주세요.',
       jsonb_build_object('name', '11월_시험일정표_v2.xlsx', 'kind', 'text',
         'digest', '11월 시험 12건 일정. 시제품 확정 주간(3주차)에 6건 집중. 건당 담당 · 장비 · 목표 지표(재현성 · 정밀도) 표기. 분석센터 슬롯 표시 없음. 지난달 결과 비교 없음.'),
       null, t0),
      (r.team_id, v_choi, 'assistant',
       '전체 구성은 탄탄해요. 다만 시제품 확정 주간에 6건이 몰려 있는데 분석 장비가 가능한지 표시가 없어서, 일정 질문이 먼저 나올 가능성이 높아요. 팀 방향의 일하는 방식에 유관부서와 미리 맞추라는 기준이 있으니 분석센터 확인 여부를 한 줄 넣어 두면 좋겠어요. 목표 지표를 왜 재현성 · 정밀도로 잡았는지도 지난달 숫자와 함께 짧게 붙이면 판단이 쉬워져요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('일정 분산안 같이 짜 줘', '지표 근거 한 줄로 써 줘'),
         'panel', jsonb_build_object('title', '11월 시험 일정표 v2',
           'questions', jsonb_build_array(
             jsonb_build_object('q', '확정 주간 6건, 분석 장비 가능한가요?', 'tip', '분석센터 슬롯 확인 결과나 앞 주로 당길 건 표시'),
             jsonb_build_object('q', '재현성 · 정밀도를 목표 지표로 잡은 이유는요?', 'tip', '지난달 건당 재현성 · 정밀도와 비교')),
           'fixes', jsonb_build_array(
             jsonb_build_object('t', '맨 위에 한 줄 요약', 'd', '몇 건 · 언제 집중 · 기대 효과를 첫 줄에'),
             jsonb_build_object('t', '지난달 결과 열 추가', 'd', '같은 장비 지난달 숫자와 기준일')),
           'good', jsonb_build_array(jsonb_build_object('t', '건마다 담당 · 장비가 분명함', 'd', '바로 실행할 수 있는 수준')))),
       t0 + interval '20 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_choi, t0);
    end if;

    if v_kim is not null then    -- 보고 방법 · 타이밍
      t0 := now() - interval '1 day 5 hours';
      insert into simbox_messages (team_id, user_id, role, body, attachment, meta, created_at) values
      (r.team_id, v_kim, 'user', '내구 시험이 목표 대비 많이 밀려 있어요. 이번 주 주간 보고에서 어떻게 꺼내면 좋을까요?', null, null, t0),
      (r.team_id, v_kim, 'assistant',
       '밀린 상황은 숨기기보다 먼저 꺼내는 게 좋아요. 팀 방향의 일하는 방식에 막히면 일찍 공유하고, 숫자에는 기준일을 붙이라는 기준이 있어서 그 순서로 짜 보면 자연스러워요. 첫 줄에 현재 누적과 목표 대비 비율, 다음 줄에 밀린 이유 한두 가지, 마지막에 만회 방안과 팀장님이 정해 주셨으면 하는 것을 두세요. 만회 방안은 하나보다 두 가지를 놓고 고르게 하면 대화가 빨라져요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('보고 첫 문단 같이 써 줘', '만회 방안 두 가지 정리해 줘'),
         'panel', jsonb_build_object('title', '주간 보고 — 내구 시험 현황',
           'questions', jsonb_build_array(
             jsonb_build_object('q', '언제까지 얼마나 따라잡을 수 있나요?', 'tip', '주차별 만회 계획 숫자'),
             jsonb_build_object('q', '시험 경로별로 어디가 제일 약한가요?', 'tip', '자체 · 위탁 시험 비중과 지난주 대비')),
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
       '팀 방향과 팀 목표로 보면 지금은 신소재 시제품이 가장 앞에 있고, 산학 공동연구 확대와 과제 관리 효율화가 뒤를 잇고 있어요. 일하는 방식에서는 근거 자료를 붙이는 것과 결론을 먼저 쓰는 것이 여러 번 강조됐어요. 다만 팀장님 개인의 생각까지는 자료로 알 수 없어서, 확실하지 않은 부분은 1on1에서 직접 여쭤보는 걸 권해요. 최근에 공유된 보고서 한 장 요약 양식을 먼저 익혀 두면 첫 보고가 한결 수월할 거예요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('1on1에서 물어볼 질문 추려 줘', '한 장 요약 양식으로 연습해 볼래'), 'panel', null),
       t0 + interval '12 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_han, t0);
    end if;

    -- 6) 의사결정 보드 '팀원 요청' — 팀원이 대화에서 물은 결정 (45_decision_asks 이후에만 카드가 된다)
    if v_jung is not null then
      select id into v_item from work_items where team_id = r.team_id and title = '공동연구 과제 제안서' limit 1;
      insert into space_messages (team_id, space_user, author_id, item_id, body, created_at)
        values (r.team_id, v_jung, v_jung, v_item, asks[1], now() - interval '2 days 2 hours') returning id into v_msg;
      if to_regclass('public.decision_asks') is not null then
        execute $q$update decision_asks set status = 'ask', classified_at = now(),
          ai = '{"title": "공동연구 제안서를 B대학 빼고 2개 기관 안으로 먼저 낼지", "options": ["B대학 빼고 A·C 2개 기관 안으로 먼저 제출", "B대학 데이터 올 때까지 일주일 더 기다림"], "due": null}'::jsonb
          where src_id = $1$q$ using v_msg;
      end if;
    end if;
    if v_kim is not null then
      select id into v_item from work_items where team_id = r.team_id and title = '시제품 코팅 사양 확정' limit 1;
      insert into space_messages (team_id, space_user, author_id, item_id, body, created_at)
        values (r.team_id, v_kim, v_kim, v_item, asks[2], now() - interval '20 hours') returning id into v_msg;
      if to_regclass('public.decision_asks') is not null then
        execute $q$update decision_asks set status = 'ask', classified_at = now(),
          ai = '{"title": "코팅 재료 예산 300만 원을 위탁 시험으로 옮길지", "options": ["300만 원을 위탁 시험으로 이동", "옮기지 않고 지금 계획 유지"], "due": "금요일까지"}'::jsonb
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
  update teams set settings = coalesce(settings, '{}'::jsonb) || '{"plan_open": false}'::jsonb where is_demo and name = '연구개발팀 (데모)';
end $$;









do $$
declare
  r record; c1 uuid; c2 uuid; v_jung uuid; v_item uuid; t text;
  ch jsonb;
begin
  if to_regclass('public.core_works') is null then raise notice '46_core_works 를 먼저 Run 하세요 — 데모 핵심 업무는 건너뜁니다'; return; end if;
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo and t.name = '연구개발팀 (데모)' loop
    delete from history_shares where team_id = r.team_id and core_work_id is not null;
    delete from core_work_chapters where team_id = r.team_id;
    delete from core_works where team_id = r.team_id;   -- core_work_items 는 함께 지워진다
    delete from core_work_state where team_id = r.team_id;
    select tm.user_id into v_jung from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '정예슬' limit 1;

    -- ---------- 1) 제휴사 파트너십 운영 ----------
    insert into core_works (team_id, title, summary, since_year, dirty, synced_at, updated_at, content) values (r.team_id, '산학 공동연구 운영',
      '7년째 A연구원 · C대학 중심으로 운영 중인 산학 공동연구. 2021년 B대학 정산 분쟁 이후 협약서 기준이 정해졌고, 지금은 B대학 데이터 지연으로 2026 제안서가 막혀 있음.',
      2019, false, now(), now(), $j${
        "eras": [{"name": "오태현", "from": "2019-01", "to": "2020-12"}, {"name": "한승우", "from": "2021-01", "to": "2022-05"}, {"name": "김소희", "from": "2022-06", "to": "2024-07"},
                 {"name": "이재혁", "from": "2024-08", "to": "2025-03"}, {"name": "정예슬", "from": "2025-04", "to": null}],
        "principles": [{"text": "연구비 정산은 월 1회 · 익월 10일", "year": 2020}, {"text": "협약서에 정산 지연 이자 조항 (B대학 분쟁 이후)", "year": 2021},
                       {"text": "협력 기관에 분기마다 성과 리포트 공유", "year": 2022}, {"text": "배합 원자료는 비공개 · 결과값만 공유", "year": 2024}],
        "recurring": [{"text": "A연구원 · C대학 재협약 협의 — 2월 말까지 성과 리포트 준비", "when": "매년 3월"}, {"text": "협력 기관 성과 리포트 발송", "when": "매 분기"},
                      {"text": "다음 해 공동 시험 일정 확정", "when": "매년 11월"}],
        "tried": [{"text": "소규모 연구실 10곳 동시 협약 → 관리 부담으로 8곳 종료", "year": 2023}, {"text": "B대학 연구비 인상 협상 → 데이터 공유 조항과 맞바꿔 동결", "year": 2024}],
        "people": [{"text": "A연구원 소재팀 — 실무 창구 3번 바뀜", "since": 2019}, {"text": "C대학 재료공학과 — 공동 시험 파트너", "since": 2020},
                   {"text": "B대학 산학협력단 — 정산 분쟁 이력 · 데이터 회신 느림", "since": 2021}, {"text": "재무팀 — 연구비 정산 · 협약 검토", "since": 2021}],
        "open": [{"text": "B대학 데이터 공유 주기 — 협약엔 있지만 지켜진 적 드묾", "since": 2024}, {"text": "2개 기관 축소안으로 제안서 먼저 낼지", "since": 2026}],
        "cautions": [{"text": "B대학과 정산 이야기는 메일로만 — 2021년 구두 합의가 분쟁 원인"}, {"text": "3월 재협약 전에 담당이 바뀌면 리포트 준비가 밀림"}],
        "gaps": [{"text": "2019 시범 종료 이유 — 기록 없음 → 오태현 님(전 담당)에게 확인"}]
      }$j$::jsonb) returning id into c1;

    for ch in select * from jsonb_array_elements($j$[
      {"y": 2019, "t": "산학 공동연구 첫 시범", "o": "오태현", "p": "2019-03 ~ 2019-08", "c": {"summary": "공동연구 가능성을 보려 3개월 시범", "key": "시범 3개월 · 과제 2건", "decisions": ["A연구원 1곳으로 시범 시작 — 리스크를 줄이려고"], "results": "과제 2건 완료, 정식 협약 검토로 넘어감", "lessons": ["정산 기준 없이 시작해 월말 정산이 매번 늦어짐"], "carried": ["정산 기준 정하기"], "people": ["A연구원 소재팀 — 첫 파트너"]}},
      {"y": 2020, "t": "A연구원 · C대학 정식 협약", "o": "오태현", "p": "2020-01 ~ 2020-06", "c": {"summary": "A연구원 · C대학과 1년 단위 정식 협약", "key": "정산 월 1회로 확정", "decisions": ["정산 월 1회 · 익월 10일로 확정 — 재무팀 요청"], "results": "2개 기관 협약, 공동 시험 월 30건", "lessons": [], "carried": ["B대학 추가 검토"], "people": ["C대학 재료공학과 — 공동 시험", "재무팀 — 정산 기준"]}},
      {"y": 2021, "t": "B대학 정산 분쟁 대응", "o": "한승우", "p": "2021-02 ~ 2021-07", "c": {"summary": "B대학 정산 지연 3개월 · 구두 합의 해석 차이로 분쟁", "key": "B대학 정산 지연 → 지연 이자 조항", "decisions": ["협약서에 정산 지연 이자 조항 추가", "정산 관련 합의는 메일로만"], "results": "미정산금 회수, 협약 유지", "lessons": ["구두 합의가 분쟁 원인"], "carried": ["협약서 표준화"], "people": ["B대학 — 정산 담당 교체 잦음", "재무팀 · 법무팀 — 협약 검토"]}},
      {"y": 2021, "t": "공동연구 협약서 표준화", "o": "한승우", "p": "2021-08 ~ 2021-12", "c": {"summary": "협력 기관 공통 협약서 양식 정리", "decisions": ["공통 양식 + 기관별 부속서"], "results": "신규 협약 검토 기간 3주 → 1주", "lessons": [], "carried": [], "people": ["법무팀"]}},
      {"y": 2022, "t": "협력 기관 성과 리포트 도입", "o": "김소희", "p": "2022-06 ~ 2022-12", "c": {"summary": "협력 기관에 분기 성과 리포트를 보내기 시작", "key": "분기 리포트로 관계 안정", "decisions": ["분기마다 리포트 공유"], "results": "재협약 협의가 숫자 중심으로 바뀜", "lessons": [], "carried": ["리포트 준비를 재협약 일정에 맞추기"], "people": ["A연구원 소재팀 — 창구 교체"]}},
      {"y": 2023, "t": "신규 협력 기관 발굴", "o": "김소희", "p": "2023-02 ~ 2023-11", "c": {"summary": "협력 기관을 늘리려 12곳 접촉", "key": "후보 12곳 중 2곳만 협약", "decisions": ["소규모 연구실 10곳 동시 협약 시도"], "results": "관리 부담으로 8곳 종료, 2곳만 유지", "lessons": ["소규모 다수 협약은 관리 비용이 큼"], "carried": [], "people": []}},
      {"y": 2024, "t": "B대학 재협약", "o": "김소희", "p": "2024-01 ~ 2024-04", "c": {"summary": "B대학 연구비 인상 요구 속 재협약", "key": "연구비 동결 · 데이터 공유 조항", "decisions": ["연구비 동결 대신 데이터 공유 조항 추가", "배합 원자료는 비공개 · 결과값만"], "results": "재협약, 데이터 공유 주기는 협약상 월 1회", "lessons": ["연구비 협상은 데이터 조항과 맞바꾸는 쪽이 통함"], "carried": ["B대학 데이터 공유 주기 지키기"], "people": ["B대학 — 협상 창구 바뀜"]}},
      {"y": 2024, "t": "공동연구 LIMS 연계 1차", "o": "이재혁", "p": "2024-08 ~ 2024-12", "c": {"summary": "공동연구 시험 데이터를 LIMS에 처음 연결", "decisions": ["A연구원 · C대학부터 연계"], "results": "공동연구 데이터 표준 등록률 측정 시작", "lessons": [], "carried": ["B대학 연계는 데이터 문제로 보류"], "people": ["LIMS 담당 — 최원석"]}},
      {"y": 2025, "t": "협력 기관 장비 공동 활용", "o": "정예슬", "p": "2025-04 ~ 2025-12", "c": {"summary": "협력 기관 장비를 함께 쓰는 운영", "key": "공동 활용 5곳 · 시험 1.8배", "decisions": ["협력 기관 장비 공동 활용 5곳"], "results": "공동 시험 1.8배, 수주 4억 원 달성", "lessons": [], "carried": ["2026 공동연구 과제 제안"], "people": ["C대학 — 공동연구 확대 의향"]}}
    ]$j$::jsonb) loop
      insert into core_work_chapters (team_id, core_work_id, year, title, owner_name, period, content)
      values (r.team_id, c1, (ch->>'y')::int, ch->>'t', ch->>'o', ch->>'p', ch->'c');
    end loop;
    foreach t in array array['공동연구 과제 제안서', '공동연구 데이터 LIMS 연계'] loop
      select id into v_item from work_items where team_id = r.team_id and title = t and status <> 'dropped' order by created_at desc limit 1;
      if v_item is not null then
        insert into core_work_items (item_id, core_work_id, team_id, reason)
        values (v_item, c1, r.team_id, case when t = '공동연구 과제 제안서' then '관계자 B대학 · A연구원, 지표 ’공동과제 수주액’이 같음' else '관계자 B대학 · LIMS 연계가 2024년 장에서 이어짐' end)
        on conflict (item_id) do update set core_work_id = excluded.core_work_id, reason = excluded.reason;
      end if;
    end loop;

    -- ---------- 2) 신제품 런칭 운영 ----------
    insert into core_works (team_id, title, summary, since_year, dirty, synced_at, updated_at, content) values (r.team_id, '연간 특허 · 인증 관리',
      '해마다 한두 건 시제품의 특허 출원 · 인증을 운영. 2024년부터 선행 특허 조사를 먼저 하고 결과를 본 뒤 출원 범위를 넓히는 순서가 굳어짐.',
      2023, false, now(), now(), $j${
        "eras": [{"name": "김소희", "from": "2023-03", "to": "2024-06"}, {"name": "이재혁", "from": "2024-07", "to": null}],
        "principles": [{"text": "선행 특허 조사를 먼저 하고 결과를 본 뒤 출원 범위 확대", "year": 2024}, {"text": "인증 시험 비용은 과제 예산의 15%를 넘지 않음", "year": 2025}],
        "recurring": [{"text": "출원 6주 전 수요처 인터뷰", "when": "시제품마다"}, {"text": "생산기술팀 원가표 반영 확인", "when": "출원 2주 전"}],
        "tried": [{"text": "1차 출원에 청구항 집중 → 초반 심사만 빠르고 이후 거절 급증", "year": 2023}],
        "people": [{"text": "분석센터 — 배합 분석 · 주간 고정 슬롯", "since": 2023}, {"text": "생산기술팀 — 원가표 · 일정 충돌 잦음", "since": 2024}],
        "open": [{"text": "내구 시험 목표 대비 37% — 만회 방안", "since": 2026}],
        "cautions": [{"text": "생산기술팀 원가표가 늦게 나오면 코팅 사양을 확정할 수 없음"}],
        "gaps": []
      }$j$::jsonb) returning id into c2;
    for ch in select * from jsonb_array_elements($j$[
      {"y": 2023, "t": "내열 소재 특허 출원", "o": "김소희", "p": "2023-03 ~ 2023-05", "c": {"summary": "내열 소재 특허 출원", "key": "1차 출원 집중 → 이후 거절 급증", "decisions": ["1차 출원에 청구항 60% 집중"], "results": "목표 대비 82%", "lessons": ["한 번에 넓게 출원하기보다 선행 조사로 범위를 먼저 보는 게 나음"], "carried": ["선행 특허 조사 도입"], "people": ["분석센터"]}},
      {"y": 2024, "t": "하반기 코팅 소재 인증", "o": "이재혁", "p": "2024-08 ~ 2024-11", "c": {"summary": "선행 조사를 먼저 한 첫 인증", "key": "선행 조사 먼저 · 목표 108%", "decisions": ["선행 조사 4주 → 결과 보고 출원 범위 확대"], "results": "목표 대비 108%", "lessons": [], "carried": [], "people": ["생산기술팀 — 원가표 지연"]}},
      {"y": 2025, "t": "경량 소재 시제품 인증 획득", "o": "이재혁", "p": "2025-03 ~ 2025-07", "c": {"summary": "경량 소재 개발과 함께한 인증", "key": "인증 비용 15% 상한 정함", "decisions": ["인증 시험 비용은 과제 예산의 15%를 넘지 않음 — 원가 기준"], "results": "목표 달성", "lessons": [], "carried": [], "people": []}}
    ]$j$::jsonb) loop
      insert into core_work_chapters (team_id, core_work_id, year, title, owner_name, period, content)
      values (r.team_id, c2, (ch->>'y')::int, ch->>'t', ch->>'o', ch->>'p', ch->'c');
    end loop;
    foreach t in array array['시제품 개발 계획', '시제품 코팅 사양 확정'] loop
      select id into v_item from work_items where team_id = r.team_id and title = t and status <> 'dropped' order by created_at desc limit 1;
      if v_item is not null then
        insert into core_work_items (item_id, core_work_id, team_id, reason) values (v_item, c2, r.team_id, '시제품마다 반복되는 선행 특허 조사 · 수요처 인터뷰 · 생산기술팀 원가표가 같음')
        on conflict (item_id) do update set core_work_id = excluded.core_work_id, reason = excluded.reason;
      end if;
    end loop;

    -- ---------- AI가 한 일 · 전달 ----------
    insert into core_work_state (team_id, status, finished_at, actions) values (r.team_id, 'ready', now(), jsonb_build_array(
      jsonb_build_object('at', now(), 'core_work_id', c1, 'text', '2026 ’공동연구 과제 제안서’를 ’산학 공동연구 운영’에 묶음 (관계자 B대학 · A연구원, 지표 ’공동과제 수주액’이 같음)'),
      jsonb_build_object('at', now(), 'core_work_id', c1, 'text', '2025 ’협력 기관 장비 공동 활용’을 장으로 접어 고정'),
      jsonb_build_object('at', now(), 'core_work_id', c1, 'text', '’산학 공동연구 운영’ 흐름을 다시 정리 (장 9개 · 진행 중 과제 2개)'),
      jsonb_build_object('at', now(), 'core_work_id', c2, 'text', '2026 ’시제품 개발 계획’을 ’연간 특허 · 인증 관리’에 묶음 (선행 특허 조사 · 수요처 인터뷰 · 생산기술팀 원가표가 같음)')));

    if v_jung is not null then
      insert into history_shares (team_id, core_work_id, from_id, to_id, note, status, sent_at, created_at, snapshot)
      select r.team_id, c1, r.leader_id, v_jung, '산학 쪽은 2021년 B대학 건만 알면 반은 이해한 거예요. 3월 재협약 전에 같이 한 번 봐요.', 'sent', now() - interval '1 day', now() - interval '1 day',
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









do $$
declare
  r record; m record; L uuid; task text; oo uuid; last_oo uuid; d int;
begin
  if to_regclass('public.one_on_one_entries') is null then return; end if;
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader'
            where t.is_demo and t.name = '연구개발팀 (데모)' loop
    L := r.leader_id;
    for m in
      select tm.user_id uid, (regexp_match(u.email, '_p([0-9])@'))[1]::int n
        from team_members tm join auth.users u on u.id = tm.user_id
       where tm.team_id = r.team_id and tm.role = 'member' and tm.status = 'active' and u.email ~ '_p[0-9]@'
    loop
      -- 이 팀원의 대표 과제 (목표 바로 아래 · 진행 중 · 지표 아님)
      select w.title into task from work_items w join work_items p on p.id = w.parent_id and p.parent_id is null
       where w.team_id = r.team_id and w.owner_id = m.uid and w.status in ('active', 'blocked') and coalesce(w.role, 'task') <> 'metric'
       order by w.status = 'blocked' desc, w.sort, w.created_at limit 1;
      task := coalesce(task, '맡은 과제');
      select id into last_oo from one_on_ones where team_id = r.team_id and member_id = m.uid and status = 'done' order by scheduled_at desc limit 1;

      -- ---------- 지난 1on1 기록 (같은 말만 반복되던 것을 그 사람 이야기로) ----------
      if last_oo is not null and m.n between 2 and 6 then
        update one_on_one_entries set body = case m.n
            when 2 then '정기 업무 일정 점검. 지난달 빠진 회차는 마감 이틀 전 초안 공유로 보완하기로 함. 다음 분기에 맡고 싶은 일도 이야기 나눔.'
            when 3 then '「' || task || '」 진행 공유. 고정 일정 확보 효과를 확인했고, 다음 달에 소요 시간을 다시 재 보기로 함.'
            when 4 then '「' || task || '」 막힘 공유. 외부 회신 지연은 팀장이 위로 올려 협조를 요청하고, 그동안 할 수 있는 부분부터 진행하기로 함.'
            when 5 then '맡은 일이 한 사람에게 몰려 있는 점 확인. 다음 1on1 전까지 덜어낼 일 목록을 같이 보기로 함.'
            else '합류 한 달 회고. 팀 방식(결론 먼저 · 근거 붙이기)을 익히는 중이고, 다음 달에는 회의 요약을 한 번 맡아 보기로 함.' end
         where id = (select id from one_on_one_entries where one_on_one_id = last_oo order by created_at desc limit 1);
        update one_on_ones set shared_notes = (select body from one_on_one_entries where one_on_one_id = last_oo order by created_at desc limit 1) where id = last_oo;
      end if;

      -- ---------- 다음 1on1 + 미리 꺼낼 이야기 ----------
      select id into oo from one_on_ones where team_id = r.team_id and member_id = m.uid and status = 'scheduled' and scheduled_at > now() order by scheduled_at limit 1;
      if oo is null then
        d := case m.n when 1 then 4 when 2 then 2 when 3 then 6 when 4 then 2 when 5 then 1 else 8 end;
        insert into one_on_ones (team_id, leader_id, member_id, scheduled_at, duration_min, status)
        values (r.team_id, L, m.uid, date_trunc('day', now()) + make_interval(days => d) + interval '6 hours', 30, 'scheduled') returning id into oo;
      end if;
      insert into one_on_one_entries (one_on_one_id, team_id, author_id, body, created_at)
      values (oo, r.team_id, m.uid, case m.n
          when 1 then '다음 분기 목표 초안을 미리 같이 보고 싶어요.'
          when 2 then '정기 업무를 자동으로 정리하는 방법을 써 보고 싶어요. 시간이 얼마나 줄지 같이 봐 주세요.'
          when 3 then '지금 과제가 끝나면 다음에 맡을 일을 상의하고 싶어요.'
          when 4 then '막힌 과제 범위를 줄여서 먼저 내는 안도 같이 보고 싶어요.'
          when 5 then '요즘 혼자 처리하는 일이 많아서 우선순위를 같이 정하고 싶어요.'
          else '첫 달 해 보면서 궁금했던 점을 정리해 갈게요.' end, now() - interval '20 hours');

      -- ---------- 정한 할 일 (지난 1on1에서) ----------
      if last_oo is not null then
        insert into action_items (team_id, one_on_one_id, owner_id, title, due_date, done_at, created_by, created_at)
        select r.team_id, last_oo, m.uid, x.t, current_date + x.due, case when x.done then now() - interval '2 days' end, L, now() - interval '7 days'
          from (values
            (2, '정기 업무 초안을 마감 이틀 전 공유', 5, false), (2, '다음 분기 희망 업무 정리해 오기', -2, true),
            (3, '소요 시간 재는 기준 정리해 공유', 6, false),
            (4, '외부 회신 기한을 정해 메일로 요청', -3, true), (4, '외부 자료 없이 할 수 있는 부분 일정 정리', 3, false),
            (5, '맡은 일 목록과 주당 시간 적어 오기', 1, false),
            (6, '팀 노하우 한 번 훑어보기', -4, true), (6, '회의 요약 양식 미리 보기', 7, false)) x(n, t, due, done)
         where x.n = m.n;
      end if;

      -- ---------- Feedback ----------
      -- 칭찬 배지
      insert into observations (team_id, author_id, subject_id, kind, competency, body, occurred_at)
      select r.team_id, L, m.uid, 'praise', x.c, x.b, current_date - x.ago
        from (values
          (2, '실행 관리', '정기 업무를 매달 꾸준히 챙겨 줘서 팀이 숫자를 믿고 씁니다.', 9),
          (3, '문제 정의', '「' || task || '」에서 병목을 먼저 짚어 준 덕분에 개선 방향이 빨리 잡혔어요.', 12),
          (4, '커뮤니케이션', '막힌 상황을 숨기지 않고 바로 공유해 줘서 빨리 손쓸 수 있었어요.', 6),
          (5, '실행 관리', '「' || task || '」를 혼자서도 끝까지 붙잡고 있어 줘서 고마워요.', 15),
          (6, '협업', '조사 내용을 빠짐없이 정리해 줘서 다음 단계가 빨라졌어요.', 5)) x(n, c, b, ago)
       where x.n = m.n;
      -- 육성 · 지원·격려 · 업무 독려 (요청)
      insert into team_requests (team_id, from_id, to_id, kind, title, body, due_date, status, response, responded_at, created_at)
      select r.team_id, L, m.uid, x.k, x.t, x.b, case when x.due is not null then current_date + x.due end,
             (case when x.resp is not null then 'done' else 'open' end)::request_status, coalesce(x.resp, ''),
             case when x.resp is not null then now() - interval '1 day' end, now() - make_interval(days => x.ago)
        from (values
          (2, 'progress', '이번 달 정기 업무, 마감 이틀 전에 초안만 먼저 보여 주세요', '지난달처럼 몰리지 않게 초안만 봐도 충분해요.', 5, null::text, 2),
          (3, 'grow', '「' || task || '」 결과를 팀 노하우로 정리해 볼래요?', '다른 과제에도 쓸 수 있을 것 같아요. 한 장이면 충분해요.', null::int, null, 4),
          (4, 'cheer', '외부 회신 늦는 건 혼자 떠안지 않아도 돼요', '제가 위로 올려 둘게요. 이번 주는 무리하지 마세요.', null, '감사합니다. 회신 오는 대로 바로 공유할게요.', 3),
          (5, 'cheer', '요즘 일이 많이 몰려 있죠', '이번 주에 30분만 시간 내 주세요. 덜어낼 수 있는 일을 같이 봐요.', null, null, 1),
          (6, 'grow', '다음 주간 회의 요약을 맡아 볼래요?', '팀 전체 흐름을 빨리 익히는 데 좋아요. 처음엔 제가 같이 봐 줄게요.', null, '네, 해 볼게요!', 6),
          (1, 'grow', '다음 분기에는 후배 한 명의 결과물 리뷰를 같이 맡아 볼래요?', '지금 기준이면 충분히 잘할 것 같아요. 부담되면 편하게 말해 주세요.', null, null, 8)) x(n, k, t, b, due, resp, ago)
       where x.n = m.n;
      -- ATEAM 업무 피드백 (보낸 사람 표시 없음)
      if to_regclass('public.coaching_notes') is not null and not exists (select 1 from coaching_notes where team_id = r.team_id and member_id = m.uid) and m.n in (2, 3, 4, 6) then
        insert into coaching_notes (team_id, member_id, title, body, seen_at, created_at)
        values (r.team_id, m.uid, case m.n
            when 2 then '숫자 옆에 기준일을 붙이면 더 믿고 읽혀요'
            when 3 then '결과 숫자를 앞에 두면 더 잘 읽혀요'
            when 4 then '막힌 일, 요청은 한 가지로 좁혀 보세요'
            else '질문을 미리 적어 가면 1on1이 훨씬 알차져요' end,
          case m.n
            when 2 then '정기 업무 결과가 꾸준히 올라오고 있어요. 다만 숫자가 언제 기준인지 빠질 때가 있어 다시 묻게 되는 경우가 있어요. 표 제목 옆에 기준일을 한 줄 붙여 보세요.'
            when 3 then '「' || task || '」 공유 글이 꾸준히 올라오고 있어요. 다만 바뀐 점이 본문 뒤쪽에 있어 한 번에 읽히지 않을 때가 있어요. 첫 줄에 무엇이 얼마나 줄었는지를 숫자로 두고, 근거는 아래에 붙여 보세요.'
            when 4 then '「' || task || '」 상황을 빠르게 공유하고 있어요. 도움을 청할 때 바라는 것이 여러 개면 우선순위가 흐려질 수 있어요. 가장 필요한 한 가지를 먼저 쓰고, 나머지는 그다음에 덧붙여 보세요.'
            else '합류 초기라 궁금한 게 많을 때예요. 1on1 전에 묻고 싶은 것을 세 줄로 적어 두면 짧은 시간에도 필요한 답을 얻기 쉬워요.' end,
          case when m.n = 4 then null else now() - interval '1 day' end, now() - make_interval(days => m.n + 1));
      end if;
    end loop;
  end loop;
end $$;







do $$
declare
  r record; m record; w int; k int; cnt int; its uuid[]; slot int; d int; it uuid; ts timestamptz; mon date; got int; tries int;
  plan int[][] := array[
    array[7, 8, 7, 8, 7, 8, 7],   -- p1 (7주 전 → 지난주)
    array[2, 1, 2, 1, 1, 1, 1],   -- p2
    array[3, 4, 4, 5, 5, 6, 7],   -- p3
    array[7, 6, 7, 6, 3, 2, 1],   -- p4
    array[6, 7, 8, 8, 9, 10, 10], -- p5
    array[0, 0, 0, 1, 2, 2, 2]];  -- p6
begin
  if to_regclass('public.work_item_logs') is null then return; end if;
  for r in select t.id team_id from teams t where t.is_demo and t.name = '연구개발팀 (데모)' loop
    for m in
      select tm.user_id uid, tm.joined_at, (regexp_match(u.email, '_p([0-9])@'))[1]::int n
        from team_members tm join auth.users u on u.id = tm.user_id
       where tm.team_id = r.team_id and tm.role = 'member' and tm.status = 'active' and u.email ~ '_p[1-6]@'
    loop
      select array_agg(w2.id order by w2.sort, w2.created_at) into its from work_items w2
       where w2.team_id = r.team_id and w2.owner_id = m.uid and w2.parent_id is not null and w2.status not in ('dropped', 'proposed') and coalesce(w2.role, 'task') <> 'metric';
      if its is null then continue; end if;
      for w in 1..7 loop
        cnt := plan[m.n][8 - w];
        mon := date_trunc('week', now() at time zone 'Asia/Seoul')::date - w * 7;
        if mon + 6 < (m.joined_at at time zone 'Asia/Seoul')::date then continue; end if;
        slot := 0;
        for k in 1..cnt loop
          -- 평일부터 채우고(과부하 팀원은 주말 · 밤 비중을 높인다) · 같은 과제 같은 날 기록이 이미 있으면 다음 칸으로
          got := 0; tries := 0;
          while got = 0 and tries < 40 loop
            d := case when m.n = 5 and k % 5 = 0 then 5 + (k / 5 + tries) % 2 else (slot / array_length(its, 1)) % 7 end;
            if m.n <> 5 and d >= 5 and tries < 20 then slot := slot + 1; tries := tries + 1; continue; end if;
            it := its[1 + slot % array_length(its, 1)];
            slot := slot + 1; tries := tries + 1;
            ts := ((mon + d)::timestamp + case
                    when m.n = 5 and k % 5 in (0, 2) then time '22:40'
                    when m.n = 1 and k = 3 then time '21:20'
                    else (time '09:30' + make_interval(mins => (k * 53) % 420)) end) at time zone 'Asia/Seoul';
            insert into work_item_logs (item_id, team_id, author_id, kind, period, value, created_at)
            select it, r.team_id, m.uid, 'progress', (ts at time zone 'Asia/Seoul')::date,
                   greatest(0, coalesce(x.progress, 0) - w * 6 - (k % 3)), ts
              from work_items x where x.id = it
            on conflict do nothing;
            get diagnostics got = row_count;
          end loop;
        end loop;
      end loop;
    end loop;

  end loop;
end $$;


-- 데모 팀 표시 (데모 띠의 팀 고르기 · 직급 · 팀원 화면 기본 계정)
update public.teams set settings = coalesce(settings, '{}'::jsonb) || '{"demo_key": "rnd", "demo_label": "연구개발", "demo_ranks": {"이재혁": "차장", "김소희": "과장", "박민규": "대리", "정예슬": "과장", "최원석": "대리", "윤채원": "사원"}, "demo_default_member": "정예슬"}'::jsonb where is_demo and name = '연구개발팀 (데모)';
