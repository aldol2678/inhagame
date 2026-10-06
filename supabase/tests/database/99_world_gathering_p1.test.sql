-- Gathering P1 trusted-presence consumer and exposure boundary.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select has_table('private','world_gathering_positions','Gathering trusted position ledger exists');
select ok((select relrowsecurity from pg_class where oid='private.world_gathering_positions'::regclass),
  'Gathering position ledger has RLS');
select ok(not has_table_privilege(r,'private.world_gathering_positions',p),
  format('%s cannot %s Gathering positions',r,p))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;

select results_eq($$
  select x,z,radius,min_y,max_y
    from private.world_gathering_source_catalog
   where source_ref='gathering.campus.leaf_pile_01'
$$,$$values (
  80.86579271812072::double precision,
  -74.43269999979925::double precision,
  2.0::double precision,
  -1.0::double precision,
  4.0::double precision
)$$,'DB geometry mirrors the Heidegger Forest Gathering source');

select is((select presence_required from private.world_gathering_runtime),true,
  'Gathering trusted presence is required by default');
select is((select enabled from private.world_gathering_runtime),false,
  'P1 does not activate Gathering runtime');
select is((select status from private.world_gathering_source_catalog
  where source_ref='gathering.campus.leaf_pile_01'),'COMING_SOON',
  'P1 does not activate the Gathering source');

select ok(not has_function_privilege(r,
  'public.world_gathering_read_v1(uuid)','execute'),
  format('%s cannot call Gathering read',r))
from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role',
  'public.world_gathering_read_v1(uuid)','execute'),
  'trusted server can call Gathering read');

select ok(not has_function_privilege(r,
  'public.world_gathering_observe_position_v1(uuid,uuid,bigint,double precision,double precision,double precision,text,text,timestamp with time zone)','execute'),
  format('%s cannot publish Gathering positions',r))
from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role',
  'public.world_gathering_observe_position_v1(uuid,uuid,bigint,double precision,double precision,double precision,text,text,timestamp with time zone)','execute'),
  'trusted server may publish Gathering positions');

select ok(not has_function_privilege(r,'private.world_gathering_require_position_v1(uuid,text)','execute'),
  format('%s cannot call private Gathering position gate',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r,'private.world_gathering_require_server_v1(uuid)','execute'),
  format('%s cannot call private Gathering server guard',r))
from unnest(array['anon','authenticated','service_role']) r;

select * from finish();
rollback;
