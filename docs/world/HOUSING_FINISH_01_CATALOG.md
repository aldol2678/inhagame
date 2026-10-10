# HOUSING-FINISH-01 · catalog and Shop P0

## Scope

Four catalog identities, one shop and two LOCKED priced offers, no user-facing activation.

| ID | Finish slot | Policy | Acquisition |
|---|---|---|---|
| `finish.wall_basic` | wall | free baseline | DEFAULT identity only |
| `finish.wall_white_plaster_02` | wall | 1,500 Induck Coins | LOCKED Shop |
| `finish.floor_basic` | floor | free baseline | DEFAULT identity only |
| `finish.floor_wood_051` | floor | 1,500 Induck Coins | LOCKED Shop |

This stage does **not** auto-grant, charge, equip or save any finish. `ITEM_CATALOG` is the presentation canon, `private.world_item_catalog` is the grant mirror, and the Shop listing is price authority. Catalog statuses stay COMING_SOON; Shop offers stay LOCKED. Current Wood Floor 051 remains the personal-room visual default, without demanding ownership.

## Next gates (not in this PR)

1. Preserve existing Wood Floor 051 access through an audited existing-user grant or equivalent entitlement migration. Do not make existing rooms lose their wood floor, and do not double-charge.
2. Provide server-authoritative wall/floor finish slots with room ownership, inventory guard, revision conflict protection and visitor readback. Do not reuse 32-place furniture layout or accept arbitrary asset URLs.
3. Verify real White Plaster 02 D WebP bytes / CC0 provenance before integration; keep the original `#ece7dc` wall and `#b99168` floor fallbacks.
4. Run disposable DB / Housing browser / account-isolation QA. Activation of offers from LOCKED to ACTIVE requires a separately authorized change and Production migration authority.

The publication of a public migration file is **not** proof it was applied to Production. No Production database operation is requested.
