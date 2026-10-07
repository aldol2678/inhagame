import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBiryongSourceHashes, assertBiryongInputReceipt } from './browser/biryong-cloud-sync-acceptance.mjs';

const hash = 'a'.repeat(64);
const receipt = mobile => ({
  mobile,
  events: [{ type: 'click', target: 'fixture-modal-open', trusted: true },
    ...(mobile ? [{ type: 'pointerdown', target: 'biryong-cloud-retry', trusted: true, pointerType: 'touch' },
      { type: 'click', target: 'fixture-modal-close', trusted: true }]
      : [...['Tab', 'KeyW', 'Enter', 'Escape'].map(code => ({ type: 'keydown', code, trusted: true, target: code === 'Enter' ? 'biryong-cloud-retry' : 'fixture-modal-close' })),
        { type: 'keyup', code: 'KeyW', target: 'biryong-cloud-retry', trusted: true }])],
  transitions: [{ state: 'saved', owners: ['fixture-modal'], movement: false, camera: false, focus: 'fixture-modal-close', biryongInert: false }],
  whileSaving: { owners: ['fixture-modal'], movement: false, camera: false, focus: 'fixture-modal-close', biryongInert: false },
  afterSaved: { owners: ['fixture-modal'], movement: false, camera: false, focus: 'fixture-modal-close', biryongInert: false },
  afterClose: { owners: [], movement: true, camera: true, focus: 'fixture-modal-open', biryongInert: false }
});

test('input receipt rejects transient owner loss or replacement even when the final owner recovers', () => {
  for (const owners of [[], ['replacement-owner']]) {
    const changed = receipt(false);
    changed.transitions.unshift({ ...changed.whileSaving, state: 'pending', owners });
    assert.throws(() => assertBiryongInputReceipt(changed), 'never filter away lost-owner transitions');
  }
});

test('input receipt rejects fixture-only inert protection that could mask focus theft', () => {
  const protectedBackground = receipt(false);
  protectedBackground.whileSaving.biryongInert = true;
  assert.throws(() => assertBiryongInputReceipt(protectedBackground));
});

test('source receipt requires exact served bytes for every source', () => {
  assert.doesNotThrow(() => assertBiryongSourceHashes({ 'source.js': hash }, { 'source.js': hash }));
  assert.throws(() => assertBiryongSourceHashes({ 'source.js': hash }, {}));
  assert.throws(() => assertBiryongSourceHashes({ 'source.js': hash }, { 'source.js': 'b'.repeat(64) }));
});

test('input receipt accepts only trusted retry keyboard or touch plus stable modal ownership', () => {
  for (const mobile of [false, true]) {
    assert.doesNotThrow(() => assertBiryongInputReceipt(receipt(mobile)));
    const untrusted = receipt(mobile); untrusted.events.forEach(event => { event.trusted = false; });
    assert.throws(() => assertBiryongInputReceipt(untrusted));
    const stolen = receipt(mobile); stolen.afterSaved.focus = 'biryong-cloud-retry';
    assert.throws(() => assertBiryongInputReceipt(stolen));
    const released = receipt(mobile); released.afterSaved.owners = [];
    assert.throws(() => assertBiryongInputReceipt(released));
    const stuck = receipt(mobile); stuck.afterClose.movement = false;
    assert.throws(() => assertBiryongInputReceipt(stuck));
    const transient = receipt(mobile); transient.transitions[0].focus = 'biryong-cloud-retry';
    assert.throws(() => assertBiryongInputReceipt(transient));
  }
});
