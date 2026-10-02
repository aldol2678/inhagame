// Shared hub entry script (apps/world/game-entry.js), which every game loads from inhagame.example.
// Each load() is one document; documents share the tab's sessionStorage like a real navigation.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','..','world','game-entry.js'),'utf8');
const HOSTS={classic:'duck.inhagame.example',induckup:'induckup.inhagame.example',survival:'survival.inhagame.example',campus:'inhagame.example'};
const ENTRY='3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const OTHER='9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function tab(){
  const store=new Map();
  const sessionStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))};
  const requests=[];
  let replies=[];
  let now=Date.parse('2026-09-25T10:00:00Z');
  const timers=[];
  function load(game,{query='',host=HOSTS[game]}={}){
    const location=new URL(`https://${host}/${query}`);
    const window={addEventListener(){}};
    let seq=0;
    const ctx=vm.createContext({
      window,location,sessionStorage,URL,JSON,Set,Array,
      Date:{now:()=>now},
      document:{currentScript:{dataset:{game}},readyState:'complete',getElementById:()=>null,addEventListener(){}},
      history:{state:null,replaceState:(_s,_t,url)=>{location.href=new URL(url,location).href;}},
      crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`},
      setTimeout:(fn)=>timers.push(fn),
      fetch:(url,init)=>{
        requests.push({url,init,body:JSON.parse(init.body)});
        const reply=replies.shift()??204;
        return reply==='network'?Promise.reject(new TypeError('offline')):Promise.resolve({status:reply,ok:reply>=200&&reply<300});
      }
    });
    vm.runInContext(source,ctx);
    return {api:window.InhaGameEntry,url:()=>location.href};
  }
  const settle=async()=>{for(let i=0;i<20;i++){await new Promise(r=>setImmediate(r));while(timers.length)timers.shift()();}};
  return {load,requests,store,settle,reply:(...r)=>{replies=r;},advance:ms=>{now+=ms;}};
}
const types=t=>t.requests.map(r=>r.body.event_type);

test('landing is sent once, confirmed, and not repeated by a new document in the same tab',async()=>{
  const t=tab();
  const home=t.load('induckup',{query:`?ih_entry=${ENTRY}`});
  assert.equal(home.url(),'https://induckup.inhagame.example/','ih_entry is removed from the URL');
  assert.equal(home.api.landing(),true);
  assert.equal(home.api.landing(),false);
  await t.settle();
  // InduckUp home -> ?play=campaign loads game-entry.js again and calls landing() then play().
  const campaign=t.load('induckup',{query:'?play=campaign&stage=1'});
  assert.equal(campaign.api.landing(),false,'confirmed landing is not re-sent');
  assert.equal(campaign.api.play(),true);
  await t.settle();
  assert.deepEqual(types(t),['game_landing','game_play_start']);
  for(const {url,init,body} of t.requests){
    assert.equal(url,'https://inhagame.example/api/hub-entry');
    assert.equal(init.method,'POST');
    assert.deepEqual(Object.keys(body).sort(),['entry_id','event_id','event_type','target']);
    assert.equal(body.entry_id,ENTRY);
    assert.equal(body.target,'induckup');
  }
  const again=t.load('induckup',{query:'?play=campaign&stage=2'});
  assert.equal(again.api.landing(),false);
  assert.equal(again.api.play(),false);
  await t.settle();
  assert.equal(t.requests.length,2,'a third document sends nothing');
});

test('409 (click or previous stage not stored yet) is still retried, then confirmed',async()=>{
  const t=tab();
  t.reply(409,409,204);
  t.load('survival',{query:`?ih_entry=${ENTRY}`}).api.landing();
  await t.settle();
  assert.deepEqual(types(t),['game_landing','game_landing','game_landing']);
  assert.equal(new Set(t.requests.map(r=>r.body.event_id)).size,1,'retries reuse the same event_id');
  assert.equal(t.load('survival').api.landing(),false,'confirmed after the successful retry');
});

test('409 retries stay bounded and an unconfirmed stage is sent again by the next document',async()=>{
  const t=tab();
  t.reply(409,409,409,409,409,409);
  t.load('survival',{query:`?ih_entry=${ENTRY}`}).api.play();
  await t.settle();
  assert.equal(t.requests.length,5,'one send plus four retries');
  t.reply(204);
  assert.equal(t.load('survival').api.play(),true);
  await t.settle();
  assert.equal(t.requests.length,6);
});

test('network failure is not retried in-page and is not treated as confirmed',async()=>{
  const t=tab();
  t.reply('network');
  t.load('classic',{query:`?ih_entry=${ENTRY}`}).api.landing();
  await t.settle();
  assert.equal(t.requests.length,1);
  assert.equal(t.load('classic').api.landing(),true,'at-least-once delivery is preserved');
});

test('a confirmed LOST first result keeps a later document from reporting a first clear',async()=>{
  const t=tab();
  const first=t.load('survival',{query:`?ih_entry=${ENTRY}`});
  first.api.landing();first.api.play();
  assert.equal(first.api.result(),true);
  await t.settle();
  // Survival restarts with location.reload(); the next run's result is not the first result.
  const reloaded=t.load('survival');
  assert.equal(reloaded.api.result(),false);
  assert.deepEqual(types(t),['game_landing','game_play_start','game_first_result']);
});

test('each game reports under its own host and target; wrong host or game stays inert',async()=>{
  for(const game of Object.keys(HOSTS)){
    const t=tab();
    const doc=t.load(game,{query:`?ih_entry=${ENTRY}`});
    assert.equal(doc.api.landing(),true,game);
    assert.equal(doc.api.play(),true,game);
    await t.settle();
    assert.deepEqual(t.requests.map(r=>[r.body.event_type,r.body.target]),[['game_landing',game],['game_play_start',game]]);
    const wrongHost=tab();
    assert.ok(!wrongHost.load(game,{query:`?ih_entry=${ENTRY}`,host:'localhost'}).api.landing());
    assert.equal(wrongHost.requests.length,0);
  }
});

test('stored entries do not leak across games, expire after 30 minutes, and reset on a new click',async()=>{
  const t=tab();
  t.load('survival',{query:`?ih_entry=${ENTRY}`}).api.landing();
  await t.settle();
  assert.ok(!t.load('induckup').api.landing(),'another game never reuses the entry');
  const fresh=t.load('survival',{query:`?ih_entry=${OTHER}`});
  assert.equal(fresh.api.landing(),true,'a new hub click starts a new entry');
  await t.settle();
  assert.deepEqual(t.requests.map(r=>r.body.entry_id),[ENTRY,OTHER]);
  t.advance(30*60*1000+1);
  assert.ok(!t.load('survival').api.play(),'expired entry is inert');
  assert.equal(t.requests.length,2);
});

test('no entry means no requests',async()=>{
  const t=tab();
  const doc=t.load('survival');
  assert.ok(!doc.api.landing(),'inert API');
  assert.equal(doc.api.result(),false);
  await t.settle();
  assert.equal(t.requests.length,0);
});
