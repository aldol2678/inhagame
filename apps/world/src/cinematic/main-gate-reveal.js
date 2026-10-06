import { MAIN_GATE_SPAWN } from "../campus-spawn.js";
import { TOUR_STOPS } from "../campus-layout.js";

const mainStop = TOUR_STOPS.find(stop => stop.id === "main") ?? { x: 0, z: -20 };
const dx = mainStop.x - MAIN_GATE_SPAWN.x;
const dz = mainStop.z - MAIN_GATE_SPAWN.z;
const length = Math.max(1, Math.hypot(dx, dz));
const forward = Object.freeze({ x: dx / length, z: dz / length });
const right = Object.freeze({ x: forward.z, z: -forward.x });

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const smooth = value => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const point = (along, side, y) => ({
  x: MAIN_GATE_SPAWN.x + forward.x * along + right.x * side,
  y,
  z: MAIN_GATE_SPAWN.z + forward.z * along + right.z * side
});
const mixPoint = (a, b, t) => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t)
});

const SHOT_A = Object.freeze({
  from: Object.freeze({ pos: point(-9, -8, 3.6), look: point(19, 0, 3.2), fov: 57 }),
  to: Object.freeze({ pos: point(8, 13, 8.8), look: point(38, 0, 5.2), fov: 60 })
});
const SHOT_B = Object.freeze({
  from: SHOT_A.to,
  to: Object.freeze({
    pos: point(34, -18, 15.5),
    look: Object.freeze({ x: mainStop.x, y: 6.2, z: mainStop.z }),
    fov: 64
  })
});

export const MAIN_GATE_REVEAL_V01 = Object.freeze({
  id: "MAIN_GATE_REVEAL_V01",
  duration: 6.4,
  blendSeconds: 0.48,
  streamingLeadSeconds: 1.35,
  skippable: true,
  poseAt(time = 0) {
    const t = Math.max(0, Math.min(6.4, Number(time) || 0));
    if (t <= 2.35) {
      const q = smooth(t / 2.35);
      return {
        pos: mixPoint(SHOT_A.from.pos, SHOT_A.to.pos, q),
        look: mixPoint(SHOT_A.from.look, SHOT_A.to.look, q),
        fov: lerp(SHOT_A.from.fov, SHOT_A.to.fov, q)
      };
    }
    const q = smooth((t - 2.35) / (6.4 - 2.35));
    return {
      pos: mixPoint(SHOT_B.from.pos, SHOT_B.to.pos, q),
      look: mixPoint(SHOT_B.from.look, SHOT_B.to.look, q),
      fov: lerp(SHOT_B.from.fov, SHOT_B.to.fov, q)
    };
  }
});
