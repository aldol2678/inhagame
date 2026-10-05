import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const worldDir = fileURLToPath(new URL('../', import.meta.url));
const read = relative => readFileSync(join(worldDir, relative), 'utf8');
const css = read('styles.css');
const html = read('campus/index.html');

const START = '/* LANDSCAPE-HUD:start';
const END = '/* LANDSCAPE-HUD:end */';
const QUERY = '@media (pointer: coarse) and (orientation: landscape) and (max-height: 500px) {';

const startIndex = css.indexOf(START);
const endIndex = css.indexOf(END);
const before = css.slice(0, startIndex);
const MAP_START = '/* Full Map short-landscape: independent of the legacy HUD block. */';
const MAP_END = '/* FULL-MAP-LANDSCAPE:end */';
const mapSection = css.slice(css.indexOf(MAP_START), css.indexOf(MAP_END) + MAP_END.length);
const beforeWithoutMap = before.replace(mapSection, '');
const mapBlock = mapSection.slice(mapSection.indexOf(QUERY) + QUERY.length, mapSection.lastIndexOf('}'));
const section = css.slice(startIndex, endIndex + END.length);
// The override lives in exactly one media block; `body` is the inside of that block.
const blockOpen = section.indexOf(QUERY);
const block = section.slice(blockOpen + QUERY.length, section.lastIndexOf('}', section.length - END.length - 1));

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'tests' || name === 'docs') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(js|mjs|html)$/.test(name)) out.push(path);
  }
  return out;
}

test('landscape HUD remains last while Full Map owns an isolated earlier media block', () => {
  assert.ok(startIndex > 0 && endIndex > startIndex, 'LANDSCAPE-HUD markers exist');
  assert.equal(css.split(QUERY).length - 1, 2, 'one HUD block and one isolated Full Map block');
  assert.ok(css.indexOf(MAP_START) >= 0 && css.indexOf(MAP_END) < startIndex);
  const mapSelectors = [...mapBlock.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|})\s*([^{}]+)\{/g)]
    .flatMap(match => match[1].split(','));
  assert.ok(mapSelectors.length > 10 && mapSelectors.every(selector => selector.trim().startsWith('body .full-map')),
    'the earlier landscape exception can style Full Map only');
  assert.match(QUERY, /pointer: coarse/);
  assert.match(QUERY, /orientation: landscape/);
  assert.match(QUERY, /max-height: 500px/);
  // Nothing but the override follows the markers: no rule can leak out of the media query.
  assert.equal(css.slice(endIndex + END.length).trim(), '');
  const open = (block.match(/\{/g) ?? []).length;
  const close = (block.match(/\}/g) ?? []).length;
  assert.equal(open, close, 'braces inside the landscape block are balanced');
  assert.doesNotMatch(block, /@media/, 'no nested query widens the override');
});

test('the override is not a max-width rule and never touches portrait or desktop media', () => {
  assert.doesNotMatch(QUERY, /max-width/);
  // Every pre-existing orientation-free rule is still above the markers, unchanged in place.
  assert.doesNotMatch(beforeWithoutMap, /orientation:\s*landscape/, 'no other existing rule was converted to a landscape rule');
  assert.match(before, /@media \(pointer: coarse\) and \(max-width: 420px\) \{[\s\S]*?#run,\s*#jump,\s*#descend \{[\s\S]*?width: 68px;\s*height: 68px;/,
    'portrait small-phone action buttons are unchanged');
  assert.match(before, /@media \(pointer: coarse\) and \(max-width: 420px\) \{[\s\S]*?\.social-cluster #chat-toggle \{[\s\S]*?width: 44px;/,
    'portrait social cluster is unchanged');
  assert.match(before, /@media \(max-width: 560px\) \{\s*\.tracked-quest-hud \{[\s\S]*?right: max\(10px, env\(safe-area-inset-right\)\);/,
    'portrait tracked quest card is unchanged');
  assert.match(before, /@media \(pointer: fine\) and \(min-width: 700px\) \{\s*#joystick,\s*#run,\s*#jump,\s*#descend \{\s*display: none !important;/,
    'desktop hides the touch controls as before');
  assert.match(before, /#jump \{ bottom: max\(42px, env\(safe-area-inset-bottom\)\); \}/);
  assert.match(before, /\.minimap \{\s*--minimap-size: var\(--world-right-rail-map-size, 112px\);/);
});

test('every selector used by the override exists in the campus DOM or the HUD sources', () => {
  const corpus = [html, before, ...sourceFiles(worldDir).map(file => readFileSync(file, 'utf8'))].join('\n');
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, '{}');
  const selectors = stripped.split('{}').map(part => part.trim()).filter(Boolean).join(',');
  const ids = new Set([...selectors.matchAll(/#([A-Za-z][\w-]*)/g)].map(match => match[1]));
  const classes = new Set([...selectors.matchAll(/\.([A-Za-z][\w-]*)/g)].map(match => match[1]));
  assert.ok(ids.size >= 15 && classes.size >= 20, 'the selector scan found the override rules');
  for (const id of ids) assert.ok(corpus.includes(id), `#${id} is a real HUD id`);
  for (const name of classes) assert.ok(corpus.includes(name), `.${name} is a real HUD class`);
});

test('touch controls are re-laid out as joystick left, short two-column action cluster right', () => {
  // Joystick keeps its size and honours the safe area; the side tokens drive both hands.
  assert.match(block, /--ls-edge-l: max\(24px, env\(safe-area-inset-left\)\);/);
  assert.match(block, /--ls-edge-r: max\(24px, env\(safe-area-inset-right\)\);/);
  assert.match(block, /--ls-bottom: max\(16px, env\(safe-area-inset-bottom\)\);/);
  assert.match(block, /--ls-pad: 116px;/);
  assert.match(block, /body #joystick,\s*body\.joystick-right #joystick \{\s*left: var\(--ls-pad-l\);\s*right: var\(--ls-pad-r\);\s*bottom: var\(--ls-bottom\);/);
  // JUMP / RUN share the bottom row (two columns) at a finger-sized 68px.
  assert.match(block, /--ls-btn: 68px;/);
  assert.match(block, /body #run,\s*body #jump,\s*body #descend,\s*body\.joystick-right #run,\s*body\.joystick-right #jump,\s*body\.joystick-right #descend \{[^}]*left: var\(--ls-o1-l\);[^}]*right: var\(--ls-o1-r\);[^}]*bottom: var\(--ls-bottom\);[^}]*width: var\(--ls-btn\);[^}]*height: var\(--ls-btn\);/);
  assert.match(block, /body #run,\s*body\.joystick-right #run \{\s*left: var\(--ls-o2-l\);\s*right: var\(--ls-o2-r\);/);
  // Flight: DESCEND keeps the bottom slot and ASCEND (jump) sits on row 2 instead of a tall stack.
  assert.match(block, /body\[data-movement-state="MOUNT_FLIGHT"\] #jump \{ bottom: var\(--ls-row2\); \}/);
  assert.match(block, /body\[data-movement-state="MOUNT_FLIGHT"\] #descend \{ bottom: var\(--ls-bottom\); \}/);
  // Mirrored hand: the same tokens swap sides, so joystick-right needs no second layout.
  assert.match(block, /body\.joystick-right \{[^}]*--ls-pad-l: auto;[^}]*--ls-pad-r: var\(--ls-edge-r\);[^}]*--ls-o1-l: var\(--ls-edge-l\);[^}]*--ls-o1-r: auto;/);
});

test('context and transport actions form one short cluster above JUMP / RUN, never a tall stack', () => {
  const transport = block.match(/body #transport-action,[\s\S]*?\{([^}]*)\}/)?.[1] ?? '';
  assert.match(transport, /bottom: var\(--ls-row2\);/);
  assert.match(transport, /width: var\(--ls-btn\);/);
  assert.match(transport, /min-height: 44px;/);
  assert.match(block, /--ls-row2: calc\(var\(--ls-bottom\) \+ var\(--ls-btn\) \+ var\(--ls-gap\)\);/);
  // The two sibling-aware existing selectors (specificity 2,1,x) are matched, otherwise they would win.
  assert.match(block, /body #context-action\[hidden\] \+ #transport-action,/);
  assert.match(block, /body\.joystick-right #context-action\[hidden\] \+ #transport-action,/);
  const context = block.match(/body #context-action \{([^}]*)\}/)?.[1] ?? '';
  assert.match(context, /left: var\(--ls-o2-l\);/, 'context action sits beside the transport slot, not bottom-centre');
  assert.match(context, /transform: none;/);
  assert.match(context, /bottom: var\(--ls-row2\);/);
  assert.match(context, /max-width: 164px;/);
  assert.match(context, /min-height: 44px;/);
  assert.doesNotMatch(context, /left: 50%/);
  assert.match(block, /body:has\(> #transport-action\[hidden\]\) > #context-action \{\s*left: var\(--ls-o1-l\);/,
    'without a transport button the context action takes the slot above JUMP');
  assert.match(block, /body\[data-movement-state="MOUNT_FLIGHT"\] #transport-action,\s*body\[data-movement-state="MOUNT_FLIGHT"\] #context-action\[hidden\] \+ #transport-action \{\s*left: var\(--ls-o2-l\);/);
});

test('chat, social row and transient toasts leave the bottom centre free until they are used', () => {
  assert.match(block, /body \.social-cluster,\s*body\.joystick-right \.social-cluster \{[^}]*bottom: calc\(var\(--ls-bottom\) \+ var\(--ls-pad\) \+ 8px\);/);
  assert.match(block, /body \.social-cluster #chat-toggle \{ width: 44px; height: 44px;/);
  // The chat form / feed live in the lane between joystick and cluster and still honour --keyboard-inset.
  assert.match(block, /body \.chat-form \{ bottom: calc\(var\(--ls-lane-bottom\) \+ var\(--keyboard-inset, 0px\)\); \}/);
  assert.match(block, /body \.chat-feed,\s*body \.chat-form,\s*body \.chat-hint \{\s*left: var\(--ls-lane-left\);\s*right: auto;/);
  assert.match(block, /body \.emote-menu,\s*body\.joystick-right \.emote-menu \{\s*left: var\(--ls-lane-left\);/);
  assert.match(block, /body > \.mcm26-toast,\s*body \.mcm26-game-toast \{\s*bottom: var\(--ls-lane-bottom\);/);
  assert.match(block, /body \.follow-status \{\s*bottom: var\(--ls-lane-bottom\);/);
  // Dialogue cards (NPC, Biryong, back-gate guide, MCM) stay below the one-line quest card.
  assert.match(block, /body #npc-test-panel\.npc-live-panel,\s*body \.biryong-dialogue,\s*body \.main2-guide-dialogue,\s*body \.mcm26-dialogue \{[^}]*bottom: var\(--ls-lane-bottom\);[^}]*max-height: calc\(100dvh - var\(--world-right-rail-top\) - 46px - var\(--ls-lane-bottom\)\);[^}]*overflow-y: auto;/);
});

test('Mini-map is compact (88-100px), top-right and safe-area aware', () => {
  const size = Number(block.match(/--ls-map: (\d+)px;/)?.[1]);
  assert.ok(size >= 88 && size <= 100, `mini-map is ${size}px`);
  assert.match(block, /--world-right-rail-map-size: var\(--ls-map\);/);
  assert.match(block, /body \.minimap \{ --minimap-size: var\(--ls-map\); \}/);
  assert.match(block, /--ls-top: max\(6px, env\(safe-area-inset-top\)\);/);
  assert.match(block, /--world-right-rail-top: calc\(var\(--ls-top\) \+ var\(--ls-bar\) \+ 6px\);/);
  // The Mini-map itself still reads the shared rail tokens, which carry the top / right safe-area insets.
  assert.match(before, /\.minimap \{[^}]*top: var\(--world-right-rail-top[^}]*right: var\(--world-right-rail-right, max\(12px, env\(safe-area-inset-right\)\)\);/s);
  assert.match(before, /--world-right-rail-right: max\(12px, env\(safe-area-inset-right\)\);/);
});

test('tracked quest HUD collapses to one line in the Mini-map right rail', () => {
  assert.match(block, /body \.tracked-quest-hud \{[^}]*top: calc\(var\(--world-right-rail-top\) \+ var\(--ls-map\) \+ 6px\);[^}]*right: var\(--world-right-rail-right\);[^}]*left: auto;[^}]*width: min\(210px, calc\(100vw - 24px\)\);[^}]*min-height: 36px;[^}]*display: flex;/s);
  assert.match(block, /body \.tracked-quest-hud \.tracked-quest-hud-open \{[^}]*min-height: 36px !important;[^}]*grid-template-areas: "flag objective bearing";/);
  assert.match(block, /body \.tracked-quest-hud \.tour-heading \{ display: none; \}/);
  // The first-tour card keeps the top-left lane; the tracked quest no longer shares it.
  assert.match(block, /body \.tour \{[^}]*top: var\(--world-right-rail-top\);[^}]*left: max\(12px, env\(safe-area-inset-left\)\);[^}]*max-width: min\(340px, calc\(100vw - var\(--ls-chip-right\) - 210px\)\);/s);
  // The existing tracked-quest runtime contract (open-journal button, objective, bearing) is reused, not replaced.
  for (const id of ['quest-hud', 'quest-hud-open', 'quest-hud-heading', 'quest-hud-objective', 'quest-hud-bearing']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('event, guidance and objective UI become compact chips beside the Mini-map, not tall cards under it', () => {
  assert.match(block, /--ls-chip-right: calc\(var\(--world-right-rail-right\) \+ var\(--ls-map\) \+ 8px\);/);
  assert.match(block, /body \.nav-guidance \{[^}]*top: var\(--world-right-rail-top\);[^}]*right: var\(--ls-chip-right\);/);
  assert.match(block, /body > \.mcm26-chip \{[^}]*top: var\(--ls-event-top\);[^}]*right: var\(--ls-chip-right\);[^}]*min-height: 32px;/);
  assert.match(block, /body \.inkyung-living-moment \{[^}]*top: var\(--ls-event-top\);[^}]*right: var\(--ls-inky-right\);/);
  assert.match(block, /body \.biryong-objective \{[^}]*transform: none;[^}]*font-size: 12px;/);
  assert.match(block, /body \.biryong-toast \{[^}]*top: auto;[^}]*bottom: var\(--ls-lane-bottom\);/);
  // The chip is injected by JS after styles.css, so the override needs the higher-specificity `body >` form.
  const eventUi = read('src/events/zombie-university-2026/event-ui.js');
  assert.match(eventUi, /\.mcm26-chip\{position:fixed;/);
  assert.match(eventUi, /\.mcm26-toast\{position:fixed;/);
  assert.doesNotMatch(block, /(^|,)[ \t]*\.mcm26-chip\s*\{/m, 'a bare .mcm26-chip rule would lose to the injected style');
});

test('menu and settings drawers fit a short screen (3-column menu, scrollable settings)', () => {
  assert.match(block, /body \.identity-actions \{[^}]*max-height: calc\(100dvh - var\(--world-right-rail-top\) - 8px\);[^}]*overflow-y: auto;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(block, /body \.view-settings \{[^}]*max-height: calc\(100dvh - var\(--world-right-rail-top\) - 8px\);[^}]*overflow-y: auto;/);
  assert.match(block, /body \.quest-journal-body \{ min-height: 0;/);
  // Menu rows keep the 44px touch target set by the base touch rule.
  assert.match(before, /\.identity-actions button \{\s*width: 100%;\s*\/\* Touch devices keep the 44px target[^*]*\*\/\s*min-height: 44px;/);
});

test('Full Map fits short landscape viewports without reserving an empty desktop detail column', () => {
  assert.match(mapBlock, /body \.full-map-card \{/);
  assert.match(mapBlock, /--ls-full-map-size: min\(430px, calc\(var\(--ls-full-map-available-height\) - 60px - var\(--full-map-search-height\)\)\);/);
  assert.match(mapBlock, /body \.full-map-card:has\(\.full-map-info\[hidden\]\) \{[^}]*width: fit-content;/s,
    'closed info panel does not reserve the desktop detail column');
  assert.match(mapBlock, /body \.full-map-body \{[^}]*width: fit-content;[^}]*margin-inline: auto;[^}]*grid-template-columns: calc\(var\(--ls-full-map-size\) \+ 76px\) minmax\(170px, 210px\);/s);
  assert.match(mapBlock, /body \.full-map-body:has\(> \.full-map-info\[hidden\]\) \{\s*grid-template-columns: calc\(var\(--ls-full-map-size\) \+ 76px\);/);
  assert.match(mapBlock, /body \.full-map-surface \{[^}]*width: var\(--ls-full-map-size\);[^}]*height: var\(--ls-full-map-size\);[^}]*aspect-ratio: 1;/s,
    'map remains square so SVG geometry and percentage marker layers stay aligned');
  assert.match(mapBlock, /body \.full-map-info \{[^}]*max-height: var\(--ls-full-map-size\);[^}]*overflow-y: auto;/s);
  assert.match(mapBlock, /body \.full-map-controls \{[^}]*position: static;[^}]*width: 68px;[^}]*flex-direction: column;[^}]*transform: none;/s);
  assert.match(before, /\.full-map-surface \{[^}]*aspect-ratio: 1;/s,
    'portrait and desktop Full Map base contract remains unchanged');
});

test('the override changes presentation only: no JS, DOM or authority edits are implied', () => {
  assert.doesNotMatch(block, /content:|animation|@import|url\(/);
  // Touch controls are still the existing nodes, in the existing document order.
  assert.match(html, /<div id="joystick"[^>]*><div id="joystick-knob"><\/div><\/div>\s*<button id="run"[^>]*>RUN<\/button>\s*<button id="jump"[^>]*>JUMP<\/button>\s*<button id="descend"[^>]*hidden>/);
  assert.match(html, /<button id="context-action"[^>]*hidden><\/button>\s*<button id="transport-action"[^>]*hidden><\/button>/);
});
