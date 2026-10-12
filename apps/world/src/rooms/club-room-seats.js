// Six authored club chairs. Admission and occupancy belong to the club server lease, never
// to a personal-room UUID or an optimistic visual pose. Back approaches avoid the central table.
import { CLUB_ROOM_FURNITURE, CLUB_ROOM_OBSTACLES, CLUB_ROOM_BOUNDS } from "./club-room-layout.js";
import { GROUND_ORIGIN_Y, SIT_HIP_HEIGHT, SEAT_INTERACT_RANGE } from "../seat-anchors.js";
import { roomSeatPointIsClear } from "./personal-room-seats.js";

export const CLUB_ROOM_ID = "ROOM_CLUBHOUSE_01";
export const CLUB_ROOM_CAPACITY = 6;
export const CLUB_ROOM_SEAT_TOP = .25; // renderer: chair seat centre .23, thickness .04
export const CLUB_ROOM_SEATS = Object.freeze(CLUB_ROOM_FURNITURE.filter(item => item.kind === "chair").map(item => {
  const direction = item.yaw === 180 ? 1 : -1;
  return Object.freeze({
    id: `SEAT_${CLUB_ROOM_ID}_${item.id}`, seatId: item.id, interactableId: item.id,
    type: "seat", clubRoomId: CLUB_ROOM_ID, placeZoneId: CLUB_ROOM_ID,
    position: Object.freeze({ x: item.at[0], y: GROUND_ORIGIN_Y + CLUB_ROOM_SEAT_TOP - SIT_HIP_HEIGHT, z: item.at[2] }),
    yaw: item.yaw ?? 0,
    approachDirection: Object.freeze({ x: 0, z: direction }),
    standPoint: Object.freeze({ x: item.at[0], y: GROUND_ORIGIN_Y, z: item.at[2] + direction * .6 })
  });
}));
export const CLUB_ROOM_SEAT_IDS = Object.freeze(CLUB_ROOM_SEATS.map(seat => seat.seatId));

export function clubRoomSeatAnchors({ position = null } = {}) {
  return CLUB_ROOM_SEATS.filter(seat => {
    if (!position) return true;
    if (Math.hypot(position.x - seat.position.x, position.z - seat.position.z) > SEAT_INTERACT_RANGE) return false;
    const distance = Math.hypot(position.x - seat.standPoint.x, position.z - seat.standPoint.z);
    const steps = Math.max(1, Math.ceil(distance / .08));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      if (!roomSeatPointIsClear({ x: position.x + (seat.standPoint.x - position.x) * t,
        z: position.z + (seat.standPoint.z - position.z) * t }, CLUB_ROOM_OBSTACLES, CLUB_ROOM_BOUNDS)) return false;
    }
    return true;
  });
}
