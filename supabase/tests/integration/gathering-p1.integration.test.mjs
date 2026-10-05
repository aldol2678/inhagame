import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { GATHERING_SPOTS } from '../../../apps/world/src/activity/gathering-spots.js';

const run=promisify(execFile),DB_URL=process.env.DB_URL;
assert.match(DB_URL??'',/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//);
const lit=v=>v===null?'null':`'${String(v).replaceAll("'","''")}'`;
async function query(sql){
  const args=['-Atq','-v','ON_ERROR_STOP=1','-c',sql];let result;
  try{result=await run('psql',[DB_URL,...args]);}
  catch(error){if(error.code!=='ENOENT'||!process.env.PSQL_FALLBACK_CONTAINER)throw error;
    result=await run('docker',['exec',process.env.PSQL_FALLBACK_CONTAINER,'psql','-U','postgres','-d','postgres',...args]);}
  return result.stdout.trim();
}
const json=async sql=>JSON.parse((await query(sql)).split('\n').at(-1));
const server=expression=>json(`set role service_role;set request.jwt.claims='{"role":"service_role"}';select ${expression};`);
const users=[];let previous;
async function user(){
  const id=randomUUID();users.push(id);
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
    (${lit(id)},'authenticated','authenticated',${lit(id+'@example.test')},now(),false);
    insert into public.profiles(user_id,nickname,is_banned) values(${lit(id)},'채집P1',false);`);
  return id;
}
async function activate(){
  await query(`update private.world_gathering_runtime set enabled=true,
      policy='{"policyVersion":"gathering.fixture.v1","lifeXp":10}'::jsonb,
      minimum_harvest_interval_ms=1,presence_required=true;
    update private.world_gathering_source_catalog set status='ACTIVE'
      where source_ref='gathering.campus.leaf_pile_01';
    update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.gathering';
    update private.world_collection_entry_catalog set status='ACTIVE'
      where entry_id='collection.plant.campus_leaf';`);
}
async function observe(actor,{x=GATHERING_SPOTS[0].position.x,z=GATHERING_SPOTS[0].position.z,
  y=0,mode='ON_FOOT',space='CAMPUS',revision=1,session=randomUUID()}={}){
  return server(`public.world_gathering_observe_position_v1(
    ${lit(actor)},${lit(session)},${revision},${x},${y},${z},${lit(space)},${lit(mode)},clock_timestamp())`);
}
async function harvest(actor,key=randomUUID()){
  return server(`public.world_gathering_harvest_v1(
    ${lit(actor)},'gathering.campus.leaf_pile_01',${lit(key)})`);
}

before(async()=>{
  previous=await json(`select jsonb_build_object(
    'runtime',to_jsonb(r),
    'source',(select status from private.world_gathering_source_catalog where source_ref='gathering.campus.leaf_pile_01'),
    'skill',(select status from private.world_life_skill_catalog where skill_id='life.gathering'),
    'collection',(select status from private.world_collection_entry_catalog where entry_id='collection.plant.campus_leaf'))
    from private.world_gathering_runtime r where singleton`);
});
after(async()=>{
  if(previous){
    const r=previous.runtime;
    await query(`update private.world_gathering_runtime set
      enabled=${r.enabled},
      policy=${r.policy===null?'null':lit(JSON.stringify(r.policy))+'::jsonb'},
      minimum_harvest_interval_ms=${r.minimum_harvest_interval_ms??'null'},
      presence_required=${r.presence_required};
      update private.world_gathering_source_catalog set status=${lit(previous.source)}
        where source_ref='gathering.campus.leaf_pile_01';
      update private.world_life_skill_catalog set status=${lit(previous.skill)} where skill_id='life.gathering';
      update private.world_collection_entry_catalog set status=${lit(previous.collection)}
        where entry_id='collection.plant.campus_leaf';`);
  }
  if(users.length)await query(`delete from auth.users where id in(${users.map(lit).join(',')})`);
});

test('Gathering P1 code and DB geometry stay aligned',async()=>{
  const row=await json(`select jsonb_build_object('x',x,'z',z,'radius',radius)
    from private.world_gathering_source_catalog where source_ref='gathering.campus.leaf_pile_01'`);
  const spot=GATHERING_SPOTS[0];
  assert.ok(Math.abs(row.x-spot.position.x)<1e-9);
  assert.ok(Math.abs(row.z-spot.position.z)<1e-9);
  assert.equal(row.radius,spot.interactionRadius);
});

test('Gathering P1 fails closed without trusted position and accepts a fresh in-range observation',async()=>{
  await activate();const actor=await user();
  await assert.rejects(harvest(actor),/GATHERING_POSITION_UNAVAILABLE/);
  assert.equal(await query(`select count(*) from private.world_activity_attempts where user_id=${lit(actor)}`),'0');
  assert.equal((await observe(actor)).status,'OBSERVED');
  const result=await harvest(actor);
  assert.equal(result.status,'HARVESTED');
  assert.equal(result.output.itemId,'material.campus_leaf');
  assert.equal(result.output.quantity,1);
});

test('Gathering P1 refuses out-of-range and ineligible observations',async()=>{
  await activate();
  const outside=await user();await observe(outside,{x:GATHERING_SPOTS[0].position.x+10});
  await assert.rejects(harvest(outside),/GATHERING_OUT_OF_RANGE/);
  const mounted=await user();await observe(mounted,{mode:'INELIGIBLE'});
  await assert.rejects(harvest(mounted),/GATHERING_POSITION_INELIGIBLE/);
});

test('exact replay stays recoverable after trusted position changes',async()=>{
  await activate();const actor=await user(),key=randomUUID();
  await observe(actor,{revision:1});
  const first=await harvest(actor,key);
  await observe(actor,{revision:2,x:GATHERING_SPOTS[0].position.x+10});
  const replay=await harvest(actor,key);
  assert.equal(first.status,'HARVESTED');
  assert.equal(replay.status,'ALREADY_PROCESSED');
  assert.equal(replay.attemptId,first.attemptId);
  assert.deepEqual(replay.receipt,first.receipt);
});

test('Gathering read reflects activation gates but does not claim a producer exists',async()=>{
  await activate();const actor=await user();
  const read=await server(`public.world_gathering_read_v1(${lit(actor)})`);
  assert.deepEqual(read,{available:true,reason:null,sourceRef:'gathering.campus.leaf_pile_01',presenceRequired:true});
  assert.equal(await query(`select count(*) from private.world_gathering_positions where user_id=${lit(actor)}`),'0');
});

test('account deletion cascades trusted Gathering position evidence',async()=>{
  await activate();const actor=await user();await observe(actor);
  await query(`delete from auth.users where id=${lit(actor)}`);
  assert.equal(await query(`select count(*) from private.world_gathering_positions where user_id=${lit(actor)}`),'0');
});
