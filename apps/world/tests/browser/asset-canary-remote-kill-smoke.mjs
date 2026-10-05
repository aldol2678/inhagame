import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const smoke = await startSmoke({ viewport: { width: 512, height: 512 } });
try {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  await page.goto(
    smoke.origin + "/tests/browser/asset-canary-remote-kill-harness.html",
    { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS }
  );
  await Promise.race([
    page.waitForFunction(() => window.__ASSET_REMOTE_KILL_HARNESS__?.ready !== undefined,
      null, { timeout: TIMEOUT_MS }),
    fatal
  ]);
  const state = await page.evaluate(() => window.__ASSET_REMOTE_KILL_HARNESS__);
  assert.equal(state.ready, true, state.error);

  assert.equal(state.before.remote.state, "ENABLED");
  assert.equal(state.before.character.authority, "OPTIMIZED_CANARY");
  assert.equal(state.before.character.outcome, "CANARY_ACTIVE");
  assert.equal(state.before.visualAttached, true);

  assert.equal(state.after.remote.state, "DISABLED");
  assert.equal(state.after.remote.failClosed, true);
  assert.equal(state.after.character.authority, "CANONICAL");
  assert.equal(state.after.character.outcome, "ROLLED_BACK_MANUAL");
  assert.equal(state.after.character.reason, "REMOTE_KILL_DISABLED");
  assert.equal(state.after.visualAttached, true);

  assert.deepEqual(state.telemetryEvents.map(item => item.eventType), [
    "asset_canary_selected",
    "asset_canary_active",
    "asset_canary_rollback"
  ]);
  assert.ok(state.telemetryEvents.every(item =>
    item.surface === "campus" && item.target === "induck_v3"));

  assert.deepEqual(smoke.problems, []);
  console.log("asset canary remote kill: PASS", JSON.stringify({
    before: state.before, after: state.after, events: state.telemetryEvents
  }));
} finally {
  await smoke.close();
}
