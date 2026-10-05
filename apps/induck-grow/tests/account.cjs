const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','account.js'),'utf8');
const elements=new Map(),storage=new Map();
function el(id){if(!elements.has(id))elements.set(id,{
  hidden:false,open:false,disabled:false,textContent:'',value:'',handlers:{},
  elements:{email:{value:'a@inhagame.example',reportValidity:()=>true},password:{value:'password'},code:{value:'123456'}},
  querySelector(){return {disabled:false}},addEventListener(event,fn){this.handlers[event]=fn}
});return elements.get(id)}
const id='00000000-0000-0000-0000-000000000001',person={id,email:'a@inhagame.example'};
const guest='induck-grow-p0',account=guest+'-account-'+id;
storage.set(guest,JSON.stringify({week:5,phase:'semester',department:'cse'}));
let remote=null,revision=null,seq=0;
const client={auth:{onAuthStateChange(){},async getUser(){return {data:{user:null},error:{name:'AuthSessionMissingError'}}},
  async signInWithPassword(){return {data:{user:person},error:null}},async signOut(){return {error:null}}},
  async rpc(name,args){
    if(name==='get_my_game_progress')return {data:remote?[{progress:remote,updated_at:revision}]:[],error:null};
    if(name==='save_my_grow_progress'){
      if(args.p_expected_updated_at!==revision)return {error:{message:'GROW_SAVE_CONFLICT'}};
      remote=JSON.parse(JSON.stringify(args.p_progress));revision='revision-'+(++seq);return {data:revision,error:null};
    }
    if(name==='delete_my_grow_progress'){
      if(args.p_expected_updated_at!==revision)return {error:{message:'GROW_SAVE_CONFLICT'}};
      remote=null;revision=null;return {data:true,error:null};
    }
    throw Error(name);
  }};
const context={console,JSON,Object,Array,Set,Map,setTimeout,confirm:()=>true,
  location:{origin:'https://grow.inhagame.example'},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  document:{getElementById:el},supabase:{createClient:()=>client},growSaveKey:guest,state:null,
  switchGrowSaveKey(key){context.growSaveKey=key;context.state=null},show(){},updateSavePill(){}};
context.window=context;
vm.runInNewContext(code,context,{timeout:3000});
const click=id=>el(id).handlers.click(),tick=()=>new Promise(resolve=>setTimeout(resolve,15));
(async()=>{
  await tick();assert.equal(context.growSaveKey,guest);
  await el('grow-password-form').handlers.submit({preventDefault(){},currentTarget:el('grow-password-form')});
  assert.equal(context.growSaveKey,account,el('grow-account-status').textContent);assert.equal(storage.get(account),undefined);
  click('grow-import-guest');await tick();
  assert.equal(remote.week,5);assert.equal(JSON.parse(storage.get(guest)).week,5);
  storage.set(account,JSON.stringify({...remote,week:6}));
  await context.InduckGrowAccount.queueSave();assert.equal(remote.week,6);
  remote={...remote,week:8};revision='revision-other-device';
  storage.set(account,JSON.stringify({...remote,week:7}));
  await context.InduckGrowAccount.queueSave();
  assert.equal(remote.week,8);assert.equal(context.InduckGrowAccount.connected(),false);
  click('grow-use-cloud');await tick();
  assert.equal(JSON.parse(storage.get(account)).week,8);
  assert.equal(JSON.parse(storage.get(guest)).week,5);
  await click('grow-sign-out');await tick();
  assert.equal(context.growSaveKey,guest);assert.equal(JSON.parse(storage.get(account)).week,8);
  // The cloud was deleted elsewhere; a stale local save must not resurrect it on login.
  remote=null;revision=null;
  await el('grow-password-form').handlers.submit({preventDefault(){},currentTarget:el('grow-password-form')});
  assert.equal(context.InduckGrowAccount.connected(),false);
  assert.equal(remote,null);
  click('grow-use-cloud');await tick();
  assert.equal(storage.get(account),undefined);
  assert.equal(JSON.parse(storage.get(guest)).week,5);
  console.log('Account import, sync CAS conflict, cloud selection, guest isolation PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
