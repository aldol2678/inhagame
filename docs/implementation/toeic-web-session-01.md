# TOEIC web learning — first daily session (draft)

## Product slice

The native learning app previously retained checked progress after reload, but
not the unfinished question cursor. This change adds a lightweight `/learn/`
web entry: Today → ten English choice questions → explanation → up to three
rechecks → result → locally saved continuation. The web entry does not load the
3D world. It reuses the existing catalog, engine and native progress contract.

This is the first implementation slice of the proposed TOEIC study website,
not a released TOEIC course. The existing English catalog still requires an
approved content release. No question bank or new curriculum is included.

### Verified starting point, 2026-10-28

- PR #429 is **merged**, per GitHub metadata, despite its old description.
- PR #430 is **open/draft**, head `2bbaaadddfa5e053e707cf7e22ac0333ef9248b6`,
  base `codex/phone-learn-01-r1a` / `82ceb7989cb2f48b2f3301c3013531c0114f45c9`.
- Observed main: `81b3fa793b6155d50e1bb30bb3611732b8c79f9f`.
- This is a new child branch based on #430; neither existing branch is edited.
- The separately referenced private `ARCHITECTURE_DECISION.md` and
  `CODEX_ASTRA_IMPLEMENTATION_HANDOFF.md` could not be retrieved. This draft
  follows the inspectable R1-A/R1-B implementation contracts; it does not claim
  those unavailable documents were reviewed or superseded.

## Behavior and scope

- Responsive Today, question/explanation, result, review and history views.
- Prioritize wrong/due items, then unstudied English choice items. Ten distinct
  initial items; this is rule-based selection, not a calibrated score predictor.
- Hint is a generic reasoning cue, recorded separately from independent recall.
  Hinted correct answers count as practice but do not advance native mastery.
- After the first ten answers, revisit up to three wrong/hinted items once.
  This slice repeats the same items; related alternative sentences and semantic
  grammar/word tags require a later reviewed content contract.
- Result separates initial accuracy from extra rechecks. No TOEIC score estimate.
- Save choice, hint, checked explanation, cursor and finished result. Restore
  does not resubmit or increment learning counters.
- Production entry uses the unchanged approved-content loader only. With the
  release OFF it shows a preparation state, performs no content fetch, and does
  not create learning records. No query parameter or global enables test data.
- Guest/local-only entry. The session API is scope-aware and tested for A/B/guest
  isolation, but this is not an authenticated website or cross-device sync.
  Existing authenticated Phone learning continues unchanged.

## Storage authority and failure handling

Native `inha-world-learning-v1:<scope>` remains the progress authority. The
additional `inha-world-learning-daily-v1:<scope>` contains only a versioned
cursor, content IDs, learner-selected option indices, hint flags, scope and a
native-shaped progress checkpoint. No prompt, options, answer keys or economy
fields are written. The checkpoint is local only; it is never sent to cloud.

Each action checks the observed cursor and native progress before writing.
An unchanged cursor restores only if its progress matches the loaded native
progress and every referenced content version validates. Any malformed/future
record, changed content, newer native progress, or stale tab blocks continuation
without replaying grades or silently replacing the original.

Native progress and the cursor are two localStorage writes, **not one atomic
transaction**. If interrupted between them, completed grades remain in native
progress and restoration is blocked. The user can export the in-memory/stored
records, explicitly acknowledge backup, and reset only the cursor. Cursor quota
failure keeps the checked answer in memory and offers retry and backup. Existing
native recovery copies are retained. Native import UI remains the recovery path
for native progress; this slice does not import daily-recovery bundles.

localStorage does not provide cross-process atomic CAS. Sequential stale writes
are rejected; truly interleaved writers are not claimed to be linearizable.
Account scope is local convenience isolation, not authentication. Browser storage
can be cleared externally; exports remain necessary for durable personal backup.

## Validation

At implementation time:

- New focused Node cases: **16/16 PASS**.
- Existing learning cases: **101/101 PASS**.
- Full World Node suite including new cases: **4,970/4,970 PASS**, no skips.
- `node apps/world/qa.mjs`: **PASS**.
- Browser test added for desktop 1280×900 and mobile 360×780: actual production
  closed gate, test-only fixture response, ten-question flow, hints, rechecks,
  selection/explanation reload, quota retry, two tabs, overflow and JS errors.
- Local browser execution is **BLOCKED**: no installed Chromium and Playwright's
  Chrome/Headless Shell downloads returned invalid zip payloads. Browser results
  and visual appearance are not counted as verified. CI runs the new smoke in
  the existing exact-head learning workflow. Physical Android/iOS remain untested.

```sh
node --test apps/world/tests/phone-learning*.test.mjs
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
# With the repository's existing browser test dependencies installed:
node apps/world/tests/browser/phone-learning-web-smoke.mjs
# To inspect the actual gated entry locally:
node apps/world/dev-server.mjs
# Open http://localhost:8080/learn/
```

## Next slices

1. Review a small TOEIC vocabulary/Part 5 bank and its explanations; add approved
   topic metadata, per-distractor explanations and alternate-sentence rechecks.
2. Add target score/date/study-time settings and a course view using reviewed data.
3. Connect verified authentication and the existing R1-B progress transport after
   its independent release gates. Define resume behavior across sync changes.
4. Validate real mobile input and visuals, then plan LC audio and Part 6/7 passages.

No merge, public-content approval, feature activation, Production deployment,
database migration or game reward change is included in this draft.
