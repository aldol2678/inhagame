# Jeongseok recovered exterior candidate

Status: local opt-in candidate; no production binding, publication, or WorldForge promotion.

## Reuse and scope

This mount reuses the public photo-informed Jeongseok renderer from
`316c8ff95f7a12618ec8db61342d153f3cbb29ea` (PR #108). It does not replace the
building with a new approximate box or claim a new detailed reconstruction.

Preserved features are the canonical footprint and 17 WU body height, seven
teal front bays, the curtain-wall grid, upper pavilion, bounded curved roof,
and warm gridded entry-canopy underside. The roof maximum remains 19.5 WU.
Photo-derived appearance remains qualitative rather than measured.

The historical library west facade and entrance approaches were located, but
their observation-derived shapes are outside the current public source boundary
documented in `NOTICE.md`. They are not copied, converted, or reconstructed here.
The owner's available front/canopy photographs do not establish the west elevation.
Owner-supplied west-side photographs or separately cleared source material are
needed before restoring its observed pattern. Approach stairs, rails and paving
also require a separate terrain/collision decision. Interiors are not inferred.

No original photograph, PDF, texture, private source reference, private identifier,
Naver panorama reference, logo, person or number plate is included in this change.

## Mount contract

`buildJeongseokCandidate(root, tier = 'BASE')` returns a caller-owned group for
`bldg_jungseok`. Allowed tiers are `BASE`, `NEAR`, and `DETAIL`; an invalid tier
throws before creating an entity. The recovered source currently has no NEAR
mesh, which is intentionally preserved.

- Use this mount OR the existing building renderer, never both for the same tier
- A repeat call with the same root/tier returns the same group
- Destroy the group to unload; the next call recreates it
- The returned group is local identity: position zero, identity rotation, scale one
- Vertices already use canonical campus WU. Do not convert units or reflect Z again
- Existing batching, shared material ownership and mesh disposal are reused
- Gameplay footprint, collision, height sampling and roof landing stay authoritative

There is no global toggle and no production bootstrap import. The supplied
offline harness opts in explicitly. Its presentation-switch test owns the
old/candidate selection locally; it is not proof of an integrated campus toggle.

## Verification commands

The dependency-free World gate is unchanged:

```sh
bash .github/ci/world-tests.sh
node apps/world/qa.mjs
```

Real-engine tests use the existing browser QA dependency installation. They are
deliberately outside the World `*.test.mjs` glob so clean public CI does not
require an uninstalled PlayCanvas package:

```sh
(cd apps/world/tests/browser && npm ci --ignore-scripts --no-audit --no-fund)
node --test apps/world/tests/browser/jeongseok-candidate-null-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 WORLD_SMOKE_BROWSER=chrome \
  node apps/world/tests/browser/jeongseok-candidate-smoke.mjs
```

The engine tests compare mesh positions, normals, indices, transforms and shared
material identities against the existing renderer, and check repeat activation,
destroy/recreate, invalid tiers, canonical bounds and positive/negative-Z parents.
NullGraphicsDevice proves these contracts only; it produces no rendered pixels.

Final local checks on 2026-10-04: World 1,867/1,867, separate engine 8/8,
`qa.mjs` PASS, and `scripts/public-ci.sh` exit 0. The aggregate run uses a
writable temporary npm cache. The migration linter explicitly skipped its
history-based append-only comparison because this pinned checkout has no usable
base history; no database tests, database mutation, or deployment were performed.

Measured engine counts for this unchanged recovered exterior:

| Tier | Meshes | Vertices | Materials |
| --- | ---: | ---: | ---: |
| BASE | 7 | 1,154 | 6 |
| NEAR | 0 | 0 | 0 |
| DETAIL | 2 | 7,554 | 2 |

The actual-pixel smoke covers three viewport sizes, both coordinate modes and a
canopy close-up. In this local executor it was blocked before page startup:
the pinned browser binary was absent and installed Chromium could not create
its process-singleton socket. No new screenshot or browser pass is claimed.
Previous #108 screenshots remain evidence for #108, not a new candidate run.

## Remaining boundary

This candidate recovers the already available front/roof/canopy presentation.
It is not a complete restoration of every historical library detail. The west
elevation, entrance approaches, actual combined campus binding and new rendered
pixel verification remain outside this completed local adapter work.
