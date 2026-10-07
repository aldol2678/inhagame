# PERSONAL-ROOM-V2 · Visual Quality & Living Room Plan

> Status: **DESIGN / IMPLEMENTATION PLAN**
>
> Rebased design baseline: `main@a72b650ad21d84bc6682f32d3e924ff8ee1907ef` (2026-10-08). Implementation must still re-check latest `main` immediately before code work.
>
> Scope: upgrade the existing 제1생활관 personal room from a functional primitive scene into a player-customizable showcase interior, using the selected **C · Creative / Open Creator** layout direction without changing Housing authority, room identity, furniture persistence, or existing return/guest/privacy contracts.

## 0. Goal

The target is not “photorealism at any cost.” The target is the visual density of a polished browser room demo:

- believable bed / desk / wardrobe / shelving / lighting / window treatment,
- coherent PBR-ish material response instead of flat colored primitives,
- stronger contact and object grounding,
- day/evening/night response inside the room,
- interactive lighting and curtains,
- a real mirror effect on higher quality tiers,
- the existing Collection-backed furniture editor continuing to work unchanged.

The personal room is intentionally a **showcase interior with a large editable center**. The campus remains optimized for breadth; the room can spend a larger visual budget because the scene is small and bounded.

## 0.1 Selected layout direction · C / Creative Open Creator

Decision date: **2026-10-07**

Among the A / B / C layout studies, **C · Creative / Open Creator is the selected base layout direction**.

Principles:

- maximize the central Living / Customize zone for Collection furniture, seasonal props, photos and trophies;
- keep fixed fixtures close to walls so they do not consume the editable floor;
- preserve an identifiable Ungbijae signature bundle without forcing a four-person-room reconstruction;
- maintain the strong Entrance → free-space → Window sightline;
- use **1.70:1 as the C-layout prototype maximum**, not as a surveyed physical dimension;
- start from a restrained dorm baseline and let visual density grow through player customization.

The Ungbijae signature bundle should preserve at least one coherent group of recognizable cues where practical: loft-style sleeping/study structure, near-vertical ladder, privacy divider, whiteboard, task light, storage and outlet details.

A / Reality and B / Hybrid remain comparison evidence and possible future template/theme candidates. They are not the default V2 implementation target.

## 0.2 Current canonical product decisions

The design work completed after the initial V2 audit is now part of the implementation target:

- **R0 shell direction:** C · Creative / Open Creator, with a prototype aspect-ratio maximum of **1.70:1**.
- **R0 placement budget:** keep the current **32-placement** ceiling until runtime/mobile QA proves a change is needed.
- **Starter furniture wave:** preserve the current 9 Collection-backed furniture IDs and extend toward **F0 = 16 items** with 7 starter candidates:
  - one-seat sofa,
  - low side table,
  - slim bookshelf,
  - medium plant,
  - desk monitor,
  - trophy shelf,
  - Study Books decor set.
- **Recommended layout roles:**
  - **Default** = initial move-in state,
  - **Cozy** = representative R0 recommendation and first visual housing goal,
  - **Study** = preference preset,
  - **Collector** = later play-history/display preset.
- Presets are **non-authoritative editor recipes**, not separate room templates, item grants, or progression power.
- Missing preset items may appear as client-only ghosts; only owned furniture can enter the saved placement snapshot.
- C70 authoring coordinates are design coordinates only. Runtime coordinates must be derived from the final C-shell bounds, snapped to the Housing grid and validated by the existing collision/exit rules.

Canonical product references:

- Personal Room CURRENT DESIGN: https://app.notion.com/p/3e727155213b81569ffbe06b5aa51d48
- Housing Tier System: https://app.notion.com/p/3f227155213b8149a77ee6ae6813811e
- Furniture Catalog & Placement Taxonomy: https://app.notion.com/p/3f227155213b81aca311d2fce276df2a
- Furniture F0 Starter Pack 16: https://app.notion.com/p/3f227155213b81da9a10d020b049fd98
- R0 Layout Presets: https://app.notion.com/p/3f227155213b81b6b509fc884fa6b072



## 1. Current implementation audit

### KEEP

These are already good ownership/authority seams and should stay intact:

- `personal-room-layout.js`
  - room bounds, spawn, exit, fixed fixture collision contract,
  - `PERSONAL_ROOM_BASIC_FURNITURE` placement coordinates.
- `personal-room-client.js`, room UUID authority and D1/D2 access/session contracts.
- H2 furniture persistence:
  - `furniture-layout.js`,
  - `furniture-renderer.js`,
  - room layout revision/save authority.
- `personal-room-fixture-model.js`
  - async visual replacement with primitive fallback,
  - no RPC-controlled model URLs/transforms.
- `personal-room-decor-renderer.js`
  - decorative fixture visibility yields to owned placements,
  - collider list is updated without duplication.
- Mini-map / room-map / audio / room HUD / visit privacy behavior.

### CURRENT VISUAL LIMITS

`personal-room-renderer.js` currently builds most of the room from primitives:

- flat-color floor / walls / ceiling,
- primitive bed, desk, bookshelf, rug and plant,
- chair + three decor props are the main imported-model path,
- window is an emissive thin box, not a real window/view/light source,
- two ceiling panels + two omni lights use `castShadows:false`,
- no curtain state,
- no mirror,
- no room-local quality tier,
- no day/night binding beyond the room's fixed ambient/clear color.

This is enough for function, but it caps perceived quality well below the requested reference.

## 2. Non-negotiable constraints

PERSONAL-ROOM-V2 must **not**:

1. change room UUID semantics or ownership authority;
2. alter D2 privacy / friend visit rules;
3. replace H2 Collection inventory as placement authority;
4. let server/RPC data choose arbitrary asset URLs;
5. change persisted furniture object schema merely for visuals;
6. break the current room collision/exit clear corridor;
7. require a mirror pass on low-end devices;
8. merge or deploy as part of visual implementation without a separate release decision.

Visual geometry may diverge from collision geometry, but the collision contract remains the authoritative gameplay footprint unless a dedicated migration is approved.

## 3. Architecture

Split the current monolithic visual responsibilities into small room-local modules.

### Existing modules retained

- `personal-room-renderer.js` — composition root only.
- `personal-room-layout.js` — gameplay dimensions / fixed fixture anchors.
- `personal-room-fixture-model.js` — safe visual asset loader + fallback.
- `furniture-renderer.js` — owned furniture layer.
- `personal-room-decor-renderer.js` — optional decor layer.

### New modules

- `personal-room-materials.js`
  - room-specific material factory,
  - texture/normal/roughness loading,
  - fallback to existing `surface()`.
- `personal-room-shell-renderer.js`
  - floor, walls, ceiling, trims, door, window frame and curtains.
- `personal-room-fixtures-v2.js`
  - bed, desk, bookshelf, wardrobe/storage, plant and permanent small props.
- `personal-room-lighting.js`
  - ceiling fixtures, desk/floor lamps, quality-tier shadow policy,
  - day/evening/night intensity + color-temperature presets.
- `personal-room-window.js`
  - exterior sky/view card, day/night tint, curtain state.
- `personal-room-mirror.js`
  - high/medium planar-style reflection path,
  - low-tier static/fallback material.
- `personal-room-interactions.js`
  - light toggle, curtain toggle, chair sit / bed rest seams.
  - No persistence in the first visual PR unless separately specified.
- `personal-room-quality.js`
  - HIGH / MEDIUM / LOW capability policy.

The room renderer should become orchestration, not a second asset factory.

## 4. Asset plan

### Reuse first

Keep existing KayKit assets where they read well at room scale:

- chair_A,
- table_medium,
- lamp_standing,
- shelf_B_large_decorated.

They remain fallback or secondary props, not the entire visual identity.

### New room-specific assets

Create or source legal-to-ship room assets under a dedicated path such as:

`apps/world/public/assets/rooms/personal-v2/`

The fixed-room visual pass and the Collection-backed F0 furniture wave are separate layers. The fixed shell must not bake player-owned F0 items into the room.

F0 hero candidates for the Collection layer are the **one-seat sofa, slim bookshelf and trophy shelf**. Small F0 candidates are the **side table, medium plant, monitor and Study Books set**. They require their own C0/ownership/placement integration and must not be silently converted into permanent fixtures.

Minimum V2 fixed-fixture set:

| Asset | Purpose | Requirement |
|---|---|---|
| bed frame + mattress | hero fixture | separated frame / fabric materials |
| pillow + blanket/duvet | soft detail | low-cost rounded geometry, not a box |
| desk | hero fixture | laptop/desk props remain placeable |
| wardrobe / closet | fills empty wall | doors readable at room camera distance |
| bookshelf/storage | replaces primitive block | shelves have actual depth |
| curtain rail + curtains | window interaction | open/closed transforms |
| window frame | believable opening | frame + glass surface |
| ceiling light | practical light source | emissive mesh + runtime light |
| wall switch | interaction cue | small but readable |
| plant | organic silhouette | simple leaves, mobile-safe |
| mirror frame/plane | reflection feature | dedicated render layer |
| small clutter kit | lived-in density | books, cup, tissue box, slippers, cable box |

Target budgets are QA targets, not hard schema:

- HIGH: roughly <= 120k visible room-fixture triangles before avatars,
- MEDIUM: <= 70k,
- LOW: <= 40k or simplified/fallback meshes,
- prefer 1K textures for ordinary props, 2K only for hero surfaces where visible,
- compressed web delivery and material reuse are required.

## 5. Material / lighting direction

### Materials

Replace “one hex = one surface” for hero room surfaces with a small reusable set:

- painted wall: low gloss,
- warm wood: desk / trim / furniture,
- fabric: bedding / curtain,
- tile or laminate floor,
- metal: handles / lamp,
- glass: window / mirror fallback,
- plastic / electronics.

PBR texture maps are optional per asset, but normal + roughness should be supported where they materially improve the close-room view.

### Lighting

Use a layered lighting model:

1. **ambient / environment** for baseline visibility;
2. **window contribution** driven by world time;
3. **ceiling practicals** for room-wide illumination;
4. **local practicals** for desk/floor lamp warmth;
5. **contact/shadow policy** by quality tier.

Recommended behavior:

- DAY: brighter/cooler window, ceiling lights optional,
- EVENING: warmer sky, stronger practical lights,
- NIGHT: dark exterior, practical lights become dominant,
- weather can later modulate exterior brightness without coupling room authority to weather.

Shadow casting must be selective. Hero fixtures may cast/receive on HIGH; MEDIUM limits shadowed lights; LOW uses no dynamic room-light shadows.

## 6. Window and curtain

The current emissive window box is replaced by:

- physical frame,
- glass pane,
- outside-view layer / sky card,
- curtain rail,
- left/right curtain meshes.

First implementation may use a stylized exterior rather than rendering the whole campus again. The objective is believable depth and time-of-day response, not a second full world render.

Curtain interaction:

- `OPEN` / `CLOSED`,
- visual transform only in the first pass,
- window lighting contribution fades with curtain closure,
- later persistence can be added as room preference data if worthwhile.

## 7. Mirror

### Quality policy

- **HIGH**: real offscreen reflection pass with reflected camera transform.
- **MEDIUM**: reduced render-target resolution and reduced update cadence.
- **LOW**: static reflective material / blurred environment approximation; no second scene render.

Implementation requirements:

- mirror mesh itself is excluded from the reflection pass,
- reflection render target is recreated/disposed cleanly with room lifecycle,
- no render-target leak across repeated room enter/exit,
- reflection is disabled automatically if capability/performance policy says so,
- local/remote avatar inclusion is allowed only when the avatar scene/layer is already available safely; do not create a duplicate network representation solely for the mirror.

Initial mirror success criterion is **room geometry + fixtures reflecting correctly**. Avatar reflection can be a follow-up gate.

## 8. Interactions

V2 interaction order:

### V2-A
- ceiling light ON/OFF,
- curtains OPEN/CLOSED.

### V2-B
- chair sit interaction,
- bed rest/lie interaction,
- desk inspect/use seam.

These interactions must not conflict with Housing editor input locks or room exit actions.

## 9. Quality tiers

`personal-room-quality.js` should expose a resolved policy rather than scattering device checks.

Example policy fields:

- `fixtureDetail`
- `dynamicShadowLights`
- `mirrorMode`
- `mirrorResolution`
- `mirrorUpdateHz`
- `materialNormalMaps`
- `smallClutter`

Suggested defaults:

| Tier | Mirror | Shadows | Detail |
|---|---|---|---|
| HIGH | real-time | selective dynamic | full clutter |
| MEDIUM | lower-res / throttled | limited | most props |
| LOW | static/fallback | off | simplified |

Do not classify solely by user agent. Prefer actual renderer/capability information and an explicit override for QA.

## 10. Implementation slices

### PR A — Visual foundation

- split shell / fixture / material modules,
- replace primitive hero fixtures with visual models while preserving old collision boxes,
- upgrade window frame / curtains,
- preserve primitive fallback path,
- no mirror yet.

**Acceptance:** current Housing Node/browser tests remain green; room enter/exit loops leak no entities/assets.

### PR B — Time-aware lighting

- bind room lighting to existing world time/celestial state,
- day/evening/night presets,
- practical light toggle,
- curtain affects perceived window contribution.

**Acceptance:** no change to outdoor weather/celestial authority; room only consumes current state.

### PR C — Mirror

- quality-tier mirror renderer,
- lifecycle cleanup,
- HIGH/MEDIUM/LOW behavior.

**Acceptance:** mirror failure must degrade visually, never block room entry.

### PR D — Living interactions + polish

- sit / rest seams,
- clutter pass,
- final material tuning,
- optional avatar reflection if safe.

## 11. Tests / QA

Required automated checks:

- renderer can build with all V2 assets missing and fall back safely;
- repeated `ensureVisualAssets()` is idempotent;
- enter/exit cycles do not grow `app.root` child count;
- mirror target/camera resources are destroyed on room teardown;
- quality tier LOW never creates reflection render targets;
- owned furniture placements still hide conflicting optional decor correctly;
- H2 collision and save validation are byte-for-byte behavior-compatible unless an explicit separate change says otherwise;
- light/curtain controls do not acquire a stuck input lock;
- desktop / portrait / landscape housing smoke remains green.

Manual hardware QA:

- desktop WebGPU/WebGL2,
- Android phone,
- iPad/Safari,
- HIGH and LOW override,
- night room with lights off/on,
- mirror while moving camera,
- owned furniture editor with dense placements.

## 12. “Done” definition

PERSONAL-ROOM-V2 is not complete merely because imported furniture exists.

The visual milestone is complete when:

1. the room no longer reads as primitive-box placeholder art at first glance;
2. bed, desk, storage, window, curtains and lighting form one coherent visual language;
3. day/night materially changes the room atmosphere;
4. user furniture still edits/saves exactly through H2 authority;
5. HIGH tier has a convincing mirror or an explicitly accepted substitute;
6. mobile tiers remain usable without forcing the reflection cost;
7. repeated room lifecycle QA shows no resource leak/regression.

## 13. Recommended first coding task

Start with **PR A only**.

The first code change should not touch persistence or database migrations. It should:

- extract shell rendering,
- add room-specific material loading,
- install new hero fixture models behind the existing fallback model pattern,
- add curtain/window geometry,
- prototype the C-layout shell up to the approved **1.70:1 maximum** while keeping current collision/persistence contracts intact until the prototype proves a geometry change is safe,
- keep the central editable floor intentionally clear, with **Cozy** as the representative recommendation rather than a baked-in default fixture layout,
- move fixed visual fixtures toward perimeter zones without changing persisted furniture authority.

That produces the largest visible quality jump with the smallest gameplay risk.
