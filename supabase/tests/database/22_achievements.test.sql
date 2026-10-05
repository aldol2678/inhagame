-- First P2 award: only the caller's permanent account receives a Classic record award.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a1a1a1a1-0000-4000-8000-000000000091','authenticated','authenticated','ach-a@example.test',now(),false),
 ('b2b2b2b2-0000-4000-8000-000000000092','authenticated','authenticated','ach-b@example.test',now(),false),
 ('c3c3c3c3-0000-4000-8000-000000000093','authenticated','authenticated',null,null,true);
insert into public.profiles(user_id,nickname) values
 ('a1a1a1a1-0000-4000-8000-000000000091','기록계정'),
 ('b2b2b2b2-0000-4000-8000-000000000092','빈계정'),
 ('c3c3c3c3-0000-4000-8000-000000000093','익명계정')
on conflict (user_id) do nothing;
insert into public.general_stage_bests(user_id,stage_id,best_score,best_combo,achieved_at)
values
 ('a1a1a1a1-0000-4000-8000-000000000091',1,100,2,'2026-09-20T00:00:00Z'),
 ('c3c3c3c3-0000-4000-8000-000000000093',1,100,2,'2026-09-20T00:00:00Z');

select is((select count(*) from public.user_achievements
  where user_id='a1a1a1a1-0000-4000-8000-000000000091'),0::bigint,
  'new records do not depend on a Classic save trigger');
set local role anon;
select throws_ok($$select public.get_my_achievements()$$,'42501',null,'anon cannot call private awards');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"b2b2b2b2-0000-4000-8000-000000000092","role":"authenticated","is_anonymous":false}';
select is((public.get_my_achievements()->>'earnedCount')::integer,0,'recordless account has no award');
select is_empty($$select 1 from public.user_achievements$$,'recordless account cannot see another account');

set local request.jwt.claims='{"sub":"a1a1a1a1-0000-4000-8000-000000000091","role":"authenticated","is_anonymous":false}';
select is((public.get_my_achievements()->>'earnedCount')::integer,1,'record owner earns once');
select is((public.get_my_achievements()->'achievements'->0->>'earnedAt')::timestamptz,
  '2026-09-20T00:00:00Z'::timestamptz,'earned date is the source record date');
select is((select count(*) from public.user_achievements),1::bigint,'repeat reads are idempotent');
select throws_ok($$insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  values ('b2b2b2b2-0000-4000-8000-000000000092','classic_recorded_v1',now(),'classic_record')$$,
  '42501',null,'client cannot award another user');

set local request.jwt.claims='{"sub":"b2b2b2b2-0000-4000-8000-000000000092","role":"authenticated","is_anonymous":false}';
select is_empty($$select 1 from public.user_achievements$$,'other account cannot read award');

set local request.jwt.claims='{"sub":"c3c3c3c3-0000-4000-8000-000000000093","role":"authenticated","is_anonymous":true}';
select throws_ok($$select public.get_my_achievements()$$,'42501','PERMANENT_ACCOUNT_REQUIRED',
  'guest record never produces a permanent-account award');
reset role;
select is((select count(*) from public.user_achievements
  where user_id='c3c3c3c3-0000-4000-8000-000000000093'),0::bigint,
  'anonymous account remains unawarded');

select * from finish();
rollback;
