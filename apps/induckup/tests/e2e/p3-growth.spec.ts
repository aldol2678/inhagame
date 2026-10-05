import { expect, test, type Page } from '@playwright/test';

async function reachSecondEvolution(page: Page, kind: 'elastic' | 'bomb' | 'clone', firstSlot = 1) {
  await page.goto('/?p3=1&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await page.evaluate(() => {
    (window as any).__QUACKTRIS_TEST_API__.grantXp(8);
    (window as any).__QUACKTRIS_TEST_API__.clearWave();
  });
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'CHOOSING');
  await page.evaluate(({ kind, firstSlot }) =>
    (window as any).__QUACKTRIS_TEST_API__.choose(kind, firstSlot), { kind, firstSlot });
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.wave === 2);
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.grantXp(12));
  const center = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[2]);
  await page.evaluate(({ x, y }) =>
    (window as any).__QUACKTRIS_TEST_API__.setBall(x, y - 40, 0, 8), center);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'CHOOSING');
}

test('Induck Up root boots growth by default and the P2 comparator stays available', async ({ page }) => {
  await page.goto('/?p3=1');
  await expect(page.locator('[data-ui="growth-level"]')).toHaveText('LV.1 · XP 0/8');
  await expect(page.locator('[data-ui="growth-meter"]')).toBeVisible();
  await page.goto('/?p3=1&growth=0&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).growthEnabled).toBe(false);
  await expect(page.locator('[data-ui="growth-level"]')).toBeHidden();
});

test('real brick impacts drop visible feathers that only the ducks can collect', async ({ page }) => {
  await page.goto('/?p3=1&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const before = await page.evaluate(() => (window as any).__QUACKTRIS__);
  await page.setViewportSize({ width: 320, height: 568 });
  expect(before.growthEnabled).toBe(true);
  const levelRect = await page.locator('[data-ui="growth-level"]').boundingBox();
  const pauseRect = await page.locator('[data-ui="pause"]').boundingBox();
  expect(levelRect!.x + levelRect!.width).toBeLessThanOrEqual(pauseRect!.x);
  const brick = before.brickPositions.find((point: any) => point.y > 180 && Math.abs(point.x - 180) < 60);
  await page.evaluate(({x,y}) => (window as any).__QUACKTRIS_TEST_API__.setBall(x,y+24,0,-8),brick);
  await page.waitForFunction((remaining) =>
    (window as any).__QUACKTRIS__?.bricksRemaining < remaining, before.bricksRemaining);
  const spawned = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(spawned.featherPositions.length).toBeGreaterThanOrEqual(1);
  expect(spawned.xp).toBeGreaterThanOrEqual(1);
  expect(spawned.level).toBe(1);
  await expect(page.locator('[data-ui="growth-level"]')).toContainText(`LV.1 · XP ${spawned.xp}/8`);
  await expect(page.locator('[data-ui="stats"]')).toContainText(/깃털 낙하 [1-9]/);
  await page.waitForFunction((xp) => (window as any).__QUACKTRIS__?.xp > xp,
    spawned.xp, { timeout: 6000 });
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).evolutionPending).toBe(false);
});

test('Hangul ㄱ restarts and ㅔ pauses and resumes, including physical key codes', async ({ page }) => {
  await page.goto('/?p3=1&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅔ', code: 'Unidentified' })));
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'PAUSED');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'KeyP' })));
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.forceLose());
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'LOST');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㄱ', code: 'Unidentified' })));
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).duckKinds).toEqual(Array(5).fill('basic'));
});

test('mobile grows five basic ducks into one chosen role, then preserves it in wave two', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?p3=1&growth=1&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  let debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.duckKinds).toEqual(Array(5).fill('basic'));
  expect(debug.activeBalls).toBe(1);
  expect(debug.xp).toBe(0);
  expect(await page.locator('.duck-key').evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(568);

  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.grantXp(8));
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.xp === 8);
  await expect(page.locator('[data-ui="growth-level"]')).toContainText('LV.2 · XP 8/8');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).phase).toBe('RUNNING');
  const duck = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[2]);
  await page.evaluate(({ x, y }) => (window as any).__QUACKTRIS_TEST_API__.setBall(x - 7, y - 40, 0, 8), duck);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'CHOOSING');
  const frozen = await page.evaluate(() => (window as any).__QUACKTRIS__);
  await page.waitForTimeout(150);
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).ballPositions).toEqual(frozen.ballPositions);
  await page.locator('[data-kind="bomb"]').click();
  await page.locator('[data-slot="4"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.duckKinds).toEqual(['basic', 'basic', 'basic', 'basic', 'bomb']);
  expect(debug.worldBodies).toBe(10 + debug.bricksRemaining);

  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.clearWave());
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.wave === 2);
  debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.bricksRemaining).toBe(35);
  expect(debug.brickPattern).toBe('clusters');
  expect(debug.reinforcedBricks.length).toBeGreaterThanOrEqual(6);
  expect(debug.xpTarget).toBe(12);
  expect(debug.xp).toBe(0);
  expect(debug.duckKinds[4]).toBe('bomb');
  expect(debug.activeBalls).toBe(1);
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.clearWave());
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'CLEAR');
  const finalElapsed = (await page.evaluate(() => (window as any).__QUACKTRIS__)).telemetry.elapsedMs;
  await page.waitForTimeout(120);
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).telemetry.elapsedMs).toBe(finalElapsed);
  await page.keyboard.press('r');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.wave).toBe(1);
  expect(debug.xp).toBe(0);
  expect(debug.level).toBe(1);
  expect(debug.duckKinds).toEqual(Array(5).fill('basic'));
  expect(debug.worldBodies).toBe(10 + debug.bricksRemaining);
});

test('wave two armor takes two hits and LV.3 evolves a different duck with desktop keys', async ({ page }) => {
  await page.goto('/?p3=1&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await page.evaluate(() => {
    (window as any).__QUACKTRIS_TEST_API__.grantXp(8);
    (window as any).__QUACKTRIS_TEST_API__.clearWave();
  });
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'CHOOSING');
  await page.locator('[data-kind="elastic"]').click();
  await page.locator('[data-slot="0"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.wave === 2);
  const first = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(first.brickPattern).toBe('clusters');
  expect(first.reinforcedBricks.length).toBeGreaterThanOrEqual(6);
  expect(first.xpTarget).toBe(12);
  expect(first.duckKinds).toEqual(['elastic', 'basic', 'basic', 'basic', 'basic']);
  // The cluster layout leaves a hole directly below this armored cell.
  const armor = first.reinforcedBricks.find((brick: any) => brick.y === 109 && brick.x > 140 && brick.x < 180)!;
  await page.evaluate(({x,y}) => (window as any).__QUACKTRIS_TEST_API__.setBall(x,y+27,0,-8), armor);
  await page.waitForFunction(({x,y}) => (window as any).__QUACKTRIS__?.reinforcedBricks
    .some((brick: any) => brick.x === x && brick.y === y && brick.hp === 1), armor);
  const chipped = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(chipped.brickPositions).toContainEqual({ x: armor.x, y: armor.y });
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.setBall(180,370,0,0));
  await page.waitForTimeout(160);
  await page.evaluate(({x,y}) => (window as any).__QUACKTRIS_TEST_API__.setBall(x,y+27,0,-8), armor);
  await page.waitForFunction(({ x, y }) => !(window as any).__QUACKTRIS__?.brickPositions
    .some((brick: any) => brick.x === x && brick.y === y), armor);
  const broken = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(broken.bricksRemaining).toBeLessThan(chipped.bricksRemaining);
  expect(broken.xp).toBeGreaterThanOrEqual(chipped.xp + 1);
  expect(broken.xpPopups).toContain('+1 XP');
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.grantXp(11));
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.level === 3);
  const duck = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[2]);
  await page.evaluate(({x,y}) => (window as any).__QUACKTRIS_TEST_API__.setBall(x,y-40,0,8),duck);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'CHOOSING');
  await expect(page.locator('[data-ui="evolution"] strong')).toHaveText('두 번째 진화!');
  await expect(page.locator('[data-slot="0"]')).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('1');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).phase).toBe('CHOOSING');
  await page.keyboard.press('3');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const evolved = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(evolved.duckKinds).toEqual(['elastic', 'basic', 'elastic', 'basic', 'basic']);
  expect(evolved.evolutions).toBe(2);
  expect(evolved.worldBodies).toBe(10 + evolved.bricksRemaining);
});

test('desktop arrows select an evolution and digits choose one of five ducks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?p3=1&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.grantXp(8));
  const center = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[2]);
  await page.evaluate(({ x, y }) => (window as any).__QUACKTRIS_TEST_API__.setBall(x, y - 40, 0, 8), center);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'CHOOSING');

  await page.keyboard.press('3');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).phase).toBe('CHOOSING');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-kind="elastic"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-kind="bomb"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-kind="clone"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-kind="bomb"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('3');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).duckKinds)
    .toEqual(['basic', 'basic', 'bomb', 'basic', 'basic']);
  await page.keyboard.press('1');
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).duckKinds)
    .toEqual(['basic', 'basic', 'bomb', 'basic', 'basic']);
});

test('clone evolution still creates two actual balls without extra duck bodies', async ({ page }) => {
  await page.goto('/?p3=1&growth=1&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.grantXp(8));
  const center = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[2]);
  await page.evaluate(({x,y}) => (window as any).__QUACKTRIS_TEST_API__.setBall(x,y-40,0,8), center);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'CHOOSING');
  await page.locator('[data-kind="clone"]').click();
  await page.locator('[data-slot="1"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const duck = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[1]);
  await page.evaluate(({x,y}) => (window as any).__QUACKTRIS_TEST_API__.setBall(x-9,y-40,0,8),duck);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.activeBalls === 2);
  const debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.duckKinds).toEqual(['basic', 'clone', 'basic', 'basic', 'basic']);
  expect(debug.worldBodies).toBe(11 + debug.bricksRemaining);
});

test('mobile same-kind neighboring selection merges into the chosen slot and restart restores basics', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await reachSecondEvolution(page, 'elastic');
  await page.locator('[data-kind="elastic"]').click();
  await expect(page.locator('[data-slot="2"]')).toHaveAttribute('data-fusion', 'true');
  await expect(page.locator('[data-slot="4"]')).toHaveAttribute('data-fusion', 'false');
  const before = await page.evaluate(() => (window as any).__QUACKTRIS__);
  await page.locator('[data-slot="2"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const fused = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(fused.duckKinds).toEqual(['basic', 'elastic', 'basic', 'basic']);
  expect(fused.fusionTiers).toEqual([0, 2, 0, 0]);
  expect(fused.mergeActive).toBe(true);
  expect(fused.ducks).toBe(4);
  expect(fused.worldConstraints).toBe(before.worldConstraints - 1);
  expect(fused.worldBodies).toBe(before.worldBodies - 1);
  expect(fused.duckPositions[1].parts).toBe(3);
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.setBall(180, 380, 0, 0));
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const target = (window as any).__QUACKTRIS__.duckPositions[1];
    (window as any).__QUACKTRIS_TEST_API__.setBall(target.x, target.y - 29, 0, 7);
  });
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.telemetry.hitsByDuckKind.elastic > 0);
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).ballVelocities[0].y).toBeLessThan(0);
  await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.forceLose());
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'LOST');
  await page.keyboard.press('r');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING'
    && (window as any).__QUACKTRIS__?.duckKinds.every((kind: string) => kind === 'basic'));
  const reset = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(reset.duckKinds).toEqual(Array(5).fill('basic'));
  expect(reset.fusionTiers).toEqual(Array(5).fill(0));
  expect(reset.worldBodies).toBe(10 + reset.bricksRemaining);
});

test('mobile fused paddle reaches both walls and catches a vertical edge ball', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await reachSecondEvolution(page, 'elastic');
  await page.locator('[data-kind="elastic"]').click();
  await page.locator('[data-slot="2"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const card = await page.locator('[data-game-surface]').boundingBox();
  expect(card).not.toBeNull();
  const y = card!.y + card!.height * 0.85;
  for (const side of ['left', 'right'] as const) {
    await page.evaluate(() => (window as any).__QUACKTRIS_TEST_API__.setBall(180, 390, 0, 0));
    await page.mouse.move(card!.x + card!.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(card!.x + (side === 'left' ? 2 : card!.width - 2), y, { steps: 8 });
    await page.waitForTimeout(3100);
    const before = await page.evaluate(() => (window as any).__QUACKTRIS__);
    expect(before.ducks).toBe(4);
    const outer = before.duckPositions[side === 'left' ? 0 : 3];
    expect(side === 'left' ? outer.x : 360 - outer.x).toBeLessThan(42);
    await page.evaluate((x) => (window as any).__QUACKTRIS_TEST_API__.setBall(x, 485, 0, 5.9),
      side === 'left' ? 8 : 352);
    await page.waitForFunction((hits) => {
      const d = (window as any).__QUACKTRIS__;
      return d?.phase === 'RUNNING' && d.telemetry.hitsByDuckKind.basic > hits;
    }, before.telemetry.hitsByDuckKind.basic, { timeout: 2500 });
    await page.mouse.up();
  }
});

test('same-kind nonadjacent ducks evolve separately without merging', async ({ page }) => {
  await reachSecondEvolution(page, 'elastic', 0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('5');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(debug.duckKinds).toEqual(['elastic', 'basic', 'basic', 'basic', 'elastic']);
  expect(debug.fusionTiers).toEqual([1, 0, 0, 0, 1]);
  expect(debug.mergeActive).toBe(false);
});

test('fused bomb clears up to two neighbors and fused clone lives longer', async ({ page }) => {
  await reachSecondEvolution(page, 'bomb');
  await page.locator('[data-kind="bomb"]').click();
  await page.locator('[data-slot="2"]').click();
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  const bombDuck = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[1]);
  await page.evaluate(({ x, y }) =>
    (window as any).__QUACKTRIS_TEST_API__.setBall(x - 8, y - 40, 0, 5.9), bombDuck);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.bombArmed === true);
  const debug = await page.evaluate(() => (window as any).__QUACKTRIS__);
  const bottom = debug.brickPositions.find((brick: any) => brick.y === 190
    && brick.x > 120 && brick.x < 200)!;
  await page.evaluate(({ x, y }) =>
    (window as any).__QUACKTRIS_TEST_API__.setBall(x, y + 25, 0, -8), bottom);
  await page.waitForFunction((count) => (window as any).__QUACKTRIS__?.bricksRemaining <= count - 3,
    debug.bricksRemaining);
  expect((await page.evaluate(() => (window as any).__QUACKTRIS__)).telemetry.bombBonusBricks)
    .toBeGreaterThanOrEqual(2);

  await reachSecondEvolution(page, 'clone');
  await page.locator('[data-kind="clone"]').click();
  await page.locator('[data-slot="2"]').click();
  const duck = await page.evaluate(() => (window as any).__QUACKTRIS__.duckPositions[1]);
  await page.evaluate(({ x, y }) =>
    (window as any).__QUACKTRIS_TEST_API__.setBall(x - 9, y - 40, 0, 8), duck);
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.activeBalls === 2);
  const clone = await page.evaluate(() => (window as any).__QUACKTRIS__);
  expect(clone.cloneRemainingMs).toBeGreaterThan(8500);
  expect(clone.ducks).toBe(4);
  expect(clone.worldBodies).toBe(10 + clone.bricksRemaining);
});
