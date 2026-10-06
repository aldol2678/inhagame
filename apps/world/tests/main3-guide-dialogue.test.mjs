import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../npc-factory/main3-guide-dialogue.mjs').catch(() => ({}));
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(initial = {}) {
  assert.equal(typeof module.renderMain3GuideDialogue, 'function');
  let state = { enabled: true, signedIn: true, ready: true, available: true, stage: 0, ...initial };
  let current = true, starts = 0, refreshes = 0, resolve;
  const pending = new Promise(r => { resolve = r; });
  const line = { textContent: '' }; const buttons = [];
  const options = { quest: { status: () => state, startFromGuide: () => { starts++; return pending; }, refresh: async () => { refreshes++; state = { ...state, ready: true }; } },
    line, clearChoices: () => { buttons.length = 0; }, addChoice: (label, click) => { const button = { label, click, disabled: false }; buttons.push(button); return button; },
    closeDialogue: () => { current = false; }, isCurrent: () => current };
  return { render: () => module.renderMain3GuideDialogue(options), line, buttons, resolve, stale: () => { current = false; }, starts: () => starts, refreshes: () => refreshes };
}
test('Main3 guide offers canonical CTA; starting never purchases and updates only on server result', async () => {
  const h = harness(); assert.equal(h.render(), true);
  assert.match(h.line.textContent, /학생회관 굿즈샵/);
  assert.equal(h.buttons[0].label, '굿즈샵 가보기');
  const click = h.buttons[0].click(); assert.equal(h.starts(), 1);
  assert.equal(h.buttons[0].disabled, true);
  h.resolve({ stage: 1 }); await click;
  assert.match(h.line.textContent, /학생회관 굿즈샵으로/);
});
test('closing or account switching prevents delayed guide responses from replacing newer dialogue', async () => {
  const h = harness(); h.render(); const click = h.buttons[0].click();
  h.stale(); h.line.textContent = 'new dialogue'; h.resolve({ stage: 1 }); await click;
  assert.equal(h.line.textContent, 'new dialogue');
});
test('guide retry and progress wording do not demand another purchase or speculate on rewards', async () => {
  const h = harness({ ready: false }); h.render(); assert.equal(h.buttons[0].label, '다시 확인');
  await h.buttons[0].click(); assert.equal(h.refreshes(), 1);
  for (const stage of [1, 2, 3, 4]) {
    const active = harness({ stage }); active.render();
    assert.doesNotMatch(active.line.textContent, /100|재구매|다시 구매/);
    assert.ok(!active.buttons.some(b => b.label === '굿즈샵 가보기'));
  }
});
