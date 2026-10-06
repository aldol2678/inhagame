import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerActivityAudio } from '../src/audio/player-activity-audio.js';
import { resolveFootstepSurface, resolveDoorCue } from '../src/audio/activity-surfaces.js';
import { createActivityCueRenderer, MAX_ACTIVITY_SOURCES } from '../src/audio/activity-cues.js';
import { MCM_2026_ROOM_ID } from '../src/events/zombie-university-2026/minigame-room-layout.js';
import { SITE_FEATURES } from '../src/basic-campus.js';
import { PERSONAL_ROOM_BASIC_FURNITURE } from '../src/rooms/personal-room-layout.js';

function eventTarget() {
  const events = new Map();
  return { visibilityState: 'visible', addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    emit(type, event = {}) { for (const fn of events.get(type) ?? []) fn(event); },
    count: () => [...events.values()].reduce((n, set) => n + set.size, 0) };
}
function rig() {
  const cues = [], documentLike = eventTarget(), windowLike = eventTarget();
  const audioState = { context: 'running', volume: 1 };
  let stops = 0;
  const renderer = { play(cue) { cues.push(cue); return true; }, stop() { stops++; }, dispose() { stops++; }, status: () => ({ activeSources: 0 }) };
  const activity = createPlayerActivityAudio({ audio: { status: () => audioState }, documentLike, windowLike,
    renderer, resolveSurface: () => 'hard-outdoor' });
  let x = 0;
  const move = (overrides = {}) => { const from = { x, y: 1.15, z: 0 }; x += overrides.distance ?? 0.35;
    return activity.observeMove({ from, to: { x, y: 1.15, z: 0 }, dt: .05, space: 'campus',
      groundedBefore: true, grounded: true, moving: true, inputEnabled: true, walkSpeed: 7, maxSpeed: 12, ...overrides }); };
  return { activity, cues, documentLike, windowLike, audioState, move, get stops() { return stops; } };
}

test('footsteps accumulate actual displacement, WALK/RUN differ, and are frame-rate independent', () => {
  const walk = rig(), run = rig();
  for (let i = 0; i < 100; i++) { walk.move(); run.move({ distance: .6 }); }
  assert.ok(walk.cues.length >= 10 && walk.cues.length <= 16);
  assert.ok(run.cues.length > walk.cues.length);
  assert.ok(walk.cues.every(cue => cue.gait === 'WALK'));
  assert.ok(run.cues.every(cue => cue.gait === 'RUN'));
  assert.deepEqual(walk.cues.slice(0, 4).map(cue => cue.foot), [0, 1, 0, 1]);
  const fast = rig();
  for (let i = 0; i < 300; i++) fast.move({ distance: 7 / 60, dt: 1 / 60 });
  assert.equal(fast.cues.length, walk.cues.length);
});

test('blocked/stationary, airborne/landing, mounts, swim, disabled input and unknown space cannot produce steps', () => {
  for (const state of [{ distance: 0 }, { moving: false }, { grounded: false }, { groundedBefore: false },
    { mounted: true }, { swimming: true }, { blocked: true }, { inputEnabled: false }, { seated: true }]) {
    const r = rig(); for (let i = 0; i < 50; i++) r.move(state);
    assert.equal(r.cues.length, 0, JSON.stringify(state));
  }
  assert.equal(resolveFootstepSurface({ space: 'biryong-realm', position: { x: 0, z: 0 } }), null);
});

test('pauses, invalid samples, teleports and stationary frames discard distance without catch-up bursts', () => {
  const r = rig();
  for (let i = 0; i < 7; i++) r.move();
  r.move({ distance: 0 });
  assert.equal(r.move(), false);
  for (const overrides of [{ distance: 100 }, { dt: 2 }, { dt: 0 }, { dt: NaN }, { to: { x: NaN, z: 0 } }]) {
    const before = r.cues.length;
    r.move(overrides);
    assert.equal(r.cues.length, before);
    assert.equal(r.move(), false);
  }
});

test('locked/muted/hidden audio drops cues and never replays them on unlock/resume', () => {
  const r = rig();
  for (const state of [{ context: 'locked' }, { context: 'suspended' }, { context: 'running', volume: 0 }]) {
    Object.assign(r.audioState, state); for (let i = 0; i < 50; i++) r.move();
    assert.equal(r.cues.length, 0);
  }
  Object.assign(r.audioState, { context: 'running', volume: 1 });
  r.documentLike.visibilityState = 'hidden'; r.documentLike.emit('visibilitychange');
  for (let i = 0; i < 50; i++) r.move();
  r.documentLike.visibilityState = 'visible'; r.documentLike.emit('visibilitychange');
  assert.equal(r.move(), false);
  assert.equal(r.cues.length, 0);
  for (let i = 0; i < 10; i++) r.move();
  assert.ok(r.cues.length > 0);
});

test('confirmed room transitions use three door families, ignore duplicates/failure and reset locomotion', () => {
  const r = rig();
  assert.equal(r.activity.onRoomChange({ space: 'ROOM_DORM1_LOBBY' }, 'enter'), true);
  assert.equal(r.activity.onRoomChange({ space: 'ROOM_DORM1_LOBBY' }, 'enter'), false);
  assert.equal(r.activity.onRoomChange({ space: 'ROOM_PERSONAL_BASIC' }, 'enter-nested'), true);
  assert.equal(r.activity.onRoomChange({ space: 'ROOM_DORM1_LOBBY' }, 'exit-nested'), true);
  assert.equal(r.activity.onRoomChange({ space: 'campus' }, 'exit'), true);
  assert.equal(r.activity.onRoomChange({ space: 'ROOM_PERSONAL_BASIC' }, 'failed'), false);
  assert.deepEqual(r.cues.map(cue => cue.family), ['glass', 'wood', 'wood', 'glass']);
  assert.equal(resolveDoorCue('campus', 'ROOM_CLUBHOUSE_01').family, 'wood');
  assert.equal(resolveDoorCue('campus', MCM_2026_ROOM_ID).family, 'threshold');
  assert.equal(resolveDoorCue('campus', 'biryong-realm'), null);
});

test('bfcache pagehide stops active voices, pageshow resets, final disposal is idempotent', () => {
  const r = rig();
  r.windowLike.emit('pagehide', { persisted: true });
  assert.ok(r.stops > 0);
  for (let i = 0; i < 50; i++) r.move();
  assert.equal(r.cues.length, 0);
  r.windowLike.emit('pageshow', { persisted: true });
  assert.equal(r.move(), false);
  r.activity.dispose(); r.activity.dispose();
  assert.equal(r.documentLike.count() + r.windowLike.count(), 0);
  for (let i = 0; i < 50; i++) r.move();
  assert.equal(r.cues.length, 0);
});

test('surface mapping uses authored lawns and rugs; ordinary room floors stay hard', () => {
  const rug = PERSONAL_ROOM_BASIC_FURNITURE.find(item => item.kind === 'rug');
  const position = { x: rug.at[0], z: rug.at[2] };
  assert.equal(resolveFootstepSurface({ space: 'ROOM_PERSONAL_BASIC', position }), 'indoor-soft');
  assert.equal(resolveFootstepSurface({ space: 'ROOM_PERSONAL_BASIC', position: { x: 0, z: -3 } }), 'indoor-hard');
  assert.equal(resolveFootstepSurface({ space: 'ROOM_DORM1_LOBBY', position }), 'indoor-hard');
  assert.equal(resolveFootstepSurface({ space: 'campus', position: { x: 0, z: -76 } }), 'hard-outdoor');
  // At least one real lawn interior remains soft; resolver must not infer softness from an entire Place Zone.
  const grass = SITE_FEATURES.filter(feature => feature.kind === 'lawn').flatMap(feature => {
    const xs = feature.vertices.map(p => p.x), zs = feature.vertices.map(p => p.z), points = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 1) points.push({ x, z });
    return points;
  });
  assert.ok(grass.some(position => resolveFootstepSurface({ space: 'campus', position }) === 'soft-outdoor'));
  assert.equal(resolveFootstepSurface({ position: { x: NaN, z: 0 } }), null);
});

function audioRig() {
  const sources = [], nodes = [];
  const context = { currentTime: 1, sampleRate: 24000,
    createBuffer(_channels, size, sampleRate) { const data = new Float32Array(size); return { duration: size / sampleRate, getChannelData: () => data }; },
    createBufferSource() { const source = { playbackRate: { value: 1 }, connect() {}, disconnect() { this.disconnected = true; },
      start() { this.started = true; }, stop() { this.stopped = true; } }; sources.push(source); return source; },
    createGain() { const node = { gain: { value: 1 }, connect() {}, disconnect() { this.disconnected = true; } }; nodes.push(node); return node; } };
  const output = {};
  const audio = { playCue(render) { render(context, output); return true; } };
  return { sources, nodes, context, audio };
}

test('procedural voices stay bounded, door feedback takes priority, and ended/disposed nodes disconnect', () => {
  const r = audioRig(), renderer = createActivityCueRenderer({ audio: r.audio });
  for (let i = 0; i < 30; i++) renderer.play({ kind: 'footstep', surface: 'hard-outdoor', gait: 'WALK', foot: i % 2 });
  assert.equal(renderer.status().activeSources, MAX_ACTIVITY_SOURCES);
  renderer.play({ kind: 'door', family: 'wood', direction: 'enter' });
  assert.equal(renderer.status().activeSources, MAX_ACTIVITY_SOURCES);
  assert.ok(r.sources[0].stopped);
  const latest = r.sources.at(-1); latest.onended();
  assert.equal(latest.disconnected, true);
  assert.equal(renderer.status().activeSources, MAX_ACTIVITY_SOURCES - 1);
  renderer.dispose(); renderer.dispose();
  assert.equal(renderer.status().activeSources, 0);
  assert.ok(r.sources.every(source => source.disconnected));
  assert.ok(r.nodes.every(node => node.disconnected));
  assert.equal(renderer.play({ kind: 'door', family: 'wood' }), false);
});

test('surface/gait buffers differ, finite samples are bounded, and a rejected playCue creates nothing', () => {
  const r = audioRig(), renderer = createActivityCueRenderer({ audio: r.audio });
  const signatures = new Set();
  for (const surface of ['hard-outdoor', 'soft-outdoor', 'indoor-hard', 'indoor-soft']) {
    renderer.play({ kind: 'footstep', surface, gait: 'WALK', foot: 0 });
    const source = r.sources.at(-1), data = source.buffer.getChannelData(0);
    assert.ok(data.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
    assert.ok(data.some(sample => Math.abs(sample) > .01));
    signatures.add([...data.slice(0, 100)].join(','));
    source.onended();
  }
  assert.equal(signatures.size, 4);
  renderer.play({ kind: 'footstep', surface: 'hard-outdoor', gait: 'RUN', foot: 1 });
  assert.ok(r.sources.at(-1).playbackRate.value > 1);
  const silent = createActivityCueRenderer({ audio: { playCue: () => false } });
  assert.equal(silent.play({ kind: 'door', family: 'glass' }), false);
  assert.equal(silent.status().activeSources, 0);
});

test('main samples only the controller move and subscribes only to committed room transitions', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /createPlayerActivityAudio\(\{ audio: worldAudio, initialSpace: rooms\.currentSpace \}\)/);
  assert.match(source, /rooms\.onChange\(playerActivityAudio\.onRoomChange\)/);
  const from = source.indexOf('const footstepFrom = player.getLocalPosition().clone()');
  const controller = source.indexOf('controller.update(Math.min(dt, 0.05), orbit.yaw)', from);
  const audio = source.indexOf('playerActivityAudio.observeMove(', controller);
  const combat = source.indexOf('combatWorldMotion.update()', controller);
  assert.ok(from >= 0 && from < controller && controller < audio && audio < combat);
  assert.match(source, /playerActivityAudio\.dispose\(\)/);
  assert.match(source, /unbindActivityRoom\(\)/);
});

test('real PlayerController held movement against a wall is silent; free walking, sprint and disabled input use actual motion', async () => {
  const { PlayerController } = await import('../src/player-controller.js');
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = { addEventListener() {} };
  globalThis.document = { getElementById: () => null, body: { dataset: {} } };
  try {
    const player = { position: { x: 0, y: 1.15, z: 0 }, getLocalPosition() { return this.position; },
      setLocalPosition(x, y, z) { this.position = { x, y, z }; }, setLocalEulerAngles() {} };
    const controller = new PlayerController(player, { campusShuttleEnabled: false });
    const obstacles = [{ minX: .25, maxX: 10, minZ: -10, maxZ: 10, minY: 0, maxY: 10 }];
    controller.setMovementSpace({ id: 'ROOM_PERSONAL_BASIC', allowMount: false, obstacles,
      bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, groundHeight: () => 0, constrain: (_p, next) => next });
    const r = rig();
    controller.keys.add('KeyD');
    const update = () => {
      const from = { ...player.position }, groundedBefore = controller.grounded;
      controller.update(.05, 0);
      return r.activity.observeMove({ from, to: player.position, dt: .05, space: controller.space.id,
        groundedBefore, grounded: controller.grounded, moving: controller.moving, inputEnabled: controller.inputEnabled,
        mounted: controller.mounted, walkSpeed: controller.walkSpeed, maxSpeed: controller.sprintSpeed });
    };
    for (let i = 0; i < 60; i++) update();
    assert.equal(controller.moving, true, 'input intent remains true at the wall');
    assert.equal(r.cues.length, 0);
    obstacles.length = 0;
    for (let i = 0; i < 60; i++) update();
    assert.ok(r.cues.some(cue => cue.gait === 'WALK'));
    controller.keys.add('ShiftLeft');
    for (let i = 0; i < 60; i++) update();
    assert.ok(r.cues.some(cue => cue.gait === 'RUN'));
    controller.setInputEnabled(false);
    const before = r.cues.length;
    for (let i = 0; i < 60; i++) update();
    assert.equal(r.cues.length, before);
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

test('room transition acceptance does not sound before successful fade commit; rollback is silent', async () => {
  const { createRoomTransition } = await import('../src/rooms/room-transition.js');
  const r = rig();
  let fail = true, finishFade;
  const rooms = createRoomTransition({
    fade: async run => { await new Promise(resolve => { finishFade = resolve; }); return run(); },
    world: { leaveCampus() {}, showRoom() { if (fail) throw new Error('injected scene failure'); },
      placePlayer() {}, getPlaceZoneId: () => 'AREA_MAIN_HALL', createCheckpoint: () => () => {} }
  });
  rooms.onChange(r.activity.onRoomChange);
  assert.equal(rooms.enter('ROOM_CLUBHOUSE_01'), true);
  assert.equal(r.cues.length, 0);
  finishFade(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.cues.length, 0);
  fail = false;
  assert.equal(rooms.enter('ROOM_CLUBHOUSE_01'), true);
  assert.equal(r.cues.length, 0);
  finishFade(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.cues.length, 1);
  assert.equal(r.cues[0].family, 'wood');
});

test('authored hard/rug/hard crossings keep cadence and choose material at each contact', () => {
  const cues = [];
  const activity = createPlayerActivityAudio({
    audio: { status: () => ({ context: 'running', volume: 1 }) }, documentLike: eventTarget(), windowLike: eventTarget(),
    renderer: { play(cue) { cues.push(cue); return true; }, stop() {}, dispose() {}, status: () => ({}) }
  });
  let z = -2.65;
  for (let i = 0; i < 48; i++) {
    const from = { x: 0, y: 1.15, z }; z += 7 / 60;
    activity.observeMove({ from, to: { x: 0, y: 1.15, z }, dt: 1 / 60, space: 'ROOM_PERSONAL_BASIC',
      groundedBefore: true, grounded: true, moving: true, inputEnabled: true });
  }
  assert.equal(cues.length, 2);
  assert.deepEqual(cues.map(cue => cue.surface), ['indoor-soft', 'indoor-hard']);
});

test('frequent WALK/RUN switches preserve progress through the foot contact cycle', () => {
  const r = rig();
  for (let i = 0; i < 100; i++) r.move({ distance: i % 2 ? .6 : .35 });
  assert.equal(r.cues.length, Math.floor(50 * (.35 / 2.6 + .6 / 3.2)));
});
