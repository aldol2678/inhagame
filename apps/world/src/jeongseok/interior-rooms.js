// JSL-B · Jeongseok interior rooms, campus entrance and safe return anchor.
//
// The exterior stays the existing bldg_jungseok renderer; nothing here builds another facade.
// The entrance and return anchor are derived from LIBRARY_FRONT (canonical footprint edge 6-7) on
// the front landing at LIBRARY_ENTRY_HEIGHT, a game walk height. ROOM_* interiors are separate
// spaces, never AREA_* Place Zones, and own no Realtime channel. Entry is decided by the
// Jeongseok entry policy (entry-policy.js), never by this file.

import { LIBRARY_FRONT } from "../basic-campus.js";
import { LIBRARY_ENTRY_HEIGHT } from "../library-route-layout.js";
import { PLAYER_ORIGIN_Y } from "../player-dimensions.js";
import { GAME_ADAPTATION } from "./interior-evidence.js";
import { JEONGSEOK_LOBBY, JEONGSEOK_LOBBY_LAYOUT, JEONGSEOK_LOBBY_ROOM_ID } from "./lobby-layout.js";
import { JEONGSEOK_B1_READING, JEONGSEOK_B1_READING_LAYOUT, JEONGSEOK_B1_READING_ROOM_ID } from "./b1-reading-layout.js";
import { JEONGSEOK_B1_CREATIVE, JEONGSEOK_B1_CREATIVE_LAYOUT, JEONGSEOK_B1_CREATIVE_ROOM_ID } from "./b1-creative-layout.js";

export { JEONGSEOK_LOBBY_ROOM_ID, JEONGSEOK_B1_READING_ROOM_ID, JEONGSEOK_B1_CREATIVE_ROOM_ID };
export const JEONGSEOK_ROOM_IDS = Object.freeze([JEONGSEOK_LOBBY_ROOM_ID, JEONGSEOK_B1_READING_ROOM_ID, JEONGSEOK_B1_CREATIVE_ROOM_ID]);
export const isJeongseokRoomId = id => JEONGSEOK_ROOM_IDS.includes(id);

const front = (u, v) => LIBRARY_FRONT.at(u, v);
const outward = (() => { const a = front(0, 0), b = front(0, 1); return { x: b.x - a.x, z: b.z - a.z }; })();
const facing = (x, z) => Math.atan2(x, z) * 180 / Math.PI;

// Under the existing entry canopy, between the facade and the JSL-A temporary reader (v 1.0).
export const JEONGSEOK_ENTRANCE = Object.freeze({
  id: "JEONGSEOK_ENTRANCE",
  roomId: JEONGSEOK_LOBBY_ROOM_ID,
  placeZoneId: "AREA_JUNGSEOK_WOONAM",
  buildingId: "bldg_jungseok",
  position: Object.freeze(front(0, 0.45)),
  facingYaw: facing(-outward.x, -outward.z),
  radius: 1.0,
  returnAnchor: "JEONGSEOK_CAMPUS_RETURN",
  access: "jeongseok-policy",
  trace: GAME_ADAPTATION("door slot derived from LIBRARY_FRONT; real 2026 doors/gates UNKNOWN")
});

// On the same landing beside the doors, outside the entrance radius and the JSL-A reader radius,
// facing away from the building, so leaving never bounces straight back in.
export const JEONGSEOK_CAMPUS_RETURN = Object.freeze({
  id: "JEONGSEOK_CAMPUS_RETURN",
  placeZoneId: "AREA_JUNGSEOK_WOONAM",
  position: Object.freeze({ ...front(-2.6, 1.05), y: PLAYER_ORIGIN_Y + LIBRARY_ENTRY_HEIGHT }),
  yaw: facing(outward.x, outward.z),
  trace: GAME_ADAPTATION("safe campus return on the front landing")
});

const room = (id, label, fields) => Object.freeze({ id, label, type: "public_library", access: "jeongseok-policy", ...fields });

export const JEONGSEOK_ROOMS = Object.freeze({
  [JEONGSEOK_LOBBY_ROOM_ID]: room(JEONGSEOK_LOBBY_ROOM_ID, "정석학술정보관 1층 로비", {
    enterLabel: "정석학술정보관 들어가기",
    exitLabel: "캠퍼스로 나가기",
    locationLabel: "📚 정석학술정보관 · 1층 로비",
    spawn: JEONGSEOK_LOBBY_LAYOUT.spawn,
    exit: JEONGSEOK_LOBBY_LAYOUT.exit,
    obstacles: JEONGSEOK_LOBBY_LAYOUT.obstacles,
    bounds: JEONGSEOK_LOBBY_LAYOUT.bounds,
    cameraLimits: JEONGSEOK_LOBBY.camera,
    entranceId: JEONGSEOK_ENTRANCE.id
  }),
  [JEONGSEOK_B1_READING_ROOM_ID]: room(JEONGSEOK_B1_READING_ROOM_ID, "정석 B1 제2열람실", {
    exitLabel: "1층 로비로 이동 (임시 층간 이동)",
    locationLabel: "📚 정석학술정보관 · B1 제2열람실",
    spawn: JEONGSEOK_B1_READING_LAYOUT.spawn,
    exit: JEONGSEOK_B1_READING_LAYOUT.exit,
    obstacles: JEONGSEOK_B1_READING_LAYOUT.obstacles,
    bounds: JEONGSEOK_B1_READING_LAYOUT.bounds,
    cameraLimits: JEONGSEOK_B1_READING.camera,
    entranceId: null
  }),
  [JEONGSEOK_B1_CREATIVE_ROOM_ID]: room(JEONGSEOK_B1_CREATIVE_ROOM_ID, "정석 B1 Creative Space", {
    exitLabel: "1층 로비로 이동 (임시 층간 이동)",
    locationLabel: "📚 정석학술정보관 · B1 Creative Space",
    spawn: JEONGSEOK_B1_CREATIVE_LAYOUT.spawn,
    exit: JEONGSEOK_B1_CREATIVE_LAYOUT.exit,
    obstacles: JEONGSEOK_B1_CREATIVE_LAYOUT.obstacles,
    bounds: JEONGSEOK_B1_CREATIVE_LAYOUT.bounds,
    cameraLimits: JEONGSEOK_B1_CREATIVE.camera,
    entranceId: null
  })
});

export const JEONGSEOK_LAYOUTS = Object.freeze({
  [JEONGSEOK_LOBBY_ROOM_ID]: JEONGSEOK_LOBBY_LAYOUT,
  [JEONGSEOK_B1_READING_ROOM_ID]: JEONGSEOK_B1_READING_LAYOUT,
  [JEONGSEOK_B1_CREATIVE_ROOM_ID]: JEONGSEOK_B1_CREATIVE_LAYOUT
});
