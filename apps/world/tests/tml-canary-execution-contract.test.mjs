import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createTmlMain2CanaryExecutionContract,
  fingerprintTmlMain2PromotionProposal,
  TML_CANARY_EXECUTION_APPROVAL_DECISION,
  TML_CANARY_EXECUTION_APPROVAL_SCOPE,
  TML_CANARY_EXECUTION_CONTRACT_STATUS,
  TML_MAIN2_CANARY_EXECUTION_CONTRACT
} from '../tml/runtime/canary-execution-contract.mjs';

const GENERATED_AT = '2026-10-03T14:10:00+09:00';
const APPROVED_AT = '2026-10-03T14:05:00+09:00';
const EXPIRES_AT = '2026-10-03T15:10:00+09:00';

function proposalPack(overrides = {}) {
  return {
    schema: 'tml.promotion-proposal-pack',
    version: '0.1',
    contract: 'main2-promotion-proposal@p14',
    generatedAt: '2026-10-03T13:55:00+09:00',
    status: 'PROPOSAL_READY',
    advisoryOnly: true,
    executable: false,
    automaticExecutionAllowed: false,
    authorityChangeAllowed: false,
    authority: {
      current: 'legacy-main2',
      proposedCandidate: 'tml-main2',
      currentRemainsAuthoritative: true
    },
    sourceAttestation: {
      id: 'attestation.main2.0123456789abcdef01234567',
      reviewedAt: '2026-10-03T13:50:00+09:00',
      reviewerRef: 'human:release-reviewer',
      decision: 'APPROVE_FOR_NEXT_STAGE',
      reviewFingerprint: 'a'.repeat(64),
      attestationFingerprint: 'b'.repeat(64)
    },
    canaryPlan: {
      mode: 'PROPOSAL_ONLY',
      phases: [
        {
          id: 'canary-1-percent',
          audiencePercent: 1,
          authority: 'tml-main2-candidate',
          entryMode: 'HUMAN_APPROVAL_REQUIRED',
          exitMode: 'HUMAN_APPROVAL_REQUIRED'
        },
        {
          id: 'canary-5-percent',
          audiencePercent: 5,
          authority: 'tml-main2-candidate',
          entryMode: 'HUMAN_APPROVAL_REQUIRED',
          exitMode: 'HUMAN_APPROVAL_REQUIRED'
        },
        {
          id: 'canary-25-percent',
          audiencePercent: 25,
          authority: 'tml-main2-candidate',
          entryMode: 'HUMAN_APPROVAL_REQUIRED',
          exitMode: 'HUMAN_APPROVAL_REQUIRED'
        }
      ],
      progressionRule: 'HUMAN_APPROVAL_REQUIRED_FOR_EVERY_PHASE',
      fullRolloutIncluded: false
    },
    rollbackPlan: {
      mode: 'PROPOSAL_ONLY',
      targetAuthority: 'legacy-main2',
      automaticRollbackAllowed: false,
      conditions: []
    },
    observabilityPlan: {
      mode: 'PROPOSAL_ONLY',
      metrics: [],
      requiredSettlementCoverageDuringCanary: 1,
      mismatchBudget: 0
    },
    preSwitchChecklist: [],
    nextAction: 'HUMAN_REVIEW_PROPOSAL_ONLY',
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE',
    ...overrides
  };
}

async function approvalFor(pack, phaseId = 'canary-1-percent') {
  const proposalFingerprint = await fingerprintTmlMain2PromotionProposal(pack);
  return {
    proposalFingerprint,
    approval: {
      approvalRef: 'approval:canary:001',
      approverRef: 'human:canary-approver',
      approvedAt: APPROVED_AT,
      decision: TML_CANARY_EXECUTION_APPROVAL_DECISION,
      scope: TML_CANARY_EXECUTION_APPROVAL_SCOPE,
      phaseId,
      proposalFingerprint,
      attestationFingerprint: pack.sourceAttestation.attestationFingerprint
    }
  };
}

async function validArgs({ phaseId = 'canary-1-percent', pack = proposalPack() } = {}) {
  const { proposalFingerprint, approval } = await approvalFor(pack, phaseId);
  const percent = phaseId === 'canary-1-percent' ? 1 : phaseId === 'canary-5-percent' ? 5 : 25;
  return {
    proposalPack: pack,
    proposalFingerprint,
    phaseId,
    humanApproval: approval,
    cohort: {
      id: `cohort:main2:${percent}`,
      assignmentMode: 'EXTERNAL_EXPLICIT_COHORT',
      expectedAudiencePercent: percent
    },
    rollbackHandle: 'rollback:legacy-main2:v1',
    observabilityHandle: 'observe:main2-canary:v1',
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT
  };
}

test('P16 creates a non-executable canary execution contract with all required bindings', async () => {
  const contract = await createTmlMain2CanaryExecutionContract(await validArgs());

  assert.equal(contract.schema, 'tml.canary-execution-contract');
  assert.equal(contract.version, '0.1');
  assert.equal(contract.contract, TML_MAIN2_CANARY_EXECUTION_CONTRACT);
  assert.equal(contract.status, TML_CANARY_EXECUTION_CONTRACT_STATUS.CONTRACT_READY);
  assert.match(contract.id, /^canary-contract\.main2\.[0-9a-f]{24}$/);
  assert.match(contract.evidence.contractFingerprint, /^[0-9a-f]{64}$/);

  assert.equal(contract.advisoryOnly, true);
  assert.equal(contract.executable, false);
  assert.equal(contract.activationAllowed, false);
  assert.equal(contract.routingEffect, 'NONE');
  assert.equal(contract.deploymentEffect, 'NONE');
  assert.equal(contract.runtimeEffect, 'NONE');
  assert.equal(contract.persistenceEffect, 'NONE');
  assert.equal(contract.authorityChangeAllowed, false);
  assert.deepEqual(contract.authority, {
    current: 'legacy-main2',
    requestedCandidate: 'tml-main2',
    currentRemainsAuthoritative: true
  });

  assert.equal(contract.phase.id, 'canary-1-percent');
  assert.equal(contract.phase.audiencePercent, 1);
  assert.equal(contract.phase.fullRollout, false);
  assert.equal(contract.humanApproval.decision, TML_CANARY_EXECUTION_APPROVAL_DECISION);
  assert.equal(contract.humanApproval.scope, TML_CANARY_EXECUTION_APPROVAL_SCOPE);
  assert.equal(contract.cohort.assignmentMode, 'EXTERNAL_EXPLICIT_COHORT');
  assert.equal(contract.cohort.membershipEmbedded, false);
  assert.equal(contract.handles.rollback, 'rollback:legacy-main2:v1');
  assert.equal(contract.handles.observability, 'observe:main2-canary:v1');
  assert.equal(contract.validity.maxValidityMs, 2 * 60 * 60 * 1000);
  assert.ok(contract.requirements.includes('SEPARATE_HUMAN_ACTIVATION_REQUIRED'));
  assert.ok(contract.requirements.includes('EXTERNAL_ROUTER_IMPLEMENTATION_REQUIRED'));
  assert.equal(contract.nextAction, 'HUMAN_REVIEW_EXECUTION_ADAPTER_DESIGN_ONLY');

  assert.throws(() => {
    contract.phase.audiencePercent = 100;
  }, TypeError);
  assert.throws(() => {
    contract.humanApproval.approverRef = 'other';
  }, TypeError);
  assert.throws(() => {
    contract.handles.rollback = 'changed';
  }, TypeError);
});

test('P16 proposal fingerprint is canonical and binds the exact P14 proposal', async () => {
  const pack = proposalPack();
  const reordered = Object.fromEntries(Object.entries(pack).reverse());

  const first = await fingerprintTmlMain2PromotionProposal(pack);
  const second = await fingerprintTmlMain2PromotionProposal(reordered);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);

  const args = await validArgs({ pack });
  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      ...args,
      proposalFingerprint: '0'.repeat(64)
    }),
    (error) => error.code === 'PROPOSAL_FINGERPRINT_MISMATCH'
  );
});

test('P16 separate human approval must bind phase, proposal and P13 attestation fingerprints', async () => {
  const args = await validArgs();

  for (const [patch, code] of [
    [{ phaseId: 'canary-5-percent' }, 'APPROVAL_PHASE_MISMATCH'],
    [{ proposalFingerprint: 'c'.repeat(64) }, 'APPROVAL_PROPOSAL_FINGERPRINT_MISMATCH'],
    [{ attestationFingerprint: 'd'.repeat(64) }, 'APPROVAL_ATTESTATION_FINGERPRINT_MISMATCH'],
    [{ decision: 'APPROVE_FOR_NEXT_STAGE' }, 'INVALID_EXECUTION_APPROVAL_DECISION'],
    [{ scope: 'RUNTIME_ACTIVATION' }, 'INVALID_EXECUTION_APPROVAL_SCOPE']
  ]) {
    await assert.rejects(
      () => createTmlMain2CanaryExecutionContract({
        ...args,
        humanApproval: {
          ...args.humanApproval,
          ...patch
        }
      }),
      (error) => error.code === code
    );
  }
});

test('P16 requires explicit external cohort metadata without embedding real membership', async () => {
  const args = await validArgs();

  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      ...args,
      cohort: undefined
    }),
    (error) => error.code === 'EXPLICIT_COHORT_REQUIRED'
  );

  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      ...args,
      cohort: {
        ...args.cohort,
        assignmentMode: 'HASH_USERS_AUTOMATICALLY'
      }
    }),
    (error) => error.code === 'INVALID_COHORT_ASSIGNMENT_MODE'
  );

  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      ...args,
      cohort: {
        ...args.cohort,
        expectedAudiencePercent: 5
      }
    }),
    (error) => error.code === 'COHORT_PERCENT_MISMATCH'
  );

  for (const key of ['members', 'userIds', 'users']) {
    await assert.rejects(
      () => createTmlMain2CanaryExecutionContract({
        ...args,
        cohort: {
          ...args.cohort,
          [key]: ['user-1']
        }
      }),
      (error) => error.code === 'COHORT_MEMBERSHIP_EMBEDDED'
    );
  }
});

test('P16 requires explicit rollback and observability handles', async () => {
  const args = await validArgs();

  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      ...args,
      rollbackHandle: ''
    }),
    (error) => error.code === 'INVALID_ROLLBACK_HANDLE'
  );

  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      ...args,
      observabilityHandle: '   '
    }),
    (error) => error.code === 'INVALID_OBSERVABILITY_HANDLE'
  );
});

test('P16 contract is short-lived and cannot predate its human approval', async () => {
  const args = await validArgs();

  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      ...args,
      generatedAt: '2026-10-03T14:00:00+09:00'
    }),
    (error) => error.code === 'CONTRACT_PREDATES_APPROVAL'
  );

  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      ...args,
      expiresAt: GENERATED_AT
    }),
    (error) => error.code === 'CONTRACT_EXPIRY_NOT_AFTER_GENERATION'
  );

  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      ...args,
      expiresAt: '2026-10-03T16:10:01+09:00'
    }),
    (error) => error.code === 'CONTRACT_VALIDITY_TOO_LONG'
  );
});

test('P16 supports only the P14 1/5/25 phases and never creates a full-rollout contract', async () => {
  for (const phaseId of ['canary-1-percent', 'canary-5-percent', 'canary-25-percent']) {
    const args = await validArgs({ phaseId });
    const contract = await createTmlMain2CanaryExecutionContract(args);
    assert.equal(contract.phase.id, phaseId);
    assert.equal(contract.phase.fullRollout, false);
  }

  const pack = proposalPack();
  const { proposalFingerprint, approval } = await approvalFor(pack, 'canary-100-percent');

  await assert.rejects(
    () => createTmlMain2CanaryExecutionContract({
      proposalPack: pack,
      proposalFingerprint,
      phaseId: 'canary-100-percent',
      humanApproval: approval,
      cohort: {
        id: 'cohort:main2:100',
        assignmentMode: 'EXTERNAL_EXPLICIT_COHORT',
        expectedAudiencePercent: 100
      },
      rollbackHandle: 'rollback:legacy-main2:v1',
      observabilityHandle: 'observe:main2:v1',
      generatedAt: GENERATED_AT,
      expiresAt: EXPIRES_AT
    }),
    (error) => error.code === 'CANARY_PHASE_NOT_FOUND'
  );
});

test('P16 rejects tampered P14 effect, authority, rollout, rollback and observability boundaries', async () => {
  const tampered = [
    proposalPack({ executable: true }),
    proposalPack({ automaticExecutionAllowed: true }),
    proposalPack({ authorityChangeAllowed: true }),
    proposalPack({ runtimeEffect: 'WRITE' }),
    proposalPack({
      authority: {
        current: 'tml-main2',
        proposedCandidate: 'tml-main2',
        currentRemainsAuthoritative: false
      }
    }),
    proposalPack({
      canaryPlan: {
        ...proposalPack().canaryPlan,
        fullRolloutIncluded: true
      }
    }),
    proposalPack({
      rollbackPlan: {
        ...proposalPack().rollbackPlan,
        automaticRollbackAllowed: true
      }
    }),
    proposalPack({
      observabilityPlan: {
        ...proposalPack().observabilityPlan,
        mismatchBudget: 1
      }
    })
  ];

  for (const pack of tampered) {
    await assert.rejects(
      () => fingerprintTmlMain2PromotionProposal(pack),
      (error) => [
        'PROPOSAL_EFFECT_BOUNDARY_INVALID',
        'PROPOSAL_AUTHORITY_BOUNDARY_INVALID',
        'FULL_ROLLOUT_NOT_ALLOWED',
        'ROLLBACK_PLAN_INVALID',
        'OBSERVABILITY_PLAN_INVALID'
      ].includes(error.code)
    );
  }
});

test('P16 contract fingerprint changes with phase, cohort or human approval context', async () => {
  const oneArgs = await validArgs({ phaseId: 'canary-1-percent' });
  const fiveArgs = await validArgs({ phaseId: 'canary-5-percent' });

  const one = await createTmlMain2CanaryExecutionContract(oneArgs);
  const five = await createTmlMain2CanaryExecutionContract(fiveArgs);
  const otherCohort = await createTmlMain2CanaryExecutionContract({
    ...oneArgs,
    cohort: {
      ...oneArgs.cohort,
      id: 'cohort:main2:1:other'
    }
  });

  assert.notEqual(one.evidence.contractFingerprint, five.evidence.contractFingerprint);
  assert.notEqual(one.evidence.contractFingerprint, otherCohort.evidence.contractFingerprint);
  assert.notEqual(one.id, five.id);
});

test('P16 module has no routing, activation, persistence, deployment or authority-switch integration', () => {
  const source = readFileSync(new URL('../tml/runtime/canary-execution-contract.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /routeUser\s*\(|assignCohort\s*\(|setFlag\s*\(|featureFlag\s*\.\s*(?:set|enable|update)\s*\(|deploy\s*\(|vercel\s*\.|cloudRun\s*\(/i);
  assert.doesNotMatch(source, /setAuthority|promote\s*\(|activate\s*\(|setQuestEnabled/i);
  assert.doesNotMatch(main, /canary-execution-contract|CONTRACT_READY|EXTERNAL_EXPLICIT_COHORT/);
  assert.doesNotMatch(runtime, /canary-execution-contract|CONTRACT_READY|EXTERNAL_EXPLICIT_COHORT/);
});
