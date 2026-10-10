// The existing semantic inkyung_photo_point anchor used by NPC invitations and slots.
// This projects the same pond edge/slot formula as the NPC runtime; it adds no new landmark.
// Photo Mode never depends on it: entry is global. A future optional Inkyung composition
// preset may read this anchor, and without that preset Photo Mode behaves identically.
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

// Lake-facing yaw from a position: a candidate input for that optional preset only.
// It never turns or moves the player, and Photo Mode does not call it on entry.
export function inkyungPhotoYaw(position = INKYUNG_PHOTO_POINT.position) {
  return Math.atan2(position.x - INKYUNG_PHOTO_POINT.lookAt.x, INKYUNG_PHOTO_POINT.lookAt.z - position.z);
}
