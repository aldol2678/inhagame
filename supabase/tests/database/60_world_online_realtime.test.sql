-- INHA WORLD Online Realtime authorization (migrations 20260926020000 and 20260927140000 guests).
-- The CI stack runs without the Realtime service, so realtime.messages and realtime.topic()
-- do not exist there. This test then creates a rolled-back stand-in with the production shape
-- (columns and realtime.topic() body copied from the GAMES project) and installs the committed
-- policies on it, so the policy expressions themselves are exercised under RLS.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select set_config('world.realtime_stub', (to_regclass('realtime.messages') is null)::text, true);

do $$
begin
  if to_regclass('realtime.messages') is null then
    create schema if not exists realtime;
    create table realtime.messages (
      topic text not null,
      extension text not null,
      payload jsonb,
      event text,
      private boolean default false,
      updated_at timestamp not null default now(),
      inserted_at timestamp not null default now(),
      id uuid not null default gen_random_uuid()
    );
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon, authenticated;
    grant select, insert, update on realtime.messages to anon, authenticated;
    if to_regprocedure('realtime.topic()') is null then
      create function realtime.topic() returns text language sql stable
        as $body$ select nullif(current_setting('realtime.topic', true), '')::text; $body$;
      grant execute on function realtime.topic() to anon, authenticated;
    end if;
    perform private.install_world_online_realtime_policies();
  end if;
end;
$$;

select policies_are('realtime', 'messages',
  array['world online players read place zone', 'world online players write place zone'],
  'realtime.messages carries exactly the world online policies');
select ok(not has_function_privilege(r, 'private.install_world_online_realtime_policies()', 'execute'),
  format('%s cannot run the policy installer', r))
from unnest(array['anon', 'authenticated']) r;

-- ---- behaviour under RLS (stand-in only: the real table is partitioned by day) ----
select skip('real realtime.messages present; behaviour runs on the CI stand-in', 15)
where current_setting('world.realtime_stub') = 'false';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d4d4d4d4-0000-4000-8000-000000000060","role":"authenticated","is_anonymous":false}';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select lives_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:AREA_MAIN_HALL', 'presence', 'probe')$$, 'permanent account tracks presence in a place zone')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select lives_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:AREA_MAIN_HALL', 'broadcast', 'probe')$$, 'permanent account broadcasts pose in a place zone')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select is((select count(*) from realtime.messages where topic = 'world:campus:AREA_MAIN_HALL'), 2::bigint, 'permanent account receives place-zone presence and broadcast')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select throws_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:AREA_MAIN_HALL', 'postgres_changes', 'probe')$$, '42501', null, 'no other Realtime extension on world topics')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:RC_0_0';
select throws_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:RC_0_0', 'presence', 'probe')$$, '42501', null, 'render chunk IDs are never channels')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:area_main_hall';
select throws_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:area_main_hall', 'presence', 'probe')$$, '42501', null, 'topic grammar is exact (upper-case AREA IDs)')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL:x';
select throws_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:AREA_MAIN_HALL:x', 'broadcast', 'probe')$$, '42501', null, 'topic is anchored')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'room-1';
select throws_ok($$insert into realtime.messages(topic, extension, event) values ('room-1', 'broadcast', 'probe')$$, '42501', null, 'unrelated private topics stay closed')
where current_setting('world.realtime_stub') = 'true';
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e5e5e5e5-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":true}';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select lives_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:AREA_MAIN_HALL', 'presence', 'probe')$$, 'anonymous (guest) accounts track presence in the shared place zone')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select lives_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:AREA_MAIN_HALL', 'broadcast', 'probe')$$, 'anonymous (guest) accounts broadcast pose and jump in the shared place zone')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select is((select count(*) from realtime.messages where topic = 'world:campus:AREA_MAIN_HALL'), 4::bigint, 'anonymous (guest) accounts receive the same channel as members')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:RC_0_0';
select throws_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:RC_0_0', 'presence', 'probe')$$, '42501', null, 'guests follow the same topic grammar')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'room-1';
select throws_ok($$insert into realtime.messages(topic, extension, event) values ('room-1', 'broadcast', 'probe')$$, '42501', null, 'guests cannot reach unrelated private topics')
where current_setting('world.realtime_stub') = 'true';
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select throws_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:AREA_MAIN_HALL', 'presence', 'probe')$$, '42501', null, 'signed-out clients cannot join world channels')
where current_setting('world.realtime_stub') = 'true';
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select is((select count(*) from realtime.messages where topic = 'world:campus:AREA_MAIN_HALL'), 0::bigint, 'signed-out clients receive nothing')
where current_setting('world.realtime_stub') = 'true';
reset role;

select * from finish();
rollback;
