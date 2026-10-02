import { expect, test, type Page } from '@playwright/test';

async function unlockLibrary(page: Page) {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('induckupCampaignV2', JSON.stringify({
    version: 2, clearedStages: [1, 2], highestUnlockedStage: 3, stages: {}, updatedAt: null,
  })));
}

test('Stage 3 direct entry stays locked before Stage 2 CLEAR', async ({ page }) => {
  await page.goto('/?play=campaign&stage=3&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆⬆️' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 3 · 정석학술정보관' }))
    .toContainText('🔒');
});

test('library combat reuses the campaign account contract and opens Stage 4 PLAY', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await unlockLibrary(page);
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 3 · 정석학술정보관' }))
    .toContainText('PLAY');
  await expect(page.locator('.continue-button')).toHaveAttribute('href', '?play=campaign&stage=3');
  await page.goto('/?play=campaign&stage=3&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆📚' })).toBeVisible();
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  const first = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(first.monsterPositions.map((monster: any) => monster.kind))
    .toEqual(['support', 'shelf', 'shield']);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.area === 2);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CLEAR');
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('induckupCampaignV2') ?? 'null'));
  expect(progress.clearedStages).toEqual([1, 2, 3]);
  expect(progress.stages['3'].goals).toContain('clear');
  expect(progress.highestUnlockedStage).toBe(4);
  expect(progress.rankingUnlocked).toBe(false);
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 3 · 정석학술정보관' }))
    .toContainText('CLEAR');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 4 · 5호관' }))
    .toContainText('PLAY');
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
  await page.goto('/?play=campaign&stage=5&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆⬆️' })).toBeVisible();
});

test('piercing ball traverses the bookshelf corridor in Stage 3', async ({ page }) => {
  await unlockLibrary(page);
  await page.goto('/?play=campaign&stage=3&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(15));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'UPGRADING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.chooseUpgrade());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CHOOSING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.choose('pierce', 2));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.setBall(180, 510, 0, 7));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.pierceRemaining === 1);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.setBall(180, 342, 0, -7));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.ballPositions[0]?.y < 250);
  const debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug.pierceRemaining).toBe(1);
  expect(debug.ballVelocities[0].y).toBeLessThan(0);
});
