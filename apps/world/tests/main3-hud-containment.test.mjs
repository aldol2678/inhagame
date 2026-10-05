import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createShopWorldLabel } from '../src/shop/shop-world-label.js';
import { QUEST_ID_MAIN_FIRST_STYLE } from '../src/quest/quest-registry.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

function markerHarness() {
  const blockers = [];
  const markerRect = rect(114, 200, 162, 54);
  const classes = new Set();
  const document = {
    querySelectorAll: selector => blockers.filter(blocker => selector.includes(blocker.selector)),
    defaultView: { getComputedStyle: node => ({ display: 'block', visibility: 'visible', opacity: '1', ...node.computedStyle }) }
  };
  const element = {
    hidden: true, style: {}, dataset: {}, ownerDocument: document,
    classList: { remove: name => classes.delete(name), toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
    getBoundingClientRect: () => element.hidden ? rect(0, 0, 0, 0) : markerRect,
    querySelector: () => null
  };
  const label = createShopWorldLabel({ element,
    camera: { getPosition: () => ({ x: 0, y: 2, z: 5 }), camera: { worldToScreen: () => ({ x: 195, y: 268, z: 1 }) } },
    canvas: { clientWidth: 390, clientHeight: 844, getBoundingClientRect: () => rect(0, 0, 390, 844) },
    getWorldPosition: () => ({ x: 0, y: 2, z: 0 }), coarsePointer: true
  });
  const addBlocker = (selector, bounds = rect(174, 186, 204, 48), extra = {}) => {
    const blocker = { selector, hidden: false, getBoundingClientRect: () => bounds, ...extra };
    blockers.push(blocker);
    return blocker;
  };
  const update = () => label.update({ visible: true, nearby: true, available: true });
  return { element, classes, markerRect, label, update, addBlocker };
}

test('Main3 measured mobile overlap: floating shop marker yields to the primary tracked HUD', () => {
  const h = markerHarness();
  h.addBlocker('#quest-hud');
  assert.equal(h.update(), false, 'the marker intersects the mobile tracked quest at x174–276, y200–234');
  assert.equal(h.element.hidden, true);
  assert.equal(h.classes.has('is-near'), false);
});

test('floating marker reappears after the tracked HUD hides or moves clear', () => {
  const h = markerHarness();
  const hud = h.addBlocker('#quest-hud');
  assert.equal(h.update(), false);
  hud.hidden = true;
  assert.equal(h.update(), true);
  assert.equal(h.element.hidden, false);
  assert.equal(h.classes.has('is-near'), true);
  hud.hidden = false;
  hud.getBoundingClientRect = () => rect(10, 55, 340, 80);
  assert.equal(h.update(), true, 'desktop tracked HUD is clear of the shop label');
});

test('floating marker also yields to visible critical screens', () => {
  for (const selector of ['#minimap', '[aria-modal="true"]', '#hud-menu', '#view-settings', '.main2-guide-dialogue']) {
    const h = markerHarness();
    h.addBlocker(selector);
    assert.equal(h.update(), false, selector);
  }
});

test('hidden, CSS-suppressed and empty critical screens do not suppress discovery', () => {
  for (const extra of [{ hidden: true }, { computedStyle: { display: 'none' } },
    { computedStyle: { visibility: 'hidden' } }, { computedStyle: { opacity: '0' } },
    { getBoundingClientRect: () => rect(195, 220, 0, 0) }]) {
    const h = markerHarness();
    h.addBlocker('#quest-hud', undefined, extra);
    assert.equal(h.update(), true);
    assert.equal(h.element.dataset.state, 'near');
  }
});

test('marker keeps breathing room for its animated pointer beside the HUD', () => {
  const h = markerHarness();
  h.addBlocker('#quest-hud', rect(280, 186, 98, 48));
  assert.equal(h.update(), false, 'four pixels is too close to the marker glow and float');
});

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const start = css.indexOf('/* MAIN3-HUD-CONTAINMENT:start */');
const end = css.indexOf('/* MAIN3-HUD-CONTAINMENT:end */');
const scopedCss = start < 0 ? '' : css.slice(start, end);
const questSelector = `#quest-hud[data-quest-id="${QUEST_ID_MAIN_FIRST_STYLE}"]`;

test('only the Main3 tracked objective wraps through the final action verb', () => {
  assert.ok(start > 0 && end > start && end < css.indexOf('/* LANDSCAPE-HUD:start'),
    'Main3 has an isolated block before the final landscape contract; its ID selector wins the compact rules');
  assert.ok(scopedCss.includes(`${questSelector} .tour-objective`));
  assert.match(scopedCss, /white-space:\s*normal;/);
  assert.match(scopedCss, /overflow:\s*visible;/);
  assert.match(scopedCss, /text-overflow:\s*clip;/);
  assert.match(scopedCss, /max-width:\s*none;/);
  assert.doesNotMatch(scopedCss, /\.tracked-quest-hud\s*\{|#context-action/);
});

test('Main3 keeps the secondary Living Campus card off its active primary HUD rail', () => {
  assert.ok(scopedCss.includes(`body:has(> ${questSelector}:not([hidden])) > .inkyung-living-moment`));
  assert.match(scopedCss, /\.inkyung-living-moment\s*\{\s*display:\s*none\s*!important;/);
});

test('Main3 touch objective uses the available card width with bearing on a separate row', () => {
  assert.match(scopedCss, /@media \(pointer: coarse\)/);
  assert.ok(scopedCss.includes(`${questSelector} .tracked-quest-hud-open`));
  assert.match(scopedCss, /"flag objective"\s*"flag bearing"/);
});

test('touch Main3 reserves the heading slot when DIALOGUE or SHOP restores its visibility', () => {
  // EXPLORE/NONE hides heading on portrait phones, but the same HUD restores it during overlays.
  // Its inherited grid-area must remain explicit in the touch layout, with no implicit columns.
  assert.match(css, /\.tracked-quest-hud \.tour-heading\s*\{[^}]*grid-area:\s*heading;/s);
  assert.match(scopedCss, /grid-template-areas:\s*"flag heading"\s*"flag objective"\s*"flag bearing"/);
});

test('secondary Living Campus suppression is limited to touch UI', () => {
  assert.ok(scopedCss.indexOf('body:has(') > scopedCss.indexOf('@media (pointer: coarse)'),
    'desktop secondary discovery remains unchanged');
});
