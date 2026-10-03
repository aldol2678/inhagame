import { isQuestRewardResult } from '../../npc-factory/quest-reward-shape.mjs';
import { createTmlEvidence, createTmlVerification, TML_VERIFICATION_STATUS } from './verification.mjs';
import { createTmlTraceRecorder } from './trace.mjs';
import { executeTmlVerifiedWriteTransition, TML_P5_DISPOSITION } from './verified-write-runtime.mjs';
import { progressionSubject, walletSubject } from './economic-read-adapters.mjs';
import { assertTmlReadResultStructure, isTmlDateTime } from './conformance.mjs';
import { captureTmlAdapterMethod, prepareTmlWriteTransition } from './write-admission.mjs';
import { snapshotTmlData, summarizeTmlError } from './value-snapshot.mjs';

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
  if (isTmlDateTime(value) && Number.isFinite(Date.parse(value))) return value;
  return fallback;
}

function readTime(now) {
  const value = now();
  if (!isTmlDateTime(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('now() must return an ISO-compatible timestamp');
  }
  return value;
}

function validateRewardSpec(spec) {
  if (!spec || spec.schema !== 'tml.reward-spec' || spec.version !== '0.1' ||
      typeof spec.id !== 'string' || spec.id.trim().length === 0 ||
      spec.reward_id !== 'reward.quest.navigation_intro' ||
      typeof spec.source_transition !== 'string' || spec.source_transition.trim().length === 0 ||
      !Number.isSafeInteger(spec.reward_version) || spec.reward_version <= 0 ||
      !Array.isArray(spec.grants) || spec.grants.length === 0) {
    fail('INVALID_REWARD_SPEC', 'reward settlement requires a valid tml.reward-spec v0.1 fixture');
  }
  const seen = new Set();
  for (const grant of spec.grants) {
    const supported = grant && (
      (grant.grant_type === 'CURRENCY' && grant.target_id === 'currency.induck_coin') ||
      (grant.grant_type === 'EXP' && grant.target_id === 'exp.campus')
    );
    if (!supported || !Number.isSafeInteger(grant.amount) || grant.amount <= 0) {
      fail('INVALID_REWARD_SPEC', 'reward spec contains an invalid grant');
    }
    const key = `${grant.grant_type}:${grant.target_id}`;
    if (seen.has(key)) fail('INVALID_REWARD_SPEC', 'reward spec contains a duplicate grant');
    seen.add(key);
  }
  return spec;
}

function validateReadBinding(profile, capability, adapter, source) {
  const declarations = profile?.capabilities?.filter((item) => item.id === capability) ?? [];
  if (declarations.length !== 1 || declarations[0].mutates !== false ||
      !declarations[0].parameters || Object.keys(declarations[0].parameters).length !== 0 ||
      declarations[0].provider_binding !== undefined) {
    fail('REWARD_READ_BINDING_INVALID', `reward settlement requires the existing ${capability} binding`);
  }
  if ((adapter.capability !== undefined && adapter.capability !== capability) ||
      (adapter.source !== undefined && adapter.source !== source)) {
    fail('REWARD_READ_BINDING_INVALID', `reward settlement adapter disagrees with ${capability}`);
  }
}

export function prepareTmlRewardTransition(options = {}) {
  let rewardSpec;
  try {
    rewardSpec = snapshotTmlData(options.rewardSpec);
  } catch {
    fail('INVALID_REWARD_SPEC', 'reward spec must contain only supported plain data');
  }
  validateRewardSpec(rewardSpec);
  if (rewardSpec.source_transition !== options.transitionId ||
      rewardSpec.source_transition !== 'transition.inha-world.campus_navigation_intro_v1.8_to_9') {
    fail('REWARD_SPEC_TRANSITION_MISMATCH', 'reward spec must bind the final Main 2 transition');
  }

  const profile = snapshotTmlData(options.profile);
  const walletReadAdapter = captureTmlAdapterMethod(options.walletReadAdapter, 'read', 'walletReadAdapter.read');
  const progressionReadAdapter = captureTmlAdapterMethod(options.progressionReadAdapter, 'read', 'progressionReadAdapter.read');
  validateReadBinding(profile, 'world.wallet.read', walletReadAdapter, 'server.wallet');
  validateReadBinding(profile, 'world.progression.read', progressionReadAdapter, 'server.progression');
  for (const [predicate, authority] of [
    ['wallet.balance', 'server.wallet'],
    ['progression.total_exp', 'server.progression'],
    ['reward.status', 'server.reward'],
    ['reward.version', 'server.reward'],
    ['reward.replayed', 'server.reward'],
    ['reward.granted', 'server.reward']
  ]) {
    const rules = profile?.authority?.filter((rule) => rule.predicate === predicate) ?? [];
    if (!profile?.predicates?.includes(predicate) || rules.length !== 1 || rules[0].authority !== authority) {
      fail('REWARD_AUTHORITY_INVALID', `reward settlement requires ${authority} for ${predicate}`);
    }
  }

  const write = prepareTmlWriteTransition({
    module: options.module,
    profile,
    transitionId: options.transitionId,
    actionId: options.actionId,
    context: options.context,
    readAdapter: options.questReadAdapter,
    advanceAdapter: options.questAdvanceAdapter,
    now: options.now,
    createExecutionKey: options.createExecutionKey,
    traceId: options.traceId
  });
  if (write.event !== 'visit_back_gate') {
    fail('REWARD_SPEC_TRANSITION_MISMATCH', 'reward settlement requires the Main 2 completion event');
  }
  return Object.freeze({
    write,
    rewardSpec,
    walletReadAdapter,
    progressionReadAdapter,
    now: write.now,
    traceId: write.traceId
  });
}

async function safeRead(adapter, userId) {
  try {
    const result = snapshotTmlData(await adapter.read({ userId }));
    assertTmlReadResultStructure(result);
    return Object.freeze({ ok: true, result });
  } catch (error) {
    return Object.freeze({ ok: false, error: summarizeTmlError(error) });
  }
}

function findFact(readResult, subject, predicate) {
  return readResult?.facts?.find?.((fact) => fact.subject === subject && fact.predicate === predicate) ?? null;
}

function numberFactValue(fact) {
  return fact?.value?.type === 'number' && Number.isSafeInteger(fact.value.value) && fact.value.value >= 0
    ? fact.value.value : null;
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
  let receipt;
  try {
    receipt = reward == null ? null : snapshotTmlData(reward);
    if (!isQuestRewardResult(receipt)) fail('INVALID_REWARD_RECEIPT', 'reward receipt is missing or malformed');
    if (!Number.isSafeInteger(receipt.rewardVersion) || receipt.rewardVersion <= 0) {
      fail('INVALID_REWARD_VERSION', 'reward receipt requires a positive safe integer version');
    }
  } catch (error) {
    return Object.freeze({
      ok: false,
      error: summarizeTmlError(error),
      facts: Object.freeze([]),
      observations: Object.freeze([])
    });
  }
  reward = receipt;
  if (!isTmlDateTime(observedAt) || !Number.isFinite(Date.parse(observedAt))) {
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
      if (!Number.isSafeInteger(before + grant.amount)) {
        fail('PRE_REWARD_AMOUNT_UNSAFE', 'expected post-reward wallet balance exceeds the safe integer range');
      }
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
    if (!Number.isSafeInteger(before + expectedDeltas.exp)) {
      fail('PRE_REWARD_AMOUNT_UNSAFE', 'expected post-reward EXP exceeds the safe integer range');
    }
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

export async function executeTmlVerifiedRewardTransition(options = {}) {
  const prepared = prepareTmlRewardTransition(options);
  const { write, rewardSpec, walletReadAdapter, progressionReadAdapter, now } = prepared;
  const { module, profile, context, transition: declaredTransition, action, executionKey } = write;
  const transitionId = declaredTransition.id;
  let recorder;
  try {
    const startedAt = readTime(now);
    recorder = createTmlTraceRecorder({
      id: prepared.traceId ?? `trace.reward-settlement.${token(transitionId)}.${token(startedAt)}`,
      module: module.id,
      profile: profile.id,
      startedAt
    });
  } catch (error) {
    return Object.freeze({
      disposition: TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION,
      verification: TML_VERIFICATION_STATUS.UNKNOWN,
      executionKey,
      dispatchStatus: 'NOT_ATTEMPTED',
      attempt: Object.freeze({
        requestedExecutionKey: executionKey,
        receivedExecutionKey: null,
        dispatchStatus: 'NOT_ATTEMPTED',
        providerReturned: false
      }),
      automaticMutationRetryAllowed: false,
      transition: null,
      receiptPresent: false,
      diagnostic: summarizeTmlError(error),
      traceComplete: false,
      trace: null
    });
  }

  let transition = null;
  let transitionStarted = false;
  let receipt = null;
  let evidence = null;
  let settlementVerification = null;
  let preWallet = null;
  let preProgression = null;
  let postWallet = null;
  let postProgression = null;
  let processingFailed = false;

  // Once the child runtime has been called, no processing or trace error may erase its result.
  // A failed clock leaves an explicitly incomplete trace; it does not manufacture a timestamp.
  function finish(fields) {
    let trace;
    let traceComplete = !processingFailed && transition?.traceComplete !== false;
    let diagnostic = fields.diagnostic ?? null;
    let disposition = fields.disposition;
    let verification = fields.verification;
    try {
      trace = recorder.close(readTime(now));
    } catch (error) {
      try { trace = recorder.snapshot(); } catch { trace = null; }
      traceComplete = false;
      diagnostic ??= summarizeTmlError(error);
      if (transition?.dispatchStatus === 'NOT_ATTEMPTED' || !transitionStarted) {
        disposition = TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION;
      } else {
        disposition = TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED;
      }
      verification = TML_VERIFICATION_STATUS.UNKNOWN;
    }
    const dispatchStatus = transition?.dispatchStatus ?? (transitionStarted ? 'UNKNOWN' : 'NOT_ATTEMPTED');
    const attempt = transition?.attempt ?? Object.freeze({
      requestedExecutionKey: executionKey,
      receivedExecutionKey: null,
      dispatchStatus,
      providerReturned: false
    });
    return Object.freeze({
      ...fields,
      disposition,
      verification,
      executionKey,
      dispatchStatus,
      attempt,
      automaticMutationRetryAllowed: false,
      transition,
      receiptPresent: receipt?.ok === true,
      receipt,
      receiptError: receipt?.ok === false ? receipt.error : null,
      evidence,
      settlementVerification,
      postWalletError: postWallet?.ok === false ? postWallet.error : null,
      postProgressionError: postProgression?.ok === false ? postProgression.error : null,
      reads: Object.freeze({
        preWallet: preWallet?.result ?? null,
        preProgression: preProgression?.result ?? null,
        postWallet: postWallet?.result ?? null,
        postProgression: postProgression?.result ?? null
      }),
      diagnostic,
      traceComplete,
      trace
    });
  }

  try {
    // Economic baselines stay just-in-time, after any preceding pipeline steps.
    preWallet = await safeRead(walletReadAdapter, context.userId);
    preProgression = await safeRead(progressionReadAdapter, context.userId);
    appendRead(recorder, preWallet);
    appendRead(recorder, preProgression);

    if (!preWallet.ok || !preProgression.ok) {
      return finish({
        disposition: TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION,
        verification: TML_VERIFICATION_STATUS.UNKNOWN,
        preWalletError: preWallet.ok ? null : preWallet.error,
        preProgressionError: preProgression.ok ? null : preProgression.error
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
      return finish({
        disposition: TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION,
        verification: TML_VERIFICATION_STATUS.UNKNOWN,
        preconditionError: summarizeTmlError(error)
      });
    }

    transitionStarted = true;
    transition = await executeTmlVerifiedWriteTransition({
      module,
      profile,
      transitionId,
      actionId: action.id,
      context,
      readAdapter: write.readAdapter,
      advanceAdapter: write.advanceAdapter,
      traceId: `${recorder.snapshot().id}.transition`,
      now,
      createExecutionKey: () => executionKey
    });

    if (Array.isArray(transition.trace?.records)) {
      for (const record of transition.trace.records) recorder.append(record);
    } else if (transition.dispatchStatus !== 'NOT_ATTEMPTED') {
      fail('REWARD_TRANSITION_TRACE_INVALID', 'attempted reward transition did not return its trace records');
    }

    if (transition.disposition !== TML_P5_DISPOSITION.VERIFIED) {
      return finish({
        disposition: transition.dispatchStatus === 'NOT_ATTEMPTED' && transition.trace == null
          ? TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION
          : TML_P7_DISPOSITION.TRANSITION_NOT_VERIFIED,
        verification: TML_VERIFICATION_STATUS.UNKNOWN,
        diagnostic: transition.diagnostic ?? null
      });
    }

    const actionRecord = transition.trace.records.find((record) => record.kind === 'action');
    receipt = createTmlRewardReceiptRead({
      reward: transition.provider?.output?.reward,
      observedAt: ensureTime(
        transition.provider?.output?.reward?.completedAt,
        actionRecord?.completed_at ?? readTime(now)
      ),
      sequence: 1
    });

    if (receipt.ok) {
      for (const observation of receipt.observations) recorder.append(observation);
      for (const fact of receipt.facts) recorder.append(fact);
    }

    postWallet = await safeRead(walletReadAdapter, context.userId);
    postProgression = await safeRead(progressionReadAdapter, context.userId);
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
    evidence = Object.freeze({
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
    recorder.append(evidence);

    const checkedAt = readTime(now);
    settlementVerification = createTmlVerification({
      id: `verification.${token(transitionId)}.reward-settlement.${token(checkedAt)}`,
      transitionId,
      evidence,
      status: built.evaluation.status,
      checkedAt
    });
    recorder.append(settlementVerification);

    return finish({
      disposition: built.evaluation.status === TML_VERIFICATION_STATUS.SATISFIED
        ? TML_P7_DISPOSITION.VERIFIED
        : TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED,
      verification: built.evaluation.status,
      reason: built.evaluation.reason
    });
  } catch (error) {
    processingFailed = true;
    return finish({
      disposition: transitionStarted && transition?.dispatchStatus !== 'NOT_ATTEMPTED'
        ? TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED
        : TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION,
      verification: TML_VERIFICATION_STATUS.UNKNOWN,
      diagnostic: summarizeTmlError(error)
    });
  }
}
