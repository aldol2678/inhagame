-- P1-B · inha_verified_v1 and Classic S1 placements coexist in the achievement contract.
-- A: direct Inha primary · B: linked school mailbox · C: S1 regression · D: Classic contract
-- E: invalid key/evidence pairs · plus grant and SECURITY DEFINER readback.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at) values
 ('8b000000-0000-4000-8000-000000000001','authenticated','authenticated','p1b-direct@inha.edu','2026-09-26T00:00:00Z',false,now()),
 ('8b000000-0000-4000-8000-000000000002','authenticated','authenticated','p1b-direct@inha.ac.kr','2026-09-26T00:00:00Z',false,now()),
 ('8b000000-0000-4000-8000-000000000003','authenticated','authenticated','p1b-primary@example.test','2026-09-26T00:00:00Z',false,now()),
 ('8b000000-0000-4000-8000-000000000004','authenticated','authenticated','p1b-school@inha.ac.kr','2026-09-26T00:01:00Z',false,now()),
 ('8b000000-0000-4000-8000-000000000005','authenticated','authenticated','p1b-s1@inha.edu','2026-09-26T00:00:00Z',false,now()),
 ('8b000000-0000-4000-8000-000000000006','authenticated','authenticated','p1b-plain@example.test','2026-09-26T00:00:00Z',false,now()),
 ('8b000000-0000-4000-8000-000000000007','authenticated','authenticated','p1b-unconfirmed@example.test',null,false,now()),
 ('8b000000-0000-4000-8000-000000000008','authenticated','authenticated','p1b-banned@inha.edu','2026-09-26T00:00:00Z',false,now());
insert into public.profiles(user_id,nickname,is_banned) values
 ('8b000000-0000-4000-8000-000000000001','직접인증A',false),
 ('8b000000-0000-4000-8000-000000000002','직접인증B',false),
 ('8b000000-0000-4000-8000-000000000003','연결인증',false),
 ('8b000000-0000-4000-8000-000000000005','시즌1',false),
 ('8b000000-0000-4000-8000-000000000006','미인증',false),
 ('8b000000-0000-4000-8000-000000000007','미확인',false),
 ('8b000000-0000-4000-8000-000000000008','차단',true)
on conflict (user_id) do update set nickname=excluded.nickname, is_banned=excluded.is_banned;

-- Constraint readback (A/B).
select ok(pg_get_constraintdef(oid) ~ 'inha_verified_v1', 'key check allows inha_verified_v1')
from pg_constraint where conrelid='public.user_achievements'::regclass and conname='user_achievements_achievement_key_check';
select ok(pg_get_constraintdef(oid) ~ 'inha_mail_verified', 'evidence check maps inha_verified_v1 to inha_mail_verified')
from pg_constraint where conrelid='public.user_achievements'::regclass and conname='user_achievements_evidence_source_check';

-- E: invalid pairs and unknown keys are rejected; every valid pair is accepted.
select throws_ok($$insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  values ('8b000000-0000-4000-8000-000000000006','inha_verified_v1',now(),'classic_record')$$,
  '23514', null, 'inha_verified_v1 + classic_record is rejected');
select throws_ok($$insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  values ('8b000000-0000-4000-8000-000000000006','classic_recorded_v1',now(),'inha_mail_verified')$$,
  '23514', null, 'classic_recorded_v1 + inha_mail_verified is rejected');
select throws_ok($$insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  values ('8b000000-0000-4000-8000-000000000006','classic_inha_duck_s1_rank_1_v1',now(),'inha_mail_verified')$$,
  '23514', null, 'S1 rank + inha_mail_verified is rejected');
select throws_ok($$insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  values ('8b000000-0000-4000-8000-000000000006','inha_verified_v1',now(),'classic_event_final_rank')$$,
  '23514', null, 'inha_verified_v1 + classic_event_final_rank is rejected');
select throws_ok($$insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  values ('8b000000-0000-4000-8000-000000000006','classic_inha_duck_s1_rank_11_v1',now(),'classic_event_final_rank')$$,
  '23514', null, 'S1 rank 11 is rejected');
select throws_ok($$insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  values ('8b000000-0000-4000-8000-000000000006','classic_inha_duck_s1_rank_0_v1',now(),'classic_event_final_rank')$$,
  '23514', null, 'S1 rank 0 is rejected');
select throws_ok($$insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  values ('8b000000-0000-4000-8000-000000000006','unknown_award_v1',now(),'classic_record')$$,
  '23514', null, 'unknown achievement key is rejected');
select lives_ok(format($f$
  insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
  values ('8b000000-0000-4000-8000-000000000006','classic_inha_duck_s1_rank_%s_v1',now(),'classic_event_final_rank')$f$, g),
  'S1 rank '||g||' is accepted')
from generate_series(1,10) g;
delete from public.user_achievements where user_id='8b000000-0000-4000-8000-000000000006';

-- A: direct confirmed Inha primary (@inha.edu and @inha.ac.kr).
set local role authenticated;
set local request.jwt.claims='{"sub":"8b000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select is(public.get_my_achievements()->'achievements'->2->>'key','inha_verified_v1','inha_verified_v1 is the third achievement');
select is((public.get_my_achievements()->'achievements'->2->>'earned')::boolean,true,'@inha.edu primary earns inha_verified_v1');
select is((public.get_my_achievements()->>'earnedCount')::integer,1,'earnedCount includes inha_verified_v1');
set local request.jwt.claims='{"sub":"8b000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select is((public.get_my_achievements()->'achievements'->2->>'earned')::boolean,true,'@inha.ac.kr primary earns inha_verified_v1');
reset role;
select is((select count(*) from public.user_achievements
  where user_id in ('8b000000-0000-4000-8000-000000000001','8b000000-0000-4000-8000-000000000002')
    and achievement_key='inha_verified_v1' and evidence_source='inha_mail_verified'),2::bigint,
  'direct verification is materialized lazily with inha_mail_verified evidence');

-- Not verified: no Inha evidence, no row.
set local role authenticated;
set local request.jwt.claims='{"sub":"8b000000-0000-4000-8000-000000000006","role":"authenticated","is_anonymous":false}';
select is((public.get_my_achievements()->'achievements'->2->>'earned')::boolean,false,'non-Inha account without badge is not verified');
select is((public.get_my_achievements()->>'earnedCount')::integer,0,'non-Inha account earns nothing');
reset role;
select is((select count(*) from public.user_achievements where user_id='8b000000-0000-4000-8000-000000000006'),0::bigint,
  'no achievement row is created without evidence');

-- Banned / anonymous callers stay blocked.
set local role authenticated;
set local request.jwt.claims='{"sub":"8b000000-0000-4000-8000-000000000008","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.get_my_achievements()$$,'42501','PERMANENT_ACCOUNT_REQUIRED','banned account is blocked');
set local request.jwt.claims='{"sub":"8b000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}';
select throws_ok($$select public.get_my_achievements()$$,'42501','PERMANENT_ACCOUNT_REQUIRED','anonymous session is blocked');
reset role;

-- B: linked school mailbox through the service path.
select throws_ok($$select public.claim_inha_mail_badge('8b000000-0000-4000-8000-000000000003','8b000000-0000-4000-8000-000000000003')$$,
  'P0001','A second mailbox is required','same account cannot be its own school mailbox');
select throws_ok($$select public.claim_inha_mail_badge('8b000000-0000-4000-8000-000000000007','8b000000-0000-4000-8000-000000000004')$$,
  'P0001','Primary account is not confirmed','unconfirmed primary is rejected');
select throws_ok($$select public.claim_inha_mail_badge('8b000000-0000-4000-8000-000000000003','8b000000-0000-4000-8000-000000000006')$$,
  'P0001','School mailbox is not confirmed','non-Inha school mailbox is rejected');
set local role service_role;
select ok(public.claim_inha_mail_badge('8b000000-0000-4000-8000-000000000003','8b000000-0000-4000-8000-000000000004'),
  'service role links a confirmed Inha mailbox');
select ok(public.claim_inha_mail_badge('8b000000-0000-4000-8000-000000000003','8b000000-0000-4000-8000-000000000004'),
  'repeat claim is idempotent');
reset role;
select is((select count(*) from public.inha_mail_badges where user_id='8b000000-0000-4000-8000-000000000003'),1::bigint,
  'claim writes exactly one inha_mail_badges row');
select is((select count(*) from public.user_achievements where user_id='8b000000-0000-4000-8000-000000000003'
  and achievement_key='inha_verified_v1' and evidence_source='inha_mail_verified'),1::bigint,
  'claim writes exactly one inha_verified_v1 row');
set local role authenticated;
set local request.jwt.claims='{"sub":"8b000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}';
select is((public.get_my_achievements()->'achievements'->2->>'earned')::boolean,true,'linked account sees inha_verified_v1 earned');
reset role;

-- C: Classic S1 placement coexists with inha_verified_v1.
set local session_replication_role = replica;  -- fixture only: skip the best_run_id FK
insert into public.classic_event_badges(event_key,user_id,placement,badge_code,best_run_id,final_score,final_combo,final_achieved_at)
values ('inha_duck_s1','8b000000-0000-4000-8000-000000000005',2,'inha_duck_s1_silver',gen_random_uuid(),1000,10,'2026-09-27T00:00:00Z');
set local session_replication_role = origin;
insert into public.user_achievements(user_id,achievement_key,earned_at,evidence_source)
values ('8b000000-0000-4000-8000-000000000005','classic_inha_duck_s1_rank_2_v1','2026-09-27T00:00:00Z','classic_event_final_rank');
set local role authenticated;
set local request.jwt.claims='{"sub":"8b000000-0000-4000-8000-000000000005","role":"authenticated","is_anonymous":false}';
select is(jsonb_array_length(public.get_my_achievements()->'achievements'),4,'S1 placement is appended as a fourth achievement');
select is(public.get_my_achievements()->'achievements'->3->>'key','classic_inha_duck_s1_rank_2_v1','S1 placement key is returned');
select is(public.get_my_achievements()->'achievements'->3->>'title','인하오리 S1 준우승','S1 placement title is preserved');
select is((public.get_my_achievements()->'achievements'->3->>'earned')::boolean,true,'S1 placement is earned');
select is((public.get_my_achievements()->'achievements'->2->>'earned')::boolean,true,'S1 player with Inha mail also has inha_verified_v1');
select is((public.get_my_achievements()->>'earnedCount')::integer,2,'earnedCount counts inha_verified_v1 and the S1 placement');
reset role;
select is((select count(*) from public.user_achievements where user_id='8b000000-0000-4000-8000-000000000005'
  and achievement_key='classic_inha_duck_s1_rank_2_v1'),1::bigint,'existing S1 row is untouched');

-- D: Classic response contract (order and shape).
set local role authenticated;
set local request.jwt.claims='{"sub":"8b000000-0000-4000-8000-000000000006","role":"authenticated","is_anonymous":false}';
select is(public.get_my_achievements()->'achievements'->0->>'key','classic_recorded_v1','Classic record stays first');
select is(public.get_my_achievements()->'achievements'->1->>'key','classic_ranked_accepted_v1','Classic ranked stays second');
select is(public.get_my_achievements()->'achievements'->2->>'scope','platform','Inha verification is a platform award');
select ok(public.get_my_achievements()->'achievements'->2->'gameSlug' = 'null'::jsonb,'Inha verification has no game slug');
reset role;

-- Grants and SECURITY DEFINER contract.
select ok(not has_function_privilege('anon','public.claim_inha_mail_badge(uuid,uuid)','execute'),'anon cannot claim');
select ok(not has_function_privilege('authenticated','public.claim_inha_mail_badge(uuid,uuid)','execute'),'authenticated cannot claim');
select ok(has_function_privilege('service_role','public.claim_inha_mail_badge(uuid,uuid)','execute'),'service_role can claim');
select ok(not has_function_privilege('anon','public.get_my_achievements()','execute'),'anon cannot read achievements');
select ok(has_function_privilege('authenticated','public.get_my_achievements()','execute'),'authenticated can read own achievements');
select ok(not exists (
  select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid in ('public.claim_inha_mail_badge(uuid,uuid)'::regprocedure,'public.get_my_achievements()'::regprocedure)
    and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC cannot execute either function');
select ok(p.prosecdef and p.proconfig = array['search_path=""'], p.oid::regprocedure::text||' is SECURITY DEFINER with empty search_path')
from pg_proc p where p.oid in ('public.claim_inha_mail_badge(uuid,uuid)'::regprocedure,'public.get_my_achievements()'::regprocedure);
select ok(pg_get_functiondef(p.oid) !~ 'user_metadata', p.oid::regprocedure::text||' does not authorize from user_metadata')
from pg_proc p where p.oid in ('public.claim_inha_mail_badge(uuid,uuid)'::regprocedure,'public.get_my_achievements()'::regprocedure);

select * from finish();
rollback;
