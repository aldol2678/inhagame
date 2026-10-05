import test from "node:test";
import assert from "node:assert/strict";
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
