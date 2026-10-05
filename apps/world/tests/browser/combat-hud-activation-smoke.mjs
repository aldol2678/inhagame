// Exact-head native Chromium acceptance, using only the existing offline harness.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { BUILDING5_TRAINING_TARGET } from '../../src/combat/building5-combat-training.js';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Combat browser acceptance requires GitHub Actions');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Combat browser acceptance requires a hosted runner');
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
assert.equal(process.env.WORLD_SMOKE_DISABLE_WEBGPU, '1');
assert.equal(process.env.WORLD_SMOKE_BROWSER, 'chrome');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(process.env.EXPECTED_COMBAT_HEAD || '', /^[0-9a-f]{40}$/);
assert.equal(head, process.env.EXPECTED_COMBAT_HEAD, 'Browser evidence must match the requested PR head');
const { startSmoke, TIMEOUT_MS } = await import('./harness.mjs');
const output = resolve(process.env.COMBAT_QA_OUTPUT || 'test-results/combat-input');
await mkdir(output, { recursive: true });
const report = { head, status: 'RUNNING', cases: [], screenshots: [],
  scope: 'Native Chromium input in real source modules, followed by full offline Campus HUD rendering',
  limits: ['Touch is native browser emulation, not a physical device',
    'DOM click models assistive activation; no screen-reader claim', 'Screenshots require independent visual review'] };
const shot = async (page, name) => {
  const file = resolve(output, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  report.screenshots.push({ name: `${name}.png`, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
};
try {
  for (const spec of [{ name: 'desktop', viewport: { width: 1280, height: 800 }, mobile: false },
    { name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true }]) {
    let smoke = await startSmoke({ viewport: spec.viewport, contextOptions: { hasTouch: true, isMobile: spec.mobile } });
    let page;
    try {
      page = await smoke.context.newPage();
      let fatal = smoke.watch(page);
      const wait = (fn, arg = null) => Promise.race([page.waitForFunction(fn, arg, { timeout: TIMEOUT_MS }), fatal]);
      const load = async () => {
        await page.goto(`${smoke.origin}/tests/browser/combat-hud-activation-harness.html`);
        await wait(() => window.combatInputAcceptance);
      };
      const snapshot = () => page.evaluate(() => window.combatInputAcceptance.snapshot());
      const activate = async (button, mode) => {
        if (mode === 'mouse') await button.click();
        else if (mode === 'touch') await button.tap();
        else if (mode === 'assistive-click') await button.evaluate(node => node.click());
        else { await button.focus(); await page.keyboard.press(mode); }
      };
      const isolated = state => {
        assert.equal(state.chatOpen, false, 'No accidental chat');
        assert.equal(state.jumpQueued, false, 'No accidental jump');
        assert.equal(state.ascendHeld, false, 'No held Space');
      };
      for (const action of ['basic', 'active_1', 'active_2', 'active_3', 'dodge', 'ultimate']) {
        for (const mode of ['mouse', 'touch', 'Enter', 'NumpadEnter', 'Space', 'assistive-click']) {
          await load();
          const button = page.locator(`[data-combat-action="${action}"]`);
          assert.equal(await button.isEnabled(), true);
          await activate(button, mode);
          const state = await snapshot();
          assert.deepEqual(state.calls, [action], `${action}/${mode}: exactly once`);
          isolated(state);
          if (['mouse', 'touch'].includes(mode)) {
            assert.ok(state.events.some(e => e.type === 'pointerdown' && e.trusted && e.pointerType === mode));
          } else {
            const click = state.events.find(e => e.type === 'click');
            assert.ok(click, `${mode}: a real click default action must occur`);
            assert.equal(click.detail, 0);
            assert.equal(click.trusted, mode !== 'assistive-click');
            if (mode === 'Space') assert.ok(state.events.findIndex(e => e.type === 'keyup') < state.events.indexOf(click));
          }
          report.cases.push({ viewport: spec.name, action, mode, calls: state.calls, events: state.events });
        }
      }
      for (const mode of ['mouse', 'touch', 'Enter', 'Space', 'assistive-click']) {
        await load();
        await page.evaluate(() => window.combatInputAcceptance.defeat());
        await activate(page.locator('[data-combat-reset]'), mode);
        const state = await snapshot();
        assert.equal(state.resets, 1);
        assert.equal(state.state.training.defeated, false);
        isolated(state);
        report.cases.push({ viewport: spec.name, action: 'reset', mode, resets: state.resets, events: state.events });
      }
      for (const key of ['Enter', 'Space']) {
        await load();
        const basic = page.locator('[data-combat-action="basic"]');
        await basic.focus();
        await page.keyboard.down(key);
        assert.equal((await snapshot()).calls.length, key === 'Enter' ? 1 : 0, `${key}: native trigger phase`);
        await page.keyboard.down(key);
        await page.keyboard.up(key);
        const state = await snapshot();
        assert.deepEqual(state.calls, ['basic'], `Held ${key} fires once`);
        isolated(state);
        assert.ok(state.events.some(e => e.repeat && e.defaultPrevented));
        report.cases.push({ viewport: spec.name, action: `held-${key}`, events: state.events });
      }
      await load();
      const basic = page.locator('[data-combat-action="basic"]');
      await basic.focus();
      await page.keyboard.down('Space');
      await page.locator('#chat-toggle').focus();
      await page.keyboard.up('Space');
      assert.deepEqual((await snapshot()).calls, [], 'Blur cancels pending native Space activation');
      report.cases.push({ viewport: spec.name, action: 'Space-focus-cancel', ...(await snapshot()) });
      await basic.focus();
      await page.keyboard.down('Digit1');
      assert.ok((await snapshot()).keys.includes('Digit1'), 'Other physical hotkeys still bubble');
      await page.keyboard.up('Digit1');
      for (const focusClass of ['CHAT', 'BLOCKING_UI', 'SYSTEM_LOCK']) {
        await page.evaluate(value => window.combatInputAcceptance.block(value), focusClass);
        assert.equal(await basic.isDisabled(), true);
        await basic.dispatchEvent('pointerdown', { button: 0, pointerType: 'touch' });
        await basic.dispatchEvent('click', { detail: 0 });
        assert.deepEqual((await snapshot()).calls, [], 'Blocked retained callbacks never dispatch');
        assert.equal(await page.evaluate(() => window.combatInputAcceptance.release()), true);
        report.cases.push({ viewport: spec.name, action: 'focus-lock', focusClass, dispatches: 0 });
      }
      await basic.evaluate(node => { node.disabled = true; node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); });
      assert.deepEqual((await snapshot()).calls, [], 'Native disabled guard rejects retained click');
      await load();
      const cdp = await smoke.context.newCDPSession(page);
      const box = await basic.boundingBox();
      const point = { id: 1, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      assert.deepEqual((await snapshot()).calls, ['basic'], 'Touch action is immediate on press');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      let state = await snapshot();
      assert.deepEqual(state.calls, ['basic'], 'Cancel cannot dispatch another action');
      assert.ok(state.events.some(e => e.type === 'pointercancel' && e.trusted));
      await basic.tap();
      state = await snapshot();
      assert.deepEqual(state.calls, ['basic', 'basic'], 'A fresh gesture works after cancel');
      report.cases.push({ viewport: spec.name, action: 'native-touch-cancel-recovery', events: state.events });
      await cdp.detach();
      await page.evaluate(() => window.combatInputAcceptance.destroy());
      await basic.evaluate(node => node.click());
      assert.deepEqual((await snapshot()).calls, ['basic', 'basic']);
      report.cases.push({ viewport: spec.name, action: 'destroy', retainedDispatches: 0 });

      assert.deepEqual(smoke.problems, []);
      await smoke.close();
      // A touch-enabled desktop fixture cannot prove fine-pointer desktop CSS.
      smoke = await startSmoke({ viewport: spec.viewport, contextOptions: { hasTouch: spec.mobile, isMobile: spec.mobile } });
      page = await smoke.context.newPage();
      fatal = smoke.watch(page);
      assert.equal(await page.evaluate(() => matchMedia('(pointer: fine)').matches), !spec.mobile);

      // Actual Campus rendering and actual shared gameplay handlers, with only
      // the training start/position prepared locally through the existing debug API.
      await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded' });
      await wait(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished);
      assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer), 'WebGL2');
      await page.evaluate(target => {
        const d = window.__INHAGAME_P0__;
        const y = d.controller.groundY + d.controller.space.groundHeight(target.x, target.z + 6);
        d.player.setLocalPosition(target.x, y, target.z + 6);
        d.controller.velocityY = 0;
        d.controller.jumpQueued = false;
        d.combatRuntime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' });
        d.combatRuntime.gainUltimate(100);
      }, BUILDING5_TRAINING_TARGET);
      await wait(() => window.__INHAGAME_P0__.controller.grounded && document.body.dataset.hudMode === 'COMBAT');
      await page.evaluate(() => new Promise(resolve => {
        const app = window.__INHAGAME_P0__.app;
        app.once('postrender', () => app.once('postrender', resolve));
      }));
      const campusBasic = page.locator('[data-combat-action="basic"]');
      await campusBasic.focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.combatAction), 'active_1', 'Actual HUD is tabbable');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.combatAction), 'basic');
      const before = await page.evaluate(() => ({ serial: window.__INHAGAME_P0__.combatRuntime.snapshot().actionSerial,
        y: window.__INHAGAME_P0__.player.getLocalPosition().y }));
      for (const key of ['Enter', 'Space']) await page.keyboard.press(key);
      await (spec.mobile ? campusBasic.tap() : campusBasic.click());
      const after = await page.evaluate(() => {
        const d = window.__INHAGAME_P0__;
        return { serial: d.combatRuntime.snapshot().actionSerial, y: d.player.getLocalPosition().y,
          chatOpen: d.chatPanel.open, jumpQueued: d.controller.jumpQueued, ascendHeld: d.controller.ascendHeld,
          renderer: d.getStatus().renderer, combat: d.combatRuntime.snapshot(), focus: d.getStatus().inputFocus };
      });
      assert.equal(after.serial, before.serial + 3);
      assert.equal(after.chatOpen, false);
      assert.equal(after.jumpQueued, false);
      assert.equal(after.ascendHeld, false);
      assert.ok(Math.abs(after.y - before.y) < .15, 'Space activation does not launch the player');
      await campusBasic.focus();
      await shot(page, `${spec.name}-campus-combat-focused`);
      report.cases.push({ viewport: spec.name, action: 'actual-campus-HUD', before, after });
      assert.deepEqual(smoke.problems, []);
    } catch (error) {
      if (page) await shot(page, `${spec.name}-failure`).catch(() => {});
      throw error;
    } finally { await smoke.close(); }
  }
  report.status = 'PASS';
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = 'FAIL';
  report.error = error.stack || String(error);
  throw error;
} finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
