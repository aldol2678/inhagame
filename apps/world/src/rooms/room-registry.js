// Indoor spaces and the campus doorways that lead to them.
//
// A room is its own space, identified by a ROOM_* id. It is NOT a campus Place Zone (AREA_*),
// and it has no Realtime channel in Club Room P0: interiors are local-only. A future Room
// Session (S1-D) attaches to this id with its own channel, never world:campus:*.

import { HALL_FRONT } from "../basic-campus.js";
import { CLUB_ROOM_BOUNDS, CLUB_ROOM_EXIT, CLUB_ROOM_OBSTACLES, CLUB_ROOM_SPAWN } from "./club-room-layout.js";
import { DORM_1_ENTRANCE as DORM_1_WORLD_ENTRANCE, DORM_1_CAMPUS_RETURN } from "../dorm1-layout.js";
import { DORM_1_LOBBY, DORM_1_LOBBY_BOUNDS, DORM_1_LOBBY_EXIT, DORM_1_LOBBY_OBSTACLES, DORM_1_LOBBY_SPAWN } from "./dorm1-lobby-layout.js";
import { PERSONAL_ROOM_BASIC, PERSONAL_ROOM_BASIC_BOUNDS, PERSONAL_ROOM_BASIC_EXIT, PERSONAL_ROOM_BASIC_OBSTACLES, PERSONAL_ROOM_BASIC_SPAWN } from "./personal-room-layout.js";
import { MCM_2026_ROUTE } from "../events/zombie-university-2026/event-route.js";
import {
  MCM_2026_ROOM, MCM_2026_ROOM_BOUNDS, MCM_2026_ROOM_EXIT, MCM_2026_ROOM_ID,
  MCM_2026_ROOM_OBSTACLES, MCM_2026_ROOM_SPAWN
} from "../events/zombie-university-2026/minigame-room-layout.js";

export const CAMPUS_SPACE = "campus";

// Point on the main-hall front: u along the facade from its centre, v outward (negative) from it.
const hallFront = (u, v) => {
  const { a, b, along, inward } = HALL_FRONT;
  return { x: (a.x + b.x) / 2 + along.x * u + inward.x * v, z: (a.z + b.z) / 2 + along.z * u + inward.z * v };
};
// Player-entity yaw (degrees) that faces direction (x, z) in the canonical campus frame.
const facing = (x, z) => Math.atan2(x, z) * 180 / Math.PI;

// On the top entrance step in front of the rendered hall doors (hall_entry_glass), just outside
// the centre facade column.
export const CLUB_ROOM_ENTRANCE = Object.freeze({
  id: "CLUB_ROOM_ENTRANCE",
  roomId: "ROOM_CLUBHOUSE_01",
  placeZoneId: "AREA_MAIN_HALL",
  position: Object.freeze(hallFront(0, -0.85)),
  facingYaw: facing(HALL_FRONT.inward.x, HALL_FRONT.inward.z),
  radius: 1.8,
  returnAnchor: "MAIN_HALL_ROOM_EXIT_RETURN"
});

// Flat apron beyond the entrance steps, facing away from the doors: walkable, outside every
// collider and outside the entrance radius, so leaving never bounces straight back in.
export const DORM_1_LOBBY_ENTRANCE = Object.freeze({
  ...DORM_1_WORLD_ENTRANCE,
  roomId: "ROOM_DORM1_LOBBY",
  returnAnchor: DORM_1_CAMPUS_RETURN.id
});

export const MCM_2026_VENUE_ENTRANCE = Object.freeze({
  id: "MCM_2026_VENUE_ENTRANCE",
  roomId: MCM_2026_ROOM_ID,
  position: MCM_2026_ROUTE.venue.position,
  radius: 1.9,
  returnAnchor: "MCM_2026_VENUE_RETURN"
});

export const RETURN_ANCHORS = Object.freeze({
  MAIN_HALL_ROOM_EXIT_RETURN: Object.freeze({
    id: "MAIN_HALL_ROOM_EXIT_RETURN",
    position: Object.freeze({ ...hallFront(0, -3.2), y: 1.15 }),
    yaw: facing(-HALL_FRONT.inward.x, -HALL_FRONT.inward.z)
  }),
  [DORM_1_CAMPUS_RETURN.id]: DORM_1_CAMPUS_RETURN,
  MCM_2026_VENUE_RETURN: Object.freeze({
    id: "MCM_2026_VENUE_RETURN",
    position: Object.freeze({ ...MCM_2026_ROUTE.venue.position, y: 1.15 }),
    yaw: 0
  })
});

export const ROOM_ENTRANCES = Object.freeze([CLUB_ROOM_ENTRANCE, DORM_1_LOBBY_ENTRANCE, MCM_2026_VENUE_ENTRANCE]);

export const ROOMS = Object.freeze({
  ROOM_CLUBHOUSE_01: Object.freeze({
    id: "ROOM_CLUBHOUSE_01",
    label: "동아리방",
    enterLabel: "동아리방 들어가기",
    exitLabel: "본관으로 나가기",
    locationLabel: "🏠 동아리방",
    type: "club",
    spawn: CLUB_ROOM_SPAWN,
    exit: CLUB_ROOM_EXIT,
    obstacles: CLUB_ROOM_OBSTACLES,
    bounds: CLUB_ROOM_BOUNDS,
    entranceId: CLUB_ROOM_ENTRANCE.id
  }),
  ROOM_DORM1_LOBBY: Object.freeze({
    id: "ROOM_DORM1_LOBBY",
    label: "제1생활관 로비",
    enterLabel: "제1생활관 들어가기",
    exitLabel: "캠퍼스로 나가기",
    locationLabel: "🏢 제1생활관 로비",
    type: "housing_lobby",
    spawn: DORM_1_LOBBY_SPAWN,
    exit: DORM_1_LOBBY_EXIT,
    obstacles: DORM_1_LOBBY_OBSTACLES,
    bounds: DORM_1_LOBBY_BOUNDS,
    cameraLimits: DORM_1_LOBBY.camera,
    entranceId: DORM_1_LOBBY_ENTRANCE.id
  }),
  ROOM_PERSONAL_BASIC: Object.freeze({
    id: "ROOM_PERSONAL_BASIC",
    label: "내 방",
    exitLabel: "생활관 로비로 나가기",
    locationLabel: "🏠 제1생활관 · 내 방",
    type: "personal",
    spawn: PERSONAL_ROOM_BASIC_SPAWN,
    exit: PERSONAL_ROOM_BASIC_EXIT,
    obstacles: PERSONAL_ROOM_BASIC_OBSTACLES,
    bounds: PERSONAL_ROOM_BASIC_BOUNDS,
    cameraLimits: PERSONAL_ROOM_BASIC.camera,
    entranceId: null
  }),
  [MCM_2026_ROOM_ID]: Object.freeze({
    id: MCM_2026_ROOM_ID,
    label: "좀비대학교",
    enterLabel: "건물주 · 좀비대학교 입장",
    exitLabel: "건물주 앞 골목으로 나가기",
    locationLabel: "🧟 좀비대학교 · 이벤트 룸",
    type: "event",
    spawn: MCM_2026_ROOM_SPAWN,
    exit: MCM_2026_ROOM_EXIT,
    obstacles: MCM_2026_ROOM_OBSTACLES,
    bounds: MCM_2026_ROOM_BOUNDS,
    cameraLimits: MCM_2026_ROOM.camera,
    entranceId: MCM_2026_VENUE_ENTRANCE.id
  })
});

export const isRoomId = (id) => typeof id === "string" && Object.hasOwn(ROOMS, id);
