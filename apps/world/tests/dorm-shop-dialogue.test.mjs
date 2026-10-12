import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from './support/fake-dom.mjs';
import { createDormShopDialogue } from '../src/shop/dorm-shop-dialogue.js';
import { createDormShopInteraction } from '../src/shop/dorm-shop-interaction.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createInputFocusOwner } from '../src/input/input-focus-owner.js';

function rig() {
  const doc = createFakeDocument(); doc.body = doc.createElement('body');
  doc.removeEventListener = (event, fn) => doc.listeners.set(event, (doc.listeners.get(event) ?? []).filter(x => x !== fn));
  const make = doc.createElement;
  doc.createElement = tag => { const node = make(tag);
    node.removeEventListener = (event, fn) => node.listeners.set(event, (node.listeners.get(event) ?? []).filter(x => x !== fn));
    node.remove = () => { node.parent.children = node.parent.children.filter(x => x !== node); node.parent = null; };
    return node;
  };
  const opener = doc.createElement('button'); doc.body.append(opener); opener.focus();
  const manager = createInputFocusManager(), owner = createInputFocusOwner({ manager, ownerId: 'dorm-shop-dialogue', policy: INPUT_FOCUS_POLICY.BLOCKING_UI });
  const view = createDormShopDialogue({ doc, onOpenChange: open => open ? owner.acquire() : owner.release() });
  let state = { space: 'ROOM_DORM1_LOBBY', position: { x: 0, z: .85 }, grounded: true, available: true, accountId: 'a' };
  const calls = [];
  const interaction = createDormShopInteraction({ dialogue: view, getState: () => ({ ...state, blocked: !manager.can('WORLD_ACTION') }),
    openShop: id => { calls.push({ id, focus: doc.activeElement, claims: manager.size }); return true; } });
  const panel = doc.body.children.at(-1);
  return { doc, opener, panel, manager, interaction, calls, get buttons() { return panel.children.filter(n => n.tagName === 'BUTTON'); },
    state: patch => { state = { ...state, ...patch }; } };
}

test('greeting owns input, traps Tab and restores the world opener before shop handoff', () => {
  const r = rig(); r.interaction.contextAction().trigger();
  assert.equal(r.manager.can('WORLD_ACTION'), false); assert.equal(r.manager.size, 1);
  assert.equal(r.doc.activeElement, r.buttons[0]);
  r.doc.dispatch('keydown', { key: 'Tab' }); assert.equal(r.doc.activeElement, r.buttons[1]);
  r.doc.dispatch('keydown', { key: 'Tab', shiftKey: true }); assert.equal(r.doc.activeElement, r.buttons[0]);
  const staleBrowse = r.buttons[0]; staleBrowse.click(); staleBrowse.click();
  assert.deepEqual(r.calls, [{ id: 'shop.dorm_furniture', focus: r.opener, claims: 0 }]);
  assert.equal(r.panel.hidden, true); assert.equal(r.manager.size, 0);
});

test('Escape and explicit close release focus without buying or stale callbacks', () => {
  const r = rig(); r.interaction.contextAction().trigger(); const old = r.buttons[0];
  r.doc.dispatch('keydown', { code: 'Escape' }); old.click();
  assert.equal(r.panel.hidden, true); assert.equal(r.manager.size, 0); assert.equal(r.doc.activeElement, r.opener);
  r.interaction.contextAction().trigger(); r.buttons[1].click(); assert.equal(r.calls.length, 0);
  assert.equal(r.manager.can('WORLD_ACTION'), true);
});

test('invalidated and destroyed dialogue never restores a departed opener or revives old buttons', () => {
  const r = rig(); r.interaction.contextAction().trigger(); const old = r.buttons[0];
  const newerPanel = r.doc.createElement('button'); newerPanel.focus();
  r.state({ space: 'campus' }); r.interaction.update();
  assert.equal(r.doc.activeElement, newerPanel); old.click(); assert.equal(r.calls.length, 0);
  r.interaction.destroy(); r.interaction.destroy();
  assert.equal(r.doc.listeners.get('keydown').length, 0);
  assert.equal(r.doc.body.children.includes(r.panel), false); assert.equal(r.manager.size, 0);
});
