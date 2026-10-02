-- Economy/Collection P0-B: Item Catalog mirror + Ownership (20260927110000). UNIQUE and STACKABLE
-- grants, provenance, idempotency, unknown/disabled safety, guests and the client/server boundary.
-- Concurrency, cross-connection readback and the code-catalog sync live in
-- supabase/tests/integration/inventory.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a4000000-0000-4000-8000-0000000000a4', 'authenticated', 'authenticated', 'inv-a@example.test', now(), false),
 ('b4000000-0000-4000-8000-0000000000b4', 'authenticated', 'authenticated', 'inv-b@example.test', now(), false),
 ('c4000000-0000-4000-8000-0000000000c4', 'authenticated', 'authenticated', null, null, true),
 ('d4000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'inv-d@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a4000000-0000-4000-8000-0000000000a4', '가방A', false),
 ('b4000000-0000-4000-8000-0000000000b4', '가방B', false),
 ('c4000000-0000-4000-8000-0000000000c4', '가방게스트', false),
 ('d4000000-0000-4000-8000-0000000000d4', '가방정지', true);

-- ---- catalog mirror ----
select has_table('private', 'world_item_catalog', 'catalog mirror exists');
select has_table('private', 'world_player_items', 'ownership table exists');
select has_table('private', 'world_item_grants', 'grant log exists');
select col_is_pk('private', 'world_item_catalog', array['item_id'], 'item ids are unique');
select col_is_unique('private', 'world_player_items', array['user_id', 'item_id'], 'one ownership row per (user, item)');
select col_is_pk('private', 'world_item_grants', array['grant_id'], 'a grant key is used once');
select is((select count(*) from private.world_item_catalog), 29::bigint, '6 pilot fixtures + Starter Catalog 20 + Life M1 materials 3');
select is(
  array(select item_id from private.world_item_catalog where item_id = any(array[
    'top.induck_hoodie', 'head.induck_cap', 'furniture.induck_cushion', 'furniture.campus_map_poster',
    'badge.campus_first_step', 'badge.mcm_2026_landlord', 'top.mcm_2026_survivor', 'furniture.mcm_2026_poster'])
    order by item_id),
  array['badge.campus_first_step', 'badge.mcm_2026_landlord', 'furniture.campus_map_poster', 'furniture.induck_cushion',
        'furniture.mcm_2026_poster', 'head.induck_cap', 'top.induck_hoodie', 'top.mcm_2026_survivor'],
  'the 8 vertical slice items are in the catalog');
select results_eq($$select item_id, status from private.world_item_catalog
  where item_id in ('head.inha_cap', 'head.inkyung_duck', 'top.inha_basic', 'back.freshman_bag', 'badge.main_gate', 'emote.wave_plus')
  order by item_id$$,
  $$values ('back.freshman_bag'::text, 'ACTIVE'::text), ('badge.main_gate', 'COMING_SOON'), ('emote.wave_plus', 'COMING_SOON'),
           ('head.inha_cap', 'ACTIVE'), ('head.inkyung_duck', 'COMING_SOON'), ('top.inha_basic', 'ACTIVE')$$,
  'pilot fixtures are kept with their C0 statuses');
select results_eq($$select item_id, category, ownership_policy, max_stack, status
  from private.world_item_catalog where item_id like 'material.%' order by item_id$$,
  $$values
    ('material.artifact_fragment_01'::text, 'MATERIAL'::text, 'STACKABLE'::text, 99, 'ACTIVE'::text),
    ('material.campus_leaf', 'MATERIAL', 'STACKABLE', 99, 'ACTIVE'),
    ('material.fish_carp', 'MATERIAL', 'STACKABLE', 99, 'ACTIVE')$$,
  'Life M1 materials are real stackable catalog entries');
select throws_ok($$insert into private.world_item_catalog values ('head.inha_cap', 'WEARABLE', 'UNIQUE', null, 'ACTIVE')$$,
  '23505', null, 'duplicate item id is refused');
select throws_ok($$insert into private.world_item_catalog values ('COSMETIC_INDUCK_HOODIE', 'WEARABLE', 'UNIQUE', null, 'ACTIVE')$$,
  '23514', null, 'uppercase id scheme is refused');
select throws_ok($$insert into private.world_item_catalog values ('weapon.sword', 'WEAPON', 'UNIQUE', null, 'ACTIVE')$$,
  '23514', null, 'unknown category is refused');
select throws_ok($$insert into private.world_item_catalog values ('memorabilia.bad_stack', 'MEMORABILIA', 'UNIQUE', 5, 'ACTIVE')$$,
  '23514', null, 'UNIQUE items have no max stack');
select hasnt_column('private', 'world_item_catalog', 'price', 'catalog carries no price');
select hasnt_column('private', 'world_player_items', 'position', 'ownership carries no room placement');
select ok(not exists (
  select 1 from pg_constraint where conrelid = 'private.world_player_items'::regclass and contype = 'f'
    and confrelid = 'private.world_item_catalog'::regclass),
  'ownership has no FK to the catalog, so catalog drift cannot delete it');

-- ---- authority ----
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_item_catalog'::regclass, 'private.world_player_items'::regclass, 'private.world_item_grants'::regclass)),
  'inventory tables have RLS');
select ok(not has_table_privilege(r, t, p), format('%s cannot %s %s', r, p, t))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.world_player_items', 'private.world_item_grants', 'private.world_item_catalog']) t,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated']) r, unnest(array[
  'public.world_inventory_grant_item_v1(uuid,text,integer,text,text,text,text,jsonb)',
  'public.world_inventory_ensure_default_items_v1(uuid)',
  'public.world_inventory_list_v1(uuid)',
  'public.world_inventory_get_item_v1(uuid,text)',
  'public.world_inventory_has_item_v1(uuid,text)',
  'private.world_inventory_grant_v1(uuid,text,integer,text,text,text,text,jsonb)']) f;
select ok(has_function_privilege('service_role', f, 'execute'), format('service_role can execute %s', f))
from unnest(array[
  'public.world_inventory_grant_item_v1(uuid,text,integer,text,text,text,text,jsonb)',
  'public.world_inventory_ensure_default_items_v1(uuid)',
  'public.world_inventory_list_v1(uuid)',
  'public.world_inventory_get_item_v1(uuid,text)',
  'public.world_inventory_has_item_v1(uuid,text)']) f;
select ok(not has_function_privilege('service_role', 'private.world_inventory_grant_v1(uuid,text,integer,text,text,text,text,jsonb)', 'execute'),
  'even the server grants through the public RPC, not the internal path');
select ok(has_function_privilege('authenticated', 'public.get_my_world_inventory_v1()', 'execute'), 'player can read own inventory');
select ok(not has_function_privilege('anon', 'public.get_my_world_inventory_v1()', 'execute'), 'guest has no inventory read');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a4000000-0000-4000-8000-0000000000a4","is_anonymous":false}';
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap', 1, 'SHOP', 'client', 'client-grant')$$,
  '42501', null, 'player cannot call grantItem');
select throws_ok($$select public.world_inventory_ensure_default_items_v1('a4000000-0000-4000-8000-0000000000a4')$$,
  '42501', null, 'player cannot trigger default grants');
select throws_ok($$insert into private.world_player_items(user_id, item_id, quantity, source_type, source_ref, grant_id)
  values ('a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap', 1, 'SHOP', 'forged', 'forged')$$,
  '42501', null, 'player cannot INSERT ownership');
select throws_ok($$update private.world_player_items set quantity = 99$$, '42501', null, 'player cannot change quantity');
select throws_ok($$update private.world_player_items set source_type = 'ADMIN'$$, '42501', null, 'player cannot change provenance');
select throws_ok($$delete from private.world_player_items$$, '42501', null, 'player cannot DELETE ownership');
select throws_ok($$insert into private.world_item_grants(grant_id, user_id, item_id, result, quantity_requested, quantity_before, quantity_granted, quantity_after, source_type, source_ref)
  values ('forged', 'a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap', 'GRANTED', 1, 0, 1, 1, 'SHOP', 'x')$$,
  '42501', null, 'player cannot forge a grant record');
select throws_ok($$update private.world_item_catalog set status = 'ACTIVE'$$, '42501', null, 'player cannot edit the catalog');
select throws_ok($$select * from private.world_player_items$$, '42501', null, 'player cannot read raw ownership');
select throws_ok($$select public.world_inventory_list_v1('b4000000-0000-4000-8000-0000000000b4')$$,
  '42501', null, 'player cannot list another inventory through the server API');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.get_my_world_inventory_v1()$$, '42501', null, 'guest cannot read an inventory');
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap', 1, 'SHOP', 'anon', 'anon-grant')$$,
  '42501', null, 'guest cannot grant');
reset role;

-- ---- UNIQUE grant, provenance, duplicate safety, idempotency: the 8 vertical slice items ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_inventory_has_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap'), false, 'nothing owned yet');
select is(public.world_inventory_get_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap')->>'owned', 'false',
  'getOwnedItem reports not owned');

select is(public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', v.item_id, 1, v.source_type, v.source_ref,
  'p0b-test:a4:' || v.item_id, v.event_id, v.meta)->>'status', 'GRANTED', format('first grant of %s -> GRANTED', v.item_id))
from (values
  ('top.induck_hoodie', 'SHOP', 'shop.campus.basic', null, null::jsonb),
  ('head.induck_cap', 'SHOP', 'shop.campus.basic', null, null),
  ('furniture.induck_cushion', 'SHOP', 'shop.dorm.furniture', null, null),
  ('furniture.campus_map_poster', 'SHOP', 'shop.campus.basic', null, null),
  ('badge.campus_first_step', 'QUEST', 'quest.first_campus', null, null),
  ('badge.mcm_2026_landlord', 'MINIGAME', 'minigame.landlord:first_clear', 'event.mcm_2026', '{"label":"2026 문콘경 일일호프"}'),
  ('top.mcm_2026_survivor', 'EVENT', 'quest.mcm_2026_core', 'event.mcm_2026', null),
  ('furniture.mcm_2026_poster', 'EVENT', 'event.mcm_2026:complete', 'event.mcm_2026', null)
) as v(item_id, source_type, source_ref, event_id, meta);

select is(public.world_inventory_has_item_v1('a4000000-0000-4000-8000-0000000000a4', item_id), true, format('hasItem %s', item_id))
from unnest(array['top.induck_hoodie', 'head.induck_cap', 'furniture.induck_cushion', 'furniture.campus_map_poster',
  'badge.campus_first_step', 'badge.mcm_2026_landlord', 'top.mcm_2026_survivor', 'furniture.mcm_2026_poster']) item_id;

select is(public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap', 1, 'QUEST', 'quest.other',
  'p0b-test:a4:head.induck_cap:second')->>'status', 'ALREADY_OWNED', 'second grant of a UNIQUE item -> ALREADY_OWNED');
select is(public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap', 1, 'SHOP', 'shop.campus.basic',
  'p0b-test:a4:head.induck_cap')->>'status', 'ALREADY_PROCESSED', 'same grant key again -> ALREADY_PROCESSED');
select is(public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap', 1, 'SHOP', 'shop.campus.basic',
  'p0b-test:a4:head.induck_cap')->>'originalStatus', 'GRANTED', 'replay reports the original result');
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'top.induck_hoodie', 1, 'SHOP', 'shop.campus.basic',
  'p0b-test:a4:head.induck_cap')$$, '23505', 'IDEMPOTENCY_CONFLICT', 'a grant key cannot be reused for another item');
select throws_ok($$select public.world_inventory_grant_item_v1('b4000000-0000-4000-8000-0000000000b4', 'head.induck_cap', 1, 'SHOP', 'shop.campus.basic',
  'p0b-test:a4:head.induck_cap')$$, '23505', 'IDEMPOTENCY_CONFLICT', 'a grant key cannot be reused for another account');
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'furniture.mini_induck', 2, 'SHOP', 'x', 'p0b-test:a4:qty2')$$,
  '22023', 'INVALID_QUANTITY', 'UNIQUE items grant exactly 1');

select results_eq($$
  select (x->>'itemId'), (x->>'quantity')::int, x->>'sourceType', x->>'sourceRef', x->>'eventId', x->>'catalogStatus',
         (x->'acquisitionMetadata'->>'label')
  from jsonb_array_elements(public.world_inventory_list_v1('a4000000-0000-4000-8000-0000000000a4')->'items') x
  order by 1$$,
  $$values
    ('badge.campus_first_step'::text, 1, 'QUEST'::text, 'quest.first_campus'::text, null::text, 'COMING_SOON'::text, null::text),
    ('badge.mcm_2026_landlord', 1, 'MINIGAME', 'minigame.landlord:first_clear', 'event.mcm_2026', 'COMING_SOON', '2026 문콘경 일일호프'),
    ('furniture.campus_map_poster', 1, 'SHOP', 'shop.campus.basic', null, 'COMING_SOON', null),
    ('furniture.induck_cushion', 1, 'SHOP', 'shop.dorm.furniture', null, 'COMING_SOON', null),
    ('furniture.mcm_2026_poster', 1, 'EVENT', 'event.mcm_2026:complete', 'event.mcm_2026', 'COMING_SOON', null),
    ('head.induck_cap', 1, 'SHOP', 'shop.campus.basic', null, 'COMING_SOON', null),
    ('top.induck_hoodie', 1, 'SHOP', 'shop.campus.basic', null, 'COMING_SOON', null),
    ('top.mcm_2026_survivor', 1, 'EVENT', 'quest.mcm_2026_core', 'event.mcm_2026', 'COMING_SOON', null)$$,
  'every owned item keeps quantity 1 and its first-acquisition provenance');
select ok((public.world_inventory_get_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.induck_cap')->'item'->>'acquiredAt') is not null,
  'getOwnedItem returns acquiredAt');
reset role;
select is((select count(*) from private.world_player_items where user_id = 'a4000000-0000-4000-8000-0000000000a4'),
  8::bigint, 'duplicates and replays created no extra ownership rows');
select is((select count(*) from private.world_item_grants where user_id = 'a4000000-0000-4000-8000-0000000000a4'),
  9::bigint, '8 grants + 1 ALREADY_OWNED attempt are logged once each');

-- ---- validation ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'weapon.sword', 1, 'SHOP', 'x', 'v-unknown')$$,
  '22023', 'UNKNOWN_ITEM', 'items outside the catalog cannot be granted');
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'COSMETIC_INDUCK_HOODIE', 1, 'SHOP', 'x', 'v-upper')$$,
  '22023', 'INVALID_ITEM_ID', 'uppercase ids are refused');
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.inha_cap', 1, 'GACHA', 'x', 'v-source')$$,
  '22023', 'INVALID_SOURCE', 'unknown source type is refused');
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.inha_cap', 0, 'SYSTEM', 'x', 'v-zero')$$,
  '22023', 'INVALID_QUANTITY', 'quantity 0 is refused');
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.inha_cap', 1, 'SYSTEM', 'x', null)$$,
  '22023', 'INVALID_IDEMPOTENCY_KEY', 'grant key is required');
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'head.inha_cap', 1, 'SYSTEM', 'x', 'v-meta', null, '[1,2]'::jsonb)$$,
  '22023', 'INVALID_METADATA', 'metadata must be an object');
select throws_ok($$select public.world_inventory_grant_item_v1('c4000000-0000-4000-8000-0000000000c4', 'head.inha_cap', 1, 'DEFAULT', 'x', 'v-guest')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'guest gets no persistent ownership');
select throws_ok($$select public.world_inventory_ensure_default_items_v1('c4000000-0000-4000-8000-0000000000c4')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'guest gets no default items');
select throws_ok($$select public.world_inventory_grant_item_v1('d4000000-0000-4000-8000-0000000000d4', 'head.inha_cap', 1, 'DEFAULT', 'x', 'v-banned')$$,
  '22023', 'ACCOUNT_UNAVAILABLE', 'banned account is refused');
reset role;
select is((select count(*) from private.world_player_items where user_id in (
  'c4000000-0000-4000-8000-0000000000c4', 'd4000000-0000-4000-8000-0000000000d4')), 0::bigint, 'guest and banned own nothing');

-- ---- default items: idempotent, never duplicated ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(array(select x->>'status' from jsonb_array_elements(
    public.world_inventory_ensure_default_items_v1('b4000000-0000-4000-8000-0000000000b4')->'items') x),
  array['GRANTED', 'GRANTED', 'GRANTED'], 'first login grants the three DEFAULT items');
select is(array(select x->>'status' from jsonb_array_elements(
    public.world_inventory_ensure_default_items_v1('b4000000-0000-4000-8000-0000000000b4')->'items') x),
  array['ALREADY_PROCESSED', 'ALREADY_PROCESSED', 'ALREADY_PROCESSED'], 'every later login changes nothing');
reset role;
select results_eq($$select item_id, quantity, source_type from private.world_player_items
  where user_id = 'b4000000-0000-4000-8000-0000000000b4' order by item_id$$,
  $$values ('back.freshman_bag'::text, 1, 'DEFAULT'::text), ('head.inha_cap', 1, 'DEFAULT'), ('top.inha_basic', 1, 'DEFAULT')$$,
  'B owns exactly the three defaults once');

-- ---- STACKABLE contract (structural; fixture item rolled back with this test) ----
insert into private.world_item_catalog values ('memorabilia.p0b_test_ticket', 'MEMORABILIA', 'STACKABLE', 5, 'ACTIVE');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select results_eq($$select (r->>'quantityBefore')::int, (r->>'quantityGranted')::int, (r->>'quantityAfter')::int, r->>'status'
  from (select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'memorabilia.p0b_test_ticket', 2, 'SYSTEM', 'test', 'p0b-test:a4:stack1') r) s$$,
  $$values (0, 2, 2, 'GRANTED'::text)$$, 'first stack grant 0 + 2 = 2');
select results_eq($$select (r->>'quantityBefore')::int, (r->>'quantityGranted')::int, (r->>'quantityAfter')::int, r->>'status'
  from (select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'memorabilia.p0b_test_ticket', 3, 'EVENT', 'later', 'p0b-test:a4:stack2') r) s$$,
  $$values (2, 3, 5, 'GRANTED'::text)$$, 'second stack grant 2 + 3 = 5');
select throws_ok($$select public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'memorabilia.p0b_test_ticket', 1, 'SYSTEM', 'test', 'p0b-test:a4:stack3')$$,
  'P0001', 'MAX_STACK_EXCEEDED', 'max stack is enforced');
select is(public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'memorabilia.p0b_test_ticket', 2, 'SYSTEM', 'test', 'p0b-test:a4:stack1')->>'status',
  'ALREADY_PROCESSED', 'stack grant replay adds nothing');
select results_eq($$select (x->>'quantity')::int, x->>'sourceType', x->>'sourceRef'
  from (select public.world_inventory_get_item_v1('a4000000-0000-4000-8000-0000000000a4', 'memorabilia.p0b_test_ticket')->'item' x) s$$,
  $$values (5, 'SYSTEM'::text, 'test'::text)$$, 'one row, quantity 5, first-acquisition provenance kept');
reset role;
select is((select count(*) from private.world_item_grants where item_id = 'memorabilia.p0b_test_ticket'), 2::bigint,
  'each stack top-up is its own grant log row');

-- ---- Life M1 source vocabulary + real MATERIAL fixture ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_inventory_grant_item_v1(
  'a4000000-0000-4000-8000-0000000000a4', 'material.campus_leaf', 1, v.source_type,
  'life-m1:' || lower(v.source_type), 'life-m1:a4:' || lower(v.source_type))->>'status',
  'GRANTED', format('%s is an accepted inventory grant source', v.source_type))
from (values ('ACTIVITY'::text), ('CRAFTING'), ('EQUIPMENT'), ('RESEARCH')) v(source_type);
reset role;
select results_eq($$select source_type, quantity_requested from private.world_item_grants
  where item_id = 'material.campus_leaf' order by created_at, source_type$$,
  $$values ('ACTIVITY'::text, 1), ('CRAFTING', 1), ('EQUIPMENT', 1), ('RESEARCH', 1)$$,
  'the four M1 grant sources are preserved in the append-only grant log');
select is((select quantity from private.world_player_items
  where user_id = 'a4000000-0000-4000-8000-0000000000a4' and item_id = 'material.campus_leaf'),
  4, 'the real M1 material stacks through the existing grant authority');

-- ---- disabled / hidden / unknown items never lose ownership ----
update private.world_item_catalog set status = 'DISABLED' where item_id = 'top.mcm_2026_survivor';
update private.world_item_catalog set status = 'HIDDEN' where item_id = 'furniture.mcm_2026_poster';
delete from private.world_item_catalog where item_id = 'badge.mcm_2026_landlord';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.world_inventory_grant_item_v1('b4000000-0000-4000-8000-0000000000b4', 'top.mcm_2026_survivor', 1, 'EVENT', 'late', 'v-disabled')$$,
  'P0001', 'ITEM_UNAVAILABLE', 'a DISABLED item cannot be newly granted');
select throws_ok($$select public.world_inventory_grant_item_v1('b4000000-0000-4000-8000-0000000000b4', 'furniture.mcm_2026_poster', 1, 'EVENT', 'late', 'v-hidden')$$,
  'P0001', 'ITEM_UNAVAILABLE', 'a HIDDEN item cannot be newly granted (event ended)');
select is(public.world_inventory_grant_item_v1('a4000000-0000-4000-8000-0000000000a4', 'top.mcm_2026_survivor', 1, 'EVENT', 'quest.mcm_2026_core',
  'p0b-test:a4:top.mcm_2026_survivor', 'event.mcm_2026')->>'status', 'ALREADY_PROCESSED', 'an earlier grant replays safely after disable');
select is(public.world_inventory_has_item_v1('a4000000-0000-4000-8000-0000000000a4', item_id), true, format('%s is still owned', item_id))
from unnest(array['top.mcm_2026_survivor', 'furniture.mcm_2026_poster', 'badge.mcm_2026_landlord']) item_id;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a4000000-0000-4000-8000-0000000000a4","is_anonymous":false}';
select results_eq($$select x->>'itemId', x->>'catalogStatus', x->>'sourceRef'
  from jsonb_array_elements(public.get_my_world_inventory_v1()->'items') x
  where x->>'itemId' in ('top.mcm_2026_survivor', 'furniture.mcm_2026_poster', 'badge.mcm_2026_landlord') order by 1$$,
  $$values ('badge.mcm_2026_landlord'::text, 'UNKNOWN_ITEM'::text, 'minigame.landlord:first_clear'::text),
           ('furniture.mcm_2026_poster', 'HIDDEN', 'event.mcm_2026:complete'),
           ('top.mcm_2026_survivor', 'DISABLED', 'quest.mcm_2026_core')$$,
  'player still reads disabled, hidden and catalog-missing items with provenance');

-- ---- player read contract: own inventory only, no server-only fields ----
select is(jsonb_array_length(public.get_my_world_inventory_v1()->'items'), 10, 'A reads all 10 owned rows (incl. the Life M1 material stack)');
select ok(not exists (select 1 from jsonb_array_elements(public.get_my_world_inventory_v1()->'items') x
  where x ? 'grantId' or x ? 'acquisitionMetadata'), 'player read hides grant ids and server metadata');
set local request.jwt.claims = '{"role":"authenticated","sub":"b4000000-0000-4000-8000-0000000000b4","is_anonymous":false}';
select is(array(select x->>'itemId' from jsonb_array_elements(public.get_my_world_inventory_v1()->'items') x order by 1),
  array['back.freshman_bag', 'head.inha_cap', 'top.inha_basic'], 'B sees only B''s items, never A''s');
set local request.jwt.claims = '{"role":"authenticated","sub":"c4000000-0000-4000-8000-0000000000c4","is_anonymous":true}';
select throws_ok($$select public.get_my_world_inventory_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous session has no inventory');
set local request.jwt.claims = '{"role":"authenticated","sub":"d4000000-0000-4000-8000-0000000000d4","is_anonymous":false}';
select throws_ok($$select public.get_my_world_inventory_v1()$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned account cannot read');
reset role;

-- ---- integrity ----
select throws_ok($$update private.world_item_grants set quantity_granted = 5$$, '42501', 'GRANT_LOG_APPEND_ONLY',
  'grant log rows are never updated, even by the owner');
select throws_ok($$update private.world_player_items set quantity = 0 where user_id = 'a4000000-0000-4000-8000-0000000000a4'$$,
  '23514', null, 'the database refuses quantity below 1');
select is(
  array(select i.user_id::text || ':' || i.item_id from private.world_player_items i
        where i.quantity <> (select sum(g.quantity_granted) from private.world_item_grants g
                             where g.user_id = i.user_id and g.item_id = i.item_id)),
  array[]::text[], 'every ownership quantity equals the sum of its granted log rows');

select * from finish();
rollback;
