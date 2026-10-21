-- ATEAM 이름 바꾸기: 성과 체크인 → 성과입력 (이미 올라간 카드·알림의 제목 머리말) — 25_oo_entries 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 이름 바꾸기: 성과 체크인 → 성과입력 (화면 이름만 — 코드·DB 이름 checkin 은 그대로)
--   · 이미 올라간 성과입력 카드의 제목 머리말 '체크인 · ' → '성과입력 · '
--   · 알림에 남은 같은 머리말도 함께
-- 다시 Run 해도 안전합니다.
-- =====================================================================
update public.submissions set title = regexp_replace(title, '^체크인 · ', '성과입력 · ')
 where kind = 'checkin' and title like '체크인 · %';
update public.notifications set title = replace(title, '체크인 · ', '성과입력 · '), body = replace(body, '체크인 · ', '성과입력 · ')
 where title like '%체크인 · %' or body like '%체크인 · %';
