# Photo-informed north landmarks and Agora

Baseline: public main `5b262960c1b5f9a365528952ab351e477a289948`.
Current implementation base: `3b95e37f3dec477ebe7e06456907176bb81a63a2`,
including subsequent Fishing F3, Housing H3 and NPC-label fixes.
The immutable before-image comparison remains `9fa74a0`, which has the same
pre-restoration campus presentation.

## Diagnosis

The public renderer deliberately replaced the two northern facades with one
neutral panel per edge. Agora structure/near builders were empty. The 60th hall's
public_qa style also disabled the old style-gated tower, including upper collision.
That is a verified migration presentation loss. The absent 5th-building clock
core is a photo-confirmed gap; its precise point of historical loss was not proven.

## Bounded change

- 5호관: south arches and pale spandrels, plain east bands, attached clock core
- 60주년: separate high glass slab, gray frame, podium glazing and flowing facade ribbon
- Agora: green rectangle, pale cross-path, existing 1.6-unit support/stairs/guards
  made visible; full-height arches only on courtyard-facing 6/9 edges
- Pinned ground rings, centers, approaches, existing obstacles and static navigation
  remain identical. Two elevated colliders match the new skyline meshes. The 5th
  courtyard remains empty for walking/falling
- BASE retains solid silhouettes. NEAR owns recognizable facades and guards;
  DETAIL adds fine divisions. Existing batch, fade, material and disposal owners
  remain authoritative. Hall/library, student center, Biryong and backgate are unchanged

No source photographs, extracted textures, brands, people, private photo IDs or
private repository files are included. Public reference links and the exact
observed/inferred distinction are in the provenance JSON.

## Accuracy limits

The tall slab and clock core are fitted game-scale approximations, not surveyed
models. The original north-shifted miniature tower was not copied as authoritative.
The tower now follows the mapped long axis with a reversible south setback/span.
The 60th podium's complex roof section remains the existing coarse envelope;
the S-curve is explicitly a facade ribbon, not a measured roof reconstruction.
The clock face is a decorative fixed representation, not a working time display.

5호관 inner/north/west elevations were not verified and do not receive invented
arches. Furniture, landscaping, new stairs/entrances and interior access are out
of scope. The April-2025-context 5th photo and February-2026-published university
aerial were checked, but camera dates are unverified. Agora ground details rely
on a 2021-uploaded venue set; a current-condition guarantee is not supported.

## Verification contract

`north-landmark-restoration.test.mjs` records red-to-green checks for missing
silhouettes, semantic materials, ground/old-collider/nav parity, collision/flight/
landing/camera behavior, selective facades, supported stairs and deterministic data.
Existing north/courtyard/player tests remain applicable. The student obstacle
count test explicitly recognizes only the two added upper IDs and still requires
all 854 prior non-student obstacles.

`north-landmark-null-smoke.mjs` checks actual pinned PlayCanvas vertices, three
create/destroy cycles, streaming re-entry, source material separation and disposal.
It is CPU/ownership evidence, not a screenshot or visual pass. Graphical QA must
run in the approved hosted browser flow; local socket restrictions are respected.

Publication, Draft PR, hosted execution, merge and Production release require their
own approval. Local source/tests alone do not establish visual acceptance.
