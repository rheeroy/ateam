-- ATEAM 가이드북 신청 (랜딩 /guidebook 폼 → guide-request 함수) — 43_credit_no_carryover 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 가이드북 신청 — 랜딩 /guidebook 폼 → guide-request 함수가 저장하고 가이드북 링크를 메일로 보낸다
--   정책 없음(RLS on) = 함수(service role)로만 쓰고, 대시보드 Table Editor에서 본다
-- 다시 Run 해도 안전합니다.
-- =====================================================================
create table if not exists public.guide_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  email       text not null,
  company     text not null,
  job_title   text not null default '',
  team_size   text not null default '',
  phone       text not null default '',
  consent     boolean not null default false,       -- 개인정보 수집 · 이용 (필수)
  marketing   boolean not null default false,       -- 마케팅 정보 수신 (선택)
  source      text not null default '',             -- utm_source 등 유입 경로
  emailed_at  timestamptz,                          -- 가이드북 메일을 보낸 시각 (RESEND_API_KEY 가 없으면 비어 있다)
  email_error text not null default ''
);
create index if not exists guide_requests_created_idx on public.guide_requests (created_at desc);
create index if not exists guide_requests_email_idx on public.guide_requests (lower(email));
alter table public.guide_requests enable row level security;
