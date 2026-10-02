-- Appearance / Loadout Authority P0 (20260928160000). Per-account appearance slots on top of P0-B
-- ownership: read shape, equip / replace / unequip, validation (ownership, slot, category, catalog
-- status), idempotency, guests and banned accounts, account isolation, the client/server boundary and
-- deletion cascade. Concurrency and cross-session readback live in
-- supabase/tests/integration/appearance-loadout.integration.test.mjs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a7600000-0000-4000-8000-0000000000a7', 'authenticated', 'authenticated', 'look-a@example.test', now(), false),
 ('b7600000-0000-4000-8000-0000000000b7', 'authenticated', 'authenticated', 'look-b@example.test', now(), false),
 ('c7600000-0000-4000-8000-0000000000c7', 'authenticated', 'authenticated', null, null, true),
 ('d7600000-0000-4000-8000-0000000000d7', 'authenticated', 'authenticated', 'look-d@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a7600000-0000-4000-8000-0000000000a7', '옷장A', false),
 ('b7600000-0000-4000-8000-0000000000b7', '옷장B', false),
 ('c7600000-0000-4000-8000-0000000000c7', '옷장게스트', false),
 ('d7600000-0000-4000-8000-0000000000d7', '옷장정지', true);

-- Test-only catalog rows (rolled back): the categories the canon has no item for yet, and wearables
-- whose status is changed below.
insert into private.world_item_catalog (item_id, category, ownership_policy, max_stack, status) values
 ('mount.p0l_bike', 'MOUNT', 'UNIQUE', null, 'ACTIVE'),
 ('mount_cosmetic.p0l_bell', 'MOUNT_COSMETIC', 'UNIQUE', null, 'ACTIVE'),
 ('head.p0l_disabled', 'WEARABLE', 'UNIQUE', null, 'ACTIVE'),
 ('head.p0l_hidden', 'WEARABLE', 'UNIQUE', null, 'ACTIVE'),
 ('shoes.p0l_locked', 'WEARABLE', 'UNIQUE', null, 'LOCKED');

-- Ownership through the P0-B server path only.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.world_inventory_grant_item_v1('a7600000-0000-4000-8000-0000000000a7', i, 1, 'SYSTEM', 'p0l_test',
  'p0l:a:' || i, null)
from unnest(array['head.inha_cap', 'head.induck_cap', 'top.inha_basic', 'back.freshman_bag', 'badge.main_gate',
  'furniture.induck_chair', 'memorabilia.campus_mug', 'emote.wave_plus', 'mount.p0l_bike', 'mount_cosmetic.p0l_bell',
  'head.p0l_disabled', 'head.p0l_hidden', 'shoes.p0l_locked']) i;
select public.world_inventory_grant_item_v1('b7600000-0000-4000-8000-0000000000b7', 'top.induck_hoodie', 1, 'SYSTEM',
  'p0l_test', 'p0l:b:top.induck_hoodie', null);
reset role;
update private.world_item_catalog set status = 'DISABLED' where item_id = 'head.p0l_disabled';
update private.world_item_catalog set status = 'HIDDEN' where item_id = 'head.p0l_hidden';

-- ---- schema ----
select has_table('private', 'world_player_appearance_loadout', 'loadout table exists');
select has_table('private', 'world_appearance_transactions', 'appearance change log exists');
select col_is_pk('private', 'world_player_appearance_loadout', array['user_id', 'slot'], 'one item per (account, slot)');
select col_is_unique('private', 'world_appearance_transactions', array['idempotency_key'], 'a key is used once');
select hasnt_column('private', 'world_player_appearance_loadout', c, format('loadout stores no %s', c))
from unnest(array['level', 'display_name', 'category', 'equip_slot', 'quantity', 'status']) c;
select ok(exists (select 1 from pg_constraint where conrelid = 'private.world_player_appearance_loadout'::regclass
  and contype = 'f' and confrelid = 'private.world_player_items'::regclass),
  'an equipped item references its ownership row');
select ok(not exists (select 1 from pg_constraint where conrelid = 'private.world_player_appearance_loadout'::regclass
  and contype = 'f' and confrelid = 'private.world_item_catalog'::regclass),
  'no FK to the catalog: catalog drift never deletes a loadout');

-- ---- authority ----
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_player_appearance_loadout'::regclass, 'private.world_appearance_transactions'::regclass)),
  'appearance tables have RLS');
select ok(not has_table_privilege(r, t, p), format('%s cannot %s %s', r, p, t))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['private.world_player_appearance_loadout', 'private.world_appearance_transactions']) t,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array[
  'private.world_appearance_slot_ok_v1(text)',
  'private.world_appearance_caller_v1()',
  'private.world_appearance_loadout_json_v1(uuid)',
  'private.world_appearance_result_v1(private.world_appearance_transactions,boolean)',
  'private.world_appearance_record_v1(uuid,text,text,text,text,text,text)']) f;
select ok(has_function_privilege('authenticated', f, 'execute'), format('authenticated can execute %s', f))
from unnest(array['public.get_my_world_appearance_loadout_v1()', 'public.equip_my_world_item_v1(text,text,text)',
  'public.unequip_my_world_item_v1(text,text)']) f;
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'service_role']) r,
     unnest(array['public.get_my_world_appearance_loadout_v1()', 'public.equip_my_world_item_v1(text,text,text)',
       'public.unequip_my_world_item_v1(text,text)']) f;

-- ---- player A: fresh read, equip, replace, unequip ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a7600000-0000-4000-8000-0000000000a7","is_anonymous":false}';
select is(public.get_my_world_appearance_loadout_v1(),
  '{"slots":{"BODY":null,"FACE":null,"HAIR":null,"HEAD":null,"TOP":null,"BOTTOM":null,"SHOES":null,"BACK":null,"ACCESSORY":null}}'::jsonb,
  'fresh account: every appearance slot present and empty');
reset role;
select is((select count(*) from private.world_player_appearance_loadout
  where user_id = 'a7600000-0000-4000-8000-0000000000a7'), 0::bigint, 'reading provisions no loadout row');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a7600000-0000-4000-8000-0000000000a7","is_anonymous":false}';
create temp table r1 on commit drop as select public.equip_my_world_item_v1('HEAD', 'head.inha_cap', 'look:a:1') v;
select is((select v - 'transactionId' - 'createdAt' - 'loadout' from r1),
  '{"status":"SUCCESS","replayed":false,"action":"EQUIP","slot":"HEAD","previousItemId":null,"itemId":"head.inha_cap","changed":true}'::jsonb,
  'owned HEAD item equips');
select is((select v #>> '{loadout,slots,HEAD,itemId}' from r1), 'head.inha_cap', 'the result carries the new loadout');
select is((select v #>> '{loadout,slots,HEAD,catalogStatus}' from r1), 'ACTIVE', 'with the item''s catalog status');
select is(public.equip_my_world_item_v1('TOP', 'top.inha_basic', 'look:a:2') ->> 'itemId', 'top.inha_basic', 'owned TOP item equips');
select is(public.equip_my_world_item_v1('HEAD', 'head.induck_cap', 'look:a:3') ->> 'previousItemId', 'head.inha_cap',
  'another HEAD item replaces the first (COMING_SOON owned items are equippable)');
select is(public.get_my_world_appearance_loadout_v1() #>> '{slots,HEAD,itemId}', 'head.induck_cap', 'HEAD now holds the new item');
select is(public.get_my_world_appearance_loadout_v1() #>> '{slots,TOP,itemId}', 'top.inha_basic', 'TOP untouched by the HEAD change');
select is(public.equip_my_world_item_v1('HEAD', 'head.induck_cap', 'look:a:4') ->> 'changed', 'false',
  'equipping what is already worn succeeds without a change');

-- ---- idempotency ----
select is((select (v ->> 'transactionId') from r1),
  public.equip_my_world_item_v1('HEAD', 'head.inha_cap', 'look:a:1') ->> 'transactionId', 'same key + same request replays');
select is(public.equip_my_world_item_v1('HEAD', 'head.inha_cap', 'look:a:1') ->> 'replayed', 'true', 'the replay is marked');
select is(public.get_my_world_appearance_loadout_v1() #>> '{slots,HEAD,itemId}', 'head.induck_cap',
  'a replay does not re-apply the old change');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', 'head.induck_cap', 'look:a:1')$$, '23505', 'IDEMPOTENCY_CONFLICT',
  'same key, different item');
select throws_ok($$select public.equip_my_world_item_v1('TOP', 'top.inha_basic', 'look:a:1')$$, '23505', 'IDEMPOTENCY_CONFLICT',
  'same key, different slot');
select throws_ok($$select public.unequip_my_world_item_v1('HEAD', 'look:a:1')$$, '23505', 'IDEMPOTENCY_CONFLICT',
  'same key, different action');

select is(public.unequip_my_world_item_v1('TOP', 'look:a:u1') ->> 'previousItemId', 'top.inha_basic', 'unequip empties the slot');
select is(public.get_my_world_appearance_loadout_v1() -> 'slots' -> 'TOP', 'null'::jsonb, 'TOP is empty');
select is(public.unequip_my_world_item_v1('TOP', 'look:a:u1') ->> 'replayed', 'true', 'unequip replays');
select is(public.unequip_my_world_item_v1('TOP', 'look:a:u2') ->> 'changed', 'false', 'unequipping an empty slot is a no-op success');
select throws_ok($$select public.unequip_my_world_item_v1('TOP', 'look:a:2')$$, '23505', 'IDEMPOTENCY_CONFLICT',
  'an equip key cannot be reused to unequip');
select is(jsonb_array_length(public.get_my_world_inventory_v1() -> 'items'), 13, 'ownership is untouched by equip / unequip');

-- ---- validation ----
select throws_ok($$select public.equip_my_world_item_v1('TOP', 'top.induck_hoodie', 'look:a:e1')$$, 'P0001', 'ITEM_NOT_OWNED',
  'an item the caller does not own');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', 'head.no_such_hat', 'look:a:e2')$$, '22023', 'UNKNOWN_ITEM',
  'an item the catalog does not have');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', 'HEAD_CAP', 'look:a:e3')$$, '22023', 'INVALID_ITEM_ID', 'a malformed item id');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', null, 'look:a:e4')$$, '22023', 'INVALID_ITEM_ID', 'a missing item id');
select throws_ok($$select public.equip_my_world_item_v1('TOP', 'head.inha_cap', 'look:a:e5')$$, 'P0001', 'SLOT_MISMATCH',
  'a HEAD item in the TOP slot');
select throws_ok($$select public.equip_my_world_item_v1('BACK', 'head.inha_cap', 'look:a:e6')$$, 'P0001', 'SLOT_MISMATCH',
  'a HEAD item in the BACK slot');
select throws_ok(format($$select public.equip_my_world_item_v1('HEAD', %L, %L)$$, i, 'look:a:ne:' || i), 'P0001', 'ITEM_NOT_EQUIPPABLE',
  format('%s is not appearance', i))
from unnest(array['badge.main_gate', 'furniture.induck_chair', 'memorabilia.campus_mug', 'emote.wave_plus',
  'mount.p0l_bike', 'mount_cosmetic.p0l_bell']) i;
select throws_ok($$select public.equip_my_world_item_v1('BADGE', 'badge.main_gate', 'look:a:e7')$$, '22023', 'INVALID_APPEARANCE_SLOT',
  'BADGE is a profile slot, not appearance');
select throws_ok(format($$select public.equip_my_world_item_v1(%L, 'head.inha_cap', %L)$$, s, 'look:a:slot:' || coalesce(s, 'null')),
  '22023', 'INVALID_APPEARANCE_SLOT', format('slot %s is refused', coalesce(s, 'null')))
from unnest(array['head', 'HAT', 'FURNITURE', '', null]) s;
select throws_ok($$select public.unequip_my_world_item_v1('BADGE', 'look:a:e8')$$, '22023', 'INVALID_APPEARANCE_SLOT',
  'unequip checks the slot too');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', 'head.p0l_disabled', 'look:a:e9')$$, 'P0001', 'ITEM_UNAVAILABLE',
  'an owned DISABLED item cannot be put on');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', 'head.p0l_hidden', 'look:a:e10')$$, 'P0001', 'ITEM_UNAVAILABLE',
  'an owned HIDDEN item cannot be put on');
select is(public.equip_my_world_item_v1('SHOES', 'shoes.p0l_locked', 'look:a:5') ->> 'itemId', 'shoes.p0l_locked',
  'LOCKED follows the grant rule: only DISABLED / HIDDEN are blocked');
select throws_ok(format($$select public.equip_my_world_item_v1('HEAD', 'head.inha_cap', %L)$$, k), '22023', 'INVALID_IDEMPOTENCY_KEY',
  format('key %s is refused', coalesce(k, 'null')))
from unnest(array[' bad', '', '-leading', repeat('k', 201), null]) k;
select throws_ok($$select public.unequip_my_world_item_v1('HEAD', null)$$, '22023', 'INVALID_IDEMPOTENCY_KEY', 'unequip needs a key');
reset role;
select is((select count(*) from private.world_appearance_transactions where user_id = 'a7600000-0000-4000-8000-0000000000a7'),
  7::bigint, 'only accepted changes are logged (4 equips + 1 no-op equip, 1 unequip + 1 no-op unequip, SHOES)');

-- An item worn before its status changes stays worn; the read reports the current status.
update private.world_item_catalog set status = 'DISABLED' where item_id = 'shoes.p0l_locked';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a7600000-0000-4000-8000-0000000000a7","is_anonymous":false}';
select is((public.get_my_world_appearance_loadout_v1() -> 'slots' -> 'SHOES') - 'equippedAt',
  '{"itemId":"shoes.p0l_locked","catalogStatus":"DISABLED"}'::jsonb, 'a status change keeps the row and reports DISABLED');
select throws_ok($$select public.equip_my_world_item_v1('SHOES', 'shoes.p0l_locked', 'look:a:e11')$$, 'P0001', 'ITEM_UNAVAILABLE',
  'but it cannot be put on again');
select is(public.unequip_my_world_item_v1('SHOES', 'look:a:u3') ->> 'previousItemId', 'shoes.p0l_locked', 'and it can be taken off');

-- ---- client/server boundary: no direct table or helper access, no forged ownership ----
select throws_ok($$select * from private.world_player_appearance_loadout$$, '42501', null, 'player cannot read the loadout table');
select throws_ok($$insert into private.world_player_appearance_loadout(user_id, slot, item_id)
  values ('a7600000-0000-4000-8000-0000000000a7', 'TOP', 'top.induck_hoodie')$$, '42501', null, 'player cannot write the loadout table');
select throws_ok($$select * from private.world_appearance_transactions$$, '42501', null, 'player cannot read the change log');
select throws_ok($$insert into private.world_player_items(user_id, item_id, quantity, source_type, source_ref, grant_id)
  values ('a7600000-0000-4000-8000-0000000000a7', 'top.induck_hoodie', 1, 'SHOP', 'forged', 'forged')$$, '42501', null,
  'player cannot forge an ownership row');
select throws_ok($$select private.world_appearance_record_v1('a7600000-0000-4000-8000-0000000000a7', 'look:forged', 'EQUIP',
  'TOP', 'top.induck_hoodie', null, 'top.induck_hoodie')$$, '42501', null, 'player cannot call the internal helpers');
select throws_ok($$select public.equip_my_world_item_v1('TOP', 'top.induck_hoodie', 'look:a:e12')$$, 'P0001', 'ITEM_NOT_OWNED',
  'still not owned after the forge attempts');

-- ---- guests, signed-out and banned accounts ----
set local request.jwt.claims = '{"role":"authenticated","sub":"c7600000-0000-4000-8000-0000000000c7","is_anonymous":true}';
select throws_ok($$select public.get_my_world_appearance_loadout_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'guest has no loadout');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', 'head.inha_cap', 'look:c:1')$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'guest cannot equip');
select throws_ok($$select public.unequip_my_world_item_v1('HEAD', 'look:c:2')$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'guest cannot unequip');
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.get_my_world_appearance_loadout_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'no caller, no loadout');
set local request.jwt.claims = '{"role":"authenticated","sub":"d7600000-0000-4000-8000-0000000000d7","is_anonymous":false}';
select throws_ok($$select public.get_my_world_appearance_loadout_v1()$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned account cannot read');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', 'head.inha_cap', 'look:d:1')$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned account cannot equip');
select throws_ok($$select public.unequip_my_world_item_v1('HEAD', 'look:d:2')$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned account cannot unequip');
reset role;
set local request.jwt.claims = '{}';
select throws_ok($$select public.get_my_world_appearance_loadout_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED',
  'a database session without a player JWT has no caller');

-- ---- account isolation ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b7600000-0000-4000-8000-0000000000b7","is_anonymous":false}';
select is(public.get_my_world_appearance_loadout_v1() -> 'slots' -> 'HEAD', 'null'::jsonb, 'B never sees A''s loadout');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', 'head.inha_cap', 'look:b:1')$$, 'P0001', 'ITEM_NOT_OWNED',
  'B cannot wear A''s item');
select throws_ok($$select public.equip_my_world_item_v1('HEAD', 'head.inha_cap', 'look:a:1')$$, '23505', 'IDEMPOTENCY_CONFLICT',
  'B cannot replay A''s key');
select is(public.equip_my_world_item_v1('TOP', 'top.induck_hoodie', 'look:b:2') ->> 'itemId', 'top.induck_hoodie', 'B wears B''s own item');
select is(public.unequip_my_world_item_v1('HEAD', 'look:b:3') ->> 'changed', 'false', 'B''s unequip is B''s slot only');
set local request.jwt.claims = '{"role":"authenticated","sub":"a7600000-0000-4000-8000-0000000000a7","is_anonymous":false}';
select is(public.get_my_world_appearance_loadout_v1() #>> '{slots,HEAD,itemId}', 'head.induck_cap', 'A''s HEAD is unchanged by B');
select is(public.get_my_world_appearance_loadout_v1() -> 'slots' -> 'TOP', 'null'::jsonb, 'A''s TOP is unchanged by B');
reset role;

-- ---- table integrity (owner-level writes still obey the invariants) ----
select throws_ok($$insert into private.world_player_appearance_loadout(user_id, slot, item_id)
  values ('a7600000-0000-4000-8000-0000000000a7', 'TOP', 'head.inha_cap')$$, '23514', null, 'a row cannot put an item in another slot');
select throws_ok($$insert into private.world_player_appearance_loadout(user_id, slot, item_id)
  values ('a7600000-0000-4000-8000-0000000000a7', 'TOP', 'top.induck_hoodie')$$, '23503', null, 'a row cannot hold an unowned item');
select throws_ok($$update private.world_appearance_transactions set slot = 'TOP'$$, '42501', 'APPEARANCE_LOG_APPEND_ONLY',
  'the change log is append-only');

-- ---- account deletion ----
delete from auth.users where id = 'a7600000-0000-4000-8000-0000000000a7';
select is((select count(*) from private.world_player_appearance_loadout where user_id = 'a7600000-0000-4000-8000-0000000000a7'),
  0::bigint, 'account deletion removes the loadout');
select is((select count(*) from private.world_appearance_transactions where user_id = 'a7600000-0000-4000-8000-0000000000a7'),
  0::bigint, 'account deletion removes the change log');
select is((select count(*) from private.world_player_appearance_loadout where user_id = 'b7600000-0000-4000-8000-0000000000b7'),
  1::bigint, 'other accounts keep theirs');

select * from finish();
rollback;
