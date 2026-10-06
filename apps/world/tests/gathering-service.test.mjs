import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatheringApiHandler, createGatheringService, GatheringError } from '../server/gathering-service.mjs';

const ACCOUNT='22222222-2222-4222-8222-222222222222';
const KEY='11111111-1111-4111-8111-111111111111';

test('Gathering service derives actor from auth and refuses client authority fields',async()=>{
  const calls=[];
  const service=createGatheringService({
    verifyUser:async()=>ACCOUNT,
    rpc:async(name,args)=>{calls.push([name,args]);return {available:true};}
  });
  await service('Bearer x',{op:'read'});
  await service('Bearer x',{op:'harvest',sourceRef:'gathering.campus.leaf_pile_01',clientAttemptKey:KEY});
  assert.deepEqual(calls,[
    ['world_gathering_read_v1',{p_user:ACCOUNT}],
    ['world_gathering_harvest_v1',{p_user:ACCOUNT,p_source_ref:'gathering.campus.leaf_pile_01',p_client_attempt_key:KEY}]
  ]);
  await assert.rejects(
    service('Bearer x',{op:'harvest',sourceRef:'gathering.campus.leaf_pile_01',clientAttemptKey:KEY,lifeXp:999}),
    error=>error instanceof GatheringError&&error.message==='INVALID_REQUEST'&&error.status===400
  );
});

test('Gathering API handler is POST-only and returns 404 while exposure flag is closed',async()=>{
  const replies=[];
  const res={
    headers:{},setHeader(k,v){this.headers[k]=v;return this;},
    status(code){this.code=code;return this;},end(){replies.push([this.code,null]);return this;},
    json(body){replies.push([this.code,body]);return this;}
  };
  const disabled=createGatheringApiHandler({enabled:false,service:async()=>({})});
  await disabled({method:'POST',headers:{}},res);
  assert.deepEqual(replies.pop(),[404,null]);

  const enabled=createGatheringApiHandler({enabled:true,service:async()=>({available:true})});
  await enabled({method:'GET',headers:{}},res);
  assert.deepEqual(replies.pop(),[405,null]);
  assert.equal(res.headers.Allow,'POST');
});
