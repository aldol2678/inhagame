// Optional template decorations yield to Collection-owned placements. They never reserve
// persisted layout space or introduce shop/catalog/server item definitions.
import { FURNITURE_BY_ID, furnitureBox } from "./furniture-layout.js";

const prop = (id, asset, at, size, yaw = 0, offset = [0, 0, 0]) => Object.freeze({
  id, at: Object.freeze(at), size: Object.freeze(size),
  model: Object.freeze({ url: `/assets/kaykit/furniture-bits/${asset}.gltf`,
    name: `personal_${id}_kaykit`, scale: 0.5, yaw, offset: Object.freeze(offset) })
});
export const PERSONAL_ROOM_DECOR = Object.freeze([
  prop("reading_table", "table_medium", [-3.85, 0, -2.25], [1, 0.5, 1]),
  prop("floor_lamp", "lamp_standing", [-4.65, 0, -3], [0.5, 1.26, 0.500001], 0, [0, 0.000001, 0]),
  // At yaw 90 the source's +Z depth points into the room from the west wall.
  // Centre its one-sided depth on the anchor and lift its slightly negative Y pivot.
  prop("wall_shelf", "shelf_B_large_decorated", [-5.235, 1.32, -1.8], [0.250001, 0.409, 1.000001], 90, [-0.125, 0.050001, 0])
]);
export function personalRoomDecorBox(prop) {
  const [x, y, z] = prop.at, [w, h, d] = prop.size;
  return { id: `personal_decor_${prop.id}`, minX: x-w/2, maxX: x+w/2,
    minY: y, maxY: y+h, minZ: z-d/2, maxZ: z+d/2 };
}
const overlaps = (a, b) => ["X", "Y", "Z"].every(axis =>
  a[`min${axis}`] < b[`max${axis}`] - 1e-7 && a[`max${axis}`] > b[`min${axis}`] + 1e-7);
export function visiblePersonalRoomDecor(objects) {
  const ownedBoxes = objects.filter(object => !FURNITURE_BY_ID.get(object.itemId)?.flat)
    .map(furnitureBox).filter(Boolean);
  return PERSONAL_ROOM_DECOR.filter(prop => !ownedBoxes.some(box => overlaps(personalRoomDecorBox(prop), box)));
}
