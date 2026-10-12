-- Candidate authority regression; no chat feature is enabled outside this rollback transaction.
-- Supabase Realtime websocket delivery is a separate two-client activation acceptance gate.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select ok(not (select enabled from private.world_room_chat_config where singleton), 'candidate starts CLOSED');
select ok(not has_table_privilege(r, 'private.world_room_chat_sessions', p), format('%s cannot %s room leases', r, p))
from unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) p;
select ok(not has_table_privilege(r, 'private.world_room_chat_limits', p), format('%s cannot %s rate timestamps', r, p))
from unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) p;
select ok(not has_function_privilege('anon', f, 'execute'), format('anon cannot execute %s', f)) from unnest(array[
  'public.join_world_room_chat_v1(text,text,uuid)', 'public.renew_world_room_chat_v1(uuid)',
  'public.send_world_room_chat_v1(uuid,text)', 'public.leave_world_room_chat_v1(uuid)',
  'public.can_receive_world_room_chat_v1(text)']) f;

insert into auth.users(id,aud,role,email,is_anonymous) values
 ('01000000-0000-4000-8000-000000000001','authenticated','authenticated','chat-owner@example.test',false),
 ('01000000-0000-4000-8000-000000000002','authenticated','authenticated','chat-friend@example.test',false),
 ('01000000-0000-4000-8000-000000000003','authenticated','authenticated','chat-stranger@example.test',false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('01000000-0000-4000-8000-000000000001','채팅주인',false),
 ('01000000-0000-4000-8000-000000000002','채팅친구',false),
 ('01000000-0000-4000-8000-000000000003','외부인',false)
on conflict (user_id) do update set nickname=excluded.nickname,is_banned=excluded.is_banned;
insert into public.world_friendships(user_low,user_high,status,requested_by,accepted_at) values
 ('01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000002','accepted','01000000-0000-4000-8000-000000000001',now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"01000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('chat.room',(public.get_or_create_my_personal_room_v1()->>'roomId'),true);
select public.set_my_personal_room_visibility_v1('friends');
reset role;
update private.world_room_chat_config set enabled=true;
select ok(private.world_room_chat_access_v1('01000000-0000-4000-8000-000000000001','personal',current_setting('chat.room'),'01000000-0000-4000-8000-000000000011'), 'owner admission');
select ok(private.world_room_chat_access_v1('01000000-0000-4000-8000-000000000002','personal',current_setting('chat.room'),'01000000-0000-4000-8000-000000000012'), 'friend admission');
select ok(not private.world_room_chat_access_v1('01000000-0000-4000-8000-000000000003','personal',current_setting('chat.room'),'01000000-0000-4000-8000-000000000013'), 'known UUID is not admission');
select ok(not private.world_room_chat_access_v1('01000000-0000-4000-8000-000000000001','personal','ROOM_CLUBHOUSE_01','01000000-0000-4000-8000-000000000011'), 'club ID cannot enter personal contract');
select ok(not private.world_room_chat_access_v1('01000000-0000-4000-8000-000000000001','club','ROOM_CLUBHOUSE_01','01000000-0000-4000-8000-000000000011'), 'club chat requires an active club admission');

-- Insert one fixture lease directly so send authority can be exercised even without a running
-- Realtime service. There is no recipient, hence no provider delivery call in this fixture.
insert into private.world_room_chat_sessions(id,user_id,kind,room_id,session_id,lease_expires_at) values
 ('01000000-0000-4000-8000-000000000021','01000000-0000-4000-8000-000000000001','personal',current_setting('chat.room'),'01000000-0000-4000-8000-000000000011',clock_timestamp()+interval '30 seconds');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"01000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select ok(public.can_receive_world_room_chat_v1('world:room-chat:01000000-0000-4000-8000-000000000021'), 'own inbox accepted');
select ok(not public.can_receive_world_room_chat_v1('world:room-chat:01000000-0000-4000-8000-000000000021:suffix'), 'topic grammar exact');
select is(public.send_world_room_chat_v1('01000000-0000-4000-8000-000000000021',repeat('👋',121))->>'reason','too_long','Unicode limit server-side');
select is(public.send_world_room_chat_v1('01000000-0000-4000-8000-000000000021',' x ')->>'reason','malformed','noncanonical input refused');
select is(public.send_world_room_chat_v1('01000000-0000-4000-8000-000000000021','첫 메시지')->'message'->>'userId','01000000-0000-4000-8000-000000000001','sender comes from auth');
select is(public.send_world_room_chat_v1('01000000-0000-4000-8000-000000000021','두 번째')->'message'->>'name','채팅주인','nickname comes from profile');
select is(public.send_world_room_chat_v1('01000000-0000-4000-8000-000000000021','<img onerror=evil()>')->>'ok','true','markup is transmitted as text');
select is(public.send_world_room_chat_v1('01000000-0000-4000-8000-000000000021','네 번째')->>'reason','rate_limited','three per five seconds enforced');
select set_config('request.jwt.claims','{"sub":"01000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
select ok(not public.can_receive_world_room_chat_v1('world:room-chat:01000000-0000-4000-8000-000000000021'), 'friend cannot subscribe owner inbox');
select is(public.send_world_room_chat_v1('01000000-0000-4000-8000-000000000021','위조')->>'ok','false','other account cannot impersonate sender lease');
select ok(not public.leave_world_room_chat_v1('01000000-0000-4000-8000-000000000021'), 'other account cannot revoke sender lease');
reset role;
insert into public.world_user_blocks(blocker_id,blocked_id) values ('01000000-0000-4000-8000-000000000002','01000000-0000-4000-8000-000000000001');
select ok(not private.world_room_chat_access_v1('01000000-0000-4000-8000-000000000002','personal',current_setting('chat.room'),'01000000-0000-4000-8000-000000000012'),'reverse block denies visitor');
insert into private.world_user_moderation_actions(target_id,action,starts_at,ends_at,actor_source) values
 ('01000000-0000-4000-8000-000000000001','interaction_restriction_24h',now()-interval '1 minute',now()+interval '1 day','ops_token');
select ok(not private.world_room_chat_access_v1('01000000-0000-4000-8000-000000000001','personal',current_setting('chat.room'),'01000000-0000-4000-8000-000000000011'),'active interaction restriction denies owner chat');
update private.world_user_moderation_actions set ends_at=now()-interval '1 second' where target_id='01000000-0000-4000-8000-000000000001';
select ok(private.world_room_chat_access_v1('01000000-0000-4000-8000-000000000001','personal',current_setting('chat.room'),'01000000-0000-4000-8000-000000000011'),'expired interaction restriction no longer denies');
update private.world_room_chat_sessions set lease_expires_at=clock_timestamp()-interval '1 second';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"01000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select is(public.renew_world_room_chat_v1('01000000-0000-4000-8000-000000000021')->>'allowed','false','expired lease cannot renew');
select ok(not public.can_receive_world_room_chat_v1('world:room-chat:01000000-0000-4000-8000-000000000021'),'expired inbox denied');
reset role;
select * from finish();
rollback;
