// F06: once the online layer is stopped (operator ejection, pagehide teardown, explicit stop) no late
// getSession() answer, scheduled auth callback or sign-in completion may create a NEW Realtime session.
import test from "node:test";
import assert from "node:assert/strict";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";

const member = id => ({ id, is_anonymous: false });
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const joinsOf = world => world.server.joins.length;
const liveOf = (world, client) => client.lib.clients.reduce((n, c) => n + world.server.liveSubscriptions(c), 0);

async function connected(t, options = {}) {
  const world = createRealtimeWorld();
  const client = createWorldClient(world, { label: "A", user: member("user-a"), ...options });
  await runWorld(world, 600);
  t.after(() => client.online.stop());
  return { world, client, auth: client.lib.clients.find(c => c.storageKey === "default") };
}

test("a getSession answer that arrives after stop() cannot open a new Realtime session", async t => {
  const { world, client, auth } = await connected(t);
  assert.ok(liveOf(world, client) > 0, "fixture starts connected");
  const original = auth.auth.getSession;
  const gate = deferred();
  auth.auth.getSession = () => gate.promise;
  const refresh = client.online.refreshAuth();
  client.online.stop();
  const joinsAtStop = joinsOf(world);
  gate.resolve(await original());
  await refresh;
  await runWorld(world, 600);
  assert.equal(client.online.network, null, "no NetworkManager after stop");
  assert.equal(client.online.status().sessionId, null);
  assert.equal(joinsOf(world), joinsAtStop, "no channel was joined after stop");
  assert.equal(liveOf(world, client), 0);
});

test("an auth callback already scheduled before stop() cannot reconnect afterwards", async t => {
  const { world, client, auth } = await connected(t);
  auth.signIn(member("user-b")); // the callback only schedules setTimeout(0)
  client.online.stop();
  const joinsAtStop = joinsOf(world);
  await runWorld(world, 600);
  assert.equal(client.online.network, null);
  assert.equal(joinsOf(world), joinsAtStop);
  assert.equal(liveOf(world, client), 0);
});

test("explicit refreshAuth() after stop() is a no-op", async t => {
  const { world, client } = await connected(t);
  client.online.stop();
  const joinsAtStop = joinsOf(world);
  await client.online.refreshAuth();
  await runWorld(world, 600);
  assert.equal(client.online.network, null);
  assert.equal(joinsOf(world), joinsAtStop);
});

test("a guest sign-in that completes after stop() cannot open a guest session", async t => {
  const world = createRealtimeWorld();
  const client = createWorldClient(world, { label: "G", user: null });
  const gate = deferred();
  let real;
  // The guest client is created lazily after the first await; intercept it before that happens.
  const make = client.lib.createClient;
  client.lib.createClient = (...args) => {
    const created = make(...args);
    if (created.storageKey !== "default") {
      real = created.auth.signInAnonymously;
      created.auth.signInAnonymously = () => gate.promise;
      created.auth.realSignIn = () => real.call(created.auth);
    }
    return created;
  };
  await runWorld(world, 100);
  const guestClient = client.lib.clients.find(c => c.storageKey !== "default");
  assert.ok(guestClient, "guest client exists and is waiting on anonymous sign-in");
  client.online.stop();
  gate.resolve(await guestClient.auth.realSignIn());
  await runWorld(world, 600);
  assert.equal(client.online.network, null);
  assert.equal(liveOf(world, client), 0);
  assert.equal(joinsOf(world), 0);
});

test("a profile lookup that finishes after stop() cannot open a member session", async t => {
  const world = createRealtimeWorld();
  const client = createWorldClient(world, { label: "P", user: member("user-p") });
  const auth = client.lib.clients.find(c => c.storageKey === "default");
  const gate = deferred();
  auth.from = () => ({ select: () => ({ eq: () => ({ single: () => gate.promise.then(() => ({ data: { nickname: "late" }, error: null })) }) }) });
  await runWorld(world, 100);
  client.online.stop();
  gate.resolve();
  await runWorld(world, 600);
  assert.equal(client.online.network, null);
  assert.equal(liveOf(world, client), 0);
  assert.equal(joinsOf(world), 0);
});
