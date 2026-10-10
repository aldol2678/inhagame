// Hosted-browser QA only: real DOM + production cooking modules, in-memory service boundaries.
// No real account, remote RPC, database, production activation, or food-use action.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.resolve(process.env.COOKING_QA_OUTPUT || 'test-results/cooking-candidate');
await mkdir(output, { recursive: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const expectedHead = process.env.EXPECTED_COOKING_HEAD;
const report = { head, expectedHead, status: 'RUNNING',
  scope: 'Synthetic offline boundary with real cooking feature/client/panel; no live account or DB; production availability remains false',
  sourceHashes: {}, screenshots: [], checks: [], viewports: [] };
const screenshot = async (page, name) => {
  const file = path.join(output, name);
  await page.screenshot({ path: file, fullPage: true });
  const bytes = await readFile(file);
  report.screenshots.push({ file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
};
try {
  assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/, 'EXPECTED_COOKING_HEAD must pin the candidate');
  assert.equal(head, expectedHead, 'browser must test the exact PR head');
  const sources = ['apps/world/src/rooms/cooking-client.js', 'apps/world/src/rooms/cooking-feature.js',
    'apps/world/src/rooms/cooking-panel.js', 'apps/world/src/rooms/furniture-layout.js',
    'apps/world/src/rooms/personal-room-layout.js', 'apps/world/src/player-dimensions.js',
    'apps/world/src/collection/item-catalog.js', 'apps/world/src/main.js', 'apps/world/styles.css',
    'apps/world/dev-server.mjs', 'apps/world/tests/browser/harness.mjs', 'apps/world/tests/browser/harness-source.mjs',
    'apps/world/tests/browser/package.json', 'apps/world/tests/browser/package-lock.json',
    'apps/world/tests/browser/cooking-candidate-fixture.mjs', 'apps/world/tests/browser/cooking-candidate-harness.html',
    'apps/world/tests/browser/cooking-candidate-smoke.mjs', '.github/workflows/cooking-candidate-browser.yml'];
  for (const name of sources) report.sourceHashes[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', ...sources], { cwd: root, stdio: 'pipe' });
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const smoke = await startSmoke({ viewport });
    let page;
    const offOrigin = [];
    try {
      page = await smoke.context.newPage();
      const fatal = smoke.watch(page);
      page.on('request', request => { if (new URL(request.url()).origin !== smoke.origin) offOrigin.push(request.url()); });
      const snapshot = () => page.evaluate(() => window.__COOKING_QA__.snapshot());
      const wait = predicate => Promise.race([page.waitForFunction(predicate, null, { timeout: TIMEOUT_MS }), fatal]);
      const load = async (enabled = true) => {
        await page.goto(`${smoke.origin}/tests/browser/cooking-candidate-harness.html${enabled ? '?synthetic=enabled' : ''}`);
        await wait(() => !!window.__COOKING_QA__);
      };
      const invoke = (method, value) => page.evaluate(({ method, value }) => window.__COOKING_QA__[method](value), { method, value });
      const open = () => page.locator('#open-cooking').click();
      const panel = page.locator('#cooking-panel');
      const button = name => panel.getByRole('button', { name, exact: true });
      const focused = name => page.evaluate(text => document.activeElement?.textContent === text, name);
      const record = async name => { report.checks.push({ viewport: viewport.width, name, snapshot: await snapshot() }); console.log(`PASS ${viewport.width}: ${name}`); };
      const clickDisabled = async locator => {
        assert.equal(await locator.isDisabled(), true);
        const box = await locator.boundingBox(); assert.ok(box);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 });
      };

      await load(false);
      await open();
      let state = await snapshot();
      assert.equal(state.defaultAvailable, false); assert.equal(state.explicitlyEnabled, false);
      assert.equal(state.available, false); assert.equal(state.open, false); assert.equal(state.blocking, false);
      assert.deepEqual(state.attempts, [false]); assert.equal(state.calls.length, 0);
      assert.ok(state.catalog.every(item => item.status === 'COMING_SOON')); assert.equal(state.recipe.foodUseAvailable, false);
      assert.equal(await panel.isVisible(), false);
      await screenshot(page, `${viewport.width}-default-unavailable.png`);
      await record('default availability remains closed without synthetic injection');

      await load(); await open();
      state = await snapshot();
      assert.equal(state.defaultAvailable, false); assert.equal(state.available, true); assert.equal(state.otherAvailable, false);
      assert.equal(await panel.getAttribute('role'), 'dialog'); assert.equal(await panel.getAttribute('aria-modal'), 'true');
      assert.match(await panel.innerText(), /붕어 1개 → 인경호 붕어구이 1개/);
      assert.match(await panel.innerText(), /조리하면 붕어 1개가 소모돼요/);
      assert.match(await panel.innerText(), /지금은 먹거나 전투 효과를 받을 수 없어요/);
      assert.equal(await panel.getByRole('button', { name: /먹기|사용/ }).count(), 0);
      assert.equal(await focused('닫기'), true);
      await page.keyboard.press('Tab'); assert.equal(await focused('붕어구이 만들기'), true);
      await page.keyboard.press('Tab'); assert.equal(await focused('닫기'), true);
      await page.keyboard.press('Shift+Tab'); assert.equal(await focused('붕어구이 만들기'), true);
      await invoke('update'); assert.equal(await focused('붕어구이 만들기'), true);
      await page.keyboard.press('Escape');
      state = await snapshot(); assert.equal(state.open, false); assert.equal(state.blocking, false);
      assert.equal(state.worldEvents.escape, 0); assert.equal(await page.locator('#open-cooking').evaluate(el => el === document.activeElement), true);
      await open();
      const pointerBefore = (await snapshot()).worldEvents.pointerdown;
      await button('닫기').click();
      assert.equal((await snapshot()).worldEvents.pointerdown, pointerBefore, 'panel pointer must not reach world');
      assert.equal(await page.locator('#open-cooking').evaluate(el => el === document.activeElement), true);
      await open();
      await page.locator('.furniture-editor-backdrop').click({ position: { x: 2, y: 2 } });
      assert.equal((await snapshot()).open, false); assert.equal((await snapshot()).blocking, false);
      await record('native Escape, close, backdrop, focus restoration and Tab containment');

      await open(); await invoke('queueCook', 'ambiguous');
      await button('붕어구이 만들기').click();
      await wait(() => window.__COOKING_QA__.snapshot().state.error === 'UNAVAILABLE');
      state = await snapshot();
      const requestId = state.state.retryId;
      const originalReceipt = state.committedReceipts[0];
      assert.match(requestId, /^[a-f0-9-]{36}$/); assert.equal(state.calls.length, 1);
      assert.equal(state.commits, 1); assert.deepEqual(state.serverQuantities, { carp: 1, grilled: 1 });
      assert.equal(originalReceipt.requestId, requestId);
      assert.deepEqual(state.inventory.quantities, { carp: 2, grilled: 0 }, 'receipt does not overwrite canonical Inventory');
      assert.match(await panel.innerText(), /같은 요청으로 안전하게/);
      await screenshot(page, `${viewport.width}-ambiguous-retry.png`);
      await invoke('queueCook', 'hold'); await invoke('queueRead', 'failure');
      await button('같은 요청 다시 확인').click();
      await wait(() => window.__COOKING_QA__.snapshot().heldCooks === 1);
      await clickDisabled(button('같은 요청 다시 확인'));
      assert.equal((await snapshot()).calls.length, 2);
      await button('닫기').click(); await open();
      assert.equal((await snapshot()).state.retryId, requestId);
      assert.equal(await button('같은 요청 다시 확인').isDisabled(), true);
      await invoke('releaseCook', 'success');
      await wait(() => { const s = window.__COOKING_QA__.snapshot().state; return !s.pending && s.inventoryStatus === 'UNAVAILABLE'; });
      state = await snapshot();
      assert.deepEqual(state.calls[0].args, state.calls[1].args, 'ambiguous retry preserves exact request identity');
      assert.equal(state.commits, 1); assert.equal(state.state.receipt.status, 'SUCCESS');
      assert.equal(state.state.receipt.inventory.status, 'SUCCESS');
      assert.deepEqual(state.state.receipt, originalReceipt, 'retry returns every field of the original frozen receipt unchanged');
      assert.deepEqual(state.committedReceipts, [originalReceipt], 'replay must neither replace nor add a committed receipt');
      assert.equal(state.state.retryId, null); assert.equal(state.state.error, null); assert.equal(state.reads.length, 1);
      assert.match(await panel.innerText(), /붕어구이 1개를 만들었어요/);
      assert.match(await panel.innerText(), /보유 수량만 다시 확인해 주세요/);
      await clickDisabled(button('붕어구이 만들기'));
      assert.equal((await snapshot()).calls.length, 2);
      await button('닫기').click(); await open();
      assert.equal(await button('붕어구이 만들기').isDisabled(), true);
      await screenshot(page, `${viewport.width}-success-inventory-unavailable.png`);
      await record('ambiguous same-request replay commits once and preserves success while Inventory is unavailable');

      await invoke('queueRead', 'hold'); await button('보유 수량만 다시 확인').click();
      await wait(() => window.__COOKING_QA__.snapshot().state.inventoryStatus === 'CHECKING');
      await clickDisabled(button('보유 수량만 다시 확인')); await clickDisabled(button('붕어구이 만들기'));
      assert.equal((await snapshot()).reads.length, 2); assert.equal((await snapshot()).calls.length, 2);
      await invoke('releaseRead', 'failure');
      await wait(() => window.__COOKING_QA__.snapshot().state.inventoryStatus === 'UNAVAILABLE');
      await invoke('queueRead', 'success'); await button('보유 수량만 다시 확인').click();
      await wait(() => window.__COOKING_QA__.snapshot().state.inventoryStatus === 'READY');
      state = await snapshot();
      assert.equal(state.calls.length, 2); assert.equal(state.commits, 1); assert.equal(state.reads.length, 3);
      assert.equal(state.state.receipt.requestId, requestId); assert.equal(state.state.retryId, null);
      assert.deepEqual(state.inventory.quantities, { carp: 1, grilled: 1 });
      assert.equal(await button('보유 수량만 다시 확인').count(), 0);
      assert.equal(await button('붕어구이 만들기').isDisabled(), false);
      await screenshot(page, `${viewport.width}-inventory-recovered.png`);
      await record('Inventory-only retry is read-only, blocks duplicates and never auto-cooks');
      await button('붕어구이 만들기').click();
      await wait(() => { const s = window.__COOKING_QA__.snapshot(); return s.commits === 2 && !s.state.pending && s.state.inventoryStatus === 'READY'; });
      state = await snapshot();
      assert.equal(state.calls.length, 3); assert.notEqual(state.calls[2].args.p_request_id, requestId);
      assert.deepEqual(state.inventory.quantities, { carp: 0, grilled: 2 });
      assert.deepEqual(state.state.receipt.inventory.entries.map(e => [e.direction, e.quantity]), [['CONSUME', 1], ['GRANT', 1]]);
      await record('only a fresh native click after canonical readback creates the next one-carp operation');

      for (const boundary of ['room', 'account']) for (const phase of ['recipe', 'inventory']) {
        await load(); await open();
        await invoke(phase === 'recipe' ? 'queueCook' : 'queueRead', 'hold');
        await button('붕어구이 만들기').click();
        await wait(phase === 'recipe'
          ? () => window.__COOKING_QA__.snapshot().heldCooks === 1
          : () => window.__COOKING_QA__.snapshot().heldReads === 1);
        await invoke('changeScope', boundary);
        state = await snapshot();
        assert.equal(state.open, false); assert.equal(state.blocking, false);
        assert.equal(state.state.receipt, null); assert.equal(state.state.retryId, null);
        await invoke(phase === 'recipe' ? 'releaseCook' : 'releaseRead', 'success');
        await wait(phase === 'recipe'
          ? () => window.__COOKING_QA__.snapshot().completedCooks === 1
          : () => window.__COOKING_QA__.snapshot().completedReads === 1);
        // Reopen through the real handler to prove the old completion cannot paint a new scope.
        await open(); state = await snapshot();
        assert.equal(state.state.receipt, null); assert.equal(state.state.retryId, null);
        assert.equal(state.state.inventoryStatus, 'IDLE'); assert.equal(state.state.pending, false);
        assert.equal(state.state.inventoryReading, false); assert.equal(state.state.accountId, state.actor);
        assert.equal(state.state.roomId, state.room.roomId); assert.equal(state.calls.length, 1);
        assert.equal(state.reads.length, phase === 'recipe' ? 0 : 1);
        assert.equal(await button('붕어구이 만들기').isDisabled(), false);
        assert.doesNotMatch(await panel.innerText(), /만들었어요/);
        await screenshot(page, `${viewport.width}-${boundary}-${phase}-stale.png`);
        await record(`${boundary} change invalidates delayed ${phase} completion and closes modal`);
      }

      for (const [name, patch] of [['visitor', { role: 'visitor' }], ['no saved station', { objects: [] }],
        ['unsaved edit', { editing: true }], ['transition', { busy: true }], ['unready room', { ready: false }],
        ['campus', { space: 'CAMPUS' }], ['another owner', { ownerUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]]) {
        await load(); await open(); await invoke('patchRoom', patch);
        assert.equal((await snapshot()).open, false); assert.equal((await snapshot()).blocking, false);
        await open(); state = await snapshot();
        assert.equal(state.available, false); assert.equal(state.open, false); assert.equal(state.calls.length, 0);
        await record(`${name} closes the panel and refuses native reopen`);
      }
      assert.deepEqual(offOrigin, [], 'fixture must not request any external origin');
      assert.deepEqual(smoke.problems, []);
      report.viewports.push({ ...viewport, status: 'PASS', problems: [...smoke.problems], offOrigin });
    } catch (error) {
      if (page && !page.isClosed()) await screenshot(page, `${viewport.width}-failure.png`).catch(() => {});
      report.viewports.push({ ...viewport, status: 'FAIL', problems: [...smoke.problems], offOrigin });
      throw error;
    } finally { await smoke.close(); }
  }
  report.status = 'PASS';
  console.log(`Cooking candidate browser QA PASS at ${head}`);
} catch (error) { report.status = 'FAIL'; report.error = error.stack ?? String(error); throw error; }
finally { await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); }
