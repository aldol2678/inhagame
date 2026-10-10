# INHA WORLD · Inventory Mutation P0

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Canonical design: `INHA WORLD · P0 Inventory Mutation Technical Contract v0.1 [CANDIDATE]`.

This slice adds the first **decrement / exchange authority** on top of the existing Inventory grant core.
It does not implement Crafting recipes, Equipment enhancement/disassembly rules, Fishing bait policy or
any player-facing generic mutation endpoint.

## Scope

Pure contract:

- `apps/world/src/collection/inventory-mutation-contract.js`
  - mutation/source vocabulary
  - plan validation
  - deterministic item ordering
  - duplicate/overlap rejection
  - parent/child idempotency key contract

Database:

- `private.world_inventory_mutations`
- `private.world_item_consumptions`
- `private.world_inventory_mutation_entries`
- `private.world_inventory_consume_v1(...)`
- `private.world_inventory_mutate_v1(...)`

No `public.world_inventory_mutate_*` or `public.world_inventory_consume_*` RPC is created.

Future narrow domain commands such as Crafting or Equipment are expected to run as SECURITY DEFINER
server functions and call the private core after their own domain eligibility checks.

## Consume contract

P0 generic consume accepts only catalog items whose `ownership_policy = STACKABLE`.

- quantity must be positive
- insufficient quantity is rejected
- successful consume is append-only logged
- quantity > 0 updates the existing ownership row
- quantity = 0 deletes the ownership row
- the consume ledger remains after ownership reaches zero
- existing UNIQUE ownership is rejected with `CONSUME_POLICY_UNSUPPORTED`

This keeps existing appearance/loadout UNIQUE ownership outside the generic delete path.

## Mutation plan

Trusted server plan shape:

```json
{
  "consumes": [
    { "itemId": "material.campus_leaf", "quantity": 2 }
  ],
  "grants": [
    { "itemId": "material.artifact_fragment_01", "quantity": 1 }
  ]
}
```

Rules:

- 1..16 consume operations
- 0..16 grant operations
- item IDs follow the current one-dot Item ID contract
- duplicate item IDs inside one direction are rejected
- the same item cannot appear in consume and grant in P0
- operations are canonicalized by `itemId`
- `CONSUME` mutations have no outputs
- every other mutation type requires at least one output

## Atomic settlement

`private.world_inventory_mutate_v1`:

1. validates account / source / idempotency / plan
2. acquires the existing per-account Inventory advisory transaction lock
3. resolves parent replay before value movement
4. preflights all STACKABLE inputs under row locks
5. preflights every output before consuming anything
6. inserts one parent mutation receipt
7. calls `private.world_inventory_consume_v1` for each input
8. calls existing `private.world_inventory_grant_v1` for each output
9. stores immutable child receipt entries
10. returns the historical receipt

A downstream grant error occurs inside the same PostgreSQL transaction, so all earlier input
consumption and parent/child rows roll back.

## Idempotency

Parent key:

- max 160 characters
- globally unique

Child keys are deterministic:

- `<parent>/consume/<0..15>`
- `<parent>/grant/<0..15>`

Parent replay with the same normalized plan returns `ALREADY_PROCESSED`.
Reusing the key for another account/type/source/plan returns `IDEMPOTENCY_CONFLICT`.

## Output preflight

Before any input moves:

- unknown / disabled / hidden output → `OUTPUT_UNAVAILABLE`
- already-owned UNIQUE output → `OUTPUT_ALREADY_OWNED`
- STACKABLE overflow → `MAX_STACK_EXCEEDED`

The existing grant core remains the only primitive that actually increases ownership.

## Security

- all new tables use RLS
- raw table privileges are revoked from anon/authenticated/service_role
- private consume/mutate helpers have no direct execute grant for Data API roles
- no generic public mutation RPC exists
- the caller must already be trusted server/domain logic
- Recipe, Equipment and Activity semantic validation remains outside Inventory

## Tests

Pure Node:

- `apps/world/tests/inventory-mutation-contract.test.mjs`

Database pgTAP:

- `supabase/tests/database/83_world_inventory_mutation_p0.test.sql`

Coverage includes:

- deterministic plan ordering
- malformed/duplicate/overlapping plan rejection
- partial stack consume
- exact-to-zero ownership deletion
- consume replay and conflict
- UNIQUE consume refusal
- over-consume refusal
- 2 inputs → 1 output
- parent replay
- changed-plan idempotency conflict
- insufficient input rollback
- max-stack output rollback
- already-owned UNIQUE output rollback
- consume-only mutation
- append-only receipts
- guest / banned rejection
- account deletion cascade

## Verification status

- Branch implementation only.
- Static pure-contract execution: PASS.
- Changed Node test syntax: PASS.
- Migration structure/readback inspection: PASS.
- GitHub-hosted database tests are not claimed until Actions actually starts and runs the database job.
- Cross-connection concurrency remains a merge gate if hosted CI continues to fail at startup.
- Not merged.
- Not deployed.
- Not migrated to Production.
