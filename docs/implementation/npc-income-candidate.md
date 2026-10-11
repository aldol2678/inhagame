# NPC side quests + short shift income: CLOSED local candidate

Base: main `82538ea`. This is an implementation candidate, not a release, a migration applied to Production, an activated game feature, or a validated economy balance. A local-only authenticated candidate HTTP entry point and explicit developer mount are included. Production Node/Vercel modes and all non-loopback database targets are hard-blocked. No main gameplay/NPC runtime handler is added.

## Small vertical slice

- Explicit QuestDefinition `quest.side.taerin_carp` binds only `INKYUNG-NPC-013` (가태린). One owned `material.fish_carp` is consumed for the candidate 20 coin reward. The server selects item, amount, giver and reward; dialogue output cannot choose them.
- `quest.side.convenience_help` binds a development-only, unassigned `npc.authored.convenience_employer`. This is not an existing NPC and does not claim a placed employer. Its three interactive steps are stock, checkout and tidy; the server chooses and verifies the challenge. Candidate pay is 30 coins only after all steps pass and one completion commits. The employer label is explicitly “NPC 배정 미확정 · 개발용 계약”.
- Generated NPC `can_start_quest=false` remains unchanged. No global quest capability is enabled. Closed definitions are accessible through explicit lookup or opt-in `includeCandidates`, never the default live journal list.
- The income accounting authority is shared; existing Reward owns grants and Wallet changes, Inventory owns item consumption. Fishing and gathering do not directly grant coins.

## Candidate limits, not economic conclusions

Each definition permits at most one paid completion per account per KST accounting day. At most one live session for the same account and quest exists across all dates. An expired unpaid session releases its reservation so the player can try again. The shared candidate cap is 60 coins, with only 20 + 30 = 50 coins currently earnable from these two definitions. The unused 10 is unallocated test headroom, not a hidden reward or an incentive to find another NPC. No client may spend that headroom by submitting an amount. Tests must exercise cap rejection with local fixtures rather than pretending the two current definitions can naturally exceed 60.

Starting a session freezes its reward, definition version and KST accounting date, and reserves capacity. Finishing after midnight charges the original period. The UI displays remaining capacity before start; server start rechecks it under the same account lock. No real-clock attendance appointment, timer-based AFK pay, full-inventory sale or daily all-NPC checklist is introduced. These limits and rewards need playtesting and telemetry before any balance signoff.

## Why this NPC, and diversity beyond this first slice

Identity was cross-checked against runtime loader `npc-factory/npc-population-loader.mjs`, its `data/fixtures/public-roster.json`, and traits/interests in `data/repaired/INKYUNG-20-A-R1.json`.

- 가태린 013: 생명과학과, playful/generous, film/walking/cooking. A small ingredient-sharing request uses the cooking interest and generous personality. This is a design interpretation, not canon that the NPC is a cook or that the closed cooking system works.
- 가나율 010: 화학과, cautious/calm, sketching/coding. A future careful observation/sketch comparison request is a better fit than forcing the same fish sale onto another NPC. No unsupported chemistry or gathering material is invented.
- 나수현 003: no department, curious/patient, music/coding; existing souvenir-shop role remains. A future patient catalogue-ordering or sound-pattern task is a distinct design direction; no quest or reward is enabled.
- 가지안 012: no department, generous/playful, coding/cooking; existing fashion-shop role remains. A future playful outfit-display request fits without reassignment to a convenience store. No quest or reward is enabled.

Only 013 delivery and the unassigned shift contract have executable candidate definitions. The other three are future design directions, not implemented quests.

## Acquisition and exposure evidence

`20261004132000_world_fishing_f2.sql` freezes a carp outcome and settles one `material.fish_carp` through Activity. `server/fishing-f2.md` explicitly calls it a development candidate. The newer `20261005021000_world_fishing_f3_trusted_presence.sql` requires trusted position evidence by default. `server/fishing-f3.md` says the authoritative producer is not connected; browser/Realtime pose or a service-role relay of it is insufficient. `api/world-fishing.js` additionally requires `WORLD_FISHING_API_ENABLED=1`. No live environment variable or Production database was inspected here; repository implementation is not proof of current player availability. The isolated PR199 experiment is not current F2 authority.

Therefore carp is the only already-catalogued, implemented acquisition output selected, but a new player's live ability to obtain it remains unverified. Delivery stays CLOSED. Gathering sources and Cooking B2 remain COMING_SOON/CLOSED; no wood, herb or cooked-food delivery is offered.

## Trust and failure boundaries

- Actor comes only from server authentication. Browser account, giver, price, clock, result, reward plan, inventory count and completion flags are rejected.
- Server challenge choices, step/revision ordering, elapsed-time bounds and expiry are checked. This blocks a forged completion flag and idle auto-pay; it is not an anti-bot system or proof of physical store attendance. Trusted employer/location binding is still an exposure prerequisite.
- Request identities prevent replay conflicts; session completion identity prevents payment through fresh request IDs. A single transaction performs consumption, Reward/Wallet, immutable completion receipt and cap accounting or none of them.
- Ambiguous mutation responses are recovered through status/receipt readback, never automatic repeat grants. Account switch/disconnect clears client ownership and ignores stale responses.
- Finished historical receipts must remain readable if runtime/catalog switches later close. Time crossing midnight must not redate a started session.

## Verification and release gates

Run `node --test apps/world/tests/*.test.mjs`, migration lint and contract lint, `node apps/world/qa.mjs`, and the repository `scripts/public-ci.sh`. SQL tests and schema/primitive authority guards require `scripts/public-db.sh` on a disposable local stack only. No Production credentials or connections are part of this candidate.

Before exposure: actual disposable DB replay and concurrent settlement testing; frozen policy and cap review; usable carp acquisition with approved trusted position evidence; explicit employer and shop location assignment; live interaction/journal wiring and a separately designed production transport (the present route is local-only); interruption/browser QA; separately approved migration/exposure/release. A green JavaScript suite alone does not prove transactional DB behavior or economic balance.

### Local verification record (2026-10-11)

- World Node suite: 4,206 passed, zero failed/skipped.
- Income/client/panel/HTTP/runtime/browser-contract focused tests: 54 passed. This includes actual developer mount → HTTP transport → auth handler → mock RPC for both panels under Node, not a live Auth/DB or Chromium run.
- Edge tests plus migration-lint test suites: 53 passed.
- `node apps/world/qa.mjs`, migration lint, migration-contract lint, whitespace checks passed.
- `scripts/public-ci.sh` did not finish: World stage passed, then pinned Recast tarball integrity retries occurred; tool approval review was cancelled. No bypass or retry was attempted after cancellation. Subsequent stages of that aggregate are not claimed as passed.
- No PostgreSQL/Supabase/Docker binary is available here. New pgTAP fixtures are authored, not executed. No genuine DB concurrency, schema replay, rollback or clock-boundary runtime proof is claimed.
- Real Chromium is unverified: the current harness lacks installed Playwright, and an earlier browser launch was blocked by the sandbox socket restriction. Fake-DOM accessibility/lifecycle tests are not a screenshot or real-browser pass.

### Hosted validation plan before considering activation

With separately authorized publication, `.github/workflows/public-ci.yml` must run `scope` in full/database-required mode, `source` (`scripts/public-ci.sh`), `database` (`scripts/public-db.sh`, Supabase 2.117.0), then aggregate `verify` for the exact candidate head. This covers migration replay, the new `114_world_income_candidate.test.sql`, existing schema/authority/grants guards, and existing integration discovery. Confirm the database job actually executes the new income integration fixture; browser proof additionally requires the dedicated workflow below.

The included `supabase/tests/integration/income-candidate.integration.test.mjs` adds eight real-connection scenarios for duplicate finishes, competing start reservations, Wallet→Inventory lock contention and expiry/receipt recovery. `scripts/local-integration.mjs` automatically discovers such tests and rejects non-loopback targets. The fixture is included but has not been executed locally here.

The included standalone income browser fixture/smoke and `income-candidate-browser.yml` use pinned browser dependencies, read-only permissions, exact-head verification and evidence uploads. Cover Tab/Escape/Back/reopen, touch-sized controls, account switch in-flight, lost acknowledgements, CLOSED historical receipt and expired/new-day posting. The workflow and harness are included; their real Chromium run is still unverified in this environment. Existing cooking or quest-journal workflows do not exercise this new panel.

These are local/synthetic validations. They must not use Production users, grant live money, apply migrations to Production, or enable a live gameplay entry point automatically.


## Local candidate wiring (never Production)

- `POST /api/world-income-candidate` is handled by `server/income-candidate-http.mjs` in the local dev server, with a matching API entry point that remains disabled in Production.
- Requires all four explicitly local configuration values: `WORLD_INCOME_CANDIDATE_ENABLED=1`, loopback-only `WORLD_INCOME_CANDIDATE_SUPABASE_URL`, local `WORLD_INCOME_CANDIDATE_ANON_KEY`, and local `WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY`. There is no fallback to global/Production Supabase credentials. Never paste credentials into the review page.
- The verifier calls the local Auth `/auth/v1/user` endpoint for each request; anonymous/invalid actors are rejected, and database account/ban guards still apply. Redirects are refused. The browser cannot supply the actor.
- `mountIncomeCandidate` connects both actual panels to `income-http-client` → authenticated HTTP handler → the authority RPCs. It requires an explicit enabled option and a localhost page. A local auth host supplies the current authorization callback and propagates account changes. The example page is `dev/income-candidate/index.html`; it remains inert without such a host.
- Delivery supports accept without consumption, current owned-carp display, deliberate one-carp submission, immutable receipt readback, insufficient-material blocking, expired sessions, and lost-response recovery. Convenience work uses the same auth/transport boundary.
- The browser harness uses only synthetic accounts and an in-memory RPC substitute. It reviews the real UI/client/service modules without activating the local SQL candidate or connecting to Production. SQL integration separately exercises the actual RPC authority on a disposable loopback stack.
