import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
const member = world => createWorldClient(world, { label: "M" });
const authClient = client => client.lib.clients.find(c => c.storageKey === "default");

function windowEvents() {
  const handlers = new Map();
  return {
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
    },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
    dispatch(type, event = {}) {
      for (const handler of handlers.get(type) ?? []) handler(event);
    }
  };
}

test("permanent stop prevents manual refreshAuth or repeated stop from resurrecting channels", async () => {
  const world = createRealtimeWorld();
  const client = member(world);
  await runWorld(world, 600);
  assert.ok(client.online.userId);
  client.online.stop();
  client.online.stop();
  await client.online.refreshAuth();
  await runWorld(world, 100);
  assert.equal(client.online.userId, null);
  assert.equal(client.online.status().signedIn, false);
  assert.equal(client.online.status().liveChannels, 0);
});

test("getSession resolving after stop cannot recreate a member session", async () => {
  const world = createRealtimeWorld();
  const client = member(world);
  await runWorld(world, 600);
  const sdk = authClient(client);
  assert.ok(sdk);
  let finish;
  sdk.auth.getSession = () => new Promise(resolve => { finish = resolve; });
  const pending = client.online.refreshAuth();
  assert.equal(typeof finish, "function");
  client.online.stop();
  finish({ data: { session: sdk.session }, error: null });
  await pending;
  assert.equal(client.online.userId, null);
  assert.equal(client.online.status().signedIn, false);
});

test("old getSession rejection cannot stop a newer successful refresh", async () => {
  const world = createRealtimeWorld();
  const client = member(world);
  await runWorld(world, 600);
  const sdk = authClient(client);
  const original = sdk.auth.getSession;
  let rejectOld;
  sdk.auth.getSession = () => new Promise((_resolve, reject) => { rejectOld = reject; });
  const old = client.online.refreshAuth();
  sdk.auth.getSession = original;
  await client.online.refreshAuth();
  assert.ok(client.online.userId, "newer auth request retains a member session");
  rejectOld(new Error("synthetic outdated auth failure"));
  await old;
  assert.ok(client.online.userId, "older rejection cannot destroy current session");
  client.online.stop();
});

test("BFCache suspension releases the session and actual persisted callback resumes it once", async () => {
  const bus = windowEvents();
  const world = createRealtimeWorld();
  const client = createWorldClient(world, { label: "M", windowTarget: bus });
  await runWorld(world, 600);
  const original = client.online.userId;
  assert.ok(original);
  bus.dispatch("pagehide", { persisted: true });
  assert.equal(client.online.userId, null);
  bus.dispatch("pageshow", { persisted: false });
  assert.equal(client.online.userId, null);
  bus.dispatch("pageshow", { persisted: true });
  await runWorld(world, 600);
  assert.equal(client.online.userId, original);
  const resumed = client.online.status().sessionId;
  bus.dispatch("pageshow", { persisted: true });
  await flush();
  assert.equal(client.online.status().sessionId, resumed, "duplicate pageshow must not restart the session");
  client.online.stop();
  bus.dispatch("pagehide", { persisted: true });
  bus.dispatch("pageshow", { persisted: true });
  await runWorld(world, 100);
  assert.equal(client.online.userId, null, "permanent stop cannot be undone by BFCache");
});

test("guest anonymous sign-in completing after stop cannot create a channel", async () => {
  const world = createRealtimeWorld();
  const client = createWorldClient(world, { label: "G", user: null, anonymousSignIns: false });
  await runWorld(world, 100);
  const sdk = client.lib.clients.find(c => c.storageKey !== "default");
  assert.ok(sdk);
  let finish;
  sdk.auth.signInAnonymously = () => new Promise(resolve => { finish = resolve; });
  const pending = client.online.refreshAuth();
  await flush();
  assert.equal(typeof finish, "function");
  client.online.stop();
  finish({ data: { user: { id: "anon-delayed-guest", is_anonymous: true } }, error: null });
  await pending;
  assert.equal(client.online.status().signedIn, false);
  assert.equal(client.online.status().liveChannels, 0);
});

test("lifecycle contract guards old scheduled Auth callbacks, errors and guest completion", () => {
  const source = readFileSync(new URL("../src/online/world-online.js", import.meta.url), "utf8");
  assert.match(source, /let permanentlyStopped = false/);
  assert.match(source, /const isCurrentStart = epoch => !permanentlyStopped && !pageSuspended/);
  assert.match(source, /const scheduledGeneration = lifecycleGeneration/);
  assert.match(source, /if \(!isCurrentStart\(epoch\)\) return;\s*record\("auth", error\)/);
  assert.match(source, /if \(permanentlyStopped\) return;\s*permanentlyStopped = true/);
});
