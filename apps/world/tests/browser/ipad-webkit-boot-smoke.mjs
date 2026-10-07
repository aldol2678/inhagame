// iPad-class WebKit boot regression gate: the reported failure stalls at the loader's 6% BOOT
// phase, before boot() can advance to RENDERER. This smoke therefore focuses on module loading
// and boot entry, not desktop-only Pointer Lock behavior.
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

try {
  const page = await smoke.context.newPage();
  const fatalError = smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?lobby=1`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });

  await Promise.race([
    page.waitForFunction(() => {
      const loading = globalThis.__INHA_WORLD_LOADING__?.status?.();
      return loading?.phase !== "BOOT" || document.querySelector("#world-loading")?.dataset.state === "ERROR";
    }, null, { timeout: 15_000, polling: 100 }),
    fatalError
  ]);

  const state = await page.evaluate(() => ({
    loading: globalThis.__INHA_WORLD_LOADING__?.status?.() ?? null,
    loaderState: document.querySelector("#world-loading")?.dataset.state ?? null
  }));
  assert.ok(state.loading, "iPad WebKit publishes loader state");
  assert.notEqual(state.loading.phase, "BOOT",
    `iPad WebKit remained at 6% BOOT: ${JSON.stringify(state)}`);
  assert.notEqual(state.loaderState, "ERROR",
    `iPad WebKit reported an initialization error: ${JSON.stringify(state)}`);
  assert.deepEqual(smoke.problems, [], "iPad WebKit has no module/page/request failures");
  console.log(`iPad WebKit boot-entry smoke: PASS (phase=${state.loading.phase})`);
} finally {
  await smoke.close();
}
