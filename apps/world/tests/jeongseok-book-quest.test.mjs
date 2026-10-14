import test from 'node:test';
import assert from 'node:assert/strict';
import { JSL_BOOKS, JSL_BOOK_ANCHORS, jslBookNear, jslBookQuestPresentation, JSL_BOOK_QUEST_ID } from '../src/jeongseok/book-quest.js';
import { getQuestDefinition, listQuestDefinitions } from '../src/quest/quest-registry.js';
import { createQuestRuntime } from '../src/quest/quest-runtime.js';

test('books are fixed practice metadata and never holdings, no generated rewards', () => {
  assert.equal(JSL_BOOKS.length,3);
  assert.equal(new Set(JSL_BOOKS.map(b=>b.id)).size,3);
  const quest=getQuestDefinition(JSL_BOOK_QUEST_ID);
  assert.equal(quest.type,'SIDE');
  assert.deepEqual(quest.rewardRefs,[]);
  assert.ok(listQuestDefinitions({type:'SIDE'}).some(q=>q.questId===JSL_BOOK_QUEST_ID));
});
test('public-lobby spots cannot leak to campus or inner space', () => {
  const c={space:'ROOM_JEONGSEOK_LOBBY',position:{x:-1.9,z:-5.8},grounded:true,mounted:false,busy:false};
  assert.equal(jslBookNear(c,JSL_BOOK_ANCHORS.librarian),0);
  assert.equal(jslBookNear({...c,space:'world'},JSL_BOOK_ANCHORS.librarian),null);
  assert.equal(jslBookNear({...c,mounted:true},JSL_BOOK_ANCHORS.librarian),null);
  assert.equal(jslBookNear({...c,busy:true},JSL_BOOK_ANCHORS.librarian),null);
  assert.equal(jslBookNear({...c,position:{x:100,z:100}},JSL_BOOK_ANCHORS.librarian),null);
});
test('side quest presentation does not fabricate server progress',()=>{
  assert.equal(jslBookQuestPresentation(null),null);
  assert.equal(jslBookQuestPresentation(-1),null);
  assert.equal(jslBookQuestPresentation(5),null);
  assert.equal(jslBookQuestPresentation(0).state,'AVAILABLE');
  assert.equal(jslBookQuestPresentation(2).state,'ACTIVE');
  assert.equal(jslBookQuestPresentation(4).state,'COMPLETED');
  assert.equal(jslBookQuestPresentation(4).currentObjective,null);
});
test('side quest is isolated from legacy Main1/Main2 and clears on account reset',()=>{
  const runtime=createQuestRuntime();
  const side=jslBookQuestPresentation(2);
  runtime.setSideQuest(JSL_BOOK_QUEST_ID, side);
  assert.ok(runtime.list('SIDE').some(q=>q.questId===JSL_BOOK_QUEST_ID));
  runtime.update({quest:{signedIn:true,ready:true,stage:0},main2Quest:{signedIn:true,ready:true,stage:0}});
  assert.equal(runtime.list('MAIN').length,2);
  assert.equal(runtime.list('SIDE').length,1);
  runtime.setSideQuest(JSL_BOOK_QUEST_ID,null);
  assert.equal(runtime.list('SIDE').length,0);
  runtime.setSideQuest(JSL_BOOK_QUEST_ID,side);
  runtime.reset();
  assert.equal(runtime.list().length,0);
});
