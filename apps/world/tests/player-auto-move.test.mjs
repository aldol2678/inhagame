import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_MOVE_CANCEL_REASON,
  AUTO_MOVE_DEFAULTS,
  AUTO_MOVE_STATUS,
  autoMoveIntent,
  bindAutoMoveManualCancellation,
  createPlayerAutoMove
} from "../src/navigation/player-auto-move.js";
import { PlayerController } from "../src/player-controller.js";
import { CAMPUS_BIKE_ID } from "../src/mounts/campus-bike-world.js";
import { DRAGON_MOUNT_ID } from "../src/mounts/mount-kinds.js";

const nav = (overrides = {}) => ({
  status: "GUIDING",
  destination: { id: "poi:poi.main-hall", title: "본관", x: 10, z: 20 },
  nextWaypoint: { x: 5, z: 6 },
  ...overrides
});

test("P0-A auto-move starts from an existing guiding route without owning the route", () => {
  let cleared = 0;
  const clock = { now: () => 1234 };
  const auto = createPlayerAutoMove({ clearAssist: () => { cleared += 1; }, clock });
  const events = [];
  auto.onChange((state, event) => events.push([state.status, event]));

  assert.equal(auto.start(nav()), true);
  assert.equal(auto.active, true);
  assert.equal(auto.snapshot().status, AUTO_MOVE_STATUS.MOVING);
  assert.equal(auto.snapshot().destinationId, "poi:poi.main-hall");
  assert.equal(auto.snapshot().startedAt, 1234);
  assert.equal(cleared, 1);
  assert.deepEqual(events, [
    [AUTO_MOVE_STATUS.PREPARING, "start"],
    [AUTO_MOVE_STATUS.MOVING, "ready"]
  ]);
});

test("P0-A refuses missing, paused or unrouted guidance", () => {
  const auto = createPlayerAutoMove();
  assert.equal(auto.start(null), false);
  assert.equal(auto.start(nav({ status: "PAUSED" })), false);
  assert.equal(auto.start(nav({ nextWaypoint: null })), false);
  assert.equal(auto.active, false);
});

test("P1-A manual stop pauses the session instead of discarding its destination", () => {
  const auto = createPlayerAutoMove();
  auto.start(nav());
  assert.equal(auto.pause(AUTO_MOVE_CANCEL_REASON.MANUAL_INPUT), true);
  assert.equal(auto.active, false);
  assert.equal(auto.paused, true);
  assert.equal(auto.snapshot().status, AUTO_MOVE_STATUS.PAUSED);
  assert.equal(auto.snapshot().pauseReason, AUTO_MOVE_CANCEL_REASON.MANUAL_INPUT);
  assert.equal(auto.snapshot().cancelReason, null);
  assert.equal(auto.cancel(AUTO_MOVE_CANCEL_REASON.USER_CANCEL), true, "a paused session can still be ended permanently");
  assert.equal(auto.snapshot().status, AUTO_MOVE_STATUS.CANCELLED);
});

test("P0-A terminal navigation changes still end the local session", () => {
  for (const [snapshot, reason] of [
    [nav({ destination: null }), AUTO_MOVE_CANCEL_REASON.NAVIGATION_CLEARED],
    [nav({ destination: { id: "poi:other", title: "학생회관", x: 30, z: 40 } }), AUTO_MOVE_CANCEL_REASON.DESTINATION_CHANGED],
    [nav({ status: "ARRIVED" }), AUTO_MOVE_CANCEL_REASON.ARRIVED]
  ]) {
    const auto = createPlayerAutoMove();
    auto.start(nav());
    assert.equal(auto.syncNavigation(snapshot), true);
    assert.equal(auto.snapshot().cancelReason, reason);
  }
});

test("P1-A navigation pause preserves a resumable Auto Move session", () => {
  const auto = createPlayerAutoMove();
  auto.start(nav());
  assert.equal(auto.syncNavigation(nav({ status: "PAUSED" })), true);
  assert.equal(auto.paused, true);
  assert.equal(auto.snapshot().pauseReason, AUTO_MOVE_CANCEL_REASON.NAVIGATION_PAUSED);
  assert.equal(auto.snapshot().destinationId, "poi:poi.main-hall");
});

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type, event = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, target: event.target ?? null, ...event });
  }
}

test("P0-A keyboard and touch movement cancel, typing does not", () => {
  const win = new FakeTarget();
  const joystick = new FakeTarget();
  const jump = new FakeTarget();
  const auto = createPlayerAutoMove();
  const off = bindAutoMoveManualCancellation({ autoMove: auto, windowTarget: win, joystick, jumpButton: jump });

  auto.start(nav());
  win.dispatch("keydown", { code: "KeyW" });
  assert.equal(auto.snapshot().pauseReason, AUTO_MOVE_CANCEL_REASON.MANUAL_INPUT);
  assert.equal(auto.paused, true);

  auto.start(nav());
  win.dispatch("keydown", { code: "KeyW", target: { closest: () => ({}) } });
  assert.equal(auto.active, true, "typing targets do not steal UI input");

  joystick.dispatch("pointerdown");
  assert.equal(auto.snapshot().pauseReason, AUTO_MOVE_CANCEL_REASON.MANUAL_INPUT);

  auto.start(nav());
  win.dispatch("keydown", { code: "KeyF" });
  assert.equal(auto.snapshot().pauseReason, AUTO_MOVE_CANCEL_REASON.INTERACTION);

  auto.start(nav());
  win.dispatch("keydown", { code: "KeyM" });
  assert.equal(auto.snapshot().pauseReason, AUTO_MOVE_CANCEL_REASON.TRANSPORT);

  auto.start(nav());
  jump.dispatch("pointerdown");
  assert.equal(auto.snapshot().pauseReason, AUTO_MOVE_CANCEL_REASON.MANUAL_INPUT);

  off();
  auto.start(nav());
  win.dispatch("keydown", { code: "KeyA" });
  assert.equal(auto.active, true, "destroy removes listeners");
});

test("P0-A Escape cancels only when no higher UI owns Escape", () => {
  const win = new FakeTarget();
  let blocked = true;
  const auto = createPlayerAutoMove();
  bindAutoMoveManualCancellation({ autoMove: auto, windowTarget: win, shouldIgnoreEscape: () => blocked });

  auto.start(nav());
  win.dispatch("keydown", { code: "Escape" });
  assert.equal(auto.active, true);

  blocked = false;
  win.dispatch("keydown", { code: "Escape" });
  assert.equal(auto.snapshot().pauseReason, AUTO_MOVE_CANCEL_REASON.USER_CANCEL);
  assert.equal(auto.paused, true);
});


test("P0-B route intent points at the next waypoint and never requests sprint", () => {
  assert.deepEqual(autoMoveIntent(nav(), { x: 2, z: 2 }), {
    x: 3 / 5,
    z: 4 / 5,
    sprint: false
  });
  assert.equal(autoMoveIntent(nav({ status: "PAUSED" }), { x: 2, z: 2 }), null);
  assert.equal(autoMoveIntent(nav({ nextWaypoint: null }), { x: 2, z: 2 }), null);
});

test("P0-B update feeds the normal assisted-movement path and clears it when idle", () => {
  const intents = [];
  let clears = 0;
  const auto = createPlayerAutoMove({
    setAssist: intent => intents.push(intent),
    clearAssist: () => { clears += 1; }
  });

  assert.equal(auto.start(nav()), true);
  const clearsAfterStart = clears;
  assert.equal(auto.update(nav(), { x: 2, z: 2 }), true);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].sprint, false);
  assert.ok(Math.abs(Math.hypot(intents[0].x, intents[0].z) - 1) < 1e-12);

  auto.cancel(AUTO_MOVE_CANCEL_REASON.USER_CANCEL);
  const clearsAfterCancel = clears;
  assert.equal(auto.update(nav(), { x: 2, z: 2 }), false);
  assert.equal(clears, clearsAfterCancel, "idle Auto Move must not clear another system's shared assist");
});

test("P0-B source never writes player transforms directly", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/navigation/player-auto-move.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setLocalPosition|setPosition|translateLocal|translate\s*\(/);
  assert.match(source, /setAssist\(intent\)/);
});


async function realPlayerControllerForAutoMove(position) {
  const listeners = {};
  globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); } };
  globalThis.document = {
    body: { dataset: {} },
    getElementById: id => (id === "profile-panel" || id === "view-settings" || id === "keyboard-shortcuts-panel"
      ? { hidden: true } : null)
  };
  globalThis.HTMLElement = class { closest() { return null; } };
  const pos = { ...position };
  const entity = {
    mountKind: null,
    getLocalPosition: () => ({ ...pos }),
    setLocalPosition: (x, y, z) => Object.assign(pos, { x, y, z }),
    setLocalEulerAngles() {}
  };
  const controller = new PlayerController(entity);
  return {
    controller,
    pos,
    cleanup() {
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.HTMLElement;
    }
  };
}

test("P0-B uses the existing PlayerController walk path, including camera-independent world steering", async () => {
  const start = { x: 0, y: 1.15, z: -98 };
  const h = await realPlayerControllerForAutoMove(start);
  try {
    const route = nav({
      destination: { id: "poi:test", title: "테스트", x: 0, z: -80 },
      nextWaypoint: { x: 0, z: -90 }
    });
    const auto = createPlayerAutoMove({
      setAssist: intent => h.controller.setAssistedMovement(intent),
      clearAssist: () => h.controller.clearAssistedMovement()
    });
    assert.equal(auto.start(route), true);
    for (let i = 0; i < 12; i += 1) {
      auto.update(route, h.pos);
      h.controller.update(1 / 60, Math.PI / 2);
    }
    assert.equal(h.controller.moving, true, "existing locomotion flag drives the existing walk animation");
    assert.ok(h.pos.z > start.z + 0.5, `moved along route: ${JSON.stringify(h.pos)}`);
    assert.ok(Math.abs(h.pos.x - start.x) < 1e-6, "camera yaw does not bend assisted world-space steering");
    assert.equal(h.controller.mounted, false);
  } finally {
    h.cleanup();
  }
});


test("P0-C stuck recovery reroutes once, then stops safely if still blocked", () => {
  const clock = { t: 0, now() { return this.t; } };
  const reroutes = [];
  const events = [];
  let clears = 0;
  const auto = createPlayerAutoMove({
    clock,
    setAssist() {},
    clearAssist() { clears += 1; },
    requestReroute(target, position) {
      reroutes.push({ target, position: { ...position } });
      return true;
    }
  });
  auto.onChange((state, event) => events.push([event, state.cancelReason, state.rerouteAttempts]));
  const route = nav({ nextWaypoint: { x: 10, z: 0 } });
  const pos = { x: 0, z: 0 };

  assert.equal(auto.start(route), true);
  auto.update(route, pos);
  clock.t += AUTO_MOVE_DEFAULTS.stuckMs + 1;
  assert.equal(auto.update(route, pos), false, "first stall pauses assist for a reroute frame");
  assert.equal(auto.active, true);
  assert.equal(reroutes.length, 1);
  assert.equal(auto.snapshot().rerouteAttempts, 1);
  assert.ok(events.some(([event]) => event === "reroute"));

  clock.t += AUTO_MOVE_DEFAULTS.stuckMs + 1;
  assert.equal(auto.update(route, pos), false);
  assert.equal(auto.active, false);
  assert.equal(auto.snapshot().cancelReason, AUTO_MOVE_CANCEL_REASON.STUCK);
  assert.equal(reroutes.length, 1, "P0-C never loops reroutes indefinitely");
  assert.ok(clears >= 3, "start, reroute and stop all clear stale assist");
});

test("P0-C meaningful progress resets the stuck timer", () => {
  const clock = { t: 0, now() { return this.t; } };
  let reroutes = 0;
  const auto = createPlayerAutoMove({
    clock,
    setAssist() {},
    requestReroute() { reroutes += 1; return true; }
  });
  const route = nav({ nextWaypoint: { x: 10, z: 0 } });
  assert.equal(auto.start(route), true);
  auto.update(route, { x: 0, z: 0 });
  clock.t += AUTO_MOVE_DEFAULTS.stuckMs - 100;
  auto.update(route, { x: 0.3, z: 0 }); // 0.6m in the shared world scale
  clock.t += AUTO_MOVE_DEFAULTS.stuckMs - 100;
  assert.equal(auto.update(route, { x: 0.3, z: 0 }), true);
  assert.equal(auto.active, true);
  assert.equal(reroutes, 0);
});

test("P0-C arrival clears movement assist and ends only the auto-move session", () => {
  let clears = 0;
  const auto = createPlayerAutoMove({ clearAssist: () => { clears += 1; } });
  assert.equal(auto.start(nav()), true);
  const before = clears;
  assert.equal(auto.syncNavigation(nav({ status: "ARRIVED", nextWaypoint: null })), true);
  assert.equal(auto.active, false);
  assert.equal(auto.snapshot().cancelReason, AUTO_MOVE_CANCEL_REASON.ARRIVED);
  assert.equal(clears, before + 1);
});


test("P1-A resume returns a paused session to MOVING on the same destination", () => {
  const events = [];
  const auto = createPlayerAutoMove();
  auto.onChange((state, event) => events.push([state.status, event]));
  assert.equal(auto.start(nav()), true);
  assert.equal(auto.pause(AUTO_MOVE_CANCEL_REASON.MANUAL_INPUT), true);
  assert.equal(auto.resume(nav({ nextWaypoint: { x: 7, z: 8 } })), true);
  assert.equal(auto.active, true);
  assert.equal(auto.paused, false);
  assert.equal(auto.snapshot().status, AUTO_MOVE_STATUS.MOVING);
  assert.equal(auto.snapshot().pauseReason, null);
  assert.equal(auto.snapshot().destinationId, "poi:poi.main-hall");
  assert.ok(events.some(([status, event]) => status === AUTO_MOVE_STATUS.PAUSED && event === "pause"));
  assert.ok(events.some(([status, event]) => status === AUTO_MOVE_STATUS.MOVING && event === "resume"));
});

test("P1-A resume rejects a changed destination and keeps the session paused", () => {
  const auto = createPlayerAutoMove();
  auto.start(nav());
  auto.pause(AUTO_MOVE_CANCEL_REASON.MANUAL_INPUT);
  const changed = nav({ destination: { id: "poi:other", title: "학생회관", x: 30, z: 40 } });
  assert.equal(auto.resume(changed), false);
  assert.equal(auto.paused, true);
  assert.equal(auto.snapshot().destinationId, "poi:poi.main-hall");
});

test("P1-A a paused session still observes terminal navigation changes", () => {
  const auto = createPlayerAutoMove();
  auto.start(nav());
  auto.pause(AUTO_MOVE_CANCEL_REASON.USER_CANCEL);
  assert.equal(auto.syncNavigation(nav({ destination: null })), true);
  assert.equal(auto.snapshot().status, AUTO_MOVE_STATUS.CANCELLED);
  assert.equal(auto.snapshot().cancelReason, AUTO_MOVE_CANCEL_REASON.NAVIGATION_CLEARED);
});


test("P1-B campus bike follows Auto Move through the existing mounted locomotion path", async () => {
  const start = { x: 0, y: 1.15, z: -98 };
  const h = await realPlayerControllerForAutoMove(start);
  try {
    h.controller.mounted = true;
    h.controller.mountId = CAMPUS_BIKE_ID;
    h.controller.entity.mountKind = CAMPUS_BIKE_ID;
    assert.equal(h.controller.onBike, true);

    const route = nav({
      destination: { id: "poi:test-bike", title: "자전거 목적지", x: 0, z: -70 },
      nextWaypoint: { x: 0, z: -88 }
    });
    const auto = createPlayerAutoMove({
      setAssist: intent => h.controller.setAssistedMovement(intent),
      clearAssist: () => h.controller.clearAssistedMovement()
    });
    assert.equal(auto.start(route), true);
    for (let i = 0; i < 12; i += 1) {
      auto.update(route, h.pos);
      h.controller.update(1 / 60, Math.PI / 2);
    }

    assert.equal(h.controller.moving, true);
    assert.ok(h.pos.z > start.z + 0.8, `bike moved along route: ${JSON.stringify(h.pos)}`);
    assert.ok(Math.abs(h.pos.x - start.x) < 1e-6, "bike assisted steering stays world-space");
    assert.equal(h.controller.onBike, true, "Auto Move never dismounts the bike");
  } finally {
    h.cleanup();
  }
});

test("P1-B flight mount never consumes Auto Move assisted steering", async () => {
  const start = { x: 0, y: 5, z: -98 };
  const h = await realPlayerControllerForAutoMove(start);
  try {
    h.controller.mounted = true;
    h.controller.mountId = DRAGON_MOUNT_ID;
    h.controller.entity.mountKind = DRAGON_MOUNT_ID;
    h.controller.grounded = false;
    h.controller.setAssistedMovement({ x: 0, z: 1, sprint: false });
    h.controller.update(1 / 60, 0);

    assert.equal(h.controller.moving, false, "flight mount remains manual-only");
    assert.equal(h.pos.z, start.z, "flight mount does not follow the ground route");
  } finally {
    h.cleanup();
  }
});

test("P1-B PlayerController grants assisted movement only to walkers and the campus bike", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/player-controller.js", import.meta.url), "utf8");
  assert.match(source, /\(!this\.mounted \|\| this\.onBike\)/);
  assert.doesNotMatch(source, /!manual\s*&&\s*this\.assist\s*!==\s*null\s*&&\s*this\.mounted/);
});
