import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneShell } from '../src/phone/phone-shell.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
test('Phone stack owns all gameplay input, back unwinds photo/maps, system takeover never unlocks gameplay', () => {
  const focus = createInputFocusManager();
  const registry = ['album', 'maps'].map(id => ({ id, available: () => true }));
  const shell = createPhoneShell({ inputFocus: focus, registry });
  shell.open(); for (const key of ['MOVE','CAMERA','WORLD_ACTION','GAMEPLAY_SHORTCUT']) assert.equal(focus.can(key), false);
  shell.launch('album'); shell.launch('album', { photoId: 'a' }); shell.launch('maps');
  shell.back(); assert.equal(shell.snapshot().current.photoId, 'a'); shell.back(); shell.back();
  assert.equal(shell.state, 'HOME'); shell.edit(); shell.back(); assert.equal(shell.state, 'HOME');
  const lock = focus.claim('transition', INPUT_FOCUS_POLICY.SYSTEM_LOCK);
  assert.equal(shell.state, 'CLOSED'); assert.equal(focus.can('MOVE'), false);
  focus.release(lock); assert.equal(focus.can('MOVE'), true);
});
test('app error retains close escape path and unavailable apps stay absent', () => {
  const focus = createInputFocusManager(), errors = [];
  const shell = createPhoneShell({ inputFocus: focus, registry: [{id:'broken',available:()=>true,open(){throw Error('bad');}}, {id:'future',available:()=>false}], onError:e=>errors.push(e) });
  shell.open(); assert.equal(shell.launch('future'), false); shell.launch('broken'); assert.equal(errors.length, 1);
  shell.close(); assert.equal(focus.size, 0); shell.destroy(); assert.equal(shell.open(), false);
});
