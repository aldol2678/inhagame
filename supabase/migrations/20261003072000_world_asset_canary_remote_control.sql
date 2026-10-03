-- INHA WORLD asset GLB canary remote kill switch + observability.
-- Initial state is disabled. Runtime code must fail closed to canonical authority.
-- The flag is intentionally read-only to public Data API roles; service_role is the only writer.

create table if not exists public.world_runtime_flags (
  flag text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint world_runtime_flags_flag_check check (
    flag in ('asset_glb_canary_v1')
  )
);

alter table public.world_runtime_flags enable row level security;

revoke all on table public.world_runtime_flags from public, anon, authenticated;
grant select on table public.world_runtime_flags to anon, authenticated, service_role;
grant insert, update, delete on table public.world_runtime_flags to service_role;

drop policy if exists world_runtime_flags_public_read on public.world_runtime_flags;
create policy world_runtime_flags_public_read
  on public.world_runtime_flags
  for select
  to anon, authenticated
  using (flag = 'asset_glb_canary_v1');

insert into public.world_runtime_flags(flag, enabled)
values ('asset_glb_canary_v1', false)
on conflict (flag) do nothing;

alter table public.inhagame_hub_events
  drop constraint if exists inhagame_hub_events_event_type_check;
alter table public.inhagame_hub_events
  add constraint inhagame_hub_events_event_type_check check (
    event_type in (
      'hub_visit','hub_panel_view','hub_game_click','campus_entry_click',
      'campus_boot_ready','campus_boot_error','campus_zone_enter','hub_card_impression',
      'game_landing','game_play_start','game_load_error','game_first_result',
      'game_first_clear','game_retry','classic_ranked_start',
      'profile_view','profile_edit_open','profile_edit_save','profile_game_click',
      'first_session_start','first_goal_seen','first_move','first_zone_arrival','first_npc_interaction',
      'quest_started','first_player_encounter','first_activity_start','first_activity_complete',
      'first_reward','reward_seen','growth_seen','core_loop_complete','next_goal_seen',
      'core15_complete','world_return','next_discovery_click',
      'asset_canary_selected','asset_canary_active','asset_canary_rollback','asset_canary_failure'
    )
  );

alter table public.inhagame_hub_events
  drop constraint if exists hub_event_context_check;
alter table public.inhagame_hub_events
  add constraint hub_event_context_check check (
    coalesce(
      (
        entry_id is null and (
          (event_type='hub_visit' and surface='home' and target is null)
          or (event_type='hub_panel_view' and surface in ('home','ranking','friends','messages','account','settings') and target is null)
          or (event_type='hub_game_click' and surface in ('home','ranking','account') and target in ('classic','induckup','survival','induck-grow'))
          or (event_type='campus_entry_click' and surface='home' and target='campus')
          or (event_type='hub_card_impression' and surface='home' and target in ('classic','induckup','survival','campus','induck-grow'))
          or (event_type in ('campus_boot_ready','campus_boot_error') and surface='campus' and target is null)
          or (event_type='campus_zone_enter' and surface='campus' and target in ('C01_GATE','C02_MAIN_HALL','C03_CENTRAL'))
          or (event_type in ('profile_view','profile_edit_open','profile_edit_save') and surface='profile' and target is null)
          or (event_type='profile_game_click' and surface='profile' and target in ('classic','induckup','survival','campus','induck-grow'))
          or (event_type in ('first_session_start','first_move','first_zone_arrival','first_npc_interaction','first_player_encounter','world_return')
              and surface='campus' and target is null)
          or (event_type in ('first_activity_start','first_activity_complete')
              and surface='campus' and target='inkyung_living')
          or (event_type in ('first_goal_seen','quest_started','first_reward','reward_seen','growth_seen','core_loop_complete','core15_complete')
              and surface='campus' and target='first_campus')
          or (event_type in ('next_goal_seen','next_discovery_click')
              and surface='campus' and target='main2_back_gate_guide')
          or (event_type in ('asset_canary_selected','asset_canary_active','asset_canary_rollback','asset_canary_failure')
              and surface='campus' and target='induck_v3')
        )
      )
      or (
        entry_id is not null
        and event_type in (
          'game_landing','game_play_start','game_load_error','game_first_result',
          'game_first_clear','game_retry','classic_ranked_start'
        )
        and surface='game'
        and target in ('classic','induckup','survival','campus','induck-grow')
        and (event_type<>'classic_ranked_start' or target='classic')
      )
    , false)
  );

create or replace function public.log_inhagame_hub_event_v2(
  p_event_id uuid,
  p_session_id uuid,
  p_visitor_id uuid,
  p_event_type text,
  p_surface text,
  p_target text default null,
  p_acquisition_source text default 'unknown',
  p_campaign text default null
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_event_id is null or p_session_id is null or p_visitor_id is null
     or p_event_type is null or p_event_type not in (
       'hub_visit','hub_panel_view','hub_game_click','campus_entry_click',
       'campus_boot_ready','campus_boot_error','campus_zone_enter','hub_card_impression',
       'profile_view','profile_edit_open','profile_edit_save','profile_game_click',
       'first_session_start','first_goal_seen','first_move','first_zone_arrival','first_npc_interaction',
       'quest_started','first_player_encounter','first_activity_start','first_activity_complete',
       'first_reward','reward_seen','growth_seen','core_loop_complete','next_goal_seen',
       'core15_complete','world_return','next_discovery_click',
       'asset_canary_selected','asset_canary_active','asset_canary_rollback','asset_canary_failure'
     )
     or p_acquisition_source not in ('direct','everytime','internal','external','unknown')
     or (p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
     or coalesce((select count(*) from public.inhagame_hub_events
       where session_id=p_session_id and created_at>now()-interval '1 hour'),0)>=120
  then return false; end if;

  insert into public.inhagame_hub_events(
    event_id,session_id,visitor_id,event_type,surface,target,acquisition_source,campaign
  )
  values(
    p_event_id,p_session_id,p_visitor_id,p_event_type,p_surface,p_target,
    p_acquisition_source,p_campaign
  )
  on conflict(event_id) do nothing;
  return true;
exception when check_violation or foreign_key_violation then return false;
end;
$$;

revoke all on function public.log_inhagame_hub_event_v2(uuid,uuid,uuid,text,text,text,text,text) from public;
grant execute on function public.log_inhagame_hub_event_v2(uuid,uuid,uuid,text,text,text,text,text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
