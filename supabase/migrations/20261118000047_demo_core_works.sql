-- =====================================================================
-- 데모 팀: 핵심 업무 — 몇 년 쓰면 AI가 이렇게 묶고 정리해 둔다는 모습 (46_core_works 다음 · 06_demo_accounts 끝에 포함)
--   · 제휴사 파트너십 운영 (2019~ · 담당 5번 교체 · 장 7개 + 올해 과제 2개) — 정우성에게 전달된 상태
--   · 신제품 런칭 운영 (2023~ · 장 3개 + 올해 과제 2개)
--   · 콘텐츠 제작 프로세스 개선은 단독 과제로 남겨 둔다
--   다시 Run 하면 데모 팀의 핵심 업무만 지우고 새로 넣는다
-- =====================================================================
do $$
declare
  r record; c1 uuid; c2 uuid; v_jung uuid; v_item uuid; t text;
  ch jsonb;
begin
  if to_regclass('public.core_works') is null then raise notice '46_core_works 를 먼저 Run 하세요 — 데모 핵심 업무는 건너뜁니다'; return; end if;
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader' where t.is_demo loop
    delete from history_shares where team_id = r.team_id and core_work_id is not null;
    delete from core_work_chapters where team_id = r.team_id;
    delete from core_works where team_id = r.team_id;   -- core_work_items 는 함께 지워진다
    delete from core_work_state where team_id = r.team_id;
    select tm.user_id into v_jung from team_members tm join profiles p on p.id = tm.user_id where tm.team_id = r.team_id and p.full_name = '정우성' limit 1;

    -- ---------- 1) 제휴사 파트너십 운영 ----------
    insert into core_works (team_id, title, summary, since_year, dirty, synced_at, updated_at, content) values (r.team_id, '제휴사 파트너십 운영',
      '7년째 A · C사 중심으로 운영 중인 제휴 채널. 2021년 B사 정산 분쟁 이후 계약서 기준이 정해졌고, 지금은 B사 데이터 지연으로 2026 제안서가 막혀 있음.',
      2019, false, now(), now(), $j${
        "eras": [{"name": "윤지호", "from": "2019-01", "to": "2020-12"}, {"name": "서민재", "from": "2021-01", "to": "2022-05"}, {"name": "박서연", "from": "2022-06", "to": "2024-07"},
                 {"name": "김현정", "from": "2024-08", "to": "2025-03"}, {"name": "정우성", "from": "2025-04", "to": null}],
        "principles": [{"text": "정산은 월 1회 · 익월 10일", "year": 2020}, {"text": "계약서에 정산 지연 이자 조항 (B사 분쟁 이후)", "year": 2021},
                       {"text": "제휴사에 분기마다 성과 리포트 공유", "year": 2022}, {"text": "고객 데이터는 비식별 집계만 공유", "year": 2024}],
        "recurring": [{"text": "A · C사 재계약 협의 — 2월 말까지 성과 리포트 준비", "when": "매년 3월"}, {"text": "제휴사 성과 리포트 발송", "when": "매 분기"},
                      {"text": "다음 해 공동 프로모션 일정 확정", "when": "매년 11월"}],
        "tried": [{"text": "소규모 제휴사 10곳 동시 계약 → 관리 부담으로 8곳 종료", "year": 2023}, {"text": "B사 단가 인상 협상 → 데이터 공유 조항과 맞바꿔 동결", "year": 2024}],
        "people": [{"text": "A사 제휴팀 — 실무 창구 3번 바뀜", "since": 2019}, {"text": "C사 마케팅본부 — 공동 프로모션 파트너", "since": 2020},
                   {"text": "B사 — 정산 분쟁 이력 · 데이터 회신 느림", "since": 2021}, {"text": "재무팀 — 정산 · 계약 검토", "since": 2021}],
        "open": [{"text": "B사 데이터 공유 주기 — 계약엔 있지만 지켜진 적 드묾", "since": 2024}, {"text": "2개사 축소안으로 제안서 먼저 낼지", "since": 2026}],
        "cautions": [{"text": "B사와 정산 이야기는 메일로만 — 2021년 구두 합의가 분쟁 원인"}, {"text": "3월 재계약 전에 담당이 바뀌면 리포트 준비가 밀림"}],
        "gaps": [{"text": "2019 시범 종료 이유 — 기록 없음 → 윤지호 님(전 담당)에게 확인"}]
      }$j$::jsonb) returning id into c1;

    for ch in select * from jsonb_array_elements($j$[
      {"y": 2019, "t": "제휴 채널 첫 시범", "o": "윤지호", "p": "2019-03 ~ 2019-08", "c": {"summary": "제휴 채널 가능성을 보려 3개월 시범", "key": "시범 3개월 · 전환율 2.1%", "decisions": ["A사 1곳으로 시범 시작 — 리스크를 줄이려고"], "results": "전환율 2.1%, 정식 계약 검토로 넘어감", "lessons": ["정산 기준 없이 시작해 월말 정산이 매번 늦어짐"], "carried": ["정산 기준 정하기"], "people": ["A사 제휴팀 — 첫 파트너"]}},
      {"y": 2020, "t": "A사 · C사 정식 계약", "o": "윤지호", "p": "2020-01 ~ 2020-06", "c": {"summary": "A · C사와 1년 단위 정식 계약", "key": "정산 월 1회로 확정", "decisions": ["정산 월 1회 · 익월 10일로 확정 — 재무팀 요청"], "results": "2개사 계약, 제휴 유입 월 3천 명", "lessons": [], "carried": ["B사 추가 검토"], "people": ["C사 마케팅본부 — 공동 프로모션", "재무팀 — 정산 기준"]}},
      {"y": 2021, "t": "B사 정산 분쟁 대응", "o": "서민재", "p": "2021-02 ~ 2021-07", "c": {"summary": "B사 정산 지연 3개월 · 구두 합의 해석 차이로 분쟁", "key": "B사 정산 지연 → 지연 이자 조항", "decisions": ["계약서에 정산 지연 이자 조항 추가", "정산 관련 합의는 메일로만"], "results": "미정산금 회수, 계약 유지", "lessons": ["구두 합의가 분쟁 원인"], "carried": ["계약서 표준화"], "people": ["B사 — 정산 담당 교체 잦음", "재무팀 · 법무팀 — 계약 검토"]}},
      {"y": 2021, "t": "제휴 계약서 표준화", "o": "서민재", "p": "2021-08 ~ 2021-12", "c": {"summary": "제휴사 공통 계약서 양식 정리", "decisions": ["공통 양식 + 제휴사별 부속서"], "results": "신규 계약 검토 기간 3주 → 1주", "lessons": [], "carried": [], "people": ["법무팀"]}},
      {"y": 2022, "t": "제휴사 성과 리포트 도입", "o": "박서연", "p": "2022-06 ~ 2022-12", "c": {"summary": "제휴사에 분기 성과 리포트를 보내기 시작", "key": "분기 리포트로 관계 안정", "decisions": ["분기마다 리포트 공유"], "results": "재계약 협의가 숫자 중심으로 바뀜", "lessons": [], "carried": ["리포트 준비를 재계약 일정에 맞추기"], "people": ["A사 제휴팀 — 창구 교체"]}},
      {"y": 2023, "t": "신규 제휴사 발굴", "o": "박서연", "p": "2023-02 ~ 2023-11", "c": {"summary": "제휴사를 늘리려 12곳 접촉", "key": "후보 12곳 중 2곳만 계약", "decisions": ["소규모 10곳 동시 계약 시도"], "results": "관리 부담으로 8곳 종료, 2곳만 유지", "lessons": ["소규모 다수 계약은 관리 비용이 큼"], "carried": [], "people": []}},
      {"y": 2024, "t": "B사 재계약", "o": "박서연", "p": "2024-01 ~ 2024-04", "c": {"summary": "B사 단가 인상 요구 속 재계약", "key": "단가 동결 · 데이터 공유 조항", "decisions": ["단가 동결 대신 데이터 공유 조항 추가", "고객 데이터는 비식별 집계만"], "results": "재계약, 데이터 공유 주기는 계약상 월 1회", "lessons": ["단가 협상은 데이터 조항과 맞바꾸는 쪽이 통함"], "carried": ["B사 데이터 공유 주기 지키기"], "people": ["B사 — 협상 창구 바뀜"]}},
      {"y": 2024, "t": "제휴 CRM 연계 1차", "o": "김현정", "p": "2024-08 ~ 2024-12", "c": {"summary": "제휴 유입 고객을 CRM에 처음 연결", "decisions": ["A · C사부터 연계"], "results": "제휴 고객 재방문율 측정 시작", "lessons": [], "carried": ["B사 연계는 데이터 문제로 보류"], "people": ["CRM 담당 — 이동욱"]}},
      {"y": 2025, "t": "제휴 단독 혜택 운영", "o": "정우성", "p": "2025-04 ~ 2025-12", "c": {"summary": "제휴 채널 전용 추가 할인 운영", "key": "단독 혜택 5% · 유입 1.8배", "decisions": ["제휴 단독 혜택 5%"], "results": "제휴 유입 1.8배, 신규 4만 명 달성", "lessons": [], "carried": ["2026 공동 프로모션 제안"], "people": ["C사 — 공동 프로모션 확대 의향"]}}
    ]$j$::jsonb) loop
      insert into core_work_chapters (team_id, core_work_id, year, title, owner_name, period, content)
      values (r.team_id, c1, (ch->>'y')::int, ch->>'t', ch->>'o', ch->>'p', ch->'c');
    end loop;
    foreach t in array array['제휴 프로모션 제안서', '제휴 유입 고객 CRM 연계'] loop
      select id into v_item from work_items where team_id = r.team_id and title = t and status <> 'dropped' order by created_at desc limit 1;
      if v_item is not null then
        insert into core_work_items (item_id, core_work_id, team_id, reason)
        values (v_item, c1, r.team_id, case when t = '제휴 프로모션 제안서' then '관계자 B사 · A사, 지표 ''제휴 신규 고객''이 같음' else '관계자 B사 · CRM 연계가 2024년 장에서 이어짐' end)
        on conflict (item_id) do update set core_work_id = excluded.core_work_id, reason = excluded.reason;
      end if;
    end loop;

    -- ---------- 2) 신제품 런칭 운영 ----------
    insert into core_works (team_id, title, summary, since_year, dirty, synced_at, updated_at, content) values (r.team_id, '신제품 런칭 운영',
      '해마다 한두 번 신제품 런칭 캠페인을 운영. 2024년부터 사전 예약을 먼저 열고 반응을 본 뒤 광고를 늘리는 순서가 굳어짐.',
      2023, false, now(), now(), $j${
        "eras": [{"name": "박서연", "from": "2023-03", "to": "2024-06"}, {"name": "김현정", "from": "2024-07", "to": null}],
        "principles": [{"text": "사전 예약을 먼저 열고 반응을 본 뒤 광고 증액", "year": 2024}, {"text": "런칭 할인은 15%를 넘지 않음", "year": 2025}],
        "recurring": [{"text": "런칭 6주 전 고객 FGI", "when": "런칭마다"}, {"text": "영업팀 단가표 반영 확인", "when": "런칭 2주 전"}],
        "tried": [{"text": "런칭 첫 주 광고 집중 → 초반 예약만 몰리고 이후 급감", "year": 2023}],
        "people": [{"text": "디자인팀 — 키비주얼 · 주간 고정 슬롯", "since": 2023}, {"text": "영업팀 — 단가표 · 일정 충돌 잦음", "since": 2024}],
        "open": [{"text": "사전 예약 목표 대비 37% — 만회 방안", "since": 2026}],
        "cautions": [{"text": "영업팀 단가표가 늦게 나오면 프로모션 정책을 확정할 수 없음"}],
        "gaps": []
      }$j$::jsonb) returning id into c2;
    for ch in select * from jsonb_array_elements($j$[
      {"y": 2023, "t": "봄 시즌 신제품 런칭", "o": "박서연", "p": "2023-03 ~ 2023-05", "c": {"summary": "봄 시즌 신제품 런칭", "key": "첫 주 광고 집중 → 이후 급감", "decisions": ["런칭 첫 주에 광고 예산 60%"], "results": "목표 대비 82%", "lessons": ["초반 집중보다 사전 예약으로 수요를 먼저 보는 게 나음"], "carried": ["사전 예약 도입"], "people": ["디자인팀"]}},
      {"y": 2024, "t": "하반기 리브랜딩 런칭", "o": "김현정", "p": "2024-08 ~ 2024-11", "c": {"summary": "사전 예약을 먼저 연 첫 런칭", "key": "사전 예약 먼저 · 목표 108%", "decisions": ["사전 예약 4주 → 반응 보고 광고 증액"], "results": "목표 대비 108%", "lessons": [], "carried": [], "people": ["영업팀 — 단가표 지연"]}},
      {"y": 2025, "t": "브랜드 리뉴얼 캠페인 런칭", "o": "김현정", "p": "2025-03 ~ 2025-07", "c": {"summary": "브랜드 리뉴얼과 함께한 런칭", "key": "할인 15% 상한 정함", "decisions": ["런칭 할인은 15%를 넘지 않음 — 마진 기준"], "results": "목표 달성", "lessons": [], "carried": [], "people": []}}
    ]$j$::jsonb) loop
      insert into core_work_chapters (team_id, core_work_id, year, title, owner_name, period, content)
      values (r.team_id, c2, (ch->>'y')::int, ch->>'t', ch->>'o', ch->>'p', ch->'c');
    end loop;
    foreach t in array array['런칭 캠페인 기획', '런칭 프로모션 정책 확정'] loop
      select id into v_item from work_items where team_id = r.team_id and title = t and status <> 'dropped' order by created_at desc limit 1;
      if v_item is not null then
        insert into core_work_items (item_id, core_work_id, team_id, reason) values (v_item, c2, r.team_id, '런칭마다 반복되는 사전 예약 · FGI · 영업팀 단가표가 같음')
        on conflict (item_id) do update set core_work_id = excluded.core_work_id, reason = excluded.reason;
      end if;
    end loop;

    -- ---------- AI가 한 일 · 전달 ----------
    insert into core_work_state (team_id, status, finished_at, actions) values (r.team_id, 'ready', now(), jsonb_build_array(
      jsonb_build_object('at', now(), 'core_work_id', c1, 'text', '2026 ''제휴 프로모션 제안서''를 ''제휴사 파트너십 운영''에 묶음 (관계자 B사 · A사, 지표 ''제휴 신규 고객''이 같음)'),
      jsonb_build_object('at', now(), 'core_work_id', c1, 'text', '2025 ''제휴 단독 혜택 운영''을 장으로 접어 고정'),
      jsonb_build_object('at', now(), 'core_work_id', c1, 'text', '''제휴사 파트너십 운영'' 흐름을 다시 정리 (장 9개 · 진행 중 과제 2개)'),
      jsonb_build_object('at', now(), 'core_work_id', c2, 'text', '2026 ''런칭 캠페인 기획''을 ''신제품 런칭 운영''에 묶음 (사전 예약 · FGI · 영업팀 단가표가 같음)')));

    if v_jung is not null then
      insert into history_shares (team_id, core_work_id, from_id, to_id, note, status, sent_at, created_at, snapshot)
      select r.team_id, c1, r.leader_id, v_jung, '제휴 쪽은 2021년 B사 건만 알면 반은 이해한 거예요. 3월 재계약 전에 같이 한 번 봐요.', 'sent', now() - interval '1 day', now() - interval '1 day',
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
