import { expect, test } from '@playwright/test';

test('living paddle boot exposes five ducks and running phase', async ({ page }) => {
  await page.goto('/?p3=1&growth=0&mode=living&test=1');
  await expect(page.locator('[data-game-surface]')).toBeVisible();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.mode).toBe('living');
  expect(debug.ducks).toBe(5);
  expect(debug.bricksRemaining).toBeGreaterThan(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('five pixel ducks paint separately at their physics positions', async ({ page }) => {
  await page.goto('/?p3=1&growth=0&mode=living&test=1&flock=off');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const bodyColors = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const context = canvas.getContext('2d')!;
    const scale = canvas.width / 360;
    return (window as any).__QUACKTRIS__.duckPositions.map(({ x, y }: { x: number; y: number }) =>
      Array.from(context.getImageData(Math.round((x - 8) * scale), Math.round((y + 2) * scale), 1, 1).data).slice(0, 3));
  });
  expect(bodyColors).toHaveLength(5);
  for (const [red, green, blue] of bodyColors) {
    expect(red).toBeGreaterThan(220);
    expect(green).toBeGreaterThan(140);
    expect(blue).toBeLessThan(160);
  }
});

test('short portrait screens keep the complete game card and controls visible', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/?p3=1&growth=0&mode=living');
    const card = await page.locator('[data-game-surface]').boundingBox();
    const footer = await page.locator('.pilot-footer').boundingBox();
    const hudSub = await page.locator('.hud-sub').boundingBox();
    expect(card).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(hudSub).not.toBeNull();
    expect(card!.y + card!.height).toBeLessThanOrEqual(viewport.height);
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height);
    expect(hudSub!.y + hudSub!.height).toBeLessThan(card!.y + card!.height * 71 / 640);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('rigid mode boots as test baseline', async ({ page }) => {
  await page.goto('/?p3=1&growth=0&mode=rigid&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.mode).toBe('rigid');
  expect(debug.ducks).toBe(0);
});


test('lost run can restart without losing living paddle bodies', async ({ page }) => {
  await page.goto('/?p3=1&growth=0&mode=living&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');

  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.forceLose());
    await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'LOST');
    await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.restart());
    await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
    const debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
    expect(debug.ducks).toBe(5);
    expect(debug.telemetry.restartCount).toBe(i + 1);
    expect(debug.worldBodies).toBe(5 + 1 + debug.bricksRemaining + 4);
    expect(debug.worldConstraints).toBe(4);
  }
});

test('result panel is centered in the game and R restarts after a loss', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/?p3=1&growth=0&mode=living&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await page.keyboard.press('r');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).telemetry.restartCount).toBe(0);
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.forceLose());
  const panel = page.locator('[data-ui="result"]');
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  const cardBox = await page.locator('[data-game-surface]').boundingBox();
  expect(panelBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(Math.abs(panelBox!.x + panelBox!.width / 2 - (cardBox!.x + cardBox!.width / 2))).toBeLessThan(2);
  expect(Math.abs(panelBox!.y + panelBox!.height / 2 - (cardBox!.y + cardBox!.height / 2))).toBeLessThan(2);
  await page.keyboard.press('r');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).telemetry.restartCount).toBe(1);
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.forceLose());
  await expect(panel).toBeVisible();
  await panel.locator('button').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).telemetry.restartCount).toBe(2);
});

test('P and the mobile pause button freeze physics and elapsed time until resumed', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/?p3=1&growth=0&mode=living&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await page.keyboard.press('p');
  await expect(page.locator('[data-ui="pause-panel"]')).toBeVisible();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'PAUSED');
  const paused = await page.evaluate(() => (window as any).__QUACKTRIS__);
  await page.waitForTimeout(350);
  const held = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(held.ballPosition).toEqual(paused.ballPosition);
  expect(held.duckPositions).toEqual(paused.duckPositions);
  expect(held.telemetry.elapsedMs).toBe(paused.telemetry.elapsedMs);
  await page.keyboard.press('r');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).phase).toBe('PAUSED');
  await page.locator('[data-ui="resume"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await expect(page.locator('[data-ui="pause"]')).toBeVisible();
  await page.locator('[data-ui="pause"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'PAUSED');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const moving = await page.evaluate(() => (window as any).__QUACKTRIS__.ballPosition);
  await page.waitForTimeout(80);
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__.ballPosition))).not.toEqual(moving);
});

test('mobile wall hold keeps five compound ducks distinct', async ({ page }) => {
  await page.goto('/?p3=1&growth=0&mode=living&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * .85);
  await page.mouse.down();
  await page.mouse.move(box!.x + 2, box!.y + box!.height * .85, { steps: 8 });
  await page.waitForTimeout(3100);
  const debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.duckPositions).toHaveLength(5);
  expect(debug.duckPositions.every((body: any) => body.parts === 3
    && Number.isFinite(body.x) && Number.isFinite(body.angle))).toBeTruthy();
  const xs = debug.duckPositions.map((body: any) => body.x).sort((a: number, b: number) => a - b);
  expect(xs[4] - xs[0]).toBeGreaterThan(140);
  await page.mouse.up();
});

test('both wall holds keep five distinctly colored pixel heads and recover on release', async ({ page }) => {
  await page.goto('/?p3=1&growth=0&mode=living&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const box = await page.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height * .85;

  for (const side of [0, 1]) {
    await page.mouse.move(box!.x + box!.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box!.x + (side ? box!.width - 2 : 2), y, { steps: 8 });
    await page.waitForTimeout(3100);
    const result = await page.evaluate(() => {
      const positions = (window as any).__QUACKTRIS__.duckPositions as { x: number; y: number; parts: number }[];
      const canvas = document.querySelector('canvas')!;
      const ctx = canvas.getContext('2d')!;
      const scale = canvas.width / 360;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const kinds = (window as any).__QUACKTRIS__.duckKinds as string[];
      const visibleHeads = positions.map(({ x, y }, index) => {
        let colored = 0;
        // Each head must retain a distinct patch of its own palette at the wall.
        for (let dx = 1; dx <= 21; dx += 1) for (let dy = -28; dy <= -12; dy += 1) {
          const px = Math.round((x + dx) * scale), py = Math.round((y + dy) * scale);
          if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) continue;
          const at = (py * canvas.width + px) * 4;
          const [r, g, b] = [pixels[at], pixels[at + 1], pixels[at + 2]];
          if (kinds[index] === 'elastic' ? g > 150 && b > 150 && r < 210
            : kinds[index] === 'bomb' ? r > 200 && g > 110 && g < 230 && b < 170 && r > g + 20
              : r > 225 && g > 150 && b < 155) colored += 1;
        }
        return colored;
      });
      return { visibleHeads, positions };
    });
    expect(result.positions).toHaveLength(5);
    expect(result.positions.every(duck => duck.parts === 3)).toBe(true);
    expect(result.visibleHeads.every(count => count >= 5)).toBe(true);
    await page.mouse.up();
    await page.mouse.move(box!.x + box!.width / 2, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(950);
    const recovered = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions);
    expect(recovered[4].x - recovered[0].x).toBeGreaterThan(145);
  }
});

test('desktop A/D and arrow keys move the center duck', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?p3=1&growth=0&mode=living&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const center = async () => page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[2].x);
  const initial = await center();
  await page.keyboard.down('d');
  await page.waitForTimeout(550);
  await page.keyboard.up('d');
  const right = await center();
  expect(right).toBeGreaterThan(initial + 8);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(650);
  await page.keyboard.up('ArrowLeft');
  expect(await center()).toBeLessThan(right - 8);
});

test('INHAGAME account panel is optional and does not block play', async ({ page }) => {
  await page.goto('/?p3=1&mode=living&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await expect(page.locator('[data-account-open]')).toBeVisible();
  await page.locator('[data-account-open]').click();
  await expect(page.locator('[data-account-overlay]')).toBeVisible();
  await expect(page.locator('[data-account-tab="signup"]')).toBeVisible();
  await expect(page.locator('[data-account-signup-email]')).toBeVisible();
  await expect(page.locator('[data-account-signup]')).toBeVisible();
  await page.locator('[data-account-tab="login"]').click();
  await expect(page.locator('[data-account-login-email]')).toBeVisible();
  await expect(page.locator('[data-account-login-password]')).toBeVisible();
  await expect(page.locator('[data-account-password-login]')).toBeVisible();
  await page.locator('[data-account-close]').click();
  await expect(page.locator('[data-account-overlay]')).toBeHidden();
  await expect(page.locator('[data-game-surface]')).toBeVisible();
});
