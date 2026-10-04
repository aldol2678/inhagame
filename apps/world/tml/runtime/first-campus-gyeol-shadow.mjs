import { QUEST_ID } from '../../npc-factory/quest-contract.mjs';
import {
  buildTmlGyeolVerdictRequest,
  GYEOL_VERDICT_STATUS
} from './gyeol-verdict-contract.mjs';
import { createTmlGyeolMockAdapter } from './gyeol-mock-adapter.mjs';
import {
  createTmlVerification,
  TML_VERIFICATION_STATUS
} from './verification.mjs';

export const TML_FIRST_CAMPUS_GYEOL_SHADOW_MODE = 'GYEOL_SHADOW_P21';
export const TML_FIRST_CAMPUS_GYEOL_POLICY = 'gyeol.inha-world.quest-first-campus-shadow@p21';

export const TML_FIRST_CAMPUS_GYEOL_SHADOW_STATUS = Object.freeze({
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  UNKNOWN: 'UNKNOWN',
  IDLE: 'IDLE'
});

const QUEST_REF = `quest.${QUEST_ID}`;
const COMPLETE_STAGE = 5;
const TRANSITION_ID = 'transition.inha-world.campus_first_walk_v1.complete-shadow';

function freezeCopy(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy));
  if (typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freezeCopy(item)])
    ));
  }
  return value;
}

function token(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-|-$/g, '');
}

function checkedTime(now) {
  const value = now();
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('P21 now() must return an ISO-compatible timestamp');
  }
  return value;
}

function validServerResult(result) {
  return Boolean(result && typeof result === 'object' &&
    result.quest_id === QUEST_ID &&
    Number.isInteger(result.stage) &&
    result.stage >= 0 &&
    result.stage <= COMPLETE_STAGE);
}

function buildTmlCompletionRecords({ result, observedAt, sequence }) {
  const suffix = `${token(observedAt)}.${sequence}`;
  const factId = `fact.${QUEST_REF}.quest.stage.${suffix}`;
  const observationId = `observation.${QUEST_REF}.quest.stage.${suffix}`;
  const evidenceId = `evidence.p21.first-campus.complete.${suffix}`;
  const claim = freezeCopy({
    op: 'eq',
    subject: QUEST_REF,
    predicate: 'quest.stage',
    value: { type: 'number', value: COMPLETE_STAGE }
  });
  const fact = freezeCopy({
    kind: 'fact',
    id: factId,
    subject: QUEST_REF,
    predicate: 'quest.stage',
    value: { type: 'number', value: result.stage },
    source: 'server.quest',
    observed_at: observedAt,
    confidence: 1,
    extensions: { p21_sequence: sequence }
  });
  const observation = freezeCopy({
    kind: 'observation',
    id: observationId,
    source: 'server.quest',
    observed_at: observedAt,
    query: { subject: QUEST_REF, predicate: 'quest.stage' },
    facts: [factId],
    extensions: { p21_sequence: sequence }
  });
  const verificationStatus = result.stage === COMPLETE_STAGE
    ? TML_VERIFICATION_STATUS.SATISFIED
    : TML_VERIFICATION_STATUS.UNSATISFIED;
  const evidence = freezeCopy({
    kind: 'evidence',
    id: evidenceId,
    claim,
    observations: [observationId],
    facts: [factId]
  });
  const verification = createTmlVerification({
    id: `verification.p21.first-campus.complete.${suffix}`,
    transitionId: TRANSITION_ID,
    evidence,
    status: verificationStatus,
    checkedAt: observedAt
  });
  return freezeCopy({ fact, observation, evidence, verification });
}

function decisionForP21(request) {
  const verified = request.verification.status === TML_VERIFICATION_STATUS.SATISFIED;
  const incomplete = request.verification.status === TML_VERIFICATION_STATUS.UNSATISFIED;
  return {
    status: verified
      ? GYEOL_VERDICT_STATUS.VERIFIED
      : incomplete
        ? GYEOL_VERDICT_STATUS.HOLD
        : GYEOL_VERDICT_STATUS.UNKNOWN,
    reasons: [{
      code: verified
        ? 'P21_FIRST_CAMPUS_COMPLETE'
        : incomplete
          ? 'P21_FIRST_CAMPUS_INCOMPLETE'
          : 'P21_FIRST_CAMPUS_UNRESOLVED'
    }],
    evidence_used: [request.evidence[0].id]
  };
}

export function createTmlFirstCampusGyeolShadow({
  enabled = true,
  now = () => new Date().toISOString()
} = {}) {
  let observations = 0;
  let matches = 0;
  let mismatches = 0;
  let unknown = 0;
  let sequence = 0;
  let scopeResets = 0;
  let latest = null;

  const adapter = createTmlGyeolMockAdapter({
    source: 'TEST_MOCK',
    mockOnly: true,
    now,
    decide: async request => decisionForP21(request)
  });

  async function observeQuestResult({ event, previousStage, result } = {}) {
    if (!enabled) return null;

    if (!validServerResult(result)) {
      observations += 1;
      mismatches += 1;
      latest = freezeCopy({
        mode: TML_FIRST_CAMPUS_GYEOL_SHADOW_MODE,
        kind: 'first-campus-completion',
        status: TML_FIRST_CAMPUS_GYEOL_SHADOW_STATUS.MISMATCH,
        reason: 'INVALID_SERVER_RESULT',
        event: event ?? null,
        previousStage: Number.isInteger(previousStage) ? previousStage : null,
        actualStage: result?.stage ?? null,
        runtimeEffect: 'NONE',
        persistenceEffect: 'NONE',
        authorityChangeAllowed: false
      });
      return latest;
    }

    const observedAt = checkedTime(now);
    const records = buildTmlCompletionRecords({
      result,
      observedAt,
      sequence: ++sequence
    });
    const legacyComplete = result.stage === COMPLETE_STAGE;
    const request = buildTmlGyeolVerdictRequest({
      verification: records.verification,
      evidence: [records.evidence],
      context: {
        domain: 'quest',
        questId: QUEST_ID,
        questRef: QUEST_REF,
        event: typeof event === 'string' ? event : null,
        previousStage: Number.isInteger(previousStage) ? previousStage : null,
        actualStage: result.stage,
        legacyComplete
      },
      policyRef: TML_FIRST_CAMPUS_GYEOL_POLICY,
      requestedAt: observedAt
    });

    try {
      const verdict = await adapter.evaluate(request);
      const expectedVerdict = legacyComplete
        ? GYEOL_VERDICT_STATUS.VERIFIED
        : GYEOL_VERDICT_STATUS.HOLD;
      const parity = verdict.status === expectedVerdict;
      observations += 1;
      if (parity) matches += 1;
      else mismatches += 1;
      latest = freezeCopy({
        mode: TML_FIRST_CAMPUS_GYEOL_SHADOW_MODE,
        kind: 'first-campus-completion',
        status: parity
          ? TML_FIRST_CAMPUS_GYEOL_SHADOW_STATUS.MATCH
          : TML_FIRST_CAMPUS_GYEOL_SHADOW_STATUS.MISMATCH,
        reason: parity ? 'GYEOL_LEGACY_COMPLETION_MATCH' : 'GYEOL_LEGACY_COMPLETION_MISMATCH',
        event: typeof event === 'string' ? event : null,
        previousStage: Number.isInteger(previousStage) ? previousStage : null,
        actualStage: result.stage,
        legacyComplete,
        expectedVerdict,
        gyeolVerdict: verdict.status,
        tmlVerification: records.verification.status,
        requestId: request.id,
        evidenceId: records.evidence.id,
        observedAt,
        policyRef: TML_FIRST_CAMPUS_GYEOL_POLICY,
        advisoryOnly: true,
        runtimeEffect: 'NONE',
        persistenceEffect: 'NONE',
        authorityChangeAllowed: false
      });
      return latest;
    } catch (error) {
      observations += 1;
      unknown += 1;
      latest = freezeCopy({
        mode: TML_FIRST_CAMPUS_GYEOL_SHADOW_MODE,
        kind: 'first-campus-completion',
        status: TML_FIRST_CAMPUS_GYEOL_SHADOW_STATUS.UNKNOWN,
        reason: error?.code ?? 'GYEOL_SHADOW_ERROR',
        event: typeof event === 'string' ? event : null,
        previousStage: Number.isInteger(previousStage) ? previousStage : null,
        actualStage: result.stage,
        legacyComplete,
        tmlVerification: records.verification.status,
        advisoryOnly: true,
        runtimeEffect: 'NONE',
        persistenceEffect: 'NONE',
        authorityChangeAllowed: false
      });
      return latest;
    }
  }

  function resetScope() {
    latest = null;
    scopeResets += 1;
  }

  function status() {
    return freezeCopy({
      mode: TML_FIRST_CAMPUS_GYEOL_SHADOW_MODE,
      enabled: Boolean(enabled),
      questId: QUEST_ID,
      questRef: QUEST_REF,
      policyRef: TML_FIRST_CAMPUS_GYEOL_POLICY,
      authority: 'legacy-first-campus',
      advisoryOnly: true,
      runtimeEffect: 'NONE',
      persistenceEffect: 'NONE',
      authorityChangeAllowed: false,
      observations,
      matches,
      mismatches,
      unknown,
      parityRatio: observations - unknown > 0 ? matches / (matches + mismatches) : null,
      scopeResets,
      latest
    });
  }

  return Object.freeze({
    observeQuestResult,
    resetScope,
    status
  });
}
