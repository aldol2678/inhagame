# Main gate roadwork — supplied photo references

## Evidence and scope

Five Naver roadview/satellite screenshots were supplied by the user on 2026-10-02.
The outside roadview screenshot displays April 2026. Other capture dates are
not verified. Screenshots are retained separately as user reference material,
not shipped as runtime textures. All widths remain visual estimates, not survey data.

| Reference | Observed feature | Implemented change |
| --- | --- | --- |
| 01-1000012773.png | Open gate mouth, gray paving, low paved traffic island | Gray sidewalk and island surface palette |
| 02-1000012772.png | Broad zebra and curved curb returns | Existing zebra preserved; asphalt now reaches the existing curb inside edges |
| 03-1000012771.png | Red transverse surface inside the gate | Editor-authored flush red promenade |
| 04-1000012770.png | Entrance widens toward the central garden | Forecourt derived from curb geometry, shared by rendering and both maps |
| 05-1000012769.png | Continuous red band across the inner forecourt | Continuous pedestrian path; directional arrows moved before it |

## Geometry ownership

`data/editor/main-gate.world.json` remains the authority for paths and structures.
The new forecourt derives its boundary from the approach and paired curb returns;
it does not add an independent set of map coordinates. Procedural trees exclude
the complete apron plus their shoulder clearance. The promenade is a normal
editor path consumed by existing corridor, map and clearance adapters.

The island's historical `gate_traffic_island_green` identifier is retained for
compatibility, but its displayed name and material now describe gray paving.
Its footprint and low height remain unchanged. Booth, walls, dormitory connector,
external-road lanes and zebra crossing anchors retain their existing positions.
Planters, flexible bollards and transient vehicles are not reconstructed in this pass.

## Verification and integration

Based on the terrain fix in PR #478 at `9c201ed848618b7c1c93c677794819a3e4ac0c7e`,
which itself depends on camera fix PR #477. This change must retain that stack;
it is not an independent patch for current main.

Run `node --test apps/world/tests/main-gate-*.test.mjs`.
Coverage includes editor schema, render/map outline agreement, pavement height,
curb contact, procedural-tree clearance, both-direction promenade traversal,
the dormitory route and camera collision regressions.

Native GPU appearance and mobile interaction still require review on the
deployed preview. Geometry tests do not establish photographic visual fidelity.
