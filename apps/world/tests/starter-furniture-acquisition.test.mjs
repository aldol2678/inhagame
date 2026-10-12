import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createShopClient, SHOP_READ_RPC, SHOP_SCOPED_PURCHASE_RPC } from '../src/shop/shop-client.js';
import { createInventoryClient, INVENTORY_RPC } from '../src/inventory/inventory-client.js';
import { createShopPanel } from '../src/shop/shop-panel.js';
import { createShopFurnitureHandoff, furnitureOfferDetails } from '../src/shop/shop-furniture-handoff.js';
import { createFurnitureClient } from '../src/rooms/furniture-client.js';
import { createFurnitureEditor } from '../src/rooms/furniture-editor.js';
import { canonicalFurniture, validateFurniture } from '../src/rooms/furniture-layout.js';
import { personalRoomSeatAnchors } from '../src/rooms/personal-room-seats.js';
import { createSeatInteraction } from '../src/seat-interaction.js';
import { getItemDefinition } from '../src/collection/item-catalog.js';
import { createFakeDocument, FakeElement } from './support/fake-dom.mjs';

const USER = '11111111-1111-4111-8111-111111111111', ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHOP = 'shop.dorm_furniture', BOOKS = 'furniture.study_books_set', SOFA = 'furniture.dorm_single_sofa';
const walk = n => [n, ...(n.children ?? []).flatMap(walk)];
const text = n => walk(n).map(x => x.textContent).join(' ');
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
// Minimal SVG/editor support; this tests interaction contracts, not browser pixels.
Object.defineProperty(FakeElement.prototype, 'firstChild', { get() { return this.children[0]; } });
Object.defineProperty(FakeElement.prototype, 'childElementCount', { get() { return this.children.length; } });
FakeElement.prototype.querySelectorAll = function(selector) {
  return walk(this).slice(1).filter(n => selector === '[data-focus]' ? !!n.dataset.focus
    : selector.includes('not(:disabled)') ? ['BUTTON','SELECT'].includes(n.tagName) && !n.disabled
      : n.tagName === selector.toUpperCase());
};
FakeElement.prototype.querySelector = function(s) { return this.querySelectorAll(s)[0] ?? null; };
FakeElement.prototype.remove = function() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); };

const rows = [BOOKS, SOFA].map((itemId, i) => ({ listingId: `offer.dorm_furniture.${itemId.split('.')[1]}`, itemId,
  currencyId: 'currency.induck_coin', price: [120,480][i], quantity: 1, requiredLevel: 1,
  purchaseLimit: null, startAt: null, endAt: null, status: 'ACTIVE', purchasable: true, unavailableReason: null }));

async function rig({ locked = false } = {}) {
  const doc = createFakeDocument(); doc.body = doc.createElement('body'); doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  const panel = doc.createElement('section'); doc.body.append(panel);
  const calls = [], owned = [], messages = []; let objects = [], revision = 0, ui, editor, releaseInventory;
  let pauseInventory = false, space = 'ROOM_DORM1_LOBBY';
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === SHOP_READ_RPC) return { data: { shopId: SHOP, displayName: '생활관 가구점', status: 'ACTIVE', playerLevel: 1,
      offers: rows.map(row => locked ? { ...row, status: 'LOCKED', purchasable: false, unavailableReason: 'LISTING_LOCKED' } : row) } };
    if (name === SHOP_SCOPED_PURCHASE_RPC) {
      assert.equal(args.p_shop_id, SHOP); assert.deepEqual(Object.keys(args).sort(), ['p_idempotency_key','p_listing_id','p_shop_id']);
      if (locked) return { error: { message: 'LISTING_LOCKED' } };
      const row = rows.find(r => r.listingId === args.p_listing_id);
      owned.push({ itemId: row.itemId, quantity: 1, acquiredAt: '2026-10-12T00:00:00Z', sourceType: 'SHOP', sourceRef: row.listingId, catalogStatus: 'COMING_SOON' });
      return { data: { status: 'SUCCESS' } };
    }
    if (name === INVENTORY_RPC) {
      if (pauseInventory) await new Promise(resolve => { releaseInventory = resolve; });
      return { data: { items: structuredClone(owned) } };
    }
    if (name === 'save_my_room_furniture_v1') { assert.equal(validateFurniture(args.p_objects, owned), null); objects = structuredClone(args.p_objects); revision++; }
    if (['get_world_room_furniture_v1','save_my_room_furniture_v1'].includes(name))
      return { data: { roomId: ROOM, role: 'owner', revision, objects } };
    throw Error(`Unexpected fixture RPC ${name}`);
  };
  const client = { rpc }, inventory = createInventoryClient({ getClient: () => client });
  const shop = createShopClient({ getClient: () => client, shopId: SHOP, scopedPurchase: true, createKey: () => `starter:${calls.length}` });
  const furniture = createFurnitureClient({ getClient: () => client, getUserId: () => USER, onChange: state => editor?.update(state) });
  editor = createFurnitureEditor({ doc, client: furniture, inventory });
  await furniture.bind(ROOM);
  const handoff = createShopFurnitureHandoff({ inventory, getAccountId: () => USER,
    getContext: () => ({ available: true, space, busy: false,
      metadata: { visitRole: 'owner', ownerUserId: USER, personalRoomId: ROOM }, furniture: furniture.state(),
      session: { active: true, roomId: ROOM, ownerUserId: USER, role: 'owner' } }),
    openEditor: () => editor.openEditor(), guideToDorm: () => true, onStatus: s => messages.push(s) });
  ui = createShopPanel({ panel, doc, shop, inventory, onPurchase: () => inventory.refresh('purchase'),
    getFurnitureAction: id => handoff.action(id), onDecorate: id => handoff.open(id) });
  await inventory.setAccount(USER); shop.setAccount(USER); ui.setOpen(true); await flush();
  const card = item => walk(panel).find(n => n.dataset.listingId === rows.find(r => r.itemId === item).listingId);
  const button = (item, className) => walk(card(item)).find(n => n.className.split(' ').includes(className));
  return { doc, panel, ui, inventory, shop, furniture, editor, handoff, calls, messages, owned,
    card, button, pause: () => { pauseInventory = true; }, resume: () => { pauseInventory = false; releaseInventory(); },
    enterOwnRoom: () => { space = 'ROOM_PERSONAL_BASIC'; },
    editorButton: label => walk(doc.body).find(n => n.tagName === 'BUTTON' && n.textContent === label),
    writes: () => calls.filter(c => c.name === SHOP_SCOPED_PURCHASE_RPC) };
}

test('two starter listings remain server-locked, with no invented inventory, offers, price or item activation', async () => {
  const h = await rig({ locked: true });
  for (const id of [BOOKS, SOFA]) {
    const buy = h.button(id, 'shop-offer-buy'); assert.equal(buy.disabled, true); buy.click();
    assert.equal(getItemDefinition(id).status, 'COMING_SOON');
    assert.match(text(h.card(id)), new RegExp(`${rows.find(r => r.itemId === id).price} 인덕코인`));
  }
  assert.equal(h.writes().length, 0); assert.equal(h.inventory.snapshot.items.length, 0);
});

test('books and sofa use shop → fresh inventory → lobby guide → owned editor → saved placement → real seat controller', async () => {
  const h = await rig();
  assert.match(text(h.card(BOOKS)), /책상 위.*책 다섯 권과 노트/);
  assert.match(text(h.card(SOFA)), /바닥.*소파 앞에서 ‘앉기’/);
  // Each real panel click waits for fresh ownership. Retained and duplicate clicks cannot buy again.
  for (const id of [BOOKS, SOFA]) {
    if (!h.ui.open) { h.ui.setOpen(true); await flush(); }
    h.pause(); const buy = h.button(id, 'shop-offer-buy'); buy.click(); buy.click(); await flush();
    assert.equal(h.button(id, 'shop-furniture-action').disabled, true);
    assert.equal(h.handoff.action(id), null);
    h.resume(); await flush();
    assert.equal(h.button(id, 'shop-furniture-action').textContent, '내 방 위치 안내');
    h.button(id, 'shop-furniture-action').click(); assert.equal(h.ui.open, false); assert.equal(h.editor.open, false);
    assert.match(h.messages.at(-1), /로비의 내 방 문/);
  }
  assert.equal(h.writes().length, 2);
  h.enterOwnRoom(); assert.equal(h.handoff.open(SOFA), true);
  h.editorButton('Study Books Set (0/1) +').click();
  h.editorButton('생활관 1인 소파 (0/1) +').click();
  let objects = h.furniture.state().objects;
  assert.equal(objects.find(o => o.itemId === BOOKS).surface, 'desk');
  assert.equal(objects.find(o => o.itemId === SOFA).surface, 'floor');
  // Native default placement must have an accessible sofa front, not only fit the floor bounds.
  let anchors = personalRoomSeatAnchors({ roomId: ROOM, objects });
  const sofa = objects.find(o => o.itemId === SOFA);
  let seat = anchors.find(a => a.interactableId === sofa.id);
  assert.ok(seat, 'native first sofa placement must be usable for sitting');
  h.editorButton('저장').click(); await flush(); assert.equal(h.furniture.state().dirty, false);
  h.editorButton('완료').click(); assert.equal(h.editor.open, false);
  await h.furniture.refresh(); assert.deepEqual(h.furniture.state().objects, canonicalFurniture(objects));
  const transforms = []; let position = { ...seat.standPoint };
  const player = { getLocalPosition: () => position, setLocalPosition(x,y,z) { position = {x,y,z}; transforms.push(position); }, setLocalEulerAngles() {} };
  const controller = { grounded: true, mounted: false, keys: new Set(), joystick: {x:0,y:0} };
  const seating = createSeatInteraction({ player, controller, getSpaceId: () => ROOM,
    getPlaceZoneId: () => seat.placeZoneId, getAnchors: () => personalRoomSeatAnchors({ roomId: ROOM, objects }),
    canInteract: () => !h.editor.open });
  assert.equal(seating.toggle(), true); assert.equal(seating.seats.isSeated, true);
  assert.deepEqual(position, seat.position); assert.equal(seating.standUp('explicit'), true);
  assert.deepEqual(position, seat.standPoint); assert.equal(seating.seats.isSeated, false);
  assert.equal(transforms.length, 2); assert.equal(h.writes().length, 2);
});

test('candidate changes only two locked server listings; other F0 items and authorities remain untouched', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261012022000_world_starter_furniture_locked_candidate.sql', import.meta.url), 'utf8');
  assert.match(sql, /'furniture.study_books_set', 120, 1, 1/); assert.match(sql, /'furniture.dorm_single_sofa', 480, 1, 2/);
  assert.match(sql, /null, null, null, 'LOCKED'/);
  const uncommented = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(uncommented, /create\s+(?:or replace\s+)?function|update\s+|delete\s+|grant\s+execute|world_player_items|world_wallets|world_purchase_transactions/i);
  assert.doesNotMatch(uncommented, /dorm_plant|dorm_monitor|dorm_side_table|dorm_trophy|dorm_bookshelf/);
  assert.equal(furnitureOfferDetails('furniture.dorm_plant_medium').useText, null);
});

test('optional suggestion filter cannot bypass ownership or accept a blocked sofa front', async () => {
  const { firstFurniturePosition } = await import('../src/rooms/furniture-layout.js');
  const owned = [{ itemId: SOFA, quantity: 1 }];
  const original = firstFurniturePosition(SOFA, 'floor', [], owned);
  assert.ok(original); assert.equal(personalRoomSeatAnchors({roomId:ROOM,objects:[original]}).some(a => a.interactableId === original.id), false);
  const usable = firstFurniturePosition(SOFA,'floor',[],owned,{accept:c => personalRoomSeatAnchors({roomId:ROOM,objects:[c]}).some(a => a.interactableId === c.id)});
  assert.ok(usable); assert.equal(validateFurniture([usable],owned),null);
  assert.notDeepEqual(usable,original);
  assert.equal(firstFurniturePosition(SOFA,'floor',[],[],{accept:()=>true}),null);
  assert.equal(firstFurniturePosition(SOFA,'floor',[],owned,{positions:[{x:0,z:-3}],accept:()=>true}),null);
  assert.equal(firstFurniturePosition(SOFA,'floor',[],owned,{positions:[{x:-2,z:0}],accept:()=>false}),null);
});
