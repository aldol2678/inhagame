# Room social draft: remote verification contract

This draft contains friend-room chat and shared-club multiplayer only. Mobile boot recovery is
maintained separately. The base was verified at `af532a53c433479e12354f88a5a1c234075de5e7`.
Production activation, hosted database changes, merge and deployment are not authorized.
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

Chat starts CLOSED in `private.world_room_chat_config` and there is no client toggle. No hosted
DB/Realtime configuration is modified by these workflows. Existing Phone, ZIP-room visual and
room-photo code is preserved; existing regression workflows remain enabled.

UI transcripts clear on leaving/switching/reconnecting. This is not zero-retention: Supabase
Database Broadcast stores delivery payloads in `realtime.messages` and documents deletion after
3 days. See [Supabase documentation](https://supabase.com/docs/guides/realtime/broadcast#broadcast-from-the-database).
That retention requires separate disclosure/approval before activation; it is not an E2EE claim.
Real two-account Realtime and physical mobile acceptance remain a distinct activation gate.
