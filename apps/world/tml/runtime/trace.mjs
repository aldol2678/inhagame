import { canonicalTmlData, snapshotTmlData } from './value-snapshot.mjs';

function assertTime(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be an ISO-compatible timestamp`);
  }
}

function fail(code, message) {
  throw Object.assign(new TypeError(message), { code });
}

// Tuple boundaries and exact string contents are retained. This is a record
// reference, not a provider or database idempotency key.
export function createTmlRecordId(kind, identityTuple) {
  if (typeof kind !== 'string' || kind.length === 0 || kind.includes(':') || !Array.isArray(identityTuple)) {
    throw new TypeError('record identity requires a nonempty colon-free kind and identity tuple');
  }
  return `${kind}:${canonicalTmlData(identityTuple)}`;
}

export function snapshotTmlRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('trace records must be an array');
  // Ownership rejects unsupported properties instead of discarding them.
  const owned = snapshotTmlData(records);
  const byId = new Map();
  const unique = [];
  for (const record of owned) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        typeof record.kind !== 'string' || record.kind.length === 0 ||
        typeof record.id !== 'string' || record.id.length === 0) {
      throw new TypeError('trace record requires nonempty kind and id');
    }
    const content = canonicalTmlData(record);
    if (byId.has(record.id)) {
      if (byId.get(record.id) !== content) {
        fail('TML_DUPLICATE_RECORD_ID', `conflicting duplicate trace record id: ${record.id}`);
      }
      continue;
    }
    byId.set(record.id, content);
    unique.push(record);
  }
  return Object.freeze(unique);
}

function assertNoPreconditionVerification(record) {
  const evaluation = record.extensions?.evaluation;
  if (evaluation?.basis !== 'NO_PRECONDITION') return false;
  if (record.status !== 'SATISFIED' || record.evidence.length !== 0 ||
      evaluation.evaluator !== 'tml.expression.v0.1' ||
      evaluation.inputs?.phase !== 'precondition' ||
      !evaluation.inputs.transition || evaluation.inputs.transition.id !== record.transition ||
      evaluation.inputs.transition.precondition !== undefined ||
      evaluation.result?.status !== 'SATISFIED' ||
      evaluation.result.reason !== 'NO_CONDITION' ||
      !Array.isArray(evaluation.result.factIds) || evaluation.result.factIds.length !== 0) {
    fail('TML_NO_PRECONDITION_INVALID', 'NO_PRECONDITION verification must capture an omitted precondition without evidence');
  }
  return true;
}

export function assertTmlRecordReferences(records) {
  const owned = snapshotTmlRecords(records);
  const byId = new Map(owned.map((record) => [record.id, record]));

  function references(record, field, kind) {
    if (!Array.isArray(record[field]) || record[field].some((id) => typeof id !== 'string' || id.length === 0)) {
      fail('TML_RECORD_REFERENCE_INVALID', `${record.kind}.${field} must contain record ids`);
    }
    for (const id of record[field]) {
      const target = byId.get(id);
      if (!target) fail('TML_RECORD_REFERENCE_MISSING', `unresolved ${record.kind}.${field} reference: ${id}`);
      if (target.kind !== kind) {
        fail('TML_RECORD_REFERENCE_KIND', `${record.kind}.${field} reference ${id} must resolve to ${kind}`);
      }
    }
  }

  for (const record of owned) {
    if (record.kind === 'observation') references(record, 'facts', 'fact');
    if (record.kind === 'evidence') {
      references(record, 'facts', 'fact');
      references(record, 'observations', 'observation');
    }
    if (record.kind === 'verification') {
      references(record, 'evidence', 'evidence');
      const noPrecondition = assertNoPreconditionVerification(record);
      if (record.status === 'SATISFIED' && record.evidence.length === 0 && !noPrecondition) {
        fail('TML_RECORD_REFERENCE_MISSING', 'SATISFIED verification requires evidence or an explicit NO_PRECONDITION basis');
      }
    }
  }
  return owned;
}

export function createTmlTraceRecorder({
  id,
  module,
  profile,
  startedAt = new Date().toISOString()
} = {}) {
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('trace id is required');
  if (typeof module !== 'string' || module.length === 0) throw new TypeError('module id is required');
  if (typeof profile !== 'string' || profile.length === 0) throw new TypeError('profile id is required');
  assertTime(startedAt, 'startedAt');

  let records = Object.freeze([]);
  let endedAt = null;

  function ensureOpen() {
    if (endedAt !== null) throw new Error('TML trace is already closed');
  }

  function stageBatch(batch) {
    ensureOpen();
    const owned = snapshotTmlRecords(batch);
    return snapshotTmlRecords([...records, ...owned]);
  }

  function append(record) {
    ensureOpen();
    const batch = snapshotTmlRecords([record]);
    const staged = stageBatch(batch);
    records = staged;
    return records.find((item) => item.id === batch[0].id);
  }

  return Object.freeze({
    append,

    appendBatch(batch) {
      records = stageBatch(batch);
      return this;
    },

    appendReadResult(readResult) {
      ensureOpen();
      const owned = snapshotTmlData(readResult);
      if (!owned || !Array.isArray(owned.observations) || !Array.isArray(owned.facts)) {
        throw new TypeError('readResult must contain observations and facts');
      }
      if (owned.observations.some((record) => record?.kind !== 'observation') ||
          owned.facts.some((record) => record?.kind !== 'fact')) {
        throw new TypeError('readResult observations and facts must have their declared record kinds');
      }
      const batch = [...owned.observations, ...owned.facts];
      // Readers supply a closed batch. Observations may precede their facts.
      assertTmlRecordReferences(batch);
      records = stageBatch(batch);
      return this;
    },

    appendVerificationResult(result) {
      ensureOpen();
      const owned = snapshotTmlData(result);
      if (!owned?.verification || owned.verification.kind !== 'verification') {
        throw new TypeError('verification result must contain evidence and verification');
      }
      if (owned.evidence === null) {
        assertTmlRecordReferences([owned.verification]);
        if (owned.verification.extensions?.evaluation?.basis !== 'NO_PRECONDITION') {
          throw new TypeError('omitted evidence requires an explicit NO_PRECONDITION basis');
        }
        records = stageBatch([owned.verification]);
      } else {
        if (owned.evidence?.kind !== 'evidence') {
          throw new TypeError('verification result must contain evidence and verification');
        }
        records = stageBatch([owned.evidence, owned.verification]);
      }
      return this;
    },

    close(value = new Date().toISOString()) {
      ensureOpen();
      assertTime(value, 'endedAt');
      // Do not mark an unresolved trace complete. PR1 can still retain its
      // owned partial snapshot after this validation throws.
      assertTmlRecordReferences(records);
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
