import { isQuestRewardResult } from '../../npc-factory/quest-reward-shape.mjs';
import { createTmlEvidence, createTmlVerification, TML_VERIFICATION_STATUS } from './verification.mjs';
import { createTmlTraceRecorder } from './trace.mjs';
import { executeTmlVerifiedWriteTransition, TML_P5_DISPOSITION } from './verified-write-runtime.mjs';
import { progressionSubject, walletSubject } from './economic-read-adapters.mjs';

export const TML_P7_DISPOSITION = Object.freeze({
  HOLD_BEFORE_EXECUTION: 'HOLD_BEFORE_EXECUTION',
  VERIFIED: 'VERIFIED',
  TRANSITION_NOT_VERIFIED: 'TRANSITION_NOT_VERIFIED',
  SETTLEMENT_UNVERIFIED: 'SETTLEMENT_UNVERIFIED'
});

function fail(code, message) {
  const error = new Error(message);
  error.name = 'TmlRewardSettlementError';
  error.code = code;
  throw error;
}

function token(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-|-$/g, '');
}

function ensureTime(value, fallback) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  return fallback;
}

function validateRewardSpec(spec) {
  if (!spec || spec.schema !== 'tml.reward-spec' || spec.version !== '0.1' ||
      typeof spec.id !== 'string' || typeof spec.reward_id !== 'string' ||
      !Array.isArray(spec.grants) || spec.grants.length === 0) {
    fail('INVALID_REWARD_SPEC', 'reward settlement requires a valid tml.reward-spec v0.1 fixture');
  }
  for (const grant of spec.grants) {
    if (!grant || !['CURRENCY', 'EXP'].includes(grant.grant_type) ||
        typeof grant.target_id !== 'string' ||
        !Number.isSafeInteger(grant.amount) || grant.amount < 0) {
      fail('INVALID_REWARD_SPEC', 'reward spec contains an invalid grant');
    }
  }
  return spec;
}

function safeError(error) {
  return Object.freeze({
    code: typeof error?.code === 'string' ? error.code
      : typeof error?.name === 'string' ? error.name
        : 'TML_READ_ERROR',
    message: typeof error?.message === 'string' ? error.message : undefined
  });
}

async function safeRead(adapter, userId) {
  try {
    return Object.freeze({ ok: true, result: await adapter.read({ userId }) });
  } catch (error) {
    return Object.freeze({ ok: false, error: safeError(error) });
  }
}

function findFact(readResult, subject, predicate) {
  return readResult?.facts?.find?.((fact) => fact.subject === subject && fact.predicate === predicate) ?? null;
}

function numberFactValue(fact) {
  return fact?.value?.type === 'number' && Number.isFinite(fact.value.value) ? fact.value.value : null;
}

export function rewardGrantSubject(rewardId, grantType, targetId) {
  return `${rewardId}.grant.${grantType.toLowerCase()}.${targetId}`;
}

function makeRewardFact({ id, subject, predicate, value, observedAt, sequence, extensions }) {
  return Object.freeze({
    kind: 'fact',
    id,
    subject,
    predicate,
    value: Object.freeze(value),
    source: 'server.reward',
    observed_at: observedAt,
    confidence: 1,
    extensions: Object.freeze({ observation_sequence: sequence, ...(extensions ?? {}) })
  });
}

function makeRewardObservation({ fact, observedAt, sequence }) {
  return Object.freeze({
    kind: 'observation',
    id: `observation.${token(fact.subject)}.${fact.predicate}.${token(observedAt)}.${sequence}`,
    source: 'server.reward',
    observed_at: observedAt,
    query: Object.freeze({ subject: fact.subject, predicate: fact.predicate }),
    facts: Object.freeze([fact.id]),
    extensions: Object.freeze({ observation_sequence: sequence })
  });
}

export function createTmlRewardReceiptRead({ reward, observedAt, sequence = 1 } = {}) {
  if (!isQuestRewardResult(reward)) {
    return Object.freeze({ ok: false, facts: Object.freeze([]), observations: Object.freeze([]) });
  }
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
    fail('INVALID_REWARD_OBSERVED_AT', 'reward receipt observedAt must be an ISO-compatible timestamp');
  }

  const rewardSubject = reward.rewardId;
  const facts = [
    makeRewardFact({
      id: `fact.${token(rewardSubject)}.reward.status.${token(observedAt)}.${sequence}`,
      subject: rewardSubject,
      predicate: 'reward.status',
      value: { type: 'string', value: reward.status },
      observedAt,
      sequence,
      extensions: { reward_version: reward.rewardVersion ?? null, reward_transaction_id: reward.rewardTransactionId ?? null }
    }),
    makeRewardFact({
      id: `fact.${token(rewardSubject)}.reward.version.${token(observedAt)}.${sequence}`,
      subject: rewardSubject,
      predicate: 'reward.version',
      value: { type: 'number', value: reward.rewardVersion },
      observedAt,
      sequence
    }),
    makeRewardFact({
      id: `fact.${token(rewardSubject)}.reward.replayed.${token(observedAt)}.${sequence}`,
      subject: rewardSubject,
      predicate: 'reward.replayed',
      value: { type: 'boolean', value: reward.replayed },
      observedAt,
      sequence
    })
  ];

  for (const entry of reward.entries) {
    const subject = rewardGrantSubject(reward.rewardId, entry.grantType, entry.targetId);
    facts.push(makeRewardFact({
      id: `fact.${token(subject)}.reward.granted.${token(observedAt)}.${sequence}`,
      subject,
      predicate: 'reward.granted',
      value: { type: 'number', value: entry.granted },
      observedAt,
      sequence,
      extensions: {
        grant_type: entry.grantType,
        target_id: entry.targetId,
        status: entry.status
      }
    }));
  }

  return Object.freeze({
    ok: true,
    rewardId: reward.rewardId,
    observedAt,
    sequence,
    facts: Object.freeze(facts),
    observations: Object.freeze(facts.map((fact) => makeRewardObservation({ fact, observedAt, sequence })))
  });
}

function expectedPostState({ rewardSpec, preWallet, preProgression }) {
  const claims = [
    {
      op: 'eq',
      subject: rewardSpec.reward_id,
      predicate: 'reward.status',
      value: { type: 'string', value: 'SUCCESS' }
    },
    {
      op: 'eq',
      subject: rewardSpec.reward_id,
      predicate: 'reward.version',
      value: { type: 'number', value: rewardSpec.reward_version }
    },
    {
      op: 'eq',
      subject: rewardSpec.reward_id,
      predicate: 'reward.replayed',
      value: { type: 'boolean', value: false }
    }
  ];

  const expectedDeltas = { currencies: {}, exp: 0 };
  const preFactIds = [];

  for (const grant of rewardSpec.grants) {
    const grantSubject = rewardGrantSubject(rewardSpec.reward_id, grant.grant_type, grant.target_id);
    claims.push({
      op: 'eq',
      subject: grantSubject,
      predicate: 'reward.granted',
      value: { type: 'number', value: grant.amount }
    });

    if (grant.grant_type === 'CURRENCY') {
      const subject = walletSubject(grant.target_id);
      const preFact = findFact(preWallet, subject, 'wallet.balance');
      const before = numberFactValue(preFact);
      if (before === null) fail('PRE_REWARD_WALLET_FACT_MISSING', `missing wallet fact for ${grant.target_id}`);
      preFactIds.push(preFact.id);
      expectedDeltas.currencies[grant.target_id] = grant.amount;
      claims.push({
        op: 'eq',
        subject,
        predicate: 'wallet.balance',
        value: { type: 'number', value: before + grant.amount }
      });
    }

    if (grant.grant_type === 'EXP') {
      if (grant.target_id !== 'exp.campus') {
        fail('UNSUPPORTED_EXP_TARGET', `unsupported progression target: ${grant.target_id}`);
      }
      expectedDeltas.exp += grant.amount;
    }
  }

  if (expectedDeltas.exp > 0) {
    const subject = progressionSubject();
    const preFact = findFact(preProgression, subject, 'progression.total_exp');
    const before = numberFactValue(preFact);
    if (before === null) fail('PRE_REWARD_EXP_FACT_MISSING', 'missing progression.total_exp fact');
    preFactIds.push(preFact.id);
    claims.push({
      op: 'eq',
      subject,
      predicate: 'progression.total_exp',
      value: { type: 'number', value: before + expectedDeltas.exp }
    });
  }

  return Object.freeze({
    claim: Object.freeze({ op: 'and', args: Object.freeze(claims) }),
    preFactIds: Object.freeze(preFactIds),
    expectedDeltas: Object.freeze({
      currencies: Object.freeze({ ...expectedDeltas.currencies }),
      exp: expectedDeltas.exp
    })
  });
}

function appendRead(recorder, read) {
  if (read?.ok) recorder.appendReadResult(read.result);
}

export async function executeTmlVerifiedRewardTransition({
  module,
  profile,
  transitionId,
  actionId,
  context,
  questReadAdapter,
  questAdvanceAdapter,
  walletReadAdapter,
  progressionReadAdapter,
  rewardSpec,
  now = () => new Date().toISOString(),
  createExecutionKey,
  traceId
} = {}) {
  validateRewardSpec(rewardSpec);
  if (!context || typeof context.userId !== 'string' || context.userId.length === 0) {
    throw new TypeError('reward settlement context requires userId');
  }
  if (!walletReadAdapter?.read || !progressionReadAdapter?.read) {
    throw new TypeError('reward settlement requires wallet and progression read adapters');
  }

  const startedAt = now();
  const recorder = createTmlTraceRecorder({
    id: traceId ?? `trace.reward-settlement.${token(transitionId)}.${token(startedAt)}`,
    module: module.id,
    profile: profile.id,
    startedAt
  });

  const preWallet = await safeRead(walletReadAdapter, context.userId);
  const preProgression = await safeRead(progressionReadAdapter, context.userId);
  appendRead(recorder, preWallet);
  appendRead(recorder, preProgression);

  if (!preWallet.ok || !preProgression.ok) {
    return Object.freeze({
      disposition: TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION,
      verification: TML_VERIFICATION_STATUS.UNKNOWN,
      transition: null,
      preWalletError: preWallet.ok ? null : preWallet.error,
      preProgressionError: preProgression.ok ? null : preProgression.error,
      trace: recorder.close(now())
    });
  }

  let expected;
  try {
    expected = expectedPostState({
      rewardSpec,
      preWallet: preWallet.result,
      preProgression: preProgression.result
    });
  } catch (error) {
    return Object.freeze({
      disposition: TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION,
      verification: TML_VERIFICATION_STATUS.UNKNOWN,
      transition: null,
      preconditionError: safeError(error),
      trace: recorder.close(now())
    });
  }

  const transition = await executeTmlVerifiedWriteTransition({
    module,
    profile,
    transitionId,
    actionId,
    context,
    readAdapter: questReadAdapter,
    advanceAdapter: questAdvanceAdapter,
    traceId: `${recorder.snapshot().id}.transition`,
    now,
    createExecutionKey
  });

  for (const record of transition.trace.records) recorder.append(record);

  if (transition.disposition !== TML_P5_DISPOSITION.VERIFIED) {
    return Object.freeze({
      disposition: TML_P7_DISPOSITION.TRANSITION_NOT_VERIFIED,
      verification: TML_VERIFICATION_STATUS.UNKNOWN,
      transition,
      trace: recorder.close(now())
    });
  }

  const actionRecord = transition.trace.records.find((record) => record.kind === 'action');
  const receipt = createTmlRewardReceiptRead({
    reward: transition.provider?.output?.reward,
    observedAt: ensureTime(
      transition.provider?.output?.reward?.completedAt,
      actionRecord?.completed_at ?? now()
    ),
    sequence: 1
  });

  if (receipt.ok) {
    for (const observation of receipt.observations) recorder.append(observation);
    for (const fact of receipt.facts) recorder.append(fact);
  }

  const postWallet = await safeRead(walletReadAdapter, context.userId);
  const postProgression = await safeRead(progressionReadAdapter, context.userId);
  appendRead(recorder, postWallet);
  appendRead(recorder, postProgression);

  const combinedFacts = [
    ...(receipt.ok ? receipt.facts : []),
    ...(postWallet.ok ? postWallet.result.facts : []),
    ...(postProgression.ok ? postProgression.result.facts : [])
  ];
  const combinedObservations = [
    ...(receipt.ok ? receipt.observations : []),
    ...(postWallet.ok ? postWallet.result.observations : []),
    ...(postProgression.ok ? postProgression.result.observations : [])
  ];

  const built = createTmlEvidence({
    id: `evidence.${token(transitionId)}.reward-settlement`,
    claim: expected.claim,
    observations: combinedObservations,
    facts: combinedFacts,
    profile
  });

  const evidence = Object.freeze({
    ...built.evidence,
    extensions: Object.freeze({
      reward_spec_id: rewardSpec.id,
      reward_receipt_present: receipt.ok,
      pre_fact_ids: expected.preFactIds,
      expected_deltas: expected.expectedDeltas,
      post_wallet_read_ok: postWallet.ok,
      post_progression_read_ok: postProgression.ok
    })
  });

  const verification = createTmlVerification({
    id: `verification.${token(transitionId)}.reward-settlement.${token(now())}`,
    transitionId,
    evidence,
    status: built.evaluation.status,
    checkedAt: now()
  });

  recorder.append(evidence);
  recorder.append(verification);

  return Object.freeze({
    disposition: built.evaluation.status === TML_VERIFICATION_STATUS.SATISFIED
      ? TML_P7_DISPOSITION.VERIFIED
      : TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED,
    verification: built.evaluation.status,
    reason: built.evaluation.reason,
    transition,
    evidence,
    settlementVerification: verification,
    receiptPresent: receipt.ok,
    postWalletError: postWallet.ok ? null : postWallet.error,
    postProgressionError: postProgression.ok ? null : postProgression.error,
    trace: recorder.close(now())
  });
}
