# World stability QA

This change reuses the earlier five-module stability patch and its 142 regression cases, preserving current PlayerController student-center, combat and shuttle behavior. Two additional post-readback generation checks prevent shop/loadout results from escaping into a different account after an awaited refresh. Server-side mutation authority and request counts are unchanged.

## Local verification

- `node --test apps/world/tests/shop-loadout-readback-account.test.mjs`: 54 cases covering purchase/equip/unequip, A→B, A→B→A, logout, success/refusal, successful/failed readback, current in-flight ownership and retry keys, plus the actual ShopPanel's hint/toast/callback/wallet consumers
- `node --test apps/world/tests/world-stability-browser-contract.test.mjs`: bounded/read-only workflow assertions and executable production-module fixture checks
- `bash scripts/public-ci.sh`: complete non-database local gates, including Recast WASM and TypeScript/Vite build

An unknown readback result must not change a same-account committed SUCCESS into a purchase failure. An account-generation change must return STALE. Neither case may silently repeat a purchase/equip/unequip.

## Hosted Chromium

Workflow: `.github/workflows/world-stability-browser.yml`

It checks out the exact PR head, uses the pinned browser dependencies, and runs:

```sh
EXPECTED_STABILITY_HEAD=$(git rev-parse HEAD) \
WORLD_SMOKE_BROWSER=chrome WORLD_SMOKE_DISABLE_WEBGPU=1 \
node apps/world/tests/browser/world-stability-smoke.mjs
```

The existing offline harness serves only local files, stubs backend startup, blocks off-origin traffic and uses no secrets. The stability fixture instantiates production clients and ShopPanel with real browser DOM but synthetic accounts and manually controlled RPC promises. No actual sign-in, purchase, reward grant, database write or production request occurs.

Desktop 1280×800 and mobile 390×844 coverage:

- Real ShopPanel click → successful synthetic purchase → delayed readback → A→B / A→B→A / logout → late success/error; no old hint, toast, callback or wallet read
- Equip/unequip readback boundaries; current retry-key preservation; attendance/quiz old-read suppression and deferred read coalescing
- Chromium-native trusted touch input via CDP, two-pointer ownership, foreign-pointer release, native gotpointercapture/lostpointercapture, input-disable release and fresh gesture recovery
- Explicitly synthetic DOM blur/pagehide dispatch checks inside the real browser

The artifact `world-stability-browser-evidence` contains `report.json` with exact head, assertions, event provenance and SHA-256 hashes, plus four screenshots. Failure screenshots and report are preserved when possible. Screenshots are a labelled test surface rather than a full campus render.

## Limitations and authorization boundary

Native capture evidence does not establish physical-device touch behavior. Synthetic blur/pagehide is not OS focus-loss or BFCache navigation evidence. The fixture is not a production login or financial transaction smoke test. Database changes, merge and production deployment are outside this change. Hosted public CI may separately replay the repository's disposable local development database as its normal PR gate.

## Chromium touch adapter compatibility

The runner verifies trusted `pointerup` for the actual foreign pointer before claiming a partial release. It first tries the current active-point-list protocol, then uses the older `CreateWebTouchEvents` explicit-ended-point form only when no native release occurred. The report records the selected form. Capture loss always targets the original owning pointer ID; another finger can have implicit browser capture even when the controller correctly ignores it.

References: [CDP Input schema](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Input.pdl), [Chromium InputHandler implementations](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/input_handler.cc).
