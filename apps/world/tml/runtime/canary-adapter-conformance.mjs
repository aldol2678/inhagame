import { getTmlCanaryAdapterInterfaceDescriptors, TML_MAIN2_CANARY_ADAPTER_INTERFACE_PACK } from './canary-adapter-interfaces.mjs';

export const TML_CANARY_ADAPTER_CONFORMANCE_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL'
});

export const TML_MAIN2_CANARY_ADAPTER_CONFORMANCE = 'main2-canary-adapter-conformance@p18';

const ROLE_ORDER = Object.freeze([
  'cohortResolver',
  'activationPreflight',
  'observabilityAdapter',
  'rollbackAdapter',
  'expiryGuard'
]);

function diagnostic(role, code, message) {
  return Object.freeze({ role, code, message });
}

function isIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

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

function validateInterfacePack(pack) {
  const errors = [];

  if (!pack || typeof pack !== 'object') {
    errors.push(diagnostic('pack', 'INTERFACE_PACK_REQUIRED', 'P18 requires a P17 interface pack'));
    return errors;
  }

  if (pack.schema !== 'tml.canary-adapter-interface-pack' ||
      pack.version !== '0.1' ||
      pack.contract !== TML_MAIN2_CANARY_ADAPTER_INTERFACE_PACK ||
      pack.status !== 'INTERFACES_BOUND_BY_REFERENCE') {
    errors.push(diagnostic('pack', 'INVALID_INTERFACE_PACK', 'P18 requires the current P17 interface pack'));
  }

  if (pack.advisoryOnly !== true ||
      pack.executable !== false ||
      pack.adapterInvocationAllowed !== false ||
      pack.routingEffect !== 'NONE' ||
      pack.deploymentEffect !== 'NONE' ||
      pack.runtimeEffect !== 'NONE' ||
      pack.persistenceEffect !== 'NONE' ||
      pack.authorityChangeAllowed !== false) {
    errors.push(diagnostic('pack', 'INTERFACE_PACK_EFFECT_BOUNDARY_INVALID', 'P17 interface pack must remain effect-free'));
  }

  if (pack.authority?.current !== 'legacy-main2' ||
      pack.authority?.currentRemainsAuthoritative !== true) {
    errors.push(diagnostic('pack', 'INTERFACE_PACK_AUTHORITY_BOUNDARY_INVALID', 'legacy Main 2 must remain authoritative'));
  }

  if (typeof pack.sourceExecutionContract?.contractFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(pack.sourceExecutionContract.contractFingerprint) ||
      typeof pack.sourceExecutionContract?.cohortId !== 'string' ||
      typeof pack.sourceExecutionContract?.rollbackHandle !== 'string' ||
      typeof pack.sourceExecutionContract?.observabilityHandle !== 'string' ||
      !isIso(pack.sourceExecutionContract?.expiresAt)) {
    errors.push(diagnostic('pack', 'INTERFACE_PACK_SOURCE_INVALID', 'P17 source execution contract reference is incomplete'));
  }

  return errors;
}

function validateMockShape(role, mock, descriptor) {
  const errors = [];

  if (!mock || typeof mock !== 'object') {
    errors.push(diagnostic(role, 'MOCK_REQUIRED', `mock adapter required for ${role}`));
    return errors;
  }
  if (mock.mockOnly !== true || mock.source !== 'TEST_MOCK') {
    errors.push(diagnostic(role, 'MOCK_BRAND_REQUIRED', `${role} must be explicitly branded TEST_MOCK`));
  }
  if (mock.interfaceContract !== descriptor.interfaceContract) {
    errors.push(diagnostic(role, 'MOCK_INTERFACE_MISMATCH', `${role} interface contract mismatch`));
  }

  const requiredMethodNames = descriptor.requiredMethods.map((method) => method.name);
  for (const methodName of requiredMethodNames) {
    if (typeof mock[methodName] !== 'function') {
      errors.push(diagnostic(role, 'MOCK_METHOD_MISSING', `${role} missing method ${methodName}`));
    }
  }

  for (const [key, value] of Object.entries(mock)) {
    if (typeof value === 'function' && !requiredMethodNames.includes(key)) {
      errors.push(diagnostic(role, 'MOCK_EXTRA_CALLABLE_FORBIDDEN', `${role} exposes unexpected callable ${key}`));
    }
  }

  return errors;
}

async function invoke(role, methodName, fn, input, errors) {
  try {
    return await fn(input);
  } catch (error) {
    errors.push(diagnostic(
      role,
      'MOCK_INVOCATION_THROW',
      `${role}.${methodName} threw: ${error?.message ?? String(error)}`
    ));
    return null;
  }
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validMetricSnapshot(snapshot) {
  return snapshot &&
    snapshot.sideEffects === 'NONE' &&
    nonNegativeInteger(snapshot.transitionMismatches) &&
    nonNegativeInteger(snapshot.rewardReceiptMismatches) &&
    nonNegativeInteger(snapshot.rewardSettlementMismatches) &&
    nonNegativeInteger(snapshot.verificationUnknown) &&
    nonNegativeInteger(snapshot.verificationConflict) &&
    typeof snapshot.settlementCoverageRatio === 'number' &&
    Number.isFinite(snapshot.settlementCoverageRatio) &&
    snapshot.settlementCoverageRatio >= 0 &&
    snapshot.settlementCoverageRatio <= 1;
}

export async function runTmlCanaryAdapterMockConformance({
  interfacePack,
  mocks,
  currentTime = new Date().toISOString()
} = {}) {
  const errors = [...validateInterfacePack(interfacePack)];
  const descriptors = getTmlCanaryAdapterInterfaceDescriptors();

  if (!isIso(currentTime)) {
    errors.push(diagnostic('harness', 'INVALID_CURRENT_TIME', 'currentTime must be an ISO-compatible timestamp'));
  }

  if (!mocks || typeof mocks !== 'object') {
    errors.push(diagnostic('harness', 'MOCK_SET_REQUIRED', 'P18 requires a complete mock adapter set'));
  }

  for (const role of ROLE_ORDER) {
    errors.push(...validateMockShape(role, mocks?.[role], descriptors[role]));
  }

  if (errors.length > 0) {
    return freezeCopy({
      schema: 'tml.canary-adapter-conformance',
      version: '0.1',
      contract: TML_MAIN2_CANARY_ADAPTER_CONFORMANCE,
      status: TML_CANARY_ADAPTER_CONFORMANCE_STATUS.FAIL,
      mockOnly: true,
      liveAdapterInvocationAllowed: false,
      routingEffect: 'NONE',
      deploymentEffect: 'NONE',
      runtimeEffect: 'NONE',
      persistenceEffect: 'NONE',
      authorityChangeAllowed: false,
      diagnostics: errors,
      evidence: null
    });
  }

  const source = interfacePack.sourceExecutionContract;
  const evidence = {};
  const runtimeErrors = [];

  const cohort = await invoke(
    'cohortResolver',
    'inspect',
    mocks.cohortResolver.inspect.bind(mocks.cohortResolver),
    Object.freeze({
      cohortId: source.cohortId,
      expectedAudiencePercent: interfacePack.sourceExecutionContract.phaseId === 'canary-1-percent'
        ? 1
        : interfacePack.sourceExecutionContract.phaseId === 'canary-5-percent'
          ? 5
          : 25,
      membershipEmbedded: false,
      synthetic: true
    }),
    runtimeErrors
  );

  if (!cohort ||
      cohort.sideEffects !== 'NONE' ||
      cohort.cohortId !== source.cohortId ||
      cohort.membershipEmbedded !== false ||
      cohort.readOnly !== true) {
    runtimeErrors.push(diagnostic('cohortResolver', 'COHORT_MOCK_OUTPUT_INVALID', 'cohort mock output violates P17'));
  }
  evidence.cohortResolver = cohort;

  const preflight = await invoke(
    'activationPreflight',
    'check',
    mocks.activationPreflight.check.bind(mocks.activationPreflight),
    Object.freeze({
      contractFingerprint: source.contractFingerprint,
      phaseId: source.phaseId,
      cohortId: source.cohortId,
      rollbackHandle: source.rollbackHandle,
      observabilityHandle: source.observabilityHandle,
      expiresAt: source.expiresAt,
      synthetic: true
    }),
    runtimeErrors
  );

  if (!preflight ||
      !['BLOCKED', 'READY_FOR_SEPARATE_HUMAN_ACTIVATION'].includes(preflight.status) ||
      preflight.sideEffects !== 'NONE' ||
      preflight.activated !== false) {
    runtimeErrors.push(diagnostic('activationPreflight', 'PREFLIGHT_MOCK_OUTPUT_INVALID', 'preflight mock output violates P17'));
  }
  evidence.activationPreflight = preflight;

  const observabilityMeta = await invoke(
    'observabilityAdapter',
    'inspect',
    mocks.observabilityAdapter.inspect.bind(mocks.observabilityAdapter),
    Object.freeze({
      handle: source.observabilityHandle,
      synthetic: true
    }),
    runtimeErrors
  );

  if (!observabilityMeta ||
      observabilityMeta.handle !== source.observabilityHandle ||
      observabilityMeta.available !== true ||
      observabilityMeta.readOnly !== true ||
      observabilityMeta.sideEffects !== 'NONE' ||
      typeof observabilityMeta.sessionRef !== 'string') {
    runtimeErrors.push(diagnostic('observabilityAdapter', 'OBSERVABILITY_INSPECT_OUTPUT_INVALID', 'observability inspect output violates P17'));
  }

  const observabilitySnapshot = observabilityMeta?.sessionRef
    ? await invoke(
        'observabilityAdapter',
        'snapshot',
        mocks.observabilityAdapter.snapshot.bind(mocks.observabilityAdapter),
        Object.freeze({
          sessionRef: observabilityMeta.sessionRef,
          synthetic: true
        }),
        runtimeErrors
      )
    : null;

  if (!validMetricSnapshot(observabilitySnapshot)) {
    runtimeErrors.push(diagnostic('observabilityAdapter', 'OBSERVABILITY_SNAPSHOT_INVALID', 'observability snapshot output violates P17'));
  }
  evidence.observabilityAdapter = {
    inspect: observabilityMeta,
    snapshot: observabilitySnapshot
  };

  const rollbackMeta = await invoke(
    'rollbackAdapter',
    'inspect',
    mocks.rollbackAdapter.inspect.bind(mocks.rollbackAdapter),
    Object.freeze({
      handle: source.rollbackHandle,
      synthetic: true
    }),
    runtimeErrors
  );

  if (!rollbackMeta ||
      rollbackMeta.handle !== source.rollbackHandle ||
      rollbackMeta.available !== true ||
      rollbackMeta.proposalOnly !== true ||
      rollbackMeta.sideEffects !== 'NONE') {
    runtimeErrors.push(diagnostic('rollbackAdapter', 'ROLLBACK_INSPECT_OUTPUT_INVALID', 'rollback inspect output violates P17'));
  }

  const rollbackProposal = await invoke(
    'rollbackAdapter',
    'propose',
    mocks.rollbackAdapter.propose.bind(mocks.rollbackAdapter),
    Object.freeze({
      reason: 'SYNTHETIC_CONFORMANCE_PROBE',
      contractFingerprint: source.contractFingerprint,
      synthetic: true
    }),
    runtimeErrors
  );

  if (!rollbackProposal ||
      rollbackProposal.status !== 'ROLLBACK_PROPOSAL_ONLY' ||
      rollbackProposal.targetAuthority !== 'legacy-main2' ||
      rollbackProposal.executed !== false ||
      rollbackProposal.sideEffects !== 'NONE') {
    runtimeErrors.push(diagnostic('rollbackAdapter', 'ROLLBACK_PROPOSAL_OUTPUT_INVALID', 'rollback proposal output violates P17'));
  }
  evidence.rollbackAdapter = {
    inspect: rollbackMeta,
    propose: rollbackProposal
  };

  const expiry = await invoke(
    'expiryGuard',
    'check',
    mocks.expiryGuard.check.bind(mocks.expiryGuard),
    Object.freeze({
      expiresAt: source.expiresAt,
      currentTime,
      synthetic: true
    }),
    runtimeErrors
  );

  const expectedExpiryStatus = Date.parse(currentTime) < Date.parse(source.expiresAt) ? 'VALID' : 'EXPIRED';
  if (!expiry ||
      expiry.status !== expectedExpiryStatus ||
      expiry.observedExpiresAt !== source.expiresAt ||
      expiry.mutatedExpiry !== false ||
      expiry.sideEffects !== 'NONE') {
    runtimeErrors.push(diagnostic('expiryGuard', 'EXPIRY_GUARD_OUTPUT_INVALID', 'expiry guard output violates P17'));
  }
  evidence.expiryGuard = expiry;

  const status = runtimeErrors.length === 0
    ? TML_CANARY_ADAPTER_CONFORMANCE_STATUS.PASS
    : TML_CANARY_ADAPTER_CONFORMANCE_STATUS.FAIL;

  return freezeCopy({
    schema: 'tml.canary-adapter-conformance',
    version: '0.1',
    contract: TML_MAIN2_CANARY_ADAPTER_CONFORMANCE,
    status,
    mockOnly: true,
    liveAdapterInvocationAllowed: false,
    routingEffect: 'NONE',
    deploymentEffect: 'NONE',
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE',
    authorityChangeAllowed: false,
    authority: {
      current: 'legacy-main2',
      currentRemainsAuthoritative: true
    },
    diagnostics: runtimeErrors,
    evidence
  });
}
