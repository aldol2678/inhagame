// Client-side reference verifier. Feed ONLY via authenticated HTTPS roster + server-write-only topic.
// Never give legacy Presence or unsigned broadcast a social identity.
import {canonical,isTopic,UUID,verifyFrame} from './crypto.mjs';
export class VerifiedReceiver {
 constructor({now=()=>Date.now(),limit=256}={}){
  this.now=now;this.limit=limit;this.topic=null;this.revision=-1;this.members=new Map();this.lastSeq=new Map();this.needsResync=true;
 }
 reset(topic){if(!isTopic(topic))throw Error('BAD_TOPIC');this.topic=topic;this.revision=-1;this.members.clear();this.lastSeq.clear();this.needsResync=true;}
 fromSnapshot(snap){
  if(!snap||snap.topic!==this.topic||!Number.isSafeInteger(snap.revision)||snap.revision<0||!Array.isArray(snap.entries)||snap.entries.length>this.limit)return false;
  if(snap.revision<this.revision)return false;
  const next=new Map();
  for(const e of snap.entries){
   if(!this.#valid(e)||e.expiresAt<=this.now()||next.has(e.sid))return false;
   next.set(e.sid,{...e});
  }
  const changed=[...this.members].filter(([sid,m])=>!next.has(sid)||next.get(sid).epoch!==m.epoch);
  for(const [sid] of changed)this.#forgetSid(sid);
  this.members=next;this.revision=snap.revision;this.needsResync=false;
  return true;
 }
 #valid(e){return e&&UUID.test(e.sid??'')&&UUID.test(e.userId??'')&&e.topic===this.topic&&e.publicJwk?.kty==='EC'&&Number.isSafeInteger(e.epoch)&&e.epoch>0&&Number.isSafeInteger(e.expiresAt);}
 #forgetSid(sid){for(const k of this.lastSeq.keys())if(k.startsWith(sid+'|'))this.lastSeq.delete(k);}
 // Events are allowed only from the server-controlled read-only trusted channel.
 fromTrustedEvent(e){
  if(this.needsResync||!e||e.topic!==this.topic||e.revision!==this.revision+1){this.needsResync=true;return false;}
  if(e.type==='REVOKE'){
   if(!UUID.test(e.entry?.sid??'')){this.needsResync=true;return false;}
   this.members.delete(e.entry.sid);this.#forgetSid(e.entry.sid);
  }else if(e.type==='JOIN'||e.type==='UPDATE'){
   if(!this.#valid(e.entry)){this.needsResync=true;return false;}
   const current=this.members.get(e.entry.sid);
   if(current&&e.entry.epoch<current.epoch){this.needsResync=true;return false;}
   if(current&&e.entry.epoch!==current.epoch)this.#forgetSid(e.entry.sid);
   this.members.set(e.entry.sid,{...e.entry});
  }else{this.needsResync=true;return false;}
  this.revision=e.revision;return true;
 }
 async verify(frame,actualTopic){
  if(this.needsResync)return {ok:false,reason:'ROSTER_UNSYNCED'};
  if(actualTopic!==this.topic||!frame||frame.v!==2||frame.topic!==actualTopic||!['POSE','ACTION'].includes(frame.kind))return {ok:false,reason:'BAD_ENVELOPE'};
  if(!UUID.test(frame.sid??'')||!Number.isSafeInteger(frame.seq)||frame.seq<0||!Number.isSafeInteger(frame.epoch)||frame.epoch<=0||typeof frame.sig!=='string')return {ok:false,reason:'BAD_ENVELOPE'};
  try {if(canonical(frame).length>2048)return {ok:false,reason:'OVERSIZE'};}catch{return {ok:false,reason:'BAD_ENVELOPE'};}
  // The wire has an exact allowlist, so unsigned extra fields cannot influence clients.
  if(Object.keys(frame).sort().join(',')!==['epoch','kind','payload','seq','sid','sig','topic','v'].sort().join(','))return {ok:false,reason:'BAD_ENVELOPE'};
  const member=this.members.get(frame.sid);
  if(!member||member.expiresAt<=this.now()||member.epoch!==frame.epoch||member.topic!==actualTopic)return {ok:false,reason:'NO_ACTIVE_BINDING'};
  const pkt=frame.payload;
  if(!pkt||typeof pkt!=='object'||Array.isArray(pkt))return {ok:false,reason:'BAD_PACKET'};
  if(frame.kind==='ACTION'){
   if(!Number.isSafeInteger(pkt.id)||pkt.id!==frame.seq||!['jump','teleport','emote','chat'].includes(pkt.type))return {ok:false,reason:'BAD_ACTION'};
   if(member.guest&&!['jump','teleport'].includes(pkt.type))return {ok:false,reason:'GUEST_FORBIDDEN'};
  }else if(!Number.isSafeInteger(pkt.seq)||pkt.seq!==frame.seq||pkt.v!==1)return {ok:false,reason:'BAD_POSE'};
  const replayKey=`${frame.sid}|${frame.epoch}|${actualTopic}|${frame.kind}`;
  const prior=this.lastSeq.get(replayKey)??-1;
  if(frame.seq<=prior)return {ok:false,reason:'REPLAY'};
  let good=false;
  try{good=await verifyFrame(member.publicJwk,frame);}catch{}
  if(!good)return {ok:false,reason:'SIGNATURE_INVALID'};
  // Crypto is asynchronous; competing promises must re-check sequence before committing.
  if(frame.seq<=(this.lastSeq.get(replayKey)??-1))return {ok:false,reason:'REPLAY'};
  // Another async operation may have revoked/rotated the identity while we verified.
  if(this.needsResync||this.members.get(frame.sid)?.epoch!==member.epoch||this.members.get(frame.sid)?.expiresAt<=this.now())return {ok:false,reason:'BINDING_CHANGED'};
  this.lastSeq.set(replayKey,frame.seq);
  return {ok:true,sid:member.sid,userId:member.userId,guest:member.guest,displayName:member.displayName,
    payload:pkt,kind:frame.kind,epoch:frame.epoch};
 }
}
