import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQuestRuntime,
  QUEST_ID_MAIN_FIRST_CAMPUS,
  QUEST_ID_MAIN_NAVIGATION_INTRO,
  QUEST_STATE,
  QUEST_TYPE
} from '../src/quest/quest-runtime.js';

const main1 = (stage, extra = {}) => ({
  signedIn: true, ready: true, stage, complete: stage === 5, ...extra
});
const main2 = (stage, available, extra = {}) => ({
  signedIn: true, ready: true, stage, available, complete: stage === 9, ...extra
});

test('signed-out runtime exposes no persistent quests', () => {
  const runtime = createQuestRuntime();
  runtime.update({
    quest: { signedIn: false, ready: false, stage: 0, complete: false },
    main2Quest: { signedIn: false, ready: false, stage: 0, available: false, complete: false }
  });
  assert.equal(runtime.snapshot.signedIn, false);
  assert.deepEqual(runtime.snapshot.quests, []);
  assert.equal(runtime.tracked(), null);
});

test('runtime adapts Main 01 and locked Main 02 and tracks the active quest', () => {
  const runtime = createQuestRuntime();
  const snapshot = runtime.update({ quest: main1(2), main2Quest: main2(0, false) });

  assert.equal(snapshot.quests.length, 2);
  assert.equal(snapshot.quests[0].questId, QUEST_ID_MAIN_FIRST_CAMPUS);
  assert.equal(snapshot.quests[0].state, QUEST_STATE.ACTIVE);
  assert.equal(snapshot.quests[0].currentObjective.id, 'visit_inkyung');
  assert.equal(snapshot.quests[1].questId, QUEST_ID_MAIN_NAVIGATION_INTRO);
  assert.equal(snapshot.quests[1].state, QUEST_STATE.LOCKED);
  assert.equal(snapshot.trackedQuestId, QUEST_ID_MAIN_FIRST_CAMPUS);
  assert.equal(runtime.list(QUEST_TYPE.MAIN).length, 2);
  assert.equal(runtime.list(QUEST_TYPE.SIDE).length, 0);
});

test('completed Main 01 hands default tracking to available Main 02', () => {
  const runtime = createQuestRuntime();
  runtime.update({ quest: main1(4), main2Quest: main2(0, false) });
  assert.equal(runtime.trackedQuestId, QUEST_ID_MAIN_FIRST_CAMPUS);

  const snapshot = runtime.update({ quest: main1(5), main2Quest: main2(0, true) });
  assert.equal(snapshot.quests[0].state, QUEST_STATE.COMPLETED);
  assert.equal(snapshot.quests[1].state, QUEST_STATE.AVAILABLE);
  assert.equal(snapshot.trackedQuestId, QUEST_ID_MAIN_NAVIGATION_INTRO);
});

test('explicit tracking only accepts actionable quests', () => {
  const runtime = createQuestRuntime();
  runtime.update({ quest: main1(5), main2Quest: main2(2, true) });

  assert.equal(runtime.setTrackedQuestId(QUEST_ID_MAIN_FIRST_CAMPUS), false);
  assert.equal(runtime.setTrackedQuestId(QUEST_ID_MAIN_NAVIGATION_INTRO), true);
  assert.equal(runtime.tracked()?.questId, QUEST_ID_MAIN_NAVIGATION_INTRO);
});

test('runtime publishes account-switch state without leaking old quests', () => {
  const runtime = createQuestRuntime();
  const seen = [];
  runtime.onChange(snapshot => seen.push(snapshot));
  runtime.update({ quest: main1(3), main2Quest: main2(0, false) });
  runtime.update({
    quest: { signedIn: false, ready: false, stage: 0, complete: false },
    main2Quest: { signedIn: false, ready: false, stage: 0, available: false, complete: false }
  });
  assert.equal(seen.at(-1).signedIn, false);
  assert.equal(seen.at(-1).quests.length, 0);
  assert.equal(seen.at(-1).trackedQuestId, null);
});
