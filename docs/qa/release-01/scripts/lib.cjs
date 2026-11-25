const { chromium, devices } = require('playwright');
const GL = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];
async function open({ port = 8021, context = { viewport: { width: 1366, height: 768 } }, storageState, extraArgs = [] } = {}) {
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ args: [...GL, ...extraArgs] });
  const ctx = await browser.newContext({ ...context, storageState });
  const page = await ctx.newPage();
  const log = { errors: [], warnings: [], failed: [], requests: 0, bytes: 0 };
  page.on('pageerror', e => log.errors.push('PAGEERROR ' + (e.stack || e.message).slice(0, 600)));
  page.on('console', m => { if (m.type() === 'error') log.errors.push(m.text().slice(0, 400)); else if (m.type() === 'warning' && !/GL Driver|GPU stall/.test(m.text())) log.warnings.push(m.text().slice(0, 300)); });
  page.on('requestfailed', r => { if (new URL(r.url()).origin === origin) log.failed.push(r.url() + ' ' + r.failure()?.errorText); });
  page.on('response', r => { log.requests++; if (r.status() >= 400 && new URL(r.url()).origin === origin) log.failed.push(r.status() + ' ' + r.url()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
    return route.abort();
  });
  return { browser, ctx, page, log, origin };
}
const status = page => page.evaluate(() => { const s = window.__INHAGAME_P0__.getStatus(); delete s.landmarks; return s; });
const boot = async (page, origin, path = '/campus/?lobby=1') => {
  const t0 = Date.now();
  await page.goto(origin + path, { waitUntil: 'commit' });
  await page.waitForFunction(() => ['ERROR', 'READY'].includes(window.__INHA_WORLD_BOOT_RECOVERY__?.status().state), null, { timeout: 180000 });
  return { ms: Date.now() - t0, recovery: await page.evaluate(() => window.__INHA_WORLD_BOOT_RECOVERY__.status()) };
};
module.exports = { open, status, boot, devices, GL };
