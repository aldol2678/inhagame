import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  simulateTmlMain2CanaryDryRun,
  TML_CANARY_DRY_RUN_OUTCOME,
  TML_MAIN2_CANARY_DRY_RUN_CONTRACT
} from '../tml/runtime/canary-dry-run.mjs';

const NOW = '2026-10-03T14:00:00+09:00';

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
      reviewerRef: 'human:reviewer',
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

function healthyScenario(overrides = {}) {
  return {
    virtualPopulation: 1000,
    resolvedWrites: 40,
    transitionMismatches: 0,
    rewardReceiptMismatches: 0,
    rewardSettlementMismatches: 0,
    verificationUnknown: 0,
    verificationConflict: 0,
    settlementCoverageRatio: 1,
    humanStopRequested: false,
    ...overrides
  };
}

test('P15 entry approval is mandatory before any dry-run canary evaluation', () => {
  const result = simulateTmlMain2CanaryDryRun({
    proposalPack: proposalPack(),
    phaseId: 'canary-1-percent',
    humanGate: { entryApproved: false, exitApproved: false },
    scenario: healthyScenario(),
    generatedAt: NOW
  });

  assert.equal(result.outcome, TML_CANARY_DRY_RUN_OUTCOME.HOLD);
  assert.deepEqual(result.reasons, ['ENTRY_HUMAN_APPROVAL_REQUIRED']);
  assert.equal(result.proposedAction, 'HOLD_CANARY_ENTRY');
  assert.equal(result.phase.virtualCohortSize, 10);
  assert.equal(result.routingEffect, 'NONE');
  assert.equal(result.authorityChangeAllowed, false);
});

test('P15 any mismatch proposes rollback and outranks sample or exit gates', () => {
  for (const scenario of [
    healthyScenario({ transitionMismatches: 1 }),
    healthyScenario({ rewardReceiptMismatches: 1 }),
    healthyScenario({ rewardSettlementMismatches: 1 })
  ]) {
    const result = simulateTmlMain2CanaryDryRun({
      proposalPack: proposalPack(),
      phaseId: 'canary-5-percent',
      humanGate: { entryApproved: true, exitApproved: false },
      scenario,
      generatedAt: NOW
    });

    assert.equal(result.outcome, TML_CANARY_DRY_RUN_OUTCOME.ROLLBACK_PROPOSED);
    assert.equal(result.proposedAction, 'PROPOSE_ROLLBACK_TO_LEGACY');
    assert.equal(result.nextPhaseId, null);
  }
});

test('P15 settlement coverage below 100% proposes rollback', () => {
  const result = simulateTmlMain2CanaryDryRun({
    proposalPack: proposalPack(),
    phaseId: 'canary-1-percent',
    humanGate: { entryApproved: true, exitApproved: true },
    scenario: healthyScenario({ settlementCoverageRatio: 0.999 }),
    generatedAt: NOW
  });

  assert.equal(result.outcome, TML_CANARY_DRY_RUN_OUTCOME.ROLLBACK_PROPOSED);
  assert.deepEqual(result.reasons, ['SETTLEMENT_COVERAGE_BELOW']);
});

test('P15 verification UNKNOWN or CONFLICT proposes rollback', () => {
  for (const scenario of [
    healthyScenario({ verificationUnknown: 1 }),
    healthyScenario({ verificationConflict: 1 }),
    healthyScenario({ verificationUnknown: 1, verificationConflict: 1 })
  ]) {
    const result = simulateTmlMain2CanaryDryRun({
      proposalPack: proposalPack(),
      phaseId: 'canary-1-percent',
      humanGate: { entryApproved: true, exitApproved: true },
      scenario,
      generatedAt: NOW
    });

    assert.equal(result.outcome, TML_CANARY_DRY_RUN_OUTCOME.ROLLBACK_PROPOSED);
    assert.ok(result.reasons.includes('ANY_VERIFICATION_UNKNOWN_OR_CONFLICT'));
  }
});

test('P15 explicit human stop proposes rollback even with perfect metrics', () => {
  const result = simulateTmlMain2CanaryDryRun({
    proposalPack: proposalPack(),
    phaseId: 'canary-1-percent',
    humanGate: { entryApproved: true, exitApproved: true },
    scenario: healthyScenario({ humanStopRequested: true }),
    generatedAt: NOW
  });

  assert.equal(result.outcome, TML_CANARY_DRY_RUN_OUTCOME.ROLLBACK_PROPOSED);
  assert.deepEqual(result.reasons, ['HUMAN_STOP_REQUESTED']);
});

test('P15 healthy but under-sampled phase stays HOLD', () => {
  const result = simulateTmlMain2CanaryDryRun({
    proposalPack: proposalPack(),
    phaseId: 'canary-1-percent',
    humanGate: { entryApproved: true, exitApproved: true },
    scenario: healthyScenario({ resolvedWrites: 19 }),
    generatedAt: NOW,
    minResolvedWrites: 20
  });

  assert.equal(result.outcome, TML_CANARY_DRY_RUN_OUTCOME.HOLD);
  assert.deepEqual(result.reasons, ['RESOLVED_WRITES_BELOW_DRY_RUN_MINIMUM']);
  assert.equal(result.proposedAction, 'COLLECT_MORE_DRY_RUN_EVIDENCE');
});

test('P15 healthy phase still requires explicit exit approval', () => {
  const result = simulateTmlMain2CanaryDryRun({
    proposalPack: proposalPack(),
    phaseId: 'canary-1-percent',
    humanGate: { entryApproved: true, exitApproved: false },
    scenario: healthyScenario(),
    generatedAt: NOW
  });

  assert.equal(result.outcome, TML_CANARY_DRY_RUN_OUTCOME.HOLD);
  assert.deepEqual(result.reasons, ['EXIT_HUMAN_APPROVAL_REQUIRED']);
  assert.equal(result.proposedAction, 'HOLD_CANARY_EXIT');
});

test('P15 healthy approved 1% proposes 5%, and healthy approved 5% proposes 25%', () => {
  const one = simulateTmlMain2CanaryDryRun({
    proposalPack: proposalPack(),
    phaseId: 'canary-1-percent',
    humanGate: { entryApproved: true, exitApproved: true },
    scenario: healthyScenario(),
    generatedAt: NOW
  });
  const five = simulateTmlMain2CanaryDryRun({
    proposalPack: proposalPack(),
    phaseId: 'canary-5-percent',
    humanGate: { entryApproved: true, exitApproved: true },
    scenario: healthyScenario(),
    generatedAt: NOW
  });

  assert.equal(one.outcome, TML_CANARY_DRY_RUN_OUTCOME.ADVANCE_PROPOSED);
  assert.equal(one.nextPhaseId, 'canary-5-percent');
  assert.equal(one.phase.virtualCohortSize, 10);

  assert.equal(five.outcome, TML_CANARY_DRY_RUN_OUTCOME.ADVANCE_PROPOSED);
  assert.equal(five.nextPhaseId, 'canary-25-percent');
  assert.equal(five.phase.virtualCohortSize, 50);
});

test('P15 healthy approved 25% never proposes 100% because P14 excludes full rollout', () => {
  const result = simulateTmlMain2CanaryDryRun({
    proposalPack: proposalPack(),
    phaseId: 'canary-25-percent',
    humanGate: { entryApproved: true, exitApproved: true },
    scenario: healthyScenario(),
    generatedAt: NOW
  });

  assert.equal(result.outcome, TML_CANARY_DRY_RUN_OUTCOME.HOLD);
  assert.deepEqual(result.reasons, ['P14_FULL_ROLLOUT_NOT_INCLUDED']);
  assert.equal(result.nextPhaseId, null);
  assert.equal(result.proposedAction, 'RETURN_TO_HUMAN_REVIEW_FOR_FULL_ROLLOUT_DESIGN');
  assert.equal(result.phase.virtualCohortSize, 250);
});

test('P15 is simulation-only and carries no runtime/routing/persistence effect', () => {
  const result = simulateTmlMain2CanaryDryRun({
    proposalPack: proposalPack(),
    phaseId: 'canary-1-percent',
    humanGate: { entryApproved: true, exitApproved: true },
    scenario: healthyScenario(),
    generatedAt: NOW
  });

  assert.equal(result.schema, 'tml.canary-dry-run');
  assert.equal(result.version, '0.1');
  assert.equal(result.contract, TML_MAIN2_CANARY_DRY_RUN_CONTRACT);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.executable, false);
  assert.equal(result.runtimeEffect, 'NONE');
  assert.equal(result.persistenceEffect, 'NONE');
  assert.equal(result.routingEffect, 'NONE');
  assert.deepEqual(result.authority, {
    current: 'legacy-main2',
    simulatedCandidate: 'tml-main2',
    currentRemainsAuthoritative: true
  });
});

test('P15 rejects executable/tampered P14 packs and unknown phases', () => {
  for (const pack of [
    proposalPack({ executable: true }),
    proposalPack({ automaticExecutionAllowed: true }),
    proposalPack({ authorityChangeAllowed: true }),
    proposalPack({ runtimeEffect: 'WRITE' }),
    proposalPack({ persistenceEffect: 'DB' }),
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
      canaryPlan: {
        ...proposalPack().canaryPlan,
        phases: [
          ...proposalPack().canaryPlan.phases.slice(0, 2),
          { ...proposalPack().canaryPlan.phases[2], audiencePercent: 100 }
        ]
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
  ]) {
    assert.throws(
      () => simulateTmlMain2CanaryDryRun({
        proposalPack: pack,
        phaseId: 'canary-1-percent',
        humanGate: { entryApproved: true, exitApproved: true },
        scenario: healthyScenario(),
        generatedAt: NOW
      }),
      (error) => [
        'PROPOSAL_EFFECT_BOUNDARY_INVALID',
        'PROPOSAL_AUTHORITY_BOUNDARY_INVALID',
        'FULL_ROLLOUT_NOT_ALLOWED',
        'CANARY_PLAN_BOUNDARY_INVALID',
        'ROLLBACK_PLAN_BOUNDARY_INVALID',
        'OBSERVABILITY_PLAN_BOUNDARY_INVALID'
      ].includes(error.code)
    );
  }

  assert.throws(
    () => simulateTmlMain2CanaryDryRun({
      proposalPack: proposalPack(),
      phaseId: 'canary-100-percent',
      humanGate: { entryApproved: true, exitApproved: true },
      scenario: healthyScenario(),
      generatedAt: NOW
    }),
    (error) => error.code === 'CANARY_PHASE_NOT_FOUND'
  );
});

test('P15 module has no live routing, persistence, deployment or authority-switch integration', () => {
  const source = readFileSync(new URL('../tml/runtime/canary-dry-run.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /featureFlag|setFlag|routeUser|assignCohort|deploy|vercel|cloud run/i);
  assert.doesNotMatch(source, /setAuthority|promote\s*\(|activate\s*\(|setQuestEnabled/i);
  assert.doesNotMatch(main, /canary-dry-run|ADVANCE_PROPOSED|ROLLBACK_PROPOSED/);
  assert.doesNotMatch(runtime, /canary-dry-run|ADVANCE_PROPOSED|ROLLBACK_PROPOSED/);
});
