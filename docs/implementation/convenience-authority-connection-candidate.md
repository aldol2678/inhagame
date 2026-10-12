# Convenience-only authority connection candidate

Design discussion: https://github.com/aldol2678/inhagame/issues/366

Base: main `d729746ce9ab5733a5e082db7313d156b15c7a48`. Reuses the CLOSED income/game-entry implementation from Draft #348 and the prior local canonical collision kernel. #348 remains unchanged. The unpublished income migration is rebased to `20261012090000` so all migrations append after the current main lineage; the new connection is the next forward migration.

## Scope and activation

Operating suitability: **HOLD**. This candidate establishes a connection to test; it is not a recommendation to activate this polling architecture.

Only fictional BACKGATE-NPC-001 도유진 at back_street_4 is connected by the new path. NPC013 delivery/Fishing F3 are not connected. Their existing CLOSED discovery and regression fixtures are retained, not enabled in gameplay. Wage 30, daily once, shared cap 60 remain candidate test values, not approved economy tuning.

This is a local development connection, not a Production integration. Both the HTTP configuration and service refuse Production. It is absent from hosted API exports. The local dev server requires all existing loopback income settings plus `WORLD_CONVENIENCE_AUTHORITY_CANDIDATE=1`. DB runtime and reward/definition gates remain CLOSED in committed migrations. No real credentials, new service, paid infrastructure, permission change in an existing environment, live balance write, merge, or deployment is included.

The normal game mounts the local candidate only when an explicit disposable local auth host sets `convenienceAuthority: true`. That host uses the matching game account and current bearer from its existing local login; never paste a bearer into the game. Hosted main still offers only the informational employer and unpaid practice.

## Narrow gameplay session

The player explicitly presses “검증 이동 시작 (서버 출발점으로 이동)”. The server chooses MAIN_GATE, or BACK_GATE only when the stored navigation quest is at stage 9. This is an explicit teleport to an authorized starting point, not acceptance of the browser's current position. The actual PlayerController then stops independent local movement and uses server snapshots. No shadow player is separately used to award wages. Zero client prediction is intentional; smoothing is not asserted complete.

Keyboard/touch generate only `{sequence, moveX, moveZ}`. Sequence/session/revision/fence are persistent in DB. Browser coordinates, elapsed time, reward values, actor IDs and completion claims are rejected. The reused geometry owns collision, height, speed and the local coordinate frame. The new fixed target does not compile moving NPC schedules/meetings.

The candidate polls every 200 ms only while this explicit session is active. It uses its own transport lock and UI input lease. Another blocking interface, conversation, realm/room transition, mounting/seating, account replacement, visibility loss or pagehide stops it. Late open/move/panel responses cannot apply transforms or resurrect input ownership. Receipt reads do not start an authority session.

## Stateless workers and durable state

Each move verifies the exact bearer against local Auth, then uses claims only from that verified token to identify the account and auth session. SQL also checks the current auth.sessions row and account eligibility. No persistent app credentials are issued.

A worker reads the DB-authoritative timestamp and previous state, reduces only the prior accepted intent's elapsed interval, then attempts revision/session/fence CAS. Intent gaps over 250 ms discard the old interval; new input never moves retroactively. Exact duplicate acknowledgements do not advance observedAt or extend the lease. Cold workers hydrate the same row. Concurrent CAS losers surface a conflict; an old computation is never blindly replayed.

The COMMIT age is under 250 ms and its complete typed JSON contract is checked by SQL. The observation timestamp is preserved, not replaced with commit time. The lease is 3 seconds and each authority session has a fixed 10-minute maximum. Failure to receive a browser-close notification is therefore bounded, not instantaneously detected. Confirmed revocation is serialized at the row; unknown network disconnect is a timeout guarantee.

## Atomic settlement

The original income engine retains challenge generation, minimum step time, ordered revisions, KST start-date reservation, limits, request payload idempotency, Reward/Wallet settlement and immutable receipts. A versioned forward mapping changes only the convenience employer. Legacy v1 APIs cannot mutate unpaid shifts even if their old switch is accidentally enabled.

The v2 wrapper takes the income account lock, records whether the receipt was already settled, runs the original core, and then locks/rechecks the current authority row, Auth session and current convenience runtime after the core's potentially blocking economic locks. Missing/stale/future/malformed observations, an old fence/binding, revoke/logout, target/version changes, closed runtime, wrong distance or failed server sightline roll back the entire transaction, including provisional reward/wallet work and the request receipt. Presence is not locked before a Wallet wait, so a revocation can commit while that wait occurs.

A final Auth row share lock gives a defined ordering: a logout committed first blocks settlement; a logout arriving after the final authorization lock waits for that already-authorized transaction. This is not a promise to observe a browser closing before the server receives it.

Only a ledger-proven pre-existing SETTLED receipt bypasses new presence. Terminal FINISH uses exactly the same payload fields as initial FINISH, so identical request IDs replay. STATUS/terminal recovery works without a movement session, while still requiring a valid authenticated account. An interrupted unpaid job is not silently transferred to a new authority session; its reservation remains until income expiry. Faster explicit abandonment/restart UX remains a candidate follow-up, not an automatic reward bypass.

## Verification and cost limits

- Pure reducer: 21 focused tests including a canonical back-gate-to-store walk.
- New service/client/runtime/reducer focused tests: 123 passed locally. They include actual PlayerController and the actual main mount block, but fake HTTP/DOM cases do not prove browser pixels or PostgreSQL.
- Final local World aggregate: 4,525/4,525 passed. The stale unassigned-employer assertion was updated for the explicit 도유진 mapping. The later documented-refusal classification change also passed its 39 focused job-client/service regressions.
- World QA, 53 edge/migration guard tests, migration ordering and contract lint passed locally.
- `115_world_convenience_authority.test.sql` and `convenience-authority.integration.test.mjs` are new disposable tests. The latter uses real HTTP, local Auth, the actual reducer and PostgREST/PostgreSQL, including independent workers, real-clock canonical walking, work ordering, duplicate settlement, lock waits, logout/runtime/target races and rollback. It has **not run locally** because this executor lacks PostgreSQL/Docker/Supabase. Exact-head hosted results are required.
- Existing income database regressions use explicit synthetic server observations for their SHIFT cases; they are economy regression evidence, not movement proof.
- Browser module rendering could not launch locally: Chromium was denied an OS socket before loading any page, including one approved escalation retry. No local renderer/touch PASS is claimed. The existing browser CI includes this module fixture; exact-head hosted results are recorded in Draft #368.
- Browser module rendering is separate from whole-main startup. Neither a module render fixture nor the Node main-mount test is claimed as a full authenticated whole-campus boot.
- A separate desktop full-campus test reuses the existing starter-furniture workflow's disposable DB and Chromium. It performs actual SDK password login, unchanged `/campus/` boot, trusted toolbar/W/work interactions, real server walk/settlement, linked Reward/Wallet readback, wallet refresh and cancel/reopen receipt recovery. It passes through real local Auth/authority/DB responses. Launch gates and pre-existing intro progression are the only SQL setup; positions, work answers, timestamps and balances are not injected. Only the hash-verified public avatar substitute may be pictured. This added test is not claimed PASS until its exact-head hosted result is verified.

The first full-campus hosted attempt (`8f9f2bea`) reached real login, READY main and the server-owned spawn, but an in-session screenshot stalled the GPU-less renderer: one movement response was observed after about 6.9 seconds and the next request correctly failed `CONVENIENCE_SESSION_EXPIRED`. No payment was reached. The test now selects the supported LOW graphics preset through settings, records only semantic state during active authority, and takes one bounded screenshot of the historical receipt only after confirmed revocation. This does not increase lease/freshness, add fake keepalives or establish Production latency suitability. Exact-head retry results remain required.

Local pure-code measurement (1,000 stationary reductions; this executor): geometry factory 17.4 ms after module import, mean reducer 0.625 ms, p95 0.967 ms. It excludes module cold import, Auth, HTTP, DB and game rendering. It does not establish deployed latency or cost.

There is no separate server-locked WORKING phase yet: opening the work panel sends zero movement but **continues 5 Hz polling during the work itself**. The minimal follow-up would atomically enter a server-owned work lock, stop movement polling, and validate the auth/session/work lock on each work command, with explicit release/revocation semantics. That redesign is not silently included here.

At 5 Hz this design means 18,000 browser requests and up to 36,000 DB RPCs per active player-hour, plus Auth verification and work commands. Even with the 10-minute session bound, it is not approved as an economical operating architecture. Measure end-to-end p50/p95, late-computation rejection, stationary/active call counts, retry pressure and visible reconciliation in a disposable environment before considering activation. If that budget is unsuitable, stop for an architecture decision; do not quietly add an always-on paid server, change credentials or trust client poses.
