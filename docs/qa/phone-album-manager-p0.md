# Phone album storage and ZIP export

Base: `03f4aafaedc4c3168a963a84d7a4a285f9f85985` (latest main at task start).
Rebased onto `952a826c3a38d4dd88f2d5fe316cacc9c9b41dd6` after #341 merged during
verification; no NPC or migration files are part of this PR diff.
Checked open PRs #337, #340, #336 and #314; their owned code is unchanged.

## Player behavior

Album shows the current account's count, original bytes and thumbnail bytes. Open
**저장공간 관리** for a separately labelled, optional site-wide browser usage/quota
estimate. Estimates include other accounts/caches and do not describe free disk
space. Photo viewer lists both sizes; grid lists original size.

**전체 사진 ZIP**, **즐겨찾기 ZIP** and **선택 사진 ZIP** export original bytes.
**사진 다중 선택** enables keyboard/touch toggle buttons and **선택 전체 해제**.
Selected count/estimated original bytes, ZIP progress, explicit cancel and error
messages use the existing phone shell and InputFocus owner. Leaving the album,
closing the phone, logging out or switching accounts cancels a pending job.

## Data and memory contract

- Existing `inha-world-phone-v1` database, version 1 and both stores remain unchanged.
- Export uses readonly operations. It never deletes, edits, migrates or uploads photos.
- Blob sizes are measured without decoding or materializing all original bytes.
- A monotonic account generation is checked after every async read/yield, including
  A → B → A. Original/thumbnail references must match the current account/photo key.
- Store-only ZIP with CRC32, unique sequential filenames, fixed ZIP date and no
  manifest. No record IDs, coordinates, location names, captions or auth fields are
  copied into the archive. Original images remain byte-for-byte unchanged.
- Maximum 100 photos and 32 MiB of original bytes per job; oversized jobs fail before
  original-byte reads. Choose smaller batches. ZIP headers add a small overhead.
- PNG/JPEG only, maximum 16,777,216 pixels per image. Dimensions are checked before
  image validation; JPEG dimensions must appear within the first 1 MiB. Decode
  failures, missing originals and unsupported dimensions fail the whole job.
- Originals are processed sequentially in 1 MiB chunks; each chunk yields to permit
  cancellation. One bounded archive is assembled in memory (not streamed to disk).
  Cancellation also completes while an IDB read or decoder is stalled; late results
  are discarded. Temporary parts are released on completion/failure; download Blob URLs are revoked
  after one second. Browser decoding/Blob copies still contribute to peak memory.
- The UI reports ZIP creation and download request, **not confirmed disk persistence**.
  Browser JavaScript cannot observe OS disk-full errors or completed native downloads;
  players are directed to the browser download list. Exceptions issuing a request are
  shown as failures. Already-issued downloads cannot be recalled on account changes.

## Reproduction and validation

```sh
node --test apps/world/tests/phone-*.test.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/phone-album-manager-smoke.mjs
PHONE_HEAD_SHA=$(git rev-parse HEAD) WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chromium node apps/world/tests/browser/phone-campus-smoke.mjs
bash scripts/public-ci.sh
```

The new browser test runs actual campus/production phone modules with native
IndexedDB and browser downloads in desktop, mobile portrait and landscape. Python
`zipfile` opens every downloaded ZIP, checks CRC, count, unique filenames and exact
original bytes. Synthetic photos are compared again after all exports.

Failure injection covers missing/corrupt/33 MiB originals, download request errors,
explicit cancellation, A → B → A/logout during export, denied IDB, quota errors,
poisoned cross-account references and low/denied/unsupported storage estimates.
Unit tests also exercise 120-photo statistics and the 100-photo limit.
Existing phone browser QA covers actual Photo Mode capture, favorites, wallpaper,
confirm-delete, navigation, settings, input isolation and persistence.

Artifacts: `test-results/phone-album-manager/` (ZIPs, screenshots, JSON report) and
`test-results/phone-campus/`; uploaded by Smartphone integration browser QA.
Only synthetic local data is used. Chromium viewport/touch emulation does not replace
physical Android/iOS browser acceptance. No production deployment, main merge,
server/DB configuration change, external service or live user data access is involved.

Local browser note: the full Phone capture regression failed in Chromium Headless
Shell (including a sequential run), while the installed full Chromium browser
passed all three viewports. Use the full Chromium command above for that suite;
GitHub runs the existing Phone regression with Chrome. The capture engine is unchanged.
