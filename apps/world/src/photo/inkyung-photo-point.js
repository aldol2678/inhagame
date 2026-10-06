// The existing semantic inkyung_photo_point anchor, shared by NPC invitations and the player UI.
// This projects the same pond edge/slot formula as the NPC runtime; it adds no new landmark.
import { computePolygonCentroid, getCanonicalLandmark, projectPolygon } from '../reality-adapter.js';
import { edgeFrame } from '../roadview-layout.js';
const ring = projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon);
export const INKYUNG_PHOTO_ANCHOR_SPEC = Object.freeze([10, .5, 4]);
const [edge, fraction, distance] = INKYUNG_PHOTO_ANCHOR_SPEC;
const frame = edgeFrame(ring, edge);
export function inkyungPhotoPosition(slotIndex = 0) {
  const column = slotIndex % 3 - 1, row = Math.floor(slotIndex / 3);
  const along = Math.max(.35, Math.min(frame.length - .35, frame.length * fraction + column * 1.25));
  return frame.at(along, distance + row * 1.4);
}
export const INKYUNG_PHOTO_POINT = Object.freeze({
  id: 'inkyung_photo_point', position: Object.freeze(inkyungPhotoPosition(0)), radius: 3,
  lookAt: Object.freeze(computePolygonCentroid(ring))
});

// The photo preset frames the existing lake from the player’s current safe position.
// Arrival orientation is restored by the mode; this never turns or moves the player.
export function inkyungPhotoYaw(position = INKYUNG_PHOTO_POINT.position) {
  return Math.atan2(position.x - INKYUNG_PHOTO_POINT.lookAt.x, INKYUNG_PHOTO_POINT.lookAt.z - position.z);
}
