-- R1-B candidate only. No operational deployment in this task.
-- Snapshot CAS + immutable request receipts. Learning is non-economic client progress.
create table public.world_learning_progress (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision bigint not null check (revision between 1 and 9007199254740991),
 progress jsonb not null,
 updated_at timestamptz not null default now()
);
create table private.world_learning_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 expected_revision bigint not null,
 committed_revision bigint not null,
 progress jsonb not null,
 created_at timestamptz not null default now(),
 primary key (user_id,request_id)
);
alter table public.world_learning_progress enable row level security;
alter table private.world_learning_requests enable row level security;
revoke all on public.world_learning_progress,private.world_learning_requests from public,anon,authenticated;
grant select on public.world_learning_progress to authenticated;
create policy learning_owner_read on public.world_learning_progress for select to authenticated
 using ((select auth.uid())=user_id and (select auth.jwt()->>'is_anonymous')='false');
-- All direct writes are denied; only the narrow CAS procedure may mutate rows.
-- No policy is created for request receipts: they are internal and never publicly readable.

create function private.learning_validate_progress(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare f text; k text; v jsonb; a text; x jsonb; allowed text[];
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>1000000 or p->>'version' is distinct from '1' then return false; end if;
 if (select count(*) from jsonb_object_keys(p))<>10 or not p ?& array['version','completed','masteries','wrong','skillScores','languageSkills','learningHistory','bosses','languageBosses','speech'] then return false; end if;
 if jsonb_typeof(p->'skillScores') is distinct from 'array' or jsonb_array_length(p->'skillScores')<>3 then return false; end if;
 for x in select value from jsonb_array_elements(p->'skillScores') loop
  if jsonb_typeof(x)<>'number' or x::numeric<0 or x::numeric>100 then return false; end if;
 end loop;
 for f in select unnest(array['completed','masteries','wrong','languageSkills','learningHistory','bosses','languageBosses','speech']) loop
  if jsonb_typeof(p->f) is distinct from 'object' or (select count(*) from jsonb_object_keys(p->f))>5000 then return false; end if;
  if f='languageSkills' and ((select count(*) from jsonb_object_keys(p->f))<>2 or not (p->f) ?& array['zh','ja']) then return false; end if;
  for k,v in select key,value from jsonb_each(p->f) loop
   if f='completed' then
    if k !~ '^(e|zh|ja)[0-9]{2}$' or v<>'true'::jsonb then return false; end if;
   elsif f='languageSkills' then
    if k not in ('zh','ja') or jsonb_typeof(v)<>'number' or v::numeric<0 or v::numeric>100 then return false; end if;
   else
    if f in ('masteries','wrong','speech') and k !~ '^qv:[a-zA-Z0-9_.-]{1,160}@[1-9][0-9]{0,8}$' then return false; end if;
    if f='learningHistory' and k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    if f='bosses' and k not in ('0','1','2') then return false; end if;
    if f='languageBosses' and k not in ('zh','ja') then return false; end if;
    if f='wrong' then
     if v<>'true'::jsonb then return false; end if;
    else
     allowed:=case f when 'masteries' then array['level','errors','streak','intervalDays','correctDays','lastCorrectDay','dueDate','needsRecheck'] when 'learningHistory' then array['answered','correct'] when 'speech' then array['typed','mic','lastDay'] else array['count','best','passed','lastDate'] end;
     if jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>cardinality(allowed) or not v ?& allowed then return false; end if;
     for a,x in select key,value from jsonb_each(v) loop
      if a in ('lastCorrectDay','dueDate','lastDay','lastDate') then
       if x<>'null'::jsonb and (jsonb_typeof(x)<>'string' or (x#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then return false; end if;
       if x<>'null'::jsonb then perform (x#>>'{}')::date; end if;
      elsif a in ('needsRecheck','passed') then
       if jsonb_typeof(x)<>'boolean' then return false; end if;
      else
       if jsonb_typeof(x)<>'number' or x::numeric<0 or x::numeric>1000000 or trunc(x::numeric)<>x::numeric then return false; end if;
       if (a='level' and x::numeric>2) or (a='best' and x::numeric>5) or (a='intervalDays' and x::numeric not between 1 and 14) then return false; end if;
      end if;
     end loop;
     if f='learningHistory' and ((v->>'correct')::numeric>(v->>'answered')::numeric) then return false; end if;
    end if;
   end if;
  end loop;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function private.learning_validate_progress(jsonb) from public,anon,authenticated;

-- Preserve the repository contract: clients have no private schema/function access.
-- A narrowly granted, pinned public wrapper follows the existing account API pattern;
-- this private invoker helper runs with the wrapper privileges and checks Auth itself.
create function private.learning_save(p_request_id uuid,p_expected_revision bigint,p_progress jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare u uuid:=auth.uid(); r bigint; prior private.world_learning_requests%rowtype;
begin
 if u is null or not exists(select 1 from auth.users where id=u and is_anonymous=false) or (auth.jwt()->>'is_anonymous') is distinct from 'false' then raise exception 'permanent account required' using errcode='42501'; end if;
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 or not private.learning_validate_progress(p_progress) then raise exception 'invalid progress' using errcode='22023'; end if;
 -- Serialize first insert as well as subsequent updates for this authenticated owner.
 perform pg_advisory_xact_lock(hashtextextended('learning:'||u::text,0));
 select * into prior from private.world_learning_requests where user_id=u and request_id=p_request_id;
 if found then
  if prior.expected_revision<>p_expected_revision or prior.progress<>p_progress then raise exception 'request identity reused' using errcode='22023'; end if;
  return jsonb_build_object('owner',u,'requestId',p_request_id,'revision',prior.committed_revision,'duplicate',true);
 end if;
 select revision into r from public.world_learning_progress where user_id=u;
 r:=coalesce(r,0);
 if r<>p_expected_revision then raise exception 'revision conflict' using errcode='PT409'; end if;
 insert into public.world_learning_progress(user_id,revision,progress) values(u,r+1,p_progress)
 on conflict(user_id) do update set revision=excluded.revision,progress=excluded.progress,updated_at=now();
 insert into private.world_learning_requests(user_id,request_id,expected_revision,committed_revision,progress) values(u,p_request_id,r,r+1,p_progress);
 return jsonb_build_object('owner',u,'requestId',p_request_id,'revision',r+1,'duplicate',false);
end $$;
revoke all on function private.learning_save(uuid,bigint,jsonb) from public,anon,authenticated;

create function public.world_learning_save_v1(p_request_id uuid,p_expected_revision bigint,p_progress jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
 select private.learning_save(p_request_id,p_expected_revision,p_progress);
$$;
create function public.world_learning_read_v1() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare u uuid:=auth.uid(); row public.world_learning_progress%rowtype;
begin
 if u is null or (auth.jwt()->>'is_anonymous') is distinct from 'false' then raise exception 'permanent account required' using errcode='42501'; end if;
 select * into row from public.world_learning_progress where user_id=u;
 return jsonb_build_object('owner',u,'revision',coalesce(row.revision,0),'progress',row.progress);
end $$;
revoke all on function public.world_learning_save_v1(uuid,bigint,jsonb),public.world_learning_read_v1() from public,anon,authenticated;
grant execute on function public.world_learning_save_v1(uuid,bigint,jsonb),public.world_learning_read_v1() to authenticated;
comment on table public.world_learning_progress is 'Private, non-economic learning progress. No prompts, answers, coins, EXP or league scores. R1-B rollout gated.';

-- PostgREST must refresh signatures/privileges after this candidate is applied.
notify pgrst, 'reload schema';
