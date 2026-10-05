import { expect, test } from '@playwright/test';

test('mobile layout links change only the special duck slots and preserve the five basic comparator', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/?p3=1&growth=0&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).duckKinds)
    .toEqual(['elastic', 'basic', 'basic', 'basic', 'bomb']);
  await page.locator('[data-layout="B"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.flockLayout === 'B');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).duckKinds)
    .toEqual(['basic', 'elastic', 'basic', 'bomb', 'basic']);
  await page.locator('[data-layout="off"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.flockLayout === 'off');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).duckKinds)
    .toEqual(Array(5).fill('basic'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const viewport of [{ width: 375, height: 667 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const bottom = await page.locator('.duck-key').evaluate(el => el.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(viewport.height);
  }
});

test('bomb duck charges one ball then destroys at most one extra adjacent brick', async ({ page }) => {
  await page.goto('/?p3=1&growth=0&test=1&flock=A');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const duck = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[4]);
  await page.evaluate(({ x, y }) =>
    (window as any).__QUACKTRIS_TEST_API__.setBall(x - 9, y - 40, 0, 8), duck);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.bombArmed === true);
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.setBall(180, 385, 0, -8));
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.ballPosition.y < 380);
  const firePixels = await page.evaluate(() => {
    const { x, y } = (window as any).__QUACKTRIS__.ballPosition;
    const canvas = document.querySelector('canvas')!;
    const scale = canvas.width / 360;
    const data = canvas.getContext('2d')!.getImageData(
      Math.floor((x - 17) * scale), Math.floor((y - 17) * scale), 34 * scale, 34 * scale).data;
    let pixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 210 && data[i + 1] > 60 && data[i + 1] < 205 && data[i + 2] < 120) pixels++;
    }
    return pixels;
  });
  expect(firePixels).toBeGreaterThan(10);
  const before = await page.evaluate(() => (window as any).__QUACKTRIS__);
  const bottom = before.brickPositions.filter((brick: any) => brick.y > 180)[0];
  expect(bottom).toBeTruthy();
  await page.evaluate(({ x, y }) =>
    (window as any).__QUACKTRIS_TEST_API__.setBall(x, y + 24, 0, -8), bottom);
  await page.waitForFunction((n) => (window as any).__QUACKTRIS__?.telemetry.brickHits > n,
    before.telemetry.brickHits);
  const after = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(after.bombArmed).toBe(false);
  expect(after.blastActive).toBe(true);
  // The ball can touch multiple neighboring bricks on the same physics tick.
  // The bomb itself must still remove exactly one additional brick.
  expect(after.telemetry.brickHits - before.telemetry.brickHits).toBeGreaterThanOrEqual(1);
  expect(after.telemetry.bombBonusBricks - before.telemetry.bombBonusBricks).toBe(1);
  expect(after.telemetry.bricksDestroyed - before.telemetry.bricksDestroyed)
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.forceLose());
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.restart());
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const restarted = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(restarted.bombArmed).toBe(false);
  expect(restarted.telemetry.bricksDestroyed).toBe(0);
});

test('elastic rebound leaves a visible cyan ball echo that expires without spawning a second ball', async ({ page }) => {
  await page.goto('/?p3=1&growth=0&test=1&flock=A');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const duck = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[0]);
  await page.evaluate(({ x, y }) =>
    (window as any).__QUACKTRIS_TEST_API__.setBall(x - 10, y - 40, 0, 8), duck);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.ballEffect === 'elastic');
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.setBall(180, 385, 2, -8));
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.ballPosition.y < 380);
  const echoPixels = await page.evaluate(() => {
    const { x, y } = (window as any).__QUACKTRIS__.ballPosition;
    const canvas = document.querySelector('canvas')!;
    const scale = canvas.width / 360;
    const data = canvas.getContext('2d')!.getImageData(
      Math.floor((x - 18) * scale), Math.floor((y - 18) * scale), 36 * scale, 36 * scale).data;
    let pixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 140 && data[i + 1] > 105 && data[i + 2] > 140) pixels++;
    }
    return pixels;
  });
  expect(echoPixels).toBeGreaterThan(10);
  const debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.worldBodies).toBe(10 + debug.bricksRemaining);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.ballEffect === 'none');
});
