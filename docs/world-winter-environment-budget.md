# INHA WORLD Winter Environment Performance Budget

P6K freezes the runtime budget for the winter presentation stack introduced by P6E through P6J.

## Scope

The budget covers:

- P6E accumulated ground snow
- P6F batched player footprints
- P6G roof / bench / lamp snow caps
- P6H roof-edge depth, snowdrifts, and plow traces
- P6I thaw slush and thin ice
- P6J eave meltwater, roadside runoff, and drainage marks

It does **not** include the pre-existing rain renderer itself, sky/clouds, night windows, pond rendering, or street-light pools.

## Runtime budget

| Tier | Concurrent winter draw meshes | Tracked active vertices | Dynamic footprint vertex budget |
| --- | ---: | ---: | ---: |
| LOW | 8 | 6,000 | 108 |
| MEDIUM | 11 | 10,000 | 180 |
| HIGH | 11 | 14,000 | 252 |

Tracked vertices are the active winter presentation geometry exposed by the runtime status surfaces. Disabled prebuilt tier meshes do not count toward the active total.

## Forbidden winter regressions

P6K keeps the winter stack presentation-only. The aggregate winter QA status must report zero for:

- extra real lights
- extra shadow casters
- external textures introduced by P6I/P6J
- network requests introduced by the winter presentation stack

Winter graphics must not modify collision, terrain authority, friction, movement speed, or other gameplay physics.

## LOD rules

LOW deliberately removes or reduces expensive secondary layers:

- no P6G prop snow beyond roofs
- no P6H plow overlay
- no P6I thin-ice batch
- no P6J drain marks
- smaller footprint, snowdrift, slush, runoff, and meltwater budgets

MEDIUM is the reference desktop budget. HIGH increases retained geometry and presentation density without increasing the aggregate draw-call ceiling beyond 11.

## Runtime readback

The browser exposes:

`window.__INHAGAME_WINTER_QA__.status()`

Important fields:

- `withinBudget`
- `violations`
- `drawMeshes` / `budget.drawMeshes`
- `trackedVertices` / `budget.trackedVertices`
- `dynamicFootprintVertices` / `budget.dynamicFootprintVertices`
- `resources`
- per-subsystem `draws` and `vertices`

## Acceptance

CI must fail if the environment browser smoke observes a winter state that exceeds the tier budget or reports a forbidden resource. The browser smoke covers at least:

1. non-winter initial state
2. active SNOW with accumulated snow and winter surface layers
3. SNOW → RAIN thaw with slush and meltwater
4. fresh mobile RAIN with no snow history

Any future winter visual patch that intentionally raises these ceilings must update the budget contract and this document in the same change.
