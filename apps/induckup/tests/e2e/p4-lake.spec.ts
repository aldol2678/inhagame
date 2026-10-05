import { expect, test, type Page } from '@playwright/test';

async function chooseFirstUpgrade(page: Page) {
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'UPGRADING');
  const offer = await page.evaluate(() => (window as any).__INDUCKUP_P4__.upgradeOffer);
  expect(offer).toHaveLength(3);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.chooseUpgrade());
}

test('P4 alternates roguelike cards with Lv.3 / Lv.6 evolution while preserving growth across areas', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?play=campaign&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');

  let debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug).toMatchObject({
    area: 1, level: 1, totalXp: 0, hp: 100, maxHp: 100, defence: 5, ballAttack: 10,
  });
  expect(debug.monsterPositions.every((m: any) => m.hp === 10 && m.defense === 0)).toBe(true);

  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(7));
  await chooseFirstUpgrade(page);
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug.level).toBe(2);
  expect(debug.pickedCards).toHaveLength(1);

  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(8));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CHOOSING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.choose('pierce', 1));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug.level).toBe(3);
  expect(debug.duckKinds).toEqual(['basic', 'pierce', 'basic', 'basic', 'basic']);

  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.area === 2);
  expect((await page.evaluate(() => (window as any).__INDUCKUP_P4__)).totalXp).toBe(15);

  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(10));
  await chooseFirstUpgrade(page);
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(11));
  await chooseFirstUpgrade(page);
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');

  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(12));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CHOOSING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.choose('pierce', 2));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug.level).toBe(6);
  expect(debug.ducks).toBe(4);
  expect(debug.fusionTiers).toEqual([0, 2, 0, 0]);
  expect(debug.pickedCards).toHaveLength(3);

  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(14));
  await chooseFirstUpgrade(page);
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug.level).toBe(7);
  expect(debug.pickedCards).toHaveLength(4);

  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CLEAR');
  const campaign = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('induckupCampaignV2') ?? 'null'));
  expect(campaign.clearedStages).toEqual([1]);
  expect(campaign.stages['1'].goals).toContain('fusion');
  expect(campaign.rankingUnlocked).toBe(false);
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 1 · 인경호' }))
    .toContainText('CLEAR');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 2 · 본관' }))
    .toContainText('PLAY');
});

test('P4 overflow resolves Lv.2 card before Lv.3 evolution', async ({ page }) => {
  await page.goto('/?play=campaign&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(17));
  await page.waitForFunction(() => {
    const game = (window as any).__INDUCKUP_P4__;
    return game?.phase === 'UPGRADING' && game.upgradeLevel === 2 && game.level === 3;
  });
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.chooseUpgrade());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CHOOSING');
  const debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug.totalXp).toBe(17);
  expect(debug.xp).toBe(2);
  expect(debug.pickedCards).toHaveLength(1);
});

test('P4 danger line deals monster ATK minus player DEF to HP', async ({ page }) => {
  await page.goto('/?play=campaign&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.breach());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.hp === 75);
  const debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug.phase).toBe('RUNNING');
  expect(debug.hp).toBe(75);
  expect(debug.defence).toBe(5);
  expect(debug.breached).toBeGreaterThanOrEqual(1);
});

test('P4 base ball ATK 10 destroys a 10 HP wave monster in one hit', async ({ page }) => {
  await page.goto('/?play=campaign&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  const target = await page.evaluate(() => (window as any).__INDUCKUP_P4__.monsterPositions[0]);
  const before = await page.evaluate(() => (window as any).__INDUCKUP_P4__.monsterCount);
  await page.evaluate(({ x, y }) =>
    (window as any).__INDUCKUP_P4_TEST_API__.setBall(x, y + 28, 0, -7), target);
  await page.waitForFunction((count) => (window as any).__INDUCKUP_P4__?.monsterCount < count, before);
  expect((await page.evaluate(() => (window as any).__INDUCKUP_P4__)).defeated).toBeGreaterThanOrEqual(1);
});

test('P4 pierce evolution still preserves incoming direction through a monster', async ({ page }) => {
  await page.goto('/?play=campaign&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(15));
  await chooseFirstUpgrade(page);
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CHOOSING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.choose('pierce', 2));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');

  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.setBall(180, 510, 0, 7));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.pierceRemaining === 1);
  const target = await page.evaluate(() => {
    const monsters = (window as any).__INDUCKUP_P4__.monsterPositions;
    return monsters.reduce((best: any, item: any) => !best || item.y > best.y ? item : best, null);
  });
  const before = await page.evaluate(() => (window as any).__INDUCKUP_P4__.monsterCount);
  await page.evaluate(({ x, y }) =>
    (window as any).__INDUCKUP_P4_TEST_API__.setBall(x, y + 28, 0, -7), target);
  await page.waitForFunction((count) => (window as any).__INDUCKUP_P4__?.monsterCount < count, before);
  const debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug.piercePasses).toBeGreaterThanOrEqual(1);
  expect(debug.ballVelocities[0].y).toBeLessThan(0);
});

test('campaign route loads P4 and P3 remains available behind p3=1', async ({ page }) => {
  await page.goto('/?play=campaign&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await expect(page.getByText('인덕업 🦆🌊')).toBeVisible();

  await page.goto('/?p3=1&test=1');
  await page.waitForFunction(() => (window as any).__QUACKTRIS__?.phase === 'RUNNING');
  await expect(page.getByText('인덕업 🦆⬆️')).toBeVisible();
});


test('P4 exposes an always-visible main hub navigation control', async ({ page }) => {
  await page.goto('/?play=campaign&test=1');
  const home = page.getByRole('link', { name: '메인 허브로 이동' });
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute('href', './');
});
