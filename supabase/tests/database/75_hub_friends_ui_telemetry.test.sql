-- Hub Friends P0: friends is a panel label only; no relationship/user identifier enters Hub telemetry.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

set local role anon;
select is(
  public.log_inhagame_hub_event_v2(
    '75000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000002',
    '75000000-0000-4000-8000-000000000003',
    'hub_panel_view','friends',null,'direct',null
  ),
  true,
  'friends panel-view telemetry is accepted'
);
select is(
  public.log_inhagame_hub_event_v2(
    '75000000-0000-4000-8000-000000000004',
    '75000000-0000-4000-8000-000000000002',
    '75000000-0000-4000-8000-000000000003',
    'hub_panel_view','friend_user_id',null,'direct',null
  ),
  false,
  'arbitrary social/user surfaces remain rejected'
);
reset role;

select is(
  (select surface from public.inhagame_hub_events where event_id='75000000-0000-4000-8000-000000000001'),
  'friends',
  'only the friends panel label is stored'
);
select is(
  (select target from public.inhagame_hub_events where event_id='75000000-0000-4000-8000-000000000001'),
  null::text,
  'friends panel telemetry stores no target id'
);

select * from finish();
rollback;
