-- Grow account saves: guest denial, per-user isolation and optimistic revisions.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a1a1a1a1-0000-4000-8000-000000000001','authenticated','authenticated','grow-a@example.test',now(),false),
 ('b2b2b2b2-0000-4000-8000-000000000002','authenticated','authenticated','grow-b@example.test',now(),false),
 ('c3c3c3c3-0000-4000-8000-000000000003','authenticated','authenticated',null,null,true);
select is((select status from public.games where slug='induck-grow'),'production','Grow is a separate production game');
set local role anon;
select throws_ok($$select public.save_my_grow_progress('{}'::jsonb,null)$$,'42501',null,'anon cannot save');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"c3c3c3c3-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}';
select throws_ok($$select public.save_my_grow_progress('{}'::jsonb,null)$$,'42501','PERMANENT_ACCOUNT_REQUIRED','guest cannot save');
set local request.jwt.claims='{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select public.save_my_grow_progress('{"week":5,"phase":"semester"}'::jsonb,null,true) as grow_rev \gset
select throws_ok($$select public.save_my_grow_progress('{"week":1}'::jsonb,null)$$,'40001','GROW_SAVE_CONFLICT','second insert cannot overwrite');
select throws_ok($$select public.save_my_grow_progress('{"week":1}'::jsonb,'2000-01-01'::timestamptz)$$,'40001','GROW_SAVE_CONFLICT','stale revision cannot overwrite');
select lives_ok(format('select public.save_my_grow_progress(''{"week":6,"phase":"semester"}''::jsonb,%L::timestamptz)', :'grow_rev'), 'matching revision updates');
select results_eq($$select progress->>'week' from public.get_my_game_progress('induck-grow')$$,$$values ('6'::text)$$,'read returns own updated save');
select updated_at::text as grow_rev from public.user_game_progress where user_id=auth.uid() limit 1 \gset
set local request.jwt.claims='{"sub":"b2b2b2b2-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select is_empty($$select * from public.get_my_game_progress('induck-grow')$$,'other user cannot read');
select throws_ok(format('select public.delete_my_grow_progress(%L::timestamptz)', :'grow_rev'),'40001','GROW_SAVE_CONFLICT','other user cannot delete');
set local request.jwt.claims='{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select lives_ok(format('select public.delete_my_grow_progress(%L::timestamptz)', :'grow_rev'),'owner deletes own save');
select is_empty($$select * from public.get_my_game_progress('induck-grow')$$,'deleted save is absent');
reset role;
select * from finish();
rollback;
