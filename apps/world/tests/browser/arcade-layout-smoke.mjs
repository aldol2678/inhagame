// Offline application regression. No Production requests, accounts, or game writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(process.env.EVIDENCE_DIR || 'test-results/portal-layout', 'arcade');
await mkdir(output, { recursive: true });
const data = JSON.parse(await readFile(resolve(root, 'data/game-catalog.json'), 'utf8'));
const games = data.games.filter(g => g.id !== 'campus' && g.status === 'playable');
const paths = ['/arcade/', ...games.map(g => '/arcade/' + g.id + '/')];
const types = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let path = new URL(req.url, 'http://localhost').pathname;
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root.replace(/\/$/, '') + sep)) throw Error('outside root');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
let browser;
const results = [];
const decodeImages = page => page.locator('img').evaluateAll(async images => {
  await Promise.all(images.map(async i => { i.loading = 'eager'; await i.decode(); }));
});
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  for (const width of [320, 390, 700, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const missing = [], external = [];
    page.on('response', r => { if (r.status() >= 400) missing.push(r.url()); });
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    for (const path of paths) {
      const response = await page.goto(origin + path);
      assert.equal(response.status(), 200);
      await decodeImages(page);
      const detail = path !== '/arcade/';
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        h1: document.querySelectorAll('h1').length,
        lang: document.documentElement.lang,
        images: [...document.images].map(i => ({ w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, loaded: i.naturalWidth > 0 })),
        columns: getComputedStyle(document.querySelector('.cards, .detail')).gridTemplateColumns.split(' ').length,
        canonical: document.querySelector('[rel=canonical]').href,
        ld: JSON.parse(document.querySelector('[type="application/ld+json"]').textContent)
      }));
      assert.equal(metrics.overflow, false, `${width} ${path}: overflow`);
      assert.equal(metrics.h1, 1); assert.equal(metrics.lang, 'ko');
      assert.equal(metrics.canonical, 'https://inhagame.app' + path);
      assert.equal(metrics.ld['@type'], detail ? 'VideoGame' : 'CollectionPage');
      assert.equal(metrics.columns, width <= 700 ? 1 : 2);
      for (const image of metrics.images) {
        assert.equal(image.loaded, true);
        assert.ok(Math.abs(image.h - image.w / (detail ? 4 / 3 : 16 / 9)) < 1, `${width} ${path}: image ratio`);
      }
      // Real keyboard focus, skip target and backwards traversal; never start a game.
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(':focus').textContent(), '본문으로 이동');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => location.hash), '#main');
      await page.keyboard.press('Tab');
      assert.ok(await page.locator('main a:focus').count(), 'skip moves sequential focus into main');
      assert.equal(await page.locator(':focus').evaluate(a => getComputedStyle(a).outlineStyle), 'solid');
      await page.keyboard.press('Shift+Tab');
      if (detail) {
        const game = games.find(g => path === '/arcade/' + g.id + '/');
        const play = page.getByRole('link', { name: '게임 플레이 ↗' });
        assert.equal(await play.getAttribute('href'), game.playUrl);
        await play.click({ trial: true });
      } else {
        for (const game of games) {
          await page.getByRole('link', { name: game.title + ' 게임 소개 보기', exact: true }).click();
          assert.equal(new URL(page.url()).pathname, '/arcade/' + game.id + '/');
          await page.getByRole('link', { name: '← 다른 게임 살펴보기', exact: true }).click();
          assert.equal(new URL(page.url()).pathname, '/arcade/');
        }
      }
      await decodeImages(page);
      await page.screenshot({ path: resolve(output, (detail ? path.split('/')[2] : 'index') + '-' + width + '.png'), fullPage: true });
      results.push({ width, path, ...metrics });
    }
    // Equivalent CSS viewport of a 1440px desktop at 200% zoom, plus larger text.
    await page.setViewportSize({ width: 720, height: 500 });
    for (const path of paths) {
      await page.goto(origin + path);
      await page.addStyleTag({ content: ':root{font-size:200%}' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '200% text / narrow viewport');
    }
    assert.deepEqual(missing, [], 'all local page resources resolve');
    assert.deepEqual(external, [], 'no external requests during regression');
    await page.close();
  }
  await writeFile(resolve(output, 'metrics.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ status: 'passed', pages: paths.length, widths: [320, 390, 700, 768, 1440], cases: results.length, output }));
} finally {
  await browser?.close();
  if (server.listening) await new Promise(r => server.close(r));
}
