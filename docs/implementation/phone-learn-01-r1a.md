# PHONE-LEARN-01 / R1-A — native Induck Campus

Draft implementation only. Do not merge, deploy, enable public content, change production databases, or change economy authority as part of this PR.

Baseline verified at start: `main` `1a8466a2bb715dcc44aad3dece83e358ec442ca1`.
Private handoff v0.6.2.1 HTML SHA-256: `dc836a1c92d3e0036fc3bedad36180b99f0de14f36f80fa8095b8f4256d03e33`.
R4 bank SHA-256: `0567b32944235ee4240408e8c53ad23b070efc446d68defa0d30e824487e0ae3`.
All handoff checksums verified. Source HTML, question bank, private screenshots and original QA outputs remain outside the Git checkout. None is a public deliverable.

## Implementation

- `src/learning/learning-content.js`: closed release configuration; manifest approval/rights/reference, exact SHA-256 bytes, ID/version list, item approval and complete course structure validation. The fixed local resource path is restricted to `/learning-content/<name>.json`; no dynamic JS, iframe, URL parameter, localStorage flag or window-global activation. Default `{enabled:false, manifest:null, resource:null}` performs no fetch. No approved release manifest exists.
- `learning-engine.js`: rules extracted from the actual source: six-question lessons, adaptive +5/-8 skill and four tiers, option/order/match and correction/scenario/reading/tone/kana types, combo, five-question bosses after five completed lessons (4/5 pass), wrong-answer and interval review. Catalog preserves English 15 and optional complete Chinese/Japanese five-lesson groups. Demo banks are rejected.
- `learning-view.js`, `learning.css`: native host-scoped DOM rendering with inert text and `.learning-app` styles, home/course/question/explanation/result/review/history/backup and voice-practice views. No duplicate phone shell. Speech practice reuses eligible course sentence cards; supplemental unapproved audio/story banks remain in the private source.
- `learning-speech.js`: explicit user-triggered recognition/playback, language voice detection, text fallback, 15-second recognition timeout and generation-guarded cancellation. Recognition is text practice, not pronunciation grading. Voice playback/recognition ends on navigation, unmount, account switch, pagehide and disposal.
- `learning-controller.js`: `ready`, `available`, `mount`, `unmount`, `setAccount`, `snapshot`, `dispose`. A mounted session can resume in memory after Phone Home/Back; reload retains checked progress and completed lessons, not the unfinished question cursor. Exceptions present recovery guidance while Phone navigation remains available.
- `phone-app-catalog.js`, `smartphone.js`, `main.js`: stable native `learning` ID; actual availability gate; existing HOME/APP/BACK/CLOSE and InputFocus retained; same account identity lifecycle as Phone. Today’s Quiz only launches existing `daily-quiz`; no learning RPC or wallet/EXP/reward/league writes.
- `ui/ui-icon-runtime.js`: learning reuses the existing approved duck profile glyph; no new asset or icon authority.
- `phone-preferences.js`, `phone-store-integration.js`: optional app enters a vacant Home slot only when ready; existing home order, hidden apps and Dock preserved. Saved learning placement survives feature disabling. Store bridge is finite and cannot install it as an external app. Textareas join the Phone keyboard focus trap.

## Progress contract and manual migration

Local key: `inha-world-learning-v1:guest` or `inha-world-learning-v1:user:<encoded-auth-id>`; never nickname. Account change closes the Phone and clears controller session/DOM/voice/import buffers before loading the next scope. Guest records are never silently copied to a member. Same-browser origin users with developer tools can access localStorage: this is local convenience isolation, not server authorization.

Stored data: completed lesson IDs; `qv:<questionId>@<version>` mastery/wrong references; skill values; day counts; boss and typed/microphone practice counts. No question text, choices, answers, demo currency/EXP or ranks. Changed versions retain historical records and create `needsRecheck` for the current question. Same-day repeat does not shorten mastery intervals; correct recheck clears the flag as in v0.6.2.1.

Native UI: **학습 기록 → 기록 백업 · 가져오기 → 백업 JSON 만들기**. Copy/save the JSON, then paste it in the target browser/account, review, and explicitly confirm the merge. Existing conflicting target records win; a failed save rolls back memory. Malformed/future stored formats are not overwritten. Cross-origin automatic access is impossible.

For an old standalone origin, export the exact `inha-world-induck-campus-html-r1` localStorage value from that origin's browser storage inspector into a private JSON backup first. Do not delete the original. Import accepts that legacy shape and the new export format, ignores economy/rank/content fields, and migrates only unambiguous static slots 0–2. Version-changed static records require recheck. Unresolved adaptive legacy slots are reported and remain in the user's original backup; guessing their question from the current skill level would corrupt history. Old source's `legacyR4Archive`, narrative history and supplemental studio stats are not automatically migrated in R1-A.

## Validation and reproduction

Public fixtures are newly authored `test.*` strings in `tests/support/learning-fixture.mjs`, not R4 items. Their approval booleans are test input only, not a curriculum publication decision. They never enter production Quiz or a league.

```sh
node --test apps/world/tests/phone-*.test.mjs apps/world/tests/daily-quiz.test.mjs apps/world/tests/daily-panel-focus.test.mjs apps/world/tests/daily-reward-readback.test.mjs apps/world/tests/pwa-shortcuts.test.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 PHONE_HEAD_SHA=$(git rev-parse HEAD) node apps/world/tests/browser/phone-learning-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 PHONE_HEAD_SHA=$(git rev-parse HEAD) node apps/world/tests/browser/phone-learning-campus-smoke.mjs
```

`phone-learning-smoke.mjs` exercises real Smartphone/InputFocus/Learning with World/Daily Quiz test doubles: 1280×900 and 360×640, six-question result, wrong review, Back/Home/Close, actual-origin localStorage reload, A/B/logout, manual migration, text fallback, render exception, pagehide and overflow.

`phone-learning-campus-smoke.mjs` first checks the unchanged release is OFF in actual `/campus/`. It then injects synthetic content into only Playwright's loopback main.js response and verifies the real player/orbit input locks, lesson/result, daily-quiz surface, maps/album/camera and return to World. The test override is not part of the deployed application.

The dedicated `Phone Learning R1-A QA` workflow checks out the exact PR head. Its artifacts contain only synthetic content. Existing Phone and Public CI remain required; workflow skips are not test passes.

Private verification performed locally: source VM versus native engine, all 25 lessons / 150 submitted questions, identical adaptive IDs/versions, skill/combo results and five boss question sets. The private catalog holds 153 learning candidates; 27 demos excluded. Original approval remains 0/180. Private browser evidence is outside the checkout. Physical Android/iOS, microphone hardware/service and live authenticated backend rewards are not covered by emulation.

## Remaining gates

- **R1-B**: approved English 15-lesson manifest, professional quality/rights review, verified deployment-to-server mapping, server progress contract/RLS, authenticated account isolation, idempotent saves/conflict resolution, offline synchronization and migration readback. Local storage is not cloud-save completion.
- **R2**: separate opt-in server-authoritative learning league, server-only competitive answers and scoring, KST daily/weekly boundaries, top-five-days aggregation, tied ranks and minimal public identity. No demo questions or existing game ranked authority reuse.
- **HOLD merge/public release**: any unapproved content exposure, account leakage, wallet/reward changes, lost InputFocus, missing required exact-head checks, missing content/server/device gates or absent separate merge/deploy authorization. Even green QA does not authorize content publication or Production deployment.
