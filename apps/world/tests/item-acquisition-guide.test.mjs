import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveItemAcquisition } from '../src/collection/item-acquisition-guide.js';
import { renderItemAcquisitionGuide } from '../src/collection/item-acquisition-guide-view.js';
import { getItemDefinition } from '../src/collection/item-catalog.js';
import { parseShopSnapshot } from '../src/shop/shop-client.js';
import { createFakeDocument } from './support/fake-dom.mjs';
const ITEM = 'head.induck_cap';
const offer = (extra = {}) => ({ listingId: 'cap', itemId: ITEM, currencyId: 'coin', price: 10, quantity: 1,
  requiredLevel: null, purchaseLimit: null, startAt: null, endAt: null, status: 'ACTIVE', purchasable: true, unavailableReason: null, ...extra });
const snapshot = (shopId = 'shop.student_center', extra = {}) => parseShopSnapshot({shopId, status: 'ACTIVE', playerLevel: 1, offers: [offer(extra)]}, shopId);
const context = (extra = {}) => ({accountId: 'A', accountEpoch: 1, capabilityMode: 'split', shopSnapshots: [
  Object.freeze({accountId: 'A', accountEpoch: 1, state: 'READY', snapshot: snapshot()})], ...extra});
const poi = (extra = {}) => Object.freeze({poiId: 'poi.student-center', title: '학생회관', visible: true, validPosition: true,
  discoveryState: 'DISCOVERED', gateState: 'AVAILABLE', ...extra});

test('static catalog ACTIVE and READY routes never establish a seller or availability', () => {
  const guide = resolveItemAcquisition(ITEM);
  assert.equal(guide.availability, 'UNKNOWN'); assert.equal(guide.shopId, null); assert.equal(guide.location, null);
  assert.match(guide.label, /판매 여부 확인 필요/);
  assert.equal(resolveItemAcquisition('furniture.dorm_single_sofa').availability, 'UNKNOWN');
});
test('current frozen server snapshot establishes exact seller and allows only verified POI', () => {
  const input = Object.freeze(context({knownPois: Object.freeze([poi()])}));
  const before = JSON.stringify(input);
  const guide = resolveItemAcquisition(ITEM, input);
  assert.equal(guide.availability, 'AVAILABLE'); assert.equal(guide.shopId, 'shop.student_center');
  assert.equal(guide.location.poiId, 'poi.student-center'); assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(guide)); assert.ok(Object.isFrozen(guide.location));
});
test('account mismatch, A-B-A epoch, logout, loading, failed and absent reads fail closed', () => {
  for (const extra of [{accountId:'B'}, {accountId:null}, {accountEpoch:3}, {accountEpoch:undefined},
    {shopSnapshots:[]}, {shopSnapshots:[{accountId:'A',accountEpoch:1,state:'LOADING',snapshot:snapshot()}]},
    {shopSnapshots:[{accountId:'A',accountEpoch:1,state:'UNAVAILABLE',snapshot:snapshot()}]}]) {
    assert.equal(resolveItemAcquisition(ITEM, context(extra)).availability, 'UNKNOWN');
  }
});
test('legacy/split capability gates and capability transient errors never imply purchase', () => {
  const fashion = Object.freeze({accountId:'A',accountEpoch:1,state:'READY',snapshot:snapshot('shop.student_center_fashion')});
  assert.equal(resolveItemAcquisition(ITEM,context({shopSnapshots:[fashion]})).availability,'AVAILABLE');
  assert.equal(resolveItemAcquisition(ITEM,context({shopSnapshots:[fashion],capabilityMode:'legacy'})).availability,'UNKNOWN');
  assert.equal(resolveItemAcquisition(ITEM,context({capabilityMode:'legacy'})).availability,'AVAILABLE');
  for(const mode of ['checking','unavailable',null]) assert.equal(resolveItemAcquisition(ITEM,context({capabilityMode:mode})).availability,'UNKNOWN');
  assert.equal(resolveItemAcquisition(ITEM,context({capabilityChecking:true})).availability,'UNKNOWN');
});
test('server refusal controls guidance without locally recalculating level, price or status', () => {
  const c = context(); c.shopSnapshots = [{accountId:'A',accountEpoch:1,state:'READY',snapshot:snapshot('shop.student_center',{purchasable:false,unavailableReason:'LEVEL_REQUIRED',requiredLevel:2})}];
  assert.equal(resolveItemAcquisition(ITEM,c).availability,'UNAVAILABLE'); assert.match(resolveItemAcquisition(ITEM,c).detail,/레벨/);
  c.shopSnapshots[0].snapshot = snapshot('shop.student_center',{purchasable:true,unavailableReason:'LEVEL_REQUIRED'});
  assert.equal(resolveItemAcquisition(ITEM,c).availability,'UNKNOWN');
});
test('hidden catalog/server rows and unrevealed discovery do not expose a shop or POI', () => {
  for (const extra of [{catalogStatus:'HIDDEN'}, {discoveryState:'UNDISCOVERED'}, {discoveryState:'UNKNOWN'},
    {definition:{...getItemDefinition(ITEM),status:'HIDDEN'}}]) {
    const g = resolveItemAcquisition(ITEM,context({...extra,knownPois:[poi()]}));
    assert.equal(g.availability,'HIDDEN'); assert.equal(g.shopId,null); assert.equal(g.location,null);
    assert.doesNotMatch(JSON.stringify(g),/student|인경호|학생회관/);
  }
});
test('missing, hidden, undiscovered, invalid, unknown POIs never expose a location', () => {
  for (const p of [poi({visible:false}),poi({validPosition:false}),poi({discoveryState:'UNDISCOVERED'}),
    poi({gateState:'HIDDEN'}),poi({poiId:'guessed.vendor'}),poi({gateState:'UNKNOWN'})]) {
    assert.equal(resolveItemAcquisition(ITEM,context({knownPois:[p]})).location,null);
  }
});
test('planned/unregistered shops and missing product are not sellers', () => {
  for(const shopId of ['shop.inkyung_fishing','shop.library_photo','guessed.shop']) {
    assert.equal(resolveItemAcquisition(ITEM,context({shopSnapshots:[{accountId:'A',accountEpoch:1,state:'READY',snapshot:snapshot(shopId)}]})).shopId,null);
  }
  assert.equal(resolveItemAcquisition('memorabilia.campus_mug',context()).shopId,null);
});
test('owned sourceType does not infer a new reward path or resurrect proposed activities', () => {
  assert.equal(resolveItemAcquisition('material.fish_carp',{sourceType:'ACTIVITY'}).availability,'UNKNOWN');
  assert.equal(resolveItemAcquisition('material.campus_leaf').availability,'UNKNOWN');
  assert.equal(resolveItemAcquisition('consumable.grilled_carp').availability,'PLANNED');
  assert.equal(resolveItemAcquisition('head.inha_cap',{sourceType:'SHOP'}).label,'기본 지급');
  assert.match(resolveItemAcquisition('badge.main_gate').label,/탐방 완료/);
  assert.equal(resolveItemAcquisition('future.secret').availability,'UNKNOWN');
});
test('view distinguishes acquisition guidance, escapes text and invokes only explicit map callback', () => {
  const doc=createFakeDocument(), clicked=[];
  const guide=resolveItemAcquisition(ITEM,context({knownPois:[poi()]}));
  const view=renderItemAcquisitionGuide({doc,guide,onShowLocation:p=>clicked.push(p)});
  assert.match(view.element.children[0].textContent,/획득 방법/);
  assert.equal(clicked.length,0); view.locationButton.click(); assert.deepEqual(clicked,[guide.location]);
  assert.equal(renderItemAcquisitionGuide({doc,guide}).locationButton,null);
  const hidden=renderItemAcquisitionGuide({doc,guide:{availability:'HIDDEN',label:'<script>',location:guide.location},onShowLocation:()=>assert.fail()});
  assert.equal(hidden.locationButton,null); assert.equal(hidden.element.children[0].textContent,'획득 방법 · <script>');
});

test('contradictory shop or offer status never produces available guidance', () => {
  for (const snap of [{...snapshot(),status:'DISABLED'},snapshot('shop.student_center',{status:'LOCKED'})]) {
    const guide=resolveItemAcquisition(ITEM,context({shopSnapshots:[{accountId:'A',accountEpoch:1,state:'READY',snapshot:snap}]}));
    assert.equal(guide.availability,'UNKNOWN'); assert.equal(guide.shopId,null);
  }
});
