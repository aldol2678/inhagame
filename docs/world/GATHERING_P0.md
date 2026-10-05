# Gathering P0 — closed instant-harvest authority

Gathering P0 is the first server foundation for `activity.gathering.campus`. It deliberately does
**not** expose a player action yet. The repository has no general authoritative world-position
producer, so P0 closes the domain transaction first and defers spatial eligibility to the
player-exposure slice instead of treating browser pose or raw XYZ as trusted evidence.

## First vertical slice

Semantic source:

- `gathering.campus.leaf_pile_01`
- Activity: `activity.gathering.campus`
- Item: `material.campus_leaf` × 1
- Collection: `collection.plant.campus_leaf`
- Life Skill: `life.gathering`

The source stays `COMING_SOON` in P0. `life.gathering` and the Collection entry also remain
`COMING_SOON`. The Material row already exists and is ACTIVE.

The source identity is mirrored in
`apps/world/src/activity/gathering-source-registry.js` and
`private.world_gathering_source_catalog`.

## Transaction contract

`public.world_gathering_harvest_v1(user, source, client_attempt_key)` is service-role only.

For a fresh accepted request it runs one database transaction:

1. verify the permanent, non-banned account and semantic source identity;
2. require the operator-owned Gathering runtime and source to be ACTIVE;
3. enforce the server-side minimum harvest interval;
4. start `activity.gathering.campus` through the Life → Creature start bridge;
5. freeze policy and output identity in `world_gathering_attempt_snapshots`;
6. finalize the Activity as `SUCCEEDED / HARVESTED`;
7. settle the frozen output through the shared Activity settlement primitive;
8. return the immutable receipt.

The settlement path is the only writer of Inventory / Collection / Life XP for the harvest. The
Gathering function never calls those domain primitives directly.

Exact retry with the same account + client key + source returns the committed output and receipt.
The same key with a different source conflicts. A failed settlement rolls the whole statement back,
so no successful Activity attempt or Gathering snapshot is stranded without its value.

## Policy and activation

`private.world_gathering_runtime` is seeded:

- `enabled = false`
- no policy
- no minimum interval

A later reviewed activation migration must set a policy with exactly:

- `policyVersion`
- `lifeXp`

and set a server-side minimum harvest interval. P0 does not canonize a final XP or cooldown number.

Activation also requires, in the same reviewed rollout boundary:

- `life.gathering = ACTIVE`
- `collection.plant.campus_leaf = ACTIVE`
- the intended Gathering source = `ACTIVE`

The Life → Creature Gathering bridge remains independently `COMING_SOON`; a successful harvest
therefore records a NOOP bridge decision until Creature tuning is separately activated.

## Position / player exposure boundary

P0 accepts no browser position, Realtime pose, raw coordinates, output item, quantity, XP amount or
Collection id.

Before a browser interaction or HTTP route can be enabled, a follow-up slice must provide trusted
world-presence evidence for the selected semantic source. Reusing browser pose behind a service
credential does not satisfy that requirement.

No Vercel Preview is needed for P0. Verification is local/static + GitHub CI + disposable local
Supabase, matching the current Seum delivery policy.

## Verification

- `gathering-source-registry.test.mjs`: source identity and drift rejection.
- `99_world_gathering_p0.test.sql`: closed default, RLS/grants, source mirror, policy validation.
- `gathering.integration.test.mjs`: code/DB mirror, concurrent exact retries, one leaf/discovery/XP
  settlement, rollback on inactive dependencies, cooldown/account gates, deletion cascade.
- Authority guards register the Gathering source catalog as migration-only and
  `world_gathering_harvest_v1` as a reviewed server-only Activity settlement adapter.

## Delivery state

- Repository implementation: candidate branch / PR until merged.
- Player exposure: CLOSED.
- Production migration: not applied by this slice.
- Production runtime activation: not performed.
- Preview deployment: not required.
