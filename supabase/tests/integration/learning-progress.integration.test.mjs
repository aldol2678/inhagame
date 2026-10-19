import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyProgress} from '../../../apps/world/src/learning/learning-progress.js';
import {localLearningBackend} from '../support/learning-local.mjs';
const backend=localLearningBackend();test.after(()=>backend.cleanup());
test('real Auth + PostgREST: A/B ownership, simultaneous CAS, replay and invalid-content rejection',async()=>{
 const a=await backend.signup(),b=await backend.signup(),p=emptyProgress();p.completed.e01=true;
 const economicCount=()=>backend.sql(`select jsonb_build_array((select count(*) from private.world_currency_transactions where user_id='${a.user.id}'),(select count(*) from private.world_reward_transactions where user_id='${a.user.id}'),(select row_to_json(x) from private.world_player_progression x where user_id='${a.user.id}'))`);
 const hasEconomy=backend.sql("select to_regclass('private.world_player_progression') is not null")==='t';
 const before=hasEconomy?economicCount():null;
 const save={p_request_id:randomUUID(),p_expected_revision:0,p_progress:p};
 const concurrent=await Promise.all([backend.rpc(a,'world_learning_save_v1',save),backend.rpc(a,'world_learning_save_v1',{...save,p_request_id:randomUUID()})]);
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 const winner=concurrent.findIndex(r=>r.status===200);
 if(winner===0){const repeat=await backend.rpc(a,'world_learning_save_v1',save);assert.equal(repeat.status,200);assert.equal(repeat.data.duplicate,true);}
 const read=await backend.rpc(a,'world_learning_read_v1');assert.equal(read.status,200);assert.equal(read.data.revision,1);assert.deepEqual(read.data.progress,p);
 const query=await backend.request(`/rest/v1/world_learning_progress?user_id=eq.${a.user.id}`,{token:b.access_token,method:'GET'});assert.equal(query.status,200);assert.deepEqual(query.data,[]);
 const patch=await backend.request(`/rest/v1/world_learning_progress?user_id=eq.${a.user.id}`,{token:b.access_token,method:'PATCH',body:{revision:20}});assert.ok(patch.status>=400);
 const forged=await backend.rpc(b,'world_learning_save_v1',{...save,p_user_id:a.user.id});assert.ok(forged.status>=400);
 const bRead=await backend.rpc(b,'world_learning_read_v1');assert.equal(bRead.data.revision,0);
 const invalid=await backend.rpc(a,'world_learning_save_v1',{...save,p_request_id:randomUUID(),p_expected_revision:1,p_progress:{...p,answer:'SYNTHETIC_FORBIDDEN'}});assert.ok(invalid.status>=400);
 const noAuth=await backend.request('/rest/v1/rpc/world_learning_read_v1',{body:{}});assert.ok(noAuth.status>=400);
 const badJWT=await backend.request('/rest/v1/rpc/world_learning_read_v1',{token:a.access_token.slice(0,-10)+'tampered!!',body:{}});assert.ok(badJWT.status>=400);
 if(hasEconomy)assert.equal(economicCount(),before,'learning performed zero wallet/reward/EXP mutations');
});

test('full lineage: learning adds zero wallet, reward or campus EXP transactions',async t=>{
 if(backend.sql("select to_regclass('private.world_player_progression') is not null")!=='t'){t.skip('minimal local DB has no economy schema; full Supabase CI required');return;}
 const a=await backend.signup();
 const count=()=>backend.sql(`select jsonb_build_array((select count(*) from private.world_currency_transactions where user_id='${a.user.id}'),(select count(*) from private.world_reward_transactions where user_id='${a.user.id}'),(select count(*) from private.world_exp_transactions where user_id='${a.user.id}'))`);
 const before=count(),p=emptyProgress();p.completed.e01=true;
 const save=await backend.rpc(a,'world_learning_save_v1',{p_request_id:randomUUID(),p_expected_revision:0,p_progress:p});assert.equal(save.status,200);
 assert.equal(count(),before);
});

import {learningContractCases} from '../../../apps/world/tests/support/learning-contract-cases.mjs';
import {progressWeight} from '../../../apps/world/src/learning/learning-contract.js';
test('F-03: every shared browser JSON vector has identical real PostgreSQL RPC acceptance',async()=>{
 const a=await backend.signup();let revision=0;
 for(const c of learningContractCases()){
  const result=await backend.rpc(a,'world_learning_save_v1',{p_request_id:randomUUID(),p_expected_revision:revision,p_progress:c.progress});
  assert.equal(result.status,c.valid?200:400,c.name+': '+JSON.stringify(result.data));
  if(c.valid){revision++;assert.equal(result.data.revision,revision);const read=await backend.rpc(a,'world_learning_read_v1');assert.deepEqual(read.data.progress,c.progress);
   const sqlWeight=backend.sql(`select private.learning_progress_weight('${JSON.stringify(c.progress)}'::jsonb)`);assert.equal(Number(sqlWeight),progressWeight(c.progress));
  }
 }
});
test('F-02: repeated actual RPC receipts have measured bounded cost and rate refusals are atomic',async t=>{
 const a=await backend.signup(),p=emptyProgress();
 for(let i=0;i<200;i++)p.masteries[`qv:test.synthetic.${i}@1`]={level:1,errors:0,streak:1,intervalDays:1,correctDays:1,lastCorrectDay:null,dueDate:null,needsRecheck:false};
 const requests=[];
 for(let revision=0;revision<100;revision++){
  if(revision>0&&revision%12===0){
   const denied=await backend.rpc(a,'world_learning_save_v1',{p_request_id:randomUUID(),p_expected_revision:revision,p_progress:p});assert.equal(denied.status,429);
   assert.equal((await backend.rpc(a,'world_learning_read_v1')).data.revision,revision);
   // Advance only test fixtures' timestamps; never sleep or modify production.
   backend.sql(`update private.world_learning_requests set created_at=statement_timestamp()-interval '2 minutes' where user_id='${a.user.id}'`);
  }
  const args={p_request_id:randomUUID(),p_expected_revision:revision,p_progress:p};requests.push(args);
  assert.equal((await backend.rpc(a,'world_learning_save_v1',args)).status,200);
 }
 const repeat=await backend.rpc(a,'world_learning_save_v1',requests[0]);assert.equal(repeat.status,200);assert.equal(repeat.data.revision,1);
 const changed=await backend.rpc(a,'world_learning_save_v1',{...requests[0],p_progress:{...p,completed:{e01:true}}});assert.equal(changed.status,400);
 const measurement=JSON.parse(backend.sql(`create temporary table learning_measure (like private.world_learning_requests including all); insert into learning_measure(user_id,request_id,expected_revision,committed_revision,progress,created_at) select user_id,request_id,expected_revision,committed_revision,progress,created_at from private.world_learning_requests where user_id='${a.user.id}'; select jsonb_build_object('receipts',count(*),'payload_weight',sum(payload_weight),'stored_json_bytes',sum(pg_column_size(progress)),'isolated_relation_bytes',pg_total_relation_size('learning_measure')) from learning_measure;`));
 assert.equal(measurement.receipts,100);assert.equal(measurement.payload_weight,100*progressWeight(p));assert.ok(measurement.payload_weight<16777216);
 t.diagnostic('synthetic 200-question mastery, 100 committed RPCs: '+JSON.stringify(measurement));
});
