import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../campus/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/quest/quest-runtime.js', import.meta.url), 'utf8');
const journal = readFileSync(new URL('../src/quest/quest-journal.js', import.meta.url), 'utf8');

test('Quest Journal shell is reachable from the campus menu and labeled as one dialog', () => {
  assert.match(html, /id="open-quest-journal"[^>]*aria-controls="quest-journal-panel"/);
  assert.match(html, /id="quest-journal-panel"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /aria-keyshortcuts="Q"/);
});

test('main wires one blocking Quest Journal that closes competing modal surfaces', () => {
  assert.match(main, /ownerId: "quest-journal".*INPUT_FOCUS_POLICY\.BLOCKING_UI/s);
  assert.match(main, /const questRuntime = createQuestRuntime\(\)/);
  assert.match(main, /questJournal = createQuestJournal\(\{/);
  assert.match(main, /questJournalInput\.acquire\(\)/);
  assert.match(main, /fullMap\?\.close\?\.\(\)/);
  assert.match(main, /shopPanel\.setOpen\(false\)[\s\S]*inventoryPanel\.setOpen\(false\)[\s\S]*wardrobePanel\.setOpen\(false\)/);
  assert.match(main, /event\.code !== "KeyQ"/);
});

test('Quest Runtime consumes legacy state changes without owning quest writes', () => {
  assert.match(main, /onQuestStateChange: progress => \{[\s\S]*?nextDiscovery\?\.syncProgress\(progress\)/);
  assert.match(main, /onProgress: progress => questRuntime\.update\(progress\)/);
  assert.doesNotMatch(runtime, /fetch\s*\(|supabase|rpc\s*\(/i);
  assert.doesNotMatch(journal, /fetch\s*\(|supabase|rpc\s*\(/i);
});

test('Quest Journal uses canonical POI navigation and responsive two-to-one-column layout', () => {
  assert.match(main, /campusMapDataSource\?\.poiRegistry\?\.\(\)\.get\?\.\(navigationTarget\)/);
  assert.match(main, /campusNavigation\.poiTarget\(poi, CAMPUS_NAV_SPACE\)/);
  assert.match(css, /\.quest-journal-body\s*\{[^}]*grid-template-columns:\s*minmax\(210px, 250px\) minmax\(0, 1fr\)/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.quest-journal-body\s*\{[^}]*grid-template-columns:\s*1fr/s);
});
