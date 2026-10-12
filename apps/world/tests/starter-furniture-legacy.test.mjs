import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopRouter } from '../src/shop/shop-router.js';
import { SHOP_CAPABILITIES_RPC } from '../src/shop/shop-capabilities.js';
import { SHOP_READ_RPC, SHOP_PURCHASE_RPC, SHOP_SCOPED_PURCHASE_RPC } from '../src/shop/shop-client.js';
import { assertStarterLocalEnvironment } from '../../../supabase/tests/support/starter-furniture-browser-db.mjs';
const D='shop.dorm_furniture',S='shop.student_center',F='shop.student_center_fashion';
const miss={error:{code:'PGRST202',message:'Could not find the function public.get_world_shop_capabilities_v1() in the schema cache'}};
function rig(){let capability=miss,result={data:{status:'SUCCESS'}},serial=0;const calls=[];
 const shop=createShopRouter({shopIds:[S,D,F,'shop.department_mcm'],createKey:()=>`starter:${++serial}`,getClient:()=>({async rpc(name,args){calls.push({name,args});if(name===SHOP_CAPABILITIES_RPC)return capability;
  if(name===SHOP_READ_RPC)return {data:{shopId:args.p_shop_id,status:'ACTIVE',playerLevel:1,offers:[{listingId:`${args.p_shop_id}.fixture`,itemId:'furniture.study_books_set',currencyId:'currency.induck_coin',price:120,quantity:1,requiredLevel:1,purchaseLimit:null,status:'ACTIVE',purchasable:true,unavailableReason:null}]}};return result;}})});shop.setAccount('a');
 return{shop,calls,setCapability:c=>capability=c,setResult:r=>result=r,buys:()=>calls.filter(c=>[SHOP_PURCHASE_RPC,SHOP_SCOPED_PURCHASE_RPC].includes(c.name))};}
test('legacy adds only existing dorm route while keeping all old student products and rejecting fashion/department',async()=>{
 const h=rig();await h.shop.refresh();assert.equal(h.shop.mode,'legacy');assert.equal(h.shop.select(D),true);await h.shop.refresh();
 assert.equal(h.shop.shopId,D);assert.equal(h.shop.snapshot.shopId,D);assert.equal(h.shop.select(F),false);assert.equal(h.shop.select('shop.department_mcm'),false);
 await h.shop.purchase(D+'.fixture');assert.equal(h.buys().length,1);assert.equal(h.buys()[0].name,SHOP_PURCHASE_RPC);assert.equal('p_shop_id' in h.buys()[0].args,false);
 h.shop.select(S);await h.shop.refresh();assert.equal(h.shop.snapshot.offers[0].listingId,S+'.fixture');
});
test('legacy dorm unknown receipt retains original v1/key through later split negotiation',async()=>{
 const h=rig();await h.shop.refresh();h.shop.select(D);await h.shop.refresh();h.setResult({error:{message:'lost'}});await h.shop.purchase(D+'.fixture');
 h.setCapability({data:{version:1,catalogLayout:'split',purchaseRpc:SHOP_SCOPED_PURCHASE_RPC}});await h.shop.refresh();h.setResult({data:{status:'SUCCESS'}});await h.shop.purchase(D+'.fixture');
 assert.deepEqual(h.buys()[1],h.buys()[0]);
});
test('capability outage/mixed never licenses new legacy dorm purchase and clears selected dorm',async()=>{
 for(const value of [{error:{message:'network'}},{data:{version:1,catalogLayout:'mixed',purchaseRpc:SHOP_SCOPED_PURCHASE_RPC}}]){
 const h=rig();await h.shop.refresh();h.shop.select(D);await h.shop.refresh();h.setCapability(value);await h.shop.refresh();
 assert.equal(h.shop.shopId,S);assert.equal(h.shop.mode,'unavailable');assert.equal(h.shop.select(D),false);await h.shop.purchase(S+'.fixture');assert.equal(h.buys().length,0);}
});
test('browser database helper rejects nonlocal URLs and missing explicit fixture marker',()=>{
 const good={STARTER_FURNITURE_LOCAL_QA:'1',API_URL:'http://127.0.0.1:54321',DB_URL:'postgresql://postgres:fixture@127.0.0.1:54322/postgres',ANON_KEY:'fixture',JWT_SECRET:'fixture'};
 assert.doesNotThrow(()=>assertStarterLocalEnvironment(good));
 for(const override of [{API_URL:'https://example.supabase.co'},{DB_URL:'postgresql://postgres@db.example.com/db'},{STARTER_FURNITURE_LOCAL_QA:''},{JWT_SECRET:''}])assert.throws(()=>assertStarterLocalEnvironment({...good,...override}));
});
