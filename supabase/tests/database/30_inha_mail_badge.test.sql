-- Inha mail badge contract: the database side of supabase/functions/verify-inha-mail.
-- claim_inha_mail_badge is service-role only and trusts nothing but confirmed auth.users rows.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

\set primary_a '''d1000000-0000-4000-8000-000000000001'''
\set primary_b '''d2000000-0000-4000-8000-000000000002'''
\set school_ok '''d3000000-0000-4000-8000-000000000003'''
\set school_unconfirmed '''d4000000-0000-4000-8000-000000000004'''
\set school_gmail '''d5000000-0000-4000-8000-000000000005'''
\set primary_unconfirmed '''d6000000-0000-4000-8000-000000000006'''
\set claims_a '''{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}'''
\set claims_b '''{"sub":"d2000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}'''

insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous) values
  (:primary_a, 'authenticated', 'authenticated', 'a@gmail.example', now(), false),
  (:primary_b, 'authenticated', 'authenticated', 'b@gmail.example', now(), false),
  (:school_ok, 'authenticated', 'authenticated', 'Duck.12201234@INHA.EDU', now(), false),
  (:school_unconfirmed, 'authenticated', 'authenticated', 'late@inha.ac.kr', null, false),
  (:school_gmail, 'authenticated', 'authenticated', 'duck@gmail.example', now(), false),
  (:primary_unconfirmed, 'authenticated', 'authenticated', 'new@gmail.example', null, false);

-- ---- mailbox rule, shared with the Edge Function ----
select is(public.is_inha_mail(e), ok, format('is_inha_mail(%L) = %s', e, ok)) from (values
  ('s@inha.edu', true), ('S@INHA.AC.KR', true), ('s@inha.ac.kr', true),
  ('s@inha.edu.evil.example', false), ('s@mail.inha.edu', false), ('s@notinha.edu', false),
  ('@inha.edu', false), ('a b@inha.edu', false), (null, false)
) as t(e, ok);

-- ---- who may claim ----
set local role anon;
select throws_ok(format('select public.claim_inha_mail_badge(%L, %L)', :primary_a, :school_ok), '42501', null,
  'anon cannot claim a badge');
select throws_ok($$select public.my_inha_mail_badge()$$, '42501', null, 'anon cannot query badge status');
reset role;
set local role authenticated;
set local request.jwt.claims = :claims_a;
select throws_ok(format('select public.claim_inha_mail_badge(%L, %L)', :primary_a, :school_ok), '42501', null,
  'a signed-in player cannot grant themselves a badge');
select throws_ok($$select * from public.inha_mail_badges$$, '42501', null, 'players cannot read the badge table');
select is(public.my_inha_mail_badge(), false, 'no badge before the claim');
reset role;

-- ---- claim rules (as the Edge Function's service role) ----
set local role service_role;
select throws_ok(format('select public.claim_inha_mail_badge(%L, %L)', :primary_a, :primary_a), 'P0001',
  'A second mailbox is required', 'primary and school must be different accounts');
select throws_ok(format('select public.claim_inha_mail_badge(%L, %L)', :primary_unconfirmed, :school_ok), 'P0001',
  'Primary account is not confirmed', 'primary must be confirmed');
select throws_ok(format('select public.claim_inha_mail_badge(%L, %L)', :primary_a, :school_unconfirmed), 'P0001',
  'School mailbox is not confirmed', 'school mailbox must be confirmed');
select throws_ok(format('select public.claim_inha_mail_badge(%L, %L)', :primary_a, :school_gmail), 'P0001',
  'School mailbox is not confirmed', 'school mailbox must be an Inha address');
select is(public.claim_inha_mail_badge(:primary_a, :school_ok), true, 'a valid claim succeeds');
reset role; -- no Data API role, service_role included, can read the table itself
select results_eq(format('select user_id, email from public.inha_mail_badges where user_id = %L', :primary_a),
  format('values (%L::uuid, %L::text)', :primary_a, 'duck.12201234@inha.edu'),
  'the badge stores the lower-cased school address');
select ok(not has_table_privilege('service_role', 'public.inha_mail_badges', 'select'),
  'even service_role reads badges only through the functions');
set local role service_role;
select is(public.claim_inha_mail_badge(:primary_a, :school_ok), true, 'claiming again is idempotent');
select throws_ok(format('select public.claim_inha_mail_badge(%L, %L)', :primary_b, :school_ok), '23505', null,
  'one school mailbox cannot back two accounts (Edge Function maps this to 409)');
reset role;

set local role authenticated;
set local request.jwt.claims = :claims_a;
select is(public.my_inha_mail_badge(), true, 'the claimed account now has the badge');
set local request.jwt.claims = :claims_b;
select is(public.my_inha_mail_badge(), false, 'another account does not');
reset role;

select * from finish();
rollback;
