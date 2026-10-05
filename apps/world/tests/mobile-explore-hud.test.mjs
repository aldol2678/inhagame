import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const worldDir = fileURLToPath(new URL('../', import.meta.url));
const css = readFileSync(join(worldDir, 'styles.css'), 'utf8');

const START = '/* EXPLORE-MOBILE-HUD:start';
const END = '/* EXPLORE-MOBILE-HUD:end */';
const startIndex = css.indexOf(START);
const endIndex = css.indexOf(END);
const section = css.slice(startIndex, endIndex + END.length);

test('Explore mobile polish is a bounded presentation-only block before the landscape override', () => {
  assert.ok(startIndex > 0 && endIndex > startIndex, 'Explore mobile HUD markers exist');
  assert.ok(endIndex < css.indexOf('/* LANDSCAPE-HUD:start'), 'base touch polish precedes the landscape-specific override');
  assert.match(section, /@media \(pointer: coarse\)/);
  assert.match(section, /body\[data-hud-mode="EXPLORE"\]\[data-hud-overlay="NONE"\]/);
  assert.doesNotMatch(section, /display:\s*none\s*!important/);
  assert.doesNotMatch(section, /content:|@import|url\(/);
});

test('portrait Explore uses a Mini-map -> tracked quest right rail', () => {
  assert.match(section, /@media \(pointer: coarse\) and \(orientation: portrait\) and \(max-width: 720px\)/);
  assert.match(section, /:has\(> #minimap:not\(\[hidden\]\)\) > \.tracked-quest-hud \{[^}]*top: calc\(var\(--world-right-rail-top\) \+ var\(--world-right-rail-map-size\) \+ 8px\);[^}]*right: var\(--world-right-rail-right\);[^}]*left: auto;[^}]*max-width: 204px;/s, 'Explore selector matches the legacy #minimap specificity so the quest stays directly under the map');
  assert.match(section, /grid-template-areas: "flag objective bearing";/);
  assert.match(section, /> \.tracked-quest-hud \.tour-heading \{\s*display: none;\s*\}/);
});

test('tracked quest reserves the event rail below it instead of overlapping event UI', () => {
  assert.match(section, /:has\(> #quest-hud:not\(\[hidden\]\)\) \{\s*--world-right-rail-event-top: calc\([\s\S]*var\(--world-right-rail-map-size\) \+ 62px[\s\S]*\);\s*\}/);
});

test('Explore keeps all social actions while visually prioritising chat', () => {
  assert.match(section, /\.social-cluster #nearby-toggle,[\s\S]*\.social-cluster #emote-toggle \{\s*opacity: \.84;/);
  assert.match(section, /\.social-cluster #chat-toggle \{[^}]*background: rgba\(24, 91, 137, \.92\);[^}]*box-shadow:/s);
  assert.doesNotMatch(section, /#nearby-toggle[^}]*display:\s*none/);
  assert.doesNotMatch(section, /#emote-toggle[^}]*display:\s*none/);
});

test('Explore context action remains the shared control and receives only presentation polish', () => {
  assert.match(section, /#context-action \{[^}]*border-color: rgba\(174, 229, 255, \.88\);[^}]*background: rgba\(24, 91, 137, \.94\);/s);
  assert.doesNotMatch(section, /#context-action[^}]*position:/);
  assert.doesNotMatch(section, /#context-action[^}]*left:/);
  assert.doesNotMatch(section, /#context-action[^}]*right:/);
});
