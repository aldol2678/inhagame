// Executes real candidate SQL + current Inventory/Housing helpers in ephemeral in-memory PostgreSQL.
// Synthetic provider/auth fixture; no URL, network connection, secrets, or Production database accepted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ITEM_CATALOG } from '../../apps/world/src/collection/item-catalog.js';
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const root = fileURLToPath(new URL('../../', import.meta.url)), db = new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=s=>db.exec(s), scalar=async(s,p=[])=>Object.values((await db.query(s,p)).rows[0])[0];
const base='supabase/migrations/20261001213132_public_baseline.sql', h3='supabase/migrations/20261005022000_world_personal_room_knock_h3.sql';
const source=p=>readFileSync(root+p,'utf8');
function fn(path,name) { const s=source(path),i=s.toLowerCase().indexOf(`function ${name}(`),start=s.toLowerCase().lastIndexOf('create',i);assert.ok(i>=0,name);const m=/\bAS\s+(\$[^$]*\$)/i.exec(s.slice(i));const end=s.indexOf(m[1]+';',i+m.index+m[0].length);return s.slice(start,end+m[1].length+1); }
function table(name) {const s=source(base),i=s.indexOf('CREATE TABLE '+name+' (');assert.ok(i>=0,name);return s.slice(i,s.indexOf('\n);',i)+4);}
const auth=async(n,anonymous=false)=>{await q('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id(n),role:'authenticated',is_anonymous:anonymous})]);await q('set role authenticated');};
const room=id(100), roomB=id(101), object=id(200), other=id(201);
const objects=o=>JSON.stringify([{id:o,itemId:'furniture.indoor_planter',surface:'floor',x:-6,z:0,yaw:0}]);
const read=()=>scalar('select public.get_world_room_plants_v1($1)',[room]);
const care=(request,revision=1,o=object)=>scalar('select public.care_my_room_plant_v1($1,$2,$3,$4)',[room,o,revision,id(request)]);
const plant=(request,o=object)=>scalar('select public.plant_my_room_plant_v1($1,$2,$3)',[room,o,id(request)]);
let checks=0;const eq=(a,b,reason)=>{assert.deepEqual(a,b,reason);checks++;};
const rejects=async(p,regex)=>{await assert.rejects(p,regex);checks++;};
try {
  await q(`create schema auth; create schema private; create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key,is_anonymous boolean);
    create table public.profiles(user_id uuid primary key,nickname text,is_banned boolean default false);
    create table public.world_friendships(user_low uuid,user_high uuid,status text,requested_by uuid);
    create table public.world_user_blocks(blocker_id uuid,blocked_id uuid);
    create table private.world_room_knocks(room_id uuid,visitor_user_id uuid,status text,responded_at timestamptz,created_at timestamptz);
    create table private.world_room_owner_presence(room_id uuid,seen_at timestamptz);
    create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
  for (const name of ['private.world_item_catalog','private.world_player_items','private.world_item_grants','public.world_player_rooms']) await q(table(name));
  await q(`alter table private.world_item_catalog add primary key(item_id);
    alter table private.world_player_items add primary key(id); alter table private.world_player_items add unique(user_id,item_id);
    alter table private.world_item_grants add primary key(grant_id);
    alter table public.world_player_rooms add primary key(id); alter table public.world_player_rooms add unique(owner_user_id);
    alter table private.world_item_catalog drop constraint world_item_catalog_category_check;`);
  for (const name of ['private.world_inventory_account_ok_v1','private.world_inventory_grant_result_v1','private.world_room_caller_v1','private.world_relationship']) await q(fn(base,name));
  await q(fn('supabase/migrations/20261002131000_world_material_catalog_m1.sql','private.world_inventory_grant_v1'));
  for (const name of ['private.world_room_owner_present_v1','private.world_room_access_v1']) await q(fn(h3,name));
  const f0new=new Set(['furniture.dorm_single_sofa','furniture.dorm_side_table_low','furniture.dorm_bookshelf_slim','furniture.dorm_plant_medium','furniture.dorm_monitor','furniture.dorm_trophy_shelf','furniture.study_books_set']);
  for (const d of ITEM_CATALOG.filter(d=>d.category==='FURNITURE'&&!f0new.has(d.itemId)&&d.itemId!=='furniture.indoor_planter'))
    await db.query('insert into private.world_item_catalog values($1,$2,$3,$4,$5)',[d.itemId,d.category,d.ownershipPolicy,d.maxStack,d.status]);
  await q(source('supabase/migrations/20261002136000_world_personal_room_furniture_d3.sql'));
  await q(source('supabase/migrations/20261009142600_world_personal_room_f0_furniture.sql'));
  await q(source('supabase/migrations/20261012024000_world_room_plant_candidate.sql'));
  await q(`insert into auth.users values('${id(1)}',false),('${id(2)}',false),('${id(3)}',false),('${id(4)}',true),('${id(5)}',false);
    insert into public.profiles values('${id(1)}','owner',false),('${id(2)}','friend',false),('${id(3)}','stranger',false),('${id(4)}','guest',false),('${id(5)}','banned',true);
    insert into public.world_player_rooms(id,owner_user_id) values('${room}','${id(1)}'),('${roomB}','${id(2)}');
    insert into public.world_friendships values('${id(1)}','${id(2)}','accepted','${id(1)}');`);
  eq(await scalar('select private.world_room_plant_enabled_v1()'),false,'CLOSED by default');
  eq(await scalar("select status from private.world_item_catalog where item_id='furniture.indoor_planter'"),'COMING_SOON');
  eq(await scalar('select count(*)::int from private.world_room_furniture_v1()'),18,'all legacy + cooking definitions preserved');
  for(const role of ['anon','authenticated','service_role']) for(const t of ['world_room_plants','world_room_plant_receipts'])
    for(const perm of ['SELECT','INSERT','UPDATE','DELETE']) eq(await scalar('select has_table_privilege($1,$2,$3)',[role,`private.${t}`,perm]),false,'no direct table access');
  for(const signature of ['public.claim_my_room_planter_v1(uuid)','public.plant_my_room_plant_v1(uuid,uuid,uuid)','public.care_my_room_plant_v1(uuid,uuid,integer,uuid)','public.get_world_room_plants_v1(uuid)']) {
    eq(await scalar("select has_function_privilege('anon',$1,'execute')",[signature]),false);
    eq(await scalar("select has_function_privilege('authenticated',$1,'execute')",[signature]),true);
  }
  await auth(1);await rejects(()=>scalar('select public.claim_my_room_planter_v1($1)',[room]),/PLANT_UNAVAILABLE/);
  eq((await read()).featureStatus,'CLOSED');
  await q(`reset role; create or replace function private.world_room_plant_enabled_v1() returns boolean language sql stable security definer set search_path='' as $$select true$$;`);
  await auth(1);await rejects(()=>scalar('select public.claim_my_room_planter_v1($1)',[room]),/PLANT_UNAVAILABLE/);
  await q(`reset role; update private.world_item_catalog set status='ACTIVE' where item_id='furniture.indoor_planter'`);
  await auth(1);const claim=await scalar('select public.claim_my_room_planter_v1($1)',[room]);eq(claim.inventory.status,'GRANTED');
  for(let n=0;n<12;n++) eq((await scalar('select public.claim_my_room_planter_v1($1)',[room])).inventory.status,'ALREADY_PROCESSED');
  await q('reset role');eq(await scalar('select count(*)::int from private.world_item_grants'),1,'fixed key bounds claim ledger');
  await auth(1);await rejects(()=>plant(300),/PLANTER_REQUIRED/);
  await scalar('select public.save_my_room_furniture_v1($1,0,$2)',[room,objects(object)]);
  await rejects(()=>plant(300,other),/PLANTER_REQUIRED/);
  const planted=await plant(300);eq(planted.plantRevision,1);eq(await plant(300),planted,'exact replay');
  await rejects(()=>plant(301),/PLANT_ALREADY_PLANTED/);await rejects(()=>care(300),/IDEMPOTENCY_CONFLICT/);
  eq((await read()).plant.stage,'SPROUT');eq((await read()).plant.canCare,true);
  const watered=await care(302);eq(watered.plantRevision,2);eq(await care(302),watered);
  await rejects(()=>care(303),/PLANT_CONFLICT/);
  for(let n=0;n<24;n++) await rejects(()=>care(400+n,2),/PLANT_NOT_READY/);
  await q('reset role');eq(await scalar('select count(*)::int from private.world_room_plant_receipts'),2,'no receipt spam for rejected water');
  await rejects(()=>q('update private.world_room_plant_receipts set receipt=receipt'),/PLANT_RECEIPT_APPEND_ONLY/);
  await rejects(()=>q('delete from private.world_room_plant_receipts'),/PLANT_RECEIPT_APPEND_ONLY/);
  // Exact 20h clock boundaries run the same immutable helper used by the real read RPC.
  const at='2026-10-01T00:00:00Z';
  const grow=(first,second,now)=>scalar('select private.world_room_plant_growth_v1($1,$2,$3)',[first,second,now]);
  eq((await grow(at,null,'2026-10-01T19:59:59.999Z')).stage,'SPROUT');
  eq((await grow(at,null,'2026-10-01T20:00:00Z')).stage,'BUD');
  eq((await grow(at,null,'2036-10-01T20:00:00Z')).canCare,true,'late return waits, no death');
  eq((await grow(at,'2026-10-01T20:00:00Z','2026-10-02T15:59:59.999Z')).stage,'BUD');
  eq((await grow(at,'2026-10-01T20:00:00Z','2026-10-02T16:00:00Z')).stage,'BLOOM');
  eq((await grow(at,'2026-10-01T20:00:00Z','2036-10-02T16:00:00Z')).stage,'BLOOM','flower is permanent');
  // Fixture advances stored timestamps, never the command API or user clock.
  await q("update private.world_room_plants set planted_at=clock_timestamp()-interval '22 hours',first_cared_at=clock_timestamp()-interval '21 hours'");
  await auth(1);eq((await read()).plant.stage,'BUD');
  await scalar('select public.save_my_room_furniture_v1($1,1,$2)',[room,'[]']);
  const stored=await read();eq(stored.plant.objectId,null);eq(stored.plant.stage,'BUD');eq(stored.plant.canCare,false);
  await rejects(()=>care(500,2),/PLANTER_REQUIRED/);eq(await care(302),watered,'historical replay after recall does not regrow');
  await scalar('select public.save_my_room_furniture_v1($1,2,$2)',[room,objects(other)]);
  eq((await read()).plant.revision,2,'new object ID keeps growth');eq((await read()).plant.objectId,other);
  await rejects(()=>care(501,2,object),/PLANTER_REQUIRED/);
  const second=await care(502,2,other);eq(second.plantRevision,3);
  await rejects(()=>care(503,2,other),/PLANT_CONFLICT/);await rejects(()=>care(504,3,other),/PLANT_NOT_READY/);
  await q("reset role; update private.world_room_plants set planted_at=clock_timestamp()-interval '43 hours',first_cared_at=clock_timestamp()-interval '42 hours',second_cared_at=clock_timestamp()-interval '21 hours'");
  await auth(1);eq((await read()).plant.stage,'BLOOM');eq((await read()).plant.canCare,false);
  await auth(2);const visitor=await read();eq(Object.keys(visitor).sort(),['featureStatus','layoutRevision','plants','role','roomId']);
  eq(Object.keys(visitor.plants[0]).sort(),['objectId','plantId','stage']);eq(visitor.plants[0].stage,'BLOOM');
  await rejects(()=>care(600,3,other),/PLANT_ACCESS_DENIED/);await rejects(()=>scalar('select public.claim_my_room_planter_v1($1)',[room]),/PLANT_ACCESS_DENIED/);
  await q(`reset role; insert into private.world_room_owner_presence values('${room}',now())`);
  await auth(2);await rejects(read,/PLANT_ACCESS_DENIED/);
  await q(`reset role; insert into private.world_room_knocks values('${room}','${id(2)}','ACCEPTED',now(),now())`);
  await auth(2);eq((await read()).role,'visitor');
  await q(`reset role; update private.world_room_knocks set created_at=now()-interval '3 hours'`);
  await auth(2);await rejects(read,/PLANT_ACCESS_DENIED/);
  await q('reset role; delete from private.world_room_owner_presence');
  for(const direction of [1,2]) {
    await q(`reset role; insert into public.world_user_blocks values('${id(direction)}','${id(direction===1?2:1)}')`);
    await auth(2);await rejects(read,/PLANT_ACCESS_DENIED/);await q('reset role; delete from public.world_user_blocks');
  }
  await q("update public.world_player_rooms set visibility='private'");await auth(2);await rejects(read,/PLANT_ACCESS_DENIED/);
  await q("reset role; update public.world_player_rooms set visibility='friends'");
  await auth(3);await rejects(read,/PLANT_ACCESS_DENIED/);await auth(4,true);await rejects(read,/PERMANENT_ACCOUNT_REQUIRED/);await auth(5);await rejects(read,/ACCOUNT_UNAVAILABLE/);
  // Revoking current ownership hides both owner and visitor growth, preserving the record without recreating the item.
  await q("reset role; delete from private.world_player_items");await auth(1);eq((await read()).plant,null);eq((await read()).planterOwned,false);
  eq((await scalar('select public.claim_my_room_planter_v1($1)',[room])).inventory.status,'ALREADY_PROCESSED');
  await auth(2);eq((await read()).plants,[]);
  await q('reset role');eq(await scalar('select count(*)::int from private.world_player_items'),0);eq(await scalar('select count(*)::int from private.world_room_plant_receipts'),3);
  await q(`delete from auth.users where id='${id(1)}'`);eq(await scalar('select count(*)::int from private.world_room_plants'),0);eq(await scalar('select count(*)::int from private.world_room_plant_receipts'),0);
  // A second actor may reuse a request UUID without borrowing the first actor's state.
  await auth(2);await scalar('select public.claim_my_room_planter_v1($1)',[roomB]);
  await scalar('select public.save_my_room_furniture_v1($1,0,$2)',[roomB,objects(object)]);
  await q(`reset role; create function private.fixture_fail_plant_receipt() returns trigger language plpgsql as $$begin raise exception 'FIXTURE_RECEIPT_FAILURE'; end$$;
    create trigger fixture_fail_plant_receipt before insert on private.world_room_plant_receipts for each row execute function private.fixture_fail_plant_receipt();`);
  await auth(2);await rejects(()=>scalar('select public.plant_my_room_plant_v1($1,$2,$3)',[roomB,object,id(300)]),/FIXTURE_RECEIPT_FAILURE/);
  await q('reset role');eq(await scalar('select count(*)::int from private.world_room_plants'),0,'receipt failure rolls back plant state atomically');
  await q('drop trigger fixture_fail_plant_receipt on private.world_room_plant_receipts; drop function private.fixture_fail_plant_receipt()');
  await auth(2);eq((await scalar('select public.plant_my_room_plant_v1($1,$2,$3)',[roomB,object,id(300)])).userId,id(2),'same request is actor scoped');
  console.log(`PASS: ${checks} SQL assertions in PGlite; real candidate, Inventory grant, H2 save and H3 access helpers. Full Supabase replay, independent-connection concurrency and live accounts UNKNOWN.`);
} finally { await db.close(); }
