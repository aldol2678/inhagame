// PA-G2B-R1 · real campus + real PlayCanvas, offline harness. Drives the shipped Inkyung promenade
// water-path entry exactly as a player does (F key / mobile Context button / Esc / on-screen buttons) on
// PC, mobile portrait and mobile landscape. Position is the only fixture: the player is placed on the
// promenade, every other transition goes through production code.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {startSmoke, TIMEOUT_MS} from './harness.mjs';

const output = process.env.WATER_PATH_QA_OUTPUT || 'test-results/inkyung-water-path';
await mkdir(output, {recursive: true});
const cases = [
  ['desktop', {width: 1280, height: 800}, false],
  ['portrait', {width: 390, height: 844}, true],
  ['landscape', {width: 844, height: 390}, true]
];
const report = {status: 'RUNNING', limits: [
  'Offline guest campus (no account, no server). Headless Chromium; mobile is viewport/touch emulation, not a physical device.',
  'BFCache is exercised by dispatching pagehide/pageshow with persisted=true; the browser history cache itself is not driven.'
], cases: []};
const save = () => writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));

for (const [name, viewport, mobile] of cases) {
  const result = {name, viewport, checks: [], screenshots: []};
  report.cases.push(result);
  await save();
  const smoke = await startSmoke({viewport, contextOptions: {isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1}});
  try {
    const page = await smoke.context.newPage();
    page.setDefaultTimeout(30000);
    const fatal = smoke.watch(page);
    const ok = text => result.checks.push(text);
    const shot = async suffix => {
      const file = `${name}-${suffix}.png`;
      await page.screenshot({path: `${output}/${file}`, timeout: 60000});
      result.screenshots.push(file);
    };
    await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`, {waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS});
    await Promise.race([page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus().loading.finished,
      null, {timeout: 120000}), fatal]);
    assert.notEqual(await page.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer), 'UNAVAILABLE');

    // ---- helpers evaluated in the page (production modules, same URLs as the app) ----
    const place = (dx = 0, dz = 0) => page.evaluate(async ({dx, dz}) => {
      const [{inkyungWaterPathAnchor}, {roadviewGroundHeight}] = await Promise.all([
        import('/src/minigames/world/inkyung-water-path-interaction.js'), import('/src/roadview-layout.js')]);
      const d = window.__INHAGAME_P0__, a = inkyungWaterPathAnchor();
      const x = a.x + dx, z = a.z + dz;
      d.player.setLocalPosition(x, 1.15 + roadviewGroundHeight(x, z), z);
      d.controller.grounded = true; d.controller.velocityY = 0;
      d.app.fire('update', 0);
      return {x, z};
    }, {dx, dz});
    const state = () => page.evaluate(() => {
      const d = window.__INHAGAME_P0__, s = d.getStatus(), p = d.player.getLocalPosition();
      const panel = document.getElementById('water-path-panel');
      return {
        action: s.contextAction, owners: [...s.inputFocus.topOwners], focusClass: s.inputFocus.focusClass,
        inputEnabled: d.controller.inputEnabled, yaw: d.orbit.yaw, x: p.x, z: p.z,
        waterPath: d.inkyungWaterPath.status(),
        panel: panel ? (() => {
          const b = panel.getBoundingClientRect(), root = panel.querySelector('.water-path-t0');
          return {left: b.left, top: b.top, right: b.right, bottom: b.bottom, hidden: panel.hidden,
            overflowX: panel.scrollWidth > panel.clientWidth + 1, text: panel.innerText,
            focusKey: document.activeElement?.getAttribute?.('data-focus-key') ?? null,
            focusInside: !!document.activeElement && panel.contains(document.activeElement),
            rootPresent: !!root};
        })() : null,
        button: (() => { const b = document.getElementById('context-action'); return {hidden: b.hidden, text: b.textContent}; })()
      };
    });
    const released = async label => {
      const s = await state();
      assert.equal(s.panel, null, `${label}: panel removed`);
      assert.deepEqual(s.owners, [], `${label}: no input owner`);
      assert.equal(s.focusClass, 'GAMEPLAY', label);
      assert.equal(s.inputEnabled, true, `${label}: World movement input back`);
      assert.equal(s.waterPath.active, false, label);
      assert.equal(s.waterPath.focusActive, false, label);
      return s;
    };
    const enter = async via => {
      await place();
      let s = await state();
      assert.equal(s.action, 'inkyung-water-path', 'Context Action is published at the Anchor');
      assert.equal(s.button.hidden, false);
      assert.match(s.button.text, /물길/);
      if (via === 'touch') await page.locator('#context-action').tap();
      else { await page.locator('#application').focus(); await page.keyboard.press('f'); }
      await page.waitForFunction(() => !document.getElementById('water-path-panel')?.hidden, null, {timeout: 10000});
      s = await state();
      return s;
    };
    const layout = async label => {
      const s = await state();
      const b = s.panel;
      assert.ok(b && b.left >= 0 && b.top >= 0 && b.right <= viewport.width + 1 && b.bottom <= viewport.height + 1, `${label}: ${JSON.stringify(b)}`);
      assert.equal(b.overflowX, false, `${label}: no horizontal overflow`);
      const tiles = page.locator('#water-path-panel [data-focus-key^="tile-"]');
      for (const index of [0, await tiles.count() - 1]) {
        const box = await tiles.nth(index).boundingBox();
        assert.ok(box.width >= 43 && box.height >= 43, `${label}: touch target ${JSON.stringify(box)}`);
      }
    };

    // ---- 1. Conflicts: nothing else owns the Anchor; far / seat positions never offer the puzzle ----
    await place(6);                       // outside the 1.25 radius
    assert.equal((await state()).action === 'inkyung-water-path', false);
    await place(1.3);
    assert.equal((await state()).action === 'inkyung-water-path', false, 'radius is 1.25 WU');
    await place(1.2);
    assert.equal((await state()).action, 'inkyung-water-path', 'inside radius');
    const seatAction = await page.evaluate(async () => {
      const {SEAT_ANCHORS} = await import('/src/seat-anchors.js');
      const {roadviewGroundHeight} = await import('/src/roadview-layout.js');
      const d = window.__INHAGAME_P0__, seat = SEAT_ANCHORS.find(a => a.id.startsWith('SEAT_INKYUNG_TREE_'));
      d.player.setLocalPosition(seat.position.x, 1.15 + roadviewGroundHeight(seat.position.x, seat.position.z), seat.position.z);
      d.controller.grounded = true; d.app.fire('update', 0);
      return d.getStatus().contextAction;
    });
    assert.equal(seatAction, 'seat', 'seat action keeps its tile');
    ok('Action only inside 1.25 WU of the Anchor; pond seats keep their own action');

    // ---- 2. Enter, block World input, layout ----
    const via = mobile ? 'touch' : 'key';
    const before = await (async () => { await place(); return state(); })();
    let s = await enter(via);
    assert.deepEqual(s.owners, ['inkyung-water-path']);
    assert.equal(s.focusClass, 'BLOCKING_UI');
    assert.equal(s.inputEnabled, false, 'World movement input blocked');
    assert.equal(s.panel.focusInside, true, 'keyboard focus is inside the panel');
    assert.match(s.panel.text, /보상과 저장 없음/);
    await layout('opened');
    await shot('opened');
    await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
    await page.mouse.move(viewport.width / 2, 40); await page.mouse.down(); await page.mouse.move(viewport.width / 2 + 120, 60); await page.mouse.up();
    const held = await state();
    assert.ok(Math.hypot(held.x - before.x, held.z - before.z) < 1e-3, 'player did not move');
    assert.ok(Math.abs(held.yaw - before.yaw) < 1e-6, 'camera did not turn');
    assert.equal(held.panel.focusInside, true, 'a click on the dimmed World hands focus back to the dialog');
    ok(`Opened via ${mobile ? 'mobile Context button tap' : 'F key'}; BLOCKING_UI claimed; movement and camera blocked; layout inside viewport`);

    // ---- 3. Keyboard play, focus kept across rotations ----
    await page.keyboard.press('Enter');                       // focused 시작
    s = await state();
    assert.equal(s.waterPath.panel.status, 'PLAYING');
    assert.match(s.panel.focusKey, /^tile-/);
    const focusKey = s.panel.focusKey;
    await page.keyboard.press('Enter');                       // rotate the focused tile
    s = await state();
    assert.equal(s.panel.focusKey, focusKey, 'focus survives the re-render');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      assert.equal((await state()).panel.focusInside, true, 'Tab never leaves the dialog');
    }
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
    assert.equal((await state()).panel.focusInside, true);
    if (mobile) {
      // Rotate the device: the same session keeps its panel inside the new viewport and keeps focus.
      const turned = {width: viewport.height, height: viewport.width};
      await page.setViewportSize(turned);
      await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
      s = await state();
      assert.equal(s.panel.focusInside, true, 'keyboard focus survives rotation');
      assert.ok(s.panel.right <= turned.width + 1 && s.panel.bottom <= turned.height + 1, 'panel inside the rotated viewport');
      assert.equal(s.waterPath.active, true);
      await shot('rotated');
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
      assert.equal((await state()).panel.focusInside, true);
    }
    ok('Keyboard start/rotate, Tab wrap, arrows; focus kept after re-render' + (mobile ? ' and after device rotation' : ''));

    // ---- 4. Esc ends and restores the World at the same position ----
    await page.keyboard.press('Escape');
    s = await released('Esc');
    assert.equal(s.waterPath.lastEnd.reason, 'ESC');
    assert.ok(Math.hypot(s.x - before.x, s.z - before.z) < 1e-3);
    ok('Esc closes, releases InputFocus and keeps the player position');

    // ---- 5. Cancel button, then success ----
    await enter(via);
    await page.locator('#water-path-panel [data-focus-key="ctl-start"]').click();
    await page.locator('#water-path-panel [data-focus-key="ctl-cancel"]').click();
    s = await released('cancel');
    assert.equal(s.waterPath.lastEnd.reason, 'CANCEL');
    assert.equal(s.waterPath.lastEnd.result, 'CANCELLED');
    await enter(via);
    await page.locator('#water-path-panel [data-focus-key="ctl-start"]').click();
    const plan = await page.evaluate(async () => {
      const [{createWaterPathDefinition, validateWaterPath}, {INKYUNG_WATER_PATH_SEED}] = await Promise.all([
        import('/src/minigames/games/water-path.js'), import('/src/minigames/world/inkyung-water-path-interaction.js')]);
      const {size, tiles} = createWaterPathDefinition({size: 3, seed: INKYUNG_WATER_PATH_SEED}).initialState;
      const cells = tiles.map((t, i) => t.kind === 'BLOCK' ? -1 : i).filter(i => i >= 0), n = new Array(cells.length).fill(0);
      for (;;) {
        const trial = {size, tiles: tiles.map(t => ({...t}))};
        cells.forEach((c, i) => { trial.tiles[c].rotation = (tiles[c].rotation + n[i]) & 3; });
        if (validateWaterPath(trial).cleared) return cells.map((cell, i) => ({key: `tile-${Math.floor(cell / size)}-${cell % size}`, n: n[i]}));
        let i = 0; while (i < n.length && ++n[i] === 4) n[i++] = 0;
        if (i >= n.length) throw new Error('no solution');
      }
    });
    for (const {key, n} of plan) for (let i = 0; i < n; i++) await page.locator(`#water-path-panel [data-focus-key="${key}"]`).click();
    s = await state();
    assert.match(s.panel.text, /물길 연결 성공/);
    await shot('cleared');
    await page.locator('#water-path-panel [data-focus-key="ctl-close"]').click();
    s = await released('success');
    assert.equal(s.waterPath.lastEnd.result, 'CLEARED');
    ok('Cancel and success both end with a local CLEARED/CANCELLED result and release input');

    // ---- 6. Interruptions: drifting away, another SYSTEM_LOCK owner, BFCache ----
    await enter(via);
    await place(6);                                          // region/teleport style displacement
    s = await released('displaced');
    assert.match(s.waterPath.lastEnd.reason, /^INTERRUPTED:TOO_FAR/);
    await enter(via);
    // A production modal (Student Center shop) opening on top ends the puzzle session cleanly.
    await page.evaluate(() => window.__INHAGAME_P0__.shopPanel.setOpen(true));
    s = await state();
    assert.equal(s.waterPath.active, false, 'competing modal ends the session');
    assert.equal(s.waterPath.lastEnd.reason, 'FOCUS_LOST');
    assert.equal(s.panel, null);
    await page.evaluate(() => window.__INHAGAME_P0__.shopPanel.setOpen(false));
    await released('competing modal');
    await enter(via);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true})));
    s = await released('pagehide');
    assert.equal(s.waterPath.lastEnd.reason, 'PAGEHIDE');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
    s = await released('pageshow');
    assert.equal(s.waterPath.panel, null, 'stale session is not revived');
    await place();
    assert.equal((await state()).action, 'inkyung-water-path', 'World input and position are valid after restore');
    ok('Displacement, a competing modal and BFCache pagehide/pageshow all clean up; nothing is revived');

    // ---- 7. No side effects, no page problems ----
    const persisted = await page.evaluate(() => ({
      local: Object.keys(localStorage).filter(k => /water|puzzle/i.test(k)),
      session: Object.keys(sessionStorage).filter(k => /water|puzzle/i.test(k))
    }));
    assert.deepEqual(persisted, {local: [], session: []}, 'no puzzle state persisted');
    assert.deepEqual(smoke.problems, [], smoke.problems.join('\n'));
    ok('No storage writes; zero console/page/request problems');
    result.status = 'PASS';
    await save();
  } catch (error) {
    result.status = 'FAIL';
    result.error = String(error?.stack || error);
    report.status = 'FAIL';
    await save();
    throw error;
  } finally {
    await smoke.close();
  }
}
report.status = 'PASS';
await save();
console.log(`inkyung-water-path-smoke PASS (${cases.length} viewports) → ${output}/report.json`);
