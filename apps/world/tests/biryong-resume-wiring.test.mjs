import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const saveCall = source.match(/  resumeStore\.maybeSave\(\{[\s\S]*?\n  \}\);/)[0];
function savedOptions(extra = {}) {
  let result;
  vm.runInNewContext(saveCall, { resumeStore: { maybeSave: options => { result = options; } },
    pos: { x: 0, y: 1.15, z: 75 }, player: { getLocalEulerAngles: () => ({ y: 47 }) }, orbit: { yaw: .8 },
    place: { id: 'BR_MARKET' }, controller: { grounded: true, mounted: false }, inside: true,
    rooms: { insideRoom: false, status: () => ({ busy: false }) },
    biryongRealm: { regionId: 'BIRYONG_REALM', busy: false }, WORLD_REGION_ID: { CAMPUS: 'CAMPUS' },
    inBiryong: true, firstPlayerMovement: true, npcTestMode: false, combatRuntime: { active: false },
    lobbyWorld: { active: false }, lobbyTransition: { active: false }, ...extra });
  return result;
}
test('production save treats the Biryong outdoor region separately from actual room exclusion', () => {
  const options = savedOptions();
  assert.equal(options.insideRoom, false);
  assert.equal(options.regionId, 'BIRYONG_REALM');
  assert.equal(options.enabled, true);
});
test('production save explicitly blocks region, room and lobby transitions plus combat', () => {
  for (const extra of [{ biryongRealm: { regionId: 'BIRYONG_REALM', busy: true } },
    { rooms: { insideRoom: false, status: () => ({ busy: true }) } }, { lobbyTransition: { active: true } }]) {
    const options = savedOptions(extra);
    assert.equal(options.transitioning || options.enabled === false, true);
  }
  const options = savedOptions({ combatRuntime: { active: true } });
  assert.equal(options.inCombat || options.enabled === false, true);
});
test('initial and account-rebound resume entries both resolve the live Biryong transition', () => {
  const init = source.slice(source.indexOf('const resumeEntry = bindResumeEntry({'), source.indexOf('const backGateLock'));
  assert.match(init, /getRegionTransition:\s*\(\) => biryongRealm/);
  const scope = readFileSync(new URL('../src/lobby/world-resume-account-scope.js', import.meta.url), 'utf8');
  assert.match(scope, /getRegionTransition:\s*\(\) => world\.biryongRealm/);
});
test('region transaction suspends frame observers before lobby and gameplay coordinate readers', () => {
  const frame = source.slice(source.indexOf('app.on("update", (dt) => {'));
  const guard = frame.indexOf('rooms.status().busy || biryongRealm?.busy');
  assert.ok(guard >= 0 && guard < frame.indexOf('if (lobbyWorld.active || lobbyTransition.active)'));
});

test('a fresh Biryong resume keeps saving without first moving through Campus', () => {
  assert.equal(savedOptions({ firstPlayerMovement: false }).enabled, true);
  assert.equal(savedOptions({ firstPlayerMovement: false, inBiryong: false }).enabled, false);
});

test('pagehide cancels pending regional resume including BFCache suspension', () => {
  assert.match(source, /window\.addEventListener\("pagehide", event => \{\s*biryongRealm\?\.cancelResume\(\);\s*if \(!event\.persisted\)/);
});
