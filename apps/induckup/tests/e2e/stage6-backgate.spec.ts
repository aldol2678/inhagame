import { expect, test, type Page } from '@playwright/test';

async function unlockBackGate(page: Page) {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('induckupCampaignV2', JSON.stringify({
    version: 2, clearedStages: [1, 2, 3, 4, 5], highestUnlockedStage: 6,
    stages: {}, updatedAt: null, rankingUnlocked: true,
  })));
}

test('new visitors cannot enter Stage 6 and old ranking flags cannot open its lobby', async ({ page }) => {
  await page.goto('/?play=campaign&stage=6&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆⬆️' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 6 · 후문' }))
    .toContainText('🔒');
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
  await page.evaluate(() => localStorage.setItem('induckupCampaignV2', JSON.stringify({
    version: 2, clearedStages: [1, 2, 3, 4, 5], highestUnlockedStage: 6,
    rankingUnlocked: true, stages: {},
  })));
  await page.goto('/?test=1');
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
});

test('Stage 6 passes four Areas, saves CLEAR and stars, and opens only the ranking lobby', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await unlockBackGate(page);
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 6 · 후문' }))
    .toContainText('PLAY');
  await expect(page.locator('.continue-button')).toHaveAttribute('href', '?play=campaign&stage=6');
  await page.goto('/?play=campaign&stage=6&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆🌙' })).toBeVisible();
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  for (const [area, target] of [[1, 12], [2, 14], [3, 14], [4, 5]]) {
    await page.waitForFunction((expected) => (window as any).__INDUCKUP_P4__?.area === expected, area);
    expect((await page.evaluate(() => (window as any).__INDUCKUP_P4__)).target).toBe(target);
    if (area === 4) {
      const boss = await page.evaluate(() => (window as any).__INDUCKUP_P4__.monsterPositions
        .find((enemy: any) => enemy.kind === 'final-thesis'));
      expect(boss).toMatchObject({ hp: 120, defense: 6 });
      await page.evaluate((enemy) => (window as any).__INDUCKUP_P4_TEST_API__.setBall(
        enemy.x, enemy.y + 35, 0, -7), boss);
      await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.monsterPositions
        .some((enemy: any) => enemy.kind === 'final-thesis' && enemy.hp < 120));
    }
    await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  }
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CLEAR');
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 6 · 후문' }))
    .toContainText('CLEAR');
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('induckupCampaignV2') ?? 'null'));
  expect(progress.clearedStages).toEqual([1, 2, 3, 4, 5, 6]);
  expect(progress.stages['6'].goals).toContain('clear');
  expect(progress.stages['6'].goals).toContain('hp50');
  expect(progress.rankingUnlocked).toBe(true);
  await expect(page.locator('.ranking-button')).not.toHaveClass(/locked/);
  await page.goto('/?ranking=1&test=1');
  await expect(page.getByRole('heading', { name: '랭킹전 · 무한 생존' })).toBeVisible();
  await expect(page.getByRole('link', { name: /무한 생존 연습 시작/ }))
    .toHaveAttribute('href', '?play=ranking-preview&test=1');
});

test('final boss breach ends Stage 6 without granting CLEAR or unlocking ranking', async ({ page }) => {
  await unlockBackGate(page);
  await page.goto('/?play=campaign&stage=6&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  for (let area = 1; area <= 3; area += 1) {
    await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
    await page.waitForFunction((next) => (window as any).__INDUCKUP_P4__?.area === next, area + 1);
  }
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.breach('final-thesis'));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'LOST');
  await expect(page.locator('[data-ui="result-copy"]')).toContainText('졸업논문');
  await page.goto('/?test=1');
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
});
