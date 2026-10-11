-- 로컬 Postgres에서 마이그레이션을 검증하기 위한 Supabase 최소 스텁 (배포에는 쓰지 않음)
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, aud text, role text, email_confirmed_at timestamptz, instance_id uuid, encrypted_password text, confirmation_token text, recovery_token text, email_change_token_new text, email_change text, raw_app_meta_data jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('request.jwt.claims', true), '')::json->>'role', 'service_role') $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage; grant usage on schema storage to authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;

-- PostgREST 로그인 역할 (로컬 E2E 용)
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then
  create role authenticator login password 'auth' noinherit; end if; end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema storage to anon, service_role;
