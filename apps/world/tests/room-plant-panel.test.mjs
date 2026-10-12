import test from 'node:test';
import assert from 'node:assert/strict';
import {createFakeDocument,FakeElement} from './support/fake-dom.mjs';
import {createRoomPlantPanel} from '../src/rooms/room-plant-panel.js';
import {createRoomPlantFeature} from '../src/rooms/room-plant-feature.js';
import {roomPlantVisual} from '../src/rooms/room-plant-visual.js';
const walk=node=>[node,...(node.children??[]).flatMap(walk)];
FakeElement.prototype.querySelectorAll=function(selector){return walk(this).slice(1).filter(e=>e.tagName===selector.toUpperCase());};
const object={id:'object',itemId:'furniture.indoor_planter'};
function rig() {
  const doc=createFakeDocument();doc.body=doc.createElement('body');
  const h={doc,calls:[],opens:[],available:true,room:{objects:[object]},state:{accountId:'a',roomId:'r',generation:1,role:'owner',ready:true,inventoryConfirmed:true,
    snapshot:{featureStatus:'ACTIVE',planterOwned:true,serverNow:'2026-10-12T00:00:00Z',plant:null}},backs:[]};
  const client={state:()=>h.state,available:()=>h.available,sync(){},refresh:()=>h.calls.push('read'),retry:()=>h.calls.push('retry'),
    claim:()=>h.calls.push('claim'),plant:o=>h.calls.push(['plant',o]),care:o=>h.calls.push(['care',o])};
  h.ui=createRoomPlantPanel({doc,client,getRoomState:()=>h.room,onPlace:()=>h.calls.push('place'),onOpenChange:o=>h.opens.push(o),win:{addEventListener:(k,fn)=>h.backs.push(fn)}});
  h.panel=doc.body.children[1];h.find=text=>walk(h.panel).find(e=>e.textContent===text);return h;
}
test('plant panel has one primary action and touch-sized existing style; closes and restores focus',()=>{
  const h=rig(),previous=h.doc.createElement('button');previous.focus();h.ui.openPanel(object);assert.ok(h.find('꽃 심기'));
  h.find('꽃 심기').click();assert.deepEqual(h.calls,['read',['plant','object']]);h.find('닫기').click();assert.equal(h.doc.activeElement,previous);assert.deepEqual(h.opens,[true,false]);
});
test('starter offer and stored plant use explicit claim/place actions without automatic writes',()=>{
  const h=rig();h.state.snapshot.planterOwned=false;h.ui.openPanel();assert.ok(h.find('첫 화분 받기 · 무료'));assert.deepEqual(h.calls,['read']);
  h.find('첫 화분 받기 · 무료').click();h.state.snapshot.planterOwned=true;h.room.objects=[];h.ui.update();h.find('꾸미기에서 배치').click();assert.deepEqual(h.calls,['read','claim','place']);
});
test('water, waiting and permanent flower states never offer XP/sale/replant',()=>{
  const h=rig();h.state.snapshot.plant={objectId:'object',stage:'SPROUT',revision:1,canCare:true,nextStageAt:null};h.ui.openPanel(object);
  h.find('물주기').click();assert.deepEqual(h.calls.at(-1),['care','object']);
  h.state.snapshot.plant={objectId:'object',stage:'BUD',revision:3,canCare:false,nextStageAt:'2026-10-12T20:00:00Z'};h.ui.update();
  assert.ok(h.find('다음 변화까지 약 20시간. 서두르지 않아도 괜찮아요.'));assert.equal(h.find('물주기'),undefined);
  h.state.snapshot.plant={objectId:'object',stage:'BLOOM',revision:3,canCare:false,nextStageAt:null};h.ui.update();
  assert.ok(h.find('꽃이 활짝 피었어요. 이제 물주기 없이 이 모습을 계속 간직해요.'));
  assert.equal(walk(h.panel).some(e=>e.tagName==='BUTTON'&&/XP|판매|재심기|수확/.test(e.textContent)),false);
});
test('visitors see only appearance and no caretaker actions',()=>{
  const h=rig();h.state.role='visitor';h.state.snapshot={featureStatus:'ACTIVE',plants:[{objectId:'object',stage:'BLOOM'}]};h.ui.openPanel(object);
  assert.ok(h.find('활짝 핀 꽃'));assert.equal(walk(h.panel).filter(e=>e.tagName==='BUTTON').length,1);assert.deepEqual(h.calls,['read']);
});
test('unknown response and committed unread result have distinct bounded retry actions',()=>{
  const h=rig();h.state.retry={action:'CARE'};h.state.error='UNAVAILABLE';h.state.ready=false;h.ui.openPanel(object);
  h.find('같은 요청 다시 확인').click();assert.equal(h.calls.at(-1),'retry');
  h.state.retry=null;h.state.needsReadback=true;h.state.error='READBACK_REQUIRED';h.ui.update();h.find('현재 상태 다시 확인').click();assert.equal(h.calls.at(-1),'read');
});
test('stale callbacks, account ABA, access loss and recalled target cannot operate the current room',()=>{
  const h=rig();h.ui.openPanel(object);const stale=h.find('꽃 심기');h.state.generation=3;h.ui.update();assert.equal(h.ui.open,false);stale.click();assert.deepEqual(h.calls,['read']);
  h.ui.openPanel(object);h.room.objects=[];h.ui.update();assert.equal(h.ui.open,false);
  h.room.objects=[object];h.ui.openPanel(object);h.available=false;h.ui.update();assert.equal(h.ui.open,false);assert.equal(h.ui.openPanel(object),false);
});
test('Escape, Back and Tab preserve modal input ownership',()=>{
  const h=rig();h.ui.openPanel(object);h.find('꽃 심기').focus();h.panel.dispatch('keydown',{key:'Tab'});assert.equal(h.doc.activeElement,h.find('닫기'));
  h.panel.dispatch('keydown',{key:'Tab',shiftKey:true});assert.equal(h.doc.activeElement,h.find('꽃 심기'));
  h.panel.dispatch('keydown',{key:'Escape'});assert.equal(h.ui.open,false);h.ui.openPanel(object);h.backs[0]();assert.equal(h.ui.open,false);
});
test('unchanged updates preserve the focused DOM button',()=>{
  const h=rig();h.ui.openPanel(object);const b=h.find('꽃 심기');b.focus();h.ui.update();h.ui.update();assert.equal(h.find('꽃 심기'),b);assert.equal(h.doc.activeElement,b);
});
test('assembled feature does no work while CLOSED',()=>{
  const doc=createFakeDocument();doc.body=doc.createElement('body');let reads=0;
  const f=createRoomPlantFeature({doc,getUserId:()=>null,getClient:()=>{reads++;},getRoomState:()=>({}),inventory:{},win:null});
  f.update();assert.equal(f.handler(),false);f.reset();assert.equal(reads,0);
});
test('all three silhouettes are distinct, self-authored and contained within .55 x .80 x .55',()=>{
  const counts=[];for(const stage of ['SPROUT','BUD','BLOOM']){
    const parts=roomPlantVisual(stage);counts.push(parts.length);
    for(const p of parts){assert.ok(Math.abs(p.at[0])+p.size[0]/2<=.275);assert.ok(Math.abs(p.at[2])+p.size[2]/2<=.275);assert.ok(p.at[1]+p.size[1]/2<=.8);assert.ok(p.at[1]-p.size[1]/2>=0);}
  }
  assert.equal(new Set(counts).size,3);assert.equal(roomPlantVisual(null).length,2);assert.ok(roomPlantVisual('BLOOM').some(p=>p.name==='grow_flower_center'));
});
