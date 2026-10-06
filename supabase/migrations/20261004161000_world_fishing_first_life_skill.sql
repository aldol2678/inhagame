-- Fishing becomes the first ACTIVE Life Skill (Life Skill Tree PR-6).
--
-- Activated here:
-- - life.fishing (Life Skill catalog): its XP, level and SP pool now show in the Life Skill Book.
-- - collection.fish.carp (Collection discovery): the settlement path refuses inactive entries.
-- - the Fishing F2 runtime, with a CANDIDATE policy. The values are not tuned balance; change them
--   with a later migration (or an UPDATE of this one row) without touching code. A policy change
--   applies to new attempts only, because every attempt snapshots its policy at start.
--
-- Deliberately not activated:
-- - the Fishing skill tree nodes. They have no effects yet, so spending SP on them would buy nothing.
--   SP still accumulates in the Fishing pool and stays spendable once the nodes are activated.
-- - creature.bridge.activity.fishing (finalize keeps recording NOOP decisions).
-- - every other Life Skill.
--
-- The HTTP entry point stays behind WORLD_FISHING_API_ENABLED=1 (server env), so production play
-- starts only when that switch is set; this migration alone does not expose a player action.

update private.world_life_skill_catalog
   set status = 'ACTIVE'
 where skill_id = 'life.fishing' and status = 'COMING_SOON';

update private.world_collection_entry_catalog
   set status = 'ACTIVE'
 where entry_id = 'collection.fish.carp' and status = 'COMING_SOON';

update private.world_fishing_runtime
   set enabled = true,
       policy = jsonb_build_object(
         'policyVersion', 'fishing.candidate.v1',
         'minWaitMs', 3000,
         'maxWaitMs', 9000,
         'responseWindowMs', 1500,
         'attemptTtlMs', 30000,
         'lifeXp', 20),
       minimum_start_interval_ms = 2000
 where singleton;

-- Fail the migration rather than ship an unusable activation.
do $$
begin
  perform private.world_fishing_policy_validate_v1((select policy from private.world_fishing_runtime));
  if (select status from private.world_life_skill_catalog where skill_id = 'life.fishing') <> 'ACTIVE'
     or (select status from private.world_collection_entry_catalog where entry_id = 'collection.fish.carp') <> 'ACTIVE'
     or exists (select 1 from private.world_life_skill_thresholds where curve_id = 'life.common.v1' and level = 20) is not true then
    raise exception 'FISHING_ACTIVATION_INCOMPLETE';
  end if;
end;
$$;
