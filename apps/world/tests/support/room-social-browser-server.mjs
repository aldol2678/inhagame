// Deterministic browser transport double. Not Supabase, RLS or database evidence.
// The SQL fixture and disposable Supabase jobs test the separate server authority.
import { randomUUID } from 'node:crypto';
import { serverFixture } from './club-server-fixture.mjs';
import { normalizeChatText } from '../../src/online/local-chat.js';
export const socialUser = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const SOCIAL_ROOM = '20000000-0000-4000-8000-000000000001';
export function browserSocialServer() {
  const club = serverFixture(), leases = new Map(), subscribers = new Map(), denied = new Set(), blocked = new Set(), limits = new Map();
  const allowed = l => !denied.has(l.userId) && l.expires > Date.now() &&
    (l.kind === 'personal' ? [socialUser(1),socialUser(2)].includes(l.userId) :
      club.sessions.get(l.sessionId)?.userId === l.userId);
  const leaseData = l => ({ version:1, allowed:true, leaseId:l.id, inboxNonce:l.inboxNonce, kind:l.kind, roomId:l.roomId,
    userId:l.userId, sessionId:l.sessionId, topic:`world:room-chat:${l.id}`, ttlMs:30000 });
  const pair = (a,b) => [a,b].sort().join(':');
  const sync = topic => {
    const state = Object.fromEntries([...subscribers.values()].filter(s=>s.topic===topic && s.presence).map(s=>[s.presence.sessionId,[s.presence]]));
    for (const s of subscribers.values()) if(s.topic===topic) s.deliver({ kind:'presence', event:'sync', state });
  };
  async function rpc(userId, name, args) {
    if (name.includes('world_club_room')) return club.client(userId).rpc(name,args);
    if (name === 'check_world_room_access_v1') return { data:{ roomId:args.p_room, allowed:!denied.has(userId),
      role:userId===socialUser(1)?'owner':'visitor',ownerUserId:socialUser(1),visibility:'friends' } };
    if (name === 'join_world_room_chat_v1') {
      const l={id:randomUUID(),inboxNonce:randomUUID(),userId,kind:args.p_kind,roomId:args.p_room,sessionId:args.p_session,expires:Date.now()+30000};
      if(!allowed(l)) return {data:{allowed:false}};
      for(const [id,old] of leases) if(old.userId===userId) leases.delete(id);
      leases.set(l.id,l);return {data:leaseData(l)};
    }
    const l=leases.get(args.p_lease);
    if(!l||l.userId!==userId) return {data:{allowed:false,ok:false,reason:'denied'}};
    if(name==='leave_world_room_chat_v1'){leases.delete(l.id);return {data:true};}
    if(!allowed(l))return {data:{allowed:false,ok:false,reason:'denied'}};
    if(name==='renew_world_room_chat_v1'){l.inboxNonce=randomUUID();l.expires=Date.now()+30000;return {data:leaseData(l)};}
    if(name==='send_world_room_chat_v1'){
      const valid=normalizeChatText(args.p_text); if(!valid.ok)return {data:{ok:false,reason:valid.reason}};
      const recent=(limits.get(userId)||[]).filter(t=>Date.now()-t<5000);
      if(recent.length>=3)return {data:{ok:false,reason:'rate_limited'}};
      recent.push(Date.now());limits.set(userId,recent);
      const message={v:1,id:randomUUID(),kind:l.kind,roomId:l.roomId,sessionId:l.sessionId,userId,name:userId===socialUser(1)?'방주인':'친구',text:valid.text};
      for(const target of leases.values()) if(target.userId!==userId&&target.kind===l.kind&&target.roomId===l.roomId&&allowed(target)&&!blocked.has(pair(userId,target.userId))) {
        for(const s of subscribers.values())if(s.topic===leaseData(target).topic)s.deliver({kind:'broadcast',event:'room_chat_v1',payload:{...message,inboxNonce:target.inboxNonce}});
      }
      return {data:{ok:true,message}};
    }
    throw Error(`Unexpected synthetic RPC ${name}`);
  }
  function subscribe(userId,id,topic,options,deliver){
    if(!options.config.private)throw Error('Expected private channel');
    const s={userId,id,topic,deliver};subscribers.set(id,s);
    if(topic.startsWith('world:club:')){
      s.club=club.client(userId).channel(topic,options).on('broadcast',{event:'club-packet'},({payload})=>deliver({kind:'broadcast',event:'club-packet',payload}));
      s.club.subscribe(()=>{});
    }
  }
  function remove(id){const s=subscribers.get(id);if(!s)return;subscribers.delete(id);if(s.club)club.client(s.userId).removeChannel(s.club);if(s.presence)sync(s.topic);}
  function track(id,presence){const s=subscribers.get(id);if(!s||!s.topic.startsWith('world:room:'))throw Error('Only legacy personal Presence is client asserted');s.presence=presence;sync(s.topic);}
  function send(id,packet){const s=subscribers.get(id);if(!s||!s.topic.startsWith('world:room:')||!['pose','action'].includes(packet.event))throw Error('Client chat/club publish prohibited');for(const target of subscribers.values())if(target.id!==id&&target.topic===s.topic)target.deliver({kind:'broadcast',event:packet.event,payload:packet.payload});}
  return {club,leases,denied,subscribers,rpc,subscribe,remove,track,send,block(a,b){blocked.add(pair(a,b));},unblock(a,b){blocked.delete(pair(a,b));},resetLimits(){limits.clear();}};
}
