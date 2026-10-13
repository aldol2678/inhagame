# Photo-save UX and runtime diagnostics release

Status: CANDIDATE / EXACT-HEAD CI AND PRODUCTION READBACK PENDING

## Reviewed scope and admission

- Verified release base: `bfa08ad78f92fba51eb1a3978dd97a12182fc82c` on main.
- Included #311 unchanged reviewed head: `1dcd85d9370b82a32ea29a0992c45618e5a82f5e`. Only the exact photo QA documentation path becomes database-independent; source checks stay full, and mixed/unknown changes fail closed. All four original exact-head checks remain successful.
- Included #340 unchanged reviewed head: `912a6d354464e6536029b631a587ab5f64c0ac5c`. Local diagnostics and explicit user-initiated redacted report copy/download. All 37 original exact-head checks remain successful. The CSS-link merge resolution preserves both current-main stylesheet links and the diagnostics stylesheet.
- Included the explicitly approved first-stage photo-save repair from local reviewed commit `dacbdeadde17625a5fc7378dc831135bc9529a6a`: stage spinner, ten-second soft warning, cancellable PNG creation and provisional thirty-second hard limit with retry guidance. It retains capture elapsed and over-soft-limit diagnostics. Already requested downloads cannot be cancelled; album persistence remains a separately labelled stage with no new album-wide abort transaction. Worker encoding is deferred.
- Only seven runtime owners change: the four diagnostics modules, main.js, photo/photo-capture.js and photo/photo-mode-panel.js. No geometry, collision, world data, shader, performance sampler or existing performance threshold changes.
- #379 is already on main, with no duplicate release changes.

## Explicit exclusions and failed evidence

- #365 (`8f00074c8736a100bd229a1bd29a74e8bfd9698d`) and #382 remain HOLD and are not ancestors of this release. No walkway/clocktower/south-entry changes, paving batching experiment, Hall release-scope extension, Backgate release-scope extension or walkway baseline-selector changes are included.
- Preserve #382 Draft and its failed evidence. Its latest head `4e63d81fd6aafec2cad82cd20ac1f9322f2c638c` had 36 successful and two failed workflows: Backgate scope before rendering (`38337042622`) and North walkway (`38337042790`). The latter failed performance in nine of 24 views and strict pixel equivalence in eleven views (187 differing pixels, maximum channel delta 81). Null-device structural equivalence was insufficient; that optimization is not adopted. Heap observations do not establish a leak or isolate causation.
- #383 photo diagnostics, #385 water-path work, #386 librarian work and all other pending candidates are excluded. Existing main content is preserved unchanged.

## Evidence and release gate

- Final split-release local verification: World 4545/4545, CI-policy 105/105, static QA, browser-script syntax and whitespace checks passed. No browser/GPU claim follows from these local checks.

- The photo and diagnostics runtime bytes match the separately verified #382 head above, but its prior success is not substituted for this release's own exact-head checks.
- In that prior head, Smartphone run `38337043073` and five Photo Mode jobs in `38337042850` passed. Actual desktop PNG took 11296.7 ms, retaining a 1296.7 ms soft-limit overrun (924.3 ms frame wait, 3625 ms readback, 6747.4 ms encoding-stage wall time); portrait and landscape were 704.2 and 1178.8 ms. This demonstrates completion under the approved waiting policy, not faster encoding. PNG pixels, three pending/cancel viewport screenshots, late callbacks and album/ZIP/account isolation were verified.
- Final integrated release CI, including Public verify and every triggered browser workflow, must succeed before merge. Local unit/static evidence and admission-head success are not final browser acceptance. Local Chromium startup is blocked by executor UNIX socket permissions; no local rendering success is claimed.
- After merge, verify exact main SHA, its required CI, matching READY Production deployment/custom domain and changed-surface readback/runtime errors. Until those postconditions are established, the release is PENDING. Physical devices, real-user accounts and Safari interaction are not claimed.

## Database, privacy and rollback boundary

- No database migration, SQL, Production data, permissions, credentials, deployment configuration, backend activation or external transmission changes.
- Diagnostics are bounded/allowlisted and user-initiated, with identity cleanup and no automatic report upload. Existing Jeongseok account grants, gate rules and exact-loopback preview guard stay unchanged.
- Last independently verified Production rollback candidate is `ea88ceaf1c813a0a9ea3f7056290bd5110e5552a`; use a newer independently verified deployment if appropriate. Never select an older pre-guard deployment. This release does not authorize a rollback.
