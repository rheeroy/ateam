-- =====================================================================
-- 데모 링크 메일 (demo-mail 함수 · Resend) — 승인하면 자동 발송, 언제 · 몇 번 보냈는지 남긴다
-- 다시 Run 해도 안전합니다.
-- =====================================================================
alter table public.demo_requests add column if not exists mailed_at  timestamptz;
alter table public.demo_requests add column if not exists mail_count int not null default 0;
