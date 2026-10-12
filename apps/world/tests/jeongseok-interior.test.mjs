// JSL-B · Jeongseok 1F/B1 interior: evidence, layouts, walkability, camera, entry policy and the
// campus → lobby → B1 → lobby → campus Room Transition loop (engine-free with fakes).
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const pcStub = `
export class Color { constructor(r=0,g=0,b=0,a=1){Object.assign(this,{r,g,b,a});} clone(){return new Color(this.r,this.g,this.b,this.a);} }
export class StandardMaterial { update(){} }
export const FRESNEL_SCHLICK = 2, BLEND_NORMAL = 2, CULLFACE_NONE = 0;
`;
registerHooks({ resolve(specifier, context, next) {
  return specifier === "playcanvas"
    ? { url: `data:text/javascript,${encodeURIComponent(pcStub)}`, shortCircuit: true }
    : next(specifier, context);
} });

const { canOccupy, cameraSafeFraction } = await import("../src/world-collision.js");
const { WALK_SHAPE, PLAYER_ORIGIN_Y } = await import("../src/player-dimensions.js");
const { PlaceZoneRegistry } = await import("../src/place-zone-registry.js");
const { LIBRARY_FRONT } = await import("../src/basic-campus.js");
const { roadviewGroundHeight } = await import("../src/roadview-layout.js");
const { CAMPUS_SPACE, RETURN_ANCHORS, ROOMS, ROOM_ENTRANCES } = await import("../src/rooms/room-registry.js");
const { createRoomTransition, ROOM_TRANSITION_COOLDOWN_MS } = await import("../src/rooms/room-transition.js");
const { JEONGSEOK_EVIDENCE, JEONGSEOK_INTERIOR_CLAIM, SOURCE_CLASS, isEvidenceId, isSourceClass } = await import("../src/jeongseok/interior-evidence.js");
const { CEILING_CAMERA_CLEARANCE, seatCount } = await import("../src/jeongseok/interior-kit.js");
const {
  JEONGSEOK_CAMPUS_RETURN, JEONGSEOK_ENTRANCE, JEONGSEOK_LAYOUTS, JEONGSEOK_ROOM_IDS,
  JEONGSEOK_LOBBY_ROOM_ID: LOBBY, JEONGSEOK_B1_READING_ROOM_ID: READING, JEONGSEOK_B1_CREATIVE_ROOM_ID: CREATIVE
} = await import("../src/jeongseok/interior-rooms.js");
const { JEONGSEOK_LOBBY_GATE_SLOT, gateRow } = await import("../src/jeongseok/lobby-layout.js");
const { JEONGSEOK_B1_READING } = await import("../src/jeongseok/b1-reading-layout.js");
const { GROUP_STUDY_ROOM_SLOTS, JEONGSEOK_B1_CREATIVE } = await import("../src/jeongseok/b1-creative-layout.js");
const { createJeongseokEntryPolicy, resolveJeongseokEntryMode, JEONGSEOK_ENTRY_MODE, JEONGSEOK_ACCESS_POLICY_KEY, JEONGSEOK_GRANT_TTL_MS } = await import("../src/jeongseok/entry-policy.js");
const { createJeongseokInterior } = await import("../src/jeongseok/interior-feature.js");
const { buildRoomGeometry } = await import("../src/jeongseok/interior-renderer.js");
const { createStaticBatch } = await import("../src/jeongseok/static-batch.js");

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const LAYOUTS = Object.values(JEONGSEOK_LAYOUTS);
const pointAt = (position) => ({ x: position.x, y: PLAYER_ORIGIN_Y, z: position.z });
const free = (layout, position, obstacles = layout.obstacles) => canOccupy(pointAt(position), WALK_SHAPE, obstacles);

// ------------------------------------------------------------------ evidence
test("every Jeongseok space, module, portal and anchor carries a sourceClass and known evidence ids", () => {
  const traces = [];
  for (const layout of LAYOUTS) {
    for (const [key, trace] of Object.entries(layout.shell.trace)) traces.push([`${layout.roomId}.shell.${key}`, trace]);
    for (const entry of layout.items) traces.push([`${layout.roomId}.${entry.id}`, entry.trace]);
    for (const portal of layout.portals) traces.push([`${layout.roomId}.${portal.id}`, portal.trace]);
    traces.push([`${layout.roomId}.spawn`, layout.spawn.trace], [`${layout.roomId}.exit`, layout.exit.trace]);
  }
  traces.push(["entrance", JEONGSEOK_ENTRANCE.trace], ["campus-return", JEONGSEOK_CAMPUS_RETURN.trace]);
  assert.ok(traces.length > 200);
  for (const [id, trace] of traces) {
    assert.ok(isSourceClass(trace?.sourceClass), `${id} sourceClass`);
    assert.ok(trace.evidence.length > 0 && trace.evidence.every(isEvidenceId), `${id} evidence ids`);
  }
  const classes = new Set(traces.map(([, trace]) => trace.sourceClass));
  for (const cls of [SOURCE_CLASS.HISTORICAL, SOURCE_CLASS.OBSERVED_MUSE, SOURCE_CLASS.GAME_ADAPTATION]) assert.ok(classes.has(cls), cls);
  assert.equal(JEONGSEOK_INTERIOR_CLAIM.realityReproduction, false, "a blockout is never a reality reproduction");
  assert.ok(JEONGSEOK_INTERIOR_CLAIM.heldUnknowns.length >= 6);
  for (const evidence of Object.values(JEONGSEOK_EVIDENCE)) assert.ok(!/\.(png|jpe?g|webp)$/i.test(evidence.id));
});

test("transfers and anchors are GAME_ADAPTATION; the gate row is HISTORICAL with a replaceable slot", () => {
  for (const layout of LAYOUTS) {
    for (const portal of layout.portals) assert.equal(portal.trace.sourceClass, SOURCE_CLASS.GAME_ADAPTATION, portal.id);
    assert.equal(layout.exit.trace.sourceClass, SOURCE_CLASS.GAME_ADAPTATION);
    assert.equal(layout.spawn.trace.sourceClass, SOURCE_CLASS.GAME_ADAPTATION);
    for (const portal of layout.portals) assert.match(portal.label, /임시/, "the UI never claims a real stair or elevator");
  }
  assert.equal(JEONGSEOK_LOBBY_GATE_SLOT.trace.sourceClass, SOURCE_CLASS.HISTORICAL);
  assert.deepEqual(JEONGSEOK_LOBBY_GATE_SLOT.trace.evidence, ["JSL-R0-F03-LOBBY-2015"]);
  assert.equal(JEONGSEOK_LOBBY_GATE_SLOT.placement.sourceClass, SOURCE_CLASS.GAME_ADAPTATION);
  // The gate module is a pure function of its slot: a different slot moves and resizes it.
  const moved = gateRow({ ...JEONGSEOK_LOBBY_GATE_SLOT, center: { x: 1, z: -2 }, lanes: [1, 1] });
  assert.equal(moved.laneCenters.length, 2);
  assert.ok(moved.items.filter(entry => entry.module === "gate_cabinet").every(entry => entry.at[2] === -2));
});

test("B1 reading room keeps the merged 2026 room: no rebuilt 2-1/2-2 wall, no graduate-only partition, not 474 seats", () => {
  const layout = JEONGSEOK_LAYOUTS[READING];
  assert.equal(JEONGSEOK_B1_READING.mergedRoom.dividingWallRebuilt, false);
  assert.equal(JEONGSEOK_B1_READING.graduateOnlyServiceSeats.physicalPartition, false);
  assert.equal(JEONGSEOK_B1_READING.articleSeatReference.gameRequirement, false);
  assert.ok(!layout.items.some(entry => /wall|partition_2|graduate/i.test(entry.id) && entry.module !== "carrel_row"));
  // Interior obstacles that span the room depth would split it; only the shell may do that.
  const interior = layout.obstacles.filter(box => !/_wall_|_ceiling/.test(box.id));
  assert.ok(interior.every(box => box.maxZ - box.minZ < 4 && box.maxX - box.minX < 6), "no room-dividing wall");
  const seats = seatCount(layout.items);
  assert.ok(seats > 40 && seats < 474, `representative seats (${seats})`);
  for (const module of ["open_table", "carrel_row", "standing_counter", "accessible_desk", "column_wood", "room_sign_2"])
    assert.ok(layout.items.some(entry => entry.module === module), module);
  assert.ok(layout.items.filter(entry => entry.module === "column_wood").every(entry => entry.trace.sourceClass === SOURCE_CLASS.OBSERVED_MUSE));
});

test("Creative Space separates study and lecture zones; structural columns are not light fittings", () => {
  const layout = JEONGSEOK_LAYOUTS[CREATIVE];
  const { partition } = JEONGSEOK_B1_CREATIVE;
  const study = layout.items.filter(entry => entry.at[0] < partition.minX);
  const lecture = layout.items.filter(entry => entry.at[0] > partition.maxX);
  const columns = layout.items.filter(entry => entry.module === "column_round_slat");
  assert.equal(columns.length, 4);
  for (const column of columns) {
    assert.ok(study.includes(column), "slat columns live in the study zone");
    assert.equal(column.at[1], 0); assert.equal(column.size[1], JEONGSEOK_B1_CREATIVE.ceiling, "floor to ceiling");
    assert.equal(column.collide, true);
  }
  for (const fitting of layout.items.filter(entry => ["ring_pendant", "ceiling_cylinder"].includes(entry.module))) {
    assert.ok(lecture.includes(fitting));
    assert.equal(fitting.collide, false); assert.ok(fitting.at[1] > 1, "hangs from the ceiling, never reaches the floor");
  }
  for (const module of ["tiered_seating", "lecture_screen", "lectern"]) assert.ok(lecture.some(entry => entry.module === module), module);
  for (const module of ["long_table", "sofa", "curved_glass", "glass_wall"]) assert.ok(study.some(entry => entry.module === module), module);
  assert.equal(partition.trace.sourceClass, SOURCE_CLASS.GAME_ADAPTATION);
  assert.equal(GROUP_STUDY_ROOM_SLOTS.length, 8, "official eight-room configuration");
  assert.equal(GROUP_STUDY_ROOM_SLOTS.filter(slot => slot.status === "PLACED").length, 2);
  for (const slot of GROUP_STUDY_ROOM_SLOTS.filter(slot => slot.status !== "PLACED")) {
    assert.equal(slot.status, "RESERVED_UNPLACED"); assert.equal(slot.minX, undefined, "no invented coordinates");
  }
});

// ------------------------------------------------------------------ registry and campus anchors
test("Jeongseok rooms are ROOM_* spaces gated by a policy; the exterior is not rebuilt", async () => {
  for (const id of JEONGSEOK_ROOM_IDS) {
    assert.ok(ROOMS[id]); assert.equal(ROOMS[id].access, JEONGSEOK_ACCESS_POLICY_KEY);
    assert.ok(!new PlaceZoneRegistry().zones.some(zone => zone.id === id));
  }
  assert.ok(ROOM_ENTRANCES.includes(JEONGSEOK_ENTRANCE));
  assert.equal(JEONGSEOK_ENTRANCE.buildingId, "bldg_jungseok");
  assert.equal(new PlaceZoneRegistry().getPlaceZoneAt(JEONGSEOK_ENTRANCE.position)?.id, "AREA_JUNGSEOK_WOONAM");
  assert.equal(RETURN_ANCHORS[JEONGSEOK_ENTRANCE.returnAnchor], JEONGSEOK_CAMPUS_RETURN);
  const { readFile } = await import("node:fs/promises");
  for (const file of ["interior-renderer.js", "interior-rooms.js", "lobby-layout.js"]) {
    const source = await readFile(new URL(`../src/jeongseok/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /buildJeongseokCandidate|buildMainHallBlockout/, `${file} never mounts another facade`);
  }
});

test("campus entrance and return anchor sit on the walkable front landing, apart from each other and the JSL-A reader", () => {
  const ground = p => roadviewGroundHeight(p.x, p.z);
  assert.ok(Math.abs(ground(JEONGSEOK_ENTRANCE.position) - 1.65) < 1e-9, "entrance on the 1.65 game landing");
  assert.ok(canOccupy({ ...JEONGSEOK_ENTRANCE.position, y: PLAYER_ORIGIN_Y + ground(JEONGSEOK_ENTRANCE.position) }), "entrance reachable");
  const back = JEONGSEOK_CAMPUS_RETURN.position;
  assert.ok(Math.abs(back.y - (PLAYER_ORIGIN_Y + ground(back))) < 1e-9, "return stands exactly on the landing");
  assert.ok(canOccupy(back), "return outside every campus collider");
  assert.ok(flat(back, JEONGSEOK_ENTRANCE.position) > JEONGSEOK_ENTRANCE.radius + 1, "no bounce back in");
  const jslAReader = LIBRARY_FRONT.at(0, 1.0); // PR #358 temporary reader, radius 2.2
  assert.ok(flat(back, jslAReader) > 2.2, "leaving does not land on the JSL-A reader");
  assert.equal(new PlaceZoneRegistry().getPlaceZoneAt(back)?.id, "AREA_JUNGSEOK_WOONAM");
  const outward = LIBRARY_FRONT.at(0, 1), origin = LIBRARY_FRONT.at(0, 0);
  const yaw = Math.atan2(outward.x - origin.x, outward.z - origin.z) * 180 / Math.PI;
  assert.ok(Math.abs(JEONGSEOK_CAMPUS_RETURN.yaw - yaw) < 1e-9, "faces away from the doors");
});

// ------------------------------------------------------------------ walkability, aisles, camera
function reachable(layout, from, obstacles = layout.obstacles, step = 0.2) {
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const cols = Math.floor((maxX - minX) / step) + 1, rows = Math.floor((maxZ - minZ) / step) + 1;
  const key = (i, j) => i * rows + j, seen = new Uint8Array(cols * rows), ok = new Uint8Array(cols * rows);
  const at = (i, j) => ({ x: minX + i * step, z: minZ + j * step });
  for (let i = 0; i < cols; i += 1) for (let j = 0; j < rows; j += 1) ok[key(i, j)] = free(layout, at(i, j), obstacles) ? 1 : 0;
  const start = [Math.round((from.x - minX) / step), Math.round((from.z - minZ) / step)];
  const queue = [start]; seen[key(...start)] = 1;
  while (queue.length) {
    const [i, j] = queue.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= cols || b >= rows || seen[key(a, b)] || !ok[key(a, b)]) continue;
      seen[key(a, b)] = 1; queue.push([a, b]);
    }
  }
  return p => { const i = Math.round((p.x - minX) / step), j = Math.round((p.z - minZ) / step); return seen[key(i, j)] === 1; };
}
const targets = layout => [
  ["exit", layout.exit.position], ...layout.portals.map(portal => [portal.id, portal.position]),
  ...layout.portals.filter(portal => portal.returnAnchor).map(portal => [`${portal.id}:return`, portal.returnAnchor.position]),
  ...layout.portals.filter(portal => portal.arrival).map(portal => [`${portal.id}:arrival`, portal.arrival.position])
];

test("spawn, exits, transfers and arrivals are free, inside bounds and connected for the player", () => {
  for (const layout of LAYOUTS) {
    const reach = reachable(layout, layout.spawn.position);
    assert.ok(free(layout, layout.spawn.position), `${layout.roomId} spawn free`);
    assert.ok(flat(layout.spawn.position, layout.exit.position) > layout.exit.radius, "arrival never sits on the exit");
    for (const [id, p] of targets(layout)) {
      const { minX, maxX, minZ, maxZ } = layout.bounds;
      assert.ok(p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ, `${layout.roomId}.${id} in bounds`);
      assert.ok(reach(p), `${layout.roomId}.${id} reachable from spawn`);
    }
    for (const portal of layout.portals) {
      const arrival = portal.returnAnchor?.position ?? portal.arrival?.position;
      assert.ok(free(layout, arrival) || !portal.returnAnchor, `${portal.id} arrival free`);
      assert.ok(flat(arrival, portal.position) > portal.radius || portal.arrival, `${portal.id} return outside its radius`);
    }
  }
  // Arrivals from a B1 link land outside the other room's link radius (no ping-pong).
  for (const layout of [JEONGSEOK_LAYOUTS[READING], JEONGSEOK_LAYOUTS[CREATIVE]]) for (const portal of layout.portals) {
    const target = JEONGSEOK_LAYOUTS[portal.target];
    assert.ok(free(target, portal.arrival.position));
    for (const other of target.portals) assert.ok(flat(portal.arrival.position, other.position) > other.radius);
    assert.ok(flat(portal.arrival.position, target.exit.position) > target.exit.radius);
  }
});

test("lobby gates are the only way from the entry vestibule to the inner lobby", () => {
  const layout = JEONGSEOK_LAYOUTS[LOBBY];
  const inner = layout.portals[0].position;
  assert.ok(reachable(layout, layout.spawn.position)(inner), "open lanes connect");
  for (const lane of layout.gateLanes) assert.ok(lane.width >= 0.9 && lane.width > 2 * WALK_SHAPE.radius + 0.3);
  const closed = [...layout.obstacles, ...layout.gateLanes.map((lane, i) => ({ id: `closed_${i}`, minX: lane.x - lane.width / 2,
    maxX: lane.x + lane.width / 2, minZ: lane.z - 0.05, maxZ: lane.z + 0.05, minY: 0, maxY: 1 }))];
  assert.equal(reachable(layout, layout.spawn.position, closed)(inner), false, "no bypass around the gate row");
});

test("declared NPC aisles keep their full width clear of furniture and walls", () => {
  for (const layout of LAYOUTS) {
    assert.ok(layout.aisles.length >= 2);
    const ground = layout.obstacles.filter(box => box.minY < 1);
    for (const aisle of layout.aisles) {
      const shape = { radius: aisle.width / 2, footOffset: WALK_SHAPE.footOffset, headOffset: WALK_SHAPE.headOffset };
      for (let k = 1; k < aisle.points.length; k += 1) {
        const a = aisle.points[k - 1], b = aisle.points[k], n = Math.ceil(flat(a, b) / 0.1);
        for (let s = 0; s <= n; s += 1) {
          const p = { x: a.x + (b.x - a.x) * s / n, y: PLAYER_ORIGIN_Y, z: a.z + (b.z - a.z) * s / n };
          assert.ok(canOccupy(p, shape, ground), `${layout.roomId}.${aisle.id} clear at ${p.x.toFixed(2)},${p.z.toFixed(2)}`);
        }
      }
    }
  }
});

test("third-person camera stays inside the walls and under the ceiling at every reachable pose", () => {
  for (const layout of LAYOUTS) {
    const { halfWidth: W, halfDepth: D, ceiling: H } = layout.shell, limits = ROOMS[layout.roomId].cameraLimits;
    assert.ok(limits.max <= 5 && limits.min >= 1);
    const reach = reachable(layout, layout.spawn.position, layout.obstacles, 0.6);
    let samples = 0;
    for (let x = -W + 0.5; x < W; x += 1.3) for (let z = -D + 0.5; z < D; z += 1.3) {
      const p = { x, z };
      if (!free(layout, p) || !reach(p)) continue;
      for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) for (const pitch of [0.12, 0.7, 1.2]) {
        const eye = [x, PLAYER_ORIGIN_Y - 0.35, z];
        const h = Math.cos(pitch) * limits.max;
        const candidate = [x + Math.sin(yaw) * h, eye[1] + Math.sin(pitch) * limits.max, z - Math.cos(yaw) * h];
        const f = cameraSafeFraction(eye, candidate, layout.obstacles);
        const cam = eye.map((v, i) => v + (candidate[i] - v) * f);
        assert.ok(cam[1] <= H - CEILING_CAMERA_CLEARANCE + 1e-6, `${layout.roomId} camera under ceiling clearance`);
        assert.ok(Math.abs(cam[0]) < W - 0.15 && Math.abs(cam[2]) < D - 0.15, `${layout.roomId} camera never reaches a wall plane`);
        samples += 1;
      }
    }
    assert.ok(samples > 300, `${layout.roomId} sampled ${samples}`);
    // Low ceilings and furniture still leave head room for the player.
    assert.ok(H - CEILING_CAMERA_CLEARANCE > PLAYER_ORIGIN_Y + WALK_SHAPE.headOffset + 0.1);
  }
});

// ------------------------------------------------------------------ entry policy
test("entry mode is CLOSED unless a preview host asks for the local visual review; server mode is JSL-A only", () => {
  assert.equal(resolveJeongseokEntryMode({}), JEONGSEOK_ENTRY_MODE.CLOSED);
  assert.equal(resolveJeongseokEntryMode({ previewHost: false, params: new URLSearchParams("jeongseok=jsl-b") }), JEONGSEOK_ENTRY_MODE.CLOSED);
  assert.equal(resolveJeongseokEntryMode({ previewHost: true, params: new URLSearchParams("jeongseok=jsl-a") }), JEONGSEOK_ENTRY_MODE.CLOSED);
  assert.equal(resolveJeongseokEntryMode({ previewHost: true, params: new URLSearchParams("jeongseok=jsl-b") }), JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW);
  assert.equal(resolveJeongseokEntryMode({ serverAccessAvailable: true }), JEONGSEOK_ENTRY_MODE.SERVER_GRANT);
  const closed = createJeongseokEntryPolicy();
  assert.equal(closed.allowsEntry(), false); assert.equal(closed.allowsStay(), false);
  assert.equal(closed.acceptServerGrant({ granted: true, decision: "GRANTED", userId: "a" }), false);
  assert.throws(() => createJeongseokEntryPolicy({ mode: "OPEN" }));
});

const userA = "00000000-0000-4000-8000-00000000000a", userB = "00000000-0000-4000-8000-00000000000b";
const granted = (userId, extra = {}) => ({ decision: "GRANTED", granted: true, via: "INHA_MAIL", userId, pass: null, clockOffsetMs: 0, ...extra });

test("server grants are fresh, account-bound, single-use and expire with the visitor pass", () => {
  const clock = { t: 1_000_000, now() { return this.t; } };
  const policy = createJeongseokEntryPolicy({ mode: JEONGSEOK_ENTRY_MODE.SERVER_GRANT, clock });
  assert.equal(policy.acceptServerGrant(granted(userA)), false, "no account bound yet");
  policy.setAccount(userA);
  for (const bad of [null, {}, granted(userB), { ...granted(userA), granted: false }, { ...granted(userA), decision: "NEEDS_PASS" },
    granted(userA, { via: "VISITOR_PASS", pass: { expiresAt: new Date(clock.t - 1).toISOString() } })])
    assert.equal(policy.acceptServerGrant(bad), false);
  assert.equal(policy.allowsEntry(), false);
  assert.equal(policy.acceptServerGrant(granted(userA, { via: "VISITOR_PASS", pass: { expiresAt: new Date(clock.t + 60_000).toISOString() } })), true);
  assert.equal(policy.allowsEntry(), true);
  clock.t += JEONGSEOK_GRANT_TTL_MS + 1;
  assert.equal(policy.allowsEntry(), false, "an unused grant goes stale");
  policy.acceptServerGrant(granted(userA, { via: "VISITOR_PASS", pass: { expiresAt: new Date(clock.t + 60_000).toISOString() } }));
  assert.equal(policy.commitEntry(), true);
  assert.equal(policy.allowsEntry(), false, "single use"); assert.equal(policy.allowsStay(), true);
  clock.t += 60_001;
  assert.equal(policy.allowsStay(), false, "visitor pass expiry ends the stay");
  policy.acceptServerGrant(granted(userA)); policy.commitEntry();
  assert.equal(policy.allowsStay(), true, "Inha mail access has no pass expiry");
  assert.equal(policy.revalidate({ ...granted(userA), granted: false, decision: "ACCOUNT_BLOCKED" }), false);
  assert.equal(policy.status().lastRevocation, "SERVER_ACCOUNT_BLOCKED");
  policy.acceptServerGrant(granted(userA)); policy.commitEntry();
  policy.setAccount(userB);
  assert.equal(policy.allowsStay(), false); assert.equal(policy.status().lastRevocation, "ACCOUNT_CHANGED");
});

// ------------------------------------------------------------------ the full loop with fakes
function rig({ mode = JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW, failStep = null, asyncFade = false } = {}) {
  const clock = { t: 0, now() { return this.t; } };
  const calls = [];
  let fail = failStep;
  const world = {
    getPlaceZoneId: () => "AREA_JUNGSEOK_WOONAM",
    createCheckpoint: () => () => calls.push(["restore"]),
    leaveCampus: room => calls.push(["leaveCampus", room.id]),
    showRoom: room => { if (fail === "showRoom") { fail = null; throw new Error("injected"); } calls.push(["showRoom", room.id]); },
    showCampus: room => calls.push(["showCampus", room.id]),
    resumeCampus: () => calls.push(["resumeCampus"]),
    placePlayer: (position, yaw) => calls.push(["placePlayer", { x: position.x, z: position.z }, yaw])
  };
  let release = null;
  const fade = asyncFade ? run => new Promise(resolve => { release = () => resolve(run()); }) : run => run();
  const errors = [];
  let interior = null;
  const rooms = createRoomTransition({ world, clock, fade, onError: info => errors.push(info),
    accessPolicies: { [JEONGSEOK_ACCESS_POLICY_KEY]: (entrance, room) => interior?.accessPredicate(entrance, room) === true } });
  const policy = createJeongseokEntryPolicy({ mode, clock: { now: () => 5_000_000 + clock.t } });
  const released = [];
  const statuses = [];
  interior = createJeongseokInterior({ rooms, policy, scenes: { releaseAll: () => released.push(true) }, onStatus: text => statuses.push(text) });
  const tick = () => { clock.t += ROOM_TRANSITION_COOLDOWN_MS + 1; };
  return { rooms, interior, policy, calls, clock, tick, released, errors, statuses, finishFade: () => release?.() };
}
const action = (interior, position, extra = {}) => interior.contextAction({ position, grounded: true, mounted: false, ...extra });

test("campus → lobby → B1 reading → B1 creative → lobby → campus closes one loop at the safe anchors", () => {
  const { rooms, interior, calls, tick, released } = rig();
  assert.equal(rooms.contextAction({ position: JEONGSEOK_ENTRANCE.position }), null, "the generic door never opens Jeongseok");
  const door = action(interior, JEONGSEOK_ENTRANCE.position);
  assert.equal(door.id, "jeongseok-door"); assert.match(door.label, /미리보기/);
  assert.equal(action(interior, JEONGSEOK_ENTRANCE.position, { mounted: true }), null, "mounted players get no door");
  assert.equal(door.trigger(), true);
  assert.equal(door.trigger(), false, "a double press never starts a second entry");
  assert.equal(rooms.currentSpace, LOBBY);
  assert.deepEqual(rooms.status().returnContext, { sourceSpace: CAMPUS_SPACE, placeZoneId: "AREA_JUNGSEOK_WOONAM",
    entranceId: "JEONGSEOK_ENTRANCE", returnAnchor: "JEONGSEOK_CAMPUS_RETURN" });
  tick();
  const lobby = JEONGSEOK_LAYOUTS[LOBBY];
  const toReading = lobby.portals.find(portal => portal.target === READING), toCreative = lobby.portals.find(portal => portal.target === CREATIVE);
  assert.equal(action(interior, toReading.position).trigger(), true);
  assert.equal(rooms.currentSpace, READING); assert.equal(rooms.status().parentRoomId, LOBBY);
  tick();
  const link = JEONGSEOK_LAYOUTS[READING].portals[0];
  assert.equal(action(interior, link.position).trigger(), true);
  assert.equal(rooms.currentSpace, CREATIVE); assert.equal(rooms.status().parentRoomId, LOBBY, "the lobby stays the parent");
  assert.deepEqual(calls.at(-1), ["placePlayer", { x: link.arrival.position.x, z: link.arrival.position.z }, link.arrival.yaw]);
  tick();
  assert.equal(rooms.contextAction({ position: JEONGSEOK_LAYOUTS[CREATIVE].exit.position }).trigger(), true);
  assert.equal(rooms.currentSpace, LOBBY);
  assert.deepEqual(calls.at(-1), ["placePlayer", { x: toCreative.returnAnchor.position.x, z: toCreative.returnAnchor.position.z }, 180],
    "returning lands at the Creative Space transfer, not the one first used");
  tick();
  assert.equal(released.length, 0);
  assert.equal(rooms.contextAction({ position: lobby.exit.position }).trigger(), true);
  assert.equal(rooms.currentSpace, CAMPUS_SPACE);
  assert.deepEqual(calls.at(-2), ["placePlayer", { x: JEONGSEOK_CAMPUS_RETURN.position.x, z: JEONGSEOK_CAMPUS_RETURN.position.z }, JEONGSEOK_CAMPUS_RETURN.yaw]);
  assert.deepEqual(calls.at(-1), ["resumeCampus"]);
  assert.equal(released.length, 1, "interior scenes are released back on campus");
  assert.equal(rooms.stats.nestedSwitches, 1);
});

test("CLOSED mode (every production host until JSL-A) exposes no door and refuses every path in", () => {
  const { rooms, interior } = rig({ mode: JEONGSEOK_ENTRY_MODE.CLOSED });
  assert.equal(action(interior, JEONGSEOK_ENTRANCE.position), null);
  assert.equal(rooms.contextAction({ position: JEONGSEOK_ENTRANCE.position }), null);
  assert.equal(rooms.enter(LOBBY), false);
  assert.equal(rooms.enter(LOBBY, { entranceId: JEONGSEOK_ENTRANCE.id }), false);
  assert.equal(interior.enter().status, "CLOSED");
  assert.equal(rooms.enterNestedFromCampus(READING, { parentRoomId: LOBBY, returnPosition: { x: 0, z: 0 } }), false);
  assert.equal(interior.enterFromServerGrant(granted(userA)).status, "REFUSED");
  assert.equal(rooms.currentSpace, CAMPUS_SPACE);
  // A transition built without the policy predicate is closed too (fail closed).
  const bare = createRoomTransition({ world: {} });
  assert.equal(bare.enter(LOBBY), false);
});

test("SERVER_GRANT: only the JSL-A hand-off enters; account switch or expiry leaves straight to campus", () => {
  const { rooms, interior, policy, calls, tick, statuses } = rig({ mode: JEONGSEOK_ENTRY_MODE.SERVER_GRANT });
  interior.setAccount(userA);
  assert.equal(action(interior, JEONGSEOK_ENTRANCE.position), null, "no free door without a fresh grant");
  assert.equal(interior.enterFromServerGrant(granted(userB)).status, "REFUSED");
  assert.equal(interior.enterFromServerGrant(granted(userA), { mounted: true }).status, "MOUNTED");
  assert.equal(policy.status().pendingGrant, false, "a refused entry drops its grant");
  assert.equal(interior.enterFromServerGrant(granted(userA)).status, "ENTERING");
  assert.equal(rooms.currentSpace, LOBBY); assert.equal(policy.status().session, true);
  tick();
  action(interior, JEONGSEOK_LAYOUTS[LOBBY].portals[0].position).trigger();
  assert.equal(rooms.currentSpace, READING);
  tick();
  interior.setAccount(userB);
  assert.equal(rooms.currentSpace, CAMPUS_SPACE, "forced exit skips the lobby");
  assert.deepEqual(calls.at(-2)[1], { x: JEONGSEOK_CAMPUS_RETURN.position.x, z: JEONGSEOK_CAMPUS_RETURN.position.z });
  assert.match(statuses.at(-1), /계정/);
  assert.equal(rooms.status().parentRoomId, null);
  tick();
  // Expiry while inside: update() notices and leaves.
  interior.setAccount(userA);
  assert.equal(interior.enterFromServerGrant(granted(userA, { via: "VISITOR_PASS",
    pass: { expiresAt: new Date(5_000_000 + 10_000_000).toISOString() } })).status, "ENTERING");
  assert.equal(rooms.currentSpace, LOBBY);
  assert.equal(interior.update(), false, "still valid");
  assert.equal(interior.revalidate({ ...granted(userA), granted: false, decision: "EXPIRED" }), false);
  assert.equal(rooms.currentSpace, CAMPUS_SPACE);
  assert.equal(interior.status().stats.forcedExits, 2);
});

test("a failed scene switch rolls back to campus without committing a stay, and retry works", () => {
  const { rooms, interior, calls, errors, tick, policy } = rig({ mode: JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW, failStep: "showRoom" });
  assert.equal(interior.enter().status, "ENTERING");
  assert.equal(rooms.currentSpace, CAMPUS_SPACE);
  assert.ok(calls.some(call => call[0] === "restore"));
  assert.equal(errors.at(-1).recovered, true);
  assert.equal(rooms.status().busy, false);
  assert.equal(interior.status().stats.entries, 0);
  assert.equal(policy.status().session, false);
  tick();
  assert.equal(interior.enter().status, "ENTERING");
  assert.equal(rooms.currentSpace, LOBBY);
});

test("an account change during the entry fade cancels the switch and restores campus", async () => {
  const { rooms, interior, calls, finishFade } = rig({ asyncFade: true });
  assert.equal(interior.enter().status, "ENTERING");
  assert.equal(rooms.status().busy, true);
  interior.setAccount(userA);
  await finishFade();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rooms.currentSpace, CAMPUS_SPACE);
  assert.equal(rooms.status().busy, false);
  assert.ok(!calls.some(call => call[0] === "leaveCampus" || call[0] === "showRoom"), "cancelled before the campus was left");
  assert.equal(interior.status().stats.entries, 0);
});

test("generic transition: switchNested needs a parent, and toCampus clears the nested return", () => {
  const clock = { t: 0, now() { return this.t; } };
  const world = { leaveCampus() {}, showRoom() {}, showCampus() {}, resumeCampus() {}, placePlayer() {} };
  const rooms = createRoomTransition({ world, clock });
  assert.equal(rooms.switchNested("ROOM_PERSONAL_BASIC"), false, "not from campus");
  assert.equal(rooms.enter("ROOM_DORM1_LOBBY"), true); clock.t += 1000;
  assert.equal(rooms.switchNested("ROOM_PERSONAL_BASIC"), false, "not without a nested parent");
  assert.equal(rooms.enterNested("ROOM_PERSONAL_BASIC", { returnPosition: { x: 0, z: 0 } }), true); clock.t += 1000;
  assert.equal(rooms.switchNested("ROOM_DORM1_LOBBY"), false, "cannot switch into the parent");
  assert.equal(rooms.exit({ force: true, toCampus: true }), true);
  assert.equal(rooms.currentSpace, CAMPUS_SPACE); assert.equal(rooms.status().parentRoomId, null);
});

// ------------------------------------------------------------------ geometry budget
test("each room renders every module through merged geometry within a mobile-minded budget", () => {
  for (const layout of LAYOUTS) {
    const full = buildRoomGeometry(createStaticBatch(), layout, "full");
    const low = buildRoomGeometry(createStaticBatch(), layout, "low");
    assert.ok(full.materialCount <= 40, `${layout.roomId} materials ${full.materialCount}`);
    assert.ok(full.vertexCount < 40_000, `${layout.roomId} vertices ${full.vertexCount}`);
    assert.ok(low.vertexCount <= full.vertexCount);
    assert.ok(full.primitiveCount > layout.items.length / 2);
  }
});
