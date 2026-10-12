// Real pooled PostgREST connections; only the disposable local stack is accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStarterFurnitureBrowserDatabase} from '../support/starter-furniture-browser-db.mjs';
const BOOKS='offer.dorm_furniture.study_books_set',SOFA='offer.dorm_furniture.dorm_single_sofa';
const args=(listing,key)=>({p_listing_id:listing,p_idempotency_key:key});
test('starter stock: locked default, real concurrent legacy/scoped purchases, refusals and atomic readback',async()=>{
 const db=await createStarterFurnitureBrowserDatabase({env:{...process.env,STARTER_FURNITURE_LOCAL_QA:'1'}});
 try{
  const locked=await db.rpc('purchase_world_shop_listing_v1',args(BOOKS,`starter-locked:${randomUUID()}`));
  assert.equal(locked.error.message,'LISTING_LOCKED');
  const before=await db.readback();assert.equal(before.balance,600);assert.equal(before.purchases.length,0);assert.equal(before.debits.length,0);assert.deepEqual(before.items,[]);
  db.activate();
  const key=`starter-race:${randomUUID()}`;
  const results=await Promise.all(Array.from({length:8},(_,i)=>db.rpc(i%2?'purchase_world_shop_listing_v2':'purchase_world_shop_listing_v1',
   {...args(BOOKS,key),...(i%2?{p_shop_id:'shop.dorm_furniture'}:{})})));
  for(const result of results){assert.equal(result.error,null,JSON.stringify(result.error));assert.equal(result.data.status,'SUCCESS');assert.equal(result.data.wallet.balanceAfter,480);}
  assert.equal(results.filter(r=>!r.data.replayed).length,1);assert.equal(new Set(results.map(r=>r.data.purchaseId)).size,1);
  const unique=await db.rpc('purchase_world_shop_listing_v1',args(BOOKS,`starter-unique:${randomUUID()}`));assert.equal(unique.error.message,'ITEM_ALREADY_OWNED');
  const conflict=await db.rpc('purchase_world_shop_listing_v1',args(SOFA,key));assert.equal(conflict.error.message,'IDEMPOTENCY_CONFLICT');
  const poor=await db.createAccount();
  for(const listing of [BOOKS,SOFA]){
   const denied=await poor.rpc('purchase_world_shop_listing_v1',args(listing,`starter-poor:${randomUUID()}`));assert.equal(denied.error.message,'INSUFFICIENT_FUNDS');
  }
  const foreign=await poor.rpc('purchase_world_shop_listing_v1',args(BOOKS,key));assert.equal(foreign.error.message,'IDEMPOTENCY_CONFLICT');
  const guest=await db.guestRpc('purchase_world_shop_listing_v1',args(BOOKS,`starter-guest:${randomUUID()}`));assert.ok(guest.error);
  const anonymous=await db.createAccount({anonymous:true});
  const denied=await anonymous.rpc('purchase_world_shop_listing_v1',args(BOOKS,`starter-anonymous:${randomUUID()}`));assert.ok(denied.error);
  const sofa=await db.rpc('purchase_world_shop_listing_v1',args(SOFA,`starter-sofa:${randomUUID()}`));assert.equal(sofa.error,null);assert.equal(sofa.data.wallet.balanceAfter,0);
  const state=await db.readback();assert.equal(state.balance,0);assert.equal(state.purchases.length,2);assert.equal(state.debits.length,2);assert.equal(state.grants,2);
  assert.deepEqual(state.debits.map(r=>r.amount).sort((a,b)=>a-b),[-480,-120]);
  assert.deepEqual(state.items,[{itemId:'furniture.dorm_single_sofa',quantity:1},{itemId:'furniture.study_books_set',quantity:1}]);
  for(const account of [poor,anonymous]){const state=await account.readback();assert.equal(state.balance,0);assert.equal(state.purchases.length,0);assert.equal(state.debits.length,0);assert.equal(state.grants,0);assert.deepEqual(state.items,[]);}
 }finally{await db.close();}
});
