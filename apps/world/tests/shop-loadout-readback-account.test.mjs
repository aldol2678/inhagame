import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopClient, SHOP_READ_RPC, SHOP_PURCHASE_RPC, SHOP_STUDENT_CENTER } from '../src/shop/shop-client.js';
import { createLoadoutClient, APPEARANCE_SLOTS, LOADOUT_READ_RPC, LOADOUT_EQUIP_RPC, LOADOUT_UNEQUIP_RPC } from '../src/appearance/loadout-client.js';
import { createShopPanel } from '../src/shop/shop-panel.js';
import { createFakeDocument } from './support/fake-dom.mjs';

const flush = async () => { for (let i=0;i<16;i++) await Promise.resolve(); };
const ok = data => ({ data, error:null });
const offer = { listingId:'offer.fixture.item', itemId:'memorabilia.campus_mug', currencyId:'currency.induck_coin', price:120, quantity:1, requiredLevel:null, purchaseLimit:null, startAt:null, endAt:null, status:'ACTIVE', purchasable:true, unavailableReason:null };
const shopView = () => ({ shopId:SHOP_STUDENT_CENTER, status:'ACTIVE', playerLevel:1, offers:[offer] });
const slotsView = () => ({ slots:Object.fromEntries(APPEARANCE_SLOTS.map(s=>[s,null])) });
const operations = [
  { name:'purchase', create:createShopClient, read:SHOP_READ_RPC, write:SHOP_PURCHASE_RPC, view:shopView, target:offer.listingId, act:c=>c.purchase(offer.listingId), refusal:'LEVEL_REQUIRED' },
  { name:'equip', create:createLoadoutClient, read:LOADOUT_READ_RPC, write:LOADOUT_EQUIP_RPC, view:slotsView, target:'HEAD', act:c=>c.equip('HEAD','head.inha_cap'), refusal:'ITEM_NOT_OWNED' },
  { name:'unequip', create:createLoadoutClient, read:LOADOUT_READ_RPC, write:LOADOUT_UNEQUIP_RPC, view:slotsView, target:'HEAD', act:c=>c.unequip('HEAD'), refusal:'ITEM_UNAVAILABLE' }
];
const transitions = [['A to B',['B']],['A to B to A',['B','A']],['logout',[null]]];
function rig(op) {
  const calls=[]; let sequence=0;
  const client=op.create({getClient:()=>({rpc(fn,args){return new Promise((resolve,reject)=>calls.push({fn,args,resolve,reject,account:client.accountId}));}}),createKey:()=>`fixture:key-${++sequence}`});
  async function bind(account) {
    const before=calls.length; let pending=client.setAccount(account);
    if(account&&op.read===SHOP_READ_RPC)pending=client.refresh('account');
    if(calls.length>before)calls.at(-1).resolve(ok(op.view()));
    await pending; await flush();
  }
  return {client,calls,bind,writes:()=>calls.filter(c=>c.fn===op.write)};
}

for(const op of operations) {
  for(const [transition,accounts] of transitions) for(const outcome of ['SUCCESS','REFUSED']) for(const readback of ['success','failure']) {
    test(`${op.name}: ${outcome} after ${readback} readback is stale for ${transition}`,async()=>{
      const h=rig(op);await h.bind('A');
      const old=op.act(h.client);h.calls.at(-1).resolve(outcome==='SUCCESS'?ok({status:'SUCCESS'}):{error:{message:op.refusal}});await flush();
      const oldRead=h.calls.at(-1);assert.equal(oldRead.fn,op.read);
      for(const account of accounts)await h.bind(account);
      const currentSnapshot=h.client.snapshot;const changes=[];h.client.onChange(c=>changes.push(c));
      let current;
      if(h.client.accountId)current=op.act(h.client);
      const currentCall=current?h.calls.at(-1):null;const before=changes.length;
      oldRead.resolve(readback==='success'?ok(op.view()):{error:{message:'offline'}});
      assert.equal((await old).outcome,'STALE');
      assert.equal(h.client.snapshot,currentSnapshot);assert.equal(changes.length,before);
      assert.equal(h.client.isPending(op.target),Boolean(current));
      assert.equal(h.writes().length,current?2:1,'only explicit user mutations');
      if(current){currentCall.reject(new Error('unknown outcome'));assert.equal((await current).outcome,'FAILED');const retry=op.act(h.client);assert.equal(h.writes().at(-1).args.p_idempotency_key,currentCall.args.p_idempotency_key);h.calls.at(-1).reject(new Error('still offline'));await retry;}
    });
  }
  for(const outcome of ['SUCCESS','REFUSED']) for(const readback of ['success','failure']) {
    test(`${op.name}: same-account ${outcome} remains ${outcome} despite ${readback} readback`,async()=>{
      const h=rig(op);await h.bind('A');const done=op.act(h.client);
      h.calls.at(-1).resolve(outcome==='SUCCESS'?ok({status:'SUCCESS'}):{error:{message:op.refusal}});await flush();
      assert.equal(h.calls.at(-1).fn,op.read);h.calls.at(-1).resolve(readback==='success'?ok(op.view()):{error:{message:'offline'}});
      assert.equal((await done).outcome,outcome,'readback failure never becomes mutation failure');assert.equal(h.writes().length,1);
    });
  }
}

const walk=node=>[node,...(node.children??[]).flatMap(walk)];
for(const [transition,accounts] of transitions) for(const readback of ['success','failure']) {
  test(`shop real panel suppresses old hint, toast, wallet and callback after ${transition}/${readback}`,async()=>{
    const h=rig(operations[0]),doc=createFakeDocument(),panel=doc.createElement('section'),toasts=[],purchases=[],walletReads=[];
    const ui=createShopPanel({panel,shop:h.client,doc,onStatus:x=>toasts.push(x),onPurchase:x=>purchases.push(x),wallet:{accountId:null,onChange(){},refresh:r=>walletReads.push(r)}});
    await h.bind('A');ui.setOpen(true);h.calls.at(-1).resolve(ok(shopView()));await flush();
    let pending;const purchase=h.client.purchase;h.client.purchase=id=>(pending=purchase(id));
    walk(panel).find(n=>n.className==='shop-offer-buy').click();h.calls.at(-1).resolve(ok({status:'SUCCESS'}));await flush();const oldRead=h.calls.at(-1);
    for(const account of accounts)await h.bind(account);
    oldRead.resolve(readback==='success'?ok(shopView()):{error:{message:'offline'}});await pending;await flush();
    assert.deepEqual(toasts,[]);assert.deepEqual(purchases,[]);assert.deepEqual(walletReads,[]);assert.equal(ui.status().hint,'');assert.equal(h.writes().length,1);
  });
}
