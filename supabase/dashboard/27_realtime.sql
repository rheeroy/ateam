-- ATEAM 업무 스페이스 실시간 반영 — 26_perf_input_name 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- 27_realtime.sql — 업무 스페이스 실시간 반영
--   상대가 쓴 대화 · 요청 상태 변화 · 업무 카드 변화를 화면에 바로 띄운다.
--   (Supabase Realtime 'supabase_realtime' 발행 목록에 테이블을 추가. 읽기 권한은 기존 RLS 그대로 적용됨)
--   여러 번 실행해도 안전합니다.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['space_messages', 'team_requests', 'submissions'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
