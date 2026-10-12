# Original Blender single-sofa asset

This is an original, project-authored low-poly sofa. It is not a renamed or
converted third-party model. No private-brand model, downloaded geometry,
texture, image reference, or external font was used. It follows the repository's
existing all-rights-reserved `LICENSE`; publication does not grant a new license.

## Runtime asset

- `apps/world/assets/furniture/dorm-single-sofa-v1.glb`
- One mesh, three opaque, single-sided PBR material primitives
- 1,784 triangles and 912 exported vertices
- No textures, external files, animations, skinning, morphs, or compression
- No Draco, Meshopt, or texture-decoder dependency
- Exact validated size, within floating-point tolerance: 1.10 × 0.72 × 0.78 m
- PlayCanvas/glTF coordinates: Y up, front -Z, origin at floor center
- Bounds: X [-0.55, +0.55], Y [0, 0.72], Z [-0.39, +0.39]
- The separate seat cushion still has its top at Y=0.36 m

The lower deck, rounded arms, rear shell, separate seat and back cushions, and
four tapered oak legs form ten closed, outward-facing mesh components. Joining
them into one mesh keeps the export to three draw primitives. Softened corners
and weighted vertex normals provide a more upholstered silhouette than the
existing box primitives without dense subdivision.

The visual asset changes no placement, collision, interaction, seat-anchor,
ownership, persistence, or furniture-definition behavior. The declared layout
bounds remain the authority; the model fits that pre-existing envelope.

## Reproduction

Run from the repository root with Blender 4.3.2:

```sh
blender --background --python-exit-code 1 \
  --python scripts/assets/build-dorm-single-sofa.py
```

To build and validate without the three CPU studio renders:

```sh
blender --background --python-exit-code 1 \
  --python scripts/assets/build-dorm-single-sofa.py -- --skip-renders
```

The editable compressed source is written separately to
`scratch/sofa-asset-source/dorm-single-sofa-v1.blend`. The script is the checked-in
source of truth. Blender and the source `.blend` are not runtime dependencies.
`--output`, `--source-dir`, and `--evidence-dir` can direct independent builds to
other paths. No installation or download is performed by this script.

## Checks and visual evidence

`asset-validation.json` records the final SHA-256, raw byte count, exact bounds,
triangle/vertex/material counts, normal checks, and Blender re-import results.
`asset-sha256.txt` provides the same GLB checksum independently.

The build fails when any of these checks fail:

- GLB container integrity, raw size ≤150,000 bytes, triangles ≤2,000
- At most three materials, exactly three draw primitives, no double-sided materials
- No required extensions, external textures, animation, or skinning
- Bounds and identity node transform matching the expected floor-centered asset
- Unit-length normals and consistent triangle winding at every vertex
- Independent GLB re-import retaining dimensions and coordinate orientation
- Zero degenerate triangles and zero non-manifold edges after positional welding
- Ten individually closed, outward-facing components and seat top at Y=0.36

All three PNGs are actual Blender CPU renders of the exported GLB after it was
re-imported, rather than concept art or a separate high-poly model:

- `blender-front-three-quarter.png`
- `blender-front.png`
- `blender-rear-three-quarter.png`

The studio ground, lights, camera, and background are evidence-only and excluded
from both the GLB and the editable source. Runtime lighting can change the
apparent color relative to these studio images.

On some distro Blender builds the glTF add-on logs an unavailable optional Draco
library on initialization. Compression is explicitly disabled here; the valid
plain GLB does not load or require that library. CPU rendering also explicitly
disables denoising so builds without OpenImageDenoise remain supported.
