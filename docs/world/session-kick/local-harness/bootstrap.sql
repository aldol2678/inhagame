-- Scratch-only stand-ins for a plain PostgreSQL 16 cluster. NEVER run against a real Supabase project.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role authenticator noinherit login; grant anon, authenticated, service_role to authenticator;
create schema extensions; create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), aud text, role text, email text,
  email_confirmed_at timestamptz, is_anonymous boolean not null default false, created_at timestamptz default now(),
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, updated_at timestamptz default now(),
  last_sign_in_at timestamptz, banned_until timestamptz, deleted_at timestamptz, phone text, encrypted_password text);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
create schema realtime;
create table realtime.messages(id bigserial primary key, topic text, extension text, payload jsonb);
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated, anon;
grant select, insert on realtime.messages to authenticated;
create schema storage; create schema graphql_public; create schema vault;
