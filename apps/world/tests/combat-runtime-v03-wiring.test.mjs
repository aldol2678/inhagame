import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const main = readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('../campus/index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');

test('Building 5 Combat v0.3 runtime is wired into the shared World interaction slot', () => {
  assert.match(main, /createCombatRuntimeV03\(\)/);
  assert.match(main, /createBuilding5CombatInteraction\(\{ runtime: combatRuntime \}\)/);
  assert.match(main, /contextActions\.set\("building5-combat", building5CombatAction\)/);
  assert.match(main, /hudContext\.setMode\(state\.active \? HUD_MODE\.COMBAT : HUD_MODE\.EXPLORE\)/);
});

test('Combat v0.3 PC input preserves v9.22 action grammar without replacing World authority', () => {
  assert.match(main, /combatRuntime\.dispatch\("ultimate"\)/);
  assert.match(main, /"Digit1" \? "active_1"/);
  assert.match(main, /"Digit2" \? "active_2"/);
  assert.match(main, /"Digit3" \? "active_3"/);
  assert.match(main, /"ShiftLeft" \|\| event\.code === "ShiftRight" \? "dodge"/);
  assert.match(main, /event\.button === 0\) combatRuntime\.dispatch\("basic"\)/);
  assert.match(main, /combatRuntime\.toggleLock\(\)/);
  assert.match(main, /event\.code === "Escape"[\s\S]*combatRuntime\.end\("PLAYER_EXIT"\)/);
  assert.doesNotMatch(main, /world_combat_start_v1/);
});

test('Combat v0.3 mobile HUD exposes all six action surfaces and hides incompatible Explore controls', () => {
  for (const action of ['basic','active_1','active_2','active_3','dodge','ultimate']) {
    assert.match(html, new RegExp(`data-combat-action="${action}"`));
  }
  assert.match(css, /COMBAT-V03-RUNTIME-P0:start/);
  assert.match(css, /body\[data-hud-mode="COMBAT"\] #transport-action/);
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});

test('Combat v0.3 local training disables resume and transport while active', () => {
  assert.match(main, /controller\.setTransportGate\(\(\) => !worldActionsSuspended\(\)\);/);
  assert.match(main, /controller\.setTransportLock\("combat-v03", state\.active\)/);
  assert.match(main, /enabled: firstPlayerMovement && !npcTestMode && !combatRuntime\.active/);
  assert.match(main, /transportActions\.set\("mount", null\)/);
});
