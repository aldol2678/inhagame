import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from './support/fake-dom.mjs';
import { createConvenienceJobPanel } from '../src/income/convenience-job-panel.mjs';
const walk = n => [n, ...n.children.flatMap(walk)];
const base = () => ({ accountId: 'a', enabled: true, phase: 'POSTING', pending: false, error: null,
  snapshot: { posting: { baseCoin: 30, remainingCoin: 60, remainingShifts: 1, budgetDate: '2026-10-11',
    locationLabel: '위치 미확정', npcLabel: 'NPC 배정 미확정' }, session: null, receipt: null } });
function rig() {
  const doc = createFakeDocument(); doc.body = doc.createElement('body');
  let state = base(), listener; const calls = [], opens = [], navigation = new Map();
  const client = { state: () => state, subscribe: fn => { listener = fn; return () => { listener = null; }; },
    refresh: () => calls.push('status'), start: () => calls.push('start'), choose: id => calls.push(`step:${id}`), complete: () => calls.push('complete') };
  const opener = doc.createElement('button'), outside = doc.createElement('button'); doc.body.append(opener, outside); opener.focus();
  const ui = createConvenienceJobPanel({ client, doc, onOpenChange: v => opens.push(v), navigation: {
    addEventListener: (k, fn) => navigation.set(k, fn), removeEventListener: k => navigation.delete(k) } });
  const find = key => walk(ui.panel).find(n => n.dataset?.focusKey === key);
  return { ui, doc, calls, opens, opener, outside, find, navigation, get state() { return state; },
    change(patch) { state = { ...state, ...patch }; listener?.(); } };
}
function work(h) {
  h.change({ phase: 'WORKING', snapshot: { ...h.state.snapshot, session: { id: 's', revision: 0, completedSteps: 0, totalSteps: 3,
    step: { id: 'stock', kind: 'STOCK', prompt: '먼저 진열할 상품을 선택하세요.', choices: [{ id: 'a', label: '<script>실행하지 않음</script>' }, { id: 'b', label: '다른 상품' }] } } } });
}
test('semantic dialog, remaining cap before start, no direct authority effects on open/close', () => {
  const h = rig(); h.ui.openPanel(); assert.equal(h.ui.panel.getAttribute('role'), 'dialog'); assert.equal(h.ui.panel.getAttribute('aria-modal'), 'true');
  assert.ok(walk(h.ui.panel).some(n => n.textContent.includes('남은 공통 정산 한도 60')));
  assert.equal(h.doc.activeElement, h.find('close')); h.ui.close(); assert.equal(h.doc.activeElement, h.opener); assert.deepEqual(h.calls, ['status']);
});
test('choice requires deliberate selection then submit; text stays text', () => {
  const h = rig(); work(h); h.ui.openPanel(); assert.equal(h.find('submit').disabled, true);
  assert.equal(h.find('choice:a').textContent, '<script>실행하지 않음</script>'); h.find('choice:a').click();
  assert.equal(h.find('choice:a').getAttribute('aria-pressed'), 'true'); assert.deepEqual(h.calls, ['status']);
  h.find('submit').click(); assert.deepEqual(h.calls, ['status', 'step:a']);
});
test('pending disables gameplay, preserves close and moves focus to connected heading', () => {
  const h = rig(); work(h); h.ui.openPanel(); h.find('choice:a').click(); h.find('submit').focus(); h.change({ pending: true });
  assert.equal(h.find('submit').disabled, true); assert.equal(h.find('choice:a').disabled, true); assert.equal(h.find('close').disabled, false);
  assert.equal(h.doc.activeElement.tagName, 'H2'); assert.ok(h.ui.panel.contains(h.doc.activeElement));
  h.find('submit').click(); assert.deepEqual(h.calls, ['status']);
});
test('focus trap includes close; Escape prevents world shortcuts and restores opener', () => {
  const h = rig(); h.ui.openPanel(); h.find('start').focus(); const e = h.ui.panel.dispatch('keydown', { key: 'Tab' });
  assert.equal(e.stopped, true); assert.equal(h.doc.activeElement, h.find('close'));
  h.ui.panel.dispatch('keydown', { key: 'Tab', shiftKey: true }); assert.equal(h.doc.activeElement, h.find('start'));
  h.ui.panel.dispatch('keydown', { key: 'Escape' }); assert.equal(h.ui.open, false); assert.equal(h.doc.activeElement, h.opener);
});
test('Back closes without cancelling server progress; reopen only reads', () => {
  const h = rig(); work(h); h.ui.openPanel(); h.navigation.get('popstate')(); assert.equal(h.ui.open, false);
  h.ui.openPanel(); assert.deepEqual(h.calls, ['status', 'status']); assert.equal(h.state.snapshot.session.id, 's');
});
test('account switch closes without focusing another owner UI; old buttons inactive', () => {
  const h = rig(); h.ui.openPanel(); const oldStart = h.find('start'); h.change({ accountId: 'b' }); oldStart.click();
  assert.equal(h.ui.open, false); assert.deepEqual(h.calls, ['status']); assert.deepEqual(h.opens, [true, false]);
});
test('readback updates do not steal outside focus; unchanged state keeps DOM identity', () => {
  const h = rig(); h.ui.openPanel(); const start = h.find('start'); h.ui.update(); assert.equal(h.find('start'), start);
  h.outside.focus(); h.change({ pending: true }); assert.equal(h.doc.activeElement, h.outside);
});
test('recovery exposes read-only action and never calls settlement', () => {
  const h = rig(); h.change({ phase: 'RECOVERY', error: 'OUTCOME_UNKNOWN' }); h.ui.openPanel(); assert.equal(h.find('start'), undefined);
  assert.equal(h.find('complete'), undefined); h.find('refresh').click(); assert.deepEqual(h.calls, ['status', 'status']);
});
test('new server step clears old selection; closed feature cannot open', () => {
  const h = rig(); work(h); h.ui.openPanel(); h.find('choice:a').click();
  h.change({ snapshot: { ...h.state.snapshot, session: { ...h.state.snapshot.session, revision: 1 } } }); assert.equal(h.find('submit').disabled, true);
  h.change({ phase: 'CLOSED', enabled: false }); assert.equal(h.ui.open, false); assert.equal(h.ui.openPanel(), false);
});
test('only readback confirmed state renders paid result, and disposal removes navigation handler', () => {
  const h = rig(); h.change({ phase: 'CHECKOUT' }); h.ui.openPanel(); assert.ok(h.find('complete'));
  assert.ok(!walk(h.ui.panel).some(n => n.textContent.startsWith('서버 정산 확인:')));
  h.change({ phase: 'CONFIRMED', snapshot: { ...h.state.snapshot, receipt: { coin: 30 } } });
  assert.ok(walk(h.ui.panel).some(n => n.textContent.startsWith('서버 정산 확인: 30')));
  h.ui.dispose(); assert.equal(h.navigation.size, 0); assert.equal(h.ui.openPanel(), false);
});
