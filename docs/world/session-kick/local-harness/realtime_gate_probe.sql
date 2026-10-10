\set ON_ERROR_STOP 0
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('aaaaaaaa-0000-4000-8000-000000000001','authenticated','authenticated','g1@example.test',now(),false),
 ('aaaaaaaa-0000-4000-8000-000000000002','authenticated','authenticated','g2@example.test',now(),false);
insert into realtime.messages(topic,extension,payload) values ('world:campus:AREA_MAIN_HALL','broadcast','{}');
create temp table out(step text, visible bigint, can_insert boolean);
grant all on out to authenticated;
create function pg_temp.probe(p_step text, p_user text) returns void language plpgsql as $$
declare v_vis bigint; v_ins boolean := true;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated','is_anonymous',false)::text, true);
  perform set_config('realtime.topic','world:campus:AREA_MAIN_HALL', true);
  set local role authenticated;
  select count(*) into v_vis from realtime.messages;
  begin insert into realtime.messages(topic,extension,payload) values ('world:campus:AREA_MAIN_HALL','presence','{}');
  exception when insufficient_privilege then v_ins := false; end;
  reset role;
  insert into pg_temp.out values (p_step, v_vis, v_ins);
end $$;
begin;
 select pg_temp.probe('before kick (blocked-to-be user)','aaaaaaaa-0000-4000-8000-000000000001');
 insert into private.world_session_kick_blocks(user_id,blocked_until,operator_id) values ('aaaaaaaa-0000-4000-8000-000000000001', now()+interval '10 min','aaaaaaaa-0000-4000-8000-000000000002');
 select pg_temp.probe('after kick: kicked user','aaaaaaaa-0000-4000-8000-000000000001');
 select pg_temp.probe('after kick: other user','aaaaaaaa-0000-4000-8000-000000000002');
 update private.world_session_kick_blocks set blocked_until = now()-interval '1 second';
 select pg_temp.probe('after expiry: kicked user','aaaaaaaa-0000-4000-8000-000000000001');
 select * from pg_temp.out;
rollback;
