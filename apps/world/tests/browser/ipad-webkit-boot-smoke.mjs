// iPad-class WebKit boot regression gate for the physical-Safari 6% BOOT failure.
// This must reach the actual Main Lobby, not merely leave the initial BOOT phase.
import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const smoke = await startSmoke({
  browserType: "webkit",
  viewport: { width: 1024, height: 1366 },
  contextOptions: {
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  }
});

let state = null;
try {
  const page = await smoke.context.newPage();
  const fatalError = smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?lobby=1`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });

  await Promise.race([
    page.waitForFunction(() => {
      const status = window.__INHAGAME_P0__?.getStatus?.();
      return status?.renderer === "UNAVAILABLE" ||
        (status?.loading?.finished === true && status?.lobby?.active === true) ||
        document.querySelector("#world-loading")?.dataset.state === "ERROR";
    }, null, { timeout: TIMEOUT_MS, polling: 100 }),
    fatalError
  ]);

  state = await page.evaluate(() => ({
    runtime: window.__INHAGAME_P0__?.getStatus?.() ?? null,
    loading: globalThis.__INHA_WORLD_LOADING__?.status?.() ?? null,
    loaderState: document.querySelector("#world-loading")?.dataset.state ?? null
  }));

  assert.ok(state.runtime, "iPad WebKit publishes runtime status");
  assert.notEqual(state.runtime.renderer, "UNAVAILABLE",
    `iPad WebKit renderer unavailable: ${state.runtime.error ?? "unknown error"}`);
  assert.equal(state.runtime.loading?.phase, "READY",
    `iPad WebKit did not reach READY: ${JSON.stringify(state)}`);
  assert.equal(state.runtime.loading?.finished, true, "iPad WebKit loading screen finished");
  assert.equal(state.runtime.lobby?.active, true, "iPad WebKit entered the requested Main Lobby");
  assert.notEqual(state.loaderState, "ERROR",
    `iPad WebKit reported an initialization error: ${JSON.stringify(state)}`);
  assert.deepEqual(smoke.problems, [], "iPad WebKit has no module/page/request failures");
  console.log(`iPad WebKit lobby boot smoke: PASS (${state.runtime.renderer})`);
} catch (error) {
  console.error("iPad WebKit lobby boot smoke: FAIL");
  if (smoke.problems.length) console.error(smoke.problems.map(line => `  - ${line}`).join("\n"));
  if (state) console.error(`  last state: ${JSON.stringify(state)}`);
  throw error;
} finally {
  await smoke.close();
}
