import {
  BIRYONG_CENTER,
  BIRYONG_PLACE_ID,
  BIRYONG_PLACE_ZONE_ID
} from "../biryong/biryong-layout.js";

export const MUSIC_PLACE_TARGETS = Object.freeze([
  Object.freeze({
    id: BIRYONG_PLACE_ID,
    label: "비룡탑",
    placeZoneId: BIRYONG_PLACE_ZONE_ID,
    position: Object.freeze({ x: BIRYONG_CENTER.x, z: BIRYONG_CENTER.z }),
    previewRadius: 8,
    previewCamera: Object.freeze({
      targetY: 7.5,
      offset: Object.freeze([18, 16, 22])
    })
  })
]);
