// Review-only candidate. These values are not production economy policy.
export const INCOME_CANDIDATE_POLICY = Object.freeze({
  version: 1, status: 'CLOSED', currency: 'coin', dailyCap: 60,
  accountingTimeZone: 'Asia/Seoul', periodPolicy: 'START_DATE_RESERVED',
  perDefinitionLimit: 1, balanceValidated: false
});
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const INCOME_QUEST_CANDIDATES = freeze([
  {
    questId: 'quest.side.taerin_carp', type: 'SIDE', campaignId: 'campaign.income_candidate',
    sequence: 1, title: '가태린의 작은 요리 준비',
    description: '가태린에게 보유한 잉어 1개만 납품하는 제한 의뢰 후보입니다.',
    giverId: 'INKYUNG-NPC-013', kind: 'DELIVERY', status: 'CLOSED', candidate: true,
    tags: ['NPC_SIDE', 'LIMITED_DELIVERY', 'CANDIDATE'],
    requirements: [{ type: 'SERVER_INCOME_AVAILABILITY' }, { type: 'OWNED_ITEM', itemId: 'material.fish_carp', quantity: 1 }],
    objectives: [{ id: 'deliver_carp', type: 'DELIVER', text: '잉어 1개 납품', itemId: 'material.fish_carp', quantity: 1 }],
    rewardRefs: ['reward.income.taerin_carp'], repeatPolicy: 'BOUNDED_SERVER_PERIOD',
    candidateCoin: 20, locationLabel: '가태린 · 의뢰 연결 준비 중', npcLabel: '가태린',
    acquisition: { itemId: 'material.fish_carp', source: 'FISHING_F2', runtimeReady: false,
      blocker: 'F3 trusted-position producer/exposure requires separate verification; PR199 experiment is not current F2.' },
    selectionRationale: '설계 제안: 생명과학과·관대한 성향·요리 관심을 작은 재료 나눔으로 표현. 실제 요리 기능 사용이나 학과별 필수 과제로 간주하지 않음.'
  },
  {
    questId: 'quest.side.convenience_help', type: 'SIDE', campaignId: 'campaign.income_candidate',
    sequence: 2, title: '편의점 짧은 근무', description: '진열·계산·정리의 서버 검증을 마친 뒤 급여를 받는 근무 후보입니다.',
    giverId: 'BACKGATE-NPC-001', kind: 'SHIFT', status: 'CLOSED', candidate: true,
    tags: ['NPC_SIDE', 'SHORT_SHIFT', 'CANDIDATE'], requirements: [{ type: 'SERVER_INCOME_AVAILABILITY' }],
    objectives: [{ id: 'stock', type: 'WORK', text: '상품 진열' }, { id: 'checkout', type: 'WORK', text: '계산 확인' }, { id: 'tidy', type: 'WORK', text: '마무리 정리' }],
    rewardRefs: ['reward.income.convenience_help'], repeatPolicy: 'BOUNDED_SERVER_PERIOD', candidateCoin: 30,
    locationLabel: '후문 back_street_4 편의점', npcLabel: '도유진 · 가상 고용주',
    acquisition: null, selectionRationale: '별도 authored 고용주 후보. 003 기념품점·012 패션점의 역할이나 생성형 NPC 권한을 변경하지 않음.'
  }
]);
export function getIncomeQuestCandidate(questId) {
  return INCOME_QUEST_CANDIDATES.find(quest => quest.questId === questId) ?? null;
}
// Exact authored binding, independent of can_start_quest=false generated-NPC constraints.
// CLOSED previews are opt-in and never constitute permission to start a quest.
export function getNpcIncomeQuestCandidates(giverId, { includeClosed = false } = {}) {
  if (!includeClosed) return [];
  return INCOME_QUEST_CANDIDATES.filter(quest => quest.giverId === giverId);
}
