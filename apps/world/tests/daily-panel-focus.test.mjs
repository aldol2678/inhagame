import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from './support/fake-dom.mjs';
import { createDailyPanelFocusFixture, attendanceView, quizView, ok, failed } from './browser/daily-panel-focus-fixture.mjs';

const walk = node => [node, ...node.children.flatMap(walk)];
const byClass = (root, name) => walk(root).filter(node => node.className.split(/\s+/).includes(name));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness(kind, onOpenChange) {
  const doc = createFakeDocument(), createElement = doc.createElement;
  // Model real removal and native disabled-focus refusal; the shared lightweight fake does neither.
  doc.createElement = tag => {
    const node = createElement(tag), replace = node.replaceChildren.bind(node);
    node.scrollTop = node.scrollLeft = 0;
    node.replaceChildren = (...children) => {
      if (node.children.some(child => child.contains(doc.activeElement))) doc.activeElement = doc.body;
      for (const child of node.children) child.parent = null;
      replace(...children);
    };
    node.focus = options => { if (!node.disabled) { doc.activeElement = node; node.focusOptions = options; } };
    return node;
  };
  doc.body = doc.createElement('body');
  const h = createDailyPanelFocusFixture({ kind, root: doc.body, doc, onOpenChange });
  return { ...h, doc, close: () => byClass(h.panel, 'profile-close')[0], body: () => byClass(h.panel, 'shop-panel-body')[0],
    action: () => byClass(h.panel, kind === 'attendance' ? 'attendance-claim' : 'daily-quiz-option')[kind === 'attendance' ? 0 : 2],
    retry: () => byClass(h.panel, 'shop-retry')[0] };
}
async function open(h, view = h.view()) {
  void h.client.setAccount('account-a'); h.opener.focus(); h.opener.click();
  h.settle(0, ok(view)); await flush();
}
const expectFocus = (h, node) => { assert.ok(h.doc.activeElement === node, `expected focus on ${node?.className || node?.id}, got ${h.doc.activeElement?.className || h.doc.activeElement?.id || 'body'}`); assert.ok(h.doc.body.contains(node), 'focus is connected'); };

for (const kind of ['attendance', 'quiz']) {
  test(`${kind}: slow initial load keeps close focus and same-view refresh retains scroll`, async () => {
    const h = harness(kind); void h.client.setAccount('account-a'); h.opener.focus(); h.opener.click();
    expectFocus(h, h.close()); h.settle(0, ok(h.view())); await flush(); expectFocus(h, h.close());
    h.body().scrollTop = 137; h.body().scrollLeft = 9; h.panel.scrollTop = 17;
    void h.client.refresh(); h.settle(1, ok(h.view())); await flush();
    expectFocus(h, h.close()); assert.equal(h.body().scrollTop, 137); assert.equal(h.body().scrollLeft, 9); assert.equal(h.panel.scrollTop, 17);
    assert.deepEqual(h.close().focusOptions, { preventScroll: true });
  });
  test(`${kind}: refresh never takes focus back from another UI`, async () => {
    const h = harness(kind); await open(h); h.outside.focus(); void h.client.refresh(); h.settle(1, ok(h.view())); await flush(); expectFocus(h, h.outside);
  });
  test(`${kind}: pending action retains semantic position, failure re-enables it, repeated click sends one request`, async () => {
    const h = harness(kind); await open(h); const action = h.action(); action.focus(); h.body().scrollTop = 111;
    action.click(); h.action().click(); assert.equal(h.requests.length, 2); assert.equal(h.action().disabled, true);
    assert.ok(h.panel.contains(h.doc.activeElement)); assert.notEqual(h.doc.activeElement, h.close());
    assert.equal(h.doc.activeElement.dataset.focusKey, action.dataset.focusKey);
    assert.equal(h.body().scrollTop, 111);
    h.settle(1, failed); await flush(); expectFocus(h, h.action()); assert.equal(h.action().disabled, false);
    h.settle(2, ok(h.view())); await flush(); expectFocus(h, h.action()); assert.equal(h.body().scrollTop, 111);
  });
  test(`${kind}: pending result respects deliberate close-button focus`, async () => {
    const h = harness(kind); await open(h); h.action().focus(); h.action().click(); h.close().focus();
    h.settle(1, failed); await flush(); expectFocus(h, h.close()); h.settle(2, ok(h.view())); await flush(); expectFocus(h, h.close());
  });
  test(`${kind}: pending result respects outside focus`, async () => {
    const h = harness(kind); await open(h); h.action().focus(); h.action().click(); h.outside.focus();
    h.settle(1, failed); await flush(); expectFocus(h, h.outside); h.settle(2, ok(h.view())); await flush(); expectFocus(h, h.outside);
  });
  test(`${kind}: retry failure keeps retry; recovery falls back safely`, async () => {
    const h = harness(kind); void h.client.setAccount('account-a'); h.opener.focus(); h.opener.click(); h.settle(0, failed); await flush();
    h.retry().focus(); h.retry().click(); h.retry().click(); assert.equal(h.requests.length, 2);
    h.settle(1, failed); await flush(); expectFocus(h, h.retry()); h.retry().click(); h.settle(2, ok(h.view())); await flush(); expectFocus(h, h.close());
  });
  test(`${kind}: account generation clears prior focus identity and scroll; old response is ignored`, async () => {
    const h = harness(kind); await open(h); h.action().focus(); h.action().click(); h.body().scrollTop = 130;
    void h.client.setAccount('account-b'); expectFocus(h, h.close()); assert.equal(h.body().scrollTop, 0);
    h.settle(1, failed); await flush(); assert.equal(h.client.state, 'LOADING'); expectFocus(h, h.close());
    h.settle(2, ok(h.view())); await flush(); expectFocus(h, h.close()); assert.equal(h.body().scrollTop, 0);
    void h.client.setAccount(null); expectFocus(h, h.close()); assert.equal(h.client.state, 'SIGNED_OUT');
  });
  test(`${kind}: close restores opener and late result cannot reopen or steal focus`, async () => {
    const h = harness(kind); await open(h); h.action().focus(); h.panel.scrollTop = 37; h.action().click(); h.doc.dispatch('keydown', { code: 'Escape' });
    expectFocus(h, h.opener); h.settle(1, failed); await flush(); h.settle(2, ok(h.view())); await flush(); expectFocus(h, h.opener); assert.equal(h.ui.open, false);
    h.opener.click(); expectFocus(h, h.close()); assert.equal(h.body().scrollTop, 0); assert.equal(h.panel.scrollTop, 0); h.settle(3, ok(h.view())); await flush(); expectFocus(h, h.close());
  });
  test(`${kind}: close/reopen before old response respects new session focus`, async () => {
    const h = harness(kind); await open(h); h.action().focus(); h.action().click(); h.ui.setOpen(false); h.opener.click(); h.outside.focus();
    h.settle(1, failed); await flush(); h.settle(2, ok(h.view())); await flush(); expectFocus(h, h.outside);
    assert.equal(byClass(h.panel, 'shop-hint').length, 0, 'old session notice is not rendered');
  });
  test(`${kind}: closing from outside and callback handoffs never restore opener`, async () => {
    const h = harness(kind); await open(h); h.outside.focus(); h.ui.setOpen(false); expectFocus(h, h.outside);
    const handed = harness(kind, value => { if (!value) handed.outside.focus(); }); await open(handed); handed.ui.setOpen(false); expectFocus(handed, handed.outside);
  });
  for (const restriction of ['disabled', 'detached', 'hidden']) test(`${kind}: close skips ${restriction} opener`, async () => {
    const h = harness(kind); await open(h);
    if (restriction === 'disabled') h.opener.disabled = true;
    if (restriction === 'detached') h.opener.isConnected = false;
    if (restriction === 'hidden') h.opener.closest = () => h.opener;
    h.ui.setOpen(false); assert.notEqual(h.doc.activeElement, h.opener);
  });
}

test('attendance: successful claim removes action and focuses close without losing calendar scroll', async () => {
  const h = harness('attendance'); await open(h); h.action().focus(); h.body().scrollTop = 145; h.action().click();
  h.settle(1, ok({ ...attendanceView(true), claimed: false, replayed: true, rewards: [] })); await flush();
  expectFocus(h, h.close()); assert.equal(h.body().scrollTop, 145); assert.equal(h.action(), undefined);
});
test('quiz: start pending keeps card anchor; new question uses safe close fallback', async () => {
  const h = harness('quiz'); await open(h, quizView(0, { status: 'AVAILABLE' })); const start = byClass(h.panel, 'daily-quiz-start')[0];
  start.focus(); start.click(); assert.ok(h.panel.contains(h.doc.activeElement)); assert.notEqual(h.doc.activeElement, h.close());
  h.settle(1, ok(quizView())); await flush(); expectFocus(h, h.close());
});
test('quiz: next question never focuses the same numeric answer in a different question', async () => {
  const h = harness('quiz'); await open(h); h.action().focus(); h.body().scrollTop = 145; h.action().click();
  h.settle(1, ok(quizView(1))); await flush(); expectFocus(h, h.close()); assert.equal(h.body().scrollTop, 0);
});
for (const status of ['PASSED', 'FAILED']) test(`quiz: terminal ${status} removes answers and uses close fallback`, async () => {
  const h = harness('quiz'); await open(h, quizView(2)); h.action().focus(); h.action().click(); h.settle(1, ok(quizView(3, { status }))); await flush();
  expectFocus(h, h.close()); assert.equal(h.action(), undefined);
});
test('quiz: new run cannot inherit answer identity from a reused question id', async () => {
  const h = harness('quiz'); await open(h); h.action().focus(); void h.client.refresh();
  h.settle(1, ok(quizView(0, { runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }))); await flush(); expectFocus(h, h.close());
});
