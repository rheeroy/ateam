-- =====================================================================
-- ATEAM · 예약 작업 (월요일 07:00 팀 브리핑, 매일 03:00 구독 갱신 결제)
-- 실행 전: Database > Extensions 에서 pg_cron, pg_net 을 켜 둡니다.
-- 아래 두 줄의 <...> 를 내 프로젝트 값으로 바꾼 뒤, 파일 전체를 SQL Editor 에서 Run.
--   · Project URL      : Project Settings > API (또는 Data API) 의 URL
--   · service_role key : Project Settings > API Keys 의 service_role (secret) 키
-- =====================================================================
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service_role key>', 'service_role_key');
