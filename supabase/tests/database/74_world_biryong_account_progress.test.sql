begin;
select plan(13);

select has_table('private', 'world_biryong_progress_v1', 'Biryong account progress table exists');
select ok((select relrowsecurity from pg_class where oid = 'private.world_biryong_progress_v1'::regclass),
  'Biryong table has RLS');
select ok(not has_table_privilege('authenticated', 'private.world_biryong_progress_v1', 'select'),
  'players cannot read private table directly');
select ok(has_function_privilege('authenticated', 'public.get_my_biryong_progress_v1()', 'execute'),
  'authenticated account can read its own Biryong snapshot');
select ok(has_function_privilege('authenticated', 'public.merge_my_biryong_progress_v1(jsonb,boolean)', 'execute'),
  'authenticated account can merge its own Biryong snapshot');

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('b1000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'biryong-a@example.test', now(), false),
 ('b2000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'biryong-b@example.test', now(), false),
 ('b3000000-0000-4000-8000-0000000000b3', 'authenticated', 'authenticated', null, now(), true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-0000000000b1","role":"authenticated","is_anonymous":false}', true);

select is(public.get_my_biryong_progress_v1(), null::jsonb, 'fresh account has no BR01 progress');
select lives_ok($$
  select public.merge_my_biryong_progress_v1(
    '{"discoveredAt":1000,"step":"COMPLETE","lore":["CAMPUS_LORE_BIRYONG_01","CAMPUS_LORE_BIRYONG_02"],"shouts":2,"completedAt":4000}'::jsonb,
    true)
$$, 'account can migrate legacy completion');
select is(public.get_my_biryong_progress_v1()->>'step', 'COMPLETE', 'completion is stored');
select is((public.get_my_biryong_progress_v1()->>'shouts')::int, 2, 'shout count is stored');

select public.merge_my_biryong_progress_v1(
  '{"discoveredAt":2000,"step":"FIND_CENTER","lore":[],"shouts":1,"completedAt":null}'::jsonb, false);
select is(public.get_my_biryong_progress_v1()->>'step', 'COMPLETE', 'older device cannot regress completion');

select set_config('request.jwt.claims',
  '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select is(public.get_my_biryong_progress_v1(), null::jsonb, 'another account does not inherit completion');

select set_config('request.jwt.claims',
  '{"sub":"b3000000-0000-4000-8000-0000000000b3","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$select public.get_my_biryong_progress_v1()$$, '42501', null, 'anonymous account cannot read');
select throws_ok($$select public.merge_my_biryong_progress_v1('{}'::jsonb,false)$$, '42501', null, 'anonymous account cannot merge');

reset role;
select * from finish();
rollback;
