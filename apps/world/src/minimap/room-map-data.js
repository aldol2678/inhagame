// INHA WORLD M2-2 interior map adapter.
// Converts the authoritative room runtime layout into the same read-only map data contract
// used by the campus Mini-map / Full Map. No duplicate room coordinates or persistence.

import { CLUB_ROOM, CLUB_ROOM_EXIT, CLUB_ROOM_FURNITURE } from "../rooms/club-room-layout.js";
import { DORM_1_LOBBY, DORM_1_LOBBY_EXIT, DORM_1_LOBBY_FURNITURE } from "../rooms/dorm1-lobby-layout.js";
import { PERSONAL_ROOM_BASIC, PERSONAL_ROOM_BASIC_EXIT, PERSONAL_ROOM_BASIC_FURNITURE } from "../rooms/personal-room-layout.js";
import { MCM_2026_ROOM, MCM_2026_ROOM_EXIT, MCM_2026_ROOM_FURNITURE, MCM_2026_ROOM_ID } from "../events/zombie-university-2026/minigame-room-layout.js";
import { ROOMS } from "../rooms/room-registry.js";
import { MAP_SURFACE, createMapPoiRegistry } from "./minimap-poi-registry.js";

export const ROOM_MAP_GEOMETRY_KIND = Object.freeze({
  ROOM_FLOOR: "ROOM_FLOOR",
  ROOM_FURNITURE: "ROOM_FURNITURE"
});

const freezePoint = ({ x, z }) => Object.freeze({ x, z });
const freezeRing = points => Object.freeze(points.map(freezePoint));

function rectangleRing(cx, cz, width, depth, yaw = 0) {
  if (![cx, cz, width, depth, yaw].every(Number.isFinite) || width <= 0 || depth <= 0) {
    throw new TypeError("Invalid room map rectangle");
  }
  const halfW = width / 2, halfD = depth / 2;
  const rad = yaw * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  return freezeRing([
    { x: -halfW, z: -halfD },
    { x: halfW, z: -halfD },
    { x: halfW, z: halfD },
    { x: -halfW, z: halfD }
  ].map(point => ({
    x: cx + point.x * cos - point.z * sin,
    z: cz + point.x * sin + point.z * cos
  })));
}

const ROOM_MAP_PROFILES = Object.freeze({
  ROOM_CLUBHOUSE_01: { layout: CLUB_ROOM, exit: CLUB_ROOM_EXIT, furniture: CLUB_ROOM_FURNITURE, source: "CLUB_ROOM" },
  ROOM_DORM1_LOBBY: { layout: DORM_1_LOBBY, exit: DORM_1_LOBBY_EXIT, furniture: DORM_1_LOBBY_FURNITURE, source: "DORM_1_LOBBY" },
  ROOM_PERSONAL_BASIC: { layout: PERSONAL_ROOM_BASIC, exit: PERSONAL_ROOM_BASIC_EXIT, furniture: PERSONAL_ROOM_BASIC_FURNITURE, source: "PERSONAL_ROOM_BASIC" },
  [MCM_2026_ROOM_ID]: { layout: MCM_2026_ROOM, exit: MCM_2026_ROOM_EXIT, furniture: MCM_2026_ROOM_FURNITURE, source: "MCM_2026_EVENT_ROOM" }
});

function buildRoomGeometry(roomId, profile) {
  const { layout, furniture, source } = profile;
  const geometry = [{
    id: `room.${roomId}.floor`,
    kind: ROOM_MAP_GEOMETRY_KIND.ROOM_FLOOR,
    source,
    style: "floor",
    rings: Object.freeze([rectangleRing(0, 0, layout.halfWidth * 2, layout.halfDepth * 2)])
  }];

  for (const item of furniture) {
    if (["rug", "plush"].includes(item.kind)) continue;
    const [x, , z] = item.at;
    geometry.push(Object.freeze({
      id: `room.${roomId}.furniture.${item.id}`,
      kind: ROOM_MAP_GEOMETRY_KIND.ROOM_FURNITURE,
      source: `${source}_FURNITURE`,
      style: item.kind,
      rings: Object.freeze([rectangleRing(x, z, item.size[0], item.size[2], item.yaw ?? 0)])
    }));
  }
  return Object.freeze(geometry.map(Object.freeze));
}

const roomMapCache = new Map();
const roomPoi = exit => Object.freeze([
  Object.freeze({
    poiId: "room.exit",
    title: "나가기",
    kind: "EXIT",
    sourceRef: Object.freeze({ type: "ROOM_EXIT", id: exit.id }),
    iconKey: "exit",
    priority: 100,
    labelMode: "FULL_MAP",
    surfaces: Object.freeze([MAP_SURFACE.MINIMAP, MAP_SURFACE.FULL_MAP])
  })
]);

export function createRoomMapDataSource(roomId) {
  const profile = ROOM_MAP_PROFILES[roomId];
  if (!profile || !ROOMS[roomId]) return null;
  if (roomMapCache.has(roomId)) return roomMapCache.get(roomId);
  const { layout, exit } = profile;
  const geometry = buildRoomGeometry(roomId, profile);
  const bounds = Object.freeze({
    minX: -layout.halfWidth, maxX: layout.halfWidth,
    minZ: -layout.halfDepth, maxZ: layout.halfDepth
  });

  const registry = createMapPoiRegistry({
    definitions: roomPoi(exit),
    resolvePosition: sourceRef => {
      if (sourceRef?.type !== "ROOM_EXIT" || sourceRef.id !== exit.id) {
        throw new Error(`Unknown room map source: ${sourceRef?.type}/${sourceRef?.id}`);
      }
      return exit.position;
    }
  });

  const dataSource = Object.freeze({
    id: roomId,
    label: `${ROOMS[roomId].label} 지도`,
    indoor: true,
    radiusWorld: Math.max(layout.halfWidth, layout.halfDepth) + 0.7,
    bounds,
    geometry: () => geometry,
    poiRegistry: () => registry,
    refreshState: (context = null) => registry.list({ surface: MAP_SURFACE.MINIMAP, context }),
    status: () => Object.freeze({
      roomId,
      geometryCount: geometry.length,
      poiCount: registry.size
    })
  });
  roomMapCache.set(roomId, dataSource);
  return dataSource;
}
