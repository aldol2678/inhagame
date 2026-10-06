import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_RESUME_STORAGE_PREFIX,
  WORLD_RESUME_STORAGE_KEY,
  WORLD_RESUME_SCOPE_GUEST,
  createWorldResumeStore,
  normalizeResumeScope,
  worldResumeStorageKey
} from "../src/lobby/world-resume.js";
import { attachWorldResumeAccountScope } from "../src/lobby/world-resume-account-scope.js";

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key)
  };
}

function resumeClock(start = 10_000) {
  let now = start;
  return { now: () => now, advance(ms) { now += ms; } };
}

const MAIN_GATE_RESUME = Object.freeze({
  position: { x: 0, y: 1.15, z: -76 },
  place: { id: "AREA_MAIN_GATE", displayName: "정문·남쪽 진입로" }
});

test("resume key convention keeps guest as the default live alias", () => {
  assert.equal(WORLD_RESUME_STORAGE_KEY, `${WORLD_RESUME_STORAGE_PREFIX}:${WORLD_RESUME_SCOPE_GUEST}`);
  assert.equal(worldResumeStorageKey(), WORLD_RESUME_STORAGE_KEY);
  assert.equal(normalizeResumeScope(""), WORLD_RESUME_SCOPE_GUEST);
  assert.equal(normalizeResumeScope("user/a b"), "user_a_b");
});

test("resume A: same account restores its own record", () => {
  const storage = memoryStorage();
  const clock = resumeClock();
  const store = createWorldResumeStore({ storage, clock, saveIntervalMs: 2000, scope: "user-a" });
  assert.equal(store.maybeSave({ ...MAIN_GATE_RESUME, grounded: true, yawDeg: 18, cameraYaw: .4 }), true);
  assert.equal(createWorldResumeStore({ storage, scope: "user-a" }).read().state, "VALID");
  assert.equal(createWorldResumeStore({ storage, scope: "user-a" }).read().record.yawDeg, 18);
});

test("resume B/C: another account does not inherit and keeps its own position", () => {
  const storage = memoryStorage();
  const clock = resumeClock();
  const storeA = createWorldResumeStore({ storage, clock, saveIntervalMs: 2000, scope: "user-a" });
  assert.equal(storeA.maybeSave({ ...MAIN_GATE_RESUME, grounded: true, yawDeg: 18 }), true);

  const storeB = createWorldResumeStore({ storage, clock, saveIntervalMs: 2000, scope: "user-b" });
  assert.equal(storeB.read().state, "MISSING");
  clock.advance(2500);
  assert.equal(storeB.maybeSave({
    position: { x: 2, y: 1.15, z: -76 },
    place: MAIN_GATE_RESUME.place,
    grounded: true,
    yawDeg: 90
  }), true);

  assert.equal(createWorldResumeStore({ storage, scope: "user-a" }).read().record.x, 0);
  assert.equal(createWorldResumeStore({ storage, scope: "user-b" }).read().record.x, 2);
  assert.equal(createWorldResumeStore({ storage, scope: "user-a" }).read().record.yawDeg, 18);
  assert.equal(createWorldResumeStore({ storage, scope: "user-b" }).read().record.yawDeg, 90);
});

test("resume D/E: guest and signed-in keys stay isolated", () => {
  const storage = memoryStorage();
  const clock = resumeClock();
  const guest = createWorldResumeStore({ storage, clock, saveIntervalMs: 2000, scope: WORLD_RESUME_SCOPE_GUEST });
  assert.equal(guest.maybeSave({ ...MAIN_GATE_RESUME, grounded: true, yawDeg: 11 }), true);

  const account = createWorldResumeStore({ storage, clock, saveIntervalMs: 2000, scope: "user-a" });
  assert.equal(account.read().state, "MISSING");
  clock.advance(2500);
  assert.equal(account.maybeSave({
    position: { x: 2, y: 1.15, z: -76 },
    place: MAIN_GATE_RESUME.place,
    grounded: true,
    yawDeg: 33
  }), true);

  assert.equal(createWorldResumeStore({ storage, scope: WORLD_RESUME_SCOPE_GUEST }).read().record.yawDeg, 11);
  assert.equal(createWorldResumeStore({ storage, scope: "user-a" }).read().record.yawDeg, 33);
  guest.setScope("user-a");
  assert.equal(guest.read().record.yawDeg, 33);
  guest.setScope(WORLD_RESUME_SCOPE_GUEST);
  assert.equal(guest.read().record.yawDeg, 11);
});

test("resume F: unscoped legacy key is discarded and never adopted", () => {
  const storage = memoryStorage();
  const legacy = {
    version: 1, x: 0, y: 1.15, z: -76, yawDeg: 45, cameraYaw: 0, savedAt: 10_000,
    zoneId: "AREA_MAIN_GATE", displayName: "정문·남쪽 진입로"
  };
  storage.setItem(WORLD_RESUME_STORAGE_PREFIX, JSON.stringify(legacy));

  const guest = createWorldResumeStore({ storage, scope: WORLD_RESUME_SCOPE_GUEST });
  assert.equal(guest.read().state, "MISSING");
  assert.equal(storage.data.has(WORLD_RESUME_STORAGE_PREFIX), false);

  storage.setItem(WORLD_RESUME_STORAGE_PREFIX, JSON.stringify(legacy));
  const account = createWorldResumeStore({ storage, scope: "user-a" });
  assert.equal(account.read().state, "MISSING");
  assert.equal(storage.data.has(WORLD_RESUME_STORAGE_PREFIX), false);
  assert.equal(JSON.stringify(account.read().record ?? {}).includes("user-a"), false);
});

test("resume G: grounded / mounted / insideRoom save rules stay unchanged", () => {
  const storage = memoryStorage();
  const clock = resumeClock();
  const store = createWorldResumeStore({ storage, clock, saveIntervalMs: 2000, scope: "user-a" });
  const position = MAIN_GATE_RESUME.position;
  const place = MAIN_GATE_RESUME.place;

  assert.equal(store.maybeSave({ position, place, grounded: false }), false);
  assert.equal(store.maybeSave({ position, place, grounded: true, mounted: true }), false);
  assert.equal(store.maybeSave({ position, place, grounded: true, insideRoom: true }), false);
  assert.equal(store.maybeSave({ position, place, grounded: true, yawDeg: 18 }), true);
  assert.ok(storage.data.has(worldResumeStorageKey("user-a")));
  assert.equal(storage.data.has(WORLD_RESUME_STORAGE_PREFIX), false);
});

test("identity hook rebinds lobby CTA to the signed-in scope only", () => {
  const storage = memoryStorage();
  const clock = resumeClock();
  const guestStore = createWorldResumeStore({ storage, clock, saveIntervalMs: 2000, scope: WORLD_RESUME_SCOPE_GUEST });
  assert.equal(guestStore.maybeSave({ ...MAIN_GATE_RESUME, grounded: true, yawDeg: 11 }), true);

  const accountStore = createWorldResumeStore({ storage, clock, saveIntervalMs: 2000, scope: "user-a" });
  clock.advance(2500);
  assert.equal(accountStore.maybeSave({
    position: { x: 2, y: 1.15, z: -76 },
    place: MAIN_GATE_RESUME.place,
    grounded: true,
    yawDeg: 33
  }), true);

  const listeners = new Set();
  const online = {
    userId: null,
    onIdentity(handler) {
      listeners.add(handler);
      handler({ userId: this.userId });
      return () => listeners.delete(handler);
    }
  };
  const world = {
    resumeStore: guestStore,
    online,
    resumeEntry: { destroy() { world.destroyed += 1; } },
    destroyed: 0,
    player: {},
    orbit: {},
    lobbyWorld: {},
    lobbyTransition: {}
  };

  assert.equal(attachWorldResumeAccountScope(world), true);
  assert.equal(guestStore.scope, WORLD_RESUME_SCOPE_GUEST);
  assert.equal(guestStore.read().record.yawDeg, 11);

  online.userId = "user-a";
  for (const handler of listeners) handler({ userId: online.userId });
  assert.equal(guestStore.scope, "user-a");
  assert.equal(guestStore.read().record.yawDeg, 33);
  assert.equal(world.destroyed, 1);

  online.userId = null;
  for (const handler of listeners) handler({ userId: null });
  assert.equal(guestStore.scope, WORLD_RESUME_SCOPE_GUEST);
  assert.equal(guestStore.read().record.yawDeg, 11);
});
