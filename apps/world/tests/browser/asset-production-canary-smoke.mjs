import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const smoke = await startSmoke({ viewport: { width: 512, height: 512 } });

async function run(mode) {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  await page.goto(
    `${smoke.origin}/tests/browser/asset-production-canary-harness.html?mode=${mode}`,
    { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS }
  );
  await Promise.race([
    page.waitForFunction(() => window.__ASSET_PRODUCTION_CANARY_HARNESS__?.ready !== undefined,
      null, { timeout: TIMEOUT_MS }),
    fatal
  ]);
  const state = await page.evaluate(() => window.__ASSET_PRODUCTION_CANARY_HARNESS__);
  await page.close();
  assert.equal(state.ready, true, state.error);
  assert.equal(state.renderer, "WebGL2");
  assert.equal(state.before.modelState, "glb");
  assert.equal(state.before.visualAttached, true);
  assert.equal(state.before.production.percentage, 100);
  assert.equal(state.before.production.authority.productionWired, true);
  return state;
}

try {
  const control = await run("control");
  assert.equal(control.before.selected, false);
  assert.equal(control.before.character, null, "remote-disabled control never enters optimized preparation");

  const selected = await run("selected");
  assert.equal(selected.before.selected, true);
  assert.equal(selected.before.character.authority, "OPTIMIZED_CANARY");
  assert.equal(selected.before.character.outcome, "CANARY_ACTIVE");
  assert.equal(selected.before.character.consumer, "character-production");

  const rollback = await run("rollback");
  assert.equal(rollback.before.character.authority, "OPTIMIZED_CANARY");
  assert.equal(rollback.rollback.authority, "CANONICAL");
  assert.equal(rollback.rollback.outcome, "ROLLED_BACK_MANUAL");
  assert.equal(rollback.rollback.reason, "HARNESS_PRODUCTION_ROLLBACK");
  assert.equal(rollback.after.character.authority, "CANONICAL");
  assert.equal(rollback.after.modelState, "glb");
  assert.equal(rollback.after.visualAttached, true);
  assert.equal(rollback.after.production.authority.counts.rolledBack, 1);

  assert.deepEqual(smoke.problems, []);
  console.log("production optimized asset rollout 100%: PASS", JSON.stringify({
    control: control.before.character,
    selected: selected.before.character,
    rollback: rollback.after.character
  }));
} finally {
  await smoke.close();
}
