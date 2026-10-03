import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildTmlMain2CanaryAdapterInterfacePack,
  getTmlCanaryAdapterInterfaceDescriptors,
  TML_CANARY_ADAPTER_INTERFACE,
  TML_MAIN2_CANARY_ADAPTER_INTERFACE_PACK
} from '../tml/runtime/canary-adapter-interfaces.mjs';

const GENERATED_AT = '2026-10-03T14:20:00+09:00';

function executionContract(overrides = {}) {
  return {
    schema: 'tml.canary-execution-contract',
    version: '0.1',
    contract: 'main2-canary-execution-contract@p16',
    status: 'CONTRACT_READY',
    id: 'canary-contract.main2.0123456789abcdef01234567',
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
    sourceProposal: {
      contract: 'main2-promotion-proposal@p14',
      generatedAt: '2026-10-03T13:55:00+09:00',
      proposalFingerprint: 'a'.repeat(64),
      reviewFingerprint: 'b'.repeat(64),
      attestationFingerprint: 'c'.repeat(64)
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
    humanApproval: {
      approvalRef: 'approval:canary:001',
      approverRef: 'human:approver',
      approvedAt: '2026-10-03T14:05:00+09:00',
      decision: 'APPROVE_CANARY_EXECUTION_CONTRACT',
      scope: 'CONTRACT_CREATION_ONLY',
      phaseId: 'canary-1-percent',
      proposalFingerprint: 'a'.repeat(64),
      attestationFingerprint: 'c'.repeat(64)
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
    validity: {
      generatedAt: '2026-10-03T14:10:00+09:00',
      expiresAt: '2026-10-03T15:10:00+09:00',
      maxValidityMs: 7200000
    },
    requirements: [
      'SEPARATE_HUMAN_ACTIVATION_REQUIRED',
      'EXTERNAL_ROUTER_IMPLEMENTATION_REQUIRED',
      'EXTERNAL_ROLLBACK_ADAPTER_REQUIRED',
      'EXTERNAL_OBSERVABILITY_ADAPTER_REQUIRED',
      'EXPIRY_CHECK_REQUIRED_AT_ACTIVATION'
    ],
    nextAction: 'HUMAN_REVIEW_EXECUTION_ADAPTER_DESIGN_ONLY',
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
      implementationRef: 'impl:cohort-resolver:v1',
      versionRef: 'git:abc123',
      ownerRef: 'team:runtime'
    },
    activationPreflight: {
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.ACTIVATION_PREFLIGHT,
      implementationRef: 'impl:activation-preflight:v1',
      versionRef: 'git:def456',
      ownerRef: 'team:runtime'
    },
    observabilityAdapter: {
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.OBSERVABILITY_ADAPTER,
      implementationRef: 'impl:observability:v1',
      versionRef: 'git:ghi789',
      ownerRef: 'team:ops'
    },
    rollbackAdapter: {
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.ROLLBACK_ADAPTER,
      implementationRef: 'impl:rollback:v1',
      versionRef: 'git:jkl012',
      ownerRef: 'team:ops'
    },
    expiryGuard: {
      interfaceContract: TML_CANARY_ADAPTER_INTERFACE.EXPIRY_GUARD,
      implementationRef: 'impl:expiry-guard:v1',
      versionRef: 'git:mno345',
      ownerRef: 'team:runtime'
    }
  };
}

test('P17 exposes exactly five future adapter interfaces with no live implementation', () => {
  const descriptors = getTmlCanaryAdapterInterfaceDescriptors();
  assert.deepEqual(Object.keys(descriptors), [
    'cohortResolver',
    'activationPreflight',
    'observabilityAdapter',
    'rollbackAdapter',
    'expiryGuard'
  ]);

  assert.equal(descriptors.cohortResolver.interfaceContract, 'tml.canary.cohort-resolver@p17');
  assert.equal(descriptors.activationPreflight.interfaceContract, 'tml.canary.activation-preflight@p17');
  assert.equal(descriptors.observabilityAdapter.interfaceContract, 'tml.canary.observability-adapter@p17');
  assert.equal(descriptors.rollbackAdapter.interfaceContract, 'tml.canary.rollback-adapter@p17');
  assert.equal(descriptors.expiryGuard.interfaceContract, 'tml.canary.expiry-guard@p17');

  assert.ok(descriptors.cohortResolver.prohibitedEffects.includes('ROUTE_TRAFFIC'));
  assert.ok(descriptors.activationPreflight.prohibitedEffects.includes('ACTIVATE'));
  assert.ok(descriptors.rollbackAdapter.prohibitedEffects.includes('EXECUTE_ROLLBACK'));
  assert.ok(descriptors.expiryGuard.prohibitedEffects.includes('EXTEND_EXPIRY'));
});

test('P17 builds an immutable reference-only interface pack from a valid P16 contract', () => {
  const pack = buildTmlMain2CanaryAdapterInterfacePack({
    executionContract: executionContract(),
    adapters: bindings(),
    generatedAt: GENERATED_AT
  });

  assert.equal(pack.schema, 'tml.canary-adapter-interface-pack');
  assert.equal(pack.version, '0.1');
  assert.equal(pack.contract, TML_MAIN2_CANARY_ADAPTER_INTERFACE_PACK);
  assert.equal(pack.status, 'INTERFACES_BOUND_BY_REFERENCE');
  assert.equal(pack.advisoryOnly, true);
  assert.equal(pack.executable, false);
  assert.equal(pack.adapterInvocationAllowed, false);
  assert.equal(pack.routingEffect, 'NONE');
  assert.equal(pack.deploymentEffect, 'NONE');
  assert.equal(pack.runtimeEffect, 'NONE');
  assert.equal(pack.persistenceEffect, 'NONE');
  assert.equal(pack.authorityChangeAllowed, false);
  assert.deepEqual(pack.authority, {
    current: 'legacy-main2',
    candidate: 'tml-main2',
    currentRemainsAuthoritative: true
  });

  assert.deepEqual(pack.sourceExecutionContract, {
    id: 'canary-contract.main2.0123456789abcdef01234567',
    contract: 'main2-canary-execution-contract@p16',
    contractFingerprint: 'd'.repeat(64),
    phaseId: 'canary-1-percent',
    cohortId: 'cohort:main2:1',
    rollbackHandle: 'rollback:legacy-main2:v1',
    observabilityHandle: 'observe:main2:v1',
    expiresAt: '2026-10-03T15:10:00+09:00'
  });

  assert.throws(() => {
    pack.bindings.cohortResolver.implementationRef = 'changed';
  }, TypeError);
});

test('P17 requires all five adapter reference bindings and rejects unknown bindings', () => {
  const base = bindings();

  for (const key of Object.keys(base)) {
    const partial = { ...base };
    delete partial[key];
    assert.throws(
      () => buildTmlMain2CanaryAdapterInterfacePack({
        executionContract: executionContract(),
        adapters: partial,
        generatedAt: GENERATED_AT
      }),
      (error) => error.code === 'ADAPTER_BINDING_REQUIRED'
    );
  }

  assert.throws(
    () => buildTmlMain2CanaryAdapterInterfacePack({
      executionContract: executionContract(),
      adapters: {
        ...bindings(),
        router: {
          interfaceContract: 'tml.canary.router@p17',
          implementationRef: 'impl:router',
          versionRef: 'git:x',
          ownerRef: 'team:x'
        }
      },
      generatedAt: GENERATED_AT
    }),
    (error) => error.code === 'UNKNOWN_ADAPTER_BINDING'
  );
});

test('P17 binding contract ids must match their exact interface role', () => {
  const bad = bindings();
  bad.rollbackAdapter = {
    ...bad.rollbackAdapter,
    interfaceContract: TML_CANARY_ADAPTER_INTERFACE.OBSERVABILITY_ADAPTER
  };

  assert.throws(
    () => buildTmlMain2CanaryAdapterInterfacePack({
      executionContract: executionContract(),
      adapters: bad,
      generatedAt: GENERATED_AT
    }),
    (error) => error.code === 'INTERFACE_CONTRACT_MISMATCH'
  );
});

test('P17 bindings are references only and reject executable or membership data', () => {
  for (const forbidden of [
    { implementation: () => {} },
    { handler: () => {} },
    { fn: () => {} },
    { members: ['user-1'] },
    { userIds: ['user-1'] }
  ]) {
    const bad = bindings();
    bad.cohortResolver = { ...bad.cohortResolver, ...forbidden };

    assert.throws(
      () => buildTmlMain2CanaryAdapterInterfacePack({
        executionContract: executionContract(),
        adapters: bad,
        generatedAt: GENERATED_AT
      }),
      (error) => error.code === 'EXECUTABLE_OR_MEMBERSHIP_DATA_FORBIDDEN'
    );
  }
});

test('P17 rejects tampered P16 effect, authority, cohort, fingerprint and requirement boundaries', () => {
  const invalid = [
    executionContract({ executable: true }),
    executionContract({ activationAllowed: true }),
    executionContract({ routingEffect: 'ROUTE' }),
    executionContract({ deploymentEffect: 'DEPLOY' }),
    executionContract({ runtimeEffect: 'WRITE' }),
    executionContract({ persistenceEffect: 'DB' }),
    executionContract({ authorityChangeAllowed: true }),
    executionContract({
      authority: {
        current: 'tml-main2',
        requestedCandidate: 'tml-main2',
        currentRemainsAuthoritative: false
      }
    }),
    executionContract({
      cohort: {
        id: 'cohort:main2:1',
        assignmentMode: 'HASH_USERS',
        expectedAudiencePercent: 1,
        membershipEmbedded: false
      }
    }),
    executionContract({
      evidence: {
        contractFingerprint: 'not-sha'
      }
    }),
    executionContract({
      requirements: ['SEPARATE_HUMAN_ACTIVATION_REQUIRED']
    })
  ];

  for (const contract of invalid) {
    assert.throws(
      () => buildTmlMain2CanaryAdapterInterfacePack({
        executionContract: contract,
        adapters: bindings(),
        generatedAt: GENERATED_AT
      }),
      (error) => [
        'P16_EFFECT_BOUNDARY_INVALID',
        'P16_AUTHORITY_BOUNDARY_INVALID',
        'P16_COHORT_BOUNDARY_INVALID',
        'P16_CONTRACT_FINGERPRINT_INVALID',
        'P16_REQUIREMENTS_INCOMPLETE'
      ].includes(error.code)
    );
  }
});

test('P17 descriptors keep future external effects narrow and human-gated', () => {
  const descriptors = getTmlCanaryAdapterInterfaceDescriptors();

  assert.deepEqual(
    descriptors.activationPreflight.requiredMethods.map((method) => method.name),
    ['check']
  );
  assert.deepEqual(
    descriptors.expiryGuard.requiredMethods.map((method) => method.name),
    ['check']
  );
  assert.ok(descriptors.observabilityAdapter.requiredMethods.every(
    (method) => method.effect === 'READ_ONLY'
  ));
  assert.equal(
    descriptors.rollbackAdapter.requiredMethods.find((method) => method.name === 'propose').effect,
    'PROPOSAL_ONLY'
  );
});

test('P17 has no live adapter invocation, routing, persistence, deployment or authority-switch integration', () => {
  const source = readFileSync(new URL('../tml/runtime/canary-adapter-interfaces.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /await\s+adapters?\.|adapters?\[[^\]]+\]\s*\(/i);
  assert.doesNotMatch(source, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /routeUser\s*\(|assignCohort\s*\(|setFlag\s*\(|deploy\s*\(/i);
  assert.doesNotMatch(source, /setAuthority\s*\(|activate\s*\(|setQuestEnabled/i);
  assert.doesNotMatch(main, /canary-adapter-interfaces|INTERFACES_BOUND_BY_REFERENCE/);
  assert.doesNotMatch(runtime, /canary-adapter-interfaces|INTERFACES_BOUND_BY_REFERENCE/);
});
