-- =====================================================================
-- 데모 팀: 팀원 매니징 보드 보강 — 팀원마다 Feedback(칭찬 · 육성 · 업무 독려 · 지원·격려 · ATEAM 업무 피드백) ·
--   다음 1on1과 미리 꺼낼 이야기 · 정한 할 일 · 지난 1on1 기록이 비어 보이지 않게
--   부서와 상관없는 말로 쓰고, 이름 · 과제 제목은 그 팀 데이터에서 가져온다 (팀 데모 10개에 똑같이 들어감)
--   팀원 순서는 계정 주소 끝 번호(_p1 ~ _p6) — 1 에이스 · 2 정기 업무 · 3 개선 과제 · 4 막힌 과제 · 5 컨디션 하락 · 6 신규
--   06(팀 데모 초기화) 끝에서 한 번 돈다
-- =====================================================================
do $$
declare
  r record; m record; L uuid; task text; oo uuid; last_oo uuid; d int;
begin
  if to_regclass('public.one_on_one_entries') is null then return; end if;
  for r in select t.id team_id, tm.user_id leader_id from teams t join team_members tm on tm.team_id = t.id and tm.role = 'leader'
            where t.is_demo and t.name = '마케팅기획팀 (데모)' loop
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
