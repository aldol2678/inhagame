import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTrophyDisplay, ownedDisplayItems, TROPHY_DISPLAY_NOTICE, TROPHY_VISITOR_NOTICE } from "../src/rooms/trophy-display.js";
import { createTrophyDisplayPanel } from "../src/rooms/trophy-display-panel.js";
import { trophyDisplayVisual } from "../src/rooms/trophy-display-visual.js";
import { createFakeDocument } from "./support/fake-dom.mjs";
const BADGE="badge.main_gate", WRISTBAND="memorabilia.mcm_2026_wristband";
const shelf={id:"shelf",itemId:"furniture.dorm_trophy_shelf",x:0,z:0,yaw:0,surface:"floor"};
const row=itemId=>({itemId,quantity:1,catalogStatus:"ACTIVE"});
function rig({role="owner",items=[row(BADGE),row(WRISTBAND)]}={}) {
  const context={space:"ROOM_PERSONAL_BASIC",roomId:"room",accountId:"owner",ownerUserId:"owner",role,ready:true,objects:[shelf]};
  let reads=0,refreshes=0, panel;
  const inventory={state:"READY",accountId:"owner",get snapshot(){reads++;return {items};},async refresh(){refreshes++;return true;}};
  const events=[];
  const display=createTrophyDisplay({inventory,getContext:()=>context,onChange:state=>{events.push(state);panel?.update(state);}});
  const doc=createFakeDocument();doc.body=doc.createElement("body");
  const opens=[];panel=createTrophyDisplayPanel({display,doc,onOpenChange:open=>opens.push(open)});
  const walk=node=>[node,...node.children.flatMap(walk)];
  const byText=text=>walk(doc.body).find(node=>node.tagName==="BUTTON"&&node.textContent===text);
  return {context,inventory,display,panel,doc,opens,events,items,walk,byText,reads:()=>reads,refreshes:()=>refreshes};
}
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
test("current owned badges and memorabilia only; history, furniture, unknown and zero rows are not candidates",()=>{
  const items=ownedDisplayItems([row(BADGE),row(WRISTBAND),row("furniture.dorm_trophy_shelf"),row("badge.unknown"),{...row("badge.campus_explorer"),quantity:0}]);
  assert.deepEqual(items.map(item=>item.itemId),[BADGE,WRISTBAND]);
  assert.deepEqual(ownedDisplayItems([]),[]);
});
test("select and clear affect only a saved shelf and only a currently owned item",()=>{
  const h=rig();assert.equal(h.display.select("missing",BADGE),false);assert.equal(h.display.select("shelf","badge.campus_explorer"),false);
  assert.equal(h.display.select("shelf",BADGE),true);assert.equal(h.display.state().displays[0].name,"정문 첫걸음 배지");
  assert.equal(h.display.select("shelf",null),true);assert.deepEqual(h.display.state().displays,[]);
});
test("visitors neither inspect a private inventory snapshot nor refresh it",async()=>{
  const h=rig({role:"visitor"});assert.equal(h.display.state().status,"VISITOR");assert.equal(h.panel.open(shelf),true);await flush();
  assert.equal(h.reads(),0);assert.equal(h.refreshes(),0);assert.equal(await h.display.refresh(),false);
  assert.equal(h.display.select("shelf",BADGE),false);assert.ok(h.walk(h.doc.body).some(node=>node.textContent===TROPHY_VISITOR_NOTICE));
});
test("a claimed owner role does not expose another account's inventory",async()=>{
  const h=rig();h.context.ownerUserId="someone-else";
  assert.equal(h.display.state().status,"UNAVAILABLE");assert.equal(h.reads(),0);assert.equal(h.panel.open(shelf),false);
  assert.equal(await h.display.refresh(),false);
});
test("selection disappears immediately on ownership loss, shelf removal, account switch and room exit",()=>{
  for(const change of [h=>h.items.splice(0),h=>h.context.objects=[],h=>h.context.accountId="other",h=>h.context.space="campus",h=>h.inventory.state="UNAVAILABLE"]) {
    const h=rig();h.display.select("shelf",BADGE);change(h);h.display.update();assert.deepEqual(h.display.state().displays,[]);
    assert.deepEqual(h.display.state().selections,[]);
  }
});
test("selection is not stored: reset and room switch drop preview even when the same shelf returns",()=>{
  const h=rig();h.display.select("shelf",BADGE);h.display.reset();assert.deepEqual(h.display.state().displays,[]);
  h.display.select("shelf",BADGE);h.context.roomId="other-room";h.display.update();h.context.roomId="room";assert.deepEqual(h.display.state().displays,[]);
});
test("a loading refresh hides previews and rejects selection, then restores only still-owned items",async()=>{
  const h=rig();h.display.select("shelf",BADGE);let resolve;h.inventory.refresh=()=>new Promise(r=>resolve=r);
  const pending=h.display.refresh();assert.equal(h.display.state().status,"LOADING");assert.deepEqual(h.display.state().displays,[]);
  assert.equal(h.display.select("shelf",WRISTBAND),false);resolve(true);await pending;assert.equal(h.display.state().displays[0].itemId,BADGE);
});
test("failed refresh clears preview and supports retry without accepting stale ownership",async()=>{
  const h=rig();h.display.select("shelf",BADGE);h.inventory.refresh=async()=>false;assert.equal(await h.display.refresh(),false);
  assert.equal(h.display.state().status,"UNAVAILABLE");assert.deepEqual(h.display.state().displays,[]);
  h.inventory.refresh=async()=>true;assert.equal(await h.display.refresh(),true);assert.equal(h.display.state().status,"READY");
});
test("late inventory completion cannot restore a previous room or account preview",async()=>{
  const h=rig();let resolve;h.inventory.refresh=()=>new Promise(r=>resolve=r);const pending=h.display.refresh();
  h.context.accountId="next";h.display.update();resolve(true);assert.equal(await pending,false);assert.deepEqual(h.display.state().displays,[]);
});
test("panel shows owner-only/session-only promise, supports select, clear, repeated open and Escape",async()=>{
  const h=rig();const opener=h.doc.createElement("button");h.doc.body.append(opener);opener.focus();
  assert.equal(h.panel.open(shelf),true);assert.equal(h.panel.open(shelf),false);await flush();
  assert.ok(h.walk(h.doc.body).some(node=>node.textContent===TROPHY_DISPLAY_NOTICE));
  h.byText("정문 첫걸음 배지 · 보유 1").click();assert.equal(h.display.state().displays[0].itemId,BADGE);
  h.byText("선반 비우기").click();assert.deepEqual(h.display.state().displays,[]);
  h.doc.dispatch("keydown",{code:"Escape"});assert.equal(h.panel.isOpen,false);assert.equal(h.doc.activeElement,opener);
  assert.equal(h.panel.open(shelf),true);await flush();h.panel.close();assert.deepEqual(h.opens,[true,false,true,false]);
});
test("open panel closes on editing, access loss, shelf removal and account change",async()=>{
  for(const change of [h=>h.context.editing=true,h=>h.context.ready=false,h=>h.context.objects=[],h=>h.context.accountId="other"]) {
    const h=rig();h.panel.open(shelf);await flush();change(h);h.display.update();assert.equal(h.panel.isOpen,false);assert.equal(h.opens.at(-1),false);
  }
});
test("panel empty/retry states and focus trapping remain usable on keyboard",async()=>{
  const h=rig({items:[]});h.panel.open(shelf);await flush();assert.ok(h.walk(h.doc.body).some(node=>node.textContent.includes("지금 보유한 전시용")));
  h.doc.dispatch("keydown",{code:"Tab",shiftKey:true});assert.equal(h.doc.activeElement.textContent,"보유 목록 새로 확인");
  h.inventory.refresh=async()=>false;await h.display.refresh();assert.ok(h.byText("다시 확인"));
  h.inventory.refresh=async()=>true;h.byText("다시 확인").click();await flush();assert.equal(h.display.state().status,"READY");
});
test("empty shelves do not imply an earned cup; badge and memorabilia render distinct symbolic markers",()=>{
  assert.deepEqual(trophyDisplayVisual(null),[]);
  assert.ok(trophyDisplayVisual({itemId:BADGE,name:"badge",category:"BADGE"}).some(part=>part.name==="owned_badge"));
  assert.ok(trophyDisplayVisual({itemId:WRISTBAND,name:"band",category:"MEMORABILIA"}).some(part=>part.name==="owned_wristband_side"));
  const renderer=readFileSync(new URL("../src/rooms/furniture-renderer.js",import.meta.url),"utf8");
  assert.equal(renderer.includes('"trophy_cup"'),false);
});
test("main wires the shared F provider, modal owner and lifecycle cleanup without a new keyboard handler",()=>{
  const main=readFileSync(new URL("../src/main.js",import.meta.url),"utf8");
  assert.match(main,/contextActions.set\("room-furniture", roomFurnitureFunctions.contextAction\(\)\)/);
  assert.match(main,/ownerId: "room-trophy-display"/);assert.match(main,/trophyDisplayPanel.close\(\{ restoreFocus: false \}\); trophyDisplay.reset\(\)/);
  const model=readFileSync(new URL("../src/rooms/trophy-display.js",import.meta.url),"utf8");
  assert.doesNotMatch(model,/localStorage|sessionStorage|\.rpc\(|collectionBook/);
});

test("a newer blocking panel or transition releases the display dialog without stealing focus",async()=>{
  const h=rig();h.panel.open(shelf);await flush();
  h.panel.observeFocus({topOwners:["room-trophy-display"]});assert.equal(h.panel.isOpen,true);
  const next=h.doc.createElement("button");h.doc.body.append(next);next.focus();
  h.panel.observeFocus({topOwners:["room-trophy-display","inventory"]});
  assert.equal(h.panel.isOpen,false);assert.equal(h.doc.activeElement,next);assert.equal(h.opens.at(-1),false);
});
