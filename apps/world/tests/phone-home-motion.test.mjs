import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmartphone } from '../src/phone/smartphone.js';
import { createInputFocusManager } from '../src/input/input-focus-manager.js';
import { FakeElement, createFakeDocument } from './support/fake-dom.mjs';
class Element extends FakeElement {
  click(){return this.dispatch('click',{stopImmediatePropagation(){this.stopped=true;}});}
  closest(selector){for(let n=this;n;n=n.parent){if(selector==='[data-app-id]'&&n.dataset.appId)return n;if(selector==='[data-slot]'&&n.dataset.slot!==undefined)return n;if(selector.split(',').some(s=>s.startsWith('.')&&n.className.split(' ').includes(s.slice(1))))return n;}return null;}
  removeAttribute(name){delete this.attributes[name];}
  removeEventListener(){}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
  prepend(...nodes){for(const n of nodes)n.parent=this;this.children.unshift(...nodes);}
  querySelectorAll(selector){const nodes=[];const match=n=>selector.split(',').some(s=>s.startsWith('.')?n.className.split(' ').includes(s.slice(1)):n.tagName===s.toUpperCase());const visit=n=>{for(const child of n.children){if(match(child))nodes.push(child);visit(child);}};visit(this);return nodes;}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  getClientRects(){return this.hidden?[]:[{}];}
  get isConnected(){return this.doc.body.contains(this);}
}
function rig(t,{fakeTimers=false}={}){
  const doc=createFakeDocument();doc.createElement=tag=>new Element(tag,doc);doc.body=doc.root=doc.createElement('body');doc.removeEventListener=()=>{};
  const timers=new Map();let timerId=0;const schedule=(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;};
  const data=new Map();let fail=false;const animations=[],listeners=new Map();
  const win={localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>{if(!fail)data.set(k,v);}},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);},setInterval:()=>1,clearInterval(){},setTimeout:fakeTimers?schedule:setTimeout,clearTimeout:fakeTimers?id=>timers.delete(id):clearTimeout,URL:{revokeObjectURL(){}}};
  const focus=createInputFocusManager();const phone=createSmartphone({doc,win,inputFocus:focus,photoMode:{subscribe:()=>()=>{}},getMap:()=>null,getSettings:()=>null,getIdentity:()=>null,getClient:()=>null,getProgression:()=>null,getCaptureContext:()=>({}),canOpen:()=>true});
  const button=label=>phone.root.querySelectorAll('button').find(n=>n.textContent===label||n.getAttribute('aria-label')===label);
  t.after(()=>phone.destroy());phone.open();phone.shell.edit();return {phone,doc,button,animations,focus,data,timers,runTimers:delay=>{for(const [id,timer] of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}},emit:type=>listeners.get(type)?.(),setFail:v=>fail=v};
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
test('hide prompts first, Escape cancels in edit, success persists before shrinking',async t=>{
  const r=rig(t);r.button('앨범 홈에서 숨기기').click();assert.equal(r.phone.status().preferences.hiddenApps.includes('album'),false);
  r.doc.dispatch('keydown',{code:'Escape',stopImmediatePropagation(){}});assert.equal(r.phone.status().state,'HOME_EDIT');assert.equal(r.button('숨기기 확인'),undefined);
  r.button('앨범 홈에서 숨기기').click();
  const icon=r.phone.root.querySelectorAll('button').find(n=>n.dataset.appId==='album');let shrink=false;
  icon.animate=()=>{shrink=true;assert.ok(r.phone.status().preferences.hiddenApps.includes('album'));assert.ok(JSON.parse([...r.data.values()].find(value=>JSON.parse(value).version===1)).hiddenApps.includes('album'),'persistent readback precedes animation');return {finished:Promise.resolve(),cancel(){}};};
  r.button('숨기기 확인').click();await flush();assert.equal(shrink,true);assert.equal(r.phone.root.querySelectorAll('button').some(n=>n.dataset.appId==='album'),false);
  assert.ok(r.button('🖼️ 앨범 다시 표시'));r.button('🖼️ 앨범 다시 표시').click();assert.equal(r.phone.status().preferences.hiddenApps.includes('album'),false);
});
test('failed hide never shrinks or loses layout; Dock unpin retains shortcut',async t=>{
  const r=rig(t),before=r.phone.status().preferences;r.setFail(true);r.button('앨범 홈에서 숨기기').click();
  const icon=r.phone.root.querySelectorAll('button').find(n=>n.dataset.appId==='album');icon.animate=()=>{throw Error('failed persistence must not animate');};
  r.button('숨기기 확인').click();await flush();assert.deepEqual(r.phone.status().preferences,before);
  r.setFail(false);r.button('지도 Dock에서 홈으로 이동').click();assert.equal(r.phone.status().preferences.dock.includes('maps'),false);assert.ok(r.phone.status().preferences.pages.flat().includes('maps'));
});
test('closing during shrink tears down synchronously and stale completion cannot reopen',async t=>{
  const r=rig(t);r.button('앨범 홈에서 숨기기').click();let reject,cancelled=0;
  const icon=r.phone.root.querySelectorAll('button').find(n=>n.dataset.appId==='album');icon.animate=()=>({finished:new Promise((_,no)=>reject=no),cancel(){cancelled++;reject(Error('cancel'));}});
  r.button('숨기기 확인').click();r.phone.close();assert.equal(r.phone.status().state,'CLOSED');assert.equal(r.phone.root.hidden,true);assert.equal(cancelled,1);
  r.phone.setAccount('different-user');await flush();assert.equal(r.phone.status().state,'CLOSED');assert.equal(r.phone.status().preferences.hiddenApps.includes('album'),false);
});
for(const event of ['pagehide','visibilitychange'])test(`${event} cancels shrinking and releases input without resurrection`,async t=>{
  const r=rig(t);r.button('앨범 홈에서 숨기기').click();let reject,cancelled=0;
  const icon=r.phone.root.querySelectorAll('button').find(n=>n.dataset.appId==='album');
  icon.animate=()=>({finished:new Promise((_,no)=>reject=no),cancel(){cancelled++;reject(Error('cancel'));}});
  r.button('숨기기 확인').click();
  if(event==='pagehide')r.emit(event);else {r.doc.hidden=true;r.doc.dispatch(event);}
  assert.equal(cancelled,1);assert.equal(r.phone.status().state,'CLOSED');assert.equal(r.focus.size,0);
  await flush();assert.equal(r.phone.status().state,'CLOSED');
});

function longpress(r){
  r.phone.shell.home();const icon=r.phone.root.querySelectorAll('button').find(n=>n.dataset.appId==='album');
  r.phone.root.dispatch('pointerdown',{target:icon,button:0,pointerId:17,pointerType:'touch',clientX:100,clientY:100});
  r.runTimers(550);assert.equal(r.phone.status().state,'HOME_EDIT');
}
for(const event of ['pointercancel','lostpointercapture'])test(`longpress then ${event} does not swallow next real click`,t=>{
  const r=rig(t,{fakeTimers:true});longpress(r);r.phone.root.dispatch(event,{pointerId:17});
  r.button('앨범').click();assert.equal(r.phone.root.querySelectorAll('button').find(n=>n.dataset.appId==='album').dataset.selected,'true');
  assert.equal(r.timers.size,0);
});
for(const kind of ['close','account','pagehide'])test(`longpress then ${kind} and reopen resets click suppression`,t=>{
  const r=rig(t,{fakeTimers:true});longpress(r);
  if(kind==='close')r.phone.close();else if(kind==='account')r.phone.setAccount('other-user');else r.emit('pagehide');
  r.phone.open();r.button('인덕스토어').click();assert.equal(r.phone.status().current.appId,'induck-store');assert.equal(r.timers.size,0);
});
test('completed drag suppresses its click after deliberate capture release; lifecycle clears reset timer',t=>{
  const r=rig(t,{fakeTimers:true});let capture=null;
  r.phone.root.setPointerCapture=id=>capture=id;r.phone.root.hasPointerCapture=id=>capture===id;
  r.phone.root.releasePointerCapture=id=>{capture=null;r.phone.root.dispatch('lostpointercapture',{pointerId:id});};
  longpress(r);r.doc.elementFromPoint=()=>null;r.phone.root.dispatch('pointerup',{pointerId:17,clientX:100,clientY:100});
  assert.equal(r.timers.size,1);const icon=r.button('앨범');let stopped=false;
  r.phone.root.dispatch('click',{target:icon,stopImmediatePropagation(){stopped=true;this.stopped=true;}});assert.equal(stopped,true);assert.equal(r.timers.size,0);
  longpress(r);r.phone.root.dispatch('pointerup',{pointerId:17,clientX:100,clientY:100});assert.equal(r.timers.size,1);
  r.phone.close();assert.equal(r.timers.size,0);r.phone.open();r.button('인덕스토어').click();assert.equal(r.phone.status().current.appId,'induck-store');
});
test('hidden-app summary participates in keyboard navigation rather than resetting the focus trap',async t=>{
  const r=rig(t);r.button('앨범 홈에서 숨기기').click();r.button('숨기기 확인').click();await flush();
  const summary=r.phone.root.querySelector('summary');assert.ok(summary);summary.focus();let prevented=false;
  r.doc.dispatch('keydown',{code:'Tab',target:summary,preventDefault(){prevented=true;}});
  assert.equal(prevented,false,'native Tab may continue from the disclosure to its restore button');
});
