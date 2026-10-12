# Room social draft: remote verification contract

This draft contains friend-room chat and shared-club multiplayer only. Mobile boot recovery is
maintained separately. Final compatibility verification is frozen against
`3aaec7999c8d7a52bc73c0749c1af83586e8a558` (starter furniture, Phone menu and retired venue preserved).
The 8bde3d4 baseline passed 26 workflows against 7967c6e; it does not certify this revised head.
Hosted database writes, merge and deployment await the final parent-coordinated execution plan.
`vercel.json` remains main-only; this PR must not create a Vercel Preview deployment.

## Separate evidence layers

1. Existing required `verify` runs all source/unit/static checks and the disposable local Supabase
   database job when migrations/tests change. The database job applies the complete migration
   lineage, executes pgTAP, runs local integration tests and checks generated type coverage.
   It uses GitHub-hosted local services, not a linked hosted project.
2. `Room social candidate browser and SQL QA / sql-contract` installs a locked development-only
   PGlite runner and executes the actual candidate SQL plus production JS protocol roundtrips.
   Auth/provider/pre-existing schema are synthetic; this is not full replay or live Supabase.
3. `... / browser` checks out the exact PR head, then runs real Chromium, PlayCanvas scenes,
   player/remote-avatar rendering, room sessions, network core, input and chat modules in two
   isolated browser contexts for each of desktop 1280x720, portrait 390x844 and landscape 844x390.
   Auth and network delivery in this harness are explicitly synthetic contract doubles. It tests
   mutual avatars; real composer IME/Enter/Escape/focus; inert markup; remote speech bubbles;
   seat contention; emote delivery; reconnect/no history; room switching; account change and exit.
   It does not establish live Supabase websocket delivery or physical iOS/Android keyboard behavior.

The browser report records the exact commit SHA and every scenario's checks/snapshots, with
screenshots for both participants. Failure screenshots/report are uploaded too. Review the
actual pixels and report, not merely the green workflow indicator. Artifacts expire after 7 days.
A new head invalidates earlier green evidence until the affected tests rerun on that head.

### Four-second bubbles and screenshot API latency

Capture receipts bind the synthetic server message ID, production feed ID/text/time, rendered
bubble text, bounds and QA-panel non-overlap. Both participants must capture the same message.
Immediately before capture the bubble must be visible. After capture the message/feed identity
must be unchanged; the bubble must either still be visible or have expired only after its normal
four-second deadline. The saved PNG must separately show the full expected text without overlap;
the automated receipt alone is not final visual acceptance.

An earlier, overly strict postcondition required the bubble to survive until screenshot bytes
returned. At head `033e85c`, Chromium's API returned after 5.2–5.6 seconds: the PNG contained the
correct bubble, while the later UI observation correctly showed expiration. That is screenshot
latency, not broken lifetime. This correction does not accept missing/wrong pixels, changed
message identity, early disappearance, or longer production lifetime. Both original failures
remain preserved. Direct Chromium capture with fast PNG encoding and a shared browser/GPU process
reduce harness overhead; the two BrowserContexts still have isolated accounts, cookies and storage.
No production clock, UI, animation or four-second timer is frozen or changed.

## Commands

```sh
node --test apps/world/tests/room-chat.test.mjs apps/world/tests/club-room-session.test.mjs
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
bash scripts/public-db.sh # disposable local Supabase ONLY
(cd supabase/tests/room-social-runner && npm ci --ignore-scripts --no-audit --no-fund)
PGLITE_MODULE=./room-social-runner/node_modules/@electric-sql/pglite/dist/index.js \
  node supabase/tests/room-chat-sql-candidate.mjs
(cd apps/world/tests/browser && npm ci --ignore-scripts --no-audit --no-fund)
WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome \
  node apps/world/tests/browser/room-social-multiplayer-smoke.mjs
```

## Operating boundary

Chat starts CLOSED in `private.world_room_chat_config`; club admission independently starts CLOSED in `private.world_club_rooms.enabled`. There is no client toggle. No hosted
DB/Realtime configuration is modified by these workflows. Existing Phone, ZIP-room visual and
room-photo code is preserved; existing regression workflows remain enabled.

UI transcripts clear on leaving/switching/reconnecting. This is not zero-retention: Supabase
Database Broadcast stores delivery payloads in `realtime.messages` and documents deletion after
3 days. See [Supabase documentation](https://supabase.com/docs/guides/realtime/broadcast#broadcast-from-the-database).
That retention requires separate disclosure/approval before activation; it is not an E2EE claim.
Disposable real two-account Realtime is covered by the new raw-WebSocket integration test and must pass on this head. Hosted production smoke remains an activation step. Physical mobile checks are a disclosed post-merge check, not the sole reason to hold the candidate.

## First remote head: findings preserved, not acceptance evidence

At head `c936b14af9d00c5b2939b0d4a5b12018199d7599`, required source checks and the
PGlite contract job passed, but [real database checks](https://github.com/aldol2678/inhagame/actions/runs/38196081988)
failed five pgTAP assertions. One exact RPC allowlist had not been extended; four assertions
incorrectly assumed the provider's EXECUTE privilege remained revoked. The actual provider
returned normally with `WarnSendingBroadcastMessage` because restrictive INSERT RLS rejected
the attempted row. This is corrected by testing row effects directly, not by changing provider
grants or weakening the no-forgery requirement. Anonymous/authenticated clients remain RLS-bound;
`service_role` is a trusted BYPASSRLS backend and must never be shipped to browsers.

The [first browser run](https://github.com/aldol2678/inhagame/actions/runs/38196082135) passed
desktop personal/club and portrait personal, then exposed a stationary club avatar's first pose
being dropped before channel subscription. Latest-only pending pose buffering fixes that production
race; a delayed-subscription regression failed before the fix and passes after it. Landscape was
not reached in that first run. Screenshots use the repository's intentional Public_QA_Avatar
placeholder, not the private production mascot asset.

Subsequent head checks must pass before treating either correction as remotely verified. PGlite
fault injection changes only its synthetic provider, and browser authority attacks use synthetic
transport. Live two-account provider delivery remains a separate, explicitly unverified layer.

## Fresh-admission revision

The revised database integration adds loopback-only actual Supabase WebSocket delivery checks: establish baseline raw club/chat receipt, retire admissions, reuse client pose UUID, and require zero raw new payloads to old sockets while the new sockets receive. It never logs JWTs, keys, nonce values or message payloads. Row-effect and actual socket evidence are separate assertions.

Finite rate/lease/H3 cleanup, cleanup-health fail-closed behavior, current-time checks after locks, and visitor CARE admission checks are new to this revision and invalidate prior baseline evidence for those behaviors. The runbook distinguishes healthy-scheduler bounds from outage retention.

Local checkpoint after the privacy/main3aa integration: public-ci aggregate PASS (World 4300, all other app tests/builds, Recast, edge and migration checks), focused room client 60/60, QA PASS. The first local aggregate stopped at an unwritable default npm cache; the same checks with an owned temporary cache passed. Full PostgreSQL and WebSocket stages still require the final remote head.
