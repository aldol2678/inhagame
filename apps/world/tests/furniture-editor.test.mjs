import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument,FakeElement } from "./support/fake-dom.mjs";
import { createFurnitureClient } from "../src/rooms/furniture-client.js";
import { createFurnitureEditor } from "../src/rooms/furniture-editor.js";
import { ROOM_FURNITURE } from "../src/rooms/furniture-layout.js";

const ROOM="11111111-1111-4111-8111-111111111111",USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const walk=node=>[node,...(node.children??[]).flatMap(walk)];
Object.defineProperty(FakeElement.prototype,"firstChild",{get(){return this.children[0];}});
Object.defineProperty(FakeElement.prototype,"childElementCount",{get(){return this.children.length;}});
FakeElement.prototype.querySelectorAll=function(selector){return walk(this).slice(1).filter(node=>{
  if(selector==="[data-focus]")return !!node.dataset.focus;
  return selector.includes("not(:disabled)") ? ["BUTTON","SELECT"].includes(node.tagName)&&!node.disabled : node.tagName===selector.toUpperCase();
});};
FakeElement.prototype.querySelector=function(selector){return this.querySelectorAll(selector)[0]??null;};
FakeElement.prototype.remove=function(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);};
FakeElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:1080,height:840});
FakeElement.prototype.closest=function(selector){return selector==="[data-object-id]"&&this.dataset.objectId ? this : null;};
const originalAttr=FakeElement.prototype.setAttribute;
FakeElement.prototype.setAttribute=function(key,value){originalAttr.call(this,key,value);if(key==="data-object-id")this.dataset.objectId=String(value);};

async function rig({role="owner",objects=[],items=ROOM_FURNITURE.map(item=>({itemId:item.itemId,quantity:1}))}={}) {
  const doc=createFakeDocument(); doc.body=doc.createElement("body");doc.createElementNS=(_namespace,tag)=>doc.createElement(tag);
  let ui,revision=0;const calls=[],openChanges=[],queue=[],listeners=[];
  const client=createFurnitureClient({getUserId:()=>USER,getClient:()=>({rpc:async(name,args)=>{
    calls.push({name,args});if(queue.length)return queue.shift();
    return {data:{roomId:ROOM,role,revision: name.startsWith("save")? ++revision :revision,objects:name.startsWith("save")?args.p_objects:objects},error:null};
  }}),onChange:state=>ui?.update(state)});
  const inventory={state:"READY",snapshot:{items},refresh:async()=>true,onChange:fn=>{listeners.push(fn);return ()=>{};}};
  ui=createFurnitureEditor({doc,client,inventory,onOpenChange:open=>openChanges.push(open)});await client.bind(ROOM);
  const panel=doc.body.children.find(row=>row.id==="furniture-editor");
  const byText=text=>walk(panel).find(row=>row.tagName==="BUTTON"&&row.textContent===text);
  return {ui,client,doc,panel,inventory,calls,openChanges,byText,queue,notify:()=>listeners.forEach(fn=>fn())};
}
const flush=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};

test("owner can place, tap to move, rotate, save, close and reopen the saved layout",async()=>{
  const h=await rig();assert.equal(h.ui.openEditor(),true);
  h.byText("인덕 책상 의자 (0/1) +").click();assert.equal(h.client.state().objects.length,1);
  const map=walk(h.panel).find(row=>row.tagName==="SVG");map.dispatch("click",{target:map,clientX:340,clientY:520});
  assert.deepEqual({x:h.client.state().objects[0].x,z:h.client.state().objects[0].z},{x:-2,z:-1});
  h.byText("회전 0°").click();assert.equal(h.client.state().objects[0].yaw,45);
  h.byText("저장").click();await flush();assert.equal(h.client.state().dirty,false);
  assert.equal(h.calls.filter(row=>row.name.startsWith("save")).length,1);
  h.byText("완료").click();assert.equal(h.ui.open,false);
  assert.equal(h.ui.openEditor(),true);assert.equal(h.client.state().objects[0].yaw,45);
});
test("unsaved close/leave offers keep editing and explicit discard; restore saved objects",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();let leaves=0;
  assert.equal(h.ui.requestClose(()=>leaves++),false);assert.equal(h.ui.open,true);assert.equal(leaves,0);
  h.byText("계속 꾸미기").click();assert.equal(h.client.state().objects.length,1);
  h.ui.requestClose(()=>leaves++);h.byText("변경 버리고 닫기").click();assert.equal(h.ui.open,false);assert.equal(leaves,1);assert.deepEqual(h.client.state().objects,[]);
});
test("recall is draft-only until save, and quota disables a second placement",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();
  assert.equal(h.byText("인덕 책상 의자 (1/1) +").disabled,true);
  h.byText("회수").click();assert.deepEqual(h.client.state().objects,[]);assert.equal(h.calls.length,1);assert.equal(h.client.state().dirty,false);
});
test("invalid door placement disables save, keeps selection and can be moved back",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();
  const map=walk(h.panel).find(row=>row.tagName==="SVG");map.dispatch("click",{target:map,clientX:540,clientY:695});
  assert.equal(h.byText("저장").disabled,true);
  assert.ok(walk(h.panel).some(row=>row.textContent==="문과 입장 통로는 비워 주세요."));
  const nextMap=walk(h.panel).find(row=>row.tagName==="SVG");nextMap.dispatch("click",{target:nextMap,clientX:340,clientY:520});
  assert.equal(h.byText("저장").disabled,false);
});
test("pending save prevents closing and failed save retains the visible draft",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();let resolve;
  h.queue.push(new Promise(r=>resolve=r));h.byText("저장").click();assert.equal(h.client.state().pending,true);
  assert.equal(h.ui.requestClose(),false);assert.equal(h.ui.open,true);
  resolve({data:null,error:{message:"offline"}});await flush();assert.equal(h.ui.open,true);assert.equal(h.client.state().objects.length,1);assert.equal(h.client.state().dirty,true);
});
test("no furniture owned is an explicit empty state; visitors cannot open editor",async()=>{
  const owner=await rig({items:[]});owner.ui.openEditor();assert.ok(walk(owner.panel).some(row=>row.textContent.includes("보유한 배치용 가구가 없어요")));
  const visitor=await rig({role:"visitor"});assert.equal(visitor.ui.openEditor(),false);assert.equal(visitor.ui.open,false);assert.deepEqual(visitor.openChanges,[]);
});
test("desk props can switch surface and retain their instance identity",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("생활관 스탠드 (0/1) +").click();const object=h.client.state().objects[0];assert.equal(object.surface,"desk");
  const surface=walk(h.panel).find(row=>row.dataset.focus==="surface");surface.value="floor";surface.dispatch("change");
  assert.equal(h.client.state().objects[0].surface,"floor");assert.equal(h.client.state().objects[0].id,object.id);
});
test("force close releases input even when identity resets a dirty layout",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();h.client.reset();assert.equal(h.ui.open,false);assert.equal(h.openChanges.at(-1),false);
});
