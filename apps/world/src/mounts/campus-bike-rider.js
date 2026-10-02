import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { PLAYER_ORIGIN_Y } from "../player-dimensions.js";

// Local rider-bike geometry. The player root sits PLAYER_ORIGIN_Y above terrain,
// so the bike root is lowered by the same amount and its wheels touch the ground.
const AXLE_Y = 0.22;
const REAR_Z = -0.38;
const FRONT_Z = 0.38;
const WHEEL_DIAMETER = 0.4;
const WHEEL_THICKNESS = 0.045;
const WHEEL_SEGMENTS = 18;
const CRANK = [0, 0.2, 0.02];
const SEAT = [0, 0.54, -0.16];
const HEAD = [0, 0.52, 0.24];

function yzBar(root, name, a, b, thickness, material) {
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const length = Math.hypot(dy, dz);
  const e = box(
    root,
    name,
    [0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    [thickness, thickness, length],
    material
  );
  e.setLocalEulerAngles(-Math.atan2(dy, dz) * 180 / Math.PI, 0, 0);
  return e;
}

function wheel(root, name, z, tire, steel) {
  const radius = WHEEL_DIAMETER / 2;
  const point = (angle, scale = 1) => [
    0,
    AXLE_Y + Math.sin(angle) * radius * scale,
    z + Math.cos(angle) * radius * scale
  ];

  // Build an actual ring instead of stacking filled cylinders. This keeps the
  // wheel readable as a bicycle wheel from the side.
  for (let i = 0; i < WHEEL_SEGMENTS; i++) {
    const a0 = i / WHEEL_SEGMENTS * Math.PI * 2;
    const a1 = (i + 1) / WHEEL_SEGMENTS * Math.PI * 2;
    yzBar(root, `${name}_tire_${i}`, point(a0), point(a1), WHEEL_THICKNESS, tire);
  }
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    yzBar(root, `${name}_spoke_${i}`, [0, AXLE_Y, z], point(a, 0.82), 0.012, steel);
  }
  const hub = box(root, `${name}_hub`, [0, AXLE_Y, z],
    [0.07, 0.025, 0.07], steel, 0, "cylinder");
  hub.setLocalEulerAngles(0, 0, 90);
}

function wireBasket(root, basket) {
  const y0 = 0.46;
  const y1 = 0.59;
  const z0 = 0.35;
  const z1 = 0.53;
  const halfW = 0.14;

  box(root, "basket_base", [0, y0, (z0 + z1) / 2], [0.28, 0.014, z1 - z0], basket);
  box(root, "basket_top_front", [0, y1, z1], [0.28, 0.014, 0.014], basket);
  box(root, "basket_top_back", [0, y1, z0], [0.28, 0.014, 0.014], basket);
  for (const x of [-halfW, halfW]) {
    box(root, `basket_side_${x}`, [x, y1, (z0 + z1) / 2], [0.014, 0.014, z1 - z0], basket);
  }
  for (const x of [-0.13, 0, 0.13]) {
    for (const z of [z0, z1]) {
      box(root, `basket_wire_${x}_${z}`, [x, (y0 + y1) / 2, z],
        [0.012, y1 - y0, 0.012], basket);
    }
  }
}

export function attachRiderBike(player) {
  const root = new pc.Entity("Rider_CampusBike");
  player.addChild(root);
  root.setLocalPosition(0, -PLAYER_ORIGIN_Y, 0);
  root.enabled = false;

  const navy = surface("#1b2a4a");
  const tire = surface("#17191d");
  const saddle = surface("#151515");
  const basket = surface("#ececec");
  const steel = surface("#aeb7c2");

  wheel(root, "rear_wheel", REAR_Z, tire, steel);
  wheel(root, "front_wheel", FRONT_Z, tire, steel);

  // One coherent diamond frame in the local Y/Z plane.
  yzBar(root, "top_tube", SEAT, HEAD, 0.045, navy);
  yzBar(root, "seat_tube", CRANK, SEAT, 0.045, navy);
  yzBar(root, "down_tube", CRANK, HEAD, 0.045, navy);
  yzBar(root, "rear_stay", [0, AXLE_Y, REAR_Z], SEAT, 0.036, navy);
  yzBar(root, "chain_stay", [0, AXLE_Y, REAR_Z], CRANK, 0.032, navy);
  yzBar(root, "front_fork", [0, AXLE_Y, FRONT_Z], HEAD, 0.036, navy);

  box(root, "seat", [0, 0.57, -0.12], [0.16, 0.045, 0.22], saddle);
  yzBar(root, "handle_stem", HEAD, [0, 0.59, 0.26], 0.03, navy);
  box(root, "handlebar", [0, 0.59, 0.26], [0.44, 0.035, 0.035], tire);
  wireBasket(root, basket);

  // Small crank/pedal cue, kept close to the frame so it does not read as debris.
  const crank = box(root, "crank", CRANK, [0.08, 0.03, 0.08], steel, 0, "cylinder");
  crank.setLocalEulerAngles(90, 0, 0);
  box(root, "pedal_bar", [0, 0.2, -0.02], [0.34, 0.025, 0.025], steel);

  return root;
}
