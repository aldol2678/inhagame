// Shared campus bicycle. Parked visual at the main gate; ride is ground-only.
import { GATE_FRAME } from "../roadview-layout.js";
import { metersToWorld } from "../world-scale.js";

export const CAMPUS_BIKE_ID = "mount.campus_bike.default";

const U = 6.05;
const V = 3.2;
const LENGTH = 1.12;
const WIDTH = 0.44;
const V0 = V - LENGTH / 2;
const V1 = V + LENGTH / 2;

const center = GATE_FRAME.at(U, V);

export const MAIN_GATE_CAMPUS_BIKE = Object.freeze({
  id: "main_gate_campus_bike",
  mountId: CAMPUS_BIKE_ID,
  rideable: true,
  u: U,
  v: V,
  x: center.x,
  y: 0,
  z: center.z,
  yaw: GATE_FRAME.yaw,
  interactionRadius: metersToWorld(3)
});

export const MAIN_GATE_CAMPUS_BIKE_COLLIDER = Object.freeze({
  id: "main_gate_campus_bike",
  polygon: Object.freeze([
    GATE_FRAME.at(U - WIDTH / 2, V0),
    GATE_FRAME.at(U + WIDTH / 2, V0),
    GATE_FRAME.at(U + WIDTH / 2, V1),
    GATE_FRAME.at(U - WIDTH / 2, V1)
  ].map(Object.freeze)),
  minY: 0,
  maxY: 0.72
});

let propRoot = null;
export function setCampusBikePropRoot(root) {
  propRoot = root ?? null;
}
export function setCampusBikePropVisible(visible) {
  if (propRoot) propRoot.enabled = visible === true;
}

const NAVY = "#1b2a4a";
const TIRE = "#1a1a1a";
const SADDLE = "#151515";
const BASKET = "#ececec";
const STEEL = "#c5c5c8";

function wheel(batch, p, u, v, y, radius) {
  const segments = 14;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    batch.tube(
      TIRE,
      p(u, v + Math.cos(a0) * radius, y + Math.sin(a0) * radius),
      p(u, v + Math.cos(a1) * radius, y + Math.sin(a1) * radius),
      0.022,
      5
    );
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    batch.tube(
      STEEL,
      p(u, v + Math.cos(a) * radius * 0.12, y + Math.sin(a) * radius * 0.12),
      p(u, v + Math.cos(a) * radius * 0.88, y + Math.sin(a) * radius * 0.88),
      0.008,
      4
    );
  }
  batch.tube(STEEL, p(u - 0.03, v, y), p(u + 0.03, v, y), 0.028, 6);
}

function wireBasket(batch, p, u, v, y) {
  const w = 0.13;
  const d = 0.11;
  const h = 0.1;
  const corners = [
    [u - w, v - d, y],
    [u + w, v - d, y],
    [u + w, v + d, y],
    [u - w, v + d, y]
  ];
  const top = corners.map(([cu, cv]) => [cu, cv, y + h]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    batch.tube(BASKET, p(...corners[i]), p(...corners[j]), 0.01, 4);
    batch.tube(BASKET, p(...top[i]), p(...top[j]), 0.01, 4);
    batch.tube(BASKET, p(...corners[i]), p(...top[i]), 0.01, 4);
  }
  batch.tube(BASKET, p(u - w, v, y), p(u + w, v, y), 0.008, 4);
  batch.tube(BASKET, p(u, v - d, y), p(u, v + d, y), 0.008, 4);
}

export function fillCampusBike(batch) {
  const f = GATE_FRAME;
  const p = (u, v, y) => {
    const q = f.at(u, v);
    return [q.x, y, q.z];
  };
  const box = (color, u, v, y, w, h, d) => batch.box(color, p(u, v, y), [w, h, d], f.yaw);

  const rearV = V0 + 0.16;
  const frontV = V1 - 0.16;
  const axleY = 0.2;
  const radius = 0.2;

  wheel(batch, p, U, rearV, axleY, radius);
  wheel(batch, p, U, frontV, axleY, radius);

  const seatV = rearV + 0.08;
  const headV = frontV - 0.08;
  batch.tube(NAVY, p(U, rearV, axleY), p(U, seatV, 0.54), 0.022, 6);
  batch.tube(NAVY, p(U, seatV, 0.54), p(U, headV, 0.52), 0.022, 6);
  batch.tube(NAVY, p(U, rearV, axleY), p(U, headV, 0.52), 0.02, 6);
  batch.tube(NAVY, p(U, frontV, axleY), p(U, headV, 0.52), 0.02, 6);
  batch.tube(NAVY, p(U, seatV, 0.54), p(U, seatV, 0.6), 0.016, 5);
  batch.tube(NAVY, p(U, headV, 0.52), p(U, headV, 0.6), 0.016, 5);

  box(SADDLE, U, seatV, 0.63, 0.12, 0.04, 0.22);
  batch.tube(TIRE, p(U - 0.18, headV, 0.6), p(U + 0.18, headV, 0.6), 0.016, 6);
  wireBasket(batch, p, U, frontV + 0.02, 0.52);

  batch.tube(NAVY, p(U, rearV, axleY + radius * 0.55), p(U, seatV - 0.02, axleY + radius * 0.85), 0.012, 5);
  batch.tube(NAVY, p(U, frontV, axleY + radius * 0.55), p(U, headV + 0.02, axleY + radius * 0.85), 0.012, 5);

  batch.tube(TIRE, p(U - 0.08, V, 0.16), p(U + 0.08, V, 0.16), 0.012, 5);
  batch.tube(TIRE, p(U + 0.03, V - 0.02, 0.18), p(U + 0.1, V - 0.06, 0.02), 0.01, 5);
}
