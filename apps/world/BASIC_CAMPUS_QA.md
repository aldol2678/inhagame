# Central campus map alignment

Scope: In-Kung Pond, Main Hall and entrance, Jungseok Memorial Library, open main gate,
four central lawn compartments, reflecting pool and basic approach roads.

## Geometry and visual sources

- Main Hall: OSM way 217958071, 20 unique outline vertices.
- Library: OSM way 217958067, 14 unique outline vertices.
- Lawn, pool and road coordinates: `data/reality/campus-site.json`.
- Exact source IDs, versions, timestamps, ordered node IDs and coordinates:
  `data/reality/evidence/basic-campus/source.json`.
- Building identity and relative placement were compared with the official campus
  illustration and the photographs supplied
  by the user from the Yonghyeon-campus article. The article itself was inaccessible
  through browser policy; no claim is made to have browsed it.

Source geometry is preserved in WGS84. Ground-level building bodies and their
collision boundaries use the same projected vertices, including rotated facades and
concave setbacks. Roof caps use the existing ear-clipping triangulator rather than a
convex fan. Library roof/canopy collision follows the rendered estimated roof parts.
The western world bound extends by 16 WU to allow walking around the library footprint
whose western edge exceeded the former bound. No other world expansion is included.

Building heights, window spacing, colonnade details, glazing curvature, roof details,
gate-wall dimensions, road widths, entrance paving and individual vegetation are
**simplified visual estimates**, not measured architectural data. Canonical unknown
height fields remain null. This is an exterior blockout, not a photoreal replica.
There are no interiors, new islands, gazebos, swimming or pond collision systems.

## Visible changes

The old unrotated rectangular Main Hall and tall gate crossbeam are replaced by the
source footprint and open entrance. Main Hall has its long facade/colonnade facing
the central approach; the library is west of the lawns with a glazed front and
overhanging roof. The four lawns and long rectangular pool follow their source rings.
Pond geometry is unchanged; water uses muted green-grey tint, animated small normals
and sky-colour reflection (not real-time reflection of the surrounding buildings).
Shadow bias removes observed striping on the ground and facades. Shared terrain colour
keeps the approach visually continuous when zones change state.

## Verification

Run:

```sh
node apps/world/validate-reality.mjs
node apps/world/validate-reality-evidence.mjs
node apps/world/qa.mjs
node --test apps/world/tests/*.test.mjs
```

`qa-pond-browser.mjs` additionally exercises real Chrome desktop, 390x844 mobile
emulation and WebGL2 fallback, keyboard/touch input, mount/landing, tour completion,
ACTIVE/NEAR/unload/reload, real mesh buffers and AABBs, and console errors. It captures
gate, Main Hall entrance, library, pond close/overview and return screenshots. Only
hub telemetry calls are intercepted; scene assets, shaders and canonical JSON are real.
`POND_QA_ACCESS_URL` is optional for an authenticated Preview and is never written into
the report. `POND_QA_URL` is the clean deployment URL.

## Accepted remaining TODO: Agora location

OSM way 1099894035 reproduces the existing Agora polygon exactly, but the supplied campus
illustration locates Agora farther south between 6 and 9.
This is a source-identity conflict, not a coordinate sign error. This change does not
guess a replacement polygon or move Agora independently. The existing tour is tested
for functional regressions only; passing it does **not** verify Agora's real location.
The user explicitly authorized merging private PR #68 with this remaining TODO on 2026-09-25.
Agora geography remains unresolved and is excluded from geographic completion claims.
Visual verification must be checked separately after merge.
