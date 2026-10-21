// RI F10/F11 server-side registration contract. No direct Production access.
import {randomUUID, randomBytes} from 'node:crypto';
import {canonical, fingerprint, isTopic, ROOM, UUID, validatePublicJwk, verifyProof} from './crypto.mjs';

export class RIError extends Error {
  constructor(code, status=400) { super(code);this.code=code;this.status=status; }
}
const fail=(code,status)=>{throw new RIError(code,status)};
const tokenFrom = raw => {
  if (typeof raw !== 'string' || !/^Bearer [A-Za-z0-9._~+/-]{20,4096}$/.test(raw)) fail('AUTH_REQUIRED',401);
  return raw.slice(7);
};
const PUBLIC_KINDS=new Set(['register','renew','leave']);

export class MemoryIdentityStore {
  // Disposable single-process test store only. Never use in a multi-instance hosted deployment.
  constructor(){this.challenges=new Map();this.sessions=new Map();this.revisions=new Map();}
  async issue(c){this.challenges.set(c.id,{...c,consumed:false});return c;}
  async challenge(id){return this.challenges.get(id)??null;}
  #bump(topic){const n=(this.revisions.get(topic)??0)+1;this.revisions.set(topic,n);return n;}
  async finalize({challengeId,actor,now,makeSid,ttlMs}) {
    const q=this.challenges.get(challengeId);
    if(!q || q.consumed || q.expiresAt<=now || q.userId!==actor.userId || q.authSessionId!==actor.authSessionId) fail('CHALLENGE_REPLAY_OR_EXPIRED',409);
    // All changes are synchronous after the single-use check (atomic within this isolated process).
    const old=q.sid?this.sessions.get(q.sid):null;
    if(q.kind!=='register' && (!old || old.revokedAt!==null || old.expiresAt<=now || old.userId!==actor.userId || old.authSessionId!==actor.authSessionId || old.topic!==q.topic)) fail('SESSION_NO_LONGER_ACTIVE',409);
    q.consumed=true;
    if(q.kind==='register') {
      const sid=makeSid();
      const record={sid,epoch:1,topic:q.topic,userId:actor.userId,authSessionId:actor.authSessionId,
        guest:actor.guest,displayName:actor.guest?`게스트 ${sid.slice(0,4).toUpperCase()}`:actor.displayName,
        publicJwk:q.publicJwk,issuedAt:now,expiresAt:now+ttlMs,revokedAt:null,revision:this.#bump(q.topic)};
      this.sessions.set(sid,record);
      return {event:'JOIN',record:{...record}};
    }
    if(q.kind==='renew') {
      const record={...old,epoch:old.epoch+1,issuedAt:now,expiresAt:now+ttlMs,revision:this.#bump(q.topic),displayName:actor.guest?old.displayName:actor.displayName};
      this.sessions.set(old.sid,record);
      return {event:'UPDATE',record:{...record}};
    }
    const record={...old,revokedAt:now,revision:this.#bump(q.topic)};
    this.sessions.set(old.sid,record);
    return {event:'REVOKE',record:{...record}};
  }
  async activeSession(sid,now){const x=this.sessions.get(sid);return x && x.expiresAt>now && x.revokedAt===null?{...x}:null;}
  async hasActiveActor(actor,topic,now){return [...this.sessions.values()].some(s=>s.topic===topic&&s.userId===actor.userId&&s.authSessionId===actor.authSessionId&&s.revokedAt===null&&s.expiresAt>now);}
  async snapshot(topic,now){
    const active=[...this.sessions.values()].filter(s=>s.topic===topic&&s.revokedAt===null&&s.expiresAt>now).map(s=>({...s}));
    return {topic,revision:this.revisions.get(topic)??0,asOf:now,entries:active};
  }
  async revokeUser(userId,now){
    const changed=[];
    for(const [sid,record] of this.sessions)if(record.userId===userId&&record.revokedAt===null){
      const updated={...record,revokedAt:now,revision:this.#bump(record.topic)};
      this.sessions.set(sid,updated);changed.push({event:'REVOKE',record:updated});
    }
    return changed;
  }
}

function publicEntry(x){return {
  sid:x.sid,userId:x.userId,guest:x.guest,displayName:x.displayName,
  epoch:x.epoch,topic:x.topic,publicJwk:x.publicJwk,
  issuedAt:x.issuedAt,expiresAt:x.expiresAt,revision:x.revision,
};}

export class IdentityService {
  constructor({auth,store,publisher,authorize,now=()=>Date.now(),uuid=randomUUID,nonce=()=>randomBytes(24).toString('base64url'),ttlMs=60_000,challengeMs=20_000}){
    if(!auth?.verify || !store?.finalize || !publisher?.publish || typeof authorize!=='function')throw Error('Missing security dependency');
    this.auth=auth;this.store=store;this.publisher=publisher;this.authorize=authorize;this.now=now;this.uuid=uuid;this.nonce=nonce;this.ttlMs=ttlMs;this.challengeMs=challengeMs;
  }
  async #actor(authorization,topic){
    const token=tokenFrom(authorization);
    let actor;
    try{actor=await this.auth.verify(token);}catch(e){if(e instanceof RIError)throw e;fail('AUTH_UNAVAILABLE',503);}
    if(!actor || !UUID.test(actor.userId) || !UUID.test(actor.authSessionId) || typeof actor.guest!=='boolean')fail('AUTH_REQUIRED',401);
    if(!isTopic(topic))fail('BAD_TOPIC',400);
    if(actor.banned || actor.kicked)fail('ACCESS_REVOKED',403);
    if(!actor.guest && (typeof actor.displayName!=='string'||actor.displayName.length<1))fail('PROFILE_UNAVAILABLE',503);
    if(ROOM.test(topic)&&actor.guest)fail('PERMANENT_ACCOUNT_REQUIRED',403);
    const allowed=await this.authorize({actor,topic});
    if(!allowed)fail('SCOPE_DENIED',403);
    return actor;
  }
  async challenge(authorization,{kind,topic,publicJwk,sid=null}={}){
    if(!PUBLIC_KINDS.has(kind))fail('BAD_CHALLENGE_KIND',400);
    const actor=await this.#actor(authorization,topic);
    if(kind==='register' && sid!==null)fail('SID_NOT_ALLOWED',400);
    if(kind!=='register' && (!UUID.test(sid??'')))fail('SID_REQUIRED',400);
    let keyHash;
    try {publicJwk=validatePublicJwk(publicJwk);keyHash=await fingerprint(publicJwk);} catch {fail('BAD_PUBLIC_KEY',400);}
    const now=this.now();
    if(kind!=='register'){
      const old=await this.store.activeSession(sid,now);
      if(!old||old.userId!==actor.userId||old.authSessionId!==actor.authSessionId||old.topic!==topic||canonical(old.publicJwk)!==canonical(publicJwk))fail('NO_SESSION_OWNERSHIP',403);
    }
    const q={id:this.uuid(),nonce:this.nonce(),kind,topic,sid,userId:actor.userId,authSessionId:actor.authSessionId,
      publicJwk, keyHash,expiresAt:now+this.challengeMs};
    await this.store.issue(q);
    // The client signs exactly this server-supplied public data; server retains the binding.
    return {id:q.id,nonce:q.nonce,kind:q.kind,topic:q.topic,sid:q.sid,keyHash:q.keyHash,expiresAt:q.expiresAt};
  }
  async finish(authorization,{challengeId,signature}={}){
    if(!UUID.test(challengeId??'') || typeof signature!=='string')fail('BAD_FINISH_REQUEST',400);
    const q=await this.store.challenge(challengeId);
    if(!q||q.expiresAt<=this.now()||q.consumed)fail('CHALLENGE_REPLAY_OR_EXPIRED',409);
    const actor=await this.#actor(authorization,q.topic);
    if(q.userId!==actor.userId||q.authSessionId!==actor.authSessionId)fail('CHALLENGE_OWNER_MISMATCH',403);
    let valid=false;
    try { valid=await verifyProof(q.publicJwk,q,signature); } catch {valid=false;}
    if(!valid)fail('PROOF_INVALID',403);
    const outcome=await this.store.finalize({challengeId,actor,now:this.now(),makeSid:this.uuid,ttlMs:this.ttlMs});
    const record=outcome.record;
    const event={type:outcome.event,topic:record.topic,revision:record.revision,entry:outcome.event==='REVOKE'?{sid:record.sid,epoch:record.epoch,topic:record.topic}:publicEntry(record)};
    let publication='PUBLISHED';
    try {await this.publisher.publish(event);}catch{publication='PENDING_SNAPSHOT_RECONCILIATION';}
    return {event:outcome.event,entry:outcome.event==='REVOKE'?null:publicEntry(record),revision:record.revision,publication};
  }
  async roster(authorization,topic){
    const actor=await this.#actor(authorization,topic);
    if(!await this.store.hasActiveActor(actor,topic,this.now()))fail('ACTIVE_IDENTITY_REQUIRED',403);
    const snap=await this.store.snapshot(topic,this.now());
    return {topic:snap.topic,revision:snap.revision,asOf:snap.asOf,
      entries:snap.entries.map(publicEntry)};
  }
  // Server/ops-only entry point. Never expose an arbitrary target revoke endpoint to web clients.
  async revokeByAuthority(userId) {
    if(!UUID.test(userId))fail('BAD_USER',400);
    const results=await this.store.revokeUser(userId,this.now());
    for(const result of results){
      const e={type:'REVOKE',topic:result.record.topic,revision:result.record.revision,entry:{sid:result.record.sid,epoch:result.record.epoch,topic:result.record.topic}};
      try {await this.publisher.publish(e);}catch{/* snapshot reconciles; unresolved failures monitored by caller */}
    }
    return {sessionsRevoked:results.length,notSocketDisconnect:true};
  }
}
