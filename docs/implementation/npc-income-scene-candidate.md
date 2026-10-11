# Income scene followup (CLOSED review candidate)

Base: Draft #348 head `7d857c84697e9a3c314a65e41789f8b9bf5ee5e7`.
The user authorized posting this followup to Draft #348 and running hosted browser checks on 2026-10-11. It incorporates main `e299136b43a4be65f1feb1dc2a911241ad578a8a` (#347), preserves the prior candidate ancestry and excludes room PR #349. Production remains inactive. Cancelled historical fetch/body-update actions are not retried.

## Content evidence and location decision

The Job/Department Side Quest design (Notion `3f227155213b815684eecba907fece77`, edited 2026-10-07) defines convenience tasks and department stories, but no employer NPC or building ID. Economy `3e727155213b8152b7f5d363a0f26c85` and Life `3eb27155213b8156a3fafe908de124c5` do not supply that missing assignment.
The user's 2026-10-11 followup selected a building close to the back gate as a game-world convenience store.

- Gate: (143.044075, 101.650142), from `back-gate-layout.js`.
- Selected existing building: `back_street_4`, already labelled 편의점 by `MARKET_EXISTING_SHOPS`.
- Candidate approach: (153.189674, 111.377165), straight distance 14.0552 WU.
- `back_street_3` is closer at 12.3705 WU but labelled 분식. Reusing the nearest existing convenience facade avoids replacing another shop's role.
- These facades are explicitly illustrative game exteriors, not real tenancy records. No real brand/operator is claimed.
- Direct gate-to-door walking intersects a rail and a tree. The exported approach bends around them; sampled against all `campus-layout.OBSTACLES` at radius .35 WU, larger than WALK_SHAPE .24. Approximate walk distance is 20.42 WU. The last approach-to-facade eye ray is clear. This is geometry evidence, not a rendered screenshot or live navigation proof.
- User subsequently requested a new fictional employer: BACKGATE-NPC-001 도유진, calm/meticulous, cooking/stock organization interests. Existing procedural avatar provides a green uniform and badge. IDs/names were checked against base and expansion populations. NPC003 souvenir/NPC012 fashion remain untouched. This authored game candidate is not a real person or tenant.
- The SQL shift giver remains the closed #348 placeholder. No new NPC identity is silently granted server reward authority; an explicit versioned definition mapping is required before future activation.

## Implemented bridge

`dev-runtime.getIncomeCandidateGiverView()` returns only the visible rendered CAMPUS-LOCAL position of NPC013. The earlier world/local mismatch is fixed using incomeLocalEntityPosition/getLocalPosition and covered by a reflected/translated/scaled parent fixture. It neither changes generated can_start_quest nor claims a trusted player-position producer.
`createIncomeSceneCandidate` is retained as a standalone adapter/fixture surface; the actual main path uses income-game-entry and NPC013's existing dialogue rather than taking over its F slot. The adapter composes the actual delivery panel/client/HTTP transport with a scene action. The host supplies live scene/account/NPC views, a local auth callback, the existing F/touch context action controller and an input-focus lease.

- Radius 2.5 WU, vertical tolerance 1.5; hides outside campus, during main quest, conversation, mounted/seated/blocked states.
- Priority 305: below Main2 310, above ordinary conversation 300 for this explicitly enabled local candidate only. Main1 priority must be represented by host `mainQuestPending`; the bridge does not guess Quest internals.
- Trigger re-reads actor/account/scene/proximity, so retained callbacks cannot open after leaving.
- Account/logout/scene departure/range loss closes. Close/back releases its input lease and restores panel opener; no position/camera teleport occurs.
- All scene requests are status-only. Snapshot.enabled is forced false even if a local backend reports ACTIVE; the wrapper rejects mutations. Existing receipts remain viewable. No live payment is possible through this bridge.
- The standalone adapter exports convenience location mapping; the normal game entry below now registers the separately authored employer. No paid start action is registered.

## Actual game mounting (normal discovery; payment CLOSED)

`main.js` now imports the informational game entry in the normal game path, without a query flag. Hosted builds only show authored discovery/dialogue and unpaid practice; they cannot instantiate the local HTTP records adapter. No environment flag or SQL gate is opened. This insertion was coordinated with the room-light owner and avoids their room controller/lighting sections.

- back_street_4 has the independent authored procedural character. The existing F/touch slot opens the employer conversation, first greeting and work briefing.
- A deliberately labelled unpaid practice teaches stock→checkout→tidy. Wrong selections get a patient retry line; correct work gets a calm acknowledgement. Practice never calls start/action/finish, inventory or wallet and never produces a receipt.
- NPC013's existing conversation HOME offers the authored delivery candidate only when no main quest/event has priority. Normal dialogue remains its F/touch entry; no generated global Quest permission is enabled.
- Without a local test auth host, it opens truthful CLOSED information, with no claimed holdings or receipt. With explicit INCOME_CANDIDATE_LOCAL_AUTH, the actual delivery status panel can show local server holdings/previous receipts but its request wrapper still rejects every mutation.
- Existing input owner claims are respected, without unconditional unlock. Close/Back, departure, realm/room transition, mounted/seated state and local account changes close the candidate and release its own lease. No teleport or game camera reset is performed.
- main passes campus-local player position. NPC render position now uses that same frame. NPC013 schedule and all existing shop positions remain unchanged.

## Remaining server/operational gates

No trusted player movement producer is connected in the repository. Fishing F3 only consumes trusted observations; browser poses/Realtime/heartbeat are not that evidence. Shared NPC authority P0 covers only 003/012, so moving NPC013 also needs a server-resolved schedule/position before on-site delivery is enforceable.
A future versioned presence consumer must check account/session/monotonic revision/freshness, same space/mode and target distance at delivery acceptance/submission and shift start/action/first settlement, rechecking after lock waits. Historical receipt recovery must remain position-independent. Do not relay client coordinates through service-role credentials as a substitute.

The scene remains unable to pay even if a local backend is misconfigured ACTIVE. Full server movement authority, approved employer definition mapping, usable fishing acquisition and separately approved production migration/exposure/release remain necessary. The amounts 20/30/common60 are test candidates, not validated balance.

Local verification on latest main: World 4,247 tests and World QA passed. Hosted browser evidence for this followup is requested separately; only a completed exact-head run establishes browser results. Node DOM/entity and geometry fixtures alone do not establish pixels or authoritative positions.

## Minimum paid-connection implementation specification (not implemented here)

1. **Player presence producer:** an authoritative world session must own spawn/realm/locomotion and validate sequenced movement intents against speed, elapsed server time and canonical collision geometry. Issue one account-bound session/revision stream; disconnection and invalid modes revoke eligibility. Existing browser PlayerController/Realtime is a presentation/transport system, not this producer. No new credential alone solves the gap.
2. **Target authority:** fixed back_street_4 geometry can be a versioned server definition. NPC013 needs a server schedule/route resolver and visible/eligible state; currently shared P0 only includes 003/012. Client render coordinates cannot be that resolver.
3. **Income presence consumer:** add an append-only migration/authority contract for target+player evidence and a versioned employer definition. Check freshness (<5s candidate), session, revision, space, grounded/on-foot mode, horizontal radius and vertical/sightline eligibility. Bind target/evidence identity at start; revalidate actionable commands and first settlement after lock waits. Never require presence for paid receipt replay. Keep existing wallet/inventory atomic settlement and caps.
4. **Disposable verification:** server-fixture issue observations, then real local HTTP→RPC→PostgreSQL tests for missing/stale/future/conflicting evidence, wrong actor/session/target, moving/invisible013, leaving the store, disconnect, lock waiting, exactly-once receipt and unchanged zero writes on refusal. Coordinate presence/income/Activity lock order explicitly rather than reusing Fishing's private table as an unrelated writer.
5. **Operational activation:** only after those code gates and usable carp acquisition pass, separately approve forward Production migration, employer/quest policy mapping, API exposure and release. Existing service deployment or secret changes are not part of this patch.

The safe work completed here is normal gameplay UI connection in local code. Paid operational connection remains incomplete. Employer practice is explicitly unpaid and must not be used as evidence that any server-issued shift was completed.
