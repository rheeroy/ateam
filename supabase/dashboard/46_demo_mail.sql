-- ATEAM 데모 링크 메일 (demo-mail 함수가 발송 시각 · 횟수를 남긴다) — 45_invite_mail 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 데모 링크 메일 (demo-mail 함수 · Resend) — 승인하면 자동 발송, 언제 · 몇 번 보냈는지 남긴다
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter table public.demo_requests add column if not exists mailed_at  timestamptz;
alter table public.demo_requests add column if not exists mail_count int not null default 0;
