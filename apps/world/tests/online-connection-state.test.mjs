import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionState, ConnectionStateMachine } from "../src/network/connection-state.js";
import { MAIN_HALL, createClient, createWorld, run } from "./support/online-harness.mjs";

const { OFFLINE, CONNECTING, ONLINE, RECONNECTING } = ConnectionState;

test("state machine: OFFLINE → CONNECTING → ONLINE → RECONNECTING → ONLINE", () => {
  const machine = new ConnectionStateMachine();
  assert.equal(machine.state, OFFLINE);
  assert.equal(machine.connected(0), false, "cannot be ONLINE without connecting");
  assert.ok(machine.start(0));
  assert.equal(machine.start(0), false, "start is not re-entrant");
  assert.ok(machine.connected(10));
  assert.ok(machine.lost(20));
  assert.equal(machine.state, RECONNECTING);
  assert.equal(machine.nextRetryAt, 520);
  assert.equal(machine.takeDueRetry(519), false);
  assert.ok(machine.takeDueRetry(520));
  assert.equal(machine.takeDueRetry(520), false, "a retry is handed out once");
  assert.ok(machine.connected(600));
  assert.equal(machine.attempts, 0, "success resets the retry budget");
  assert.deepEqual(machine.history, [OFFLINE, CONNECTING, ONLINE, RECONNECTING, ONLINE]);
});

test("state machine: backoff then OFFLINE when retries are exhausted", () => {
  const machine = new ConnectionStateMachine({ retry: { backoffMs: [100, 200, 400] } });
  machine.start(0);
  machine.lost(0);
  const scheduled = [];
  let now = 0;
  while (machine.state === RECONNECTING) {
    scheduled.push(machine.nextRetryAt - now);
    now = machine.nextRetryAt;
    assert.ok(machine.takeDueRetry(now));
    machine.lost(now);
  }
  assert.deepEqual(scheduled, [100, 200, 400]);
  assert.equal(machine.state, OFFLINE);
  assert.deepEqual(machine.history, [OFFLINE, CONNECTING, RECONNECTING, OFFLINE]);
});

test("state machine: deliberate stop from any live state goes OFFLINE", () => {
  for (const setup of [(m) => m.start(0), (m) => { m.start(0); m.connected(0); }, (m) => { m.start(0); m.lost(0); }]) {
    const machine = new ConnectionStateMachine();
    setup(machine);
    assert.ok(machine.stop(1));
    assert.equal(machine.state, OFFLINE);
    assert.equal(machine.nextRetryAt, null);
  }
});

test("NetworkManager connects through the transport and joins the place zone", () => {
  const world = createWorld();
  const a = createClient(world, { label: "A" });
  const states = [];
  a.net.onStateChange(({ state }) => states.push(state));
  a.net.setPlaceZone(MAIN_HALL);
  assert.ok(a.net.start());
  assert.equal(a.net.state, CONNECTING);
  run(world, 200);
  assert.equal(a.net.state, ONLINE);
  assert.deepEqual(states, [CONNECTING, ONLINE]);
  assert.deepEqual(a.transport.calls.slice(0, 2), ["connect", "joinPlaceZone"]);
  assert.equal(a.net.onlineCount, 1);
});

test("initial connect failure retries, and an unanswered connect times out", () => {
  const world = createWorld();
  world.hub.setReachable(false);
  const a = createClient(world, { label: "A", net: { retry: { backoffMs: [500, 500], connectTimeoutMs: 1000 } } });
  a.net.start();
  run(world, 100);
  assert.equal(a.net.state, RECONNECTING, "unreachable connect reports error");
  world.hub.setReachable(true);
  run(world, 1000);
  assert.equal(a.net.state, ONLINE);

  // A transport that never answers must not leave the client CONNECTING forever.
  const silent = createWorld();
  const b = createClient(silent, { label: "B", net: { retry: { backoffMs: [500], connectTimeoutMs: 1000 } } });
  b.transport.connect = () => {};
  b.net.start();
  run(silent, 1100);
  assert.equal(b.net.state, RECONNECTING);
  run(silent, 2000);
  assert.equal(b.net.state, OFFLINE, "one retry, one timeout, then offline");
});

test("a transport that throws everywhere never throws into the frame loop", () => {
  const world = createWorld();
  const a = createClient(world, { label: "A", net: { retry: { backoffMs: [100, 100] } } });
  a.transport.failing.add("*");
  a.sim.input.speed = 7;
  assert.doesNotThrow(() => { a.net.start(); run(world, 2000); });
  assert.equal(a.net.state, OFFLINE);
  assert.ok(a.sim.z > 13, "local player kept moving the whole time");
  assert.ok(a.net.errors.some((e) => e.method === "connect"));
});

test("async transport rejections are contained", async () => {
  const world = createWorld();
  const a = createClient(world, { label: "A" });
  a.net.setPlaceZone(MAIN_HALL);
  a.net.start();
  run(world, 200);
  a.transport.publishPose = () => Promise.reject(new Error("socket closed"));
  a.sim.input.speed = 7;
  run(world, 500);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(a.net.errors.some((e) => e.method === "publishPose" && /socket closed/.test(e.message)));
  assert.equal(a.net.state, ONLINE);
});
