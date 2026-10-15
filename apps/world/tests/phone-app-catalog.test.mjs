import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PHONE_SYSTEM_APPS,PHONE_EXTERNAL_APPS,PHONE_SYSTEM_APP_IDS,PHONE_INSTALLABLE_APP_IDS,
  phoneExternalApp,createPhoneAppRegistry} from '../src/phone/phone-app-catalog.js';
import {defaultPhonePreferences,normalizePhonePreferences,movePhoneApp,createPhonePreferences} from '../src/phone/phone-preferences.js';

function fakeStore() {
  const raw=new Map();
  return {raw,storage:{getItem:key=>raw.get(key)||null,setItem:(key,val)=>raw.set(key,val)}};
}

test('system catalog retains legacy IDs; external links are fixed, trusted, and non-executable until installed',()=>{
  const ids=PHONE_SYSTEM_APPS.map(app=>app.id);
  assert.deepEqual(ids.slice(0,9),['student-id','maps','camera','album','settings','daily-quiz','attendance','messages','notifications']);
  assert.equal(ids.at(-1),'induck-store');
  assert.equal(new Set([...ids,...PHONE_INSTALLABLE_APP_IDS]).size,ids.length+PHONE_EXTERNAL_APPS.length);
  for(const app of PHONE_EXTERNAL_APPS) {
    const url=new URL(app.url);
    assert.equal(url.protocol,'https:');
    assert.equal(url.hostname.endsWith('.inhagame.app'),true);
    assert.equal(url.search,'');
    assert.equal(url.hash,'');
    assert.equal(phoneExternalApp(app.id),app);
  }
  assert.equal(phoneExternalApp('https://malicious.example'),null);
  const registry=createPhoneAppRegistry([],()=>[]);
  assert.equal(registry.find(x=>x.id==='induck-store').available(),true);
  assert.equal(registry.find(x=>x.id==='induckup').available(),false);
});

test('v1 layout, Dock, wallpaper and student face migrate without silent install or reset',()=>{
  const legacy=defaultPhonePreferences();
  delete legacy.installedApps;
  legacy.pages[0][8]='messages';
  legacy.pages[0][2]=null;
  legacy.wallpaper={type:'default',id:'night'};
  legacy.studentIdFace='back';
  const migrated=normalizePhonePreferences(legacy);
  assert.equal(migrated.version,1);
  assert.deepEqual(migrated.installedApps,[]);
  assert.deepEqual(migrated.dock,legacy.dock);
  assert.equal(migrated.pages[0][8],'messages');
  assert.equal(migrated.wallpaper.id,'night');
  assert.equal(migrated.studentIdFace,'back');
  assert.equal(migrated.pages.flat().filter(x=>x==='induck-store').length,1);
  assert.equal(migrated.pages.flat().some(x=>PHONE_INSTALLABLE_APP_IDS.includes(x)),false);
  assert.deepEqual(normalizePhonePreferences(migrated),migrated);
});

test('free install, move, hide, restore, uninstall and reload preserve other apps',()=>{
  const {raw,storage}=fakeStore();
  const prefs=createPhonePreferences({getStorage:()=>storage,getScope:()=> 'acct-A'});
  prefs.wallpaper({type:'default',id:'mint'});
  assert.equal(prefs.install('induckup'),true);
  assert.equal(prefs.install('induckup'),true);
  assert.equal(prefs.install('unknown'),false);
  assert.equal(prefs.install('student-id'),false);
  assert.equal(prefs.save(),true);
  let state=prefs.snapshot();
  assert.deepEqual(state.installedApps,['induckup']);
  assert.equal(state.pages.flat().filter(x=>x==='induckup').length,1);
  assert.equal(state.wallpaper.id,'mint');
  let moved=movePhoneApp(state,'induckup',{area:'dock',slot:2});
  assert.equal(moved.dock[2],'induckup');
  assert.equal(moved.pages.flat().includes('induckup'),false);
  assert.equal(prefs.hide('induck-store'),false);
  assert.equal(prefs.hide('induckup'),true);
  state=prefs.snapshot();
  assert.equal(state.hiddenApps.includes('induckup'),true);
  assert.equal(state.pages.flat().includes('induckup'),false);
  assert.equal(prefs.save(),true);
  prefs.load();
  assert.equal(prefs.snapshot().hiddenApps.includes('induckup'),true);
  assert.equal(prefs.show('induckup'),true);
  assert.equal(prefs.snapshot().pages.flat().includes('induckup'),true);
  assert.equal(prefs.uninstall('induckup'),true);
  assert.equal(prefs.uninstall('induckup'),false);
  state=prefs.snapshot();
  assert.deepEqual(state.installedApps,[]);
  assert.equal(state.pages.flat().includes('induckup'),false);
  assert.equal(state.pages.flat().filter(x=>x==='album').length,1);
  assert.equal(prefs.save(),true);
  assert.ok(raw.size>0);
});

test('preferences are account-scoped, reject unknown installed shortcuts and preserve hidden system apps',()=>{
  const {storage}=fakeStore();
  let scope='alice';
  const prefs=createPhonePreferences({getStorage:()=>storage,getScope:()=>scope});
  assert.equal(prefs.hide('album'),true);
  assert.equal(prefs.install('induck-survival'),true);
  assert.equal(prefs.save(),true);
  scope='bob';prefs.load();
  assert.equal(prefs.snapshot().hiddenApps.includes('album'),false);
  assert.equal(prefs.snapshot().installedApps.length,0);
  scope='alice';prefs.load();
  assert.equal(prefs.snapshot().hiddenApps.includes('album'),true);
  assert.deepEqual(prefs.snapshot().installedApps,['induck-survival']);
  const bad=normalizePhonePreferences({...defaultPhonePreferences(),installedApps:['induckup','hack','induckup']});
  assert.deepEqual(bad.installedApps,['induckup']);
  assert.deepEqual(PHONE_SYSTEM_APP_IDS,PHONE_SYSTEM_APPS.map(x=>x.id));
});
