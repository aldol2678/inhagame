# INHA OS · Induck Store v0.2.1 integration and live Phone authority
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

## LIVE-STORE follow-up (PR #418, 2026-10-15)

PR #416 was merged to main at `213bc98697efa04024405ec9d44d0db5c90136c5`. Its Store was mostly a self-contained demo iframe. PR #418 corrects the app operation authority without rewriting the original v0.2.1 UI or discarding its local mock content.

- Reviewed Store-ID → Phone-ID catalog includes **10 built-in Phone apps + 4 real external shortcut games**. `induck-pet` remains its own demo, **not** an alias for the released `induck-grow` game.
- The Phone Shell publishes a read-only, account-scoped projection of **installedApps, hiddenApps, systemIds, availableIds, homeIds, dockIds**. The Store displays it directly in the embedded **실제 스마트폰 앱 관리 / 홈** views. Independent standalone prototype mode remains unchanged.
- Store sends `install/uninstall/pin/open/home` requests to the still-active, same-origin iframe owner with bounded integer request IDs and an explicit catalog allowlist. Only the Phone Preferences owner changes its own state and saves it with existing storage readback. A rejected/failed write restores persisted preferences before the Store receives a failure result; no optimistic success display. No new service-side state/permission.
- Built-ins are not removable. External game installs only add local launcher shortcuts; `pin` shows/hides without deleting records. Successful execution routes existing native Phone apps via Phone Shell and installed external titles to a separate, explicit new-tab link. Installed/visible status is not taken from the Store's JSON backups.
- Mock-only apps, user app lab, updates, demo notes and JSON import/export remain isolated in embedded Store's own scoped local storage, visibly marked as a demo. They cannot create a trusted executable Phone app or overwrite the real launcher.
- Regression: `phone-store-integration.test.mjs`, existing preferences/shell/album/social/photo tests, full Smartphone integration browser workflow plus new store navigation and Home visibility verification. Physical Android/iOS, old backups and mobile iframe interaction remain release acceptance tasks.

**Validation state:** CI required after branch updates; Draft until tests and review. This follow-up does not automatically migrate or delete existing installs and does not authorize a manual Production deploy.
