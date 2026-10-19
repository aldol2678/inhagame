-- R1-B-REMEDIATION-01 candidate: local/CI only. Never applied to Production here.
-- Receipts are NOT deleted by age. Fixed per-account ceilings bound retained JSON
-- while preserving every committed UUID/payload/revision acknowledgement.
create function private.learning_valid_day(v text) returns boolean
language plpgsql immutable strict set search_path = '' as $$
begin
 if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(v,4)='0000' then return false; end if;
 return to_char(v::date,'YYYY-MM-DD')=v;
exception when others then return false;
end $$;
create function private.learning_progress_weight(v jsonb) returns bigint
language plpgsql immutable strict set search_path = '' as $$
declare n bigint:=2; k text; x jsonb;
begin
 case jsonb_typeof(v)
 when 'null' then return 4;
 -- Alternate numeric encodings can retain trailing zeroes in JSONB. Charge their
 -- actual serialized size too; a long spelling must not bypass the byte ceiling.
 when 'number' then return greatest(32,octet_length(v::text));
 when 'boolean' then return 5;
 when 'string' then return octet_length(v#>>'{}')+2;
 when 'array' then
  for x in select value from jsonb_array_elements(v) loop n:=n+private.learning_progress_weight(x)+2; end loop;
 else
  for k,x in select key,value from jsonb_each(v) loop n:=n+octet_length(k)+4+private.learning_progress_weight(x)+2; end loop;
 end case;
 return n;
end $$;
revoke all on function private.learning_valid_day(text),private.learning_progress_weight(jsonb) from public,anon,authenticated;
create or replace function private.learning_validate_progress(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare f text; k text; v jsonb; a text; x jsonb; allowed text[];
begin
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'version') is distinct from 'number' or p->'version' is distinct from '1'::jsonb then return false; end if;
 if (select count(*) from jsonb_object_keys(p))<>10 or not p ?& array['version','completed','masteries','wrong','skillScores','languageSkills','learningHistory','bosses','languageBosses','speech'] then return false; end if;
 if jsonb_typeof(p->'skillScores') is distinct from 'array' or jsonb_array_length(p->'skillScores')<>3 then return false; end if;
 for x in select value from jsonb_array_elements(p->'skillScores') loop
  if jsonb_typeof(x)<>'number' or x::numeric<0 or x::numeric>100 or trunc(x::numeric,6)<>x::numeric then return false; end if;
 end loop;
 for f in select unnest(array['completed','masteries','wrong','languageSkills','learningHistory','bosses','languageBosses','speech']) loop
  if jsonb_typeof(p->f) is distinct from 'object' or (select count(*) from jsonb_object_keys(p->f))>5000 then return false; end if;
  if f='languageSkills' and ((select count(*) from jsonb_object_keys(p->f))<>2 or not (p->f) ?& array['zh','ja']) then return false; end if;
  for k,v in select key,value from jsonb_each(p->f) loop
   if f='completed' then
    if k !~ '^(e|zh|ja)[0-9]{2}$' or v<>'true'::jsonb then return false; end if;
   elsif f='languageSkills' then
    if k not in ('zh','ja') or jsonb_typeof(v)<>'number' or v::numeric<0 or v::numeric>100 or trunc(v::numeric,6)<>v::numeric then return false; end if;
   else
    if f in ('masteries','wrong','speech') and k !~ '^qv:[a-zA-Z0-9_.-]{1,160}@[1-9][0-9]{0,8}$' then return false; end if;
    if f='learningHistory' and not private.learning_valid_day(k) then return false; end if;
    if f='bosses' and k not in ('0','1','2') then return false; end if;
    if f='languageBosses' and k not in ('zh','ja') then return false; end if;
    if f='wrong' then
     if v<>'true'::jsonb then return false; end if;
    else
     allowed:=case f when 'masteries' then array['level','errors','streak','intervalDays','correctDays','lastCorrectDay','dueDate','needsRecheck'] when 'learningHistory' then array['answered','correct'] when 'speech' then array['typed','mic','lastDay'] else array['count','best','passed','lastDate'] end;
     if jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>cardinality(allowed) or not v ?& allowed then return false; end if;
     for a,x in select key,value from jsonb_each(v) loop
      if a in ('lastCorrectDay','dueDate','lastDay','lastDate') then
       if x<>'null'::jsonb and (jsonb_typeof(x)<>'string' or not private.learning_valid_day(x#>>'{}')) then return false; end if;
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
 return private.learning_progress_weight(p)<=262144;
exception when others then return false;
end $$;
revoke all on function private.learning_validate_progress(jsonb) from public,anon,authenticated;


alter table private.world_learning_requests add column payload_weight bigint
 generated always as (private.learning_progress_weight(progress)) stored;
create index world_learning_requests_owner_created on private.world_learning_requests(user_id,created_at);
-- Existing invalid rows are held for explicit export/review, never silently normalized.
alter table public.world_learning_progress add constraint world_learning_progress_contract
 check (private.learning_validate_progress(progress)) not valid;

create or replace function private.learning_save(p_request_id uuid,p_expected_revision bigint,p_progress jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare u uuid:=auth.uid(); r bigint; prior private.world_learning_requests%rowtype;
 total_count bigint; total_weight bigint; minute_count bigint; day_count bigint; weight bigint;
begin
 if u is null or not exists(select 1 from auth.users where id=u and is_anonymous=false) or (auth.jwt()->>'is_anonymous') is distinct from 'false' then raise exception 'permanent account required' using errcode='42501'; end if;
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 then raise exception 'invalid progress' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('learning:'||u::text,0));
 select * into prior from private.world_learning_requests where user_id=u and request_id=p_request_id;
 if found then
  if prior.expected_revision is distinct from p_expected_revision or prior.progress is distinct from p_progress then raise exception 'request identity reused' using errcode='22023'; end if;
  -- Replay predates validation/rate/retention checks: old acknowledged requests remain valid.
  return jsonb_build_object('owner',u,'requestId',p_request_id,'revision',prior.committed_revision,'duplicate',true);
 end if;
 if not private.learning_validate_progress(p_progress) then raise exception 'invalid progress' using errcode='22023'; end if;
 select revision into r from public.world_learning_progress where user_id=u;
 r:=coalesce(r,0);
 if r<>p_expected_revision then raise exception 'revision conflict' using errcode='PT409'; end if;
 weight:=private.learning_progress_weight(p_progress);
 select count(*),coalesce(sum(payload_weight),0),
  count(*) filter(where created_at>statement_timestamp()-interval '1 minute'),
  count(*) filter(where created_at>statement_timestamp()-interval '24 hours')
 into total_count,total_weight,minute_count,day_count
 from private.world_learning_requests where user_id=u;
 if total_count>=2048 or total_weight+weight>16777216 then raise exception 'learning retention capacity reached' using errcode='PT413'; end if;
 if minute_count>=12 or day_count>=240 then raise exception 'learning request rate exceeded' using errcode='PT429'; end if;
 insert into public.world_learning_progress(user_id,revision,progress) values(u,r+1,p_progress)
 on conflict(user_id) do update set revision=excluded.revision,progress=excluded.progress,updated_at=now();
 insert into private.world_learning_requests(user_id,request_id,expected_revision,committed_revision,progress) values(u,p_request_id,r,r+1,p_progress);
 return jsonb_build_object('owner',u,'requestId',p_request_id,'revision',r+1,'duplicate',false);
end $$;
revoke all on function private.learning_save(uuid,bigint,jsonb) from public,anon,authenticated;
comment on table private.world_learning_requests is 'Immutable replay receipts. No time-based pruning. Per owner: 2048 requests / 16 MiB conservative payload weight lifetime, 12 per rolling minute / 240 per rolling 24h. Duplicate UUID retries bypass caps; new writes fail closed. 256 KiB payload weight per request. Account deletion cascades. Candidate rollout requires capacity approval.';
notify pgrst, 'reload schema';
