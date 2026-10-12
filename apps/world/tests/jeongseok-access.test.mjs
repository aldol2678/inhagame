import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACCESS_STATE, createJeongseokAccessClient, parseAccessSnapshot, parsePurchaseResult } from '../src/jeongseok/access-client.js';
import { createJeongseokGateController, GATE_STATE } from '../src/jeongseok/gate-controller.js';
import { gateContextAction, gateMessage } from '../src/jeongseok/gate-panel.js';
import { JEONGSEOK_FOOTPRINT, JEONGSEOK_GATE, nearJeongseokGate } from '../src/jeongseok/gate-layout.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { getPlaceZoneAt } from '../src/place-zone-registry.js';
import { isRoomId, ROOM_ENTRANCES } from '../src/rooms/room-registry.js';

const A = '0a000000-0000-4000-8000-00000000000a', B = '0b000000-0000-4000-8000-00000000000b';
const NOW = '2026-10-12T03:00:00.000Z', LATER = '2026-10-13T03:00:00.000Z';
const offer = (balance, price = 100) => ({ status: 'ACTIVE', passType: 'jeongseok.visitor.day', price, currencyId: 'currency.induck_coin',
  durationSeconds: 86400, balance, canPurchase: balance >= price, shortfall: Math.max(price - balance, 0) });
const read = (over = {}) => ({ version: 1, decision: 'NEEDS_PASS', granted: false, via: null, gateStatus: 'ACTIVE', serverNow: NOW,
  userId: A, inhaMailVerified: false, pass: null, offer: offer(150), ...over });
const pass = (active = true) => ({ passType: 'jeongseok.visitor.day', issuedAt: NOW, expiresAt: LATER, active });
const granted = (user = A) => read({ decision: 'GRANTED', granted: true, via: 'VISITOR_PASS', userId: user, pass: pass(), offer: null });
const receipt = (key, user = A, status = 'SUCCESS') => ({ status, purchaseId: '1c000000-0000-4000-8000-000000000001', userId: user,
  passType: 'jeongseok.visitor.day', currencyId: 'currency.induck_coin', price: 100, balanceBefore: 150, balanceAfter: 50,
  issuedAt: NOW, expiresAt: LATER, walletTransactionId: '2c000000-0000-4000-8000-000000000002', idempotencyKey: key, access: granted(user) });
const memoryStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

function fakeServer(handlers) {
  const calls = [];
  return { calls, client: { rpc: async (name, args) => { calls.push({ name, args }); return handlers[name](args, calls); } } };
}
const instant = { setTimer: fn => { fn(); return 1; }, clearTimer: () => {} };

test('parser accepts only the documented, account-bound server decision', () => {
  assert.equal(parseAccessSnapshot(read(), A).decision, 'NEEDS_PASS');
  assert.equal(parseAccessSnapshot(read(), B), null, 'a decision about another account is rejected');
  assert.equal(parseAccessSnapshot(read({ granted: true }), A), null, 'granted must match the decision');
  assert.equal(parseAccessSnapshot(read({ decision: 'GRANTED', granted: true, via: 'INHA_MAIL', inhaMailVerified: false, offer: null }), A), null,
    'free entry requires the server mail badge');
  assert.equal(parseAccessSnapshot(read({ decision: 'GRANTED', granted: true, via: 'VISITOR_PASS', pass: pass(false), offer: null }), A), null,
    'a pass grant needs an active server pass');
  assert.equal(parseAccessSnapshot(read({ offer: { ...offer(150), canPurchase: false } }), A), null, 'offer arithmetic is the server contract');
  assert.equal(parseAccessSnapshot(read({ offer: { status: 'COMING_SOON', price: 100, canPurchase: false } }), A), null,
    'a closed product must not carry a price');
  assert.equal(parseAccessSnapshot(read({ decision: 'COMING_SOON', userId: null, inhaMailVerified: null, offer: null }), A).decision, 'COMING_SOON');
  assert.equal(parseAccessSnapshot({ ...read(), version: 2 }, A), null);
  assert.equal(parseAccessSnapshot(null, A), null);
});

test('purchase parser binds account, key and pass type and checks money math', () => {
  assert.ok(parsePurchaseResult(receipt('jsl:k'), { accountId: A, key: 'jsl:k', passType: 'jeongseok.visitor.day' }));
  assert.equal(parsePurchaseResult(receipt('jsl:k', B), { accountId: A, key: 'jsl:k', passType: 'jeongseok.visitor.day' }), null);
  assert.equal(parsePurchaseResult(receipt('jsl:other'), { accountId: A, key: 'jsl:k', passType: 'jeongseok.visitor.day' }), null);
  assert.equal(parsePurchaseResult({ ...receipt('jsl:k'), balanceAfter: 60 }, { accountId: A, key: 'jsl:k', passType: 'jeongseok.visitor.day' }), null);
});

test('server failure is UNKNOWN, never "not verified", and signed-out makes no call', async () => {
  const server = fakeServer({ get_jeongseok_access_v1: async () => ({ error: { message: 'boom' } }) });
  const access = createJeongseokAccessClient({ getClient: () => server.client });
  assert.equal(access.state, ACCESS_STATE.SIGNED_OUT);
  assert.equal(await access.refresh(), null);
  assert.equal(server.calls.length, 0, 'no account, no RPC');
  await access.setAccount(A);
  assert.equal(access.state, ACCESS_STATE.UNKNOWN);
  assert.equal(access.snapshot, null);
});

test('late reply after an account switch never lands on the new account', async () => {
  const replies = [];
  const server = fakeServer({ get_jeongseok_access_v1: () => new Promise(resolve => { replies.push(resolve); }) });
  const access = createJeongseokAccessClient({ getClient: () => server.client });
  const pending = access.setAccount(A);
  const switched = access.setAccount(B);
  replies[0]({ data: granted(A) });
  await pending;
  assert.equal(access.accountId, B);
  assert.equal(access.snapshot, null, 'A grant does not show for B');
  replies[1]({ data: read({ userId: B }) });
  await switched;
  assert.equal(access.snapshot.userId, B);
  await access.setAccount(null);
  assert.deepEqual([access.state, access.snapshot], [ACCESS_STATE.SIGNED_OUT, null]);
});

test('lost purchase reply is recovered with the same key; a definitive refusal frees it', async () => {
  const storage = memoryStorage();
  let attempt = 0;
  const server = fakeServer({
    get_jeongseok_access_v1: async () => ({ data: read() }),
    purchase_jeongseok_pass_v1: async args => (++attempt === 1 ? { error: { message: 'Failed to fetch' } } : { data: receipt(args.p_idempotency_key, A, 'ALREADY_PROCESSED') })
  });
  let n = 0;
  const access = createJeongseokAccessClient({ getClient: () => server.client, storage: () => storage, newKey: () => `jsl:key-${++n}` });
  await access.setAccount(A);
  assert.equal(await access.purchase(), null);
  assert.equal(access.view().purchaseError, 'UNKNOWN');
  assert.equal(access.view().pendingKey, true, 'key kept for recovery');
  // A reload keeps the key per account.
  const reloaded = createJeongseokAccessClient({ getClient: () => server.client, storage: () => storage, newKey: () => `jsl:key-${++n}` });
  await reloaded.setAccount(A);
  const result = await reloaded.purchase();
  assert.equal(result.status, 'ALREADY_PROCESSED');
  const keys = server.calls.filter(c => c.name === 'purchase_jeongseok_pass_v1').map(c => c.args.p_idempotency_key);
  assert.deepEqual(keys, ['jsl:key-1', 'jsl:key-1'], 'the same key was replayed, never a new one');
  assert.equal(reloaded.view().pendingKey, false);
  assert.equal(storage.m.size, 0, 'resolved key removed');
  for (const call of server.calls.filter(c => c.name === 'purchase_jeongseok_pass_v1'))
    assert.deepEqual(Object.keys(call.args).sort(), ['p_idempotency_key', 'p_pass_type'], 'client sends no price, user or expiry');

  const poor = fakeServer({ get_jeongseok_access_v1: async () => ({ data: read({ offer: offer(10) }) }),
    purchase_jeongseok_pass_v1: async () => ({ error: { message: 'INSUFFICIENT_FUNDS' } }) });
  const client2 = createJeongseokAccessClient({ getClient: () => poor.client, storage: () => storage });
  await client2.setAccount(B);
  await client2.purchase();
  assert.deepEqual([client2.view().purchaseError, client2.view().pendingKey], ['INSUFFICIENT_FUNDS', false]);
});

test('gate reload: a stored unresolved key can be replayed from IDLE, with no new charge key', async () => {
  const storage = memoryStorage();
  storage.setItem(`inha-world:jeongseok-pass-key:${A}`, 'jsl:pre-reload');
  const server = fakeServer({
    // The first purchase committed before reload, so the fresh server already sees a grant.
    get_jeongseok_access_v1: async () => ({ data: granted() }),
    purchase_jeongseok_pass_v1: async args => ({ data: receipt(args.p_idempotency_key, A, 'ALREADY_PROCESSED') })
  });
  const access = createJeongseokAccessClient({
    getClient: () => server.client, storage: () => storage,
    newKey: () => { throw Error('must reuse the saved key'); }
  });
  await access.setAccount(A);
  const gate = createJeongseokGateController({ access, setTimer: () => 1, clearTimer: () => {} });
  assert.equal(gate.state, GATE_STATE.IDLE, 'fresh controller does not inherit old gate state');
  assert.equal(access.view().pendingKey, true, 'the purchase key survived reload');
  assert.equal(await gate.purchase(), true, 'saved-key recovery is accepted from IDLE');
  const purchases = server.calls.filter(c => c.name === 'purchase_jeongseok_pass_v1');
  assert.equal(purchases.length, 1, 'one replay only');
  assert.equal(purchases[0].args.p_idempotency_key, 'jsl:pre-reload');
  assert.equal(access.view().pendingKey, false, 'successful replay clears saved key');
  assert.equal(gate.state, GATE_STATE.SCANNING, 'fresh server grant drives the animation');
});

test('pending key is account scoped: B never replays A\'s request', async () => {
  const storage = memoryStorage();
  storage.setItem(`inha-world:jeongseok-pass-key:${A}`, 'jsl:a-only');
  const server = fakeServer({ get_jeongseok_access_v1: async () => ({ data: read({ userId: B }) }),
    purchase_jeongseok_pass_v1: async args => ({ data: receipt(args.p_idempotency_key, B) }) });
  const access = createJeongseokAccessClient({ getClient: () => server.client, storage: () => storage, newKey: () => 'jsl:b-new' });
  await access.setAccount(B);
  await access.purchase();
  assert.equal(server.calls.find(c => c.name === 'purchase_jeongseok_pass_v1').args.p_idempotency_key, 'jsl:b-new');
  assert.equal(storage.getItem(`inha-world:jeongseok-pass-key:${A}`), 'jsl:a-only');
});

test('gate: verified/pass tag sequence, then entry asks the server again', async () => {
  const server = fakeServer({ get_jeongseok_access_v1: async () => ({ data: granted() }) });
  const access = createJeongseokAccessClient({ getClient: () => server.client });
  await access.setAccount(A);
  const seen = [], cues = [];
  const gate = createJeongseokGateController({ access, ...instant, onCue: c => cues.push(c), onChange: v => seen.push(v.state) });
  await gate.start();
  assert.deepEqual(seen.slice(0, 6), ['CHECKING', 'SCANNING', 'GRANTED', 'OPENING', 'READY_TO_ENTER', 'IDLE']);
  assert.deepEqual(cues, ['scan', 'grant', 'open']);
  // A held READY_TO_ENTER is not a credential: entry re-reads.
  const slow = createJeongseokGateController({ access, setTimer: () => 1, clearTimer: () => {} });
  await slow.start();
  assert.equal(slow.state, GATE_STATE.SCANNING);
});

test('gate: READY_TO_ENTER re-verifies; a pass that expired meanwhile is refused', async () => {
  let current = granted();
  const server = fakeServer({ get_jeongseok_access_v1: async () => ({ data: current }) });
  const access = createJeongseokAccessClient({ getClient: () => server.client });
  await access.setAccount(A);
  const timers = [];
  let entered = 0;
  const gate = createJeongseokGateController({ access, setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {},
    onEnter: () => { entered++; return { status: 'PENDING_JSL_B' }; } });
  await gate.start();
  timers.shift()(); timers.shift()(); timers.shift()();
  assert.equal(gate.state, GATE_STATE.READY_TO_ENTER);
  const outcome = await gate.enter();
  assert.deepEqual([outcome.status, entered, gate.snapshot().notice], ['PENDING_JSL_B', 1, 'PENDING_JSL_B']);
  current = read({ decision: 'EXPIRED', pass: pass(false) });
  const calls = server.calls.length;
  assert.equal(await gate.enter(), null);
  assert.equal(server.calls.length, calls + 1, 'entry made a fresh server read');
  assert.deepEqual([gate.state, entered], [GATE_STATE.EXPIRED, 1]);
});

test('gate: refusals map to their states and never reach onEnter', async () => {
  const cases = [
    [read(), GATE_STATE.NEEDS_PASS], [read({ decision: 'EXPIRED', pass: pass(false) }), GATE_STATE.EXPIRED],
    [read({ decision: 'AUTH_REQUIRED', userId: null, inhaMailVerified: null, offer: null }), GATE_STATE.AUTH_REQUIRED],
    [read({ decision: 'ACCOUNT_BLOCKED', inhaMailVerified: null, offer: null }), GATE_STATE.ACCOUNT_BLOCKED],
    [read({ decision: 'COMING_SOON', userId: null, inhaMailVerified: null, offer: null }), GATE_STATE.DISABLED],
    [read({ decision: 'DISABLED', userId: null, inhaMailVerified: null, offer: null }), GATE_STATE.DISABLED],
    [{ forged: true, granted: true }, GATE_STATE.UNKNOWN]
  ];
  for (const [reply, expected] of cases) {
    const server = fakeServer({ get_jeongseok_access_v1: async () => ({ data: reply }) });
    const access = createJeongseokAccessClient({ getClient: () => server.client });
    await access.setAccount(A);
    let entered = false;
    const gate = createJeongseokGateController({ access, ...instant, onEnter: () => { entered = true; } });
    await gate.start();
    assert.equal(gate.state, expected, JSON.stringify(reply));
    assert.equal(await gate.enter(), null);
    assert.equal(entered, false);
  }
  const off = createJeongseokGateController({ access: createJeongseokAccessClient({ getClient: () => null }), isEnabled: () => false, ...instant });
  await off.start();
  assert.equal(off.state, GATE_STATE.DISABLED, 'client-closed feature never calls the server');
  const guest = createJeongseokGateController({ access: createJeongseokAccessClient({ getClient: () => null }), ...instant });
  await guest.start();
  assert.equal(guest.state, GATE_STATE.AUTH_REQUIRED);
});

test('gate: purchase → fresh read → tag; double click buys once; cancel is blocked while paying', async () => {
  let after = read(), release;
  const server = fakeServer({
    get_jeongseok_access_v1: async () => ({ data: after }),
    purchase_jeongseok_pass_v1: args => new Promise(resolve => { release = () => { after = granted(); resolve({ data: receipt(args.p_idempotency_key) }); }; })
  });
  const access = createJeongseokAccessClient({ getClient: () => server.client });
  await access.setAccount(A);
  const gate = createJeongseokGateController({ access, setTimer: () => 1, clearTimer: () => {} });
  await gate.start();
  assert.deepEqual([gate.state, gate.snapshot().canPurchase], [GATE_STATE.NEEDS_PASS, true]);
  const first = gate.purchase(), second = gate.purchase();
  assert.equal(gate.state, GATE_STATE.PURCHASING);
  assert.equal(gate.reset(), false, 'cannot cancel a payment in flight');
  assert.equal(gate.snapshot().canCancel, false);
  await new Promise(r => setTimeout(r, 0));
  release();
  assert.equal(await second, false);
  await first;
  assert.equal(server.calls.filter(c => c.name === 'purchase_jeongseok_pass_v1').length, 1, 'one purchase RPC');
  assert.equal(gate.state, GATE_STATE.SCANNING, 'tag starts only after the fresh server read');
  assert.equal(gate.snapshot().notice, 'ISSUED');
});

test('gate: insufficient funds shows the server shortfall and stays retryable', async () => {
  const server = fakeServer({ get_jeongseok_access_v1: async () => ({ data: read({ offer: offer(150) }) }),
    purchase_jeongseok_pass_v1: async () => ({ error: { message: 'INSUFFICIENT_FUNDS' } }) });
  const access = createJeongseokAccessClient({ getClient: () => server.client });
  await access.setAccount(A);
  const gate = createJeongseokGateController({ access, ...instant });
  await gate.start();
  await gate.purchase();
  assert.equal(gate.state, GATE_STATE.INSUFFICIENT_FUNDS);
  assert.match(gateMessage({ ...gate.snapshot(), offer: offer(40) }), /60개 부족/);
});

test('gate: cancel before paying makes no purchase call; account switch resets', async () => {
  const server = fakeServer({ get_jeongseok_access_v1: async () => ({ data: read() }) });
  const access = createJeongseokAccessClient({ getClient: () => server.client });
  await access.setAccount(A);
  const gate = createJeongseokGateController({ access, ...instant });
  await gate.start();
  assert.equal(gate.reset(), true);
  assert.equal(gate.state, GATE_STATE.IDLE);
  assert.equal(server.calls.some(c => c.name === 'purchase_jeongseok_pass_v1'), false);
  await gate.start();
  gate.accountChanged();
  assert.equal(gate.state, GATE_STATE.IDLE);
});

test('context action labels follow the gate state', () => {
  const base = { busy: false };
  assert.equal(gateContextAction({ ...base, state: 'IDLE' }, { distance: 1 }).label, '학생증 태그');
  assert.equal(gateContextAction({ ...base, state: 'NEEDS_PASS' }, { distance: 1 }).label, '방문증 안내');
  assert.equal(gateContextAction({ ...base, state: 'READY_TO_ENTER' }, { distance: 1 }).label, '정석 입장');
  assert.equal(gateContextAction({ ...base, state: 'IDLE' }, { distance: 1 }).priority, 155);
});

test('temporary reader derives from canonical bldg_jungseok geometry and opens no room', () => {
  assert.equal(JEONGSEOK_GATE.classification, 'GAME_ADAPTATION');
  assert.equal(JEONGSEOK_GATE.status, 'TEMPORARY');
  assert.equal(JEONGSEOK_GATE.interiorLink, 'PENDING_JSL_B');
  assert.equal(polygonOverlap(JEONGSEOK_GATE.position.x, JEONGSEOK_GATE.position.z, JEONGSEOK_FOOTPRINT), false, 'reader is outside the facade');
  assert.equal(getPlaceZoneAt(JEONGSEOK_GATE.position).id, 'AREA_JUNGSEOK_WOONAM');
  assert.equal(nearJeongseokGate(JEONGSEOK_GATE.position), 0);
  assert.equal(nearJeongseokGate({ x: JEONGSEOK_GATE.position.x + 5, z: JEONGSEOK_GATE.position.z }), null);
  // No Jeongseok room or door exists until JSL-B: nothing to teleport, resume or join into.
  assert.equal(isRoomId('ROOM_JEONGSEOK_LOBBY'), false);
  assert.equal(ROOM_ENTRANCES.some(e => /JEONGSEOK|JUNGSEOK/i.test(e.id + e.roomId)), false);
});

test('integration stays closed by default and never computes balances or rights', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const feature = await readFile(new URL('../src/jeongseok/jeongseok-feature.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../src/jeongseok/access-client.js', import.meta.url), 'utf8');
  assert.match(main, /const jeongseokGatePreview = previewHost && startupParams\.get\('jeongseok'\) === 'jsl-a';/);
  assert.match(main, /isEnabled: \(\) => jeongseokGatePreview/);
  assert.match(main, /void jeongseok\.setAccount\(identity \? online\?\.userId \?\? null : null\);/);
  assert.match(main, /void wallet\.refresh\("jeongseok-pass"\)/);
  assert.doesNotMatch(feature + client, /rooms\.enter|enterNested|teleport\(|\.channel\(|'world:room:|"world:room:/);
  assert.doesNotMatch(client, /balance\s*-\s*|-\s*price|\+\s*86400|Date\.now\(\)\s*\+\s*\d/);
});

test('gate copy joins notices readably and never invents a shortfall', () => {
  assert.equal(gateMessage({ state: 'GRANTED', via: 'VISITOR_PASS', notice: 'RECOVERED' }), '가상 정석 방문증 · 출입 승인 · 이전에 발급된 방문증을 확인했어요.');
  assert.match(gateMessage({ state: 'READY_TO_ENTER', notice: 'PENDING_JSL_B' }), /^게이트가 열렸어요\. 출입 자격이 서버에서 다시 확인됐어요/);
  assert.equal(gateMessage({ state: 'INSUFFICIENT_FUNDS', offer: null }), '인덕코인이 부족해 방문증을 발급할 수 없어요.');
  assert.equal(gateMessage({ state: 'DISABLED', decision: 'COMING_SOON' }), '정석학술정보관 출입은 준비 중이에요.');
});
