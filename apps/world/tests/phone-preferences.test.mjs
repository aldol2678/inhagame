import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPhonePreferences, normalizePhonePreferences, movePhoneApp, createPhonePreferences } from '../src/phone/phone-preferences.js';
test('slot migration deduplicates dock/home and installs new app without resetting placements', () => {
  const p = defaultPhonePreferences(); p.pages[0][7]='album'; p.pages[0][1]=null; p.dock[2]='maps';
  const next=normalizePhonePreferences(p,['student-id','maps','camera','album','settings','new']);
  assert.equal(next.pages[0][7],'album'); assert.equal(next.pages[0][1],'new');
  assert.equal([...next.pages.flat(),...next.dock].filter(x=>x==='maps').length,1); assert.equal(next.dock.length,4);
});
test('pointer/keyboard moves swap stable slots across dock without duplicates', () => {
  let p=movePhoneApp(defaultPhonePreferences(),'album',{area:'dock',slot:0});
  assert.equal(p.dock[0],'album'); assert.equal(p.pages[0][1],'maps');
  p=movePhoneApp(p,'student-id',{area:'home',page:0,slot:9}); assert.equal(p.pages[0][9],'student-id');
  assert.deepEqual(movePhoneApp(p,'camera',{area:'dock',slot:9}),p);
});
test('preferences are scoped and readback failures are exposed', () => {
  let scope='a'; const map=new Map(),errors=[];
  const p=createPhonePreferences({getScope:()=>scope,getStorage:()=>({getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)}),onError:e=>errors.push(e)});
  p.wallpaper({type:'default',id:'night'}); assert.equal(p.save(),true); scope='b';p.load(); assert.equal(p.snapshot().wallpaper.id,'campus');
  scope='a';p.load();assert.equal(p.snapshot().wallpaper.id,'night');
  const failed=createPhonePreferences({getScope:()=>scope,getStorage:()=>({setItem(){},getItem(){return null;}}),onError:e=>errors.push(e)});
  failed.wallpaper({type:'default',id:'night'});assert.equal(failed.save(),false);assert.ok(errors.length);
});

test('MENU-01 installs two Daily apps into old layouts without erasing existing preferences', () => {
  const legacy = defaultPhonePreferences();
  legacy.dock = ['maps','camera',null,null];
  legacy.pages[0][7] = 'album'; legacy.pages[0][1] = null;
  const next = normalizePhonePreferences(legacy);
  const ids = [...next.pages.flat(), ...next.dock].filter(Boolean);
  assert.equal(ids.filter(id => id === 'daily-quiz').length, 1);
  assert.equal(ids.filter(id => id === 'attendance').length, 1);
  assert.equal(next.pages[0][7], 'album');
  assert.deepEqual(next.dock, ['maps','camera',null,null]);
  assert.equal(next.wallpaper.id, 'campus');
  assert.deepEqual(normalizePhonePreferences(next), next, 'reloading the same layout must be stable');
});

test('MENU-02A installs messages exactly once while preserving existing Home, Dock and wallpaper', () => {
  const old=defaultPhonePreferences();
  old.pages[0][10]='attendance';old.pages[0][8]='daily-quiz';
  const normalized=normalizePhonePreferences(old);
  const ids=[...normalized.pages.flat(),...normalized.dock].filter(Boolean);
  assert.equal(ids.filter(x=>x==='messages').length,1);
  assert.equal(ids.filter(x=>x==='attendance').length,1);
  assert.equal(ids.filter(x=>x==='daily-quiz').length,1);
  assert.deepEqual(normalized.dock,['maps','camera',null,null]);
  assert.equal(normalized.wallpaper.id,'campus');
  assert.deepEqual(normalizePhonePreferences(normalized),normalized);
});
