# INHA WORLD · Equipment Asset Binding P0 (first two equipment models)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| Equipment Loadout Authority | **IMPLEMENTED** (`docs/world/APPEARANCE_LOADOUT_AUTHORITY_P0.md`) |
| Wardrobe UI | **IMPLEMENTED** (`docs/world/WARDROBE_UI_P0.md`) |
| Local Equipment Projection Infrastructure | **IMPLEMENTED** (`docs/world/LOCAL_EQUIPMENT_PROJECTION_P0.md`) |
| Equipment Asset Binding P0 — `head.induck_cap`, `back.induck_backpack` | **IMPLEMENTED** (this document) |
| Equipment Asset Expansion P1a — `top.induck_hoodie` | **IMPLEMENTED** (`docs/world/EQUIPMENT_ASSET_EXPANSION_P1.md`) |
| Remaining Equipment 3D Assets | FOLLOW-UP |
| Multiplayer Equipment Projection P0 | **IMPLEMENTED** (`docs/world/MULTIPLAYER_EQUIPMENT_PROJECTION_P0.md`) |
| Skin System | SEPARATE FOLLOW-UP |

This phase connects the first two real equipment models to the existing pipeline. It is **Equipment
Asset Binding**, not a skin: the base Induck character, its GLB and every other system stay as they
were. Order of the axes: Base Character / Skin → Equipment Loadout → Equipment Projection.

## What renders

| Item | Slot | modelAssetId | URL | GLB |
| --- | --- | --- | --- | --- |
| `head.induck_cap` 인덕 캠퍼스 캡 | HEAD | `equipment.head.induck_cap.v1` | `/assets/induck-cap-v1.glb` | 34,788 B · 6 meshes |
| `back.induck_backpack` 인덕 백팩 | BACK | `equipment.back.induck_backpack.v1` | `/assets/induck-backpack-v1.glb` | 19,224 B · 8 meshes |

Every other catalog item keeps `modelAssetId: null` (equipping it shows nothing, as before). No item's
category, slot, status, rarity, acquisition or id changed; the two items keep their canon status
(`COMING_SOON`, which the projection renders).

## Binding flow

```
Wardrobe → equip RPC → server loadout → loadout client re-read → Equipment Projection
  → catalog getItemDefinition(itemId).modelAssetId → EQUIPMENT_MODEL_REGISTRY[modelAssetId] → URL
  → PlayCanvas container load → instantiate → HEAD / BACK anchor
```

- `item-catalog.js`: `item()` takes an optional `modelAssetId` (default `null`); only the two items set it.
- `equipment-asset-loader.js`: `EQUIPMENT_MODEL_REGISTRY` holds exactly the two ids. There is no
  itemId → URL mapping anywhere; the projection core has no cap / backpack code.
- Asset reuse: PlayCanvas `loadFromUrl` returns the already-loaded container for a known URL, so
  equip ↔ unequip ↔ re-equip instantiates a new entity from the same asset. Browser QA: 4 loads, one
  download per GLB. No extra cache layer.

## Assets (`apps/world/assets/`)

- `build_equipment.py` — generates both GLBs from original low-poly geometry (flat-colour PBR, no
  textures, nothing downloaded) with the same `Glb` writer as `build_characters.py`. Deterministic:
  re-running produces byte-identical files (a test rebuilds into a scratch directory and compares).
  `EQUIPMENT_GLB_OUT=<dir>` writes elsewhere.

  *Public note:* the brand GLB builders (`build_equipment.py`, `build_characters.py`) are kept in the
  private repository; this repository ships independent QA geometry and serves brand assets through
  the brand asset proxy, so the rebuild test is not part of it.
- `check_equipment.mjs` — GLB magic / version 2, chunk and buffer bounds, index bounds, flat-colour
  materials, no textures, the expected scene root and mesh names, no node transforms, size < 64 KB.

### Authored in anchor space (no per-item transform)

Both models are modelled directly in their anchor's space, so the projection attaches them as-is:
World units (character height 0.875), +Y up, the character faces **+Z** (the Induck beak points to +Z).

- **Cap** — origin = HEAD anchor (0.97 × height above the feet). A navy crown dome over the head top,
  orange band, a navy visor to the front (+Z) that tapers to the sides, a button and a white front patch
  with a navy "I" mark.
- **Backpack** — origin = BACK anchor (0.55 × height above the feet, 0.12 × height behind the axis). A
  navy pack hanging below and behind the anchor, just outside the Induck body's back, with an orange
  flap, a blue front pocket with a zip line and a small top handle. Shoulder straps were tried and
  dropped: the round Induck body has no shoulders for them to wrap over, so they floated.

No item-specific transform table was needed. Fit is tuned for the Induck GLB; on the primitive
fallback the same anchors are used and the models still attach (fit is approximate there).

## Infrastructure fix found by real-model QA

With real models attached, a sitting pose (`bodyPitch -6°`) moved the cap about 0.05 away from the
head: the equipment root rotated about the **feet** while the Induck visual rotates about its **own
origin**. `equipment-anchors.js` now pivots at the visual's origin (`follow({ pivotY })`: `Equipment_Root`
sits at the pivot and carries the rotation, `Equipment_Frame` shifts back down to the feet) and
`character-model.js` passes `pivotY: pose.y` (one argument). Anchor positions and the projection core
are unchanged.

## Wardrobe note

The Wardrobe note now reads "3D 모델이 지원되는 장비는 캐릭터에 바로 반영돼요." — it does not claim every
wearable renders. No "3D supported" chip was added.

## Tests and QA

- `apps/world/tests/equipment-asset-binding.test.mjs` — catalog / registry binding, GLB validity and
  reproducibility, anchor-space bounds, attach / unequip / null-model replace / account switch / logout /
  stale loads / load failure / first person / mount / fallback on the real catalog and anchors.
- `equipment-projection.test.mjs`, `equipment-anchors.test.mjs` updated for the binding and the pivot.
- Browser QA (real catalog, real GLBs, WebGPU and WebGL2, 1280×720 and 360×740): Wardrobe equip of cap
  and backpack → models on HEAD / BACK measured against the Induck head and body meshes (cap covers the
  head top with the visor forward, backpack behind the body); walk, rotate, camera orbit, sit, emote;
  first person hides both and third person restores; dragon mount → ride → dismount keeps the same
  entities; unequip one keeps the other; null-model replace clears both; account switch clears A's cap
  before B's loadout arrives; logout clears; guest loads nothing; primitive fallback character still
  attaches both; a failing cap GLB leaves the backpack, the World and the Wardrobe working; 0 console /
  page errors. WebGL2 rendered screenshots were checked by eye (front, side, back).

## Not changed

`supabase/**`, RPCs, ownership / loadout / Shop / Wallet / Reward / EXP authorities, MCM rewards, the
Realtime protocol, multiplayer appearance, the base Induck and dragon GLBs, the projection core, the
private #310 graphics device (`createWorldGraphicsDevice`, WebGPU / WebGL2 fallback, `rendererName`). No skin
concept was added.
