-- Economy P0-C + P0-F1: Reward Orchestrator with CURRENCY / ITEM / EXP adapters.
-- Definitions, composite rewards, duplicate UNIQUE -> PARTIAL_SUCCESS, parent idempotency, conflicts, adapter
-- failure + resume, final-row immutability and the client/server boundary. Concurrency, crash
-- rollback and cross-connection readback live in supabase/tests/integration/reward.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a5000000-0000-4000-8000-0000000000a5', 'authenticated', 'authenticated', 'reward-a@example.test', now(), false),
 ('b5000000-0000-4000-8000-0000000000b5', 'authenticated', 'authenticated', 'reward-b@example.test', now(), false),
 ('c5000000-0000-4000-8000-0000000000c5', 'authenticated', 'authenticated', null, null, true),
 ('d5000000-0000-4000-8000-0000000000d5', 'authenticated', 'authenticated', 'reward-d@example.test', now(), false),
 ('e5000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'reward-e@example.test', now(), false),
 ('f5000000-0000-4000-8000-0000000000f5', 'authenticated', 'authenticated', 'reward-f@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a5000000-0000-4000-8000-0000000000a5', '보상A', false),
 ('b5000000-0000-4000-8000-0000000000b5', '보상B', false),
 ('c5000000-0000-4000-8000-0000000000c5', '보상게스트', false),
 ('d5000000-0000-4000-8000-0000000000d5', '보상정지', true),
 ('e5000000-0000-4000-8000-0000000000e5', '보상E', false),
 ('f5000000-0000-4000-8000-0000000000f5', '보상F', false);

-- ---- definitions ----
select has_table('private', t, format('%s exists', t))
from unnest(array['world_reward_definitions', 'world_reward_grants', 'world_reward_transactions',
                  'world_reward_transaction_entries']) t;
select results_eq($$
  select d.reward_id, d.status, d.event_id, g.grant_entry_id, g.grant_type, g.target_id, g.amount
  from private.world_reward_definitions d join private.world_reward_grants g using (reward_id)
  where d.reward_id in ('reward.event.mcm_2026_main_clear', 'reward.minigame.landlord_first_clear', 'reward.quest.first_campus')
  order by d.reward_id, g.position$$,
  $$values
    ('reward.event.mcm_2026_main_clear'::text, 'ACTIVE'::text, 'event.mcm_2026'::text, 'currency.induck_coin'::text, 'CURRENCY'::text, 'currency.induck_coin'::text, 80::bigint),
    ('reward.event.mcm_2026_main_clear', 'ACTIVE', 'event.mcm_2026', 'item.top.mcm_2026_survivor', 'ITEM', 'top.mcm_2026_survivor', 1),
    ('reward.event.mcm_2026_main_clear', 'ACTIVE', 'event.mcm_2026', 'item.furniture.mcm_2026_poster', 'ITEM', 'furniture.mcm_2026_poster', 1),
    ('reward.event.mcm_2026_main_clear', 'ACTIVE', 'event.mcm_2026', 'exp.campus', 'EXP', 'exp.campus', 150),
    ('reward.minigame.landlord_first_clear', 'ACTIVE', 'event.mcm_2026', 'item.badge.mcm_2026_landlord', 'ITEM', 'badge.mcm_2026_landlord', 1),
    ('reward.minigame.landlord_first_clear', 'ACTIVE', 'event.mcm_2026', 'exp.campus', 'EXP', 'exp.campus', 50),
    ('reward.quest.first_campus', 'ACTIVE', null, 'item.badge.main_gate', 'ITEM', 'badge.main_gate', 1),
    ('reward.quest.first_campus', 'ACTIVE', null, 'exp.campus', 'EXP', 'exp.campus', 100)$$,
  'the three first RewardDefinitions and their grants');
select throws_ok($$insert into private.world_reward_definitions(reward_id, status, description) values ('reward.quest.first_campus', 'ACTIVE', 'dup')$$,
  '23505', null, 'duplicate reward id is refused');
select throws_ok($$insert into private.world_reward_definitions(reward_id, status, description) values ('QUEST_FIRST', 'ACTIVE', 'x')$$,
  '23514', null, 'reward id must be lowercase reward.<domain>.<name>');
select throws_ok($$insert into private.world_reward_grants values ('reward.quest.first_campus', 'item.badge.main_gate', 5, 'ITEM', 'badge.campus_explorer', 1)$$,
  '23505', null, 'duplicate grant entry id is refused');
select throws_ok($$insert into private.world_reward_grants values ('reward.quest.first_campus', 'item.again', 6, 'ITEM', 'badge.main_gate', 1)$$,
  '23505', null, 'the same target twice in one reward is refused');
select throws_ok($$insert into private.world_reward_grants values ('reward.quest.first_campus', 'item.sword', 7, 'ITEM', 'weapon.sword', 1)$$,
  '23503', 'REWARD_UNKNOWN_ITEM', 'grant target must be a catalog item');
select throws_ok($$insert into private.world_reward_grants values ('reward.quest.first_campus', 'currency.gold', 8, 'CURRENCY', 'currency.gold', 10)$$,
  '23503', 'REWARD_UNKNOWN_CURRENCY', 'grant target must be a known currency');
select throws_ok($$insert into private.world_reward_grants values ('reward.quest.first_campus', 'item.two_caps', 9, 'ITEM', 'head.induck_cap', 2)$$,
  '23514', 'REWARD_INVALID_QUANTITY', 'a UNIQUE item is granted exactly once');
select throws_ok($$insert into private.world_reward_grants values ('reward.quest.first_campus', 'power', 10, 'STAT', 'attack', 1)$$,
  '23514', null, 'unknown grant type is refused');
select is(pg_get_function_identity_arguments('public.world_reward_grant_v1'::regproc),
  'p_user uuid, p_reward_id text, p_source_type text, p_source_id text, p_idempotency_key text',
  'callers pass who / which reward / verified source / key: never an amount, item or currency');

-- ---- authority ----
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_reward_definitions'::regclass, 'private.world_reward_grants'::regclass,
  'private.world_reward_transactions'::regclass, 'private.world_reward_transaction_entries'::regclass)),
  'reward tables have RLS');
select ok(not has_table_privilege(r, t, p), format('%s cannot %s %s', r, p, t))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.world_reward_definitions', 'private.world_reward_grants',
                  'private.world_reward_transactions', 'private.world_reward_transaction_entries']) t,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated']) r, unnest(array[
  'public.world_reward_grant_v1(uuid,text,text,text,text)',
  'public.world_reward_get_result_v1(text)',
  'private.world_reward_grant_v1(uuid,text,text,text,text)']) f;
select ok(has_function_privilege('service_role', f, 'execute'), format('service_role can execute %s', f))
from unnest(array['public.world_reward_grant_v1(uuid,text,text,text,text)', 'public.world_reward_get_result_v1(text)']) f;
select ok(not has_function_privilege('service_role', 'private.world_reward_grant_v1(uuid,text,text,text,text)', 'execute'),
  'the server goes through the public RPC');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a5000000-0000-4000-8000-0000000000a5","is_anonymous":false}';
select throws_ok($$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.event.mcm_2026_main_clear', 'EVENT', 'x', 'client-reward')$$,
  '42501', null, 'player cannot grant a reward');
select throws_ok($$select public.world_reward_get_result_v1('client-reward')$$, '42501', null, 'player cannot read reward records');
select throws_ok($$insert into private.world_reward_definitions(reward_id, status, description) values ('reward.client.free_money', 'ACTIVE', 'x')$$,
  '42501', null, 'player cannot create a definition');
select throws_ok($$update private.world_reward_grants set amount = 999999$$, '42501', null, 'player cannot change a reward amount');
select throws_ok($$insert into private.world_reward_transactions(user_id, reward_id, reward_version, source_type, source_id, idempotency_key, status, completed_at)
  values ('a5000000-0000-4000-8000-0000000000a5', 'reward.quest.first_campus', 1, 'QUEST', 'x', 'forged', 'SUCCESS', now())$$,
  '42501', null, 'player cannot forge a reward transaction');
select throws_ok($$update private.world_reward_transaction_entries set status = 'GRANTED'$$, '42501', null, 'player cannot forge an entry');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.quest.first_campus', 'QUEST', 'x', 'anon-reward')$$,
  '42501', null, 'guest cannot grant a reward');
reset role;

-- ---- fixtures: test-only definitions (rolled back with this test) ----
insert into private.world_reward_definitions(reward_id, status, description) values
  ('reward.test.coin_only', 'ACTIVE', 'coin only'),
  ('reward.test.disabled', 'DISABLED', 'disabled'),
  ('reward.test.empty', 'ACTIVE', 'empty'),
  ('reward.test.with_exp', 'ACTIVE', 'coin + exp'),
  ('reward.test.with_collection', 'ACTIVE', 'reserved collection');
insert into private.world_reward_grants values
  ('reward.test.coin_only', 'currency.induck_coin', 0, 'CURRENCY', 'currency.induck_coin', 80),
  ('reward.test.disabled', 'currency.induck_coin', 0, 'CURRENCY', 'currency.induck_coin', 5),
  ('reward.test.with_exp', 'currency.induck_coin', 0, 'CURRENCY', 'currency.induck_coin', 10),
  ('reward.test.with_exp', 'exp.campus', 1, 'EXP', 'exp.campus', 5),
  ('reward.test.with_collection', 'collection.test', 0, 'COLLECTION', 'collection.test', 1);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- ---- B. currency-only ----
select is((public.world_wallet_get_balance_v1('a5000000-0000-4000-8000-0000000000a5', 'currency.induck_coin')->>'balance')::bigint, 0::bigint, 'A starts at 0 coin');
select is(public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.test.coin_only', 'SYSTEM', 'test', 'p0c:a5:coin')->>'status',
  'SUCCESS', 'currency-only reward -> SUCCESS');
select is((public.world_wallet_get_balance_v1('a5000000-0000-4000-8000-0000000000a5', 'currency.induck_coin')->>'balance')::bigint, 80::bigint, 'wallet shows +80');

-- ---- B2. EXP adapter: Reward snapshot -> P0-F0 ledger / projection ----
select is((public.world_progression_get_v1('f5000000-0000-4000-8000-0000000000f5')->>'totalExp')::bigint,
  0::bigint, 'F starts at 0 EXP');
select results_eq($sql$select e->>'grantEntryId', e->>'grantType', e->>'status', (e->>'granted')::bigint, e->>'childIdempotencyKey'
  from jsonb_array_elements(public.world_reward_grant_v1(
    'f5000000-0000-4000-8000-0000000000f5', 'reward.test.with_exp', 'SYSTEM', 'p0f1',
    'p0f1:f5:coin-exp')->'entries') e$sql$,
  $expected$values
    ('currency.induck_coin'::text, 'CURRENCY'::text, 'GRANTED'::text, 10::bigint,
      'reward/p0f1:f5:coin-exp/currency.induck_coin'::text),
    ('exp.campus', 'EXP', 'GRANTED', 5,
      'reward/p0f1:f5:coin-exp/exp.campus')$expected$,
  'Reward executes currency + EXP with stable child keys');
select is((public.world_wallet_get_balance_v1('f5000000-0000-4000-8000-0000000000f5', 'currency.induck_coin')->>'balance')::bigint,
  10::bigint, 'P0-F1 sibling currency lands');
select is((public.world_progression_get_v1('f5000000-0000-4000-8000-0000000000f5')->>'totalExp')::bigint,
  5::bigint, 'P0-F1 EXP lands in the P0-F0 projection');
select is((public.world_progression_get_v1('f5000000-0000-4000-8000-0000000000f5')->>'level')::int,
  1, '5 EXP remains Lv1');
select is(public.world_reward_get_result_v1('p0f1:f5:coin-exp')->>'status',
  'SUCCESS', 'currency + EXP reward settles SUCCESS');
reset role;
select is((select count(*) from private.world_exp_transactions
  where user_id='f5000000-0000-4000-8000-0000000000f5'), 1::bigint,
  'Reward EXP creates exactly one P0-F0 ledger row');
select is((select amount from private.world_exp_transactions
  where user_id='f5000000-0000-4000-8000-0000000000f5'), 5::bigint,
  'EXP ledger records the RewardDefinition amount');
select is((select source_type from private.world_exp_transactions
  where user_id='f5000000-0000-4000-8000-0000000000f5'), 'reward',
  'EXP ledger provenance is reward');
select ok((select source_id like 'reward.test.with_exp:%:exp.campus'
  from private.world_exp_transactions where user_id='f5000000-0000-4000-8000-0000000000f5'),
  'EXP source points back to reward id / reward transaction / grant entry');
select is((select e.child_transaction_id
  from private.world_reward_transaction_entries e
  join private.world_reward_transactions t using (reward_transaction_id)
  where t.idempotency_key='p0f1:f5:coin-exp' and e.grant_type='EXP'),
  (select x.transaction_id::text from private.world_exp_transactions x
   where x.user_id='f5000000-0000-4000-8000-0000000000f5'),
  'Reward entry records the EXP transaction identity');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_reward_grant_v1(
  'f5000000-0000-4000-8000-0000000000f5', 'reward.test.with_exp', 'SYSTEM', 'p0f1',
  'p0f1:f5:coin-exp')->>'replayed', 'true', 'parent replay returns the stored EXP reward');
select is((public.world_progression_get_v1('f5000000-0000-4000-8000-0000000000f5')->>'totalExp')::bigint,
  5::bigint, 'parent replay moves no EXP');
reset role;
select is((select count(*) from private.world_exp_transactions
  where user_id='f5000000-0000-4000-8000-0000000000f5'), 1::bigint,
  'parent replay adds no EXP ledger row');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- ---- C. item-only ----
select is(public.world_inventory_has_item_v1('a5000000-0000-4000-8000-0000000000a5', 'badge.main_gate'), false, 'badge not owned yet');
select is(public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.quest.first_campus', 'QUEST', 'quest.first_campus', 'grant:quest.first_campus:a5')->>'status',
  'SUCCESS', 'item-only reward -> SUCCESS');
select is(public.world_inventory_has_item_v1('a5000000-0000-4000-8000-0000000000a5', 'badge.main_gate'), true, 'badge now owned');

-- ---- D. composite (fresh account B) ----
select results_eq($$select e->>'grantEntryId', e->>'status', (e->>'granted')::bigint, e->>'childIdempotencyKey'
  from jsonb_array_elements(public.world_reward_grant_v1('b5000000-0000-4000-8000-0000000000b5', 'reward.event.mcm_2026_main_clear',
    'EVENT', 'event.mcm_2026:main_clear', 'reward:event.mcm_2026:b5:main_clear')->'entries') e$$,
  $$values ('currency.induck_coin'::text, 'GRANTED'::text, 80::bigint, 'reward/reward:event.mcm_2026:b5:main_clear/currency.induck_coin'::text),
           ('item.top.mcm_2026_survivor', 'GRANTED', 1, 'reward/reward:event.mcm_2026:b5:main_clear/item.top.mcm_2026_survivor'),
           ('item.furniture.mcm_2026_poster', 'GRANTED', 1, 'reward/reward:event.mcm_2026:b5:main_clear/item.furniture.mcm_2026_poster'),
           ('exp.campus', 'GRANTED', 150, 'reward/reward:event.mcm_2026:b5:main_clear/exp.campus')$$,
  'composite reward grants coin + 2 items + EXP (P1b) with stable child keys');
select is(public.world_reward_get_result_v1('reward:event.mcm_2026:b5:main_clear')->>'status', 'SUCCESS', 'composite -> SUCCESS');
select is((public.world_wallet_get_balance_v1('b5000000-0000-4000-8000-0000000000b5', 'currency.induck_coin')->>'balance')::bigint, 80::bigint, 'B wallet 80');
select results_eq($$select x->>'itemId', x->>'sourceType', x->>'sourceRef', x->>'eventId'
  from jsonb_array_elements(public.world_inventory_list_v1('b5000000-0000-4000-8000-0000000000b5')->'items') x order by 1$$,
  $$values ('furniture.mcm_2026_poster'::text, 'EVENT'::text, 'reward.event.mcm_2026_main_clear'::text, 'event.mcm_2026'::text),
           ('top.mcm_2026_survivor', 'EVENT', 'reward.event.mcm_2026_main_clear', 'event.mcm_2026')$$,
  'items carry the reward as provenance');
reset role;
select is((select t.source_type || ':' || t.idempotency_key from private.world_currency_transactions t
           where t.user_id = 'b5000000-0000-4000-8000-0000000000b5'),
  'reward:reward/reward:event.mcm_2026:b5:main_clear/currency.induck_coin', 'the coin went through the P0-A ledger');
select is((select e.child_transaction_id from private.world_reward_transaction_entries e
           join private.world_reward_transactions t using (reward_transaction_id)
           where t.idempotency_key = 'reward:event.mcm_2026:b5:main_clear' and e.grant_entry_id = 'currency.induck_coin'),
  (select t.transaction_id::text from private.world_currency_transactions t where t.user_id = 'b5000000-0000-4000-8000-0000000000b5'),
  'the entry records the wallet transaction identity');

-- ---- E. duplicate UNIQUE -> PARTIAL_SUCCESS (A already owns the survivor top) ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_inventory_grant_item_v1('a5000000-0000-4000-8000-0000000000a5', 'top.mcm_2026_survivor', 1, 'SHOP', 'earlier', 'p0c:a5:earlier-top')->>'status',
  'GRANTED', 'A owned the survivor top before the reward');
select results_eq($$select e->>'grantEntryId', e->>'status', e->>'reason', (e->>'granted')::bigint
  from jsonb_array_elements(public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.event.mcm_2026_main_clear',
    'EVENT', 'event.mcm_2026:main_clear', 'reward:event.mcm_2026:a5:main_clear')->'entries') e$$,
  $$values ('currency.induck_coin'::text, 'GRANTED'::text, null::text, 80::bigint),
           ('item.top.mcm_2026_survivor', 'SKIPPED', 'ALREADY_OWNED', 0),
           ('item.furniture.mcm_2026_poster', 'GRANTED', null, 1),
           ('exp.campus', 'GRANTED', null, 150)$$,
  'coin granted, owned item SKIPPED / ALREADY_OWNED, sibling item and EXP granted');
select is(public.world_reward_get_result_v1('reward:event.mcm_2026:a5:main_clear')->>'status', 'PARTIAL_SUCCESS', 'reward -> PARTIAL_SUCCESS');
select is((public.world_wallet_get_balance_v1('a5000000-0000-4000-8000-0000000000a5', 'currency.induck_coin')->>'balance')::bigint,
  160::bigint, 'coin credited once (80 + 80), no refund for the duplicate item');
select is(public.world_inventory_get_item_v1('a5000000-0000-4000-8000-0000000000a5', 'top.mcm_2026_survivor')->'item'->>'sourceRef',
  'earlier', 'the earlier ownership and its provenance are untouched');

-- ---- F. parent idempotency ----
select is(public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.event.mcm_2026_main_clear',
    'EVENT', 'event.mcm_2026:main_clear', 'reward:event.mcm_2026:a5:main_clear')->>'replayed', 'true', 'same key -> stored result replayed');
select is(public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.event.mcm_2026_main_clear',
    'EVENT', 'event.mcm_2026:main_clear', 'reward:event.mcm_2026:a5:main_clear')->>'status', 'PARTIAL_SUCCESS', 'replay keeps the original status');
select is((public.world_wallet_get_balance_v1('a5000000-0000-4000-8000-0000000000a5', 'currency.induck_coin')->>'balance')::bigint,
  160::bigint, 'replays moved no coin');

-- ---- H. conflicts and preflight refusals (nothing written) ----
select throws_ok($$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.minigame.landlord_first_clear', 'EVENT', 'event.mcm_2026:main_clear', 'reward:event.mcm_2026:a5:main_clear')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'same key, different reward');
select throws_ok($$select public.world_reward_grant_v1('b5000000-0000-4000-8000-0000000000b5', 'reward.event.mcm_2026_main_clear', 'EVENT', 'event.mcm_2026:main_clear', 'reward:event.mcm_2026:a5:main_clear')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'same key, different user');
select throws_ok($$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.event.mcm_2026_main_clear', 'EVENT', 'other-source', 'reward:event.mcm_2026:a5:main_clear')$$,
  '23505', 'IDEMPOTENCY_CONFLICT', 'same key, different source');
select throws_ok($$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.quest.nope', 'QUEST', 'x', 'p0c:a5:unknown')$$,
  '22023', 'UNKNOWN_REWARD', 'unknown reward id');
select throws_ok($$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.test.disabled', 'SYSTEM', 'x', 'p0c:a5:disabled')$$,
  'P0001', 'REWARD_INACTIVE', 'inactive reward');
select throws_ok($$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.test.empty', 'SYSTEM', 'x', 'p0c:a5:empty')$$,
  'P0001', 'REWARD_EMPTY', 'reward without grants');
select throws_ok($sql$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.test.with_collection', 'SYSTEM', 'x', 'p0c:a5:collection')$sql$,
  'P0001', 'REWARD_UNSUPPORTED_GRANT', 'COLLECTION remains reserved and is refused before any value moves');
select throws_ok($$select public.world_reward_grant_v1('c5000000-0000-4000-8000-0000000000c5', 'reward.quest.first_campus', 'QUEST', 'x', 'p0c:c5:guest')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'guest');
select throws_ok($$select public.world_reward_grant_v1('d5000000-0000-4000-8000-0000000000d5', 'reward.quest.first_campus', 'QUEST', 'x', 'p0c:d5:banned')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'banned account');
select throws_ok($$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.quest.first_campus', 'SHOP', 'x', 'p0c:a5:shop')$$,
  '22023', 'INVALID_SOURCE', 'SHOP is not a reward source');
select throws_ok($$select public.world_reward_grant_v1('a5000000-0000-4000-8000-0000000000a5', 'reward.quest.first_campus', 'QUEST', 'x', null)$$,
  '22023', 'INVALID_IDEMPOTENCY_KEY', 'key is required');
select is((public.world_wallet_get_balance_v1('a5000000-0000-4000-8000-0000000000a5', 'currency.induck_coin')->>'balance')::bigint,
  160::bigint, 'refused rewards moved no coin');
reset role;
select is((select count(*) from private.world_reward_transactions where user_id in (
  'a5000000-0000-4000-8000-0000000000a5', 'c5000000-0000-4000-8000-0000000000c5', 'd5000000-0000-4000-8000-0000000000d5')),
  3::bigint, 'A has exactly 3 reward transactions; refusals and replays created none');

-- ---- I. adapter failure mid-reward, then resume ----
update private.world_item_catalog set status = 'DISABLED' where item_id = 'top.mcm_2026_survivor';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select results_eq($$select e->>'grantEntryId', e->>'status', e->>'reason'
  from jsonb_array_elements(public.world_reward_grant_v1('e5000000-0000-4000-8000-0000000000e5', 'reward.event.mcm_2026_main_clear',
    'EVENT', 'event.mcm_2026:main_clear', 'reward:event.mcm_2026:e5:main_clear')->'entries') e$$,
  $$values ('currency.induck_coin'::text, 'GRANTED'::text, null::text),
           ('item.top.mcm_2026_survivor', 'FAILED', 'ITEM_UNAVAILABLE'),
           ('item.furniture.mcm_2026_poster', 'GRANTED', null),
           ('exp.campus', 'GRANTED', null)$$,
  'the middle child fails; its siblings (EXP included) are granted and recorded');
select is(public.world_reward_get_result_v1('reward:event.mcm_2026:e5:main_clear')->>'status', 'FAILED', 'reward is FAILED (resumable)');
select is(public.world_inventory_has_item_v1('e5000000-0000-4000-8000-0000000000e5', 'top.mcm_2026_survivor'), false, 'failed child left no ownership');
reset role;
update private.world_item_catalog set status = 'COMING_SOON' where item_id = 'top.mcm_2026_survivor';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select results_eq($$select r->>'status', r->>'replayed', (r->>'attempts')::int
  from (select public.world_reward_grant_v1('e5000000-0000-4000-8000-0000000000e5', 'reward.event.mcm_2026_main_clear',
    'EVENT', 'event.mcm_2026:main_clear', 'reward:event.mcm_2026:e5:main_clear') r) s$$,
  $$values ('SUCCESS'::text, 'false'::text, 2)$$, 'retry with the same key resumes and completes');
select results_eq($$select e->>'grantEntryId', e->>'status', (e->>'attempts')::int
  from jsonb_array_elements(public.world_reward_get_result_v1('reward:event.mcm_2026:e5:main_clear')->'entries') e$$,
  $$values ('currency.induck_coin'::text, 'GRANTED'::text, 1), ('item.top.mcm_2026_survivor', 'GRANTED', 2),
           ('item.furniture.mcm_2026_poster', 'GRANTED', 1), ('exp.campus', 'GRANTED', 1)$$,
  'only the failed child ran again');
select is((public.world_wallet_get_balance_v1('e5000000-0000-4000-8000-0000000000e5', 'currency.induck_coin')->>'balance')::bigint,
  80::bigint, 'coin was not credited twice');
reset role;
select is((select count(*) from private.world_currency_transactions where user_id = 'e5000000-0000-4000-8000-0000000000e5'), 1::bigint, 'one ledger row');
select is((select count(*) from private.world_item_grants where user_id = 'e5000000-0000-4000-8000-0000000000e5'), 2::bigint,
  'one grant log row per item');
select is((select count(*) from private.world_reward_transactions where user_id = 'e5000000-0000-4000-8000-0000000000e5'), 1::bigint,
  'the resume reused the same reward transaction');

-- ---- final results are immutable ----
select throws_ok($$update private.world_reward_transaction_entries set reason = 'x' where status = 'GRANTED'$$,
  '42501', 'REWARD_RESULT_FINAL', 'granted entries never change');
select throws_ok($$update private.world_reward_transactions set status = 'FAILED', completed_at = null where status = 'SUCCESS'$$,
  '42501', 'REWARD_RESULT_FINAL', 'final reward transactions never change');
select is((select count(*) from private.world_reward_transactions where status = 'FAILED' and user_id in (
  'a5000000-0000-4000-8000-0000000000a5', 'b5000000-0000-4000-8000-0000000000b5', 'e5000000-0000-4000-8000-0000000000e5')),
  0::bigint, 'no reward is left unfinished');

select * from finish();
rollback;
