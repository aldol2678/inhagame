# INHA WORLD · Collection Discovery P0

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Canonical design: `INHA WORLD · P0 Collection Discovery Technical Contract v0.1 [CANDIDATE]`.

This slice adds the shared **Discovery fact authority** while keeping Ownership, Completion, Record and
owner-derived facts separate.

## Scope

Pure code Registry:

- `apps/world/src/collection/collection-discovery-contract.js`
- four persistence modes
- entry definition validation
- DB authority-row projection
- presentation-state contract that distinguishes:
  - `UNKNOWN`
  - `DISCOVERED`
  - `OWNER_DERIVED`
  - `NOT_PERSISTED`

Initial entries:

- `collection.fish.carp` → SERVER_PERSISTED / COMING_SOON
- `collection.plant.campus_leaf` → SERVER_PERSISTED / COMING_SOON
- `collection.artifact.campus_fragment_01` → SERVER_PERSISTED / COMING_SOON
- `collection.place.biryong_tower` → DERIVED_FROM_OWNER / BIRYONG / BR01 / ACTIVE

The first three are defined but not discoverable until a later activation migration and verified domain
adapter exist.

## Persistence

### Entry mirror

`private.world_collection_entry_catalog`

The code Registry remains product-semantic canon. The DB mirror carries only:

- entry id
- category
- persistence mode
- owner pointer
- status
- definition version

It exists so SQL write authority can reject forged entry IDs and wrong persistence modes.

### Event ledger

`private.world_collection_discovery_events`

One row per verified discovery result:

- append-only
- globally unique idempotency key
- source type/ref
- optional domain result ref
- definition version snapshot
- server discovery timestamp

### Player projection

`private.world_player_collection_discoveries`

One row per `(user, entry)`:

- immutable first discovery provenance
- latest discovery time
- verified discovery count
- monotonic version

Ownership reaching zero does not delete this projection.

## Commit authority

`private.world_collection_discover_v1(...)`

A commit requires:

1. permanent non-banned account
2. valid Collection Entry ID
3. valid verified source
4. idempotency key
5. catalog entry exists
6. entry status is `ACTIVE`
7. persistence mode is `SERVER_PERSISTED`

Behavior:

- first verified result → `DISCOVERED`
- new verified result → `REDISCOVERED`
- exact key replay → `ALREADY_PROCESSED`
- reused key with different identity → `IDEMPOTENCY_CONFLICT`

`DERIVED_FROM_OWNER` is rejected by this write path.

## Read contract

`private.world_collection_list_v1(user)` builds a server read model.

SERVER_PERSISTED:

- no projection → `UNKNOWN`
- projection exists → `DISCOVERED`

DERIVED_FROM_OWNER:

- returns `OWNER_DERIVED`
- returns owner domain/ref
- does **not** invent a discovered boolean

This slice does not yet call Biryong/Mount/Quest owner adapters. It preserves the boundary so a later
Collection Book aggregator can resolve those owners without duplicating their state.

## Server surface

Service-role wrappers:

- `public.world_collection_discover_v1(...)`
- `public.world_collection_list_v1(user)`

No authenticated player write API exists.

A player-facing Collection Book RPC is intentionally deferred until visibility/spoiler filtering and
owner-derived projection adapters are implemented.

## Security

- three new private tables have RLS
- raw table grants are revoked from anon/authenticated/service_role
- private helpers are not directly executable by Data API roles
- service-role wrapper is the server adapter boundary
- client cannot submit discovery through an authenticated generic RPC
- account-scoped advisory lock serializes discovery writes

## Tests

Pure:

- `apps/world/tests/collection-discovery-contract.test.mjs`

Database:

- `supabase/tests/database/84_world_collection_discovery_p0.test.sql`

Integration parity:

- `supabase/tests/integration/collection-discovery.integration.test.mjs`

Coverage includes:

- Registry persistence boundary
- exact code ↔ DB mirror parity
- COMING_SOON write refusal
- DERIVED_FROM_OWNER write refusal
- first discovery
- same-key replay
- key conflict
- rediscovery count/version
- immutable first provenance
- append-only event ledger
- UNKNOWN vs DISCOVERED vs OWNER_DERIVED read model
- account isolation
- guest/banned refusal
- account-delete cascade without catalog deletion

## Explicitly deferred

- Fishing / Gathering / Archaeology result adapters
- activation of the three P1-A entries
- authenticated Collection Book API/UI
- visibility/spoiler filtering
- Biryong derived-state resolver
- Mount derived-state resolver
- Inventory-acquisition discovery adapter
- Collection milestone / Reward adapter
- photo/media records
- boss/combat records

## Status

Branch implementation only.

- Not merged
- Not deployed
- Not migrated to Production
- No P1-A gameplay is claimed live
