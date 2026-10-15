// Exercise the same category navigation as a user, never hidden-control selection.
import assert from 'node:assert/strict';

export async function openSettingsCategory(page, category, { touch = false } = {}) {
  assert.equal(await page.locator('#view-settings').isVisible(), true, 'settings panel is open');
  assert.equal(await page.locator('#settings-category-home').isVisible(), true, 'settings opens at category home');
  const section = page.locator(`#settings-page-${category}`);
  assert.equal(await section.isVisible(), false, 'category controls start hidden');
  const button = page.locator(`[data-settings-target="${category}"]`);
  if (touch) await button.tap();
  else await button.click();
  assert.equal(await section.isVisible(), true, 'selected category is visible');
  assert.equal(await page.locator('#settings-category-home').isVisible(), false, 'category home is hidden');
  assert.equal(await page.locator('#settings-section-back').isVisible(), true, 'category has a visible back action');
}
