import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const environmentWorldTime = readFileSync(
  new URL('../src/environment/environment-world-time.js', import.meta.url),
  'utf8'
);
const npcRuntime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
const worldTimeHud = readFileSync(new URL('../src/hud/world-time-hud.js', import.meta.url), 'utf8');

test('production environment and NPC runtime share one server-anchored world clock', () => {
  assert.match(main, /const worldClock = previewHost \? null : createNpcWorldClock\(\);/);
  assert.match(main, /createEnvironmentWorldTime\(\{[\s\S]*clock: worldClock,[\s\S]*enabled: worldClock !== null/);
  assert.match(main, /sharedSchedulePreview: npcSharedScheduleMode,\s*worldClock,/);
  assert.match(npcRuntime, /sharedSchedulePreview = false, worldClock = null,/);
  assert.match(npcRuntime, /worldClock = sharedSchedulePreview \? \(worldClock \?\? createNpcWorldClock\(\)\) : null;/);
});

test('environment world-time bridge never reads the client wall clock', () => {
  assert.doesNotMatch(environmentWorldTime, /Date\.now\s*\(/);
  assert.match(environmentWorldTime, /worldScheduleAt\(serverNowMs\)/);
  assert.match(environmentWorldTime, /morning: 'DAY'/);
  assert.match(environmentWorldTime, /evening: 'SUNSET'/);
  assert.match(environmentWorldTime, /night: 'NIGHT'/);
});


test('world-time HUD is a read-only projection of the shared server-anchored clock', () => {
  assert.match(main, /createWorldTimeHud\(\{[\s\S]*element: worldTimeEl,[\s\S]*getStatus: \(\) => environmentWorldTime\.status\(\)/);
  assert.match(main, /worldTimeHud\.update\(dt\)/);
  assert.match(main, /__INHAGAME_WORLD_TIME_HUD__/);
  assert.doesNotMatch(worldTimeHud, /Date\.now\s*\(/);
  assert.doesNotMatch(worldTimeHud, /new Date\s*\(/);
});
