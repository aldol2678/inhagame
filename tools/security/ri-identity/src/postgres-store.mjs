// PostgreSQL reference adapter using a *server-only* pool (e.g. pg Pool).
// This file has NO imports from `pg` and no DB connection is made in these tests.
// For deployment: connect as a service-only role, run preflight, then use a reviewed
// disposable SQL branch. Never connect directly from a browser.
import {RIError} from './identity-service.mjs';
const deny=(code,status=409)=>{throw new RIError(code,status)};
const mapped=row=>row && ({
 sid:row.sid,userId:row.user_id,authSessionId:row.auth_session_id,guest:row.guest,
 displayName:row.display_name,topic:row.topic,epoch:Number(row.epoch),publicJwk:row.public_jwk,
 issuedAt:new Date(row.issued_at).getTime(),expiresAt:new Date(row.expires_at).getTime(),
 revokedAt:row.revoked_at?new Date(row.revoked_at).getTime():null,revision:Number(row.revision)
});
export class PostgresIdentityStore {
 constructor(pool){if(!pool?.connect)throw Error('A server-only SQL pool is required');this.pool=pool;}
 async issue(q){
  await this.pool.query(`INSERT INTO private.world_ri_challenges
     (id,nonce,kind,topic,sid,user_id,auth_session_id,public_jwk,key_hash,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,to_timestamp($10/1000.0))`,
     [q.id,q.nonce,q.kind,q.topic,q.sid,q.userId,q.authSessionId,JSON.stringify(q.publicJwk),q.keyHash,q.expiresAt]);
  return q;
 }
 async challenge(id){const {rows}=await this.pool.query(`SELECT id,nonce,kind,topic,sid,user_id,auth_session_id,public_jwk,key_hash,expires_at,consumed_at
     FROM private.world_ri_challenges WHERE id=$1`,[id]);const q=rows[0];return q?{
      id:q.id,nonce:q.nonce,kind:q.kind,topic:q.topic,sid:q.sid,userId:q.user_id,authSessionId:q.auth_session_id,
      publicJwk:q.public_jwk,keyHash:q.key_hash,expiresAt:new Date(q.expires_at).getTime(),consumed:q.consumed_at!==null}:null;}
 async activeSession(sid,now){const {rows}=await this.pool.query(`SELECT * FROM private.world_ri_sessions WHERE sid=$1 AND revoked_at IS NULL AND expires_at>to_timestamp($2/1000.0)`,[sid,now]);return mapped(rows[0])??null;}
 async #write(operation){
  const db=await this.pool.connect();
  try{await db.query('BEGIN');const result=await operation(db);await db.query('COMMIT');return result;}
  catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally{db.release();}
 }
 async finalize({challengeId,actor,makeSid,ttlMs}) {
  return this.#write(async db=>{
    const row=(await db.query(`SELECT * FROM private.world_ri_challenges WHERE id=$1 FOR UPDATE`,[challengeId])).rows[0];
    if(!row||row.consumed_at!==null||new Date(row.expires_at).getTime()<=Date.now()||row.user_id!==actor.userId||row.auth_session_id!==actor.authSessionId)deny('CHALLENGE_REPLAY_OR_EXPIRED');
    // All registration writers must share the SAME user-lock contract as the kick fix (F01-F03).
    // This lock name is a candidate and must be reconciled with the actual patched kick RPC.
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('world_ri_identity:'||$1::text,0))`,[actor.userId]);
    const live=await db.query(`SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id=$2 AND user_id=$1) AS auth_live,
      EXISTS(SELECT 1 FROM public.profiles WHERE user_id=$1 AND is_banned=TRUE) AS banned,
      EXISTS(SELECT 1 FROM private.world_session_kick_blocks WHERE user_id=$1 AND blocked_until>now()) AS kicked`,[actor.userId,actor.authSessionId]);
    if(!live.rows[0].auth_live||live.rows[0].banned||live.rows[0].kicked)deny('ACCESS_REVOKED',403);
    if(row.topic.startsWith('world:room:')){
      const ok=(await db.query(`SELECT private.world_room_access_v1($1::uuid,substring($2 from 12)::uuid) IN ('OWNER','VISITOR') AS ok`,[actor.userId,row.topic])).rows[0].ok;
      if(!ok)deny('ROOM_ACCESS_DENIED',403);
    }
    let prev=null;
    if(row.kind!=='register'){
      prev=(await db.query(`SELECT * FROM private.world_ri_sessions WHERE sid=$1 FOR UPDATE`,[row.sid])).rows[0];
      if(!prev||prev.user_id!==actor.userId||prev.auth_session_id!==actor.authSessionId||prev.topic!==row.topic||prev.revoked_at||new Date(prev.expires_at).getTime()<=Date.now())deny('SESSION_NO_LONGER_ACTIVE');
    }
    await db.query(`UPDATE private.world_ri_challenges SET consumed_at=now() WHERE id=$1`,[challengeId]);
    const revision=(await db.query(`INSERT INTO private.world_ri_topic_revisions(topic,revision) VALUES($1,1)
      ON CONFLICT(topic) DO UPDATE SET revision=private.world_ri_topic_revisions.revision+1 RETURNING revision`,[row.topic])).rows[0].revision;
    let result;
    if(row.kind==='register'){
      const sid=makeSid(),name=actor.guest?`게스트 ${sid.slice(0,4).toUpperCase()}`:actor.displayName;
      result=(await db.query(`INSERT INTO private.world_ri_sessions
        (sid,user_id,auth_session_id,guest,display_name,topic,epoch,public_jwk,issued_at,expires_at,revision)
        VALUES ($1,$2,$3,$4,$5,$6,1,$7::jsonb,now(),now()+($8::int * interval '1 millisecond'),$9)
        RETURNING *`,[sid,actor.userId,actor.authSessionId,actor.guest,name,row.topic,JSON.stringify(row.public_jwk),ttlMs,revision])).rows[0];
    }else if(row.kind==='renew'){
      result=(await db.query(`UPDATE private.world_ri_sessions SET epoch=epoch+1,issued_at=now(),
       expires_at=now()+($2::int * interval '1 millisecond'),revision=$3,display_name=$4
       WHERE sid=$1 RETURNING *`,[row.sid,ttlMs,revision,actor.guest?prev.display_name:actor.displayName])).rows[0];
    }else{
      result=(await db.query(`UPDATE private.world_ri_sessions SET revoked_at=now(),revision=$2 WHERE sid=$1 RETURNING *`,[row.sid,revision])).rows[0];
    }
    return {event:row.kind==='register'?'JOIN':row.kind==='renew'?'UPDATE':'REVOKE',record:mapped(result)};
  });
 }
 async hasActiveActor(actor,topic,now){const {rows}=await this.pool.query(`SELECT EXISTS(SELECT 1 FROM private.world_ri_sessions
 WHERE user_id=$1 AND auth_session_id=$2 AND topic=$3 AND revoked_at IS NULL AND expires_at>now()) AS yes`,
 [actor.userId,actor.authSessionId,topic]);return rows[0]?.yes===true;}
 async snapshot(topic,now){return this.#write(async db=>{
   // Our caller only needs two SQL queries in one repeatable-read consistent transaction.
   await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const rev=(await db.query('SELECT revision FROM private.world_ri_topic_revisions WHERE topic=$1',[topic])).rows[0]?.revision??0;
   const {rows}=await db.query(`SELECT * FROM private.world_ri_sessions WHERE topic=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY sid LIMIT 256`,[topic]);
   return {topic,revision:Number(rev),asOf:now,entries:rows.map(mapped)};
 });}
 async revokeUser(userId){return this.#write(async db=>{
   // Used only by the trusted ops/ejection path, never by HTTP on a player-chosen user.
   await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('world_ri_identity:'||$1::text,0))`,[userId]);
   const rows=(await db.query('SELECT * FROM private.world_ri_sessions WHERE user_id=$1 AND revoked_at IS NULL FOR UPDATE',[userId])).rows;
   const results=[];
   for(const old of rows){const revision=(await db.query(`INSERT INTO private.world_ri_topic_revisions(topic,revision) VALUES($1,1)
     ON CONFLICT(topic) DO UPDATE SET revision=private.world_ri_topic_revisions.revision+1 RETURNING revision`,[old.topic])).rows[0].revision;
     const updated=(await db.query(`UPDATE private.world_ri_sessions SET revoked_at=now(),revision=$2 WHERE sid=$1 RETURNING *`,[old.sid,revision])).rows[0];
     results.push({event:'REVOKE',record:mapped(updated)});
   }
   return results;
 });}
}
