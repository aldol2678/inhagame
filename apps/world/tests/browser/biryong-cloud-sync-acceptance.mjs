import assert from 'node:assert/strict';

export function assertBiryongSourceHashes(expected, served) {
  assert.ok(Object.keys(expected).length > 0, 'record runtime source hashes');
  for (const hash of Object.values(expected)) assert.match(hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(served, expected, 'browser-served bytes must match the exact checked-out sources');
}

export function assertBiryongInputReceipt({ mobile, events, transitions, whileSaving, afterSaved, afterClose }) {
  const trusted = events.filter(event => event.trusted);
  assert.ok(trusted.some(event => event.type === 'click' && event.target === 'fixture-modal-open'), 'competing owner opened through native input');
  if (mobile) {
    assert.ok(trusted.some(event => event.type === 'pointerdown' && event.pointerType === 'touch' &&
      event.target === 'biryong-cloud-retry'), 'retry was activated by a trusted touch');
    assert.ok(trusted.some(event => event.type === 'click' && event.target === 'fixture-modal-close'), 'native close tap');
  } else {
    for (const code of ['Tab', 'KeyW', 'Enter', 'Escape']) {
      assert.ok(trusted.some(event => event.type === 'keydown' && event.code === code), `native ${code}`);
    }
    assert.ok(trusted.some(event => event.type === 'keydown' && event.code === 'Enter' &&
      event.target === 'biryong-cloud-retry'), 'retry was activated by native keyboard input');
    assert.ok(trusted.some(event => event.type === 'keyup' && event.code === 'KeyW' &&
      event.target === 'biryong-cloud-retry'), 'held gameplay key was released with retry focused');
  }
  assert.ok(transitions.length > 0, 'observe all asynchronous updates from modal open through saved');
  for (const state of [whileSaving, afterSaved, ...transitions]) {
    assert.deepEqual(state.owners, ['fixture-modal'], 'cloud state changes cannot replace the active input owner');
    assert.equal(state.movement, false); assert.equal(state.camera, false);
    assert.equal(state.focus, 'fixture-modal-close', 'cloud state changes cannot steal modal focus');
    assert.equal(state.biryongInert, false, 'background retry must remain non-inert so focus theft is observable');
  }
  assert.deepEqual(afterClose.owners, []);
  assert.equal(afterClose.movement, true); assert.equal(afterClose.camera, true);
  assert.equal(afterClose.focus, 'fixture-modal-open');
  assert.equal(afterClose.biryongInert, false);
}
