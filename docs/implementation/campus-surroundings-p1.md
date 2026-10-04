# Campus surroundings P1: local repair candidate and planting proposals

## Scope

Initial base: public main `9fa74a0b69c85e3a4ba57ceba38fb0d28019706b`
(Fishing F3 #189); refreshed without conflicts onto
`3b95e37f3dec477ebe7e06456907176bb81a63a2` (including #195) before final verification.
The user approved local repair of the pond render/seat mismatch and the two
Main Hall approach gaps. Heidegger Forest and the central lawn remain proposals.
Draft publication and hosted validation were subsequently approved.
Merge and Production deployment remain separate approvals.

## Photo evidence and limitations

All cited visual observations below were checked against actual image pixels.
Public photographs are reference links only; no image is copied into app assets.

| Source | Date supported | Relevant observation | Limit |
| --- | --- | --- | --- |
| User-supplied field reference, PHOTO03/04 and PHOTO13 | Labeled 2026-10-01; no independent EXIF verification | Open central lawn, separated pruned trees/shrubs; stone pond edge, large willow and gazebo | Trees obscure the lower Main Hall approach boundaries; no complete furniture inventory |
| [University-provided aerial in Financial News](https://www.fnnews.com/news/202602230937515499), [image](https://image.fnnews.com/resource/media/image/2026/02/23/202602230942533090_e.jpg) | Published 2026-02-23; capture date unspecified | Two central pool-side axes, narrow approaches at the Hall, broad lawns, separated planting groups | Publication is not evidence of a 2026 survey or unchanged current measurements |
| [University-provided aerial in Kyunghyang](https://www.khan.co.kr/article/202512282201001), [image](https://img.khan.co.kr/news/2025/12/28/news-p.v1.20251228.5644d0445c60402ea81c2256ebff0cef_P1.jpg) | Published 2025-12-28; capture date unspecified | Both avenues continue around the central planted island to the Hall's transverse lane | No reliable stair count, grade or paving dimensions |
| [Gyeonggi Ilbo pond visit](https://www.kyeonggi.com/article/20250522580363), [image](https://ypzxxdrj8709.edge.naverncp.com/data2/content/image/2025/05/22/.cache/512/20250522580364.jpg) | Caption identifies the 2025-05-22 visit; published that day | Irregular gray shore stone, hanging willow, straight backed bench across the water | Not evidence for 32 seats or regular ring seating |
| [Michuhol-gu rainy campus visit](https://m.blog.naver.com/tong_namgu/223838593624) | Published 2025-04-18; described as April, exact capture day unstated | Rock edge with planted pockets, mature trunks and straight wooden seating | Partial views, no complete layout |
| [University gallery: spring in Heidegger Forest](https://www.inha.ac.kr/bbs/kr/64/37176/artclView.do), [credited image mirror](https://media.tel-co.net/isr/uploads/download_c1ef0d0567.do?w=720) | Published 2024-04-12; filename suggests April 4, not EXIF-confirmed | Straight brick path, gray edging, bare soil under mature trunks, discrete benches beside the path | Strong local surface evidence; not a full path graph |
| [Michuhol-gu campus introduction](https://m.blog.naver.com/tong_namgu/223433854717), [forest interior](https://cdn.welfarehello.com/naver-blog/production/tong_namgu/2024-05/223433854717/tong_namgu_223433854717_8.jpg?f=webp&q=80&w=800) | Published 2024-05-02; exact capture day unstated | Brick walk, soil, mixed high canopy and scattered wooden seating | Curved stone seats belong to a separate entrance view, not the entire forest |

A newer [official April 2026 essay](https://eng.inha.ac.kr/bbs/kr/64/43763/artclView.do)
was located, but its pond image could not be visually verified: the image viewer
reported an inline size limit, and one normal-sandbox direct fetch returned HTTP
502. It is not used to infer geometry. The 2026 field reference remains the most
recent inspected ground-level pond/lawn evidence.

## Implemented: pond presentation parity

- New independent persistent BASE owner, outside the student model's early-return
  branch. All 32 existing seat anchors receive matching tops at the unchanged
  `POND_TREE_SEATING` dimensions. The 4 x 8 ring arrangement is existing game
  interaction design, explicitly not a reconstruction of photographed furniture.
- Four existing seat-tree positions and seven existing `pondBankTrees()` positions
  receive coarse silhouettes. The already-tagged hero willow gets hanging lobes;
  no new position authority is introduced.
- A narrow irregular stone ground cap follows the outside of the canonical pond
  polygon. Each tile rejects water overlap, including crossing edges and contained
  water vertices. The cap stays in the flat render-offset band (y <= .030).
- This is not a surveyed retaining wall. Existing ground heights and the water
  plane are unchanged; tall bank walls or bank elevation need a separate design.
- No new colliders, lights, textures, network calls or per-frame geometry. Seat
  and tree surfaces are visual-only, consistent with the pre-existing ordinary
  tree/seat interaction contract. Fishing bank clearance is tested.
- Pond plus Hall approaches add six static color meshes and 1,910 triangles
  (137,520 position/normal bytes plus 11,460 16-bit index bytes). These are
  resource counts, not a measured mobile GPU or frame-time result.

## Implemented: two Main Hall approach strips

- A small shared layout reads the ends of `site_481241657` and `site_258995842`
  and projects them onto the existing transverse `site_481241692` line. It owns no
  copied geographic coordinates. Width is inherited from the source avenue's
  existing presentation estimate (3.5 WU), not measured from the photographs.
- The two narrow gray strips leave the planted island, lawns, reflecting pool,
  building footprints and all road source vertices unchanged.
- Rendering, the common Mini-map/Full Map geometry adapter, and navigation consume
  that layout. The old implicit connectors become explicit PATH records. The
  graph retains 185 nodes / 209 edges; virtual connectors reduce from 11 to 9.
  Independent comparison found no added or lost geometric graph edge pairs.
- Only the three connected path IDs adopt the existing flat-ground render band;
  their older raised display boxes are replaced by planar faces. Widths and source
  centerlines remain identical. Gate clipping remains authoritative.
- Vetoing both links was rejected: it would force the Main Hall route west around
  the library and fail the promenade acceptance. Broad forecourt paving was also
  rejected because evidence supports two narrow approaches.
- Hosted review found a view-dependent overlap at the receiving lane: the new
  approach reached its centerline and relied on a .001 WU depth separation.
  Rendering now ends at the existing lane's outer shoulder edge, and both donor
  corners meet the incoming avenue's exact terminal plane. No positive-area
  overlap, arbitrary overlap pad, or skew-end gap remains in the geometric
  contract. Navigation and map endpoints still continue to the lane center.
- Real-world stair count and grade remain unimplemented. No new step, ramp,
  collider or grounding function is inferred from an aerial photograph.

## Proposed only: Heidegger Forest

Keep the existing road-side brick promenade. Concentrate on a small internal
forest slice beside the 6/9 Hall road, using current safe grove positions:

1. Separate shaded compacted-soil ground from the surrounding lawn. Clip any
   candidate soil patches to verified grove coverage and existing road/entry
   clearances; do not blanket-resurface the entire area.
2. Preserve an open straight brick walking strip, with a narrow gray edge. Do
   not invent additional junctions from one photographed view. The exact strip
   endpoints need a site/aerial alignment review before implementation.
3. Use discrete path-adjacent wooden seating pockets, not a continuous bench ring.
   Counts, placements and any new sit/collision semantics require a reviewed plan.
4. Replace uniform small crowns with a mix of tall broadleaf and pine-like
   silhouettes while retaining clear views along the path. Do not increase tree
   density merely to fill space. The curved stone seats seen at the entrance
   must stay an entrance-specific feature.

## Proposed only: central lawn

Keep the large open grass compartments and the two primary axes from the gate
and Jeongseok viewpoint. The supplied field photos support three visual layers:
low shrub/pruned-tree groups, isolated mature canopy trees, and open grass.

- First pilot: vary silhouette/height within one existing lawn compartment,
  keeping current source boundaries and route clearance unchanged. Generated
  positions remain presentation estimates, not individually surveyed plantings.
- Reserve the dominant sightlines to Main Hall and the central pool; avoid a
  dense uniform grid and additional paving.
- Only a small selected set of key crowns should have a persistent far silhouette;
  ordinary foliage remains streamed. Coordinate this with #181 contact shading,
  without changing its material/fade/receiver ownership.
- Photograph-matched before/after views from Jeongseok and the gate, at desktop
  and mobile widths, are needed before selecting a planting layout.

No forest or central-lawn runtime geometry is changed in this candidate.

## Verification and remaining gate

- Added unit regressions for all 32 seat tops, water exclusion, fishing clearance,
  geometry budgets, exact approach endpoints, map parity and nav semantics.
- Actual PlayCanvas 2.22.4 null-device QA checks all seats, endpoint/midpoint ground
  contacts, reflected root transforms, distance transitions and three disposal
  cycles. Null-device QA is not pixel evidence.
- A shared actual-PlayerController helper runs 38 cases: four approach traversals,
  two fishing-bank traversals and sit/stand/walk-out at all 32 pond anchors.
- Existing read-only campus visual-parity browser QA is extended with the new
  checks, on/off/stable full-area views and seat/willow/approach closeups at three
  viewports. No new workflow job, credentials or external state writes are added.
- The initial historical literal-baseline pass replaced all four changed
  pre-existing runtime files with exact `3b95e37` bytes and a strict seven-file
  runtime scope guard. The final integration baseline is recorded below.
  It records source hashes, verified camera transforms and stable baseline/candidate
  images of the pond, seating, willow and both Hall approaches. On/off diagnostics
  are labeled separately and are not presented as the prior main runtime.
- Local browser execution is restricted. Authorized hosted run `37227310028`
  at `d816f73` produced 30 literal-baseline comparison PNGs. Independent visual
  review accepted pond presentation but identified the approach overlap above.
  The seam repair requires a fresh exact-head hosted visual review; stationary
  pixel equality alone is not evidence that depth overlaps are absent.
- At `d816f73`, all seven hosted workflows passed, including World 2,683 tests
  and isolated database 67 files / 3,430 tests. These counts apply to that head,
  not automatically to the subsequent seam repair. No local browser workaround
  is attempted.

Protected authorities: the canonical pond/water polygon, terrain/grounding,
student model #173, Fishing #182/#189 sources and server geometry, seat IDs and
heights, existing collision and controller code all remain unchanged.

Rollback: remove the two BASE builder calls and their shared approach consumers
from navigation/maps, then restore the three paths' prior display-height branch.
No persistent player state or database changes exist.

## Approved final integration with the restored landmarks

The final integration starts from main `0f875b88cc39a7432253e4cd52b2b489d37a3df2`
(#196 plus the night-sky and preview-policy changes). Candidate runtime geometry
is unchanged from `2f01efe`. The literal surroundings browser baseline is now
that newer main, so restored buildings are identical on both sides.

The earlier landmark test's full navigation hash intentionally changes because
two existing CONNECTOR records are promoted to PATH metadata. A separate pinned
regression proves the 185-node / 209-edge geometric set, original road/path
vertices and widths, and all 864 ground obstacles match that exact main. Existing
facility, collider, upper-tower, stair and approach tests remain enforced.
