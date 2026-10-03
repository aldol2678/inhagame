import { canonicalTmlValue, sameTmlValue, snapshotTmlData } from './value-snapshot.mjs';
import { assertTmlRecordReferences, createTmlRecordId, snapshotTmlRecords } from './trace.mjs';

const STATUS = Object.freeze({
  SATISFIED: 'SATISFIED',
  UNSATISFIED: 'UNSATISFIED',
  UNKNOWN: 'UNKNOWN',
  CONFLICT: 'CONFLICT'
});

function compareValue(op, actual, expected) {
  // Equality is structural, including nested TML types. Time equality remains
  // lexical; this does not change the existing relational time interpretation.
  canonicalTmlValue(actual);
  canonicalTmlValue(expected);
  if (actual.type !== expected.type) return false;
  if (op === 'eq') return sameTmlValue(actual, expected);
  if (op === 'ne') return !sameTmlValue(actual, expected);

  if (!['number', 'string', 'time'].includes(actual.type)) return false;
  const left = actual.type === 'time' ? Date.parse(actual.value) : actual.value;
  const right = expected.type === 'time' ? Date.parse(expected.value) : expected.value;
  if ((actual.type === 'time') && (!Number.isFinite(left) || !Number.isFinite(right))) return false;

  if (op === 'gt') return left > right;
  if (op === 'gte') return left >= right;
  if (op === 'lt') return left < right;
  if (op === 'lte') return left <= right;
  return false;
}

function authorityFor(profile, predicate) {
  return profile?.authority?.find?.((rule) => rule?.predicate === predicate) ?? null;
}

function factsForClaim(facts, subject, predicate) {
  return facts.filter((fact) =>
    fact?.kind === 'fact' &&
    fact.subject === subject &&
    fact.predicate === predicate
  );
}

function authoritativeFacts(facts, profile, subject, predicate) {
  const rule = authorityFor(profile, predicate);
  if (!rule) return { rule: null, facts: [] };

  const authoritative = factsForClaim(facts, subject, predicate)
    .filter((fact) => fact.source === rule.authority);

  if (authoritative.length === 0) return { rule, facts: [] };

  const validTimes = authoritative
    .map((fact) => Date.parse(fact.observed_at))
    .filter(Number.isFinite);
  if (validTimes.length === 0) return { rule, facts: authoritative };

  const latest = Math.max(...validTimes);
  const latestFacts = authoritative.filter((fact) => Date.parse(fact.observed_at) === latest);
  const sequences = latestFacts
    .map((fact) => fact?.extensions?.observation_sequence)
    .filter(Number.isInteger);
  if (sequences.length === 0) return { rule, facts: latestFacts };
  const latestSequence = Math.max(...sequences);
  return {
    rule,
    facts: latestFacts.filter((fact) => fact?.extensions?.observation_sequence === latestSequence)
  };
}

function atomicVerification(expr, facts, profile) {
  const selected = authoritativeFacts(facts, profile, expr.subject, expr.predicate);

  if (!selected.rule) {
    return {
      status: STATUS.UNKNOWN,
      factIds: [],
      reason: 'AUTHORITY_RULE_MISSING'
    };
  }

  if (selected.facts.length === 0) {
    return {
      status: STATUS.UNKNOWN,
      factIds: [],
      reason: 'AUTHORITATIVE_FACT_MISSING'
    };
  }

  const distinct = new Map();
  for (const fact of selected.facts) distinct.set(canonicalTmlValue(fact.value), fact);

  if (distinct.size > 1) {
    return {
      status: STATUS.CONFLICT,
      factIds: selected.facts.map((fact) => fact.id),
      reason: 'AUTHORITATIVE_FACT_CONFLICT'
    };
  }

  const fact = selected.facts.at(-1);
  if (expr.op === 'exists') {
    return {
      status: STATUS.SATISFIED,
      factIds: [fact.id],
      reason: 'AUTHORITATIVE_FACT_PRESENT'
    };
  }

  return {
    status: compareValue(expr.op, fact.value, expr.value) ? STATUS.SATISFIED : STATUS.UNSATISFIED,
    factIds: [fact.id],
    reason: 'AUTHORITATIVE_COMPARISON'
  };
}

function combineAnd(children) {
  const factIds = children.flatMap((child) => child.factIds);
  if (children.some((child) => child.status === STATUS.CONFLICT)) {
    return { status: STATUS.CONFLICT, factIds, reason: 'AND_CONFLICT' };
  }
  if (children.some((child) => child.status === STATUS.UNSATISFIED)) {
    return { status: STATUS.UNSATISFIED, factIds, reason: 'AND_UNSATISFIED' };
  }
  if (children.some((child) => child.status === STATUS.UNKNOWN)) {
    return { status: STATUS.UNKNOWN, factIds, reason: 'AND_UNKNOWN' };
  }
  return { status: STATUS.SATISFIED, factIds, reason: 'AND_SATISFIED' };
}

function combineOr(children) {
  const factIds = children.flatMap((child) => child.factIds);
  if (children.some((child) => child.status === STATUS.SATISFIED)) {
    return { status: STATUS.SATISFIED, factIds, reason: 'OR_SATISFIED' };
  }
  if (children.some((child) => child.status === STATUS.CONFLICT)) {
    return { status: STATUS.CONFLICT, factIds, reason: 'OR_CONFLICT' };
  }
  if (children.some((child) => child.status === STATUS.UNKNOWN)) {
    return { status: STATUS.UNKNOWN, factIds, reason: 'OR_UNKNOWN' };
  }
  return { status: STATUS.UNSATISFIED, factIds, reason: 'OR_UNSATISFIED' };
}

function invert(result) {
  if (result.status === STATUS.SATISFIED) return { ...result, status: STATUS.UNSATISFIED, reason: 'NOT_SATISFIED' };
  if (result.status === STATUS.UNSATISFIED) return { ...result, status: STATUS.SATISFIED, reason: 'NOT_UNSATISFIED' };
  return result;
}

function evaluateExpression(expr, facts, profile) {
  if (!expr || typeof expr !== 'object') {
    return { status: STATUS.UNKNOWN, factIds: [], reason: 'INVALID_EXPRESSION' };
  }

  if (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists'].includes(expr.op)) {
    return atomicVerification(expr, facts, profile);
  }

  if (expr.op === 'and' && Array.isArray(expr.args) && expr.args.length > 0) {
    return combineAnd(expr.args.map((child) => evaluateExpression(child, facts, profile)));
  }

  if (expr.op === 'or' && Array.isArray(expr.args) && expr.args.length > 0) {
    return combineOr(expr.args.map((child) => evaluateExpression(child, facts, profile)));
  }

  if (expr.op === 'not') return invert(evaluateExpression(expr.arg, facts, profile));

  return { status: STATUS.UNKNOWN, factIds: [], reason: 'UNSUPPORTED_EXPRESSION' };
}

export function evaluateTmlExpression(expr, facts, profile) {
  const inputs = snapshotTmlData({ expr, facts, profile });
  return snapshotTmlData(evaluateExpression(inputs.expr, inputs.facts, inputs.profile));
}

function observationIdsForFacts(observations, factIds) {
  const wanted = new Set(factIds);
  return observations
    .filter((observation) => observation?.kind === 'observation' &&
      Array.isArray(observation.facts) &&
      observation.facts.some((factId) => wanted.has(factId)))
    .map((observation) => observation.id);
}

export function createTmlEvidence({
  id,
  claim,
  observations = [],
  facts = [],
  profile,
  recordContext = [],
  evaluationContext = null
}) {
  // Own the whole candidate pool before evaluation. Keeping only selected
  // fact IDs would lose the inputs to absence, recency, and conflict decisions.
  const supplied = snapshotTmlData({ claim, facts, observations, profile, recordContext, evaluationContext });
  if (!Array.isArray(supplied.facts) || !supplied.facts.every((fact) => fact?.kind === 'fact') ||
      !Array.isArray(supplied.observations) || !supplied.observations.every((observation) => observation?.kind === 'observation')) {
    throw new TypeError('evidence requires fact and observation arrays');
  }
  if (!Array.isArray(supplied.recordContext)) throw new TypeError('recordContext must be an array');
  const records = snapshotTmlRecords([...supplied.observations, ...supplied.facts]);
  assertTmlRecordReferences(records);
  const inputs = snapshotTmlData({
    claim: supplied.claim,
    profile: supplied.profile,
    facts: records.filter((record) => record.kind === 'fact'),
    observations: records.filter((record) => record.kind === 'observation'),
    recordContext: supplied.recordContext
  });
  const result = snapshotTmlData(evaluateExpression(inputs.claim, inputs.facts, inputs.profile));
  const evidenceId = id ?? createTmlRecordId('evidence', [
    supplied.evaluationContext, inputs.recordContext, inputs.claim, inputs.profile?.id ?? null,
    inputs.facts.map((fact) => fact.id), inputs.observations.map((observation) => observation.id)
  ]);
  const evidence = snapshotTmlData({
    kind: 'evidence',
    id: evidenceId,
    claim: inputs.claim,
    observations: observationIdsForFacts(inputs.observations, result.factIds),
    facts: [...new Set(result.factIds)],
    extensions: {
      evaluation: {
        basis: 'CLAIM', evaluator: 'tml.expression.v0.1',
        context: supplied.evaluationContext, inputs, result
      }
    }
  });
  assertTmlRecordReferences(snapshotTmlRecords([...records, evidence]));
  return snapshotTmlData({ evaluation: result, evidence });
}

export function createTmlVerification({
  id,
  transitionId,
  evidence,
  status,
  checkedAt,
  evaluation = null
}) {
  if (typeof transitionId !== 'string' || transitionId.length === 0) throw new TypeError('transitionId is required');
  if (!Object.values(STATUS).includes(status)) throw new TypeError('unsupported verification status');
  if (typeof checkedAt !== 'string' || !Number.isFinite(Date.parse(checkedAt))) {
    throw new TypeError('checkedAt must be an ISO-compatible timestamp');
  }
  if (id !== undefined && (typeof id !== 'string' || id.length === 0)) throw new TypeError('verification id must be a nonempty string');

  const ownedEvidence = snapshotTmlData(evidence);
  const ownedEvaluation = snapshotTmlData(evaluation);
  const noPrecondition = ownedEvidence == null && ownedEvaluation?.basis === 'NO_PRECONDITION';
  if (!noPrecondition && (ownedEvidence?.kind !== 'evidence' || typeof ownedEvidence.id !== 'string' || ownedEvidence.id.length === 0)) {
    throw new TypeError('evidence is required');
  }
  if (ownedEvidence?.extensions?.evaluation?.result?.status !== undefined &&
      ownedEvidence.extensions.evaluation.result.status !== status) {
    throw new TypeError('verification status must match the captured evaluation');
  }
  if (!noPrecondition && ownedEvaluation !== null) throw new TypeError('explicit evaluation is only supported for no precondition');
  const verification = snapshotTmlData({
    kind: 'verification',
    id: id ?? createTmlRecordId('verification', [
      transitionId, checkedAt, ownedEvidence?.id ?? null,
      noPrecondition ? [ownedEvaluation.basis, ownedEvaluation.inputs?.profile?.id ?? null, ownedEvaluation.inputs?.recordContext] : null
    ]),
    transition: transitionId,
    evidence: noPrecondition ? [] : [ownedEvidence.id],
    status,
    checked_at: checkedAt,
    ...(noPrecondition ? { extensions: { evaluation: ownedEvaluation } } : {})
  });
  if (noPrecondition) assertTmlRecordReferences([verification]);
  return verification;
}

export function verifyTmlTransition({
  transition,
  profile,
  observations = [],
  facts = [],
  checkedAt = new Date().toISOString(),
  phase = 'postcondition',
  recordContext = []
}) {
  const inputs = snapshotTmlData({ transition, profile, observations, facts, phase, recordContext });
  if (typeof inputs.transition?.id !== 'string' || inputs.transition.id.length === 0) throw new TypeError('transition with id is required');
  if (!['precondition', 'postcondition'].includes(phase)) throw new TypeError('unsupported verification phase');
  if (!Array.isArray(inputs.recordContext)) throw new TypeError('recordContext must be an array');
  const claim = inputs.transition[phase];
  if (phase === 'precondition' && claim === undefined) {
    // The published verification permits an empty evidence array. Record the
    // absence here instead of inventing an ordinary fact claim for truth.
    const evaluation = snapshotTmlData({
      basis: 'NO_PRECONDITION', evaluator: 'tml.expression.v0.1',
      inputs: { transition: inputs.transition, profile: inputs.profile, phase, recordContext: inputs.recordContext },
      result: { status: STATUS.SATISFIED, factIds: [], reason: 'NO_CONDITION' }
    });
    const verification = createTmlVerification({
      transitionId: inputs.transition.id,
      evidence: null,
      status: STATUS.SATISFIED,
      checkedAt,
      evaluation
    });
    return snapshotTmlData({
      status: STATUS.SATISFIED,
      reason: 'NO_CONDITION',
      evidence: null,
      verification
    });
  }
  if (!claim) throw new TypeError(`${phase} must be a condition`);

  const built = createTmlEvidence({
    claim,
    observations: inputs.observations,
    facts: inputs.facts,
    profile: inputs.profile,
    recordContext: inputs.recordContext,
    evaluationContext: { transitionId: inputs.transition.id, phase, checkedAt }
  });
  const verification = createTmlVerification({
    transitionId: inputs.transition.id,
    evidence: built.evidence,
    status: built.evaluation.status,
    checkedAt
  });

  return snapshotTmlData({
    status: built.evaluation.status,
    reason: built.evaluation.reason,
    evidence: built.evidence,
    verification
  });
}

export { STATUS as TML_VERIFICATION_STATUS };
