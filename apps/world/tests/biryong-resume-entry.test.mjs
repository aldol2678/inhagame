import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiryongRealmWorldAdapter, BIRYONG_REALM_MOVEMENT_SPACE, BIRYONG_REALM_CAMERA_OBSTACLES } from '../src/biryong/biryong-realm-world-adapter.js';
import { createBiryongRealmTransition } from '../src/biryong/biryong-realm-transition.js';
import { createLobbyWorldMode } from '../src/lobby/lobby-world.js';
import { bindResumeEntry } from '../src/lobby/lobby-resume.js';
import { CAMPUS_MOVEMENT_SPACE } from '../src/player-controller.js';

const record = () => ({ version: 2, regionId: 'BIRYONG_REALM', x: 0, y: 1.15, z: 75,
  yawDeg: 47, cameraYaw: .8, savedAt: 10_000, displayName: '중앙시장', zoneId: 'BR_MARKET' });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ fade, failAt } = {}) {
  const campusRoot = { enabled: true }, biryongRoot = { enabled: false };
  const player = { parent: campusRoot, position: { x: 0, y: 1.15, z: -76 }, yaw: 0,
    getLocalPosition() { return { ...this.position }; }, getLocalEulerAngles() { return { y: this.yaw }; },
    setLocalPosition(x, y, z) { this.position = { x, y, z }; },
    setLocalEulerAngles(_x, y) { this.yaw = y; }, reparent(parent) { this.parent = parent; } };
  const controller = { space: CAMPUS_MOVEMENT_SPACE, setMovementSpace(s) { this.space = s; }, setInputEnabled(v) { this.inputEnabled = v; } };
  const orbit = { yaw: 1, pitch: .35, distance: 3.5, setIndoor(v) { this.indoor = v; },
    setOutdoorObstacles(v) { this.outdoorObstacles = v; }, setInputEnabled(v) { this.inputEnabled = v; } };
  const online = { campusPaused: false, pauseCampus() { this.campusPaused = true; }, resumeCampus() { this.campusPaused = false; } };
  const shell = { hidden: false }, root = { dataset: {} };
  const documentLike = { body: root, getElementById: id => id === 'world-lobby' ? shell : null };
  const lobbyWorld = createLobbyWorldMode({ player, controller, orbit, root }); lobbyWorld.enter();
  const world = createBiryongRealmWorldAdapter({ player, controller, orbit, campusRoot, biryongRoot, getOnline: () => online });
  if (failAt) { const original = world[failAt]; let failed = false; world[failAt] = (...args) => {
    original(...args); if (!failed) { failed = true; throw Error('injected adapter failure'); }
  }; }
  let now = 1000;
  const errors = [], changes = [];
  const region = createBiryongRealmTransition({ world, campusReturnAnchor: { x: 0, y: 1.15, z: -76 },
    clock: { now: () => now }, fade, onError: info => errors.push(info) });
  region.onChange(status => changes.push(status));
  const lobbyTransition = { active: false };
  const button = { hidden: true, addEventListener() {}, removeEventListener() {} };
  const bind = (value = record()) => bindResumeEntry({ button, resume: { state: 'VALID', record: value }, player, orbit,
    lobbyWorld, transition: lobbyTransition, getRegionTransition: () => region, documentLike });
  const entry = bind();
  return { entry, bind, player, controller, orbit, online, region, lobbyWorld, campusRoot, biryongRoot, errors, changes, shell, lobbyTransition,
    advance() { now += 1000; } };
}

test('last-location entry restores Biryong roots, collision, presence and saved camera before leaving the lobby', () => {
  const f = fixture();
  assert.equal(f.entry.start(), true);
  assert.equal(f.region.inBiryong, true);
  assert.equal(f.player.parent, f.biryongRoot);
  assert.equal(f.controller.space, BIRYONG_REALM_MOVEMENT_SPACE);
  assert.equal(f.orbit.outdoorObstacles, BIRYONG_REALM_CAMERA_OBSTACLES);
  assert.equal(f.online.campusPaused, true);
  assert.deepEqual(f.player.position, { x: 0, y: 1.15, z: 75 });
  assert.equal(f.player.yaw, 47); assert.equal(f.orbit.yaw, .8);
  assert.equal(f.orbit.pitch, .35); assert.equal(f.orbit.distance, 3.5);
  assert.equal(f.lobbyWorld.active, false); assert.equal(f.shell.hidden, true);
  assert.equal(f.changes.length, 1, 'existing region observers receive one successful handoff');
  assert.equal(f.entry.start(), false);
  f.advance(); assert.equal(f.region.returnToCampus(), true);
  assert.equal(f.player.parent, f.campusRoot); assert.equal(f.online.campusPaused, false);
});

test('regional resume holds the lobby during fade, blocks duplicate starts and leaves only after settlement', async () => {
  let run, finish;
  const f = fixture({ fade: callback => { run = callback; return new Promise(r => { finish = r; }); } });
  assert.equal(f.entry.start(), true); assert.equal(f.entry.start(), false);
  assert.equal(f.lobbyWorld.active, true); assert.equal(f.region.inCampus, true);
  run();
  assert.equal(f.region.inBiryong, true); assert.equal(f.region.busy, true);
  assert.equal(f.lobbyWorld.active, true); assert.equal(f.changes.length, 0);
  finish(); await flush();
  assert.equal(f.lobbyWorld.active, false); assert.equal(f.region.busy, false);
  assert.equal(f.changes.length, 1);
});

for (const afterSwitch of [false, true]) test(`scope rebind cancels ${afterSwitch ? 'switched' : 'queued'} resume and ignores late fade`, async () => {
  let run, finish;
  const f = fixture({ fade: callback => { run = callback; return new Promise(r => { finish = r; }); } });
  const before = f.player.getLocalPosition();
  f.entry.start(); if (afterSwitch) run();
  f.entry.destroy();
  assert.equal(f.entry.start(), false, 'retained account A callback cannot start after rebinding');
  run(); finish(); await flush();
  assert.equal(f.region.inCampus, true); assert.equal(f.region.busy, false);
  assert.equal(f.player.parent, f.campusRoot); assert.deepEqual(f.player.position, before);
  assert.equal(f.online.campusPaused, false); assert.equal(f.lobbyWorld.active, true);
  assert.equal(f.changes.length, 0); assert.equal(f.errors.length, 0, 'intentional cancellation is not an error toast');
  assert.equal(f.bind().start(), true, 'the new binding can retry after fade cleanup');
  f.entry.destroy(); // Repeated cleanup of the old binding cannot cancel the new account.
  run(); finish(); await flush();
  assert.equal(f.region.inBiryong, true); assert.equal(f.lobbyWorld.active, false);
});

for (const failAt of ['leaveCampus', 'showBiryong', 'placePlayer']) test(`resume adapter failure at ${failAt} restores safe campus lobby`, () => {
  const f = fixture({ failAt }); const before = f.player.getLocalPosition();
  assert.equal(f.entry.start(), true);
  assert.equal(f.region.inCampus, true); assert.equal(f.lobbyWorld.active, true);
  assert.equal(f.online.campusPaused, false); assert.deepEqual(f.player.position, before);
  assert.equal(f.errors[0].recovered, true); assert.equal(f.changes.length, 0);
  assert.equal(f.entry.start(), true); assert.equal(f.region.inBiryong, true);
});

test('fade rejection after switching cannot leave a Biryong coordinate in the campus lobby', async () => {
  const f = fixture({ fade: async run => { run(); throw Error('fade rejected'); } });
  const before = f.player.getLocalPosition(); f.entry.start(); await flush();
  assert.equal(f.region.inCampus, true); assert.deepEqual(f.player.position, before);
  assert.equal(f.online.campusPaused, false); assert.equal(f.lobbyWorld.active, true);
  assert.equal(f.changes.length, 0); assert.equal(f.errors[0].recovered, true);
});

test('invalid Biryong record is refused before any regional or local player mutation', () => {
  const f = fixture(); const before = f.player.getLocalPosition();
  assert.equal(f.bind({ ...record(), x: -24, z: 58 }).start(), false);
  assert.deepEqual(f.player.position, before); assert.equal(f.region.inCampus, true);
  assert.equal(f.lobbyWorld.active, true); assert.equal(f.online.campusPaused, false);
});

test('disposal invalidates regional resume and its late completion', async () => {
  let run, finish;
  const f = fixture({ fade: callback => { run = callback; return new Promise(r => { finish = r; }); } });
  f.entry.start(); f.region.dispose(); run(); finish(); await flush();
  assert.equal(f.region.inCampus, true); assert.equal(f.lobbyWorld.active, true);
  assert.equal(f.changes.length, 0); assert.equal(f.entry.start(), false);
});

for (const afterSwitch of [false, true]) test(`a newer lobby start supersedes ${afterSwitch ? 'switched' : 'queued'} regional resume`, async () => {
  let run, finish;
  const f = fixture({ fade: callback => { run = callback; return new Promise(r => { finish = r; }); } });
  const before = f.player.getLocalPosition();
  f.entry.start(); if (afterSwitch) run();
  f.lobbyTransition.active = true;
  run(); finish(); await flush();
  assert.equal(f.region.inCampus, true); assert.deepEqual(f.player.position, before);
  assert.equal(f.region.busy, false); assert.equal(f.changes.length, 0);
  assert.equal(f.entry.start(), false, 'another active lobby transition owns the start');
});

for (const asynchronous of [false, true]) test(`lobby completion error remains committed and fail-closed (async=${asynchronous})`, async () => {
  const f = fixture({ fade: asynchronous ? async run => run() : run => run() });
  f.controller.setInputEnabled = enabled => { if (enabled) throw Error('lobby input release failed'); };
  assert.equal(f.entry.start(), true); await flush();
  assert.equal(f.region.inBiryong, true, 'cannot roll back after publishing regional success');
  assert.equal(f.player.parent, f.biryongRoot); assert.equal(f.online.campusPaused, true);
  assert.equal(f.region.busy, true, 'keep gameplay frozen until reload after incomplete lobby cleanup');
  assert.equal(f.changes.length, 1); assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].phase, 'completion'); assert.equal(f.errors[0].recovered, false);
});
