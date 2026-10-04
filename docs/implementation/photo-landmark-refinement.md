# Field-photo landmark refinement (local candidate)

## Dependency and scope

This candidate is based on the neutral-campus Draft PR #97 head
`d2b201d8baa8294069498a793102c92fde411e48`, over public main
`f9541148dd59193234f0e3d158fe5ece68af46b9` (including the persistent ground fix).
It does not promote a WorldForge Draft or change the committed WorldForge geometry
manifest. The manifest still provides all 21 imported facility footprints; 20 keep
generic presentation, and the student center has a photo-informed presentation.
Main hall and Jeongseok remain on their separate existing public renderer.

Only the student center (`bldg_07`), main hall (`bldg_01`) and Jeongseok library
(`bldg_jungseok`) were crosswalked for this work. The unidentified tower, dormitory,
pavilion, gate structure and surrounding landscape are outside this refinement.

## Evidence versus interpretation

The owner requested use of an 11-page field-reference PDF labeled 2026-10-01,
containing 16 embedded photographs. The implementation author inspected actual
pixels, not only the compilation's captions. The PDF is a compiled document;
its date label is not independently verified camera metadata. No dimensions were
measured from pixels. The reference is private and is not included in this repository.

| Target | Viewed evidence | Geometric presentation | Still illustrative / unverified |
|---|---|---|---|
| Student center | PDF p8, photos 11/12 | Muted red stair-end accent with pale zigzag bands; tan segmented frontage; two upper ribbon bands; dark terrace recesses and thin rail lines; opposite rounded bay's vertical glazing | Existing source outline and 13-unit height retained exactly. Edge attachment, facade band spacing and palette are fitted visual estimates. No newly walkable terraces/stairs, no claim about unseen rear |
| Main hall | PDF p4/p6, photos 03/07 | Pale cladding-grid and pier rhythm; twin teal vertical glass frames; selective window-color accents | Existing public body, piers, approach and doorway positions are authoritative; new fine-detail spacing is estimated |
| Jeongseok library | PDF p10 photo 14; p5 photos 05/06 | Central green/teal curtain-wall rhythm; shallow upturned roof-cap profile; warm gridded canopy soffit | Existing front-edge and roof-part envelopes remain authoritative. Roof curvature is a bounded interpretation, not a surveyed section or new roof plan |

The body silhouettes, heights, navigation, source rings, doors, gameplay colliders
and ground remain unchanged. The library roof surface fits inside its existing
roof-part envelope. Student terrace depth is suggested by facade bands; it is not
new volumetric or walkable geometry. Tiny lit-pane colors are non-emissive material
accents, not new scene lights or a verified nighttime lighting simulation.

## Rights and publication boundary

The reference informed newly authored procedural geometry only. No photograph,
PDF, texture, person, plate, institutional CI, contractor branding, banner text or
identifiable incidental element is copied into this candidate. Permission to use a
reference is not a blanket assertion that every pictured third-party element is
rights-cleared. Hidden elevations and all other facilities remain unverified.
Publication requires the owner's separate approval; this local candidate does not
establish broader photo-distribution or trademark permission.

## Rendering and verification

The existing BASE/NEAR/DETAIL and chunk fade paths own the new presentation.
Student BASE keeps the exact neutral-envelope vertices with two recolored materials;
its NEAR facade uses five shared materials and no DETAIL tier. Pale parapets and
selective pane overlays use a second depth-bias layer to avoid coplanar z-fighting.
Material clone tests cover fade-bias retention. The student uses 255 BASE vertices
and 2,436 NEAR vertices, with no DETAIL vertices. There are no new dependencies.

Focused checks:

```sh
node --test apps/world/tests/photo-student-center.test.mjs apps/world/tests/photo-hall-library.test.mjs
node apps/world/tests/browser/photo-landmarks-null-smoke.mjs
```

The real-engine null-device check covers actual production render entry points,
three create/destroy cycles, shared source materials, clone depth bias and draw/vertex
budgets under the production negative-Z parent. A separate binding assertion checks
all 21 facility BASE outputs and 20 NEAR outputs; the unchanged dormitory sign needs
a real canvas and is left to graphical QA. It does not generate pixels and must
not be described as a visual pass.

Graphical fixture (offline, backend/API writes blocked by the existing harness):

```sh
WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome \
  node apps/world/tests/browser/photo-landmarks-smoke.mjs
```

It captures all three landmarks at portrait, landscape and desktop sizes in both
production reflected-Z and unreflected control modes. BASE/detail comparisons test
visibility and stationary-frame stability. They are not original-version before/after
screenshots. An actual same-camera original-version comparison requires running the
pinned dependency commit separately. See the local evidence receipt for attempted,
passed and blocked checks; no hosted or production visual pass is implied.
