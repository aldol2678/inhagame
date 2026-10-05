import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../campus/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('campus has exactly one tracked quest HUD and no legacy Main 01/02 HUD shells', () => {
  assert.equal((html.match(/id="quest-hud"/g) ?? []).length, 1);
  assert.equal((html.match(/id="quest-hud-open"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /id="npc-quest"|id="main2-quest"|npc-quest-bearing|main2-quest-bearing/);
  const hud = html.match(/<section\b[^>]*id="quest-hud"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(hud, /id="next-discovery"/);
  assert.match(hud, /id="next-discovery-primary"/);
});

test('quest clients no longer own visual HUD nodes while exposing target lookup for the tracked runtime quest', () => {
  assert.doesNotMatch(runtime, /document\.getElementById\(['"]npc-quest|document\.getElementById\(['"]main2-quest/);
  assert.doesNotMatch(runtime, /npc-quest-bearing|main2-quest-bearing|renderQuestGuidance/);
  assert.match(runtime, /getQuestMapObjective: legacyProgressId =>/);
  assert.match(runtime, /legacyProgressId === QUEST_ID \? quest\.mapTarget\(\)/);
  assert.match(runtime, /legacyProgressId === MAIN2_QUEST_ID \? main2Quest\.mapTarget\(\)/);
});

test('main wires the tracked HUD to Quest Runtime and updates it in the campus frame', () => {
  assert.match(main, /createTrackedQuestHud\(\{/);
  assert.match(main, /runtime: questRuntime/);
  assert.match(main, /getTarget: quest => npcTest\?\.getQuestMapObjective\?\.\(quest\.legacyProgressId\)/);
  assert.match(main, /onOpenJournal: \(\) => questJournal\.setOpen\(true\)/);
  assert.match(main, /questHud\?\.update\(\)/);
});

test('mobile single HUD keeps the Mini-map safe zone and bearing below copy', () => {
  assert.match(css, /body:has\(> #minimap:not\(\[hidden\]\)\) > \.tracked-quest-hud\s*\{[^}]*right:\s*calc\(max\(12px, env\(safe-area-inset-right\)\) \+ 120px\)/s);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.tracked-quest-hud-open\s*\{[\s\S]*?grid-template-areas:\s*"flag heading"\s*"flag objective"\s*"bearing bearing"/s);
});
