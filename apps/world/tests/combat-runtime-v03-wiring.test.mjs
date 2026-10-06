import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const main = readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('../campus/index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');

test('Building 5 Combat v0.3 runtime is wired into the shared World interaction slot', () => {
  assert.match(main, /createBuilding5CombatTraining\(\{/);
  assert.match(main, /createCombatRuntimeV03\(\{ localTraining: building5Training \}\)/);
  assert.match(main, /createBuilding5CombatTargetRenderer\(\{/);
  assert.match(main, /createCombatWorldMotionV03\(\{/);
  assert.match(main, /createCombatFeedbackV03\(\{/);
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
  assert.match(main, /event\.code === "KeyR"[\s\S]*combatRuntime\.resetTrainingTarget\(\)/);
  assert.doesNotMatch(main, /world_combat_start_v1/);
  assert.match(main, /combatRuntime\.update\(\)/);
  assert.match(main, /combatTargetRenderer\.update\(dt\)/);
  assert.match(main, /combatWorldMotion\.update\(\)/);
  assert.match(main, /combatFeedback\.hitstopActive\(\)/);
  assert.match(main, /poseOffsets: combatFeedback\.poseOffsets\(\) \?\? biryong\?\.poseOffsets\(\) \?\? null/);
});

test('Production removes the prototype combat panel while retaining runtime feedback', () => {
  assert.doesNotMatch(html, /combat-hud-v03|data-combat-(action|reset|player-hp|target-hp|target-break|ult-gauge)/);
  assert.doesNotMatch(html, /BLASTER|FREE AIM|훈련 재시작/);
  assert.doesNotMatch(main, /createCombatHudV03|combatHud/);
  assert.match(html, /id="combat-impact-feedback"/);
  assert.match(css, /combat-camera-kick/);
  assert.match(css, /combat-impact-flash/);
  assert.match(css, /body\[data-hud-mode="COMBAT"\] #transport-action/);
});

test('Combat v0.3 local training disables resume and transport while active', () => {
  assert.match(main, /controller\.setTransportGate\(\(\) => !worldActionsSuspended\(\)\);/);
  assert.match(main, /controller\.setTransportLock\("combat-v03", state\.active\)/);
  assert.match(main, /controller\.combatDodgeDirection\(orbit\.yaw/);
  assert.match(main, /enabled: \(firstPlayerMovement \|\| inBiryong\) && !npcTestMode && !combatRuntime\.active/);
  assert.match(main, /transportActions\.set\("mount", null\)/);
});
