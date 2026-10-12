# Jeongseok entrance exterior refinement

This is a historically informed game exterior, not a surveyed reconstruction of the 2026 entrance.

## Evidence and limits

- The owner confirmed the presence of revolving doors, ordinary doors and basement entrances on 2026-10-12.
- The [Korea Tourism Organization entrance close-up](https://tong.visitkorea.or.kr/cms/resource/21/1577421_image2_1.jpg) visibly supports two round revolving-door enclosures, ordinary glazed door areas on both flanks, two square stone piers and grey panelled canopy undersides. The photograph is historical; its exact capture date and the current door-leaf arrangement are not verified.
- All geometry is newly authored. Reference photography, logos and the foreground sculpture are not distributed as game assets.
- Door diameters, leaf arrangement, pier dimensions and locations are GAME_ADAPTATION values fitted to the existing campus frame. The displayed rotors are static and have no physical or access-control behavior.
- The [official 2025-1 opening notice](https://lib.inha.ac.kr/guide/bulletins/notice/650) distinguishes basement doors toward Building 5 and toward the Law School. Their exact exterior coordinates, grades and current operating rules remain unverified. No basement door, hole or route is invented here.

## Preserved authorities

- `basic-campus.js`: canonical footprint, building height, `LIBRARY_FRONT` and every `LIBRARY_ROOF_PARTS` volume.
- `roadview-layout.js` / `library-route-layout.js`: existing landing, stair heights and approach routes.
- `campus-layout.js` / `world-collision.js`: unchanged solid building and approach collision.
- Navigation/minimap: unchanged building marker and ground-level front approach.
- JSL-A reader and JSL-B entrance/return anchors: unchanged; the visible door modules retain clearance around the existing landing positions.
- Production access policy, visitor-pass pricing, room transitions, database and Realtime: no changes.

## Rendering

`library-approaches.js` now draws the pre-existing front/rear landing, steps and parapet/rail surfaces. It uses the same step intervals as `libraryStairHeight`.

`jeongseok-entry-geometry.js` contains the evidence record and replaceable pure geometry modules. BASE keeps the paired revolving casings, ordinary glazing and piers visible. NEAR adds handles and landing details; DETAIL adds narrow stone joints and abstract sign strokes. Static faces share the existing campus material producer and per-material batch ownership.

Only three central lower curtain-wall bays are shortened to avoid layering the old glazing over the new entrances. The established canopy volume is retained, with its underside retiled in grey.

## Acceptance

- Geometry tests verify deterministic finite bounds, two revolving modules, ordinary doors on both flanks, preserved landing/anchor clearance, and rendered stair top/ground-height agreement.
- Existing approach movement and navigation tests remain applicable.
- Hosted QA compares the fixed pre-exterior main tree with the candidate. Changed pixels are confined to independently specified projected entrance/canopy/stair regions; the remaining facade and Main Hall remain protected. It retains real CampusChunkRenderer/PlaceScenePreview consumers, reflected coordinates, lifecycle cleanup and stationary-pixel checks.
- Hardware/mobile GPU performance and contemporary real-world dimensional fidelity are not implied by software-rendered QA.
