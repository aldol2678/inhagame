import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { FLAG_DISABLED, FLAG_ENABLED, FLAG_UNAVAILABLE } from "../src/npc-feature-flags.js";
import { createAssetCanaryRemoteControl } from "../src/asset-canary-remote-control.js";
import { ASSET_CANARY_EVENT, createAssetCanaryTelemetry } from "../src/asset-canary-telemetry.js";

function reply(status, body = null) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}

test("remote control starts enabled then publishes disabled", async () => {
  const responses = [reply(200, { enabled: true }), reply(404)];
  const states = [];
  const remote = createAssetCanaryRemoteControl({ fetcher: async () => responses.shift(), pollMs: 0 });
  remote.subscribe(state => states.push(state));
  assert.equal(await remote.start(), FLAG_ENABLED);
  assert.equal(remote.enabled, true);
  assert.equal(await remote.check(), FLAG_DISABLED);
  assert.equal(remote.enabled, false);
  assert.deepEqual(states, [FLAG_ENABLED, FLAG_DISABLED]);
  assert.equal(remote.status().failClosed, true);
});

test("remote control treats network failure as unavailable fail-closed", async () => {
  const remote = createAssetCanaryRemoteControl({
    fetcher: async () => { throw new Error("offline"); },
    pollMs: 0,
    timeoutMs: 10
  });
  assert.equal(await remote.start(), FLAG_UNAVAILABLE);
  assert.equal(remote.status().failClosed, true);
});

test("canary telemetry emits each privacy-minimal event at most once", () => {
  const sent = [];
  const telemetry = createAssetCanaryTelemetry({
    track: (eventType, surface, target) => sent.push({ eventType, surface, target })
  });
  assert.equal(telemetry.selected(), true);
  assert.equal(telemetry.selected(), false);
  assert.equal(telemetry.active(), true);
  assert.equal(telemetry.rollback(), true);
  assert.equal(telemetry.failure(), true);
  assert.deepEqual(sent.map(item => item.eventType), [
    ASSET_CANARY_EVENT.SELECTED, ASSET_CANARY_EVENT.ACTIVE,
    ASSET_CANARY_EVENT.ROLLBACK, ASSET_CANARY_EVENT.FAILURE
  ]);
  assert.ok(sent.every(item => item.surface === "campus" && item.target === "induck_v3"));
});

// Deterministic lifecycle simulation: these tests do not claim browser BFCache eligibility.
function lifecycleHarness({ previewHost = false } = {}) {
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const pollMs = 15000;
  const remote = createAssetCanaryRemoteControl({
    fetcher: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    pollMs,
    setTimer: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id)
  });
  const states = [];
  remote.subscribe(state => states.push(state));
  const target = new EventTarget();
  const reasons = [];
  const character = {
    assetCanary: { authority: "OPTIMIZED_CANARY" },
    ready: new Promise(() => {}),
    rollbackAssetCanary(reason) {
      reasons.push(reason);
      this.assetCanary = { authority: "CANONICAL" };
      return this.assetCanary;
    }
  };
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const begin = main.indexOf("let assetCanaryRemoteStateCurrent =");
  const end = main.indexOf("window.__INHAGAME_ASSET_PRODUCTION_CANARY__", begin);
  assert.ok(begin >= 0 && end > begin, "test executes the actual main canary subscription and lifecycle wiring");
  runInNewContext(main.slice(begin, end), {
    window: target, previewHost, assetCanaryRemoteControl: remote,
    assetCanaryRemoteState: FLAG_ENABLED, FLAG_ENABLED, character,
    assetProductionCanary: { selected: true },
    assetCanaryTelemetry: createAssetCanaryTelemetry()
  });
  const dispatch = (type, persisted) => {
    const event = new Event(type);
    Object.defineProperty(event, "persisted", { value: persisted });
    target.dispatchEvent(event);
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const settle = async (index, response) => { requests[index].resolve(response); await flush(); };
  const polls = () => [...timers.values()].filter(timer => timer.ms === pollMs);
  const poll = () => {
    const entry = [...timers].find(([, timer]) => timer.ms === pollMs);
    assert.ok(entry, "one poll is scheduled");
    timers.delete(entry[0]);
    return entry[1].fn();
  };
  const timeout = () => {
    const entry = [...timers].find(([, timer]) => timer.ms === 1500);
    assert.ok(entry, "one request timeout is scheduled");
    timers.delete(entry[0]);
    entry[1].fn();
  };
  return { remote, requests, states, reasons, character, dispatch, flush, settle, polls, poll, timeout };
}

test("persisted restore immediately rechecks a flag disabled while cached and keeps polling", async () => {
  const h = lifecycleHarness();
  const started = h.remote.start();
  await h.settle(0, reply(200, { enabled: true }));
  await started;
  h.dispatch("pagehide", true);
  assert.equal(h.polls().length, 0);
  h.dispatch("pageshow", true);
  assert.equal(h.requests.length, 2, "restore must immediately issue a fresh read");
  await h.settle(1, reply(200, { enabled: false }));
  assert.equal(h.remote.state, FLAG_DISABLED);
  assert.deepEqual(h.reasons, ["REMOTE_KILL_DISABLED"]);
  assert.equal(h.character.assetCanary.authority, "CANONICAL");
  assert.equal(h.polls().length, 1);
  const polled = h.poll();
  await h.settle(2, reply(200, { enabled: true }));
  await polled;
  assert.equal(h.character.assetCanary.authority, "CANONICAL", "reenabling never retries a canary mutation");
  h.remote.stop();
});

test("persisted hide ignores a pending read and restored generation wins a late response race", async () => {
  const h = lifecycleHarness();
  const first = h.remote.start();
  h.dispatch("pagehide", true);
  h.dispatch("pageshow", true);
  assert.equal(h.requests.length, 2, "a pre-hide pending read cannot replace the fresh restore read");
  await h.settle(1, reply(200, { enabled: false }));
  await h.settle(0, reply(200, { enabled: true }));
  await first;
  assert.deepEqual(h.states, [FLAG_DISABLED]);
  assert.equal(h.remote.state, FLAG_DISABLED);
  assert.deepEqual(h.reasons, ["REMOTE_KILL_DISABLED"]);
  assert.equal(h.polls().length, 1, "old completion must not add a polling chain");
  h.remote.stop();
});

test("old completion cannot clear the fresh restore read while it is still pending", async () => {
  const h = lifecycleHarness();
  const first = h.remote.start();
  h.dispatch("pagehide", true);
  h.dispatch("pageshow", true);
  assert.equal(h.requests.length, 2);
  await h.settle(0, reply(200, { enabled: true }));
  await first;
  assert.deepEqual(h.states, []);
  const checked = h.remote.check();
  h.dispatch("pageshow", true);
  assert.equal(h.requests.length, 2, "old completion must not clear the new single-flight read");
  await h.settle(1, reply(404));
  await checked;
  assert.deepEqual(h.states, [FLAG_DISABLED]);
  assert.equal(h.polls().length, 1);
  h.remote.stop();
});

test("pending response while cached never publishes and restore reads again", async () => {
  const h = lifecycleHarness();
  const first = h.remote.start();
  h.dispatch("pagehide", true);
  await h.settle(0, reply(200, { enabled: true }));
  await first;
  assert.deepEqual(h.states, []);
  assert.equal(h.remote.state, FLAG_UNAVAILABLE);
  assert.equal(h.polls().length, 0);
  h.dispatch("pageshow", true);
  assert.equal(h.requests.length, 2);
  await h.settle(1, reply(404));
  assert.deepEqual(h.reasons, ["REMOTE_KILL_DISABLED"]);
  h.remote.stop();
});

test("repeated pageshow, start, and overlapping poll reads keep one request and polling chain", async () => {
  const h = lifecycleHarness();
  const first = h.remote.start();
  const same = h.remote.start();
  const checked = h.remote.check();
  assert.equal(h.requests.length, 1, "concurrent reads are single-flight");
  await h.settle(0, reply(200, { enabled: true }));
  assert.deepEqual(await Promise.all([first, same, checked]), [FLAG_ENABLED, FLAG_ENABLED, FLAG_ENABLED]);
  for (let cycle = 0; cycle < 3; cycle++) {
    const queuedOldPoll = h.polls()[0].fn;
    h.dispatch("pagehide", true);
    h.dispatch("pageshow", true);
    h.dispatch("pageshow", true);
    h.dispatch("pageshow", false);
    assert.equal(h.requests.length, cycle + 2);
    await h.settle(cycle + 1, reply(200, { enabled: true }));
    await queuedOldPoll(); // Cancellation may race a callback already queued by the browser.
    h.dispatch("pageshow", true);
    assert.equal(h.requests.length, cycle + 2);
    assert.equal(h.polls().length, 1);
  }
  const polling = h.poll();
  const overlap = h.remote.check();
  assert.equal(h.requests.length, 5);
  await h.settle(4, reply(404));
  await Promise.all([polling, overlap]);
  assert.deepEqual(h.states, [FLAG_ENABLED, FLAG_ENABLED, FLAG_ENABLED, FLAG_ENABLED, FLAG_DISABLED]);
  assert.deepEqual(h.reasons, ["REMOTE_KILL_DISABLED"]);
  assert.equal(h.polls().length, 1);
  h.remote.stop();
});

test("nonpersisted hide permanently stops late publication and ignores subsequent restore", async () => {
  const h = lifecycleHarness();
  const pending = h.remote.start();
  h.dispatch("pagehide", false);
  await h.settle(0, reply(200, { enabled: true }));
  await pending;
  assert.equal(h.remote.state, FLAG_UNAVAILABLE, "stopped controller cannot accept late state");
  assert.deepEqual(h.states, []);
  assert.deepEqual(h.reasons, []);
  h.dispatch("pageshow", true);
  await h.remote.start();
  await h.remote.check();
  assert.equal(h.requests.length, 1);
  assert.equal(h.polls().length, 0);
});

test("restored network failure remains fail-closed and rolls back canonical once", async () => {
  const h = lifecycleHarness();
  const started = h.remote.start();
  await h.settle(0, reply(200, { enabled: true }));
  await started;
  h.dispatch("pagehide", true);
  h.dispatch("pageshow", true);
  assert.equal(h.requests.length, 2);
  h.requests[1].reject(new Error("offline"));
  await h.flush();
  assert.equal(h.remote.state, FLAG_UNAVAILABLE);
  assert.equal(h.remote.status().failClosed, true);
  assert.deepEqual(h.reasons, ["REMOTE_KILL_UNAVAILABLE"]);
  assert.equal(h.polls().length, 1);
  h.remote.stop();
});

test("preview BFCache lifecycle never starts production remote polling", async () => {
  const h = lifecycleHarness({ previewHost: true });
  h.dispatch("pagehide", true);
  h.dispatch("pageshow", true);
  await h.flush();
  assert.equal(h.requests.length, 0);
  assert.equal(h.polls().length, 0);
  h.remote.stop();
});

test("restored timeout fails closed and ignores the timed-out response", async () => {
  const h = lifecycleHarness();
  const started = h.remote.start();
  await h.settle(0, reply(200, { enabled: true }));
  await started;
  h.dispatch("pagehide", true);
  h.dispatch("pageshow", true);
  h.timeout();
  await h.flush();
  assert.equal(h.remote.state, FLAG_UNAVAILABLE);
  assert.equal(h.remote.status().failClosed, true);
  assert.deepEqual(h.reasons, ["REMOTE_KILL_UNAVAILABLE"]);
  assert.equal(h.character.assetCanary.authority, "CANONICAL");
  assert.equal(h.polls().length, 1);
  await h.settle(1, reply(200, { enabled: true }));
  assert.equal(h.remote.state, FLAG_UNAVAILABLE, "a late timed-out response cannot publish");
  const polling = h.poll();
  await h.settle(2, reply(200, { enabled: true }));
  await polling;
  assert.equal(h.remote.state, FLAG_ENABLED);
  assert.equal(h.character.assetCanary.authority, "CANONICAL", "a fresh true never reactivates the asset");
  assert.deepEqual(h.reasons, ["REMOTE_KILL_UNAVAILABLE"]);
  assert.equal(h.polls().length, 1);
  h.remote.stop();
});
