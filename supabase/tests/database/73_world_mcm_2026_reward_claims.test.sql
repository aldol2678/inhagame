-- MCM 2026 P0-E (20260927160000): verified completion → claim → P0-C Reward → Wallet / Inventory →
-- final claim. Completions are produced through the real P0-E0 entry points. Concurrency, true
-- completed-before-end ordering and fresh-session readback live in
-- supabase/tests/integration/mcm-completion.integration.test.mjs (P0-E section).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a8000000-0000-4000-8000-0000000000a8', 'authenticated', 'authenticated', 'claim-a@example.test', now(), false),
 ('b8000000-0000-4000-8000-0000000000b8', 'authenticated', 'authenticated', 'claim-b@example.test', now(), false),
 ('c8000000-0000-4000-8000-0000000000c8', 'authenticated', 'authenticated', null, null, true),
 ('d8000000-0000-4000-8000-0000000000d8', 'authenticated', 'authenticated', 'claim-d@example.test', now(), false),
 ('e8000000-0000-4000-8000-0000000000e8', 'authenticated', 'authenticated', 'claim-e@example.test', now(), false),
 ('f8000000-0000-4000-8000-0000000000f8', 'authenticated', 'authenticated', 'claim-f@example.test', now(), false),
 ('08000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'claim-g@example.test', now(), false),
 ('18000000-0000-4000-8000-000000000018', 'authenticated', 'authenticated', 'claim-h@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a8000000-0000-4000-8000-0000000000a8', '수령A', false),
 ('b8000000-0000-4000-8000-0000000000b8', '수령B', false),
 ('c8000000-0000-4000-8000-0000000000c8', '수령게스트', false),
 ('d8000000-0000-4000-8000-0000000000d8', '수령정지', false),
 ('e8000000-0000-4000-8000-0000000000e8', '수령E', false),
 ('f8000000-0000-4000-8000-0000000000f8', '수령F', false),
 ('08000000-0000-4000-8000-000000000008', '수령G', false),
 ('18000000-0000-4000-8000-000000000018', '수령H', false);

-- Open the window around the (frozen) transaction time; the rollback restores the canonical dates.
update private.world_events set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour'
 where event_id = 'event.mcm_2026';

-- Test drivers for the real P0-E0 entry points (service adapter + server-judged landlord run).
create function pg_temp.clear_landlord(p uuid) returns void language plpgsql as $f$
declare
  v_run jsonb;
  v_survivor text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', p, 'is_anonymous', false)::text, true);
  v_run := public.start_mcm_landlord_run_v1();
  select r.survivor_actor_id into v_survivor from private.world_landlord_runs r
   where r.run_id = (v_run ->> 'runId')::uuid;
  perform public.submit_mcm_landlord_choice_v1((v_run ->> 'runId')::uuid, v_survivor);
  perform set_config('request.jwt.claims', '', true);
end;
$f$;
create function pg_temp.complete_mcm(p uuid) returns void language plpgsql as $f$
declare
  a text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.advance_mcm_2026_event_v1(p, 'start');
  foreach a in array array['investigate_staggering', 'investigate_dancing', 'investigate_hungry'] loop
    perform public.advance_mcm_2026_event_v1(p, a);
  end loop;
  perform pg_temp.clear_landlord(p);
end;
$f$;
create function pg_temp.coin(p uuid) returns bigint language sql as $f$
  select coalesce((select w.balance from private.world_wallets w
                    where w.user_id = p and w.currency_id = 'currency.induck_coin'), 0);
$f$;
create function pg_temp.items(p uuid) returns text[] language sql as $f$
  select coalesce(array_agg(i.item_id order by i.item_id), '{}') from private.world_player_items i where i.user_id = p;
$f$;
create function pg_temp.n(t regclass, p uuid) returns bigint language plpgsql as $f$
declare
  v bigint;
begin
  execute format('select count(*) from %s where user_id = $1', t) into v using p;
  return v;
end;
$f$;

select pg_temp.complete_mcm('a8000000-0000-4000-8000-0000000000a8');
select pg_temp.complete_mcm('d8000000-0000-4000-8000-0000000000d8');
select pg_temp.complete_mcm('f8000000-0000-4000-8000-0000000000f8');
select pg_temp.complete_mcm('18000000-0000-4000-8000-000000000018');
select is((select string_agg(p.stage::text, ',' order by p.user_id) from private.world_event_progress p
   where p.user_id in ('a8000000-0000-4000-8000-0000000000a8', 'd8000000-0000-4000-8000-0000000000d8',
                       'f8000000-0000-4000-8000-0000000000f8', '18000000-0000-4000-8000-000000000018')),
  '3,3,3,3', 'fixtures reached COMPLETED through the P0-E0 entry points');
-- B only started: no venue, no clear.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.advance_mcm_2026_event_v1('b8000000-0000-4000-8000-0000000000b8', 'start');
select set_config('request.jwt.claims', '', true);

-- ---- surface ----
select ok((select relrowsecurity from pg_class where oid = 'private.world_mcm_reward_claims'::regclass), 'claims have RLS');
select is((select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r,
    unnest(array['select', 'insert', 'update', 'delete']) p
  where has_table_privilege(r, 'private.world_mcm_reward_claims', p)), 0::bigint, 'no Data API role touches claims');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('claim_my_mcm_2026_main_reward_v1', 'claim_my_mcm_landlord_first_clear_reward_v1')
    and p.pronargs <> 0), 'claims take no arguments: no user, completion, reward, amount, item or currency override');
select ok(not exists (select 1 from pg_proc p where p.proname ~ 'mcm.*claim|claim_my_mcm'
    and p.prosrc ~ 'induck_coin|mcm_2026_survivor|mcm_2026_poster|badge\.'),
  'claim code names only Reward IDs; the grant list stays in the P0-C RewardDefinition');
select ok((select prosrc !~ 'public\.world_(wallet|inventory)_' and prosrc ~ 'private\.world_wallet_apply_v1'
    and prosrc ~ 'private\.world_inventory_grant_v1'
  from pg_proc where oid = 'private.world_reward_grant_v1(uuid,text,text,text,text)'::regprocedure),
  'the P0-C core reaches Wallet / Inventory through their cores, not their service-role wrappers');
select results_eq($$select has_function_privilege('anon', f, 'execute'),has_function_privilege('authenticated', f, 'execute')
  from unnest(array['public.claim_my_mcm_2026_main_reward_v1()', 'public.claim_my_mcm_landlord_first_clear_reward_v1()']) f$$,
  $$values (false, true), (false, true)$$, 'claims are signed-in only');

-- ---- A / G. incomplete: refused, nothing written (and another account's completion does not help) ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b8000000-0000-4000-8000-0000000000b8","is_anonymous":false}';
select lives_ok($$select public.save_my_game_progress('inha-duck',
  '{"events":{"event.mcm_2026":{"status":"COMPLETED","claimed":false,"landlordFirstClear":true}}}'::jsonb)$$,
  'a client can save arbitrary game JSON…');
select throws_ok($$select public.claim_my_mcm_2026_main_reward_v1()$$, 'P0001', 'CLAIM_NOT_ELIGIBLE',
  '…but an incomplete main event is refused');
select throws_ok($$select public.claim_my_mcm_landlord_first_clear_reward_v1()$$, 'P0001', 'CLAIM_NOT_ELIGIBLE',
  'no server first clear: landlord claim refused');
select throws_ok($$select private.world_mcm_claim_reward_v1('a8000000-0000-4000-8000-0000000000a8', 'MAIN_CLEAR')$$,
  '42501', null, 'the claim core cannot be called for another account');
select throws_ok($$select public.world_reward_grant_v1('b8000000-0000-4000-8000-0000000000b8',
  'reward.event.mcm_2026_main_clear', 'EVENT', 'event.mcm_2026:main_clear', 'event:mcm_2026:b8000000-0000-4000-8000-0000000000b8:main_clear')$$,
  '42501', null, 'the browser cannot run the reward directly');
select throws_ok($$insert into private.world_mcm_reward_claims(user_id, claim_type, event_id, reward_id, idempotency_key,
  reward_transaction_id, reward_status, source_completed_at) values ('b8000000-0000-4000-8000-0000000000b8', 'MAIN_CLEAR',
  'event.mcm_2026', 'reward.event.mcm_2026_main_clear', 'x', gen_random_uuid(), 'SUCCESS', now())$$,
  '42501', null, 'the browser cannot write a claim');
reset role;
select is(array[pg_temp.n('private.world_reward_transactions', 'b8000000-0000-4000-8000-0000000000b8'),
    pg_temp.n('private.world_mcm_reward_claims', 'b8000000-0000-4000-8000-0000000000b8'),
    pg_temp.n('private.world_player_items', 'b8000000-0000-4000-8000-0000000000b8'),
    pg_temp.coin('b8000000-0000-4000-8000-0000000000b8')],
  array[0, 0, 0, 0]::bigint[], 'refused claims leave no reward, claim, item or coin');

-- ---- K. account boundary ----
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.claim_my_mcm_2026_main_reward_v1()$$, '42501', null, 'signed-out: no execute');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c8000000-0000-4000-8000-0000000000c8","is_anonymous":true}';
select throws_ok($$select public.claim_my_mcm_2026_main_reward_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'guest main claim refused');
select throws_ok($$select public.claim_my_mcm_landlord_first_clear_reward_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'guest landlord claim refused');
set local request.jwt.claims = '{"role":"authenticated","sub":"c8000000-0000-4000-8000-0000000000c8","is_anonymous":false}';
select throws_ok($$select public.claim_my_mcm_2026_main_reward_v1()$$, '42501', 'ACCOUNT_UNAVAILABLE',
  'an anonymous account claiming is_anonymous=false is still refused');
reset role;
update public.profiles set is_banned = true where user_id = 'd8000000-0000-4000-8000-0000000000d8';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"d8000000-0000-4000-8000-0000000000d8","is_anonymous":false}';
select throws_ok($$select public.claim_my_mcm_2026_main_reward_v1()$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned: main claim refused');
select throws_ok($$select public.claim_my_mcm_landlord_first_clear_reward_v1()$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned: landlord claim refused');
reset role;
select is(array[pg_temp.n('private.world_reward_transactions', 'd8000000-0000-4000-8000-0000000000d8'),
    pg_temp.coin('d8000000-0000-4000-8000-0000000000d8')], array[0, 0]::bigint[], 'banned: nothing paid');

-- ---- B. main success ----
select is((select completed_at is not null from private.world_event_progress
  where user_id = 'a8000000-0000-4000-8000-0000000000a8'), true, 'A has a server completed_at');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a8000000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select set_config('test.a_main', public.claim_my_mcm_2026_main_reward_v1()::text, true);
reset role;
select results_eq($$select r->>'claimType', r->>'status', (r->>'replayed')::boolean, r->>'rewardId', r->>'rewardStatus'
  from (select current_setting('test.a_main')::jsonb r) x$$,
  $$values ('MAIN_CLEAR'::text, 'CLAIMED'::text, false, 'reward.event.mcm_2026_main_clear'::text, 'SUCCESS'::text)$$,
  'main clear claimed with a fresh SUCCESS reward');
select results_eq($$select e->>'targetId', e->>'status', (e->>'granted')::bigint
  from jsonb_array_elements(current_setting('test.a_main')::jsonb->'rewardResult'->'entries') e$$,
  $$values ('currency.induck_coin'::text, 'GRANTED'::text, 80::bigint), ('top.mcm_2026_survivor', 'GRANTED', 1),
           ('furniture.mcm_2026_poster', 'GRANTED', 1), ('exp.campus', 'GRANTED', 150)$$,
  'the RewardDefinition (v2, P1b) decided the grants: +80, survivor top, poster, +150 EXP');
select ok(not (current_setting('test.a_main')::jsonb ?| array['userId', 'idempotencyKey'])
    and not (current_setting('test.a_main')::jsonb->'rewardResult'->'entries'->0 ?| array['childIdempotencyKey', 'childTransactionId']),
  'the player result carries no user id, keys or child transaction ids');
select is(pg_temp.coin('a8000000-0000-4000-8000-0000000000a8'), 80::bigint, 'wallet +80');
select is(pg_temp.items('a8000000-0000-4000-8000-0000000000a8'),
  array['furniture.mcm_2026_poster', 'top.mcm_2026_survivor'], 'top and poster owned');
select results_eq($$select c.reward_id, c.reward_status, c.idempotency_key, c.reward_transaction_id::text,
    c.source_completed_at = p.completed_at, t.source_type, t.source_id, t.idempotency_key
  from private.world_mcm_reward_claims c
  join private.world_event_progress p on p.user_id = c.user_id
  join private.world_reward_transactions t on t.reward_transaction_id = c.reward_transaction_id
  where c.user_id = 'a8000000-0000-4000-8000-0000000000a8' and c.claim_type = 'MAIN_CLEAR'$$,
  $$select 'reward.event.mcm_2026_main_clear'::text, 'SUCCESS'::text,
    'event:mcm_2026:a8000000-0000-4000-8000-0000000000a8:main_clear'::text,
    current_setting('test.a_main')::jsonb->>'rewardTransactionId', true, 'EVENT'::text, 'event.mcm_2026:main_clear'::text,
    'event:mcm_2026:a8000000-0000-4000-8000-0000000000a8:main_clear'::text$$,
  'final claim row: reward, stable key, P0-C transaction, the completion it paid for');
select is((select stage from private.world_event_progress where user_id = 'a8000000-0000-4000-8000-0000000000a8'),
  3::smallint, 'claiming does not change completion (COMPLETED ≠ CLAIMED)');

-- ---- C. main retry: the stored claim, no second execution ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a8000000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select set_config('test.a_main2', public.claim_my_mcm_2026_main_reward_v1()::text, true);
reset role;
select results_eq($$select r->>'status', (r->>'replayed')::boolean, r->>'rewardTransactionId', r->>'claimedAt'
  from (select current_setting('test.a_main2')::jsonb r) x$$,
  $$select 'ALREADY_CLAIMED'::text, true, current_setting('test.a_main')::jsonb->>'rewardTransactionId',
    current_setting('test.a_main')::jsonb->>'claimedAt'$$, 'retry returns the final claim');
select is(array[pg_temp.n('private.world_reward_transactions', 'a8000000-0000-4000-8000-0000000000a8'),
    pg_temp.n('private.world_currency_transactions', 'a8000000-0000-4000-8000-0000000000a8'),
    pg_temp.n('private.world_item_grants', 'a8000000-0000-4000-8000-0000000000a8'),
    pg_temp.coin('a8000000-0000-4000-8000-0000000000a8')],
  array[1, 1, 2, 80]::bigint[], 'no duplicate reward, ledger row, grant or coin');

-- ---- H / I. landlord first clear ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a8000000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select set_config('test.a_land', public.claim_my_mcm_landlord_first_clear_reward_v1()::text, true);
reset role;
select results_eq($$select r->>'claimType', r->>'status', r->>'rewardId', r->>'rewardStatus',
    r->'rewardResult'->'entries'->0->>'targetId', r->'rewardResult'->'entries'->0->>'status'
  from (select current_setting('test.a_land')::jsonb r) x$$,
  $$values ('LANDLORD_FIRST_CLEAR'::text, 'CLAIMED'::text, 'reward.minigame.landlord_first_clear'::text, 'SUCCESS'::text,
    'badge.mcm_2026_landlord'::text, 'GRANTED'::text)$$, 'landlord first clear claimed: landlord badge');
select results_eq($$select c.idempotency_key, t.source_type, c.source_completed_at = f.first_cleared_at
  from private.world_mcm_reward_claims c
  join private.world_landlord_first_clears f on f.user_id = c.user_id
  join private.world_reward_transactions t on t.reward_transaction_id = c.reward_transaction_id
  where c.user_id = 'a8000000-0000-4000-8000-0000000000a8' and c.claim_type = 'LANDLORD_FIRST_CLEAR'$$,
  $$values ('minigame:landlord:a8000000-0000-4000-8000-0000000000a8:first_clear'::text, 'MINIGAME'::text, true)$$,
  'landlord claim: stable key, MINIGAME source, paid for the server first clear');
-- A later clear is not a new first clear and cannot pay again.
select pg_temp.clear_landlord('a8000000-0000-4000-8000-0000000000a8');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a8000000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select is(public.claim_my_mcm_landlord_first_clear_reward_v1()->>'status', 'ALREADY_CLAIMED', 'later runs do not re-open the badge claim');
reset role;
select is((select count(*) from private.world_landlord_runs where user_id = 'a8000000-0000-4000-8000-0000000000a8'
  and status = 'CLEARED'), 2::bigint, 'A cleared twice…');
select is(array[pg_temp.n('private.world_reward_transactions', 'a8000000-0000-4000-8000-0000000000a8'),
    (select count(*) from private.world_player_items where user_id = 'a8000000-0000-4000-8000-0000000000a8'
      and item_id = 'badge.mcm_2026_landlord'),
    pg_temp.n('private.world_mcm_reward_claims', 'a8000000-0000-4000-8000-0000000000a8'),
    pg_temp.coin('a8000000-0000-4000-8000-0000000000a8')],
  array[2, 1, 2, 80]::bigint[], '…yet one badge, two reward transactions, two claims, and still 80 coin');

-- ---- E. partial: survivor top already owned ----
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.world_inventory_grant_item_v1('e8000000-0000-4000-8000-0000000000e8', 'top.mcm_2026_survivor', 1,
  'SHOP', 'earlier', 'p0e:e8:earlier-top');
select set_config('request.jwt.claims', '', true);
select pg_temp.complete_mcm('e8000000-0000-4000-8000-0000000000e8');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e8000000-0000-4000-8000-0000000000e8","is_anonymous":false}';
select set_config('test.e_main', public.claim_my_mcm_2026_main_reward_v1()::text, true);
reset role;
select results_eq($$select r->>'status', r->>'rewardStatus' from (select current_setting('test.e_main')::jsonb r) x$$,
  $$values ('CLAIMED'::text, 'PARTIAL_SUCCESS'::text)$$, 'PARTIAL_SUCCESS is a final claim');
select results_eq($$select e->>'targetId', e->>'status', e->>'reason'
  from jsonb_array_elements(current_setting('test.e_main')::jsonb->'rewardResult'->'entries') e$$,
  $$values ('currency.induck_coin'::text, 'GRANTED'::text, null::text), ('top.mcm_2026_survivor', 'SKIPPED', 'ALREADY_OWNED'),
           ('furniture.mcm_2026_poster', 'GRANTED', null), ('exp.campus', 'GRANTED', null)$$,
  'coin, poster and EXP granted, owned top skipped');
select is(pg_temp.coin('e8000000-0000-4000-8000-0000000000e8'), 80::bigint, 'partial: +80');
select results_eq($$select source_type, source_ref from private.world_player_items
  where user_id = 'e8000000-0000-4000-8000-0000000000e8' and item_id = 'top.mcm_2026_survivor'$$,
  $$values ('SHOP'::text, 'earlier'::text)$$, 'the earlier top provenance is untouched');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e8000000-0000-4000-8000-0000000000e8","is_anonymous":false}';
select is(public.claim_my_mcm_2026_main_reward_v1()->>'status', 'ALREADY_CLAIMED', 'a partial claim is not retried');
reset role;
select is((select attempts from private.world_reward_transactions where user_id = 'e8000000-0000-4000-8000-0000000000e8'),
  1, 'P0-C ran once');

-- ---- F. response loss: reward committed, claim finalization lost ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"f8000000-0000-4000-8000-0000000000f8","is_anonymous":false}';
select set_config('test.f_main', public.claim_my_mcm_2026_main_reward_v1()::text, true);
reset role;
delete from private.world_mcm_reward_claims where user_id = 'f8000000-0000-4000-8000-0000000000f8';
select is(pg_temp.n('private.world_mcm_reward_claims', 'f8000000-0000-4000-8000-0000000000f8'), 0::bigint,
  'fault: the reward exists but the claim does not');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"f8000000-0000-4000-8000-0000000000f8","is_anonymous":false}';
select set_config('test.f_main2', public.claim_my_mcm_2026_main_reward_v1()::text, true);
reset role;
select results_eq($$select r->>'status', (r->>'replayed')::boolean, r->>'rewardTransactionId', r->>'rewardStatus'
  from (select current_setting('test.f_main2')::jsonb r) x$$,
  $$select 'CLAIMED'::text, true, current_setting('test.f_main')::jsonb->>'rewardTransactionId', 'SUCCESS'::text$$,
  'retry replays the stored P0-C result and finalizes the claim');
select is(array[pg_temp.n('private.world_mcm_reward_claims', 'f8000000-0000-4000-8000-0000000000f8'),
    pg_temp.n('private.world_reward_transactions', 'f8000000-0000-4000-8000-0000000000f8'),
    pg_temp.n('private.world_currency_transactions', 'f8000000-0000-4000-8000-0000000000f8'),
    pg_temp.n('private.world_item_grants', 'f8000000-0000-4000-8000-0000000000f8'),
    pg_temp.coin('f8000000-0000-4000-8000-0000000000f8')],
  array[1, 1, 1, 2, 80]::bigint[], 'recovered: one claim, no duplicate value');

-- ---- reward FAILED: completion kept, no claim, same key resumes ----
select pg_temp.complete_mcm('08000000-0000-4000-8000-000000000008');
-- Fault injection on this account only: a wallet one credit away from bigint overflow.
insert into private.world_wallets(user_id, currency_id, balance)
  values ('08000000-0000-4000-8000-000000000008', 'currency.induck_coin', 9223372036854775800);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"08000000-0000-4000-8000-000000000008","is_anonymous":false}';
select set_config('test.g_main', public.claim_my_mcm_2026_main_reward_v1()::text, true);
reset role;
select results_eq($$select r->>'status', r->>'rewardStatus', r->>'claimedAt', r->'rewardResult'->'entries'->0->>'status'
  from (select current_setting('test.g_main')::jsonb r) x$$,
  $$values ('REWARD_FAILED'::text, 'FAILED'::text, null::text, 'FAILED'::text)$$, 'a FAILED reward is not a claim');
select is(pg_temp.n('private.world_mcm_reward_claims', '08000000-0000-4000-8000-000000000008'), 0::bigint, 'no claim row');
select is((select stage from private.world_event_progress where user_id = '08000000-0000-4000-8000-000000000008'),
  3::smallint, 'completion is not rolled back');
delete from private.world_wallets where user_id = '08000000-0000-4000-8000-000000000008'; -- the fault is repaired
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"08000000-0000-4000-8000-000000000008","is_anonymous":false}';
select set_config('test.g_main2', public.claim_my_mcm_2026_main_reward_v1()::text, true);
reset role;
select results_eq($$select r->>'status', r->>'rewardStatus', r->>'rewardTransactionId' from (select current_setting('test.g_main2')::jsonb r) x$$,
  $$select 'CLAIMED'::text, 'SUCCESS'::text, current_setting('test.g_main')::jsonb->>'rewardTransactionId'$$,
  'the retry resumes the same reward transaction and finalizes the claim');
select is(array[(select attempts::bigint from private.world_reward_transactions where user_id = '08000000-0000-4000-8000-000000000008'),
    pg_temp.n('private.world_item_grants', '08000000-0000-4000-8000-000000000008'),
    pg_temp.coin('08000000-0000-4000-8000-000000000008')],
  array[2, 2, 80]::bigint[], 'resumed once: items not granted twice, +80');

-- ---- J. after the event: no new completions, earned claims still pay ----
update private.world_events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute'
 where event_id = 'event.mcm_2026';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"18000000-0000-4000-8000-000000000018","is_anonymous":false}';
select is(public.get_my_mcm_2026_event_v1()->>'eventState', 'ENDED', 'the event has ended');
select results_eq($$select public.claim_my_mcm_2026_main_reward_v1()->>'status' union all
  select public.claim_my_mcm_landlord_first_clear_reward_v1()->>'status'$$,
  $$values ('CLAIMED'::text), ('CLAIMED')$$, 'an earned completion is claimable after the end');
select throws_ok($$select public.start_mcm_landlord_run_v1()$$, 'P0001', 'EVENT_NOT_ACTIVE', 'no new run after the end');
set local request.jwt.claims = '{"role":"authenticated","sub":"b8000000-0000-4000-8000-0000000000b8","is_anonymous":false}';
select throws_ok($$select public.claim_my_mcm_2026_main_reward_v1()$$, 'P0001', 'CLAIM_NOT_ELIGIBLE',
  'no completion, no claim after the end');
set local request.jwt.claims = '{"role":"authenticated","sub":"a8000000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select is(public.claim_my_mcm_2026_main_reward_v1()->>'status', 'ALREADY_CLAIMED', 'final claims still read back after the end');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$select public.advance_mcm_2026_event_v1('b8000000-0000-4000-8000-0000000000b8', 'investigate_hungry')$$,
  'P0001', 'EVENT_NOT_ACTIVE', 'no new progress after the end');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.coin('18000000-0000-4000-8000-000000000018'), 80::bigint, 'post-event claim paid +80');
select is(pg_temp.items('18000000-0000-4000-8000-000000000018'),
  array['badge.mcm_2026_landlord', 'furniture.mcm_2026_poster', 'top.mcm_2026_survivor'], 'post-event claim items');

-- ---- claims are final ----
select throws_ok($$update private.world_mcm_reward_claims set reward_status = 'SUCCESS'
  where user_id = 'e8000000-0000-4000-8000-0000000000e8'$$, '42501', 'CLAIM_FINAL', 'a final claim never changes');

select * from finish();
rollback;
