// Visual-only replacement for the fixed basic-room chair. Placement and collision stay in
// personal-room-layout.js; Collection-owned furniture never reaches this loader.
import { createPersonalRoomFixtureModel } from "./personal-room-fixture-model.js";
export const PERSONAL_ROOM_CHAIR_MODEL_URL = "/assets/kaykit/furniture-bits/chair_A.gltf";
export const PERSONAL_ROOM_CHAIR_MODEL_SCALE = 0.5;

export function createPersonalRoomChairModel({ app, root, anchor, fallback }) {
  // Source backrest is at -Z; the old chair backrest is at room-local +Z.
  // Keep a positive scale: the room root already mirrors Z.
  return createPersonalRoomFixtureModel({ app, root, anchor, fallback, model: {
    url: PERSONAL_ROOM_CHAIR_MODEL_URL, name: "personal_chair_kaykit",
    offset: [0, 0, 0], scale: PERSONAL_ROOM_CHAIR_MODEL_SCALE, yaw: 180
  } });
}
