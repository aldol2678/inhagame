import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneGesture, createPhoneMotion } from '../src/phone/phone-motion.js';
import { createPhonePreferences } from '../src/phone/phone-preferences.js';

test('paging is HOME-only, horizontal and bounded by intent threshold',()=>{
  assert.equal(phoneGesture({state:'HOME',dx:-80,dy:12}),'next');
  assert.equal(phoneGesture({state:'HOME',dx:80,dy:12}),'previous');
  for(const state of ['APP','HOME_EDIT','CLOSED','CAMERA'])assert.equal(phoneGesture({state,dx:90,dy:0}),null);
  assert.equal(phoneGesture({state:'HOME',dx:30,dy:0}),null);
  assert.equal(phoneGesture({state:'HOME',dx:60,dy:90}),null);
});
test('notification swipes require explicit handle and direction',()=>{
  assert.equal(phoneGesture({state:'HOME',handle:'open',dx:1,dy:60}),'notifications');
  assert.equal(phoneGesture({state:'HOME',dx:1,dy:60}),null);
  assert.equal(phoneGesture({state:'APP',handle:'close',dx:1,dy:-60}),'dismiss');
  assert.equal(phoneGesture({state:'APP',handle:'open',dx:1,dy:60}),null);
  assert.equal(phoneGesture({state:'APP',handle:'close',dx:80,dy:-60}),null);
});
test('motion cancels pending animations and listens for reduced-motion changes',async()=>{
  let cancel=0,listener,removed;
  const media={matches:false,addEventListener:(_,fn)=>listener=fn,removeEventListener:(_,fn)=>removed=fn};
  const motion=createPhoneMotion({win:{matchMedia:()=>media}});
  let reject;const node={animate:()=>({finished:new Promise((_,no)=>reject=no),cancel(){cancel++;reject(Error('cancel'));}})};
  const finished=motion.play(node,[]);listener();await finished;assert.equal(cancel,1);
  media.matches=true;await motion.play({animate(){throw Error('must not animate');}},[]);
  motion.destroy();assert.equal(removed,listener);
});
function fixture(fail=false){const map=new Map();return createPhonePreferences({getScope:()=> 'user-a',getStorage:()=>({getItem:k=>map.get(k),setItem:(k,v)=>{if(!fail)map.set(k,v);}})});}
test('hide commits verified persistence and restore preserves installed app authority',()=>{
  const p=fixture();const id=p.snapshot().pages[0][0];
  assert.equal(p.commit(()=>p.hide(id)),true);assert.ok(p.snapshot().hiddenApps.includes(id));
  p.load();assert.ok(p.snapshot().hiddenApps.includes(id));
  assert.equal(p.commit(()=>p.show(id)),true);assert.ok(p.snapshot().pages.flat().includes(id));
  assert.equal(p.commit(()=>p.hide('induck-store')),false);
  assert.equal(p.commit(()=>p.hide('not-installed')),false);
});
test('failed readback rolls back hide and Dock placement before visual success',()=>{
  const p=fixture(true),before=p.snapshot();
  assert.equal(p.commit(()=>p.hide('album')),false);assert.deepEqual(p.snapshot(),before);
  assert.equal(p.commit(()=>p.unpin('maps')),false);assert.deepEqual(p.snapshot(),before);
});
test('Dock unpin uses free Home slot and never hides or uninstalls',()=>{
  const p=fixture(),before=p.snapshot();
  assert.equal(p.commit(()=>p.unpin('maps')),true);
  const after=p.snapshot();assert.equal(after.dock.includes('maps'),false);assert.ok(after.pages.flat().includes('maps'));
  assert.deepEqual(after.hiddenApps,before.hiddenApps);assert.deepEqual(after.installedApps,before.installedApps);
  p.load();assert.deepEqual(p.snapshot(),after);
});
test('Dock unpin creates a page when Home is full without evicting another app',()=>{
  const p=fixture();for(const id of ['induck-classic','induckup','induck-survival','induck-grow'])p.install(id);
  assert.equal(p.snapshot().pages[0].filter(Boolean).length,12);
  const before=p.snapshot();assert.equal(p.commit(()=>p.unpin('maps')),true);
  assert.equal(p.snapshot().pages.length,2);assert.equal(p.snapshot().pages[1][0],'maps');
  assert.deepEqual(p.snapshot().pages[0],before.pages[0]);assert.deepEqual(p.snapshot().installedApps,before.installedApps);
});
test('hiding installed external shortcuts keeps installation on reload and across restore',()=>{
  const p=fixture();p.install('induck-grow');assert.equal(p.commit(()=>p.hide('induck-grow')),true);p.load();
  assert.ok(p.snapshot().installedApps.includes('induck-grow'));assert.ok(p.snapshot().hiddenApps.includes('induck-grow'));
  assert.equal(p.commit(()=>p.show('induck-grow')),true);p.load();assert.ok(p.snapshot().pages.flat().includes('induck-grow'));
});
