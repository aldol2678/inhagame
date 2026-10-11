import test from 'node:test';
import assert from 'node:assert/strict';
import {createShopEntryCompatibility} from '../src/shop/shop-entry-compat.js';
import {createStudentVendorInteraction,STUDENT_CENTER_VENDORS} from '../src/shop/student-center-vendors.js';
import {createDormShopInteraction} from '../src/shop/dorm-shop-interaction.js';
import {WALK_SHAPE} from '../src/player-dimensions.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};
function harness(mode='legacy'){
 const state={available:true,blocked:false,mode},calls=[],messages=[];
 const shop={accountId:'a',get mode(){return state.mode},async refresh(){calls.push('refresh')}};
 const entry=createShopEntryCompatibility({shop,getAvailable:()=>state.available,getBlocked:()=>state.blocked,
 openLegacy:()=>{calls.push('legacy');return true},guideSplit:()=>{calls.push('guide');return true},onStatus:m=>messages.push(m)});
 return {state,calls,messages,shop,entry};
}
test('negotiation precedes legacy unified entry and split only guides',async()=>{
 for(const mode of ['legacy','split','checking','unavailable']){const h=harness(mode);assert.equal(await h.entry.enter(),['legacy','split'].includes(mode));assert.deepEqual(h.calls,['refresh',...(['legacy','split'].includes(mode)?[mode==='legacy'?'legacy':'guide']:[])]);}
});
test('signout, account switch, cancel, newer entry, lost proximity and new modal cannot reopen after await',async()=>{
 for(const interrupt of [h=>h.entry.cancel(),h=>h.shop.accountId='b',h=>h.state.available=false,h=>h.state.blocked=true]){
 const h=harness(),d=deferred();h.shop.refresh=()=>d.promise;const pending=h.entry.enter();interrupt(h);d.resolve();assert.equal(await pending,false);assert.deepEqual(h.calls,[]);}
 const h=harness(),d=deferred();let near=true;h.shop.refresh=()=>d.promise;const pending=h.entry.enter({canAccess:()=>near});near=false;d.resolve();assert.equal(await pending,false);
 const guest=harness();guest.state.available=false;assert.equal(await guest.entry.enter(),false);assert.deepEqual(guest.calls,[]);assert.match(guest.messages[0],/로그인/);
 const latest=harness(),first=deferred();let n=0;latest.shop.refresh=()=>++n===1?first.promise:Promise.resolve();const old=latest.entry.enter();assert.equal(await latest.entry.enter(),true);first.resolve();assert.equal(await old,false);assert.deepEqual(latest.calls,['legacy']);
});
test('split actor and dorm callbacks fail closed on every later capability downgrade',()=>{
 let mode='split';let calls=0;const v=STUDENT_CENTER_VENDORS[0];
 const vendor=createStudentVendorInteraction({getMode:()=>mode,getPosition:()=>({...v.position,y:v.position.y+WALK_SHAPE.footOffset}),getBlocked:()=>false,getNpcReady:()=>true,getAvailable:()=>true,openShop:()=>{calls++;return true}});
 const dorm=createDormShopInteraction({getMode:()=>mode,getState:()=>({space:'ROOM_DORM1_LOBBY',position:{x:0,z:.85},grounded:true,available:true}),openShop:()=>{calls++;return true}});
 const a=vendor.observe(),b=dorm.contextAction();assert.ok(a&&b);
 for(mode of ['legacy','checking','unavailable']){assert.equal(vendor.observe(),null);assert.equal(dorm.contextAction(),null);assert.equal(a.trigger(),false);assert.equal(b.trigger(),false);assert.equal(vendor.canAccess(v.shopId),false);assert.equal(dorm.canAccess(),false);}
 assert.equal(calls,0);mode='split';assert.equal(a.trigger(),true);assert.equal(b.trigger(),true);
});
test('capability outage admits only existing receipt recovery, never a new legacy purchase',async()=>{
 let recovered=0,legacy=0;const shop={mode:'unavailable',accountId:'a',unresolvedOffers:[{listingId:'dorm.uncertain'}],refresh:async()=>false};
 const entry=createShopEntryCompatibility({shop,getAvailable:()=>true,getBlocked:()=>false,openRecovery:()=>{recovered++;return true},openLegacy:()=>{legacy++;return true}});
 assert.equal(await entry.enter(),true);assert.equal(recovered,1);assert.equal(legacy,0);
 shop.unresolvedOffers=[];assert.equal(await entry.enter(),false);assert.equal(recovered,1);
 shop.mode='legacy';shop.refresh=async()=>{throw Error('transport')};assert.equal(await entry.enter(),false);assert.equal(legacy,0);
});
