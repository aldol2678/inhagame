function assertTime(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO-compatible timestamp`);
  }
}

function freezeRecord(record) {
  return Object.freeze(record);
}

export function createTmlTraceRecorder({
  id,
  module,
  profile,
  startedAt = new Date().toISOString()
} = {}) {
  if (!id) throw new TypeError('trace id is required');
  if (!module) throw new TypeError('module id is required');
  if (!profile) throw new TypeError('profile id is required');
  assertTime(startedAt, 'startedAt');

  const records = [];
  let endedAt = null;

  function ensureOpen() {
    if (endedAt !== null) throw new Error('TML trace is already closed');
  }

  function append(record) {
    ensureOpen();
    if (!record || typeof record !== 'object' || typeof record.kind !== 'string' || typeof record.id !== 'string') {
      throw new TypeError('trace record requires kind and id');
    }
    records.push(freezeRecord(record));
    return record;
  }

  return Object.freeze({
    append,

    appendReadResult(readResult) {
      ensureOpen();
      if (!readResult || !Array.isArray(readResult.observations) || !Array.isArray(readResult.facts)) {
        throw new TypeError('readResult must contain observations and facts');
      }
      for (const observation of readResult.observations) append(observation);
      for (const fact of readResult.facts) append(fact);
      return this;
    },

    appendVerificationResult(result) {
      ensureOpen();
      if (!result?.evidence || !result?.verification) {
        throw new TypeError('verification result must contain evidence and verification');
      }
      append(result.evidence);
      append(result.verification);
      return this;
    },

    close(value = new Date().toISOString()) {
      ensureOpen();
      assertTime(value, 'endedAt');
      endedAt = value;
      return this.snapshot();
    },

    snapshot() {
      const trace = {
        schema: 'tml.trace',
        version: '0.1',
        id,
        module,
        profile,
        started_at: startedAt,
        records: Object.freeze([...records])
      };
      if (endedAt !== null) trace.ended_at = endedAt;
      return Object.freeze(trace);
    }
  });
}
