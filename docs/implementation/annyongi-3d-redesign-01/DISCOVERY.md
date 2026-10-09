# ANNYONGI-3D-REDESIGN-01 — discovery (2026-10-07)

Baseline main queried with `git ls-remote`: `c6916d17e4d57ec05ab08af26ce0633e8c2824d5`.
Branch: `feat/annyongi-3d-redesign-01`. No merge or external submission authorized.

## Design authority and inspected references

Primary: Inha University, Public Relations Team, mascot page:
https://www.inha.ac.kr/kr/4219/subview.do
The page supplies basic/front/right/back/left views (`annyong01.png` to `annyong05.png`), PDF/AI manuals and CMYK colors. Text retrieved via Tavily. HTTPS image fetch returned 502, but the public HTTP image URLs succeeded. All five official views were subsequently downloaded and visually inspected. They are the primary silhouette/face/tail reference.

Visually inspected official-goods source family: https://inhastore.imweb.me/23
- `?idx=13`: varsity plush, image `d3c9c6707cb7b.jpg`.
- `?idx=15`: face memo, image `25228e18a9763.jpg`.
- Varsity acrylic: `8ddeab630f103.jpg` (2D full body).
- `?idx=24`: folder, `af00aa36c1785.png` (3D full body).
- `?idx=7`: blanket, `cd254830f9a38.png` (expressions).
Image base: `https://cdn-optimized.imweb.me/upload/S2025111422d8d03174f3a/`.
Source photographs/artwork are not redistributed or embedded as textures.

| Feature | Observation / reconstruction decision |
|---|---|
| Body | Very light sky blue. Official front PNG opaque pixels: #D3EDFB; use the actual published RGB artwork, preserving CMYK C20 M0 Y0 K0 as source metadata. |
| Proportion | Large rounded, slightly pear-shaped head; compact upright body and short legs. No long muzzle. |
| Horns | Two short forked antler-like horns, softly rounded. Cream in 2D/3D artwork, more yellow in plush. Prefer official C0 M0 Y15 K0 (official PNG #FFFDE4). |
| Ears | Small blue leaf shapes below horns. |
| Eyes | Two small black dots; no large fantasy eyes. |
| Cheeks | Circular pink patches, official C0 M35 Y10 K0 (official PNG #F6BEC8). |
| Nose/mouth | Small m-shaped nose line; two-lobed smile with two small ivory fangs. Open-mouth expression also exists; use the official open-mouth basic/front expression; mouth #BF6280. |
| Forelock | Raised curl/spiral centered on forehead, distinctive top tuft. |
| Arms/legs | Short rounded blue limbs, rounded hands/feet, no long claws. |
| Tail | Long curved blue tail with a pale lobed/cloud tip. Plush tip looks star-like; prefer lobed 2D silhouette. |
| Wings | SMALL white/cream cloud-shaped shoulder wings are present in official 2D/3D goods and explicitly called 구름날개 by the university. Preserve these identity details as fixed decorative geometry; no enlarged flight wings, no flapping. |
| Clothing | Goods vary (varsity jacket/hoodie). Omit product-specific clothing/logos for base character. |
| Unseen surfaces | Official rear/side views confirm a large curled tail across the back, small cloud wings and pale lobed tail tip. Exact depth is a 3D reconstruction judgment. |

The user supplied a technical commercialization team permission summary for noncommercial 2D/3D recreation preserving identity. This is user-reported permission, not independently inspected correspondence, trademark ownership verification, or approval of this new design. The university page's general permission notice is not replaced. University design review remains pending; no claim of official game operation/sponsorship.

## Current contracts and impact

Existing GLB: generator `INHAGAME independent QA cuboids v1`, root `Public_QA_Carrier`, 12 cuboid meshes, 144 triangles, one teal material, empty `DragonWing_L/R`. No mascot features.
`character-model.js` loads both characters independently, uses legacy wing pivots, shares local/remote visuals and hides visuals in first person/occlusion. Preserve lifecycle and wire mount ids. Use a new invisible rider anchor, bounded hover/lean; decorative wings do not animate.

Production routes BOTH source and optimized Annyongi to Supabase through `api/brand-asset.js`, bypassing repo bytes. A bounded Annyongi-only static ownership change is required for this newly authored asset; other brand assets keep their current upstreams. Add strict build-time optimization for the source-controlled model. Supabase optimized function remains compatible with the legacy upstream but is no longer runtime authority for this asset. No remote function deployment.

Optimizer uses dedup/prune, retains empty character pivots; validator and provenance tests currently require QA cuboids and must be updated honestly for Annyongi only. Generated output remains derived, ignored by git. No architecture, reward, entitlement or network protocol change.
