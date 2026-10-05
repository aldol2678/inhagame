# INKYUNG NPC Gemini action pilot

Status: a signed-in-only pilot on NPC 001/002 (Nana-yul, Ga-yudam). No shared NPC authority or
persistent AI memory. Deployment records, cloud project identifiers and operational readbacks are
kept outside this repository; this note describes the design and how to exercise it locally.

## Goal and boundary

`INKYUNG-NPC-001` and `INKYUNG-NPC-002` can propose a short Korean reply and one post-conversation action. The prompt supplies the selected interest, current time, place, activity, and approved dialogue hooks in Korean, and asks for a line that fits both the character and action. The World client executes only `stay`, `look_at_player`, `walk_nearby`, `sit_at_bench`, or `stand`. Its navigator and seat anchors still determine actual positions; `walk_nearby` is skipped if no safe route is available. No arbitrary coordinates, quests, rewards, groups, world-state writes, or relationship mutation are exposed to the model. The frozen A-R1 candidate is read without modification.

All 20 NPCs remain visible as ordinary NPCs to guests. Signed-in permanent accounts see `✦ AI` on NPC 001/002 and can request an AI reply by choosing an interest topic; the other 18 NPCs remain ordinary. Guests who open a conversation with either AI NPC see a login hint. AI session topic memory uses this tab's `sessionStorage`; it is not account-backed. Player free-text input is never sent to the model.

## Contextual dialogue

The model writes a short Korean reply about the selected interest using the NPC's persona and the server's current time, fixed location, activity, and approved dialogue hooks. The client offers one follow-up question on the same topic after a successful first reply; each reply is a separate call, so a conversation can use up to two calls.

The server overwrites the client's action list with `stay`. It checks the returned sentence for length, markup, links, contact details, the selected topic, a current time/place cue, and disallowed quest/reward/relationship claims. An invalid or unavailable response shows the existing local fallback; no retry is dispatched automatically. A five-minute cache separates prior-topic and follow-up requests, so a second turn cannot silently reuse the first reply.

`함께 할 거리` (social suggestion) is deterministic: NPC 001 suggests the existing `인경호 동쪽 벤치`, NPC 002 the existing `인경호 사진 지점`. It returns an approved line and `stay` without a model call or quota claim. No player location, nearby player count, friend request, invitation, chat, or group state is read or changed.

Nana-yul (001) stays at the main gate and Ga-yudam (002) at the Inkyung photo point throughout the four-period cycle. The first-walk quest (`QUEST_FIRST_WALK.md`) passes account progress between them through a separate deterministic endpoint; quest actions call no model.

## Run locally

The local pilot runs only with both a loopback browser URL and a local server flag. From the repository root, after signing in to your own Google Cloud project with Vertex AI enabled:

```sh
NPC_AI_PILOT=1 NPC_AI_PROJECT=<your-gcp-project> PORT=4173 node apps/world/dev-server.mjs
```

Open `http://127.0.0.1:4173/campus/?npcTest=a-r1&npcAiPilot=1` while signed in to a permanent account on the local stack. The local server uses the current `gcloud auth print-access-token` account, calls Vertex AI `gemini-2.5-flash` in `global`, and saves no key. The browser sends its Supabase access token only to the local endpoint, which verifies it with the Auth server and rejects guests and anonymous users before any model call. Up to 20 requests are dispatched per server process, with a five-second per-NPC cooldown and no automatic retry. There are no proximity or timer based calls. Stop the local server to stop all new calls.

The server validates NPC ID, time period, topic, off-zone status, and the action allowlist before dispatch, and validates model output after dispatch; the client checks the action again before moving or posing. The server sends fictional NPC profile, schedule and hook data plus the session's last interest topic. It does not send simulated student numbers, account identifiers, or player chat text.

## Hosted gateway design

- The browser checks `/api/npc-ai` (`apps/world/api/npc-ai.js`) once for the feature flag. It stays 404 unless both `NPC_AI_ENABLED=1` and an HTTPS `NPC_AI_CLOUD_RUN_URL` are configured, and it proxies the player's Supabase bearer token to a dedicated container service (`apps/world/Dockerfile`, `npc-factory/npc-ai-cloud-handler.mjs`).
- The service verifies a permanent account, ignores client-supplied movement actions, and calls Vertex AI with its attached service identity. It holds no long-lived cloud key.
- For an interest topic, the model chooses one of two server-approved replies; the server returns the chosen line with `stay`.
- Before each model call the service claims an atomic UTC-day quota through `claim_world_npc_ai_call_v1` with a server-only credential: 3 calls per verified user and 50 calls in total per UTC day. A claim counts an attempted dispatch, including failed responses, so failures cannot raise the cost ceiling. A per-process cap of 50 is an extra limit; the database claim is the durable cross-instance limit.
- Activation order: the quota migration and grants exist in the target database; the service runs under a dedicated identity with Vertex AI access and its database credential from a secret store; only then is the proxy URL and feature flag configured. Keep the flag off if any prerequisite is absent. Because the proxy forwards the player's token rather than a service identity token, the service handler itself performs authentication and quota enforcement even when called directly.
- Never place a service-role credential or cloud token in the browser, the repository, or ordinary hosting environment variables.

## Verification

- `node apps/world/npc-factory/tests-npc-ai-pilot.mjs` tests forbidden actions, invalid contexts, login verification, cache, call ceiling, and the Vertex request without a paid call.
- Existing World NPC runtime, navigation, and memory tests remain the regression suite.
- For real calls, record the response, latency and Vertex `usageMetadata`, and distinguish a token-price estimate from actual billing.
- Exercise both NPCs and all periods. Check that each accepted action stays at a safe local anchor, sitting uses an actual seat, and leaving the area/period cancels stale outcomes.
- Before a wider release, inspect at least 20 varied outputs for naturalness, repetition, unsupported campus facts, and harmful content.

## Next architecture decision

Each browser runs its own NPC simulation. For a shared multiplayer NPC, Social S3 must first specify which AI actions are permitted and Online Architecture must specify one authoritative NPC state owner, event ordering, period transitions, and broadcast/reconnect behavior. Do not turn the local endpoint into a public API or expose AI actions simply by setting a client flag.
