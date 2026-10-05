// First dormitory (제1생활관) gameplay presentation contract.
// Reality footprint stays owned by campus-facilities.json; this module derives the campus-facing
// entrance/return anchors without duplicating source coordinates.

import { FACILITIES } from "./campus-facilities.js";
import { GEO_ORIGIN } from "./geo-coordinates.js";

const DORM_ID = "bldg_dorm1";
const dorm = FACILITIES.find(f => f.id === DORM_ID);
if (!dorm?.rings?.[0]?.length) throw new Error("First dormitory footprint is unavailable");

const ring = dorm.rings[0];
const gate = Object.freeze({ x: GEO_ORIGIN.x, z: GEO_ORIGIN.z });
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });

const edges = ring.map((a, index) => {
  const b = ring[(index + 1) % ring.length];
  const mid = midpoint(a, b);
  return { index, a, b, mid, length: flat(a, b), gateDistance: flat(mid, gate) };
}).filter(edge => edge.length >= 6);

if (!edges.length) throw new Error("First dormitory has no usable facade edge");

// P0 housing entrance: choose the substantial footprint edge facing the campus/main-gate side.
// This is presentation placement, not a surveyed doorway. Field/photo revalidation can replace
// this one derivation without changing the Reality polygon or Room authority.
const front = edges.slice().sort((a, b) => a.gateDistance - b.gateDistance || b.length - a.length)[0];
const dx = front.b.x - front.a.x;
const dz = front.b.z - front.a.z;
const inv = 1 / Math.hypot(dx, dz);
const along = Object.freeze({ x: dx * inv, z: dz * inv });
const normals = [
  { x: -along.z, z: along.x },
  { x: along.z, z: -along.x }
];
const towardGate = { x: gate.x - front.mid.x, z: gate.z - front.mid.z };
const outward = Object.freeze(normals.reduce((best, n) =>
  n.x * towardGate.x + n.z * towardGate.z > best.x * towardGate.x + best.z * towardGate.z ? n : best
));
const at = (u, v) => Object.freeze({
  x: front.mid.x + along.x * u + outward.x * v,
  z: front.mid.z + along.z * u + outward.z * v
});
const facing = (x, z) => Math.atan2(x, z) * 180 / Math.PI;

export const DORM_1_FRAME = Object.freeze({
  buildingId: DORM_ID,
  placeZoneId: "AREA_DORM_SOUTH",
  edgeIndex: front.index,
  midpoint: Object.freeze(front.mid),
  length: front.length,
  along,
  outward,
  yaw: -Math.atan2(along.z, along.x) * 180 / Math.PI,
  at
});

export const DORM_1_ENTRANCE = Object.freeze({
  id: "DORM_1_ENTRANCE",
  buildingId: DORM_ID,
  placeZoneId: "AREA_DORM_SOUTH",
  position: at(0, 0.55),
  facingYaw: facing(-outward.x, -outward.z),
  radius: 1.8,
  status: "ACTIVE"
});

export const DORM_1_CAMPUS_RETURN = Object.freeze({
  id: "DORM_1_CAMPUS_RETURN",
  placeZoneId: "AREA_DORM_SOUTH",
  position: Object.freeze({ ...at(0, 3.4), y: 1.15 }),
  yaw: facing(outward.x, outward.z)
});

export const DORM_1_APPROACH = Object.freeze({
  id: "DORM_1_APPROACH",
  from: gate,
  to: Object.freeze({ x: DORM_1_CAMPUS_RETURN.position.x, z: DORM_1_CAMPUS_RETURN.position.z })
});
