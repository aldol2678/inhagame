# Actual gameplay sharing images

The concept-art candidate was withdrawn after the user requested actual gameplay.
The user then supplied gameplay screenshots. A daytime landscape with a flying
character beside the campus dragon monument now supplies the three exports.

## Scope

- Three Adobe-cropped/resized PNGs: 1200×630, 1080×1080 and 1080×1350.
- User screenshot provenance, hashes, crop bounds and effective scales recorded
  in apps/world/assets/social/20261028/manifest.json.
- 11 public documents updated to the landscape image, descriptive gameplay alt
  text, image/png MIME, correct dimensions and Twitter large-image metadata.
- Arcade generator and SEO contract updated together.
- IMAGE_STANDARDS.md permits PNG exports within explicit size budgets.
- ACTIVE8 icons, UI glyphs, game logic, existing hub artwork and canonical URLs
  remain unchanged. The concept social masters/generator remain withdrawn.

## Authenticity and limits

No generated scenery, character substitution, UI fabrication, recoloring or
expansion. The operator/GM nameplate remains. Phone system bars and peripheral
controls fall outside the crops. Exact capture date/build was not independently
verified. Portrait requires 2.37× resampling from selected pixels; it does not
claim native 1080×1350 detail or super-resolution.

The earlier browser could not initialize WebGL. User-supplied screenshots resolve
the source blocker. QA placeholder renders were not used.

## Validation and release

All three exports visually inspected and decoded: RGB, exact dimensions, hashes,
landscape below 500 KB and companions below 1 MB. Targeted SEO, generated-page,
item-icon and UI-glyph contracts: 21/21 passed. Full CI result is recorded below.

Not published or deployed. Actual live URLs and external sharing previews must
be checked after an authorized release; local checks do not establish this.

Full `bash scripts/public-ci.sh` passed (exit 0). Local HTTP verification passed
for all 11 public documents and 3 PNGs: 200 responses, correct image/png MIME
and matching metadata. Full test log and HTTP check results are in the review ZIP.
