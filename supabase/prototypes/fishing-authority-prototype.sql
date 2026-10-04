-- Disposable loopback test fixture ONLY. Not a migration or an exposed Data API schema.
begin;
create schema fishing_authority_prototype;
revoke all on schema fishing_authority_prototype from public,anon,authenticated;
grant usage on schema fishing_authority_prototype to service_role;

create table fishing_authority_prototype.owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  epoch bigint not null check (epoch > 0), owner_token uuid not null, session_id uuid not null,
  lease_until timestamptz not null, revision_high bigint not null check (revision_high > 0),
  state text not null check (state in ('ACTIVE','RELEASED'))
);
create table fishing_authority_prototype.claims (
  user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
  epoch bigint not null, owner_token uuid not null, session_id uuid not null,
  primary key(user_id,request_id)
);
create table fishing_authority_prototype.outbox (
  user_id uuid not null references auth.users(id) on delete cascade, operation_id uuid not null,
  epoch bigint not null, owner_token uuid not null, session_id uuid not null,
  revision bigint not null check (revision > 0),
  kind text not null check (kind in ('POSITION','CLAIM','RELEASE')),
  x double precision not null, y double precision not null, z double precision not null,
  space text not null, mode text not null, observed_at timestamptz not null,
  status text not null check (status in ('PENDING','DELIVERED','EXPIRED','FENCED','SUPERSEDED')),
  receipt jsonb,
  primary key(user_id,operation_id), unique(user_id,revision)
);
alter table fishing_authority_prototype.owners enable row level security;
alter table fishing_authority_prototype.claims enable row level security;
alter table fishing_authority_prototype.outbox enable row level security;
revoke all on all tables in schema fishing_authority_prototype from public,anon,authenticated,service_role;

-- All paths share the existing Activity account lock before any row lock or F3 call.
create function fishing_authority_prototype.lock_account(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.world_fishing_require_server_v1(p_user);
  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));
end;
$$;
create function fishing_authority_prototype.owner_view(p fishing_authority_prototype.owners)
returns jsonb language sql set search_path='' as $$
  select jsonb_build_object('epoch',(p).epoch::text,'ownerToken',(p).owner_token,'sessionId',(p).session_id,
    'revisionHigh',(p).revision_high::text,'leaseUntil',(p).lease_until,'state',(p).state);
$$;
create function fishing_authority_prototype.outbox_view(p fishing_authority_prototype.outbox)
returns jsonb language sql set search_path='' as $$
  select jsonb_build_object('operationId',(p).operation_id,'epoch',(p).epoch::text,'ownerToken',(p).owner_token,
    'sessionId',(p).session_id,'revision',(p).revision::text,'kind',(p).kind,'x',(p).x,'y',(p).y,'z',(p).z,
    'space',(p).space,'mode',(p).mode,'observedAt',(p).observed_at,'status',(p).status,'receipt',(p).receipt);
$$;
create function fishing_authority_prototype.require_owner(p_user uuid,p_epoch bigint,p_token uuid)
returns fishing_authority_prototype.owners language plpgsql security definer set search_path='' as $$
declare v fishing_authority_prototype.owners;
begin
  select * into v from fishing_authority_prototype.owners where user_id=p_user for update;
  if not found or p_epoch is null or p_token is null or v.epoch<>p_epoch or v.owner_token<>p_token
     or v.state<>'ACTIVE' or v.lease_until<=clock_timestamp() then
    raise exception 'OWNER_FENCED' using errcode='P0001';
  end if;
  return v;
end;
$$;
create function fishing_authority_prototype.next_revision(p_user uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
  select greatest(o.revision_high,coalesce(p.revision,0)) into v
    from fishing_authority_prototype.owners o left join private.world_fishing_positions p using(user_id)
    where o.user_id=p_user;
  if v is null or v=9223372036854775807 then raise exception 'REVISION_EXHAUSTED'; end if;
  update fishing_authority_prototype.owners set revision_high=v+1 where user_id=p_user;
  return v+1;
end;
$$;

create function fishing_authority_prototype.acquire(p_user uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v fishing_authority_prototype.owners; c fishing_authority_prototype.claims;
  b fishing_authority_prototype.outbox; p private.world_fishing_positions;
  t timestamptz; r bigint; e bigint; result jsonb; state text;
begin
  perform fishing_authority_prototype.lock_account(p_user);
  if p_request is null then raise exception 'INVALID_REQUEST'; end if;
  select * into c from fishing_authority_prototype.claims where user_id=p_user and request_id=p_request;
  if found then
    select * into strict v from fishing_authority_prototype.owners where user_id=p_user;
    state:=case when v.epoch<>c.epoch then 'FENCED' when v.state='RELEASED' then 'RELEASED'
      when v.lease_until<=clock_timestamp() then 'EXPIRED' else 'ALREADY_PROCESSED' end;
    return jsonb_build_object('status',state,'epoch',c.epoch::text,'ownerToken',c.owner_token,
      'sessionId',c.session_id,'revisionHigh',v.revision_high::text,'leaseUntil',v.lease_until);
  end if;
  select * into v from fishing_authority_prototype.owners where user_id=p_user for update;
  t:=clock_timestamp();
  if found and v.state='ACTIVE' and v.lease_until>t then raise exception 'OWNER_BUSY'; end if;
  e:=coalesce(v.epoch,0)+1;
  select * into p from private.world_fishing_positions where user_id=p_user;
  r:=greatest(coalesce(v.revision_high,0),coalesce(p.revision,0));
  if r=9223372036854775807 then raise exception 'REVISION_EXHAUSTED'; end if;
  insert into fishing_authority_prototype.owners values(p_user,e,gen_random_uuid(),gen_random_uuid(),t+interval '3 seconds',r+1,'ACTIVE')
    on conflict(user_id) do update set epoch=excluded.epoch,owner_token=excluded.owner_token,
      session_id=excluded.session_id,lease_until=excluded.lease_until,revision_high=excluded.revision_high,state='ACTIVE'
    returning * into v;
  insert into fishing_authority_prototype.claims values(p_user,p_request,e,v.owner_token,v.session_id);
  update fishing_authority_prototype.outbox set status='FENCED' where user_id=p_user and status='PENDING';
  -- Ownership/session transfer invalidates old eligible evidence atomically.
  result:=public.world_fishing_observe_position_v1(p_user,v.session_id,r+1,
    coalesce(p.x,0),coalesce(p.y,0),coalesce(p.z,0),'CAMPUS','INELIGIBLE',t);
  if result->>'status'<>'OBSERVED' then raise exception 'ISSUER_CONFLICT'; end if;
  insert into fishing_authority_prototype.outbox values(p_user,gen_random_uuid(),e,v.owner_token,v.session_id,r+1,
    'CLAIM',coalesce(p.x,0),coalesce(p.y,0),coalesce(p.z,0),'CAMPUS','INELIGIBLE',t,'DELIVERED',result);
  return fishing_authority_prototype.owner_view(v)||jsonb_build_object('status','ACQUIRED');
end;
$$;
create function fishing_authority_prototype.renew(p_user uuid,p_epoch bigint,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v fishing_authority_prototype.owners;
begin
  perform fishing_authority_prototype.lock_account(p_user);
  v:=fishing_authority_prototype.require_owner(p_user,p_epoch,p_token);
  update fishing_authority_prototype.owners set lease_until=clock_timestamp()+interval '3 seconds'
    where user_id=p_user returning * into v;
  return fishing_authority_prototype.owner_view(v);
end;
$$;
create function fishing_authority_prototype.enqueue(p_user uuid,p_epoch bigint,p_token uuid,p_operation uuid,
  p_x double precision,p_y double precision,p_z double precision,p_space text,p_mode text,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v fishing_authority_prototype.owners; b fishing_authority_prototype.outbox; r bigint; t timestamptz;
begin
  perform fishing_authority_prototype.lock_account(p_user);
  if p_operation is null then raise exception 'INVALID_REQUEST'; end if;
  select * into b from fishing_authority_prototype.outbox where user_id=p_user and operation_id=p_operation;
  if found then
    if (b.epoch,b.owner_token,b.kind,b.x,b.y,b.z,b.space,b.mode,b.observed_at) is distinct from
       (p_epoch,p_token,'POSITION'::text,p_x,p_y,p_z,p_space,p_mode,p_observed_at) then
      raise exception 'OUTBOX_CONFLICT' using errcode='23505';
    end if;
    return fishing_authority_prototype.outbox_view(b);
  end if;
  v:=fishing_authority_prototype.require_owner(p_user,p_epoch,p_token);
  t:=clock_timestamp();
  if p_x is null or p_x not between -10000 and 10000 or p_y is null or p_y not between -10000 and 10000
     or p_z is null or p_z not between -10000 and 10000 or p_space is null or p_space not in ('CAMPUS','OTHER')
     or p_mode is null or p_mode not in ('ON_FOOT','INELIGIBLE') or p_observed_at is null or p_observed_at>t then
    raise exception 'POSITION_INVALID';
  end if;
  if p_observed_at<=t-interval '5 seconds' then raise exception 'POSITION_STALE'; end if;
  r:=fishing_authority_prototype.next_revision(p_user);
  insert into fishing_authority_prototype.outbox values(p_user,p_operation,v.epoch,v.owner_token,v.session_id,r,
    'POSITION',p_x,p_y,p_z,p_space,p_mode,p_observed_at,'PENDING',null) returning * into b;
  return fishing_authority_prototype.outbox_view(b);
end;
$$;
create function fishing_authority_prototype.pending(p_user uuid,p_epoch bigint,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform fishing_authority_prototype.lock_account(p_user);
  perform fishing_authority_prototype.require_owner(p_user,p_epoch,p_token);
  return coalesce((select jsonb_agg(fishing_authority_prototype.outbox_view(b) order by revision)
    from fishing_authority_prototype.outbox b where user_id=p_user and epoch=p_epoch and status='PENDING'),'[]'::jsonb);
end;
$$;
create function fishing_authority_prototype.publish(p_user uuid,p_epoch bigint,p_token uuid,p_operation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b fishing_authority_prototype.outbox; result jsonb;
begin
  perform fishing_authority_prototype.lock_account(p_user);
  select * into b from fishing_authority_prototype.outbox where user_id=p_user and operation_id=p_operation for update;
  if not found then raise exception 'OUTBOX_NOT_FOUND'; end if;
  if b.epoch is distinct from p_epoch or b.owner_token is distinct from p_token or b.kind<>'POSITION' then
    raise exception 'OUTBOX_CONFLICT';
  end if;
  if b.status='DELIVERED' then return fishing_authority_prototype.outbox_view(b)||jsonb_build_object('status','ALREADY_DELIVERED'); end if;
  if b.status<>'PENDING' then return fishing_authority_prototype.outbox_view(b); end if;
  perform fishing_authority_prototype.require_owner(p_user,p_epoch,p_token);
  if b.observed_at<=clock_timestamp()-interval '5 seconds' then
    update fishing_authority_prototype.outbox set status='EXPIRED' where user_id=p_user and operation_id=p_operation returning * into b;
    return fishing_authority_prototype.outbox_view(b);
  end if;
  result:=public.world_fishing_observe_position_v1(p_user,b.session_id,b.revision,b.x,b.y,b.z,b.space,b.mode,b.observed_at);
  if result->>'status' is null or result->>'status' not in ('OBSERVED','ALREADY_PROCESSED','STALE') then raise exception 'ISSUER_CONFLICT'; end if;
  update fishing_authority_prototype.outbox set status=case when result->>'status'='STALE' then 'SUPERSEDED' else 'DELIVERED' end,
    receipt=result where user_id=p_user and operation_id=p_operation returning * into b;
  return fishing_authority_prototype.outbox_view(b);
end;
$$;
create function fishing_authority_prototype.release(p_user uuid,p_epoch bigint,p_token uuid,p_operation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v fishing_authority_prototype.owners; b fishing_authority_prototype.outbox; p private.world_fishing_positions;
  r bigint; t timestamptz; result jsonb;
begin
  perform fishing_authority_prototype.lock_account(p_user);
  if p_operation is null then raise exception 'INVALID_REQUEST'; end if;
  select * into b from fishing_authority_prototype.outbox where user_id=p_user and operation_id=p_operation;
  if found then
    if b.kind<>'RELEASE' or b.epoch is distinct from p_epoch or b.owner_token is distinct from p_token then raise exception 'OUTBOX_CONFLICT'; end if;
    return fishing_authority_prototype.outbox_view(b)||jsonb_build_object('status','ALREADY_RELEASED');
  end if;
  -- Expired current owners may still revoke; replacement owners cannot be touched.
  select * into v from fishing_authority_prototype.owners where user_id=p_user for update;
  if not found or v.epoch is distinct from p_epoch or v.owner_token is distinct from p_token or v.state<>'ACTIVE' then raise exception 'OWNER_FENCED'; end if;
  r:=fishing_authority_prototype.next_revision(p_user); t:=clock_timestamp();
  select * into p from private.world_fishing_positions where user_id=p_user;
  result:=public.world_fishing_observe_position_v1(p_user,v.session_id,r,coalesce(p.x,0),coalesce(p.y,0),coalesce(p.z,0),'CAMPUS','INELIGIBLE',t);
  if result->>'status'<>'OBSERVED' then raise exception 'ISSUER_CONFLICT'; end if;
  update fishing_authority_prototype.owners set state='RELEASED',lease_until=t where user_id=p_user;
  update fishing_authority_prototype.outbox set status='FENCED' where user_id=p_user and status='PENDING';
  insert into fishing_authority_prototype.outbox values(p_user,p_operation,v.epoch,v.owner_token,v.session_id,r,
    'RELEASE',coalesce(p.x,0),coalesce(p.y,0),coalesce(p.z,0),'CAMPUS','INELIGIBLE',t,'DELIVERED',result) returning * into b;
  return fishing_authority_prototype.outbox_view(b);
end;
$$;
revoke all on all functions in schema fishing_authority_prototype from public,anon,authenticated,service_role;
grant execute on function fishing_authority_prototype.acquire(uuid,uuid),
  fishing_authority_prototype.renew(uuid,bigint,uuid),
  fishing_authority_prototype.enqueue(uuid,bigint,uuid,uuid,double precision,double precision,double precision,text,text,timestamptz),
  fishing_authority_prototype.pending(uuid,bigint,uuid), fishing_authority_prototype.publish(uuid,bigint,uuid,uuid),
  fishing_authority_prototype.release(uuid,bigint,uuid,uuid) to service_role;
commit;
