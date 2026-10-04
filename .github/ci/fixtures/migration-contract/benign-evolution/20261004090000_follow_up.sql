-- Intended follow-ups: none of these is a contract collision.
alter table private.world_example_ledger add column if not exists source_type text not null default 'system';
alter table only private.world_example_ledger add constraint world_example_ledger_source_check check (source_type <> '');
alter table private.world_example_ledger rename column note to memo;
alter table private.world_example_ledger alter column memo type character varying(80);
create policy world_example_ledger_none on private.world_example_ledger for select using (false);
drop index if exists private.world_example_ledger_user_idx;
create index world_example_ledger_user_created_idx on private.world_example_ledger(user_id, created_at desc);
-- Idempotent re-declaration of the *current* contract (aliases normalize: int8 = bigint, timestamptz).
create table if not exists private.world_example_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount int8 not null,
  memo character varying(80),
  created_at timestamp with time zone not null default now(),
  source_type text not null default 'system'
);
insert into private.world_example_ledger(user_id, amount, memo, source_type)
select gen_random_uuid(), 1, 'seed', 'system' where false;
-- Intended next version of the function.
create or replace function private.world_example_apply_v1(p_user uuid, p_amount bigint)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  insert into private.world_example_ledger(user_id, amount, source_type) values (p_user, p_amount, 'system');
end;
$fn$;
-- A table can be dropped and re-created with a new contract on purpose.
create table private.world_example_scratch (a int);
drop table private.world_example_scratch;
create table private.world_example_scratch (b text);
