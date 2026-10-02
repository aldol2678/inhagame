// 비룡탑 · 울림돌 · 비룡 광장 layout authority. Pure data: no renderer, DOM or storage imports.
// 1 world unit ~= 2 m. The tower centre comes from the existing lmk_biryong_tower facility; every
// other dimension is an estimate from photographs and the 1998 description of the echo stones
// (18 stones, nine per side, set as a pair of brackets). Nothing here is surveyed.
import { FACILITIES } from '../campus-facilities.js';

const tower = FACILITIES.find(f => f.id === 'lmk_biryong_tower');
if (!tower) throw new Error('lmk_biryong_tower facility is required for the Biryong plaza');

export const BIRYONG_PLACE_ID = 'PLACE_BIRYONG_TOWER';
// Content sub-POIs. The runtime Place Zone stays AREA_INKYUNG_STUDENT_CENTER (realtime channel).
export const BIRYONG_POI = Object.freeze({
  TOWER: 'BIRYONG_TOWER',
  ECHO_STONE: 'ECHO_STONE',
  PLAZA: 'BIRYONG_PLAZA'
});
export const BIRYONG_PLACE_ZONE_ID = 'AREA_INKYUNG_STUDENT_CENTER';

export const BIRYONG_CENTER = Object.freeze({ x: tower.center.x, z: tower.center.z });
export const BIRYONG_DISCOVER_RADIUS = 9; // 18 m

const deg = Math.PI / 180;
const dir = angle => ({ x: Math.cos(angle * deg), z: Math.sin(angle * deg) });
const add = (p, d, s) => ({ x: p.x + d.x * s, z: p.z + d.z * s });

// The echo park lies west-south-west of the tower: the service road passes ~6 WU to the east
// and the pond path ~10 WU to the north, while the lawn toward 우남호 is open.
export const BIRYONG_ECHO_BEARING = 210;
const toEcho = dir(BIRYONG_ECHO_BEARING);
const lateral = { x: -toEcho.z, z: toEcho.x };
export const BIRYONG_AXIS = Object.freeze({ toEcho: Object.freeze(toEcho), lateral: Object.freeze(lateral) });

// Stepped round base. Three visible steps; movement uses one invisible, gentle radial ramp so
// walking and Auto Move never catch on a riser.
export const BIRYONG_PLATFORM = Object.freeze({
  height: 0.42,
  stepCount: 3,
  topRadius: 2.35,
  footRadius: 3.3
});

export const BIRYONG_MAIN_PILLAR = Object.freeze({
  baseRadius: 0.72,
  topRadius: 0.5,
  height: 15, // ~30 m column above the platform
  capitalHeight: 0.35
});

// Four lower stone pillars lean on the main column at the diagonals.
export const BIRYONG_LOWER_PILLARS = Object.freeze([45, 135, 225, 315].map((angle, i) => Object.freeze({
  id: `biryong_lower_pillar_${i}`,
  angle,
  distance: 1.55,
  radius: 0.27,
  height: 3.4
})));

export const BIRYONG_DRAGON_BASE_Y = BIRYONG_PLATFORM.height + BIRYONG_MAIN_PILLAR.height + BIRYONG_MAIN_PILLAR.capitalHeight;

export const ECHO_CENTER = Object.freeze(add(BIRYONG_CENTER, toEcho, 7.6));
export const ECHO_CENTER_RADIUS = 0.6; // 1.2 m

// Two brackets "( )" of nine stones each; the gaps face the tower and the lawn.
export const ECHO_STONE_RING_RADIUS = 2.3;
export const ECHO_STONE_ARC_HALF_SPAN = 44;
export const ECHO_STONE_SIZE = Object.freeze({ width: 0.38, height: 0.5, depth: 0.34 });

function stoneRect(center, tangent, { width, depth }) {
  const normal = { x: -tangent.z, z: tangent.x };
  const w = width / 2, d = depth / 2;
  return [
    { x: center.x - tangent.x * w - normal.x * d, z: center.z - tangent.z * w - normal.z * d },
    { x: center.x + tangent.x * w - normal.x * d, z: center.z + tangent.z * w - normal.z * d },
    { x: center.x + tangent.x * w + normal.x * d, z: center.z + tangent.z * w + normal.z * d },
    { x: center.x - tangent.x * w + normal.x * d, z: center.z - tangent.z * w + normal.z * d }
  ];
}

const echoAxisAngle = Math.atan2(lateral.z, lateral.x) / deg;
export const ECHO_STONES = Object.freeze(['left', 'right'].flatMap((side, sideIndex) => {
  const middle = echoAxisAngle + (sideIndex ? 180 : 0);
  return Array.from({ length: 9 }, (_, i) => {
    const angle = middle - ECHO_STONE_ARC_HALF_SPAN + i * (ECHO_STONE_ARC_HALF_SPAN * 2 / 8);
    const radial = dir(angle);
    const position = add(ECHO_CENTER, radial, ECHO_STONE_RING_RADIUS);
    const tangent = { x: -radial.z, z: radial.x };
    // Slight, deterministic height variety keeps the row from reading as a fence.
    const height = ECHO_STONE_SIZE.height * (0.86 + ((i * 7 + sideIndex * 3) % 5) * 0.06);
    return Object.freeze({
      id: `echo_stone_${side}_${i + 1}`,
      side,
      index: i,
      x: position.x,
      z: position.z,
      yaw: -Math.atan2(tangent.z, tangent.x) / deg,
      height,
      polygon: Object.freeze(stoneRect(position, tangent, ECHO_STONE_SIZE).map(Object.freeze))
    });
  });
}));

// Benches face the tower along the walk between the platform and the echo park.
export const BIRYONG_BENCHES = Object.freeze([-1, 1].map((side, i) => {
  const at = add(add(BIRYONG_CENTER, toEcho, 4.6), lateral, side * 2.6);
  const tangent = toEcho;
  return Object.freeze({
    id: `biryong_bench_${i + 1}`,
    x: at.x,
    z: at.z,
    yaw: -Math.atan2(tangent.z, tangent.x) / deg,
    polygon: Object.freeze(stoneRect(at, tangent, { width: 1.3, depth: 0.42 }).map(Object.freeze))
  });
}));

function circle(center, radius, sides) {
  return Array.from({ length: sides }, (_, i) => {
    const a = i / sides * Math.PI * 2;
    return Object.freeze({ x: center.x + Math.cos(a) * radius, z: center.z + Math.sin(a) * radius });
  });
}

// Solid parts. Pillars are tall solids for navigation; stones and benches are low obstacles.
export const BIRYONG_COLLIDERS = Object.freeze([
  Object.freeze({ id: 'biryong_main_pillar', polygon: Object.freeze(circle(BIRYONG_CENTER, BIRYONG_MAIN_PILLAR.baseRadius, 10)), minY: 0, maxY: BIRYONG_DRAGON_BASE_Y }),
  ...BIRYONG_LOWER_PILLARS.map(p => Object.freeze({
    id: p.id,
    polygon: Object.freeze(circle(add(BIRYONG_CENTER, dir(p.angle), p.distance), p.radius, 8)),
    minY: 0,
    maxY: BIRYONG_PLATFORM.height + p.height
  })),
  ...ECHO_STONES.map(s => Object.freeze({ id: s.id, polygon: s.polygon, minY: 0, maxY: s.height })),
  ...BIRYONG_BENCHES.map(b => Object.freeze({ id: b.id, polygon: b.polygon, minY: 0, maxY: 0.24 }))
]);

// Walkable surface height (the invisible ramp) for the stepped base; 0 elsewhere.
export function biryongGroundHeight(x, z) {
  const r = Math.hypot(x - BIRYONG_CENTER.x, z - BIRYONG_CENTER.z);
  const { height, topRadius, footRadius } = BIRYONG_PLATFORM;
  if (r >= footRadius) return 0;
  if (r <= topRadius) return height;
  return height * (footRadius - r) / (footRadius - topRadius);
}

// Plaza walkway: service road → around the platform → into the echo ring → out to the lawn.
// Endpoints are joined to the campus graph by the existing junction rule (no solid in between).
const towerSideGap = add(ECHO_CENTER, toEcho, -(ECHO_STONE_RING_RADIUS + 0.5));
const lawnSideGap = add(ECHO_CENTER, toEcho, ECHO_STONE_RING_RADIUS + 0.5);
export const BIRYONG_PLAZA_PATHS = Object.freeze([
  Object.freeze({
    id: 'biryong_plaza_walk',
    points: Object.freeze([
      add(BIRYONG_CENTER, dir(330), 5.6),
      add(BIRYONG_CENTER, dir(280), 4.3),
      add(BIRYONG_CENTER, dir(245), 4.2),
      towerSideGap,
      { ...ECHO_CENTER },
      lawnSideGap,
      add(lawnSideGap, toEcho, 1.6)
    ].map(Object.freeze))
  })
]);

export const BIRYONG_APPROACH = Object.freeze({
  tower: Object.freeze({ ...towerSideGap, arrivalRadius: 2.4 }),
  echo: Object.freeze({ ...ECHO_CENTER, arrivalRadius: 0.45 })
});

// BR01 student waits beside the tower-side gap, facing the path in.
export const BIRYONG_EVENT_NPC = Object.freeze({
  id: 'biryong_student_001',
  name: '윤하람',
  role: '인하대 학생 · 비룡탑 단골',
  position: Object.freeze(add(towerSideGap, lateral, 1.35)),
  interactionRadius: 2.2
});

// Purposeful NPC hooks for P1 (data only; no NPC runtime reads these yet).
export const BIRYONG_IDLE_NODES = Object.freeze([
  { id: 'BIRYONG_IDLE_01', kind: 'idle', at: add(BIRYONG_CENTER, dir(260), 4.0) },
  { id: 'BIRYONG_IDLE_02', kind: 'idle', at: add(BIRYONG_CENTER, dir(170), 4.2) },
  { id: 'BIRYONG_BENCH_01', kind: 'bench', at: BIRYONG_BENCHES[0], benchId: BIRYONG_BENCHES[0].id },
  { id: 'BIRYONG_ECHO_01', kind: 'echo', at: ECHO_CENTER },
  { id: 'BIRYONG_MEETING_01', kind: 'meeting', at: add(towerSideGap, lateral, -1.4) }
].map(node => Object.freeze({ ...node, at: Object.freeze({ x: node.at.x, z: node.at.z }) })));

export const distanceTo = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const isNearBiryong = (p, radius = BIRYONG_DISCOVER_RADIUS) =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.z) && distanceTo(p, BIRYONG_CENTER) <= radius;
export const isAtEchoCenter = (p, radius = ECHO_CENTER_RADIUS) =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.z) && distanceTo(p, ECHO_CENTER) <= radius;
