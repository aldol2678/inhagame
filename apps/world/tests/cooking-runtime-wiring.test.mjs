import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
test('closed Cooking B2 is wired into the shared B1 provider without a runtime activation flag', () => {
  assert.match(main, /import \{ createCookingFeature \} from "\.\/rooms\/cooking-feature\.js"/);
  assert.match(main, /cook: cookingFeature.handler/);
  assert.match(main, /isAvailable: feature => cookingFeature.isAvailable\(feature\)/);
  const setup = main.slice(main.indexOf('cookingFeature = createCookingFeature({'), main.indexOf('const roomFurnitureFunctions ='));
  assert.match(setup, /getRoomState: getRoomFunctionState/); assert.doesNotMatch(setup, /isAvailable:|localStorage|startupParams|true\s*[,}]/);
  assert.match(setup, /getUserId: \(\) => roomFunctionAccountId/);
});
test('cooking acquires blocking focus and closes on takeover, account reset, transitions and pagehide', () => {
  assert.match(main, /ownerId: "room-cooking", policy: INPUT_FOCUS_POLICY.BLOCKING_UI/);
  assert.match(main, /if \(!open\) \{ cookingInput.release\(\)/);
  assert.match(main, /snapshot.topOwners.some\(owner => owner !== "room-cooking"\)/);
  assert.match(main, /const nextRoomFunctionAccountId = identity\?\.userId \?\? null;\s*const roomFunctionIdentityChanged = nextRoomFunctionAccountId !== roomFunctionAccountId;\s*roomFunctionAccountId = nextRoomFunctionAccountId;\s*if \(roomFunctionIdentityChanged\) \{\s*cookingFeature\?\.reset\(\)/);
  assert.match(main, /accountId: roomFunctionAccountId && roomFunctionAccountId === online\?\.userId \? roomFunctionAccountId : null/);
  assert.match(main, /pagehide", \(\) => \{ cookingFeature.reset\(\)/);
  assert.match(main, /cookingFeature\?\.reset\(\);\n\s+trophyDisplayPanel\?\.close/);
  assert.match(main, /cookingFeature.update\(\);\n\s+contextActions.set\("room-furniture"/);
  assert.match(main, /fullMap\?\.close\(\); smartphone\?\.close\(\)/);
});
