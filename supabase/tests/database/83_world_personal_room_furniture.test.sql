-- Disposable Collection-backed housing contract. All users, grants, rooms and layouts roll back.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a3000000-0000-4000-8000-000000000001','authenticated','authenticated','furniture-owner@example.test',now(),false),
 ('b3000000-0000-4000-8000-000000000002','authenticated','authenticated','furniture-friend@example.test',now(),false),
 ('c3000000-0000-4000-8000-000000000003','authenticated','authenticated','furniture-stranger@example.test',now(),false),
 ('d3000000-0000-4000-8000-000000000004','authenticated','authenticated',null,null,true);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a3000000-0000-4000-8000-000000000001','가구주인',false),
 ('b3000000-0000-4000-8000-000000000002','방문친구',false),
 ('c3000000-0000-4000-8000-000000000003','다른유저',false),
 ('d3000000-0000-4000-8000-000000000004','게스트',false)
on conflict(user_id) do update set is_banned=false;
insert into public.world_friendships(user_low,user_high,status,requested_by,accepted_at) values
 ('a3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002','accepted','a3000000-0000-4000-8000-000000000001',now());
select private.world_inventory_grant_v1('a3000000-0000-4000-8000-000000000001','furniture.induck_chair',1,'SYSTEM','housing-d3-fixture','housing-d3:chair',null,null);

select ok((select relrowsecurity from pg_class where oid='private.world_room_layouts'::regclass),'layout table has RLS');
select ok(not has_table_privilege(r,'private.world_room_layouts',p),r||' has no direct '||p)
from unnest(array['anon','authenticated']) r,unnest(array['select','insert','update','delete']) p;
select ok(not has_function_privilege('anon',f,'execute'),'anon cannot execute '||f)
from unnest(array['public.get_world_room_furniture_v1(uuid)','public.save_my_room_furniture_v1(uuid,integer,jsonb)']) f;
select ok(has_function_privilege('authenticated',f,'execute'),'authenticated may execute '||f)
from unnest(array['public.get_world_room_furniture_v1(uuid)','public.save_my_room_furniture_v1(uuid,integer,jsonb)']) f;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot call private helper '||f)
from unnest(array['anon','authenticated']) r,unnest(array['private.world_room_furniture_v1()','private.validate_world_room_furniture_v1(uuid,jsonb)']) f;
select is((select count(*) from private.world_room_furniture_v1()),17::bigint,'server furniture catalog exposes sixteen F0 and one cooking candidate placement');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('housing.d3_room',public.get_or_create_my_personal_room_v1()->>'roomId',true);
select set_config('housing.d3_chair','[{"id":"11111111-1111-4111-8111-111111111111","itemId":"furniture.induck_chair","surface":"floor","x":-2,"z":-1,"yaw":0}]',true);
select is(public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)->>'revision','0','uninitialized layout is empty revision zero');
select is(public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)->'objects','[]'::jsonb,'no auto-grants or seeded ownership');
select is(public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,0,'[]')->>'revision','0','empty no-op does not bump revision');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,0,'[{"id":"11111111-1111-4111-8111-111111111111","itemId":"furniture.dorm_desk_lamp","surface":"desk","x":2.25,"z":1.5,"yaw":0}]')$$,'42501','ITEM_NOT_OWNED','unowned Collection item cannot be placed');
select is(public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,0,current_setting('housing.d3_chair')::jsonb)->>'revision','1','first real save advances revision');
select is(public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)->'objects',current_setting('housing.d3_chair')::jsonb,'re-entry reads exact saved placement');
select is(public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,0,current_setting('housing.d3_chair')::jsonb)->>'revision','1','lost-response retry is idempotent even with previous revision');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,0,'[]')$$,'40001','LAYOUT_CONFLICT','stale different snapshot never overwrites');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,1,jsonb_set(current_setting('housing.d3_chair')::jsonb,'{0,x}','0')||jsonb_build_array(jsonb_set((current_setting('housing.d3_chair')::jsonb)->0,'{id}','"22222222-2222-4222-8222-222222222222"')))$$,'42501','ITEM_NOT_OWNED','aggregate quantity must not exceed owned count');

-- Grant through the existing inventory authority, with provenance. Fixtures remain transaction-local.
reset role;
select private.world_inventory_grant_v1('a3000000-0000-4000-8000-000000000001',item_id,1,'SYSTEM','housing-d3-fixture','housing-d3:'||item_id,null,null)
from private.world_room_furniture_v1() where item_id<>'furniture.induck_chair';
select set_config('housing.d3_owned_before',(select jsonb_agg(jsonb_build_object('item',item_id,'quantity',quantity) order by item_id)::text from private.world_player_items where user_id='a3000000-0000-4000-8000-000000000001'),true);
set local role authenticated;
select lives_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,1,'[
 {"id":"11111111-1111-4111-8111-111111111111","itemId":"furniture.induck_chair","surface":"floor","x":-2,"z":-1,"yaw":45},
 {"id":"22222222-2222-4222-8222-222222222222","itemId":"furniture.campus_rug_blue","surface":"floor","x":-2.5,"z":-1.75,"yaw":0},
 {"id":"33333333-3333-4333-8333-333333333333","itemId":"furniture.dorm_desk_lamp","surface":"desk","x":2.25,"z":1.5,"yaw":0},
 {"id":"44444444-4444-4444-8444-444444444444","itemId":"furniture.mini_induck","surface":"desk","x":2.5,"z":1.5,"yaw":0},
 {"id":"55555555-5555-4555-8555-555555555555","itemId":"furniture.induck_cushion","surface":"bed","x":-3.75,"z":1.5,"yaw":45},
 {"id":"66666666-6666-4666-8666-666666666666","itemId":"furniture.campus_map_poster","surface":"north","x":-3,"z":4.15,"yaw":0},
 {"id":"77777777-7777-4777-8777-777777777777","itemId":"furniture.dorm_resident_plate","surface":"south","x":2,"z":-4.15,"yaw":180},
 {"id":"88888888-8888-4888-8888-888888888888","itemId":"furniture.mcm_2026_poster","surface":"west","x":-5.35,"z":-1,"yaw":270},
 {"id":"99999999-9999-4999-8999-999999999999","itemId":"furniture.mcm_2026_landlord_figure","surface":"floor","x":1.5,"z":-1.5,"yaw":0},
 {"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","itemId":"furniture.dorm_single_sofa","surface":"floor","x":-6.25,"z":1,"yaw":0},
 {"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","itemId":"furniture.dorm_side_table_low","surface":"floor","x":-6.25,"z":2,"yaw":0},
 {"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3","itemId":"furniture.dorm_bookshelf_slim","surface":"floor","x":6.5,"z":0.5,"yaw":0},
 {"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4","itemId":"furniture.dorm_plant_medium","surface":"floor","x":6.5,"z":-1,"yaw":0},
 {"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5","itemId":"furniture.dorm_monitor","surface":"desk","x":2.75,"z":1.75,"yaw":0},
 {"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6","itemId":"furniture.dorm_trophy_shelf","surface":"floor","x":6.5,"z":2.5,"yaw":0},
 {"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7","itemId":"furniture.study_books_set","surface":"desk","x":2.25,"z":1.75,"yaw":0}
 ]')$$,'all sixteen F0 Collection items save together, including the C70 side bays');
select set_config('housing.d3_saved',(public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)->'objects')::text,true);
select is(public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)->>'revision','2','atomic replacement advances once');
select is(public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,1,(select jsonb_agg(value order by value->>'id' desc) from jsonb_array_elements(current_setting('housing.d3_saved')::jsonb)))->>'revision','2','reordered identical snapshot is also idempotent');

-- Invalid geometry/snapshot never changes the preceding saved layout.
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,null)$$,'22023','INVALID_LAYOUT','SQL null rejected');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,'null')$$,'22023','INVALID_LAYOUT','JSON null rejected');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,'[null]')$$,'22023','INVALID_LAYOUT','non-object placement rejected');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_set(current_setting('housing.d3_chair')::jsonb,'{0,x}','-2.1'))$$,'22023','INVALID_LAYOUT','quarter-unit grid enforced');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_set(current_setting('housing.d3_chair')::jsonb,'{0,yaw}','46'))$$,'22023','INVALID_LAYOUT','45-degree rotation enforced');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_set(current_setting('housing.d3_chair')::jsonb,'{0,x}','1e100'))$$,'22023','INVALID_LAYOUT','huge coordinates rejected before float cast');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_set(current_setting('housing.d3_chair')::jsonb,'{0,x}','-7'))$$,'22023','ROOM_BOUNDS','footprint must fit room');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_set(jsonb_set(current_setting('housing.d3_chair')::jsonb,'{0,x}','0'),'{0,z}','-2.75'))$$,'22023','EXIT_BLOCKED','door and spawn corridor cannot be blocked');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_set(jsonb_set(current_setting('housing.d3_chair')::jsonb,'{0,x}','-3.75'),'{0,z}','1.5'))$$,'22023','FURNITURE_OVERLAP','base fixtures protected');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_set(current_setting('housing.d3_chair')::jsonb,'{0,itemId}','"bed_basic"'))$$,'22023','INVALID_LAYOUT','obsolete generic furniture IDs are not accepted');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_set(current_setting('housing.d3_chair')::jsonb,'{0,y}','100'))$$,'22023','INVALID_LAYOUT','arbitrary height or extra keys rejected');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_build_array((current_setting('housing.d3_chair')::jsonb)->0, jsonb_set((current_setting('housing.d3_chair')::jsonb)->0,'{itemId}','"furniture.mini_induck"')))$$,'22023','INVALID_LAYOUT','duplicate object IDs rejected');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,jsonb_build_array((current_setting('housing.d3_chair')::jsonb)->0, jsonb_set(jsonb_set((current_setting('housing.d3_chair')::jsonb)->0,'{itemId}','"furniture.mini_induck"'),'{id}','"22222222-2222-4222-8222-222222222222"')))$$,'22023','FURNITURE_OVERLAP','same surface solid placements cannot overlap');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,(select jsonb_agg((current_setting('housing.d3_chair')::jsonb)->0) from generate_series(1,33)))$$,'22023','INVALID_LAYOUT','bounded object count');
select is(public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)->'objects',current_setting('housing.d3_saved')::jsonb,'all rejected saves leave preceding snapshot intact');

-- D2 authority applies to layout reads and owner-only saves too.
select set_config('request.jwt.claims','{"sub":"b3000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
select is(public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)->>'role','visitor','friend receives saved furniture as visitor');
select is(public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)->'objects',current_setting('housing.d3_saved')::jsonb,'visitor reads the same authoritative saved layout');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,'[]')$$,'42501','LAYOUT_DENIED','visitor cannot save owner room');
select set_config('request.jwt.claims','{"sub":"c3000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)$$,'42501','LAYOUT_DENIED','stranger cannot read layout');
select throws_ok($$select public.get_world_room_furniture_v1('00000000-0000-4000-8000-000000000000')$$,'42501','LAYOUT_DENIED','unknown UUID reveals no room existence');
select throws_ok($$select public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,'[]')$$,'42501','LAYOUT_DENIED','another account cannot clear layout');
select set_config('request.jwt.claims','{"sub":"d3000000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)$$,'42501','PERMANENT_ACCOUNT_REQUIRED','guest cannot read room furniture');
select set_config('request.jwt.claims','{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select public.set_my_personal_room_visibility_v1('private');
select set_config('request.jwt.claims','{"sub":"b3000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
select throws_ok($$select public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)$$,'42501','LAYOUT_DENIED','privacy change revokes saved-layout reads');
select set_config('request.jwt.claims','{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select is(public.save_my_room_furniture_v1(current_setting('housing.d3_room')::uuid,2,'[]')->>'revision','3','owner can recall all furniture in private room');
select is(public.get_world_room_furniture_v1(current_setting('housing.d3_room')::uuid)->'objects','[]'::jsonb,'clear persists without deleting base template');
reset role;
select is((select jsonb_agg(jsonb_build_object('item',item_id,'quantity',quantity) order by item_id) from private.world_player_items where user_id='a3000000-0000-4000-8000-000000000001'),current_setting('housing.d3_owned_before')::jsonb,'placing and recalling never changes Collection ownership');
select * from finish();
rollback;
