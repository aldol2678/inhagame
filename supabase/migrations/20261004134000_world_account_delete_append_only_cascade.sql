-- Account deletion must cascade through the remaining DELETE-blocking append-only ledgers.
--
-- Same failure and fix as 20261004133000 (Creature): these triggers refused every DELETE, so the
-- auth.users FK cascade failed and delete_my_inhagame_account_v1 could not complete.
-- - world_biryong_npc_relationship_events: reachable now. Any account that advanced a Biryong NPC
--   relationship stage could not be deleted.
-- - world_life_sp_transactions / world_player_life_nodes: same pattern, reachable once a Life Skill
--   tree node is ACTIVE.
--
-- A DELETE is allowed only once the owning account row is gone (the cascade case). Direct UPDATE /
-- DELETE of a live account's rows is still refused with the original error. Every table using these
-- triggers carries user_id.

create or replace function private.world_biryong_relationship_event_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'BIRYONG_RELATIONSHIP_EVENT_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_biryong_relationship_event_append_only_v1()
  from public, anon, authenticated, service_role;

create or replace function private.world_life_sp_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'LIFE_SP_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_sp_append_only_v1()
  from public, anon, authenticated, service_role;

create or replace function private.world_life_nodes_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'LIFE_NODE_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_nodes_append_only_v1()
  from public, anon, authenticated, service_role;
