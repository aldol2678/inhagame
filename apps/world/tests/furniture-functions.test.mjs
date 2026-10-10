import test from "node:test";
import assert from "node:assert/strict";
import { createFurnitureFunctionProvider, getFurnitureFunction } from "../src/rooms/furniture-functions.js";

const target = { id:"shelf", itemId:"furniture.dorm_trophy_shelf", x:0, z:0, yaw:0, surface:"floor" };
function rig() {
  const calls = [];
  const state = { space:"ROOM_PERSONAL_BASIC", roomId:"room", accountId:"owner", ownerUserId:"owner", role:"owner",
    ready:true, objects:[target], grounded:true };
  const position = {x:0,z:1};
  const provider = createFurnitureFunctionProvider({ getState:()=>state, getPosition:()=>position,
    handlers:{display:(object, current)=>{calls.push({object,current});return true;}} });
  return {state,position,provider,calls};
}
test("B1 registry offers a nearby known furniture function through one F provider",()=>{
  const h=rig(), action=h.provider.contextAction(); assert.equal(action.label,"기념품 전시 확인"); assert.equal(action.priority,170);
  assert.equal(action.trigger(),true); assert.equal(h.calls[0].object.id,"shelf");
  assert.equal(getFurnitureFunction("furniture.induck_chair").kind,"seat");
  assert.equal(getFurnitureFunction("unknown"),null);
});
test("gate matrix excludes editing, transitions, modals, mounts, sitting, airborne and other spaces",()=>{
  for(const [key,value] of Object.entries({editing:true,busy:true,blocked:true,mounted:true,seated:true,grounded:false,ready:false,
    space:"ROOM_DORM1_LOBBY",accountId:null,roomId:null,role:"unknown"})) {
    const h=rig();h.state[key]=value;assert.equal(h.provider.contextAction(),null,key);
  }
});
test("retained F/mobile callbacks revalidate gates, room, account, owner, role and distance",()=>{
  for(const change of [h=>h.state.busy=true,h=>h.state.editing=true,h=>h.state.blocked=true,h=>h.state.roomId="other",
    h=>h.state.accountId="other",h=>h.state.ownerUserId="other",h=>h.state.role="visitor",h=>h.position.z=4,h=>h.state.objects=[]]) {
    const h=rig(),action=h.provider.contextAction();change(h);assert.equal(action.trigger(),false);assert.equal(h.calls.length,0);
  }
});
test("missing handlers never offer seats; only nearest supported furniture wins deterministically",()=>{
  const h=rig();h.state.objects=[{...target,id:"z"},{...target,id:"a"},{...target,id:"chair",itemId:"furniture.induck_chair"}];
  assert.match(h.provider.contextAction().id,/:a$/);
  h.position.z=2;assert.equal(h.provider.contextAction(),null);
});
test("cooking remains COMING_SOON unless explicitly available, placed, and owner scoped",()=>{
  const h=rig();h.state.objects=[{...target,itemId:"furniture.cooking_station"}];
  let available=false;
  const provider=createFurnitureFunctionProvider({getState:()=>h.state,getPosition:()=>h.position,handlers:{cook:()=>true},isAvailable:()=>available});
  assert.equal(provider.contextAction(),null);available=true;assert.equal(provider.contextAction().trigger(),true);
  h.state.role="visitor";assert.equal(provider.contextAction(),null);
  h.state.role="owner";h.state.ownerUserId="other";assert.equal(provider.contextAction(),null);
  h.state.objects=[];assert.equal(provider.contextAction(),null);
});
