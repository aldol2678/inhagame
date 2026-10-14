import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseTrustedPublisher} from '../src/supabase-trusted-publisher.mjs';
const ref='abcdefghijklmnopqrst';const url=`https://${ref}.supabase.co`;
test('RI-PUB-01 server secret only, trusted namespace and private=true in REST broadcast',async()=>{
 let seen=null;const broadcaster=createSupabaseTrustedPublisher({projectUrl:url,projectRef:ref,secretKey:'test-server-secret-'+('q'.repeat(30)),
  fetcher:async(url,options)=>{seen={url,options};return {ok:true}}});
 const result=await broadcaster.publish({type:'JOIN',topic:'world:campus:AREA_MAIN_HALL',revision:1,entry:{sid:'a'}});
 assert.equal(result.accepted,true);assert.equal(result.deliveredToAllClients,false);
 assert.ok(seen.url.includes('/realtime/v1/api/broadcast/world%3Atrusted%3Acampus%3AAREA_MAIN_HALL/events/ri.registry?private=true'));
 assert.equal(seen.options.headers.apikey.startsWith('test-server-secret'),true);
 assert.equal(seen.options.headers.authorization,undefined);
 assert.equal(JSON.parse(seen.options.body).revision,1);
});
test('RI-PUB-02 rejects production and mismatched project origin before network access',()=>{
 assert.throws(()=>createSupabaseTrustedPublisher({projectUrl:'https://oosshdsthgpqabjmbkjo.supabase.co',projectRef:'oosshdsthgpqabjmbkjo',secretKey:'x'.repeat(40)}));
 assert.throws(()=>createSupabaseTrustedPublisher({projectUrl:url,projectRef:'unmatchedxxxxxxxxxxx',secretKey:'x'.repeat(40)}));
});
test('RI-PUB-03 rejects any attempt to publish arbitrary trusted namespace or malformed action',async()=>{
 let sent=0;const b=createSupabaseTrustedPublisher({projectUrl:url,projectRef:ref,secretKey:'x'.repeat(40),fetcher:async()=>{sent++;return {ok:true}}});
 await assert.rejects(()=>b.publish({type:'JOIN',topic:'world:trusted:campus:AREA_MAIN_HALL',revision:1}));
 await assert.rejects(()=>b.publish({type:'OTHER',topic:'world:campus:AREA_MAIN_HALL',revision:1}));
 assert.equal(sent,0);
});
