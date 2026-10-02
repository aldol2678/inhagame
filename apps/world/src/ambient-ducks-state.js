import { getCanonicalLandmark, projectPolygon, triangulatePolygon } from "./reality-adapter.js";
import { polygonOverlap } from "./polygon-collision.js";
import { overPondWater } from "./landmark-detail-layout.js";

export const INKYUNG_DUCK_ROSTER = Object.freeze([
  Object.freeze({ id: "inkyung_duck_white_01", kind: "white", speed: 0.34 }),
  Object.freeze({ id: "inkyung_duck_white_02", kind: "white", speed: 0.31 }),
  Object.freeze({ id: "inkyung_duck_white_03", kind: "white", speed: 0.36 }),
  Object.freeze({ id: "inkyung_duck_mallard_01", kind: "mallard", speed: 0.38 })
]);

export const MECHANICAL_DUCK_ID = "inkyung_duck_mechanical_01";
export const MECHANICAL_DUCK_CHANCE = 0.08;
export const MECHANICAL_DUCK_INTERACTION_RADIUS = 2.4;
export const DUCK_SHORE_OBSERVATION_RADIUS = 6;
export const MECHANICAL_DUCK_CONTEXT_PRIORITY = 240;
export const DUCK_WATER_Y = 0.025;

const pondRing = projectPolygon(getCanonicalLandmark("lmk_inkyung_pond").polygon);
const pondTriangles = (() => {
  const ids = triangulatePolygon(pondRing);
  const out = [];
  for (let i = 0; i < ids.length; i += 3) out.push(ids.slice(i, i + 3).map(id => pondRing[id]));
  return out;
})();

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function distanceToSegment(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  if (!length2) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length2));
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

export function distanceToInkyungPondShore(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return Infinity;
  let nearest = Infinity;
  for (let i = 0; i < pondRing.length; i++) {
    nearest = Math.min(nearest, distanceToSegment(point, pondRing[i], pondRing[(i + 1) % pondRing.length]));
  }
  return nearest;
}

export function canObserveInkyungDucksFromShore(point, radius = DUCK_SHORE_OBSERVATION_RADIUS) {
  return !!point && Number.isFinite(radius) && radius >= 0 &&
    !overPondWater(point.x, point.z) &&
    distanceToInkyungPondShore(point) <= radius;
}
const hash = text => {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
};
const mulberry32 = seed => () => {
  let t = seed += 0x6D2B79F5;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const range = (random, min, max) => min + (max - min) * random();

function trianglePoint(triangle, random, inset = 0.28) {
  let a = random(), b = random();
  if (a + b > 1) { a = 1 - a; b = 1 - b; }
  const weights = [1 - a - b, a, b].map(w => inset / 3 + (1 - inset) * w);
  const sum = weights[0] + weights[1] + weights[2];
  return {
    x: triangle.reduce((v, p, i) => v + p.x * weights[i] / sum, 0),
    z: triangle.reduce((v, p, i) => v + p.z * weights[i] / sum, 0)
  };
}

export function isInsideInkyungPond(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.z) &&
    polygonOverlap(point.x, point.z, pondRing, 0) &&
    overPondWater(point.x, point.z);
}

function segmentInside(a, b, steps = 10) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!isInsideInkyungPond({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
  }
  return true;
}

function randomWaterPoint(random) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const triangle = pondTriangles[Math.min(pondTriangles.length - 1, Math.floor(random() * pondTriangles.length))];
    const point = trianglePoint(triangle, random, 0.34);
    if (isInsideInkyungPond(point)) return point;
  }
  return null;
}

function safeTarget(from, random) {
  for (let i = 0; i < 20; i++) {
    const target = randomWaterPoint(random);
    if (target && segmentInside(from, target)) return target;
  }
  return { ...from };
}

export function inkyungDuckSpawnPoints(count = INKYUNG_DUCK_ROSTER.length) {
  if (!Number.isInteger(count) || count < 1) throw new Error("Duck spawn count must be a positive integer");
  const points = [];
  for (let i = 0; i < count; i++) {
    const random = mulberry32(0x1d00c + i * 977);
    let point = null;
    for (let attempt = 0; attempt < pondTriangles.length * 2 && !point; attempt++) {
      const triangle = pondTriangles[(Math.floor(i * pondTriangles.length / count) + attempt) % pondTriangles.length];
      const candidate = trianglePoint(triangle, random, 0.52);
      if (isInsideInkyungPond(candidate)) point = candidate;
    }
    point ||= randomWaterPoint(random);
    if (!point) throw new Error("Could not derive a safe Inkyung Pond duck spawn");
    points.push(point);
  }
  return points;
}

export function shouldSpawnMechanicalDuck({ force = false, random = Math.random, chance = MECHANICAL_DUCK_CHANCE } = {}) {
  if (force) return true;
  if (typeof random !== "function" || !Number.isFinite(chance) || chance < 0 || chance > 1) return false;
  return random() < chance;
}

function setState(brain, state) {
  brain.state = state;
  brain.stateTime = 0;
  brain.stateDuration =
    state === "swim" ? range(brain.random, 3.4, 7.2) :
    state === "groom" ? range(brain.random, 1.5, 2.8) :
    state === "flap" ? range(brain.random, 1.0, 1.7) :
    range(brain.random, 2.2, 5.4);
  if (state === "swim") brain.target = safeTarget(brain.position, brain.random);
}

function chooseState(brain) {
  const roll = brain.random();
  setState(brain, roll < 0.54 ? "idle" : roll < 0.86 ? "swim" : roll < 0.96 ? "groom" : "flap");
}

export function createDuckBrain({ id, spawn, speed = 0.34, mechanical = false, seed = 0 }) {
  if (!id || !isInsideInkyungPond(spawn)) throw new Error("Duck spawn must be inside Inkyung Pond");
  const firstRandom = mulberry32(hash(id) ^ seed);
  const brain = {
    id, mechanical, speed, position: { ...spawn }, target: { ...spawn },
    yaw: range(firstRandom, -180, 180),
    state: "idle", stateTime: 0, stateDuration: 0,
    random: mulberry32(hash(id) ^ seed ^ 0x9e3779b9)
  };
  setState(brain, "idle");
  return brain;
}

export function advanceDuckBrain(brain, dt, playerPosition = null) {
  if (!brain || !Number.isFinite(dt) || dt <= 0) return brain;
  dt = Math.min(dt, 0.05);
  brain.stateTime += dt;

  if (playerPosition && Number.isFinite(playerPosition.x) && Number.isFinite(playerPosition.z)) {
    const d = distance(brain.position, playerPosition);
    if (d < 1.25) {
      const dx = brain.position.x - playerPosition.x, dz = brain.position.z - playerPosition.z;
      const len = Math.hypot(dx, dz) || 1;
      const flee = { x: brain.position.x + dx / len * 1.4, z: brain.position.z + dz / len * 1.4 };
      if (isInsideInkyungPond(flee) && segmentInside(brain.position, flee, 4)) {
        brain.target = flee;
        brain.state = "swim";
        brain.stateTime = 0;
        brain.stateDuration = 2.2;
      }
    }
  }

  if (brain.state === "swim") {
    const dx = brain.target.x - brain.position.x, dz = brain.target.z - brain.position.z;
    const remaining = Math.hypot(dx, dz);
    if (remaining < 0.08) {
      chooseState(brain);
    } else {
      const step = Math.min(remaining, brain.speed * dt);
      const next = { x: brain.position.x + dx / remaining * step, z: brain.position.z + dz / remaining * step };
      if (isInsideInkyungPond(next)) {
        brain.position = next;
        brain.yaw = Math.atan2(dx, dz) * 180 / Math.PI;
      } else {
        brain.target = safeTarget(brain.position, brain.random);
      }
    }
  }

  if (brain.stateTime >= brain.stateDuration) chooseState(brain);
  return brain;
}
