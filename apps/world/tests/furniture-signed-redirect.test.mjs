import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {CHARACTER_FURNITURE_CANDIDATES} from '../src/rooms/character-furniture-assets.js';
import {OFFICIAL_FURNITURE_CANDIDATES} from '../src/rooms/furniture-visual-assets.js';
const visuals=[...CHARACTER_FURNITURE_CANDIDATES,...OFFICIAL_FURNITURE_CANDIDATES.filter(v=>['furniture.campus_rug_blue','fixture.personal_bed'].includes(v.itemId))];
const source=readFileSync(new URL('../api/brand-asset.js',import.meta.url),'utf8');
function rig(visual, override={}) {
 const asset=new URL(visual.url,'https://local.invalid').searchParams.get('asset');
 const location=`https://example.supabase.co/storage/v1/object/sign/inhagame-furniture-private/${asset}?token=fixture.signature`;
 const calls=[];let bodyReads=0;
 const context={module:{exports:{}},process:{env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'}},URL,AbortSignal,Buffer,
  fetch:async(url,options)=>{calls.push({url,options});if(override.throw)throw Error('upstream unavailable');return {status:override.status??307,headers:new Headers({Location:override.location??location,'X-INHAGAME-Asset-SHA256':override.sha??visual.sha256,'X-INHAGAME-Output-Bytes':override.bytes??String(visual.byteLength)}),arrayBuffer(){bodyReads++;throw Error('must not buffer furniture')}}}};
 vm.runInNewContext(source,context);
 return {calls,location,bodyReads:()=>bodyReads,async request(method='GET') {const headers={};let status;const response={setHeader(k,v){headers[k.toLowerCase()]=v},status(v){status=v;return this},end(){}};await context.module.exports({method,url:visual.url},response);return {status,headers}}};
}
test('five immutable GET/HEAD redirects are manual, bounded, exact and never buffered/cached',async()=>{
 for(const visual of visuals) for(const method of ['GET','HEAD']){
  const r=rig(visual),out=await r.request(method);assert.equal(out.status,307);assert.equal(out.headers.location,r.location);assert.equal(out.headers['cache-control'],'no-store');assert.equal(out.headers['cdn-cache-control'],'no-store');assert.equal(out.headers['vercel-cdn-cache-control'],'no-store');assert.equal(out.headers['referrer-policy'],'no-referrer');assert.equal(out.headers['x-inhagame-asset-sha256'],visual.sha256);assert.equal(out.headers['x-inhagame-output-bytes'],String(visual.byteLength));assert.equal(r.calls[0].options.redirect,'manual');assert.equal(r.calls[0].options.method,method);assert.ok(r.calls[0].options.signal);assert.equal(r.bodyReads(),0);assert.equal(visual.enabled,true);
 }
});
test('wrong host, scheme, bucket, object, credentials, extra query, hash and ambiguous tokens fail closed',async()=>{
 const visual=visuals[0],valid=rig(visual).location;
 const invalid=[valid.replace('https:','http:'),valid.replace('example.supabase.co','attacker.invalid'),valid.replace('example.supabase.co','example.supabase.co.attacker.invalid'),valid.replace('https://','https://user:password@'),valid.replace('inhagame-furniture-private','another-bucket'),valid.replace('annyongi-character-chair','other-chair'),valid+'&download=true',valid+'&token=duplicate',valid+'#fragment',valid.replace('fixture.signature',''),valid.replace('?token=','?other='),valid.replace('fixture.signature','bad%20token')];
 for(const location of invalid){const r=rig(visual,{location}),out=await r.request();assert.equal(out.status,502);assert.equal(out.headers.location,undefined);assert.equal(out.headers['cache-control'],'no-store');assert.equal(r.bodyReads(),0)}
});
test('wrong digest/size/status or failed signing never redirects and retains no-store',async()=>{
 for(const override of [{sha:'0'.repeat(64)},{bytes:'1'},{status:200},{status:302},{status:404},{throw:true}]){const r=rig(visuals[0],override),out=await r.request();assert.equal(out.status,override.throw?503:502);assert.equal(out.headers.location,undefined);assert.equal(out.headers['cache-control'],'no-store');assert.equal(r.bodyReads(),0)}
});
test('legacy five canonical and optimized deliveries retain their original buffered response contract',async()=>{
 const assets=['induck-v3.glb','annyongi-flight-v1.glb','induck-cap-v1.glb','induck-backpack-v1.glb','induck-hoodie-v1.glb'];
 const payload=Buffer.alloc(1024);payload.write('glTF');const calls=[];
 const context={module:{exports:{}},process:{env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'}},URL,AbortSignal,Buffer,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,headers:new Headers(),arrayBuffer:async()=>payload}}};
 vm.runInNewContext(source,context);
 for(const asset of assets)for(const variant of ['canonical','optimized']){
  const headers={};let status,sent;
  await context.module.exports({method:'GET',url:`/api/brand-asset?asset=${asset}&variant=${variant}`},{setHeader(k,v){headers[k.toLowerCase()]=v},status(v){status=v;return this},send(bytes){sent=bytes},end(){}});
  assert.equal(status,200);assert.deepEqual(sent,payload);assert.equal(calls.at(-1).options.redirect,undefined);assert.match(headers['cache-control'],/^public, max-age=300/);assert.equal(headers.location,undefined);
 }
});
