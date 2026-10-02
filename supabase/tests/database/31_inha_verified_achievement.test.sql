begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('d4000000-0000-4000-8000-000000000041','authenticated','authenticated','direct@inha.edu','2026-09-26T00:00:00Z',false),
 ('d4000000-0000-4000-8000-000000000042','authenticated','authenticated','primary@example.test','2026-09-26T00:00:00Z',false),
 ('d4000000-0000-4000-8000-000000000043','authenticated','authenticated','school@inha.ac.kr','2026-09-26T00:01:00Z',false);
insert into public.profiles(user_id,nickname) values
 ('d4000000-0000-4000-8000-000000000041','직접인증'),
 ('d4000000-0000-4000-8000-000000000042','연결인증')
on conflict (user_id) do nothing;

set local role authenticated;
set local request.jwt.claims='{"sub":"d4000000-0000-4000-8000-000000000041","role":"authenticated","is_anonymous":false}';
select is((public.get_my_achievements()->>'earnedCount')::integer,1,'confirmed Inha primary mail earns platform award');
select is(public.get_my_achievements()->'achievements'->2->>'key','inha_verified_v1','platform award is third achievement');
select is((public.get_my_achievements()->'achievements'->2->>'earned')::boolean,true,'direct Inha mail award is earned');
reset role;

set local role service_role;
select ok(public.claim_inha_mail_badge(
  'd4000000-0000-4000-8000-000000000042',
  'd4000000-0000-4000-8000-000000000043'
),'linked school mailbox is accepted');
reset role;

select is((select count(*) from public.user_achievements
  where user_id='d4000000-0000-4000-8000-000000000042'
    and achievement_key='inha_verified_v1'),1::bigint,'claim materializes achievement immediately');

set local role authenticated;
set local request.jwt.claims='{"sub":"d4000000-0000-4000-8000-000000000042","role":"authenticated","is_anonymous":false}';
select is(public.my_inha_mail_badge(),true,'linked primary reports Inha verification');
select is((public.get_my_achievements()->'achievements'->2->>'earned')::boolean,true,'linked account sees earned platform award');
reset role;

select * from finish();
rollback;
