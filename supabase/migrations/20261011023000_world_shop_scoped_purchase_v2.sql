-- Prerequisite for any rollout: the dorm furniture shop must have a reachable NPC route.
-- Local candidate: preserve listing identity/history while moving existing furniture.
-- Do not rename listing IDs or rewrite completed purchase / inventory / wallet records.
-- position is the only other changed field: destination positions are unique per shop.
with moving as (
  select l.listing_id,
    (select coalesce(max(d.position), -1) from private.world_shop_listings d
      where d.shop_id = 'shop.dorm_furniture')
      + row_number() over (order by l.position, l.listing_id) as destination_position
  from private.world_shop_listings l
  join private.world_item_catalog c on c.item_id = l.item_id
  where l.shop_id = 'shop.student_center' and c.category = 'FURNITURE'
)
update private.world_shop_listings l
set shop_id = 'shop.dorm_furniture', position = m.destination_position
from moving m where l.listing_id = m.listing_id;

create function public.purchase_world_shop_listing_v2(
  p_shop_id text, p_listing_id text, p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing private.world_purchase_transactions%rowtype;
  v_shop_id text;
begin
  -- Match v1's authentication order before exposing any listing or replay information.
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_inventory_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  -- Share v1's lock, including mixed v1/v2 requests; nested acquisition is reentrant.
  perform pg_advisory_xact_lock(hashtextextended('world_shop:' || v_uid::text, 0));
  select * into v_existing from private.world_purchase_transactions p
    where p.idempotency_key = p_idempotency_key;
  if found then
    -- The completed purchase's original shop is authoritative for retries, even after
    -- a listing moves or is disabled. Never reinterpret a key using its new shop.
    if (v_existing.user_id, v_existing.listing_id, v_existing.shop_id)
       is distinct from (v_uid, p_listing_id, p_shop_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return public.purchase_world_shop_listing_v1(p_listing_id, p_idempotency_key);
  end if;

  -- Hold binding stable through v1's authoritative debit/grant transaction. FOR SHARE
  -- blocks a concurrent listing move/update; ordinary simultaneous readers can coexist.
  select l.shop_id into v_shop_id from private.world_shop_listings l
    where l.listing_id = p_listing_id for share;
  if not found then
    raise exception 'INVALID_LISTING' using errcode = 'P0001';
  end if;
  if v_shop_id is distinct from p_shop_id then
    raise exception 'SHOP_LISTING_MISMATCH' using errcode = 'P0001';
  end if;
  -- v1 remains the sole owner of price, availability, level, limits, balance and grant.
  return public.purchase_world_shop_listing_v1(p_listing_id, p_idempotency_key);
end;
$$;
revoke all on function public.purchase_world_shop_listing_v2(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.purchase_world_shop_listing_v2(text,text,text) to authenticated;
comment on function public.purchase_world_shop_listing_v2(text,text,text) is
  'Shop-scoped purchase. New requests require current listing binding; retries require the original recorded user/listing/shop. Value movement delegates unchanged v1.';
