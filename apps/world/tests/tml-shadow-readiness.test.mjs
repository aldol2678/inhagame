import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TML_MAIN2_SHADOW_TRANSITIONS } from '../tml/runtime/main2-shadow-contract.mjs';
import { createTmlMain2Shadow } from '../tml/runtime/main2-shadow.mjs';
import {
  DEFAULT_TML_MAIN2_READINESS_THRESHOLDS,
  evaluateTmlMain2ShadowReadiness,
  TML_SHADOW_READINESS_STATUS
} from '../tml/runtime/shadow-readiness.mjs';

const TRANSITION_IDS = TML_MAIN2_SHADOW_TRANSITIONS.map((item) => item.transitionId);

function transitionBuckets({ observed = 10, mismatches = 0, overrides = {} } = {}) {
  return Object.fromEntries(TRANSITION_IDS.map((transitionId) => {
    const bucket = overrides[transitionId] ?? {};
    const count = bucket.observed ?? observed;
    const bad = bucket.mismatches ?? mismatches;
    const good = Math.max(0, count - bad);
    return [
      transitionId,
      {
        observed: count,
        matches: good,
        mismatches: bad,
        parityRatio: count > 0 ? good / count : null
      }
    ];
  }));
}

function perfectParity(overrides = {}) {
  return {
    transition: {
      observed: 90,
      matches: 90,
      mismatches: 0,
      parityRatio: 1,
      byTransition: transitionBuckets()
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
    scopeResets: 2,
    reasons: {},
    recentMismatches: [],
    ...overrides
  };
}

test('P11 default thresholds are conservative and advisory-only', () => {
  assert.deepEqual(DEFAULT_TML_MAIN2_READINESS_THRESHOLDS, {
    minResolvedSamples: 100,
    minTransitionSamples: 5,
    minRewardReceiptSamples: 5,
    minRewardSettlementSamples: 5,
    minSettlementCoverageRatio: 0.95,
    maxMismatches: 0
  });

  const result = evaluateTmlMain2ShadowReadiness({ parity: perfectParity() });

  assert.equal(result.status, TML_SHADOW_READINESS_STATUS.READY_CANDIDATE);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.authorityChangeAllowed, false);
  assert.deepEqual(result.dataGaps, []);
  assert.deepEqual(result.reviewReasons, []);
});

test('P11 empty or early shadow data is NOT_ENOUGH_DATA', () => {
  const result = evaluateTmlMain2ShadowReadiness({
    parity: {
      transition: { byTransition: {} },
      rewardReceipt: {},
      rewardSettlement: {},
      combined: {}
    }
  });

  assert.equal(result.status, TML_SHADOW_READINESS_STATUS.NOT_ENOUGH_DATA);
  assert.equal(result.authorityChangeAllowed, false);
  assert.ok(result.dataGaps.some((item) => item.code === 'RESOLVED_SAMPLES_BELOW_MINIMUM'));
  assert.equal(
    result.dataGaps.filter((item) => item.code === 'TRANSITION_SAMPLES_BELOW_MINIMUM').length,
    TRANSITION_IDS.length
  );
  assert.ok(result.dataGaps.some((item) => item.code === 'REWARD_RECEIPT_SAMPLES_BELOW_MINIMUM'));
  assert.ok(result.dataGaps.some((item) => item.code === 'REWARD_SETTLEMENT_SAMPLES_BELOW_MINIMUM'));
});

test('P11 aggregate volume cannot hide an under-sampled transition', () => {
  const sparseTransition = TRANSITION_IDS[4];
  const parity = perfectParity({
    transition: {
      observed: 180,
      matches: 180,
      mismatches: 0,
      parityRatio: 1,
      byTransition: transitionBuckets({
        observed: 20,
        overrides: {
          [sparseTransition]: { observed: 2, mismatches: 0 }
        }
      })
    },
    combined: {
      resolved: 200,
      matches: 200,
      mismatches: 0,
      parityRatio: 1,
      unresolved: 0
    }
  });

  const result = evaluateTmlMain2ShadowReadiness({ parity });

  assert.equal(result.status, TML_SHADOW_READINESS_STATUS.NOT_ENOUGH_DATA);
  const gap = result.dataGaps.find((item) =>
    item.code === 'TRANSITION_SAMPLES_BELOW_MINIMUM' &&
    item.detail === sparseTransition
  );
  assert.deepEqual(gap, {
    code: 'TRANSITION_SAMPLES_BELOW_MINIMUM',
    actual: 2,
    required: 5,
    detail: sparseTransition
  });
});

test('P11 sufficient samples with any mismatch require REVIEW', () => {
  const parity = perfectParity({
    transition: {
      observed: 90,
      matches: 89,
      mismatches: 1,
      parityRatio: 89 / 90,
      byTransition: transitionBuckets({
        overrides: {
          [TRANSITION_IDS[3]]: { observed: 10, mismatches: 1 }
        }
      })
    },
    combined: {
      resolved: 110,
      matches: 109,
      mismatches: 1,
      parityRatio: 109 / 110,
      unresolved: 0
    }
  });

  const result = evaluateTmlMain2ShadowReadiness({ parity });

  assert.equal(result.status, TML_SHADOW_READINESS_STATUS.REVIEW);
  assert.equal(result.dataGaps.length, 0);
  assert.ok(result.reviewReasons.some((item) => item.code === 'COMBINED_MISMATCHES_EXCEED_LIMIT'));
  assert.equal(result.authorityChangeAllowed, false);
});

test('P11 sufficient samples with weak settlement coverage require REVIEW', () => {
  const parity = perfectParity({
    rewardSettlement: {
      observed: 10,
      matches: 9,
      mismatches: 0,
      pending: 0,
      unknown: 1,
      parityRatio: 1,
      coverageRatio: 0.9
    },
    combined: {
      resolved: 109,
      matches: 109,
      mismatches: 0,
      parityRatio: 1,
      unresolved: 1
    }
  });

  const result = evaluateTmlMain2ShadowReadiness({ parity });

  assert.equal(result.status, TML_SHADOW_READINESS_STATUS.REVIEW);
  const coverageIssue = result.reviewReasons.find(
    (item) => item.code === 'SETTLEMENT_COVERAGE_BELOW_MINIMUM'
  );
  assert.deepEqual(coverageIssue, {
    code: 'SETTLEMENT_COVERAGE_BELOW_MINIMUM',
    actual: 0.9,
    required: 0.95,
    detail: null
  });
});

test('P11 custom thresholds support small QA runs without changing production defaults', () => {
  const tiny = perfectParity({
    transition: {
      observed: 9,
      matches: 9,
      mismatches: 0,
      parityRatio: 1,
      byTransition: transitionBuckets({ observed: 1 })
    },
    rewardReceipt: {
      observed: 1,
      matches: 1,
      mismatches: 0,
      parityRatio: 1
    },
    rewardSettlement: {
      observed: 1,
      matches: 1,
      mismatches: 0,
      pending: 0,
      unknown: 0,
      parityRatio: 1,
      coverageRatio: 1
    },
    combined: {
      resolved: 11,
      matches: 11,
      mismatches: 0,
      parityRatio: 1,
      unresolved: 0
    }
  });

  const defaultResult = evaluateTmlMain2ShadowReadiness({ parity: tiny });
  assert.equal(defaultResult.status, TML_SHADOW_READINESS_STATUS.NOT_ENOUGH_DATA);

  const qaResult = evaluateTmlMain2ShadowReadiness({
    parity: tiny,
    thresholds: {
      minResolvedSamples: 11,
      minTransitionSamples: 1,
      minRewardReceiptSamples: 1,
      minRewardSettlementSamples: 1,
      minSettlementCoverageRatio: 1,
      maxMismatches: 0
    }
  });

  assert.equal(qaResult.status, TML_SHADOW_READINESS_STATUS.READY_CANDIDATE);
  assert.equal(qaResult.authorityChangeAllowed, false);
});

test('P11 shadow status exposes readiness but has no promotion or authority-switch API', () => {
  const shadow = createTmlMain2Shadow({
    enabled: true,
    readinessThresholds: {
      minResolvedSamples: 0,
      minTransitionSamples: 0,
      minRewardReceiptSamples: 0,
      minRewardSettlementSamples: 0,
      minSettlementCoverageRatio: 0,
      maxMismatches: 0
    }
  });

  const status = shadow.status();

  assert.ok(status.readiness);
  assert.equal(status.readiness.advisoryOnly, true);
  assert.equal(status.readiness.authorityChangeAllowed, false);
  assert.equal('promote' in shadow, false);
  assert.equal('activate' in shadow, false);
  assert.equal('setAuthority' in shadow, false);
});


test('P11 readiness is not consumed by the live execution path', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');

  for (const source of [main, runtime]) {
    assert.doesNotMatch(source, /readiness\s*\.\s*status/);
    assert.doesNotMatch(source, /READY_CANDIDATE/);
    assert.doesNotMatch(source, /authorityChangeAllowed/);
    assert.doesNotMatch(source, /promoteTml|activateTml|setTmlAuthority/i);
  }
});
