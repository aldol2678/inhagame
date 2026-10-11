import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryIncomeClient, normalizeDeliveryIncomeSnapshot } from '../src/income/delivery-income-client.mjs';
import { createDeliveryIncomePanel } from '../src/income/delivery-income-panel.mjs';
import { createFakeDocument } from './support/fake-dom.mjs';
const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', session = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const preview = () => ({ questId: 'quest.side.taerin_carp', enabled: true, coin: 20, sessionId: null, state: null,
  inventory: { itemId: 'material.fish_carp', requiredQuantity: 1, ownedQuantity: 2 },
  budget: { remainingCoin: 60, remainingDeliveries: 1, budgetDate: '2026-10-11' }, receipt: null });
function rig() {
  let raw = preview(), lost = null, failRead = false, paid = 0;
  const calls = [];
  const client = createDeliveryIncomeClient({ enabled: true, makeRequestId: () => requestId, onCommitted: r => { paid += r.coin; },
    request: async body => {
      calls.push(body);
      if (body.op === 'status') { if (failRead) throw Error('lost read'); return structuredClone(raw); }
      if (body.op === 'start') raw = { ...raw, sessionId: session, state: 'READY_TO_SETTLE', budget: { ...raw.budget, remainingCoin: 40, remainingDeliveries: 0 } };
      if (body.op === 'complete') raw = { ...raw, state: 'SETTLED', inventory: { ...raw.inventory, ownedQuantity: raw.inventory.ownedQuantity - 1 },
        receipt: { sessionId: session, settlementId: session, coin: 20, committed: true } };
      if (lost === body.op) throw Error('lost ack'); return raw;
    } });
  return { client, calls, get paid() { return paid; }, get raw() { return raw; }, set raw(v) { raw = v; }, set lost(v) { lost = v; }, set failRead(v) { failRead = v; } };
}
test('delivery displays bounded material holding and rejects forged snapshots', () => {
  assert.equal(normalizeDeliveryIncomeSnapshot(preview()).ownedQuantity, 2);
  for (const patch of [{ questId: 'other' }, { inventory: { ...preview().inventory, ownedQuantity: -1 } },
    { sessionId: session, state: 'SETTLED' }, { coin: '20' }]) assert.throws(() => normalizeDeliveryIncomeSnapshot({ ...preview(), ...patch }), /INVALID/);
});
test('accept does not consume, submit only server receipt triggers completion once', async () => {
  const r = rig(); await r.client.setAccount(user); await r.client.accept();
  assert.equal(r.raw.inventory.ownedQuantity, 2); assert.equal(r.paid, 0);
  await r.client.submit(); await r.client.refresh();
  assert.equal(r.raw.inventory.ownedQuantity, 1); assert.equal(r.paid, 20);
  for (const body of r.calls) for (const field of ['userId', 'accountId', 'coin', 'quantity', 'giverId', 'finished']) assert.equal(field in body, false);
});
test('missing material blocks client submission and lost response reads same receipt without re-submit', async () => {
  const r = rig(); r.raw.inventory.ownedQuantity = 0; await r.client.setAccount(user); await r.client.accept();
  assert.equal(await r.client.submit(), false); assert.equal(r.calls.some(x => x.op === 'complete'), false);
  r.raw.inventory.ownedQuantity = 1; await r.client.refresh(); r.lost = 'complete'; await r.client.submit();
  assert.equal(r.paid, 20); assert.equal(r.calls.filter(x => x.op === 'complete').length, 1);
});
test('uncertain receipt blocks repeat submit until readback, closure retains paid receipt', async () => {
  const r = rig(); await r.client.setAccount(user); await r.client.accept(); r.failRead = true; r.lost = 'complete'; await r.client.submit();
  assert.equal(r.paid, 0); assert.equal(await r.client.submit(), false);
  r.failRead = false; r.raw.enabled = false; await r.client.refresh();
  assert.equal(r.paid, 20); assert.equal(r.client.state().snapshot.enabled, false); assert.equal(await r.client.accept(), false);
});
test('stale account response and settled-to-ready rollback cannot change visible authority', async () => {
  let resolve;
  const c = createDeliveryIncomeClient({ enabled: true, request: () => new Promise(done => { resolve = done; }) });
  const pending = c.setAccount(user); await c.setAccount(null); resolve(preview()); await pending;
  assert.equal(c.state().snapshot, null);
  const r = rig(); await r.client.setAccount(user); await r.client.accept(); await r.client.submit();
  r.raw = { ...r.raw, state: 'READY_TO_SETTLE', receipt: null }; await r.client.refresh();
  assert.equal(r.client.state().snapshot.status, 'SETTLED'); assert.equal(r.client.state().error, 'STATUS_UNCONFIRMED');
});
test('delivery panel opens read-only, shows holding/cap, supports Escape/back and account cleanup', async () => {
  const r = rig(); await r.client.setAccount(user);
  const doc = createFakeDocument(); doc.body = doc.createElement('body'); const opener = doc.createElement('button'); doc.body.append(opener); opener.focus();
  const events = new Map(); const panel = createDeliveryIncomePanel({ client: r.client, doc, navigation: { addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) } });
  await panel.open();
  const walk = el => [el, ...el.children.flatMap(walk)]; const texts = walk(panel.element).map(el => el.textContent ?? '').join(' ');
  assert.match(texts, /보유 잉어 2개/); assert.match(texts, /60 코인/); assert.equal(r.calls.some(c => c.op === 'start'), false);
  panel.element.dispatch('keydown', { key: 'Escape' }); assert.equal(panel.element.hidden, true); assert.equal(doc.activeElement, opener);
  await panel.open(); events.get('popstate')(); assert.equal(panel.element.hidden, true);
  await panel.open(); await r.client.setAccount(null); assert.equal(panel.element.hidden, true);
  panel.dispose(); assert.equal(events.has('popstate'), false);
});
