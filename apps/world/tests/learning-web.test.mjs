import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLearningWebAuth,createLearningWebClient} from '../src/learning-web/auth.js';
import {learningRoute,clearLearningUrl} from '../src/learning-web/navigation.js';
import {createLearningLauncher,LEARNING_LAUNCHER_RELEASE} from '../src/phone/learning-launcher.js';
import {createFakeDocument} from './support/fake-dom.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const session=id=>({access_token:'test-token-'+id,user:{id,is_anonymous:false,email:id+'@example.test'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(initial=session('A')){
 let current=initial,callback,unsubscribed=false;const states=[];
 const client={auth:{getSession:async()=>({data:{session:current}}),getUser:async token=>({data:{user:session(token.replace('test-token-','')).user}}),
  onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){unsubscribed=true;}}}};},
  async signInWithPassword(){current=session('A');callback('SIGNED_IN',current);return {data:{session:current}};},
  async signOut(){current=null;callback('SIGNED_OUT',null);return {};}}};
 const auth=createLearningWebAuth({client,onState:s=>states.push(s)});
 return {client,auth,states,event(event,id){current=id?session(id):null;callback(event,current);},set(value){current=value;},get unsubscribed(){return unsubscribed;}};
}
test('same project/default persistence, no URL-token consumption, unavailable SDK stays closed',()=>{
 assert.equal(createLearningWebClient({win:{}}),null);let options;
 const client={};assert.equal(createLearningWebClient({win:{__INHAGAME_PUBLIC_SUPABASE__:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'},supabase:{createClient:(u,k,o)=>{assert.equal(u,'https://example.supabase.co');options=o;return client;}}}}),client);
 assert.deepEqual(options.auth,{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false});assert.equal(options.auth.storageKey,undefined);
});
test('initial A records are gated until token-pinned getUser and session readback complete',async()=>{
 const f=fixture(),pending=deferred();f.client.auth.getUser=token=>{assert.equal(token,'test-token-A');return pending.promise;};const ready=f.auth.start();await tick();assert.equal(f.auth.snapshot().status,'checking');
 pending.resolve({data:{user:session('A').user}});await ready;assert.equal(f.auth.snapshot().user.id,'A');f.auth.dispose();
});
test('A to B event clears immediately and late A verification cannot expose A',async()=>{
 const f=fixture(),pending=deferred();f.client.auth.getUser=token=>token==='test-token-A'?pending.promise:Promise.resolve({data:{user:session('B').user}});
 const ready=f.auth.start();await tick();f.event('SIGNED_IN','B');assert.equal(f.auth.snapshot().status,'checking');assert.equal(f.auth.snapshot().user,null);
 await tick();assert.equal(f.auth.snapshot().user.id,'B');pending.resolve({data:{user:session('A').user}});await ready;assert.equal(f.auth.snapshot().user.id,'B');f.auth.dispose();
});
test('logout fences pending verification before awaiting SDK and does not copy member into guest',async()=>{
 const f=fixture(),pending=deferred();f.client.auth.getUser=()=>pending.promise;const ready=f.auth.start();await tick();await f.auth.signOut();assert.equal(f.auth.snapshot().status,'guest');
 pending.resolve({data:{user:session('A').user}});await ready;assert.equal(f.auth.snapshot().user,null);f.auth.dispose();
});
test('logout failure still clears personal state and stays locked',async()=>{
 const f=fixture();await f.auth.start();f.client.auth.signOut=async()=>({error:Error('offline')});const promise=f.auth.signOut();assert.equal(f.auth.snapshot().user,null);await assert.rejects(promise,/LOGOUT_FAILED/);assert.equal(f.auth.snapshot().status,'error');f.auth.dispose();
});
test('SDK subscription and thrown login failures remain recoverable without personal data',async()=>{
 const f=fixture(null);f.client.auth.onAuthStateChange=()=>{throw Error('storage unavailable');};await f.auth.start();assert.equal(f.auth.snapshot().status,'error');assert.equal(f.auth.snapshot().user,null);f.auth.dispose();
 const g=fixture(null);await g.auth.start();g.client.auth.signInWithPassword=async()=>{throw Error('network unavailable');};await assert.rejects(g.auth.signIn('A@example.test','test-only'),/LOGIN_FAILED/);assert.equal(g.auth.snapshot().status,'error');assert.equal(g.auth.snapshot().user,null);await g.auth.refresh();assert.equal(g.auth.snapshot().status,'guest');g.auth.dispose();
});
for(const kind of ['wrong-owner','anonymous','network','session-changed'])test(`verification refuses ${kind}`,async()=>{
 const f=fixture();f.client.auth.getUser=async()=>{
  if(kind==='network')throw Error('offline');if(kind==='session-changed')f.set(session('B'));
  return {data:{user:kind==='wrong-owner'?session('B').user:{...session('A').user,is_anonymous:kind==='anonymous'}}};
 };
 await f.auth.start();assert.equal(f.auth.snapshot().status,'error');assert.equal(f.auth.snapshot().user,null);f.auth.dispose();
});
test('anonymous and missing sessions use only guest; no server user impersonation',async()=>{
 for(const value of [null,{...session('A'),user:{...session('A').user,is_anonymous:true}}]){const f=fixture(value);f.client.auth.getUser=()=>{throw Error('must not verify anonymous as member');};await f.auth.start();assert.equal(f.auth.snapshot().status,'guest');f.auth.dispose();}
});
test('same-account refresh revalidates without announcing a different account',async()=>{
 const f=fixture();await f.auth.start();f.event('TOKEN_REFRESHED','A');assert.equal(f.auth.snapshot().candidateId,'A');await tick();assert.equal(f.auth.snapshot().user.id,'A');f.auth.dispose();
});
test('dispose fences late result and unsubscribes Auth listener',async()=>{
 const f=fixture(),pending=deferred();f.client.auth.getUser=()=>pending.promise;const ready=f.auth.start();await tick();f.auth.dispose();const count=f.states.length;pending.resolve({data:{user:session('A').user}});await ready;assert.equal(f.states.length,count);assert.equal(f.unsubscribed,true);
});
test('static navigation rejects unreviewed names; query/hash never become a destination',()=>{
 assert.equal(learningRoute('learn'),'/learn/');assert.equal(learningRoute('daily'),'/campus/?lobby=1&shortcut=daily-quiz');
 for(const key of ['https://evil.test','//evil.test','javascript:alert(1)','__proto__','constructor'])assert.throws(()=>learningRoute(key),/UNREVIEWED/);
 let path;clearLearningUrl({location:{search:'?returnTo=https://evil.test&access_token=secret',hash:'#refresh_token=secret'},history:{replaceState:(a,b,c)=>path=c}});assert.equal(path,'/learn/');
});
test('Phone launcher is OFF by default and only offers explicit noopener same-origin link',()=>{
 const doc=createFakeDocument(),host=doc.createElement('div');let returns=0;
 assert.equal(LEARNING_LAUNCHER_RELEASE.enabled,false);const off=createLearningLauncher({doc});assert.equal(off.mount(host),false);assert.equal(host.children.length,0);
 const launcher=createLearningLauncher({doc,enabled:true,onReturn:()=>returns++});assert.equal(launcher.mount(host),true);const nodes=host.children[0].children,link=nodes.find(n=>n.tagName==='A');
 assert.equal(link.href,'/learn/');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');nodes.find(n=>n.tagName==='BUTTON').click();assert.equal(returns,1);
 launcher.setAccount('B');assert.equal(host.children.length,0);launcher.dispose();assert.equal(launcher.mount(host),false);
});
test('standalone ESM transitive imports exclude World/Phone/graphics; World imports only the launcher',async()=>{
 const base=fileURLToPath(new URL('../',import.meta.url)),seen=new Set();
 async function walk(file){if(seen.has(file))return;seen.add(file);assert.ok(file.startsWith(resolve(base,'src/learning')));const source=await readFile(file,'utf8');assert.doesNotMatch(source,/navigator\.gpu|WebGPU|new pc\.|requestAnimationFrame|\.glb\b|postMessage\(/);for(const match of source.matchAll(/^\s*import\s+(?:[^;\n]*?\sfrom\s*)?['"]([^'"]+)['"]/gm)){assert.ok(match[1].startsWith('.'));await walk(resolve(dirname(file),match[1]));}}
 await walk(resolve(base,'src/learning-web/entry.js'));assert.ok(seen.has(resolve(base,'src/learning/learning-engine.js')));
 const main=await readFile(resolve(base,'src/main.js'),'utf8');assert.doesNotMatch(main,/learning\/(learning-controller|learning-cloud)\.js|createLearningController/);assert.match(main,/createLearningLauncher/);
 const html=await readFile(resolve(base,'learn/index.html'),'utf8');assert.match(html,/noindex,nofollow/);assert.doesNotMatch(html,/manifest|importmap|playcanvas|src\/main|phone\.css|canvas/i);
 const routes=JSON.parse(await readFile(resolve(base,'vercel.json'),'utf8')).routes;assert.equal(routes.find(r=>r.src==='/learn/?').dest,'/learn/index.html');
 const launcher=await readFile(resolve(base,'src/phone/learning-launcher.js'),'utf8');assert.doesNotMatch(launcher,/^import |\.rpc\(|localStorage|window\.open\(/m);
 for(const name of await readdir(resolve(base,'src/learning-web')))assert.doesNotMatch(await readFile(resolve(base,'src/learning-web',name),'utf8'),/service_role|signInAnonymously|\.rpc\(|wallet\.|campusXp\s*=/);
});
