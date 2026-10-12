// Independent PostgreSQL connections; run ONLY via scripts/public-db.sh on a disposable local stack.
// PGlite's serialized queue is not proof of these races or lock ordering.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const {DB_URL,PSQL_FALLBACK_CONTAINER}=process.env;
assert.match(DB_URL??'',/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//,'disposable local DB only');
const run=promisify(execFile),lit=v=>`'${String(v).replaceAll("'","''")}'`;
async function sql(query){const args=['-v','ON_ERROR_STOP=1','-Atq','-c',query];try{return(await run('psql',[DB_URL,...args],{encoding:'utf8',timeout:15000})).stdout.trim();}
  catch(e){if(e.code!=='ENOENT'||!PSQL_FALLBACK_CONTAINER)throw e;return(await run('docker',['exec',PSQL_FALLBACK_CONTAINER,'psql','-U','postgres','-d','postgres',...args],{encoding:'utf8',timeout:15000})).stdout.trim();}}
const actor=randomUUID(),room=randomUUID(),object=randomUUID(),claims=lit(JSON.stringify({sub:actor,role:'authenticated',is_anonymous:false}));
const asUser=q=>sql(`begin; set local lock_timeout='5s'; set local role authenticated; set local request.jwt.claims=${claims}; ${q}; commit;`);
const invoke=async q=>{try{return{ok:true,value:JSON.parse((await asUser(q)).split('\n').at(-1))};}catch(e){return{ok:false,error:/ERROR:\s+([A-Z_]+)/.exec(String(e.stderr??e.message))?.[1]??String(e.message)};}};
const seed=r=>invoke(`select public.plant_my_room_plant_v1(${lit(room)},${lit(object)},${lit(r)})`);
const water=(r,rev)=>invoke(`select public.care_my_room_plant_v1(${lit(room)},${lit(object)},${rev},${lit(r)})`);
let originalStatus,previousGate;
test.before(async()=>{
  previousGate=await sql('select private.world_room_plant_enabled_v1()');assert.equal(previousGate,'f','test starts from CLOSED candidate');
  originalStatus=await sql("select status from private.world_item_catalog where item_id='furniture.indoor_planter'");
  await sql(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values(${lit(actor)},'authenticated','authenticated',${lit(`plant-${actor}@example.test`)},now(),false);
    insert into public.profiles(user_id,nickname,is_banned) values(${lit(actor)},${lit('p'+actor.slice(0,8))},false);
    insert into public.world_player_rooms(id,owner_user_id) values(${lit(room)},${lit(actor)});
    create or replace function private.world_room_plant_enabled_v1() returns boolean language sql stable security definer set search_path='' as $$select true$$;
    update private.world_item_catalog set status='ACTIVE' where item_id='furniture.indoor_planter';`);
});
test.after(async()=>{
  if(previousGate!==undefined)await sql(`delete from auth.users where id=${lit(actor)};
    create or replace function private.world_room_plant_enabled_v1() returns boolean language sql stable security definer set search_path='' as $$select false$$;
    update private.world_item_catalog set status=${lit(originalStatus)} where item_id='furniture.indoor_planter';`);
});
test('twelve independent claim connections grant one starter and one grant ledger row',async()=>{
  const replies=await Promise.all(Array.from({length:12},()=>invoke(`select public.claim_my_room_planter_v1(${lit(room)})`)));
  assert.ok(replies.every(r=>r.ok),JSON.stringify(replies));
  assert.equal(await sql(`select quantity from private.world_player_items where user_id=${lit(actor)} and item_id='furniture.indoor_planter'`),'1');
  assert.equal(await sql(`select count(*) from private.world_item_grants where user_id=${lit(actor)} and item_id='furniture.indoor_planter'`),'1');
  await asUser(`select public.save_my_room_furniture_v1(${lit(room)},0,${lit(JSON.stringify([{id:object,itemId:'furniture.indoor_planter',surface:'floor',x:-6,z:0,yaw:0}]))}::jsonb)`);
});
test('same-key PLANT races return identical frozen receipt once',async()=>{
  const request=randomUUID(),replies=await Promise.all(Array.from({length:12},()=>seed(request)));
  assert.ok(replies.every(r=>r.ok),JSON.stringify(replies));for(const r of replies)assert.deepEqual(r.value,replies[0].value);
  assert.equal(await sql(`select count(*) from private.world_room_plant_receipts where user_id=${lit(actor)}`),'1');
});
test('different WATER requests on the same revision advance once',async()=>{
  const replies=await Promise.all([water(randomUUID(),1),water(randomUUID(),1)]);
  assert.equal(replies.filter(r=>r.ok).length,1,JSON.stringify(replies));assert.equal(replies.find(r=>!r.ok).error,'PLANT_CONFLICT');
  assert.equal(await sql(`select revision from private.world_room_plants where user_id=${lit(actor)}`),'2');
});
test('H2 recall racing second care has a serial outcome and no deadlock',async()=>{
  await sql(`update private.world_room_plants set planted_at=clock_timestamp()-interval '22 hours',first_cared_at=clock_timestamp()-interval '21 hours' where user_id=${lit(actor)}`);
  const [result]=await Promise.all([water(randomUUID(),2),asUser(`select public.save_my_room_furniture_v1(${lit(room)},1,'[]'::jsonb)`)]);
  assert.ok(result.ok||result.error==='PLANTER_REQUIRED',JSON.stringify(result));
  assert.equal(await sql(`select revision from private.world_room_plants where user_id=${lit(actor)}`),result.ok?'3':'2');
  assert.equal((await water(randomUUID(),result.ok?3:2)).error,'PLANTER_REQUIRED');
});
