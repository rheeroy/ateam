-- =====================================================================
-- 데모 팀: 업무플랫폼 확장(팀 방향 · Sim.Box · 8주 흐름) 체험용 기록 — 36_workspace_plus 다음 (06_demo_accounts 끝에 포함)
--   · 팀장 결과물 의견 4건 추가 → '팀장님이 일하는 방식'이 2번 이상 나온 기준으로 잡히게
--   · 팀 방향 미리 정리 (허용 목록 방식과 같은 모양: 팀 목표 제목 + 기준 문장) → 데모에서 기다리지 않게
--   · Sim.Box: 최다은 계정에 예시 대화 1개 · 팀 경향 집계용 분류(팀원 5명 · 분류마다 3명 이상)
-- 지금 있는 데모에 이 부분만 Run 해도 됩니다 (이미 넣었으면 건너뜀 · 다시 Run 해도 안전)
-- =====================================================================
do $$
declare
  r record; v_choi uuid; v_users uuid[]; s record; n int; v_quarter jsonb; v_ways jsonb;
  -- 팀장 의견: (기준, 의견) — 서로 다른 결과물에 하나씩
  fb text[][] := array[
    ['conclusion_first', '내용은 충실한데 결론이 3페이지에 있어서 찾느라 시간이 걸렸어요. 첫 문단에 결론부터 써 주세요.'],
    ['number_source',    '전환율 수치가 언제 기준인지 빠져 있어요. 출처랑 기준일을 같이 적어 주세요.'],
    ['evidence',         '방향은 동의해요. 다만 왜 이 채널인지 근거 데이터를 한 장 붙여 주면 위에 올리기 쉬워요.'],
    ['align_peers',      '이건 영업팀 일정이랑 겹칠 수 있어요. 올리기 전에 영업팀과 먼저 맞춰 주세요.']
  ];
begin
  if to_regclass('public.simbox_messages') is null then raise notice '36_workspace_plus 를 먼저 Run 하세요'; return; end if;
  for r in select t.id team_id, t.name, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo loop
    -- 이미 넣었으면 건너뜀 (표시: 추가한 첫 의견)
    if exists (select 1 from review_comments where team_id = r.team_id and author_id = r.leader_id and body = fb[1][2]) then continue; end if;

    -- 1) 팀장 의견 4건 — 팀원이 올린 결과물 중 팀장 의견이 아직 없는 것부터
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
      values (s.id, s.ver, r.team_id, r.leader_id, fb[n][2], now() - make_interval(days => 6 + n * 9));
    end loop;

    -- 2) 팀 방향 (팀 목표 제목 그대로 + 미리 쓴 기준 문장)
    select coalesce(jsonb_agg(jsonb_build_object('text', g.title, 'why', coalesce(g.sub, ''), 'source', '팀 목표',
             'date', to_char(g.updated_at, 'YYYY-MM-DD'), 'repeat', 1, 'new', false) order by g.pr), '[]'::jsonb)
      into v_quarter
      from (select w.title, w.updated_at, coalesce(w.priority, 9) pr,
                   (select string_agg(m.title || coalesce(' ' || to_char(m.num_target, 'FM999,999,999') || coalesce(m.unit, ''), ''), ' · ')
                      from (select * from work_items k where k.parent_id = w.id and k.role = 'metric' order by k.sort limit 3) m) sub
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
        jsonb_build_object('key', 'ways', 'title', '팀장님이 일하는 방식', 'sub', '결과물 의견 · 요청에서 2번 이상 나온 기준', 'items', v_ways))))
    on conflict (team_id) do update set status = 'ready', updated_at = now(), content = excluded.content;  -- 예전 방식으로 만든 것이 있으면 바꾼다

    -- 3) Sim.Box 예시 대화 (최다은 · 본인만 보임)
    select tm.user_id into v_choi from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '최다은' limit 1;
    if v_choi is not null then
      insert into simbox_messages (team_id, user_id, role, body, attachment, meta, created_at) values
      (r.team_id, v_choi, 'user', '11월 콘텐츠 캘린더 초안이에요. 팀장님께 올리기 전에 한번 봐 주세요.',
       jsonb_build_object('name', '11월_콘텐츠캘린더_v2.xlsx', 'kind', 'text',
         'digest', '11월 콘텐츠 12편 일정. 런칭 주간(3주차)에 6편 집중. 편당 담당 · 채널 · 목표 지표(저장 · 공유) 표기. 디자인팀 슬롯 표시 없음. 지난달 성과 비교 없음.'),
       null, now() - interval '2 days 3 hours'),
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
           'good', jsonb_build_array(
             jsonb_build_object('t', '편마다 담당 · 채널이 분명함', 'd', '바로 실행할 수 있는 수준')))),
       now() - interval '2 days 3 hours' + interval '20 seconds');
      insert into simbox_usage (team_id, user_id, created_at) values (r.team_id, v_choi, now() - interval '2 days 3 hours');
    end if;

    -- 4) 팀 경향 집계용 분류 (이름 · 내용 없이 분류만) — 팀원 5명, 분류마다 3명 이상
    select array_agg(user_id order by joined_at) into v_users
      from (select tm.user_id, tm.joined_at from team_members tm where tm.team_id = r.team_id and tm.role = 'member' and tm.status = 'active' order by tm.joined_at limit 5) x;
    if coalesce(array_length(v_users, 1), 0) >= 5 then
      insert into simbox_tags (team_id, user_id, category, created_at)
      select r.team_id, v_users[u], c.cat, now() - make_interval(days => (u * 3 + c.k * 2) % 27 + 1)
        from (values ('evidence', 1, 5), ('structure', 2, 4), ('stakeholder', 3, 3), ('priority', 4, 3), ('reporting', 5, 3)) c(cat, k, users)
        cross join generate_series(1, 5) u
       where u <= c.users;
      insert into simbox_tags (team_id, user_id, category, created_at)
      select r.team_id, v_users[u], 'evidence', now() - make_interval(days => u + 10) from generate_series(1, 3) u;
    end if;
  end loop;
end $$;
