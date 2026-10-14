# INHA-PWA-R1 · 캠퍼스 설치 아이콘 출처와 범위 (2026-10-13)

- Source: private user-held `INHA_WORLD_인덕이_안뇽이_3D_개선시안_통합검토본_20261008.pdf`, page 2, section `인덕이 / 여의주 섭취 후 · 공식 5면도`, front-facing official 2D reference.
- Process: front-facing figure cropped from the official 2D figure panel; guide-grid removed by color segmentation; silhouette, beak, face, wings, feet and neck positions preserved; flat sky-blue application-icon background added. Five-color indexed PNG variants are generated from one artwork crop.
- User states that official-use permission for the mascot has already been obtained. The full license correspondence was not independently inspected here. Do not treat this statement as institutional operation or endorsement of INHA WORLD. If the authorization has asset/channel restrictions, verify before Production use.
- This is **not** generated from the public `induck-v3.glb` QA placeholder. No source document, manual, 3D private model or unrelated university logos are committed.
- Paths: `campus/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon-32.png`, `favicon-16.png`.
- Only the campus entry point and campus-scoped manifest are changed; no service worker, offline caching, 3D runtime, account data, or backend logic changes.

QA required before merge: manifest HTTP 200 + JSON MIME + icon PNG 200; Android Chrome install/launch; Safari iPhone/iPad Add to Home Screen, account restore, WebGPU start and 6% loader behavior. Device/runtime outcomes remain UNKNOWN until measured.

## R1 correction · 2026-10-13

- Original installed-icon export FAILED visual QA: an Int16 squared RGB-distance overflow mapped bright/white pixels into the dark palette. The resulting icon was committed without visual review.
- Regenerated all six files using Int32 arithmetic, full-resolution palette matching, and a plain sky-blue background. White body, dark face outline and yellow beak/feet rechecked against the official 2D reference.
- Added apps/world/tests/pwa-visual-guard.test.mjs. It decodes PNG pixels and checks center-white, corner-blue and low overall dark coverage. It passes with the corrected icons and fails with the previous black icon.
- Not a new institutional approval or Production sign-off. Draft and device QA gates remain.
