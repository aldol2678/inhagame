// Explicit no-graphics smoke: both WebGPU and WebGL2 are disabled, so Campus must show the unsupported path.
import assert from 'node:assert/strict';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const smoke = await startSmoke();
try {
  const page = await smoke.context.newPage();
  smoke.watch(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type === "webgl2" || type === "webgl" || type === "experimental-webgl") return null;
      return originalGetContext.call(this, type, ...args);
    };
  });
  await page.goto(`${smoke.origin}/campus/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().renderer === 'UNAVAILABLE', null, { timeout: TIMEOUT_MS });
  assert.equal(await page.locator('#world-loading').getAttribute('data-state'), 'ERROR');
  assert.match(await page.locator('#world-loading-message').textContent(), /3D 렌더링을 사용할 수 없습니다/);
  assert.match(await page.locator('#world-loading-detail').textContent(), /브라우저와 그래픽 드라이버/);
  assert.deepEqual(smoke.problems, []);
  console.log('world unsupported graphics smoke: PASS');
} finally { await smoke.close(); }
