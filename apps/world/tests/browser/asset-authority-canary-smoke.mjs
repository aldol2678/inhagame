import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const smoke = await startSmoke({ viewport: { width: 512, height: 512 } });

async function runMode(mode) {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  await page.goto(
    `${smoke.origin}/tests/browser/asset-authority-canary-harness.html?mode=${encodeURIComponent(mode)}`,
    { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS }
  );
  await Promise.race([
    page.waitForFunction(() => window.__ASSET_CANARY_HARNESS__?.ready !== undefined,
      null, { timeout: TIMEOUT_MS }),
    fatal
  ]);
  const state = await page.evaluate(() => window.__ASSET_CANARY_HARNESS__);
  await page.close();
  assert.equal(state.ready, true, state.error);
  assert.equal(state.renderer, "WebGL2");
  assert.equal(state.shadowStatus.authority, "CANONICAL_SOURCE_ONLY");
  assert.equal(state.shadowStatus.counts.mismatch, 0);
  assert.equal(state.shadowStatus.counts.unavailable, 0);
  assert.equal(state.canaryStatus.productionWired, false);
  return state;
}

try {
  const control = await runMode("control");
  assert.equal(control.beforeRollback.authority, "CANONICAL");
  assert.equal(control.beforeRollback.outcome, "CONTROL");
  assert.equal(control.beforeRollback.canonicalAttached, true);
  assert.equal(control.beforeRollback.optimizedAttached, false);

  const canary = await runMode("canary");
  assert.equal(canary.beforeRollback.authority, "OPTIMIZED_CANARY");
  assert.equal(canary.beforeRollback.outcome, "CANARY_ACTIVE");
  assert.equal(canary.beforeRollback.canonicalAttached, false);
  assert.equal(canary.beforeRollback.optimizedAttached, true);
  assert.equal(canary.canaryStatus.counts.optimizedCanary, 1);

  const rollback = await runMode("rollback");
  assert.equal(rollback.beforeRollback.authority, "OPTIMIZED_CANARY");
  assert.equal(rollback.beforeRollback.optimizedAttached, true);
  assert.equal(rollback.after.authority, "CANONICAL");
  assert.equal(rollback.after.outcome, "ROLLED_BACK_MANUAL");
  assert.equal(rollback.after.canonicalAttached, true);
  assert.equal(rollback.after.optimizedAttached, false);
  assert.equal(rollback.rollbackReceipt.reason, "HARNESS_MANUAL_ROLLBACK");
  assert.equal(rollback.canaryStatus.counts.rolledBack, 1);

  const failed = await runMode("load-failure");
  assert.equal(failed.beforeRollback.authority, "CANONICAL");
  assert.equal(failed.beforeRollback.outcome, "ROLLED_BACK_LOAD_FAILURE");
  assert.equal(failed.beforeRollback.canonicalAttached, true);
  assert.equal(failed.beforeRollback.optimizedAttached, false);
  assert.match(failed.canaryStatus.entries[0].reason, /HARNESS_OPTIMIZED_LOAD_FAILURE/);

  assert.deepEqual(smoke.problems, []);
  console.log("asset authority canary: PASS", JSON.stringify({
    control: control.beforeRollback,
    canary: canary.beforeRollback,
    rollback: rollback.after,
    loadFailure: failed.beforeRollback
  }));
} finally {
  await smoke.close();
}
