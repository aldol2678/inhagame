# INHA WORLD image export standards

These rules preserve the existing runtime asset contracts. New art must use a new
versioned directory and identifier; do not overwrite reviewed icon pixels.

| Use | Dimensions | Format | Contract |
| --- | --- | --- | --- |
| Link share / Open Graph | 1200 × 630 | PNG or JPEG | Opaque composition, under 500 KB, absolute HTTPS URL, matching width/height/type/alt |
| Square social post | 1080 × 1080 | PNG or JPEG | Dedicated framing, under 1 MB; do not crop required text |
| Portrait social post | 1080 × 1350 | PNG or JPEG | Dedicated framing, under 1 MB; preserve subjects and source provenance |
| ACTIVE8 item icon | 32, 64, 128, 256 square | RGBA PNG | Straight alpha, sRGB artwork, fully transparent outer border, nonempty content |
| Phone/HUD glyph | 24 × 24 viewBox | SVG | Retain the approved p0-v1 source, colors and runtime mappings |

For item icons use the existing `item-icons/active8-v1/manifest.json` for source
hashes, IDs and bounds. Its `runtimeIntegrationPerformed` field records the
historical source delivery, not current runtime status (see that pack's README).
The renderer uses 64px/128px images in its existing fixed CSS slot. Do not
reprocess these reviewed files merely to make a new export pack.

New exports must record the source, dimensions, byte count and SHA-256. Inspect
text and edges at full size and thumbnail size. Inspect transparent art against
light and dark backgrounds. Texture atlases, normal maps, sprite sheets and 3D
materials are not covered by these icon rules; their UV/layout contracts must
be preserved.

Official 1.0+ releases must also validate the deployed image URL, MIME type,
page metadata and actual sharing preview. Local file checks and a simulated
card are not evidence that an external platform has refreshed its cache.

Checks: `node --test apps/world/tests/seo-metadata.test.mjs apps/world/tests/item-icons.test.mjs apps/world/tests/ui-icon-runtime.test.mjs`.

## Gameplay imagery

Game promotional images must use verified captures from the actual running game.
Do not substitute concept illustrations, generated scenes, model studio renders
or QA scenes with placeholder characters. Preserve the original capture and
record its date, source URL/build, viewport and whether it is production or local.
Do not describe archived or local captures as current production screenshots.

Cropping and resizing may change framing, but must not invent scenery or replace
characters. Review each aspect ratio separately for clipped characters and HUD.
If no suitable capture is available, keep the current share metadata unchanged
and mark the proposed image set as blocked pending real gameplay captures.
