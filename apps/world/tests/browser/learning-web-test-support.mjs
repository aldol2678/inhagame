// Synthetic response injection only. No production query/global release override.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const fakeWebSdk=`(()=>{
 const key='web-qa-session';let listeners=new Set(),session=JSON.parse(localStorage.getItem(key)||'null');
 const notify=(event)=>listeners.forEach(fn=>fn(event,session));
 const set=s=>{session=s;s?localStorage.setItem(key,JSON.stringify(s)):localStorage.removeItem(key);};
 const client={auth:{
 getSession:async()=>({data:{session}}),
 getUser:async token=>{if(window.webVerifyDelay)await new Promise(r=>window.webVerifyRelease=r);return {data:{user:token?{id:token.replace('synthetic-',''),is_anonymous:false,email:token.replace('synthetic-','')+'@example.test'}:null}};},
 onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe(){listeners.delete(fn);}}}};},
 async signInWithPassword({email}){const id=email.split('@')[0];set({access_token:'synthetic-'+id,user:{id,is_anonymous:false,email}});notify('SIGNED_IN');return {data:{session}};},
 async signOut(){set(null);notify('SIGNED_OUT');return {};}
 },rpc(){throw Error('CLOUD_OFF_RPC_FORBIDDEN');}};
 addEventListener('storage',e=>{if(e.key===key){session=JSON.parse(e.newValue||'null');notify(session?'SIGNED_IN':'SIGNED_OUT');}});
 window.supabase={createClient:()=>client};
})();`;
export async function installWebQA(context,{content=false,cloud=false,sdk=fakeWebSdk,config={url:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'}}={}){
 const isLearn=r=>new URL(r.request().frame().url()).pathname.startsWith('/learn');
 await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',r=>isLearn(r)?r.fulfill({contentType:'text/javascript',body:sdk}):r.fallback());
 await context.route('**/api/public-supabase-config',r=>isLearn(r)?r.fulfill({contentType:'text/javascript',body:'globalThis.__INHAGAME_PUBLIC_SUPABASE__='+JSON.stringify(config)+';'}):r.fallback());
 if(content){
  const original=await readFile(new URL('../../src/learning-web/entry.js',import.meta.url),'utf8');
  const needle='const app=createLearningWeb({client:createLearningWebClient()});';assert.ok(original.includes(needle));
  const source=`import {createLearningController} from '/src/learning/learning-controller.js';\nimport {createLearningCatalog} from '/src/learning/learning-content.js';\nimport {createLearningCloudTransport} from '/src/learning/learning-cloud.js';\nimport {learningFixture} from '/tests/support/learning-fixture.mjs';\n`+original.replace(needle,`const app=createLearningWeb({client:window.webTestClient=createLearningWebClient(),createController:options=>createLearningController({...options,content:createLearningCatalog(learningFixture())${cloud?',cloudTransport:createLearningCloudTransport({getClient:()=>window.webTestClient,enabled:true})':''}})});window.webApp=app;`);
  await context.route('**/src/learning-web/entry.js',r=>r.fulfill({contentType:'text/javascript',body:source}));
 }
}
export const webButton=(page,name)=>page.getByRole('button',{name,exact:true});
export const webSnapshot=page=>page.evaluate(()=>window.webApp.snapshot());
export async function answerWeb(page,{wrong=false,advance=true}={}){
 const run=(await webSnapshot(page)).learning.run,q=run.questions[run.index];
 if(q.type==='order')for(const part of q.parts)await page.locator('.learning-answers').getByRole('button',{name:part,exact:true}).first().click();
 else if(q.type==='match')for(const [l,r] of q.pairs){await page.locator('.learning-match').getByRole('button',{name:l,exact:true}).click();await page.locator('.learning-match').getByRole('button',{name:r,exact:true}).click();}
 else {const i=wrong?(q.a+1)%q.options.length:q.a;await webButton(page,`${String.fromCharCode(65+i)}. ${q.options[i]}`).click();}
 await webButton(page,'정답 확인하기').click();if(advance)await webButton(page,run.index+1===run.questions.length?'결과 확인하기':'다음 문제').click();
}
export async function webLogin(page,email,password='synthetic-only'){
 await page.getByLabel('이메일',{exact:true}).fill(email);await page.getByLabel('비밀번호',{exact:true}).fill(password);await webButton(page,'기존 계정으로 로그인').click();
 await page.waitForFunction(()=>window.webApp?.snapshot().auth.status==='member'&&window.webApp.snapshot().mounted);
}
export async function assertWebLayout(page){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'horizontal overflow');
 const small=await page.locator('button:visible,a:visible,input:visible').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height<43).map(n=>n.textContent));assert.deepEqual(small,[],'44px touch targets');
}
