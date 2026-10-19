import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createPhonePreferences,defaultPhonePreferences} from '../src/phone/phone-preferences.js';
import {STORE_PHONE_IDS,phoneIdForStore,storeIdForPhone,phoneStoreSnapshot,phoneStoreMutate,phoneStoreCanOpen} from '../src/phone/phone-store-integration.js';
import {PHONE_SYSTEM_APP_IDS,PHONE_INSTALLABLE_APP_IDS} from '../src/phone/phone-app-catalog.js';
const registry=[...PHONE_SYSTEM_APP_IDS,...PHONE_INSTALLABLE_APP_IDS].map(id=>({id,available:()=>true}));
function state(){
  let scope='account-a';const raw=new Map();
  const getStorage=()=>({getItem:k=>raw.get(k)||null,setItem:(k,v)=>raw.set(k,v)});
  const prefs=createPhonePreferences({getStorage,getScope:()=>scope});
  return {raw,prefs,setScope:v=>{scope=v;prefs.load();}};
}
test('all connected Store IDs map uniquely to real Phone IDs; pet demo is not Grow',()=>{
  const all=[...PHONE_SYSTEM_APP_IDS,...PHONE_INSTALLABLE_APP_IDS];
  assert.equal(Object.keys(STORE_PHONE_IDS).length,all.length);
  assert.deepEqual([...Object.values(STORE_PHONE_IDS)].sort(),[...all].sort());
  assert.equal(phoneIdForStore('induck-pet'),null);
  assert.equal(phoneIdForStore('__proto__'),null);
  assert.equal(phoneIdForStore('induck-grow'),'induck-grow');
  assert.equal(storeIdForPhone('maps'),'map');
  assert.equal(storeIdForPhone('induck-grow'),'induck-grow');
});
test('Phone snapshot is the sole installed, hidden and dock authority',()=>{
  const {prefs}=state();
  assert.equal(phoneStoreMutate(prefs,'install','induck-classic'),true);
  assert.equal(prefs.save(),true);
  const a=phoneStoreSnapshot(prefs,registry);
  assert.ok(a.systemIds.includes('store'));
  assert.ok(a.installedApps.includes('induck-classic'));
  assert.deepEqual(a.dockIds.slice(0,2),['map','camera']);
  assert.ok(a.homeIds.includes('induck-classic'));
  assert.equal(a.homeIds.includes('induck-pet'),false);
  assert.equal(phoneStoreCanOpen(registry,prefs,'induck-classic'),true);
  assert.equal(phoneStoreMutate(prefs,'pin','induck-classic'),true);
  assert.ok(phoneStoreSnapshot(prefs,registry).hiddenApps.includes('induck-classic'));
  assert.equal(phoneStoreMutate(prefs,'pin','induck-classic'),true);
  assert.equal(phoneStoreSnapshot(prefs,registry).hiddenApps.includes('induck-classic'),false);
  assert.equal(phoneStoreMutate(prefs,'uninstall','induck-classic'),true);
  assert.equal(phoneStoreCanOpen(registry,prefs,'induck-classic'),false);
});
test('core apps cannot be uninstalled; store cannot be hidden; demos cannot mutate Phone',()=>{
  const {prefs}=state();
  assert.equal(phoneStoreMutate(prefs,'uninstall','map'),false);
  assert.equal(phoneStoreMutate(prefs,'install','messages'),false);
  assert.equal(phoneStoreMutate(prefs,'pin','store'),false);
  assert.equal(phoneStoreMutate(prefs,'install','induck-talk'),false);
  assert.equal(phoneStoreMutate(prefs,'install','induck-pet'),false);
  assert.deepEqual(prefs.snapshot().installedApps,[]);
  const blocked=registry.map(a=>a.id==='daily-quiz'?{...a,available:()=>false}:a);
  assert.equal(phoneStoreCanOpen(blocked,prefs,'daily-quiz'),false);
  assert.equal(phoneStoreCanOpen(blocked,prefs,'map'),true);
  assert.equal(phoneStoreCanOpen(blocked,prefs,'__proto__'),false);
});
test('saved settings survive account switch; no cross-account installation claims',()=>{
  const a=state();
  a.prefs.install('induckup');a.prefs.hide('messages');assert.equal(a.prefs.save(),true);
  a.setScope('account-b');
  assert.equal(a.prefs.snapshot().installedApps.length,0);
  assert.equal(a.prefs.snapshot().hiddenApps.includes('messages'),false);
  a.prefs.install('induck-survival');assert.equal(a.prefs.save(),true);
  a.setScope('account-a');
  assert.deepEqual(a.prefs.snapshot().installedApps,['induckup']);
  assert.equal(a.prefs.snapshot().hiddenApps.includes('messages'),true);
  assert.equal(a.prefs.snapshot().installedApps.includes('induck-survival'),false);
});
test('storage failure can be rolled back by owner without phantom install',()=>{
  const raw=new Map();let block=false;
  const prefs=createPhonePreferences({getScope:()=> 'test',getStorage:()=>({
    getItem:k=>raw.get(k)||null,setItem:(k,v)=>{if(block)throw Error('quota');raw.set(k,v);}
  })});
  assert.equal(prefs.snapshot().installedApps.length,0);
  block=true;assert.equal(phoneStoreMutate(prefs,'install','induckup'),true);
  assert.equal(prefs.save(),false);
  prefs.load();assert.deepEqual(prefs.snapshot().installedApps,[]);
  assert.equal(phoneStoreCanOpen(registry,prefs,'induckup'),false);
  block=false;assert.equal(phoneStoreMutate(prefs,'install','induckup'),true);
  assert.equal(prefs.save(),true);
  prefs.load();assert.deepEqual(prefs.snapshot().installedApps,['induckup']);
});

// The child rejects the entire sync envelope when even an unavailable native ID is unknown.
test('embedded Store receiver accepts the complete parent ID map, including gated learning',async()=>{
  const html=await readFile(new URL('../campus/induck-store-v0.2.1.html',import.meta.url),'utf8');
  const body=html.match(/const PHONE_MANAGED=Object\.freeze\((\{[\s\S]*?\})\);/)[1];
  const child=JSON.parse(JSON.stringify(runInNewContext('('+body+')')));
  assert.deepEqual(child,STORE_PHONE_IDS);
  const {prefs}=state();
  for(const enabled of [false,true]){
    const snapshot=phoneStoreSnapshot(prefs,registry.map(a=>a.id==='learning'?{...a,available:()=>enabled}:a));
    for(const values of Object.values(snapshot))assert.ok(values.every(id=>Object.hasOwn(child,id)));
    assert.equal(snapshot.availableIds.includes('learning'),enabled);
  }
});
