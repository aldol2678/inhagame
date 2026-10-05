// Main-gate guestbook world anchor.
// The stand sits on the west side of the gate opening, opposite the guard booth and away from
// the main NPC position. Measurements are game-layout estimates, not surveyed furniture.
import { GATE_FRAME } from "../roadview-layout.js";
import { metersToWorld } from "../world-scale.js";

const U = -6.2;
const V = 2.7;
const WIDTH = 0.95;
const DEPTH = 0.75;
const center = GATE_FRAME.at(U, V);

export const MAIN_GATE_GUESTBOOK = Object.freeze({
  id: "main_gate_guestbook",
  locationKey: "main_gate",
  x: center.x,
  y: 0,
  z: center.z,
  yaw: GATE_FRAME.yaw,
  u: U,
  v: V,
  interactionRadius: metersToWorld(3)
});

export const MAIN_GATE_GUESTBOOK_COLLIDER = Object.freeze({
  id: "main_gate_guestbook_stand",
  polygon: Object.freeze([
    GATE_FRAME.at(U - WIDTH / 2, V - DEPTH / 2),
    GATE_FRAME.at(U + WIDTH / 2, V - DEPTH / 2),
    GATE_FRAME.at(U + WIDTH / 2, V + DEPTH / 2),
    GATE_FRAME.at(U - WIDTH / 2, V + DEPTH / 2)
  ].map(Object.freeze)),
  minY: 0,
  maxY: 1.35
});
