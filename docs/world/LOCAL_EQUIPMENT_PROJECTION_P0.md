# INHA WORLD · Local Equipment Projection P0 (infrastructure)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| Inventory Ownership Authority (P0-B) | **IMPLEMENTED** (`docs/world/ECONOMY_P0B_INVENTORY_CATALOG.md`) |
| Inventory UI P0 | **IMPLEMENTED** (`docs/world/INVENTORY_UI_P0.md`) |
| Equipment Loadout Authority P0 | **IMPLEMENTED** (`docs/world/APPEARANCE_LOADOUT_AUTHORITY_P0.md`) |
| Wardrobe UI P0 | **IMPLEMENTED** (`docs/world/WARDROBE_UI_P0.md`) |
| Local Equipment Projection Infrastructure P0 | **IMPLEMENTED** (this document) |
| Equipment Asset Binding P0 (`head.induck_cap`, `back.induck_backpack`) | **IMPLEMENTED** (`docs/world/EQUIPMENT_ASSET_BINDING_P0.md`) |
| Remaining Equipment 3D Assets | FOLLOW-UP |
| Multiplayer Equipment Projection P0 | **IMPLEMENTED** (`docs/world/MULTIPLAYER_EQUIPMENT_PROJECTION_P0.md`) |
| Skin Authority / Projection | SEPARATE FOLLOW-UP |
| Profile Badge Decoration | SEPARATE |

**Naming.** The loadout built in "Appearance / Loadout Authority P0" is used as a generic **Equipment
Loadout**: the wearable pieces a character has equipped per slot. Older documents keep their names
(`APPEARANCE_*`, `get_my_world_appearance_loadout_v1`); nothing is renamed. **Skin** (a change of the base
character itself) is a separate future system with its own authority and projection; this phase contains
no skin concept.

This phase builds the pipeline that attaches equipped models to the local character. **At this phase
production showed no visual change** (Equipment Asset Binding P0 later bound the first two models): every catalog item still has `modelAssetId: null` and the model registry is empty, so the
projection resolves every equipped slot to "no asset" and never loads or adds anything. Binding real models
is the Equipment 3D Asset Binding follow-up.

No migration, no RPC, no Supabase client, no catalog / asset change, no Realtime or multiplayer change.

## Flow and authority

```
Wardrobe → equip / unequip RPC → loadout client (server re-read) → loadout.onChange → Equipment Projection
                                                                                      │
                                           local catalog getItemDefinition(itemId) ───┤ modelAssetId (asset binding)
                                                                                      ▼
                                                    loadEquipmentModel(modelAssetId) → slot anchor
```

- The loadout client's snapshot is the **only** equipped authority. The projection never reads the
  Inventory, never talks to the Wardrobe, never calls an RPC and never edits the loadout.
- The local catalog is used only to bind an item to a model (`modelAssetId`) and to check that it is a
  WEARABLE for that slot.
- The projection updates only when the loadout client publishes a change. Nothing runs per frame for the
  projection and nothing polls; re-publishes with the same slot contents do nothing.

## Render eligibility

A slot renders only when **all** hold:

1. the slot entry is non-null;
2. the local catalog has a definition for the item;
3. its category is `WEARABLE`;
4. `definition.equipSlot === slot`;
5. `modelAssetId` is set;
6. the server `catalogStatus` is `ACTIVE`, `COMING_SOON` or `LOCKED`.

`DISABLED`, `HIDDEN` and `UNKNOWN_ITEM` (and unknown / non-wearable / mismatched items) keep their
loadout entry (the server's truth, shown by the Wardrobe) and only hide the 3D entity. BADGE is not an
equipment slot and never projects.

`modelAssetId = null` is the normal P0 state: no loader call, no warning, no placeholder primitive, and no
item-id-based mesh or transform anywhere.

## Slot state (`status()`)

| State | Meaning |
| --- | --- |
| `EMPTY` | nothing equipped, or the loadout is not READY |
| `NO_ASSET` | equipped and eligible, but the catalog binds no model (P0 normal) |
| `HIDDEN` | equipped but not renderable (status / unknown / category / slot) |
| `PENDING` | model load in flight |
| `ATTACHED` | model attached to the slot anchor |
| `FAILED` | model load failed; no entity |

`window.__INHAGAME_P0__.equipmentProjection.status()` (and `getStatus().equipment`) returns slot names per
state plus a load counter — never entities.

## Lifecycle and stale-load defense

- Each slot has a token. Any change of the slot's desired asset (replace, unequip, status change, account
  switch, logout, destroy) bumps it; a load that finishes for an older token is discarded and its entity
  destroyed.
- The desired key includes the account id, so the same item on another account is a new desire.
- Replace keeps the previous entity until the new model is attached, then destroys it (no empty flicker).
  If the new load fails the old entity is removed too, so a mismatched item is never shown.
- Any non-READY loadout state (`SIGNED_OUT`, `LOADING` on an account switch, `UNAVAILABLE`) clears every
  entity and pending load. Guests never load anything.
- `destroy()` (on `pagehide`) removes every entity, discards pending loads and unsubscribes.

## Anchors (`equipment-anchors.js`)

- The character creates one `Equipment_Root` **under the player entity**; under it an `Equipment_Frame`
  holds one `Equipment_<SLOT>` anchor per slot (BODY FACE HAIR HEAD TOP BOTTOM SHOES BACK ACCESSORY).
- The root is not a child of the active visual, so the primitive fallback → GLB swap never orphans or
  destroys attached equipment (pinned by tests).
- Each frame `positionDuck` copies the body pose into the root: feet height (incl. bob), depth offset and
  the pose rotation relative to the model's base rotation. Equipment therefore walks, emotes, sits and
  rides (dragon, bike) with the character. The copy is skipped when the pose did not change.
- The rotation pivots where the visual pivots (`pivotY` = the visual's origin, not the feet): the root
  sits at the pivot and carries the rotation, the frame shifts back down to the feet. Added in Equipment
  Asset Binding P0 after real-model QA showed a sit / bike pitch drifting head items off the head.
- Anchor positions are generic fractions of body height (`DEFAULT_EQUIPMENT_ANCHOR_LAYOUT`), not tied to
  any item or to the base model's node names; a future base character can pass its own layout.
- First person: `setFirstPerson` hides the root together with the character, so no equipment floats in
  front of the camera. Mount / dismount: anchors follow the rider pose; nothing is created or destroyed.
- `character-model.js` changes are minimal: create the anchors, follow the pose, follow first-person
  visibility, expose `getEquipmentAnchor(slot)`.

## Loader (`equipment-asset-loader.js`)

`createEquipmentModelLoader({ app, registry })` returns `loadEquipmentModel(modelAssetId)`. It looks up a
same-origin URL in `EQUIPMENT_MODEL_REGISTRY` (empty and frozen in this phase; unregistered ids reject without
touching the asset system) and instantiates a container render entity. It uses only the PlayCanvas asset
registry, so it is independent of the graphics device (WebGPU or the private #310 WebGL2 fallback). Tests inject
fake loaders. (Equipment Asset Binding P0 added the first two registry entries.)

## Tests and QA

- `apps/world/tests/equipment-projection.test.mjs` — eligibility, null-asset no-op, attach, replace,
  unequip, stale loads, account switch / logout / guest, status gating, failure, destroy, wiring.
- `apps/world/tests/equipment-anchors.test.mjs` — slot anchors, pose follow, fallback→GLB survival,
  first-person visibility, destroy, `character-model.js` contract.
- `apps/world/qa.mjs` — static contracts.
- Browser QA (1280×720, 360×740): production loadout with equipped items → no loader call, no extra
  entity; fixture-only fake HEAD / BACK models attached through an injected loader follow the character,
  hide in first person, survive mount / dismount and are cleared on unequip, account switch and logout;
  WebGPU and WebGL2 boots.

## Follow-ups

- **Remaining Equipment 3D Assets** — models for the other wearables (see `EQUIPMENT_ASSET_BINDING_P0.md`).
- **Multiplayer Equipment Projection** — implemented in P0 (`MULTIPLAYER_EQUIPMENT_PROJECTION_P0.md`).
- **Skin Authority / Projection** — separate system for the base character.
