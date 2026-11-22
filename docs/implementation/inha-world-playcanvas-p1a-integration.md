# PlayCanvas × P1A 분리 통합 (후보, QA 전용)

Status: DRAFT / NOT MERGED. Source PlayCanvas main `0b72d2593ecd3e9bb6293724771cdfb978e74ccf`. Independent Three.js P1A: `aldol2678/inhaworld` PR #10 HEAD `ec9b07b8ac17d94f2b196aab09c23643c467d387`.

## Why
The legacy PlayCanvas world already contains a developed Agora courtyard `fac_agora_courtyard`, Inkyung pond shoreline, trees, seats, pond interaction, fishing, nav graph, quests and Supabase-based online client. P1A in the newer, smaller Three.js client uses GIS `lmk_agora_plaza` (a different polygon, reported ~78 WU from the existing court). Combining both as one structure would introduce duplicate or misplaced Agora assets.

## What this candidate integrates
- Source-backed OSM 481241663 v3 and footway 1063267429 v2 from P1A, with unmeasured widths remaining null. Existing world projection, pond polygon, terrain, collisions and legacy Agora are not replaced.
- QA-only `?p1a_east=1` mode on `*.inha-world-playcanvas-qa.pages.dev` adds corresponding east lakeside road surfaces (water-clipped) and navigation centre lines. Off by default, including on other hostnames.
- No new room/quest/collection/seat authority, DB schema, credentials or authenticated calls. Existing pond/Agora remain independently owned.

## Required validation before adoption
1. Run `node --test apps/world/tests/pond-east-access-p1a.test.mjs` and existing pond, navigation and terrain tests.
2. On Cloudflare QA, compare `/campus/` vs `/campus/?p1a_east=1` at the same camera and test main gate → east pond walkway round trip, water boundary, collisions and real mobile input. Do **not** infer Android hardware PASS from Chromium emulation.
3. Inspect the exact existing Agora `fac_agora_courtyard` and source `lmk_agora_plaza` relationship with owner field survey. Do not move/delete legacy interactive Agora automatically.
4. Verify draw calls, overdraw and shoreline seams; compare with the Three.js PR #10 QA documentation.

## Online migration hold
The PlayCanvas client still uses Supabase member/anonymous sessions, server quest/collection/social RPCs and Vercel API routes. The new `inhaworld` service uses Cloudflare Tier 1–4 with different authentication ownership. Live member data, Firebase/Neon or legacy Supabase must **not** be silently attached to this QA deployment. Use guest/offline mode until a separate, approved isolated QA auth/DB mapping and readback exist.

No `main` merge, no DNS change and no production cutover authorized by this draft. Source images or unapproved GLBs are not copied.
