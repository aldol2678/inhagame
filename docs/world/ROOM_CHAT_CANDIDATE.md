# Room chat candidate (personal rooms and the common club room)

Status: draft PR #353, not deployed or activated. Current compatibility target: `3aaec7999c8d7a52bc73c0749c1af83586e8a558`.

## Player behavior

- Reuses the current Enter/chat button, IME-safe input, feed and avatar speech bubbles.
- Personal rooms use the owner's current room access/knock/friendship/visibility decision. The common club room requires its separate live club admission.
- Guests, strangers, banned accounts and currently interaction-restricted accounts cannot join. A room UUID is not an access grant.
- Messages reach admitted chat participants in the same room, without the campus 15 m presentation filter. This does not change campus chat.
- The in-memory feed is capped at 30 messages; bubbles last 4 seconds. Transition start, room change, exit, account change, page hide, expired lease or connection loss clears it. No history replay on reconnect.
- No DM, voice, calls, announcement feature, rewards, permanent application message history or browser persistence is added.

## Important retention boundary

This is **not zero-retention or end-to-end encrypted chat**. The application has no message-history table or history API, but server-published Supabase Database Broadcast messages are temporarily stored in the provider's `realtime.messages` transport table. Supabase documents deletion after 3 days:
https://supabase.com/docs/guides/realtime/broadcast#broadcast-from-the-database

The user approved this up-to-three-day transport retention and opening in principle. The new finite admission/H3 metadata cleanup and final operational plan still require coordinated review before application. No production database or scheduler has been changed. A hard requirement for zero stored payloads would require a different trusted relay.

## Trust boundary

`room-chat.js` does not call client `channel.send`. A signed-in caller invokes `send_world_room_chat_v1(lease, text)`; the server supplies user ID, profile nickname, room and sender session. Callers cannot pass a nickname, sender, recipient or topic.

Each send checks the sender's current lease/access and each recipient's current lease/access and both block directions. The common club room also checks its live `(room,user,session,server admission)` admission. This protects against stale Realtime subscription authorization: a revoked inbox may remain connected temporarily, but is omitted from new server fanout.

The recipient inbox is `world:room-chat:<server-generated random UUID>`. Restrictive read policies bind both the row's `topic` and Realtime authorization topic to the caller's live inbox; restrictive write policies prohibit clients from publishing in this namespace even if an unrelated permissive policy is broad. The provider owns its `realtime.send` EXECUTE grants. Its current SECURITY INVOKER implementation can return normally after warning that INSERT was rejected; tests require zero forged rows, rather than assuming EXECUTE is denied. The private safety gate requires invoker semantics, enabled table RLS, and non-bypass anonymous/authenticated roles. Unsafe provider semantics close admission, renewal, publication and new reads.

Personal-room pose/Presence remains the existing client-asserted implementation. It is not a certified identity or proof of physical avatar location. Chat identity does not trust that Presence: speech bubbles bind `(authenticated user ID, session ID)` and display the server-certified nickname and text from the same message. A malicious duplicate pose session ID cannot overwrite another user's speech bubble.

Server limits are 120 Unicode code points and 3 messages per 5 seconds per account, including across room rejoin. Server-side canonical Unicode/control-character/whitespace validation matches the client. Names and text render through `textContent`; markup is inert.

## Lifecycle and API

`createRoomChat({getClient,getIdentity,isBlocked,onChange})` exposes:

- `enter({kind: 'personal'|'club', roomId, sessionId, admissionId}) (admissionId is null for personal, required for club)`, `stop()`, `update()`, `revalidateNow()`
- Async `submit(text)`, `feed`, `status()`, `canChat`, `signedIn`
- `personalVisitLease(roomId)` returns an own live personal `{leaseId,sessionId}` or null for friend plant CARE; this is server admission, not physical location proof
- `ownBubble()`, `bubbleFor(sessionId,userId)`, `removeSender(userId)`

Leases last 30 seconds and renew every 10 seconds. A valid lease remains usable while a routine renewal is pending; initial or reconnected channels stay closed until access is checked. There is no offline send queue or optimistic local message. Join requests are serialized across room switches; a stale successful join revokes its own lease before a newer join runs. Leave is best effort after logout/network loss; server lease expiry bounds stale admission when cleanup cannot authenticate or reach the server.

`createChatPanel` preserves synchronous campus submissions and supports async room submissions. `reset()` cancels stale acknowledgements, clears drafts/feed and releases input focus. A late response cannot erase text for a new room or account.

Both `PersonalRoomSession` and `ClubRoomSession` expose `setChatBubbles(getter)` and a session ID. The main loop owns chat context switching; neither can silently route room text into a campus channel.

## Activation gates

1. Review the existing H3 prerequisite and three append-only candidate migrations in the [activation runbook](ROOM_SOCIAL_ACTIVATION_RUNBOOK.md). Do not push unrelated unapplied migrations.
2. Run the complete disposable Supabase migration replay, pgTAP tests and generated type coverage. The local fixture below is additional evidence, not a replacement.
3. Verify the actual deployment's Realtime policies, provider function grants and private inbox send/receive with two permanent test accounts. Include raw client publish attempts, owner/visitor, block/unfriend/privacy/restriction changes, club leave/replacement/expiry, reconnect and delayed responses.
4. Perform desktop and mobile browser acceptance, including IME/Enter/Escape, focus release, page restore and existing room photo/Phone behavior.
5. Publication and remote CI validation are approved. The user also approved opening, transport retention, H3 visitor changes and automatic finite cleanup in principle; actual production writes remain paused for the final coordinated plan and exact-head review. Chat defaults CLOSED until the trusted `private.world_room_chat_config.enabled` is deliberately enabled. There is no client feature toggle.

The common club room has a separate admission contract and six server-owned seats; see [the club server contract](CLUB_ROOM_MULTIPLAYER_SERVER.md). No production, release, remote branch, PR or CI action is implied by these files.

## Local verification

- `node --test apps/world/tests/*.test.mjs`
- `node apps/world/qa.mjs`
- `node .github/ci/migration-lint.mjs`
- `node .github/ci/migration-contract-lint.mjs`
- `bash scripts/public-db.sh` requires the disposable local Supabase stack. It was unavailable in the current environment; new-revision full replay/pgTAP require remote CI. The earlier 8bde3d4 baseline passed them.

The additional `supabase/tests/room-chat-sql-candidate.mjs` executes the **actual** personal-room helper, club migration and chat migration in an in-memory PostgreSQL engine. Auth, provider transport and pre-existing table fixtures are synthetic. It cannot connect to production and accepts no database URL. Install its development-only dependency outside the repository, then run:

```sh
runner=$(mktemp -d)
npm --cache "$runner/cache" install --prefix "$runner" --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
PGLITE_MODULE="$runner/node_modules/@electric-sql/pglite/dist/index.js" node supabase/tests/room-chat-sql-candidate.mjs
```

The fixture checks CLOSED default, caller-derived sender, owner/visitor/stranger/guest, interaction restriction start/end, blocks, visibility loss, Unicode validation, rate across rejoin, row/topic RLS under broad unrelated policies, client publish denial, club admission/leave/replacement/expiry, coexistence of club/chat inbox policies, and production JS action/Presence/pose encoder-validator roundtrips through the actual club SQL.

Actual two-browser attempts in this environment were blocked before page creation by Chromium's `process_singleton_posix.cc: socket() failed: Operation not permitted`, including the permitted elevated retry. GitHub-hosted Chromium subsequently passed on the earlier baseline using synthetic delivery. The revised head requires new remote evidence. Physical mobile Safari and hosted production delivery remain unverified.

## Draft PR verification

See [Room social remote QA](ROOM_SOCIAL_REMOTE_QA.md) for exact-head CI, two isolated browser contexts, and disposable PostgreSQL race/replay scope. Mobile boot recovery is a separate PR and is not included in this candidate.

## Cached-channel capability defense

Authenticated admission/renewal responses include a server-random per-recipient inbox capability.
It is absent from roster/presence, send acknowledgements to other users, public status, screenshots
and diagnostics. Only server fanout to that recipient includes it. The client requires it before
processing a provider callback. Renewal rotates it; in-flight previous capabilities are accepted
only until their original request-start-bounded lease expires (chat at most 30 seconds, club 20).
The store is bounded to eight capabilities and is cleared on lost connection, room/account change
or denial. Reconnect authenticates again and obtains a fresh capability. This does not promise
cryptographic signatures, E2EE, protection from the recipient modifying its own UI, or protection
from a compromised privileged backend/service key.

A synthetic-provider SECURITY DEFINER mutation test deliberately demonstrates that direct
provider INSERT may then bypass RLS. The application authority closes; the actual resulting
forged envelope lacks the target capability and is rejected by production client authority.
Real Supabase's protected function is never altered by the test. Browser tests separately inject
missing/cross-recipient capabilities into already-subscribed channels and require zero feed entries.
No live WebSocket zero-delivery result is inferred from a database zero-row assertion.

## Fresh admission and H3/CARE coupling

Club chat joins carry the server admission UUID, and all later checks require that exact live admission; deletion of the club admission cascades its chat lease. A reused client pose UUID cannot revive an old chat inbox. No permanent account-linked session tombstones remain. See the club contract for finite rate/lease retention and cleanup outage behavior.

Personal admission requires the reviewed H3 access/presence helpers, tables and pinned security attributes. A legacy D2 helper or unexpected body drift closes personal chat. H3 checks use current wall-clock time after waits, not transaction-start time.

Room entry automatically starts the lease without opening the composer or sending a message. Friend plant CARE can use the narrow own lease getter, but its server must independently check user, room, client session, lease, current H3 and gate/cleanup state after locking. Leaving, expiry, account change or disabled/unhealthy chat closes visitor CARE; owner CARE remains independent. This is not authoritative physical-position tracking.
