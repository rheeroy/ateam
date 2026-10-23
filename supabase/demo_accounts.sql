-- =====================================================================
-- ATEAM 데모 계정 — 팀장 1 + 팀원 6, 약 6개월치 기록이 있는 '마케팅기획팀 (데모)'
-- SQL Editor에서 Run. 다시 Run하면 데모 계정·데이터가 처음 상태로 초기화됩니다.
-- 로그인: 앱 로그인 화면 → 이메일 + 비밀번호
--   팀장  demo@ateam.com
--   팀원  demo_p1@ateam.com ~ demo_p6@ateam.com
--   비밀번호 demo123 (모든 계정 같음 · 아래 pw 값) — 공개 주소이니 바꿔서 쓰세요
-- 메일은 보내지 않습니다 (이메일 확인 완료 상태로 생성)
-- =====================================================================

-- 데모 계정과 그 계정이 남긴 기록을 지운다 (다시 Run할 때 초기화용)
create or replace function pg_temp.purge_demo_users(p_ids uuid[]) returns void language plpgsql as $f$
declare r record; pass int;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then return; end if;
  delete from public.teams where owner_id = any(p_ids)
     or (is_demo and id in (select team_id from public.team_members where user_id = any(p_ids)));
  for pass in 1..4 loop
    for r in
      select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype in ('a', 'r')
    loop
      begin
        execute format('delete from %s where %I = any($1)', r.tbl, r.col) using p_ids;
      exception when foreign_key_violation then null;
      end;
    end loop;
  end loop;
  delete from auth.users where id = any(p_ids);
end $f$;

do $$
declare
  pw   text := 'demo123';   -- ← 비밀번호
  dom  text := 'ateam.com';
  cast_ text[][] := array[['demo','이정재'], ['demo_p1','김현정'], ['demo_p2','박서연'], ['demo_p3','최다은'], ['demo_p4','정우성'], ['demo_p5','이동욱'], ['demo_p6','한수진']];
  ids  uuid[] := '{}';
  uid  uuid;
  L    uuid;
  members uuid[] := '{}';
  T    uuid;
  col  text;
  i    int;
begin
  perform set_config('search_path', 'public, extensions', true);

  -- 0) 이전 데모 정리 (이 스크립트로 만든 계정 + 예전 '데모 팀 만들기' 기능으로 만든 것)
  --    데모 주소만 정확히 고른다 (같은 도메인의 실제 사용자는 건드리지 않음) + 예전 @demo.ateam 계정
  select coalesce(array_agg(id), '{}') into ids from auth.users
    where email = 'demo@' || dom or email ~ ('^demo_p[0-9]+@' || replace(dom, '.', '\.') || '$') or email like '%@demo.ateam';
  if to_regclass('public.demo_accounts') is not null then
    execute 'select coalesce(array_agg(user_id), ''{}'') from public.demo_accounts' into members;
    ids := ids || members;
    members := '{}';
  end if;
  perform pg_temp.purge_demo_users(ids);
  drop table if exists public.demo_accounts;

  -- 1) 계정 (이메일 확인 완료, 비밀번호 로그인)
  for i in 1..array_length(cast_, 1) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data,
                            confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            cast_[i][1] || '@' || dom, crypt(pw, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', cast_[i][2]),
            '', '', '', '', now(), now())
    returning id into uid;
    if to_regclass('auth.identities') is not null then
      execute $q$insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
               values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true), 'email', now(), now(), now())$q$
        using uid, cast_[i][1] || '@' || dom;
    end if;
    update public.profiles set full_name = cast_[i][2] where id = uid;
    if i = 1 then L := uid; else members := members || uid; end if;
  end loop;
  -- 로그인 서버는 토큰 칸이 NULL이면 오류를 내므로 빈 문자열로 (버전에 따라 있는 칸만)
  for col in select column_name from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and is_nullable = 'YES'
               and column_name in ('email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %I = '''' where (email = $1 or email ~ $2) and %I is null', col, col) using 'demo@' || dom, '^demo_p[0-9]+@' || replace(dom, '.', '\.') || '$';
  end loop;

  -- 2) 팀장 구독 (Pro, 1년) + 데모 팀 + 기록
  insert into public.subscriptions (owner_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (L, 'pro', 'active', null, now(), now() + interval '1 year');
  insert into public.teams (name, owner_id, is_demo) values ('마케팅기획팀 (데모)', L, true) returning id into T;
  perform public.seed_demo_team(T, L, members);
end $$;

select u.email as "데모 계정", p.full_name as "이름", tm.role as "역할", tm.job_title as "직무"
from auth.users u join public.profiles p on p.id = u.id join public.team_members tm on tm.user_id = u.id
where u.email = 'demo@ateam.com' or u.email ~ '^demo_p[0-9]+@ateam\.com$' order by tm.role = 'leader' desc, tm.joined_at;
