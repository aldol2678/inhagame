import { expect, test } from '@playwright/test';

test('Stage 2 direct route remains locked until Stage 1 is clear', async ({ page }) => {
  await page.goto('/?play=campaign&stage=2&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆⬆️' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 2 · 본관' }))
    .toContainText('🔒');
});

test('Stage 2 combat opens Stage 3 PLAY without unlocking ranking', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('induckupCampaignV2', JSON.stringify({
    version: 2, clearedStages: [1], highestUnlockedStage: 2, stages: {}, updatedAt: null,
  })));
  await page.reload();
  const stage2 = page.locator('.stage-row').filter({ hasText: 'Stage 2 · 본관' });
  await expect(stage2).toContainText('PLAY');
  await expect(stage2).toHaveAttribute('href', '?play=campaign&stage=2');
  await page.goto('/?play=campaign&stage=2&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆🏛️' })).toBeVisible();
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  const first = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(first.monsterPositions.some((monster: any) => monster.kind === 'armor')).toBe(true);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.area === 2);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CLEAR');
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('induckupCampaignV2') ?? 'null'));
  expect(progress.clearedStages).toEqual([1, 2]);
  expect(progress.stages['2'].goals).toContain('clear');
  expect(progress.highestUnlockedStage).toBe(3);
  expect(progress.rankingUnlocked).toBe(false);
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 2 · 본관' }))
    .toContainText('CLEAR');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 3 · 정석학술정보관' }))
    .toContainText('PLAY');
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
});
