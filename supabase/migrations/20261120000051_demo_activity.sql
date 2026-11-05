-- =====================================================================
-- 데모 팀: 팀원 활동 지수가 보이도록 지난 7주의 업무 기록(진척 기록)을 채운다
--   팀원 순서(_p1 ~ _p6): 1 꾸준히 많음 · 2 일이 적음(업무 여유) · 3 점점 늘어남 · 4 최근 급감(의욕 저하 신호) · 5 많고 밤·주말 비중 큼(과부하) · 6 합류 초기(적음)
--   이번 주(진행 중)는 건드리지 않는다 · 06(팀 데모 초기화) 끝에서 한 번 돈다
-- =====================================================================
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
  for r in select t.id team_id from teams t where t.is_demo and t.name = '마케팅기획팀 (데모)' loop
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
