-- ATEAM AI 분석 완료 실시간 반영 — 27_realtime 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- 28_realtime_ai.sql — AI 1차 분석 완료를 팀장 화면에 바로 반영
--   업무 카드 위 'AI 분석 ●' 표시와 오른쪽 AI 분석 패널이 분석이 끝나는 순간 바뀐다.
--   (supabase_realtime 발행 목록에 ai_outputs 추가. 읽기 권한은 기존 RLS 그대로 — 검토 결과는 팀장만 받음)
--   여러 번 실행해도 안전합니다.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if to_regclass('public.ai_outputs') is not null and not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_outputs'
  ) then
    alter publication supabase_realtime add table public.ai_outputs;
  end if;
end $$;
