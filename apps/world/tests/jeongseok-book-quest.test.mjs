import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSL_BOOKS, JSL_BOOK_ANCHORS, jslBookNear, jslBookQuestPresentation, JSL_BOOK_QUEST_ID, createJeongseokBookQuest } from '../src/jeongseok/book-quest.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createFakeDocument } from './support/fake-dom.mjs';
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

// Model focus detachment on replacement, which the shared lightweight DOM intentionally omits.
function questDocument() {
  const doc = createFakeDocument(), create = doc.createElement;
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  doc.createElement = tag => {
    const node = create(tag); node.style = {};
    Object.defineProperty(node, 'isConnected', { get: () => doc.body?.contains(node) ?? false });
    node.getClientRects = () => node.hidden ? [] : [{}];
    node.querySelectorAll = selector => descendants(node).filter(child =>
      selector === 'button' ? child.tagName === 'BUTTON' :
      (child.tagName === 'BUTTON' && !child.disabled) || (child.tagName === 'A' && child.href));
    node.querySelector = selector => node.querySelectorAll(selector)[0] ?? null;
    node.replaceChildren = (...children) => {
      if (node.contains(doc.activeElement)) doc.activeElement = doc.body;
      for (const child of node.children) child.parent = null;
      node.children = []; node.append(...children);
    };
    node.remove = () => {
      if (node.contains(doc.activeElement)) doc.activeElement = doc.body;
      if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
      node.parent = null;
    };
    return node;
  };
  doc.removeEventListener = (type, fn) => doc.listeners.set(type, (doc.listeners.get(type) ?? []).filter(value => value !== fn));
  doc.body = doc.createElement('body'); doc.activeElement = doc.body;
  doc.getElementById = id => descendants(doc.body).find(node => node.id === id) ?? null;
  return doc;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = stage => ({ data: { quest_id: 'jsl_first_book_search_v1', stage, reward: null }, error: null });
function fixture(t, { abortable = false } = {}) {
  const doc = questDocument(), inputFocus = createInputFocusManager(), calls = [], progress = [];
  const context = { space: 'ROOM_JEONGSEOK_LOBBY', position: { ...JSL_BOOK_ANCHORS.librarian }, grounded: true };
  const canvas = doc.createElement('canvas'); canvas.id = 'application'; canvas.tabIndex = -1; doc.body.append(canvas);
  const opener = doc.createElement('button'); doc.body.append(opener); opener.focus();
  const quest = createJeongseokBookQuest({ doc, inputFocus, getContext: () => context,
    onProgress: value => progress.push(value), getClient: () => ({ rpc: (name, args) => {
      const operation = new Promise((resolve, reject) => calls.push({ name, args, resolve, reject }));
      if (abortable) operation.abortSignal = signal => { calls.at(-1).signal = signal; return operation; };
      return operation;
    } }) });
  const panel = doc.body.children.at(-1);
  t.after(() => quest.destroy());
  return { doc, panel, opener, canvas, quest, inputFocus, context, calls, progress,
    button: text => panel.querySelectorAll('button').find(node => node.textContent === text),
    open: () => quest.observe('librarian')?.trigger() };
}
async function ready(f, account = 'A', stage = 0) {
  const pending = f.quest.setAccount(account); f.calls.at(-1).resolve(reply(stage)); await pending;
}

test('book quest keeps keyboard focus through pending and completed renders, then restores opener', async t => {
  const f = fixture(t); await ready(f); assert.equal(f.open(), true);
  const start = f.button('첫 도서 찾기 시작'); start.focus(); start.click();
  assert.ok(f.panel.contains(f.doc.activeElement), 'pending render retains dialog focus');
  assert.equal(f.inputFocus.can('WORLD_ACTION'), false);
  f.calls.at(-1).resolve(reply(1)); await tick();
  assert.ok(f.panel.contains(f.doc.activeElement), 'reply render retains dialog focus');
  f.doc.dispatch('keydown', { key: 'Escape' });
  assert.equal(f.quest.status().open, false);
  assert.equal(f.doc.activeElement, f.opener);
  assert.equal(f.inputFocus.can('WORLD_ACTION'), true);
});

test('book quest traps Tab and yields to a competing blocking owner without stealing its focus', async t => {
  const f = fixture(t); await ready(f); f.open();
  let prevented = 0;
  const close = f.button('닫기'), start = f.button('첫 도서 찾기 시작');
  start.focus(); f.doc.dispatch('keydown', { key: 'Tab', preventDefault: () => prevented++ });
  assert.equal(f.doc.activeElement, close);
  f.doc.dispatch('keydown', { key: 'Tab', shiftKey: true, preventDefault: () => prevented++ });
  assert.equal(f.doc.activeElement, start); assert.equal(prevented, 2);
  const competing = f.inputFocus.claim('other-dialog', INPUT_FOCUS_POLICY.BLOCKING_UI);
  assert.equal(f.quest.status().open, false);
  assert.equal(f.inputFocus.size, 1, 'quest claim is released when another blocking owner takes over');
  assert.equal(f.open(), false, 'captured context action cannot open through another modal');
  const outside = f.doc.createElement('button'); f.doc.body.append(outside); outside.focus();
  f.doc.dispatch('keydown', { key: 'Escape' }); assert.equal(f.doc.activeElement, outside);
  f.inputFocus.release(competing);
});

test('book quest ignores detached controls and old replies across an account change', async t => {
  const f = fixture(t); await ready(f); f.open();
  const oldStart = f.button('첫 도서 찾기 시작'); oldStart.click();
  const oldRequest = f.calls.at(-1);
  await ready(f, 'B'); f.open();
  const count = f.calls.length; oldStart.click();
  assert.equal(f.calls.length, count, 'detached A control cannot write for B');
  oldRequest.resolve(reply(1)); await tick();
  assert.equal(f.quest.status().accountId, 'B'); assert.equal(f.quest.status().stage, 0);
  assert.equal(f.quest.status().busy, false);
});

test('book quest bounds a never-settling request and ignores its late response after retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); let settled = false;
  const pending = f.quest.setAccount('A').then(value => { settled = true; return value; });
  const old = f.calls.at(-1);
  t.mock.timers.tick(8000); await tick();
  assert.equal(settled, true, 'a missing RPC reply has a terminal deadline');
  assert.equal(await pending, false);
  assert.deepEqual(f.quest.status(), { accountId: 'A', stage: null, state: 'UNAVAILABLE', open: false, busy: false });
  const retry = f.quest.refresh(); f.calls.at(-1).resolve(reply(2)); await retry;
  old.resolve(reply(4)); await tick();
  assert.equal(f.quest.status().stage, 2, 'late timeout reply cannot replace current verified progress');
});

test('book quest cancels obsolete transport and clears deadlines after completion or destruction', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { abortable: true });
  const first = f.quest.setAccount('A'), old = f.calls.at(-1);
  const second = f.quest.setAccount('B'), current = f.calls.at(-1);
  assert.equal(old.signal.aborted, true); assert.equal(await first, false);
  current.resolve(reply(0)); assert.equal(await second, true);
  t.mock.timers.tick(8000); await tick();
  assert.equal(current.signal.aborted, false, 'completed request has no remaining deadline');
  const pending = f.quest.refresh(), destroyed = f.calls.at(-1);
  f.quest.destroy();
  assert.equal(destroyed.signal.aborted, true); assert.equal(await pending, false);
  destroyed.resolve(reply(4)); await tick();
  assert.equal(f.progress.at(-1), null); assert.equal(f.inputFocus.size, 0);
});

test('actual main pagehide callback closes for BFCache and disposes only on final departure', async t => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const hooks = [...source.matchAll(/window\.addEventListener\('pagehide', event => \{([\s\S]*?)\n\}\);/g)]
    .filter(match => match[1].includes('jeongseokBookQuest'));
  assert.equal(hooks.length, 1, 'extract exactly one production quest lifecycle callback');
  const f = fixture(t); await ready(f); f.open();
  const pagehide = runInNewContext(`event => {${hooks[0][1]}\n}`, { jeongseokBookQuest: f.quest });
  pagehide({ persisted: true });
  assert.equal(f.quest.status().open, false); assert.equal(f.inputFocus.size, 0);
  assert.equal(f.panel.isConnected, true, 'BFCache keeps the runtime reusable');
  assert.equal(f.open(), true);
  pagehide({ persisted: false });
  assert.equal(f.panel.isConnected, false); assert.equal(f.inputFocus.size, 0);
  assert.equal(f.doc.listeners.get('keydown').length, 0);
});

test('book quest restores the visible World canvas when its HUD opener is hidden', async t => {
  const f = fixture(t); await ready(f); f.open(); f.opener.hidden = true;
  f.quest.close();
  assert.equal(f.doc.activeElement, f.canvas); assert.equal(f.inputFocus.can('WORLD_ACTION'), true);
});

test('book quest close does not restore focus over a remaining chat owner', async t => {
  const f = fixture(t); await ready(f); f.open();
  const chat = f.inputFocus.claim('synthetic-chat', INPUT_FOCUS_POLICY.CHAT);
  const outside = f.doc.createElement('input'); f.doc.body.append(outside); outside.focus();
  f.quest.close();
  assert.equal(f.doc.activeElement, outside); assert.equal(f.inputFocus.can('WORLD_ACTION'), false);
  f.inputFocus.release(chat);
});
