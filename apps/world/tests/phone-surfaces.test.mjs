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
