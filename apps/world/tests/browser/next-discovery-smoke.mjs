// Real Chromium rendering of the committed Main 2 HUD, minimap, CSS and controller.
// Quest state is a fixture: this proves layout/input, not production authentication/RPCs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const html = await readFile(new URL('../../campus/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../../styles.css', import.meta.url), 'utf8');
const source = await readFile(new URL('../../src/next-discovery.js', import.meta.url), 'utf8');
const hud = html.match(/<section\b[^>]*id="quest-hud"[^>]*>[\s\S]*?<\/section>/)?.[0];
const minimap = html.match(/<aside\b[^>]*id="minimap"[^>]*>[\s\S]*?<\/aside>/)?.[0];
assert.ok(hud && minimap, 'use actual committed HUD and minimap markup');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body data-space="campus">${hud}${minimap}</body></html>`);
  await page.addScriptTag({ content: source.replace(/export /g, '') + '\nwindow.createNextDiscovery = createNextDiscovery;' });
  await page.evaluate(() => {
    document.getElementById('quest-hud').hidden = false;
    document.getElementById('quest-hud-objective').textContent = '후문 안내 학생과 대화';
    document.getElementById('quest-hud-bearing').textContent = '↗ 180m';
    document.getElementById('minimap').hidden = false;
    document.getElementById('minimap').removeAttribute('data-minimap-state');
    window.calls = 0;
    window.progress = { quest: { enabled: true, signedIn: true, ready: true, stage: 5 },
      main2Quest: { enabled: true, signedIn: true, ready: true, available: true, stage: 0 } };
    window.controller = createNextDiscovery({ root: document.getElementById('next-discovery'),
      primaryButton: document.getElementById('next-discovery-primary'), onPrimary: () => { window.calls++; return true; } });
    controller.syncProgress(progress);
  });
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.evaluate(() => {
      const r = document.getElementById('quest-hud').getBoundingClientRect();
      const b = document.getElementById('next-discovery-primary').getBoundingClientRect();
      const m = document.getElementById('minimap').getBoundingClientRect();
      return { inside: b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom,
        onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        overlapsMinimap: r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top,
        buttonWidth: b.width, buttonHeight: b.height };
    });
    assert.ok(layout.inside && layout.onScreen && !layout.overlapsMinimap, JSON.stringify({ width, ...layout }));
    await page.getByRole('button', { name: '후문 안내 학생까지 길 안내' }).click();
    assert.equal(await page.locator('#next-discovery-primary').isVisible(), true, 'action remains retryable');
    console.log('next-discovery layout PASS', JSON.stringify({ width, ...layout }));
  }
  assert.equal(await page.evaluate(() => window.calls), 3, 'real clicks reached the controller');
  await page.evaluate(() => controller.syncProgress(null));
  assert.equal(await page.locator('#next-discovery-primary').isVisible(), false, 'logout hides the action');
  await page.evaluate(() => controller.syncProgress(progress));
  assert.equal(await page.locator('#next-discovery-primary').isVisible(), true, 'status restores the action');
  await page.evaluate(() => controller.syncProgress({ ...progress, main2Quest: { ...progress.main2Quest, stage: 1 } }));
  assert.equal(await page.locator('#next-discovery-primary').isVisible(), false, 'starting Main 2 removes the handoff action');
  console.log('next-discovery browser smoke: PASS');
} finally { await browser.close(); }
