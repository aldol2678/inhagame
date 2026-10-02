import { expect, test } from '@playwright/test';

test('mobile controls keep A/B, strength, brick pattern and clone independently selectable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?p3=1&test=1&growth=0&flock=A&clone=1&elastic=strong&bricks=clusters');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  let debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.duckKinds).toEqual(['elastic', 'clone', 'basic', 'basic', 'bomb']);
  expect(debug.brickPattern).toBe('clusters');
  expect(debug.elasticMode).toBe('strong');
  expect(await page.locator('.duck-key').evaluate(el => el.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(568);
  await page.locator('[data-layout="B"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.flockLayout === 'B');
  debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.duckKinds).toEqual(['basic', 'elastic', 'basic', 'bomb', 'clone']);
  expect(debug.cloneEnabled).toBe(true);
  expect(debug.brickPattern).toBe('clusters');
  await page.locator('[data-experiment="clone:0"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.cloneEnabled === false);
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).duckKinds)
    .toEqual(['basic', 'elastic', 'basic', 'bomb', 'basic']);
});

test('clone duck creates two real balls, either can break bricks, surviving ball continues and restart cleans up', async ({ page }) => {
  await page.goto('/?p3=1&test=1&growth=0&flock=A&clone=1&elastic=strong&bricks=clusters');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const duck = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[1]);
  await page.evaluate(({ x, y }) =>
    (window as any).__QUACKTRIS_TEST_API__.setBall(x - 8, y - 40, 0, 8), duck);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.activeBalls === 2);
  let debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.worldBodies).toBe(11 + debug.bricksRemaining);
  expect(debug.telemetry.hitsByDuckKind.clone).toBeGreaterThanOrEqual(1);
  expect(debug.telemetry.cloneTriggers).toBe(1);
  expect(debug.ballPositions[0].x).not.toBe(debug.ballPositions[1].x);
  expect(debug.ballVelocities.every((v: any) => Number.isFinite(v.x + v.y) && v.y < 0)).toBe(true);

  const before = debug.bricksRemaining;
  const brick = debug.brickPositions.find((item: any) => item.y > 180);
  await page.evaluate(({ x, y }) => {
    (window as any).__QUACKTRIS_TEST_API__.setBall(300, 400, 0, -8, 0);
    (window as any).__QUACKTRIS_TEST_API__.setBall(x, y + 24, 0, -8, 1);
  }, brick);
  await page.waitForFunction((n) => (window as any).__QUACKTRIS__?.bricksRemaining < n, before);
  debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.telemetry.brickHits).toBeGreaterThanOrEqual(1);

  await page.evaluate(() => {
    (window as any).__QUACKTRIS_TEST_API__.setBall(300, 380, 0, -8, 1);
    (window as any).__QUACKTRIS_TEST_API__.setBall(180, 600, 0, 9, 0);
  });
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.activeBalls === 1);
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).phase).toBe('RUNNING');
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.forceLose());
  await page.keyboard.press('r');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.activeBalls).toBe(1);
  expect(debug.worldBodies).toBe(10 + debug.bricksRemaining);
  expect(debug.telemetry.cloneTriggers).toBe(0);
});
