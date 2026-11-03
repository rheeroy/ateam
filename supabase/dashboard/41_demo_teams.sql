-- ATEAM 데모 팀 여러 개 (신청서 '팀 직무' · 데모 띠 팀 고르기) — 38 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 데모 팀 여러 개 — 신청서의 '팀 직무'로 그 팀 데모가 열린다 (데모 띠에서 다른 팀으로 바꿔 볼 수도 있음)
--   팀 데모 SQL: 06_demo_accounts.sql(마케팅기획팀) + 06_demo_team_<팀>.sql (팀마다 하나)
-- 37_demo_access 다음에 Run. 다시 Run 해도 안전합니다.
-- =====================================================================
alter table public.demo_requests add column if not exists dept text not null default '';
-- 마케팅기획팀 데모 표시 (다른 팀은 06_demo_team_<팀>.sql 끝에서 넣는다)
update public.teams set settings = coalesce(settings, '{}'::jsonb)
  || '{"demo_key": "marketing", "demo_label": "마케팅", "demo_default_member": "정우성", "demo_ranks": {"김현정": "차장", "박서연": "과장", "정우성": "과장", "최다은": "대리", "이동욱": "대리", "한수진": "사원"}}'::jsonb
 where is_demo and name = '마케팅기획팀 (데모)';
