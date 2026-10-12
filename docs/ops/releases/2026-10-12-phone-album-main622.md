# INHA WORLD · Phone Album Manager · Main 622 Integration Release
## Exact provenance
- New integration base: `6222104ea19630a33f73daca8379224075595d3f` (merged source #349 present).
- Original source: PR #342 at `df88b6090ae1a4b3ddbb5b160bef598f2d6296de` (9 source files).
- Original release wrapper: PR #346 at `ce4ec9eb06c7d72a0d574998d2866fc905a9501f`; preserved untouched, not a parallel release authorization.
- This candidate reuses 8 of the 9 source file Git blob SHAs exactly. Only `apps/world/src/phone/smartphone.js` is adapted against current main for source changes from #342.
- Exact #349 behavior retained: `onAlbumViewed(record)` runs only after photo image load within the same UI epoch; photo image error messaging; `openAlbum(record)` retains the input/admission check and boolean result; `launch` returns the shell's admission status.
- Added #342 functionality: storage statistics, capped original-image ZIP (100 photos / 32 MiB / 16,777,216 pixels), multi-select, progress/cancel, account generation isolation, and readonly export.
- No other candidate or source PR is inherited. Do not merge #342 separately.

## Scoped changes and QA
- 9 files from #342's source scope: 8 exact original blobs + 1 integrated phone shell file.
- QA trigger-only updates to `.github/workflows/housing-browser.yml` and `.github/workflows/photo-mode-browser.yml`: include the exact `apps/world/src/phone/smartphone.js` path so the integration PR triggers the dedicated existing Housing and Photo Mode browser regression suites. No QA thresholds, commands, budgets, rights, secrets or test implementations are relaxed.
- New manifest is this document. Total intended PR change set: 12 files.
- Existing Phone browser workflow brings the album ZIP browser smoke and desktop/portrait/landscape original-byte ZIP verification; latest main supplies the room-photo-story and photo-view callbacks.
- Admission: required Public CI `verify`, Smartphone integration browser QA, Housing browser QA, Photo Mode browser QA, Life Housing browser QA, and any other triggered checks all SUCCESS on this exact new Head. A previous successful #346 or #342 Head is not a substitute.
- Validate real album-view callback, failed image handling, album direct open return value, account A→B→A cancellation, folder/album transitions and the Photo Mode/room photo-story regression. If CI or review fails, keep Draft/HOLD; no merge.
- Chrome viewport emulation is not physical-device validation. The user explicitly waived physical Android/iOS device QA for this release.

## Authority and rollout safety
- No Production SQL, schema, migration execution, Auth, tokens, backend calls, other PR changes, release flags or account data mutations.
- Current #350 Daily Quiz/Attendance Phone PR remains independent and is not included. PR #337/#340/#314 and all other HOLD/experiment candidates remain excluded.
- The previous #346 release branch and its provenance are historical; do not revise, close or merge it as part of this isolated integration.
- This branch/PR is release-preparation only. No main merge, no direct push to main, no Production deployment and no Preview/manual deployment authorization.
- A future approved merge must use a fresh expected-main-head readback and all required checks, followed by a Git-triggered Production SHA/READY/domain/runtime verification. The earlier rollback candidate in #346 is historical and must not be assumed READY at that future release time.
