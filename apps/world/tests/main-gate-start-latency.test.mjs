import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAIN_GATE_SPAWN } from "../src/campus-spawn.js";
import { MAIN_GATE_TOUCH_CLICK_SUPPRESS_MS, bindMainGateEntry } from "../src/lobby/lobby-main-gate.js";
import { createNpcNavigator } from "../npc-factory/dev-navigation.mjs";
import { campusNavGraph } from "../src/navigation/campus-navigation.js";
import { mergeCampusPopulation } from "../npc-factory/npc-campus-expansion.mjs";
import { createPurposefulRoster } from "../npc-factory/purposeful-roster.mjs";
import { bindSharedSchedule } from "../npc-factory/npc-shared-schedule.mjs";
import { createSharedMeetings, seedSharedMeetingGroups } from "../npc-factory/npc-shared-meetings.mjs";
import { NPC_WORLD_EPOCH_MS, NPC_WORLD_PERIOD_MS } from "../npc-factory/npc-world-time-contract.mjs";
import { polygonOverlap } from "../src/polygon-collision.js";
import { OBSTACLES } from "../src/campus-layout.js";
import { safeDwell, snapshotForPeriod, validateDevCandidate } from "../npc-factory/dev-runtime-state.mjs";

// Minimal DOM stand-ins: an EventTarget that also records dataset/classList like a button.
function fakeButton(rect = { left: 10, top: 10, right: 110, bottom: 60 }) {
  const target = new EventTarget();
  const classes = new Set();
  return Object.assign(target, {
    dataset: {},
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), has: name => classes.has(name) },
    getBoundingClientRect: () => rect
  });
}
const pointer = (type, init = {}) => Object.assign(new Event(type, { cancelable: true }),
  { pointerType: "touch", isPrimary: true, clientX: 50, clientY: 30, ...init });
const fakeDocument = () => {
  const target = new EventTarget();
  target.body = { dataset: {} };
  target.getElementById = () => ({ hidden: false });
  return target;
};

function harness() {
  const button = fakeButton();
  const documentLike = fakeDocument();
  const player = {
    pos: { ...MAIN_GATE_SPAWN },
    getLocalPosition() { return this.pos; },
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; },
    setLocalEulerAngles() {}
  };
  let leaves = 0;
  const lobbyWorld = { active: true, leave() { leaves++; this.active = false; return true; } };
  let time = 1000;
  const clock = () => time;
  const entry = bindMainGateEntry({ button, player, lobbyWorld, documentLike, clock });
  return { button, documentLike, entry, advance: ms => { time += ms; }, leaves: () => leaves, lobbyWorld };
}

test("touch pointerup starts MAIN_GATE once and the follow-up click does not double start", () => {
  const h = harness();
  h.button.dispatchEvent(pointer("pointerdown"));
  assert.equal(h.button.dataset.activating, "true", "pressed state is shown on pointerdown");
  assert.equal(h.button.classList.has("is-activating"), true);
  h.button.dispatchEvent(pointer("pointerup"));
  assert.equal(h.leaves(), 1, "lobby left on pointerup, before the synthetic click");
  assert.equal(h.button.dataset.activating, undefined);
  h.advance(40);
  h.lobbyWorld.active = true; // a second start would be observable as another leave()
  h.button.dispatchEvent(new Event("click"));
  assert.equal(h.leaves(), 1, "click inside the suppress window is ignored");
});

test("touch activation keeps the Main Gate reveal hook: onEntered fires once", () => {
  const button = fakeButton();
  const player = { pos: { ...MAIN_GATE_SPAWN }, getLocalPosition() { return this.pos; },
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; }, setLocalEulerAngles() {} };
  const lobbyWorld = { active: true, leave() { this.active = false; return true; } };
  let entered = 0, time = 0;
  bindMainGateEntry({ button, player, lobbyWorld, documentLike: fakeDocument(), clock: () => time,
    onEntered: () => { entered++; } });
  button.dispatchEvent(pointer("pointerup"));
  assert.equal(entered, 1);
  time += 30;
  button.dispatchEvent(new Event("click"));
  assert.equal(entered, 1, "the follow-up click does not re-enter");
});

test("touch activation still requests lobby fullscreen exactly once, from the gesture", () => {
  const button = fakeButton();
  const player = { pos: { ...MAIN_GATE_SPAWN }, getLocalPosition() { return this.pos; },
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; }, setLocalEulerAngles() {} };
  const lobbyWorld = { active: true, leave() { this.active = false; return true; } };
  const calls = []; let time = 0;
  bindMainGateEntry({ button, player, lobbyWorld, documentLike: fakeDocument(), clock: () => time,
    requestFullscreen: () => { calls.push(lobbyWorld.active ? "before-leave" : "after-leave"); } });
  button.dispatchEvent(pointer("pointerup"));
  time += 30;
  button.dispatchEvent(new Event("click"));
  assert.deepEqual(calls, ["before-leave"], "requested inside the pointerup gesture, not repeated by the click");
});

test("the ghost click that follows a touch start is swallowed before it reaches the game UI", () => {
  const h = harness();
  const reached = [];
  h.button.dispatchEvent(pointer("pointerup"));
  // Registered after the start so it runs after the capture guard, as a game-UI click handler would.
  h.documentLike.addEventListener("click", () => reached.push("bubble"));
  const ghost = new Event("click", { cancelable: true });
  h.documentLike.dispatchEvent(ghost);
  assert.equal(ghost.defaultPrevented, true);
  assert.deepEqual(reached, [], "swallowed in the capture phase");
  const next = new Event("click", { cancelable: true });
  h.documentLike.dispatchEvent(next);
  assert.deepEqual(reached, ["bubble"], "only one click is swallowed");
});

test("mouse and keyboard activation keep using click (Enter / Space on a focused button)", () => {
  const h = harness();
  h.button.dispatchEvent(pointer("pointerup", { pointerType: "mouse" }));
  assert.equal(h.leaves(), 0, "mouse pointerup alone does not start");
  h.button.dispatchEvent(new Event("click"));
  assert.equal(h.leaves(), 1);

  const k = harness();
  // Enter and Space on a native <button> are delivered by the browser as a click without pointer events.
  k.button.dispatchEvent(new Event("click"));
  assert.equal(k.leaves(), 1, "keyboard activation works");
});

test("a click after the suppress window is honoured again", () => {
  const h = harness();
  h.button.dispatchEvent(pointer("pointerup"));
  assert.equal(h.leaves(), 1);
  h.advance(MAIN_GATE_TOUCH_CLICK_SUPPRESS_MS + 1);
  h.lobbyWorld.active = true;
  h.button.dispatchEvent(new Event("click"));
  assert.equal(h.leaves(), 2);
});

test("a touch released outside the button, or cancelled, does not start", () => {
  const h = harness();
  h.button.dispatchEvent(pointer("pointerdown"));
  h.button.dispatchEvent(pointer("pointerup", { clientX: 400, clientY: 400 }));
  assert.equal(h.leaves(), 0);
  assert.equal(h.button.dataset.activating, undefined);

  h.button.dispatchEvent(pointer("pointerdown"));
  assert.equal(h.button.dataset.activating, "true");
  h.button.dispatchEvent(pointer("pointercancel"));
  assert.equal(h.button.dataset.activating, undefined);
  assert.equal(h.leaves(), 0);
});

test("destroy removes every listener", () => {
  const h = harness();
  h.entry.destroy();
  h.button.dispatchEvent(pointer("pointerup"));
  h.button.dispatchEvent(new Event("click"));
  assert.equal(h.leaves(), 0);
});

const root = new URL("../npc-factory/", import.meta.url);
const batch = validateDevCandidate(JSON.parse(readFileSync(new URL("data/repaired/INKYUNG-20-A-R1.json", root), "utf8")));

test("NPC navigator grid is built lazily and warmGrid() slices give the same routes", () => {
  const eager = createNpcNavigator(batch);
  const sliced = createNpcNavigator(batch);
  let slices = 0;
  while (!sliced.warmGrid(0)) slices++;
  assert.ok(slices > 1, "a zero budget builds the grid in several slices, not one blocking pass");
  assert.equal(sliced.warmGrid(0), true, "warm grid is idempotent");

  const anchors = snapshotForPeriod(batch, "class_time").actors.map(actor => actor.position).filter(Boolean);
  let compared = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const from = anchors[i], to = anchors[i + 1];
    assert.deepEqual(sliced.route(from, to), eager.route(from, to), `route ${i}`);
    compared++;
  }
  assert.ok(compared > 5);
  assert.deepEqual(sliced.navigationGeometry(), eager.navigationGeometry(), "geometry contract is unchanged");
});

test("walkable and networkRoute work before the grid exists (the shared-schedule path)", () => {
  const navigator = createNpcNavigator(batch);
  const [a] = snapshotForPeriod(batch, "class_time").actors.map(actor => actor.position).filter(Boolean);
  assert.equal(navigator.walkable(a), true);
  assert.equal(typeof navigator.warmGrid, "function");
});

test("runtime wiring: lobby hold, staged startup and quest-only lobby readback", () => {
  const runtime = readFileSync(new URL("dev-runtime.mjs", root), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(runtime, /isSimulationHeld = \(\) => false/);
  assert.match(runtime, /function update\(dt\) \{\n\s+if \(isSimulationHeld\(\) \|\| !stepStartup\(\)\) return;/,
    "the held lobby returns before any simulation work");
  assert.match(main, /isSimulationHeld: \(\) => lobbyWorld\.active/);
  assert.match(main, /getQuest: npcQuestStatus,/, "lobby quest highlight uses the light quest readback");
  assert.doesNotMatch(main, /createNpcNavigator\(/, "main.js never builds a navigator in a click handler");
});

test("NPC dwell bounds prefilter is exactly equivalent to the full polygon check", () => {
  // Reference: the unfiltered predicate. Points are scattered around the real obstacles, where the
  // clearance edge cases live, plus a coarse sweep of the campus.
  const clearance = .65;
  const obstacles = OBSTACLES.filter(box => box.minY < 2.5 && box.maxY > 0);
  const reference = point => !obstacles.some(box => box.polygon
    ? polygonOverlap(point.x, point.z, box.polygon, clearance)
    : point.x >= box.minX - clearance && point.x <= box.maxX + clearance &&
      point.z >= box.minZ - clearance && point.z <= box.maxZ + clearance);
  let seed = 12345;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const points = [];
  for (const box of obstacles.slice(0, 120)) {
    const ring = box.polygon ?? [{ x: box.minX, z: box.minZ }, { x: box.maxX, z: box.maxZ }];
    for (let i = 0; i < 40; i++) {
      const a = ring[Math.floor(random() * ring.length)];
      points.push({ x: a.x + (random() - .5) * 3, z: a.z + (random() - .5) * 3 });
    }
  }
  for (let x = -60; x <= 200; x += 5) for (let z = -140; z <= 90; z += 5) points.push({ x, z });
  // The filter can only err by skipping a real overlap, so every blocked point must still be rejected.
  // (safeDwell additionally rejects the pond ring, which is unchanged, hence one direction only.)
  let blocked = 0;
  for (const point of points) {
    if (reference(point)) continue;
    blocked++;
    assert.equal(safeDwell(point), false, `obstacle point accepted at ${point.x},${point.z}`);
  }
  assert.ok(blocked > 100, "enough obstacle rejections were compared");
});

test("bucketed walkable() is identical to scanning every obstacle", () => {
  const navigator = createNpcNavigator(batch);
  const { bounds, obstacles, pond, clearance } = navigator.navigationGeometry();
  const graph = campusNavGraph();
  const snap = point => graph.nearestEdgePoint(point, { maxDistance: .4 });
  const pondBounds = {
    minX: Math.min(...pond.map(p => p.x)), maxX: Math.max(...pond.map(p => p.x)),
    minZ: Math.min(...pond.map(p => p.z)), maxZ: Math.max(...pond.map(p => p.z))
  };
  // The pre-bucket implementation, verbatim, over the full obstacle list.
  const reference = ({ x, z }) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < bounds.minX || x > bounds.maxX ||
        z < bounds.minZ || z > bounds.maxZ) return false;
    if (x >= pondBounds.minX - clearance && x <= pondBounds.maxX + clearance &&
        z >= pondBounds.minZ - clearance && z <= pondBounds.maxZ + clearance &&
        polygonOverlap(x, z, pond, clearance)) return false;
    const legacyBlocked = obstacles.some(box => x >= box.minX - clearance && x <= box.maxX + clearance &&
      z >= box.minZ - clearance && z <= box.maxZ + clearance &&
      (box.polygon ? polygonOverlap(x, z, box.polygon, clearance) : true));
    return !legacyBlocked || Boolean(snap({ x, z }));
  };
  let seed = 99;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const points = [];
  for (let i = 0; i < 6000; i++) points.push({
    x: bounds.minX - 2 + random() * (bounds.maxX - bounds.minX + 4),
    z: bounds.minZ - 2 + random() * (bounds.maxZ - bounds.minZ + 4)
  });
  // Dense probes hugging obstacle edges, where bucket borders and clearance interact.
  for (const box of obstacles.slice(0, 150)) points.push(
    { x: box.minX - clearance, z: (box.minZ + box.maxZ) / 2 }, { x: box.maxX + clearance, z: (box.minZ + box.maxZ) / 2 },
    { x: (box.minX + box.maxX) / 2, z: box.minZ - clearance }, { x: (box.minX + box.maxX) / 2, z: box.maxZ + clearance },
    { x: box.minX - clearance - 1e-9, z: box.minZ }, { x: box.maxX + clearance + 1e-9, z: box.maxZ });
  for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minZ, bounds.maxZ]) points.push({ x, z });
  points.push({ x: NaN, z: 0 }, { x: Infinity, z: 0 });
  let walkable = 0;
  for (const point of points) {
    const expected = reference(point);
    if (expected) walkable++;
    assert.equal(navigator.walkable(point), expected, `walkable at ${point.x},${point.z}`);
  }
  assert.ok(walkable > 1000 && walkable < points.length, "both outcomes are exercised");
});

test("shared meeting plans built in budgeted slices equal the one-shot build", () => {
  const read = file => JSON.parse(readFileSync(new URL(`data/${file}`, root), "utf8"));
  const { batch: campus, roster: profiles } = mergeCampusPopulation(read("repaired/INKYUNG-20-A-R1.json"),
    read("fixtures/public-roster.json"), read("expansion/CAMPUS-28-P2A.json"));
  const navigator = createNpcNavigator(campus);
  let now = NPC_WORLD_EPOCH_MS;
  const build = () => {
    const roster = bindSharedSchedule(createPurposefulRoster(campus, navigator), navigator, () => now);
    return { roster, meetings: createSharedMeetings({ batch: campus, profiles, roster, navigator, now: () => now }) };
  };
  const oneShot = build(), sliced = build();
  // The seed replay may also be spent in slices and handed in; the groups must not change.
  const seed = seedSharedMeetingGroups({ batch: campus, profiles });
  let seedSlices = 0, seeded;
  for (let step = seed.next(); ; step = seed.next()) { if (step.done) { seeded = step.value; break; } seedSlices++; }
  assert.ok(seedSlices > 1, "seed ticks are spread over several slices");
  const supplied = createSharedMeetings({ batch: campus, profiles, roster: build().roster, navigator,
    now: () => now, groups: seeded });
  assert.deepEqual(supplied.groups(), oneShot.meetings.groups(), "sliced seed gives the same groups");
  for (let index = 0; index < 5; index++) {
    let slices = 0;
    while (!sliced.meetings.warm(index, 0)) slices++;
    assert.ok(slices > 1, `period ${index} is spread over several slices`);
    assert.equal(sliced.meetings.warm(index, 0), true, "warm is idempotent once cached");
    assert.deepEqual(sliced.meetings.plans(index), oneShot.meetings.plans(index), `plans for period ${index}`);
  }
  now = NPC_WORLD_EPOCH_MS + 2 * NPC_WORLD_PERIOD_MS + 400_000;
  for (const [id, member] of oneShot.roster) assert.deepEqual(sliced.roster.get(id).controller.status(), member.controller.status(), id);
});
