import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmartphone } from '../src/phone/smartphone.js';
import { createInputFocusManager } from '../src/input/input-focus-manager.js';
import { createJeongseokFeature } from '../src/jeongseok/jeongseok-feature.js';
import { JEONGSEOK_GATE, JEONGSEOK_GUIDE } from '../src/jeongseok/gate-layout.js';
import { FakeElement, createFakeDocument } from './support/fake-dom.mjs';

class PhoneElement extends FakeElement {
  removeAttribute(name) { delete this.attributes[name]; }
  removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(value => value !== fn)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(value => value !== this); this.parent = null; }
  querySelectorAll(selector) {
    const match = node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tagName === selector.toUpperCase();
    const nodes = []; const visit = node => { for (const child of node.children) { if (match(child)) nodes.push(child); visit(child); } };
    visit(this); return nodes;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  get isConnected() { return this.doc.body.contains(this); }
}
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const A = '0a000000-0000-4000-8000-00000000000a';
const NOW = '2026-10-12T03:00:00.000Z', LATER = '2026-10-13T03:00:00.000Z';
function rig(t, { account = A, balance = 150, price = 100, durationSeconds = 86400, pendingKey = null } = {}) {
  const doc = createFakeDocument(); doc.createElement = tag => new PhoneElement(tag, doc);
  doc.body = doc.root = doc.createElement('body'); doc.removeEventListener = () => {};
  const map = new Map(); const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
  if (pendingKey) storage.setItem(`inha-world:jeongseok-pass-key:${account}`, pendingKey);
  const win = { localStorage: storage, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {},
    setTimeout, clearTimeout, URL: { revokeObjectURL() {} } };
  let phone, context = { space: JEONGSEOK_GUIDE.space, position: { ...JEONGSEOK_GUIDE.position }, grounded: true, busy: false, mounted: false };
  let snapshot = { version: 1, decision: 'NEEDS_PASS', granted: false, via: null, gateStatus: 'ACTIVE', serverNow: NOW,
    userId: A, inhaMailVerified: false, pass: null, offer: { status: 'ACTIVE', passType: 'jeongseok.visitor.day',
      price, currencyId: 'currency.induck_coin', durationSeconds, balance, canPurchase: balance >= price, shortfall: Math.max(price - balance, 0) } };
  const calls = [];
  const feature = createJeongseokFeature({ doc, getContext: () => context, isEnabled: () => true, getPhone: () => phone,
    storage: () => storage, getClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); if (name === 'get_jeongseok_access_v1') return { data: snapshot };
      snapshot = { ...snapshot, decision: 'GRANTED', granted: true, via: 'VISITOR_PASS', offer: null,
        pass: { passType: 'jeongseok.visitor.day', issuedAt: NOW, expiresAt: LATER, active: true } };
      return { data: { status: pendingKey ? 'ALREADY_PROCESSED' : 'SUCCESS', purchaseId: '1c000000-0000-4000-8000-000000000001', userId: A,
        passType: 'jeongseok.visitor.day', currencyId: 'currency.induck_coin', price, balanceBefore: balance, balanceAfter: balance - price,
        issuedAt: NOW, expiresAt: LATER, walletTransactionId: '2c000000-0000-4000-8000-000000000002', idempotencyKey: args.p_idempotency_key, access: snapshot } };
    } }) });
  const focus = createInputFocusManager();
  phone = createSmartphone({ doc, win, inputFocus: focus, photoMode: { subscribe: () => () => {} },
    getMap: () => null, getSettings: () => null, getIdentity: () => null, getClient: () => null, getProgression: () => null,
    getCaptureContext: () => ({}), canOpen: () => true, jeongseok: feature });
  t.after(() => { phone.destroy(); feature.destroy(); });
  return { feature, phone, calls,
    async open() { await feature.setAccount(account); feature.npcContextAction(context).trigger(); await flush(); },
    setContext(value) { context = { ...context, ...value }; },
    async changeAccount(accountId) { snapshot = { ...snapshot, userId: accountId }; await feature.setAccount(accountId); await feature.refresh(); },
    refresh() { phone.refresh(); }, text: () => text(phone.root),
    button(label) { return phone.root.querySelectorAll('button').find(node => node.textContent === label); },
    purchases: () => calls.filter(call => call.name === 'purchase_jeongseok_pass_v1') };
}

test('real Phone guest guide explains free lobby and login without any purchase controls', async t => {
  const r = rig(t, { account: null }); await r.open();
  assert.equal(r.phone.status().state, 'APP');
  assert.match(r.text(), /로비는 로그인 없이 자유롭게/);
  assert.match(r.text(), /인하대 이메일 인증 계정은 무료/);
  assert.match(r.text(), /정식 계정 로그인/);
  assert.match(r.text(), /게임 속 가상 안내원/);
  assert.equal(r.button('방문증 발급하기 · 100 인덕코인'), undefined);
  assert.equal(r.calls.length, 0);
});

test('real Phone shows server price/duration, cancels safely, then purchases once at guide', async t => {
  const r = rig(t); await r.open();
  assert.match(r.text(), /정석 24시간 방문증/); assert.match(r.text(), /100 인덕코인/);
  const buy = r.button('방문증 발급하기 · 100 인덕코인'); assert.ok(buy); assert.equal(buy.disabled, false);
  buy.click(); assert.ok(r.button('결제 확인 · 100 인덕코인 사용'));
  r.button('구매 취소').click(); assert.equal(r.purchases().length, 0);
  r.button('방문증 발급하기 · 100 인덕코인').click(); r.button('결제 확인 · 100 인덕코인 사용').click(); await flush();
  assert.equal(r.purchases().length, 1);
  assert.equal(r.feature.gate.state, 'IDLE');
  assert.equal(r.phone.status().state, 'APP', 'guide stays open instead of animating/closing as a reader');
  assert.match(r.text(), /가상 정석 방문증 보유/);
});

test('real Phone reflects changed server offer instead of hardcoded 100 coins or 24 hours', async t => {
  const r = rig(t, { price: 70, durationSeconds: 7200 }); await r.open();
  assert.match(r.text(), /정석 2시간 방문증/); assert.match(r.text(), /70 인덕코인/);
  assert.doesNotMatch(r.text(), /정석 24시간 방문증|100 인덕코인/);
});

test('real Phone disables insufficient-funds purchase using the server shortfall', async t => {
  const r = rig(t, { balance: 40 }); await r.open();
  assert.match(r.text(), /60개 부족/);
  assert.equal(r.button('방문증 발급하기 · 100 인덕코인').disabled, true);
  assert.equal(r.purchases().length, 0);
});

test('retained Phone confirmation cannot buy after walking to reader; refresh removes purchase UI', async t => {
  const r = rig(t); await r.open(); r.button('방문증 발급하기 · 100 인덕코인').click();
  const stale = r.button('결제 확인 · 100 인덕코인 사용');
  r.setContext({ position: { ...JEONGSEOK_GATE.position } }); stale.click(); await flush();
  assert.equal(r.purchases().length, 0, 'live guide guard applies even before a UI frame');
  r.refresh(); assert.equal(r.button('방문증 발급하기 · 100 인덕코인'), undefined);
  assert.match(r.text(), /내부 게이트 옆 안내 NPC에게 구입/);
});

test('Phone saved-key recovery is shown only at guide and replays exactly one request key', async t => {
  const r = rig(t, { pendingKey: 'jsl:phone-replay' }); await r.open();
  assert.ok(r.button('같은 요청 다시 확인'));
  r.setContext({ position: { ...JEONGSEOK_GATE.position } }); r.refresh();
  assert.equal(r.button('같은 요청 다시 확인'), undefined);
  r.setContext({ position: { ...JEONGSEOK_GUIDE.position } }); r.refresh();
  r.button('같은 요청 다시 확인').click(); await flush();
  assert.equal(r.purchases().length, 1);
  assert.equal(r.purchases()[0].args.p_idempotency_key, 'jsl:phone-replay');
  assert.equal(r.feature.gate.state, 'IDLE');
  assert.equal(r.feature.access.view().pendingKey, false);
});


test('retained purchase confirmation cannot spend on a newly selected account', async t => {
  const r = rig(t); await r.open(); r.button('방문증 발급하기 · 100 인덕코인').click();
  const stale = r.button('결제 확인 · 100 인덕코인 사용');
  const other = '0b000000-0000-4000-8000-00000000000b';
  await r.changeAccount(other);
  assert.equal(r.feature.access.accountId, other);
  assert.equal(r.feature.gate.snapshot().canPurchase, true, 'the new account itself could buy');
  stale.click(); await flush();
  assert.equal(r.purchases().length, 0, 'approval from the old account/render cannot apply to another');
});
