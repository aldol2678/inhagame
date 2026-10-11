// Visual-only replacement for the fixed basic-room chair. Placement and collision stay in
// personal-room-layout.js; Collection-owned furniture never reaches this loader.
import { createPersonalRoomFixtureModel } from './personal-room-fixture-model.js';
import { PERSONAL_ROOM_CHAIR_PARTS } from './personal-room-chair-design.js';
export const PERSONAL_ROOM_CHAIR_MODEL_URL = '/assets/rooms/personal-v2/fixed-chair-oak-linen.glb';
export const PERSONAL_ROOM_CHAIR_MODEL_SCALE = 1;
const MATERIAL_SLOTS = new Set(PERSONAL_ROOM_CHAIR_PARTS.map(part => part.material));

export function createPersonalRoomChairModel({ app, root, anchor, fallback, materials }) {
  // Authored in room-local metres, with the back at +Z. Positive scale preserves
  // the room root's existing mirror. Only instance bindings change; shared asset
  // materials remain untouched and room materials keep their existing lifecycle.
  return createPersonalRoomFixtureModel({ app, root, anchor, fallback, model: {
    url: PERSONAL_ROOM_CHAIR_MODEL_URL, name: 'personal_chair_oak_linen',
    offset: [0, 0, 0], scale: PERSONAL_ROOM_CHAIR_MODEL_SCALE, yaw: 0,
    prepare(model) {
      if (!materials) return;
      for (const render of model.findComponents('render')) for (const instance of render.meshInstances) {
        const slot = instance.material?.name;
        if (!MATERIAL_SLOTS.has(slot)) throw new TypeError(`Unexpected fixed-chair material: ${slot}`);
        instance.material = materials.get(slot);
      }
    }
  } });
}
