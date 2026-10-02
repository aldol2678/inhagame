-- Hub Messages P0-M2: the messages route is a valid panel-view telemetry surface.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

set local role anon;
select is(
  public.log_inhagame_hub_event_v2(
    '74000000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000002',
    '74000000-0000-4000-8000-000000000003',
    'hub_panel_view','messages',null,'direct',null
  ),
  true,
  'messages panel-view telemetry is accepted'
);
select is(
  public.log_inhagame_hub_event_v2(
    '74000000-0000-4000-8000-000000000004',
    '74000000-0000-4000-8000-000000000002',
    '74000000-0000-4000-8000-000000000003',
    'hub_panel_view','private_messages_raw',null,'direct',null
  ),
  false,
  'arbitrary message-related surfaces remain rejected'
);
reset role;

select is(
  (select surface from public.inhagame_hub_events where event_id='74000000-0000-4000-8000-000000000001'),
  'messages',
  'only the panel surface label is stored'
);
select is(
  (select target from public.inhagame_hub_events where event_id='74000000-0000-4000-8000-000000000001'),
  null::text,
  'panel telemetry stores no user/message target'
);

select * from finish();
rollback;
