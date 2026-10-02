-- Progression Content P1b (20260929020000): first production EXP balance.
-- first_campus +100, landlord first clear +50, MCM main clear +150 through the unchanged
-- Reward → P0-F1 adapter → private.world_exp_apply_v1 → EXP ledger → derived Level path, the
-- Level-gated Shop at Lv.1 / Lv.2 / Lv.3, and the no-retroactive-EXP snapshot invariant.
-- Concurrent retries of the production rewards live in supabase/tests/integration/mcm-completion.integration.test.mjs (P1b section).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a9100000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'p1b-a@example.test', now(), false),
 ('a9100000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'p1b-b@example.test', now(), false),
 ('a9100000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'p1b-c@example.test', now(), false),
 ('a9100000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'p1b-d@example.test', now(), false),
 ('a9100000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'p1b-e@example.test', now(), false),
 ('a9100000-0000-4000-8000-0000000000f6', 'authenticated', 'authenticated', 'p1b-f@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a9100000-0000-4000-8000-0000000000a1', '성장A', false),
 ('a9100000-0000-4000-8000-0000000000b2', '성장B', false),
 ('a9100000-0000-4000-8000-0000000000c3', '성장C', false),
 ('a9100000-0000-4000-8000-0000000000d4', '성장D', false),
 ('a9100000-0000-4000-8000-0000000000e5', '성장E', false),
 ('a9100000-0000-4000-8000-0000000000f6', '성장F', false);

update private.world_events set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour'
 where event_id = 'event.mcm_2026';

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
-- The player claim RPCs, called as the player (no arguments; claimant = auth.uid()).
create function pg_temp.claim(p uuid, kind text) returns jsonb language plpgsql as $f$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', p, 'is_anonymous', false)::text, true);
  if kind = 'landlord' then v := public.claim_my_mcm_landlord_first_clear_reward_v1();
  else v := public.claim_my_mcm_2026_main_reward_v1(); end if;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$f$;
-- first_campus has no player-facing claim yet (P1c): the service-role Reward entry point runs it.
create function pg_temp.first_campus(p uuid) returns jsonb language plpgsql as $f$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v := public.world_reward_grant_v1(p, 'reward.quest.first_campus', 'QUEST', 'quest.first_campus',
    'grant:quest.first_campus:' || p::text);
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$f$;
create function pg_temp.prog(p uuid) returns text language sql as $f$
  select (s ->> 'totalExp') || '/Lv.' || (s ->> 'level')
    from (select private.world_progression_snapshot_v1(p) s) x;
$f$;
create function pg_temp.exp_rows(p uuid) returns bigint language sql as $f$
  select count(*) from private.world_exp_transactions t where t.user_id = p;
$f$;
create function pg_temp.exp_line(r jsonb) returns text language sql as $f$
  select string_agg(e ->> 'targetId' || ':' || (e ->> 'status') || ':' || (e ->> 'granted'), ',')
    from jsonb_array_elements(r -> 'rewardResult' -> 'entries') e where e ->> 'grantType' = 'EXP';
$f$;
-- Shop view as the player: "listing=reason" for the level-gated offers (reason '' = purchasable).
create function pg_temp.shop(p uuid) returns text language plpgsql as $f$
declare
  v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', p, 'is_anonymous', false)::text, true);
  select string_agg(o ->> 'itemId' || '=' || coalesce(o ->> 'unavailableReason', ''), ',' order by o ->> 'itemId')
    into v
    from (select jsonb_array_elements(public.get_world_shop_v1('shop.student_center') -> 'offers') o
          union all
          select jsonb_array_elements(public.get_world_shop_v1('shop.dorm_furniture') -> 'offers')) x
   where (o ->> 'requiredLevel')::int in (2, 3);
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$f$;

-- ---- 1-7. definitions ----
select results_eq($$
  select g.reward_id, g.position, g.grant_entry_id, g.grant_type, g.target_id, g.amount
    from private.world_reward_grants g where g.grant_type = 'EXP' and g.reward_id in ('reward.event.mcm_2026_main_clear', 'reward.minigame.landlord_first_clear', 'reward.quest.first_campus') order by g.reward_id$$,
  $$values ('reward.event.mcm_2026_main_clear'::text, 3::smallint, 'exp.campus'::text, 'EXP'::text, 'exp.campus'::text, 150::bigint),
           ('reward.minigame.landlord_first_clear', 1::smallint, 'exp.campus', 'EXP', 'exp.campus', 50),
           ('reward.quest.first_campus', 1::smallint, 'exp.campus', 'EXP', 'exp.campus', 100)$$,
  'approved EXP grants: main 150 / landlord 50 / first_campus 100, grant/target exp.campus, one per reward');
select is((select bool_and(g.position = (select max(o.position) from private.world_reward_grants o where o.reward_id = g.reward_id))
             from private.world_reward_grants g where g.grant_type = 'EXP'),
  true, 'each EXP grant sits after every existing grant');
select results_eq($$
  select d.reward_id, d.status, d.version from private.world_reward_definitions d where d.reward_id in ('reward.event.mcm_2026_main_clear', 'reward.minigame.landlord_first_clear', 'reward.quest.first_campus') order by d.reward_id$$,
  $$values ('reward.event.mcm_2026_main_clear'::text, 'ACTIVE'::text, 2),
           ('reward.minigame.landlord_first_clear', 'ACTIVE', 2), ('reward.quest.first_campus', 'ACTIVE', 2)$$,
  'the changed definitions are version 2 and stay ACTIVE');
select results_eq($$
  select g.reward_id, g.position, g.grant_entry_id, g.grant_type, g.target_id, g.amount
    from private.world_reward_grants g where g.grant_type <> 'EXP' and g.reward_id in ('reward.event.mcm_2026_main_clear', 'reward.minigame.landlord_first_clear', 'reward.quest.first_campus') order by g.reward_id, g.position$$,
  $$values ('reward.event.mcm_2026_main_clear'::text, 0::smallint, 'currency.induck_coin'::text, 'CURRENCY'::text, 'currency.induck_coin'::text, 80::bigint),
           ('reward.event.mcm_2026_main_clear', 1::smallint, 'item.top.mcm_2026_survivor', 'ITEM', 'top.mcm_2026_survivor', 1),
           ('reward.event.mcm_2026_main_clear', 2::smallint, 'item.furniture.mcm_2026_poster', 'ITEM', 'furniture.mcm_2026_poster', 1),
           ('reward.minigame.landlord_first_clear', 0::smallint, 'item.badge.mcm_2026_landlord', 'ITEM', 'badge.mcm_2026_landlord', 1),
           ('reward.quest.first_campus', 0::smallint, 'item.badge.main_gate', 'ITEM', 'badge.main_gate', 1)$$,
  'existing coin / item grants are unchanged');
select results_eq($$select level, min_total_exp from private.world_level_thresholds order by level$$,
  $$values (1, 0::bigint), (2, 100::bigint), (3, 300::bigint), (4, 600::bigint), (5, 1000::bigint),
           (6, 1500::bigint), (7, 2100::bigint), (8, 2800::bigint), (9, 3600::bigint), (10, 4500::bigint)$$,
  'Level thresholds unchanged');
select results_eq($$select listing_id, required_level from private.world_shop_listings
    where required_level in (2, 3) order by listing_id$$,
  $$values ('offer.dorm_furniture.campus_rug_blue'::text, 3), ('offer.dorm_furniture.dorm_desk_lamp', 2),
           ('offer.dorm_furniture.induck_chair', 3), ('offer.student_center.campus_map_poster', 2),
           ('offer.student_center.campus_sneakers', 2), ('offer.student_center.induck_backpack', 3),
           ('offer.student_center.induck_hoodie', 2)$$,
  'Shop required levels unchanged');

-- ---- 8, 16, 20. first_campus: 0 → 100 = Lv.2 unlocks the Lv.2 offers ----
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000a1'), '0/Lv.1', 'A starts at 0 EXP / Lv.1');
select is(pg_temp.shop('a9100000-0000-4000-8000-0000000000a1'),
  'back.induck_backpack=LEVEL_REQUIRED,furniture.campus_map_poster=LEVEL_REQUIRED,furniture.campus_rug_blue=LEVEL_REQUIRED,'
  'furniture.dorm_desk_lamp=LEVEL_REQUIRED,furniture.induck_chair=LEVEL_REQUIRED,shoes.campus_sneakers=LEVEL_REQUIRED,top.induck_hoodie=LEVEL_REQUIRED',
  'Lv.1: every Lv.2 / Lv.3 offer is LEVEL_REQUIRED');
select set_config('test.a_first', pg_temp.first_campus('a9100000-0000-4000-8000-0000000000a1')::text, true);
select results_eq($$select r->>'status', (r->>'rewardVersion')::int from (select current_setting('test.a_first')::jsonb r) x$$,
  $$values ('SUCCESS'::text, 2)$$, 'first_campus runs as a version 2 reward');
select results_eq($$select e->>'grantEntryId', e->>'grantType', e->>'status', (e->>'granted')::bigint
    from jsonb_array_elements(current_setting('test.a_first')::jsonb->'entries') e$$,
  $$values ('item.badge.main_gate'::text, 'ITEM'::text, 'GRANTED'::text, 1::bigint), ('exp.campus', 'EXP', 'GRANTED', 100)$$,
  'first_campus grants the badge and +100 EXP');
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000a1'), '100/Lv.2', 'A: 0 → 100 EXP = Lv.2');
select is(pg_temp.shop('a9100000-0000-4000-8000-0000000000a1'),
  'back.induck_backpack=LEVEL_REQUIRED,furniture.campus_map_poster=,furniture.campus_rug_blue=LEVEL_REQUIRED,'
  'furniture.dorm_desk_lamp=,furniture.induck_chair=LEVEL_REQUIRED,shoes.campus_sneakers=,top.induck_hoodie=',
  'Lv.2: the four Lv.2 offers unlock; the Lv.3 offers stay LEVEL_REQUIRED');

-- ---- 9, 17, 24. landlord claim: 100 → 150 stays Lv.2 ----
select pg_temp.complete_mcm('a9100000-0000-4000-8000-0000000000a1');
select set_config('test.a_land', pg_temp.claim('a9100000-0000-4000-8000-0000000000a1', 'landlord')::text, true);
select results_eq($$select r->>'status', r->>'rewardStatus', (r->>'replayed')::boolean from (select current_setting('test.a_land')::jsonb r) x$$,
  $$values ('CLAIMED'::text, 'SUCCESS'::text, false)$$, 'landlord first clear claimed');
select results_eq($$select e->>'targetId', e->>'grantType', e->>'status', (e->>'granted')::bigint
    from jsonb_array_elements(current_setting('test.a_land')::jsonb->'rewardResult'->'entries') e$$,
  $$values ('badge.mcm_2026_landlord'::text, 'ITEM'::text, 'GRANTED'::text, 1::bigint), ('exp.campus', 'EXP', 'GRANTED', 50)$$,
  'the player landlord claim returns the badge and EXP 50');
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000a1'), '150/Lv.2', 'A: 100 → 150 EXP stays Lv.2');

-- ---- 10, 18, 21, 25. main clear claim: 150 → 300 = Lv.3 unlocks the Lv.3 offers ----
select set_config('test.a_main', pg_temp.claim('a9100000-0000-4000-8000-0000000000a1', 'main')::text, true);
select results_eq($$select e->>'targetId', e->>'grantType', e->>'status', (e->>'granted')::bigint
    from jsonb_array_elements(current_setting('test.a_main')::jsonb->'rewardResult'->'entries') e$$,
  $$values ('currency.induck_coin'::text, 'CURRENCY'::text, 'GRANTED'::text, 80::bigint),
           ('top.mcm_2026_survivor', 'ITEM', 'GRANTED', 1), ('furniture.mcm_2026_poster', 'ITEM', 'GRANTED', 1),
           ('exp.campus', 'EXP', 'GRANTED', 150)$$,
  'the player main claim returns +80 coin, survivor top, poster and EXP 150');
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000a1'), '300/Lv.3', 'A: 150 → 300 EXP = Lv.3');
select is(pg_temp.shop('a9100000-0000-4000-8000-0000000000a1'),
  'back.induck_backpack=,furniture.campus_map_poster=,furniture.campus_rug_blue=,furniture.dorm_desk_lamp=,'
  'furniture.induck_chair=,shoes.campus_sneakers=,top.induck_hoodie=',
  'Lv.3: Lv.2 and Lv.3 offers are all purchasable');
select is((select balance from private.world_wallets where user_id = 'a9100000-0000-4000-8000-0000000000a1'
            and currency_id = 'currency.induck_coin'), 80::bigint, 'wallet: exactly the unchanged +80 coin');
select is((select array_agg(item_id order by item_id) from private.world_player_items
            where user_id = 'a9100000-0000-4000-8000-0000000000a1'),
  array['badge.main_gate', 'badge.mcm_2026_landlord', 'furniture.mcm_2026_poster', 'top.mcm_2026_survivor'],
  'inventory: exactly the unchanged item grants');

-- ---- 11, 22. replay moves no EXP and no Shop state ----
select is(pg_temp.claim('a9100000-0000-4000-8000-0000000000a1', 'landlord') ->> 'status', 'ALREADY_CLAIMED', 'landlord replay');
select is(pg_temp.claim('a9100000-0000-4000-8000-0000000000a1', 'main') ->> 'status', 'ALREADY_CLAIMED', 'main replay');
select is(pg_temp.exp_line(pg_temp.claim('a9100000-0000-4000-8000-0000000000a1', 'main')), 'exp.campus:GRANTED:150',
  'the replay shows the stored settlement (EXP 150, already granted)');
select is((pg_temp.first_campus('a9100000-0000-4000-8000-0000000000a1') ->> 'replayed')::boolean, true, 'first_campus replay');
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000a1'), '300/Lv.3', 'replays moved 0 EXP');
select is(pg_temp.exp_rows('a9100000-0000-4000-8000-0000000000a1'), 3::bigint, 'three EXP ledger rows, one per reward');
select is(pg_temp.shop('a9100000-0000-4000-8000-0000000000a1'),
  'back.induck_backpack=,furniture.campus_map_poster=,furniture.campus_rug_blue=,furniture.dorm_desk_lamp=,'
  'furniture.induck_chair=,shoes.campus_sneakers=,top.induck_hoodie=', 'replays did not change the Shop view');

-- ---- 13. provenance ----
select results_eq($$
  select t.amount, t.source_type,
         t.source_id = r.reward_id || ':' || r.reward_transaction_id::text || ':exp.campus',
         t.idempotency_key = 'reward/' || r.idempotency_key || '/exp.campus',
         t.exp_before, t.exp_after, t.level_before, t.level_after
    from private.world_exp_transactions t
    join private.world_reward_transactions r on r.user_id = t.user_id
     and t.source_id like r.reward_id || ':%'
   where t.user_id = 'a9100000-0000-4000-8000-0000000000a1' order by t.exp_after$$,
  $$values (100::bigint, 'reward'::text, true, true, 0::bigint, 100::bigint, 1, 2),
           (50::bigint, 'reward', true, true, 100::bigint, 150::bigint, 2, 2),
           (150::bigint, 'reward', true, true, 150::bigint, 300::bigint, 2, 3)$$,
  'ledger rows: source reward, <rewardId>:<txId>:exp.campus, reward/<parent key>/exp.campus, Level derived');
select results_eq($$select e.child_transaction_id::uuid = t.transaction_id
    from private.world_reward_transaction_entries e
    join private.world_reward_transactions r using (reward_transaction_id)
    join private.world_exp_transactions t on t.idempotency_key = e.child_idempotency_key
   where r.user_id = 'a9100000-0000-4000-8000-0000000000a1' and e.grant_type = 'EXP'$$,
  $$values (true), (true), (true)$$, 'each EXP entry records its EXP ledger transaction id');

-- ---- 9 alone, 19 order independence ----
select pg_temp.complete_mcm('a9100000-0000-4000-8000-0000000000b2');
select is(pg_temp.exp_line(pg_temp.claim('a9100000-0000-4000-8000-0000000000b2', 'landlord')), 'exp.campus:GRANTED:50', 'B: landlord EXP 50');
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000b2'), '50/Lv.1', 'B: 0 → 50 EXP stays Lv.1');

select pg_temp.complete_mcm('a9100000-0000-4000-8000-0000000000c3');
select is(pg_temp.exp_line(pg_temp.claim('a9100000-0000-4000-8000-0000000000c3', 'main')), 'exp.campus:GRANTED:150', 'C: main first');
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000c3'), '150/Lv.2', 'C: main 150 = Lv.2');
do $$ begin perform pg_temp.claim('a9100000-0000-4000-8000-0000000000c3', 'landlord'); end $$;
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000c3'), '200/Lv.2', 'C: + landlord 50 = 200 Lv.2');
do $$ begin perform pg_temp.first_campus('a9100000-0000-4000-8000-0000000000c3'); end $$;
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000c3'), '300/Lv.3', 'C: + first_campus 100 = 300 Lv.3 (order independent)');

-- ---- 14. account isolation ----
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000e5'), '0/Lv.1', 'E (no rewards) is untouched');
select is(pg_temp.exp_rows('a9100000-0000-4000-8000-0000000000e5'), 0::bigint, 'E has no EXP ledger rows');

-- ---- 23. snapshot invariant: a v1 transaction never gains the new EXP ----
-- Recreate the pre-P1b definition inside this test transaction, run D's main clear as v1, then
-- restore the P1b definition exactly as the migration left it.
create temp table p1b_saved as select * from private.world_reward_grants
 where reward_id = 'reward.event.mcm_2026_main_clear' and grant_type = 'EXP';
delete from private.world_reward_grants where reward_id = 'reward.event.mcm_2026_main_clear' and grant_type = 'EXP';
update private.world_reward_definitions set version = 1 where reward_id = 'reward.event.mcm_2026_main_clear';
select pg_temp.complete_mcm('a9100000-0000-4000-8000-0000000000d4');
select set_config('test.d_v1', pg_temp.claim('a9100000-0000-4000-8000-0000000000d4', 'main')::text, true);
insert into private.world_reward_grants select * from p1b_saved;
update private.world_reward_definitions set version = 2 where reward_id = 'reward.event.mcm_2026_main_clear';
select results_eq($$select r->>'status', r->>'rewardStatus', jsonb_array_length(r->'rewardResult'->'entries')
    from (select current_setting('test.d_v1')::jsonb r) x$$,
  $$values ('CLAIMED'::text, 'SUCCESS'::text, 3)$$, 'D completed main clear on the v1 definition (coin + 2 items)');
select results_eq($$select r->>'status', pg_temp.exp_line(r)
    from (select pg_temp.claim('a9100000-0000-4000-8000-0000000000d4', 'main') r) x$$,
  $$values ('ALREADY_CLAIMED'::text, null::text)$$, 'after P1b the v1 claim replays its stored result without EXP');
select is((select reward_version from private.world_reward_transactions
            where idempotency_key = 'event:mcm_2026:a9100000-0000-4000-8000-0000000000d4:main_clear'), 1,
  'the stored transaction keeps reward_version 1');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select results_eq($$select r->>'status', (r->>'replayed')::boolean, (r->>'rewardVersion')::int, jsonb_array_length(r->'entries')
    from (select public.world_reward_grant_v1('a9100000-0000-4000-8000-0000000000d4', 'reward.event.mcm_2026_main_clear',
      'EVENT', 'event.mcm_2026:main_clear', 'event:mcm_2026:a9100000-0000-4000-8000-0000000000d4:main_clear') r) x$$,
  $$values ('SUCCESS'::text, true, 1, 3)$$, 'the same idempotency key at the Reward core replays v1 (3 entries)');
reset role;
select is(pg_temp.exp_rows('a9100000-0000-4000-8000-0000000000d4'), 0::bigint, 'no EXP ledger row for the v1 transaction');
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000d4'), '0/Lv.1', 'D gained no retroactive EXP');

-- A FAILED v1 transaction resumes from its own v1 snapshot: it finishes without an EXP entry.
delete from private.world_reward_grants where reward_id = 'reward.event.mcm_2026_main_clear' and grant_type = 'EXP';
update private.world_reward_definitions set version = 1 where reward_id = 'reward.event.mcm_2026_main_clear';
update private.world_item_catalog set status = 'DISABLED' where item_id = 'furniture.mcm_2026_poster';
select pg_temp.complete_mcm('a9100000-0000-4000-8000-0000000000f6');
select is(pg_temp.claim('a9100000-0000-4000-8000-0000000000f6', 'main') ->> 'status', 'REWARD_FAILED', 'F: v1 main clear FAILED (poster child)');
insert into private.world_reward_grants select * from p1b_saved;
update private.world_reward_definitions set version = 2 where reward_id = 'reward.event.mcm_2026_main_clear';
update private.world_item_catalog set status = 'COMING_SOON' where item_id = 'furniture.mcm_2026_poster';
select set_config('test.f_resume', pg_temp.claim('a9100000-0000-4000-8000-0000000000f6', 'main')::text, true);
select results_eq($$select r->>'status', r->>'rewardStatus', jsonb_array_length(r->'rewardResult'->'entries'), pg_temp.exp_line(r)
    from (select current_setting('test.f_resume')::jsonb r) x$$,
  $$values ('CLAIMED'::text, 'SUCCESS'::text, 3, null::text)$$, 'F: the resume completes the v1 snapshot, no EXP entry appended');
select is(pg_temp.exp_rows('a9100000-0000-4000-8000-0000000000f6'), 0::bigint, 'F: no EXP ledger row');
select is((select count(*) from private.world_currency_transactions where user_id = 'a9100000-0000-4000-8000-0000000000f6'),
  1::bigint, 'F: the coin granted before the failure was not credited again');

-- ---- 15. v2 failed child resume: EXP settles once, siblings unchanged ----
update private.world_item_catalog set status = 'DISABLED' where item_id = 'furniture.mcm_2026_poster';
select pg_temp.complete_mcm('a9100000-0000-4000-8000-0000000000e5');
select is(pg_temp.claim('a9100000-0000-4000-8000-0000000000e5', 'main') ->> 'status', 'REWARD_FAILED', 'E: v2 main clear FAILED (poster child)');
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000e5'), '150/Lv.2', 'E: the EXP sibling committed');
update private.world_item_catalog set status = 'COMING_SOON' where item_id = 'furniture.mcm_2026_poster';
select set_config('test.e_resume', pg_temp.claim('a9100000-0000-4000-8000-0000000000e5', 'main')::text, true);
select results_eq($$select e->>'targetId', e->>'status' from jsonb_array_elements(current_setting('test.e_resume')::jsonb->'rewardResult'->'entries') e$$,
  $$values ('currency.induck_coin'::text, 'GRANTED'::text), ('top.mcm_2026_survivor', 'GRANTED'),
           ('furniture.mcm_2026_poster', 'GRANTED'), ('exp.campus', 'GRANTED')$$, 'E: resume completes every entry');
select is(pg_temp.prog('a9100000-0000-4000-8000-0000000000e5'), '150/Lv.2', 'E: the resume moved no further EXP');
select is(pg_temp.exp_rows('a9100000-0000-4000-8000-0000000000e5'), 1::bigint, 'E: one EXP ledger row');
select is((select count(*) from private.world_currency_transactions where user_id = 'a9100000-0000-4000-8000-0000000000e5'),
  1::bigint, 'E: one coin ledger row');

select * from finish();
rollback;
