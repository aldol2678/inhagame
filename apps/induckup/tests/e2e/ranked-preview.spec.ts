import { expect, test } from '@playwright/test';

test('new guests can practice while the ranked lobby and campaign remain locked', async ({ page }) => {
  await page.goto('/?test=1');
  await page.getByRole('link', { name: /무한 생존 연습 시작/ }).click();
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  await expect(page.locator('[data-ui="progress"]')).toContainText('Wave 1');
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.forceLose());
  await expect(page.locator('[data-ui="result-copy"]')).toContainText('공식 랭킹에 반영되지 않습니다');
  await page.goto('/?ranking=1&test=1');
  await expect(page.getByRole('heading', { name: '랭킹전 잠김' })).toBeVisible();
  await expect(page.getByRole('link', { name: /무한 생존 연습 시작/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('induckupCampaignV2'))).toBeNull();
});

test('practice survives waves 1–10 without writing campaign or ranking records', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('induckupCampaignV2', JSON.stringify({
    version: 2, clearedStages: [1, 2, 3, 4, 5, 6], highestUnlockedStage: 6,
    rankingUnlocked: true, stages: {}, updatedAt: null,
  })));
  await page.goto('/?ranking=1&test=1');
  await page.getByRole('link', { name: /무한 생존 연습 시작/ }).click();
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.phase === 'RUNNING');
  const before = await page.evaluate(() => localStorage.getItem('induckupCampaignV2'));
  expect((await page.evaluate(() => (window as any).__INDUCKUP_P4__)).equipmentId).toBeNull();

  for (let wave = 1; wave <= 10; wave += 1) {
    await page.waitForFunction((expected) => (window as any).__INDUCKUP_P4__?.previewWave === expected, wave);
    const state = await page.evaluate(() => (window as any).__INDUCKUP_P4__);
    if (wave === 5) expect(state.monsterPositions.map((enemy: any) => enemy.kind))
      .toContain('elite-giant');
    if (wave === 10) expect(state.monsterPositions.map((enemy: any) => enemy.kind))
      .toContain('boss');
    await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.completeArea());
  }
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.previewWave === 11);
  await page.evaluate(() => (window as any).__INDUCKUP_P4_TEST_API__.forceLose());
  await expect(page.locator('[data-ui="result-copy"]')).toContainText('완료 10 Wave');
  await expect(page.locator('[data-ui="result-copy"]')).toContainText('공식 랭킹에 반영되지 않습니다');
  expect(await page.evaluate(() => localStorage.getItem('induckupCampaignV2'))).toBe(before);
  await page.getByRole('button', { name: /다시 꽥/ }).click();
  await page.waitForFunction(() => (window as any).__INDUCKUP_P4__?.previewWave === 1);
});
