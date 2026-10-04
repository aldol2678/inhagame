-- INHA WORLD Life Skill Book P0 (20261004138000): self-only reads and actions.
-- Activations below are fixtures and roll back. Calls run as the authenticated role.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9840000-0000-4000-8000-0000000000a9','authenticated','authenticated','book-a@example.test',now(),false),
 ('b9840000-0000-4000-8000-0000000000b9','authenticated','authenticated','book-b@example.test',now(),false),
 ('c9840000-0000-4000-8000-0000000000c9','authenticated','authenticated',null,null,true);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9840000-0000-4000-8000-0000000000a9','도감A',false),
 ('b9840000-0000-4000-8000-0000000000b9','도감정지',true),
 ('c9840000-0000-4000-8000-0000000000c9','도감게스트',false);

create function pg_temp.as_user(p_user text, p_anonymous boolean default false) returns void language plpgsql as $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub',p_user,'role','authenticated','is_anonymous',p_anonymous)::text,true);
end;
$$;

-- ---- surface ----
select ok(has_function_privilege('authenticated',f,'execute'),format('authenticated may call %s',f))
from unnest(array['public.get_my_world_life_skills_v1()','public.get_my_world_life_skill_tree_v1(text)',
  'public.unlock_my_world_life_node_v1(text,uuid)','public.reset_my_world_life_tree_v1(text,uuid)']) f;
select ok(not has_function_privilege('anon',f,'execute'),format('anon cannot call %s',f))
from unnest(array['public.get_my_world_life_skills_v1()','public.get_my_world_life_skill_tree_v1(text)',
  'public.unlock_my_world_life_node_v1(text,uuid)','public.reset_my_world_life_tree_v1(text,uuid)']) f;
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('get_my_world_life_skills_v1','get_my_world_life_skill_tree_v1',
    'unlock_my_world_life_node_v1','reset_my_world_life_tree_v1')
    and pg_get_function_identity_arguments(p.oid) ~ '(^|, )p_user '),0::bigint,'no Life Book RPC takes a user id');

-- ---- nothing is visible while every skill is COMING_SOON ----
select pg_temp.as_user('a9840000-0000-4000-8000-0000000000a9');
select is(public.get_my_world_life_skills_v1()->'skills','[]'::jsonb,'the book is empty before any activation');
select throws_ok($$select public.get_my_world_life_skill_tree_v1('life.fishing')$$,
  'P0002','LIFE_SKILL_NOT_FOUND','a COMING_SOON skill is not visible');
select throws_ok($$select public.get_my_world_life_skill_tree_v1('life.nope')$$,
  'P0002','LIFE_SKILL_NOT_FOUND','an unknown skill looks the same as a hidden one');
select throws_ok($$select public.unlock_my_world_life_node_v1('life.node.fishing.steady_hands',gen_random_uuid())$$,
  'P0002','LIFE_NODE_NOT_FOUND','a hidden node cannot be unlocked');
reset role;

select pg_temp.as_user('c9840000-0000-4000-8000-0000000000c9',true);
select throws_ok($$select public.get_my_world_life_skills_v1()$$,'42501','PERMANENT_ACCOUNT_REQUIRED','guests have no Life Skill Book');
reset role;
select pg_temp.as_user('b9840000-0000-4000-8000-0000000000b9');
select throws_ok($$select public.get_my_world_life_skills_v1()$$,'42501','ACCOUNT_UNAVAILABLE','banned accounts have no Life Skill Book');
reset role;

-- ---- fixtures: fishing visible, one fishing node still hidden ----
update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.fishing';
update private.world_life_skill_tree_catalog set status='ACTIVE' where skill_id='life.fishing'
  and node_id <> 'life.node.fishing.deep_sea_fishing';
select private.world_life_skill_xp_apply_v1('a9840000-0000-4000-8000-0000000000a9','life.fishing',1000,
  'activity','activity.fishing.inkyung:book','book:xp');

select pg_temp.as_user('a9840000-0000-4000-8000-0000000000a9');
select is(jsonb_array_length(public.get_my_world_life_skills_v1()->'skills'),1,'only the ACTIVE skill is listed');
select is(public.get_my_world_life_skills_v1()->'skills'->0,
  jsonb_build_object('skillId','life.fishing','level',5,'totalXp',1000,'currentLevelStartXp',1000,'nextLevelXp',1500,
    'maxDefinedLevel',20,'isMaxLevel',false,
    'sp',jsonb_build_object('earned',5,'spent',0,'available',5,'nextLevelEarned',6)),
  'skill view: level, XP progress and the per-skill SP pool');

create temp table book_tree as select public.get_my_world_life_skill_tree_v1('life.fishing') as v;
select is(jsonb_array_length((select v->'nodes' from book_tree)),5,'a hidden node is not listed');
select results_eq($$
  select n->>'nodeId',(n->>'canUnlock')::boolean,n->>'lockReason',(n->>'nextRankCost')::int
    from book_tree,jsonb_array_elements(v->'nodes') n order by 1
$$,$$values
  ('life.node.fishing.baitcraft'::text,false,'PREREQUISITE'::text,1),
  ('life.node.fishing.boat_fishing',false,'PREREQUISITE',2),
  ('life.node.fishing.fish_sense',false,'PREREQUISITE',1),
  ('life.node.fishing.rare_fish_sense',false,'PREREQUISITE',2),
  ('life.node.fishing.steady_hands',true,null,1)
$$,'the server decides unlockability, reason and cost per node');
select is((select v->'reset' from book_tree) - 'cooldownSeconds',
  jsonb_build_object('cost',0,'lastResetAt',null,'nextResetAt',null,'canReset',false,'resetBlockedBy','EMPTY'),
  'nothing to reset yet');

-- ---- unlock / rank-up ----
create temp table book_req(name text primary key, id uuid) on commit drop;
insert into book_req values ('u1',gen_random_uuid()),('u2',gen_random_uuid()),('u3',gen_random_uuid()),
  ('u4',gen_random_uuid()),('u5',gen_random_uuid()),('r1',gen_random_uuid()),('r2',gen_random_uuid());
grant select on book_req to authenticated;

select is(public.unlock_my_world_life_node_v1('life.node.fishing.steady_hands',(select id from book_req where name='u1'))
  ->>'rankAfter','1','rank 1 acquired by the caller');
select is(public.unlock_my_world_life_node_v1('life.node.fishing.steady_hands',(select id from book_req where name='u1'))
  ->>'status','ALREADY_PROCESSED','the same request id replays');
select is(public.unlock_my_world_life_node_v1('life.node.fishing.steady_hands',(select id from book_req where name='u2'))
  ->>'rankAfter','2','a new request id ranks up');
select throws_ok($$select public.unlock_my_world_life_node_v1('life.node.fishing.deep_sea_fishing',gen_random_uuid())$$,
  'P0002','LIFE_NODE_NOT_FOUND','a hidden node in a visible tree cannot be unlocked');
select public.unlock_my_world_life_node_v1('life.node.fishing.fish_sense',(select id from book_req where name='u3'));
select public.unlock_my_world_life_node_v1('life.node.fishing.fish_sense',(select id from book_req where name='u4'));
select is((select n->>'lockReason' from jsonb_array_elements(
  public.unlock_my_world_life_node_v1('life.node.fishing.baitcraft',(select id from book_req where name='u5'))->'tree'->'nodes') n
  where n->>'nodeId'='life.node.fishing.steady_hands'),'SP','the returned tree shows the pool is spent');
select throws_ok($$select public.unlock_my_world_life_node_v1('life.node.fishing.steady_hands',gen_random_uuid())$$,
  'P0001','LIFE_SP_INSUFFICIENT','the authority refuses what the hint marked as SP');
select is((select n->>'lockReason' from jsonb_array_elements(public.get_my_world_life_skill_tree_v1('life.fishing')->'nodes') n
  where n->>'nodeId'='life.node.fishing.rare_fish_sense'),'SKILL_LEVEL','a met prerequisite moves the reason to the skill level');
select is((select n->'prerequisites' from jsonb_array_elements(public.get_my_world_life_skill_tree_v1('life.fishing')->'nodes') n
  where n->>'nodeId'='life.node.fishing.boat_fishing'),
  '[{"nodeId":"life.node.fishing.fish_sense","requiredRank":2,"visible":true,"met":true}]'::jsonb,
  'prerequisite status is reported per edge');

-- ---- free reset ----
select is(public.get_my_world_life_skill_tree_v1('life.fishing')->'reset'->>'canReset','true','a spent tree can be reset');
select results_eq($$
  select r->>'status',(r->>'refundedSp')::int,(r->'tree'->'skill'->'sp'->>'available')::int,
         r->'tree'->'reset'->>'resetBlockedBy'
    from (select public.reset_my_world_life_tree_v1('life.fishing',(select id from book_req where name='r1')) r) x
$$,$$values ('SUCCESS'::text,5,5,'EMPTY'::text)$$,'free reset refunds everything; nothing left to reset');
select is(public.reset_my_world_life_tree_v1('life.fishing',(select id from book_req where name='r1'))->>'status',
  'ALREADY_PROCESSED','the same reset request replays');
select public.unlock_my_world_life_node_v1('life.node.fishing.steady_hands',gen_random_uuid());
select results_eq($$
  select r->>'canReset',r->>'resetBlockedBy',(r->>'nextResetAt') is not null,(r->>'cooldownSeconds')::int
    from (select public.get_my_world_life_skill_tree_v1('life.fishing')->'reset' r) x
$$,$$values ('false'::text,'COOLDOWN'::text,true,86400)$$,'the cooldown is reported with nextResetAt');
select throws_ok($$select public.reset_my_world_life_tree_v1('life.fishing',gen_random_uuid())$$,
  'P0001','LIFE_TREE_RESET_COOLDOWN','the authority enforces the cooldown');
select throws_ok($$select public.reset_my_world_life_tree_v1('life.mining',gen_random_uuid())$$,
  'P0002','LIFE_SKILL_NOT_FOUND','a hidden skill cannot be reset');
reset role;

select * from finish();
rollback;
