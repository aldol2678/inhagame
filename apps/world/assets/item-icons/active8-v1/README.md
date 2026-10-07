# ACTIVE8 inventory icon runtime exports

The 32 PNGs are byte-identical exports from `inha.inventory.active8.icons.v1` (2026-10-07), independently generated with built-in imagegen and reviewed at 32/64 pixels on light/dark backgrounds. No art was regenerated for this integration.

`manifest.json` is the unchanged source-pack provenance manifest. Its `runtimeIntegrationPerformed: false` describes the original asset-only delivery, not the current runtime. Master paths/hashes identify archived originals; masters are intentionally not shipped in the web app. The catalog at source creation was `c4fe1bcb30183c793cb4829f04e2b65590f92253`; runtime integration started from `439213f74a0c9d9a6c73041a46884b61fa2053c2`.

- Exactly eight ACTIVE catalog item IDs bind the corresponding `icon.<itemId>.v1` IDs
- Inventory/current mementos use 64px and 128px 2x files at a fixed 48 CSS-pixel slot
- Collection discovery uses only the already-discovered `collection.fish.carp` record; unrevealed and owner-derived records fetch no icon
- Unknown bindings and load failures keep item names, quantities and a labelled same-size fallback
- Cap brand marks are intentionally absent pending approved references; the gate badge is abstract, not a claim of architectural accuracy
- No ownership, economy, reward, equipment model, discovery, server/API or DB behavior is changed

Tests: `node --test apps/world/tests/item-icons.test.mjs` verifies exact IDs, dimensions, RGBA and source SHA-256 for every export, fixed local paths, safe fallback and privacy guards.
