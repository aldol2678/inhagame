-- Account deletion must cascade through Creature append-only ledgers.
--
-- world_creature_append_only_v1 refused every DELETE, so the auth.users FK cascade failed for any
-- account with Creature history (party history, observations, Life/Combat bridge contexts and
-- decisions, ...): delete_my_inhagame_account_v1 could not complete for such accounts. Fishing F2
-- binds a Life -> Creature context on every attempt, which makes this reachable for every angler.
--
-- A DELETE is now allowed only once the owning account row is gone (the cascade case). Direct
-- UPDATE / DELETE of a live account's ledger rows is still refused. Every table using this trigger
-- carries user_id.
create or replace function private.world_creature_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'CREATURE_LEDGER_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_creature_append_only_v1()
  from public, anon, authenticated, service_role;
