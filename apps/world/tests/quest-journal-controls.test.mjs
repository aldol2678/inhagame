import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeDocument } from './support/fake-dom.mjs';
import { createQuestRuntime } from '../src/quest/quest-runtime.js';
import { createQuestJournal } from '../src/quest/quest-journal.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';

const state = (stage = 2, complete = false, main2Available = false) => ({
  quest: { signedIn: true, ready: true, stage, complete },
  main2Quest: { signedIn: true, ready: true, stage: 0, available: main2Available, complete: false }
});
const walk = node => [node, ...node.children.flatMap(walk)];
const byClass = (node, name) => walk(node).filter(child => child.className === name);
const byQuest = (node, id) => byClass(node, 'quest-journal-item').find(child => child.dataset.questId === id);

function harness({ onOpenChange = () => {} } = {}) {
  const doc = createFakeDocument();
  doc.body = doc.createElement('body');
  const panel = doc.createElement('section');
  const opener = doc.createElement('button');
  const outside = doc.createElement('button');
  doc.body.append(opener, panel, outside);
  // Model native replacement: detached children lose containment and document focus.
  // The shared minimal fake DOM deliberately does neither.
  panel.replaceChildren = (...nodes) => {
    if (panel.contains(doc.activeElement)) doc.activeElement = doc.body;
    for (const child of panel.children) child.parent = null;
    panel.children = [];
    panel.append(...nodes);
  };
  const runtime = createQuestRuntime();
  runtime.update(state());
  const journal = createQuestJournal({ panel, runtime, doc, onOpenChange });
  opener.focus();
  journal.setOpen(true);
  return { doc, panel, opener, outside, runtime, journal };
}

// Regression contract: removing semantic focus recovery from render must fail these assertions.
test('journal preserves focused tab when keyboard activation replaces the DOM', () => {
  const h = harness();
  const side = byClass(h.panel, 'quest-journal-tab')[1];
  side.focus();
  side.click();
  assert.equal(h.doc.activeElement, byClass(h.panel, 'quest-journal-tab')[1]);
  assert.notEqual(h.doc.activeElement, side);
  assert.equal(h.doc.activeElement.getAttribute('aria-pressed'), 'true');
});

test('journal preserves selected quest focus across selection and progress updates', () => {
  const h = harness();
  const row = byClass(h.panel, 'quest-journal-item')[1];
  const id = row.dataset.questId;
  row.focus();
  row.click();
  assert.equal(h.doc.activeElement, byQuest(h.panel, id));
  h.runtime.update(state(3));
  assert.equal(h.doc.activeElement, byQuest(h.panel, id));
  assert.equal(h.journal.selectedQuestId, id);
});

test('journal preserves close and objective action focus while progress refreshes', () => {
  const h = harness();
  h.runtime.update(state(3));
  assert.equal(h.doc.activeElement, byClass(h.panel, 'profile-close')[0]);
  const navigate = byClass(h.panel, 'quest-journal-primary')[0];
  navigate.focus();
  h.journal.render();
  assert.equal(h.doc.activeElement, byClass(h.panel, 'quest-journal-primary')[0]);
});

test('journal falls back to close when a focused action disappears on tracking handoff', () => {
  const h = harness();
  byClass(h.panel, 'quest-journal-primary')[0].focus();
  h.runtime.update(state(5, true, true));
  assert.equal(h.doc.activeElement, byClass(h.panel, 'profile-close')[0]);
});

test('journal falls back to close when a focused track action becomes disabled', () => {
  const h = harness();
  h.runtime.update(state(2, false, true));
  byClass(h.panel, 'quest-journal-item')[1].click();
  const track = byClass(h.panel, 'quest-journal-secondary')[0];
  assert.equal(track.disabled, false);
  track.focus();
  track.click();
  assert.equal(h.doc.activeElement, byClass(h.panel, 'profile-close')[0]);
});

test('journal preserves scroll in both axes through progress refresh without stealing outside focus', () => {
  const h = harness();
  const names = ['quest-journal-body', 'quest-journal-list', 'quest-journal-detail'];
  names.forEach((name, index) => Object.assign(byClass(h.panel, name)[0], { scrollTop: 30 + index, scrollLeft: 10 + index }));
  Object.assign(h.panel, { scrollTop: 12, scrollLeft: 4 });
  h.outside.focus();
  h.runtime.update(state(3));
  names.forEach((name, index) => {
    assert.equal(byClass(h.panel, name)[0].scrollTop, 30 + index, name);
    assert.equal(byClass(h.panel, name)[0].scrollLeft, 10 + index, name);
  });
  assert.equal(h.panel.scrollTop, 12);
  assert.equal(h.panel.scrollLeft, 4);
  assert.equal(h.doc.activeElement, h.outside);
});

test('quest selection preserves list scroll but resets detail for the new quest', () => {
  const h = harness();
  Object.assign(byClass(h.panel, 'quest-journal-list')[0], { scrollTop: 45, scrollLeft: 18 });
  Object.assign(byClass(h.panel, 'quest-journal-detail')[0], { scrollTop: 70, scrollLeft: 8 });
  const next = byClass(h.panel, 'quest-journal-item')[1];
  next.focus();
  next.click();
  assert.equal(byClass(h.panel, 'quest-journal-list')[0].scrollTop, 45);
  assert.equal(byClass(h.panel, 'quest-journal-list')[0].scrollLeft, 18);
  assert.equal(byClass(h.panel, 'quest-journal-detail')[0].scrollTop, 0);
  assert.equal(byClass(h.panel, 'quest-journal-detail')[0].scrollLeft, 0);
});

test('switching tabs starts fresh scroll positions rather than reusing another tab', () => {
  const h = harness();
  byClass(h.panel, 'quest-journal-body')[0].scrollTop = 50;
  byClass(h.panel, 'quest-journal-list')[0].scrollLeft = 80;
  byClass(h.panel, 'quest-journal-tab')[1].click();
  assert.equal(byClass(h.panel, 'quest-journal-body')[0].scrollTop, 0);
  byClass(h.panel, 'quest-journal-tab')[0].click();
  assert.equal(byClass(h.panel, 'quest-journal-list')[0].scrollLeft, 0);
});

test('sign-out removes focused quest controls and safely focuses close', () => {
  const h = harness();
  byClass(h.panel, 'quest-journal-item')[0].focus();
  h.runtime.reset();
  assert.equal(byClass(h.panel, 'quest-journal-item').length, 0);
  assert.equal(h.doc.activeElement, byClass(h.panel, 'profile-close')[0]);
});

test('reopening captures the new opener and clears detached scroll references', () => {
  const h = harness();
  byClass(h.panel, 'quest-journal-list')[0].scrollLeft = 80;
  h.journal.setOpen(false);
  h.outside.focus();
  h.journal.setOpen(true);
  assert.equal(byClass(h.panel, 'quest-journal-list')[0].scrollLeft, 0);
  h.journal.setOpen(false);
  assert.equal(h.doc.activeElement, h.outside);
});

for (const method of ['close button', 'Escape', 'setOpen']) {
  test(`journal restores valid opener when closed by ${method}`, () => {
    const h = harness();
    if (method === 'close button') byClass(h.panel, 'profile-close')[0].click();
    else if (method === 'Escape') h.doc.dispatch('keydown', { code: 'Escape' });
    else h.journal.setOpen(false);
    assert.equal(h.doc.activeElement, h.opener);
    assert.equal(h.journal.open, false);
  });
}

for (const invalid of ['removed', 'disabled', 'hidden', 'inert']) {
  test(`journal does not restore an opener that is ${invalid}`, () => {
    const h = harness();
    if (invalid === 'removed') h.opener.isConnected = false;
    else if (invalid === 'disabled') h.opener.disabled = true;
    else h.opener.closest = selector => selector.includes(invalid) ? h.opener : null;
    h.journal.setOpen(false);
    assert.notEqual(h.doc.activeElement, h.opener);
  });
}

test('journal does not restore opener when focus moved outside before close', () => {
  const h = harness();
  h.outside.focus();
  h.journal.setOpen(false);
  assert.equal(h.doc.activeElement, h.outside);
});

test('journal does not override a close callback focus handoff', () => {
  let h;
  h = harness({ onOpenChange: open => { if (!open) h.outside.focus(); } });
  h.journal.setOpen(false);
  assert.equal(h.doc.activeElement, h.outside);
});

// Execute the actual main.js listener, with real shared input policy and journal lifecycle.
// This catches a missing gate in the production handler rather than a duplicated test helper.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const qListener = main.match(/window\.addEventListener\("keydown", \(event\) => \{\n  if \(event\.code !== "KeyQ"[\s\S]*?\n\}\);/)?.[0];
assert.ok(qListener, 'production Q listener is available');
function shortcutHarness() {
  const inputFocus = createInputFocusManager();
  let claim;
  const h = harness({ onOpenChange: open => {
    if (open) claim = inputFocus.claim('quest-journal', INPUT_FOCUS_POLICY.BLOCKING_UI);
    else inputFocus.release(claim);
  } });
  h.journal.setOpen(false);
  const combatRuntime = { active: false, toggles: 0, toggleLock() { this.toggles += 1; } };
  const lobbyWorld = { active: false };
  const lobbyTransition = { active: false };
  let listener;
  class HTMLElement { closest() { return null; } }
  new Function('window', 'HTMLElement', 'inputFocus', 'questJournal', 'combatRuntime', 'lobbyWorld', 'lobbyTransition', qListener)(
    { addEventListener: (_name, fn) => { listener = fn; } }, HTMLElement, inputFocus, h.journal, combatRuntime, lobbyWorld, lobbyTransition
  );
  const press = (props = {}) => {
    const event = { code: 'KeyQ', target: new HTMLElement(), prevented: false, preventDefault() { this.prevented = true; }, ...props };
    listener(event);
    return event;
  };
  return { ...h, inputFocus, combatRuntime, lobbyWorld, lobbyTransition, press, HTMLElement };
}

for (const [owner, policy] of [
  ['view-settings', INPUT_FOCUS_POLICY.BLOCKING_UI],
  ['npc-dialogue', INPUT_FOCUS_POLICY.BLOCKING_UI],
  ['chat', INPUT_FOCUS_POLICY.CHAT],
  ['room-transition', INPUT_FOCUS_POLICY.SYSTEM_LOCK]
]) {
  test(`Q cannot open journal while ${owner} owns input`, () => {
    const h = shortcutHarness();
    h.inputFocus.claim(owner, policy);
    const event = h.press();
    assert.equal(h.journal.open, false);
    assert.equal(event.prevented, false);
  });
}

test('Q opens under gameplay policy and closes its own blocking journal claim', () => {
  const h = shortcutHarness();
  assert.equal(h.press().prevented, true);
  assert.equal(h.journal.open, true);
  assert.equal(h.inputFocus.can('GAMEPLAY_SHORTCUT'), false);
  assert.equal(h.press().prevented, true);
  assert.equal(h.journal.open, false);
  assert.equal(h.doc.activeElement, h.opener);
  assert.equal(h.inputFocus.can('GAMEPLAY_SHORTCUT'), true);
});

test('Q retains combat lock behavior and combat input gating', () => {
  const h = shortcutHarness();
  h.combatRuntime.active = true;
  assert.equal(h.press().prevented, true);
  assert.equal(h.combatRuntime.toggles, 1);
  assert.equal(h.journal.open, false);
  h.inputFocus.claim('view-settings', INPUT_FOCUS_POLICY.BLOCKING_UI);
  assert.equal(h.press().prevented, false);
  assert.equal(h.combatRuntime.toggles, 1);
});

test('Q ignores repeats, modifiers, editable targets and active lobby transitions', () => {
  const h = shortcutHarness();
  for (const props of [{ code: 'KeyE' }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    assert.equal(h.press(props).prevented, false);
    assert.equal(h.journal.open, false);
  }
  const editable = new h.HTMLElement();
  editable.closest = () => editable;
  assert.equal(h.press({ target: editable }).prevented, false);
  for (const state of [h.lobbyWorld, h.lobbyTransition]) {
    state.active = true;
    assert.equal(h.press().prevented, false);
    assert.equal(h.journal.open, false);
    state.active = false;
  }
});

test('browser fixture carries production journal visibility and layout classes', () => {
  const html = readFileSync(new URL('../campus/index.html', import.meta.url), 'utf8');
  const fixture = readFileSync(new URL('./browser/quest-journal-controls-harness.html', import.meta.url), 'utf8');
  const classes = (source, id) => source.match(new RegExp(`id="${id}" class="([^"]+)"`))?.[1].split(/\s+/).sort();
  assert.deepEqual(classes(fixture, 'journal'), classes(html, 'quest-journal-panel'));
});
