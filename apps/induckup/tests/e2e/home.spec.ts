import { expect, test } from '@playwright/test';

test('home is the default route with six campus stages and locked ranking', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.getByRole('heading', { name: '인덕업 🦆⬆️' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 1 · 인경호' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 2 · 본관' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 3 · 정석학술정보관' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 4 · 5호관' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 5 · 60주년기념관' })).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 6 · 후문' })).toBeVisible();
  const home = await page.evaluate(() => (window as any).__INDUCKUP_HOME__);
  expect(home.rankingUnlocked).toBe(false);
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
  await expect(page.locator('[data-account-open]')).toBeVisible();
  await expect(page.locator('[data-home-ranking]')).toBeVisible();
});

test('stage one entry opens campaign while ranking remains locked until stage six', async ({ page }) => {
  await page.goto('/?test=1');
  await page.locator('.stage-row.active').click();
  await expect(page.getByRole('heading', { name: '인덕업 🦆🌊' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('play')).toBe('campaign');

  await page.evaluate(() => localStorage.setItem('induckupCampaignV1', JSON.stringify({
    version: 1,
    clearedStages: [1],
    highestUnlockedStage: 2,
    rankingUnlocked: true,
    updatedAt: new Date().toISOString(),
  })));
  await page.goto('/?test=1');
  await expect(page.locator('.ranking-button')).toHaveClass(/locked/);
  await expect(page.getByText('1/6 CLEAR')).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 2 · 본관' })).toContainText('PLAY');
  await expect(page.getByText('Stage 6 후문 CLEAR 후 해금')).toBeVisible();
  await expect(page.locator('.stage-row').filter({ hasText: 'Stage 1 · 인경호' }))
    .toContainText('★☆☆');
  await page.reload();
  await expect(page.getByText('1/6 CLEAR')).toBeVisible();
});

test('ranking direct route stays locked before stage six clear', async ({ page }) => {
  await page.goto('/?ranking=1&test=1');
  await expect(page.getByRole('heading', { name: '랭킹전 잠김' })).toBeVisible();
});


test('home account button opens unified INHAGAME account panel', async ({ page }) => {
  await page.goto('/?test=1');
  await page.locator('[data-account-open]').click();
  await expect(page.getByRole('heading', { name: '👤 INHAGAME 계정' })).toBeVisible();
  await expect(page.getByRole('button', { name: '회원가입' })).toBeVisible();
  await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
});

test('stage six clear unlocks server leaderboard shell and account control', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('induckupCampaignV1', JSON.stringify({
    version: 1,
    clearedStages: [1,2,3,4,5,6],
    highestUnlockedStage: 6,
    rankingUnlocked: true,
    updatedAt: new Date().toISOString(),
  })));
  await page.goto('/?ranking=1&test=1');
  await expect(page.getByRole('heading', { name: '랭킹전 · 무한 생존' })).toBeVisible();
  await expect(page.getByText('전체 랭킹')).toBeVisible();
  await expect(page.locator('[data-account-open]')).toBeVisible();
});
