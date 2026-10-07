import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudentId } from '../src/phone/student-id.js';
test('student ID shows guest/unavailable honestly and never invents progression', async () => {
  let identity = null;
  const id = createStudentId({ getIdentity:()=>identity, getClient:()=>({rpc:async()=>({error:true})}), getProgression:()=>({state:'UNAVAILABLE'}) });
  await id.refresh(); assert.equal(id.snapshot().state,'GUEST'); assert.equal(id.snapshot().progression,null);
  identity = {userId:'a',displayName:'A'}; await id.refresh(); assert.equal(id.snapshot().state,'UNAVAILABLE'); assert.equal(id.snapshot().nickname,'A');
});
test('late account RPC does not leak old profile into the new identity', async () => {
  let done, identity = {userId:'a'};
  const id = createStudentId({getIdentity:()=>identity,getProgression:()=>null,getClient:()=>({rpc:()=>new Promise(r=>done=r)})});
  const pending = id.refresh(); identity = {userId:'b'}; id.invalidate(); done({data:{profile:{department:'OLD'}}}); await pending;
  assert.notEqual(id.snapshot().department,'OLD');
});
