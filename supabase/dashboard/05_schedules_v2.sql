-- ATEAM v2 — AI 인사이트 예약 (02_schedules.sql 을 이미 실행한 프로젝트에서 한 번 Run)

-- =====================================================================
-- ATEAM · 0009 AI 인사이트 예약 (0006 이후에 실행)
--   평일 06:40 KST  일간 인사이트
--   월요일 07:00 KST 주간 인사이트 (기존 '월요일 브리핑'을 대신함)
--   매월 1일 09:30 KST 월간 인사이트
--   대상: AI가 켜져 있고 최근 14일 안에 활동이 있는 팀 (ai-insights 함수가 고른다)
-- =====================================================================
do $$ begin perform cron.unschedule('weekly-briefing'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('insight-daily'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('insight-weekly'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('insight-monthly'); exception when others then null; end $$;

select cron.schedule('insight-daily',   '40 21 * * 0-4', $$ select public._invoke_function('ai-insights', '{"all": true, "period": "daily"}') $$);
select cron.schedule('insight-weekly',  '0 22 * * 0',    $$ select public._invoke_function('ai-insights', '{"all": true, "period": "weekly"}') $$);
select cron.schedule('insight-monthly', '30 0 1 * *',    $$ select public._invoke_function('ai-insights', '{"all": true, "period": "monthly"}') $$);
