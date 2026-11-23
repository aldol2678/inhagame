import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {realEngine,waitReady,ENGINE_AVAILABLE} from './helpers/inkyung-daily-environment.mjs';
import {createInputFocusManager,INPUT_FOCUS_POLICY} from '../src/input/input-focus-manager.js';
import {createInputFocusOwner} from '../src/input/input-focus-owner.js';
import {selectContextAction} from '../src/context-action.js';
import {createInkyungDailyLayout} from '../src/inkyung-daily-layout.mjs';
const url=new URL('../src/inkyung-daily-npcs.mjs',import.meta.url);
const module=ENGINE_AVAILABLE&&existsSync(url)?await import(url):{};
const engineTest=(name,run)=>test(name,{skip:!ENGINE_AVAILABLE?'Set PLAYCANVAS_TEST_MODULE to PlayCanvas 2.22.4 for actual GLB/NullGraphicsDevice validation':false},run);
async function setup(extra={}){
 assert.equal(typeof module.createInkyungDailyNpcs,'function','official ambient app adapter is missing');
 const env=await realEngine(),layout=createInkyungDailyLayout(),focus=createInputFocusManager();
 const owner=createInputFocusOwner({manager:focus,ownerId:'inkyung-daily-dialogue',policy:INPUT_FOCUS_POLICY.BLOCKING_UI});
 let position={...layout.route[0],y:1.15},blocked=false;
 const layer=module.createInkyungDailyNpcs({...env,getPlayerPosition:()=>position,canInteract:()=>!blocked,onConversationChange:v=>v?owner.acquire():owner.release(),...extra});
 const tick=s=>{for(let i=0;i<Math.ceil(s/.05);i++){layer.update(.05,{visible:true,blocked});env.app.update(.05)}};
 const near=id=>{const a=layer.status().actors[id];position={x:a.x+.25,y:1.15,z:a.z}};
 return {...env,layer,layout,focus,tick,near,setPosition:p=>position=p,setBlocked:v=>blocked=v,dispose(){layer.destroy();env.app.destroy()}};
}
engineTest('real GLBs move and share canonical ground; dialogue brakes/hides phone then resumes without new camera/player',async()=>{
 const q=await setup();try{
 q.tick(.05);await waitReady(q.layer);assert.equal(q.layer.status().ready,true);
 assert.equal(q.root.children.length,1,'one isolated layer');assert.equal(q.app.root.findComponents('camera').length,0);
 q.tick(1);const a=q.layer.status().actors.phone;assert(a.speed>0);q.near('phone');
 const action=q.layer.getContextAction();assert(action.label.includes('휴대폰'));assert.equal(action.trigger(),true);
 assert.equal(q.focus.can('MOVEMENT'),false,'pending conversation owns input');
 q.tick(.8);assert.equal(q.layer.status().activeTalk,'phone');
 const model=q.root.findByName('INKYUNG-DAILY-PHONE');assert(model.anim);assert.equal(model.findByName('slot_hand_prop_phone').enabled,false);
 const stop=model.getPosition().clone();q.tick(.3);assert.deepEqual(model.getPosition(),stop);
 assert.equal(q.document.activeElement.id,'inkyung-daily-close');
 assert.notEqual(q.document.activeElement.focusOptions?.preventScroll,true);
 q.document.getElementById('inkyung-daily-close').fire('click');q.tick(.4);assert(q.focus.can('MOVEMENT'));
 assert.notDeepEqual(model.getPosition(),stop);assert(model.findByName('slot_hand_prop_phone').enabled);
 }finally{q.dispose()}
});
engineTest('retained action never retargets another NPC, revalidates range/permissions, and existing quest action wins',async()=>{
 const q=await setup();try{
 q.tick(.05);await waitReady(q.layer);q.near('call');const action=q.layer.getContextAction();assert(action.label.includes('통화'));
 q.near('bench');assert.equal(action.trigger(),false);assert.equal(q.layer.status().activeTalk,null);
 q.near('call');q.setBlocked(true);assert.equal(action.trigger(),false);q.setBlocked(false);
 const quest={id:'npc-talk',priority:300,distance:1};assert.equal(selectContextAction([action,quest]).id,'npc-talk');
 assert.equal(action.trigger(),true);q.tick(.5);assert.equal(q.layer.status().activeTalk,'call');
 q.document.fire('keydown',{key:'Escape'});q.tick(.1);assert.equal(q.layer.status().actors.call.state,'call');
 }finally{q.dispose()}
});
engineTest('bench waits for complete sit-stand; independent furniture does not rotate during dialogue',async()=>{
 const q=await setup();try{
 q.tick(.05);await waitReady(q.layer);q.tick(.6);q.near('bench');const before=q.root.findByName('Bench_Wood').getWorldTransform().clone();
 assert(q.layer.getContextAction().trigger());q.tick(.4);assert.equal(q.layer.status().activeTalk,null);assert.equal(q.layer.status().pendingTalk,'bench');
 q.tick(5);assert.equal(q.layer.status().activeTalk,'bench');
 assert.deepEqual(q.root.findByName('Bench_Wood').getWorldTransform(),before);
 q.layer.closeConversation();q.tick(.1);assert.equal(q.layer.status().actors.bench.state,'bench');
 }finally{q.dispose()}
});
engineTest('room/lobby suppression and other UI cancellation release pending input, hide actors and never offer stale talk',async()=>{
 const q=await setup();try{
 q.tick(.05);await waitReady(q.layer);q.near('bench');const retained=q.layer.getContextAction();retained.trigger();assert(!q.focus.can('MOVEMENT'));
 q.layer.update(.05,{visible:false,blocked:true});assert(q.focus.can('MOVEMENT'));assert.equal(q.root.children[0].enabled,false);assert.equal(retained.trigger(),false);
 assert.equal(q.layer.getContextAction(),null);q.tick(.1);q.near('call');assert(q.layer.getContextAction().trigger());q.setBlocked(true);q.tick(.1);
 assert.equal(q.layer.status().activeTalk,null);assert(q.focus.can('MOVEMENT'));
 }finally{q.dispose()}
});
engineTest('far/lobby state never loads assets; failed assets leave campus usable and no invisible targets',async()=>{
 let loads=0;const q=await setup({loadAsset:async()=>{loads++;throw new Error('missing GLB')}});try{
 q.setPosition({x:0,y:1.15,z:0});q.layer.update(.1,{visible:true,blocked:false});assert.equal(loads,0);
 q.setPosition({...q.layout.call,y:1.15});q.layer.update(.1,{visible:false,blocked:false});assert.equal(loads,0);
 q.tick(.05);await waitReady(q.layer);assert.equal(q.layer.status().ready,false);assert.equal(q.layer.getContextAction(),null);assert(q.focus.can('MOVEMENT'));assert.equal(q.root.children.length,0);
 }finally{q.dispose()}
});
engineTest('late asset completion after destroy cannot resurrect the layer or input listeners',async()=>{
 const releases=[];const q=await setup({loadAsset:()=>new Promise(resolve=>releases.push(resolve))});try{
 q.tick(.05);q.layer.destroy();for(const release of releases)release(null);await new Promise(r=>setTimeout(r,0));assert.equal(q.layer.status().loading,false);assert.equal(q.root.children.length,0);assert(q.focus.can('MOVEMENT'));assert.equal(q.layer.getContextAction(),null);
 }finally{q.dispose()}
});

engineTest('reflected official campus frame maps local gameplay positions to rendered north with grounded fixed bench',async()=>{
 const q=await setup();try{
 q.tick(.05);await waitReady(q.layer);q.tick(.5);
 for(const [id,name] of Object.entries({phone:'INKYUNG-DAILY-PHONE',call:'INKYUNG-DAILY-CALL',bench:'INKYUNG-DAILY-BENCH'})){
  const a=q.layer.status().actors[id],e=q.root.findByName(name),p=e.getPosition();
  assert(Math.abs(p.x-a.x)<.0001);assert(Math.abs(p.z+a.z)<.0001,`render ${id} must reflect canonical Z`);assert(Math.abs(p.y)<.0001);
 }
 const a=q.layer.status().actors.bench;
 for(const name of ['Bench_Wood','Bench_Metal']){const p=q.root.findByName(name).getPosition();assert(Math.abs(p.z+a.z)<1,'bench stays with reflected actor');assert(Math.abs(p.x-a.x)<1);}
 }finally{q.dispose()}
});

engineTest('shared host action focus restores after HUD refresh, but cancellation by another UI never steals focus',async()=>{
 const q=await setup();try{
 q.tick(.05);await waitReady(q.layer);q.near('call');const host=q.document.createElement('button');host.id='context-action';q.document.body.append(host);host.focus();
 q.layer.getContextAction().trigger();q.tick(.1);host.hidden=true;
 q.layer.closeConversation();q.tick(.05);assert.notEqual(q.document.activeElement,host);
 host.hidden=false;q.tick(.05);assert.equal(q.document.activeElement,host,'restore after deferred host refresh');
 q.layer.getContextAction().trigger();q.tick(.1);const map=q.document.createElement('button');map.id='map-close';map.focus();q.setBlocked(true);q.tick(.1);assert.equal(q.document.activeElement,map);
 }finally{q.dispose()}
});
engineTest('dialog labels are filled before focus and live text is not rewritten on every animation frame',async()=>{
 const q=await setup();try{
 q.tick(.05);await waitReady(q.layer);q.near('call');const close=q.document.getElementById('inkyung-daily-close');let atFocus='';const focus=close.focus.bind(close);
 close.focus=(...args)=>{atFocus=q.document.getElementById('inkyung-daily-speaker').textContent;focus(...args)};
 q.layer.getContextAction().trigger();assert.equal(atFocus,'통화 중인 학생');q.tick(.5);
 const line=q.document.getElementById('inkyung-daily-line');let writes=0,value=line.textContent;
 Object.defineProperty(line,'textContent',{get:()=>value,set:v=>{writes++;value=v},configurable:true});q.tick(1);assert.equal(writes,0,'stable aria-live text does not reannounce');
 }finally{q.dispose()}
});
