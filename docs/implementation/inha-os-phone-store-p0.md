# INHA OS · Induck Store v0.2.1 actual Phone integration (Draft #416)
Status: **candidate / PR only**. No main merge, Production deploy, game-save migration, new DB/RPC or reward grants.
2026-10-15. Source from the user's Library `INDUCK_STORE_v0.2.1.html` + `INDUCK_STORE_v0.2.1_PATCH_NOTES.md`. Original Library file stays unchanged.

## Integration scope
- The full v0.2.1 single-file HTML UI is imported to `apps/world/campus/induck-store-v0.2.1.html` with narrowly scoped embedded-mode adaptations. Search, discovery, categories, installed view, app detail, favorites, updates (demo), notes, backup/restore, local app lab/recycle bin, and corruption recovery remain present.
- Existing 9 Phone apps, Phone Shell input ownership, world camera/maps panels, album, messages, notifications, game saves, wallet, quests, economy, and backend auth are untouched.
- `induck-store` (always available, non-removable) hosts the original UI in a same-origin iframe inside Phone. Two nav bars intentionally remain distinct (Phone Back/Home vs Store internal navigation); the inner fake status bar is hidden only in embedded mode.
- No third-party script, arbitrary app execution, iframe injection, remote catalog, login token transfer, or automatic external navigation.
- The parent checks `postMessage` origin, iframe window identity, allowlisted event type and IDs. The child checks parent source/origin. On installation, a successful local parent Phone preferences write is separately required; local store demo state isn't proof of real launcher installation.
- Native Store IDs `map/camera/album/student-id/settings` route to existing Phone app IDs through the bridge. Store ID `induck-pet` maps to the verified `induck-grow` standalone shortcut. Added standalone game listings `induck-classic`, `induckup`, `induck-survival` route to their existing fixed URLs (after user taps the explicit external link). All remaining v0.2.1 catalog apps remain **prototype-only** and retain their demo screens, even when the Store says "installed".
- Home settings still use `inha-world-phone-home-v1:<scope>`, `version:1`, optional `installedApps` and only the four allowlisted standalone game shortcuts. Removing an app shortcut does not delete game progress.

## Local state and old data
- Standalone original Store default keys remain `induck-store-v02` / `induck-store-v01`; embedded mode uses `induck-store-v02:phone:<scope>` (and scoped recovery/legacy keys), preserving account/guest separation.
- Legacy standalone file data are NOT automatically copied to the embedded scope; use the original v0.2.1 JSON backup then the embedded Store's JSON restore after confirming data scope and content. This does **not** transfer game saves.
- Embedded UI can present demo installed listings (e.g. InduckTalk), whereas real Phone app installation is restricted to implemented game shortcuts. No claim is made that unreleased apps are operational.

## QA / release gate
- `node --test apps/world/tests/phone-preferences.test.mjs apps/world/tests/phone-app-catalog.test.mjs apps/world/tests/phone-shell.test.mjs`
- `PHONE_HEAD_SHA=$(git rev-parse HEAD) WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/phone-campus-smoke.mjs` (now includes iframe search/install/open/back/uninstall)
- Existing Phone, photo, social, account-switch, album export/restore and UI-icon suites remain required, plus real-device Android/iOS and Storage partition checks. The original standalone v0.2.1 test 16/16 is **not** a replacement for integrated QA.
- No merge/deploy until CI and mobile/backup behaviors pass. Do not reset existing user storage as a 'fix'.
