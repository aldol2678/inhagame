# PHONE-LEARN-01 / R1-B — account cloud progress (Draft)

Depends on unmerged Draft PR #429, exact base `c773b137ec9252573e519dd025c670774c086bbc`. Start-of-task `main` was rechecked at `1a8466a2bb715dcc44aad3dece83e358ec442ca1`. No merge, Production deployment, operational database write, content approval or economy change is part of this task.

Current follow-up: [R1-B remediation evidence and retention/contract policy](phone-learn-01-r1b-remediation-01.md). It supersedes the original retention gate and backup format description below.

## R1-A prerequisite review

This is a fresh review pass by the original implementing agent, **not independent approval**. A separate human/security reviewer is still required before merge.

- **P1, fixed first in fb1d05a2:** two instances loaded the same account; A saved a completed lesson; stale B overwrote it. A failed import also wrote its old snapshot unconditionally as rollback. `phone-learning-review.test.mjs` first reproduced both failures. Compare stored bytes with the loaded baseline before save; refuse stale writes while retaining memory for backup; never perform an unconditional rollback write. LocalStorage is not a cross-process transaction: this is stale-write detection, not an atomic multi-tab database. Cloud CAS is the authoritative concurrency boundary. R1-B additionally writes and verifies a rolling recovery copy per writer/account before replacing the primary key. Even an inter-process race retains both writers’ snapshots for explicit backup/recovery; no automatic merge is claimed.
- **P2, fixed:** raw future-version records could enter the legacy import path. Reject explicit unsupported versions. All three reproduction tests failed before the patch and passed after it; prerequisite Phone/learning/Daily Quiz regression was 30/30.
- Content release remains a source-controlled OFF capability. The loader checks approval, rights, digest, exact ID/version set and rejects demo banks. Catalog injection is for trusted callers/tests; it is not an authorization boundary against modified application JavaScript. No URL/storage activation or new content was added.
- Controller load/dispose and speech generation guards, account-change unmount/buffer clearing, Phone Shell/InputFocus and Daily Quiz routes were reviewed and tested. No additional P0/P1 found in those reviewed paths. The new cloud work adds its own epoch, token pinning and abort guards.
- Private source/QA and all 180 unapproved items remain outside Git. Public tests use synthetic `test.*` records only.

## Verified deployment mapping (read-only, 2026-10-19 UTC)

Fetched `https://inhagame.app/campus/` and its `/api/public-supabase-config` script anew. The deployed script points to `https://oosshdsthgpqabjmbkjo.supabase.co` with a browser publishable key. Read-only Supabase project listing identifies that exact ref as **GAMES**, PostgreSQL 17.6. This is current deployed evidence, not an assumption from the older fishing report. No project SQL, migration or operational data mutation was sent to that project. API keys/tokens are not copied into this report or source.

Supabase skill/docs checked: current RLS and RPC/abortSignal guidance and the October 12 TLS cipher deprecation (earliest November 10). No new frontend framework or runtime Supabase client is introduced; `main.js` reuses `online.supabase`. A pinned Supabase SDK exists only in browser QA dependencies.

## Storage and authorization contract

Migration `20261019012613_world_learning_progress_r1b.sql` is a repository candidate only.

- `public.world_learning_progress`: one row per Auth `user_id`, monotonic `revision`, strictly validated progress JSON and server `updated_at`. RLS permits only the signed-in non-anonymous owner's SELECT. No client has INSERT/UPDATE/DELETE grants.
- `private.world_learning_requests`: immutable `(user_id, request_id)` receipts, expected/committed revisions and the exact sanitized snapshot. RLS enabled and no direct client table grants. Receipts retain payloads to compare retries exactly; retention/quotas require an explicit rollout policy. Do not prune casually: that changes idempotency guarantees.
- `world_learning_read_v1()` and `world_learning_save_v1(request_id, expected_revision, progress)` expose no target user parameter. The read RPC is SECURITY INVOKER. To preserve the repository prohibition on client access to the entire private schema, the narrowly granted public write wrapper is SECURITY DEFINER with an empty search_path, following the existing account API pattern. Its private invoker helper is not executable by clients and checks `auth.uid()`, signed `is_anonymous=false` and actual `auth.users.is_anonymous=false`, and locks the owner's transaction. Definer rights are necessary to deny direct table writes and private-schema access while enforcing CAS. The generic grants contract keeps its private-access prohibitions unchanged and allowlists only the two named public RPCs and owner-only SELECT table. No dynamic SQL or economy calls.
- New request: require exact current revision and increment once. Same ID/same body returns its original receipt without writing. Same ID/different body is rejected. Stale/different requests receive `PT409` / HTTP 409. Authentication failures receive 42501. Invalid fields/formats receive 22023.
- JSON permits only lesson completion, versioned mastery/wrong refs, due dates, unit/language skill values, bosses, learning/day and speech counters. No question/answer text fields, demo coins, EXP or rank fields. Values, sizes, counts, key formats and nested keys are validated server-side. This is personal progress, **not trusted competitive score**.

## Synchronization and lifecycle

`learning-cloud.js` owns only the two learning RPCs and reuses the current permanent session. It pins that request's user access token after checking account identity; a shared client switching accounts cannot relabel an in-flight A write with B's token. Server Auth remains authoritative. No service-role key is used in the browser.

`learning-sync.js` keeps a per-account durable outbox under `inha-world-learning-sync-v1:user:<id>` alongside the unchanged R1-A progress key. Guest has no outbox/network sync. A pending UUID/snapshot/base revision is persisted and read back locally **before** network submission. Retries after timeout/reload reuse it. Offline edits remain in localStorage. Retry is bounded exponential backoff, also triggered by online/manual retry. Account changes abort the request, clear timers/remote state and invalidate callbacks by generation; old requests may already have committed to their original owner, so the next A login resolves its same persisted receipt. No B state is applied from A.

Server acceptance is `acknowledged`, **not** `synced`. A separate read RPC must match the committed revision and canonical JSON exactly. Concurrent local edits during the request remain local and are submitted as the next revision. A newer remote revision with unchanged local baseline is restored; an active question defers restoration until learning finishes/manual retry. A server revision rollback/deleted row, malformed/future storage or malformed readback blocks synchronization instead of overwriting it.

**Conflict policy:** no speculative merge. When local and remote both differ from the confirmed baseline, pause. Stats shows both completion counts and remote revision, and offers explicit whole-record local/server selection. Re-read the remote revision at confirmation; if it advanced, require review again. Save both snapshots to account-scoped recovery storage before applying a choice. Archive failure blocks replacement. Ordinary JSON import preserves the original external backup, uses R1-A's explicit confirmation and then follows this same outbox/readback path. Choosing a whole snapshot can omit the other side's progress; recovery copies remain available.

Backup UI exports native JSON and recovery bundles. Recovery bundles contain `localCopies[]`, `cloudCopies.records[].local` and `cloudCopies.records[].cloud.progress`; select the desired progress object and import it using the normal reviewed JSON path. No automatic ambiguous legacy adaptive-slot mapping was added. Existing lower/future versions are not used to silently replace a confirmed newer server revision.

Web Locks serialize cloud work between supported tabs; raw-byte comparisons reject stale local/metadata writes. LocalStorage remains origin-readable, is finite and can be blocked/cleared by the user. There is no claim of RLS-like confidentiality between users sharing browser developer tools. Storage errors keep visible memory for manual backup and halt cloud replacement.

## Gates and remaining work

Both `LEARNING_RELEASE.enabled` and `LEARNING_CLOUD_RELEASE.enabled` ship **false**. No query parameter, localStorage switch, global override or environment auto-enable. Learning UI is hidden without approved content; cloud transport makes zero RPCs when OFF. Test-only harnesses inject synthetic capabilities, never the deployed main.

Before release: independent review, reviewed Production lineage mapping and migration plan, explicit migration/deploy authorization, content rights/approval and digest manifest, all required exact-head CI, real-device/microphone testing, operational retention/quotas/backup policy and production-auth rollout validation. The public-lineage migration must not be blindly pushed over Production history. Physical Android/iOS and real Production E2E remain UNKNOWN.

R2 must implement opt-in server-authoritative league/scoring, server-only approved answer validation, weekly KST boundaries, ties and privacy independently. Never derive rewards or ranking from this editable personal progress JSON. Existing Wallet, Daily Quiz answer/payout logic and ranking remain untouched.

## Reproduction and evidence

```sh
node --test apps/world/tests/phone-*.test.mjs apps/world/tests/daily-quiz.test.mjs apps/world/tests/daily-panel-focus.test.mjs apps/world/tests/daily-reward-readback.test.mjs apps/world/tests/pwa-shortcuts.test.mjs apps/world/tests/ui-icon-runtime.test.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/phone-learning-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/phone-learning-campus-smoke.mjs
# Disposable local stack only; no link/push or remote DB URL:
supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase test db supabase/tests/database/96_learning_progress.test.sql
node scripts/learning-cloud-local.mjs
node scripts/learning-cloud-local.mjs --browser
supabase stop --no-backup
```

Local targeted Node: 222/222 after rollback, archive-quota and missing-randomUUID startup regressions. Local isolated security advisors reported no issues. Real Phone/InputFocus browser regression: desktop and 360px PASS. Isolated PostgreSQL 17 SQL: 31/31 PASS. Real local GoTrue Auth + PostgREST: ownership/forged JWT/direct writes/parallel CAS/readback PASS. Real SDK browser: lesson save/reload, A/B/logout, offline legacy import and new-browser cloud restoration PASS at both sizes. Two live browser contexts also reproduced conflicting offline edits, explicit resolution and preservation of both recovery copies.

Full local Supabase image extraction exceeded workspace disk capacity. A separate minimal PostgreSQL 17 + GoTrue + PostgREST loopback stack was used for local DB/API/browser validation. Its absence of existing economy tables is an explicit SKIP for the economy-delta test, not PASS. The committed exact-head cloud CI job boots the full migration lineage and runs that test without the minimal-schema limitation. Final CI SHA/results are recorded in the Draft PR body. Browser JSON/screenshots contain synthetic content only; private bank checks remain local.

## STACK-REPAIR-01: repaired dependency

Base is now the independently testable R1-A parent `82ceb7989cb2f48b2f3301c3013531c0114f45c9`; #430 remains Draft against `codex/phone-learn-01-r1a`. Common contract/progress/engine and local failure/recovery tests now belong to #429. The residual child diff contains cloud transport/sync, cloud state UI and archive extensions, existing World client hookup, two ordered SQL migrations, RLS/API/cloud browser tests and cloud CI. No shared engine/contract/progress changes remain in the child diff.

Real rebase replayed the original cloud commits. Two common-only changes were skipped because the parent already includes their final implementation. Conflicts in controller/view/recovery/progress/tests were resolved against the reviewed final runtime contract; SQL was not conflicted or rewritten. Before documentation updates, every runtime/test/workflow/SQL file matched original child `3ece3cf298eca7ed2e03ed7dc3d7b4fcf0c6d068` byte for byte. Only inherited parent documentation differed. Subsequent edits update evidence/ownership documentation only. Target tests after rebase: 285/285 (101 learning). Exact final-head CI supplies fresh browser/full-lineage SQL/API proof; earlier CI is historical evidence only.

Server caps remain 256 KiB per request, 2,048 receipts / 16 MiB per owner, 12 new requests/minute / 240 per 24 hours. Exact UUID replay runs before limits; mismatched reuse fails. No TTL cleanup is added. Production schema/data, Wallet/EXP/Daily Quiz rewards and content approvals are untouched. Both release flags remain OFF. See [stack report](phone-learn-01-stack-repair-01.md) and [remediation policy](phone-learn-01-r1b-remediation-01.md) for explicit merge/release HOLD conditions.
