import { QUEST_ID, QUEST_OBJECTIVES } from '../../npc-factory/quest-contract.mjs';
import { MAIN2_QUEST_ID, MAIN2_QUEST_OBJECTIVES } from '../../npc-factory/main2-quest-contract.mjs';

export const QUEST_TYPE = Object.freeze({
  MAIN: 'MAIN',
  SIDE: 'SIDE'
});

export const QUEST_STATE = Object.freeze({
  LOCKED: 'LOCKED',
  AVAILABLE: 'AVAILABLE',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CLAIMED: 'CLAIMED',
  EXPIRED: 'EXPIRED',
  COOLDOWN: 'COOLDOWN'
});

export const QUEST_ID_MAIN_FIRST_CAMPUS = 'quest.main.first_campus';
export const QUEST_ID_MAIN_NAVIGATION_INTRO = 'quest.main.navigation_intro';
export const QUEST_CAMPAIGN_ONBOARDING = 'campaign.onboarding';

function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    tags: Object.freeze([...definition.tags]),
    requirements: Object.freeze(definition.requirements.map(requirement => Object.freeze({ ...requirement }))),
    objectives: Object.freeze(definition.objectives.map(objective => Object.freeze({ ...objective }))),
    rewardRefs: Object.freeze([...definition.rewardRefs])
  });
}

const DEFINITIONS = Object.freeze([
  freezeDefinition({
    questId: QUEST_ID_MAIN_FIRST_CAMPUS,
    legacyProgressId: QUEST_ID,
    type: QUEST_TYPE.MAIN,
    campaignId: QUEST_CAMPAIGN_ONBOARDING,
    sequence: 1,
    title: '첫 캠퍼스 탐방',
    description: '정문에서 출발해 본관과 인경호를 둘러보고 다시 정문으로 돌아옵니다.',
    tags: ['TUTORIAL', 'EXPLORATION'],
    requirements: [],
    objectives: [
      { id: 'talk_nanayul_start', type: 'TALK', text: QUEST_OBJECTIVES[0], navigationTarget: 'poi.main-gate' },
      { id: 'visit_main_hall', type: 'VISIT', text: QUEST_OBJECTIVES[1], navigationTarget: 'poi.main-hall' },
      { id: 'visit_inkyung', type: 'VISIT', text: QUEST_OBJECTIVES[2], navigationTarget: 'poi.inkyung-pond' },
      { id: 'talk_gayudam', type: 'TALK', text: QUEST_OBJECTIVES[3], navigationTarget: 'poi.inkyung-pond' },
      { id: 'talk_nanayul_return', type: 'TALK', text: QUEST_OBJECTIVES[4], navigationTarget: 'poi.main-gate' }
    ],
    rewardRefs: ['reward.quest.first_campus'],
    repeatPolicy: 'ONCE'
  }),
  freezeDefinition({
    questId: QUEST_ID_MAIN_NAVIGATION_INTRO,
    legacyProgressId: MAIN2_QUEST_ID,
    type: QUEST_TYPE.MAIN,
    campaignId: QUEST_CAMPAIGN_ONBOARDING,
    sequence: 2,
    title: '길찾기 익히기',
    description: '지도의 목적지 설정과 자동이동을 연습하고 후문으로 돌아옵니다.',
    tags: ['TUTORIAL', 'NAVIGATION'],
    requirements: [
      { type: 'QUEST_COMPLETED', questId: QUEST_ID_MAIN_FIRST_CAMPUS }
    ],
    objectives: [
      { id: 'talk_back_gate_guide', type: 'TALK', text: MAIN2_QUEST_OBJECTIVES[0], navigationTarget: 'poi.back-gate' },
      { id: 'set_building5_destination', type: 'INTERACT', text: MAIN2_QUEST_OBJECTIVES[1], navigationTarget: 'poi.building-5' },
      { id: 'start_auto_building5', type: 'INTERACT', text: MAIN2_QUEST_OBJECTIVES[2], navigationTarget: 'poi.building-5' },
      { id: 'pause_auto_building5', type: 'INTERACT', text: MAIN2_QUEST_OBJECTIVES[3], navigationTarget: 'poi.building-5' },
      { id: 'resume_auto_building5', type: 'INTERACT', text: MAIN2_QUEST_OBJECTIVES[4], navigationTarget: 'poi.building-5' },
      { id: 'visit_building5', type: 'VISIT', text: MAIN2_QUEST_OBJECTIVES[5], navigationTarget: 'poi.building-5' },
      { id: 'set_back_gate_destination', type: 'INTERACT', text: MAIN2_QUEST_OBJECTIVES[6], navigationTarget: 'poi.back-gate' },
      { id: 'start_auto_back_gate', type: 'INTERACT', text: MAIN2_QUEST_OBJECTIVES[7], navigationTarget: 'poi.back-gate' },
      { id: 'visit_back_gate', type: 'VISIT', text: MAIN2_QUEST_OBJECTIVES[8], navigationTarget: 'poi.back-gate' }
    ],
    rewardRefs: ['reward.quest.navigation_intro'],
    repeatPolicy: 'ONCE'
  })
]);

const BY_ID = new Map(DEFINITIONS.map(definition => [definition.questId, definition]));
const BY_LEGACY_ID = new Map(DEFINITIONS.map(definition => [definition.legacyProgressId, definition]));

export function getQuestDefinition(questId) {
  return BY_ID.get(questId) ?? null;
}

export function getQuestDefinitionByLegacyId(legacyProgressId) {
  return BY_LEGACY_ID.get(legacyProgressId) ?? null;
}

export function listQuestDefinitions({ type = null, campaignId = null } = {}) {
  return DEFINITIONS.filter(definition =>
    (type == null || definition.type === type) &&
    (campaignId == null || definition.campaignId === campaignId)
  );
}

export const QUEST_DEFINITIONS = DEFINITIONS;
