# PWA portal integration A1

Baseline: main d67b1ba2b1fab882b0136dd22c5a36c4f92661ba; related merged PRs #395, #401, #410. Implementation scope: extend the existing manifest scope to `/`, and link that same manifest from the integrated portal. Existing `id: /campus/`, manifest URL `/campus/manifest.webmanifest`, `start_url: /campus/?lobby=1`, INHA WORLD brand, all six icon files and four campus shortcut URLs remain unchanged.

## Deliberate release boundary

This is **A1, not the root-launch A2 migration**. The installed launcher still starts at the campus lobby. The wider manifest scope allows the portal to be part of the installed app's navigation context on supporting platforms after their manifest update. A root portal install uses this same existing identity; no second app identity is introduced. There is no redirect of `/campus/` and no redirect of independently hosted games.

Changing `start_url` to `/` is deferred until existing-install upgrade tests are recorded on Android WebAPK and iPhone/iPad Home Screen apps. Source tests and desktop browser checks cannot establish OS propagation, app selection, session restoration or iOS storage continuity. Old installations that do not refresh their manifest retain their existing campus start and remain functional. Do not ask users to uninstall as a default migration step: local guest progress or installation-specific data may be lost.

## Unchanged runtime and security

No Service Worker, Push API/subscription, offline cache, new storage, authentication or database logic is introduced. Manifest scope and service-worker scope are distinct. The existing Phone shortcut admission, one-shot/expiry behavior and account epoch boundaries are unchanged. Existing `serviceWorkers: 'block'` browser fixtures remain suitable for this no-SW patch; their passing must not be presented as validation of a future service worker.

## Verification

Run `node --test apps/world/tests/pwa-install-shell.test.mjs apps/world/tests/pwa-shortcuts.test.mjs apps/world/tests/pwa-visual-guard.test.mjs apps/world/tests/pwa-portal-integration.test.mjs`. The new contracts check one shared manifest link, unchanged absolute app identity and launch URL, widened same-origin scope, exact shortcut URLs and original icon blob hashes. Full required repository CI and integrated browser QA remain separate release gates.

After deployment, read back manifest status/MIME/body and both HTML manifest links. Actual Android/iOS pre-existing-install upgrade, launcher/shortcut refresh, in-scope navigation, guest/member auth restoration and WebGPU runtime are **UNKNOWN until measured**. Record OS/browser versions, old and new manifest values, installation type and observations. A successful fresh install alone is not an upgrade test.

Rollback consists of restoring the old manifest scope and removing the portal link if needed; OS manifest rollback can also be delayed. No cache/storage purge or mass unregister is part of rollback.

## Official basis (read 2026-10-14)

- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id — app identity is distinct from scope/start URL.
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope — manifest scope controls installed navigation context, not cross-origin games.
- https://web.dev/articles/manifest-updates — preserve the manifest URL; Chrome metadata updates are asynchronous. This article was last updated 2024-09-19, so device-specific behavior still needs current testing.
- https://webkit.org/blog/13878/ — iOS/iPadOS Home Screen identity behavior is not interchangeable with Android WebAPK update behavior.
