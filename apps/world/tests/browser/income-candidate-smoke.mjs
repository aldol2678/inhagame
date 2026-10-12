// Exact-head browser evidence for a fully isolated synthetic income RPC pipeline.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const output = process.env.INCOME_BROWSER_OUTPUT || 'test-results/income-candidate-browser';
const paths = ['src/income/convenience-job-state.mjs', 'src/income/convenience-job-client.mjs',
  'src/income/convenience-job-panel.mjs', 'src/income/income-client-adapter.mjs', 'src/income/income-catalog.mjs',
  'server/income-service.mjs', 'server/income-candidate-http.mjs',
  'src/income/income-candidate-runtime.mjs', 'src/income/income-http-client.mjs',
  'src/income/delivery-income-client.mjs', 'src/income/delivery-income-panel.mjs', 'styles.css', 'tests/browser/income-candidate-fixture.html', 'tests/browser/income-candidate-fixture.mjs'];
await mkdir(output, { recursive: true });
const report = { kind: 'SYNTHETIC_CANDIDATE_ONLY', productionEvidence: false,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  expectedHead: process.env.EXPECTED_INCOME_HEAD || null,
  sourceHashes: Object.fromEntries(await Promise.all(paths.map(async p => [p, createHash('sha256').update(await readFile(path.join(root, p))).digest('hex')]))),
  cases: [], result: 'running' };
let browser, server, launched = false;
try {
  if (report.expectedHead) {
    assert.match(report.expectedHead, /^[0-9a-f]{40}$/); assert.equal(report.head, report.expectedHead);
    assert.equal(execFileSync('git', ['status', '--porcelain', '--', ...paths.map(p => `apps/world/${p}`)], { encoding: 'utf8' }).trim(), '', 'exact-head source must be clean');
  }
  const { chromium } = await import('playwright'); launched = true;
  browser = await chromium.launch({ headless: true, ...(process.env.INCOME_BROWSER_EXECUTABLE ? { executablePath: process.env.INCOME_BROWSER_EXECUTABLE } : {}) });
  report.browserVersion = browser.version();
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(`${root}${path.sep}`) || url.pathname.startsWith('/api/') || req.method !== 'GET') { res.writeHead(403).end(); return; }
      const body = await readFile(file); const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': ['.js', '.mjs'].includes(ext) ? 'text/javascript' : ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const device of [{ label: 'desktop-keyboard', viewport: { width: 1280, height: 900 }, mobile: false },
    { label: 'mobile-touch', viewport: { width: 390, height: 844 }, mobile: true }]) {
    const item = { ...device, checks: [], result: 'running' }; report.cases.push(item);
    const context = await browser.newContext({ viewport: device.viewport, isMobile: device.mobile, hasTouch: device.mobile, serviceWorkers: 'block' });
    const blocked = [], errors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
      blocked.push(url.href); return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const button = key => page.locator(`[data-focus-key="${key}"]`);
    const press = async locator => { if (device.mobile) await locator.tap(); else { await locator.focus(); await page.keyboard.press('Enter'); } };
    const idle = () => page.waitForFunction(() => window.__INCOME_FIXTURE__ && !window.__INCOME_FIXTURE__.state().pending && !window.__INCOME_FIXTURE__.delivery.state().pending);
    const phase = value => page.waitForFunction(v => window.__INCOME_FIXTURE__.state().phase === v && !window.__INCOME_FIXTURE__.state().pending, value);
    const scenario = async name => { await page.evaluate(n => window.__INCOME_FIXTURE__.scenario(n), name); await press(page.locator('#opener')); await idle(); };
    try {
      await page.goto(`${origin}/tests/browser/income-candidate-fixture.html`); await idle();
      item.servedSourceHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async p => {
        const bytes = await (await fetch(`/${p}`)).arrayBuffer(), hash = await crypto.subtle.digest('SHA-256', bytes);
        return [p, [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('')];
      }))), paths);
      assert.deepEqual(item.servedSourceHashes, report.sourceHashes);
      await scenario('fresh');
      if (!device.mobile) {
        await button('close').focus(); await page.keyboard.press('Shift+Tab');
        assert.equal(await button('start').evaluate(el => document.activeElement === el), true);
        await page.keyboard.press('Tab'); assert.equal(await button('close').evaluate(el => document.activeElement === el), true);
        item.checks.push('native keyboard focus wraps inside modal');
      } else { const bounds = await button('start').boundingBox(); assert.ok(bounds.height >= 44, 'touch target >= 44px'); }
      assert.match(await page.locator('.convenience-job-panel').innerText(), /남은 공통 정산 한도 60/);
      await press(button('start')); await phase('WORKING');
      await press(button('choice:rushed')); await press(button('submit')); await idle();
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.state().snapshot.session.revision), 0);
      assert.match(await page.locator('.convenience-job-panel').innerText(), /다른 방법/); item.checks.push('wrong choice is correctable; no progress or wage loss');
      await press(button('choice:careful')); await press(button('submit')); await idle();
      await page.evaluate(() => history.pushState({}, '', '#job-panel')); await page.goBack();
      await page.waitForFunction(() => !window.__INCOME_FIXTURE__.ui.open); await press(page.locator('#opener')); await idle();
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.state().snapshot.session.revision), 1); item.checks.push('Back/close retains verified session');
      await page.reload(); await idle(); await press(page.locator('#opener')); await idle();
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.calls.filter(c => c.name !== 'world_income_status_v1').length), 0);
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.state().snapshot.session.revision), 1); item.checks.push('reload only reads and resumes');
      assert.match(await page.locator('.convenience-job-panel').innerText(), /POS/);
      for (let i = 1; i < 3; i++) { await press(button('choice:careful')); await press(button('submit')); await idle(); }
      await phase('CHECKOUT'); await page.evaluate(() => window.__INCOME_FIXTURE__.loseNextFinish());
      await press(button('complete')); await phase('RECOVERY');
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.commits.length), 0);
      assert.doesNotMatch(await page.locator('.convenience-job-panel').innerText(), /서버 정산 확인:/);
      await press(button('refresh')); await phase('CONFIRMED');
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.commits.length), 1);
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.calls.filter(c => c.name === 'world_income_finish_v1').length), 1);
      item.checks.push('lost finish plus lost status: read-only recovery, one receipt, no resend');
      await page.screenshot({ path: `${output}/${device.label}-confirmed.png` });
      if (!device.mobile) { await page.keyboard.press('Escape'); assert.equal(await page.locator('#opener').evaluate(el => document.activeElement === el), true); }
      else await press(button('close'));
      await scenario('checkout'); await page.evaluate(() => window.__INCOME_FIXTURE__.holdNext('world_income_finish_v1'));
      await press(button('complete')); await page.waitForFunction(() => window.__INCOME_FIXTURE__.held());
      assert.equal(await button('complete').isDisabled(), true); await button('complete').evaluate(el => el.click());
      await page.evaluate(() => window.__INCOME_FIXTURE__.switchAccount());
      await page.evaluate(() => window.__INCOME_FIXTURE__.release()); await idle();
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.ui.open), false);
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.commits.length), 0);
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.calls.filter(c => c.name === 'world_income_finish_v1').length), 1);
      item.checks.push('duplicate finish blocked; switched account drops old receipt');
      await scenario('dailyLimit'); assert.equal(await button('start').isDisabled(), true); item.checks.push('daily cap and remaining count disable start');
      await scenario('expired'); assert.match(await page.locator('.convenience-job-panel').innerText(), /만료/);
      await press(button('start')); await phase('WORKING'); item.checks.push('expired session permits server-eligible new start');
      await scenario('closedReceipt'); await phase('CONFIRMED'); assert.equal(await button('start').count(), 0);
      assert.match(await page.locator('.convenience-job-panel').innerText(), /서버 정산 확인: 30/); item.checks.push('CLOSED preserves historical receipt but exposes no start');
      await page.screenshot({ path: `${output}/${device.label}-closed-receipt.png` });
      // The real mount's delivery button switches panels; no test-only panel factory is used.
      await page.evaluate(() => window.__INCOME_FIXTURE__.scenario('fresh'));
      await press(page.locator('#opener')); await idle(); await press(button('close'));
      await press(page.locator('#delivery-opener')); await idle();
      const deliveryPanel = page.locator('.delivery-income-panel');
      const deliveryButton = label => deliveryPanel.getByRole('button', { name: label, exact: true });
      assert.equal(await page.locator('.convenience-job-panel').isVisible(), false);
      assert.match(await deliveryPanel.innerText(), /보유 잉어 2개/);
      await press(deliveryButton('의뢰 수락')); await idle();
      assert.match(await deliveryPanel.innerText(), /수락한 의뢰/);
      await press(deliveryButton('잉어 1개 제출')); await idle();
      assert.match(await deliveryPanel.innerText(), /서버 정산 영수증 확인: 20 코인/);
      assert.match(await deliveryPanel.innerText(), /보유 잉어 1개/);
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.deliveryCommits.length), 1);
      item.checks.push('real mount switches job→delivery; accept→owned quantity→submit→receipt with one item consumed');
      await page.screenshot({ path: `${output}/${device.label}-delivery-receipt.png` });
      await page.evaluate(() => window.__INCOME_FIXTURE__.scenario('deliveryInsufficient'));
      await press(page.locator('#delivery-opener')); await idle(); await press(deliveryButton('의뢰 수락')); await idle();
      assert.match(await deliveryPanel.innerText(), /보유 잉어 0개/); assert.equal(await deliveryButton('잉어 1개 제출').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.calls.filter(c => c.name === 'world_income_finish_v1').length), 0);
      item.checks.push('delivery missing material blocks submit without consuming or paying');
      await page.evaluate(() => window.__INCOME_FIXTURE__.scenario('fresh'));
      await press(page.locator('#delivery-opener')); await idle(); await press(deliveryButton('의뢰 수락')); await idle();
      await page.evaluate(() => window.__INCOME_FIXTURE__.loseNextFinish());
      await press(deliveryButton('잉어 1개 제출')); await idle();
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.deliveryCommits.length), 0);
      assert.doesNotMatch(await deliveryPanel.innerText(), /서버 정산 영수증 확인:/);
      await press(deliveryButton('의뢰 기록 다시 확인')); await idle();
      assert.match(await deliveryPanel.innerText(), /서버 정산 영수증 확인: 20 코인/);
      assert.match(await deliveryPanel.innerText(), /보유 잉어 1개/);
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.calls.filter(c => c.name === 'world_income_finish_v1').length), 1);
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.deliveryCommits.length), 1);
      assert.equal(await page.evaluate(() => window.__INCOME_FIXTURE__.httpCalls.every(c => !('accountId' in c.body) && !('coin' in c.body))), true);
      item.checks.push('delivery lost receipt recovers with read-only status, no resubmit and no double consumption');
      item.trustedEvents = await page.evaluate(() => window.__INCOME_FIXTURE__.events.filter(e => e.trusted));
      assert.ok(item.trustedEvents.some(e => device.mobile ? e.pointerType === 'touch' : e.key === 'Enter'));
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []); item.result = 'pass';
    } catch (error) { item.result = 'fail'; item.error = error.stack; await page.screenshot({ path: `${output}/${device.label}-failure.png` }).catch(() => {}); throw error; }
    finally { item.pageErrors = errors; item.blockedRequests = blocked; await context.close(); }
  }
  report.result = 'pass'; console.log('PASS: isolated real candidate mount → both panels → HTTP client → auth handler → mock RPC browser workflow');
} catch (error) { report.result = !browser ? 'blocked' : 'fail'; report.launchAttempted = launched; report.error = error.stack; throw error; }
finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`); }
