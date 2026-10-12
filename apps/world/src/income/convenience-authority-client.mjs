// Local-only real HTTP transport. Only direction intents leave the browser; never a pose/time/actor.
export function createConvenienceAuthorityRequest({getAuthorization,getEpoch=()=>0,fetcher=fetch,location=globalThis.location}={}){
 if(!['localhost','127.0.0.1'].includes(location?.hostname))throw Error('CONVENIENCE_LOCAL_ONLY');
 return async body=>{
   const epoch=getEpoch(),authorization=await getAuthorization();
   if(epoch!==getEpoch())throw Error('AUTH_CHANGED');
   if(!/^Bearer [A-Za-z0-9._~-]{20,4096}$/.test(authorization??''))throw Error('AUTH_REQUIRED');
   const response=await fetcher('/api/world-convenience-authority',{method:'POST',redirect:'error',cache:'no-store',credentials:'same-origin',
     headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
   const result=await response.json();if(epoch!==getEpoch())throw Error('AUTH_CHANGED');
   if(!response.ok)throw Object.assign(Error(result.error??'CONVENIENCE_UNAVAILABLE'),{code:result.error});return result;
 };
}
export function createConvenienceAuthorityClient({request,onSnapshot=()=>{},onStop=()=>{},connectionId=globalThis.crypto.randomUUID(),getEpoch=()=>0}={}){
 let generation=0,snapshot=null,inflight=null,opening=null,pendingCommand=null,disposed=false;
 const publish=result=>{if(!result||result.active!==true||!result.state||!Number.isSafeInteger(result.state.sequence)||result.state.sequence<0||
   !Number.isSafeInteger(result.state.revision)||result.state.revision<1||result.state.sequence>=result.state.revision||
   !Number.isSafeInteger(result.fence)||result.fence<1||typeof result.sessionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.sessionId)||
   !['x','y','z'].every(k=>Number.isFinite(result.state.position?.[k])&&Math.abs(result.state.position[k])<=10000))throw Error('CONVENIENCE_INVALID_SNAPSHOT');
   if(snapshot&&(snapshot.sessionId!==result.sessionId||snapshot.fence!==result.fence||result.state.revision<snapshot.state.revision||result.state.sequence<snapshot.state.sequence))throw Error('CONVENIENCE_STALE_SNAPSHOT');
   if(snapshot&&result.state.revision===snapshot.state.revision&&JSON.stringify(result.state)!==JSON.stringify(snapshot.state))throw Error('CONVENIENCE_STALE_SNAPSHOT');
   const publishingGeneration=generation;onSnapshot(result);if(publishingGeneration!==generation)throw Error('AUTH_CHANGED');snapshot=result;return result;};
 const scope=()=>({connectionId,authoritySessionId:snapshot?.sessionId,fence:snapshot?.fence});
 const stop=async(reason='CANCELLED')=>{const old=snapshot,oldConnection=connectionId;generation++;snapshot=null;pendingCommand=null;inflight=null;opening=null;connectionId=globalThis.crypto.randomUUID();onStop(reason);
   if(old)try{await request({op:'revoke',connectionId:oldConnection,authoritySessionId:old.sessionId,fence:old.fence});}catch{/* Unknown disconnect is bounded by DB lease, never called an acknowledged revoke. */}};
 const move=(moveX=0,moveZ=0)=>{
   if(disposed||!snapshot)return Promise.reject(Error('CONVENIENCE_SESSION_REQUIRED'));
   if(inflight)return inflight;
   const gen=generation,reference=scope();
   // A lost response retries exactly the same input. It does not invent a next sequence or time.
   const command=pendingCommand??{sequence:snapshot.state.sequence+1,moveX,moveZ};pendingCommand=command;
   const run=Promise.resolve().then(async()=>{try{if(gen!==generation||!snapshot)throw Error('AUTH_CHANGED');const result=await request({op:'move',...reference,command});if(gen!==generation)throw Error('AUTH_CHANGED');
     if(result?.state?.sequence!==command.sequence||result.state.lastCommand?.sequence!==command.sequence||result.state.lastCommand?.moveX!==command.moveX||result.state.lastCommand?.moveZ!==command.moveZ)throw Error('CONVENIENCE_INVALID_ACK');
     const accepted=publish(result);pendingCommand=null;return accepted;
   }catch(e){if(gen===generation&&['CONVENIENCE_SESSION_CHANGED','CONVENIENCE_SESSION_EXPIRED','CONVENIENCE_AUTH_REVOKED','CONVENIENCE_VERSION_CHANGED'].includes(e.code))void stop(e.code);throw e;}
   finally{if(inflight===run)inflight=null;}});inflight=run;return run;
 };
 return {get snapshot(){return snapshot;},get active(){return !!snapshot;},
   open(){if(disposed)return Promise.reject(Error('DISPOSED'));if(snapshot)return Promise.resolve(snapshot);if(opening)return opening;
     const gen=++generation,authEpoch=getEpoch(),openedConnection=connectionId;
     const run=Promise.resolve().then(async()=>{try{const result=await request({op:'open',connectionId:openedConnection});
       if(gen!==generation){if(authEpoch===getEpoch()&&result?.sessionId&&result?.fence)try{
         await request({op:'revoke',connectionId:openedConnection,authoritySessionId:result.sessionId,fence:result.fence});
       }catch{}throw Error('AUTH_CHANGED');}
       try{return publish(result);}catch(error){if(authEpoch===getEpoch()&&result?.sessionId&&result?.fence)try{await request({op:'revoke',connectionId:openedConnection,authoritySessionId:result.sessionId,fence:result.fence});}catch{}throw error;}
     }finally{if(opening===run)opening=null;}});opening=run;return run;},
   move,stop,
   async income(body){const {questId,...command}=body; if(questId&&questId!=='quest.side.convenience_help')throw Error('CONVENIENCE_ONLY');
     if(command.op==='status')return request({...command,connectionId});
     // Drain uncertain/nonzero input, then obtain an explicitly stopped acknowledgement.
     const gen=generation;
     await move(0,0);if(gen!==generation||!snapshot)throw Error('AUTH_CHANGED');
     if(snapshot.state.lastCommand?.moveX!==0||snapshot.state.lastCommand?.moveZ!==0){
       await move(0,0);if(gen!==generation||!snapshot)throw Error('AUTH_CHANGED');
     }
     if(snapshot.state.lastCommand?.moveX!==0||snapshot.state.lastCommand?.moveZ!==0)throw Error('CONVENIENCE_STOP_UNCONFIRMED');
     return request({...command,...scope()});},
   dispose(){disposed=true;return stop('DISPOSED');}
 };
}
