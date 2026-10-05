const STATUS = Object.freeze({
  SATISFIED: 'SATISFIED',
  UNSATISFIED: 'UNSATISFIED',
  UNKNOWN: 'UNKNOWN',
  CONFLICT: 'CONFLICT'
});

function stableValue(value) {
  return JSON.stringify(value);
}

function sameTmlValue(left, right) {
  return stableValue(left) === stableValue(right);
}

function compareValue(op, actual, expected) {
  if (!actual || !expected || actual.type !== expected.type) return false;
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
  for (const fact of selected.facts) distinct.set(stableValue(fact.value), fact);

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

export function evaluateTmlExpression(expr, facts, profile) {
  if (!expr || typeof expr !== 'object') {
    return { status: STATUS.UNKNOWN, factIds: [], reason: 'INVALID_EXPRESSION' };
  }

  if (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists'].includes(expr.op)) {
    return atomicVerification(expr, facts, profile);
  }

  if (expr.op === 'and' && Array.isArray(expr.args) && expr.args.length > 0) {
    return combineAnd(expr.args.map((child) => evaluateTmlExpression(child, facts, profile)));
  }

  if (expr.op === 'or' && Array.isArray(expr.args) && expr.args.length > 0) {
    return combineOr(expr.args.map((child) => evaluateTmlExpression(child, facts, profile)));
  }

  if (expr.op === 'not') return invert(evaluateTmlExpression(expr.arg, facts, profile));

  return { status: STATUS.UNKNOWN, factIds: [], reason: 'UNSUPPORTED_EXPRESSION' };
}

function observationIdsForFacts(observations, factIds) {
  const wanted = new Set(factIds);
  return observations
    .filter((observation) => observation?.kind === 'observation' &&
      Array.isArray(observation.facts) &&
      observation.facts.some((factId) => wanted.has(factId)))
    .map((observation) => observation.id);
}

function token(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-|-$/g, '');
}

export function createTmlEvidence({
  id,
  claim,
  observations = [],
  facts = [],
  profile
}) {
  const result = evaluateTmlExpression(claim, facts, profile);
  const evidenceId = id ?? `evidence.${token(claim?.subject ?? 'compound')}.${token(claim?.predicate ?? claim?.op ?? 'claim')}`;

  return Object.freeze({
    evaluation: Object.freeze(result),
    evidence: Object.freeze({
      kind: 'evidence',
      id: evidenceId,
      claim,
      observations: Object.freeze(observationIdsForFacts(observations, result.factIds)),
      facts: Object.freeze([...result.factIds])
    })
  });
}

export function createTmlVerification({
  id,
  transitionId,
  evidence,
  status,
  checkedAt
}) {
  if (!transitionId) throw new TypeError('transitionId is required');
  if (!evidence?.id) throw new TypeError('evidence is required');
  if (!Object.values(STATUS).includes(status)) throw new TypeError('unsupported verification status');
  if (typeof checkedAt !== 'string' || !Number.isFinite(Date.parse(checkedAt))) {
    throw new TypeError('checkedAt must be an ISO-compatible timestamp');
  }

  return Object.freeze({
    kind: 'verification',
    id: id ?? `verification.${token(transitionId)}.${token(checkedAt)}`,
    transition: transitionId,
    evidence: Object.freeze([evidence.id]),
    status,
    checked_at: checkedAt
  });
}

export function verifyTmlTransition({
  transition,
  profile,
  observations = [],
  facts = [],
  checkedAt = new Date().toISOString(),
  phase = 'postcondition'
}) {
  if (!transition?.id) throw new TypeError('transition with id is required');
  const claim = phase === 'precondition' ? transition.precondition : transition.postcondition;
  if (!claim) {
    const evidence = Object.freeze({
      kind: 'evidence',
      id: `evidence.${token(transition.id)}.${phase}`,
      claim: { op: 'exists', subject: transition.subject ?? transition.id, predicate: '__implicit_true__' },
      observations: Object.freeze([]),
      facts: Object.freeze([])
    });
    const verification = createTmlVerification({
      transitionId: transition.id,
      evidence,
      status: STATUS.SATISFIED,
      checkedAt
    });
    return Object.freeze({
      status: STATUS.SATISFIED,
      reason: 'NO_CONDITION',
      evidence,
      verification
    });
  }

  const built = createTmlEvidence({
    id: `evidence.${token(transition.id)}.${phase}`,
    claim,
    observations,
    facts,
    profile
  });
  const verification = createTmlVerification({
    id: `verification.${token(transition.id)}.${phase}.${token(checkedAt)}`,
    transitionId: transition.id,
    evidence: built.evidence,
    status: built.evaluation.status,
    checkedAt
  });

  return Object.freeze({
    status: built.evaluation.status,
    reason: built.evaluation.reason,
    evidence: built.evidence,
    verification
  });
}

export { STATUS as TML_VERIFICATION_STATUS };
