-- =====================================================================
-- 데모 팀: 업무플랫폼 확장(팀 방향 · Sim.Box · 파일 실적 · 8주 흐름) 체험용 기록 — 36_workspace_plus 다음 (06_demo_accounts 끝에 포함)
--   팀장 화면: 8주 흐름 옆 'Sim.Box 팀 경향'(분류 집계) · 팀목표 '파일로 실적 채우기'(샘플 파일은 앱 public/demo)
--   팀원 화면:
--     · 매니징 보드 '팀장님 주요 지침' · 업무플랫폼 [팀 방향] — 미리 정리 (NEW 1건 → 탭 배지)
--     · Sim.Box 예시 대화 — 최다은(결과물 검토) · 김현정(보고 방법) · 한수진(신규 · 팀장님 관심사)
--       나머지(박서연 · 정우성 · 이동욱)는 빈 화면에서 시작해 직접 써 보게
--     · 성과입력 '파일로 입력' — 김현정 · 최다은 · 이동욱은 체험용 샘플 파일 버튼이 보인다 (앱 쪽)
--   다시 Run 하면 이 블록이 넣은 것만 지우고 새로 넣는다 (지금 있는 데모에 이 부분만 Run 해도 됨)
-- =====================================================================
do $$
declare
  r record; v_users uuid[]; s record; n int; v_quarter jsonb; v_ways jsonb; v_kh text := '보고서 한 장 요약 양식';
  v_kim uuid; v_choi uuid; v_han uuid; t0 timestamptz;
  fb text[] := array[
    '내용은 충실한데 결론이 3페이지에 있어서 찾느라 시간이 걸렸어요. 첫 문단에 결론부터 써 주세요.',
    '전환율 수치가 언제 기준인지 빠져 있어요. 출처랑 기준일을 같이 적어 주세요.',
    '방향은 동의해요. 다만 왜 이 채널인지 근거 데이터를 한 장 붙여 주면 위에 올리기 쉬워요.',
    '이건 영업팀 일정이랑 겹칠 수 있어요. 올리기 전에 영업팀과 먼저 맞춰 주세요.'];
begin
  if to_regclass('public.simbox_messages') is null then raise notice '36_workspace_plus 를 먼저 Run 하세요 — 데모 확장 기록은 건너뜁니다'; return; end if;
  for r in select t.id team_id, t.name, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo loop
    select tm.user_id into v_kim  from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '김현정' limit 1;
    select tm.user_id into v_choi from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '최다은' limit 1;
    select tm.user_id into v_han  from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '한수진' limit 1;

    -- 0) 이 블록이 전에 넣은 것 지우기
    delete from review_comments where team_id = r.team_id and author_id = r.leader_id and body = any(fb);
    delete from knowhow_cards where team_id = r.team_id and title = v_kh;
    delete from team_directions where team_id = r.team_id;
    delete from simbox_messages where team_id = r.team_id;
    delete from simbox_usage where team_id = r.team_id;
    delete from simbox_tags where team_id = r.team_id;

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
    if v_choi is not null then   -- 결과물 검토 (파일 + 오른쪽 짚어 볼 포인트)
      t0 := now() - interval '2 days 3 hours';
      insert into simbox_messages (team_id, user_id, role, body, attachment, meta, created_at) values
      (r.team_id, v_choi, 'user', '11월 콘텐츠 캘린더 초안이에요. 팀장님께 올리기 전에 한번 봐 주세요.',
       jsonb_build_object('name', '11월_콘텐츠캘린더_v2.xlsx', 'kind', 'text',
         'digest', '11월 콘텐츠 12편 일정. 런칭 주간(3주차)에 6편 집중. 편당 담당 · 채널 · 목표 지표(저장 · 공유) 표기. 디자인팀 슬롯 표시 없음. 지난달 성과 비교 없음.'),
       null, t0),
      (r.team_id, v_choi, 'assistant',
       '전체 구성은 탄탄해요. 다만 런칭 주간에 6편이 몰려 있는데 디자인 작업이 가능한지 표시가 없어서, 일정 질문이 먼저 나올 가능성이 높아요. 팀 방향의 일하는 방식에 유관부서와 미리 맞추라는 기준이 있으니 디자인팀 확인 여부를 한 줄 넣어 두면 좋겠어요. 목표 지표를 왜 저장 · 공유로 잡았는지도 지난달 숫자와 함께 짧게 붙이면 판단이 쉬워져요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('일정 분산안 같이 짜 줘', '지표 근거 한 줄로 써 줘'),
         'panel', jsonb_build_object('title', '11월 콘텐츠 캘린더 v2',
           'questions', jsonb_build_array(
             jsonb_build_object('q', '런칭 주간 6편, 디자인 작업 가능한가요?', 'tip', '디자인팀 슬롯 확인 결과나 앞 주로 당길 편 표시'),
             jsonb_build_object('q', '저장 · 공유를 목표 지표로 잡은 이유는요?', 'tip', '지난달 편당 저장 · 공유 수와 비교')),
           'fixes', jsonb_build_array(
             jsonb_build_object('t', '맨 위에 한 줄 요약', 'd', '몇 편 · 언제 집중 · 기대 효과를 첫 줄에'),
             jsonb_build_object('t', '지난달 성과 열 추가', 'd', '같은 채널 지난달 숫자와 기준일')),
           'good', jsonb_build_array(jsonb_build_object('t', '편마다 담당 · 채널이 분명함', 'd', '바로 실행할 수 있는 수준')))),
       t0 + interval '20 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_choi, t0);
    end if;

    if v_kim is not null then    -- 보고 방법 · 타이밍
      t0 := now() - interval '1 day 5 hours';
      insert into simbox_messages (team_id, user_id, role, body, attachment, meta, created_at) values
      (r.team_id, v_kim, 'user', '사전 예약이 목표 대비 많이 밀려 있어요. 이번 주 주간 보고에서 어떻게 꺼내면 좋을까요?', null, null, t0),
      (r.team_id, v_kim, 'assistant',
       '밀린 상황은 숨기기보다 먼저 꺼내는 게 좋아요. 팀 방향의 일하는 방식에 막히면 일찍 공유하고, 숫자에는 기준일을 붙이라는 기준이 있어서 그 순서로 짜 보면 자연스러워요. 첫 줄에 현재 누적과 목표 대비 비율, 다음 줄에 밀린 이유 한두 가지, 마지막에 만회 방안과 팀장님이 정해 주셨으면 하는 것을 두세요. 만회 방안은 하나보다 두 가지를 놓고 고르게 하면 대화가 빨라져요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('보고 첫 문단 같이 써 줘', '만회 방안 두 가지 정리해 줘'),
         'panel', jsonb_build_object('title', '주간 보고 — 사전 예약 현황',
           'questions', jsonb_build_array(
             jsonb_build_object('q', '언제까지 얼마나 따라잡을 수 있나요?', 'tip', '주차별 만회 계획 숫자'),
             jsonb_build_object('q', '채널별로 어디가 제일 약한가요?', 'tip', '자사몰 · 제휴 비중과 지난주 대비')),
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
       '팀 방향과 팀 목표로 보면 지금은 신제품 런칭이 가장 앞에 있고, 제휴 채널 신규 고객 확대와 운영 효율화가 뒤를 잇고 있어요. 일하는 방식에서는 근거 자료를 붙이는 것과 결론을 먼저 쓰는 것이 여러 번 강조됐어요. 다만 팀장님 개인의 생각까지는 자료로 알 수 없어서, 확실하지 않은 부분은 1on1에서 직접 여쭤보는 걸 권해요. 최근에 공유된 보고서 한 장 요약 양식을 먼저 익혀 두면 첫 보고가 한결 수월할 거예요.',
       null,
       jsonb_build_object('chips', jsonb_build_array('1on1에서 물어볼 질문 추려 줘', '한 장 요약 양식으로 연습해 볼래'), 'panel', null),
       t0 + interval '12 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_han, t0);
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
end $$;
