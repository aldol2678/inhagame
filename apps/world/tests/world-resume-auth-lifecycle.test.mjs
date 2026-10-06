import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";
import { createWorldResumeStore, worldResumeStorageKey } from "../src/lobby/world-resume.js";
import { attachWorldResumeAccountScope } from "../src/lobby/world-resume-account-scope.js";

const member = id => ({ id, is_anonymous: false });
const pose = (x, yawDeg) => ({ position: { x, y: 1.15, z: -76 }, place: { id: "AREA_MAIN_GATE", displayName: "Gate" }, grounded: true, yawDeg });
function memoryStorage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function lifecycleTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    fire(name, event) { for (const fn of listeners.get(name) ?? []) fn(event); }
  };
}
async function fixture(t, { user = member("user-a"), storage = memoryStorage(), reuseDocument = false } = {}) {
  const realtime = createRealtimeWorld();
  const windowTarget = lifecycleTarget();
  const client = createWorldClient(realtime, { label: "A", user, windowTarget });
  await runWorld(realtime, 600);
  t.after(() => client.online.stop());
  const store = createWorldResumeStore({ storage, clock: realtime.scheduler, saveIntervalMs: 0 });
  const button = { hidden: true, addEventListener() {}, removeEventListener() {} };
  const document = globalThis.document;
  if (!reuseDocument) {
    globalThis.document = { getElementById: id => id === "resume-last-location" ? button : null };
    t.after(() => { if (document === undefined) delete globalThis.document; else globalThis.document = document; });
  }
  const world = { online: client.online, resumeStore: store };
  assert.equal(attachWorldResumeAccountScope(world), true);
  const auth = client.lib.clients.find(c => c.storageKey === "default");
  return { realtime, client, windowTarget, storage, store, world, auth, button };
}
function readScope(storage, scope) { return createWorldResumeStore({ storage, scope }).read(); }
function assertRecord(store, x, yawDeg) {
  const read = store.read();
  assert.equal(read.state, "VALID");
  assert.equal(read.record.x, x);
  assert.equal(read.record.yawDeg, yawDeg);
}

test("real logout: first null-identity observer saves guest even while online.userId is stale", async t => {
  const f = await fixture(t);
  assert.equal(f.store.maybeSave(pose(0, 18)), true);
  const beforeA = f.storage.getItem(worldResumeStorageKey("user-a"));
  let observed;
  f.client.online.onIdentity(identity => {
    if (identity !== null) return;
    observed = { userId: f.client.online.userId, scope: f.store.scope, saved: f.store.maybeSave(pose(2, 90)) };
  });
  f.auth.signOut();
  await runWorld(f.realtime, 600);
  assert.deepEqual(observed, { userId: "user-a", scope: "guest", saved: true });
  assert.equal(f.storage.getItem(worldResumeStorageKey("user-a")), beforeA);
  assertRecord(f.store, 2, 90);
  assert.equal(f.client.online.isGuest, true);
});

test("real A → logout → guest → B → logout → A restores three independent records", async t => {
  const f = await fixture(t);
  assert.equal(f.store.scope, "user-a");
  assert.equal(f.store.maybeSave(pose(0, 18)), true);
  f.auth.signOut();
  await runWorld(f.realtime, 600);
  assert.equal(f.store.scope, "guest");
  assert.equal(f.store.read().state, "MISSING");
  assert.equal(f.button.hidden, true);
  assert.equal(f.store.maybeSave(pose(2, 90)), true);
  f.auth.signIn(member("user-b"));
  await runWorld(f.realtime, 600);
  assert.equal(f.store.scope, "user-b");
  assert.equal(f.store.read().state, "MISSING");
  assert.equal(f.button.hidden, true);
  assert.equal(f.store.maybeSave(pose(-2, 180)), true);
  f.auth.signOut();
  await runWorld(f.realtime, 600);
  assert.equal(f.store.scope, "guest");
  assertRecord(f.store, 2, 90);
  assert.equal(f.world.resumeEntry.record.x, 2);
  f.auth.signIn(member("user-a"));
  await runWorld(f.realtime, 600);
  assert.equal(f.store.scope, "user-a");
  assertRecord(f.store, 0, 18);
  assert.equal(f.world.resumeEntry.record.x, 0);
  assert.equal(f.button.hidden, false);
  assert.equal(readScope(f.storage, "guest").record.x, 2);
  assert.equal(readScope(f.storage, "user-b").record.x, -2);
  assert.equal(f.storage.data.size, 3);
});

test("real guest → account → guest changes both live write target and resume CTA", async t => {
  const f = await fixture(t, { user: null });
  assert.equal(f.client.online.isGuest, true);
  assert.equal(f.store.maybeSave(pose(2, 90)), true);
  f.auth.signIn(member("user-a"));
  await runWorld(f.realtime, 600);
  assert.equal(f.store.scope, "user-a");
  assert.equal(f.store.read().state, "MISSING");
  assert.equal(f.store.maybeSave(pose(0, 18)), true);
  f.auth.signOut();
  await runWorld(f.realtime, 600);
  assertRecord(f.store, 2, 90);
  assert.equal(f.world.resumeEntry.record.x, 2);
  assert.equal(readScope(f.storage, "user-a").record.x, 0);
});

test("same-browser direct A → B → A switches do not read or overwrite the previous account", async t => {
  const f = await fixture(t);
  assert.equal(f.store.maybeSave(pose(0, 18)), true);
  const scopes = [];
  f.client.online.onIdentity(identity => { scopes.push({ id: identity?.userId ?? null, scope: f.store.scope }); });
  f.auth.signIn(member("user-b"));
  await runWorld(f.realtime, 600);
  assert.deepEqual(scopes.slice(-2), [{ id: null, scope: "guest" }, { id: "user-b", scope: "user-b" }]);
  assert.equal(f.store.read().state, "MISSING");
  assert.equal(f.store.maybeSave(pose(-2, 180)), true);
  f.auth.signIn(member("user-a"));
  await runWorld(f.realtime, 600);
  assertRecord(f.store, 0, 18);
  assert.equal(f.world.resumeEntry.record.x, 0);
  assert.equal(readScope(f.storage, "user-b").record.x, -2);
});

test("pagehide and BFCache pageshow preserve saved account/guest records and restore account ownership", async t => {
  const f = await fixture(t);
  const guest = createWorldResumeStore({ storage: f.storage, clock: f.realtime.scheduler });
  assert.equal(guest.maybeSave(pose(2, 90)), true);
  assert.equal(f.store.maybeSave(pose(0, 18)), true); // The production frame save path, before pagehide.
  const records = [...f.storage.data];
  f.windowTarget.fire("pagehide", { persisted: true });
  assert.equal(f.store.scope, "guest");
  assert.deepEqual([...f.storage.data], records, "pagehide itself must not rewrite a saved pose");
  f.windowTarget.fire("pageshow", { persisted: true });
  await runWorld(f.realtime, 600);
  assert.equal(f.store.scope, "user-a");
  assertRecord(f.store, 0, 18);
  assert.equal(f.world.resumeEntry.record.x, 0);
  assert.equal(f.store.maybeSave(pose(-2, 180)), true);
  assert.equal(readScope(f.storage, "guest").record.x, 2);
  assert.equal(readScope(f.storage, "user-a").record.x, -2);
});

test("page termination followed by a fresh account session reads its final frame save", async t => {
  const f = await fixture(t);
  assert.equal(f.store.maybeSave(pose(0, 18)), true);
  f.windowTarget.fire("pagehide", { persisted: false });
  const afterHide = [...f.storage.data];
  assert.equal(f.store.scope, "guest");
  assert.equal(readScope(f.storage, "guest").state, "MISSING");
  assert.equal(readScope(f.storage, "user-a").record.yawDeg, 18);
  const second = await fixture(t, { storage: f.storage, reuseDocument: true });
  assert.equal(second.store.scope, "user-a");
  assertRecord(second.store, 0, 18);
  assert.equal(second.world.resumeEntry.record.x, 0);
  assert.deepEqual([...f.storage.data], afterHide);
});

test("every browser QA clear callback executes after serialization with explicit key arguments", async () => {
  const source = readFileSync(new URL("../qa-main-lobby-browser.mjs", import.meta.url), "utf8");
  const constants = [...source.matchAll(/^const WORLD_RESUME_\w+ = .+;$/gm)].map(match => match[0]).join("\n");
  const clear = source.match(/function clearResumeStorage\([^)]*\) \{[\s\S]*?\n\}/)[0];
  const open = source.match(/async function openLobby\([^)]*\) \{[\s\S]*?\n\}/)[0];
  const calls = [...source.matchAll(/await openLobby\(context, clearResumeStorage[^;]+/g)].map(match => match[0]);
  assert.equal(calls.length, 3, "cover normal, optional-data-failure, and avatar-fallback call sites");
  for (const call of calls) {
    const storage = memoryStorage();
    for (const key of ["inhagame-world-resume-v1", "inhagame-world-resume-v1:guest", "inhagame-campus-tour-v1", "inhagame-world-resume-v1:user-a"]) storage.setItem(key, "keep-or-clear");
    const page = {
      on() {}, async goto() {}, async waitForFunction() {},
      async addInitScript(fn, arg) {
        // Playwright sends function source and a serializable argument, never lexical bindings.
        vm.runInNewContext(`(${fn.toString()})(${JSON.stringify(arg)})`, { localStorage: storage });
      }
    };
    const context = { async newPage() { return page; }, async route() {} };
    await vm.runInNewContext(`${constants}\n${clear}\n${open}\n(async () => ${call})()`, { context, URL, base: "https://example.test" });
    assert.deepEqual([...storage.data.keys()], ["inhagame-world-resume-v1:user-a"]);
  }
});
