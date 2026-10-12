import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopRouter } from '../src/shop/shop-router.js';
import { SHOP_CAPABILITIES_RPC, isMissingShopCapabilities, parseShopCapabilities } from '../src/shop/shop-capabilities.js';
import { SHOP_READ_RPC, SHOP_PURCHASE_RPC, SHOP_SCOPED_PURCHASE_RPC } from '../src/shop/shop-client.js';
const S='shop.student_center',F='shop.student_center_fashion';
const missing={code:'PGRST202',message:'Could not find the function public.get_world_shop_capabilities_v1() in the schema cache'};
const cap=(catalogLayout,purchaseRpc=SHOP_SCOPED_PURCHASE_RPC)=>({data:{version:1,catalogLayout,purchaseRpc},error:null});
const offer={listingId:'offer.cap',itemId:'cosmetic.cap',currencyId:'currency.induck_coin',price:120,quantity:1,requiredLevel:null,purchaseLimit:null,startAt:null,endAt:null,status:'ACTIVE',purchasable:true,unavailableReason:null};
function harness(initial={data:null,error:missing}) {
 let response=initial,purchaseResponse={data:{status:'SUCCESS'},error:null},keys=0;
 const calls=[],offersByShop=new Map();
 const shop=createShopRouter({shopIds:[S,F],getClient:()=>({async rpc(fn,args){calls.push({fn,args});if(fn===SHOP_CAPABILITIES_RPC)return response;if(fn===SHOP_READ_RPC)return {data:{shopId:args.p_shop_id,status:'ACTIVE',playerLevel:4,offers:offersByShop.get(args.p_shop_id)??[offer]}};return purchaseResponse;}}),createKey:()=>`key:${++keys}`});
 shop.setAccount('a');
 return {shop,calls,offers:(id,items)=>offersByShop.set(id,items),cap:r=>{response=r;},buy:r=>{purchaseResponse=r;},buys:()=>calls.filter(c=>[SHOP_PURCHASE_RPC,SHOP_SCOPED_PURCHASE_RPC].includes(c.fn))};
}
test('capability miss accepts only exact named no-argument PostgREST function absence',()=>{
 assert.equal(isMissingShopCapabilities(missing),true);
 assert.equal(isMissingShopCapabilities({...missing,message:missing.message.replace('()', ' without parameters')}),true);
 for(const e of [{...missing,code:'42501'},{...missing,message:'network failed'}, {...missing,message:missing.message.replace('capabilities','other')},{...missing,message:missing.message.replace('()','(p_bad)')}])assert.equal(isMissingShopCapabilities(e),false);
 assert.equal(parseShopCapabilities(cap('split',SHOP_PURCHASE_RPC).data),null);
 assert.equal(parseShopCapabilities(cap('mixed').data),null);
});
test('current v1-only DB uses legacy student route and performs exactly one v1 call',async()=>{
 const h=harness();await h.shop.refresh();assert.equal(h.shop.mode,'legacy');assert.equal(h.shop.select(F),false);
 assert.equal((await h.shop.purchase(offer.listingId)).outcome,'SUCCESS');
 assert.equal(h.buys().length,1);assert.equal(h.buys()[0].fn,SHOP_PURCHASE_RPC);assert.equal('p_shop_id' in h.buys()[0].args,false);
});
test('prepared API keeps old route while split binding opens new routes',async()=>{
 const h=harness(cap('legacy'));await h.shop.refresh();assert.equal(h.shop.mode,'legacy');assert.equal(h.shop.select(F),false);
 await h.shop.purchase(offer.listingId);assert.equal(h.buys()[0].fn,SHOP_SCOPED_PURCHASE_RPC);
 h.cap(cap('split'));await h.shop.refresh();assert.equal(h.shop.mode,'split');assert.equal(h.shop.select(F),true);await h.shop.refresh();await h.shop.purchase(offer.listingId);
 assert.equal(h.buys()[1].args.p_shop_id,F);
});
for(const [label,response] of [['network',{error:{message:'network'}}],['auth',{error:{code:'42501',message:'PERMANENT_ACCOUNT_REQUIRED'}}],['wrong missing',{error:{code:'PGRST202',message:'other function'}}],['mixed',cap('mixed')],['invalid',cap('split',SHOP_PURCHASE_RPC)]])test(`${label} capability fails closed without purchase fallback`,async()=>{
 const h=harness(response);await h.shop.refresh();assert.equal(h.shop.mode,'unavailable');assert.equal((await h.shop.purchase(offer.listingId)).code,'SHOP_UNAVAILABLE');assert.equal(h.buys().length,0);
});
test('v2 missing, authorization, stock and network purchase errors never automatically resend v1',async()=>{
 for(const error of [{...missing,message:'Could not find the function public.purchase_world_shop_listing_v2() in the schema cache'},{message:'INSUFFICIENT_FUNDS'},{message:'PERMANENT_ACCOUNT_REQUIRED'},{message:'network'}]){
  const h=harness(cap('split'));await h.shop.refresh();h.buy({error});await h.shop.purchase(offer.listingId);assert.equal(h.buys().length,1);assert.equal(h.buys()[0].fn,SHOP_SCOPED_PURCHASE_RPC);
 }
});
test('lost legacy receipt keeps original RPC/key across API preparation and listing relocation',async()=>{
 const h=harness();await h.shop.refresh();h.buy({error:{message:'lost'}});await h.shop.purchase(offer.listingId);
 h.cap(cap('split'));await h.shop.refresh();h.shop.select(F);await h.shop.refresh();h.buy({data:{status:'SUCCESS'}});await h.shop.purchase(offer.listingId);
 assert.equal(h.buys().length,2);assert.deepEqual(h.buys()[1],h.buys()[0]);
});
test('lost scoped receipt keeps original shop/RPC/key during capability outage',async()=>{
 const h=harness(cap('split'));await h.shop.refresh();h.shop.select(F);await h.shop.refresh();h.buy({error:{message:'lost'}});await h.shop.purchase(offer.listingId);
 h.cap({error:{message:'network'}});await h.shop.refresh();assert.equal(h.shop.shopId,S);h.buy({data:{status:'SUCCESS'}});await h.shop.purchase(offer.listingId);
 assert.deepEqual(h.buys()[1],h.buys()[0]);
});
test('listing move mismatch renegotiates without automatically retrying a new key/shop',async()=>{
 const h=harness(cap('legacy'));await h.shop.refresh();h.cap(cap('split'));h.buy({error:{message:'SHOP_LISTING_MISMATCH'}});
 assert.equal((await h.shop.purchase(offer.listingId)).code,'SHOP_LISTING_MISMATCH');assert.equal(h.shop.mode,'split');assert.equal(h.buys().length,1);
});
test('account change drops capability and unknown key contract; late capability cannot enable next account',async()=>{
 const h=harness();let resolve;h.cap(new Promise(r=>{resolve=r;}));const refresh=h.shop.refresh();h.shop.setAccount('b');resolve(cap('split'));await refresh;
 assert.equal(h.shop.mode,'checking');assert.equal(h.shop.snapshot,null);assert.equal(h.buys().length,0);
 h.cap(cap('legacy'));await h.shop.refresh();await h.shop.purchase(offer.listingId);assert.equal(h.buys()[0].fn,SHOP_SCOPED_PURCHASE_RPC);
});

test('hidden shop unresolved offer remains visible even when legacy snapshot has different listings',async()=>{
 const h=harness(cap('split'));await h.shop.refresh();h.shop.select(F);await h.shop.refresh();h.buy({error:{message:'lost'}});await h.shop.purchase(offer.listingId);
 h.offers(S,[{...offer,listingId:'other.student.mug'}]);
 h.cap({error:{message:'network'}});await h.shop.refresh();
 assert.equal(h.shop.snapshot.offers[0].listingId,'other.student.mug');
 assert.equal(h.shop.shopId,S);assert.deepEqual(h.shop.unresolvedOffers.map(x=>x.listingId),[offer.listingId]);
 assert.equal(h.shop.hasUnresolved(offer.listingId),true);
 h.shop.setAccount('b');assert.deepEqual(h.shop.unresolvedOffers,[]);
});
