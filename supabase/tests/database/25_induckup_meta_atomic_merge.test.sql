begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select is(public.induckup_merge_meta_v1(
  '{"selectedEquipmentId":"feather-recovery","equipmentChangedAt":"2026-09-25T10:00:00Z","selectedCosmeticId":"ribbon-basic","cosmeticChangedAt":"2026-09-25T09:00:00Z"}'::jsonb,
  '{"selectedEquipmentId":"landing-chalk","equipmentChangedAt":"2026-09-25T08:00:00Z","selectedCosmeticId":"ribbon-navy","cosmeticChangedAt":"2026-09-25T11:00:00Z"}'::jsonb
) - 'version',
  '{"selectedEquipmentId":"feather-recovery","equipmentChangedAt":"2026-09-25T10:00:00Z","selectedCosmeticId":"ribbon-navy","cosmeticChangedAt":"2026-09-25T11:00:00Z"}'::jsonb,
  'equipment and cosmetic choose timestamps independently');

select is(public.induckup_merge_meta_v1(
  '{"selectedEquipmentId":null,"equipmentChangedAt":"2026-09-25T12:00:00Z"}'::jsonb,
  '{"selectedEquipmentId":"feather-recovery","equipmentChangedAt":"2026-09-25T10:00:00Z"}'::jsonb
)->'selectedEquipmentId', 'null'::jsonb, 'later unequip wins');

select is(public.induckup_merge_meta_v1(
  '{"selectedEquipmentId":"feather-recovery","equipmentChangedAt":"2026-09-25T10:00:00Z"}'::jsonb,
  null
)->>'selectedEquipmentId', 'feather-recovery', 'old client without meta keeps selection');

-- A permanent user's conflicting saves exercise the real atomic UPSERT path.
insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous)
values ('d4d4d4d4-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
  'induckup-meta@example.test', now(), false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"d4d4d4d4-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":false}';
select lives_ok($$select public.save_my_game_progress('induckup',
  '{"meta":{"version":1,"selectedEquipmentId":"landing-chalk","equipmentChangedAt":"2026-09-25T12:00:00Z"}}'::jsonb)$$,
  'permanent user saves equipment');
select lives_ok($$select public.save_my_game_progress('induckup',
  '{"meta":{"version":1,"selectedEquipmentId":"feather-recovery","equipmentChangedAt":"2026-09-25T10:00:00Z"}}'::jsonb)$$,
  'stale tab can save the rest of its progress');
select is((select progress #>> '{meta,selectedEquipmentId}' from public.get_my_game_progress('induckup')),
  'landing-chalk', 'stale tab cannot replace newer equipment selection');
select lives_ok($$select public.save_my_game_progress('induckup', '{"wave":2}'::jsonb)$$,
  'legacy client can save without a meta object');
select is((select progress #>> '{meta,selectedEquipmentId}' from public.get_my_game_progress('induckup')),
  'landing-chalk', 'legacy client cannot erase the selection');
reset role;

select * from finish();
rollback;
