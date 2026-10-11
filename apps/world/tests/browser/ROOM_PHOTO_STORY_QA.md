# Room photo story: offline browser integration

## Scope

`room-photo-story-harness.html` loads the production room guide/HUD, furniture client and editor,
personal-room environment controls, photo lifecycle/camera/input/capture/panel, smartphone, and
device-local IndexedDB album. Only the camera transform, 2D scene, accounts, and furniture RPC
responses are synthetic. The shared `harness.mjs` blocks off-origin traffic. Nothing logs in,
uploads a picture, or saves a room to a service.

The smoke checks:

- Desktop 1280×720, portrait 390×844, and landscape 844×390 guide layout, scroll reachability,
  minimum 44px targets, focus containment and close/resume. Guide and photo controls use touch
  activation in mobile emulation.
- Owner mood → owned recommendation → manual move → existing explicit save, or existing
  dirty-draft discard confirmation → light/curtain controls → photo → exact image in local album.
- PNG download and album-viewer original are byte-for-byte identical. A deliberately newer
  decoy photo prevents passing by selecting the latest record. Guide completion waits for
  actual image load, and Back returns to the album list.
- Guest and visitor have no guide entry and cannot open the owner-only guide or furniture
  editor directly. The existing generic camera remains available. Inventory remains unchanged.
- A genuinely saved local-photo callback held until after cancel, account change, room change,
  or persisted pagehide/pageshow events cannot complete/reopen a stale guide. Old editor
  completion callbacks are rejected after scope/lifecycle changes. New photo entry recovers.
- Persisted pagehide/pageshow during guided editing preserves the unsaved draft, undo/redo,
  and editor input ownership. Only guide continuation is detached; the editor resumes with
  ordinary completion and cannot reopen the stale guide.
- Photo close returns focus to a visible world/HUD target rather than the hidden guide.

## Run

From the repository root after installing the existing pinned browser-test dependencies and
Chromium in an environment that permits browser processes and loopback sockets:

```sh
node --check apps/world/tests/browser/room-photo-story-fixture.mjs
node --check apps/world/tests/browser/room-photo-story-smoke.mjs
node apps/world/tests/browser/room-photo-story-smoke.mjs
```

Optional environment variables:

- `ROOM_PHOTO_STORY_QA_OUTPUT`: report/PNG output directory (default `test-results/room-photo-story`)
- `ROOM_PHOTO_STORY_HEAD_SHA`: require a particular Git head
- `WORLD_SMOKE_EXECUTABLE`: installed Chromium path supported by the shared harness

The report includes candidate source hashes and compares them with the source bytes served
to the browser. Missing dependencies or failure before browser startup reports `BLOCKED`;
an assertion/runtime failure after startup reports `FAIL`.

## Verified here, 2026-10-11

- Both new JavaScript files pass `node --check`.
- Synthetic study/relax inventory recommendations and available manual moves pass a direct
  Node check against the production recommendation/placement validators.
- Local import targets and fixture module wiring were inspected.
- Browser acceptance is **not run / blocked**, not passed. A separate Chromium launch in this
  executor failed with `socket() failed: Operation not permitted (1)`. The smoke was not
  retried and no sandbox/security restriction was bypassed. No screenshots or browser PASS
  result are claimed.

## Remaining acceptance limits

This is not the real rendered room, live authentication/RPC persistence, physical-device touch,
safe-area/notch validation, walking/seating/collision, or actual browser BFCache restoration.
Persisted lifecycle events cover callback invalidation only. The full World entry/HUD wiring,
rendered composition, and actual BFCache navigation should be exercised separately in an
allowed browser environment before treating the feature as visually accepted.
