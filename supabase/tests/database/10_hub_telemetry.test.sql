-- Hub telemetry contract: log_inhagame_hub_event_v1 / log_inhagame_game_entry_v1 called the way
-- apps/world/api calls them (as anon), and get_inhagame_hub_ops_v1 for OPS (service role).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixed ids: s = session, v = visitor, c = hub click (= entry id), e = game stage event.
\set s1 '''a0000000-0000-4000-8000-000000000001'''
\set v1 '''b0000000-0000-4000-8000-000000000001'''
\set s2 '''a0000000-0000-4000-8000-000000000002'''
\set v2 '''b0000000-0000-4000-8000-000000000002'''
\set s3 '''a0000000-0000-4000-8000-000000000003'''
\set v3 '''b0000000-0000-4000-8000-000000000003'''
\set c_classic '''c0000000-0000-4000-8000-000000000001'''
\set c_induckup '''c0000000-0000-4000-8000-000000000002'''
\set c_campus '''c0000000-0000-4000-8000-000000000003'''
\set c_old '''c0000000-0000-4000-8000-000000000004'''
\set c_recent '''c0000000-0000-4000-8000-000000000005'''
\set c_profile '''c0000000-0000-4000-8000-000000000006'''
\set c_grow '''c0000000-0000-4000-8000-000000000007'''
\set e_land '''e0000000-0000-4000-8000-000000000001'''

-- ---- hub events (as the anon Data API role) ----
set local role anon;
select is(public.log_inhagame_hub_event_v1(:c_classic, :s1, :v1, 'hub_game_click', 'home', 'classic'), true,
  'valid hub_game_click is accepted');
select is(public.log_inhagame_hub_event_v1(:c_induckup, :s1, :v1, 'hub_game_click', 'ranking', 'induckup'), true,
  'hub_game_click from the ranking panel is accepted');
select is(public.log_inhagame_hub_event_v1(:c_campus, :s1, :v1, 'campus_entry_click', 'home', 'campus'), true,
  'campus_entry_click is accepted');
select is(public.log_inhagame_hub_event_v1(gen_random_uuid(), :s1, :v1, 'hub_visit', 'home'), true,
  'hub_visit with the default null target is accepted');
select is(public.log_inhagame_hub_event_v1(:c_classic, :s1, :v1, 'hub_game_click', 'home', 'classic'), true,
  'a resent hub event_id is accepted (idempotent)');
select is(public.log_inhagame_hub_event_v1(gen_random_uuid(), :s1, :v1, 'game_landing', 'game', 'classic'), false,
  'game stages cannot be written through the hub RPC');
select is(public.log_inhagame_hub_event_v1(gen_random_uuid(), :s1, :v1, 'hub_purchase', 'home', null), false,
  'unsupported hub event type is refused');
select is(public.log_inhagame_hub_event_v1(gen_random_uuid(), :s1, :v1, 'hub_game_click', 'home', 'campus'), false,
  'context check: hub_game_click cannot target campus');
select is(public.log_inhagame_hub_event_v1(gen_random_uuid(), :s1, :v1, 'hub_game_click', 'home', 'tetris'), false,
  'unknown target is refused');
select is(public.log_inhagame_hub_event_v1(null, :s1, :v1, 'hub_visit', 'home'), false, 'null event_id is refused');
select throws_ok($$select * from public.inhagame_hub_events$$, '42501', null, 'anon cannot read hub events');
select throws_ok(
  $$insert into public.inhagame_hub_events(event_id, session_id, visitor_id, event_type, surface)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'hub_visit', 'home')$$,
  '42501', null, 'anon cannot insert hub events directly');
select throws_ok($$select public.get_inhagame_hub_ops_v1()$$, '42501', null, 'anon cannot read the OPS summary');
reset role;
select is((select count(*)::int from public.inhagame_hub_events where event_id = :c_classic), 1,
  'the resent hub event is stored once');

-- ---- CORE-15 first-session funnel (browser/session pseudonyms only) ----
set local role anon;
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_session_start', 'campus', null, 'direct', null), true,
  'CORE-15 first_session_start is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_move', 'campus', null, 'direct', null), true,
  'CORE-15 first_move is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_zone_arrival', 'campus', null, 'direct', null), true,
  'CORE-15 first_zone_arrival is accepted without storing a raw zone id');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_npc_interaction', 'campus', null, 'direct', null), true,
  'CORE-15 first_npc_interaction is accepted without storing an NPC id');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_player_encounter', 'campus', null, 'direct', null), true,
  'CORE-15 first_player_encounter is accepted without storing another player id');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_activity_start', 'campus', 'inkyung_living', 'direct', null), true,
  'CORE-15 Inkyung activity start is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_activity_complete', 'campus', 'inkyung_living', 'direct', null), true,
  'CORE-15 Inkyung activity completion is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_reward', 'campus', 'first_campus', 'direct', null), true,
  'CORE-15 First Campus reward is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'core_loop_complete', 'campus', 'first_campus', 'direct', null), true,
  'CORE-15 loop completion is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'world_return', 'campus', null, 'direct', null), true,
  'CORE-15 world_return vocabulary is reserved for RETURN-1');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'next_discovery_click', 'campus', 'main2_back_gate_guide', 'direct', null), true,
  'CORE-15 next discovery click is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_reward', 'campus', null, 'direct', null), false,
  'CORE-15 reward must use the canonical first_campus target');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'first_player_encounter', 'campus', 'some-user-id', 'direct', null), false,
  'CORE-15 player encounter cannot store a player identifier');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s3, :v3, 'next_discovery_click', 'campus', 'unknown', 'direct', null), false,
  'CORE-15 next discovery target is allowlisted');
reset role;
select throws_ok(
  format($$insert into public.inhagame_hub_events(event_id, session_id, visitor_id, event_type, surface, target)
    values (gen_random_uuid(), %L, %L, 'first_reward', 'campus', null)$$, :s3, :v3),
  '23514', null, 'CORE-15 first_reward with a NULL target violates the table context check');
select is((select count(*)::int from public.inhagame_hub_events where session_id=:s3), 11,
  'CORE-15 stores exactly the 11 canonical milestones and rejects privacy/context violations');

-- ---- game entry stages (as anon, like /api/hub-entry) ----
set local role anon;
select is(public.log_inhagame_game_entry_v1(:e_land, :c_classic, 'game_landing', 'classic'), true,
  'landing after a click is accepted');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_classic, 'game_landing', 'classic'), true,
  'a second landing for the same entry is accepted (idempotent)');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_classic, 'classic_ranked_start', 'classic'), true,
  'ranked start after landing is accepted');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_classic, 'game_play_start', 'classic'), true,
  'play after landing is accepted');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_classic, 'game_first_result', 'classic'), true,
  'first result after play is accepted');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_classic, 'game_retry', 'classic'), true,
  'retry after first result is accepted');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_classic, 'game_first_clear', 'classic'), true,
  'first clear after first result is accepted');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_campus, 'game_landing', 'campus'), true,
  'campus landing after campus_entry_click is accepted');
-- Profile page game cards (P1) are entry sources too.
select is(public.log_inhagame_hub_event_v1(:c_profile, :s1, :v1, 'profile_game_click', 'profile', 'survival'), true,
  'profile_game_click is accepted');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_profile, 'game_landing', 'survival'), true,
  'landing after a profile_game_click is accepted');
select is(public.log_inhagame_hub_event_v1(gen_random_uuid(), :s1, :v1, 'profile_view', 'profile'), true,
  'profile_view is accepted');
-- Grow has a full hub entry adapter. v2 records normalized acquisition metadata.
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s2, :v2, 'hub_visit', 'home', null,
  'everytime', 'induck_grow_v1_launch_20260925'), true,
  'Everytime launch hub_visit is accepted');
select is(public.log_inhagame_hub_event_v2(:c_grow, :s2, :v2, 'hub_game_click', 'home', 'induck-grow',
  'everytime', 'induck_grow_v1_launch_20260925'), true,
  'hub_game_click for induck-grow with acquisition metadata is accepted');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_grow, 'game_landing', 'induck-grow'), true,
  'induck-grow landing is accepted');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_grow, 'game_play_start', 'induck-grow'), true,
  'induck-grow play after landing is accepted');
reset role;
select is((select acquisition_source from public.inhagame_hub_events where entry_id=:c_grow and event_type='game_landing'),
  'everytime', 'entry stage inherits source from the hub click');
select is((select campaign from public.inhagame_hub_events where entry_id=:c_grow and event_type='game_play_start'),
  'induck_grow_v1_launch_20260925', 'entry stage inherits campaign from the hub click');

select results_eq(
  $$select event_type, target, surface, session_id, visitor_id from public.inhagame_hub_events
    where entry_id = 'c0000000-0000-4000-8000-000000000001' order by event_type$$,
  $$select t, 'classic', 'game', 'a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid
    from unnest(array['classic_ranked_start', 'game_first_clear', 'game_first_result', 'game_landing', 'game_play_start', 'game_retry']) t
    order by t$$,
  'one row per stage, attributed to the click''s target, session and visitor');
select is((select entry_id from public.inhagame_hub_events where event_id = :e_land), :c_classic::uuid,
  'the landing keeps the event id the game sent');

set local role anon;
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), gen_random_uuid(), 'game_landing', 'classic'), false,
  'missing click: refused');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_induckup, 'game_play_start', 'induckup'), false,
  'play before landing: refused');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_induckup, 'game_first_result', 'induckup'), false,
  'first result before play: refused');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_classic, 'game_landing', 'induckup'), false,
  'cross-game reuse of an entry: refused');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_classic, 'game_landing', 'tetris'), false,
  'unknown target: refused');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_classic, 'hub_visit', 'classic'), false,
  'unsupported stage: refused');
select is(public.log_inhagame_game_entry_v1(null, :c_classic, 'game_landing', 'classic'), false,
  'null event_id: refused');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :e_land, 'game_landing', 'classic'), false,
  'a stage event is not a valid entry id');
select is(public.log_inhagame_game_entry_v1(:e_land, :c_campus, 'game_play_start', 'campus'), true,
  'a duplicate event_id is accepted without effect (idempotent)');
reset role;
select is((select entry_id from public.inhagame_hub_events where event_id = :e_land), :c_classic::uuid,
  'a duplicate event_id never overwrites the stored row');
select is((select count(*)::int from public.inhagame_hub_events where entry_id = :c_campus and event_type = 'game_play_start'), 0,
  'the duplicate event_id did not create a play for the other entry');

-- ---- entry expiry (30 minutes from the click) ----
insert into public.inhagame_hub_events(event_id, session_id, visitor_id, event_type, surface, target, created_at) values
  (:c_old, :s1, :v1, 'hub_game_click', 'home', 'survival', now() - interval '31 minutes'),
  (:c_recent, :s1, :v1, 'hub_game_click', 'home', 'survival', now() - interval '29 minutes');
set local role anon;
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_old, 'game_landing', 'survival'), false,
  'expired entry (31 minutes): refused');
select is(public.log_inhagame_game_entry_v1(gen_random_uuid(), :c_recent, 'game_landing', 'survival'), true,
  'entry within 30 minutes: accepted');
reset role;

-- ---- per-session rate limit: 120 hub events per hour ----
insert into public.inhagame_hub_events(event_id, session_id, visitor_id, event_type, surface)
select gen_random_uuid(), 'a0000000-0000-4000-8000-0000000000ff', :v1, 'hub_visit', 'home' from generate_series(1, 120);
set local role anon;
select is(public.log_inhagame_hub_event_v1(gen_random_uuid(), 'a0000000-0000-4000-8000-0000000000ff', :v1, 'hub_visit', 'home'), false,
  'the 121st hub event in an hour for one session is refused');
reset role;

-- ---- OPS summary (service role) ----
set local role service_role;
select is(
  (select f from jsonb_array_elements(public.get_inhagame_hub_ops_v1()->'entry_funnel') f where f->>'target' = 'classic')
    - 'returning_visitors_7d' - 'impressions',
  jsonb_build_object('target', 'classic', 'clicks', 1, 'landings', 1, 'plays', 1, 'first_results', 1,
    'first_clears', 1, 'retries', 1, 'ranked_starts', 1, 'errors', 0),
  'OPS entry funnel counts the classic entry exactly once per stage');
select ok(public.get_inhagame_hub_ops_v1() ?& array['generated_at', 'date_kst', 'today', 'targets', 'panels', 'zones', 'entry_funnel', 'daily', 'profile', 'acquisition'],
  'OPS summary shape');
select is((public.get_inhagame_hub_ops_v1()->'profile'->>'views')::int, 1, 'OPS profile slice counts profile views');
select is((public.get_inhagame_hub_ops_v1()->'profile'->>'game_clicks')::int, 1, 'OPS profile slice counts profile game clicks');
select is((select (s->>'grow_plays')::int from jsonb_array_elements(public.get_inhagame_hub_ops_v1()->'acquisition'->'sources') s
  where s->>'source'='everytime'), 1, 'OPS acquisition slice attributes Grow play to Everytime');
select is((select (c->>'grow_plays')::int from jsonb_array_elements(public.get_inhagame_hub_ops_v1()->'acquisition'->'campaigns') c
  where c->>'campaign'='induck_grow_v1_launch_20260925'), 1, 'OPS campaign slice attributes Grow play to launch campaign');
reset role;

select * from finish();
rollback;
