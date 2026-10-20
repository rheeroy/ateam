-- =====================================================================
-- ATEAM 데모 데이터 (로컬 개발용: `supabase db reset` 시 자동 실행)
-- 팀장 1 + 팀원 6, 약 26주치 체크인·1on1·결과물·관찰 메모·실적·의사결정.
-- 로그인: Inbucket(로컬 메일함)에서 매직 링크로 leader@demo.ateam 등
-- ※ 운영 DB에는 넣지 마세요.
-- =====================================================================
do $$
declare
  L uuid := '00000000-0000-4000-a000-000000000001';
  m_kim uuid := '00000000-0000-4000-a000-000000000002';
  m_park uuid := '00000000-0000-4000-a000-000000000003';
  m_choi uuid := '00000000-0000-4000-a000-000000000004';
  m_jung uuid := '00000000-0000-4000-a000-000000000005';
  m_lee uuid := '00000000-0000-4000-a000-000000000006';
  m_han uuid := '00000000-0000-4000-a000-000000000007';
  T uuid := '00000000-0000-4000-b000-000000000001';
  g1 uuid; g2 uuid; g3 uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; mt uuid;
  sub uuid; ver uuid; oo uuid;
  wk date; i int; u record; v_month date := date_trunc('month', current_date)::date;
  this_mon date := date_trunc('week', current_date)::date;
begin
  -- GoTrue는 토큰 컬럼이 NULL이면 로그인에서 오류가 나므로 빈 문자열로 채운다
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated', x.email,
         jsonb_build_object('full_name', x.name), now(), '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb
  from (values (L, 'leader@demo.ateam', '이경훈'), (m_kim, 'kim@demo.ateam', '김현정'),
               (m_park, 'park@demo.ateam', '박서연'), (m_choi, 'choi@demo.ateam', '최다은'),
               (m_jung, 'jung@demo.ateam', '정우성'), (m_lee, 'lee@demo.ateam', '이동욱'),
               (m_han, 'han@demo.ateam', '한수진')) as x(id, email, name)
  on conflict (id) do nothing;
  if to_regclass('auth.identities') is not null then
    execute $q$
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
      select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now()
      from auth.users u where u.email like '%@demo.ateam'
      on conflict do nothing $q$;
  end if;

  insert into subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (L, 'pro', 'active', null, now() - interval '5 days', now() + interval '25 days') on conflict do nothing;
  insert into teams (id, name, mission, parent_link, owner_id) values
    (T, '전략기획팀', '신사업 기회를 빠르게 검증해, 회사의 다음 성장 동력을 만든다', '2026 회사 전략 목표 「신규 매출원 확보」 · 기여 비중 30%', L);
  insert into team_members (team_id, user_id, role, job_title, joined_at) values
    (T, L, 'leader', '팀장', now() - interval '200 days'),
    (T, m_kim, 'member', '기획', now() - interval '190 days'),
    (T, m_park, 'member', '데이터 분석', now() - interval '190 days'),
    (T, m_choi, 'member', 'HR 기획', now() - interval '180 days'),
    (T, m_jung, 'member', '사업개발', now() - interval '180 days'),
    (T, m_lee, 'member', '영업기획', now() - interval '150 days'),
    (T, m_han, 'member', '기획 (신규)', now() - interval '42 days');

  -- 목표·과제 (자유 계층)
  update teams set settings = settings || '{"level_names":["목표","과제","할 일"],"member_free_edit":false}'::jsonb where id = T;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '신제품 시장 진입 검증', 'children', 1, current_date - 60, current_date + 80, 5, now() - interval '60 days') returning id into g1;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '파트너 채널 확대', 'children', 2, current_date - 90, current_date + 70, 5, now() - interval '90 days') returning id into g2;
  insert into work_items (team_id, owner_id, title, measure, sort, start_date, due_date, contribution, created_at)
    values (T, L, '팀 역량 강화', 'children', 3, current_date - 60, current_date + 100, 3, now() - interval '60 days') returning id into g3;
  insert into hypotheses (team_id, item_id, statement, signal) values
    (T, g1, '침투가로 Q1 파일럿 전환율 20% 이상', '인터뷰 12명 중 구매 의향 7명'),
    (T, g2, 'B사 제휴로 연내 계약 4억', 'B사 데이터 수급 2주째 지연'),
    (T, g3, '온보딩 개편으로 신규 입사자 적응 기간 3개월 → 2개월', '한수진 6주차 독립 수행률 60%');
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '진입 전략 수립', m_kim, 1, 5, 16, 'children', 0, current_date - 45, current_date + 40, 1, now() - interval '45 days') returning id into t1;
  insert into work_items (team_id, parent_id, owner_id, title, measure, status, due_date, sort) values
    (T, t1, m_kim, '시장 규모 추정', 'check', 'done', current_date - 30, 1),
    (T, t1, m_kim, '경쟁사 가격 재분석', 'check', 'done', current_date - 10, 2),
    (T, t1, m_kim, '진입 시나리오 3안', 'check', 'active', current_date + 10, 3),
    (T, t1, m_han, '고객 인터뷰 12명', 'check', 'active', current_date + 20, 4),
    (T, t1, m_kim, '임원 보고', 'check', 'active', current_date + 38, 5);
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g1, '가격 정책 확정', m_kim, 1, 4, 8, 'percent', 85, current_date - 60, current_date - 5, 2, now() - interval '60 days') returning id into t2;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, status, start_date, due_date, sort, created_at) values
    (T, g2, '파트너 제안서', m_jung, 1, 5, 6, 'percent', 30, 'blocked', current_date - 30, current_date + 20, 1, now() - interval '30 days') returning id into t3;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g2, '영업 연계', m_lee, 2, 4, 6, 'percent', 35, current_date - 40, current_date + 50, 2, now() - interval '40 days') returning id into t4;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '온보딩 개선', m_choi, 2, 4, 10, 'percent', 66, current_date - 50, current_date + 30, 1, now() - interval '50 days') returning id into t5;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, progress, start_date, due_date, sort, created_at) values
    (T, g3, '사내 보고 자료 정비', m_jung, 3, 1, 18, 'percent', 40, current_date - 90, current_date + 60, 2, now() - interval '90 days') returning id into t6;
  insert into work_items (team_id, parent_id, title, owner_id, priority, contribution, est_hours_per_week, measure, recur, sort, created_at) values
    (T, g3, '월간 레거시 리포트 운영', m_park, 3, 2, 12, 'recurring', 'monthly', 3, now() - interval '120 days') returning id into t7;
  insert into work_item_logs (item_id, team_id, author_id, kind, period, done) values
    (t7, T, m_park, 'recurring', (v_month - interval '3 months')::date, true), (t7, T, m_park, 'recurring', (v_month - interval '2 months')::date, true),
    (t7, T, m_park, 'recurring', (v_month - interval '1 months')::date, false);
  -- 일정 변경 이력 (재계획 2회)
  update work_items set due_date = current_date + 5, change_reason = '경쟁사 데이터 추가 확보' where id = t2;
  update work_items set due_date = current_date + 10, change_reason = '임원 일정' where id = t2;
  -- 진척 기록 (최근 3주 속도)
  insert into work_item_logs (item_id, team_id, author_id, kind, period, value) values
    (t3, T, m_jung, 'progress', current_date - 21, 22), (t3, T, m_jung, 'progress', current_date - 14, 26), (t3, T, m_jung, 'progress', current_date - 7, 28),
    (t4, T, m_lee, 'progress', current_date - 21, 20), (t4, T, m_lee, 'progress', current_date - 14, 27),
    (t5, T, m_choi, 'progress', current_date - 21, 45), (t5, T, m_choi, 'progress', current_date - 14, 55)
    on conflict do nothing;
  -- 팀원이 올린 계획(검토 대기) + 팀장 요청
  insert into work_items (team_id, parent_id, owner_id, title, note, measure, status, start_date, due_date, sort)
    values (T, g2, m_lee, '파트너 영업 교육 자료 제작', '영업팀 대상 2회 교육', 'percent', 'proposed', current_date + 3, current_date + 35, 3);
  insert into team_requests (team_id, from_id, to_id, kind, item_id, title, body, due_date)
    values (T, L, m_jung, 'plan', g2, '파트너 채널 확대 — 하위 과제 계획 세워 주세요', '제안서 이후 단계까지 포함해서요', current_date + 3);
  insert into work_item_allocations (item_id, user_id, team_id, share_pct) values
    (t1, m_kim, T, 40), (t1, m_han, T, 30), (t2, m_kim, T, 20), (t3, m_jung, T, 15), (t4, m_lee, T, 20),
    (t5, m_choi, T, 30), (t6, m_jung, T, 45), (t6, m_park, T, 10), (t7, m_park, T, 30);

  insert into metrics (team_id, item_id, name, unit, target, period_start, period_end, cumulative)
    values (T, g2, '파트너 계약 금액', '억', 20, (v_month - interval '3 months')::date, (v_month + interval '2 months')::date, true) returning id into mt;
  insert into work_items (team_id, parent_id, owner_id, title, measure, num_target, unit, metric_id, sort)
    values (T, g2, m_lee, '파트너 계약 금액', 'number', 20, '억', mt, 4);
  insert into metric_values (metric_id, team_id, period, value) values
    (mt, T, (v_month - interval '3 months')::date, 3.4), (mt, T, (v_month - interval '2 months')::date, 3.6), (mt, T, (v_month - interval '1 months')::date, 4.2);
  insert into metric_pipeline (metric_id, team_id, label, amount, probability, expected_close) values
    (mt, T, 'B사 제휴', 4, 0.4, v_month + 45), (mt, T, 'C사 재계약', 2.5, 0.6, v_month + 30), (mt, T, 'D사 신규', 1.5, 0.3, v_month + 50);

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
              case when u.uid = m_kim and i = 1 then '가격 전략을 침투가로 바꾸는 방향에 합의. 2번 가설은 사용자 인터뷰로 검증하기로 함.'
                   else '진행 상황 공유, 다음 2주 우선순위 확인' end,
              now() - ((case when u.uid = m_lee then 21 else 7 end) + (i - 1) * 14) * interval '1 day');
    end loop;
  end loop;
  insert into one_on_ones (team_id, leader_id, member_id, scheduled_at) values
    (T, L, m_kim, date_trunc('day', now()) + interval '14 hours'),
    (T, L, m_park, date_trunc('week', now()) + interval '3 days 10 hours');
  insert into action_items (team_id, owner_id, title, due_date, created_by) values
    (T, L, '경쟁사 분석 리포트 공유', current_date - 7, L),
    (T, m_kim, '인터뷰 설계안 초안', current_date + 2, L),
    (T, L, '교육 예산 확인', current_date + 4, L);

  -- 결과물: 김현정 기획서 v1~v3 (리뷰 중)
  insert into submissions (team_id, author_id, item_id, title, status, created_at) values (T, m_kim, t1, '신제품 진입 기획서', 'in_review', now() - interval '30 days') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 1, E'1. 시장 분석\n국내 시장 규모 1.2조, 연 8% 성장.\n\n2. 가격 전략 — 프리미엄\n경쟁사 대비 20% 높은 가격으로 브랜드 포지셔닝.', '초안', m_kim, now() - interval '30 days'),
    (sub, T, 2, E'1. 시장 분석\n국내 시장 규모 1.2조, 연 8% 성장. 주요 경쟁사 3곳.\n\n2. 가격 전략 — 프리미엄\n브랜드 인지 조사 결과 반영 예정.\n\n3. 진입 시나리오\n파일럿 2곳.', '진입 시나리오 추가', m_kim, now() - interval '16 days');
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by, created_at) values
    (sub, T, 3, E'1. 시장 분석\n국내 시장 규모 1.2조, 연 8% 성장. 주요 경쟁사 3곳의 점유율 합계 61%.\n\n2. 가격 전략 — 침투가\n경쟁사 재분석 결과, 브랜드 인지도가 낮은 상태에서 프리미엄 가격은 초기 전환을 막는다고 판단했다. 경쟁사 대비 15% 낮은 침투가로 시작하고, 6개월 후 재검토한다. 버린 대안: 프리미엄(인지도 부족), 동일가(차별화 없음).\n\n3. 진입 시나리오\n파일럿 2곳 → 6개월 내 10곳.\n\n4. 가설별 검증 계획\n가설 1: 침투가로 전환율 20% 이상 — 파일럿 데이터로 검증\n가설 2: 중견기업이 주 고객 — 인터뷰 12명으로 검증 (데이터 보강 필요)',
     '가격 전략을 침투가로 전면 수정', m_kim, now() - interval '4 days') returning id into ver;
  insert into review_comments (submission_id, version_id, team_id, author_id, section_ref, body, created_at) values
    (sub, ver, T, L, '§2 가격 전략', '근거가 좋아요. 다만 2번 가설은 데이터가 더 필요해 보입니다.', now() - interval '3 days');
  insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at, parent_id)
    select sub, ver, T, m_kim, '다음 주 사용자 인터뷰로 보강하겠습니다.', now() - interval '3 days', id from review_comments where submission_id = sub limit 1;

  insert into submissions (team_id, author_id, item_id, title, status) values (T, m_choi, t5, '온보딩 개선안', 'in_review') returning id into sub;
  insert into submission_versions (submission_id, team_id, version, extracted_text, note, created_by) values
    (sub, T, 1, E'온보딩 개선안\n1. 현황: 신규 입사자 독립 수행까지 평균 3개월\n2. 개선: 버디 제도, 4주 과제 설계', '초안', m_choi),
    (sub, T, 2, E'온보딩 개선안\n1. 현황: 신규 입사자 독립 수행까지 평균 3개월 (최근 5명 기준)\n2. 개선: 버디 제도, 4주 과제 설계, 2주차 1on1\n3. 측정: 6주차 독립 수행률', '측정 지표 추가', m_choi);

  -- 지난 결과물 (승인 13건) + 판단 깊이 기록
  for i in 1..13 loop
    insert into submissions (team_id, author_id, title, created_at)
    values (T, (array[m_kim, m_park, m_choi, m_jung, m_kim, m_park, m_choi, m_kim, m_jung, m_park, m_choi, m_kim, m_lee])[i],
            (array['시장 조사 보고서','데이터 품질 진단','채용 브랜딩안','파트너 후보 리스트','경쟁사 동향','KPI 대시보드 설계','평가 제도 개선안','고객 세그먼트 정의','제휴 조건 비교','분석 자동화 계획','교육 체계안','가격 민감도 분석','영업 자료 개편'])[i],
            now() - (170 - i * 11) * interval '1 day')
    returning id into sub;
    insert into submission_versions (submission_id, team_id, version, extracted_text, created_by, created_at)
    values (sub, T, 1, '(데모 본문)', (select author_id from submissions where id = sub), now() - (170 - i * 11) * interval '1 day') returning id into ver;
    insert into review_comments (submission_id, version_id, team_id, author_id, body, created_at)
    values (sub, ver, T, L, '좋습니다. 이대로 진행하죠.', now() - (166 - i * 11) * interval '1 day');
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
    (T, L, m_kim, 'praise', '커뮤니케이션', '임원 보고에서 가격 전략 질문에 근거를 들어 침착하게 답변함', current_date - 6),
    (T, L, m_kim, 'praise', '문제 정의', '프리미엄 가정을 스스로 뒤집고 경쟁사 재분석을 제안함', current_date - 20),
    (T, L, m_kim, 'concern', '실행 관리', '마감 전 야근이 반복됨. 일정 분산 필요', current_date - 12),
    (T, L, m_kim, 'note', '데이터 분석', '시장 분석은 수치 나열에 그치는 경향', current_date - 60),
    (T, L, m_park, 'praise', '데이터 분석', '대시보드 지표 정의를 현업과 맞춰 정리함', current_date - 15),
    (T, L, m_park, 'praise', '협업', '다른 팀 요청을 우선순위 기준으로 조율', current_date - 40),
    (T, L, m_choi, 'praise', '문제 정의', '온보딩 문제를 독립 수행률로 정의', current_date - 25),
    (T, L, m_jung, 'note', '협업', '고객사 데이터 수급 지연을 혼자 해결하려 함', current_date - 9),
    (T, L, m_jung, 'praise', '커뮤니케이션', '파트너 미팅 정리가 명확함', current_date - 45),
    (T, L, m_lee, 'concern', null, '최근 회의에서 발언이 줄어듦', current_date - 10);

  -- 의사결정 (결과 기록 7건)
  insert into decisions (team_id, title, rationale, expected_outcome, outcome, outcome_rating, decided_by, decided_at) values
    (T, '가격 정책을 침투가로 확정', '경쟁사 재분석', '파일럿 전환율 20%', null, null, L, now() - interval '14 days'),
    (T, '인터뷰 대상 8명 → 12명 확대', '2번 가설 데이터 부족', '가설 검증 가능', null, null, L, now() - interval '1 day'),
    (T, '파일럿 고객 2곳 선정', '접근성', '6주 내 계약', '5주 만에 계약', 'hit', L, now() - interval '120 days'),
    (T, '분석 자동화 우선 착수', '반복 업무 30%', '주 6시간 절감', '주 5시간 절감', 'hit', L, now() - interval '100 days'),
    (T, '파트너 후보 5곳으로 압축', '조건 비교', '2곳 협상 진입', '1곳만 진입', 'partial', L, now() - interval '90 days'),
    (T, '버디 제도 시범 운영', '이탈 방지', '3개월 내 이탈 0', '이탈 0', 'hit', L, now() - interval '80 days'),
    (T, '영업 연계 주간 회의 신설', '정보 공유', '리드 전환 +10%', '변화 없음', 'miss', L, now() - interval '70 days'),
    (T, '레거시 리포트 일부 자동화', '시간 절감', '주 4시간 절감', '주 4시간 절감', 'hit', L, now() - interval '60 days'),
    (T, '교육 예산 상반기 집중', '신규 입사', '온보딩 만족도 4.0', '4.2', 'hit', L, now() - interval '50 days');
end $$;
