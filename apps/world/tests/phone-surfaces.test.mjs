import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneSurface, createPhoneMapHistory } from '../src/phone/phone-surfaces.js';

test('existing modal moved out of inert World accepts input and returns to its original position', () => {
  const attrs=new Map([['aria-modal','true']]), sibling={}, element={inert:true,dataset:{},
    getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute(key){attrs.delete(key);if(key==='data-phone-hosted')delete this.dataset.phoneHosted;}};
  const world={insertBefore(node,next){assert.equal(next,sibling);node.parentNode=this;}}, host={append(node){node.parentNode=this;}};
  element.parentNode=world;element.nextSibling=sibling;sibling.parentNode=world;
  const surface=createPhoneSurface(element);surface.mount(host);
  assert.equal(element.inert,false);assert.equal(element.parentNode,host);assert.equal(attrs.has('aria-modal'),false);
  surface.restore();assert.equal(element.parentNode,world);assert.equal(element.inert,true);assert.equal(attrs.get('aria-modal'),'true');
  assert.equal(element.dataset.phoneHosted,undefined);
});

test('map presentation history preserves coordinates and keeps favorites scoped to the active account', () => {
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};let scope='guest';
  const history=createPhoneMapHistory({getStorage:()=>storage,getScope:()=>scope});
  const place=Object.freeze({poiId:'main-hall',title:'본관',x:13,z:72});
  history.toggle(place,'campus');history.remember(place,'campus');history.remember(place,'campus');
  assert.equal(history.snapshot().recent.length,1);assert.equal(history.snapshot().favorites[0].x,13);
  scope='member:test';history.load();assert.equal(history.snapshot().favorites.length,0);
  scope='guest';history.load();assert.equal(history.snapshot().favorites[0].poiId,'main-hall');
});

test('favorites add/remove are idempotent, survive readback and never change selection/navigation',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};let scope='guest';
  const history=createPhoneMapHistory({getStorage:()=>storage,getScope:()=>scope});
  const selected=Object.freeze({poiId:'poi.library',title:'도서관',x:1,z:2}),destination={...selected,id:'nav.library'};
  history.remember(destination,'campus');history.favorite(selected,'campus',true);history.favorite({...selected,title:'새 이름'},'campus',true);
  assert.equal(history.snapshot().favorites.length,1);assert.equal(history.has(selected,'campus'),true);
  history.load();assert.equal(history.has(selected,'campus'),true);history.favorite(selected,'campus',false);
  assert.equal(history.has(selected,'campus'),false);assert.equal(history.snapshot().favorites.length,0);
  history.favorite({poiId:'missing',x:8,z:9},'campus',false);assert.equal(history.snapshot().favorites.length,0);
  assert.equal(selected.poiId,'poi.library');assert.deepEqual(history.snapshot().recent[0].x,destination.x);
  history.load();assert.equal(history.snapshot().favorites.length,0);
  history.toggle(selected,'campus');scope='member:one';history.load();assert.equal(history.has(selected,'campus'),false);
  scope='guest';history.load();assert.equal(history.has(selected,'campus'),true);
  assert.equal(history.toggle({poiId:'invalid',x:NaN,z:0},'campus'),false);
});
test('map-picked locations use coordinate identity, legacy duplicates normalize without names as keys',()=>{
  let serialized=JSON.stringify({favorites:[{id:'same',poiId:'p',x:1,z:2,title:'A'},{id:'other',poiId:'p',x:1,z:2,title:'B'},null],recent:[]});
  const history=createPhoneMapHistory({getStorage:()=>({getItem:()=>serialized,setItem:(_,v)=>{serialized=v;}})});
  assert.equal(history.snapshot().favorites.length,1);
  history.favorite({poiId:'map.point',mapPoint:true,x:3,z:4},'campus',true);
  history.favorite({poiId:'map.point',mapPoint:true,x:6,z:7},'campus',true);
  assert.equal(history.snapshot().favorites.length,3);history.load();assert.equal(history.snapshot().favorites.length,3);
});
