import { TML_MAIN2_SHADOW_MODE, TML_MAIN2_SHADOW_REWARD, TML_MAIN2_SHADOW_TRANSITIONS } from './main2-shadow-contract.mjs';
import { TML_SHADOW_READINESS_STATUS } from './shadow-readiness.mjs';

export const TML_HUMAN_PROMOTION_GATE_STATUS = Object.freeze({
  BLOCKED: 'BLOCKED',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED'
});

export const TML_MAIN2_PROMOTION_GATE_CONTRACT = 'main2-shadow-human-review@p12';

const HUMAN_CHECKLIST = Object.freeze([
  Object.freeze({
    id: 'review-transition-parity',
    title: '전이별 parity 표본을 사람이 검토한다',
    required: true,
    state: 'UNCONFIRMED'
  }),
  Object.freeze({
    id: 'review-mismatch-history',
    title: '최근 mismatch 이력과 reason 카운터를 사람이 검토한다',
    required: true,
    state: 'UNCONFIRMED'
  }),
  Object.freeze({
    id: 'review-reward-settlement',
    title: 'Reward receipt / Wallet / EXP settlement coverage를 사람이 검토한다',
    required: true,
    state: 'UNCONFIRMED'
  }),
  Object.freeze({
    id: 'review-rollout-and-rollback',
    title: '향후 rollout 및 rollback 계획을 사람이 별도로 승인한다',
    required: true,
    state: 'UNCONFIRMED'
  }),
  Object.freeze({
    id: 'confirm-authority-boundary',
    title: '현재 실행 권한이 legacy Main 2에 유지됨을 확인한다',
    required: true,
    state: 'UNCONFIRMED'
  })
]);

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

function check(id, title, passed, detail = null) {
  return Object.freeze({
    id,
    title,
    passed: Boolean(passed),
    detail: freezeCopy(detail)
  });
}

function isoTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('generatedAt must be an ISO-compatible timestamp');
  }
  return value;
}

export function buildTmlMain2HumanPromotionReview({
  shadowStatus,
  generatedAt = new Date().toISOString()
} = {}) {
  isoTime(generatedAt);

  if (!shadowStatus || typeof shadowStatus !== 'object') {
    throw new TypeError('human promotion review requires shadowStatus');
  }

  const readiness = shadowStatus.readiness ?? null;
  const parity = shadowStatus.parity ?? null;
  const recentMismatches = Array.isArray(parity?.recentMismatches)
    ? parity.recentMismatches
    : [];

  const machineChecks = [
    check(
      'shadow-mode-active',
      'Shadow Mode가 활성 상태다',
      shadowStatus.enabled === true && shadowStatus.mode === TML_MAIN2_SHADOW_MODE,
      { mode: shadowStatus.mode ?? null, enabled: shadowStatus.enabled === true }
    ),
    check(
      'readiness-candidate',
      'P11 readiness가 READY_CANDIDATE다',
      readiness?.status === TML_SHADOW_READINESS_STATUS.READY_CANDIDATE,
      {
        status: readiness?.status ?? null,
        dataGaps: readiness?.dataGaps ?? [],
        reviewReasons: readiness?.reviewReasons ?? []
      }
    ),
    check(
      'advisory-only',
      'P11 결과가 advisory-only이며 권한 변경을 허용하지 않는다',
      readiness?.advisoryOnly === true && readiness?.authorityChangeAllowed === false,
      {
        advisoryOnly: readiness?.advisoryOnly ?? null,
        authorityChangeAllowed: readiness?.authorityChangeAllowed ?? null
      }
    ),
    check(
      'no-pending-settlement',
      '진행 중인 Reward settlement가 없다',
      shadowStatus.pendingReward === false,
      { pendingReward: shadowStatus.pendingReward === true }
    ),
    check(
      'no-recent-mismatch',
      '최근 mismatch 샘플이 비어 있다',
      recentMismatches.length === 0,
      { recentMismatchCount: recentMismatches.length }
    ),
    check(
      'zero-resolved-mismatch',
      '누적 resolved mismatch가 0이다',
      (parity?.combined?.mismatches ?? null) === 0,
      { mismatches: parity?.combined?.mismatches ?? null }
    ),
    check(
      'settlement-coverage-meets-readiness',
      'settlement coverage가 readiness 기준을 충족한다',
      typeof parity?.rewardSettlement?.coverageRatio === 'number' &&
        typeof readiness?.thresholds?.minSettlementCoverageRatio === 'number' &&
        parity.rewardSettlement.coverageRatio >= readiness.thresholds.minSettlementCoverageRatio,
      {
        actual: parity?.rewardSettlement?.coverageRatio ?? null,
        required: readiness?.thresholds?.minSettlementCoverageRatio ?? null
      }
    )
  ];

  const failedMachineChecks = machineChecks.filter((item) => !item.passed);
  const status = failedMachineChecks.length === 0
    ? TML_HUMAN_PROMOTION_GATE_STATUS.HUMAN_REVIEW_REQUIRED
    : TML_HUMAN_PROMOTION_GATE_STATUS.BLOCKED;

  return Object.freeze({
    schema: 'tml.human-promotion-review',
    version: '0.1',
    contract: TML_MAIN2_PROMOTION_GATE_CONTRACT,
    generatedAt,
    status,
    advisoryOnly: true,
    authorityChangeAllowed: false,
    authority: Object.freeze({
      current: 'legacy-main2',
      candidate: 'tml-main2',
      currentRemainsAuthoritative: true
    }),
    contracts: Object.freeze({
      shadowMode: TML_MAIN2_SHADOW_MODE,
      rewardSpecId: TML_MAIN2_SHADOW_REWARD.specId,
      transitionIds: Object.freeze(
        TML_MAIN2_SHADOW_TRANSITIONS.map((item) => item.transitionId)
      )
    }),
    machineChecks: Object.freeze(machineChecks),
    failedMachineChecks: Object.freeze(failedMachineChecks),
    humanChecklist: HUMAN_CHECKLIST,
    evidence: freezeCopy({
      readiness,
      parity: {
        transition: parity?.transition ?? null,
        rewardReceipt: parity?.rewardReceipt ?? null,
        rewardSettlement: parity?.rewardSettlement ?? null,
        combined: parity?.combined ?? null,
        statusObservations: parity?.statusObservations ?? 0,
        scopeResets: parity?.scopeResets ?? 0,
        reasons: parity?.reasons ?? {},
        recentMismatches
      }
    }),
    nextAction: status === TML_HUMAN_PROMOTION_GATE_STATUS.HUMAN_REVIEW_REQUIRED
      ? 'HUMAN_REVIEW_ONLY'
      : 'COLLECT_OR_REVIEW_MORE_EVIDENCE'
  });
}
