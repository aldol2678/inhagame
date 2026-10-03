# World Editor · Main Gate Migration P6

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

The main-gate/Sosung-ro authoring source is now `apps/world/data/editor/main-gate.world.json`.

## Ownership

Editor-authoritative:
- Sosung-ro frontage road
- main-gate approach road
- west/east/north/south sidewalk paths
- main-gate pedestrian exit
- two Sosung-ro crossings
- inner-gate zebra position, span and width
- Dormitory 1 entry connector through the housing entrance anchor
- traffic-island base and green inset as editable `world.structure` box primitives
- guardhouse main body, including its production collision footprint
- west/east gate-wall bodies, caps and production collision footprints
- west/east curved curb-return centerlines as editable `world.path` entities
- guardhouse fascia, glazing, window frames, roof trim and brick-plinth detail boxes

Still owned by code/layout outside this document:
- paint styling details such as zebra stripe spacing and colours

## Workflow

1. Open `/editor/`.
2. Choose **Open Main Gate**.
3. Select a path. Move/rotate the entity, or edit **Path Geometry · production** width and point coordinates.
4. Use Runtime Preview for the same WorldDocument.
5. Export `world.json`.
6. Replace `apps/world/data/editor/main-gate.world.json` through the normal reviewed Git workflow.

Production reads the committed WorldDocument through `src/editor/main-gate-production.js`, so the JSON is the source of truth rather than duplicated road coordinates in `main-gate-road-layout.js`.

The Dormitory 1 connector keeps the former runtime anchors exactly: `GATE_FRAME.at(39,-20)` → `DORM_1_FRAME.at(0,7)` → `DORM_1_FRAME.at(0,.65)`, but those points are now stored in gate-local metres in the WorldDocument and can be edited in the Path Geometry inspector.

## Structure P0

WorldDocument now has a first-class `world.structure` component for editable box primitives. The Editor exposes a **Structure** placement tool plus Size X/Y/Z and colour fields in the Inspector. Runtime Preview renders the same component through the shared Runtime Adapter.

The first production migration is the main-gate traffic island. Its former hard-coded dimensions and placement are preserved exactly, but production now reads the two structure entities from `main-gate.world.json`. This establishes the structure-authoring path before migrating the more coupled guardhouse, curved curbs and gate walls.

## Guardhouse P1

The guardhouse main body is now a `world.structure` entity. Its visual box and `ROADVIEW_OBSTACLES` footprint are both derived from the same Editor-authored transform and size. The former collision ceiling of 2.5 WU is preserved through `metadata.production.collisionHeightMeters`, so moving/resizing the body in the canonical WorldDocument cannot silently leave the blocker behind.

Decorative fascia, glazing and sign details remain code-owned for now. They are intentionally separated from the authoritative body/collision migration so the first collision-coupled structure slice stays small and reversible.

## Gate walls P2

Both low side walls and their dark caps are now `world.structure` entities in the Main Gate canonical. The body footprint is also the authoritative collision polygon, preserving the previous 1.6 WU collision ceiling. The old `GATE_WALLS` literal has been removed from `basic-campus.js`, so wall placement/size no longer has a second code-owned source.

Stone-course lines, planting and lettering remain presentation detail for now; the wall solids, caps and blockers are the editor-owned structural authority.

## Curved curbs P3

The west/east curb-return centerlines are now `world.path` entities in the Main Gate canonical. Their four control points and 0.4 m authored width are editable in the normal Path Geometry inspector. Production tubes use those editor-derived centerlines, so reshaping the curb no longer requires editing the roadview renderer.

The narrow yellow accent remains presentation styling derived from the same centerline, which keeps the geometry authority in the Editor while avoiding a second editable path that could drift out of sync.

## Guardhouse details P4

The remaining box-based guardhouse dressing is now editor-authoritative: roof fascia, front glazing, side panel, secondary fascia/roof trim, four vertical window bars, the horizontal window bar and three brick-plinth strips. Production still renders these as lightweight boxes, but every transform, size and colour now comes from `main-gate.world.json`.

This removes the last guardhouse geometry literals from the two gate renderers. Sign lettering and non-box decorative systems remain separate presentation concerns.
