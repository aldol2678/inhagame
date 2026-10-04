import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const worldDir = fileURLToPath(new URL('../', import.meta.url));
const read = relative => readFileSync(join(worldDir, relative), 'utf8');
const html = read('campus/index.html');
const css = read('styles.css');
const minimapData = read('src/minimap/minimap-data.js');

const PORTRAIT_QUERY = '@media (orientation: portrait) and (max-width: 720px) {';

test('portrait Full Map keeps controls outside the drawable map surface', () => {
  const stage = html.match(/<div class="full-map-stage">([\s\S]*?)<aside id="full-map-info"/)?.[1] ?? '';
  assert.ok(stage, 'Full Map stage wrapper exists');
  assert.match(stage,
    /id="full-map-marker-layer"[\s\S]*?<\/div>\s*<\/div>\s*<div class="full-map-controls"/,
    'map surface closes before the controls, so the toolbar cannot cover south-campus geometry');

  const queryStart = css.indexOf(PORTRAIT_QUERY);
  assert.ok(queryStart >= 0, 'portrait Full Map media query exists');
  const portraitEnd = css.indexOf('.editor-world-runtime-status', queryStart);
  const portrait = css.slice(queryStart, portraitEnd);
  assert.match(portrait, /\.full-map-stage\s*\{[^}]*display:\s*grid;[^}]*gap:\s*8px;/s);
  assert.match(portrait, /\.full-map-controls\s*\{[^}]*position:\s*static;[^}]*width:\s*100%;[^}]*transform:\s*none;/s);
});

test('desktop and landscape keep the existing overlay control presentation', () => {
  assert.match(css, /\.full-map-stage\s*\{[^}]*position:\s*relative;[^}]*min-width:\s*0;/s);
  assert.match(css, /\.full-map-controls\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*12px;/s);
  assert.match(css, /body \.full-map-controls\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*bottom:\s*6px;/s,
    'short landscape phones explicitly restore the overlay controls');
});

test('First Dormitory remains a Full Map POI while portrait controls move below the map', () => {
  assert.match(minimapData,
    /poiId:\s*"poi\.dorm-1"[\s\S]*?title:\s*"제1생활관"[\s\S]*?surfaces:\s*Object\.freeze\(\[MAP_SURFACE\.MINIMAP, MAP_SURFACE\.FULL_MAP\]\)/,
    'First Dormitory is still available on the full campus map');
});

test('Full Map reclaims the unselected detail column on desktop as well as mobile', () => {
  const beforeMobile = css.slice(0, css.indexOf('@media (max-width: 720px)', css.indexOf('.full-map-panel {')));
  assert.match(beforeMobile, /\.full-map-body:has\(> \.full-map-info\[hidden\]\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(beforeMobile, /\.full-map-stage\s*\{[^}]*max-width:\s*min\(100%, calc\(100dvh - 160px\)\)/s,
    'expanded map remains height bounded rather than becoming a tall scrolling square');
});

test('Full Map labels are readable DOM text and POIs retain touch-sized targets', () => {
  assert.match(css, /\.full-map-poi\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(css, /\.full-map-poi-label\s*\{[^}]*font:\s*800 12px\/16px/s);
  assert.match(css, /\.full-map-poi\[data-label-visible="true"\] \.full-map-poi-label\s*\{[^}]*visibility:\s*visible/s);
  assert.match(css, /\.full-map-poi-state\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(css, /\.full-map-poi::after\s*\{/,
    'labels no longer depend on CSS-generated aria-label text');
});


test('only visible collision-resolved labels extend their POI click target', () => {
  assert.match(css, /\.full-map-poi\[data-label-visible="true"\] \.full-map-poi-label\s*\{[^}]*pointer-events:\s*auto/s);
});
