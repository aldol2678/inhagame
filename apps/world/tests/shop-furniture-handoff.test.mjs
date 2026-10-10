import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createShopClient, SHOP_READ_RPC, SHOP_PURCHASE_RPC, SHOP_STUDENT_CENTER } from '../src/shop/shop-client.js';
import { createInventoryClient, INVENTORY_RPC } from '../src/inventory/inventory-client.js';
import { createShopPanel } from '../src/shop/shop-panel.js';
import { ROOM_FURNITURE } from '../src/rooms/furniture-layout.js';
import { furnitureOfferDetails, ownsShopFurniture, createShopFurnitureHandoff } from '../src/shop/shop-furniture-handoff.js';
import { createFakeDocument } from './support/fake-dom.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM = 'furniture.induck_cushion';
const offer = { listingId: 'fixture.cushion', itemId: ITEM, currencyId: 'currency.induck_coin', price: 120,
  quantity: 1, requiredLevel: null, purchaseLimit: null, startAt: null, endAt: null,
  status: 'ACTIVE', purchasable: true, unavailableReason: null };
const snapshot = (offers = [offer]) => ({ shopId: SHOP_STUDENT_CENTER, status: 'ACTIVE', playerLevel: 1, offers });
const owned = (itemId = ITEM) => ({ items: itemId ? [{ itemId, quantity: 1, acquiredAt: '2026-10-10T00:00:00Z',
  sourceType: 'SHOP', sourceRef: offer.listingId, catalogStatus: 'ACTIVE' }] : [] });
const ok = data => ({ data, error: null });
const failure = { data: null, error: { message: 'private.fixture_failure' } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const byClass = (h, name) => walk(h.panel).filter(node => node.className.split(/\s+/).includes(name));
const text = node => [node.textContent ?? '', ...(node.children ?? []).map(text)].join(' ');
const buy = h => byClass(h, 'shop-offer-buy')[0];
const action = h => byClass(h, 'shop-furniture-action')[0];

async function harness() {
  const doc = createFakeDocument(), panel = doc.createElement('section');
  const calls = [], queues = new Map(), statuses = [], decorated = [];
  const respond = (rpc, value) => { if (!queues.has(rpc)) queues.set(rpc, []); queues.get(rpc).push(value); };
  const client = { rpc(name, args) {
    calls.push({ name, args });
    assert.ok(queues.get(name)?.length, `missing fixture: ${name}`);
    return Promise.resolve(queues.get(name).shift());
  } };
  const shop = createShopClient({ getClient: () => client, createKey: () => `fixture:${calls.length}` });
  const inventory = createInventoryClient({ getClient: () => client });
  const ui = createShopPanel({ panel, doc, shop, inventory,
    onPurchase: () => inventory.refresh('purchase'),
    getFurnitureAction: () => ({ label: '내 방 꾸미기', text: '배치할 수 있어요.' }),
    onDecorate: itemId => { decorated.push(itemId); return true; }, onStatus: value => statuses.push(value) });
  respond(INVENTORY_RPC, ok(owned(null))); await inventory.setAccount(A);
  respond(SHOP_READ_RPC, ok(snapshot())); shop.setAccount(A); ui.setOpen(true); await flush();
  return { doc, panel, shop, inventory, ui, respond, calls, statuses, decorated,
    writes: () => calls.filter(call => call.name === SHOP_PURCHASE_RPC),
    startPurchase(read = ok(owned()), shopRead = ok(snapshot())) {
      respond(SHOP_PURCHASE_RPC, ok({ status: 'SUCCESS' })); respond(SHOP_READ_RPC, shopRead); respond(INVENTORY_RPC, read);
      buy(this).click();
    } };
}

test('furniture offer metadata comes from all actual placement definitions; non-furniture has no invented size', () => {
  for (const item of ROOM_FURNITURE) {
    const details = furnitureOfferDetails(item.itemId);
    assert.equal(details.sizeText, `크기 (월드 단위): 가로 ${item.width} × 높이 ${item.height} × 깊이 ${item.depth}`);
  }
  assert.equal(furnitureOfferDetails('furniture.campus_map_poster').surfaceText, '놓을 곳: 벽');
  assert.equal(furnitureOfferDetails(ITEM).surfaceText, '놓을 곳: 바닥 · 침대 위');
  assert.equal(furnitureOfferDetails('furniture.dorm_monitor').surfaceText, '놓을 곳: 책상 위');
  assert.equal(furnitureOfferDetails('furniture.unknown'), null);
  assert.equal(furnitureOfferDetails('memorabilia.campus_mug'), null);
});

test('successful purchase waits for a fresh Inventory read, blocks duplicate/stale clicks, then offers decorating', async () => {
  const h = await harness(), read = deferred(), oldButton = buy(h);
  assert.match(text(h.panel), /가로 0\.45 × 높이 0\.14 × 깊이 0\.4/);
  h.startPurchase(read.promise); oldButton.click(); await flush();
  assert.equal(h.shop.isPending(offer.listingId), false, 'Shop pending has ended before Inventory does');
  assert.equal(buy(h).disabled, true); buy(h).click(); oldButton.click();
  assert.equal(h.writes().length, 1);
  assert.equal(action(h).disabled, true); assert.equal(h.decorated.length, 0);
  assert.match(text(h.panel), /구매는 완료됐어요/);
  read.resolve(ok(owned())); await flush();
  assert.equal(action(h).textContent, '내 방 꾸미기'); assert.equal(buy(h).textContent, '추가 구매');
  action(h).click(); assert.deepEqual(h.decorated, [ITEM]); assert.equal(h.ui.open, false);
});

for (const read of [failure, ok(owned(null))]) test(`confirmed purchase + ${read.error ? 'failed' : 'missing-item'} Inventory offers only read retry`, async () => {
  const h = await harness(); h.startPurchase(read); await flush();
  assert.match(text(h.panel), /구매 완료/); assert.match(text(h.panel), /다시 구매하지 말고/);
  assert.doesNotMatch(text(h.panel), /private.fixture_failure/);
  assert.equal(buy(h).disabled, true); assert.equal(action(h).textContent, '보유 가구 다시 확인');
  h.ui.setOpen(false); h.respond(SHOP_READ_RPC, ok(snapshot())); h.ui.setOpen(true); await flush();
  assert.equal(buy(h).disabled, true, 'successful receipt survives close/reopen');
  const pending = deferred(), retry = action(h); h.respond(INVENTORY_RPC, pending.promise); retry.click(); retry.click();
  assert.equal(action(h).disabled, true); action(h).click(); assert.equal(h.writes().length, 1);
  pending.resolve(ok(owned())); await flush(); assert.equal(action(h).textContent, '내 방 꾸미기');
  assert.equal(h.writes().length, 1, 'Inventory recovery never re-buys');
});

test('retry remains reachable when shop readback fails or the server removes the listing', async () => {
  for (const shopRead of [failure, ok(snapshot([]))]) {
    const h = await harness(); h.startPurchase(failure, shopRead); await flush();
    assert.equal(byClass(h, 'shop-purchased-furniture').length, 1);
    assert.equal(action(h).textContent, '보유 가구 다시 확인');
    h.respond(INVENTORY_RPC, ok(owned())); action(h).click(); await flush();
    assert.equal(action(h).textContent, '내 방 꾸미기'); assert.equal(h.writes().length, 1);
  }
});

test('purchase failure has no receipt and transport retry keeps its original idempotency key', async () => {
  const h = await harness(); h.respond(SHOP_PURCHASE_RPC, failure); buy(h).click(); await flush();
  assert.equal(action(h), undefined); assert.equal(buy(h).disabled, false);
  h.startPurchase(); await flush();
  assert.equal(h.writes().length, 2);
  assert.equal(h.writes()[0].args.p_idempotency_key, h.writes()[1].args.p_idempotency_key);
});

test('closing during Inventory confirmation never reopens or navigates; receipt remains recoverable', async () => {
  const h = await harness(), read = deferred(); h.startPurchase(read.promise); await flush();
  h.ui.setOpen(false); read.resolve(failure); await flush();
  assert.equal(h.ui.open, false); assert.equal(h.panel.children.length, 0);
  assert.deepEqual(h.decorated, []); assert.deepEqual(h.statuses, []);
  h.respond(SHOP_READ_RPC, ok(snapshot())); h.ui.setOpen(true); await flush();
  assert.equal(action(h).textContent, '보유 가구 다시 확인'); assert.equal(h.writes().length, 1);
});

for (const transition of ['B', 'A-B-A', 'logout']) test(`late Inventory confirmation is isolated across ${transition}`, async () => {
  const h = await harness(), read = deferred(); h.startPurchase(read.promise); await flush();
  h.shop.setAccount(transition === 'logout' ? null : B);
  if (transition === 'logout') await h.inventory.setAccount(null);
  else { h.respond(INVENTORY_RPC, ok(owned())); await h.inventory.setAccount(B); }
  if (transition === 'A-B-A') { h.shop.setAccount(A); h.respond(INVENTORY_RPC, ok(owned(null))); await h.inventory.setAccount(A); }
  read.resolve(ok(owned())); await flush();
  assert.equal(action(h), undefined); assert.deepEqual(h.statuses, []); assert.deepEqual(h.decorated, []);
});

test('Inventory loss after a successful read suppresses the action and blocks repurchase until read-only recovery', async () => {
  const h = await harness(); h.startPurchase(); await flush(); const oldAction = action(h);
  h.respond(INVENTORY_RPC, failure); await h.inventory.refresh();
  assert.equal(action(h).textContent, '보유 가구 다시 확인'); assert.equal(buy(h).disabled, true);
  oldAction.click(); assert.deepEqual(h.decorated, []);
});

function handoffHarness() {
  let accountId = A;
  const inventory = { accountId: A, state: 'READY', snapshot: owned() };
  const context = { available: true, space: 'ROOM_PERSONAL_BASIC', busy: false,
    metadata: { visitRole: 'owner', ownerUserId: A, personalRoomId: ROOM },
    furniture: { roomId: ROOM, role: 'owner', ready: true, reading: false, pending: false, error: null },
    session: { active: true, role: 'owner', ownerUserId: A, roomId: ROOM } };
  const calls = [];
  const handoff = createShopFurnitureHandoff({ inventory, getAccountId: () => accountId, getContext: () => context,
    openEditor: () => { calls.push('editor'); return true; }, guideToDorm: () => { calls.push('guide'); return true; },
    onStatus: value => calls.push(value) });
  return { handoff, inventory, context, calls, setAccount: value => { accountId = value; } };
}

test('owned furniture opens only its authorized own-room editor; campus/lobby retain doorway flow', () => {
  const h = handoffHarness(); assert.equal(h.handoff.open(ITEM), true); assert.deepEqual(h.calls, ['editor']);
  h.context.space = 'campus'; assert.equal(h.handoff.action(ITEM).label, '내 방 가는 길'); assert.equal(h.handoff.open(ITEM), true);
  assert.equal(h.calls[1], 'guide'); assert.match(h.calls[2], /제1생활관 → 내 방 → 꾸미기/);
  h.context.space = 'ROOM_DORM1_LOBBY'; assert.equal(h.handoff.open(ITEM), true);
  assert.match(h.calls.at(-1), /로비의 내 방 문/); assert.equal(h.calls.filter(value => value === 'editor').length, 1);
});

for (const [label, change] of [
  ['visitor', h => { h.context.metadata.visitRole = 'visitor'; }],
  ['another owner', h => { h.context.metadata.ownerUserId = B; }],
  ['layout visitor', h => { h.context.furniture.role = 'visitor'; }],
  ['other layout', h => { h.context.furniture.roomId = B; }],
  ['missing layout', h => { h.context.furniture.ready = false; }],
  ['layout pending', h => { h.context.furniture.pending = true; }],
  ['layout reading', h => { h.context.furniture.reading = true; }],
  ['layout denied', h => { h.context.furniture.error = 'LAYOUT_DENIED'; }],
  ['session visitor', h => { h.context.session.role = 'visitor'; }],
  ['session absent', h => { h.context.session.active = false; }],
  ['transition', h => { h.context.busy = true; }],
  ['mounted/lobby shell', h => { h.context.available = false; }],
  ['other interior', h => { h.context.space = 'ROOM_CLUBHOUSE_01'; }],
  ['identity mismatch', h => { h.setAccount(B); }],
  ['Inventory unavailable', h => { h.inventory.state = 'UNAVAILABLE'; }],
  ['not owned', h => { h.inventory.snapshot = owned(null); }]
]) test(`furniture handoff rechecks ${label} at activation`, () => {
  const h = handoffHarness(); assert.ok(h.handoff.action(ITEM)); change(h);
  assert.equal(h.handoff.action(ITEM), null); assert.equal(h.handoff.open(ITEM), false); assert.deepEqual(h.calls, []);
});

test('ownership rejects unavailable/foreign/unknown/zero rows rather than inferring from purchase', () => {
  const h = handoffHarness(); assert.equal(ownsShopFurniture(h.inventory, A, ITEM), true);
  assert.equal(ownsShopFurniture(h.inventory, B, ITEM), false);
  assert.equal(ownsShopFurniture(h.inventory, A, 'furniture.unknown'), false);
  h.inventory.snapshot.items[0].quantity = 0; assert.equal(ownsShopFurniture(h.inventory, A, ITEM), false);
});

test('main awaits Inventory purchase read and passes live server room authority to the handoff', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /getFurnitureAction: itemId => shopFurnitureHandoff\.action\(itemId\)/);
  assert.match(main, /onDecorate: itemId => shopFurnitureHandoff\.open\(itemId\)/);
  assert.match(main, /const inventoryRead = inventory\.refresh\("purchase"\);\s*void loadout\.refresh\("purchase"\);\s*return inventoryRead;/);
  const helper = readFileSync(new URL('../src/shop/shop-furniture-handoff.js', import.meta.url), 'utf8');
  assert.doesNotMatch(helper, /\.rpc\(|enterNested|\.purchase\(|localStorage/);
});

test('the seven catalog additions stay server-locked, keep server prices, and are never invented as offers', async () => {
  const h = await harness();
  const additions = ['dorm_single_sofa', 'dorm_side_table_low', 'dorm_bookshelf_slim', 'dorm_plant_medium',
    'dorm_monitor', 'dorm_trophy_shelf', 'study_books_set'];
  const locked = additions.map((id, index) => ({ ...offer, listingId: `locked.${id}`, itemId: `furniture.${id}`,
    price: 731 + index, purchasable: false, unavailableReason: 'LISTING_LOCKED' }));
  h.respond(SHOP_READ_RPC, ok(snapshot(locked))); await h.shop.refresh();
  assert.equal(byClass(h, 'shop-offer').length, additions.length);
  for (const [index, button] of byClass(h, 'shop-offer-buy').entries()) {
    assert.equal(button.disabled, true); button.click();
    assert.match(text(byClass(h, 'shop-offer')[index]), new RegExp(`${731 + index} 인덕코인`));
  }
  assert.equal(h.writes().length, 0);
  h.respond(SHOP_READ_RPC, ok(snapshot([]))); await h.shop.refresh();
  assert.equal(byClass(h, 'shop-offer').length, 0, 'catalog definitions do not create listings');
});

test('closing a failed Inventory retry preserves success and never starts navigation or another purchase', async () => {
  const h = await harness(); h.startPurchase(failure); await flush();
  const pending = deferred(); h.respond(INVENTORY_RPC, pending.promise); action(h).click();
  h.ui.setOpen(false); pending.resolve(failure); await flush();
  assert.equal(h.ui.open, false); assert.deepEqual(h.decorated, []); assert.equal(h.writes().length, 1);
  h.respond(SHOP_READ_RPC, ok(snapshot())); h.ui.setOpen(true); await flush();
  assert.equal(action(h).textContent, '보유 가구 다시 확인'); assert.equal(buy(h).disabled, true);
});
