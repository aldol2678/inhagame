import {
  QUEST_ID_MAIN_FIRST_CAMPUS,
  QUEST_ID_MAIN_NAVIGATION_INTRO,
  QUEST_STATE,
  getQuestDefinitionByLegacyId
} from './quest-registry.js';

function integerStage(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function runtimeShape(definition, {
  state,
  stage,
  trackedQuestId = null
}) {
  const totalObjectives = definition.objectives.length;
  const completedObjectives = Math.min(stage, totalObjectives);
  const currentObjective =
    state === QUEST_STATE.AVAILABLE
      ? definition.objectives[0] ?? null
      : state === QUEST_STATE.ACTIVE
        ? definition.objectives[Math.min(stage, totalObjectives - 1)] ?? null
        : null;

  return Object.freeze({
    questId: definition.questId,
    legacyProgressId: definition.legacyProgressId,
    type: definition.type,
    campaignId: definition.campaignId,
    sequence: definition.sequence,
    title: definition.title,
    description: definition.description,
    tags: definition.tags,
    rewardRefs: definition.rewardRefs,
    state,
    stage,
    currentObjective,
    progress: Object.freeze({
      completed: completedObjectives,
      total: totalObjectives
    }),
    tracked: trackedQuestId === definition.questId
  });
}

export function adaptMain1QuestStatus(raw = {}, { trackedQuestId = null } = {}) {
  const definition = getQuestDefinitionByLegacyId('campus_first_walk_v1');
  const stage = integerStage(raw.stage);
  const state =
    stage >= definition.objectives.length
      ? QUEST_STATE.COMPLETED
      : stage > 0
        ? QUEST_STATE.ACTIVE
        : QUEST_STATE.AVAILABLE;

  return runtimeShape(definition, { state, stage, trackedQuestId });
}

export function adaptMain2QuestStatus(raw = {}, {
  main1Complete = false,
  trackedQuestId = null
} = {}) {
  const definition = getQuestDefinitionByLegacyId('campus_navigation_intro_v1');
  const stage = integerStage(raw.stage);
  let state;

  if (stage >= definition.objectives.length) state = QUEST_STATE.COMPLETED;
  else if (stage > 0) state = QUEST_STATE.ACTIVE;
  else if (raw.available === true || main1Complete) state = QUEST_STATE.AVAILABLE;
  else state = QUEST_STATE.LOCKED;

  return runtimeShape(definition, { state, stage, trackedQuestId });
}

export function adaptLegacyQuestStatus(raw = {}, context = {}) {
  const definition = getQuestDefinitionByLegacyId(raw.quest_id);
  if (!definition) return null;

  if (definition.questId === QUEST_ID_MAIN_FIRST_CAMPUS)
    return adaptMain1QuestStatus(raw, context);

  if (definition.questId === QUEST_ID_MAIN_NAVIGATION_INTRO)
    return adaptMain2QuestStatus(raw, context);

  return null;
}
