// Exact-head real keyboard/DOM and mobile touch checks. The existing harness blocks off-origin
// traffic and backend calls. Only presentation progress states are injected; no rewards or account.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const output = process.env.QUEST_CONTROLS_OUTPUT || 'test-results/quest-journal-controls';
await mkdir(output, { recursive: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.env.QUEST_CONTROLS_HEAD_SHA) assert.equal(head, process.env.QUEST_CONTROLS_HEAD_SHA);
const paths = ['src/main.js', 'src/quest/quest-journal.js', 'src/quest/quest-runtime.js', 'src/input/input-focus-manager.js', 'styles.css'];
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path,
  createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex')])));
const report = { head, sourceHashes, scope: 'Real production journal, runtime and extracted main Q listener; offline fixture, no world renderer/backend', cases: [], result: 'running' };

async function verify(viewport, mobile) {
  const smoke = await startSmoke({ viewport, contextOptions: { isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 } });
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  const label = mobile ? 'mobile-360' : 'desktop';
  const item = { label, viewport, screenshots: [] };
  report.cases.push(item);
  const snapshot = () => page.evaluate(() => window.__QUEST_CONTROLS__.snapshot());
  const expectHidden = async () => assert.equal(await page.locator('#journal').isVisible(), false, 'closed journal is visually hidden');
  const expectFocus = async selector => assert.equal(await page.locator(selector).evaluate(el => el === document.activeElement), true, selector);
  const capture = async name => {
    const file = `${label}-${name}.png`;
    await page.screenshot({ path: `${output}/${file}`, fullPage: false, animations: 'disabled' });
    item.screenshots.push(file);
  };
  const load = async () => {
    await page.goto(`${smoke.origin}/tests/browser/quest-journal-controls-harness.html`);
    await Promise.race([page.waitForFunction(() => Boolean(window.__QUEST_CONTROLS__), null, { timeout: TIMEOUT_MS }), fatal]);
    await page.evaluate(() => document.fonts.ready);
    await expectHidden();
  };
  try {
    await load();
    item.servedSourceHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
      const bytes = await (await fetch(`/${path}`)).arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return [path, [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('')];
    }))), paths);
    assert.deepEqual(item.servedSourceHashes, sourceHashes);
    if (mobile) await page.locator('#opener').tap();
    else await page.keyboard.press('q');
    assert.equal((await snapshot()).open, true);
    assert.equal(await page.locator('#journal').isVisible(), true);
    await expectFocus('.profile-close');
    await capture('open');
    if (mobile) {
      await page.locator('[data-focus-key="tab:SIDE"]').tap();
      await expectFocus('[data-focus-key="tab:SIDE"]');
      await capture('side-tab');
      await page.locator('[data-focus-key="tab:MAIN"]').tap();
      await page.locator('.quest-journal-item:nth-child(2)').tap();
    } else {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expectFocus('[data-focus-key="tab:SIDE"]');
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Enter');
      await expectFocus('[data-focus-key="tab:MAIN"]');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
    }
    await expectFocus('.quest-journal-item:nth-child(2)');
    await page.evaluate(() => window.__QUEST_CONTROLS__.update(3));
    await expectFocus('.quest-journal-item:nth-child(2)');
    await capture('selection-refresh');
    item.layout = await page.locator('#journal').evaluate(panel => {
      const rect = panel.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
        overflow: document.documentElement.scrollWidth > innerWidth,
        viewport: { width: innerWidth, height: innerHeight } };
    });
    assert.ok(item.layout.x >= -1 && item.layout.right <= viewport.width + 1, `${label}: panel fits horizontally`);
    assert.ok(item.layout.y >= -1 && item.layout.bottom <= viewport.height + 1, `${label}: panel fits vertically`);
    assert.equal(item.layout.overflow, false, `${label}: no horizontal page overflow`);
    if (mobile) await page.locator('.profile-close').tap();
    else await page.keyboard.press('q');
    await expectHidden();
    await expectFocus('#opener');

    if (!mobile) {
      for (const [owner, kind] of [['view-settings', 'BLOCKING_UI'], ['npc-dialogue', 'BLOCKING_UI'], ['chat', 'CHAT'], ['room-transition', 'SYSTEM_LOCK']]) {
        await page.evaluate(([owner, kind]) => window.__QUEST_CONTROLS__.block(owner, kind), [owner, kind]);
        await page.keyboard.press('q');
        assert.equal((await snapshot()).open, false, owner);
        await expectHidden();
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true })));
        assert.equal((await snapshot()).open, false, `${owner}: synthetic event`);
      }
      await page.evaluate(() => window.__QUEST_CONTROLS__.block(null));
      await page.locator('#editable').focus();
      await page.keyboard.type('q');
      await expectHidden();
      assert.equal(await page.locator('#editable').inputValue(), 'q');
      await page.locator('#opener').focus();
      await page.keyboard.press('q');
      await page.locator('.quest-journal-item:first-child').focus();
      await page.keyboard.press('Enter');
      const scroll = await page.locator('.quest-journal-list').evaluate(el => { el.scrollTop = 35; return el.scrollTop; });
      assert.ok(scroll > 0, 'fixture provides native list scrolling');
      await page.locator('.quest-journal-primary').focus();
      await page.evaluate(() => window.__QUEST_CONTROLS__.journal.render());
      await expectFocus('.quest-journal-primary');
      assert.equal(await page.locator('.quest-journal-list').evaluate(el => el.scrollTop), scroll);
      item.preservedListScroll = scroll;
      await capture('action-refresh');
      await page.evaluate(() => window.__QUEST_CONTROLS__.update(5, true, true));
      await expectFocus('.profile-close');
      await page.locator('#outside').focus();
      await page.evaluate(() => window.__QUEST_CONTROLS__.journal.render());
      await expectFocus('#outside');
      await page.evaluate(() => window.__QUEST_CONTROLS__.journal.setOpen(false));
      await expectHidden();
      await expectFocus('#outside');
      await page.locator('#opener').focus();
      await page.keyboard.press('q');
      await page.keyboard.press('Escape');
      await expectHidden();
      await expectFocus('#opener');
      await page.evaluate(() => { window.__QUEST_CONTROLS__.combatRuntime.active = true; });
      await page.keyboard.press('q');
      assert.equal((await snapshot()).toggles, 1);
      await expectHidden();
      await page.evaluate(() => window.__QUEST_CONTROLS__.block('view-settings'));
      await page.keyboard.press('q');
      assert.equal((await snapshot()).toggles, 1);
    }
    item.trustedEvents = await page.evaluate(() => window.__QUEST_CONTROLS__.events.filter(event => event.trusted));
    if (mobile) assert.ok(item.trustedEvents.some(event => event.type === 'pointerdown' && event.pointerType === 'touch'));
    else for (const code of ['Tab', 'Enter', 'KeyQ', 'Escape']) {
      assert.ok(item.trustedEvents.some(event => event.type === 'keydown' && event.code === code), `native ${code}`);
    }
    if (!mobile) {
      item.invalidOpeners = [];
      for (const invalid of ['disabled', 'hidden', 'inert', 'removed']) {
        await load();
        await page.keyboard.press('q');
        await page.evaluate(invalid => {
          const opener = document.getElementById('opener');
          if (invalid === 'removed') opener.remove();
          else opener.setAttribute(invalid, '');
        }, invalid);
        await page.locator('.profile-close').click();
        await expectHidden();
        assert.notEqual((await snapshot()).focused, 'opener', invalid);
        item.invalidOpeners.push(invalid);
      }
      await capture('invalid-opener-closed');
    }
    assert.deepEqual(smoke.problems, []);
    item.result = 'pass';
  } catch (error) {
    item.result = 'fail'; item.error = error.stack;
    await capture('failure').catch(() => {});
    throw error;
  } finally {
    await smoke.close();
  }
}
try {
  await verify({ width: 1000, height: 800 }, false);
  await verify({ width: 360, height: 800 }, true);
  report.result = 'pass';
  console.log('PASS: exact-head quest keyboard, focus, scroll, input locks, invalid openers and mobile touch');
} catch (error) {
  report.result = 'fail'; report.error = error.stack;
  throw error;
} finally {
  await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`);
}
