import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument,FakeElement } from "./support/fake-dom.mjs";
import { createFurnitureClient } from "../src/rooms/furniture-client.js";
import { createFurnitureEditor } from "../src/rooms/furniture-editor.js";
import { ROOM_FURNITURE, FURNITURE_LIMIT, firstFurniturePosition, validateFurniture } from "../src/rooms/furniture-layout.js";
import { PERSONAL_ROOM_BASIC } from "../src/rooms/personal-room-layout.js";

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
  let ui,revision=0,user=USER;const calls=[],openChanges=[],queue=[],listeners=[];
  const client=createFurnitureClient({getUserId:()=>user,getClient:()=>({rpc:async(name,args)=>{
    calls.push({name,args});if(queue.length)return queue.shift();
    return {data:{roomId:args.p_room,role,revision: name.startsWith("save")? ++revision :revision,objects:name.startsWith("save")?args.p_objects:objects},error:null};
  }}),onChange:state=>ui?.update(state)});
  const inventory={state:"READY",snapshot:{items},refresh:async()=>true,onChange:fn=>{listeners.push(fn);return ()=>{};}};
  ui=createFurnitureEditor({doc,client,inventory,onOpenChange:open=>openChanges.push(open)});await client.bind(ROOM);
  const panel=doc.body.children.find(row=>row.id==="furniture-editor");
  const byText=text=>walk(panel).find(row=>row.tagName==="BUTTON"&&row.textContent===text);
  return {ui,client,doc,panel,inventory,calls,openChanges,byText,queue,switchUser:()=>{user="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";client.reset();},notify:()=>listeners.forEach(fn=>fn())};
}
const flush=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
const clickMapAt=(map,x,z)=>{
  const {halfWidth:W,halfDepth:D}=PERSONAL_ROOM_BASIC;
  map.dispatch("click",{target:map,clientX:(x+W)/(2*W)*1080,clientY:(D-z)/(2*D)*840});
};

test("owner can place, tap to move, rotate, save, close and reopen the saved layout",async()=>{
  const h=await rig();assert.equal(h.ui.openEditor(),true);
  h.byText("인덕 책상 의자 (0/1) +").click();assert.equal(h.client.state().objects.length,1);
  const map=walk(h.panel).find(row=>row.tagName==="SVG");clickMapAt(map,-2,-1);
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
  const map=walk(h.panel).find(row=>row.tagName==="SVG");clickMapAt(map,0,-2.75);
  assert.equal(h.byText("저장").disabled,true);
  assert.ok(walk(h.panel).some(row=>row.textContent==="문과 입장 통로는 비워 주세요."));
  const nextMap=walk(h.panel).find(row=>row.tagName==="SVG");clickMapAt(nextMap,-2,-1);
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

const byFocus=(h,key)=>walk(h.panel).find(row=>row.dataset.focus===key);
const undo=h=>byFocus(h,"undo").click();
const redo=h=>byFocus(h,"redo").click();
const objects=h=>h.client.state().objects;
const selectObject=(h,id)=>{const select=byFocus(h,"selection");select.value=id;select.dispatch("change");};
const keydown=(h,event)=>{let prevented=false;h.panel.dispatch("keydown",{preventDefault(){prevented=true;},...event});return prevented;};

test("Tab stays inside the dialog while saving and after panel fallback focus",async()=>{
  for (const succeeds of [false,true]) {
    const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();
    const snapshot=objects(h);let resolve;h.queue.push(new Promise(r=>resolve=r));
    h.byText("저장").focus();h.byText("저장").click();
    assert.equal(h.doc.activeElement,h.panel);
    for (const shiftKey of [false,true]) {
      assert.equal(keydown(h,{key:"Tab",shiftKey}),true);
      assert.equal(h.doc.activeElement,h.panel);
    }
    resolve(succeeds?{data:{roomId:ROOM,role:"owner",revision:1,objects:snapshot},error:null}:{data:null,error:{message:"offline"}});
    await flush();
    for (const shiftKey of [false,true]) {
      h.panel.focus();const enabled=h.panel.querySelectorAll("button:not(:disabled),select:not(:disabled)");
      assert.ok(enabled.length);
      assert.equal(keydown(h,{key:"Tab",shiftKey}),true);
      assert.equal(h.doc.activeElement,shiftKey?enabled.at(-1):enabled[0]);
    }
  }
});

test("history reverses placement, map movement, button movement, rotation and recall with stable identities/selection",async()=>{
  const h=await rig();h.ui.openEditor();
  assert.equal(byFocus(h,"undo").disabled,true);assert.equal(byFocus(h,"redo").disabled,true);
  const checkpoints=[objects(h)];
  h.byText("인덕 책상 의자 (0/1) +").click();checkpoints.push(objects(h));
  const id=objects(h)[0].id;
  clickMapAt(walk(h.panel).find(row=>row.tagName==="SVG"),-2,-1);checkpoints.push(objects(h));
  h.byText("↑").click();checkpoints.push(objects(h));
  h.byText("회전 0°").click();checkpoints.push(objects(h));
  h.byText("회수").click();checkpoints.push(objects(h));
  for(let i=checkpoints.length-2;i>=0;i--){undo(h);assert.deepEqual(objects(h),checkpoints[i]);if(i)assert.equal(byFocus(h,"selection").value,id);}
  assert.equal(byFocus(h,"undo").disabled,true);assert.equal(h.client.state().dirty,false);
  for(let i=1;i<checkpoints.length;i++){redo(h);assert.deepEqual(objects(h),checkpoints[i]);}
  assert.equal(byFocus(h,"redo").disabled,true);assert.equal(h.client.state().dirty,false);
  assert.equal(h.calls.length,1,"undo/redo never sends a save or consumes inventory");
  assert.ok(h.inventory.snapshot.items.every(item=>item.quantity===1));
});
test("surface changes and selection round-trip, while selection-only changes and snapped no-ops do not create history",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("생활관 스탠드 (0/1) +").click();
  const desk=objects(h);const surface=byFocus(h,"surface");surface.value="floor";surface.dispatch("change");const floor=objects(h);
  undo(h);assert.deepEqual(objects(h),desk);redo(h);assert.deepEqual(objects(h),floor);
  undo(h);selectObject(h,desk[0].id);
  clickMapAt(walk(h.panel).find(row=>row.tagName==="SVG"),desk[0].x,desk[0].z);
  assert.equal(byFocus(h,"redo").disabled,false,"same snapped position does not truncate redo");
  redo(h);assert.deepEqual(objects(h),floor);undo(h);undo(h);assert.deepEqual(objects(h),[]);
});
test("new edits after undo truncate redo and restore the prior selection when adding another object",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();const chair=objects(h)[0];
  h.byText("생활관 스탠드 (0/1) +").click();undo(h);assert.equal(byFocus(h,"selection").value,chair.id);
  h.byText("회전 0°").click();assert.equal(byFocus(h,"redo").disabled,true);redo(h);assert.equal(objects(h).length,1);assert.equal(objects(h)[0].yaw,45);
});
test("undo can repair invalid drafts and redo does not bypass geometry/save validation",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();const valid=objects(h);
  clickMapAt(walk(h.panel).find(row=>row.tagName==="SVG"),0,-2.75);assert.equal(h.byText("저장").disabled,true);
  undo(h);assert.deepEqual(objects(h),valid);assert.equal(h.byText("저장").disabled,false);
  redo(h);assert.equal(h.byText("저장").disabled,true);assert.equal(h.calls.length,1);
});
test("Ctrl/Cmd shortcuts handle undo/redo, preserve native inputs/IME, ignore repeats and isolate gameplay",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();
  let gameplay=0;h.doc.addEventListener("keydown",()=>gameplay++);
  assert.equal(keydown(h,{key:"z",ctrlKey:true}),true);assert.equal(objects(h).length,0);
  assert.equal(keydown(h,{key:"Z",metaKey:true,shiftKey:true}),true);assert.equal(objects(h).length,1);
  assert.equal(keydown(h,{key:"z",metaKey:true}),true);assert.equal(objects(h).length,0);
  assert.equal(keydown(h,{key:"y",ctrlKey:true}),true);assert.equal(objects(h).length,1);
  for(const event of [{target:h.doc.createElement("input")},{target:h.doc.createElement("textarea")},{target:byFocus(h,"selection")},{target:{isContentEditable:true}},{isComposing:true},{altKey:true}]) {
    assert.equal(keydown(h,{key:"z",ctrlKey:true,...event}),false);assert.equal(objects(h).length,1);
  }
  keydown(h,{key:"z",ctrlKey:true,repeat:true});assert.equal(objects(h).length,1);
  keydown(h,{key:"ㅋ",code:"KeyZ",ctrlKey:true});assert.equal(objects(h).length,0);
  assert.equal(gameplay,0);
});
test("history focus moves to an enabled action at undo/redo boundaries",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();
  byFocus(h,"undo").focus();undo(h);assert.equal(h.doc.activeElement.dataset.focus,"redo");
  redo(h);assert.equal(h.doc.activeElement.dataset.focus,"undo");assert.equal(h.doc.activeElement.disabled,false);
});
test("successful save clears both stacks and future undo returns to the saved checkpoint",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();const saved=objects(h);
  h.byText("회전 0°").click();undo(h);assert.equal(byFocus(h,"redo").disabled,false);
  h.byText("저장").click();await flush();assert.equal(byFocus(h,"undo").disabled,true);assert.equal(byFocus(h,"redo").disabled,true);
  h.byText("회전 0°").click();undo(h);assert.deepEqual(objects(h),saved);assert.equal(h.client.state().dirty,false);
  h.byText("완료").click();h.ui.openEditor();assert.equal(byFocus(h,"undo").disabled,true);assert.equal(byFocus(h,"redo").disabled,true);
});
test("pending save locks history, failure preserves both stacks, and retry preserves the snapshot/revision",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();h.byText("회전 0°").click();undo(h);const saved=objects(h);
  let resolve;h.queue.push(new Promise(r=>resolve=r));h.byText("저장").click();
  assert.equal(byFocus(h,"undo").disabled,true);assert.equal(byFocus(h,"redo").disabled,true);
  undo(h);redo(h);keydown(h,{key:"z",ctrlKey:true});assert.deepEqual(objects(h),saved);
  resolve({data:null,error:{message:"offline"}});await flush();
  assert.equal(byFocus(h,"undo").disabled,false);assert.equal(byFocus(h,"redo").disabled,false);
  redo(h);assert.equal(objects(h)[0].yaw,45);undo(h);assert.deepEqual(objects(h),saved);
  h.byText("저장").click();await flush();const saves=h.calls.filter(row=>row.name.startsWith("save"));assert.deepEqual(saves[0],saves[1]);
  assert.equal(byFocus(h,"undo").disabled,true);assert.equal(byFocus(h,"redo").disabled,true);
});
test("close confirmation freezes history; keep editing preserves it and discard clears it",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();const draft=objects(h);
  h.ui.requestClose();assert.equal(byFocus(h,"undo").disabled,true);undo(h);assert.deepEqual(objects(h),draft);
  h.byText("계속 꾸미기").click();undo(h);assert.deepEqual(objects(h),[]);redo(h);
  h.ui.requestClose();h.byText("변경 버리고 닫기").click();assert.deepEqual(objects(h),[]);
  h.ui.openEditor();assert.equal(byFocus(h,"undo").disabled,true);assert.equal(byFocus(h,"redo").disabled,true);
});
test("force close, account reset and room switch clear history and stale save responses cannot affect a new session",async()=>{
  for(const mode of ["force","account","room"]) {
    const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();const old=objects(h);let resolve;
    h.queue.push(new Promise(r=>resolve=r));h.byText("저장").click();
    if(mode==="force") {h.ui.forceClose();h.client.reset();await h.client.bind(ROOM);}
    else if(mode==="account") {h.switchUser();await h.client.bind(ROOM);}
    else await h.client.bind("22222222-2222-4222-8222-222222222222");
    assert.equal(h.ui.open,false);h.ui.openEditor();assert.equal(byFocus(h,"undo").disabled,true);assert.equal(byFocus(h,"redo").disabled,true);
    h.byText("생활관 스탠드 (0/1) +").click();const fresh=objects(h);
    resolve({data:{roomId:ROOM,role:"owner",revision:1,objects:old},error:null});await flush();
    assert.deepEqual(objects(h),fresh);assert.equal(byFocus(h,"undo").disabled,false);undo(h);assert.deepEqual(objects(h),[]);
    assert.equal(walk(h.panel).some(row=>row.textContent==="저장했어요. 다음에 들어와도 그대로예요."),false);
  }
});
test("client cancellation clears the session and disposal cannot reopen or revive a late save",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();h.client.cancel();assert.equal(h.ui.open,false);
  h.ui.openEditor();assert.equal(byFocus(h,"undo").disabled,true);h.byText("인덕 책상 의자 (0/1) +").click();let resolve;
  h.queue.push(new Promise(r=>resolve=r));h.byText("저장").click();h.ui.dispose();
  resolve({data:null,error:{message:"offline"}});await flush();assert.equal(h.ui.open,false);assert.equal(h.ui.openEditor(),false);assert.equal(h.client.state().editing,false);
});
test("inventory refresh cannot make undo/redo create additional unowned copies; history remains retryable",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();const placed=objects(h);undo(h);
  h.inventory.snapshot.items=[];h.notify();redo(h);assert.deepEqual(objects(h),[]);assert.equal(byFocus(h,"redo").disabled,false);
  h.inventory.snapshot.items=[{itemId:placed[0].itemId,quantity:1}];h.inventory.state="UNAVAILABLE";h.notify();redo(h);assert.deepEqual(objects(h),[]);
  h.inventory.state="READY";h.notify();redo(h);assert.deepEqual(objects(h),placed);h.byText("회수").click();
  h.inventory.snapshot.items=[];h.notify();undo(h);assert.deepEqual(objects(h),[]);
  assert.equal(h.calls.length,1);
});
test("placement and history respect the 32-object limit without changing inventory",async()=>{
  const itemId="furniture.mini_induck",items=[{itemId,quantity:FURNITURE_LIMIT+1}],full=[];
  for(let i=1;i<=FURNITURE_LIMIT;i++) {
    const point=firstFurniturePosition(itemId,"floor",full,items);assert.ok(point);
    full.push({...point,id:`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`});
  }
  assert.equal(validateFurniture(full,items),null);
  const h=await rig({objects:full,items});h.ui.openEditor();assert.equal(byFocus(h,itemId).disabled,true);
  selectObject(h,full[0].id);h.byText("회수").click();assert.equal(objects(h).length,31);
  undo(h);assert.equal(objects(h).length,32);redo(h);assert.equal(objects(h).length,31);
  const add=byFocus(h,itemId);assert.equal(add.disabled,false);add.click();assert.equal(objects(h).length,32);
  byFocus(h,itemId).click();assert.equal(objects(h).length,32);assert.equal(items[0].quantity,33);assert.equal(byFocus(h,"redo").disabled,true);
});
test("history is bounded to the latest 100 changes",async()=>{
  const h=await rig();h.ui.openEditor();h.byText("인덕 책상 의자 (0/1) +").click();
  for(let i=0;i<110;i++)byFocus(h,"rotation").click();
  for(let i=0;i<100;i++)undo(h);
  assert.equal(objects(h).length,1);assert.equal(objects(h)[0].yaw,90);assert.equal(byFocus(h,"undo").disabled,true);
  for(let i=0;i<100;i++)redo(h);
  assert.equal(objects(h)[0].yaw,270);assert.equal(byFocus(h,"redo").disabled,true);
});
