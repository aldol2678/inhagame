# Indoor Plant P0 — closed local candidate

Status: locally implemented and tested; **not operationally activated**.
Baseline: `af532a53c433479e12354f88a5a1c234075de5e7` (main, checked 2026-10-12).

## Experience and boundaries

- Each eligible permanent account can claim one free UNIQUE `furniture.indoor_planter` in its own room. The existing Inventory grant is the only acquisition writer. No shop/listing/currency path is added.
- Place it with the existing furniture editor and save. Plant one `plant.room_flower`, then water once. A second watering becomes available after **20 real hours**. The flower blooms **20 real hours after that second watering**.
- Three appearances: SPROUT → BUD → BLOOM. Before planting, the pot contains soil. No death, regression, expiration, late penalty, restart, harvest, sale, seed multiplication, XP or repeat reward.
- Planting and first care fit a short visit. Two later visits are encouraged, without a deadline or a forced 3–5 minute wait. The 20-hour interval provides four hours of scheduling flexibility against a daily habit. It is independent of the existing 75-minute World cycle.
- Bloom stays permanently. Recalling a planter and placing it with a new furniture object UUID preserves its plant. Existing `furniture.dorm_plant_medium` stays a STATIC decoration.
- Allowed visitors see the current silhouette in the room. They cannot claim, plant, water, or read the owner's inventory, plant revision, deadlines or receipts.

## Authority and data

`private.world_room_plants` is keyed by `(user_id, planter_item_id)`. It stores the fixed plant/version, planting and two care timestamps, and mutation revision 1–3. Stage is derived by the server at read time; no scheduler or per-frame database write is necessary. Growth continues while stored, but care requires a currently saved placement.

`private.world_room_plant_receipts` binds actor/request UUID to room/object/action/expected revision and stores the historical success receipt. There are at most three successful receipts per owner. Failed, early, conflicting and no-op requests create no receipt. Receipts are append-only except for account-deletion cascade. State and receipt commit or roll back together.

Both tables are private with RLS and no direct anon/authenticated/service-role grants. The candidate adds no fields to Housing's `{id,itemId,surface,x,z,yaw}` object contract. The SQL furniture mirror retains all prior 17 definitions and adds the new planter.

Public authenticated RPCs:

| RPC | Purpose |
| --- | --- |
| `claim_my_room_planter_v1(p_room)` | Free starter with a server-owned lifetime grant key; retries cannot regrant even after revocation |
| `plant_my_room_plant_v1(p_room,p_object,p_request_id)` | Create one permanent plant using the currently saved owned planter |
| `care_my_room_plant_v1(p_room,p_object,p_revision,p_request_id)` | Guarded first/second care with expected revision |
| `get_world_room_plants_v1(p_room)` | Fresh server-derived owner state or visitor silhouette projection |

Writes validate the authenticated permanent account, current owner room, saved object and current UNIQUE ownership. Lock order follows Inventory advisory → room → layout → ownership → plant, matching Housing save. The command clock is captured once after locks. An old matching request returns its existing success receipt after actor/owner checks; this is historical proof, never authority to restore a removed item or object. The client must read current state afterward.

Reads reuse current H3 room access, including relationship/privacy/block/ban/knock rules. Access revocation prevents subsequent reads and closes the UI on local session loss. Remote changes are revalidated by the server and periodic reads; this is not instantaneous cross-client push synchronization.

## Client, mobile and visuals

- Production availability is a compile-time false constant, not a URL/local-storage/debug activation flag.
- Account, room, owner/visitor role, session generation, saved layout revision, layout loading/error, editor mode and busy transitions invalidate stale responses. A→B→A account switching cannot accept an earlier A response.
- Lost command replies retain the exact immutable request UUID and arguments. Confirmed success with failed fresh readback offers a readback action rather than creating a new mutation. Starter acquisition also requires fresh account-bound Inventory before placement.
- Inventory revocation invalidates in-flight plant reads and cached visuals. Stored/replaced object IDs are resolved against the latest saved layout. Client clocks never determine growth or unlock care.
- The panel reuses the room editor shell, focus handling and touch-sized controls; Escape, Tab and browser Back are covered by deterministic tests. Owner entry is through an optional HUD button and saved-object action. Visitors have display-only text.
- Three self-authored procedural meshes reuse PlayCanvas materials and the existing furniture renderer. The visible growth overlay does not replace the existing furniture collider array. No external bitmap/model dependency or additional light is introduced.

## Local evidence (2026-10-12)

Passed:

- `node --test apps/world/tests/*.test.mjs`: **4281/4281**. Includes 37 plant client/panel tests for request retry, revision conflict, account ABA, fresh inventory, ownership revocation, object recall/re-add, room/access transitions, visitor projection and lifecycle.
- `PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/room-plant-sql-candidate.mjs`: **135 assertions** using actual candidate SQL, Inventory grant and current H2/H3 functions. Covers gates/privileges, fixed once grant, receipt binding/bounds/rollback, second actor isolation, care timing boundaries and server time, no regression, stored/replaced objects, revoked ownership, friendship/block/privacy/knock and account restrictions. PGlite serializes requests and is **not** proof of independent PostgreSQL connection races.
- `node apps/world/tests/browser/room-plant-null-smoke.mjs`: actual PlayCanvas 2.22.4 NullGraphicsDevice, 12 sprout/bud/bloom/clear cycles, geometry/material counts, collider identity, static plant and cleanup assertions.
- `node apps/world/qa.mjs`; `node .github/ci/migration-lint.mjs af532a53c433479e12354f88a5a1c234075de5e7`; `node .github/ci/migration-contract-lint.mjs`; 18 migration-lint unit tests; source syntax checks; `git diff --check`.
- Existing Recast runtime tests (3), Classic tests (11)/check, Grow tests, Survival tests (17)/check, Induckup unit tests (91) and Vite production build, Edge tests (35).
- Independent read-only review reran SQL 135, plant client/panel 37 and NullGraphics 12 cycles and found no blocking defect in the frozen implementation.

Unknown / not demonstrated:

- `WORLD_SMOKE_EXECUTABLE=/usr/bin/chromium WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/room-plant-smoke.mjs` could start the local HTTP server but Chromium exited with `socket() failed: Operation not permitted (1)`. No browser screenshots or desktop/mobile pixel, touch, accessibility or real-device pass is claimed. The replacement test harness creates the real personal-room scene with an enabled furniture renderer, existing furniture editor/client, two isolated browser contexts, and a separate synthetic server clock. It captures all three stages at desktop/portrait/landscape sizes and checks that hiding only the saved planter changes actual pixels. Its synthetic RPC authority is separate from the required full Supabase CI. Real-device and live-account validation remain distinct.
- Full Supabase migration replay, pgTAP `112_world_room_plant_candidate.test.sql`, generated database-type coverage and independent-connection integration are not run here because psql/PostgreSQL/Supabase/Docker executables are unavailable. PGlite uses minimal provider/auth shells and cannot substitute for these checks.
- `supabase/tests/integration/room-plant.integration.test.mjs` is included for a **disposable local stack only**. It uses independent connections for 12 starter claims, 12 same-request plant calls, conflicting simultaneous care, and care versus Housing recall. `scripts/public-db.sh` discovers it through the existing integration runner. Its setup changes the gate/catalog only inside that disposable test stack and restores them afterward.
- No live accounts, Production writes, real DB migration, merge, deploy or operational activation were performed. Publication as a separate Draft PR and remote checks were subsequently authorized; exact-head run evidence is attached by the dedicated candidate workflow.

## Release gates and next approval

The candidate stays closed in three places: `ROOM_PLANT_AVAILABLE=false`, `private.world_room_plant_enabled_v1()=false`, and catalog status `COMING_SOON`. Merely merging this candidate must not make it playable.

Before proposing activation:

1. Run full `scripts/public-db.sh` in a disposable Supabase stack, including migration replay, pgTAP, independent-connection tests and type coverage. Review grants, caller allowlists, lock/race outcomes and bounded receipt behavior. Confirm the proposed release's migration ordering alongside any book/sofa acquisition candidate.
2. Run the supplied browser smoke and inspect actual desktop/portrait/landscape screenshots, real touch targets, focus/Back, account switching, ownership revocation and visitor/access-loss behavior. Exercise two real test accounts against a non-production server and verify server-time boundaries/lost-response retries.
3. Obtain separate explicit approval for the exact deployment/migration/activation target. Enable the server gate, catalog item and client release only through a reviewed activation change. There is no in-app activation endpoint. For disable/rollback, close the gate and client path while preserving permanent growth and receipts; do not delete user state or reissue grants.

The first release intentionally does not activate farming XP or the farming skill tree. Any later XP/reward/replanting feature needs its own authority, balance and exploit review.

## Remote verification follow-on

The dedicated `Room plant candidate QA` workflow checks the exact PR head, keeps production gates closed, and uploads visible-room PNGs plus before/after state and source hashes. The unchanged required `verify` aggregate includes full source and isolated Supabase checks because this patch changes migrations and DB tests. Additional existing catalog/furniture count and RPC grant fixtures were updated to include only the new planter and its four RPCs; verification policy is not relaxed.

Initial remote head `a0983c17065eaace7931f9c3edb9fbf9d4253603` passed the required Public checks (run 38198366520): Supabase replay, 76 pgTAP files / 3,789 assertions, all 157 integration tests including all four plant independent-connection races, and type coverage. Visible-room QA run 38198366673 passed all three stages × three viewports and the two-context flow. Its nine stage screenshots were downloaded and source/image hashes verified. The related Housing smoke exposed an outdated 17-furniture expectation; it now explicitly expects all 18 models and 17 remaining after recall. The follow-up head must rerun all relevant checks before being considered verified. This does not authorize operational activation.
