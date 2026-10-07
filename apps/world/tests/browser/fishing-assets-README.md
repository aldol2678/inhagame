# Hosted fishing asset diagnostic

Run from a **committed, clean candidate checkout**, with the existing browser package installed:

```sh
npm ci --prefix apps/world/tests/browser
npx --prefix apps/world/tests/browser playwright install --with-deps chromium
WORLD_SMOKE_DISABLE_WEBGPU=1 \
EXPECTED_ASSET_RUNTIME_HEAD="$(git rev-parse HEAD)" \
FISHING_ASSETS_OUTPUT=test-results/asset-runtime/fishing \
node apps/world/tests/browser/fishing-assets-smoke.mjs
```

The runner uses the shared offline server/Playwright harness and pinned PlayCanvas 2.22.4. It requires WebGL2, bounds frame/operation/overall waits, and exports report.json plus labeled screenshots. It verifies HTTP payload hashes against the exact Git HEAD, including the original three fishing GLBs and two PNG atlases. All network operations must be GETs; any API/off-origin request fails. The synthetic fishing transport is entirely in-memory, including account binding and settlement. No real account, inventory or reward is touched.

Six cases cover 1280×800 desktop, 390×844 portrait and 844×390 landscape at both canonical shores. Each exercises waiting, a current bite, a pending hook without a speculative fish, synthetic authoritative success, result refresh/replay, close/reopen, suppression/resume and idempotent disposal. Component-specific visible/hidden/restored framebuffer deltas prove rod, float, fish, ripple, splash and immediate-line contributions. The report includes projected pixel regions, exact frozen-frame restoration, resource identity, real GL buffer/texture survival, and one HTTP fetch per original asset across repeated disposal/recreation.

The fixture preserves the production createCharacter and equipment-anchor code path, but the visible induck-v3 GLB is an **independent public QA cuboid proxy**, not the original duck mascot. ASSET_PROVENANCE.json pins it to SHA-256 `5057f3299a9d7e902b1370d203fa93e8279a2ff27a8bc2bdf68f09fe312c58f2`. NOTICE.md states that original mascot assets are withheld and technical filenames/attachment names exist only for API compatibility. DuckWing_R therefore identifies a compatibility node, not an anatomical wing or hand.

The runner verifies the proxy bytes and provenance against those disclosures and the exact Git HEAD, records them in avatarProvenance/sourceHashes, and requires the matching HTTP payload. Every screenshot labels the public QA proxy and excludes duck hand-fit acceptance. The report always records anatomicalFitValidated=false.

A magenta synthetic wardrobe sentinel stays on the production ACCESSORY anchor while fishing uses the separate Activity_Grip_R. Both shores get fitted **QA proxy grip/compatibility-node** close-ups. Node-origin distance is descriptive compatibility evidence only; these images cannot validate real duck anatomy or hand placement.

This is a synthetic scene with diagnostic lighting/cameras and frozen server replies. It is **not full-campus acceptance**, a live server/reward test, or proof of night/rain/first-person/device-loss behavior. Original mascot hand fit remains unvalidated regardless of this gate’s result. Pixel thresholds require hosted execution; Node and NullGraphicsDevice checks alone do not establish GPU success.

Local preflight without launching Chromium:

```sh
node --check apps/world/tests/browser/fishing-assets-harness.mjs
node --check apps/world/tests/browser/fishing-assets-smoke.mjs
node --test apps/world/tests/fishing-assets-browser.test.mjs
node --test apps/world/tests/*.test.mjs
```

If shared harness startup fails before returning its browser/server handle, this runner saves a failing report and exits explicitly; the hosted job must clean up any orphan server process. It performs no browser retries.
