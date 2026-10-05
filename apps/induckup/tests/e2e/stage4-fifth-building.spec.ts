import { expect, test, type Page } from '@playwright/test';

async function unlockFifth(page: Page) {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('induckupCampaignV2', JSON.stringify({
    version: 2, clearedStages: [1, 2, 3], highestUnlockedStage: 4,
    stages: {}, updatedAt: null, rankingUnlocked: true,
  })));
}

test('Stage 4 rejects direct entry before Stage 3 CLEAR', async ({ page }) => {
  await page.goto('/?play=campaign&stage=4&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆⬆️' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 4 · 5호관' }))
    .toContainText('🔒');
});

test('Stage 4 CLEAR opens Stage 5 PLAY while preserving account progress and ranking lock', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await unlockFifth(page);
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 4 · 5호관' }))
    .toContainText('PLAY');
  await expect(page.locator('.continue-button')).toHaveAttribute('href', '?play=campaign&stage=4');
  await page.goto('/?play=campaign&stage=4&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆🏫' })).toBeVisible();
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  const first = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(first.monsterPositions.map((monster: any) => monster.kind)).toEqual(['wave', 'flank', 'wave']);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.area === 2);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CLEAR');
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('induckupCampaignV2') ?? 'null'));
  expect(progress.clearedStages).toEqual([1, 2, 3, 4]);
  expect(progress.stages['4'].goals).toContain('clear');
  expect(progress.highestUnlockedStage).toBe(5);
  expect(progress.rankingUnlocked).toBe(false);
  await page.goto('/?test=1');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 4 · 5호관' }))
    .toContainText('CLEAR');
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 5 · 60주년기념관' }))
    .toContainText('PLAY');
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
  await page.goto('/?play=campaign&stage=6&test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆⬆️' })).toBeVisible();
});

test('a single ball crosses the open passage below the Stage 4 divider', async ({ page }) => {
  await unlockFifth(page);
  await page.goto('/?play=campaign&stage=4&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.area === 2);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.setBall(130, 420, 7, -2));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.ballPositions[0]?.x > 210);
  const debug = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
  expect(debug.activeBalls).toBe(1);
  expect(debug.ballPositions[0].y).toBeGreaterThan(320);
});

test('the clone creates two balls that damage separate Stage 4 fronts', async ({ page }) => {
  await unlockFifth(page);
  await page.goto('/?play=campaign&stage=4&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.grantXp(15));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'UPGRADING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.chooseUpgrade());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'CHOOSING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.choose('clone', 2));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.setBall(180, 510, 0, 7));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.activeBalls === 2);
  const targets = await page.evaluate(() => (window as any).__INDUCKUP_P4__.monsterPositions
    .filter((monster: any) => monster.kind === 'wave'));
  expect(targets).toHaveLength(2);
  await page.evaluate(([left, right]) => {
    (window as any).__INDUCKUP_P4_TEST_API__.setBall(left.x, left.y + 28, 0, -7, 0);
    (window as any).__INDUCKUP_P4_TEST_API__.setBall(right.x, right.y + 28, 0, -7, 1);
  }, targets);
  await page.waitForFunction(([left, right]) => {
    const monsters = (window as any).__INDUCKUP_P4__?.monsterPositions ?? [];
    return [left, right].every(target => {
      const current = monsters.find((monster: any) => Math.abs(monster.x - target.x) < 12
        && monster.kind === 'wave');
      return !current || current.hp < target.hp;
    });
  }, targets);
});

test('a breached Stage 4 boss part loses the run without granting a stage clear', async ({ page }) => {
  await unlockFifth(page);
  await page.goto('/?play=campaign&stage=4&test=1');
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.area === 2);
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.monsterPositions
    .some((monster: any) => monster.kind === 'team-doc'));
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.breach('team-doc'));
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'LOST');
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('induckupCampaignV2') ?? 'null'));
  expect(progress.clearedStages).toEqual([1, 2, 3]);
  await expect(page.getByText('조별과제 파트가 위험선에 도달했습니다.')).toBeVisible();
});
