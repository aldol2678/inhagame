import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitCameraController } from '../src/orbit-camera-controller.js';
import { createBiryongRealmWorldAdapter, BIRYONG_REALM_MOVEMENT_SPACE } from '../src/biryong/biryong-realm-world-adapter.js';
import { createBiryongRealmTransition } from '../src/biryong/biryong-realm-transition.js';
import { BIRYONG_REALM_P0_OBSTACLES } from '../src/biryong/biryong-village-layout.js';
import { BIRYONG_STATION_BUILDING } from '../src/biryong/biryong-realm-layout.js';
import { CAMPUS_MOVEMENT_SPACE } from '../src/player-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createInputFocusOwner } from '../src/input/input-focus-owner.js';
import { cameraSafeFraction } from '../src/world-collision.js';

function fixture({ fade, failAt } = {}) {
  globalThis.document = { getElementById: () => null, body: { dataset: {} } };
  globalThis.window = { addEventListener() {} };
  const camera = { camera: { fov: 50, aspectRatio: 16 / 9 }, setPosition(...p) { this.position = p; }, lookAt() {} };
  const orbit = new OrbitCameraController(camera, { addEventListener() {} });
  const campusRoot = { enabled: true }, biryongRoot = { enabled: false };
  let position = { x: 12, y: 1.15, z: -82 }, yaw = 32, fail = failAt;
  const player = {
    parent: campusRoot,
    reparent(parent) { this.parent = parent; },
    getLocalPosition: () => ({ ...position }),
    setLocalPosition(x, y, z) { position = { x, y, z }; if (fail === 'place') { fail = null; throw new Error('place failed'); } },
    getLocalEulerAngles: () => ({ y: yaw }),
    setLocalEulerAngles(x, y) { yaw = y; }
  };
  const controller = { space: CAMPUS_MOVEMENT_SPACE, setMovementSpace(space) { this.space = space; } };
  const online = { campusPaused: false, pauseCampus() { this.campusPaused = true; }, resumeCampus() { this.campusPaused = false; } };
  const world = createBiryongRealmWorldAdapter({ player, controller, orbit, campusRoot, biryongRoot,
    getOnline: () => online, markRegion() { if (fail === 'mark') { fail = null; throw new Error('mark failed'); } } });
  let now = 1000;
  const errors = [], events = [];
  const focus = createInputFocusManager();
  const input = createInputFocusOwner({ manager: focus, ownerId: "biryong-region", policy: INPUT_FOCUS_POLICY.SYSTEM_LOCK });
  const transition = createBiryongRealmTransition({ world, campusReturnAnchor: { x: 12, y: 1.15, z: -82 },
    clock: { now: () => now }, fade, onBusyChange: busy => busy ? input.acquire() : input.release(), onError: error => errors.push(error) });
  transition.onChange((status, event) => events.push({ status, event }));
  return { focus, input, events, orbit, camera, world, transition, player, controller, online, campusRoot, biryongRoot, errors,
    advance() { now += 1000; }, failNext(where) { fail = where; } };
}
const station = BIRYONG_STATION_BUILDING;
const regionObstacles = [...BIRYONG_REALM_P0_OBSTACLES, { id: station.id,
  minX: station.x - station.width / 2, maxX: station.x + station.width / 2,
  minY: station.y - station.height / 2, maxY: station.y + station.height / 2,
  minZ: station.z - station.depth / 2, maxZ: station.z + station.depth / 2 }];
const npcApproach = { x: -4.7, y: 1.15, z: 19.93 };
const eyeOf = p => [p.x, p.y - .35, p.z];
function candidate(orbit, p) {
  const horizontal = Math.cos(Math.max(.12, orbit.pitch)) * orbit.distance - .35;
  return [p.x + Math.sin(orbit.yaw) * horizontal,
    p.y - .35 + Math.sin(Math.max(.12, orbit.pitch)) * orbit.distance,
    p.z - Math.cos(orbit.yaw) * horizontal];
}
function expectedPosition(orbit, p, obstacles) {
  const from = eyeOf(p), to = candidate(orbit, p);
  const f = cameraSafeFraction(from, to, obstacles);
  return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, -(from[2] + (to[2] - from[2]) * f)];
}
function close(actual, expected) { actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-8, `${actual} != ${expected}`)); }

test('Biryong NPC approach uses its real obstacles instead of campus buildings at matching coordinates', () => {
  const f = fixture();
  assert.equal(cameraSafeFraction(eyeOf(npcApproach), candidate(f.orbit, npcApproach)), .06, 'reproduces old campus hit');
  assert.equal(cameraSafeFraction(eyeOf(npcApproach), candidate(f.orbit, npcApproach), BIRYONG_REALM_P0_OBSTACLES), 1);
  f.world.showBiryong();
  f.orbit.apply(npcApproach);
  close(f.camera.position, expectedPosition(f.orbit, npcApproach, regionObstacles));
  assert.equal(f.orbit.distance, 3.5);
  assert.equal(f.orbit.indoor, null, 'outdoor region retains walking zoom and camera mode');
});

test('actual Biryong station and village walls still compress the camera', () => {
  const f = fixture(); f.world.showBiryong();
  for (const box of [regionObstacles.at(-1), regionObstacles.find(box => box.id === 'br_inn')]) {
    const xs = box.polygon?.map(p => p.x) ?? [box.minX, box.maxX];
    const zs = box.polygon?.map(p => p.z) ?? [box.minZ, box.maxZ];
    const p = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: 1.15, z: Math.min(...zs) - .6 };
    f.orbit.yaw = Math.PI;
    const fraction = cameraSafeFraction(eyeOf(p), candidate(f.orbit, p), regionObstacles);
    assert.ok(fraction < 1);
    f.orbit.apply(p); close(f.camera.position, expectedPosition(f.orbit, p, regionObstacles));
  }
});

test('campus return restores the default collision policy including main-gate finite outlines', () => {
  const f = fixture(); f.world.showBiryong(); f.world.showCampus();
  for (const p of [npcApproach, { x: .5, y: 1.15, z: -92.6 }]) {
    f.orbit.apply(p); close(f.camera.position, expectedPosition(f.orbit, p));
  }
  assert.equal(f.controller.space, CAMPUS_MOVEMENT_SPACE);
});

test('indoor camera obstacles override the outdoor region and exiting indoors restores the region', () => {
  const f = fixture(); f.world.showBiryong();
  f.orbit.setIndoor({ obstacles: [] });
  f.orbit.apply(npcApproach); close(f.camera.position, expectedPosition(f.orbit, npcApproach, []));
  f.orbit.setIndoor(null);
  f.orbit.apply(npcApproach); close(f.camera.position, expectedPosition(f.orbit, npcApproach, regionObstacles));
});

test('failed Biryong entry restores campus movement, camera, roots and presence', () => {
  for (const failAt of ['place', 'mark']) {
    const f = fixture({ failAt });
    const before = f.player.getLocalPosition();
    assert.doesNotThrow(() => f.transition.enter());
    assert.equal(f.transition.inCampus, true);
    assert.equal(f.transition.busy, false);
    assert.equal(f.controller.space, CAMPUS_MOVEMENT_SPACE);
    assert.equal(f.player.parent, f.campusRoot);
    assert.deepEqual(f.player.getLocalPosition(), before);
    assert.equal(f.campusRoot.enabled, true); assert.equal(f.biryongRoot.enabled, false);
    assert.equal(f.online.campusPaused, false);
    f.orbit.apply(npcApproach); close(f.camera.position, expectedPosition(f.orbit, npcApproach));
    assert.equal(f.errors.length, 1); assert.equal(f.errors[0].recovered, true);
    assert.deepEqual(f.transition.status().stats, { enters: 0, exits: 0 });
  }
});

test('failed campus return preserves the active Biryong camera and never publishes a Biryong pose in campus', () => {
  const f = fixture(); f.transition.enter(); f.advance();
  const before = f.player.getLocalPosition(); f.failNext('place');
  assert.doesNotThrow(() => f.transition.returnToCampus());
  assert.equal(f.transition.inBiryong, true); assert.equal(f.transition.busy, false);
  assert.equal(f.controller.space, BIRYONG_REALM_MOVEMENT_SPACE);
  assert.equal(f.player.parent, f.biryongRoot); assert.deepEqual(f.player.getLocalPosition(), before);
  assert.equal(f.online.campusPaused, true);
  f.orbit.apply(npcApproach); close(f.camera.position, expectedPosition(f.orbit, npcApproach, regionObstacles));
});

test('fade rejection after scene switch restores the source camera and settles the input lock', async () => {
  const f = fixture({ fade: async run => { run(); throw new Error('fade failed'); } });
  f.transition.enter(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.transition.inCampus, true); assert.equal(f.transition.busy, false);
  assert.equal(f.errors.length, 1);
  f.orbit.apply(npcApproach); close(f.camera.position, expectedPosition(f.orbit, npcApproach));
});

test('dispose restores campus camera policy and invalidates an unexecuted fade callback', () => {
  let run;
  const f = fixture({ fade: callback => { run = callback; } });
  f.transition.enter(); f.transition.dispose(); run();
  assert.equal(f.transition.inCampus, true);
  assert.equal(f.controller.space, CAMPUS_MOVEMENT_SPACE);
  assert.equal(f.transition.enter(), false);
  f.orbit.apply(npcApproach); close(f.camera.position, expectedPosition(f.orbit, npcApproach));
  f.transition.dispose();
});

test('region identity follows the switched coordinate frame while fade cleanup keeps travel locked', async () => {
  let finishFade;
  const f = fixture({ fade: run => { run(); return new Promise(resolve => { finishFade = resolve; }); } });
  f.transition.enter();
  assert.equal(f.transition.inBiryong, true);
  assert.equal(f.transition.busy, true);
  assert.equal(f.transition.returnToCampus(), false);
  assert.equal(f.controller.space, BIRYONG_REALM_MOVEMENT_SPACE);
  finishFade(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.transition.busy, false);
  assert.equal(f.transition.status().stats.enters, 1);
});

test('active region disposal releases its camera ownership without resuming campus presence', () => {
  const f = fixture(); f.transition.enter(); f.transition.dispose();
  f.orbit.apply(npcApproach); close(f.camera.position, expectedPosition(f.orbit, npcApproach));
  assert.equal(f.online.campusPaused, true);
  assert.equal(f.transition.status().ready, false);
});

test('non-persisted pagehide disposes Biryong transition and recovery feedback is wired', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(!event\.persisted\) \{\s*biryongRealm\?\.dispose\(\);\s*biryongVillageDialogue/);
  const start = main.indexOf('biryongRealm = createBiryongRealmTransition({');
  assert.match(main.slice(start, main.indexOf('world: createBiryongRealmWorldAdapter', start)), /onError:[\s\S]*showWorldStatus/);
});


test('focus acquisition error stays fail-closed before camera or world mutation', () => {
  const f = fixture();
  f.focus.subscribe(() => { throw new Error('focus acquisition subscriber failed'); });
  assert.doesNotThrow(() => f.transition.enter());
  assert.equal(f.transition.busy, true); assert.equal(f.transition.status().ready, false);
  assert.equal(f.transition.inCampus, true); assert.equal(f.player.parent, f.campusRoot);
  assert.equal(f.online.campusPaused, false); assert.equal(f.orbit.outdoorObstacles, undefined);
  assert.equal(f.errors[0].recovered, false); assert.equal(f.errors[0].phase, 'input');
  assert.equal(f.transition.status().stats.enters, 0);
});

for (const asyncFade of [false, true]) test(`focus release error keeps committed Biryong identity and reasserts lock (async=${asyncFade})`, async () => {
  const f = fixture({ fade: asyncFade ? async run => run() : run => run() });
  f.focus.subscribe(state => { if (state.activeClaimCount === 0) throw new Error('focus release subscriber failed'); });
  assert.doesNotThrow(() => f.transition.enter());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.transition.inBiryong, true); assert.equal(f.player.parent, f.biryongRoot);
  assert.equal(f.transition.status().stats.enters, 1); assert.deepEqual(f.events.map(e => e.event), ['enter']);
  assert.equal(f.transition.busy, true); assert.equal(f.input.active, true);
  assert.equal(f.focus.can('MOVEMENT'), false);
  assert.equal(f.errors.length, 1); assert.equal(f.errors[0].recovered, false); assert.equal(f.errors[0].phase, 'input');
});

test('focus release error after rollback leaves restored source locked and reports failure', () => {
  const f = fixture({ failAt: 'place' });
  f.focus.subscribe(state => { if (state.activeClaimCount === 0) throw new Error('focus release subscriber failed'); });
  assert.doesNotThrow(() => f.transition.enter());
  assert.equal(f.transition.inCampus, true); assert.equal(f.player.parent, f.campusRoot);
  assert.equal(f.transition.status().stats.enters, 0); assert.equal(f.events.length, 0);
  assert.equal(f.transition.busy, true); assert.equal(f.input.active, true);
  assert.equal(f.errors.length, 1); assert.equal(f.errors[0].recovered, false);
});

test('falsy rollback exceptions still require reload and cannot unlock partial region state', () => {
  const f = fixture({ failAt: 'place' });
  f.world.createCheckpoint = () => () => { throw undefined; };
  assert.doesNotThrow(() => f.transition.enter());
  assert.equal(f.transition.busy, true); assert.equal(f.errors[0].recovered, false);
  assert.ok(f.errors[0].recoveryError instanceof Error);
});

test('hosted Biryong QA executes the pinned camera engine readback before pixel acceptance', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile(new URL('../../../.github/workflows/biryong-map-guidance-browser.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('run: node apps/world/tests/browser/biryong-camera-null-smoke.mjs'));
  assert.ok(workflow.includes("- 'apps/world/src/orbit-camera-controller.js'"));
});
