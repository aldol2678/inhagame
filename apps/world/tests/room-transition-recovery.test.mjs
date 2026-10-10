import test from "node:test";
import assert from "node:assert/strict";
import { createRoomTransition, ROOM_TRANSITION_COOLDOWN_MS } from "../src/rooms/room-transition.js";
import { createRoomWorldAdapter } from "../src/rooms/room-world-adapter.js";
import { CAMPUS_MOVEMENT_SPACE } from "../src/player-controller.js";
import { ROOMS, CLUB_ROOM_ENTRANCE } from "../src/rooms/room-registry.js";
import { DORM_1_LOBBY_MY_ROOM_RETURN } from "../src/rooms/dorm1-lobby-layout.js";
import { createInputFocusManager, INPUT_FOCUS_POLICY } from "../src/input/input-focus-manager.js";
import { createInputFocusOwner } from "../src/input/input-focus-owner.js";

const CLUB = "ROOM_CLUBHOUSE_01";
const LOBBY = "ROOM_DORM1_LOBBY";
const PERSONAL = "ROOM_PERSONAL_BASIC";
const metadata = { personalRoomId: "00000000-0000-4000-8000-000000000001", ownerUserId: "00000000-0000-4000-8000-000000000002", visitRole: "visitor" };
const nestedOptions = { returnPosition: DORM_1_LOBBY_MY_ROOM_RETURN.position, returnYaw: DORM_1_LOBBY_MY_ROOM_RETURN.yaw, metadata };
const flush = () => new Promise(resolve => setImmediate(resolve));

function rig({ fade, onError } = {}) {
  const campusRoot = { name: "campus", enabled: true };
  const scenes = new Map(Object.values(ROOMS).map(room => [room.id, {
    root: { name: room.id, enabled: false }, ambient: room.id, clearColor: room.id, obstacles: room.obstacles
  }]));
  const player = {
    parent: campusRoot, position: { ...CLUB_ROOM_ENTRANCE.position, y: 1.15 }, yaw: 137,
    getLocalPosition() { return { ...this.position }; },
    getLocalEulerAngles() { return { x: 0, y: this.yaw, z: 0 }; },
    setLocalPosition(x, y, z) { this.position = { x, y, z }; },
    setLocalEulerAngles(_x, y) { this.yaw = y; },
    reparent(parent) { this.parent = parent; }
  };
  const controller = { space: CAMPUS_MOVEMENT_SPACE, velocityY: 0, grounded: true, jumpQueued: false,
    touchVector: { x: 0, y: 0 }, keys: new Set(), setMovementSpace(s) { this.space = s; }, clearAssistedMovement() {} };
  const orbit = { indoor: null, yaw: 1.2, pitch: .4, distance: 5,
    setIndoor(value) { this.indoor = value; } };
  let lightingState = { ambient: "campus", clearColor: "campus" };
  let location = "캠퍼스";
  let markedSpace = null;
  const sun = { enabled: true };
  const online = { campusPaused: false, pauses: 0, resumes: 0,
    pauseCampus() { this.campusPaused = true; this.pauses += 1; },
    resumeCampus() { this.campusPaused = false; this.resumes += 1; } };
  const places = { getCurrentPlaceZone: () => ({ id: "AREA_MAIN_HALL", displayName: "캠퍼스" }), update() {} };
  const world = createRoomWorldAdapter({
    player, controller, orbit, campusRoot, sun, getRoomScene: room => scenes.get(room.id),
    lighting: { save: () => ({ ...lightingState }), apply: value => { lightingState = { ambient: value.ambient, clearColor: value.clearColor }; } },
    getOnline: () => online, places,
    getLocationLabel: () => location, setLocationLabel: value => { location = value; },
    markSpace: value => { markedSpace = value; }
  });
  const focus = createInputFocusManager();
  const input = createInputFocusOwner({ manager: focus, ownerId: "room-transition", policy: INPUT_FOCUS_POLICY.SYSTEM_LOCK });
  const clock = { time: 0, now() { return this.time; } };
  const errors = [];
  const busyChanges = [];
  const events = [];
  const rooms = createRoomTransition({ world, clock, ...(fade ? { fade } : {}),
    onBusyChange: busy => { busyChanges.push(busy); busy ? input.acquire() : input.release(); },
    onError: info => { errors.push(info); onError?.(info); }
  });
  rooms.onChange((state, event) => events.push({ state, event }));
  const tick = () => { clock.time += ROOM_TRANSITION_COOLDOWN_MS + 1; };
  const snapshot = () => ({ state: rooms.status(), parent: player.parent, position: { ...player.position }, yaw: player.yaw,
    campus: campusRoot.enabled, sun: sun.enabled, enabled: [...scenes].filter(([, s]) => s.root.enabled).map(([id]) => id),
    movement: controller.space, indoor: orbit.indoor, camera: [orbit.yaw, orbit.pitch, orbit.distance],
    lighting: { ...lightingState }, location, markedSpace, paused: online.campusPaused });
  const assertRestored = before => {
    const after = snapshot();
    assert.equal(rooms.status().busy, false, "recover before releasing busy");
    assert.equal(input.active, false, "SYSTEM_LOCK released");
    assert.equal(rooms.status().ready, true, "retry is immediately available");
    assert.deepEqual(after, before, "scene, transform, lighting, collision, camera, ownership metadata and presence restored");
  };
  const failOnce = (method, { async = false, after = false } = {}) => {
    const original = world[method];
    world[method] = (...args) => {
      world[method] = original;
      if (after) original(...args);
      if (async) return Promise.reject(new Error(`injected ${method}`));
      throw new Error(`injected ${method}`);
    };
  };
  return { world, rooms, online, input, focus, player, controller, orbit, scenes, campusRoot, sun,
    clock, tick, snapshot, assertRestored, failOnce, errors, busyChanges, events };
}

for (const method of ["leaveCampus", "showRoom", "placePlayer"]) {
  for (const asynchronous of [false, true]) {
    test(`campus enter recovers ${asynchronous ? "async rejection" : "throw"} after ${method} and retries`, async () => {
      const r = rig();
      const before = r.snapshot();
      r.failOnce(method, { async: asynchronous, after: true });
      assert.equal(r.rooms.enter(CLUB), true, "boolean means accepted, not committed");
      await flush();
      r.assertRestored(before);
      assert.equal(r.errors.length, 1);
      assert.equal(r.errors[0].recovered, true);
      assert.equal(r.rooms.stats.enters, 0);
      assert.equal(r.events.length, 0, "no false success event or session activation");
      assert.equal(r.rooms.enter(CLUB), true);
      assert.equal(r.rooms.currentSpace, CLUB);
      assert.equal(r.rooms.stats.enters, 1);
    });
  }
}

test("an unavailable room scene keeps the campus visible and can retry after it becomes available", () => {
  const r = rig();
  const before = r.snapshot();
  const scene = r.scenes.get(CLUB);
  r.scenes.delete(CLUB);
  assert.equal(r.rooms.enter(CLUB), true);
  r.scenes.set(CLUB, scene);
  r.assertRestored(before);
  assert.equal(r.errors[0].recovered, true);
  assert.equal(r.rooms.enter(CLUB), true);
});

test("personal-room entry failure stays in the dorm lobby without new campus or room ownership", async () => {
  const r = rig();
  r.rooms.enter(LOBBY); r.tick();
  const before = r.snapshot();
  const resumes = r.online.resumes;
  r.failOnce("placePlayer", { async: true, after: true });
  assert.equal(r.rooms.enterNested(PERSONAL, { ...nestedOptions, fromRoomId: LOBBY }), true);
  await flush();
  r.assertRestored(before);
  assert.equal(r.online.resumes, resumes, "no campus rejoin during indoor rollback");
  assert.deepEqual(r.events.map(e => e.event), ["enter"]);
  assert.equal(r.rooms.stats.nestedEnters, 0);
  assert.equal(r.rooms.enterNested(PERSONAL, { ...nestedOptions, fromRoomId: LOBBY }), true);
  assert.deepEqual(r.rooms.status().metadata, metadata);
});

test("direct friend-room failure restores exact campus location and discards provisional visitor metadata", async () => {
  const r = rig();
  const before = r.snapshot();
  r.failOnce("placePlayer", { async: true, after: true });
  assert.equal(r.rooms.enterNestedFromCampus(PERSONAL, { ...nestedOptions, parentRoomId: LOBBY }), true);
  await flush();
  r.assertRestored(before);
  assert.equal(r.rooms.stats.directNestedEnters, 0);
  assert.equal(r.rooms.enterNestedFromCampus(PERSONAL, { ...nestedOptions, parentRoomId: LOBBY }), true);
  r.tick(); r.rooms.exit();
  assert.equal(r.rooms.currentSpace, LOBBY);
  r.tick(); r.rooms.exit();
  assert.equal(r.rooms.currentSpace, "campus");
});

for (const nested of [false, true]) {
  for (const method of nested ? ["showRoom", "placePlayer"] : ["showCampus", "placePlayer", "resumeCampus"]) {
    test(`${nested ? "personal-room" : "club-room"} exit recovers rejection after ${method}, preserving return context`, async () => {
      const r = rig();
      if (nested) {
        r.rooms.enter(LOBBY); r.tick();
        r.rooms.enterNested(PERSONAL, { ...nestedOptions, fromRoomId: LOBBY });
      } else r.rooms.enter(CLUB);
      r.tick();
      const before = r.snapshot();
      const eventsBefore = r.events.length;
      r.failOnce(method, { async: true, after: true });
      assert.equal(r.rooms.exit(), true);
      await flush();
      r.assertRestored(before);
      assert.equal(r.events.length, eventsBefore, "failed exit must not stop the existing room session");
      assert.equal(r.errors[0].recovered, true);
      assert.equal(r.rooms.exit(), true);
      assert.equal(r.rooms.currentSpace, nested ? LOBBY : "campus");
    });
  }
}

for (const afterSwitch of [false, true]) {
  test(`fade ${afterSwitch ? "rejects after switch" : "throws before switch"} rolls back without success`, async () => {
    const r = rig({ fade: run => {
      if (!afterSwitch) throw new Error("fade startup");
      return Promise.resolve(run()).then(() => { throw new Error("fade completion"); });
    } });
    const before = r.snapshot();
    assert.equal(r.rooms.enter(CLUB), true);
    await flush();
    r.assertRestored(before);
    assert.equal(r.events.length, 0);
    assert.equal(r.rooms.stats.enters, 0);
    assert.equal(r.errors.length, 1);
  });
}

test("SYSTEM_LOCK and source metadata remain until awaited rollback completes", async () => {
  const r = rig();
  let finish;
  const checkpoint = r.world.createCheckpoint?.bind(r.world);
  r.world.createCheckpoint = () => {
    const restore = checkpoint?.();
    return () => new Promise(resolve => { finish = () => { restore?.(); resolve(); }; });
  };
  r.failOnce("showRoom", { after: true });
  r.rooms.enter(CLUB);
  assert.equal(r.rooms.status().busy, true);
  assert.equal(r.input.active, true);
  assert.equal(r.rooms.exit({ force: true }), false, "force does not start an overlapping transaction");
  assert.equal(r.errors.length, 0);
  finish(); await flush();
  assert.equal(r.rooms.status().busy, false);
  assert.equal(r.input.active, false);
  assert.equal(r.errors[0].recovered, true);
});

test("failed rollback stays locked and reports recovery failure, never pretend-ready", () => {
  const r = rig({ onError: () => { throw new Error("broken error UI"); } });
  r.world.createCheckpoint = () => () => { throw new Error("restore failed"); };
  r.failOnce("showRoom", { after: true });
  assert.doesNotThrow(() => r.rooms.enter(CLUB));
  assert.equal(r.rooms.status().busy, true);
  assert.equal(r.input.active, true);
  assert.equal(r.rooms.status().ready, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].recovered, false);
  assert.equal(r.events.length, 0);
  assert.equal(r.rooms.exit({ force: true }), false);
});

test("delayed transition cancellation and duplicate callback do not mutate or leak locks", () => {
  let run;
  let valid = true;
  const r = rig({ fade: callback => { run = callback; } });
  const before = r.snapshot();
  r.rooms.enterNestedFromCampus(PERSONAL, { ...nestedOptions, parentRoomId: LOBBY, isValid: () => valid });
  valid = false;
  run(); run();
  r.assertRestored(before);
  assert.equal(r.errors.length, 0);
  assert.equal(r.events.length, 0);
});

test("a forced exit requested during recovery is retried once after restoration, not lost", async () => {
  const r = rig();
  r.rooms.enter(LOBBY); r.tick();
  r.rooms.enterNested(PERSONAL, { ...nestedOptions, fromRoomId: LOBBY }); r.tick();
  let release;
  const original = r.world.showRoom;
  r.world.showRoom = room => {
    r.world.showRoom = original;
    return new Promise((_resolve, reject) => { release = () => reject(new Error("late room failure")); });
  };
  r.rooms.exit();
  assert.equal(r.rooms.exit({ force: true }), false);
  release(); await flush();
  assert.equal(r.rooms.currentSpace, LOBBY, "access-loss exit is not dropped during an in-flight failure");
  assert.equal(r.rooms.status().busy, false);
  assert.equal(r.rooms.stats.nestedExits, 1);
});

test("queued force does not exit the parent lobby again after successful personal-room departure", async () => {
  const r = rig();
  r.rooms.enter(LOBBY); r.tick();
  r.rooms.enterNested(PERSONAL, { ...nestedOptions, fromRoomId: LOBBY }); r.tick();
  const original = r.world.showRoom;
  let resolve;
  r.world.showRoom = room => { original(room); return new Promise(done => { resolve = done; }); };
  r.rooms.exit(); r.rooms.exit({ force: true });
  resolve(); await flush();
  assert.equal(r.rooms.currentSpace, LOBBY);
  assert.equal(r.rooms.stats.exits, 0);
});

test("an early fade rejection waits for an in-flight world step before restoring and stops later steps", async () => {
  let rejectFade;
  const r = rig({ fade: run => { run(); return new Promise((_resolve, reject) => { rejectFade = reject; }); } });
  const before = r.snapshot();
  const leave = r.world.leaveCampus;
  let resolveStep;
  r.world.leaveCampus = room => new Promise(resolve => { resolveStep = () => { leave(room); resolve(); }; });
  r.rooms.enter(CLUB);
  rejectFade(new Error("fade interrupted")); await flush();
  assert.equal(r.rooms.status().busy, true);
  resolveStep(); await flush();
  r.assertRestored(before);
  assert.equal(r.events.length, 0);
});

test("restoration failure after campus resume pauses public presence before touching indoor coordinates", async () => {
  const r = rig();
  r.rooms.enter(CLUB); r.tick();
  r.failOnce("resumeCampus", { async: true, after: true });
  const place = r.player.setLocalPosition.bind(r.player);
  let calls = 0;
  r.player.setLocalPosition = (...args) => { if (++calls === 2) throw new Error("position restore failure"); place(...args); };
  r.rooms.exit(); await flush();
  assert.equal(r.rooms.status().busy, true);
  assert.equal(r.online.campusPaused, true, "never keep publishing after failed indoor restoration");
  assert.equal(r.errors[0].recovered, false);
});

test("identity invalidated during fade-out never commits the previous account's room metadata", async () => {
  let finishFade;
  let valid = true;
  const r = rig({ fade: run => { run(); return new Promise(resolve => { finishFade = resolve; }); } });
  const before = r.snapshot();
  r.rooms.enterNestedFromCampus(PERSONAL, { ...nestedOptions, parentRoomId: LOBBY, isValid: () => valid });
  valid = false;
  finishFade(); await flush();
  r.assertRestored(before);
  assert.equal(r.events.length, 0);
  assert.equal(r.rooms.stats.directNestedEnters, 0);
});

test("focus acquisition failure stays locked before any world mutation", () => {
  const r = rig();
  r.focus.subscribe(() => { throw new Error("broken focus subscriber"); });
  assert.doesNotThrow(() => r.rooms.enter(CLUB));
  assert.equal(r.rooms.status().busy, true);
  assert.equal(r.rooms.status().ready, false);
  assert.equal(r.rooms.currentSpace, "campus");
  assert.equal(r.player.parent, r.campusRoot);
  assert.equal(r.online.pauses, 0);
  assert.equal(r.rooms.stats.enters, 0);
  assert.equal(r.errors[0].recovered, false);
  assert.equal(r.errors[0].phase, "input");
});

test("focus release failure keeps scene and committed ownership aligned, and reasserts the lock", () => {
  const r = rig();
  r.focus.subscribe(state => { if (state.activeClaimCount === 0) throw new Error("broken release subscriber"); });
  assert.doesNotThrow(() => r.rooms.enter(CLUB));
  assert.equal(r.rooms.currentSpace, CLUB);
  assert.equal(r.player.parent, r.scenes.get(CLUB).root);
  assert.equal(r.rooms.stats.enters, 1);
  assert.deepEqual(r.events.map(e => e.event), ["enter"]);
  assert.equal(r.rooms.status().busy, true);
  assert.equal(r.input.active, true);
  assert.equal(r.focus.can("MOVEMENT"), false);
  assert.equal(r.errors[0].recovered, false);
  assert.equal(r.errors[0].phase, "input");
});

test("focus release failure after rollback reports a locked recovery without diverging from its source", () => {
  const r = rig();
  r.focus.subscribe(state => { if (state.activeClaimCount === 0) throw new Error("broken release subscriber"); });
  r.failOnce("showRoom", { after: true });
  assert.doesNotThrow(() => r.rooms.enter(CLUB));
  assert.equal(r.rooms.currentSpace, "campus");
  assert.equal(r.player.parent, r.campusRoot);
  assert.equal(r.rooms.stats.enters, 0);
  assert.equal(r.events.length, 0);
  assert.equal(r.rooms.status().busy, true);
  assert.equal(r.input.active, true);
  assert.equal(r.errors[0].recovered, false);
});

test("a failed required access-loss exit stays locked instead of reopening the unauthorized room", async () => {
  const r = rig();
  r.rooms.enter(LOBBY); r.tick();
  r.rooms.enterNested(PERSONAL, { ...nestedOptions, fromRoomId: LOBBY });
  r.failOnce("showRoom", { async: true, after: true });
  r.rooms.exit({ force: true }); await flush();
  assert.equal(r.rooms.currentSpace, PERSONAL);
  assert.equal(r.player.parent, r.scenes.get(PERSONAL).root);
  assert.equal(r.rooms.status().busy, true);
  assert.equal(r.input.active, true);
  assert.equal(r.errors[0].recovered, false);
  assert.equal(r.rooms.stats.nestedExits, 0);
});

test("rollback restores the full engine quaternion, not the folded Euler Y angle", () => {
  const r = rig();
  const initial = { x: 0, y: .9304175679820246, z: 0, w: .3665012267242973 };
  let rotation = { ...initial };
  // PlayCanvas represents a 137 degree yaw as Euler (180, 43, 180). Y alone loses orientation.
  r.player.getLocalEulerAngles = () => ({ x: 180, y: 43, z: 180 });
  r.player.getLocalRotation = () => ({ clone: () => ({ ...rotation }) });
  r.player.setLocalRotation = value => { rotation = { ...value }; };
  const euler = r.player.setLocalEulerAngles.bind(r.player);
  r.player.setLocalEulerAngles = (x, y, z) => { rotation = { x, y, z, w: 0 }; euler(x, y, z); };
  r.failOnce("placePlayer", { after: true });
  r.rooms.enter(CLUB);
  assert.deepEqual(rotation, initial);
  assert.equal(r.rooms.status().busy, false);
});

test("falsy Promise rejection values still trigger recovery, never a stranded transition", async () => {
  const r = rig();
  r.world.showRoom = () => Promise.reject(false);
  r.rooms.enter(CLUB); await flush();
  assert.equal(r.rooms.status().busy, false);
  assert.equal(r.rooms.currentSpace, "campus");
  assert.equal(r.events.length, 0);
  assert.equal(r.errors[0].recovered, true);
});

test("rollback rejecting without a reason still fails closed", async () => {
  const r = rig();
  r.world.createCheckpoint = () => () => Promise.reject();
  r.failOnce("showRoom", { after: true });
  r.rooms.enter(CLUB); await flush();
  assert.equal(r.rooms.status().busy, true);
  assert.equal(r.input.active, true);
  assert.equal(r.errors[0].recovered, false);
});
