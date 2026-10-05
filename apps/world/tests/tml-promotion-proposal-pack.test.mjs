import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildTmlMain2PromotionProposalPack,
  TML_MAIN2_PROMOTION_PROPOSAL_CONTRACT,
  TML_PROMOTION_PROPOSAL_STATUS
} from '../tml/runtime/promotion-proposal-pack.mjs';

const GENERATED_AT = '2026-10-03T13:55:00+09:00';

function validAttestation(overrides = {}) {
  return {
    schema: 'tml.human-attestation',
    version: '0.1',
    contract: 'main2-shadow-human-attestation@p13',
    id: 'attestation.main2.0123456789abcdef01234567',
    reviewedAt: '2026-10-03T13:50:00+09:00',
    reviewerRef: 'human:release-reviewer',
    decision: 'APPROVE_FOR_NEXT_STAGE',
    note: null,
    evidence: {
      reviewContract: 'main2-shadow-human-review@p12',
      reviewGeneratedAt: '2026-10-03T13:45:00+09:00',
      reviewFingerprint: 'a'.repeat(64),
      attestationFingerprint: 'b'.repeat(64)
    },
    checklistConfirmations: [
      { id: 'review-transition-parity', confirmed: true },
      { id: 'review-mismatch-history', confirmed: true },
      { id: 'review-reward-settlement', confirmed: true },
      { id: 'review-rollout-and-rollback', confirmed: true },
      { id: 'confirm-authority-boundary', confirmed: true }
    ],
    authority: {
      current: 'legacy-main2',
      currentRemainsAuthoritative: true,
      authorityChangeAllowed: false
    },
    advisoryOnly: true,
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE',
    nextAction: 'DESIGN_NEXT_STAGE_PROPOSAL_ONLY',
    ...overrides
  };
}

test('P14 builds a non-executable proposal pack only from approved P13 attestation', () => {
  const pack = buildTmlMain2PromotionProposalPack({
    attestation: validAttestation(),
    generatedAt: GENERATED_AT
  });

  assert.equal(pack.schema, 'tml.promotion-proposal-pack');
  assert.equal(pack.version, '0.1');
  assert.equal(pack.contract, TML_MAIN2_PROMOTION_PROPOSAL_CONTRACT);
  assert.equal(pack.status, TML_PROMOTION_PROPOSAL_STATUS.PROPOSAL_READY);
  assert.equal(pack.generatedAt, GENERATED_AT);
  assert.equal(pack.advisoryOnly, true);
  assert.equal(pack.executable, false);
  assert.equal(pack.automaticExecutionAllowed, false);
  assert.equal(pack.authorityChangeAllowed, false);
  assert.equal(pack.runtimeEffect, 'NONE');
  assert.equal(pack.persistenceEffect, 'NONE');
  assert.deepEqual(pack.authority, {
    current: 'legacy-main2',
    proposedCandidate: 'tml-main2',
    currentRemainsAuthoritative: true
  });
  assert.equal(pack.nextAction, 'HUMAN_REVIEW_PROPOSAL_ONLY');
});

test('P14 proposed canary phases are 1% -> 5% -> 25% and every phase is human-gated', () => {
  const pack = buildTmlMain2PromotionProposalPack({
    attestation: validAttestation(),
    generatedAt: GENERATED_AT
  });

  assert.deepEqual(
    pack.canaryPlan.phases.map((phase) => phase.audiencePercent),
    [1, 5, 25]
  );
  assert.ok(pack.canaryPlan.phases.every((phase) =>
    phase.entryMode === 'HUMAN_APPROVAL_REQUIRED' &&
    phase.exitMode === 'HUMAN_APPROVAL_REQUIRED'
  ));
  assert.equal(pack.canaryPlan.progressionRule, 'HUMAN_APPROVAL_REQUIRED_FOR_EVERY_PHASE');
  assert.equal(pack.canaryPlan.fullRolloutIncluded, false);
  assert.equal(pack.canaryPlan.mode, 'PROPOSAL_ONLY');
});

test('P14 rollback proposal is zero-mismatch and 100% settlement-coverage strict', () => {
  const pack = buildTmlMain2PromotionProposalPack({
    attestation: validAttestation(),
    generatedAt: GENERATED_AT
  });

  const conditions = Object.fromEntries(
    pack.rollbackPlan.conditions.map((condition) => [condition.trigger, condition])
  );

  assert.equal(conditions.ANY_TRANSITION_MISMATCH.threshold, 0);
  assert.equal(conditions.ANY_REWARD_RECEIPT_MISMATCH.threshold, 0);
  assert.equal(conditions.ANY_REWARD_SETTLEMENT_MISMATCH.threshold, 0);
  assert.equal(conditions.SETTLEMENT_COVERAGE_BELOW.threshold, 1);
  assert.equal(conditions.ANY_VERIFICATION_UNKNOWN_OR_CONFLICT.threshold, 0);
  assert.equal(conditions.HUMAN_STOP_REQUESTED.threshold, null);
  assert.ok(pack.rollbackPlan.conditions.every((condition) =>
    condition.action === 'PROPOSE_ROLLBACK_TO_LEGACY'
  ));
  assert.equal(pack.rollbackPlan.targetAuthority, 'legacy-main2');
  assert.equal(pack.rollbackPlan.automaticRollbackAllowed, false);

  assert.equal(pack.observabilityPlan.requiredSettlementCoverageDuringCanary, 1);
  assert.equal(pack.observabilityPlan.mismatchBudget, 0);
});

test('P14 proposal carries the minimum observability set for later canary review', () => {
  const pack = buildTmlMain2PromotionProposalPack({
    attestation: validAttestation(),
    generatedAt: GENERATED_AT
  });

  const ids = pack.observabilityPlan.metrics.map((metric) => metric.id);
  assert.deepEqual(ids, [
    'transition-parity',
    'reward-receipt-parity',
    'reward-settlement-parity',
    'reward-settlement-coverage',
    'verification-status',
    'write-disposition',
    'rollback-events'
  ]);
  assert.ok(pack.observabilityPlan.metrics.every((metric) => metric.required === true));
  assert.equal(pack.observabilityPlan.mode, 'PROPOSAL_ONLY');
});

test('P14 pre-switch checklist is immutable and entirely UNCONFIRMED', () => {
  const pack = buildTmlMain2PromotionProposalPack({
    attestation: validAttestation(),
    generatedAt: GENERATED_AT
  });

  assert.ok(pack.preSwitchChecklist.length >= 6);
  assert.ok(pack.preSwitchChecklist.every((item) =>
    item.required === true && item.state === 'UNCONFIRMED'
  ));

  assert.throws(() => {
    pack.preSwitchChecklist[0].state = 'CONFIRMED';
  }, TypeError);
});

test('P14 rejects REJECT and NEEDS_MORE_DATA attestations', () => {
  for (const decision of ['REJECT', 'NEEDS_MORE_DATA']) {
    assert.throws(
      () => buildTmlMain2PromotionProposalPack({
        attestation: validAttestation({
          decision,
          nextAction: decision === 'REJECT'
            ? 'RETURN_TO_SHADOW_AND_INVESTIGATE'
            : 'COLLECT_MORE_EVIDENCE'
        }),
        generatedAt: GENERATED_AT
      }),
      (error) => error.code === 'ATTESTATION_DECISION_NOT_APPROVED'
    );
  }
});

test('P14 rejects tampered P13 effect and authority boundaries', () => {
  for (const attestation of [
    validAttestation({ runtimeEffect: 'WRITE' }),
    validAttestation({ persistenceEffect: 'DB' }),
    validAttestation({ advisoryOnly: false }),
    validAttestation({
      authority: {
        current: 'tml-main2',
        currentRemainsAuthoritative: false,
        authorityChangeAllowed: true
      }
    })
  ]) {
    assert.throws(
      () => buildTmlMain2PromotionProposalPack({
        attestation,
        generatedAt: GENERATED_AT
      }),
      (error) => [
        'ATTESTATION_EFFECT_BOUNDARY_INVALID',
        'ATTESTATION_AUTHORITY_BOUNDARY_INVALID'
      ].includes(error.code)
    );
  }
});

test('P14 requires valid P13 fingerprints and design-only next action', () => {
  assert.throws(
    () => buildTmlMain2PromotionProposalPack({
      attestation: validAttestation({
        evidence: {
          reviewFingerprint: 'not-sha',
          attestationFingerprint: 'b'.repeat(64)
        }
      }),
      generatedAt: GENERATED_AT
    }),
    (error) => error.code === 'ATTESTATION_FINGERPRINT_INVALID'
  );

  assert.throws(
    () => buildTmlMain2PromotionProposalPack({
      attestation: validAttestation({
        nextAction: 'PROMOTE_NOW'
      }),
      generatedAt: GENERATED_AT
    }),
    (error) => error.code === 'ATTESTATION_NEXT_ACTION_INVALID'
  );
});

test('P14 source attestation evidence is copied without creating a new human decision', () => {
  const attestation = validAttestation();
  const pack = buildTmlMain2PromotionProposalPack({
    attestation,
    generatedAt: GENERATED_AT
  });

  assert.deepEqual(pack.sourceAttestation, {
    id: attestation.id,
    reviewedAt: attestation.reviewedAt,
    reviewerRef: attestation.reviewerRef,
    decision: attestation.decision,
    reviewFingerprint: attestation.evidence.reviewFingerprint,
    attestationFingerprint: attestation.evidence.attestationFingerprint
  });
  assert.equal('decision' in pack && pack.decision !== undefined, false);
});

test('P14 module has no execution, persistence, network or authority-switch integration', () => {
  const source = readFileSync(new URL('../tml/runtime/promotion-proposal-pack.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /send\s*\(|postMessage|WebSocket|BroadcastChannel/i);
  assert.doesNotMatch(source, /setAuthority|promote\s*\(|activate\s*\(|setQuestEnabled/i);
  assert.doesNotMatch(main, /promotion-proposal-pack|PROPOSAL_READY|canary-1-percent/);
  assert.doesNotMatch(runtime, /promotion-proposal-pack|PROPOSAL_READY|canary-1-percent/);
});
