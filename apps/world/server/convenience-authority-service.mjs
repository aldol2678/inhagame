import { createCampusGeometry } from './presence/campus-geometry.mjs';
import { createDurableWalkState, reduceDurableWalkState } from './presence/durable-walk-reducer.mjs';
import { convenienceEligible, CONVENIENCE_TARGET } from './presence/convenience-target.mjs';
import { createIncomeCandidateVerifier, incomeCandidateConfig, createIncomeCandidateHttpHandler } from './income-candidate-http.mjs';
import { IncomeError } from './income-service.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(code,status=409)=>{throw new IncomeError(code,status);};
const exact=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).every(k=>keys.includes(k));
function id(value){if(typeof value!=='string'||!UUID.test(value))fail('CONVENIENCE_INVALID_REQUEST',400);return value.toLowerCase();}
// Claims are consumed only AFTER Auth has verified this exact bearer. Never an unsigned JWT authority.
export function createConvenienceVerifier(config) {
 const verify=createIncomeCandidateVerifier(config);
 return async authorization=>{
   const accountId=await verify(authorization);if(!accountId)return null;
   try {const token=authorization.slice(7),parts=token.split('.');if(parts.length!==3)return null;
     const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());
     if(claims.sub!==accountId||!UUID.test(claims.session_id??'')||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=Date.now())return null;
     return {accountId,authSessionId:claims.session_id.toLowerCase()};
   } catch{return null;}
 };
}
export function createConvenienceRpc({url,serviceKey,fetcher=fetch}) {
 return async(name,args)=>{
   if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url??'')||!serviceKey||!['world_convenience_authority_v1','world_convenience_income_v2'].includes(name))fail('CONVENIENCE_CLOSED',503);
   try {const response=await fetcher(`${url}/rest/v1/rpc/${name}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
     headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
     const body=await response.json();if(!response.ok)fail(/^(CONVENIENCE|INCOME)_[A-Z0-9_]+$/.test(body?.message??'')?body.message:'CONVENIENCE_UNAVAILABLE');return body;
   } catch(e){if(e instanceof IncomeError)throw e;fail('CONVENIENCE_UNAVAILABLE',503);}
 };
}
export function createConvenienceAuthorityService({verifyUser,rpc,geometry=createCampusGeometry(),enabled=false}={}) {
 if(typeof verifyUser!=='function'||typeof rpc!=='function')throw Error('CONVENIENCE_DEPENDENCIES');
 // Cache canonical static geometry per worker. DB CAS owns mutable state across workers/restarts.
 return async(authorization,body)=>{
   if(!enabled||process.env.NODE_ENV==='production'||process.env.VERCEL_ENV==='production')fail('CONVENIENCE_CLOSED',404);
   if(!exact(body,['op','connectionId','authoritySessionId','fence','command','requestId','sessionId','revision','stepId','choiceId']))fail('CONVENIENCE_INVALID_REQUEST',400);
   const {op}=body,connection=id(body.connectionId);
   if(!['open','move','revoke','status','start','step','complete'].includes(op))fail('CONVENIENCE_INVALID_REQUEST',400);
   const allowed={open:['op','connectionId'],move:['op','connectionId','authoritySessionId','fence','command'],revoke:['op','connectionId','authoritySessionId','fence'],
     status:['op','connectionId','sessionId'],start:['op','connectionId','authoritySessionId','fence','requestId'],
     step:['op','connectionId','authoritySessionId','fence','requestId','sessionId','revision','stepId','choiceId'],
     complete:['op','connectionId','authoritySessionId','fence','requestId','sessionId']};
   if(!exact(body,allowed[op]))fail('CONVENIENCE_INVALID_REQUEST',400);
   let principal;try{principal=await verifyUser(authorization);}catch{fail('CONVENIENCE_AUTH_UNAVAILABLE',503);}
   if(!principal||!UUID.test(principal.accountId??'')||!UUID.test(principal.authSessionId??''))fail('CONVENIENCE_AUTH_REQUIRED',401);
   const base={p_user:principal.accountId,p_auth:principal.authSessionId,p_connection:connection};
   if(['move','revoke','start','step','complete'].includes(op)){
     id(body.authoritySessionId);if(!Number.isSafeInteger(body.fence)||body.fence<1)fail('CONVENIENCE_INVALID_REQUEST',400);
   }
   const ref={p_session:body.authoritySessionId,p_fence:body.fence};
   const authority=(p_op,extra={})=>rpc('world_convenience_authority_v1',{...base,p_op,...extra});
   const present=record=>({sessionId:record.sessionId,fence:record.fence,spawnId:record.spawnId,active:record.active,
     state:record.state,eligible:record.eligible,target:CONVENIENCE_TARGET,closedCandidate:true});
   const commit=async(record,next)=>{
     if(record.targetVersion!==CONVENIENCE_TARGET.version||record.geometryRevision!==geometry.manifest.digest)fail('CONVENIENCE_VERSION_CHANGED');
     return authority('COMMIT',{p_session:record.sessionId,p_fence:record.fence,p_revision:record.state?.revision??0,
       p_state:next,p_eligible:convenienceEligible(next.position,geometry)});
   };
   if(op==='open'){
     let record=await authority('OPEN',{p_geometry:geometry.manifest.digest});
     if(record.state)return present(record); // Lost-open recovery does not teleport or refresh the lease.
     const next=createDurableWalkState({nowMs:record.nowMs,geometry,spawnId:record.spawnId});
     record=await commit(record,next);return present(record);
   }
   if(op==='revoke')return present(await authority('REVOKE',ref));
   if(op==='move'){
     const record=await authority('READ',ref);
     let reduced;try{reduced=reduceDurableWalkState({state:record.state,command:body.command,nowMs:record.nowMs,geometry});}
     catch(e){fail(e.code??'CONVENIENCE_INVALID_INPUT',400);}
     if(reduced.duplicate)return present(record); // No CAS/lease refresh for repeated input.
     return present(await commit(record,reduced.state)); // CAS conflicts surface; old output is never replayed.
   }
   if(op==='status'&&body.sessionId!=null)id(body.sessionId);
   if(op!=='status')id(body.requestId);
   if(['step','complete'].includes(op))id(body.sessionId);
   if(op==='step'&&(!Number.isInteger(body.revision)||body.revision<0||body.revision>2||body.stepId!==`${body.sessionId}:${body.revision}`||typeof body.choiceId!=='string'||!/^[a-zA-Z0-9_.-]{1,80}$/.test(body.choiceId)))fail('CONVENIENCE_INVALID_REQUEST',400);
   return rpc('world_convenience_income_v2',{...base,p_authority_session:body.authoritySessionId??null,p_fence:body.fence??null,
     p_op:{status:'STATUS',start:'START',step:'ACTION',complete:'FINISH'}[op],p_request:body.requestId??null,p_session:body.sessionId??null,
     p_action:op==='step'?['stock','checkout','tidy'][body.revision]:null,p_value:body.choiceId??null,p_revision:body.revision??null});
 };
}
export function createConfiguredConvenienceAuthorityHandler(env=process.env,fetcher=fetch){
 const config=incomeCandidateConfig(env);
 if(!config.enabled||env.WORLD_CONVENIENCE_AUTHORITY_CANDIDATE!=='1')return createIncomeCandidateHttpHandler({enabled:false});
 return createIncomeCandidateHttpHandler({enabled:true,service:createConvenienceAuthorityService({enabled:true,
   verifyUser:createConvenienceVerifier({...config,fetcher}),rpc:createConvenienceRpc({...config,fetcher})})});
}
