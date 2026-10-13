-- JSL-A: Jeongseok Library access gate and game-only visitor pass.
-- This repository's migrations target disposable local databases only, never Production.
--
-- Policy (JSL-01): Inha mail verified permanent accounts enter free; other permanent accounts buy a
-- game-only, account-bound 24h visitor pass with Induck Coin; guests, anonymous and banned
-- accounts are refused. Email verification proves mailbox ownership only, never enrollment or a
-- real facility right. No email, student number, QR or barcode is stored here.
--
-- Closed by default: the gate policy and the pass product ship COMING_SOON. 100 coins is a
-- balance CANDIDATE, not a confirmed price; the access read never exposes a non-ACTIVE price.
-- Value movement reuses the protected Wallet primitive; no second wallet or ledger copy exists.

-- Singleton gate policy (migration-owned). Not ACTIVE = DISABLED / COMING_SOON for everyone.
create table private.world_jeongseok_gate_policy (
  singleton boolean primary key default true check (singleton),
  status text not null check (status in ('COMING_SOON','ACTIVE','DISABLED')),
  updated_at timestamptz not null default now()
);
alter table private.world_jeongseok_gate_policy enable row level security;
revoke all on private.world_jeongseok_gate_policy from public,anon,authenticated,service_role;
insert into private.world_jeongseok_gate_policy(singleton,status) values (true,'COMING_SOON');

-- Pass products (migration-owned). JSL-A P0 has exactly one product.
create table private.world_jeongseok_pass_catalog (
  pass_type text primary key check (pass_type ~ '^jeongseok\.visitor\.[a-z0-9_]+$'),
  duration_seconds integer not null check (duration_seconds between 3600 and 2592000),
  currency_id text not null references private.world_currencies(currency_id),
  price bigint not null check (price > 0),
  price_basis text not null check (price_basis in ('CANDIDATE','CONFIRMED')),
  status text not null check (status in ('COMING_SOON','ACTIVE','DISABLED')),
  constraint world_jeongseok_pass_catalog_confirmed_active
    check (status <> 'ACTIVE' or price_basis = 'CONFIRMED')
);
alter table private.world_jeongseok_pass_catalog enable row level security;
revoke all on private.world_jeongseok_pass_catalog from public,anon,authenticated,service_role;
insert into private.world_jeongseok_pass_catalog values
  ('jeongseok.visitor.day', 86400, 'currency.induck_coin', 100, 'CANDIDATE', 'COMING_SOON');

-- Immutable receipts. Each row links the one Wallet ledger debit that paid for it.
create table private.world_jeongseok_pass_purchases (
  purchase_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pass_type text not null references private.world_jeongseok_pass_catalog(pass_type),
  currency_id text not null,
  price bigint not null check (price > 0),
  balance_before bigint not null check (balance_before >= 0),
  balance_after bigint not null check (balance_after >= 0),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  wallet_transaction_id uuid not null unique
    references private.world_currency_transactions(transaction_id) on delete cascade,
  idempotency_key text not null unique check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'),
  created_at timestamptz not null default now(),
  constraint world_jeongseok_pass_purchases_price_math check (balance_after = balance_before - price),
  constraint world_jeongseok_pass_purchases_window check (expires_at > issued_at)
);
create index world_jeongseok_pass_purchases_user_idx on private.world_jeongseok_pass_purchases(user_id, issued_at desc);
alter table private.world_jeongseok_pass_purchases enable row level security;
revoke all on private.world_jeongseok_pass_purchases from public,anon,authenticated,service_role;
comment on table private.world_jeongseok_pass_purchases is
  'JSL-A visitor pass receipts. Written only by purchase_jeongseok_pass_v1 in the same transaction as the Wallet debit; append-only, account deletion cascade only.';

create function private.world_jeongseok_pass_purchase_append_only_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then return old; end if;
  raise exception 'JEONGSEOK_PASS_RECEIPT_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_jeongseok_pass_purchase_append_only_v1() from public,anon,authenticated,service_role;
create trigger world_jeongseok_pass_purchases_append_only before update or delete on private.world_jeongseok_pass_purchases
for each row execute function private.world_jeongseok_pass_purchase_append_only_v1();

-- Current right, one row per account. Expiry is decided at read time against the DB clock.
create table private.world_jeongseok_pass_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pass_type text not null references private.world_jeongseok_pass_catalog(pass_type),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  last_purchase_id uuid not null unique
    references private.world_jeongseok_pass_purchases(purchase_id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint world_jeongseok_pass_entitlements_window check (expires_at > issued_at)
);
alter table private.world_jeongseok_pass_entitlements enable row level security;
revoke all on private.world_jeongseok_pass_entitlements from public,anon,authenticated,service_role;
comment on table private.world_jeongseok_pass_entitlements is
  'JSL-A current visitor pass per account. Written only by purchase_jeongseok_pass_v1; valid while now() < expires_at.';

-- Caller-scoped decision shared by the read RPC and, later, JSL-B room/Realtime gates.
-- It reads auth.uid() only: there is no way to ask about another account.
create function private.world_jeongseok_access_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_gate text;
  v_verified boolean;
  v_pass private.world_jeongseok_pass_entitlements%rowtype;
  v_product private.world_jeongseok_pass_catalog%rowtype;
  v_balance bigint;
  v_pass_json jsonb := null;
  v_offer jsonb := null;
  v_decision text;
  v_via text := null;
begin
  select g.status into v_gate from private.world_jeongseok_gate_policy g where g.singleton;
  if v_gate is distinct from 'ACTIVE' then
    -- Closed gate: no identity, price or pass detail leaves the server.
    return jsonb_build_object('version',1,'decision',coalesce(v_gate,'DISABLED'),'granted',false,'via',null,
      'gateStatus',coalesce(v_gate,'DISABLED'),'serverNow',v_now,'userId',null,'inhaMailVerified',null,'pass',null,'offer',null);
  end if;
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true)
     or not exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous is not true) then
    return jsonb_build_object('version',1,'decision','AUTH_REQUIRED','granted',false,'via',null,
      'gateStatus',v_gate,'serverNow',v_now,'userId',null,'inhaMailVerified',null,'pass',null,'offer',null);
  end if;
  if not private.world_wallet_account_ok_v1(v_uid) then
    return jsonb_build_object('version',1,'decision','ACCOUNT_BLOCKED','granted',false,'via',null,
      'gateStatus',v_gate,'serverNow',v_now,'userId',v_uid,'inhaMailVerified',null,'pass',null,'offer',null);
  end if;

  -- The existing Hub authority; mailbox ownership only.
  v_verified := public.my_inha_mail_badge();
  select * into v_pass from private.world_jeongseok_pass_entitlements e where e.user_id = v_uid;
  if found then
    v_pass_json := jsonb_build_object('passType',v_pass.pass_type,'issuedAt',v_pass.issued_at,
      'expiresAt',v_pass.expires_at,'active',v_now < v_pass.expires_at,'purchaseId',v_pass.last_purchase_id);
  end if;

  if v_verified then
    v_decision := 'GRANTED'; v_via := 'INHA_MAIL';
  elsif v_pass.user_id is not null and v_now < v_pass.expires_at then
    v_decision := 'GRANTED'; v_via := 'VISITOR_PASS';
  else
    v_decision := case when v_pass.user_id is null then 'NEEDS_PASS' else 'EXPIRED' end;
    select * into v_product from private.world_jeongseok_pass_catalog c where c.pass_type = 'jeongseok.visitor.day';
    if found and v_product.status = 'ACTIVE' then
      select w.balance into v_balance from private.world_wallets w
       where w.user_id = v_uid and w.currency_id = v_product.currency_id;
      v_balance := coalesce(v_balance, 0);
      v_offer := jsonb_build_object('status','ACTIVE','passType',v_product.pass_type,'price',v_product.price,
        'currencyId',v_product.currency_id,'durationSeconds',v_product.duration_seconds,'balance',v_balance,
        'canPurchase',v_balance >= v_product.price,'shortfall',greatest(v_product.price - v_balance, 0));
    else
      -- An unreleased or paused product never exposes its candidate price.
      v_offer := jsonb_build_object('status',coalesce(v_product.status,'DISABLED'),'passType',null,'price',null,
        'currencyId',null,'durationSeconds',null,'balance',null,'canPurchase',false,'shortfall',null);
    end if;
  end if;

  return jsonb_build_object('version',1,'decision',v_decision,'granted',v_decision = 'GRANTED','via',v_via,
    'gateStatus',v_gate,'serverNow',v_now,'userId',v_uid,'inhaMailVerified',v_verified,'pass',v_pass_json,'offer',v_offer);
end;
$$;
revoke all on function private.world_jeongseok_access_v1() from public,anon,authenticated,service_role;

create function public.get_jeongseok_access_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.world_jeongseok_access_v1();
$$;
revoke all on function public.get_jeongseok_access_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_jeongseok_access_v1() to authenticated;
comment on function public.get_jeongseok_access_v1() is
  'JSL-A caller-only Jeongseok access decision (server clock, Inha mail badge, visitor pass, server price). Read only.';

-- Frozen receipt plus a fresh access readback for the same caller.
create function private.world_jeongseok_purchase_result_v1(p_purchase_id uuid, p_replayed boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', case when p_replayed then 'ALREADY_PROCESSED' else 'SUCCESS' end,
    'purchaseId',p.purchase_id,'userId',p.user_id,'passType',p.pass_type,'currencyId',p.currency_id,
    'price',p.price,'balanceBefore',p.balance_before,'balanceAfter',p.balance_after,
    'issuedAt',p.issued_at,'expiresAt',p.expires_at,'walletTransactionId',p.wallet_transaction_id,
    'idempotencyKey',p.idempotency_key,'access',private.world_jeongseok_access_v1())
  from private.world_jeongseok_pass_purchases p where p.purchase_id = p_purchase_id;
$$;
revoke all on function private.world_jeongseok_purchase_result_v1(uuid,boolean) from public,anon,authenticated,service_role;

create function public.purchase_jeongseok_pass_v1(p_pass_type text, p_idempotency_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := now();
  v_existing private.world_jeongseok_pass_purchases%rowtype;
  v_product private.world_jeongseok_pass_catalog%rowtype;
  v_gate text;
  v_wallet jsonb;
  v_purchase_id uuid;
  v_expires timestamptz;
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  -- Stored account state, not only claims: anonymous or banned accounts never pay or replay.
  if not private.world_wallet_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  -- One pass decision per account at a time; different keys queue here and re-check the right.
  perform pg_advisory_xact_lock(hashtextextended('world_jeongseok_pass:' || v_uid::text, 0));

  -- Lost-response recovery: the same key returns the original receipt, never a second debit.
  select * into v_existing from private.world_jeongseok_pass_purchases p where p.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.user_id, v_existing.pass_type) is distinct from (v_uid, p_pass_type) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_jeongseok_purchase_result_v1(v_existing.purchase_id, true);
  end if;

  -- Preflight: every refusal happens before any value moves.
  select g.status into v_gate from private.world_jeongseok_gate_policy g where g.singleton;
  if v_gate is distinct from 'ACTIVE' then
    raise exception 'JEONGSEOK_GATE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if p_pass_type is null then raise exception 'INVALID_PASS_TYPE' using errcode = '22023'; end if;
  select * into v_product from private.world_jeongseok_pass_catalog c where c.pass_type = p_pass_type for share;
  if not found then raise exception 'INVALID_PASS_TYPE' using errcode = '22023'; end if;
  -- Defense in depth: a candidate price must never be charged, even if catalog policy changes.
  if v_product.status <> 'ACTIVE' or v_product.price_basis <> 'CONFIRMED' then
    raise exception 'PASS_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if public.my_inha_mail_badge() then
    raise exception 'FREE_ACCESS_ELIGIBLE' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.world_jeongseok_pass_entitlements e
              where e.user_id = v_uid and e.expires_at > v_now) then
    raise exception 'PASS_ALREADY_ACTIVE' using errcode = 'P0001';
  end if;

  -- Debit through the Wallet authority. INSUFFICIENT_FUNDS aborts with nothing moved.
  v_wallet := private.world_wallet_apply_v1(
    v_uid, v_product.currency_id, -v_product.price, 'PURCHASE', 'jeongseok_pass', v_product.pass_type,
    'jeongseok/' || p_idempotency_key || '/wallet', null);
  if v_wallet ->> 'status' <> 'SUCCESS' then
    -- A ledger row without its receipt would mean a split purchase; never treat it as paid.
    raise exception 'PURCHASE_STATE_CONFLICT' using errcode = 'P0001';
  end if;

  v_expires := v_now + make_interval(secs => v_product.duration_seconds);
  begin
    insert into private.world_jeongseok_pass_purchases (
      user_id, pass_type, currency_id, price, balance_before, balance_after,
      issued_at, expires_at, wallet_transaction_id, idempotency_key)
    values (
      v_uid, v_product.pass_type, v_product.currency_id, v_product.price,
      (v_wallet ->> 'balanceBefore')::bigint, (v_wallet ->> 'balanceAfter')::bigint,
      v_now, v_expires, (v_wallet ->> 'transactionId')::uuid, p_idempotency_key)
    returning purchase_id into v_purchase_id;
  exception when unique_violation then
    -- Same-account retries resolve above under the lock; this key belongs to another account.
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end;

  insert into private.world_jeongseok_pass_entitlements (user_id, pass_type, issued_at, expires_at, last_purchase_id, updated_at)
  values (v_uid, v_product.pass_type, v_now, v_expires, v_purchase_id, v_now)
  on conflict (user_id) do update
    set pass_type = excluded.pass_type, issued_at = excluded.issued_at, expires_at = excluded.expires_at,
        last_purchase_id = excluded.last_purchase_id, updated_at = excluded.updated_at;

  -- Readback inside the same transaction: right, receipt and ledger balance agree.
  if not exists (select 1 from private.world_jeongseok_pass_entitlements e
                  where e.user_id = v_uid and e.last_purchase_id = v_purchase_id and e.expires_at = v_expires)
     or (select w.balance from private.world_wallets w
          where w.user_id = v_uid and w.currency_id = v_product.currency_id)
        is distinct from (v_wallet ->> 'balanceAfter')::bigint then
    raise exception 'PURCHASE_READBACK_FAILED' using errcode = 'P0001';
  end if;

  return private.world_jeongseok_purchase_result_v1(v_purchase_id, false);
end;
$$;
revoke all on function public.purchase_jeongseok_pass_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.purchase_jeongseok_pass_v1(text,text) to authenticated;
comment on function public.purchase_jeongseok_pass_v1(text,text) is
  'JSL-A visitor pass purchase. Buyer = auth.uid(); price, duration and currency from the server catalog; Wallet debit, receipt and right in one transaction; same key replays the receipt.';
