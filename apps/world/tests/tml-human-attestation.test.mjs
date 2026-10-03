import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createTmlMain2HumanAttestation,
  TML_HUMAN_ATTESTATION_DECISION,
  TML_MAIN2_ATTESTATION_CONTRACT
} from '../tml/runtime/human-attestation.mjs';
import {
  buildTmlMain2HumanPromotionReview,
  TML_HUMAN_PROMOTION_GATE_STATUS
} from '../tml/runtime/human-promotion-gate.mjs';
import { TML_MAIN2_SHADOW_TRANSITIONS } from '../tml/runtime/main2-shadow-contract.mjs';

const GENERATED_AT = '2026-10-03T13:20:00+09:00';
const REVIEWED_AT = '2026-10-03T13:25:00+09:00';

const TRANSITION_IDS = TML_MAIN2_SHADOW_TRANSITIONS.map((item) => item.transitionId);

function transitionCoverage() {
  return Object.fromEntries(TRANSITION_IDS.map((id) => [
    id,
    { observed: 10, mismatches: 0, parityRatio: 1 }
  ]));
}

function readyShadowStatus() {
  return {
    mode: 'SHADOW_P9',
    enabled: true,
    pendingReward: false,
    parity: {
      transition: {
        observed: 90,
        matches: 90,
        mismatches: 0,
        parityRatio: 1,
        byTransition: Object.fromEntries(
          TRANSITION_IDS.map((id) => [id, { observed: 10, matches: 10, mismatches: 0, parityRatio: 1 }])
        )
      },
      rewardReceipt: {
        observed: 10,
        matches: 10,
        mismatches: 0,
        parityRatio: 1
      },
      rewardSettlement: {
        observed: 10,
        matches: 10,
        mismatches: 0,
        pending: 0,
        unknown: 0,
        parityRatio: 1,
        coverageRatio: 1
      },
      combined: {
        resolved: 110,
        matches: 110,
        mismatches: 0,
        parityRatio: 1,
        unresolved: 0
      },
      statusObservations: 12,
      scopeResets: 1,
      reasons: {
        TML_TRANSITION_MATCH: 90,
        REWARD_RECEIPT_MATCH: 10,
        TML_SETTLEMENT_MATCH: 10
      },
      recentMismatches: []
    },
    readiness: {
      status: 'READY_CANDIDATE',
      advisoryOnly: true,
      authorityChangeAllowed: false,
      thresholds: {
        minResolvedSamples: 100,
        minTransitionSamples: 5,
        minRewardReceiptSamples: 5,
        minRewardSettlementSamples: 5,
        minSettlementCoverageRatio: 0.95,
        maxMismatches: 0
      },
      transitionIds: TRANSITION_IDS,
      dataGaps: [],
      reviewReasons: [],
      evidence: {
        combinedResolved: 110,
        combinedMatches: 110,
        combinedMismatches: 0,
        combinedUnresolved: 0,
        receiptObserved: 10,
        receiptMismatches: 0,
        settlementObserved: 10,
        settlementMismatches: 0,
        settlementPending: 0,
        settlementUnknown: 0,
        settlementCoverageRatio: 1,
        transitionCoverage: transitionCoverage()
      }
    }
  };
}

function reviewPacket() {
  return buildTmlMain2HumanPromotionReview({
    shadowStatus: readyShadowStatus(),
    generatedAt: GENERATED_AT
  });
}

function confirmations(review) {
  return review.humanChecklist.map((item) => ({ id: item.id, confirmed: true }));
}

test('P13 creates an immutable human attestation only from a HUMAN_REVIEW_REQUIRED packet', async () => {
  const review = reviewPacket();
  assert.equal(review.status, TML_HUMAN_PROMOTION_GATE_STATUS.HUMAN_REVIEW_REQUIRED);

  const record = await createTmlMain2HumanAttestation({
    reviewPacket: review,
    reviewerRef: 'human:release-reviewer',
    decision: TML_HUMAN_ATTESTATION_DECISION.APPROVE_FOR_NEXT_STAGE,
    reviewedAt: REVIEWED_AT,
    checklistConfirmations: confirmations(review),
    note: 'Proceed to design-only next stage.'
  });

  assert.equal(record.schema, 'tml.human-attestation');
  assert.equal(record.version, '0.1');
  assert.equal(record.contract, TML_MAIN2_ATTESTATION_CONTRACT);
  assert.match(record.id, /^attestation\.main2\.[0-9a-f]{24}$/);
  assert.equal(record.reviewedAt, REVIEWED_AT);
  assert.equal(record.reviewerRef, 'human:release-reviewer');
  assert.equal(record.decision, 'APPROVE_FOR_NEXT_STAGE');
  assert.equal(record.runtimeEffect, 'NONE');
  assert.equal(record.persistenceEffect, 'NONE');
  assert.equal(record.advisoryOnly, true);
  assert.deepEqual(record.authority, {
    current: 'legacy-main2',
    currentRemainsAuthoritative: true,
    authorityChangeAllowed: false
  });
  assert.equal(record.nextAction, 'DESIGN_NEXT_STAGE_PROPOSAL_ONLY');
  assert.match(record.evidence.reviewFingerprint, /^[0-9a-f]{64}$/);
  assert.match(record.evidence.attestationFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(record.checklistConfirmations.length, review.humanChecklist.length);
  assert.ok(record.checklistConfirmations.every((item) => item.confirmed === true));

  assert.throws(() => {
    record.authority.current = 'tml-main2';
  }, TypeError);
});

test('P13 requires every required P12 checklist item to be explicitly confirmed', async () => {
  const review = reviewPacket();
  const partial = confirmations(review).slice(0, -1);

  await assert.rejects(
    () => createTmlMain2HumanAttestation({
      reviewPacket: review,
      reviewerRef: 'human:reviewer',
      decision: 'APPROVE_FOR_NEXT_STAGE',
      reviewedAt: REVIEWED_AT,
      checklistConfirmations: partial
    }),
    (error) => error.code === 'CHECKLIST_NOT_FULLY_CONFIRMED'
  );

  const negative = confirmations(review);
  negative[0] = { ...negative[0], confirmed: false };

  await assert.rejects(
    () => createTmlMain2HumanAttestation({
      reviewPacket: review,
      reviewerRef: 'human:reviewer',
      decision: 'REJECT',
      reviewedAt: REVIEWED_AT,
      checklistConfirmations: negative
    }),
    (error) => error.code === 'CHECKLIST_NOT_FULLY_CONFIRMED'
  );
});

test('P13 refuses BLOCKED P12 packets even for REJECT or NEEDS_MORE_DATA', async () => {
  const blocked = {
    ...reviewPacket(),
    status: 'BLOCKED'
  };

  for (const decision of ['REJECT', 'NEEDS_MORE_DATA']) {
    await assert.rejects(
      () => createTmlMain2HumanAttestation({
        reviewPacket: blocked,
        reviewerRef: 'human:reviewer',
        decision,
        reviewedAt: REVIEWED_AT,
        checklistConfirmations: blocked.humanChecklist.map((item) => item.id)
      }),
      (error) => error.code === 'REVIEW_PACKET_NOT_ELIGIBLE'
    );
  }
});

test('P13 supports exactly three human decisions and maps each to a non-runtime next action', async () => {
  const review = reviewPacket();
  const expected = new Map([
    ['APPROVE_FOR_NEXT_STAGE', 'DESIGN_NEXT_STAGE_PROPOSAL_ONLY'],
    ['REJECT', 'RETURN_TO_SHADOW_AND_INVESTIGATE'],
    ['NEEDS_MORE_DATA', 'COLLECT_MORE_EVIDENCE']
  ]);

  for (const [decision, nextAction] of expected) {
    const record = await createTmlMain2HumanAttestation({
      reviewPacket: review,
      reviewerRef: 'human:reviewer',
      decision,
      reviewedAt: REVIEWED_AT,
      checklistConfirmations: confirmations(review)
    });

    assert.equal(record.decision, decision);
    assert.equal(record.nextAction, nextAction);
    assert.equal(record.runtimeEffect, 'NONE');
    assert.equal(record.authority.authorityChangeAllowed, false);
  }

  await assert.rejects(
    () => createTmlMain2HumanAttestation({
      reviewPacket: review,
      reviewerRef: 'human:reviewer',
      decision: 'PROMOTE_NOW',
      reviewedAt: REVIEWED_AT,
      checklistConfirmations: confirmations(review)
    }),
    (error) => error.code === 'INVALID_ATTESTATION_DECISION'
  );
});

test('P13 evidence fingerprint is stable for the same P12 packet regardless of object key insertion order', async () => {
  const review = reviewPacket();
  const reordered = Object.fromEntries(Object.entries(review).reverse());

  const first = await createTmlMain2HumanAttestation({
    reviewPacket: review,
    reviewerRef: 'human:reviewer',
    decision: 'APPROVE_FOR_NEXT_STAGE',
    reviewedAt: REVIEWED_AT,
    checklistConfirmations: confirmations(review)
  });
  const second = await createTmlMain2HumanAttestation({
    reviewPacket: reordered,
    reviewerRef: 'human:reviewer',
    decision: 'APPROVE_FOR_NEXT_STAGE',
    reviewedAt: REVIEWED_AT,
    checklistConfirmations: confirmations(review)
  });

  assert.equal(first.evidence.reviewFingerprint, second.evidence.reviewFingerprint);
  assert.equal(first.evidence.attestationFingerprint, second.evidence.attestationFingerprint);
  assert.equal(first.id, second.id);
});

test('P13 attestation fingerprint changes when the human decision context changes', async () => {
  const review = reviewPacket();

  const approved = await createTmlMain2HumanAttestation({
    reviewPacket: review,
    reviewerRef: 'human:reviewer-a',
    decision: 'APPROVE_FOR_NEXT_STAGE',
    reviewedAt: REVIEWED_AT,
    checklistConfirmations: confirmations(review)
  });

  const rejected = await createTmlMain2HumanAttestation({
    reviewPacket: review,
    reviewerRef: 'human:reviewer-a',
    decision: 'REJECT',
    reviewedAt: REVIEWED_AT,
    checklistConfirmations: confirmations(review)
  });

  const otherReviewer = await createTmlMain2HumanAttestation({
    reviewPacket: review,
    reviewerRef: 'human:reviewer-b',
    decision: 'APPROVE_FOR_NEXT_STAGE',
    reviewedAt: REVIEWED_AT,
    checklistConfirmations: confirmations(review)
  });

  assert.equal(approved.evidence.reviewFingerprint, rejected.evidence.reviewFingerprint);
  assert.equal(approved.evidence.reviewFingerprint, otherReviewer.evidence.reviewFingerprint);
  assert.notEqual(approved.evidence.attestationFingerprint, rejected.evidence.attestationFingerprint);
  assert.notEqual(approved.evidence.attestationFingerprint, otherReviewer.evidence.attestationFingerprint);
  assert.notEqual(approved.id, rejected.id);
});

test('P13 validates reviewer, time, duplicate/unknown checklist confirmations and note length', async () => {
  const review = reviewPacket();
  const all = confirmations(review);

  await assert.rejects(
    () => createTmlMain2HumanAttestation({
      reviewPacket: review,
      reviewerRef: '   ',
      decision: 'REJECT',
      reviewedAt: REVIEWED_AT,
      checklistConfirmations: all
    }),
    (error) => error.code === 'INVALID_REVIEWER_REF'
  );

  await assert.rejects(
    () => createTmlMain2HumanAttestation({
      reviewPacket: review,
      reviewerRef: 'human:reviewer',
      decision: 'REJECT',
      reviewedAt: 'not-a-time',
      checklistConfirmations: all
    }),
    (error) => error.code === 'INVALID_REVIEWED_AT'
  );

  await assert.rejects(
    () => createTmlMain2HumanAttestation({
      reviewPacket: review,
      reviewerRef: 'human:reviewer',
      decision: 'REJECT',
      reviewedAt: REVIEWED_AT,
      checklistConfirmations: [...all, all[0]]
    }),
    (error) => error.code === 'DUPLICATE_CHECKLIST_CONFIRMATION'
  );

  await assert.rejects(
    () => createTmlMain2HumanAttestation({
      reviewPacket: review,
      reviewerRef: 'human:reviewer',
      decision: 'REJECT',
      reviewedAt: REVIEWED_AT,
      checklistConfirmations: [...all, { id: 'unknown-check', confirmed: true }]
    }),
    (error) => error.code === 'UNKNOWN_CHECKLIST_CONFIRMATION'
  );

  await assert.rejects(
    () => createTmlMain2HumanAttestation({
      reviewPacket: review,
      reviewerRef: 'human:reviewer',
      decision: 'REJECT',
      reviewedAt: REVIEWED_AT,
      checklistConfirmations: all,
      note: 'x'.repeat(1001)
    }),
    (error) => error.code === 'INVALID_ATTESTATION_NOTE'
  );
});

test('P13 module has no persistence, messaging, network or authority-switch action', () => {
  const source = readFileSync(new URL('../tml/runtime/human-attestation.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /send\s*\(|postMessage|WebSocket|BroadcastChannel/i);
  assert.doesNotMatch(source, /setAuthority|promote\s*\(|activate\s*\(|setQuestEnabled/i);
  assert.doesNotMatch(main, /human-attestation|APPROVE_FOR_NEXT_STAGE|attestationFingerprint/);
  assert.doesNotMatch(runtime, /human-attestation|APPROVE_FOR_NEXT_STAGE|attestationFingerprint/);
});
