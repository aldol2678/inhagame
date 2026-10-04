# Biryong map and public NPC place guidance P0

## Scope and authority

The local candidate was reviewed on public main
`413d984fcb59216e7f07bafed1fffc618351a109` (#177), preserving the current Campus
map controls (#169), NPC movement/dialogue (#176), and initial render gate.
For the approved Draft/hosted-QA publication it was rebased onto public main
`7adc0c1ec6158504aeba39c70e45a7642fc97548`, preserving #179 shopfronts, #183
account-result/touch ownership, and #71 Main3/collection/receipt foundations.
After Draft publication, Fishing #182 advanced main to
`4a6bb098ae68d300bcbf9ec403b30b4ae197c863`. It is merged into this feature branch
with both Fishing-panel and Biryong-dialogue minimap suppression retained in the
one overlapping main.js hunk. Signed-in lobby highlight wiring, Fishing UI and
result-retention logic, and all upstream migrations/authority owners are retained.
This PR does not activate Fishing in an operational database.
After the hosted landscape run reproduced the existing shared fade race, main
`0fe95f09fe3e5f1a0f02851a95338e095483bf4f` (#184) was merged normally into this
branch. Its shared `createSpaceFade` and room-recovery changes are preserved;
this PR does not duplicate that implementation. The NPC browser fixture observes
moving actors through the existing conversation contract, waiting for genuinely
safe player proximity without changing actor schedules, speed or clock.

The approved outcome is a usable map and place guidance in the existing
BIRYONG_REALM, plus links from existing public NPC dialogue. It does not create
quests, rewards, relationship stages, regional online presence, new regions,
access gates, levels, spawn unlocks, or persistent visits/resume.

Direction sources:
- [Active Core Loop decision](https://app.notion.com/p/3e927155213b81f3b8eaef652e6de4e5)
- [Biryong Lore CURRENT DESIGN](https://app.notion.com/p/3ef27155213b81ee86bdfdfaf87133a6)
- [Combat v0.3 CURRENT DESIGN](https://app.notion.com/p/3ef27155213b8144ac9bd904a83a622f)

Campus Level and Combat Progression remain connected, separate axes. The
same existing character, inventory and progression are retained. BR01 continues
to mean the Campus Biryong Tower event, not station discovery.

## Implementation

- `biryong-map-data.js` adapts current bounds, station/village geometry, water,
  and public runtime destinations to the existing map data-source contract
- Six implemented BR_* zones plus the current F1 return stop produce seven POIs.
  NPC front-of-building positions supply reachable destinations rather than
  building centres. No outer sink, forest, field, theme park or harbor POI is added
- The pre-existing station body and three floor surfaces are moved to shared
  read-only layout constants. Their renderer names, dimensions, positions and
  materials are unchanged. No PlayerController collider is added
- `biryong-navigation.js` adapts the existing region-local planner with the
  player's capsule clearance. Guidance also avoids the visible station footprint,
  which predates the current movement collider list. The regional adapter uses
  the existing continuous PlayerController polygon sweep to validate segments,
  including rounded corners. NPC planner default inputs and behaviour remain
  unchanged; Recast runtime cutover is not enabled
- Arbitrary map picks must be walkable and belong to an implemented zone or an
  authored road corridor. Outer preview fields/lab sinks are not destinations
- The existing navigation state dispatches only to the current region provider.
  Explicit unsafe/no-route results pause rather than falling back to a line
  through geometry. Moving beside a building immediately re-solves an unsafe
  retained segment, and next-waypoint lookahead cannot skip through a corner.
  Route-unavailable, another outdoor region and indoor pause
  have distinct messages. Campus solver exception behaviour remains unchanged
- Maps switch sources on region transitions. Campus quest objectives and online
  markers never render using Biryong local coordinates. Only Campus-target
  navigation is forwarded to the existing Main 2 quest observer
- Existing full-map selection, pan, zoom, locate, reset and cancel are reused.
  This slice provides manual walking guidance; Biryong auto-move remains disabled
  under the existing movement policy
- Public topics for 강소라 (`work`), 남이솔 (`map`/`station`) and 한세온 (`craft`)
  offer only allowlisted implemented destinations. Success closes the dialogue
  and resumes the NPC. Failure retains the dialogue. View-generation checks
  reject callbacks from a closed, replaced or reopened conversation
- Opening the full map acquires its existing input owner before closing Biryong
  dialogue, so there is no unlocked-frame handoff. No new input authority exists

## Verification

Executable local contracts:

```sh
node --test apps/world/tests/biryong-*.test.mjs \
  apps/world/tests/navigation-*.test.mjs \
  apps/world/tests/full-map-controller.test.mjs
node apps/world/qa.mjs
npm_config_cache=/tmp/biryong-map-npm-cache-20261004 bash scripts/public-ci.sh
```

New tests cover geometry provenance, six-zone scope, exact return anchor,
collision-safe routes, blocked targets, outer preview rejection, unchanged NPC
planner defaults, explicit route failure/recovery, region-coordinate isolation,
public-topic destinations, stale callbacks and map input ownership. The actual
PlayerController traverses destination/return routes in a disposable Node
fixture using the unchanged movement-space collision owner.

Map UI tests use the real controllers with a lightweight DOM fixture at desktop,
portrait and landscape dimensions. They test logic and lifecycle, not browser
pixels, touch hardware, WebGL/WebGPU or physical-device performance. No local
browser attempt is made because that route is already known to be blocked.
The separately approved Draft publication adds a read-only-token GitHub-hosted
browser workflow pinned to the PR head. It exercises the actual offline Campus
and Biryong modules at 1280x720, 390x844 and 844x390, with captured screenshots,
source hashes and route/input receipts. Region entry and nearby-player placement
are explicit disposable fixtures; the existing return interaction and public NPC
dialogue controls are exercised normally. Mobile is Chromium touch emulation,
not physical-device testing. Automated receipts require an independent pixel
review before they can establish rendered acceptance. The first hosted run
identified a test serializer mixing map percentages with screen pixels; its
failure is retained rather than counted as a product acceptance pass.
No database schema or authority changes are included; operational DB activation
and authenticated runtime are not established by these tests.

## Existing visit/resume work: read-only reconciliation

The recovered prior visit/spawn/resume design uses `frontier.village.p0`,
`FRONTIER_VILLAGE`, and `transit.frontier_bus.f1`. Current public runtime uses
`BIRYONG_REALM`, `BIRYONG_STATION`, and `transit.biryong_bus.f1`. These must not
be treated as interchangeable IDs without an explicit compatibility decision.
The design is a mock contract, not evidence of a deployed visit API. A prior
local commit `2170016` was reported, but its code, current owner and subsequent
member-API implementation status were not recovered in this task.

Current `world-resume.js` still rejects non-CAMPUS writes, and the station spawn
remains HIDDEN with `allowResume: false`. They are deliberately unchanged. The
next useful step is to obtain the existing local result and reconcile safe
alight, same-account server readback, failure recovery and the current IDs before
implementing any missing backend or unlock path.
