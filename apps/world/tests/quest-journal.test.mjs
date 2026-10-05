import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDocument } from './support/fake-dom.mjs';
import { createQuestRuntime, QUEST_ID_MAIN_NAVIGATION_INTRO } from '../src/quest/quest-runtime.js';
import { createQuestJournal } from '../src/quest/quest-journal.js';

function textTree(node) {
  return [node.textContent, ...(node.children ?? []).map(textTree)].join(' ');
}
function findByClass(node, className) {
  if (node.className === className) return node;
  for (const child of node.children ?? []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}
function findAllByClass(node, className, out = []) {
  if (node.className === className) out.push(node);
  for (const child of node.children ?? []) findAllByClass(child, className, out);
  return out;
}
const state = (qStage, qComplete, main2Stage, main2Available) => ({
  quest: { signedIn: true, ready: true, stage: qStage, complete: qComplete },
  main2Quest: {
    signedIn: true, ready: true, stage: main2Stage,
    available: main2Available, complete: main2Stage === 9
  }
});

test('journal renders Main and Side tabs while hiding locked Main spoilers', () => {
  const doc = createFakeDocument();
  const panel = doc.createElement('section');
  const runtime = createQuestRuntime();
  runtime.update(state(2, false, 0, false));

  const journal = createQuestJournal({ panel, runtime, doc });
  journal.setOpen(true);

  const content = textTree(panel);
  assert.match(content, /첫 캠퍼스 탐방/);
  assert.match(content, /다음 이야기/);
  assert.doesNotMatch(content, /길찾기 익히기/);

  const tabs = findAllByClass(panel, 'quest-journal-tab');
  assert.equal(tabs.length, 2);
  tabs[1].click();
  assert.match(textTree(panel), /아직 받은 서브 퀘스트가 없어요/);
});

test('journal navigation delegates only the selected objective target', () => {
  const doc = createFakeDocument();
  const panel = doc.createElement('section');
  const runtime = createQuestRuntime();
  runtime.update(state(2, false, 0, false));
  const calls = [];

  const journal = createQuestJournal({
    panel, runtime, doc,
    onNavigate: (target, quest) => { calls.push([target, quest.questId]); return true; }
  });
  journal.setOpen(true);

  const navigate = findByClass(panel, 'quest-journal-primary');
  assert.ok(navigate);
  navigate.click();
  assert.deepEqual(calls, [['poi.inkyung-pond', 'quest.main.first_campus']]);
});

test('journal follows runtime handoff from completed Main 01 to Main 02', () => {
  const doc = createFakeDocument();
  const panel = doc.createElement('section');
  const runtime = createQuestRuntime();
  runtime.update(state(4, false, 0, false));
  const journal = createQuestJournal({ panel, runtime, doc });
  journal.setOpen(true);

  runtime.update(state(5, true, 0, true));
  assert.equal(runtime.trackedQuestId, QUEST_ID_MAIN_NAVIGATION_INTRO);
  assert.match(textTree(panel), /길찾기 익히기/);
  assert.match(textTree(panel), /후문 안내 학생과 대화/);
});

test('signed-out journal never exposes account quest rows', () => {
  const doc = createFakeDocument();
  const panel = doc.createElement('section');
  const runtime = createQuestRuntime();
  runtime.update({
    quest: { signedIn: false, ready: false, stage: 0, complete: false },
    main2Quest: { signedIn: false, ready: false, stage: 0, available: false, complete: false }
  });
  const journal = createQuestJournal({ panel, runtime, doc });
  journal.setOpen(true);
  assert.match(textTree(panel), /로그인하면 메인·서브 퀘스트 진행도가 계정에 저장돼요/);
  assert.equal(findAllByClass(panel, 'quest-journal-item').length, 0);
});
