-- JSL-A Jeongseok access gate and visitor pass. Disposable fixtures only; every activation and
-- purchase below is rolled back with the test transaction. now() is constant inside it, so
-- expiry is exercised by moving a fixture entitlement into the past.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a1110000-0000-4000-8000-00000000000a','authenticated','authenticated','jsl-a@example.test',now(),false),
 ('a1110000-0000-4000-8000-00000000000b','authenticated','authenticated','jsl-b@example.test',now(),false),
 ('a1110000-0000-4000-8000-00000000000c','authenticated','authenticated','jsl-v@inha.edu',now(),false),
 ('a1110000-0000-4000-8000-00000000000d','authenticated','authenticated',null,null,true),
 ('a1110000-0000-4000-8000-00000000000e','authenticated','authenticated','jsl-ban@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a1110000-0000-4000-8000-00000000000a','정석A',false),
 ('a1110000-0000-4000-8000-00000000000b','정석B',false),
 ('a1110000-0000-4000-8000-00000000000c','정석인증',false),
 ('a1110000-0000-4000-8000-00000000000d','정석손님',false),
 ('a1110000-0000-4000-8000-00000000000e','정석정지',true);

create function pg_temp.as_user(p_uid text, p_anonymous boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub',p_uid,'role','authenticated','is_anonymous',p_anonymous)::text, true);
$$;
create function pg_temp.coin(p_uid uuid) returns bigint language sql as $$
  select coalesce((select balance from private.world_wallets where user_id=p_uid and currency_id='currency.induck_coin'),0);
$$;
create function pg_temp.ledger(p_uid uuid) returns bigint language sql as $$
  select count(*) from private.world_currency_transactions where user_id=p_uid and source_type='jeongseok_pass';
$$;
grant execute on function pg_temp.as_user(text,boolean), pg_temp.coin(uuid), pg_temp.ledger(uuid) to authenticated;

-- ---- defaults: confirmed terms, closed rollout, migration-owned catalogs ----
select is((select status from private.world_jeongseok_gate_policy),'COMING_SOON','gate ships closed');
select is((select status from private.world_jeongseok_pass_catalog where pass_type='jeongseok.visitor.day'),'COMING_SOON','pass ships closed');
select is((select price_basis from private.world_jeongseok_pass_catalog where pass_type='jeongseok.visitor.day'),'CONFIRMED','approved terms are confirmed without activating sales');
select is((select currency_id from private.world_jeongseok_pass_catalog where pass_type='jeongseok.visitor.day'),'currency.induck_coin','confirmed currency is Induck Coin');
select is((select price from private.world_jeongseok_pass_catalog where pass_type='jeongseok.visitor.day'),100::bigint,'confirmed price 100');
select is((select duration_seconds from private.world_jeongseok_pass_catalog where pass_type='jeongseok.visitor.day'),86400,'real-time 24h');
select is((select count(*) from private.world_jeongseok_pass_catalog),1::bigint,'exactly one P0 product');

-- ---- surface: RPC only, self-only signatures, no table access ----
select ok(has_function_privilege('authenticated','public.get_jeongseok_access_v1()','execute'),'authenticated reads own access');
select ok(has_function_privilege('authenticated','public.purchase_jeongseok_pass_v1(text,text)','execute'),'authenticated purchases own pass');
select ok(not has_function_privilege(r,f,'execute'),format('%s cannot execute %s',r,f))
from unnest(array['anon','service_role']) r,
 unnest(array['public.get_jeongseok_access_v1()','public.purchase_jeongseok_pass_v1(text,text)']) f;
select ok(not has_function_privilege(r,f,'execute'),format('%s cannot execute %s',r,f))
from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.world_jeongseok_access_v1()','private.world_jeongseok_purchase_result_v1(uuid,boolean)',
   'private.world_wallet_apply_v1(uuid,text,bigint,text,text,text,text,text)']) f;
select is((select count(*) from pg_proc where proname in ('get_jeongseok_access_v1','purchase_jeongseok_pass_v1')
  and pronamespace='public'::regnamespace and 'uuid'::regtype = any(proargtypes::regtype[])),0::bigint,
  'no public JSL-A function accepts an account id');
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.world_jeongseok_gate_policy','private.world_jeongseok_pass_catalog',
   'private.world_jeongseok_pass_purchases','private.world_jeongseok_pass_entitlements']) t,
 unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.world_jeongseok_gate_policy'::regclass,
  'private.world_jeongseok_pass_catalog'::regclass,'private.world_jeongseok_pass_purchases'::regclass,
  'private.world_jeongseok_pass_entitlements'::regclass)),'all JSL-A tables use RLS');

-- ---- closed gate: no price, no purchase, no decision detail ----
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000a');
select is(public.get_jeongseok_access_v1()->>'decision','COMING_SOON','closed gate reads COMING_SOON');
select is(public.get_jeongseok_access_v1()->'offer','null'::jsonb,'closed gate hides even a confirmed price');
select is((public.get_jeongseok_access_v1()->>'granted')::boolean,false,'closed gate grants nobody');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-closed-1')$$,
  'P0001','JEONGSEOK_GATE_UNAVAILABLE','closed gate cannot move value');
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000c');
select is(public.get_jeongseok_access_v1()->>'decision','COMING_SOON','term confirmation does not open the gate for verified accounts');
reset role;
select is(pg_temp.ledger('a1110000-0000-4000-8000-00000000000a'),0::bigint,'closed gate wrote no ledger row');
select is((select count(*) from private.world_jeongseok_pass_purchases),0::bigint,'closed gate wrote no receipt');
select is((select count(*) from private.world_jeongseok_pass_entitlements),0::bigint,'closed gate issued no pass');

-- ---- gate open, product still closed: verified enter free, others see no price ----
update private.world_jeongseok_gate_policy set status='ACTIVE';
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000c');
select is(public.get_jeongseok_access_v1()->>'decision','GRANTED','Inha mail verified account is granted');
select is(public.get_jeongseok_access_v1()->>'via','INHA_MAIL','free entry is via the existing mail badge');
select is(public.get_jeongseok_access_v1()->'offer','null'::jsonb,'verified account is never offered a pass');
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000a');
select is(public.get_jeongseok_access_v1()->>'decision','NEEDS_PASS','general account needs a pass');
select is(public.get_jeongseok_access_v1()->'offer'->>'status','COMING_SOON','closed product state is visible');
select is(public.get_jeongseok_access_v1()->'offer'->'price','null'::jsonb,'closed product hides even a confirmed price');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-closed-2')$$,
  'P0001','PASS_UNAVAILABLE','closed product cannot be bought');
reset role;

-- ---- candidate price is not publishable, including by an accidental ops update ----
-- The approved seed is CONFIRMED; deliberately downgrade this transaction-only fixture
-- to retain regression coverage of the original candidate-price safety constraint.
update private.world_jeongseok_pass_catalog set price_basis='CANDIDATE' where pass_type='jeongseok.visitor.day';
select throws_ok('update private.world_jeongseok_pass_catalog set status=''ACTIVE'' where pass_type=''jeongseok.visitor.day''',
  '23514','new row for relation "world_jeongseok_pass_catalog" violates check constraint "world_jeongseok_pass_catalog_confirmed_active"',
  'candidate price cannot be activated');
select is((select status from private.world_jeongseok_pass_catalog where pass_type='jeongseok.visitor.day'),
  'COMING_SOON','failed activation keeps the product closed');

-- ---- confirmed test-only product open: balance and price come from the server ----
update private.world_jeongseok_pass_catalog
  set price_basis='CONFIRMED', status='ACTIVE' where pass_type='jeongseok.visitor.day';
select private.world_wallet_apply_v1('a1110000-0000-4000-8000-00000000000a','currency.induck_coin',99,'REWARD','test','jsl-seed','jsl-test:seed:a',null);
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000a');
select is((public.get_jeongseok_access_v1()->'offer'->>'price')::bigint,100::bigint,'server price');
select is((public.get_jeongseok_access_v1()->'offer'->>'balance')::bigint,99::bigint,'server balance');
select is((public.get_jeongseok_access_v1()->'offer'->>'shortfall')::bigint,1::bigint,'exact shortfall');
select is((public.get_jeongseok_access_v1()->'offer'->>'canPurchase')::boolean,false,'99 coins cannot purchase');
select ok((public.get_jeongseok_access_v1()->>'serverNow') is not null,'server clock is returned');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-poor')$$,
  'P0001','INSUFFICIENT_FUNDS','99 coins is refused');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.week','jsl-a-week')$$,
  '22023','INVALID_PASS_TYPE','unknown pass type is refused');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day',' bad key')$$,
  '22023','INVALID_IDEMPOTENCY_KEY','malformed key is refused');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day',null)$$,
  '22023','INVALID_IDEMPOTENCY_KEY','null key is refused');
reset role;
select is(pg_temp.coin('a1110000-0000-4000-8000-00000000000a'),99::bigint,'refusals moved nothing');
select is(pg_temp.ledger('a1110000-0000-4000-8000-00000000000a'),0::bigint,'refusals wrote no ledger row');
select is((select count(*) from private.world_jeongseok_pass_purchases),0::bigint,'refusals wrote no receipt');

-- ---- mid-transaction failure rolls back debit and receipt ----
select private.world_wallet_apply_v1('a1110000-0000-4000-8000-00000000000a','currency.induck_coin',151,'REWARD','test','jsl-seed','jsl-test:seed:a2',null);
create function pg_temp.fail_entitlement() returns trigger language plpgsql as $$
begin raise exception 'INJECTED_ENTITLEMENT_FAILURE'; end; $$;
create trigger jsl_fault before insert on private.world_jeongseok_pass_entitlements
  for each row execute function pg_temp.fail_entitlement();
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000a');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-fault')$$,
  'P0001','INJECTED_ENTITLEMENT_FAILURE','failure after the debit aborts the purchase');
reset role;
drop trigger jsl_fault on private.world_jeongseok_pass_entitlements;
select is(pg_temp.coin('a1110000-0000-4000-8000-00000000000a'),250::bigint,'injected failure rolled the debit back');
select is(pg_temp.ledger('a1110000-0000-4000-8000-00000000000a'),0::bigint,'injected failure left no ledger row');
select is((select count(*) from private.world_jeongseok_pass_purchases),0::bigint,'injected failure left no receipt');
select is((select count(*) from private.world_currency_transactions where idempotency_key='jeongseok/jsl-a-fault/wallet'),0::bigint,
  'failed key is free to retry');

-- ---- success, replay and duplicate protection ----
create temp table jsl_first(result jsonb);
grant select, insert on jsl_first to authenticated;
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000a');
insert into jsl_first select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-1');
select is((select result->>'status' from jsl_first),'SUCCESS','100 coins buys the pass');
select is((select (result->>'price')::bigint from jsl_first),100::bigint,'receipt price from the catalog');
select is((select (result->>'balanceAfter')::bigint from jsl_first),150::bigint,'receipt balance math');
select is((select (result->>'expiresAt')::timestamptz - (result->>'issuedAt')::timestamptz from jsl_first),interval '24 hours',
  'server-issued 24h window');
select is((select result->'access'->>'decision' from jsl_first),'GRANTED','purchase reads back GRANTED');
select is((select result->'access'->>'via' from jsl_first),'VISITOR_PASS','granted via the visitor pass');
select is(public.get_jeongseok_access_v1()->>'via','VISITOR_PASS','access read agrees');
select is(public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-1')->>'status','ALREADY_PROCESSED',
  'same key replays the receipt');
select is(public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-1')->>'purchaseId',
  (select result->>'purchaseId' from jsl_first),'replay returns the original purchase');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-2')$$,
  'P0001','PASS_ALREADY_ACTIVE','a new key cannot buy a second active pass');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.other','jsl-a-1')$$,
  '23505','IDEMPOTENCY_CONFLICT','same key cannot change the product');
reset role;
select is(pg_temp.coin('a1110000-0000-4000-8000-00000000000a'),150::bigint,'exactly one debit');
select is(pg_temp.ledger('a1110000-0000-4000-8000-00000000000a'),1::bigint,'exactly one ledger row');
select is((select amount from private.world_currency_transactions where user_id='a1110000-0000-4000-8000-00000000000a'
  and source_type='jeongseok_pass'),-100::bigint,'ledger row is the server price');
select is((select type from private.world_currency_transactions where user_id='a1110000-0000-4000-8000-00000000000a'
  and source_type='jeongseok_pass'),'PURCHASE','ledger row is a PURCHASE');
select is((select wallet_transaction_id from private.world_jeongseok_pass_purchases where idempotency_key='jsl-a-1'),
  (select transaction_id from private.world_currency_transactions where idempotency_key='jeongseok/jsl-a-1/wallet'),
  'receipt links the ledger row');
select is((select sum(amount)::bigint from private.world_currency_transactions where user_id='a1110000-0000-4000-8000-00000000000a'),
  pg_temp.coin('a1110000-0000-4000-8000-00000000000a'),'Wallet invariant: ledger sum equals balance');
select throws_ok($$update private.world_jeongseok_pass_purchases set price=1$$,'42501','JEONGSEOK_PASS_RECEIPT_APPEND_ONLY','receipt cannot be rewritten');
select throws_ok($$delete from private.world_jeongseok_pass_purchases$$,'42501','JEONGSEOK_PASS_RECEIPT_APPEND_ONLY','live receipt cannot be removed');

-- ---- account isolation ----
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000b');
select is(public.get_jeongseok_access_v1()->>'decision','NEEDS_PASS','B does not see A''s pass');
select is(public.get_jeongseok_access_v1()->'pass','null'::jsonb,'B reads no pass detail');
select is((public.get_jeongseok_access_v1()->'offer'->>'balance')::bigint,0::bigint,'B reads only its own balance');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-1')$$,
  '23505','IDEMPOTENCY_CONFLICT','B cannot replay A''s receipt by key');
-- A client-side "verified" or forged mail claim is not authority.
select set_config('request.jwt.claims','{"sub":"a1110000-0000-4000-8000-00000000000b","role":"authenticated","is_anonymous":false,"email":"forged@inha.edu","inhaVerified":true,"user_metadata":{"inha_mail_verified":true}}',true);
select is(public.get_jeongseok_access_v1()->>'decision','NEEDS_PASS','forged claims do not grant entry');
reset role;
select is(pg_temp.ledger('a1110000-0000-4000-8000-00000000000b'),0::bigint,'B was never charged');

-- ---- verification state changes are read live ----
insert into public.inha_mail_badges(user_id,email) values ('a1110000-0000-4000-8000-00000000000b','jsl-b-school@inha.ac.kr');
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000b');
select is(public.get_jeongseok_access_v1()->>'via','INHA_MAIL','newly verified account is granted free');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-b-1')$$,
  'P0001','FREE_ACCESS_ELIGIBLE','verified account is never charged');
reset role;
delete from public.inha_mail_badges where user_id='a1110000-0000-4000-8000-00000000000b';
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000b');
select is(public.get_jeongseok_access_v1()->>'decision','NEEDS_PASS','removed verification is reflected');
reset role;

-- ---- server-clock expiry and renewal ----
update private.world_jeongseok_pass_entitlements set issued_at=now()-interval '25 hours', expires_at=now()-interval '1 second'
 where user_id='a1110000-0000-4000-8000-00000000000a';
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000a');
select is(public.get_jeongseok_access_v1()->>'decision','EXPIRED','expired pass is refused');
select is((public.get_jeongseok_access_v1()->>'granted')::boolean,false,'expired pass grants nothing');
select is((public.get_jeongseok_access_v1()->'pass'->>'active')::boolean,false,'expired pass reads inactive');
select is(public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-renew')->>'status','SUCCESS','expired pass can be renewed');
select is(public.get_jeongseok_access_v1()->>'via','VISITOR_PASS','renewal grants entry');
reset role;
select is((select count(*) from private.world_jeongseok_pass_purchases where user_id='a1110000-0000-4000-8000-00000000000a'),2::bigint,
  'renewal keeps the first receipt');
select is((select count(*) from private.world_jeongseok_pass_entitlements where user_id='a1110000-0000-4000-8000-00000000000a'),1::bigint,
  'one current right per account');
select is(pg_temp.coin('a1110000-0000-4000-8000-00000000000a'),50::bigint,'renewal debited once');

-- ---- anonymous, stored-anonymous and banned accounts ----
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000d', true);
select is(public.get_jeongseok_access_v1()->>'decision','AUTH_REQUIRED','anonymous session needs a permanent login');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-anon-1')$$,
  '42501','PERMANENT_ACCOUNT_REQUIRED','anonymous session cannot buy');
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000d', false);
select is(public.get_jeongseok_access_v1()->>'decision','AUTH_REQUIRED','stored anonymous account is refused despite a permanent claim');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-anon-2')$$,
  '42501','ACCOUNT_UNAVAILABLE','stored anonymous account cannot buy');
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000e');
select is(public.get_jeongseok_access_v1()->>'decision','ACCOUNT_BLOCKED','banned account is refused');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-ban-1')$$,
  '42501','ACCOUNT_UNAVAILABLE','banned account cannot buy');
select set_config('request.jwt.claims','',true);
select is(public.get_jeongseok_access_v1()->>'decision','AUTH_REQUIRED','no session is refused');
reset role;
update public.profiles set is_banned=true where user_id='a1110000-0000-4000-8000-00000000000a';
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000a');
select is(public.get_jeongseok_access_v1()->>'decision','ACCOUNT_BLOCKED','a valid pass does not survive a ban');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-1')$$,
  '42501','ACCOUNT_UNAVAILABLE','banned buyer cannot replay');
reset role;
update public.profiles set is_banned=false where user_id='a1110000-0000-4000-8000-00000000000a';

-- ---- maintenance close: entry stops, receipts stay recoverable ----
update private.world_jeongseok_gate_policy set status='DISABLED';
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000a');
select is(public.get_jeongseok_access_v1()->>'decision','DISABLED','disabled gate refuses even a valid pass');
select is(public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-renew')->>'status','ALREADY_PROCESSED',
  'lost response is still recoverable while the gate is disabled');
select throws_ok($$select public.purchase_jeongseok_pass_v1('jeongseok.visitor.day','jsl-a-3')$$,
  'P0001','JEONGSEOK_GATE_UNAVAILABLE','disabled gate sells nothing');
reset role;

-- ---- Room bypass: no Realtime room channel accepts a Jeongseok topic ----
set local role authenticated;
select pg_temp.as_user('a1110000-0000-4000-8000-00000000000c');
select is(public.can_access_world_room_realtime_v1('world:room:ROOM_JEONGSEOK_LOBBY'),false,
  'personal-room Realtime predicate rejects a Jeongseok room topic');
reset role;

-- ---- account deletion cascades the append-only receipts ----
select lives_ok($$delete from auth.users where id='a1110000-0000-4000-8000-00000000000a'$$,'account deletion cascades');
select is((select count(*) from private.world_jeongseok_pass_purchases where user_id='a1110000-0000-4000-8000-00000000000a'),0::bigint,
  'deleted account keeps no receipt');
select is((select count(*) from private.world_jeongseok_pass_entitlements where user_id='a1110000-0000-4000-8000-00000000000a'),0::bigint,
  'deleted account keeps no right');

select * from finish();
rollback;
