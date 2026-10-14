# PWA-SHORTCUT-01 · Android installed PWA app shortcuts

Status: GitHub Draft PR. This patch adds home-screen long-press app shortcuts for the **existing** campus PWA, not Android native APK shortcuts or OS Push.

## Manifest scope
- Keep `id: /campus/`, `scope: /campus/`, `start_url: /campus/?lobby=1`, `display: standalone` and all existing Induck icons unchanged.
- Declare four named `shortcuts` within /campus/:
  1. 캠퍼스 입장: `/campus/?lobby=1&shortcut=campus`, normal main lobby
  2. 알림센터: `/campus/?lobby=1&shortcut=notifications`
  3. 오늘의 퀴즈: `/campus/?lobby=1&shortcut=daily-quiz` (NOT the unfinished INDUCK CAMPUS learning app)
  4. 사진 앨범: `/campus/?lobby=1&shortcut=album`
- A user's OS launcher/browser decides if and how many shortcuts appear. Installation may need time or browser-managed manifest refresh before changes propagate. Do **not** claim every Android/iOS launcher supports the same long-press items.

## Runtime admission
- Parse only one allowlisted shortcut query when `lobby=1`; unknown/duplicate params are ignored, and `shortcut=campus` naturally stays in the lobby.
- Do not bypass loading, lobby selection, account checks, map/room transitions, ongoing camera cutscene, InputFocus or existing Phone Shell admissions.
- After the player **manually** enters gameplay, an on-update one-shot dispatcher opens Phone then the requested existing app. It detaches on success/expiry, has no timer or network connection of its own, and expires after ten minutes to avoid surprises.
- A failed/blocked launch keeps the intent temporarily; the underlying UI admission or identity conditions remain authoritative. Nothing is auto-claimed, auto-answered or paid.
- On successful launch, remove only the `shortcut` query parameter by same-origin history replacement to avoid accidental repeated opens on refresh; do not alter browser history until success.
- No new service worker, Push subscription, database migration, Supabase RPC, permissions, download size or asset cache.

## QA/release gate
- Run `node --test apps/world/tests/pwa-shortcuts.test.mjs apps/world/tests/pwa-install-shell.test.mjs`.
- Test Android Chrome installed PWA long press, normal launcher entry, orientation, guest and member accounts, input lock/cinematic sequencing, Home/Back/Close, and foreground return. iOS behavior requires separate device QA.
- Existing required `verify` and scoped browser tests remain authoritative. Avoid unnecessary CI reruns or modifying the full CI policy.
- After review/merge, verify Vercel Production READY and `/campus/manifest.webmanifest` HTTP 200 and manifest contents. User should then check launcher menu directly.

Related: NOTI-01C PR #401 merged, https://github.com/aldol2678/inhagame/pull/401
