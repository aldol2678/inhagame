import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUEST_CAMPAIGN_ONBOARDING,
  QUEST_ID_MAIN_FIRST_CAMPUS,
  QUEST_ID_MAIN_NAVIGATION_INTRO,
  QUEST_ID_MAIN_FIRST_STYLE,
  QUEST_STATE,
  QUEST_TYPE,
  getQuestDefinition,
  getQuestDefinitionByLegacyId,
  listQuestDefinitions
} from '../src/quest/quest-registry.js';
import {
  adaptLegacyQuestStatus,
  adaptMain1QuestStatus,
  adaptMain2QuestStatus
} from '../src/quest/legacy-quest-adapters.js';

test('quest registry exposes Main 01, Main 02 and Main 03 as one onboarding campaign', () => {
  const definitions = listQuestDefinitions({
    type: QUEST_TYPE.MAIN,
    campaignId: QUEST_CAMPAIGN_ONBOARDING
  });

  assert.deepEqual(definitions.map(definition => definition.questId), [
    QUEST_ID_MAIN_FIRST_CAMPUS,
    QUEST_ID_MAIN_NAVIGATION_INTRO,
    QUEST_ID_MAIN_FIRST_STYLE
  ]);
  assert.deepEqual(definitions.map(definition => definition.sequence), [1, 2, 3]);
  assert.equal(getQuestDefinitionByLegacyId('campus_first_walk_v1')?.questId, QUEST_ID_MAIN_FIRST_CAMPUS);
  assert.equal(getQuestDefinitionByLegacyId('campus_navigation_intro_v1')?.questId, QUEST_ID_MAIN_NAVIGATION_INTRO);
});

test('registry keeps navigation on canonical POI ids instead of authored coordinates', () => {
  const main1 = getQuestDefinition(QUEST_ID_MAIN_FIRST_CAMPUS);
  const main2 = getQuestDefinition(QUEST_ID_MAIN_NAVIGATION_INTRO);

  assert.equal(main1.objectives[1].navigationTarget, 'poi.main-hall');
  assert.equal(main1.objectives[2].navigationTarget, 'poi.inkyung-pond');
  assert.equal(main2.objectives[1].navigationTarget, 'poi.building-5');
  assert.equal(main2.objectives[8].navigationTarget, 'poi.back-gate');

  for (const definition of [main1, main2]) {
    for (const objective of definition.objectives) {
      assert.equal('x' in objective, false);
      assert.equal('z' in objective, false);
    }
  }
});

test('Main 01 legacy stages adapt to AVAILABLE, ACTIVE and COMPLETED', () => {
  const available = adaptMain1QuestStatus({ quest_id: 'campus_first_walk_v1', stage: 0 });
  assert.equal(available.state, QUEST_STATE.AVAILABLE);
  assert.equal(available.currentObjective.id, 'talk_nanayul_start');
  assert.deepEqual(available.progress, { completed: 0, total: 5 });

  const active = adaptMain1QuestStatus({ quest_id: 'campus_first_walk_v1', stage: 2 }, {
    trackedQuestId: QUEST_ID_MAIN_FIRST_CAMPUS
  });
  assert.equal(active.state, QUEST_STATE.ACTIVE);
  assert.equal(active.currentObjective.id, 'visit_inkyung');
  assert.equal(active.tracked, true);
  assert.deepEqual(active.progress, { completed: 2, total: 5 });

  const completed = adaptMain1QuestStatus({ quest_id: 'campus_first_walk_v1', stage: 5 });
  assert.equal(completed.state, QUEST_STATE.COMPLETED);
  assert.equal(completed.currentObjective, null);
  assert.deepEqual(completed.progress, { completed: 5, total: 5 });
});

test('Main 02 remains locked until Main 01 is complete, then maps its persisted stage', () => {
  const locked = adaptMain2QuestStatus({
    quest_id: 'campus_navigation_intro_v1',
    stage: 0,
    available: false
  });
  assert.equal(locked.state, QUEST_STATE.LOCKED);
  assert.equal(locked.currentObjective, null);

  const available = adaptMain2QuestStatus({
    quest_id: 'campus_navigation_intro_v1',
    stage: 0,
    available: true
  });
  assert.equal(available.state, QUEST_STATE.AVAILABLE);
  assert.equal(available.currentObjective.id, 'talk_back_gate_guide');

  const active = adaptMain2QuestStatus({
    quest_id: 'campus_navigation_intro_v1',
    stage: 5,
    available: true
  });
  assert.equal(active.state, QUEST_STATE.ACTIVE);
  assert.equal(active.currentObjective.id, 'visit_building5');
  assert.equal(active.currentObjective.navigationTarget, 'poi.building-5');
  assert.deepEqual(active.progress, { completed: 5, total: 9 });

  const completed = adaptMain2QuestStatus({
    quest_id: 'campus_navigation_intro_v1',
    stage: 9,
    available: true
  });
  assert.equal(completed.state, QUEST_STATE.COMPLETED);
  assert.deepEqual(completed.progress, { completed: 9, total: 9 });
});

test('generic legacy adapter rejects unknown quest ids and preserves tracking', () => {
  assert.equal(adaptLegacyQuestStatus({ quest_id: 'unknown', stage: 1 }), null);

  const main2 = adaptLegacyQuestStatus({
    quest_id: 'campus_navigation_intro_v1',
    stage: 1,
    available: true
  }, {
    trackedQuestId: QUEST_ID_MAIN_NAVIGATION_INTRO
  });
  assert.equal(main2.questId, QUEST_ID_MAIN_NAVIGATION_INTRO);
  assert.equal(main2.tracked, true);
  assert.equal(main2.currentObjective.id, 'set_building5_destination');
});

test('registry definitions are immutable at the nested contract level', () => {
  const definition = getQuestDefinition(QUEST_ID_MAIN_FIRST_CAMPUS);
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(Object.isFrozen(definition.objectives), true);
  assert.equal(Object.isFrozen(definition.objectives[0]), true);
  assert.equal(Object.isFrozen(definition.requirements), true);
  assert.equal(Object.isFrozen(definition.rewardRefs), true);
});
