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
