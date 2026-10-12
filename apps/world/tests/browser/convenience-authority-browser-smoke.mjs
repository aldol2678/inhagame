import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const output = process.env.CONVENIENCE_AUTHORITY_BROWSER_OUTPUT || 'test-results/income-game-entry-browser/convenience-authority';
await mkdir(output, { recursive: true });
const sources = ['src/player-controller.js', 'src/income/convenience-authority-runtime.mjs',
  'src/income/convenience-authority-client.mjs', 'src/income/convenience-job-client.mjs',
  'src/income/convenience-job-state.mjs', 'src/income/convenience-job-panel.mjs',
  'src/income/income-client-adapter.mjs', 'src/income/income-catalog.mjs', 'styles.css',
  'tests/browser/convenience-authority-browser.html', 'tests/browser/convenience-authority-browser.mjs',
  'tests/browser/convenience-authority-browser-smoke.mjs'];
const report = { kind: 'ACTUAL_MODULE_RENDER_SYNTHETIC_HTTP', fullMainBoot: false,
  realDatabase: false, realAuthentication: false, productionPaymentEvidence: false,
  syntheticFixture: 'Playwright fulfills native same-origin HTTP fetches. Test-only bearer, sessions, positions, work state and receipt. No real Auth, service, database or wallet is contacted.',
  lifecycleEvidence: 'Persisted PageTransitionEvents are synthetic, not proof of real BFCache restoration.',
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  expectedHead: process.env.EXPECTED_INCOME_GAME_HEAD ?? null,
  hashes: Object.fromEntries(await Promise.all(sources.map(async p => [p, createHash('sha256').update(await readFile(new URL(`../../${p}`, import.meta.url))).digest('hex')]))),
  cases: [], result: 'running' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function syntheticServer() {
  let state, openCount = 0, revision = null, settled = false, nextGate = null;
  const requests = [], gates = [];
  const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const steps = [
    ['stock', '상품을 확인해 진열하세요.', '유통기한과 수량을 확인해 진열'],
    ['checkout', '상품을 계산하고 포장하세요.', '품목과 수량을 확인해 계산'],
    ['tidy', '진열대를 정리하세요.', '정리하고 마무리 확인']
  ];
  const status = () => ({ enabled: true, questId: 'quest.side.convenience_help', coin: 30,
    sessionId: revision === null ? null : sessionId, revision,
    state: revision === null ? null : settled ? 'SETTLED' : revision === 3 ? 'READY_TO_SETTLE' : 'ACTIVE',
    nextChallenge: revision !== null && revision < 3 ? { id: `${sessionId}:${revision}`, action: steps[revision][0],
      prompt: steps[revision][1], choices: [{ id: 'correct', label: steps[revision][2] }, { id: 'wrong', label: '확인하지 않고 건너뛰기' }] } : null,
    receipt: settled ? { committed: true, sessionId, settlementId: 'synthetic-receipt-only', coin: 30 } : null,
    budget: { remainingCoin: settled ? 30 : 60, remainingShifts: settled ? 0 : 1, budgetDate: '2026-10-12' } });
  return {
    requests,
    hold(op, predicate = () => true) {
      assert.equal(nextGate, null); const gate = { op, predicate, seen: deferred(), release: deferred() };
      gates.push(gate); nextGate = gate; return gate;
    },
    releaseAll() { for (const gate of gates) gate.release.resolve(); },
    async handle(route) {
      const request = route.request(), body = request.postDataJSON();
      assert.equal(request.method(), 'POST'); assert.equal(request.headers().authorization, 'Bearer synthetic.browser.fixture.not.real');
      const record = { body, method: request.method(), path: new URL(request.url()).pathname }; requests.push(record);
      let reply;
      if (body.op === 'open') {
        openCount++; state = { active: true, sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fence: openCount, eligible: true,
          state: { sequence: 0, revision: 1, position: { x: 120, y: 1.15, z: 45 }, lastCommand: { sequence: 0, moveX: 0, moveZ: 0 } } };
        reply = state;
      } else if (body.op === 'move') {
        assert.ok(state); assert.equal(body.authoritySessionId, state.sessionId); assert.equal(body.fence, state.fence);
        state = { ...state, state: { sequence: body.command.sequence, revision: state.state.revision + 1,
          position: { x: state.state.position.x + body.command.moveX * .6, y: 1.15, z: state.state.position.z + body.command.moveZ * .6 }, lastCommand: { ...body.command } } };
        reply = state;
      } else if (body.op === 'status') reply = status();
      else if (body.op === 'revoke') reply = { revoked: true };
      else if (body.op === 'start') { revision = 0; settled = false; reply = { accepted: true }; }
      else if (body.op === 'step') { assert.equal(body.choiceId, 'correct'); assert.equal(body.revision, revision); revision++; reply = { accepted: true }; }
      else if (body.op === 'complete') { assert.equal(revision, 3); settled = true; reply = { accepted: true }; }
      else throw Error(`Unexpected fixture operation ${body.op}`);
      const response = JSON.stringify(reply);
      if (nextGate?.op === body.op && nextGate.predicate(body)) {
        const gate = nextGate; nextGate = null; gate.seen.resolve(record); await gate.release.promise;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: response });
    }
  };
}
let harness;
try {
  if (report.expectedHead) {
    assert.match(report.expectedHead, /^[0-9a-f]{40}$/); assert.equal(report.head, report.expectedHead);
    assert.equal(execFileSync('git', ['status', '--porcelain', '--', ...sources.map(p => `apps/world/${p}`)], { encoding: 'utf8' }).trim(), '');
  }
  const { startSmoke } = await import('./harness.mjs');
  for (const device of [{ name: 'desktop', viewport: { width: 1280, height: 800 }, mobile: false }, { name: 'touch', viewport: { width: 390, height: 844 }, mobile: true }]) {
    const item = { device: device.name, checks: [], result: 'running' }; report.cases.push(item);
    harness = await startSmoke({ viewport: device.viewport, contextOptions: { isMobile: device.mobile, hasTouch: device.mobile } });
    const server = syntheticServer(), unexpectedApi = [], routeErrors = [];
    await harness.context.route('**/api/**', async route => {
      if (new URL(route.request().url()).pathname !== '/api/world-convenience-authority') {
        unexpectedApi.push(route.request().url()); return route.abort('blockedbyclient');
      }
      try { await server.handle(route); } catch (error) { routeErrors.push(error.stack); await route.abort().catch(() => {}); }
    });
    const page = await harness.context.newPage(); page.setDefaultTimeout(15_000); harness.watch(page);
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    const press = async locator => { if (device.mobile) await locator.tap(); else { await locator.focus(); await page.keyboard.press('Enter'); } };
    const begin = () => page.getByRole('button', { name: '검증 이동 시작 (서버 출발점으로 이동)', exact: true });
    const work = () => page.getByRole('button', { name: '근무·영수증', exact: true });
    const cancel = () => page.getByRole('button', { name: '검증 근무 종료', exact: true });
    const dialog = () => page.getByRole('dialog', { name: '편의점 짧은 근무' });
    const stats = () => page.evaluate(() => window.__CONVENIENCE_AUTHORITY_QA__.stats());
    const waitActive = value => page.waitForFunction(value => window.__CONVENIENCE_AUTHORITY_QA__.stats().active === value, value);
    const open = async () => { await press(begin()); await waitActive(true); };
    const openPanel = async () => { await press(work()); await dialog().waitFor({ state: 'visible' }); };
    const count = op => server.requests.filter(r => r.body.op === op).length;
    const awaitGate = gate => Promise.race([gate.seen.promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('SYNTHETIC_HTTP_GATE_TIMEOUT')), 6000); timer.unref(); })]);
    let cdp;
    const startDirection = async () => {
      if (!device.mobile) { await page.keyboard.down('w'); return; }
      const box = await page.locator('#joystick').boundingBox(); cdp ??= await harness.context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2 + 20, y: box.y + box.height / 2 - 30 }] });
    };
    const stopDirection = async () => { if (device.mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.keyboard.up('w'); };
    try {
      await page.goto(`${harness.origin}/tests/browser/convenience-authority-browser.html`);
      await page.waitForFunction(() => window.__CONVENIENCE_AUTHORITY_QA__?.ready || window.__CONVENIENCE_AUTHORITY_QA__?.error);
      assert.equal(await page.evaluate(() => window.__CONVENIENCE_AUTHORITY_QA__.error ?? null), null);
      await page.waitForFunction(() => window.__CONVENIENCE_AUTHORITY_QA__.stats().phase === 'POSTING');
      item.servedHashes = await page.evaluate(async sources => Object.fromEntries(await Promise.all(sources.map(async p => {
        const bytes = await (await fetch(`/${p}`)).arrayBuffer(), hash = await crypto.subtle.digest('SHA-256', bytes);
        return [p, [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('')];
      }))), sources); assert.deepEqual(item.servedHashes, report.hashes);
      const initial = await stats(); assert.equal(initial.actualEntity, true); assert.equal(initial.actualController, true);
      assert.equal(initial.active, false); assert.equal(count('open'), 0); assert.deepEqual(initial.position, { x: 116, y: 1.15, z: 45 });
      await open(); const started = await stats(); assert.equal(started.walker, true);
      assert.deepEqual(started.position, { x: 120, y: 1.15, z: 45 }); assert.deepEqual(started.transportLocks, ['convenience-authority']);
      item.pixels = await page.evaluate(() => window.__CONVENIENCE_AUTHORITY_QA__.pixels());
      assert.ok(item.pixels.foreground > 300); assert.equal(item.pixels.glError, 0); assert.equal(item.pixels.renderer, 'webgl2');
      await page.screenshot({ path: `${output}/${device.name}-authority-start.png` });
      item.checks.push('Trusted start button opens native HTTP request and applies snapshot to actual PlayCanvas Entity / PlayerController; WebGL2 pixels present');

      const moveGate = server.hold('move', body => Math.hypot(body.command.moveX, body.command.moveZ) > .1);
      await startDirection(); const move = await awaitGate(moveGate), held = await stats();
      assert.deepEqual(await page.evaluate(() => window.__CONVENIENCE_AUTHORITY_QA__.frame(10)), held.position, 'no local prediction/gravity while HTTP acknowledgement is held');
      assert.ok(Math.hypot(move.body.command.moveX, move.body.command.moveZ) <= 1 + Number.EPSILON);
      moveGate.release.resolve(); await stopDirection();
      await page.waitForFunction(sequence => window.__CONVENIENCE_AUTHORITY_QA__.stats().snapshot?.state.sequence >= sequence, move.body.command.sequence);
      assert.notDeepEqual((await stats()).position, held.position);
      const acknowledged = await stats(); assert.deepEqual(acknowledged.position, acknowledged.snapshot.state.position);
      item.checks.push(`${device.mobile ? 'Trusted touch joystick' : 'Trusted W key'} drives direction-only commands; transform changes only after acknowledged snapshot`);

      await openPanel(); assert.equal((await stats()).leases.active, 1); assert.equal((await stats()).inputEnabled, false);
      await dialog().getByRole('button', { name: '닫기', exact: true }).focus(); await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog().getByRole('button', { name: '출근하기', exact: true }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Tab'); assert.equal(await dialog().getByRole('button', { name: '닫기', exact: true }).evaluate(el => el === document.activeElement), true);
      await press(dialog().getByRole('button', { name: '출근하기', exact: true }));
      for (let step = 0; step < 3; step++) {
        await page.waitForFunction(step => window.__CONVENIENCE_AUTHORITY_QA__.runtime.job.state().snapshot?.session?.revision === step && !window.__CONVENIENCE_AUTHORITY_QA__.runtime.job.state().pending, step);
        const choices = dialog().getByRole('group', { name: '업무 방법 선택' }).getByRole('button');
        await press(choices.first()); assert.equal(await choices.first().getAttribute('aria-pressed'), 'true');
        if (step === 0) await page.screenshot({ path: `${output}/${device.name}-work-panel.png` });
        await press(dialog().getByRole('button', { name: '선택한 방법으로 진행', exact: true }));
      }
      await press(dialog().getByRole('button', { name: '퇴근 정산 요청', exact: true }));
      await page.waitForFunction(() => window.__CONVENIENCE_AUTHORITY_QA__.stats().phase === 'CONFIRMED');
      assert.match(await dialog().innerText(), /서버 정산 확인: 30 코인/);
      await page.screenshot({ path: `${output}/${device.name}-synthetic-receipt.png` });
      item.checks.push('Real DOM dialog focus trap, selected choice state, three synthetic work-step readbacks and synthetic receipt render with one input lease');
      if (device.mobile) await press(dialog().getByRole('button', { name: '닫기', exact: true })); else await page.keyboard.press('Escape');
      assert.equal((await stats()).leases.active, 0); assert.equal((await stats()).inputEnabled, true);
      if (!device.mobile) assert.equal(await work().evaluate(el => el === document.activeElement), true, 'Escape restores opener focus');
      await press(cancel()); await waitActive(false); assert.equal((await stats()).walker, false); assert.deepEqual((await stats()).transportLocks, []);
      const stoppedMoves = count('move'); await page.waitForTimeout(260); assert.equal(count('move'), stoppedMoves);
      item.checks.push('Escape/touch close releases input once; cancel revokes and stops polling/authority ownership');

      await open(); await openPanel(); const opensBeforeHide = count('open');
      await page.evaluate(() => window.__CONVENIENCE_AUTHORITY_QA__.persistedHide()); await waitActive(false);
      assert.equal((await stats()).panelOpen, false); assert.equal((await stats()).leases.active, 0);
      await page.evaluate(() => window.__CONVENIENCE_AUTHORITY_QA__.persistedShow()); await page.waitForTimeout(260);
      assert.equal(count('open'), opensBeforeHide); assert.equal((await stats()).active, false);
      item.checks.push('Synthetic persisted pagehide closes panel/releases input; synthetic pageshow does not automatically reopen authority');

      await open(); await openPanel(); await page.evaluate(() => window.__CONVENIENCE_AUTHORITY_QA__.account('synthetic-account-b'));
      await waitActive(false); assert.equal((await stats()).panelOpen, false); assert.equal((await stats()).leases.active, 0);
      assert.equal((await stats()).accountId, 'synthetic-account-b');
      item.checks.push('Synthetic account-provider transition closes authority/dialog and clears its input lease');

      await open(); const staleMove = server.hold('move', body => Math.hypot(body.command.moveX, body.command.moveZ) > .1);
      await startDirection(); await awaitGate(staleMove); const beforeCancel = (await stats()).position;
      await stopDirection(); await press(cancel()); await waitActive(false); staleMove.release.resolve(); await page.waitForTimeout(150);
      assert.deepEqual((await stats()).position, beforeCancel); assert.equal((await stats()).walker, false);
      item.checks.push('Delayed HTTP movement acknowledgement after trusted cancel cannot apply an old transform or restore walker');

      await open(); const staleStatus = server.hold('status'); await press(work()); await awaitGate(staleStatus);
      await press(cancel()); await waitActive(false); staleStatus.release.resolve(); await page.waitForTimeout(150);
      assert.equal((await stats()).panelOpen, false); assert.equal((await stats()).leases.active, 0);
      item.checks.push('Delayed work status after trusted cancel cannot reopen dialog or reacquire input');
      const staleOpen = server.hold('open'); await press(begin()); await awaitGate(staleOpen);
      assert.equal(await begin().isDisabled(), true); const beforeAccount = (await stats()).position;
      await page.evaluate(() => window.__CONVENIENCE_AUTHORITY_QA__.account('synthetic-account-c'));
      staleOpen.release.resolve(); await page.waitForFunction(() => !document.querySelector('.convenience-authority-candidate button').disabled);
      assert.equal((await stats()).active, false); assert.equal((await stats()).walker, false); assert.deepEqual((await stats()).position, beforeAccount);
      item.checks.push('Delayed open after synthetic account change cannot teleport or restore authority');

      for (const { body } of server.requests) {
        for (const forbidden of ['actor', 'userId', 'accountId', 'position', 'pose', 'dt', 'now', 'timestamp']) assert.equal(forbidden in body, false, forbidden);
        if (body.op === 'move') { assert.deepEqual(Object.keys(body.command).sort(), ['moveX', 'moveZ', 'sequence']); assert.ok(Math.hypot(body.command.moveX, body.command.moveZ) <= 1 + Number.EPSILON); }
        if (['start', 'step', 'complete'].includes(body.op)) { assert.ok(body.authoritySessionId); assert.ok(body.fence > 0); }
      }
      assert.equal(count('start'), 1); assert.equal(count('step'), 3); assert.equal(count('complete'), 1);
      item.trustedEvents = await page.evaluate(() => window.__CONVENIENCE_AUTHORITY_QA__.events.filter(event => event.trusted));
      assert.ok(item.trustedEvents.some(event => device.mobile ? event.pointerType === 'touch' : event.code === 'KeyW'));
      assert.equal((await stats()).leases.acquired, (await stats()).leases.released);
      assert.deepEqual(unexpectedApi, []); assert.deepEqual(routeErrors, []); assert.deepEqual(pageErrors, []); assert.deepEqual(harness.problems, []);
      item.result = 'pass';
    } catch (error) { item.result = 'fail'; item.error = error.stack; await page.screenshot({ path: `${output}/${device.name}-failure.png` }).catch(() => {}); throw error; }
    finally { server.releaseAll(); item.requests = server.requests; item.pageErrors = pageErrors; item.routeErrors = routeErrors; await harness.close(); harness = null; }
  }
  report.result = 'pass'; console.log('PASS: actual convenience authority / PlayerController modules, WebGL2 and DOM on desktop + touch; SYNTHETIC HTTP ONLY, not full-main/Auth/Postgres/payment evidence');
} catch (error) {
  report.result = report.cases.some(item => item.result === 'fail') ? 'fail' : 'blocked';
  for (const item of report.cases) if (item.result === 'running') { item.result = 'blocked'; item.error = error.stack; }
  report.error = error.stack; throw error;
}
finally { await harness?.close(); await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`); }
