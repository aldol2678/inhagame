import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildTmlMain2CanaryAdapterInterfacePack,
  TML_CANARY_ADAPTER_INTERFACE
} from '../tml/runtime/canary-adapter-interfaces.mjs';
import {
  runTmlCanaryAdapterMockConformance,
  TML_CANARY_ADAPTER_CONFORMANCE_STATUS,
  TML_MAIN2_CANARY_ADAPTER_CONFORMANCE
} from '../tml/runtime/canary-adapter-conformance.mjs';

const NOW = '2026-10-03T14:35:00+09:00';

function executionContract(overrides = {}) {
  return {
    schema: 'tml.canary-execution-contract',
    version: '0.1',
    contract: 'main2-canary-execution-contract@p16',
    status: 'CONTRACT_READY',
    id: 'canary-contract.main2.mock123',
    generatedAt: '2026-10-03T14:10:00+09:00',
    expiresAt: '2026-10-03T15:10:00+09:00',
    advisoryOnly: true,
    executable: false,
    activationAllowed: false,
    routingEffect: 'NONE',
    deploymentEffect: 'NONE',
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE',
    authorityChangeAllowed: false,
    authority: {
      current: 'legacy-main2',
      requestedCandidate: 'tml-main2',
      currentRemainsAuthoritative: true
    },
    phase: {
      id: 'canary-1-percent',
      index: 0,
      totalPhases: 3,
      audiencePercent: 1,
      entryMode: 'HUMAN_APPROVAL_REQUIRED',
      exitMode: 'HUMAN_APPROVAL_REQUIRED',
      fullRollout: false
    },
    cohort: {
      id: 'cohort:main2:1',
      assignmentMode: 'EXTERNAL_EXPLICIT_COHORT',
      expectedAudiencePercent: 1,
      membershipEmbedded: false
    },
    handles: {
      rollback: 'rollback:legacy-main2:v1',
      observability: 'observe:main2:v1'
    },
    requirements: [
      'SEPARATE_HUMAN_ACTIVATION_REQUIRED',
      'EXTERNAL_ROUTER_IMPLEMENTATION_REQUIRED',
      'EXTERNAL_ROLLBACK_ADAPTER_REQUIRED',
      'EXTERNAL_OBSERVABILITY_ADAPTER_REQUIRED',
      'EXPIRY_CHECK_REQUIRED_AT_ACTIVATION'
    ],
    evidence: {
      contractFingerprint: 'd'.repeat(64)
    },
    ...overrides
  };
}

function bindings() {
  return {
    cohortResolver: {
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.COHORT_RESOLVER,
      implementationRef: 'mock:cohort-resolver:v1',
      versionRef: 'test:v1',
      ownerRef: 'test:p18'
    },
    activationPreflight: {
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.ACTIVATION_PREFLIGHT,
      implementationRef: 'mock:preflight:v1',
      versionRef: 'test:v1',
      ownerRef: 'test:p18'
    },
    observabilityAdapter: {
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.OBSERVABILITY_ADAPTER,
      implementationRef: 'mock:observability:v1',
      versionRef: 'test:v1',
      ownerRef: 'test:p18'
    },
    rollbackAdapter: {
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.ROLLBACK_ADAPTER,
      implementationRef: 'mock:rollback:v1',
      versionRef: 'test:v1',
      ownerRef: 'test:p18'
    },
    expiryGuard: {
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.EXPIRY_GUARD,
      implementationRef: 'mock:expiry:v1',
      versionRef: 'test:v1',
      ownerRef: 'test:p18'
    }
  };
}

function interfacePack() {
  return buildTmlMain2CanaryAdapterInterfacePack({
    executionContract: executionContract(),
    adapters: bindings(),
    generatedAt: '2026-10-03T14:20:00+09:00'
  });
}

function validMocks(overrides = {}) {
  return {
    cohortResolver: {
      mockOnly: true,
      source: 'TEST_MOCK',
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.COHORT_RESOLVER,
      async inspect(input) {
        return {
          cohortId: input.cohortId,
          membershipEmbedded: false,
          readOnly: true,
          sideEffects: 'NONE'
        };
      }
    },
    activationPreflight: {
      mockOnly: true,
      source: 'TEST_MOCK',
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.ACTIVATION_PREFLIGHT,
      async check() {
        return {
          status: 'READY_FOR_SEPARATE_HUMAN_ACTIVATION',
          activated: false,
          sideEffects: 'NONE'
        };
      }
    },
    observabilityAdapter: {
      mockOnly: true,
      source: 'TEST_MOCK',
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.OBSERVABILITY_ADAPTER,
      async inspect(input) {
        return {
          handle: input.handle,
          available: true,
          readOnly: true,
          sessionRef: 'mock:obs-session',
          sideEffects: 'NONE'
        };
      },
      async snapshot() {
        return {
          transitionMismatches: 0,
          rewardReceiptMismatches: 0,
          rewardSettlementMismatches: 0,
          verificationUnknown: 0,
          verificationConflict: 0,
          settlementCoverageRatio: 1,
          sideEffects: 'NONE'
        };
      }
    },
    rollbackAdapter: {
      mockOnly: true,
      source: 'TEST_MOCK',
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.ROLLBACK_ADAPTER,
      async inspect(input) {
        return {
          handle: input.handle,
          available: true,
          proposalOnly: true,
          sideEffects: 'NONE'
        };
      },
      async propose() {
        return {
          status: 'ROLLBACK_PROPOSAL_ONLY',
          targetAuthority: 'legacy-main2',
          executed: false,
          sideEffects: 'NONE'
        };
      }
    },
    expiryGuard: {
      mockOnly: true,
      source: 'TEST_MOCK',
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.EXPIRY_GUARD,
      async check(input) {
        return {
          status: Date.parse(input.currentTime) < Date.parse(input.expiresAt) ? 'VALID' : 'EXPIRED',
          observedExpiresAt: input.expiresAt,
          mutatedExpiry: false,
          sideEffects: 'NONE'
        };
      }
    },
    ...overrides
  };
}

test('P18 valid mock suite passes all five P17 interfaces', async () => {
  const result = await runTmlCanaryAdapterMockConformance({
    interfacePack: interfacePack(),
    mocks: validMocks(),
    currentTime: NOW
  });

  assert.equal(result.schema, 'tml.canary-adapter-conformance');
  assert.equal(result.version, '0.1');
  assert.equal(result.contract, TML_MAIN2_CANARY_ADAPTER_CONFORMANCE);
  assert.equal(result.status, TML_CANARY_ADAPTER_CONFORMANCE_STATUS.PASS);
  assert.equal(result.mockOnly, true);
  assert.equal(result.liveAdapterInvocationAllowed, false);
  assert.equal(result.routingEffect, 'NONE');
  assert.equal(result.deploymentEffect, 'NONE');
  assert.equal(result.runtimeEffect, 'NONE');
  assert.equal(result.persistenceEffect, 'NONE');
  assert.equal(result.authorityChangeAllowed, false);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.evidence.cohortResolver.cohortId, 'cohort:main2:1');
  assert.equal(result.evidence.activationPreflight.activated, false);
  assert.equal(result.evidence.observabilityAdapter.snapshot.settlementCoverageRatio, 1);
  assert.equal(result.evidence.rollbackAdapter.propose.executed, false);
  assert.equal(result.evidence.expiryGuard.status, 'VALID');
});

test('P18 rejects unbranded or live-looking adapters before invocation', async () => {
  let called = 0;
  const mocks = validMocks();
  mocks.cohortResolver = {
    mockOnly: false,
    source: 'PRODUCTION',
    interfaceContract: TML_CANARY_ADAPTER_INTERFACE.COHORT_RESOLVER,
    async inspect() {
      called += 1;
      return {};
    }
  };

  const result = await runTmlCanaryAdapterMockConformance({
    interfacePack: interfacePack(),
    mocks,
    currentTime: NOW
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(called, 0);
  assert.ok(result.diagnostics.some((item) => item.code === 'MOCK_BRAND_REQUIRED'));
  assert.equal(result.evidence, null);
});

test('P18 fails when any required mock method is missing or extra callable is exposed', async () => {
  const missing = validMocks();
  delete missing.observabilityAdapter.snapshot;

  const missingResult = await runTmlCanaryAdapterMockConformance({
    interfacePack: interfacePack(),
    mocks: missing,
    currentTime: NOW
  });
  assert.equal(missingResult.status, 'FAIL');
  assert.ok(missingResult.diagnostics.some((item) => item.code === 'MOCK_METHOD_MISSING'));

  const extra = validMocks();
  extra.expiryGuard.activate = async () => ({});
  const extraResult = await runTmlCanaryAdapterMockConformance({
    interfacePack: interfacePack(),
    mocks: extra,
    currentTime: NOW
  });
  assert.equal(extraResult.status, 'FAIL');
  assert.ok(extraResult.diagnostics.some((item) => item.code === 'MOCK_EXTRA_CALLABLE_FORBIDDEN'));
});

test('P18 catches thrown mock implementations as FAIL diagnostics', async () => {
  const mocks = validMocks();
  mocks.activationPreflight.check = async () => {
    throw new Error('mock preflight exploded');
  };

  const result = await runTmlCanaryAdapterMockConformance({
    interfacePack: interfacePack(),
    mocks,
    currentTime: NOW
  });

  assert.equal(result.status, 'FAIL');
  assert.ok(result.diagnostics.some((item) =>
    item.role === 'activationPreflight' && item.code === 'MOCK_INVOCATION_THROW'
  ));
});

test('P18 detects invalid cohort/preflight/observability/rollback outputs', async () => {
  const cases = [
    ['cohortResolver', 'COHORT_MOCK_OUTPUT_INVALID', {
      cohortResolver: {
        ...validMocks().cohortResolver,
        async inspect() {
          return { cohortId: 'wrong', membershipEmbedded: true, readOnly: false, sideEffects: 'ROUTE' };
        }
      }
    }],
    ['activationPreflight', 'PREFLIGHT_MOCK_OUTPUT_INVALID', {
      activationPreflight: {
        ...validMocks().activationPreflight,
        async check() {
          return { status: 'READY', activated: true, sideEffects: 'ACTIVATE' };
        }
      }
    }],
    ['observabilityAdapter', 'OBSERVABILITY_SNAPSHOT_INVALID', {
      observabilityAdapter: {
        ...validMocks().observabilityAdapter,
        async snapshot() {
          return {
            transitionMismatches: -1,
            rewardReceiptMismatches: 0,
            rewardSettlementMismatches: 0,
            verificationUnknown: 0,
            verificationConflict: 0,
            settlementCoverageRatio: 2,
            sideEffects: 'NONE'
          };
        }
      }
    }],
    ['rollbackAdapter', 'ROLLBACK_PROPOSAL_OUTPUT_INVALID', {
      rollbackAdapter: {
        ...validMocks().rollbackAdapter,
        async propose() {
          return {
            status: 'ROLLBACK_EXECUTED',
            targetAuthority: 'tml-main2',
            executed: true,
            sideEffects: 'ROUTE'
          };
        }
      }
    }]
  ];

  for (const [role, code, override] of cases) {
    const result = await runTmlCanaryAdapterMockConformance({
      interfacePack: interfacePack(),
      mocks: validMocks(override),
      currentTime: NOW
    });
    assert.equal(result.status, 'FAIL');
    assert.ok(result.diagnostics.some((item) => item.role === role && item.code === code));
  }
});

test('P18 expiry guard must return VALID before expiry and EXPIRED after expiry without mutation', async () => {
  const before = await runTmlCanaryAdapterMockConformance({
    interfacePack: interfacePack(),
    mocks: validMocks(),
    currentTime: '2026-10-03T15:00:00+09:00'
  });
  assert.equal(before.status, 'PASS');
  assert.equal(before.evidence.expiryGuard.status, 'VALID');

  const after = await runTmlCanaryAdapterMockConformance({
    interfacePack: interfacePack(),
    mocks: validMocks(),
    currentTime: '2026-10-03T15:10:00+09:00'
  });
  assert.equal(after.status, 'PASS');
  assert.equal(after.evidence.expiryGuard.status, 'EXPIRED');
  assert.equal(after.evidence.expiryGuard.mutatedExpiry, false);
});

test('P18 refuses a tampered P17 interface pack before mock invocation', async () => {
  const base = interfacePack();
  const tampered = {
    ...base,
    adapterInvocationAllowed: true
  };
  let calls = 0;
  const mocks = validMocks();
  mocks.cohortResolver.inspect = async () => {
    calls += 1;
    return {};
  };

  const result = await runTmlCanaryAdapterMockConformance({
    interfacePack: tampered,
    mocks,
    currentTime: NOW
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(calls, 0);
  assert.ok(result.diagnostics.some((item) => item.code === 'INTERFACE_PACK_EFFECT_BOUNDARY_INVALID'));
});

test('P18 harness is not wired into live routing, activation, persistence or deployment', () => {
  const source = readFileSync(new URL('../tml/runtime/canary-adapter-conformance.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /routeUser\s*\(|assignCohort\s*\(|setFlag\s*\(|deploy\s*\(/i);
  assert.doesNotMatch(source, /setAuthority\s*\(|setQuestEnabled|featureFlag\s*\.\s*(?:set|enable|update)\s*\(/i);
  assert.doesNotMatch(main, /canary-adapter-conformance|MOCK_ONLY|TEST_MOCK/);
  assert.doesNotMatch(runtime, /canary-adapter-conformance|MOCK_ONLY|TEST_MOCK/);
});
