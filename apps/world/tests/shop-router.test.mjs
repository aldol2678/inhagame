import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopRouter } from '../src/shop/shop-router.js';
import { createShopPanel } from '../src/shop/shop-panel.js';
import { SHOP_CAPABILITIES_RPC } from '../src/shop/shop-capabilities.js';
import { SHOP_READ_RPC, SHOP_SCOPED_PURCHASE_RPC } from '../src/shop/shop-client.js';
import { createFakeDocument } from './support/fake-dom.mjs';

const STUDENT = 'shop.student_center', DORM = 'shop.dorm_furniture';
const offer = (id, itemId = 'memorabilia.campus_mug') => ({ listingId: id, itemId,
  currencyId: 'currency.induck_coin', price: 120, quantity: 1, requiredLevel: null,
  purchaseLimit: null, startAt: null, endAt: null, status: 'ACTIVE', purchasable: true, unavailableReason: null });
const snapshot = shopId => ({ shopId, displayName: shopId === DORM ? '생활관 가구점' : '학생회관 굿즈샵',
  status: 'ACTIVE', playerLevel: 3, offers: [offer(shopId + '.listing')] });
const ok = data => ({ data, error: null });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const text = node => walk(node).map(n => n.textContent ?? '').join(' ');
function harness() {
  const calls = [], queues = new Map(); let keys = 0;
  const client = { rpc(fn, args) {
    calls.push({ fn, args });
    const queue = queues.get(fn);
    if (fn === SHOP_CAPABILITIES_RPC && !queue?.length) return Promise.resolve(ok({version:1,purchaseRpc:SHOP_SCOPED_PURCHASE_RPC,catalogLayout:'split'}));
    return Promise.resolve(queue?.length ? queue.shift() : fn === SHOP_READ_RPC ? ok(snapshot(args.p_shop_id)) : ok({ status: 'SUCCESS' }));
  } };
  const shop = createShopRouter({ getClient: () => client, shopIds: [STUDENT, DORM], createKey: () => 'key:' + ++keys });
  const queue = (fn, response) => { if (!queues.has(fn)) queues.set(fn, []); queues.get(fn).push(response); };
  const changes = []; shop.onChange(change => changes.push(change)); shop.setAccount('account-a');
  return { shop, calls, queue, changes };
}

test('shop selection uses exact server shop IDs and rejects wrong-shop snapshots/unknown routes', async () => {
  const h = harness(); await h.shop.refresh();
  assert.equal(h.shop.snapshot.shopId, STUDENT);
  assert.equal(h.shop.select('shop.unapproved'), false);
  assert.equal(h.shop.shopId, STUDENT);
  h.shop.select(DORM); h.queue(SHOP_READ_RPC, ok(snapshot(STUDENT))); await h.shop.refresh();
  assert.equal(h.shop.state, 'UNAVAILABLE'); assert.equal(h.shop.snapshot, null);
  assert.equal(h.calls.at(-1).args.p_shop_id, DORM);
});

test('rapid NPC switching isolates late reads and exposes only the selected shop', async () => {
  const h = harness(), slow = deferred();
  h.queue(SHOP_READ_RPC, slow.promise); const first = h.shop.refresh();
  h.shop.select(DORM); await h.shop.refresh();
  const changes = h.changes.length;
  slow.resolve(ok(snapshot(STUDENT))); await first;
  assert.equal(h.changes.length, changes); assert.equal(h.shop.snapshot.shopId, DORM);
  h.shop.select(STUDENT); assert.equal(h.shop.snapshot.shopId, STUDENT);
});

test('scoped purchase rejects stale listing callbacks and transmits selected shop to server', async () => {
  const h = harness(); await h.shop.refresh(); h.shop.select(DORM); await h.shop.refresh();
  assert.equal((await h.shop.purchase(STUDENT + '.listing')).code, 'INVALID_LISTING');
  assert.equal(h.calls.filter(c => c.fn === SHOP_SCOPED_PURCHASE_RPC).length, 0);
  assert.equal((await h.shop.purchase(DORM + '.listing')).outcome, 'SUCCESS');
  assert.equal(h.calls.find(c => c.fn === SHOP_SCOPED_PURCHASE_RPC).args.p_shop_id, DORM);
});

test('lost response retains original key across shop switch, reopen and retry', async () => {
  const h = harness(); await h.shop.refresh();
  h.queue(SHOP_SCOPED_PURCHASE_RPC, { data: null, error: { message: 'transport lost' } });
  assert.equal((await h.shop.purchase(STUDENT + '.listing')).outcome, 'FAILED');
  h.shop.select(DORM); await h.shop.refresh(); await h.shop.purchase(DORM + '.listing');
  h.shop.select(STUDENT); await h.shop.refresh('open'); await h.shop.purchase(STUDENT + '.listing');
  const buys = h.calls.filter(c => c.fn === SHOP_SCOPED_PURCHASE_RPC);
  assert.equal(buys[0].args.p_idempotency_key, buys[2].args.p_idempotency_key);
  assert.notEqual(buys[0].args.p_idempotency_key, buys[1].args.p_idempotency_key);
});

test('account switch invalidates every shop including hidden in-flight purchase', async () => {
  const h = harness(), slow = deferred(); await h.shop.refresh();
  h.queue(SHOP_SCOPED_PURCHASE_RPC, slow.promise); const purchase = h.shop.purchase(STUDENT + '.listing');
  h.shop.select(DORM); await h.shop.refresh(); h.shop.setAccount('account-b');
  assert.equal(h.shop.snapshot, null); h.shop.select(STUDENT); assert.equal(h.shop.snapshot, null);
  slow.resolve(ok({ status: 'SUCCESS' })); assert.equal((await purchase).outcome, 'STALE');
  await h.shop.refresh(); await h.shop.purchase(STUDENT + '.listing');
  const buys = h.calls.filter(c => c.fn === SHOP_SCOPED_PURCHASE_RPC);
  assert.notEqual(buys[0].args.p_idempotency_key, buys[1].args.p_idempotency_key);
});

test('panel late purchase refreshes authorities without overwriting another NPC title/status', async () => {
  const h = harness(), doc = createFakeDocument(), panel = doc.createElement('section'), slow = deferred();
  let readbacks = 0; const statuses = [];
  const ui = createShopPanel({ shop: h.shop, doc, panel, onPurchase: () => { readbacks++; }, onStatus: s => statuses.push(s) });
  ui.openShop(STUDENT); await flush();
  const oldBuy = walk(panel).find(n => n.className === 'shop-offer-buy');
  h.queue(SHOP_SCOPED_PURCHASE_RPC, slow.promise); oldBuy.click();
  ui.openShop(DORM); await flush(); oldBuy.click();
  slow.resolve(ok({ status: 'SUCCESS' })); await flush();
  assert.equal(readbacks, 1); assert.deepEqual(statuses, []);
  assert.match(text(panel), /생활관 가구점/); assert.doesNotMatch(text(panel), /구매 완료/);
  assert.equal(h.calls.filter(c => c.fn === SHOP_SCOPED_PURCHASE_RPC).length, 1);
  ui.setOpen(false); ui.openShop(STUDENT); await flush(); assert.match(text(panel), /학생회관 굿즈샵/);
});

test('moved listing lost response recovers original shop/key, including from new shop', async () => {
  const h = harness(), doc = createFakeDocument(), panel = doc.createElement('section');
  const ui = createShopPanel({ shop: h.shop, doc, panel });
  ui.openShop(STUDENT); await flush();
  h.queue(SHOP_SCOPED_PURCHASE_RPC, { data: null, error: { message: 'lost response' } });
  await h.shop.purchase(STUDENT + '.listing');
  h.queue(SHOP_READ_RPC, ok({ ...snapshot(STUDENT), offers: [] })); await h.shop.refresh();
  assert.match(text(panel), /구매 결과 다시 확인/);
  ui.openShop(DORM); await flush();
  h.queue(SHOP_READ_RPC, ok({ ...snapshot(DORM), offers: [offer(STUDENT + '.listing')] })); await h.shop.refresh();
  await h.shop.purchase(STUDENT + '.listing');
  const buys = h.calls.filter(c => c.fn === SHOP_SCOPED_PURCHASE_RPC);
  assert.equal(buys.length, 2);
  assert.deepEqual(buys[1].args, buys[0].args, 'retry keeps original shop and key across relocation');
});

test('dorm scoped furniture purchase keeps inventory confirmation and room handoff', async () => {
  const h = harness(), doc = createFakeDocument(), panel = doc.createElement('section'), read = deferred();
  const furniture = offer('offer.dorm_furniture.induck_cushion', 'furniture.induck_cushion');
  let decorated = 0;
  const inventory = { accountId: 'account-a', state: 'READY', snapshot: { items: [] }, onChange() {},
    refresh: async () => { await read.promise; inventory.snapshot = { items: [{ itemId: furniture.itemId, quantity: 1 }] }; return true; } };
  const ui = createShopPanel({ shop: h.shop, doc, panel, inventory,
    onPurchase: () => inventory.refresh(), getFurnitureAction: () => ({ label: '내 방 위치 안내', text: '로비의 내 방 문으로 들어가세요.' }),
    onDecorate: () => { decorated++; return true; } });
  h.queue(SHOP_READ_RPC, ok({ ...snapshot(DORM), offers: [furniture] })); ui.openShop(DORM); await flush();
  h.queue(SHOP_READ_RPC, ok({ ...snapshot(DORM), offers: [furniture] }));
  walk(panel).find(n => n.className === 'shop-offer-buy').click(); await flush();
  assert.match(text(panel), /보유 가구를 확인 중/);
  assert.equal(walk(panel).find(n => n.className === 'shop-offer-buy').disabled, true);
  read.resolve(); await flush();
  const action = walk(panel).find(n => n.className.includes('shop-furniture-action'));
  assert.equal(action.textContent, '내 방 위치 안내'); action.click();
  assert.equal(decorated, 1); assert.equal(ui.open, false);
  assert.equal(h.calls.find(c => c.fn === SHOP_SCOPED_PURCHASE_RPC).args.p_shop_id, DORM);
});
