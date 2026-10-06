// Social S1-B · Sit. Explicit seat anchors (game interaction data, not surveyed coordinates) and a
// small seat controller. Engine-free: main.js applies positions; PlayerController keeps physics.
//
// Priority: lifecycle (zone change, disconnect) and locomotion input (move, jump, mount) stand the
// player up. Occupancy is best-effort from what this client sees; two clients can still claim the
// same seat at the same moment (no distributed lock in S1).

import { POND_TREE_SEATING, pondSeatTrees, roadviewGroundHeight } from "./roadview-layout.js";
import { getPlaceZoneAt } from "./place-zone-registry.js";
import { BACK_FURNITURE, BACK_BENCH_SEAT } from './back-furniture-layout.js';
import { GARDEN_BENCHES, GARDEN_SEAT } from './library-garden-layout.js';
import { MATCHING_TREE } from './matching-tree-layout.js';

// World units (1 unit ≈ 2 m). Player standing origin sits 1.15 above the ground.
export const GROUND_ORIGIN_Y = 1.15;
export const SEAT_INTERACT_RANGE = 1.5;     // ~3 m from player to seat
export const SEAT_OCCUPIED_RADIUS = 0.35;   // a seated player this close to an anchor holds it
export const SIT_HIP_HEIGHT = 0.1;          // seat top to feet of the seated duck
export const SEAT_HIP_OUT = 0.08;           // hip sits slightly outboard of the slab centre
export const STAND_CLEARANCE = 0.6;         // step clear of the slab edge when standing up
export const SEAT_TOP_Y = POND_TREE_SEATING.slabY + POND_TREE_SEATING.slabSize[1] / 2;

const LETTERS = "ABCDEFGH";
const yawToward = (dx, dz) => Math.atan2(dx, dz) * 180 / Math.PI;

// Pond east-bank tree seats: 8 slabs per tree, facing outward from the trunk.
function pondSeatAnchors() {
  const { slabs, ringRadius, slabSize } = POND_TREE_SEATING;
  const depth = slabSize[2] / 2;
  return pondSeatTrees().flatMap((tree) => Array.from({ length: slabs }, (_, i) => {
    const a = i * Math.PI * 2 / slabs;
    const dir = { x: Math.cos(a), z: Math.sin(a) };
    const seat = { x: tree.center.x + dir.x * (ringRadius + SEAT_HIP_OUT), z: tree.center.z + dir.z * (ringRadius + SEAT_HIP_OUT) };
    const stand = { x: tree.center.x + dir.x * (ringRadius + depth + STAND_CLEARANCE), z: tree.center.z + dir.z * (ringRadius + depth + STAND_CLEARANCE) };
    return Object.freeze({
      id: `SEAT_INKYUNG_TREE_${tree.index + 1}_${LETTERS[i]}`,
      interactableId: `INKYUNG_TREE_SEAT_${tree.index + 1}`,
      type: "seat",
      placeZoneId: getPlaceZoneAt(seat)?.id ?? null,
      position: Object.freeze({ x: seat.x, y: GROUND_ORIGIN_Y + SEAT_TOP_Y - SIT_HIP_HEIGHT + roadviewGroundHeight(seat.x, seat.z), z: seat.z }),
      yaw: yawToward(dir.x, dir.z),
      standPoint: Object.freeze({ x: stand.x, y: GROUND_ORIGIN_Y + roadviewGroundHeight(stand.x, stand.z), z: stand.z })
    });
  }));
}

// Two places per back-gate bench, looking toward the sidewalk. Derive the
// seat top and stand-out direction from the same frame as the rendered bench.
function benchAnchors(benches,seatDimensions){
  return benches.flatMap(q=>[-.25,.25].map((u,i)=>{
    const seat=q.frame.at(u,.04),stand=q.frame.at(u,.9),front=q.frame.at(0,1),origin=q.frame.at(0);
    const approachDirection=Object.freeze({x:front.x-origin.x,z:front.z-origin.z});
    return Object.freeze({
      id:`SEAT_${q.id}_${i+1}`,interactableId:q.id,type:'seat',placeZoneId:getPlaceZoneAt(seat)?.id??null,
      position:Object.freeze({...seat,y:GROUND_ORIGIN_Y+roadviewGroundHeight(seat.x,seat.z)+seatDimensions.centerY+seatDimensions.slatHeight/2-SIT_HIP_HEIGHT}),
      yaw:yawToward(approachDirection.x,approachDirection.z),approachDirection,
      standPoint:Object.freeze({...stand,y:GROUND_ORIGIN_Y+roadviewGroundHeight(stand.x,stand.z)})
    });
  }));
}
// Existing public seating semantics; only two source-aligned anchors are added.
function matchingTreeAnchors(){
  const t=MATCHING_TREE;
  return t.seatOffsets.map((u,i)=>{
    const seat=t.at(u,t.seatV),stand=t.at(u,t.standV);
    return Object.freeze({id:`SEAT_MATCHING_TREE_${i?'B':'A'}`,interactableId:t.id,type:'seat',
      placeZoneId:getPlaceZoneAt(seat)?.id??null,approachDirection:t.front,yaw:t.yaw,
      position:Object.freeze({...seat,y:GROUND_ORIGIN_Y+t.seatTopY-SIT_HIP_HEIGHT+roadviewGroundHeight(seat.x,seat.z)}),
      standPoint:Object.freeze({...stand,y:GROUND_ORIGIN_Y+roadviewGroundHeight(stand.x,stand.z)})});
  });
}
export const SEAT_ANCHORS = Object.freeze([...pondSeatAnchors(),
  ...benchAnchors(BACK_FURNITURE.filter(q=>q.kind==='bench'),BACK_BENCH_SEAT),...benchAnchors(GARDEN_BENCHES,GARDEN_SEAT),...matchingTreeAnchors()]);

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function isSeatOccupied(anchor, occupants) {
  return occupants.some((p) => flat(p, anchor.position) <= SEAT_OCCUPIED_RADIUS);
}

// Nearest free seat within reach of `position`, or null.
export function findSeat(position, { occupants = [], anchors = SEAT_ANCHORS, range = SEAT_INTERACT_RANGE } = {}) {
  let best = null;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    // Back-gate benches are reached from the front, not through the boundary wall.
    if(anchor.approachDirection){
      const front=(position.x-anchor.position.x)*anchor.approachDirection.x+(position.z-anchor.position.z)*anchor.approachDirection.z;
      if(front<.12)continue;
    }
    const d = flat(position, anchor.position);
    if (d > range || d >= bestDistance || isSeatOccupied(anchor, occupants)) continue;
    best = anchor;
    bestDistance = d;
  }
  return best;
}

const MOVE_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

// Reads (never writes) PlayerController input: does the player want to leave the seat?
export function locomotionIntent(controller) {
  const touch = Math.hypot(controller.touchVector?.x ?? 0, controller.touchVector?.y ?? 0) > 0.04;
  return {
    move: touch || MOVE_KEYS.some((k) => controller.keys?.has(k)),
    jump: controller.jumpQueued === true || controller.keys?.has("Space") === true,
    mount: controller.mounted === true
  };
}

// Procedural seated pose on top of the rest pose (legs forward, slight lean back).
export const SIT_OFFSETS = Object.freeze({
  bodyY: 0, bodyPitch: -6, bodyYaw: 0, bodyRoll: 0,
  wingL: Object.freeze([0, 0, -8]), wingR: Object.freeze([0, 0, 8]),
  legL: 70, legR: 70
});

export class SeatController {
  constructor() {
    this.seated = null;
    this.listeners = new Set();
    this.stats = { sat: 0, stood: 0 };
  }

  onChange(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  #emit(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* UI never breaks seating */ }
    }
  }

  get isSeated() { return this.seated !== null; }

  // Returns the anchor to align to, or null if it cannot be taken now.
  sit(anchor, { occupants = [] } = {}) {
    if (this.seated || !anchor || isSeatOccupied(anchor, occupants)) return null;
    this.seated = anchor;
    this.stats.sat += 1;
    this.#emit({ type: "sit", anchor });
    return anchor;
  }

  // Returns the safe standing point, or null if not seated.
  stand(reason = "stand") {
    if (!this.seated) return null;
    const anchor = this.seated;
    this.seated = null;
    this.stats.stood += 1;
    this.#emit({ type: "stand", anchor, reason });
    return anchor.standPoint;
  }

  // Call each frame while seated. Returns the stand reason, or null to stay seated.
  shouldStand({ intent, placeZoneId }) {
    if (!this.seated) return null;
    if (intent.mount) return "mount";
    if (intent.jump) return "jump";
    if (intent.move) return "move";
    if (placeZoneId !== undefined && placeZoneId !== this.seated.placeZoneId) return "zone";
    return null;
  }
}
