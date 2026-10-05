import { expect, test } from '@playwright/test';

test('locked growth does not grant equipment from stale flags', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('induckupCampaignV2', JSON.stringify({
    version: 2, rankingUnlocked: true, clearedStages: [], highestUnlockedStage: 1,
  })));
  await page.goto('/?growth=1&test=1');
  await expect(page.getByText('Stage 6 · 후문을 완료하면')).toBeVisible();
  await expect(page.locator('[data-equipment="feather-recovery"]')).toBeDisabled();
  await page.goto('/?play=campaign&stage=1&test=1');
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.phase)).toBe('RUNNING');
  expect(await page.evaluate(() => (window as any).__INDUCKUP_P4__?.equipmentId)).toBeNull();
});

test('Stage 6 clear unlocks equipment, selection survives reload, and retry resets the Area budget', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('induckupCampaignV2', JSON.stringify({
    version: 2, clearedStages: [1, 2, 3, 4, 5, 6], highestUnlockedStage: 6,
    stages: Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [i, { goals: ['clear'], best: null }])),
  })));
  await page.goto('/?growth=1&test=1');
  await expect(page.getByText('누적 ★ 6/18')).toBeVisible();
  await page.locator('[data-equipment="feather-recovery"]').click();
  await expect(page.locator('[data-equipment="feather-recovery"]')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('[data-equipment="feather-recovery"]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/?play=campaign&stage=1&test=1');
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.phase)).toBe('RUNNING');
  expect(await page.evaluate(() => (window as any).__INDUCKUP_P4__?.equipmentId)).toBe('feather-recovery');
  expect(await page.evaluate(() => (window as any).__INDUCKUP_P4__?.recoveryRemaining)).toBe(1);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.forceLose());
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.restart());
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.phase)).toBe('RUNNING');
  expect(await page.evaluate(() => (window as any).__INDUCKUP_P4__?.recoveryRemaining)).toBe(1);
});

test('notebook preserves fixed Stage 5 freeze slot', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('induckupProgressV1', JSON.stringify({
    campaign: { version: 2, clearedStages: [1, 2, 3, 4, 5, 6], highestUnlockedStage: 6,
      stages: Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [i, { goals: ['clear', 'hp50', 'fusion'], best: null }])) },
    meta: { version: 1, selectedEquipmentId: 'choice-notebook', equipmentChangedAt: '2026-09-25T00:00:00Z' },
  })));
  await page.goto('/?play=campaign&stage=5&test=1');
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.phase)).toBe('RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(7));
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.phase)).toBe('UPGRADING');
  await expect(page.locator('[data-ui="upgrade-cards"]')).toContainText('빙결 훈련');
  await expect(page.locator('[data-reroll-slot="2"]')).toHaveCount(0);
  await page.locator('[data-reroll-slot="0"]').click();
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.notebookUsed)).toBe(true);
  await expect(page.locator('[data-reroll-slot]')).toHaveCount(0);
});

test('landing chalk predicts a descending ball and resets on the next Area', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('induckupProgressV1', JSON.stringify({
    campaign: { version: 2, clearedStages: [1, 2, 3, 4, 5, 6], highestUnlockedStage: 6,
      stages: Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [i, {
        goals: i <= 3 ? ['clear', 'hp50', 'fusion'] : ['clear'], best: null,
      }])) },
    meta: { version: 1, selectedEquipmentId: 'landing-chalk', equipmentChangedAt: '2026-09-25T00:00:00Z' },
  })));
  await page.goto('/?play=campaign&stage=1&test=1');
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.phase)).toBe('RUNNING');
  expect(await page.evaluate(() => (window as any).__INDUCKUP_P4__?.equipmentId)).toBe('landing-chalk');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.setBall(180, 400, 0, 5));
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.landingX)).toBeCloseTo(180);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.setBall(180, 510, 0, 5));
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.chalkAvailable)).toBe(false);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await expect.poll(async () => page.evaluate(() => (window as any).__INDUCKUP_P4__?.area)).toBe(2);
  expect(await page.evaluate(() => (window as any).__INDUCKUP_P4__?.chalkAvailable)).toBe(true);
});
