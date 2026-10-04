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

function ultimateGainFromDamage(damage, weak = false) {
  const resolved = Number(damage);
  if (!Number.isFinite(resolved) || resolved <= 0) return 0;
  return Math.min(1.8, Math.max(.12, resolved / 260)) + (weak ? 1.2 : 0);
}

function ultimateGainForFacts({
  damage = 0,
  damagePackets = null,
  weak = false,
  breakTriggered = false,
  breakTriggeredCount = 0,
  perfectDodge = false,
  perfectGuard = false,
  kill = false,
  activeSkillSucceeded = false
} = {}) {
  let gain = 0;
  if (activeSkillSucceeded) gain += 2;
  if (Array.isArray(damagePackets) && damagePackets.length > 0) {
    for (const packet of damagePackets) gain += ultimateGainFromDamage(packet, weak);
  } else {
    gain += ultimateGainFromDamage(damage, weak);
  }
  const breakCount = Number.isInteger(breakTriggeredCount) && breakTriggeredCount > 0
    ? breakTriggeredCount
    : breakTriggered ? 1 : 0;
  gain += breakCount * 12;
  if (perfectDodge) gain += 6;
  if (perfectGuard) gain += 8;
  if (kill) gain += 3;
  return gain;
}

export function createCombatRuntimeV03({
  clock = { now: () => Date.now() },
  initialJobId = 'blaster',
  localTraining = null
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
  let lastTickBucket = -1;

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
    lastAction,
    training: localTraining?.snapshot?.() ?? null
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
    lastTickBucket = -1;
    localTraining?.start?.();
    publish('start');
    return true;
  }

  function end(reason = 'EXIT') {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return false;
    localTraining?.end?.();
    phase = COMBAT_V03_RUNTIME_PHASE.IDLE;
    sourceRef = null;
    placeZoneId = null;
    startedAt = null;
    ultimateGauge = 0;
    lockOn = false;
    lastTickBucket = -1;
    lastAction = frozen({ kind: 'end', reason: String(reason) });
    publish('end');
    return true;
  }

  function applyUltimateGain(rawAmount) {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount < 0) throw new TypeError('Invalid ultimate gain');
    ultimateGauge = clamp(ultimateGauge + amount, 0, 100);
    return ultimateGauge;
  }

  function gainUltimate(rawAmount) {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return snapshot();
    applyUltimateGain(rawAmount);
    return publish('ultimate-gain');
  }

  // v9.22 telemetry-derived Ultimate gain semantics. This accepts already-resolved Combat facts only;
  // it does not decide hits, damage, BREAK, dodge timing or kills.
  function recordResolvedCombat(facts = {}) {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return snapshot();
    applyUltimateGain(ultimateGainForFacts(facts));
    return publish('resolved-combat');
  }

  function dispatch(action) {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return frozen({ accepted: false, reason: 'NOT_ACTIVE' });
    if (!ACTION_SET.has(action)) throw new TypeError(`Unknown Combat action: ${action}`);
    if (action === 'ultimate' && ultimateGauge < 100) {
      return frozen({ accepted: false, reason: 'ULTIMATE_NOT_READY', gauge: ultimateGauge });
    }

    const identity = actionIdentity(build, action);
    const resolution = localTraining?.resolveAction?.({
      action,
      identity,
      build,
      at: Number(clock.now())
    }) ?? frozen({ accepted: true });

    if (resolution.accepted === false) {
      return frozen({ ...resolution, action, identity, ultimateGauge });
    }

    if (action === 'ultimate') ultimateGauge = 0;

    const gain = ultimateGainForFacts({
      damage: resolution.damage ?? 0,
      damagePackets: resolution.damagePackets ?? null,
      weak: resolution.weak === true,
      breakTriggered: (resolution.breakTriggered ?? 0) > 0,
      breakTriggeredCount: resolution.breakTriggered ?? 0,
      kill: resolution.killed === true,
      activeSkillSucceeded: resolution.activeSkillSucceeded === true
    });
    if (gain > 0) applyUltimateGain(gain);

    actionSerial += 1;
    lastAction = frozen({
      serial: actionSerial,
      action,
      identity,
      at: Number(clock.now()),
      outcome: resolution
    });
    publish('action');
    return frozen({ accepted: true, ...lastAction, ultimateGauge, outcome: resolution });
  }

  function resetTrainingTarget() {
    if (phase !== COMBAT_V03_RUNTIME_PHASE.TRAINING || !localTraining?.resetTarget) return false;
    localTraining.resetTarget({ preserveMomentum: true });
    publish('training-reset');
    return true;
  }

  function update() {
    if (phase === COMBAT_V03_RUNTIME_PHASE.IDLE) return false;
    const at = Number(clock.now());
    const bucket = Math.floor(at / 100);
    if (bucket === lastTickBucket) return false;
    lastTickBucket = bucket;
    publish('tick');
    return true;
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
    resetTrainingTarget,
    update,
    toggleLock,
    subscribe,
    get active() { return phase !== COMBAT_V03_RUNTIME_PHASE.IDLE; }
  });
}
