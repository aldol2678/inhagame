import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatheringClient, GATHERING_CLIENT_STATE } from '../src/activity/gathering-client.js';

const UUID='11111111-1111-4111-8111-111111111111';
const ACCOUNT='22222222-2222-4222-8222-222222222222';
function response(status,payload){return {status,ok:status>=200&&status<300,json:async()=>payload};}

test('Gathering client probes availability and sends only semantic source + idempotency key', async()=>{
  const bodies=[];
  const fetcher=async(_url,init)=>{
    const body=JSON.parse(init.body);bodies.push(body);
    if(body.op==='read')return response(200,{available:true,sourceRef:'gathering.campus.leaf_pile_01',reason:null});
    return response(200,{status:'HARVESTED',sourceRef:'gathering.campus.leaf_pile_01',
      attemptId:UUID,output:{itemId:'material.campus_leaf',quantity:1,lifeXp:10,
        collectionEntryId:'collection.plant.campus_leaf',skillId:'life.gathering'},receipt:{}});
  };
  const client=createGatheringClient({getToken:async()=> 'token',fetcher,uuid:()=>UUID,now:()=>1000});
  assert.equal(await client.setAccount(ACCOUNT),true);
  assert.equal(client.state,GATHERING_CLIENT_STATE.READY);
  const result=await client.harvest('gathering.campus.leaf_pile_01');
  assert.equal(result.outcome,'HARVESTED');
  assert.deepEqual(bodies,[{op:'read'},{op:'harvest',sourceRef:'gathering.campus.leaf_pile_01',clientAttemptKey:UUID}]);
});

test('Gathering client reuses the same key after unknown transport outcome',async()=>{
  const keys=[];let first=true;
  const fetcher=async(_url,init)=>{
    const body=JSON.parse(init.body);
    if(body.op==='read')return response(200,{available:true,sourceRef:'gathering.campus.leaf_pile_01',reason:null});
    keys.push(body.clientAttemptKey);
    if(first){first=false;throw new Error('offline');}
    return response(200,{status:'ALREADY_PROCESSED',sourceRef:'gathering.campus.leaf_pile_01',
      attemptId:UUID,output:{itemId:'material.campus_leaf',quantity:1,lifeXp:10,
        collectionEntryId:'collection.plant.campus_leaf',skillId:'life.gathering'},receipt:{}});
  };
  const client=createGatheringClient({getToken:async()=> 'token',fetcher,uuid:()=>UUID});
  await client.setAccount(ACCOUNT);
  assert.equal((await client.harvest()).error,'NETWORK');
  assert.equal((await client.harvest()).outcome,'ALREADY_PROCESSED');
  assert.deepEqual(keys,[UUID,UUID]);
});

test('Gathering availability probes are throttled and disabled endpoints stay unavailable',async()=>{
  let now=1000,reads=0;
  const client=createGatheringClient({
    getToken:async()=> 'token',now:()=>now,
    fetcher:async()=>{reads++;return response(404,null);}
  });
  assert.equal(await client.setAccount(ACCOUNT),false);
  assert.equal(client.state,GATHERING_CLIENT_STATE.UNAVAILABLE);
  assert.equal(reads,1);
  assert.equal(await client.probe(),false);
  assert.equal(reads,1);
  now+=30001;
  assert.equal(await client.probe(),false);
  assert.equal(reads,2);
});
