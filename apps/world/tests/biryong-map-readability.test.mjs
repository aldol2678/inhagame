import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBiryongMapDataSource } from '../src/biryong/biryong-map-data.js';

const css = (await readFile(new URL('../styles.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
const declarations = selector => {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(([, selectors]) => selectors.split(',').some(value => value.trim() === selector));
  assert.ok(rule, `Missing scoped paint rule: ${selector}`);
  return Object.fromEntries(rule[2].split(';').filter(value => value.includes(':')).map(value => {
    const [property, ...parts] = value.split(':');
    return [property.trim(), parts.join(':').trim()];
  }));
};
const luminance = hex => {
  assert.match(hex, /^#[\da-f]{6}$/i, 'map colors are opaque, independent of the surface below');
  return hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

test('Biryong geometry opts into its own palette without changing shared campus/room paint', () => {
  assert.ok(createBiryongMapDataSource().geometry().every(item => item.style === 'biryong'));
});

for (const surface of ['minimap', 'full-map']) test(`${surface} Biryong roads and outlined solids/water stay distinct`, () => {
  const paint = Object.fromEntries(['GROUND', 'ROAD', 'BUILDING', 'WATER'].map(kind => [kind,
    declarations(`.${surface}-geometry [data-map-style="biryong"][data-map-kind="${kind}"]`)]));
  for (const kind of ['GROUND', 'BUILDING', 'WATER']) {
    assert.ok(contrast(paint.ROAD.fill, paint[kind].fill) >= 3, `road/${kind} needs 3:1 separation`);
  }
  for (const kind of ['BUILDING', 'WATER']) {
    assert.ok(contrast(paint[kind].fill, paint[kind].stroke) >= 3, `${kind} outline needs 3:1 separation`);
    assert.equal(paint[kind]['vector-effect'], 'non-scaling-stroke', 'boundaries keep their weight when zooming');
  }
  assert.notEqual(paint.BUILDING.fill, paint.WATER.fill);
});

test('the existing return stop has the first label priority and an explicit return name', () => {
  const pois = createBiryongMapDataSource().poiRegistry().list();
  assert.equal(pois.length, 7);
  const exit = pois.find(poi => poi.poiId === 'poi.biryong-realm.return');
  assert.ok(pois.filter(poi => poi !== exit).every(poi => exit.priority > poi.priority));
  assert.match(exit.title, /귀환/);
  assert.match(exit.title, /F1/);
  assert.match(exit.title, /인하대후문/);
});

test('return icon and label use a scoped high-contrast treatment on both maps', () => {
  const marker = '.minimap-poi[data-poi-id="poi.biryong-realm.return"]';
  const dot = declarations(`${marker} .minimap-poi-dot`);
  const glyph = declarations(`${marker} .minimap-poi-glyph`);
  assert.ok(contrast(dot.fill, glyph.fill) >= 4.5);
  const full = '.full-map-poi[data-poi-id="poi.biryong-realm.return"]';
  const icon = declarations(`${full} .full-map-poi-icon`);
  const label = declarations(`${full} .full-map-poi-label`);
  assert.ok(contrast(icon.color, icon.background) >= 4.5);
  assert.ok(contrast(label.color, label.background) >= 4.5);
  assert.notEqual(icon['border-radius'], '50%', 'return is distinguishable by shape as well as color');
});

test('return marker paints above ordinary POIs while selected/focused POIs keep precedence', () => {
  const exit = declarations('.full-map-poi[data-poi-id="poi.biryong-realm.return"][data-emphasized="false"]');
  const emphasized = declarations('.full-map-poi[data-emphasized="true"]');
  assert.ok(Number(exit['z-index']) > 0, 'registry priority does not bury the return marker under later siblings');
  assert.ok(Number(exit['z-index']) < Number(emphasized['z-index']));
});

test('return label wraps the complete title into a compact box without shrinking its font', () => {
  const label = declarations('.full-map-poi[data-poi-id="poi.biryong-realm.return"] .full-map-poi-label');
  assert.equal(label['max-width'], '96px');
  assert.equal(label['white-space'], 'normal');
  assert.equal(label['word-break'], 'keep-all');
  assert.equal(label['text-align'], 'center');
  assert.equal(label['font-size'], undefined, 'keep the shared readable 11px/12px label font');
});
