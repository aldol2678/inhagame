import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableWalkState, reduceDurableWalkState, DURABLE_WALK_POLICY as policy } from '../server/presence/durable-walk-reducer.mjs';
import { createCampusGeometry } from '../server/presence/campus-geometry.mjs';
import { INCOME_CONVENIENCE_LOCATION as shop } from '../src/income/income-convenience-location.mjs';

const epoch = Date.UTC(2026, 0, 1);
const digest = 'a'.repeat(64);
const fixture = () => ({
  manifest: { digest, frame: 'CAMPUS_LOCAL_XYZ' },
  valid: p => [p.x, p.y, p.z].every(Number.isFinite) && Math.abs(p.x) <= 100 && Math.abs(p.z) <= 100 && p.y === 1.15,
  spawn: id => ({ x: id === 'BACK_GATE' ? 10 : 0, y: 1.15, z: 0 }),
  advance: (p, dx, dz) => ({ ...p, x: p.x + dx, z: p.z + dz }),
});
const command = (sequence, moveX = 1, moveZ = 0) => ({ sequence, moveX, moveZ });
const expectCode = (run, code) => assert.throws(run, error => error.code === code);
const clone = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function setup(geometry = fixture(), nowMs = epoch) {
  let state = createDurableWalkState({ nowMs, geometry });
  return { geometry, get state() { return state; },
    input(at, packet = command(state.sequence + 1)) {
      const result = reduceDurableWalkState({ state, command: packet, nowMs: at, geometry });
      state = result.state;
      return result;
    } };
}

test('initial state uses only canonical server spawn, geometry revision and DB time', () => {
  const h = setup();
  assert.deepEqual(h.state, { version: policy.version, revision: 1, sequence: 0, lastCommand: null,
    position: { x: 0, y: 1.15, z: 0 }, simulatedAt: epoch, observedAt: epoch,
    intentReceivedAt: null, geometryRevision: digest });
  assert.equal(createDurableWalkState({ nowMs: epoch, geometry: h.geometry, spawnId: 'BACK_GATE' }).position.x, 10);
  expectCode(() => createDurableWalkState({ nowMs: epoch, geometry: h.geometry, spawnId: 'browser-position' }), 'SPAWN_INVALID');
  assert.deepEqual(clone(h.state), h.state);
});

test('first input never backdates movement; later inputs integrate the old direction until receipt', () => {
  const h = setup();
  h.input(epoch + 200, command(1));
  near(h.state.position.x, 0);
  h.input(epoch + 249, command(2, 0, 1));
  near(h.state.position.x, .147);
  near(h.state.position.z, 0);
  h.input(epoch + 250, command(3, 0, 0));
  near(h.state.position.x, .147);
  near(h.state.position.z, .003);
  h.input(epoch + 300, command(4));
  near(h.state.position.x, .147);
  near(h.state.position.z, .003);
  assert.equal(h.state.observedAt, epoch + 300);
  assert.equal(h.state.observedAt, h.state.simulatedAt);
  assert.equal(h.state.intentReceivedAt, epoch + 300);
});

test('diagonal movement is normalized and analog intent keeps its magnitude', () => {
  for (const [x, z, expected] of [[1, 1, .75], [-1, -1, .75], [.5, 0, .375], [0, 0, 0]]) {
    const h = setup();
    h.input(epoch, command(1, x, z));
    h.input(epoch + 250, command(2, 0, 0));
    near(Math.hypot(h.state.position.x, h.state.position.z), expected);
  }
});

test('server collision substeps are at most 50ms, bounded to five per command', () => {
  const geometry = fixture(), steps = [];
  geometry.advance = (p, dx, dz) => { steps.push([dx, dz]); return { ...p, x: Math.min(.4, p.x + dx), z: p.z + dz }; };
  const h = setup(geometry);
  h.input(epoch);
  h.input(epoch + 249);
  assert.equal(steps.length, 5);
  steps.forEach(([dx, dz]) => assert.ok(Math.hypot(dx, dz) <= .15));
  near(steps.at(-1)[0], .147);
  near(h.state.position.x, .4);
});

test('exact duplicates cannot advance revision, movement, simulation time or freshness', () => {
  const h = setup();
  h.input(epoch);
  const original = clone(h.state);
  for (let i = 0; i < 1000; i++) {
    const replay = h.input(epoch + 100000 + i, { moveZ: 0, moveX: 1, sequence: 1 });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.stoppedForGap, false);
    assert.deepEqual(h.state, original);
  }
});

test('conflicting replay and missing, backwards or skipped sequence reject without mutation', () => {
  const h = setup();
  h.input(epoch);
  const before = clone(h.state);
  expectCode(() => h.input(epoch + 50, command(1, 0, 1)), 'SEQUENCE_CONFLICT');
  expectCode(() => h.input(epoch + 50, command(3)), 'SEQUENCE_ORDER');
  assert.deepEqual(h.state, before);
  h.input(epoch + 50);
  expectCode(() => h.input(epoch + 100, command(1)), 'SEQUENCE_ORDER');
});

test('inputs are exact JSON direction records, with no client pose, time or identity', () => {
  const h = setup();
  for (const key of ['accountId', 'sessionId', 'position', 'x', 'z', 'nowMs', 'elapsedMs', 'observedAt', 'revision', 'spawnId', 'mode', 'geometryRevision']) {
    expectCode(() => h.input(epoch, { ...command(1), [key]: 'client-value' }), 'INPUT_SCHEMA');
  }
  for (const bad of [null, [], {}, { ...command(1), moveX: NaN }, { ...command(1), moveZ: Infinity },
    command(1, 1.00001), command(1, -1.00001), command(1, '1'), command(1, -0),
    command(0), command(-1), command(1.5), command(Number.MAX_SAFE_INTEGER + 1),
    Object.assign(Object.create({}), command(1)), Object.assign(command(1), { [Symbol('hidden')]: true })]) {
    expectCode(() => h.input(epoch, bad), 'INPUT_SCHEMA');
  }
  const getter = command(1);
  Object.defineProperty(getter, 'moveX', { enumerable: true, get() { assert.fail('must not invoke input getters'); } });
  expectCode(() => h.input(epoch, getter), 'INPUT_SCHEMA');
  const hidden = command(1);
  Object.defineProperty(hidden, 'secret', { value: 1 });
  expectCode(() => h.input(epoch, hidden), 'INPUT_SCHEMA');
});

test('durable state schema rejects malformed hydration instead of reinitializing', () => {
  const h = setup();
  h.input(epoch);
  const variants = [null, [], {}, { ...h.state, accountId: 'client' }, { ...h.state, version: 'old-policy' },
    { ...h.state, revision: 0 }, { ...h.state, revision: 1.5 }, { ...h.state, revision: Infinity },
    { ...h.state, sequence: -1 }, { ...h.state, sequence: -0 }, { ...h.state, sequence: h.state.revision },
    { ...h.state, lastCommand: null }, { ...h.state, lastCommand: command(2) },
    { ...h.state, lastCommand: command(1, NaN) }, { ...h.state, intentReceivedAt: null },
    { ...h.state, intentReceivedAt: epoch + 1 }, { ...h.state, intentReceivedAt: -1 },
    { ...h.state, observedAt: epoch - 1 }, { ...h.state, simulatedAt: Infinity, observedAt: Infinity },
    { ...h.state, simulatedAt: -1, observedAt: -1 }];
  for (const state of variants) expectCode(() => reduceDurableWalkState({ state, command: command(2), nowMs: epoch + 50, geometry: h.geometry }), 'STATE_INVALID');
  expectCode(() => reduceDurableWalkState({ state: { ...createDurableWalkState({ nowMs: epoch, geometry: h.geometry }), intentReceivedAt: epoch },
    command: command(1), nowMs: epoch, geometry: h.geometry }), 'STATE_INVALID');
});

test('nonfinite, malformed and out-of-cap positions fail closed even if geometry says yes', () => {
  const geometry = fixture();
  geometry.valid = () => true;
  const h = setup(geometry);
  for (const position of [null, { x: 0, y: 1.15 }, { x: 0, y: 1.15, z: 0, extra: 1 },
    { x: NaN, y: 1.15, z: 0 }, { x: 0, y: Infinity, z: 0 }, { x: 10001, y: 1.15, z: 0 }]) {
    expectCode(() => reduceDurableWalkState({ state: { ...h.state, position }, command: command(1), nowMs: epoch, geometry }), 'POSITION_INVALID');
  }
});

test('a gap greater than 250ms stops entirely; it never awards partial catch-up distance', () => {
  for (const elapsed of [251, 1000, 86400000]) {
    const h = setup();
    h.input(epoch);
    const result = h.input(epoch + elapsed, command(2, 0, 1));
    assert.equal(result.stoppedForGap, true);
    near(h.state.position.x, 0);
    near(h.state.position.z, 0);
    assert.equal(h.state.observedAt, epoch + elapsed);
    h.input(epoch + elapsed + 50, command(3, 0, 0));
    near(h.state.position.x, 0);
    near(h.state.position.z, .15);
  }
});

test('stored intent age is honored after hydration, including the exact 250ms expiry', () => {
  const geometry = fixture(), h = setup(geometry);
  h.input(epoch);
  for (const elapsed of [200, 249, 250, 300]) {
    // A durable server snapshot may have advanced its simulation without new input.
    const state = { ...h.state, simulatedAt: epoch + elapsed, observedAt: epoch + elapsed };
    const result = reduceDurableWalkState({ state, command: command(2), nowMs: epoch + elapsed + 200, geometry });
    near(result.state.position.x, Math.max(0, 250 - elapsed) * .003);
  }
});

test('DB clock must be finite, bounded integer milliseconds and cannot precede durable simulation', () => {
  const h = setup();
  h.input(epoch);
  for (const nowMs of [undefined, null, NaN, Infinity, -1, -0, epoch + .5, '123', policy.maxTimeMs + 1, Number.MAX_SAFE_INTEGER]) {
    expectCode(() => h.input(nowMs), 'CLOCK_INVALID');
    expectCode(() => createDurableWalkState({ nowMs, geometry: h.geometry }), 'CLOCK_INVALID');
  }
  expectCode(() => h.input(epoch - 1), 'CLOCK_REVERSED');
  expectCode(() => h.input(epoch - 1, command(1)), 'CLOCK_REVERSED');
  expectCode(() => reduceDurableWalkState({ state: { ...h.state, simulatedAt: epoch + 1, observedAt: epoch + 1 },
    command: command(2), nowMs: epoch, geometry: h.geometry }), 'CLOCK_REVERSED');
});

test('timestamp cap and expiry arithmetic remain finite near maximum DB time', () => {
  const h = setup(fixture(), policy.maxTimeMs - 100);
  h.input(policy.maxTimeMs - 100);
  h.input(policy.maxTimeMs);
  near(h.state.position.x, .3);
  assert.equal(h.state.observedAt, policy.maxTimeMs);
});

test('same-millisecond command floods consume sequence but never create time or movement', () => {
  const h = setup();
  for (let i = 0; i < 1000; i++) h.input(epoch);
  assert.equal(h.state.sequence, 1000);
  assert.equal(h.state.revision, 1001);
  assert.equal(h.state.observedAt, epoch);
  near(h.state.position.x, 0);
  h.input(epoch + 50);
  near(h.state.position.x, .15);
});

test('revision exhaustion still permits exact replay but never an unsafe increment', () => {
  const h = setup();
  h.input(epoch);
  const state = { ...h.state, revision: Number.MAX_SAFE_INTEGER };
  assert.equal(reduceDurableWalkState({ state, command: command(1), nowMs: epoch + 50, geometry: h.geometry }).duplicate, true);
  expectCode(() => reduceDurableWalkState({ state, command: command(2), nowMs: epoch + 50, geometry: h.geometry }), 'REVISION_EXHAUSTED');
  const exhaustedSequence = { ...state, sequence: Number.MAX_SAFE_INTEGER - 1, lastCommand: command(Number.MAX_SAFE_INTEGER - 1) };
  expectCode(() => reduceDurableWalkState({ state: exhaustedSequence, command: command(Number.MAX_SAFE_INTEGER), nowMs: epoch, geometry: h.geometry }), 'REVISION_EXHAUSTED');
});

test('geometry frame, revision and required callbacks must match before reduction or replay', () => {
  const h = setup();
  h.input(epoch);
  for (const geometry of [null, {}, { ...fixture(), valid: null }, { ...fixture(), advance: null },
    { ...fixture(), manifest: { digest, frame: 'WORLD_XYZ' } }, { ...fixture(), manifest: { digest: 'short', frame: policy.frame } }]) {
    expectCode(() => reduceDurableWalkState({ state: h.state, command: command(1), nowMs: epoch, geometry }), 'GEOMETRY_INVALID');
  }
  expectCode(() => reduceDurableWalkState({ state: { ...h.state, geometryRevision: 'b'.repeat(64) },
    command: command(1), nowMs: epoch, geometry: h.geometry }), 'GEOMETRY_MISMATCH');
});

test('geometry output must remain valid, bounded-speed and bounded-height, or the entire command fails', () => {
  for (const advance of [() => null, p => ({ ...p, x: NaN }), p => ({ ...p, x: p.x + 1 }),
    p => ({ ...p, y: p.y + .121 }), () => { throw new Error('geometry failed'); },
    p => { p.x = 5; return p; }]) {
    const geometry = fixture();
    geometry.valid = () => true;
    geometry.advance = advance;
    const h = setup(geometry);
    h.input(epoch);
    const before = clone(h.state);
    expectCode(() => h.input(epoch + 50), 'GEOMETRY_ADVANCE_INVALID');
    assert.deepEqual(h.state, before);
  }
});

test('later substep failure cannot partially mutate the durable position or incoming packet', () => {
  const geometry = fixture();
  let steps = 0;
  geometry.advance = (p, dx, dz) => { if (++steps === 3) throw Error('third step'); return { ...p, x: p.x + dx, z: p.z + dz }; };
  const h = setup(geometry);
  h.input(epoch);
  const state = clone(h.state), packet = command(2, 0, 1), original = clone(state);
  expectCode(() => reduceDurableWalkState({ state, command: packet, nowMs: epoch + 250, geometry }), 'GEOMETRY_ADVANCE_INVALID');
  assert.deepEqual(state, original);
  assert.deepEqual(packet, command(2, 0, 1));
});

test('results are independent frozen JSON copies with no caller or geometry aliases', () => {
  const geometry = fixture(), spawn = { x: 0, y: 1.15, z: 0 };
  geometry.spawn = () => spawn;
  const initial = createDurableWalkState({ nowMs: epoch, geometry });
  spawn.x = 99;
  near(initial.position.x, 0);
  const state = clone(initial), packet = command(1);
  const result = reduceDurableWalkState({ state, command: packet, nowMs: epoch, geometry });
  state.position.x = 70;
  packet.moveX = -1;
  near(result.state.position.x, 0);
  assert.equal(result.state.lastCommand.moveX, 1);
  for (const object of [result, result.state, result.state.position, result.state.lastCommand]) assert.ok(Object.isFrozen(object));
  assert.throws(() => { result.state.position.x = 10; }, TypeError);
  assert.deepEqual(clone(result.state), result.state);
  const duplicate = reduceDurableWalkState({ state: result.state, command: command(1), nowMs: epoch + 50, geometry });
  assert.notEqual(duplicate.state, result.state);
  assert.notEqual(duplicate.state.position, result.state.position);
  assert.notEqual(duplicate.state.lastCommand, result.state.lastCommand);
});

test('cold-worker JSON hydration preserves sequence, time, revision and next movement deterministically', () => {
  const warm = setup();
  warm.input(epoch);
  warm.input(epoch + 50, command(2, 0, 1));
  const hydrated = clone(warm.state);
  const cold = reduceDurableWalkState({ state: hydrated, command: command(3, 0, 0), nowMs: epoch + 125, geometry: fixture() });
  const next = warm.input(epoch + 125, command(3, 0, 0));
  assert.deepEqual(cold, next);
  assert.equal(cold.state.sequence, 3);
  assert.equal(cold.state.revision, 4);
  near(cold.state.position.x, .15);
  near(cold.state.position.z, .225);
  expectCode(() => reduceDurableWalkState({ state: hydrated, command: command(1), nowMs: epoch + 125, geometry: fixture() }), 'SEQUENCE_ORDER');
});

test('canonical geometry is used for a continuous server walk from BACK_GATE to the convenience approach', () => {
  const geometry = createCampusGeometry();
  let state = createDurableWalkState({ nowMs: epoch, geometry, spawnId: 'BACK_GATE' });
  let at = epoch;
  for (const destination of shop.approach) {
    for (let tries = 0; ; tries++) {
      const dx = destination.x - state.position.x, dz = destination.z - state.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < .01) break;
      assert.ok(tries < 1000, `route stalled at ${JSON.stringify(state.position)}`);
      const scale = Math.min(1, distance / (policy.speed * .05));
      // Begin a server intent at the current instant, then stop it after 50ms.
      state = reduceDurableWalkState({ state, command: command(state.sequence + 1, dx / distance * scale, dz / distance * scale), nowMs: at, geometry }).state;
      at += 50;
      state = reduceDurableWalkState({ state, command: command(state.sequence + 1, 0, 0), nowMs: at, geometry }).state;
      assert.equal(geometry.valid(state.position), true);
    }
  }
  assert.ok(Math.hypot(state.position.x - shop.position.x, state.position.z - shop.position.z) < 2.5);
  assert.ok(state.position.z > 0, 'campus-local Z is not the render world reflection');
  assert.equal(state.geometryRevision, geometry.manifest.digest);
});
