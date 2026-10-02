import { expect, test, type Page } from '@playwright/test';

async function unlockAnniversary(page: Page) {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('induckupCampaignV2', JSON.stringify({
    version: 2, clearedStages: [1, 2, 3, 4], highestUnlockedStage: 5,
    stages: {}, updatedAt: null, rankingUnlocked: true,
  })));
}

test('Stage 5 direct entry stays locked before Stage 4 CLEAR', async ({ page }) => {
  await page.goto('/?play=campaign&stage=5&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆⬆️' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 5 · 60주년기념관' }))
    .toContainText('🔒');
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
});

test('Stage 5 CLEAR opens Stage 6 PLAY and restores stars after reload without unlocking ranking', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await unlockAnniversary(page);
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 5 · 60주년기념관' }))
    .toContainText('PLAY');
  await expect(page.locator('.continue-button')).toHaveAttribute('href', '?play=campaign&stage=5');
  await page.goto('/?play=campaign&stage=5&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆🎓' })).toBeVisible();
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  const first = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(first.monsterPositions.map((enemy: any) => enemy.kind)).toEqual(['wave', 'swarm', 'armor']);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.area === 2);
  const second = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(second.target).toBe(24);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CLEAR');
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 5 · 60주년기념관' }))
    .toContainText('CLEAR');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 6 · 후문' }))
    .toContainText('PLAY');
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('induckupCampaignV2') ?? 'null'));
  expect(progress.clearedStages).toEqual([1, 2, 3, 4, 5]);
  expect(progress.stages['5'].goals).toContain('clear');
  expect(progress.rankingUnlocked).toBe(false);
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
  await page.goto('/?play=campaign&stage=6&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆🌙' })).toBeVisible();
});

test('optional Stage 5 freezing card slows a direct-hit monster without changing the earlier card pool', async ({ page }) => {
  await unlockAnniversary(page);
  await page.goto('/?play=campaign&stage=5&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(15));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'UPGRADING');
  expect((await page.evaluate(() => (window as any).__INDUCKUP_P4__.upgradeOffer)))
    .toContain('freeze-training');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.chooseUpgrade('freeze-training'));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CHOOSING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.choose('pierce', 2));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  const armor = await page.evaluate(() => (window as any).__INDUCKUP_P4__.monsterPositions
    .find((enemy: any) => enemy.kind === 'armor'));
  expect(armor).toBeTruthy();
  await page.evaluate((enemy) => (window as any).__INDUCKUP_P4_TEST_API__.setBall(
    enemy.x, enemy.y + 29, 0, -7), armor);
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.monsterPositions
    .some((enemy: any) => enemy.kind === 'armor' && enemy.frozen));
  expect((await page.evaluate(() => (window as any).__INDUCKUP_P4__)).freezeEnabled).toBe(true);
});
