// Contract between the population heartbeat and the Realtime layer, with the real modules:
//   allowed state unconfirmed for the grace window -> suspend (no Realtime session may exist)
//   a later successful heartbeat                   -> resume
//   WORLD_SESSION_REVOKED (any time)               -> terminal stop
// An unreachable server only ever suspends; only a server answer of REVOKED stops for good.
import test from "node:test";
import assert from "node:assert/strict";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";
import { startWorldPopulationHeartbeat, WORLD_VERIFY_GRACE_MS, WORLD_HEARTBEAT_MS } from "../src/online/world-population-heartbeat.js";
import { createWorldSessionGuard, WORLD_SESSION_NOTICE } from "../src/online/world-session-guard.js";

const member = id => ({ id, is_anonymous: false });
const UUIDS = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];

function manualTimers() {
  let next = 0;
  const intervals = new Map();
  const timeouts = new Map();
  return {
    intervals, timeouts,
    setInterval(fn, ms) { const id = ++next; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, ms) { const id = ++next; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    tick() { for (const { fn } of [...intervals.values()]) fn(); },
    fireGrace() {
      const entry = [...timeouts.entries()].find(([, timer]) => timer.ms === WORLD_VERIFY_GRACE_MS);
      assert.ok(entry, "grace timer pending");
      timeouts.delete(entry[0]);
      entry[1].fn();
    }
  };
}

async function fixture(t, { answer = () => ({ error: null }) } = {}) {
  const world = createRealtimeWorld();
  const client = createWorldClient(world, { label: "A", user: member("user-a") });
  const auth = client.lib.clients.find(c => c.storageKey === "default");
  const timers = manualTimers();
  const notices = [];
  const state = { answer, calls: 0 };
  const guard = createWorldSessionGuard({ getOnline: () => client.online, setNotice: message => notices.push(message) });
  const hb = startWorldPopulationHeartbeat({
    client: { auth: auth.auth, rpc: () => { state.calls += 1; return Promise.resolve(state.answer()); } },
    randomId: (() => { const queue = [...UUIDS, ...UUIDS]; return () => queue.shift(); })(),
    visitorStorage: { getItem: () => UUIDS[1], setItem() {} },
    scheduler: timers, windowTarget: null,
    onRevoked: guard.onRevoked, onUnverified: guard.onUnverified, onVerified: guard.onVerified
  });
  t.after(() => { hb.stop(); client.online.stop(); });
  await runWorld(world, 600);
  const live = () => client.lib.clients.reduce((n, c) => n + world.server.liveSubscriptions(c), 0);
  return { world, client, auth, timers, hb, state, notices, live };
}

test("constants: the grace window is three heartbeat intervals and shorter than the server's 70 s window", () => {
  assert.equal(WORLD_VERIFY_GRACE_MS, 3 * WORLD_HEARTBEAT_MS);
  assert.ok(WORLD_VERIFY_GRACE_MS < 70_000);
});

test("healthy heartbeats keep the Realtime session connected", async t => {
  const f = await fixture(t);
  assert.ok(f.live() > 0);
  for (let i = 0; i < 5; i += 1) { f.timers.tick(); await runWorld(f.world, 100); }
  assert.equal(f.client.online.suspended, false);
  assert.ok(f.live() > 0);
});

test("an unconfirmable allowed state is not kept indefinitely: grace expiry suspends, success resumes", async t => {
  const f = await fixture(t);
  f.state.answer = () => ({ error: { message: "network down" } });
  for (let i = 0; i < 3; i += 1) { f.timers.tick(); await runWorld(f.world, 100); }
  assert.ok(f.live() > 0, "still inside the grace window: the connection is kept");
  f.timers.fireGrace();
  assert.equal(f.client.online.suspended, true);
  assert.equal(f.client.online.network, null);
  assert.equal(f.live(), 0, "no Realtime channel survives the suspension");
  assert.equal(f.hb.status().stopped, false, "heartbeat itself keeps trying");

  // Nothing may reconnect while suspended, whatever triggers it.
  const joinsHeld = f.world.server.joins.length;
  f.auth.signIn(member("user-a"));
  await f.client.online.refreshAuth();
  await runWorld(f.world, 600);
  assert.equal(f.client.online.network, null);
  assert.equal(f.world.server.joins.length, joinsHeld, "auth events and refreshAuth cannot create a channel");

  // Many more failed heartbeats later it is still held (not "eventually connected anyway").
  for (let i = 0; i < 10; i += 1) { f.timers.tick(); await runWorld(f.world, 100); }
  assert.equal(f.live(), 0);

  f.state.answer = () => ({ error: null });
  f.timers.tick();
  await runWorld(f.world, 1_000);
  assert.equal(f.client.online.suspended, false);
  assert.ok(f.live() > 0, "a successful heartbeat restores the connection");
  assert.ok(f.client.online.network, "a fresh NetworkManager exists");
});

test("revocation while connected is terminal and nothing reconnects", async t => {
  const f = await fixture(t);
  f.state.answer = () => ({ error: { code: "42501", message: "WORLD_SESSION_REVOKED" } });
  f.timers.tick();
  await runWorld(f.world, 600);
  assert.equal(f.client.online.stopped, true);
  assert.equal(f.live(), 0);
  assert.deepEqual(f.notices, [WORLD_SESSION_NOTICE.revoked]);
  const joins = f.world.server.joins.length;
  f.auth.signIn(member("user-a"));
  await f.client.online.refreshAuth();
  assert.equal(f.client.online.resume(), false, "a stopped layer cannot be resumed");
  await runWorld(f.world, 600);
  assert.equal(f.world.server.joins.length, joins);
  assert.equal(f.client.online.network, null);
});

test("revocation while suspended is terminal and a later success cannot revive it", async t => {
  const f = await fixture(t);
  f.state.answer = () => ({ error: { message: "network down" } });
  f.timers.tick();
  await runWorld(f.world, 100);
  f.timers.fireGrace();
  assert.equal(f.client.online.suspended, true);
  f.state.answer = () => ({ error: { message: "WORLD_SESSION_REVOKED" } });
  f.timers.tick();
  await runWorld(f.world, 300);
  assert.equal(f.client.online.stopped, true);
  f.state.answer = () => ({ error: null });
  f.timers.tick();
  await runWorld(f.world, 600);
  assert.equal(f.client.online.resume(), false);
  assert.equal(f.live(), 0);
  assert.equal(f.client.online.network, null);
});

test("suspend() and resume() are idempotent and respect the terminal state", async t => {
  const f = await fixture(t);
  assert.equal(f.client.online.resume(), false, "nothing to resume yet");
  assert.equal(f.client.online.suspend("x"), true);
  assert.equal(f.client.online.suspend("x"), false);
  assert.equal(f.client.online.resume(), true);
  assert.equal(f.client.online.resume(), false);
  await runWorld(f.world, 800);
  assert.ok(f.live() > 0);
  f.client.online.stop();
  assert.equal(f.client.online.suspend("x"), false);
  assert.equal(f.client.online.resume(), false);
});

test("a suspend that races an in-flight member start cannot leave a session behind", async t => {
  const world = createRealtimeWorld();
  const client = createWorldClient(world, { label: "R", user: member("user-r") });
  const auth = client.lib.clients.find(c => c.storageKey === "default");
  t.after(() => client.online.stop());
  let release;
  const original = auth.from;
  auth.from = (...args) => {
    const chain = original(...args);
    return { select: () => ({ eq: () => ({ single: () => new Promise(resolve => { release = () => resolve(chain.select().eq().single()); }) }) }) };
  };
  client.online.suspend("race");
  await runWorld(world, 100);
  release?.();
  await runWorld(world, 800);
  assert.equal(client.online.network, null);
  assert.equal(client.lib.clients.reduce((n, c) => n + world.server.liveSubscriptions(c), 0), 0);
});
