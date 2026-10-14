import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectContextAction} from '../src/context-action.js';
import {createInputFocusManager,INPUT_FOCUS_POLICY} from '../src/input/input-focus-manager.js';
import {createInputFocusOwner} from '../src/input/input-focus-owner.js';
import {findSeat} from '../src/seat-anchors.js';
import {FISHING_SPOTS,FISHING_SPOT_RADIUS,FISHING_CONTEXT_PRIORITY} from '../src/activity/fishing-spots.js';
import {canObserveInkyungDucksFromShore,MECHANICAL_DUCK_CONTEXT_PRIORITY} from '../src/ambient-ducks-state.js';
import {INKYUNG_DOCK} from '../src/mounts/duck-boat-motion.js';
import {createWaterPathDefinition,validateWaterPath,waterPathMask} from '../src/minigames/games/water-path.js';
import {waterPathFlow,mountWaterPathPanel} from '../src/minigames/games/water-path-view.js';
import {createWaterPathSfx,WATER_PATH_CUES} from '../src/minigames/world/water-path-sfx.js';
import {
  createInkyungWaterPathInteraction,inkyungWaterPathAnchor,isInkyungWaterPathAnchorWalkable,
  waterPathBlockReason,WATER_PATH_BLOCK,INKYUNG_WATER_PATH_PRIORITY,INKYUNG_WATER_PATH_RADIUS,
  INKYUNG_WATER_PATH_OWNER_ID,INKYUNG_WATER_PATH_ACTION_ID,INKYUNG_WATER_PATH_SEED
} from '../src/minigames/world/inkyung-water-path-interaction.js';

// ---- Minimal DOM: just enough tree, bubbling, focus and query for the panel and adapter. ----
class FakeNode {
  constructor(tag,doc){
    this.tag=tag;this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parent=null;
    this.attributes={};this.style={};this.listeners={};this.disabled=false;this.hidden=false;
    this.textContent='';this.className='';this.id='';
  }
  append(...nodes){for(const n of nodes){n.parent?.children.splice(n.parent.children.indexOf(n),1);n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children.forEach(c=>{c.parent=null;});this.children=[];this.append(...nodes);}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]??[]).filter(x=>x!==fn);}
  remove(){
    if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
    if(this.ownerDocument.activeElement&&this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=null;
  }
  contains(node){for(let n=node;n;n=n.parent)if(n===this)return true;return false;}
  get isConnected(){return this.ownerDocument.body.contains(this);}
  querySelectorAll(selector){
    assert.equal(selector,'button');
    const out=[];const walk=n=>{for(const c of n.children){if(c.tag==='button')out.push(c);walk(c);}};walk(this);return out;
  }
  focus(){if(!this.disabled)this.ownerDocument.activeElement=this;}
  click(){if(!this.disabled)this.dispatch({type:'click'});}
  dispatch(event){
    event.target??=this;event.defaultPrevented=false;event.propagationStopped=false;
    event.preventDefault=()=>{event.defaultPrevented=true;};
    event.stopPropagation=()=>{event.propagationStopped=true;};
    for(let n=this;n&&!event.propagationStopped;n=n.parent)for(const fn of [...(n.listeners[event.type]??[])])fn(event);
    if(!event.propagationStopped)for(const fn of [...(this.ownerDocument.listeners[event.type]??[])])fn(event);
    return event;
  }
}
function makeDom(){
  const doc={listeners:{},activeElement:null,
    createElement(tag){return new FakeNode(tag,doc);},
    addEventListener(type,fn){(doc.listeners[type]??=[]).push(fn);},
    removeEventListener(type,fn){doc.listeners[type]=(doc.listeners[type]??[]).filter(x=>x!==fn);}};
  doc.body=new FakeNode('body',doc);
  const win={listeners:{},
    addEventListener(type,fn){(win.listeners[type]??=[]).push(fn);},
    removeEventListener(type,fn){win.listeners[type]=(win.listeners[type]??[]).filter(x=>x!==fn);},
    fire(type){for(const fn of [...(win.listeners[type]??[])])fn({type});}};
  return {doc,win};
}
const key=(target,code,extra={})=>target.dispatch({type:'keydown',code,...extra});
const keyed=(root,k)=>root.querySelectorAll('button').find(b=>b.getAttribute('data-focus-key')===k);

const anchor=inkyungWaterPathAnchor();
const GOOD={position:{x:anchor.x,z:anchor.z},insideRoom:false,inBiryong:false,lobbyActive:false,lobbyTransition:false,
  mounted:false,seated:false,swimming:false,grounded:true,combat:false,photoMode:false,roomTransition:false,
  cinematic:false,worldAction:true};

function harness(overrides={}){
  const {doc,win}=makeDom();
  const manager=createInputFocusManager();
  const focus=createInputFocusOwner({manager,ownerId:INKYUNG_WATER_PATH_OWNER_ID,policy:INPUT_FOCUS_POLICY.BLOCKING_UI});
  const live={...GOOD};
  const calls={pause:0,status:[]};
  const world=createInkyungWaterPathInteraction({
    doc,win,focus,subscribeFocus:l=>manager.subscribe(l),
    getContext:()=>({...live,worldAction:manager.can('WORLD_ACTION')}),
    pauseAutoMove:()=>{calls.pause++;},onStatus:m=>calls.status.push(m),...overrides
  });
  const panel=()=>doc.body.children.find(n=>n.id==='water-path-panel')??null;
  return {doc,win,manager,focus,live,calls,world,panel};
}
function assertReleased(h){
  assert.equal(h.focus.active,false);
  assert.equal(h.manager.size,0);
  assert.equal(h.manager.can('WORLD_ACTION'),true);
  assert.equal(h.manager.can('MOVE'),true);
  assert.equal(h.manager.can('CAMERA'),true);
  assert.equal(h.panel(),null);
  assert.equal(h.world.active,false);
  assert.equal(h.doc.listeners.keydown?.length??0,0,'document listener removed');
  assert.equal(h.doc.listeners.pointerup?.length??0,0,'pointer listener removed');
  assert.equal(h.win.listeners.resize?.length??0,0);
  assert.equal(h.win.listeners.orientationchange?.length??0,0);
}
// Brute-force the solved rotations of the adapter's puzzle, then click the real tile buttons.
function solveClicks(){
  const {size,tiles}=createWaterPathDefinition({size:3,seed:INKYUNG_WATER_PATH_SEED}).initialState;
  const movable=tiles.map((t,i)=>t.kind==='BLOCK'?-1:i).filter(i=>i>=0);
  const counts=new Array(movable.length).fill(0);
  for(;;){
    const trial={size,tiles:tiles.map(t=>({...t}))};
    movable.forEach((cell,i)=>{trial.tiles[cell].rotation=(tiles[cell].rotation+counts[i])&3;});
    if(validateWaterPath(trial).cleared)return movable.map((cell,i)=>({cell,n:counts[i]}));
    let i=0;while(i<counts.length&&++counts[i]===4)counts[i++]=0;
    assert.ok(i<counts.length,'puzzle has a solution');
  }
}

// ---- Anchor and priority ----
test('Anchor sits on a real walkable promenade point clear of every other pond action',()=>{
  assert.equal(INKYUNG_WATER_PATH_RADIUS,1.25);
  assert.equal(INKYUNG_WATER_PATH_PRIORITY,180);
  assert.equal(isInkyungWaterPathAnchorWalkable(),true);
  assert.equal(isInkyungWaterPathAnchorWalkable({x:NaN,z:0}),false);
  // A collider on the Anchor, or a point inside the pond, must refuse publication.
  const square=[{x:anchor.x-2,z:anchor.z-2},{x:anchor.x+2,z:anchor.z-2},{x:anchor.x+2,z:anchor.z+2},{x:anchor.x-2,z:anchor.z+2}];
  assert.equal(isInkyungWaterPathAnchorWalkable(anchor,{colliders:[{polygon:square}]}),false);
  assert.equal(isInkyungWaterPathAnchorWalkable(anchor,{ring:square}),false);
  assert.equal(isInkyungWaterPathAnchorWalkable({x:anchor.x+500,z:anchor.z}),false);
  const reach=INKYUNG_WATER_PATH_RADIUS;
  // Seat range, fishing radius and the duck-boat dock never overlap the 1.25 WU circle. The Anchor itself is
  // outside the 6 WU shore duck-observation band; only the pond-side rim of the circle touches it, and there
  // the higher-priority duck action (200) wins deterministically instead of sharing the F slot.
  for(const dx of [-reach,0,reach])for(const dz of [-reach,0,reach]){
    assert.equal(findSeat({x:anchor.x+dx,z:anchor.z+dz}),null,'no seat in range');
  }
  assert.equal(canObserveInkyungDucksFromShore(anchor),false,'no shore duck observation at the Anchor');
  for(const spot of FISHING_SPOTS)assert.ok(Math.hypot(spot.position.x-anchor.x,spot.position.z-anchor.z)>FISHING_SPOT_RADIUS+reach);
  assert.ok(Math.hypot(INKYUNG_DOCK.shore.x-anchor.x,INKYUNG_DOCK.shore.z-anchor.z)>4+reach);
});
test('Context Action priority ranks below seat, NPC, fishing and duck actions',()=>{
  assert.ok(INKYUNG_WATER_PATH_PRIORITY<FISHING_CONTEXT_PRIORITY);
  assert.ok(INKYUNG_WATER_PATH_PRIORITY<MECHANICAL_DUCK_CONTEXT_PRIORITY-40);
  const water={id:INKYUNG_WATER_PATH_ACTION_ID,priority:INKYUNG_WATER_PATH_PRIORITY,distance:0};
  for(const other of [{id:'seat',priority:260},{id:'npc',priority:300},{id:'inkyung-fishing',priority:FISHING_CONTEXT_PRIORITY,distance:9},
    {id:'inkyung-ordinary-duck',priority:MECHANICAL_DUCK_CONTEXT_PRIORITY-40,distance:9}]){
    assert.equal(selectContextAction([water,other]).id,other.id);
  }
  assert.equal(selectContextAction([water,{id:'guestbook',priority:150}]).id,INKYUNG_WATER_PATH_ACTION_ID);
});

// ---- Entry conditions ----
test('action publishes inside the radius and uses the shared F slot',()=>{
  const h=harness();
  const action=h.world.contextAction();
  assert.equal(action.id,INKYUNG_WATER_PATH_ACTION_ID);
  assert.equal(action.shortcut,'F');
  assert.equal(action.priority,180);
  assert.equal(action.pressed,false);
  assert.ok(action.label.length>0&&action.compactLabel.length>0);
  h.live.position={x:anchor.x+INKYUNG_WATER_PATH_RADIUS,z:anchor.z};
  assert.ok(h.world.contextAction(),'edge of the radius still enters');
  h.live.position={x:anchor.x+INKYUNG_WATER_PATH_RADIUS+0.01,z:anchor.z};
  assert.equal(h.world.contextAction(),null);
  assert.equal(h.world.contextAction({x:anchor.x,z:anchor.z})?.id,INKYUNG_WATER_PATH_ACTION_ID,'explicit frame position wins');
});
test('every blocked state hides the action and refuses a retained trigger',()=>{
  const cases={
    insideRoom:WATER_PATH_BLOCK.OUTSIDE_CAMPUS,inBiryong:WATER_PATH_BLOCK.OUTSIDE_CAMPUS,
    lobbyActive:WATER_PATH_BLOCK.OUTSIDE_CAMPUS,lobbyTransition:WATER_PATH_BLOCK.OUTSIDE_CAMPUS,
    mounted:WATER_PATH_BLOCK.MOUNTED,seated:WATER_PATH_BLOCK.SEATED,swimming:WATER_PATH_BLOCK.SWIMMING,
    combat:WATER_PATH_BLOCK.COMBAT,photoMode:WATER_PATH_BLOCK.PHOTO_MODE,
    roomTransition:WATER_PATH_BLOCK.ROOM_TRANSITION,cinematic:WATER_PATH_BLOCK.CINEMATIC
  };
  for(const [field,reason] of Object.entries(cases)){
    assert.equal(waterPathBlockReason({...GOOD,[field]:true},{anchor}),reason,field);
    const h=harness();
    const action=h.world.contextAction();
    assert.ok(action,field);
    h.live[field]=true;
    assert.equal(h.world.contextAction(),null,field);
    assert.equal(action.trigger(),false,field+' rechecked at trigger time');
    assertReleased(h);
  }
  assert.equal(waterPathBlockReason({...GOOD,grounded:false},{anchor}),WATER_PATH_BLOCK.NOT_GROUNDED);
  assert.equal(waterPathBlockReason({...GOOD,worldAction:false},{anchor}),WATER_PATH_BLOCK.INPUT_BLOCKED);
  assert.equal(waterPathBlockReason(null,{anchor}),WATER_PATH_BLOCK.NO_CONTEXT);
  assert.equal(waterPathBlockReason({...GOOD,position:{x:NaN,z:0}},{anchor}),WATER_PATH_BLOCK.NO_CONTEXT);
  const h=harness();h.live.grounded=false;assert.equal(h.world.contextAction(),null);
});
test('another modal owning input blocks the action and an entered session cannot duplicate',()=>{
  const h=harness();
  const modal=createInputFocusOwner({manager:h.manager,ownerId:'inventory',policy:INPUT_FOCUS_POLICY.BLOCKING_UI});
  modal.acquire();
  assert.equal(h.world.contextAction(),null);
  assert.equal(h.world.open(),false);
  modal.release();
  const action=h.world.contextAction();
  assert.equal(action.trigger(),true);
  assert.equal(h.world.contextAction(),null,'no second action while a session runs');
  assert.equal(h.world.open(),false);
  assert.equal(h.doc.body.children.filter(n=>n.id==='water-path-panel').length,1);
  h.world.close();assertReleased(h);
});
test('unwalkable Anchor or disabled adapter never publishes',()=>{
  const blocked=harness({isAnchorWalkable:()=>false});
  assert.equal(blocked.world.contextAction(),null);
  assert.equal(blocked.world.open(),false);
  assert.equal(blocked.world.status().blockedBy,WATER_PATH_BLOCK.ANCHOR_INVALID);
  assert.equal(harness({enabled:false}).world.contextAction(),null);
  assert.throws(()=>createInkyungWaterPathInteraction({doc:makeDom().doc,getContext:()=>GOOD}),/InputFocus/);
});

// ---- Session lifecycle ----
test('entry pauses auto move, claims BLOCKING_UI and blocks World movement, camera and actions',()=>{
  const h=harness();
  assert.equal(h.world.contextAction().trigger(),true);
  assert.equal(h.calls.pause,1);
  const snap=h.manager.snapshot();
  assert.deepEqual([...snap.topOwners],[INKYUNG_WATER_PATH_OWNER_ID]);
  assert.equal(snap.focusClass,'BLOCKING_UI');
  assert.equal(h.manager.can('MOVE'),false);
  assert.equal(h.manager.can('CAMERA'),false);
  assert.equal(h.manager.can('WORLD_ACTION'),false);
  assert.equal(h.manager.can('GAMEPLAY_SHORTCUT'),false);
  const panel=h.panel();
  assert.equal(panel.attributes.role,'dialog');
  assert.equal(panel.attributes['aria-modal'],'true');
  assert.match(panel.className,/shop-panel/);
  assert.equal(h.doc.activeElement?.getAttribute('data-focus-key'),'ctl-start','focus lands inside the panel');
  assert.equal(h.world.status().active,true);
  h.world.close();assertReleased(h);
  assert.equal(h.world.status().lastEnd.reason,'CLOSE');
});
test('pointerdown inside the panel never reaches the World camera',()=>{
  const h=harness();h.world.open();
  let reached=false;h.doc.body.addEventListener('pointerdown',()=>{reached=true;});
  h.panel().dispatch({type:'pointerdown'});
  assert.equal(reached,false);
  h.world.close();
});
test('Escape from inside the panel and from outside it both end the session',()=>{
  let h=harness();h.world.open();
  key(h.doc.activeElement,'Escape');
  assertReleased(h);assert.equal(h.world.status().lastEnd.reason,'ESC');
  h=harness();h.world.open();
  h.doc.activeElement=null;                       // focus dropped to the page body
  key(h.doc.body,'Escape');
  assertReleased(h);assert.equal(h.world.status().lastEnd.reason,'ESC');
  h=harness();h.world.open();
  key(h.doc.body,'KeyG');                         // unrelated keys keep the session
  assert.equal(h.world.active,true);h.world.close();assertReleased(h);
});
test('cancel (종료) discards the session as CANCELLED and the close button ends it',()=>{
  let h=harness();h.world.open();
  keyed(h.panel(),'ctl-start').click();
  keyed(h.panel(),'ctl-cancel').click();
  assertReleased(h);
  assert.equal(h.world.status().lastEnd.reason,'CANCEL');
  assert.equal(h.world.status().lastEnd.result,'CANCELLED');
  assert.ok(h.calls.status.some(m=>/종료/.test(m)));
  h=harness();h.world.open();
  keyed(h.panel(),'ctl-close').click();
  assertReleased(h);assert.equal(h.world.status().lastEnd.reason,'CLOSE');
});
test('success shows the local CLEARED result, then closing releases input; nothing else is touched',()=>{
  const h=harness();h.world.open();
  keyed(h.panel(),'ctl-start').click();
  for(const {cell,n} of solveClicks())for(let i=0;i<n;i++)keyed(h.panel(),'tile-'+Math.floor(cell/3)+'-'+(cell%3)).click();
  assert.match(h.panel().children[1].children[0].children[0].textContent,/물길 연결 성공/);
  assert.equal(h.world.active,true,'result stays visible until dismissed');
  assert.equal(h.doc.activeElement?.getAttribute('data-focus-key'),'ctl-restart','focus falls back to an enabled control');
  keyed(h.panel(),'ctl-close').click();
  assertReleased(h);
  assert.deepEqual({reason:h.world.status().lastEnd.reason,result:h.world.status().lastEnd.result},{reason:'CLOSE',result:'CLEARED'});
  assert.ok(h.calls.status.some(m=>/연결/.test(m)));
});
test('an exception while mounting or acting releases input and reports an error',()=>{
  let h=harness({mountPanel:()=>{throw new Error('mount boom');}});
  assert.equal(h.world.contextAction().trigger(),false);
  assertReleased(h);
  assert.equal(h.world.status().lastEnd.reason,'ERROR');
  assert.match(h.world.status().lastEnd.error,/mount boom/);
  assert.ok(h.calls.status.length>0);
  // A panel action that throws after the session started ends it through onError.
  h=harness({mountPanel:(container,options)=>{
    const root=container.ownerDocument.createElement('button');container.append(root);
    root.addEventListener('click',()=>{try{throw new Error('action boom');}catch(e){options.onError(e);}});
    return {destroy(){root.remove();},restoreFocus(){},snapshot:()=>({status:'READY'}),focusKey:null};
  }});
  h.world.open();
  assert.equal(h.world.active,true);
  h.panel().children[1].children[0].click();
  assertReleased(h);
  assert.equal(h.world.status().lastEnd.reason,'ERROR');
  // Panel teardown failure must still release input.
  h=harness({mountPanel:()=>({destroy(){throw new Error('destroy boom');},restoreFocus(){},snapshot:()=>({status:'READY'}),focusKey:null})});
  h.world.open();h.world.close();assertReleased(h);
});
test('the real panel routes a failing action to a clean exit',()=>{
  const h=harness();h.world.open();
  keyed(h.panel(),'ctl-start').click();
  // Only START turns, so the puzzle never clears; the 301st rotation exceeds maxMoves and throws in the runtime.
  let clicks=0;
  while(h.world.active&&clicks<400){keyed(h.panel(),'tile-0-0').click();clicks++;}
  assert.equal(clicks,301);
  assertReleased(h);
  assert.equal(h.world.status().lastEnd.reason,'ERROR');
  assert.match(h.world.status().lastEnd.error,/move limit/);
  assert.ok(h.calls.status.some(m=>/열지 못했어요/.test(m)));
});
test('another input owner, a system lock or clearing focus ends the session',()=>{
  for(const claim of [
    h=>createInputFocusOwner({manager:h.manager,ownerId:'shop',policy:INPUT_FOCUS_POLICY.BLOCKING_UI}).acquire(),
    h=>createInputFocusOwner({manager:h.manager,ownerId:'room-transition',policy:INPUT_FOCUS_POLICY.SYSTEM_LOCK}).acquire(),
    h=>h.manager.clear()
  ]){
    const h=harness();h.world.open();claim(h);
    assert.equal(h.world.status().active,false);
    assert.equal(h.world.status().lastEnd.reason,'FOCUS_LOST');
    assert.equal(h.focus.active,false);
    assert.equal(h.panel(),null);
    assert.equal(h.doc.listeners.keydown?.length??0,0);
  }
});
test('per-frame update ends the session on mount, zone change, combat or drift but ignores its own lock',()=>{
  let h=harness();h.world.open();h.world.update();assert.equal(h.world.active,true,'own BLOCKING_UI does not interrupt');
  h.live.position={x:anchor.x+INKYUNG_WATER_PATH_RADIUS*1.5,z:anchor.z};h.world.update();
  assert.equal(h.world.active,true,'small drift tolerated');
  h.live.position={x:anchor.x+INKYUNG_WATER_PATH_RADIUS*2.5,z:anchor.z};h.world.update();
  assertReleased(h);assert.match(h.world.status().lastEnd.reason,/^INTERRUPTED:TOO_FAR/);
  for(const field of ['insideRoom','inBiryong','mounted','combat','photoMode','roomTransition','cinematic','lobbyActive','seated','swimming']){
    h=harness();h.world.open();h.live[field]=true;h.world.update();
    assertReleased(h);assert.match(h.world.status().lastEnd.reason,/^INTERRUPTED:/,field);
  }
  h=harness();h.world.open();h.live.grounded=false;h.world.update();assertReleased(h);
});
test('pagehide discards the session; BFCache pageshow never revives it and clears a leaked claim',()=>{
  const h=harness();h.world.open();
  h.world.handlePageHide();
  assertReleased(h);assert.equal(h.world.status().lastEnd.reason,'PAGEHIDE');
  let status=h.world.handlePageShow({persisted:true});
  assert.equal(status.active,false);assert.equal(h.panel(),null);
  // A claim that outlived the page (e.g. a missed pagehide) is released on restore and World input returns.
  h.focus.acquire();assert.equal(h.manager.can('MOVE'),false);
  status=h.world.handlePageShow({persisted:true});
  assertReleased(h);assert.equal(status.focusActive,false);
  assert.ok(h.world.contextAction(),'position and input validated: the action is offered again');
  // A restored page whose player moved away no longer offers the action.
  h.live.position={x:anchor.x+30,z:anchor.z};
  assert.equal(h.world.handlePageShow({persisted:true}).blockedBy,WATER_PATH_BLOCK.TOO_FAR);
  // Session open at restore time (pagehide missed): end it as STALE.
  const g=harness();g.world.open();
  g.world.handlePageShow({persisted:true});
  assertReleased(g);assert.equal(g.world.status().lastEnd.reason,'STALE');
  g.world.destroy();g.world.destroy();
  assert.equal(g.world.contextAction(),null);
});

// ---- Keyboard focus inside the real panel ----
test('standalone preserves focused controls across renders without taking or trapping page focus',()=>{
  const {doc}=makeDom(), opener=doc.createElement('button'), host=doc.createElement('main');
  doc.body.append(opener,host);opener.focus();
  const panel=mountWaterPathPanel(host,{size:3,seed:INKYUNG_WATER_PATH_SEED});
  assert.equal(doc.activeElement,opener,'standalone mount does not autofocus');
  keyed(host,'ctl-start').focus();doc.activeElement.click();
  assert.equal(doc.activeElement,keyed(host,'tile-0-0'));
  for(let i=0;i<3;i++){
    doc.activeElement.click();
    assert.equal(doc.activeElement,keyed(host,'tile-0-0'),'replacement tile keeps focus');
    assert.equal(panel.snapshot().moves,i+1);
  }
  assert.equal(key(doc.activeElement,'Tab').defaultPrevented,false,'standalone never traps Tab');
  keyed(host,'ctl-pause').focus();doc.activeElement.click();
  assert.equal(doc.activeElement,keyed(host,'ctl-resume'));
  doc.activeElement.click();
  assert.equal(doc.activeElement,keyed(host,'tile-0-0'));
  opener.focus();keyed(host,'ctl-restart').click();
  assert.equal(doc.activeElement,opener,'external focus is left alone');
  panel.destroy();
});
test('ordinary modal exits restore connected opener after releasing ownership',()=>{
  for(const reason of ['CLOSE','ESC','CANCEL']){
    const h=harness(), opener=h.doc.createElement('button');h.doc.body.append(opener);opener.focus();
    assert.equal(h.world.open(),true);h.world.close(reason);
    assertReleased(h);assert.equal(h.doc.activeElement,opener,reason);
  }
  const h=harness(), opener=h.doc.createElement('button');h.doc.body.append(opener);opener.focus();
  h.world.open();opener.remove();h.world.close('CLOSE');assertReleased(h);
  assert.notEqual(h.doc.activeElement,opener,'detached opener never receives focus');
});
test('a hidden Context Action opener returns focus to the visible World canvas',()=>{
  const h=harness(), opener=h.doc.createElement('button'), canvas=h.doc.createElement('canvas');
  h.doc.body.append(opener,canvas);h.doc.getElementById=id=>id==='application'?canvas:null;
  opener.focus();h.world.open();opener.hidden=true;
  h.world.close('ESC');assertReleased(h);assert.equal(h.doc.activeElement,canvas);
});
test('keyboard focus survives re-renders, rotation events, Tab wrap and arrow movement',()=>{
  const h=harness();h.world.open();
  const root=()=>h.panel();
  keyed(root(),'ctl-start').click();
  assert.match(h.doc.activeElement?.getAttribute('data-focus-key'),/^tile-/,'Start vanished: focus moves to the first enabled tile');
  const firstTile=root().querySelectorAll('button').find(b=>b.getAttribute('data-focus-key').startsWith('tile-'));
  firstTile.focus();
  const focusKey=firstTile.getAttribute('data-focus-key');
  firstTile.click();                               // rotate → re-render replaces every button
  assert.equal(h.doc.activeElement?.getAttribute('data-focus-key'),focusKey,'same tile focused after the re-render');
  assert.equal(root().contains(h.doc.activeElement),true);
  // Device rotation: the browser drops focus, resize/orientationchange restores it.
  h.doc.activeElement=null;h.win.fire('orientationchange');
  assert.equal(h.doc.activeElement?.getAttribute('data-focus-key'),focusKey);
  h.doc.activeElement=null;h.win.fire('resize');
  assert.equal(root().contains(h.doc.activeElement),true);
  // A click on the dimmed World or on dead space in the dialog drops focus to the page; the modal takes it back.
  h.doc.activeElement=null;h.doc.body.dispatch({type:'pointerup'});
  assert.equal(h.doc.activeElement?.getAttribute('data-focus-key'),focusKey,'outside click restores focus');
  h.doc.activeElement=null;h.panel().dispatch({type:'pointerup'});
  assert.equal(h.doc.activeElement?.getAttribute('data-focus-key'),focusKey,'dead-space click inside the dialog restores focus');
  // Tab wraps inside the dialog in both directions and never leaves it.
  const enabled=()=>root().querySelectorAll('button').filter(b=>!b.disabled);
  enabled().at(-1).focus();key(h.doc.activeElement,'Tab');
  assert.equal(h.doc.activeElement,enabled()[0]);
  key(h.doc.activeElement,'Tab',{shiftKey:true});
  assert.equal(h.doc.activeElement,enabled().at(-1));
  // Arrow keys step between enabled tiles only.
  const tiles=()=>enabled().filter(b=>b.getAttribute('data-focus-key').startsWith('tile-'));
  tiles()[0].focus();
  const [r,c]=tiles()[0].getAttribute('data-focus-key').slice(5).split('-').map(Number);
  key(h.doc.activeElement,'ArrowDown');key(h.doc.activeElement,'ArrowRight');
  const now=h.doc.activeElement.getAttribute('data-focus-key').slice(5).split('-').map(Number);
  assert.ok(now[0]>=r&&now[1]>=c);
  assert.equal(root().contains(h.doc.activeElement),true);
  h.world.close();assertReleased(h);
});

// ---- Isolation ----
test('adapter and view carry no account, economy, storage or network surface',async()=>{
  const files=['../src/minigames/world/inkyung-water-path-interaction.js','../src/minigames/games/water-path-view.js'];
  for(const file of files){
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    const code=source.split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code,/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|supabase|wallet|inventory|quest|collection|achievement|sourceRef|navigator\.sendBeacon/i,file);
  }
  const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.equal(main.split('createInkyungWaterPathInteraction').length,3,'imported once and created once');
  // Minimal main.js wiring: shared F slot, own frame listener, page lifecycle, combat suppression.
  assert.match(main,/contextActions\.set\("inkyung-water-path", inside \? null : inkyungWaterPath\.contextAction\(pos\)\)/);
  assert.match(main,/app\.on\("update", \(\) => inkyungWaterPath\.update\(\)\)/);
  assert.match(main,/addEventListener\("pagehide", \(\) => inkyungWaterPath\.handlePageHide\(\)\)/);
  assert.match(main,/addEventListener\("pageshow", event => \{ inkyungWaterPath\.handlePageShow\(\{ persisted: event\.persisted \}\)/);
  assert.match(main,/"inkyung-fishing", "inkyung-water-path", "biryong"/,'cleared while combat owns the slot');
  assert.match(main,/ownerId: INKYUNG_WATER_PATH_OWNER_ID, policy: INPUT_FOCUS_POLICY\.BLOCKING_UI/);
});

// ---- Visual layer ----
test('display flow trace always agrees with the rules for many boards and rotations',()=>{
  let boards=0;
  for(const size of [3,4])for(let n=0;n<60;n++){
    const {tiles}=createWaterPathDefinition({size,seed:'qa.visual.'+n}).initialState;
    for(let r=0;r<8;r++){
      const trial={size,tiles:tiles.map((t,i)=>t.kind==='BLOCK'?{...t}:{kind:t.kind,rotation:(t.rotation+((n*7+r*i)%4))&3})};
      const rules=validateWaterPath(trial),flow=waterPathFlow(trial);
      assert.equal(flow.active.size,rules.activeTiles);
      assert.equal(flow.leaks.size,rules.leaks);
      assert.equal(flow.active.has(size*size-1),rules.goalConnected);
      boards++;
    }
  }
  assert.ok(boards>=960);
});
test('tiles draw pipes from the rules: one arm per open port, water on active tiles, red on leaks',()=>{
  const h=harness();h.world.open();
  keyed(h.panel(),'ctl-start').click();
  const state=h.world.status().panel&&createWaterPathDefinition({size:3,seed:INKYUNG_WATER_PATH_SEED}).initialState;
  const flow=waterPathFlow(state);
  const tileButtons=h.panel().querySelectorAll('button').filter(b=>b.getAttribute('data-focus-key').startsWith('tile-'));
  assert.equal(tileButtons.length,9);
  const spans=n=>{const out=[];const walk=x=>{for(const c of x.children){out.push(c);walk(c);}};walk(n);return out;};
  tileButtons.forEach((button,index)=>{
    const tile=state.tiles[index],all=spans(button);
    const arms=all.filter(x=>/\bwp-arm\b/.test(x.className));
    const ports=tile.kind==='BLOCK'?0:waterPathMask(tile.kind,tile.rotation).toString(2).split('1').length-1;
    assert.equal(arms.length,ports,'arms == open ports for tile '+index);
    assert.equal(/\bwp-on\b/.test(button.className),flow.active.has(index),'water only where the flow reaches');
    assert.equal(arms.filter(x=>/\bwp-leak\b/.test(x.className)).length,[0,1,2,3].filter(d=>flow.leaks.has(index+':'+d)).length);
    assert.equal(/\bwp-block\b/.test(button.className),tile.kind==='BLOCK');
    assert.equal(button.textContent,'','visual tiles carry no glyph text');
    assert.ok(button.attributes['aria-label'].includes((Math.floor(index/3)+1)+'행 '+(index%3+1)+'열'));
  });
  assert.match(tileButtons[0].attributes['aria-label'],/물이 흐름/);
  assert.equal(spans(tileButtons[0]).some(x=>x.textContent==='💧'&&x.attributes['aria-hidden']==='true'),true,'source badge');
  assert.equal(spans(tileButtons[8]).some(x=>x.textContent==='⛲'),true,'goal badge');
  // The rotation animation class lands on the tile just turned, once.
  tileButtons[0].click();
  const after=h.panel().querySelectorAll('button').filter(b=>b.getAttribute('data-focus-key').startsWith('tile-'));
  assert.match(after[0].className,/\bwp-turn\b/);
  after[1].click();
  const next=h.panel().querySelectorAll('button').filter(b=>b.getAttribute('data-focus-key').startsWith('tile-'));
  assert.doesNotMatch(next[0].className,/wp-turn/);
  assert.match(next[1].className,/wp-turn/);
  // The injected stylesheet honours reduced motion and lives beside (not inside) the panel root.
  const style=h.panel().children[1].children.find(n=>n.tag==='style');
  assert.match(style.textContent,/prefers-reduced-motion:reduce/);
  assert.equal(h.panel().children[1].children[0].tag,'section');
  h.world.close();assertReleased(h);
  assert.equal(h.panel(),null,'stylesheet removed with the panel');
});
test('success marks the board cleared for the celebration styling',()=>{
  const h=harness();h.world.open();
  keyed(h.panel(),'ctl-start').click();
  for(const {cell,n} of solveClicks())for(let i=0;i<n;i++)keyed(h.panel(),'tile-'+Math.floor(cell/3)+'-'+(cell%3)).click();
  const root=h.panel().children[1].children[0];
  assert.equal(root.attributes['data-state'],'CLEARED');
  assert.equal(root.children[1].attributes['data-cleared'],'true');
  h.world.close();assertReleased(h);
});

// ---- Expansion: difficulty, droplets, cues, sound ----
function fakeAudio({running=true}={}){
  const log={oscillators:[],connected:0};
  const context={currentTime:1,createOscillator(){
    const o={type:'',starts:[],stops:[],frequency:{set:[],ramps:[],setValueAtTime(v,t){o.frequency.set.push([v,t]);},exponentialRampToValueAtTime(v,t){o.frequency.ramps.push([v,t]);}},
      connect(){log.connected++;},disconnect(){},start(t){o.starts.push(t);},stop(t){o.stops.push(t);}};
    log.oscillators.push(o);return o;},
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){log.connected++;},disconnect(){}};}};
  return {log,context,audio:{playCue(render){if(!running)return false;render(context,{});return true;}}};
}
test('sound effects synthesise through the shared audio layer and respect lock, budget and failures',()=>{
  const a=fakeAudio();
  const sfx=createWaterPathSfx({audio:a.audio});
  assert.deepEqual([...WATER_PATH_CUES],['start','rotate','flow','clear']);
  for(const name of WATER_PATH_CUES){
    const before=a.log.oscillators.length;
    assert.equal(sfx.play(name),true,name);
    assert.ok(a.log.oscillators.length>before);
    for(const o of a.log.oscillators.slice(before)){assert.equal(o.starts.length,1);assert.ok(o.stops[0]>o.starts[0]);}
    a.log.oscillators.slice(before).forEach(o=>o.onended?.());   // voices finish
  }
  assert.equal(sfx.status().voices,0);
  assert.equal(sfx.play('unknown'),false);
  // A fully-played budget refuses extra voices instead of piling up.
  assert.equal(sfx.play('clear'),true);assert.equal(sfx.play('clear'),false,'voice budget');
  // Locked audio / missing layer / a throwing context never throw.
  assert.equal(createWaterPathSfx({audio:fakeAudio({running:false}).audio}).play('flow'),false);
  assert.equal(createWaterPathSfx({}).play('flow'),false);
  const broken={playCue(render){render({currentTime:0,createOscillator(){throw new Error('no audio');},createGain(){return {};}},{});return true;}};
  assert.equal(createWaterPathSfx({audio:broken}).play('rotate'),false);
  const off=createWaterPathSfx({audio:a.audio});off.dispose();assert.equal(off.play('flow'),false);
});
test('the view emits start, rotate, flow and clear cues at the right moments and survives a failing sound',()=>{
  const cues=[];
  const h=harness({playCue:name=>cues.push(name)});h.world.open();
  keyed(h.panel(),'ctl-start').click();
  assert.deepEqual(cues,['start']);
  // Rotating the START tile changes which neighbours it feeds: every rotation yields flow or rotate, never both silent.
  keyed(h.panel(),'tile-0-0').click();
  assert.ok(['rotate','flow'].includes(cues.at(-1)));
  for(let i=0;i<3;i++)keyed(h.panel(),'tile-0-0').click();
  keyed(h.panel(),'ctl-restart').click();
  assert.equal(cues.at(-1),'rotate');
  keyed(h.panel(),'ctl-start').click();
  for(const {cell,n} of solveClicks())for(let i=0;i<n;i++)keyed(h.panel(),'tile-'+Math.floor(cell/3)+'-'+(cell%3)).click();
  assert.equal(cues.filter(c=>c==='clear').length,1,'one fanfare per clear');
  assert.equal(cues.at(-1),'clear');
  assert.ok(cues.includes('flow'),'connecting more pipes plays the flow cue');
  h.world.close();assertReleased(h);
  const bad=harness({playCue:()=>{throw new Error('sound boom');}});bad.world.open();
  keyed(bad.panel(),'ctl-start').click();keyed(bad.panel(),'tile-0-0').click();
  assert.equal(bad.world.active,true,'a failing cue never ends the session');
  bad.world.close();assertReleased(bad);
});
test('difficulty chooser: 3x3 default, 4x4 on request, only before starting, solvable and independent per run',()=>{
  const h=harness();h.world.open();
  const tiles=()=>h.panel().querySelectorAll('button').filter(b=>b.getAttribute('data-focus-key').startsWith('tile-'));
  const board=()=>h.panel().children[1].children[0].children[1];
  assert.equal(tiles().length,9);
  assert.equal(keyed(h.panel(),'size-3').attributes['aria-pressed'],'true');
  assert.equal(keyed(h.panel(),'size-4').attributes['aria-pressed'],'false');
  assert.equal(h.doc.activeElement?.getAttribute('data-focus-key'),'ctl-start','start still gets the first focus');
  keyed(h.panel(),'size-4').click();
  assert.equal(tiles().length,16);assert.equal(board().attributes['data-size'],'4');
  assert.equal(keyed(h.panel(),'size-4').attributes['aria-pressed'],'true');
  assert.equal(h.world.status().panel.status,'READY');
  // Brute-force-free solve: undo path is not needed, search rotations of the 4x4 initial board via the rules.
  keyed(h.panel(),'ctl-start').click();
  assert.equal(keyed(h.panel(),'size-3'),undefined,'no difficulty switch while playing');
  const def=createWaterPathDefinition({size:4,seed:INKYUNG_WATER_PATH_SEED}).initialState;
  const order=def.tiles.map((t,i)=>t.kind==='BLOCK'?-1:i).filter(i=>i>=0);
  // Depth-first solve over the active-network tiles only (the rest cannot matter for clearing).
  const flowCells=[];let found=null;
  const trial=def.tiles.map(t=>({...t}));
  (function dfs(k){
    if(found)return;
    if(k===order.length){if(validateWaterPath({size:4,tiles:trial}).cleared)found=trial.map(t=>t.rotation);return;}
    const cell=order[k],base=def.tiles[cell].rotation;
    for(let r=0;r<4&&!found;r++){trial[cell].rotation=(base+r)&3;dfs(k+1);}
  })(0);
  assert.ok(found,'4x4 level has a solution');
  order.forEach(cell=>{const n=(found[cell]-def.tiles[cell].rotation+4)&3;for(let i=0;i<n;i++)keyed(h.panel(),'tile-'+Math.floor(cell/4)+'-'+(cell%4)).click();});
  assert.match(h.panel().children[1].children[0].children[0].textContent,/물길 연결 성공/);
  keyed(h.panel(),'ctl-close').click();assertReleased(h);
  // Back to 3x3 for the next session: nothing is remembered.
  h.world.open();assert.equal(tiles().length,9);h.world.close();
});
test('success adds celebration droplets and a cleared marker, and nothing remains after closing',()=>{
  const h=harness();h.world.open();
  keyed(h.panel(),'ctl-start').click();
  const drops=()=>h.panel().children[1].children[0].children[1].children.filter(n=>/\bwp-drop\b/.test(n.className));
  assert.equal(drops().length,0);
  for(const {cell,n} of solveClicks())for(let i=0;i<n;i++)keyed(h.panel(),'tile-'+Math.floor(cell/3)+'-'+(cell%3)).click();
  assert.equal(drops().length,8);
  assert.ok(drops().every(d=>d.attributes['aria-hidden']==='true'));
  keyed(h.panel(),'ctl-restart').click();assert.equal(drops().length,0,'restart clears the celebration');
  h.world.close();assertReleased(h);
});
test('main wires the sound effect lazily through worldAudio.playCue',async()=>{
  const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/createWaterPathSfx\(\{ audio: \{ playCue: render => worldAudio\?\.playCue\(render\) \?\? false \} \}\)/);
  assert.match(main,/playCue: name => waterPathSfx\.play\(name\)/);
  const sfx=await readFile(new URL('../src/minigames/world/water-path-sfx.js',import.meta.url),'utf8');
  assert.doesNotMatch(sfx.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n'),/\bfetch\s*\(|Audio\s*\(|\.mp3|\.wav|\.ogg|decodeAudioData|localStorage/);
});

test('water-path hosted QA is exact-head, bounded and metadata-only',async()=>{
  const workflow=await readFile(new URL('../../../.github/workflows/graphics-integration-browser.yml',import.meta.url),'utf8');
  const smoke=await readFile(new URL('./browser/inkyung-water-path-smoke.mjs',import.meta.url),'utf8');
  assert.match(workflow,/ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/contents: read/);
  assert.match(workflow,/timeout-minutes: 15/);
  assert.match(workflow,/name: Run Inkyung water-path metadata-only browser QA[\s\S]*?timeout-minutes: 6/);
  assert.match(workflow,/EXPECTED_WATER_PATH_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow,/run: node apps\/world\/tests\/browser\/inkyung-water-path-smoke.mjs/);
  assert.match(workflow,/name: Preserve water-path metadata only\n        if: always\(\) && steps.phone_scope.outputs.skip != 'true'/);
  assert.match(workflow,/path: test-results\/inkyung-water-path\/report.json\n/);
  assert.doesNotMatch(workflow,/continue-on-error|secrets\.|pull_request_target/);
  assert.match(smoke,/execFileSync\('git', \['rev-parse', 'HEAD'\]/);
  assert.match(smoke,/assert.equal\(report.exactHead, process.env.EXPECTED_WATER_PATH_HEAD/);
  assert.match(smoke,/let smoke = null;\n  try \{/);
  assert.match(smoke,/await smoke\?\.close\(\)/);
  assert.match(smoke,/evidence: 'METADATA_ONLY'/);
  assert.match(smoke,/result.failure = 'WATER_PATH_QA_FAILED'/);
  assert.doesNotMatch(smoke,/page\.screenshot|recordVideo|tracing\.start|error\?\.(?:stack|message)|result\.error/);
});
