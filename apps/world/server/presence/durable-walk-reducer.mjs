// Pure, server-only movement policy. This module does not authenticate, persist, lock,
// fence workers, authorize spawns, or turn a browser pose into authoritative evidence.
// The host supplies a locked/CAS-protected durable row, DB time, and server geometry.
// Hydrate that row on every worker: never recreate it on reconnect, retry, or cold start.
export const DURABLE_WALK_POLICY = Object.freeze({
  version: 'durable-campus-walk-v1',
  frame: 'CAMPUS_LOCAL_XYZ',
  speed: 3,
  substepMs: 50,
  intentTtlMs: 250,
  maxGapMs: 250,
  maxAbsCoordinate: 10000,
  maxHeightStep: .12,
  maxTimeMs: 8640000000000000,
});

const STATE_KEYS = ['version', 'revision', 'sequence', 'lastCommand', 'position',
  'simulatedAt', 'observedAt', 'intentReceivedAt', 'geometryRevision'];
const COMMAND_KEYS = ['sequence', 'moveX', 'moveZ'];
const POSITION_KEYS = ['x', 'y', 'z'];
const EPSILON = 1e-9;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const time = value => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= DURABLE_WALK_POLICY.maxTimeMs;
const integer = (value, minimum) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum;
const coordinate = value => Number.isFinite(value) && Math.abs(value) <= DURABLE_WALK_POLICY.maxAbsCoordinate;
const copyPosition = value => ({ x: value.x || 0, y: value.y || 0, z: value.z || 0 });
const copyCommand = value => value === null ? null : ({ sequence: value.sequence, moveX: value.moveX, moveZ: value.moveZ });

// Accept only ordinary JSON records, including no getters, symbols, or hidden fields.
function exactRecord(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && keys.includes(key) && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function commandValid(command) {
  return exactRecord(command, COMMAND_KEYS) && integer(command.sequence, 1) &&
    [command.moveX, command.moveZ].every(value => Number.isFinite(value) && Math.abs(value) <= 1 && !Object.is(value, -0));
}

function geometryRevision(geometry, needsSpawn = false) {
  if (!geometry || geometry.manifest?.frame !== DURABLE_WALK_POLICY.frame ||
      typeof geometry.manifest.digest !== 'string' || !/^[a-f0-9]{64}$/.test(geometry.manifest.digest) ||
      typeof geometry.valid !== 'function' || typeof geometry.advance !== 'function' ||
      (needsSpawn && typeof geometry.spawn !== 'function')) fail('GEOMETRY_INVALID');
  return geometry.manifest.digest;
}

function validPosition(position, geometry) {
  if (!exactRecord(position, POSITION_KEYS) || !POSITION_KEYS.every(key => coordinate(position[key]))) return false;
  // Neither a geometry callback nor its return value can alias the durable input.
  try { return geometry.valid(Object.freeze(copyPosition(position))) === true; }
  catch { return false; }
}

function validateState(state, geometry, revision) {
  if (!exactRecord(state, STATE_KEYS) || state.version !== DURABLE_WALK_POLICY.version ||
      !integer(state.revision, 1) || !integer(state.sequence, 0) || state.sequence >= state.revision ||
      !time(state.simulatedAt) || state.observedAt !== state.simulatedAt ||
      !(state.sequence === 0
        ? state.lastCommand === null && state.intentReceivedAt === null
        : commandValid(state.lastCommand) && state.lastCommand.sequence === state.sequence &&
          time(state.intentReceivedAt) && state.intentReceivedAt <= state.simulatedAt)) fail('STATE_INVALID');
  if (state.geometryRevision !== revision) fail('GEOMETRY_MISMATCH');
  if (!validPosition(state.position, geometry)) fail('POSITION_INVALID');
}

function frozenState(state) {
  return Object.freeze({
    version: state.version,
    revision: state.revision,
    sequence: state.sequence,
    lastCommand: state.lastCommand === null ? null : Object.freeze(copyCommand(state.lastCommand)),
    position: Object.freeze(copyPosition(state.position)),
    simulatedAt: state.simulatedAt,
    observedAt: state.observedAt,
    intentReceivedAt: state.intentReceivedAt,
    geometryRevision: state.geometryRevision,
  });
}

// Only for a genuinely new durable session. The host must authorize BACK_GATE from
// server progression and bind identity/session/fence outside this movement state.
export function createDurableWalkState({ nowMs, geometry, spawnId = 'MAIN_GATE' } = {}) {
  const revision = geometryRevision(geometry, true);
  if (!time(nowMs)) fail('CLOCK_INVALID');
  if (!['MAIN_GATE', 'BACK_GATE'].includes(spawnId)) fail('SPAWN_INVALID');
  let position;
  try { position = geometry.spawn(spawnId); }
  catch { fail('SPAWN_INVALID'); }
  if (!validPosition(position, geometry)) fail('POSITION_INVALID');
  return frozenState({ version: DURABLE_WALK_POLICY.version, revision: 1, sequence: 0,
    lastCommand: null, position, simulatedAt: nowMs, observedAt: nowMs,
    intentReceivedAt: null, geometryRevision: revision });
}

// nowMs is the authoritative DB read time, never browser time or a worker's clock.
// Each accepted command first simulates the PREVIOUS intent until nowMs, then installs
// the new intent. Duplicates are read-only acknowledgements, including after a long gap.
// A >250ms gap explicitly stops: discard the whole old interval and start the new
// intent at nowMs. It never moves for a capped slice of an arbitrarily old interval.
// Persist with revision/session/fence CAS and a bounded computation-age check. Preserve
// observedAt exactly; stamping a later commit time would claim uncomputed movement.
export function reduceDurableWalkState({ state, command, nowMs, geometry } = {}) {
  const revision = geometryRevision(geometry);
  validateState(state, geometry, revision);
  if (!commandValid(command)) fail('INPUT_SCHEMA');
  if (!time(nowMs)) fail('CLOCK_INVALID');
  if (nowMs < state.simulatedAt) fail('CLOCK_REVERSED');
  if (command.sequence === state.sequence) {
    if (command.moveX !== state.lastCommand.moveX || command.moveZ !== state.lastCommand.moveZ) fail('SEQUENCE_CONFLICT');
    return Object.freeze({ state: frozenState(state), duplicate: true, stoppedForGap: false });
  }
  if (command.sequence !== state.sequence + 1) fail('SEQUENCE_ORDER');
  if (state.revision === Number.MAX_SAFE_INTEGER) fail('REVISION_EXHAUSTED');

  const stoppedForGap = nowMs - state.simulatedAt > DURABLE_WALK_POLICY.maxGapMs;
  let position = copyPosition(state.position);
  if (!stoppedForGap && state.lastCommand) {
    const previous = state.lastCommand;
    const scale = Math.max(1, Math.hypot(previous.moveX, previous.moveZ));
    // Subtraction avoids adding TTL near the maximum representable timestamp.
    const remaining = Math.max(0, DURABLE_WALK_POLICY.intentTtlMs - (state.simulatedAt - state.intentReceivedAt));
    const elapsed = Math.min(nowMs - state.simulatedAt, remaining);
    for (let offset = 0; offset < elapsed; offset += DURABLE_WALK_POLICY.substepMs) {
      const distance = DURABLE_WALK_POLICY.speed * Math.min(DURABLE_WALK_POLICY.substepMs, elapsed - offset) / 1000;
      const dx = previous.moveX / scale * distance, dz = previous.moveZ / scale * distance;
      if (dx === 0 && dz === 0) continue;
      let next;
      try { next = geometry.advance(Object.freeze(copyPosition(position)), dx, dz); }
      catch { fail('GEOMETRY_ADVANCE_INVALID'); }
      if (!validPosition(next, geometry) ||
          Math.hypot(next.x - position.x, next.z - position.z) > Math.hypot(dx, dz) + EPSILON ||
          Math.abs(next.y - position.y) > DURABLE_WALK_POLICY.maxHeightStep + EPSILON) fail('GEOMETRY_ADVANCE_INVALID');
      position = copyPosition(next);
    }
  }

  return Object.freeze({ state: frozenState({ ...state, revision: state.revision + 1,
    sequence: command.sequence, lastCommand: command, position,
    simulatedAt: nowMs, observedAt: nowMs, intentReceivedAt: nowMs }), duplicate: false, stoppedForGap });
}
