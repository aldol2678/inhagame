// P1-A F1: pure, server-fed fishing resolver. No authentication, DB, grants or activation.
// Only a server adapter may supply actor/time/randomness/policy or a persisted attempt.
import { ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN } from './activity-contract.js';

export const FISHING_ACTIVITY_ID = 'activity.fishing.inkyung';
export const FISHING_RESOLVER_VERSION = 'resolver.fishing.inkyung_v1';
export const FISHING_SOURCES = Object.freeze([
  'fishing.inkyung.north_01', 'fishing.inkyung.south_01'
]);
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const POLICY_FIELDS = [
  'policyVersion', 'minWaitMs', 'maxWaitMs', 'responseWindowMs', 'attemptTtlMs', 'lifeXp'
];

function exactFields(raw, fields, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (!fields.includes(key)) throw new TypeError(`Unrecognized ${label} field: ${key}`);
  }
}

function uuid(value, label) {
  if (typeof value !== 'string' || !ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN.test(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value.toLowerCase();
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`Invalid ${label}`);
  return value;
}

function source(value) {
  if (!FISHING_SOURCES.includes(value)) throw new TypeError('Unknown fishing source');
  return value;
}

// Copy as well as freeze: policy callers and JSON-restored readbacks cannot mutate results.
function snapshot(value) {
  if (value === null || typeof value !== 'object') return value;
  return Object.freeze(Array.isArray(value)
    ? value.map(snapshot)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])));
}

function validatePolicy(raw) {
  exactFields(raw, POLICY_FIELDS, 'fishing policy');
  if (typeof raw.policyVersion !== 'string' || !/^[a-z][a-z0-9_.]{0,79}$/.test(raw.policyVersion)) {
    throw new TypeError('Invalid policyVersion');
  }
  for (const field of ['minWaitMs', 'maxWaitMs', 'responseWindowMs', 'attemptTtlMs']) {
    integer(raw[field], field, 1);
  }
  integer(raw.lifeXp, 'lifeXp');
  if (raw.maxWaitMs < raw.minWaitMs ||
      !Number.isSafeInteger(raw.maxWaitMs + raw.responseWindowMs) ||
      raw.attemptTtlMs <= raw.maxWaitMs + raw.responseWindowMs) {
    throw new TypeError('Invalid fishing timing policy');
  }
  return snapshot(raw);
}

export function validateFishingStartRequest(raw) {
  exactFields(raw, ['activityId', 'sourceRef', 'clientAttemptKey'], 'fishing start');
  if (raw.activityId !== FISHING_ACTIVITY_ID) throw new TypeError('Invalid fishing activity');
  return Object.freeze({
    activityId: FISHING_ACTIVITY_ID, sourceRef: source(raw.sourceRef),
    clientAttemptKey: uuid(raw.clientAttemptKey, 'clientAttemptKey')
  });
}

export function validateFishingInputRequest(raw) {
  exactFields(raw, ['attemptId', 'sourceRef', 'nonce', 'action'], 'fishing input');
  if (!['HOOK', 'CANCEL'].includes(raw.action)) throw new TypeError('Invalid fishing action');
  return Object.freeze({
    attemptId: uuid(raw.attemptId, 'attemptId'), sourceRef: source(raw.sourceRef),
    nonce: uuid(raw.nonce, 'nonce'), action: raw.action
  });
}

export function createFishingAttempt({
  request, actorUserId, attemptId, nonce, startedAtMs, policy, biteRoll
}) {
  const input = validateFishingStartRequest(request);
  const tuning = validatePolicy(policy);
  integer(startedAtMs, 'startedAtMs');
  if (!Number.isSafeInteger(startedAtMs + tuning.attemptTtlMs)) {
    throw new TypeError('Invalid expiry timestamp');
  }
  if (typeof biteRoll !== 'number' || !Number.isFinite(biteRoll) || biteRoll < 0 || biteRoll >= 1) {
    throw new TypeError('Invalid biteRoll');
  }
  // Inclusive integer wait range; randomness is sampled by the server once, before persistence.
  const waitMs = tuning.minWaitMs + Math.floor(biteRoll * (tuning.maxWaitMs - tuning.minWaitMs + 1));
  return snapshot({
    ...input, attemptId: uuid(attemptId, 'attemptId'),
    actorUserId: uuid(actorUserId, 'actorUserId'), nonce: uuid(nonce, 'nonce'),
    resolverVersion: FISHING_RESOLVER_VERSION, definitionVersion: 1, outcomeSchemaVersion: 1,
    status: 'ACTIVE', startedAtMs, biteAtMs: startedAtMs + waitMs,
    hookDeadlineMs: startedAtMs + waitMs + tuning.responseWindowMs,
    expiresAtMs: startedAtMs + tuning.attemptTtlMs, policy: tuning,
    terminalAction: null, result: null
  });
}

function assertAttempt(attempt) {
  if (!attempt || attempt.activityId !== FISHING_ACTIVITY_ID ||
      attempt.resolverVersion !== FISHING_RESOLVER_VERSION ||
      attempt.definitionVersion !== 1 || attempt.outcomeSchemaVersion !== 1 ||
      (attempt.status !== 'ACTIVE' && !TERMINAL.has(attempt.status))) {
    throw new TypeError('Invalid persisted fishing attempt');
  }
  for (const field of ['attemptId', 'actorUserId', 'nonce', 'clientAttemptKey']) uuid(attempt[field], field);
  source(attempt.sourceRef);
  const policy = validatePolicy(attempt.policy);
  for (const field of ['startedAtMs', 'biteAtMs', 'hookDeadlineMs', 'expiresAtMs']) integer(attempt[field], field);
  if (attempt.biteAtMs < attempt.startedAtMs + policy.minWaitMs ||
      attempt.biteAtMs > attempt.startedAtMs + policy.maxWaitMs ||
      attempt.hookDeadlineMs !== attempt.biteAtMs + policy.responseWindowMs ||
      attempt.expiresAtMs !== attempt.startedAtMs + policy.attemptTtlMs) {
    throw new TypeError('Invalid persisted fishing timing');
  }
  if (attempt.status === 'ACTIVE') {
    if (attempt.result !== null || attempt.terminalAction !== null) throw new TypeError('Invalid active fishing result');
  } else {
    const result = attempt.result;
    if (!result || result.resultRef !== `fishing_result:${attempt.attemptId}` ||
        result.attemptId !== attempt.attemptId || result.actorUserId !== attempt.actorUserId ||
        result.status !== attempt.status || result.policyVersion !== policy.policyVersion ||
        result.conditionSnapshot?.sourceRef !== attempt.sourceRef ||
        !['HOOK', 'CANCEL', 'EXPIRE'].includes(attempt.terminalAction)) {
      throw new TypeError('Invalid terminal fishing result');
    }
    assertTime(attempt, result.resolvedAtMs);
    if (result.activityId !== attempt.activityId || result.resolverVersion !== attempt.resolverVersion ||
        result.definitionVersion !== attempt.definitionVersion || result.outcomeSchemaVersion !== attempt.outcomeSchemaVersion ||
        result.conditionSnapshot.startedAtMs !== attempt.startedAtMs ||
        result.conditionSnapshot.biteAtMs !== attempt.biteAtMs ||
        result.conditionSnapshot.hookDeadlineMs !== attempt.hookDeadlineMs ||
        result.conditionSnapshot.expiresAtMs !== attempt.expiresAtMs || result.conditionSnapshot.weather !== 'UNKNOWN') {
      throw new TypeError('Invalid terminal fishing snapshot');
    }
    const expected = result.resolvedAtMs >= attempt.expiresAtMs ? ['EXPIRED', 'ATTEMPT_EXPIRED']
      : attempt.terminalAction === 'CANCEL' ? ['CANCELLED', 'PLAYER_CANCELLED']
        : result.resolvedAtMs < attempt.biteAtMs ? ['FAILED', 'PREMATURE_HOOK']
          : result.resolvedAtMs >= attempt.hookDeadlineMs ? ['FAILED', 'MISSED_BITE']
            : ['SUCCEEDED', 'CAUGHT'];
    if (result.status !== expected[0] || result.reason !== expected[1] ||
        (attempt.terminalAction === 'EXPIRE' && result.status !== 'EXPIRED')) {
      throw new TypeError('Invalid terminal fishing decision');
    }
    if (attempt.status === 'SUCCEEDED') {
      const caught = result.catch;
      exactFields(caught, ['speciesId', 'itemId', 'quantity', 'collectionEntryId', 'skillId', 'lifeXp'], 'fishing catch');
      if (caught.speciesId !== 'carp' || caught.itemId !== 'material.fish_carp' || caught.quantity !== 1 ||
          caught.collectionEntryId !== 'collection.fish.carp' || caught.skillId !== 'life.fishing' || caught.lifeXp !== policy.lifeXp) {
        throw new TypeError('Invalid terminal fishing catch');
      }
    } else if (result.catch !== null) {
      throw new TypeError('Non-success fishing result cannot carry a catch');
    }
  }
}

function assertActor(attempt, actorUserId) {
  if (uuid(actorUserId, 'actorUserId') !== attempt.actorUserId) throw new Error('Actor mismatch');
}

function assertTime(attempt, nowMs) {
  integer(nowMs, 'nowMs');
  if (nowMs < attempt.startedAtMs) throw new TypeError('Server time is before attempt start');
}

function finish(attempt, status, reason, terminalAction, nowMs) {
  return snapshot({
    ...attempt, status, terminalAction,
    result: {
      resultRef: `fishing_result:${attempt.attemptId}`, activityId: FISHING_ACTIVITY_ID,
      attemptId: attempt.attemptId, actorUserId: attempt.actorUserId, status, reason,
      resolverVersion: attempt.resolverVersion, definitionVersion: attempt.definitionVersion,
      outcomeSchemaVersion: attempt.outcomeSchemaVersion, policyVersion: attempt.policy.policyVersion,
      resolvedAtMs: nowMs,
      conditionSnapshot: {
        sourceRef: attempt.sourceRef, startedAtMs: attempt.startedAtMs,
        biteAtMs: attempt.biteAtMs, hookDeadlineMs: attempt.hookDeadlineMs,
        expiresAtMs: attempt.expiresAtMs, weather: 'UNKNOWN'
      },
      // Grant intent only. Inventory / Discovery / XP writes belong to the later settlement adapter.
      catch: status === 'SUCCEEDED' ? {
        speciesId: 'carp', itemId: 'material.fish_carp', quantity: 1,
        collectionEntryId: 'collection.fish.carp', skillId: 'life.fishing', lifeXp: attempt.policy.lifeXp
      } : null
    }
  });
}

export function resolveFishingAttempt({ attempt, request, actorUserId, nowMs }) {
  assertAttempt(attempt);
  assertActor(attempt, actorUserId);
  const input = validateFishingInputRequest(request);
  if (input.attemptId !== attempt.attemptId || input.sourceRef !== attempt.sourceRef || input.nonce !== attempt.nonce) {
    throw new Error('Fishing identity mismatch');
  }
  assertTime(attempt, nowMs);
  // Read persisted outcome before deadline checks. A lost response never causes a new outcome.
  if (TERMINAL.has(attempt.status)) {
    if (attempt.terminalAction !== 'EXPIRE' && attempt.terminalAction !== input.action) {
      throw new Error('Terminal command conflict');
    }
    return snapshot(attempt);
  }
  if (nowMs >= attempt.expiresAtMs) return finish(attempt, 'EXPIRED', 'ATTEMPT_EXPIRED', input.action, nowMs);
  if (input.action === 'CANCEL') return finish(attempt, 'CANCELLED', 'PLAYER_CANCELLED', input.action, nowMs);
  if (nowMs < attempt.biteAtMs) return finish(attempt, 'FAILED', 'PREMATURE_HOOK', input.action, nowMs);
  if (nowMs >= attempt.hookDeadlineMs) return finish(attempt, 'FAILED', 'MISSED_BITE', input.action, nowMs);
  return finish(attempt, 'SUCCEEDED', 'CAUGHT', input.action, nowMs);
}

// Server-only timer path. It cannot cancel, catch or grant anything before TTL.
export function expireFishingAttempt({ attempt, nowMs }) {
  assertAttempt(attempt);
  assertTime(attempt, nowMs);
  return TERMINAL.has(attempt.status) || nowMs < attempt.expiresAtMs
    ? snapshot(attempt) : finish(attempt, 'EXPIRED', 'ATTEMPT_EXPIRED', 'EXPIRE', nowMs);
}

export function projectFishingAttempt({ attempt, actorUserId }) {
  assertAttempt(attempt);
  assertActor(attempt, actorUserId);
  return snapshot({
    activityId: attempt.activityId, attemptId: attempt.attemptId, sourceRef: attempt.sourceRef,
    clientAttemptKey: attempt.clientAttemptKey, nonce: attempt.nonce, status: attempt.status,
    startedAtMs: attempt.startedAtMs, biteAtMs: attempt.biteAtMs,
    hookDeadlineMs: attempt.hookDeadlineMs, expiresAtMs: attempt.expiresAtMs, result: attempt.result
  });
}
