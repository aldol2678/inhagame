# Owned memorabilia preview: Housing B1 first step

## Implemented scope

A saved `furniture.dorm_trophy_shelf` offers the existing F/mobile interaction slot.
Its former unconditional gold cup has been removed. In the owner's own room, the
owner can select one currently owned badge or memorabilia item per shelf. The
shelf shows a small symbolic marker and an item-name plaque. It starts empty.

This is explicitly **owner-only, session-only preview**. The panel and nameplate
say so. Selecting a display does not consume or grant an item and does not write
the furniture layout. The choice is cleared on room/account changes, page hide,
access loss, shelf removal, and when an authoritative Inventory read no longer
contains the item. A refresh temporarily hides the preview until the current
ownership read succeeds. Failure provides a retry, without retaining a stale
owned display.

Visitors may open the shelf's informational panel. It explains that permission
to enter a room does not grant access to its owner's private Inventory. This path
never reads the Inventory snapshot or requests an Inventory refresh. The visitor
sees no owner's preview and no invented trophy.

## Authority and integration

- The existing `get_world_room_furniture_v1` result is the placement/role authority.
- The existing account-bound Inventory client is the current-ownership authority.
  No Collection discovery/history RPC is used; this does not duplicate the book.
- Owner preview requires the authenticated account, room owner, and Inventory
  account to agree. Client code is presentation; no new public data permission is
  inferred from these checks.
- `furniture-functions.js` contains B1 presentation metadata and a context-action
  provider. It consumes only authoritative `state.objects`, never a fabricated
  default station. The provider rechecks eligibility, object, distance, room,
  account, role and owner when a retained F/mobile callback is invoked.
- Seating remains on the existing seat interaction/pose lifecycle. `seat`
  registry entries alone do not create duplicate F actions.
- Cooking metadata is `COMING_SOON`, owner-only, radius 1.8, priority 170. Both an
  explicit `handlers.cook` and positive `isAvailable(feature, target, state)`
  are required. They do not replace the server's station/ownership validation.
- The display dialog uses the existing InputFocus blocking policy. It releases
  focus on close, transition, editing, account change and a newer blocking panel.
- Display-only renderer changes preserve the shared obstacle array, including
  obstacles appended by optional room decoration.

## Deliberately unsupported in this step

Persistent choices, cross-device restoration, and visitor-visible public
exhibits need a server-owned saved-display schema/read policy and a write path
that validates current ownership. No database schema or RPC has been added here.
No new acquisition path for the shelf or memorabilia has been activated.
The symbolic badge/wristband markers are not bespoke 3D catalog item models.

## Verification

- `node --test apps/world/tests/furniture-functions.test.mjs apps/world/tests/trophy-display.test.mjs`
- `node --test apps/world/tests/*.test.mjs`
- `node apps/world/qa.mjs`
- After installing the browser folder's pinned dependencies:
  `node apps/world/tests/browser/trophy-display-null-smoke.mjs`
- On a machine that can launch Chromium:
  `WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/trophy-display-smoke.mjs`

The NullGraphicsDevice check exercises the real pinned PlayCanvas layer, repeated
marker replacement, clearing, obstacle preservation and teardown. It is not
browser, screenshot, hardware or real-account evidence. The browser smoke uses
synthetic fixtures and the existing off-origin-blocking harness; it does not
contact Production or use a real account.
