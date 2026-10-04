// GitHub-hosted real Chromium QA. Boots the production campus/PlayCanvas and map
// controller through the existing offline harness; never a Null renderer.
// The backend is disabled. Only the explicitly named state-fixture screenshots
// inject presentation states; ordinary overview/selection/navigation use live UI.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const output = process.env.WORLD_FULL_MAP_QA_OUTPUT || 'test-results/full-map-readability';
await mkdir(output, { recursive: true });
const report = { scope: 'Real offline campus WebGL2 + production Full Map; backend disabled; no Production access', cases: [] };
const overlaps = (a, b) => a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
const screenshot = (page, name) => page.screenshot({ path: `${output}/${name}.png`, fullPage: false, animations: 'disabled' });

async function readLayout(page) {
  return page.evaluate(() => {
    const box = element => element.getBoundingClientRect().toJSON();
    const root = document.getElementById('full-map-panel');
    const surface = document.getElementById('full-map-surface');
    const labels = [...root.querySelectorAll('.full-map-poi[data-label-visible="true"] .full-map-poi-label')].map(label => {
      const button = label.closest('button'), rect = box(label);
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.full-map-poi');
      return { id: button.dataset.poiId, text: label.textContent, font: getComputedStyle(label).fontSize,
        ...rect, hitId: hit?.dataset.poiId ?? null };
    });
    return { surface: box(surface), controls: box(root.querySelector('.full-map-controls')),
      card: box(root.querySelector('.full-map-card')), infoHidden: document.getElementById('full-map-info').hidden,
      columns: getComputedStyle(root.querySelector('.full-map-body')).gridTemplateColumns,
      controlButtons: [...root.querySelectorAll('.full-map-controls button')].map(button => {
        const range = document.createRange(); range.selectNodeContents(button);
        return { text: button.textContent, lines: new Set([...range.getClientRects()].map(r => Math.round(r.top))).size, ...box(button) };
      }),
      viewport: { width: innerWidth, height: innerHeight },
      media: { coarse: matchMedia('(pointer: coarse)').matches, landscape: matchMedia('(orientation: landscape)').matches }, labels,
      pois: [...root.querySelectorAll('.full-map-poi')].map(button => ({ id: button.dataset.poiId,
        name: button.getAttribute('aria-label'), state: button.dataset.presentation,
        icon: button.querySelector('.full-map-poi-icon path')?.getAttribute('d'),
        badgeHidden: button.querySelector('.full-map-poi-state').hidden,
        badge: button.querySelector('.full-map-poi-state path')?.getAttribute('d'), ...box(button) })) };
  });
}

function checkLayout(layout, name, { portrait = false, initial = false } = {}) {
  assert.ok(layout.labels.length >= 2, `${name}: useful Korean place labels must be visible`);
  assert.ok(layout.surface.bottom <= layout.card.bottom - 1 && layout.surface.y >= layout.card.y,
    `${name}: map must fit inside its card without clipping`);
  assert.ok(layout.controls.bottom <= Math.min(layout.card.bottom - 1, layout.viewport.height) && layout.controls.y >= layout.card.y,
    `${name}: every map control must fit inside the visible card`);
  for (const [part, rect] of [['map', layout.surface], ['controls', layout.controls]]) {
    assert.ok(rect.x >= Math.max(layout.card.x, 0) && rect.right <= Math.min(layout.card.right, layout.viewport.width),
      `${name}: ${part} must fit horizontally inside the card and viewport`);
  }
  for (const label of layout.labels) {
    assert.ok(parseFloat(label.font) >= 11, `${name}: readable label size`);
    assert.ok(label.x >= layout.surface.x - 1 && label.y >= layout.surface.y - 1 &&
      label.right <= layout.surface.right + 1 && label.bottom <= layout.surface.bottom + 1,
    `${name}: label escaped map: ${JSON.stringify(label)}`);
    assert.ok(!overlaps(label, layout.controls), `${name}: label is covered by controls: ${label.id}`);
    assert.equal(label.hitId, label.id, `${name}: visible label must activate its own POI: ${label.id}`);
  }
  for (let i = 0; i < layout.labels.length; i++) for (let j = i + 1; j < layout.labels.length; j++) {
    assert.ok(!overlaps(layout.labels[i], layout.labels[j]), `${name}: labels overlap: ${layout.labels[i].id}/${layout.labels[j].id}`);
  }
  assert.ok(layout.pois.every(p => p.icon && p.width >= 43.9 && p.height >= 43.9), `${name}: SVG icons and stable touch targets`);
  for (const button of layout.controlButtons) {
    assert.equal(button.lines, 1, `${name}: ${button.text} must stay on one line`);
    assert.ok(button.x >= layout.controls.x - 1 && button.right <= layout.controls.right + 1,
      `${name}: ${button.text} cannot overflow the toolbar`);
  }
  if (portrait) assert.ok(layout.controls.y >= layout.surface.bottom - 1, `${name}: portrait toolbar stays outside the map`);
  if (initial) {
    assert.equal(layout.infoHidden, true);
    assert.equal(layout.columns.trim().split(/\s+/).length, 1, `${name}: unselected detail column cannot reserve map width`);
  }
}

try {
  for (const [name, viewport, mobile] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['portrait', { width: 390, height: 844 }, true],
    ['landscape', { width: 844, height: 390 }, true],
    ['landscape-compact', { width: 568, height: 320 }, true]
  ]) {
    // Compact QA resizes an existing campus session; lobby layout is a separate test.
    const bootViewport = name === 'landscape-compact' ? { width: 844, height: 390 } : viewport;
    const smoke = await startSmoke({ viewport: bootViewport, contextOptions: { isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 } });
    const entry = { name, viewport, deviceScaleFactor: 1, mobile, screenshots: [] };
    report.cases.push(entry);
    let page;
    try {
      page = await smoke.context.newPage();
      const fatal = smoke.watch(page);
      await page.goto(`${smoke.origin}/campus/?lobby=1&envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
      await Promise.race([page.waitForFunction(() => {
        const s = window.__INHAGAME_P0__?.getStatus?.();
        return s?.renderer === 'UNAVAILABLE' || s?.loading?.finished;
      }, null, { timeout: TIMEOUT_MS }), fatal]);
      const boot = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
      assert.equal(boot.renderer, 'WebGL2', `${name}: actual campus renderer required`);
      assert.equal(boot.loading.phase, 'READY');
      entry.renderer = boot.renderer;
      await page.locator('#main-gate-start').click({ timeout: TIMEOUT_MS });
      await page.waitForFunction(() => !window.__INHAGAME_P0__.getStatus().lobby.active &&
        !window.__INHAGAME_P0__.getStatus().lobbyTransition.active, null, { timeout: TIMEOUT_MS });
      if (name === 'landscape-compact') await page.setViewportSize(viewport);
      await page.locator('#minimap-open-map').click({ timeout: TIMEOUT_MS });
      await page.locator('#full-map-panel').waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);
      entry.initial = await readLayout(page);
      await screenshot(page, `${name}-overview`); entry.screenshots.push(`${name}-overview.png`);
      checkLayout(entry.initial, name, { portrait: name === 'portrait', initial: true });
      if (name.startsWith('landscape')) {
        assert.equal(entry.initial.media.coarse, true, 'mobile touch media query is active');
        assert.ok(entry.initial.surface.width >= (name === 'landscape' ? 300 : 220), 'short-landscape map uses its independent height-bound layout');
        assert.ok(entry.initial.controls.x >= entry.initial.surface.right, 'landscape controls live beside the map');
      }
      assert.equal(entry.initial.pois.length, 10, `${name}: canonical POIs retained`);
      assert.notEqual(entry.initial.pois.find(p => p.id === 'poi.building-5').icon,
        entry.initial.pois.find(p => p.id === 'poi.dorm-1').icon, 'building and housing have distinct symbols');
      assert.ok(entry.initial.pois.filter(p => p.state !== 'NORMAL').every(p => !p.badgeHidden && p.badge));

      // A real click/tap on a visible label must select the corresponding POI.
      const target = entry.initial.labels.find(label => entry.initial.pois.find(p => p.id === label.id)?.state === 'NORMAL');
      assert.ok(target, `${name}: an available labelled POI exists`);
      const label = page.locator(`.full-map-poi[data-poi-id="${target.id}"] .full-map-poi-label`);
      if (!mobile) {
        const before = await label.boundingBox();
        await label.hover();
        const after = await label.boundingBox();
        assert.ok(Math.abs(before.x - after.x) < .5 && Math.abs(before.y - after.y) < .5, 'hover cannot move a visible label');
        await label.click();
      } else await label.tap();
      assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.fullMap.selectedPoi.poiId), target.id);
      assert.equal(await page.locator('#full-map-info').isVisible(), true);
      assert.doesNotMatch(await page.locator('#full-map-info-meta').innerText(), /BUILDING|HOUSING|GATE|LANDMARK/);
      entry.selected = await readLayout(page);
      await screenshot(page, `${name}-selection`); entry.screenshots.push(`${name}-selection.png`);
      checkLayout(entry.selected, `${name} selected`, { portrait: name === 'portrait' });

      // Use the existing navigation owner, not a fake route or a player teleport.
      const position = await page.evaluate(() => {
        const p = window.__INHAGAME_P0__.player.getLocalPosition(); return { x: p.x, z: p.z };
      });
      await page.locator('.full-map-poi[data-poi-id="poi.main-hall"]').press('Enter');
      await page.locator('#full-map-set-destination').click();
      await page.waitForFunction(() => window.__INHAGAME_P0__.fullMap.destination?.poiId === 'poi.main-hall');
      entry.navigation = await page.evaluate(() => ({ map: window.__INHAGAME_P0__.fullMap.status(),
        target: window.__INHAGAME_P0__.fullMap.destination,
        text: document.getElementById('full-map-nav-text').textContent,
        player: { x: window.__INHAGAME_P0__.player.getLocalPosition().x, z: window.__INHAGAME_P0__.player.getLocalPosition().z } }));
      assert.deepEqual(entry.navigation.player, position, 'map guidance cannot move the player');
      assert.equal(await page.locator('#full-map-nav').isVisible(), true);
      assert.equal(entry.navigation.map.routeVisible, true, 'real campus route is visible');
      entry.guidanceLayout = await readLayout(page);
      checkLayout(entry.guidanceLayout, `${name} guidance`, { portrait: name === 'portrait' });
      await screenshot(page, `${name}-navigation`); entry.screenshots.push(`${name}-navigation.png`);
      await page.locator('#full-map-nav-clear').click();
      assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.fullMap.destination), null);

      await page.locator('#full-map-zoom-in').click(); await page.locator('#full-map-zoom-in').click();
      const zoomed = await page.evaluate(() => window.__INHAGAME_P0__.fullMap.viewport);
      assert.ok(zoomed.zoom > 1.55);
      const surface = await page.locator('#full-map-surface').boundingBox();
      if (mobile) {
        const touch = await smoke.context.newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: surface.x + 12, y: surface.y + 12, id: 1 }] });
        for (let step = 1; step <= 5; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove',
          touchPoints: [{ x: surface.x + 12 + 43 * step / 5, y: surface.y + 12 + 28 * step / 5, id: 1 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await touch.detach();
        entry.dragInput = 'Chromium emulated touch';
      } else {
        await page.mouse.move(surface.x + 12, surface.y + 12); await page.mouse.down();
        await page.mouse.move(surface.x + 55, surface.y + 40, { steps: 5 }); await page.mouse.up();
        entry.dragInput = 'mouse';
      }
      const dragged = await page.evaluate(() => window.__INHAGAME_P0__.fullMap.viewport);
      assert.ok(dragged.panX !== zoomed.panX || dragged.panY !== zoomed.panY, 'zoomed map drag works');
      await page.locator('#full-map-reset-view').click();
      await page.locator('#full-map-close').focus();
      await page.keyboard.press('Tab');
      const keyboardFocus = await page.evaluate(() => ({
        poiId: document.activeElement?.dataset.poiId,
        visible: document.activeElement?.matches(':focus-visible'),
        labelVisible: document.activeElement?.dataset.labelVisible
      }));
      assert.ok(keyboardFocus.poiId, 'keyboard reaches a map POI');
      assert.equal(keyboardFocus.visible, true);
      entry.keyboardFocus = keyboardFocus;
      assert.equal(keyboardFocus.labelVisible, 'true');
      await screenshot(page, `${name}-keyboard-focus`); entry.screenshots.push(`${name}-keyboard-focus.png`);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#full-map-panel').isVisible(), false);
      await page.locator('#minimap-open-map').click();
      assert.equal(await page.locator('#full-map-panel').isVisible(), true, 'map reopens after dismissal');

      // Synthetic state coverage, explicitly labelled as QA. Use real campus
      // geometry/positions and the production controller; never change owners.
      entry.stateFixture = await page.evaluate(async () => {
        const { createMiniMapDataSource } = await import('/src/minimap/minimap-data.js');
        const original = createMiniMapDataSource();
        const states = ['LOCKED', 'COMING_SOON', 'DISABLED', 'UNKNOWN', 'UNDISCOVERED'];
        const pois = original.poiRegistry().list({ surface: 'FULL_MAP' }).map((poi, i) => ({ ...poi, presentation: states[i % states.length] }));
        window.__INHAGAME_P0__.fullMap.setDataSource({ bounds: original.bounds, geometry: original.geometry,
          poiRegistry: () => ({ list: () => pois }) }, { id: 'campus', label: '전체지도 · 상태 표시 QA' });
        return { scope: 'synthetic presentation-only state coverage on real campus geometry', states };
      });
      const stateLayout = await readLayout(page);
      const statePaths = new Set();
      for (const state of entry.stateFixture.states) {
        const poi = stateLayout.pois.find(p => p.state === state);
        assert.ok(poi && !poi.badgeHidden && poi.badge, `${name}: distinct ${state} badge`);
        statePaths.add(poi.badge);
        await page.locator(`.full-map-poi[data-poi-id="${poi.id}"]`).press('Enter');
        assert.equal(await page.locator('#full-map-set-destination').isEnabled(), false, `${state} cannot become a destination`);
        assert.equal(await page.locator('#full-map-auto-move').isEnabled(), false, `${state} cannot start automatic movement`);
      }
      assert.equal(statePaths.size, 5, 'five non-normal states use five distinct symbols');
      await screenshot(page, `${name}-state-fixture`); entry.screenshots.push(`${name}-state-fixture.png`);
      assert.deepEqual(smoke.problems, [], `${name}: runtime browser failures`);
      entry.result = 'PASS';
    } catch (error) {
      entry.result = 'FAIL'; entry.error = String(error.stack || error); entry.problems = smoke.problems;
      if (page) await screenshot(page, `${name}-failure`).catch(() => {});
      throw error;
    } finally {
      await smoke.close();
      await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    }
  }
  console.log('Full Map real campus Chromium UI and state coverage: PASS');
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
