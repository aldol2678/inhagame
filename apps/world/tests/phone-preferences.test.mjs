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
