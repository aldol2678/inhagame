// Boot with the default (auto) graphics preference per device profile; records tier, timing and asset failures.
const fs = require('fs');
const { open, status, boot, devices } = require('./lib.cjs');
const [port, out] = process.argv.slice(2);
const profiles = { pc: { viewport: { width: 1366, height: 768 } }, android: devices['Pixel 7'], ipad: devices['iPad Pro 11 landscape'], 'ipad-portrait': devices['iPad Pro 11'] };
(async () => {
  const rows = [];
  for (const [name, context] of Object.entries(profiles)) {
    const { browser, page, log, origin } = await open({ port: +port, context });
    try {
      const b = await boot(page, origin); const s = await status(page);
      await page.locator('#world-loading').waitFor({ state: 'hidden', timeout: 60000 });
      const start = await page.locator('#main-gate-start').boundingBox();
      rows.push({ name, ms: b.ms, state: b.recovery.state, renderer: s.renderer, tier: s.graphics.tier, reason: s.graphics.autoReason, model: s.lobbyPlayer?.modelState, requests: log.requests, failed: log.failed, errors: log.errors, startButton: start, viewport: page.viewportSize() });
      await page.screenshot({ path: out.replace(/\.json$/, '-' + name + '.png') });
    } catch (e) { rows.push({ name, error: e.message.slice(0, 300) }); }
    await browser.close();
    console.log(JSON.stringify(rows.at(-1)).slice(0, 600));
  }
  fs.writeFileSync(out, JSON.stringify(rows, null, 1));
})();
