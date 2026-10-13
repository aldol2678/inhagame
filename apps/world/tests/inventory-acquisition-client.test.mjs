import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryAcquisitionClient } from '../src/inventory/inventory-acquisition-client.js';
const snapshot = shopId => ({shopId,status:'ACTIVE',playerLevel:1,offers:[]});
function harness() {
  const calls = [];
  const client = createInventoryAcquisitionClient({getClient:()=>({ rpc(fn,args){
    let resolve; const promise = new Promise(r=>{resolve=r;});
    calls.push({fn,args,resolve}); return promise;
  }})});
  const settle = start => calls.slice(start).forEach(c=>c.resolve({data:snapshot(c.args.p_shop_id),error:null}));
  return {client,calls,settle};
}
test('guidance uses read-only allowlisted shops, waits for capability, coalesces repeated opens', async()=>{
  const {client,calls,settle}=harness();
  client.setScope({accountId:'A',capabilityMode:'checking',capabilityChecking:true});
  assert.equal(await client.refresh(),false); assert.equal(calls.length,0);
  client.setScope({accountId:'A',capabilityMode:'legacy'});
  const first=client.refresh(); assert.equal(client.refresh(),first);
  assert.deepEqual(calls.map(c=>c.args.p_shop_id),['shop.student_center','shop.dorm_furniture']);
  assert.ok(calls.every(c=>c.fn==='get_world_shop_v1'));
  settle(0); await first;
  assert.equal(client.context().shopSnapshots.length,2);
  const next=client.refresh(); assert.equal(client.context().shopSnapshots.length,0,'drop stale availability during reread');
  settle(2); await next;
});
test('account ABA discards late responses and clears previous availability immediately',async()=>{
  const {client,calls,settle}=harness();
  client.setScope({accountId:'A',capabilityMode:'legacy'}); const a=client.refresh();
  const epoch=client.context().accountEpoch;
  client.setScope({accountId:'B',capabilityMode:'legacy'}); const b=client.refresh();
  client.setScope({accountId:'A',capabilityMode:'legacy'}); const newer=client.refresh();
  assert.ok(client.context().accountEpoch>epoch);
  settle(4); await newer;
  const rows=client.context().shopSnapshots;
  calls.slice(0,4).forEach(c=>c.resolve({data:snapshot(c.args.p_shop_id),error:null}));
  assert.equal(await a,false); assert.equal(await b,false);
  assert.equal(client.context().shopSnapshots,rows);
  client.setScope({accountId:null,capabilityMode:'checking'});
  assert.deepEqual(client.context().shopSnapshots,[]);
});
test('split-only shops are read only after confirmed split; errors never retain stale snapshots',async()=>{
  const {client,calls,settle}=harness();
  client.setScope({accountId:'A',capabilityMode:'split'}); const first=client.refresh();
  assert.equal(calls.length,4); settle(0); await first;
  client.setScope({accountId:'A',capabilityMode:'unavailable'});
  assert.equal(client.context().shopSnapshots.length,0); assert.equal(await client.refresh(),false);
  client.setScope({accountId:'A',capabilityMode:'legacy'}); const failed=client.refresh();
  calls.slice(4).forEach(c=>c.resolve({data:null,error:{message:'private database'}})); await failed;
  assert.ok(client.context().shopSnapshots.every(s=>s.state==='UNAVAILABLE' && s.snapshot===null));
});
test('a stalled vendor times out without hiding a successful shop or exposing late results',async()=>{
  let late;
  const client=createInventoryAcquisitionClient({timeoutMs:15,getClient:()=>({rpc(_fn,{p_shop_id}){
    return p_shop_id==='shop.student_center' ? Promise.resolve({data:snapshot(p_shop_id)}) : new Promise(r=>{late=r;});
  }})});
  client.setScope({accountId:'A',capabilityMode:'legacy'});
  await client.refresh();
  assert.deepEqual(client.context().shopSnapshots.map(s=>s.state),['READY','UNAVAILABLE']);
  const rows=client.context().shopSnapshots;
  late({data:snapshot('shop.dorm_furniture')});
  await Promise.resolve();
  assert.equal(client.context().shopSnapshots,rows);
});
