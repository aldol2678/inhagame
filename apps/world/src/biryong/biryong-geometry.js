// 비룡탑 + 울림돌 + 광장 mesh detail, emitted into the facility FacilityMeshBatch per render tier.
// BASE  (always resident, LOD2): platform, column, lower pillars and the full dragon silhouette —
//        wings and tail stay at every distance because the dragon is the landmark's identity.
// NEAR  (LOD1): lintel ring, dragon legs, echo stones, benches, plaza walkway.
// DETAIL(LOD0): horns, whiskers, spine fins, claws, eyes, stone seams, plaque.
import {
  BIRYONG_AXIS, BIRYONG_BENCHES, BIRYONG_CENTER, BIRYONG_DRAGON_BASE_Y, BIRYONG_LOWER_PILLARS,
  BIRYONG_MAIN_PILLAR, BIRYONG_PLATFORM, BIRYONG_PLAZA_PATHS, ECHO_CENTER, ECHO_STONE_RING_RADIUS,
  ECHO_STONE_SIZE, ECHO_STONES
} from './biryong-layout.js';

const granite = '#d9d4c6', graniteDark = '#bdb6a4', graniteEdge = '#ebe7dc';
const bronze = '#857b55', bronzeLight = '#a19667', bronzeDark = '#5f5a3e';
const echoStone = '#aaa493', echoStoneTop = '#c3bdac', paving = '#cdc4b0', seam = '#a79f8b';
const benchWood = '#8a6a4b', benchFrame = '#565c5f', eye = '#20231f';

const { toEcho: f, lateral: s } = BIRYONG_AXIS;
const C = BIRYONG_CENTER;
// Dragon frame: u forward (toward the echo park / main lawn), y absolute, v to its left side.
const D = (u, y, v = 0) => [C.x + f.x * u + s.x * v, y, C.z + f.z * u + s.z * v];
const at = (p, y) => [p.x, y, p.z];
const lerp = (a, b, t) => a + (b - a) * t;

function doubleTriangle(batch, color, a, b, c) {
  batch.triangle(color, a, b, c);
  batch.triangle(color, a, c, b);
}

function platform(batch) {
  const { height, stepCount, footRadius } = BIRYONG_PLATFORM;
  const tread = 0.35;
  for (let i = 0; i < stepCount; i++) {
    const r = footRadius - i * tread;
    batch.tube(i % 2 ? granite : graniteDark, at(C, i * height / stepCount), at(C, (i + 1) * height / stepCount), r, 28);
  }
}

function column(batch) {
  const y0 = BIRYONG_PLATFORM.height;
  const { baseRadius, topRadius, height, capitalHeight } = BIRYONG_MAIN_PILLAR;
  batch.tube(graniteDark, at(C, y0), at(C, y0 + 0.7), baseRadius + 0.26, 10);
  const segments = 5;
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments, t1 = (i + 1) / segments;
    batch.tube(i % 2 ? granite : graniteEdge, at(C, y0 + height * t0), at(C, y0 + height * t1), lerp(baseRadius, topRadius, (t0 + t1) / 2), 10);
  }
  batch.tube(graniteEdge, at(C, y0 + height), at(C, y0 + height + capitalHeight), topRadius + 0.3, 10);
}

function lowerPillars(batch) {
  const y0 = BIRYONG_PLATFORM.height;
  for (const p of BIRYONG_LOWER_PILLARS) {
    const a = p.angle * Math.PI / 180, dx = Math.cos(a), dz = Math.sin(a);
    const foot = [C.x + dx * p.distance, y0, C.z + dz * p.distance];
    const head = [C.x + dx * (p.distance - 0.55), y0 + p.height, C.z + dz * (p.distance - 0.55)];
    batch.tube(graniteDark, foot, head, p.radius, 8);
  }
}

// Body spine from tail tip to head; radius swells through the torso.
const SPINE = Object.freeze([
  [-3.3, 0.7, 0.7], [-2.5, 0.25, 0.25], [-1.5, 0.3, -0.45], [-0.45, 0.85, -0.2],
  [0.35, 1.85, 0.3], [0.85, 2.95, 0.1], [1.3, 3.75, 0], [1.85, 4.05, 0]
]);
const SPINE_RADIUS = Object.freeze([0.08, 0.16, 0.26, 0.38, 0.42, 0.36, 0.29, 0.26]);
const spinePoint = i => D(SPINE[i][0], BIRYONG_DRAGON_BASE_Y + SPINE[i][1], SPINE[i][2]);

function dragonSilhouette(batch) {
  for (let i = 1; i < SPINE.length; i++) {
    batch.tube(bronze, spinePoint(i - 1), spinePoint(i), (SPINE_RADIUS[i - 1] + SPINE_RADIUS[i]) / 2, 9);
  }
  const y = BIRYONG_DRAGON_BASE_Y;
  // Head, snout and jaw read as a dragon at distance.
  const head = D(1.9, y + 4.08);
  batch.crown(bronze, head, [0.72, 0.52, 0.72]);
  batch.tube(bronze, D(2.0, y + 4.05), D(2.62, y + 3.92), 0.17, 8);
  batch.tube(bronzeDark, D(2.0, y + 3.9), D(2.5, y + 3.72), 0.1, 6);
  // Wings: three-finger membranes spread wide, kept in BASE for the long-range silhouette.
  for (const side of [-1, 1]) {
    const root = D(0.3, y + 2.1, side * 0.3);
    const tips = [
      D(0.1, y + 4.5, side * 2.4), D(-0.6, y + 4.1, side * 3.4),
      D(-1.3, y + 3.0, side * 3.3), D(-0.9, y + 2.0, side * 1.4)
    ];
    for (let i = 1; i < tips.length; i++) doubleTriangle(batch, bronzeLight, root, tips[i - 1], tips[i]);
    // Scalloped trailing edge between fingers.
    for (let i = 1; i < tips.length - 1; i++) {
      const mid = tips[i - 1].map((v, k) => (v + tips[i][k]) / 2 + (k === 1 ? -0.35 : 0));
      doubleTriangle(batch, bronzeLight, tips[i - 1], mid, tips[i]);
    }
    batch.tube(bronze, root, tips[0], 0.07, 5);
  }
  // Tail fin at the tip.
  doubleTriangle(batch, bronzeLight, D(-3.3, y + 0.7, 0.7), D(-3.8, y + 1.2, 0.9), D(-3.9, y + 0.5, 0.5));
}

function dragonLegs(batch) {
  const y = BIRYONG_DRAGON_BASE_Y;
  for (const side of [-1, 1]) {
    // Front legs reach forward; hind legs grip the capital.
    batch.tube(bronze, D(0.55, y + 2.35, side * 0.32), D(0.95, y + 1.8, side * 0.5), 0.1, 6);
    batch.tube(bronze, D(0.95, y + 1.8, side * 0.5), D(1.2, y + 1.65, side * 0.48), 0.08, 6);
    batch.tube(bronze, D(-0.55, y + 0.8, side * 0.34), D(-0.25, y + 0.15, side * 0.55), 0.12, 6);
    batch.tube(bronze, D(-0.25, y + 0.15, side * 0.55), D(0.05, y + 0.02, side * 0.62), 0.09, 6);
  }
}

function dragonDetail(batch) {
  const y = BIRYONG_DRAGON_BASE_Y;
  for (const side of [-1, 1]) {
    // Horns sweep back, whiskers trail from the snout, eyes sit above the jaw line.
    batch.tube(bronzeDark, D(1.8, y + 4.28, side * 0.16), D(1.3, y + 4.75, side * 0.3), 0.05, 5);
    batch.tube(bronzeDark, D(2.55, y + 3.9, side * 0.12), D(2.4, y + 3.55, side * 0.55), 0.02, 4);
    batch.tube(bronzeDark, D(2.4, y + 3.55, side * 0.55), D(2.05, y + 3.35, side * 0.7), 0.015, 4);
    batch.box(eye, D(2.12, y + 4.13, side * 0.24), [0.07, 0.06, 0.07]);
    // Claws on front and hind feet.
    for (const [u, yy, v] of [[1.2, 1.65, 0.48], [0.05, 0.02, 0.62]]) {
      for (const k of [-1, 0, 1]) batch.tube(bronzeDark, D(u, y + yy, side * v), D(u + 0.14, y + yy - 0.06, side * v + k * 0.07), 0.025, 4);
    }
    // Wing bones.
    const root = D(0.3, y + 2.1, side * 0.3);
    for (const tip of [D(-0.6, y + 4.1, side * 3.4), D(-1.3, y + 3.0, side * 3.3)]) batch.tube(bronzeDark, root, tip, 0.045, 5);
  }
  // Spine fins along the back.
  for (let i = 1; i < SPINE.length - 1; i++) {
    const a = spinePoint(i), b = spinePoint(i + 1);
    const top = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + SPINE_RADIUS[i] + 0.22, (a[2] + b[2]) / 2];
    const aUp = [a[0], a[1] + SPINE_RADIUS[i] * 0.9, a[2]], bUp = [b[0], b[1] + SPINE_RADIUS[i + 1] * 0.9, b[2]];
    doubleTriangle(batch, bronzeDark, aUp, top, bUp);
  }
}

function lintel(batch) {
  const y = BIRYONG_PLATFORM.height + BIRYONG_LOWER_PILLARS[0].height;
  batch.tube(granite, at(C, y - 0.12), at(C, y + 0.12), 1.12, 10);
}

function columnSeams(batch) {
  const y0 = BIRYONG_PLATFORM.height, { baseRadius, topRadius, height } = BIRYONG_MAIN_PILLAR;
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    batch.tube(seam, at(C, y0 + height * t - 0.02), at(C, y0 + height * t + 0.02), lerp(baseRadius, topRadius, t) + 0.012, 10);
  }
  // Step nosings.
  const { stepCount, footRadius, height: h } = BIRYONG_PLATFORM;
  for (let i = 0; i < stepCount; i++) {
    const y = (i + 1) * h / stepCount;
    batch.tube(graniteEdge, at(C, y - 0.015), at(C, y + 0.005), footRadius - i * 0.35 + 0.01, 28);
  }
  // Plaque facing the echo park.
  const plaque = D(3.55, 0.35, 0);
  batch.box(graniteDark, plaque, [0.12, 0.7, 0.9], -Math.atan2(s.z, s.x) * 180 / Math.PI);
  batch.box('#50544f', [plaque[0] + f.x * 0.07, 0.42, plaque[2] + f.z * 0.07], [0.02, 0.36, 0.64], -Math.atan2(s.z, s.x) * 180 / Math.PI);
}

function echoStones(batch, detail) {
  for (const stone of ECHO_STONES) {
    if (!detail) {
      batch.box(echoStone, [stone.x, stone.height / 2, stone.z], [ECHO_STONE_SIZE.width, stone.height, ECHO_STONE_SIZE.depth], stone.yaw);
      continue;
    }
    batch.box(echoStoneTop, [stone.x, stone.height + 0.015, stone.z], [ECHO_STONE_SIZE.width * 0.82, 0.04, ECHO_STONE_SIZE.depth * 0.8], stone.yaw);
  }
}

function plaza(batch) {
  // Paving discs under the platform and the echo ring, joined by the walkway.
  batch.tube(paving, at(C, 0), at(C, 0.02), BIRYONG_PLATFORM.footRadius + 0.7, 28);
  batch.tube(paving, at(ECHO_CENTER, 0), at(ECHO_CENTER, 0.02), ECHO_STONE_RING_RADIUS + 0.8, 24);
  batch.tube(seam, at(ECHO_CENTER, 0.02), at(ECHO_CENTER, 0.026), 0.6, 20);
  for (const path of BIRYONG_PLAZA_PATHS) {
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      batch.box(paving, [(a.x + b.x) / 2, 0.012, (a.z + b.z) / 2], [len + 0.6, 0.024, 1.3], -Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI);
    }
  }
}

function benches(batch) {
  for (const bench of BIRYONG_BENCHES) {
    const a = bench.yaw * Math.PI / 180, dx = Math.cos(a), dz = -Math.sin(a);
    batch.box(benchWood, [bench.x, 0.22, bench.z], [1.3, 0.06, 0.4], bench.yaw);
    for (const k of [-0.5, 0.5]) batch.box(benchFrame, [bench.x + dx * k, 0.1, bench.z + dz * k], [0.06, 0.2, 0.38], bench.yaw);
  }
}

export function fillBiryongTower(batch, tier) {
  if (tier === 'BASE') {
    plaza(batch);
    platform(batch);
    column(batch);
    lowerPillars(batch);
    dragonSilhouette(batch);
  } else if (tier === 'NEAR') {
    lintel(batch);
    dragonLegs(batch);
    echoStones(batch, false);
    benches(batch);
  } else if (tier === 'DETAIL') {
    dragonDetail(batch);
    columnSeams(batch);
    echoStones(batch, true);
  }
}
