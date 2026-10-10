-- Minimal pgTAP stand-in for the disposable local cluster only (NOT real pgTAP; see ../README.md). Functions live in schema public.
create schema if not exists tapshim;
create table if not exists tapshim.results(n serial, ok boolean, descr text);
grant usage on schema tapshim to public; grant all on tapshim.results to public; grant usage on all sequences in schema tapshim to public;
create or replace function tapshim.rec(p_ok boolean, p_desc text, p_diag text default null) returns text language plpgsql security definer as $$
declare v_n int;
begin
  insert into tapshim.results(ok,descr) values (coalesce(p_ok,false),p_desc) returning n into v_n;
  return (case when coalesce(p_ok,false) then 'ok ' else 'not ok ' end)||v_n||' - '||coalesce(p_desc,'')||coalesce(E'\n#   '||p_diag,'');
end $$;
create or replace function public.no_plan() returns setof text language plpgsql as $$ begin truncate tapshim.results; alter sequence tapshim.results_n_seq restart; return; end $$;
create or replace function public.finish() returns setof text language plpgsql as $$
begin return next '# done: '||(select count(*) from tapshim.results)||' tests, '||(select count(*) from tapshim.results where not ok)||' failed'; end $$;
create or replace function public.ok(boolean, text default null) returns text language sql as $$ select tapshim.rec($1,$2) $$;
create or replace function public.is(anyelement, anyelement, text default null) returns text language sql as $$
  select tapshim.rec($1 is not distinct from $2,$3, case when $1 is not distinct from $2 then null else 'have: '||coalesce($1::text,'NULL')||' want: '||coalesce($2::text,'NULL') end) $$;
create or replace function public.isnt(anyelement, anyelement, text default null) returns text language sql as $$ select tapshim.rec($1 is distinct from $2,$3) $$;
create or replace function public.lives_ok(text, text default null) returns text language plpgsql as $$
begin execute $1; return tapshim.rec(true,$2);
exception when others then return tapshim.rec(false,$2,SQLERRM); end $$;
create or replace function public.throws_ok(p_sql text, p_code text, p_msg text, p_desc text) returns text language plpgsql as $$
declare v_state text; v_m text;
begin execute p_sql; return tapshim.rec(false,p_desc,'no exception');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_m = message_text;
  return tapshim.rec((p_code is null or v_state=p_code) and (p_msg is null or v_m=p_msg),p_desc,'state='||v_state||' msg='||v_m);
end $$;
create or replace function public.throws_ok(p_sql text, p_code text, p_msg text) returns text language sql as $$ select public.throws_ok($1,$2,$3,null::text) $$;
create or replace function public.has_table(name,name,text default null) returns text language sql as $$ select tapshim.rec(to_regclass(quote_ident($1)||'.'||quote_ident($2)) is not null,$3) $$;
create or replace function public.has_column(name,name,name,text default null) returns text language sql as $$
  select tapshim.rec(exists(select 1 from information_schema.columns where table_schema=$1 and table_name=$2 and column_name=$3),$4) $$;
create or replace function public.col_is_pk(name,name,name,text default null) returns text language sql as $$
  select tapshim.rec(exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
    where i.indisprimary and i.indrelid=(quote_ident($1)||'.'||quote_ident($2))::regclass and a.attname=$3),$4) $$;
create or replace function public.set_eq(p_sql text, p_expected anycompatiblearray, p_desc text default null) returns text language plpgsql as $$
declare v_have text[]; v_want text[]; v_extra text[]; v_missing text[];
begin execute 'select coalesce(array_agg(distinct x::text),''{}'') from ('||p_sql||') s(x)' into v_have;
  select coalesce(array_agg(distinct x::text),'{}') into v_want from unnest(p_expected) x;
  select coalesce(array_agg(x),'{}') into v_extra from unnest(v_have) x where x<>all(v_want);
  select coalesce(array_agg(x),'{}') into v_missing from unnest(v_want) x where x<>all(v_have);
  return tapshim.rec(cardinality(v_extra)=0 and cardinality(v_missing)=0,p_desc,'extra='||v_extra::text||' missing='||v_missing::text); end $$;
create or replace function public.is_empty(p_sql text, p_desc text default null) returns text language plpgsql as $$
declare v_n bigint; begin execute 'select count(*) from ('||p_sql||') s' into v_n; return tapshim.rec(v_n=0,p_desc,v_n||' rows'); end $$;


create or replace function public.has_function(name,name,name[],text default null) returns text language sql as $$
  select tapshim.rec(exists(select 1 from pg_proc p where p.pronamespace=$1::regnamespace and p.proname=$2
    and coalesce((select array_agg(x::regtype::text order by ord) from unnest(string_to_array(p.proargtypes::text,' ')::oid[]) with ordinality u(x,ord)),'{}'::text[])
      = (select coalesce(array_agg(t::text order by o),'{}') from unnest($3) with ordinality u2(t,o))),$4) $$;
grant execute on function public.no_plan() to public;
grant execute on function public.finish() to public;
grant execute on function public.ok(boolean,text) to public;
grant execute on function public.is(anyelement,anyelement,text) to public;
grant execute on function public.isnt(anyelement,anyelement,text) to public;
grant execute on function public.lives_ok(text,text) to public;
grant execute on function public.throws_ok(text,text,text,text) to public;
grant execute on function public.throws_ok(text,text,text) to public;
grant execute on function public.has_table(name,name,text) to public;
grant execute on function public.has_function(name,name,name[],text) to public;
grant execute on function public.has_column(name,name,name,text) to public;
grant execute on function public.col_is_pk(name,name,name,text) to public;
grant execute on function public.set_eq(text,anycompatiblearray,text) to public;
grant execute on function public.is_empty(text,text) to public;
