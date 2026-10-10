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

test('desktop keeps overlay controls and short landscape uses a separate rail', () => {
  assert.match(css, /\.full-map-stage\s*\{[^}]*position:\s*relative;[^}]*min-width:\s*0;/s);
  assert.match(css, /\.full-map-controls\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*12px;/s);
  assert.match(css, /body \.full-map-controls\s*\{[^}]*position:\s*static;[^}]*width:\s*68px;[^}]*flex-direction:\s*column;/s,
    'short landscape controls do not consume drawable map area');
});

test('First Dormitory remains a Full Map POI while portrait controls move below the map', () => {
  assert.match(minimapData,
    /poiId:\s*"poi\.dorm-1"[\s\S]*?title:\s*"제1생활관"[\s\S]*?surfaces:\s*Object\.freeze\(\[MAP_SURFACE\.MINIMAP, MAP_SURFACE\.FULL_MAP\]\)/,
    'First Dormitory is still available on the full campus map');
});

test('Full Map reclaims the unselected detail column on desktop as well as mobile', () => {
  const beforeMobile = css.slice(0, css.indexOf('@media (max-width: 720px)', css.indexOf('.full-map-panel {')));
  assert.match(beforeMobile, /\.full-map-body:has\(> \.full-map-info\[hidden\]\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(beforeMobile, /\.full-map-stage\s*\{[^}]*max-width:\s*min\(100%, calc\(100dvh - 160px - var\(--full-map-search-height\)\)\)/s,
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

test('Full Map short-landscape rules have their own parseable media block', () => {
  const dedicated = css.slice(css.indexOf('/* Full Map short-landscape: independent of the legacy HUD block. */'));
  assert.ok(css.includes('/* Full Map short-landscape: independent of the legacy HUD block. */'));
  assert.match(dedicated, /^\/\* Full Map short-landscape:[^]*?\*\/\s*@media \(pointer: coarse\) and \(orientation: landscape\) and \(max-height: 500px\) \{/);
  assert.match(dedicated, /body \.full-map-stage\s*\{[^}]*max-width:\s*none/);
  assert.match(dedicated, /--ls-full-map-size:\s*min\(430px, calc\(var\(--ls-full-map-available-height\) - 60px - var\(--full-map-search-height\)\)\)/);
});


test('short-landscape toolbar has a fixed compact rail and single-line action labels', () => {
  const dedicated = css.slice(css.indexOf('/* Full Map short-landscape: independent of the legacy HUD block. */'));
  assert.match(dedicated, /body \.full-map-controls\s*\{[^}]*width:\s*68px/s);
  assert.match(dedicated, /body \.full-map-controls button\s*\{[^}]*white-space:\s*nowrap/s);
});

test('short-landscape map size subtracts card chrome and guidance height', () => {
  const dedicated = css.slice(css.indexOf('/* Full Map short-landscape: independent of the legacy HUD block. */'), css.indexOf('/* FULL-MAP-LANDSCAPE:end */'));
  assert.match(dedicated, /--ls-full-map-available-height:\s*calc\(100dvh - max\(12px, env\(safe-area-inset-top\)\) - max\(12px, env\(safe-area-inset-bottom\)\)\)/);
  assert.match(dedicated, /--ls-full-map-size:\s*min\(430px, calc\(var\(--ls-full-map-available-height\) - 60px - var\(--full-map-search-height\)\)\)/);
  assert.match(dedicated, /--ls-full-map-size:\s*min\(390px, calc\(var\(--ls-full-map-available-height\) - 106px - var\(--full-map-search-height\)\)\)/);
});


test('Full Map search is independently labelled and cannot widen a 360px viewport', () => {
  const search = read('src/minimap/full-map-search.js');
  assert.match(html, /id="full-map-search" class="full-map-search"/);
  assert.match(read('src/main.js'), /searchRoot: document.getElementById\("full-map-search"\)/);
  assert.match(search, /aria-label", "지도 장소 이름 검색/);
  assert.match(css, /\.full-map-search\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.match(css, /\.full-map-search-input\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.full-map-search-panel\s*\{[^}]*max-height:\s*min\(220px, 35dvh\)[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.full-map-search-result\s*\{[^}]*overflow-wrap:\s*anywhere/s);
});


test('only the visible Campus search row reserves map height', () => {
  assert.match(css, /\.full-map-card\s*\{[^}]*--full-map-search-height:\s*0px/s);
  assert.match(css, /\.full-map-card:has\(> \.full-map-search:not\(\[hidden\]\)\)\s*\{[^}]*--full-map-search-height:\s*54px/s);
  assert.match(css, /\.full-map-search\[hidden\]\s*\{[^}]*display:\s*none/s);
});

test('very short landscape places Campus search in the header without shrinking the map rail', () => {
  const compact = css.slice(css.indexOf('/* FULL-MAP-COMPACT-SEARCH:start */'), css.indexOf('/* FULL-MAP-COMPACT-SEARCH:end */'));
  assert.match(compact, /@media \(pointer: coarse\) and \(orientation: landscape\) and \(min-width: 568px\) and \(max-height: 340px\)/);
  assert.match(compact, /--full-map-search-height:\s*0px/);
  assert.match(compact, /body \.full-map-search\s*\{[^}]*position:\s*absolute[^}]*top:\s*7px[^}]*left:\s*185px[^}]*right:\s*58px/s);
  assert.match(compact, /body \.full-map-search-input, body \.full-map-search-clear\s*\{[^}]*min-height:\s*36px/s);
});
