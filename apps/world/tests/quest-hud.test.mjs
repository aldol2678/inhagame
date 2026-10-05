import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDocument } from './support/fake-dom.mjs';
import {
  createQuestRuntime,
  QUEST_ID_MAIN_FIRST_CAMPUS,
  QUEST_ID_MAIN_NAVIGATION_INTRO
} from '../src/quest/quest-runtime.js';
import { createTrackedQuestHud } from '../src/quest/quest-hud.js';

const state = (qStage, qComplete, main2Stage, main2Available) => ({
  quest: { signedIn: true, ready: true, stage: qStage, complete: qComplete },
  main2Quest: {
    signedIn: true, ready: true, stage: main2Stage,
    available: main2Available, complete: main2Stage === 9
  }
});

function harness() {
  const doc = createFakeDocument();
  const root = doc.createElement('section');
  const openButton = doc.createElement('button');
  const heading = doc.createElement('span');
  const objective = doc.createElement('span');
  const bearing = doc.createElement('span');
  root.append(openButton, heading, objective, bearing);

  const runtime = createQuestRuntime();
  const opened = [];
  const targets = [];
  const hud = createTrackedQuestHud({
    root,
    openButton,
    headingElement: heading,
    objectiveElement: objective,
    bearingElement: bearing,
    runtime,
    getTarget: quest => {
      targets.push(quest.legacyProgressId);
      return { x: 2, z: 0, kind: 'quest-npc' };
    },
    getPlayerPosition: () => ({ x: 0, z: 0 }),
    getYaw: () => 0,
    onOpenJournal: quest => { opened.push(quest.questId); return true; }
  });
  return { root, openButton, heading, objective, bearing, runtime, opened, targets, hud };
}

test('single tracked HUD renders Main 01 and updates live guidance', () => {
  const h = harness();
  h.runtime.update(state(2, false, 0, false));
  h.hud.update();

  assert.equal(h.root.hidden, false);
  assert.equal(h.root.dataset.questId, QUEST_ID_MAIN_FIRST_CAMPUS);
  assert.equal(h.heading.textContent, 'MAIN 01 · 첫 캠퍼스 탐방');
  assert.match(h.objective.textContent, /인경호/);
  assert.match(h.bearing.textContent, /m/);
  assert.equal(h.bearing.hidden, false);
  assert.equal(h.targets.at(-1), 'campus_first_walk_v1');
});

test('automatic Main 01 to Main 02 handoff changes the same HUD instead of showing two cards', () => {
  const h = harness();
  h.runtime.update(state(4, false, 0, false));
  assert.equal(h.root.dataset.questId, QUEST_ID_MAIN_FIRST_CAMPUS);

  h.runtime.update(state(5, true, 0, true));
  h.hud.update();

  assert.equal(h.root.dataset.questId, QUEST_ID_MAIN_NAVIGATION_INTRO);
  assert.equal(h.heading.textContent, 'MAIN 02 · 길찾기 익히기');
  assert.match(h.objective.textContent, /후문 안내 학생/);
  assert.equal(h.targets.at(-1), 'campus_navigation_intro_v1');
});

test('HUD opens the journal for the tracked quest and hides on sign-out', () => {
  const h = harness();
  h.runtime.update(state(2, false, 0, false));
  h.openButton.click();
  assert.deepEqual(h.opened, [QUEST_ID_MAIN_FIRST_CAMPUS]);

  h.runtime.update({
    quest: { signedIn: false, ready: false, stage: 0, complete: false },
    main2Quest: { signedIn: false, ready: false, stage: 0, available: false, complete: false }
  });
  assert.equal(h.root.hidden, true);
  assert.equal(h.objective.textContent, '');
  assert.equal(h.bearing.hidden, true);
});
