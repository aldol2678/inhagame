// Real SQL RPCs as isolated local auth roles; no Production URLs, tokens or accounts.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {IDS} from '../../../apps/world/tests/browser/room-plant-backend.mjs';
const lit=v=>v===null?'null':`'${String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")}'`;
export function createFriendPlantBrowserDatabase({env=process.env}={}){
 assert.equal(env.ROOM_PLANT_LOCAL_QA,'1');assert.match(env.DB_URL??'',/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//);
 const sql=q=>execFileSync('psql',[env.DB_URL,'-v','ON_ERROR_STOP=1','-Atq','-c',q],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const json=q=>JSON.parse(sql(q).split('\n').at(-1));
 const previous={chat:sql('select enabled from private.world_room_chat_config where singleton'),plant:sql('select private.world_room_plant_enabled_v1()'),status:sql("select status from private.world_item_catalog where item_id='furniture.indoor_planter'")};
 assert.equal(previous.plant,'f');assert.equal(previous.chat,'f');assert.equal(previous.status,'COMING_SOON');
 assert.equal(sql("select to_regprocedure('private.world_room_chat_plant_lease_v1(uuid,uuid,uuid,uuid)') is not null"),'t');
 const calls=[],allowed={get_world_room_furniture_v1:['p_room'],save_my_room_furniture_v1:['p_room','p_revision','p_objects'],get_world_room_plants_v1:['p_room'],
 claim_my_room_planter_v1:['p_room'],plant_my_room_plant_v1:['p_room','p_object','p_request_id'],care_my_room_plant_v1:['p_room','p_object','p_revision','p_request_id'],
 care_visited_room_plant_v1:['p_room','p_object','p_care_token','p_request_id','p_visit_session','p_visit_lease'],
 join_world_room_chat_v1:['p_kind','p_room','p_session','p_admission'],renew_world_room_chat_v1:['p_lease'],leave_world_room_chat_v1:['p_lease'],get_my_world_inventory_v1:[]};
 for(const [u,room] of [[IDS.a,IDS.roomA],[IDS.b,IDS.roomB]])sql(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values(${lit(u)},'authenticated','authenticated',${lit('plant-browser-'+u+'@example.test')},now(),false);insert into public.profiles(user_id,nickname,is_banned) values(${lit(u)},${lit(u===IDS.a?'화분주인':'돌봄친구')},false);insert into public.world_player_rooms(id,owner_user_id) values(${lit(room)},${lit(u)});`);
 sql(`insert into public.world_friendships(user_low,user_high,status,requested_by,accepted_at) values(${lit(IDS.a)},${lit(IDS.b)},'accepted',${lit(IDS.a)},now());select private.world_room_cleanup_v1();update private.world_room_chat_config set enabled=true where singleton;update private.world_item_catalog set status='ACTIVE' where item_id='furniture.indoor_planter';create or replace function private.world_room_plant_enabled_v1() returns boolean language sql stable security definer set search_path='' as $$select true$$;`);
 assert.equal(sql('select private.world_room_chat_personal_authority_ready_v1()'),'t');
 async function rpc(actor,name,args={}){
  assert.ok([IDS.a,IDS.b].includes(actor));if(name==='fixture_inventory')name='get_my_world_inventory_v1';assert.ok(Object.hasOwn(allowed,name),name);
  const values=allowed[name].map(k=>lit(args[k]??null)+(k==='p_objects'?'::jsonb':''));
  try{const data=json(`begin;set local role authenticated;set local request.jwt.claims=${lit({sub:actor,role:'authenticated',is_anonymous:false})};select public.${name}(${values.join(',')});commit;`);calls.push({actor,name,args:structuredClone(args),ok:true});return{data,error:null};}
  catch(e){const message=/ERROR:\s+([A-Z_]+)/.exec(String(e.stderr??e.message))?.[1]??'FIXTURE_DB_ERROR';calls.push({actor,name,args:structuredClone(args),ok:false,error:message});return{data:null,error:{message}};}
 }
 return{rpc,calls,
  readySecondCare(){sql(`update private.world_room_plants set planted_at=clock_timestamp()-interval '22 hours',first_cared_at=clock_timestamp()-interval '21 hours' where user_id=${lit(IDS.a)}`);},
  block(){sql(`insert into public.world_user_blocks(blocker_id,blocked_id) values(${lit(IDS.a)},${lit(IDS.b)})`);},
  disableChat(){sql('update private.world_room_chat_config set enabled=false where singleton');},
  evidence(){return json(`select jsonb_build_object('revision',(select revision from private.world_room_plants where user_id=${lit(IDS.a)}),'receipts',(select count(*) from private.world_room_plant_receipts where coalesce(owner_user_id,user_id)=${lit(IDS.a)}),'careActors',(select jsonb_agg(user_id order by plant_revision) from private.world_room_plant_receipts where coalesce(owner_user_id,user_id)=${lit(IDS.a)}),'money',(select count(*) from private.world_currency_transactions where user_id in (${lit(IDS.a)},${lit(IDS.b)})),'xp',(select count(*) from private.world_exp_transactions where user_id in (${lit(IDS.a)},${lit(IDS.b)})),'lifeXp',(select count(*) from private.world_life_skill_xp_transactions where user_id in (${lit(IDS.a)},${lit(IDS.b)})),'chatMessages',(select count(*) from private.world_room_chat_limits where user_id in (${lit(IDS.a)},${lit(IDS.b)})))`);},
  close(){sql(`delete from auth.users where id in (${lit(IDS.a)},${lit(IDS.b)});update private.world_room_chat_config set enabled=${previous.chat==='t'} where singleton;update private.world_item_catalog set status=${lit(previous.status)} where item_id='furniture.indoor_planter';create or replace function private.world_room_plant_enabled_v1() returns boolean language sql stable security definer set search_path='' as $$select false$$;`);}
 };
}
