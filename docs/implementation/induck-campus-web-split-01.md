# INDUCK-CAMPUS-WEB-SPLIT-01 — standalone learning entry

Scope: W1 implementation, based on Draft #430 at `2bbaaadddfa5e053e707cf7e22ac0333ef9248b6`. #429 remains at `82ceb7989cb2f48b2f3301c3013531c0114f45c9`, based on main `1a8466a2bb715dcc44aad3dece83e358ec442ca1`. Neither existing branch is rewritten. The new Draft is stacked on `codex/phone-learn-01-r1b`.

The authenticated Drive handoff ZIP was read outside Git, including ARCHITECTURE_DECISION.md and CODEX_ASTRA_IMPLEMENTATION_HANDOFF.md. ZIP SHA-256: `384f34940152b5270b6d1dfb8263bc0fb27b0d886a9e0c6010072154af2b4c28`. No private question assets were copied into this change.

## Runtime and ownership

- `apps/world/learn/index.html`, `learn.css`: independent noindex document and responsive layout, 44px controls, safe areas, skip link, labelled login inputs and live status. The default page is a preparation screen with zero questions.
- `src/learning-web/entry.js`, `app.js`: page-owned controller lifecycle and error boundary. Reuses all ten existing learning modules (only the controller error copy becomes host-neutral), including speech fallback, 15-lesson English structure, retained Chinese/Japanese metadata, boss/mastery/review, JSON import/export, recovery, outbox/CAS/readback. No World, Phone, PlayCanvas, canvas, WebGPU, GLB or game animation loop in this import graph.
- `auth.js`: existing public-config endpoint and Supabase SDK, same project/default storage key as `hub-account.js`. It does not import hub profile/activity side effects or create anonymous accounts. Password login uses the existing account; signup/Google login opens the existing hub account page. `detectSessionInUrl:false`, no URL tokens or new OAuth authority.
- `navigation.js`: fixed same-origin routes only. Incoming query/hash is discarded, never interpreted as credentials, a release gate or redirect. Static campus return is `/campus/?lobby=1`; Daily Quiz is `/campus/?lobby=1&shortcut=daily-quiz`. It may reload the game and is labelled accordingly.
- `src/phone/learning-launcher.js`: small presentation adapter using existing `available/mount/unmount/setAccount/dispose` interface. Stable app ID `learning`, preferences, Shell states and InputFocus remain owned by unchanged Smartphone/catalog. Explicit `/learn/` anchor with `_blank` and `noopener noreferrer`, plus return-to-world button. No auth, storage, learning engine or cloud code in launcher.
- `main.js` injects that launcher instead of the native controller; campus no longer loads learning CSS. The production World import graph does not load learning modules. Historical native-host browser tests retain their original assertions using an explicitly test-only adapter and stylesheet response.
- `dev-server.mjs` and `vercel.json` map `/learn` and `/learn/` to the independent document. This is the same `apps/world` build/deployment, **not** independent Vercel deployment. PWA manifest and root scope remain unchanged.

## Auth, records and failure boundaries

Before rendering personal records, Auth verifies a pinned session JWT through `getUser()`, requires a matching non-anonymous ID, and reads back the unchanged session. Every Auth event fences prior async verification with an epoch/abort signal. SDK Auth calls themselves are not cancellable; late results are discarded. Replacing the controller cancels actual learning RPCs through the existing cloud transport.

An account change or logout hides and clears the old controller before awaiting the network; guest and member keys never merge implicitly. Same-account token revalidation hides personal UI while retaining unsaved in-memory results. Failed verification stays locked. BFCache pagehide unmounts; persisted pageshow revalidates before remount. Non-persisted pagehide disposes. The Auth SDK broadcasts signout/account changes between same-origin tabs. SDK/config unavailable offers a full reload; verification failure offers a recheck.

The existing `inha-world-learning-v1:guest` and `inha-world-learning-v1:user:<id>` keys, sync outbox and recovery keys are unchanged. Same scheme/host/port/profile restores the previous local record. Another origin/profile/private window does not share it; explicit reviewed JSON import is retained. A previously verified open page can keep working offline; a fresh offline load cannot verify the member and stays locked without deleting its local data. Unpersisted memory still requires export/retry before closing the document or switching accounts.

Local failure remains visibly unsaved and exportable, with stale-tab writes refused. Cloud pending, ACK and separately verified readback stay distinct. No automatic conflict merge or source deletion is added. Both SQL migrations, RLS/DEFINER privileges/search_path, UUID identity, revision CAS and request/recovery limits are byte-for-byte inherited from #430. No operating DB was contacted by QA; the real Auth/PostgREST harness rejects non-loopback URLs.

## Release boundaries

All three release controls are OFF: existing content and cloud releases, and new `LEARNING_LAUNCHER_RELEASE`. No query/localStorage/window override is shipped. Synthetic course/Auth or loopback cloud activation is injected only into Playwright responses; no question bank, answer asset or approved manifest is shipped. No Wallet, economy/EXP, Daily Quiz answer/reward, ranking, SQL or content-approval change.

Opening a separate tab preserves the original game document in Chromium QA and releases World input on existing Phone exit. An installed PWA may route an in-scope URL differently; physical Android/iOS and installed-PWA routing are **UNKNOWN**. No manifest/install identity change or claim of seamless session resume.

## Reproduction and evidence

Run from repository root (Node and browser dependencies as pinned by existing CI):

```sh
node --test apps/world/tests/learning-web.test.mjs apps/world/tests/phone-*.test.mjs apps/world/tests/daily-quiz.test.mjs apps/world/tests/daily-panel-focus.test.mjs apps/world/tests/daily-reward-readback.test.mjs apps/world/tests/pwa-shortcuts.test.mjs
node --test apps/world/tests/*.test.mjs
npm ci --prefix apps/world/tests/browser --ignore-scripts --no-audit --no-fund
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/learning-web-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/learning-web-campus-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/phone-learning-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/phone-learning-remediation-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/phone-learning-campus-smoke.mjs
sh apps/world/build-recast-shadow.sh
```

Only against a disposable loopback Supabase stack with the repository migrations:

```sh
supabase test db supabase/tests/database/96_learning_progress.test.sql supabase/tests/database/97_learning_remediation.test.sql
node scripts/learning-cloud-local.mjs
node scripts/learning-cloud-local.mjs --browser
node scripts/learning-cloud-local.mjs --web-browser
```

Local verification before commit: targeted Node 301/301; full World Node 4,969/4,969 before the final added Auth failure case (the final full count is verified in CI); standalone 4/4 viewports; real web Auth/cloud 2/2; inherited SQL 61/61; local API 3 PASS / 1 economy SKIP; build PASS. The private audit found zero matches across 1,793 local deploy-source/generated text files using 574 fingerprints from the unapproved 180-question bank. This is not a deployed Preview scan.

`Phone Learning QA` adds the new Node suite, standalone four-viewport matrix, actual campus launcher matrix and real Auth web matrix to all previous tests. It checks the checked-out SHA against PR head and uploads JSON reports/screenshots. Public CI and Phone browser CI remain intact. Skipped/cancelled/pending checks are not PASS. Exact-head run links and final counts belong in the Draft PR description and delivery report.

The local minimal Postgres/Auth/PostgREST fixture exercises the 61 SQL assertions and API ownership/CAS/contract/capacity tests but has no economy schema: the economy integration assertion is SKIP locally, requiring full-lineage CI. Production and Vercel Preview behavior are not inferred from local dev-server success.

## W2/W3 and merge gates

W2 must choose a coherent stack landing/ownership strategy after independent review. This PR depends on #430, which depends on #429. Do not land only the old native UI and call the web transition complete; do not merge this child directly into main while excluding its prerequisites. This task does not rewrite existing PRs or authorize any merge.

Before release: independent review of the final stack/SHAs; all applicable exact-head checks; actual Preview `/learn` + `/learn/` routing and asset/network inspection; physical Android/iOS and installed PWA new-tab/return, keyboard/microphone/orientation checks; approved content manifest (currently 0/180, English educational review still pending); separate reviewed production migration/capacity/retention/privacy plan; explicit flag/deployment/merge authorization. R2 league and independent-domain/deploy/PWA work remain separate. This Draft implements the entry and QA, not production rollout.
