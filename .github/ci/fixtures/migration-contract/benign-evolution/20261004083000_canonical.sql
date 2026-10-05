-- A canonical table plus the normal ways later migrations evolve it.
create table if not exists private.world_example_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount bigint not null check (amount > 0),
  note varchar(40),
  created_at timestamptz not null default now()
);
comment on table private.world_example_ledger is 'semicolons; in -- strings and $$ do not split ''statements''';
create index if not exists world_example_ledger_user_idx on private.world_example_ledger(user_id);
alter table private.world_example_ledger enable row level security;
create or replace function private.world_example_apply_v1(p_user uuid, p_amount bigint)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  -- create table if not exists private.world_example_ledger (bogus int);  (inside a body: ignored)
  insert into private.world_example_ledger(user_id, amount) values (p_user, p_amount);
end;
$fn$;
