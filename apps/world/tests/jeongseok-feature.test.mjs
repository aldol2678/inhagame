import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJeongseokFeature } from '../src/jeongseok/jeongseok-feature.js';
import { JEONGSEOK_GATE, JEONGSEOK_GUIDE } from '../src/jeongseok/gate-layout.js';
import { GATE_STATE } from '../src/jeongseok/gate-controller.js';

const A = '0a000000-0000-4000-8000-00000000000a', B = '0b000000-0000-4000-8000-00000000000b';
const NOW = '2026-10-12T03:00:00.000Z', LATER = '2026-10-13T03:00:00.000Z';
const read = (userId = A) => ({ version: 1, decision: 'NEEDS_PASS', granted: false, via: null,
  gateStatus: 'ACTIVE', serverNow: NOW, userId, inhaMailVerified: false, pass: null,
  offer: { status: 'ACTIVE', passType: 'jeongseok.visitor.day', price: 100, currencyId: 'currency.induck_coin',
    durationSeconds: 86400, balance: 150, canPurchase: true, shortfall: 0 } });
const granted = (userId = A, via = 'VISITOR_PASS') => ({ ...read(userId), decision: 'GRANTED', granted: true,
  via, inhaMailVerified: via === 'INHA_MAIL', offer: null,
  pass: via === 'VISITOR_PASS' ? { passType: 'jeongseok.visitor.day', issuedAt: NOW, expiresAt: LATER, active: true } : null });
const receipt = (key, userId = A, status = 'SUCCESS') => ({ status, purchaseId: '1c000000-0000-4000-8000-000000000001', userId,
  passType: 'jeongseok.visitor.day', currencyId: 'currency.induck_coin', price: 100, balanceBefore: 150, balanceAfter: 50,
  issuedAt: NOW, expiresAt: LATER, walletTransactionId: '2c000000-0000-4000-8000-000000000002', idempotencyKey: key, access: granted(userId) });
const at = (anchor, over = {}) => ({ space: anchor.space, position: { ...anchor.position }, grounded: true, mounted: false, busy: false, ...over });
const memoryStorage = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null,
  setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), map }; };
const fakeDoc = () => ({ body: { append() {} }, createElement: () => ({ dataset: {}, append() {}, setAttribute() {}, remove() {} }) });

function fixture(t, options = {}) {
  let current = options.snapshot ?? read(), context = at(JEONGSEOK_GATE), enabled = true;
  const calls = [], opens = [], entered = [], storage = options.storage ?? memoryStorage();
  let readHandler = () => ({ data: current });
  let purchaseHandler = args => { current = granted(); return { data: receipt(args.p_idempotency_key) }; };
  const feature = createJeongseokFeature({ doc: fakeDoc(), getContext: () => context, isEnabled: () => enabled,
    getClient: () => ({ rpc: async (name, args) => { calls.push({ name, args });
      return name === 'get_jeongseok_access_v1' ? readHandler() : purchaseHandler(args); } }),
    getPhone: () => ({ openJeongseok: value => { opens.push(value); return true; }, endJeongseok() {}, refresh() {} }),
    storage: () => storage, timings: { scanMs: 0, grantedMs: 0, openingMs: 0, readyMs: 60000 },
    onEnter: snapshot => { entered.push(snapshot); return { status: 'ENTERING' }; }
  });
  t.after(() => feature.destroy());
  return { feature, calls, opens, entered, storage,
    setContext: value => { context = value; }, setSnapshot: value => { current = value; },
    setReadHandler: value => { readHandler = value; }, setPurchaseHandler: value => { purchaseHandler = value; },
    setEnabled: value => { enabled = value; },
    purchases: () => calls.filter(call => call.name === 'purchase_jeongseok_pass_v1'),
    reader: () => feature.contextAction(context), guide: () => feature.npcContextAction(context) };
}
async function ready(feature) {
  if (feature.gate.state === GATE_STATE.READY_TO_ENTER) return;
  await new Promise(resolve => { const off = feature.gate.onChange(view => {
    if (view.state === GATE_STATE.READY_TO_ENTER) { off(); resolve(); }
  }); });
}

test('reader and guide require the lobby, grounded player, no mount or room transition', t => {
  const f = fixture(t);
  assert.ok(f.reader());
  assert.equal(f.guide(), null);
  for (const over of [{ space: 'campus' }, { space: 'ROOM_JEONGSEOK_B1_READING' }, { grounded: false }, { mounted: true }, { busy: true }]) {
    f.setContext(at(JEONGSEOK_GATE, over)); assert.equal(f.reader(), null);
    f.setContext(at(JEONGSEOK_GUIDE, over)); assert.equal(f.guide(), null);
  }
  f.setContext(at(JEONGSEOK_GUIDE)); assert.ok(f.guide()); assert.equal(f.reader(), null);
  f.setEnabled(false); assert.equal(f.guide(), null);
});

test('guest can open fictional guide/login guidance but cannot buy or trigger a read RPC', async t => {
  const f = fixture(t); f.setContext(at(JEONGSEOK_GUIDE));
  await f.guide().trigger();
  assert.deepEqual(f.opens, [{ tag: false }]);
  assert.equal(f.feature.gate.state, GATE_STATE.AUTH_REQUIRED);
  assert.equal(f.feature.phoneView().atGuide, true);
  assert.equal(await f.feature.purchase(), false);
  assert.equal(f.calls.length, 0);
});

test('guide obtains a server offer without tagging; reader proximity cannot authorize purchase', async t => {
  const f = fixture(t); await f.feature.setAccount(A);
  f.setContext(at(JEONGSEOK_GUIDE)); await f.guide().trigger();
  assert.equal(f.feature.gate.state, GATE_STATE.NEEDS_PASS);
  assert.equal(f.feature.gate.snapshot().canPurchase, true);
  assert.deepEqual(f.opens, [{ tag: false }]);
  f.setContext(at(JEONGSEOK_GATE));
  assert.equal(f.feature.phoneView().atGuide, false, 'Phone reads live proximity, not an old NPC frame');
  assert.equal(await f.feature.purchase(), false);
  assert.equal(f.purchases().length, 0);
});

test('successful NPC purchase and fresh read do not tag or open the internal gate', async t => {
  const f = fixture(t); await f.feature.setAccount(A);
  f.setContext(at(JEONGSEOK_GUIDE)); await f.guide().trigger();
  assert.equal(await f.feature.purchase(), true);
  assert.equal(f.purchases().length, 1);
  assert.equal(f.feature.gate.state, GATE_STATE.IDLE);
  assert.equal(f.feature.gate.snapshot().notice, 'ISSUED');
  assert.deepEqual(f.opens, [{ tag: false }]);
  assert.equal(f.entered.length, 0);
  f.setContext(at(JEONGSEOK_GATE)); await f.reader().trigger(); await ready(f.feature);
  const before = f.calls.length;
  await f.reader().trigger();
  assert.equal(f.calls.length, before + 1, 'crossing re-verifies the server even after purchase/tag');
  assert.equal(f.entered.length, 1);
});

test('free Inha-mail access at the guide never starts the tag animation or permits buying', async t => {
  const f = fixture(t, { snapshot: granted(A, 'INHA_MAIL') }); await f.feature.setAccount(A);
  f.setContext(at(JEONGSEOK_GUIDE)); await f.guide().trigger();
  assert.equal(f.feature.gate.state, GATE_STATE.IDLE);
  assert.equal(f.feature.phoneView().access.snapshot.via, 'INHA_MAIL');
  assert.equal(await f.feature.purchase(), false);
  assert.equal(f.purchases().length, 0);
  assert.deepEqual(f.opens, [{ tag: false }]);
});

test('captured reader/guide actions recheck live context before any new RPC', async t => {
  const f = fixture(t); await f.feature.setAccount(A);
  const reader = f.reader(); f.setContext(at(JEONGSEOK_GUIDE)); const guide = f.guide();
  const count = f.calls.length;
  f.setContext(at(JEONGSEOK_GUIDE, { space: 'campus' }));
  assert.equal(reader.trigger(), false); assert.equal(guide.trigger(), false);
  assert.equal(f.calls.length, count); assert.equal(f.opens.length, 0);
});

test('reader grant arriving after walking away never starts the tag sequence', async t => {
  const f = fixture(t, { snapshot: granted() }); await f.feature.setAccount(A);
  let release; f.setReadHandler(() => new Promise(resolve => { release = resolve; }));
  const pending = f.reader().trigger();
  f.setContext(at(JEONGSEOK_GUIDE)); release({ data: granted() });
  assert.equal(await pending, false);
  assert.equal(f.feature.gate.state, GATE_STATE.IDLE); assert.equal(f.opens.length, 0);
});

for (const [name, changed] of [
  ['walking away', at(JEONGSEOK_GUIDE)], ['leaving the lobby', at(JEONGSEOK_GATE, { space: 'campus' })],
  ['mounting', at(JEONGSEOK_GATE, { mounted: true })], ['becoming busy', at(JEONGSEOK_GATE, { busy: true })],
  ['becoming airborne', at(JEONGSEOK_GATE, { grounded: false })]
]) test(`fresh entry reply cannot cross after ${name}, even without a frame update`, async t => {
  const f = fixture(t, { snapshot: granted() }); await f.feature.setAccount(A);
  await f.reader().trigger(); await ready(f.feature);
  let release; f.setReadHandler(() => new Promise(resolve => { release = resolve; }));
  const pending = f.reader().trigger();
  f.setContext(changed); release({ data: granted() });
  assert.equal(await pending, null); assert.equal(f.entered.length, 0);
  assert.equal(f.feature.gate.state, GATE_STATE.IDLE);
});

test('lost purchase result can be recovered only at the guide, with the saved account key', async t => {
  const storage = memoryStorage(); storage.setItem(`inha-world:jeongseok-pass-key:${A}`, 'jsl:saved');
  const f = fixture(t, { storage, snapshot: granted() }); await f.feature.setAccount(A);
  assert.equal(await f.feature.purchase(), false, 'reader does not authorize saved-key recovery');
  f.setContext(at(JEONGSEOK_GUIDE));
  f.setPurchaseHandler(args => ({ data: receipt(args.p_idempotency_key, A, 'ALREADY_PROCESSED') }));
  assert.equal(await f.feature.purchase(), true, 'reloaded IDLE controller can replay at guide');
  assert.equal(f.purchases()[0].args.p_idempotency_key, 'jsl:saved');
  assert.equal(f.feature.gate.state, GATE_STATE.IDLE);
  assert.equal(f.feature.gate.snapshot().notice, 'RECOVERED');
  assert.equal(storage.map.size, 0); assert.equal(f.opens.length, 0);
});

test('moving away during purchase preserves its receipt but never opens the gate', async t => {
  const f = fixture(t); await f.feature.setAccount(A); f.setContext(at(JEONGSEOK_GUIDE)); await f.guide().trigger();
  let release; f.setPurchaseHandler(args => new Promise(resolve => { release = () => {
    f.setSnapshot(granted()); resolve({ data: receipt(args.p_idempotency_key) });
  }; }));
  const pending = f.feature.purchase(); await Promise.resolve();
  assert.equal(await f.feature.purchase(), false, 'one outstanding purchase');
  f.setContext(at(JEONGSEOK_GATE, { space: 'campus' })); f.guide(); release();
  assert.equal(await pending, true);
  assert.equal(f.feature.access.view().pendingKey, false);
  assert.equal(f.feature.gate.state, GATE_STATE.IDLE); assert.equal(f.entered.length, 0);
  assert.deepEqual(f.opens, [{ tag: false }]);
});

test('account switch invalidates an in-flight purchase without losing the old recovery key', async t => {
  const f = fixture(t); await f.feature.setAccount(A); f.setContext(at(JEONGSEOK_GUIDE)); await f.guide().trigger();
  let release; f.setPurchaseHandler(args => new Promise(resolve => { release = () => resolve({ data: receipt(args.p_idempotency_key) }); }));
  const pending = f.feature.purchase(); await Promise.resolve();
  const key = f.purchases()[0].args.p_idempotency_key;
  f.setSnapshot(read(B)); await f.feature.setAccount(B); release();
  assert.equal(await pending, false);
  assert.equal(f.feature.access.accountId, B); assert.equal(f.feature.access.snapshot.userId, B);
  assert.equal(f.feature.access.view().lastPurchase, null);
  assert.equal(f.feature.access.view().pendingKey, false);
  assert.equal(f.storage.getItem(`inha-world:jeongseok-pass-key:${A}`), key);
  assert.equal(f.feature.gate.state, GATE_STATE.IDLE); assert.equal(f.entered.length, 0);
});
