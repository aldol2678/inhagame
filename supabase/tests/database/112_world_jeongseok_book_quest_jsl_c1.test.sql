-- JSL-C1 pgtap: disposable-only isolated auth, stage ordering, account isolation, no awards.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
('c1110000-0000-4000-8000-000000000001','authenticated','authenticated','jslc1-a@example.test',now(),false),
('c1110000-0000-4000-8000-000000000002','authenticated','authenticated','jslc1-b@example.test',now(),false),
('c1110000-0000-4000-8000-000000000003','authenticated','authenticated','jslc1-ban@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
('c1110000-0000-4000-8000-000000000001','서가A',false),
('c1110000-0000-4000-8000-000000000002','서가B',false),
('c1110000-0000-4000-8000-000000000003','서가Ban',true);
create function pg_temp.jslauth(p_id text) returns void language sql as $$
select set_config('request.jwt.claims',json_build_object('sub',p_id,'role','authenticated','is_anonymous',false)::text,true);
$$;
grant execute on function pg_temp.jslauth(text) to authenticated;
select ok(has_function_privilege('authenticated','public.advance_jeongseok_book_quest_v1(text)','execute'),'authenticated can call quest');
select ok(not has_function_privilege('anon','public.advance_jeongseok_book_quest_v1(text)','execute'),'anonymous cannot call quest');
select ok(not has_table_privilege('authenticated','private.world_jeongseok_book_quest_v1','SELECT'),'no raw progress read');
set local role authenticated;
select pg_temp.jslauth('c1110000-0000-4000-8000-000000000001');
select is((public.advance_jeongseok_book_quest_v1('status')->>'stage')::int,0,'new account stage zero');
select is((public.advance_jeongseok_book_quest_v1('report')->>'stage')::int,0,'cannot skip');
select is((public.advance_jeongseok_book_quest_v1('start')->>'stage')::int,1,'accept');
select is((public.advance_jeongseok_book_quest_v1('start')->>'stage')::int,1,'duplicate accept');
select is((public.advance_jeongseok_book_quest_v1('select:pride_prejudice')->>'stage')::int,1,'no select before search');
select is((public.advance_jeongseok_book_quest_v1('search')->>'stage')::int,2,'search');
select is((public.advance_jeongseok_book_quest_v1('search')->>'stage')::int,2,'duplicate search');
select is((public.advance_jeongseok_book_quest_v1('select:pride_prejudice')->>'stage')::int,3,'correct author book');
select is((public.advance_jeongseok_book_quest_v1('report')->>'stage')::int,4,'report');
select is((public.advance_jeongseok_book_quest_v1('report')->>'stage')::int,4,'duplicate report');
select is(public.advance_jeongseok_book_quest_v1('status')->'reward','null'::jsonb,'no reward');
select throws_ok($$select public.advance_jeongseok_book_quest_v1('select:wrong_book')$$,'22023','INVALID_BOOK_QUEST_EVENT','invalid sample ID');
select pg_temp.jslauth('c1110000-0000-4000-8000-000000000002');
select is((public.advance_jeongseok_book_quest_v1('status')->>'stage')::int,0,'different account fresh');
select pg_temp.jslauth('c1110000-0000-4000-8000-000000000003');
select throws_ok($$select public.advance_jeongseok_book_quest_v1('start')$$,'42501','ACCOUNT_UNAVAILABLE','banned account blocked');
reset role;
select is((select count(*) from private.world_jeongseok_book_quest_v1),1::bigint,'no status-only row created');
select * from finish();
rollback;
