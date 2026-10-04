import {
  COMBAT_ACTION_SLOTS,
  COMBAT_JOB_CATALOG,
  COMBAT_V03_PROTOTYPE
} from './combat-v03-catalog.js';

export const COMBAT_V03_RUNTIME_PHASE = Object.freeze({
  IDLE: 'IDLE',
  TRAINING: 'TRAINING'
});

const ACTION_SET = new Set(COMBAT_ACTION_SLOTS);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const frozen = value => Object.freeze(value);

function defaultBuild(jobId) {
  const job = COMBAT_JOB_CATALOG[jobId];
  if (!job) throw new TypeError(`Unknown Combat v0.3 job: ${jobId}`);
  return frozen({
    jobId,
    activeSkills: frozen(job.activeSkills.slice(0, COMBAT_V03_PROTOTYPE.activeLoadoutSize)),
    ultimate: job.ultimates[0]
  });
}

function validateBuild({ jobId, activeSkills, ultimate }) {
  const job = COMBAT_JOB_CATALOG[jobId];
  if (!job) throw new TypeError(`Unknown Combat v0.3 job: ${jobId}`);
  if (!Array.isArray(activeSkills) || activeSkills.length !== COMBAT_V03_PROTOTYPE.activeLoadoutSize) {
    throw new TypeError('Combat v0.3 loadout requires exactly 3 active skills');
  }
  if (new Set(activeSkills).size !== activeSkills.length || activeSkills.some(id => !job.activeSkills.includes(id))) {
    throw new TypeError('Combat v0.3 loadout contains an invalid or duplicate active skill');
  }
  if (!job.ultimates.includes(ultimate)) throw new TypeError('Combat v0.3 loadout contains an invalid ultimate');
  return frozen({ jobId, activeSkills: frozen([...activeSkills]), ultimate });
}

function actionIdentity(build, action) {
  if (action === 'basic' || action === 'dodge') return action;
  if (action === 'ultimate') return build.ultimate;
  const index = Number(action.at(-1)) - 1;
  return build.activeSkills[index] ?? null;
}

export function createCombatRuntimeV03({
  clock = { now: () => Date.now() },
  initialJobId = 'blaster'
} = {}) {
  const listeners = new Set();
  let build = defaultBuild(initialJobId);
  let version = 0;
  let phase = COMBAT_V03_RUNTIME_PHASE.IDLE;
  let sourceRef = null;
  let placeZoneId = null;
  let startedAt = null;
  let actionSerial = 0;
  let ultimateGauge = 0;
  let lockOn = false;
  let lastAction = null;

  const snapshot = () => frozen({
    version,
    active: phase !== COMBAT_V03_RUNTIME_PHASE.IDLE,
    phase,
    sourceRef,
    placeZoneId,
    startedAt,
    build,
    actionSerial,
    ultimateGauge,
    ultimateReady: ultimateGauge >= 100,
    lockOn,
    lastAction
  });

  const publish = event => {
    version += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current, event);
    return current;
  };

  const assertEditable = () => {
    if (phase !== COMBAT_V03_RUNTIME_PHASE.IDLE) throw new Error('Combat build is locked during an encounter');
  };

  function configureBuild(next) {
    assertEditable();
    build = validateBuild(next);
    return publish('build');
  }

  function setJob(jobId) {
    assertEditable();
    build = defaultBuild(jobId);
    return publish('job');
  }

  function startTraining({ sourceRef: nextSourceRef, placeZoneId: nextPlaceZoneId } = {}) {
    if (phase !== COMBAT_V03_RUNTIME_PHASE.IDLE) return false;
    if (typeof nextSourceRef !== 'string' || nextSourceRef.length === 0) throw new TypeError('Combat sourceRef required');
    if (typeof nextPlaceZoneId !== 'string' || nextPlaceZoneId.length === 0) throw new TypeError('Combat placeZoneId required');
    phase = COMBAT_V03_RUNTIME_PHASE.TRAINING;
    sourceRef = nextSourceRef;
    placeZoneId = nextPlaceZoneId;
    startedAt = Number(clock.now());
    actionSerial = 0;
    ultimateGauge = 0;
    lockOn = false;
    lastAction = null;
    publish('start');
    return true;
  }

  function end(reason = 'EXIT') {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return false;
    phase = COMBAT_V03_RUNTIME_PHASE.IDLE;
    sourceRef = null;
    placeZoneId = null;
    startedAt = null;
    ultimateGauge = 0;
    lockOn = false;
    lastAction = frozen({ kind: 'end', reason: String(reason) });
    publish('end');
    return true;
  }

  function gainUltimate(rawAmount) {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return snapshot();
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount < 0) throw new TypeError('Invalid ultimate gain');
    ultimateGauge = clamp(ultimateGauge + amount, 0, 100);
    return publish('ultimate-gain');
  }

  // v9.22 telemetry-derived Ultimate gain semantics. This accepts already-resolved Combat facts only;
  // it does not decide hits, damage, BREAK, dodge timing or kills.
  function recordResolvedCombat({
    damage = 0,
    weak = false,
    breakTriggered = false,
    perfectDodge = false,
    perfectGuard = false,
    kill = false,
    activeSkillSucceeded = false
  } = {}) {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return snapshot();
    const resolvedDamage = Number(damage);
    if (!Number.isFinite(resolvedDamage) || resolvedDamage < 0) throw new TypeError('Invalid resolved damage');
    let gain = 0;
    if (activeSkillSucceeded) gain += 2;
    if (resolvedDamage > 0) gain += Math.min(1.8, Math.max(.12, resolvedDamage / 260)) + (weak ? 1.2 : 0);
    if (breakTriggered) gain += 12;
    if (perfectDodge) gain += 6;
    if (perfectGuard) gain += 8;
    if (kill) gain += 3;
    if (gain > 0) return gainUltimate(gain);
    return snapshot();
  }

  function dispatch(action) {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return frozen({ accepted: false, reason: 'NOT_ACTIVE' });
    if (!ACTION_SET.has(action)) throw new TypeError(`Unknown Combat action: ${action}`);
    if (action === 'ultimate' && ultimateGauge < 100) {
      return frozen({ accepted: false, reason: 'ULTIMATE_NOT_READY', gauge: ultimateGauge });
    }
    if (action === 'ultimate') ultimateGauge = 0;
    actionSerial += 1;
    lastAction = frozen({
      serial: actionSerial,
      action,
      identity: actionIdentity(build, action),
      at: Number(clock.now())
    });
    publish('action');
    return frozen({ accepted: true, ...lastAction, ultimateGauge });
  }

  function toggleLock() {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return false;
    lockOn = !lockOn;
    publish('lock');
    return lockOn;
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('Combat runtime listener must be a function');
    listeners.add(listener);
    if (emitCurrent) listener(snapshot(), 'sync');
    return () => listeners.delete(listener);
  }

  return frozen({
    snapshot,
    configureBuild,
    setJob,
    startTraining,
    end,
    gainUltimate,
    recordResolvedCombat,
    dispatch,
    toggleLock,
    subscribe,
    get active() { return phase !== COMBAT_V03_RUNTIME_PHASE.IDLE; }
  });
}
