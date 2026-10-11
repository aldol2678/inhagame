# Room life: local integrated candidate

Base: `82538ea1dfd4b3f82123673786ab052a76fc1a7c` (`main`).

This candidate combines personal-room day/night, ceiling-light and curtain controls with owned-furniture layout suggestions. It has not been committed, pushed, opened as a PR, merged or deployed. There are no database, account, security or permission changes.

## Player-facing behavior

- The window view and room ambient brightness follow the existing world clock/environment projection.
- Walk to the entrance switch or window and use the existing F/mobile action button. The ceiling switch controls the two existing ceiling lights; the existing reading lamp remains on its original behavior. Total existing lights: 3, added lights: 0, new shadow passes: 0.
- Curtains gather to the sides or spread to meet at the center. Reduced motion snaps them open/closed. No mesh creation occurs while toggling.
- Controls reset between room stays/accounts. They are local visual state, not saved settings or visitor-synchronized state.
- Furniture editor offers study, relaxation and open-center suggestions from currently owned furniture only. Suggestions are previews; manual edits, Undo/Redo, cancellation and the existing explicit Save remain available.
- Unplaced quantities stay owned and are explained. Suggestions never buy/grant furniture, change inventory, or save automatically.

## Review fixes integrated

1. Recommendation cancellation now uses the same current-ownership/READY/32-slot guard as Undo/Redo. A blocked cancellation retains the preview and history for retry. Removal-only and movement-only recovery remain possible.
2. Manual edits followed by Undo/Redo preserve recommendation metadata. Undoing the recommendation itself returns to the original layout and exits preview.
3. Recommendation search uses shared desktop/bed bounds, a bounded half-unit floor grid, unique footprint orientations, catalog-only static candidate caching, and an overlap precheck. Final candidates still pass the existing ownership/layout validator. Cached geometry contains no account/inventory/layout state.
4. Recommendation CSS is placed next to furniture editor styles, before the final landscape HUD authority block.
5. Room/campus lighting uses Color copies, preventing the world environment director from mutating another scene's stored palette through shared references.

## Performance measurement

Synthetic inventory: all 17 catalog types, 2 of each. Before: approximately 855–1,608 ms/style. After: 46–79 ms/style cold and 1.4 ms/style warm in an isolated local run. Independent review while other tests ran measured 131–255 ms cold and 2–13 ms warm. Reproduce with `node apps/world/tests/furniture-recommendations-benchmark.mjs`. These are CPU measurements in this cloud executor, not mobile-device latency or GPU proof. Coarser floor sampling intentionally favors a quick valid suggestion over maximum packing density.

## Verification and remaining release gate

- Furniture regression: 75 tests passed, including ownership loss/LOADING/retry cancellation, recommendation Undo metadata and inventory-independent caching.
- Independent review: 89 focused tests passed, new Null smoke passed, no new blocker found.
- `qa.mjs`, syntax checks and `git diff --check`: PASS after CSS authority correction.
- Actual pinned PlayCanvas 2.22.4 with NullGraphicsDevice: 20 repeated stays, 10 real adapter campus-lighting restoration cycles, stable resource counts, room material isolation and curtain overlap at every geometry row: PASS. Existing room-foundation Null smoke also passes.
- Full World Node suite after the CSS fix: **4,173 passed, 0 failed**.
- Browser harnesses are prepared and included in Housing CI for both features. Chromium cannot launch here (`socket() failed: Operation not permitted`). No permission bypass was attempted.

Actual WebGL2 screenshots, real LOW-tier readability, mobile tap/F keyboard operation, curtain visual quality and real-device performance are still required before release. Synthetic/Null tests are not substitutes for that evidence. No external publication or release was performed.

Latest-main read comparison: `e299136b43a4be65f1feb1dc2a911241ad578a8a` was fetched after implementation. Its changed-file set versus the candidate base has no overlap with this candidate. A separate clean checkout at that exact SHA also passed `git apply --check` for the combined patch. Actual publication must still recheck and apply against then-current main; no unrelated open PR was included.
