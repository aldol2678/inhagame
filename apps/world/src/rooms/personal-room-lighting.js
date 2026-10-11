// PR A fixed-time practicals. World-time binding and interactive switches are PR B.
// Keep the established two non-shadowed lights; no reflection or extra scene pass.
import * as pc from 'playcanvas';
import { box } from '../campus-render-kit.js';
import { PERSONAL_ROOM_BASIC } from './personal-room-layout.js';

export function createPersonalRoomLighting(root, materials) {
  const H = PERSONAL_ROOM_BASIC.ceiling;
  const lights = [];
  for (const [name, x] of [['personal_light_w', -2.2], ['personal_light_e', 2.2]]) {
    const fixture = new pc.Entity(`${name}_fixture`);
    fixture.setLocalPosition(x, H - .045, 0); root.addChild(fixture);
    box(fixture, 'oak_lighting_mount', [0, .01, 0], [1.16, .055, .5], materials.get('woodOak'));
    box(fixture, 'recessed_housing', [0, -.015, 0], [1.08, .05, .42], materials.get('practicalHousing'));
    box(fixture, 'warm_diffuser', [0, -.043, 0], [1.01, .013, .35], materials.get('practicalDiffuser'));
    const e = new pc.Entity(name);
    e.addComponent('light', { type: 'omni', color: new pc.Color(1, .94, .84), intensity: .7, range: 7, castShadows: false });
    e.setLocalPosition(x, H - .25, 0); root.addChild(e); lights.push(e);
  }
  // A shallow switch beside the entrance is a visual cue only in the foundation.
  const z = -PERSONAL_ROOM_BASIC.halfDepth + .021;
  box(root, 'personal_light_switch_plate', [.84, .72, z], [.12, .18, .027], materials.get('switchPlate'));
  box(root, 'personal_light_switch_inset', [.84, .72, z + .016], [.063, .11, .012], materials.get('switchInset'));
  return { lights };
}
