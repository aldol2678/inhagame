# INHA OS P0 · Phone catalog and Induck Store shortcut shell
Status: **candidate branch / review only**. No main merge, Production deploy, new database/RPC, game-save migration or reward credit.
Scope: `apps/world/src/phone`, `apps/world/phone.css`, Phone tests.
Date: 2026-10-15.

## Ownership / source
- Existing Phone Shell and focus/Photo/Maps/Notifications remain the only navigation owner.
- A static trusted catalog in `phone-app-catalog.js` defines 9 legacy system apps, new built-in `induck-store`, and four explicitly installable external game shortcuts.
- Browser does not embed external games or send tokens via a URL, frame, or postMessage. Only allowlisted literal HTTPS game URLs are rendered as `target=_blank rel=noopener noreferrer` anchors after a separate user click.
- Existing Hub Messages, server economy/EXP/inventory, and original game saves remain untouched.
- This is **not** the complete Induck Store v0.2 prototype, nor real app installation/SSO: "설치" means local Phone launcher placement only. Unreleased InduckTalk/InduckLog/Finance apps are not given fake launch surfaces.

## Migration
- Legacy `inha-world-phone-home-v1:<scope>` key and `version:1` are unchanged.
- Optional `installedApps` array holds an allowlisted subset only; missing array means no external apps installed. Existing pages, Dock, wallpaper, student-card face, hidden apps are preserved. New system store is inserted into the first free page slot.
- `hide` is launcher-only, `uninstall` prunes the shortcut; neither deletes stored progress or in-game economy.
- Home and installed apps are scoped to the existing account/guest album scope; account transition calls existing `preferences.load()`.
- Storage write failures use existing warning behavior; no misleading server success.

## Validation
- `node --test apps/world/tests/phone-preferences.test.mjs apps/world/tests/phone-app-catalog.test.mjs apps/world/tests/phone-shell.test.mjs`
- `PHONE_HEAD_SHA=$(git rev-parse HEAD) WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/phone-campus-smoke.mjs`
- Required World CI and phone, photo, account-switch, notifications and UI-icon browser regressions remain unchanged and must pass at the *exact* candidate head.
- Physical Android/iOS PWA, existing-install upgrade, GPU behavior, account A/B persistence and external new-tab return remain **UNKNOWN** until real-device checks.
- Do not merge or deploy until required CI and mobile regression criteria pass.
