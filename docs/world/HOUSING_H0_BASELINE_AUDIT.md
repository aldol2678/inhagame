# INHA WORLD Housing H0 · Baseline Audit (2026-09-29)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Canonical design: Notion **Social S1-D 제1생활관 Personal Room v0.1 [CURRENT DESIGN]**, Social S1 v0.3,
Inventory UI v0.1, Economy E0–E5. Implementation canon: this repository's `main`.

## 0. Baseline

| | |
|---|---|
| Private `main` (fetched at start) | `56d3a735b8bdb88bc70827df3a8354aac4cbb9e0` (Merge private #447) |
| Working branch | `ccr-0ce038c5-sr8aiz` — fresh from that SHA (session-designated branch; plays the role of `feat/world-housing-d2-current`) |
| Production DB (read-only check) | `[REDACTED: production database state]` |
| Old PRs | private #198 (base `feat/world-minimap-m0`, 124 ahead / 954 behind), private #201 (1 commit on a 938-behind main), private #211 (2 commits on a 914-behind main). None applied to production. |

## 1. D1 on current main — measured

Measured with the new offline browser smoke `apps/world/tests/browser/housing-smoke.mjs` (real `/campus/`
boot, WebGL2 fallback, supabase-js stubbed, 3 cycles × desktop 1280×720 and phone 360×740), the World
Node suite (1217/1217) and `apps/world/qa.mjs`.

| # | Check | Result |
|---|---|---|
| 1 | Campus → 제1생활관 Entrance (`DORM_1_ENTRANCE`, Context Action `room-door`) | PASS |
| 2 | Entrance → Dorm Lobby (`ROOM_DORM1_LOBBY`, label `🏢 제1생활관 로비`) | PASS |
| 3 | Dorm Lobby → 내 방 (`personal-room-door`, priority 150) | PASS (owner path via `enterNested`; authority RPC offline-stubbed) |
| 4 | Personal Room → Dorm Lobby return anchor (`DORM_1_LOBBY_MY_ROOM_RETURN`, within 0.6 m) | PASS |
| 5 | Dorm Lobby → Campus (`DORM_1_CAMPUS_RETURN`, Place Zone `AREA_DORM_SOUTH`) | PASS |
| 6 | Guest boundary (`로그인하면 내 방을…`, stays in lobby) | PASS |
| 7 | Room UUID reuse | PASS — unit (`personal-room.test.mjs`) + production row count; **no pgTAP contract on main** |
| 8 | Logout / account switch discards room state | PASS in code (`online.onIdentity` → `rooms.exit({force})` + `personalRoom.reset()`), unit-covered |
| 9 | Mini-map / Full Map (interior adapter `room-map-data.js`) | PASS — `ACTIVE` in every interior |
| 10 | HUD / Context Action | PASS; no stuck input lock after 6 cycles |
| 11 | Audio Room binding | PASS for `PERSONAL_ROOM`; Dorm Lobby is silent by Soundscape P0-A design |
| 12 | Campus Presence contamination | PASS — `leaveCampus` pauses campus online; nested lobby⇄room never resumes it; heartbeat splits `housing_lobby` / `personal_room` |
| — | Scene / listener leak (6 enter-exit cycles) | PASS — `app.root` child count constant, stats exact |

No D1 regression was found on current main.

## 2. Classification

### KEEP (reuse as-is)
- `rooms/room-registry.js`, `room-transition.js` (`enter` / `enterNested` / `exit`), `room-world-adapter.js`
- `dorm1-layout.js`, `rooms/dorm1-lobby-*`, `rooms/personal-room-layout.js` shell geometry
- `rooms/personal-room-client.js` (`get_or_create_my_personal_room_v1`, generation guard)
- `world_player_rooms` table + RPC, Housing heartbeat buckets
- `minimap/room-map-data.js`, `audio/audio-zones.js` `PERSONAL_ROOM`
- `network/NetworkManager`, `online/remote-player-view.js`, `online/remote-avatar.js`, `online/pose-source.js`
- Collection/Inventory authority (`private.world_player_items`, `get_my_world_inventory_v1`), Shop `shop.dorm_furniture`

### REPAIR
- `network/supabase-realtime-transport.js`: topic is hard-wired to `world:campus:AREA_*` → add an injectable topic so a room reuses the hardened transport (incl. the re-track leave fix private #201's copy lacks).
- `room-transition.js`: add a direct campus/lobby → friend room entry that still returns to the Dorm Lobby.
- `personal-room-interaction.js`: owner metadata (`ownerUserId`, `visitRole`) for the session layer.
- `main.js` identity handler: must also stop a room session.
- D1 database contract: add pgTAP coverage for `world_player_rooms` / `get_or_create_my_personal_room_v1`.
- Browser smoke: add the housing loop (this audit's script) to CI.

### REPLACE (idea kept, code rewritten for current main)
- private #201 `room-realtime-transport.js` → transport topic option (above).
- private #201 D2 migration → new migration on top of `20261001213132_public_baseline (guest Realtime policies)`: private #201 re-installs the **pre-guest** policies (`world online members …`, `is_permanent_account()`), which would silently turn guest campus Realtime off.
- private #201 `can_access_world_room_realtime_v1` → one private access helper shared by resolve / realtime RLS / 15 s revalidation.
- private #201 `room-session.js` → ported with reconnect revalidation, owner-absent state, equipment, emote routing.
- private #211 furniture catalog / tables → rebuilt on Collection (`furniture.*` items) in H2.

### OBSOLETE (do not port)
- private #198 branch as a whole (old `feat/world-minimap-m0` base).
- private #211 `ROOM_FURNITURE_CATALOG` (10 ids `bed`, `sofa`, …) as placement authority, `world_room_objects.furniture_id` CHECK list, auto-seeding a template layout into the DB.
- private #211 `furniture` ids hard-coded in SQL (`private.world_room_furniture_size_d3a`).
- private #201/#198 test files that assume the pre-Economy grants contract.

## 3. Old PR code still needed

| Source | Needed | Where it goes |
|---|---|---|
| private #201 `friend-room-visit.js` | resolver client, visit controller, error copy | ported, allows lobby as well as campus |
| private #201 `room-session.js` | session lifecycle, 15 s revalidation, identity guard | ported + reconnect / owner-absent |
| private #201 SQL | `resolve_friend_personal_room_v1`, `set_my_personal_room_visibility_v1`, topic check | rewritten |
| private #201 `player-card.js` | `🏠 방 방문` injection | ported; also added to the friend panel |
| private #211 validation math | bounds, exit clearance, overlap, 45° yaw, 0.25 grid, revision/retry idea | H2, keyed by Collection item ids |

## 4. Expected conflict points
- `main.js` (2377 lines; private #201 edits ~70 lines of an older file) — manual port only.
- Realtime RLS installer — must keep guest campus access byte-for-byte.
- `01_grants_contract.test.sql` / `00_schema_contract.test.sql` enumerate public functions.
- `player-card.js` action row (Follow / Accompany / Message rows added since private #201).
- `room-map-data.js` / `personal-room-layout.js` in H2 (static template furniture vs. saved layout).
- Migration order: new versions must sort after the version floor at the time (`20260929231000`, private lineage).

## 5. Branch plan
1. H0 + H1 on the session branch from `56d3a735` (one PR, draft).
2. H2 (Collection-backed furniture) as a separate change after D2 is live-verified.
3. H3 polish and H4 integrated QA after H2.

No old branch is merged; no production migration, merge or deployment without approval.

