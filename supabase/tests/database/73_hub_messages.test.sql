-- INHAGAME Hub Messages P0-M1: 1:1 mailbox authority, privacy boundary, blocks, reports, limits.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'hub-a@inha.edu', now(), false),
 ('82000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'hub-b@example.test', now(), false),
 ('83000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'hub-c@example.test', now(), false),
 ('84000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', null, null, true),
 ('85000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'hub-banned@example.test', now(), false);

insert into public.profiles(user_id, nickname, title, is_banned) values
 ('81000000-0000-4000-8000-000000000001', '허브A', '탐험가', false),
 ('82000000-0000-4000-8000-000000000002', '허브B', null, false),
 ('83000000-0000-4000-8000-000000000003', '허브C', null, false),
 ('84000000-0000-4000-8000-000000000004', '허브게스트', null, false),
 ('85000000-0000-4000-8000-000000000005', '허브밴', null, true)
on conflict (user_id) do update
set nickname=excluded.nickname, title=excluded.title, is_banned=excluded.is_banned;

-- ---------------------------------------------------------------- schema / boundary
select has_table('public', t, format('%s exists', t))
from unnest(array[
  'hub_conversations','hub_conversation_members','hub_messages','hub_message_reports'
]) t;

select ok(
  (select relrowsecurity from pg_class where oid=format('public.%s',t)::regclass),
  format('%s has RLS',t)
)
from unnest(array[
  'hub_conversations','hub_conversation_members','hub_messages','hub_message_reports'
]) t;

select col_is_pk('public','hub_conversations','id','conversation id is primary key');
select col_is_pk('public','hub_conversation_members',array['conversation_id','user_id'],'one membership row per user/conversation');
select col_is_pk('public','hub_messages','id','message id is primary key');
select col_is_unique('public','hub_conversations',array['user_low','user_high'],'one conversation per unordered pair');

set local role anon;
select throws_ok(
  $$select public.send_hub_message_v1('82000000-0000-4000-8000-000000000002','hi')$$,
  '42501', null, 'anon cannot call Hub message RPC'
);
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok($$select * from public.hub_messages$$,'42501',null,'authenticated cannot read message table directly');
select throws_ok($$select * from public.hub_conversations$$,'42501',null,'authenticated cannot read conversation table directly');

set local request.jwt.claims='{"sub":"84000000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$select public.send_hub_message_v1('82000000-0000-4000-8000-000000000002','guest')$$,
  '42501','PERMANENT_ACCOUNT_REQUIRED','guest cannot message'
);

set local request.jwt.claims='{"sub":"85000000-0000-4000-8000-000000000005","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$select public.get_my_hub_conversations_v1(50)$$,
  '42501','ACCOUNT_UNAVAILABLE','banned caller cannot use mailbox'
);

set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$select public.send_hub_message_v1('85000000-0000-4000-8000-000000000005','hello')$$,
  '22023','TARGET_UNAVAILABLE','banned recipient is unavailable'
);
select throws_ok(
  $$select public.send_hub_message_v1('81000000-0000-4000-8000-000000000001','self')$$,
  '22023','TARGET_UNAVAILABLE','cannot message self'
);
select throws_ok(
  $$select public.send_hub_message_v1('82000000-0000-4000-8000-000000000002','   ')$$,
  '22023','INVALID_MESSAGE','blank message rejected'
);
select throws_ok(
  $$select public.send_hub_message_v1('82000000-0000-4000-8000-000000000002',repeat('x',1001))$$,
  '22023','INVALID_MESSAGE','message length capped at 1000'
);

-- ---------------------------------------------------------------- initiation / reply / pair idempotency
set local request.jwt.claims='{"sub":"83000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$select public.send_hub_message_v1('82000000-0000-4000-8000-000000000002','first')$$,
  '42501','INHA_VERIFICATION_REQUIRED','unverified member cannot initiate a new conversation'
);

set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select is(
  public.send_hub_message_v1('82000000-0000-4000-8000-000000000002','  첫 쪽지  ')->>'newConversation',
  'true','Inha-verified member starts a conversation'
);
select is((select count(*) from public.hub_conversations),1::bigint,'one conversation created');
select is((select count(*) from public.hub_conversation_members),2::bigint,'exactly two members created');
select is((select body from public.hub_messages limit 1),'첫 쪽지','message body normalized');

select is(
  public.send_hub_message_v1('82000000-0000-4000-8000-000000000002','두 번째')->>'newConversation',
  'false','same pair reuses existing conversation'
);
reset role;
select is((select count(*) from public.hub_conversations),1::bigint,'repeated sends never duplicate the pair');

set local role authenticated;
set local request.jwt.claims='{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select is(
  public.send_hub_message_v1('81000000-0000-4000-8000-000000000001','답장')->>'newConversation',
  'false','unverified permanent member may reply to an existing conversation'
);
select is(jsonb_array_length(public.get_my_hub_conversations_v1(50)),1,'recipient inbox contains the thread');
select is(public.get_my_hub_unread_count_v1(),2::bigint,'recipient has two unread messages from initiator');

set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select is(public.get_my_hub_unread_count_v1(),1::bigint,'initiator sees one unread reply');
select is(
  jsonb_array_length(
    public.get_hub_messages_v1(
      (public.get_my_hub_conversations_v1(50)->0->>'conversationId')::uuid,50,null
    )->'messages'
  ),
  3,'thread read returns all messages'
);
select ok(
  (public.mark_hub_conversation_read_v1(
    (public.get_my_hub_conversations_v1(50)->0->>'conversationId')::uuid
  )->>'readAt') is not null,
  'mark read returns a timestamp'
);
select is(public.get_my_hub_unread_count_v1(),0::bigint,'mark read clears unread count');

select is(
  public.archive_hub_conversation_v1(
    (public.get_my_hub_conversations_v1(50)->0->>'conversationId')::uuid,true
  )->>'archived',
  'true','conversation can be archived'
);
select is(jsonb_array_length(public.get_my_hub_conversations_v1(50)),0,'archived thread leaves inbox');

-- pgTAP wraps this file in one transaction, so now() is transaction-stable. Backdate the
-- archive read marker to model the next RPC transaction before the recipient sends again.
reset role;
update public.hub_conversation_members
set last_read_at = now() - interval '1 second'
where user_id='81000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims='{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select is(
  public.send_hub_message_v1('81000000-0000-4000-8000-000000000001','새 답장')->>'newConversation',
  'false','new message reuses archived conversation'
);
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select is(jsonb_array_length(public.get_my_hub_conversations_v1(50)),1,'new message restores archived thread');
select is(public.get_my_hub_unread_count_v1(),1::bigint,'only the post-archive message is unread');

-- ---------------------------------------------------------------- shared block authority
select is(
  public.block_world_user('82000000-0000-4000-8000-000000000002')->>'relationship',
  'blocked_by_me','Hub reuses World block authority'
);
select throws_ok(
  $$select public.send_hub_message_v1('82000000-0000-4000-8000-000000000002','blocked')$$,
  '42501','NOT_ALLOWED','blocker cannot send Hub messages'
);
set local request.jwt.claims='{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$select public.send_hub_message_v1('81000000-0000-4000-8000-000000000001','blocked back')$$,
  '42501','NOT_ALLOWED','blocked user cannot send Hub messages'
);
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select is(public.unblock_world_user('82000000-0000-4000-8000-000000000002')->>'relationship','none','shared block can be lifted');

-- ---------------------------------------------------------------- message reporting
select is(
  public.report_hub_message_v1(
    (public.get_hub_messages_v1(
      (public.get_my_hub_conversations_v1(50)->0->>'conversationId')::uuid,50,null
    )->'messages'->0->>'id')::uuid,
    'spam'
  )->>'status',
  'received','recipient message can be reported'
);
select is(
  public.report_hub_message_v1(
    (public.get_hub_messages_v1(
      (public.get_my_hub_conversations_v1(50)->0->>'conversationId')::uuid,50,null
    )->'messages'->0->>'id')::uuid,
    'spam'
  )->>'status',
  'duplicate','same report is deduplicated for 24 hours'
);
select throws_ok(
  $$select public.report_hub_message_v1(
    (public.get_hub_messages_v1(
      (public.get_my_hub_conversations_v1(50)->0->>'conversationId')::uuid,50,null
    )->'messages'->2->>'id')::uuid,
    'spam'
  )$$,
  '22023','CANNOT_REPORT_SELF','cannot report own message'
);
select throws_ok(
  $$select public.report_hub_message_v1(
    (public.get_hub_messages_v1(
      (public.get_my_hub_conversations_v1(50)->0->>'conversationId')::uuid,50,null
    )->'messages'->0->>'id')::uuid,
    'rude'
  )$$,
  '22023','INVALID_CATEGORY','report category is allowlisted'
);
reset role;
select is((select count(*) from public.hub_message_reports),1::bigint,'one structured report stored');
select ok(
  not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='hub_message_reports'
      and column_name in ('body','text','comment','detail')
  ),
  'report row stores no free-text complaint'
);

-- ---------------------------------------------------------------- new-conversation rate limits
delete from public.hub_conversations;

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
select md5('hub-rate-'||g)::uuid,'authenticated','authenticated',
       'hub-rate-'||g||'@example.test',now(),false
from generate_series(1,21) g;

insert into public.profiles(user_id,nickname,is_banned)
select md5('hub-rate-'||g)::uuid,'rate-'||g,false
from generate_series(1,21) g;

insert into public.hub_conversations(user_low,user_high,created_by,created_at,updated_at)
select
  least('81000000-0000-4000-8000-000000000001'::uuid,md5('hub-rate-'||g)::uuid),
  greatest('81000000-0000-4000-8000-000000000001'::uuid,md5('hub-rate-'||g)::uuid),
  '81000000-0000-4000-8000-000000000001'::uuid,
  now()-interval '5 minutes',
  now()-interval '5 minutes'
from generate_series(1,5) g;

set local role authenticated;
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$select public.send_hub_message_v1(md5('hub-rate-6')::uuid,'sixth')$$,
  '54000','RATE_LIMITED','at most five new recipients per ten minutes'
);
reset role;

delete from public.hub_conversations;
insert into public.hub_conversations(user_low,user_high,created_by,created_at,updated_at)
select
  least('81000000-0000-4000-8000-000000000001'::uuid,md5('hub-rate-'||g)::uuid),
  greatest('81000000-0000-4000-8000-000000000001'::uuid,md5('hub-rate-'||g)::uuid),
  '81000000-0000-4000-8000-000000000001'::uuid,
  now()-interval '2 hours',
  now()-interval '2 hours'
from generate_series(1,20) g;

set local role authenticated;
set local request.jwt.claims='{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$select public.send_hub_message_v1(md5('hub-rate-21')::uuid,'twenty-first')$$,
  '54000','RATE_LIMITED','at most twenty new recipients per twenty-four hours'
);
reset role;

-- ---------------------------------------------------------------- private helpers stay private
select ok(not has_function_privilege(r,f,'execute'),format('%s cannot execute %s',r,f))
from unnest(array['anon','authenticated']) r,
unnest(array[
  'private.hub_message_caller()',
  'private.hub_message_target(uuid,uuid)',
  'private.hub_message_inha_verified(uuid)',
  'private.hub_message_card(uuid)',
  'private.hub_message_lock_pair(uuid,uuid)',
  'private.hub_message_lock_sender(uuid)'
]) f;

select * from finish();
rollback;
