-- =====================================================================
-- 요금제 가격 조정 — Starter ₩29,000 · Pro ₩49,000 · Pro+ ₩79,000 (월, VAT 별도 / 연간은 10개월 값)
--   모든 AI를 Sonnet 5.5로 돌리는 기준으로 월 AI 원가 상한도 함께 조정: $8 · $14 · $28
--   팀원 수 · 크레딧 · 기능은 그대로. 이미 결제 중인 구독은 다음 결제일부터 새 가격으로 청구됩니다.
-- 다시 Run 해도 안전합니다.
-- =====================================================================
update public.plans set price_month_krw = 29000, price_year_krw = 290000, ai_cost_cap_usd = 8  where id = 'starter';
update public.plans set price_month_krw = 49000, price_year_krw = 490000, ai_cost_cap_usd = 14 where id = 'pro';
update public.plans set price_month_krw = 79000, price_year_krw = 790000, ai_cost_cap_usd = 28 where id = 'pro_plus';
