import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from './support/fake-dom.mjs';
import { BACKGATE_TRANSIT as A, BACKGATE_TRANSIT_SOURCE_ANCHOR, BACKGATE_TRANSIT_COLLIDERS, BACKGATE_TRANSIT_WALK_GUIDE, transitRoadLocal, inTransitSidewalk } from '../src/transit/backgate-transit-layout.js';
import { fillBackgateTransit } from '../src/transit/backgate-transit-geometry.js';
import { createBackgateTransitInteraction } from '../src/transit/backgate-transit-interaction.js';
import { createBackgateTransitPanel } from '../src/transit/backgate-transit-panel.js';
import { canOccupy, moveAroundObstacles } from '../src/world-collision.js';
import { OBSTACLES } from '../src/campus-layout.js';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { WALK_SHAPE, PLAYER_ORIGIN_Y } from '../src/player-dimensions.js';
import { BACK_SEGMENTS } from '../src/back-gate-layout.js';
import { BACK_APPROACH_SEGMENTS } from '../src/back-approach-layout.js';
import { selectContextAction, createContextActionController } from '../src/context-action.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createInputFocusOwner } from '../src/input/input-focus-owner.js';

const at=p=>({...p,y:PLAYER_ORIGIN_Y+roadviewGroundHeight(p.x,p.z)});
function samples(route,step=.025) {
  const out=[];
  for(let j=1;j<route.length;j++){
    const a=route[j-1],b=route[j],n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/step);
    for(let i=0;i<=n;i++)out.push({x:a.x+(b.x-a.x)*i/n,z:a.z+(b.z-a.z)*i/n});
  }
  return out;
}
test('source stays separate from the physical pole; actual grounding and full world collision are clear',()=>{
  assert.ok(Math.abs(BACKGATE_TRANSIT_SOURCE_ANCHOR.x-111.798063)<1e-5);
  assert.ok(Math.abs(BACKGATE_TRANSIT_SOURCE_ANCHOR.z-113.042070)<1e-5);
  assert.equal(A.interactionRadius,1.75);
  assert.equal(A.gameStatus,'COMING_SOON');
  for(const p of [A.wait,A.boarding,A.busCenter]) {
    assert.equal(roadviewGroundHeight(p.x,p.z),0);
    assert.equal(canOccupy(at(p)),true);
  }
  assert.equal(canOccupy(at(A.pole)),false,'the visible pole has an always-resident collider');
  assert.ok(OBSTACLES.includes(BACKGATE_TRANSIT_COLLIDERS[0]));
  const sourceLocal=transitRoadLocal(BACKGATE_TRANSIT_SOURCE_ANCHOR);
  assert.ok(sourceLocal.v < A.sidewalk.minV);
  assert.equal(inTransitSidewalk(A.wait),true);
  assert.equal(inTransitSidewalk(A.busCenter),false);
});
test('walk guide sweeps through the full live obstacle set without relocating street furniture',()=>{
  const path=samples(BACKGATE_TRANSIT_WALK_GUIDE);let current=at(path[0]);
  for(const p of path) {
    assert.equal(canOccupy(at(p)),true,`blocked ${JSON.stringify(p)}`);
    const moved=moveAroundObstacles(current,p.x-current.x,p.z-current.z);
    assert.ok(Math.hypot(moved.x-p.x,moved.z-p.z)<.001,`sweep stopped at ${JSON.stringify(p)}`);
    current={...at(p),...moved};
  }
  assert.ok(path.length>1000);
});
test('connector geometry has upward flat faces and never covers an existing road interior',()=>{
  const tris=[];const boxes=[];
  fillBackgateTransit({triangle:(color,...pts)=>tris.push({color,pts}),quad:(color,a,b,c,d)=>{tris.push({color,pts:[a,b,c]},{color,pts:[a,c,d]});},box:(...args)=>boxes.push(args)});
  assert.ok(tris.length>5);assert.equal(boxes.length,4);
  const masks=[...BACK_SEGMENTS,...BACK_APPROACH_SEGMENTS];
  for(const {color,pts} of tris) {
    const [a,b,c]=pts;const up=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    assert.ok(up>=-1e-8,'pavement normals point upward');
    assert.ok(pts.every(p=>p[1]===a[1]),'flat, no raised curb');
    if(color!=='#9aa69a')continue;
    for(let i=0;i<=5;i++)for(let j=0;j<=5-i;j++) {
      const p={x:a[0]+(b[0]-a[0])*i/5+(c[0]-a[0])*j/5,z:a[2]+(b[2]-a[2])*i/5+(c[2]-a[2])*j/5};
      for(const mask of masks) {
        const {u,v}=transitRoadLocal(p,mask.frame);
        assert.ok(!(u>1e-6&&u<mask.frame.length-1e-6&&Math.abs(v)<mask.road.width/2-1e-6),'no asphalt overlay');
      }
    }
  }
});
function interactionHarness() {
  let p=at(A.wait),s={grounded:true,blocked:false},opens=0;
  const world=createBackgateTransitInteraction({getPosition:()=>p,getState:()=>s,getGroundHeight:roadviewGroundHeight,openPanel:()=>{opens++;return true;}});
  return {world,set:(position,state)=>{p=position;s=state;},opens:()=>opens};
}
test('stop information accepts walking guests, excludes road/air/mount/modal states, and rechecks stale triggers',()=>{
  const h=interactionHarness(),action=h.world.observe(at(A.wait),{grounded:true,blocked:false});
  assert.equal(action.shortcut,'F');assert.equal(action.trigger(),true);assert.equal(h.opens(),1);
  assert.equal(selectContextAction([action,{id:'npc',priority:300}]).id,'npc');
  assert.equal(selectContextAction([action,{id:'follow',priority:200}]).id,'follow');
  for(const [p,s] of [[at(A.busCenter),{grounded:true,blocked:false}],[at(A.wait),{grounded:false,blocked:false}],[at(A.wait),{grounded:true,blocked:true}],[{...at(A.wait),y:8},{grounded:true,blocked:false}],[at(A.wait),{}],[{x:NaN,y:1.15,z:0},{grounded:true,blocked:false}]]) {
    h.set(p,s);assert.equal(h.world.observe(p,s),null);assert.equal(action.trigger(),false);
  }
  assert.equal(h.opens(),1);
});
test('PC shared trigger and touch click open the same preparation-only panel; focus and Escape/Tab work',()=>{
  const doc=createFakeDocument(),panel=doc.createElement('section'),button=doc.createElement('button');
  button.removeAttribute=k=>delete button.attributes[k];
  const manager=createInputFocusManager(),owner=createInputFocusOwner({manager,ownerId:'backgate-transit',policy:INPUT_FOCUS_POLICY.BLOCKING_UI});
  let player=at(A.wait);
  const ui=createBackgateTransitPanel({panel,doc,onOpenChange:open=>open?owner.acquire():owner.release()});
  const world=createBackgateTransitInteraction({getPosition:()=>player,getState:()=>({grounded:true,blocked:!manager.can('WORLD_ACTION')}),getGroundHeight:roadviewGroundHeight,openPanel:()=>ui.setOpen(true)});
  for(const coarsePointer of [false,true]) {
    const slot=createContextActionController({button,shortcut:'F',coarsePointer});
    slot.set('backgate-transit',world.observe(player,{grounded:true,blocked:false}));slot.refresh();
    if(coarsePointer)button.click();else assert.equal(slot.trigger(),true);
    assert.equal(ui.open,true);assert.equal(manager.can('MOVE'),false);assert.equal(manager.can('WORLD_ACTION'),false);
    const disabled=panel.children[3].children[2];assert.equal(disabled.disabled,true);assert.equal(disabled.textContent,'준비중');
    assert.equal(ui.status().boardingEnabled,false);
    doc.dispatch('keydown',{code:'Tab'});assert.equal(doc.activeElement,panel.children[1]);
    doc.dispatch('keydown',{code:'Escape'});assert.equal(ui.open,false);assert.equal(manager.can('MOVE'),true);
    // Remove the old controller's handler before the second iteration in this lightweight fake DOM.
    button.listeners.set('click',[]);
  }
  ui.setOpen(true);const token=manager.claim('room-transition',INPUT_FOCUS_POLICY.SYSTEM_LOCK);
  ui.setOpen(false,{restoreFocus:false});assert.equal(manager.can('MOVE'),false,'closing the stop never releases another owner');
  manager.release(token);assert.equal(manager.can('MOVE'),true);
  ui.destroy();assert.equal(ui.setOpen(true),false);
});
