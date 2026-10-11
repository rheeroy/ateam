-- =====================================================================
-- ATEAM · 0006 schedules (⑩ 스케줄러)
-- 월요일 07:00 KST 팀 브리핑, 매일 03:00 KST 구독 갱신 결제.
-- pg_cron + pg_net 이 필요하다. (대시보드 > Database > Extensions 에서 켜기)
-- 아래 두 값은 배포 후 SQL Editor에서 한 번 넣는다:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role key>', 'service_role_key');
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public._invoke_function(p_name text, p_body jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    raise notice 'vault secrets project_url / service_role_key 가 없습니다'; return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := p_body);
end $$;
revoke all on function public._invoke_function(text, jsonb) from public, anon, authenticated;

-- 월요일 22:00 UTC(일) = 월요일 07:00 KST
select cron.schedule('weekly-briefing', '0 22 * * 0', $$ select public._invoke_function('ai-weekly-briefing', '{"all": true}') $$);
-- 매일 18:00 UTC = 03:00 KST
select cron.schedule('billing-renew', '0 18 * * *', $$ select public._invoke_function('billing', '{"action": "renew_due"}') $$);
