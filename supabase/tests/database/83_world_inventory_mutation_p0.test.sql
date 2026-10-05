-- INHA WORLD P0 Inventory Mutation.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a8300000-0000-4000-8000-0000000000a8','authenticated','authenticated','mutation-a@example.test',now(),false),
 ('b8300000-0000-4000-8000-0000000000b8','authenticated','authenticated','mutation-b@example.test',now(),false),
 ('c8300000-0000-4000-8000-0000000000c8','authenticated','authenticated',null,null,true),
 ('d8300000-0000-4000-8000-0000000000d8','authenticated','authenticated','mutation-d@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a8300000-0000-4000-8000-0000000000a8','변환A',false),
 ('b8300000-0000-4000-8000-0000000000b8','변환B',false),
 ('c8300000-0000-4000-8000-0000000000c8','변환게스트',false),
 ('d8300000-0000-4000-8000-0000000000d8','변환정지',true);

-- ---- schema / security ----
select has_table('private','world_inventory_mutations','mutation parent exists');
select has_table('private','world_item_consumptions','consume ledger exists');
select has_table('private','world_inventory_mutation_entries','mutation child receipt exists');
select col_is_unique('private','world_inventory_mutations',array['idempotency_key'],
  'parent mutation idempotency key is globally unique');
select col_is_pk('private','world_item_consumptions',array['consume_id'],'consume key is primary key');
select col_is_pk('private','world_inventory_mutation_entries',array['mutation_id','position'],
  'entry position is unique inside a mutation');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_inventory_mutations'::regclass,
  'private.world_item_consumptions'::regclass,
  'private.world_inventory_mutation_entries'::regclass
)), 'mutation tables have RLS');
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array[
       'private.world_inventory_mutations',
       'private.world_item_consumptions',
       'private.world_inventory_mutation_entries'
     ]) t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege(r,
  'private.world_inventory_consume_v1(uuid,text,integer,text,text,text,uuid,jsonb)','execute'),
  format('%s cannot call private consume core',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r,
  'private.world_inventory_mutate_v1(uuid,text,text,text,text,jsonb)','execute'),
  format('%s cannot call private mutation core',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(to_regprocedure('public.world_inventory_mutate_v1(uuid,text,text,text,text,jsonb)') is null,
  'no public generic mutation RPC exists');

-- ---- seed ownership through the existing grant authority ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_inventory_grant_item_v1(
  'a8300000-0000-4000-8000-0000000000a8','material.campus_leaf',5,
  'ACTIVITY','activity.gathering.campus','m3-seed:a:leaf')->>'status','GRANTED','seed 5 leaves');
select is(public.world_inventory_grant_item_v1(
  'a8300000-0000-4000-8000-0000000000a8','material.fish_carp',4,
  'ACTIVITY','activity.fishing.inkyung','m3-seed:a:fish')->>'status','GRANTED','seed 4 fish');
select is(public.world_inventory_grant_item_v1(
  'a8300000-0000-4000-8000-0000000000a8','head.inha_cap',1,
  'DEFAULT','collection.c1.default','m3-seed:a:cap')->>'status','GRANTED','seed one UNIQUE item');
reset role;

-- ---- STACKABLE consume ----
select results_eq($$
  select
    r->>'status',
    (r->>'quantityBefore')::int,
    (r->>'quantityConsumed')::int,
    (r->>'quantityAfter')::int,
    (r->>'ownedAfter')::boolean
  from (select private.world_inventory_consume_v1(
    'a8300000-0000-4000-8000-0000000000a8','material.campus_leaf',2,
    'CRAFTING','recipe.test','consume:a:leaf:1',null,null) r) x
$$, $$values ('SUCCESS'::text,5,2,3,true)$$,
  'partial STACKABLE consume updates quantity');
select is((select quantity from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='material.campus_leaf'),
  3,'ownership readback is 3');
select is(private.world_inventory_consume_v1(
  'a8300000-0000-4000-8000-0000000000a8','material.campus_leaf',2,
  'CRAFTING','recipe.test','consume:a:leaf:1',null,null)->>'status',
  'ALREADY_PROCESSED','same consume key is replay-safe');
select throws_ok($$
  select private.world_inventory_consume_v1(
    'a8300000-0000-4000-8000-0000000000a8','material.campus_leaf',1,
    'CRAFTING','recipe.test','consume:a:leaf:1',null,null)
$$,'23505','IDEMPOTENCY_CONFLICT','consume key cannot change quantity');
select is((select count(*) from private.world_item_consumptions
  where consume_id='consume:a:leaf:1'),1::bigint,'replay creates one ledger row');

select is(private.world_inventory_consume_v1(
  'a8300000-0000-4000-8000-0000000000a8','material.campus_leaf',3,
  'CRAFTING','recipe.test','consume:a:leaf:2',null,null)->>'status',
  'SUCCESS','exact consume succeeds');
select is((select count(*) from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='material.campus_leaf'),
  0::bigint,'quantity zero deletes the ownership row');
select results_eq($$
  select quantity_before,quantity_consumed,quantity_after
    from private.world_item_consumptions
   where user_id='a8300000-0000-4000-8000-0000000000a8'
     and item_id='material.campus_leaf'
   order by created_at,consume_id
$$,$$values (5,2,3),(3,3,0)$$,'consume history survives ownership deletion');

select throws_ok($$
  select private.world_inventory_consume_v1(
    'a8300000-0000-4000-8000-0000000000a8','head.inha_cap',1,
    'SYSTEM','test','consume:a:unique',null,null)
$$,'P0001','CONSUME_POLICY_UNSUPPORTED','P0 generic consume rejects UNIQUE ownership');
select is((select quantity from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='head.inha_cap'),
  1,'UNIQUE ownership remains untouched');
select throws_ok($$
  select private.world_inventory_consume_v1(
    'a8300000-0000-4000-8000-0000000000a8','material.fish_carp',5,
    'SYSTEM','test','consume:a:over',null,null)
$$,'P0001','INSUFFICIENT_QUANTITY','over-consume is refused');
select is((select quantity from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='material.fish_carp'),
  4,'failed over-consume moves no value');

-- replenish leaves for exchange tests
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_inventory_grant_item_v1(
  'a8300000-0000-4000-8000-0000000000a8','material.campus_leaf',10,
  'ACTIVITY','activity.gathering.campus','m3-seed:a:leaf:reopen')->>'status','GRANTED','reseed leaves');
reset role;

-- ---- atomic 2 input -> 1 output ----
select is(private.world_inventory_mutate_v1(
  'a8300000-0000-4000-8000-0000000000a8',
  'CRAFT','CRAFTING','recipe.test_leaf_fish',
  'inventory-mutation:craft:a:001',
  '{"consumes":[{"itemId":"material.fish_carp","quantity":1},{"itemId":"material.campus_leaf","quantity":2}],
    "grants":[{"itemId":"material.artifact_fragment_01","quantity":1}]}'::jsonb
)->>'status','SUCCESS','2 inputs -> 1 output commits atomically');

select results_eq($$
  select item_id,quantity from private.world_player_items
   where user_id='a8300000-0000-4000-8000-0000000000a8'
     and item_id in ('material.campus_leaf','material.fish_carp','material.artifact_fragment_01')
   order by item_id
$$,$$values
  ('material.artifact_fragment_01'::text,1),
  ('material.campus_leaf',8),
  ('material.fish_carp',3)
$$,'mutation readback matches consume + grant');

select results_eq($$
  select position,direction,item_id,quantity,quantity_before,quantity_after
    from private.world_inventory_mutation_entries e
    join private.world_inventory_mutations m using(mutation_id)
   where m.idempotency_key='inventory-mutation:craft:a:001'
   order by position
$$,$$values
  (0,'CONSUME'::text,'material.campus_leaf'::text,2,10,8),
  (1,'CONSUME','material.fish_carp',1,4,3),
  (2,'GRANT','material.artifact_fragment_01',1,0,1)
$$,'entry order is deterministic consumes then grants');
select is((select count(*) from private.world_item_consumptions c
  join private.world_inventory_mutations m on m.mutation_id=c.parent_mutation_id
  where m.idempotency_key='inventory-mutation:craft:a:001'),2::bigint,
  'mutation has two child consume ledger rows');
select is((select count(*) from private.world_item_grants
  where grant_id='inventory-mutation:craft:a:001/grant/0'),1::bigint,
  'output uses the existing grant ledger');

select is(private.world_inventory_mutate_v1(
  'a8300000-0000-4000-8000-0000000000a8',
  'CRAFT','CRAFTING','recipe.test_leaf_fish',
  'inventory-mutation:craft:a:001',
  '{"grants":[{"quantity":1,"itemId":"material.artifact_fragment_01"}],
    "consumes":[{"quantity":2,"itemId":"material.campus_leaf"},{"quantity":1,"itemId":"material.fish_carp"}]}'::jsonb
)->>'status','ALREADY_PROCESSED','same semantic plan replays despite input JSON ordering');
select is((select quantity from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='material.campus_leaf'),
  8,'replay consumes nothing');

select throws_ok($$
  select private.world_inventory_mutate_v1(
    'a8300000-0000-4000-8000-0000000000a8',
    'CRAFT','CRAFTING','recipe.test_leaf_fish',
    'inventory-mutation:craft:a:001',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":3}],
      "grants":[{"itemId":"material.artifact_fragment_01","quantity":1}]}'::jsonb)
$$,'23505','IDEMPOTENCY_CONFLICT','parent key cannot change its plan');

-- force a downstream child-grant idempotency conflict after input consume has started;
-- the function transaction must roll every input/parent/entry back.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_inventory_grant_item_v1(
  'a8300000-0000-4000-8000-0000000000a8','head.inha_cap',1,
  'SYSTEM','m3-test','inventory-mutation:craft:a:child-fail/grant/0')->>'status',
  'ALREADY_OWNED','reserve the future child grant key with another item');
reset role;
select throws_ok($$
  select private.world_inventory_mutate_v1(
    'a8300000-0000-4000-8000-0000000000a8',
    'CRAFT','CRAFTING','recipe.child_failure',
    'inventory-mutation:craft:a:child-fail',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":1}],
      "grants":[{"itemId":"material.artifact_fragment_01","quantity":1}]}'::jsonb)
$$,'23505','IDEMPOTENCY_CONFLICT','downstream grant conflict aborts the whole mutation');
select is((select quantity from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='material.campus_leaf'),
  8,'post-consume child failure rolls input quantity back');
select is((select count(*) from private.world_inventory_mutations
  where idempotency_key='inventory-mutation:craft:a:child-fail'),0::bigint,
  'post-consume child failure leaves no parent receipt');
select is((select count(*) from private.world_item_consumptions
  where consume_id='inventory-mutation:craft:a:child-fail/consume/0'),0::bigint,
  'post-consume child failure leaves no consume ledger row');

-- ---- preflight failures roll back all inputs ----
select throws_ok($$
  select private.world_inventory_mutate_v1(
    'a8300000-0000-4000-8000-0000000000a8',
    'CRAFT','CRAFTING','recipe.too_expensive',
    'inventory-mutation:craft:a:insufficient',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":999}],
      "grants":[{"itemId":"material.fish_carp","quantity":1}]}'::jsonb)
$$,'P0001','INSUFFICIENT_QUANTITY','insufficient input refuses whole mutation');
select is((select quantity from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='material.campus_leaf'),
  8,'insufficient mutation consumes nothing');
select is((select count(*) from private.world_inventory_mutations
  where idempotency_key='inventory-mutation:craft:a:insufficient'),0::bigint,
  'failed mutation leaves no parent receipt');

-- fill artifact stack to max 99, then verify output overflow preserves input
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_inventory_grant_item_v1(
  'a8300000-0000-4000-8000-0000000000a8','material.artifact_fragment_01',98,
  'SYSTEM','m3-test','m3-seed:a:artifact:max')->>'status','GRANTED','fill artifact stack to 99');
reset role;
select throws_ok($$
  select private.world_inventory_mutate_v1(
    'a8300000-0000-4000-8000-0000000000a8',
    'CRAFT','CRAFTING','recipe.overflow',
    'inventory-mutation:craft:a:overflow',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":1}],
      "grants":[{"itemId":"material.artifact_fragment_01","quantity":1}]}'::jsonb)
$$,'P0001','MAX_STACK_EXCEEDED','output overflow refuses before consume');
select is((select quantity from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='material.campus_leaf'),
  8,'overflow failure preserves input');

select throws_ok($$
  select private.world_inventory_mutate_v1(
    'a8300000-0000-4000-8000-0000000000a8',
    'CRAFT','CRAFTING','recipe.unique_owned',
    'inventory-mutation:craft:a:unique',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":1}],
      "grants":[{"itemId":"head.inha_cap","quantity":1}]}'::jsonb)
$$,'P0001','OUTPUT_ALREADY_OWNED','owned UNIQUE output refuses before consume');
select is((select quantity from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='material.campus_leaf'),
  8,'UNIQUE output failure preserves input');

-- ---- consume-only mutation ----
select is(private.world_inventory_mutate_v1(
  'a8300000-0000-4000-8000-0000000000a8',
  'CONSUME','ACTIVITY','activity.fishing.inkyung',
  'inventory-mutation:consume:a:001',
  '{"consumes":[{"itemId":"material.fish_carp","quantity":1}],"grants":[]}'::jsonb
)->>'status','SUCCESS','CONSUME mutation may have no grants');
select is((select quantity from private.world_player_items
  where user_id='a8300000-0000-4000-8000-0000000000a8' and item_id='material.fish_carp'),
  2,'consume-only mutation decrements the stack');

-- ---- plan contract ----
select throws_ok($$
  select private.world_inventory_mutate_v1(
    'a8300000-0000-4000-8000-0000000000a8',
    'CRAFT','CRAFTING','recipe.bad',
    'inventory-mutation:bad:no-output',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":1}],"grants":[]}'::jsonb)
$$,'22023','INVALID_MUTATION','non-CONSUME mutation requires an output');
select throws_ok($$
  select private.world_inventory_mutate_v1(
    'a8300000-0000-4000-8000-0000000000a8',
    'CRAFT','CRAFTING','recipe.bad',
    'inventory-mutation:bad:overlap',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":1}],
      "grants":[{"itemId":"material.campus_leaf","quantity":1}]}'::jsonb)
$$,'22023','MUTATION_ITEM_OVERLAP','same item cannot be input and output in P0');
select throws_ok($$
  select private.world_inventory_mutate_v1(
    'a8300000-0000-4000-8000-0000000000a8',
    'CRAFT','CRAFTING','recipe.bad',
    'inventory-mutation:bad:duplicate',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":1},{"itemId":"material.campus_leaf","quantity":1}],
      "grants":[{"itemId":"material.fish_carp","quantity":1}]}'::jsonb)
$$,'22023','DUPLICATE_MUTATION_ITEM','duplicate plan items are rejected');

-- ---- guest / banned boundary ----
select throws_ok($$
  select private.world_inventory_mutate_v1(
    'c8300000-0000-4000-8000-0000000000c8',
    'CONSUME','SYSTEM','test','inventory-mutation:guest',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":1}],"grants":[]}'::jsonb)
$$,'22023','ACCOUNT_UNAVAILABLE','guest cannot own persistent mutation state');
select throws_ok($$
  select private.world_inventory_mutate_v1(
    'd8300000-0000-4000-8000-0000000000d8',
    'CONSUME','SYSTEM','test','inventory-mutation:banned',
    '{"consumes":[{"itemId":"material.campus_leaf","quantity":1}],"grants":[]}'::jsonb)
$$,'22023','ACCOUNT_UNAVAILABLE','banned account cannot mutate inventory');

-- ---- append-only receipts ----
select throws_ok($$
  update private.world_item_consumptions set quantity_after=999
   where consume_id='consume:a:leaf:1'
$$,'42501','INVENTORY_MUTATION_APPEND_ONLY','consume ledger cannot be rewritten');
select throws_ok($$
  update private.world_inventory_mutations set source_ref='changed'
   where idempotency_key='inventory-mutation:craft:a:001'
$$,'42501','INVENTORY_MUTATION_APPEND_ONLY','mutation receipt cannot be rewritten');
select throws_ok($$
  update private.world_inventory_mutation_entries set quantity=999
   where mutation_id=(select mutation_id from private.world_inventory_mutations
     where idempotency_key='inventory-mutation:craft:a:001')
$$,'42501','INVENTORY_MUTATION_APPEND_ONLY','mutation entries cannot be rewritten');

-- ---- account lifecycle ----
delete from auth.users where id='a8300000-0000-4000-8000-0000000000a8';
select is((select count(*) from private.world_inventory_mutations
  where user_id='a8300000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes mutation parents');
select is((select count(*) from private.world_item_consumptions
  where user_id='a8300000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes consume history in account scope');

select * from finish();
rollback;
