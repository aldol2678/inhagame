// Mobile boot regression smoke: reproduce the production Android lobby entry path.
// Runs the real /campus/?lobby=1 boot under a touch/mobile Chromium context and fails with
// the exact boot() error captured by the public debug status.
import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const smoke = await startSmoke({
  viewport: { width: 360, height: 800 },
  contextOptions: {
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A346N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
  }
});

let status = null;
try {
  const page = await smoke.context.newPage();
  const fatalError = smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?lobby=1`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS
  });

  await Promise.race([
    page.waitForFunction(() => {
      const current = window.__INHAGAME_P0__?.getStatus?.();
      return current?.renderer === "UNAVAILABLE" || current?.loading?.finished === true;
    }, null, { timeout: TIMEOUT_MS, polling: 100 }),
    fatalError
  ]);

  status = await page.evaluate(() => window.__INHAGAME_P0__?.getStatus?.());
  assert.ok(status, "mobile lobby publishes runtime status");
  assert.notEqual(status.renderer, "UNAVAILABLE",
    `mobile lobby boot failed: ${status.error ?? "unknown error"}`);
  assert.equal(status.loading?.phase, "READY",
    `mobile lobby did not reach READY: ${JSON.stringify(status.loading)}`);
  assert.equal(status.loading?.finished, true, "mobile lobby loading screen finished");
  assert.equal(status.lobby?.active, true, "explicit ?lobby=1 entry keeps lobby mode active");
  assert.deepEqual(smoke.problems, [], "mobile lobby has no page/console/request failures");

  console.log(`mobile lobby boot smoke: PASS (${status.renderer})`);
} catch (error) {
  console.error("mobile lobby boot smoke: FAIL");
  if (smoke.problems.length) console.error(smoke.problems.map(line => `  - ${line}`).join("\n"));
  if (status) console.error(`  last status: ${JSON.stringify({
    renderer: status.renderer,
    loading: status.loading,
    error: status.error
  })}`);
  throw error;
} finally {
  await smoke.close();
}
