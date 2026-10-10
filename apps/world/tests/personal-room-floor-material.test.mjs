import test from "node:test";
import assert from "node:assert/strict";
import { createPersonalRoomFloorMaterial, woodFloor051Enabled, PERSONAL_ROOM_FLOOR_QA_URL } from "../src/rooms/personal-room-floor-material.js";

function rig({enabled=true, synchronous=false, throwLoad=false}={}) {
  const original={ name:"original-b99168", diffuseMap: null };
  const floor={render:{material:original}};
  let onDestroy;
  const root={enabled:true,once(event,fn){assert.equal(event,"destroy");onDestroy=fn;}};
  const calls=[];
  const app={assets:{loadFromUrl(url,type,fn){calls.push({url,type,fn});if(throwLoad) throw new Error("no network");if(synchronous) fn(null,{resource:{id:"tex-sync",width:1024,height:1024}});}}};
  const engine={
    StandardMaterial: class {
      constructor(){this.updateCount=0;this.destroyed=false;}
      update(){this.updateCount++;}
      destroy(){this.destroyed=true;}
    },
    Vec2: class { constructor(x,y){this.x=x;this.y=y;} }
  };
  const controller=createPersonalRoomFloorMaterial({app,root,floor,enabled,engine});
  const finish=(index=0,err=null,asset={resource:{id:"tex",width:1024,height:1024}})=>calls[index].fn(err,asset);
  return {original,floor,root,calls,app,controller,finish, destroy:()=>onDestroy()};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

test("F01 explicitly disabled mode retains original floor without a request",async()=>{
  const x=rig({enabled:false}); assert.equal(await x.controller.ensureVisual(),false); assert.equal(x.calls.length,0);assert.strictEqual(x.floor.render.material,x.original);
});
test("B floor is default on all hosts; explicit query 0 uses original A floor",()=>{
  for(const host of ["inhagame.app","www.inhagame.app","localhost","staging.inhagame.app","example.org"]){
    assert.equal(woodFloor051Enabled({hostname:host,search:""}),true);
    assert.equal(woodFloor051Enabled({hostname:host,search:"?woodFloor051=1"}),true);
    assert.equal(woodFloor051Enabled({hostname:host,search:"?woodFloor051=0"}),false);
  }
  assert.equal(woodFloor051Enabled(undefined),true);
});
test("F02 default B successfully loads Color only, keeps original unmodified, tiles 8x5",async()=>{
  const x=rig();const pending=x.controller.ensureVisual();await flush();
  assert.equal(x.calls.length,1);assert.equal(x.calls[0].url,PERSONAL_ROOM_FLOOR_QA_URL);assert.equal(x.calls[0].type,"texture");assert.strictEqual(x.floor.render.material,x.original);
  x.finish();assert.equal(await pending,true);assert.notStrictEqual(x.floor.render.material,x.original);
  assert.deepEqual([x.floor.render.material.diffuseMapTiling.x,x.floor.render.material.diffuseMapTiling.y],[8,5]);
  assert.equal(x.floor.render.material.updateCount,1);assert.equal(x.original.diffuseMap,null);
});
test("F03 missing texture or server error fails closed",async()=>{
  for(const [error,asset] of [[new Error("404"),undefined],[null,{}],[null,null]]){
    const x=rig();const p=x.controller.ensureVisual();await flush();x.finish(0,error,asset);assert.equal(await p,false);assert.strictEqual(x.floor.render.material,x.original);
  }
});
test("F03b reject non-1K texture even when image decoder succeeds", async()=>{const x=rig();const p=x.controller.ensureVisual();await flush();x.finish(0,null,{resource:{width:512,height:512}});assert.equal(await p,false);assert.strictEqual(x.floor.render.material,x.original);});
test("F04 thrown load fails closed, can retry",async()=>{const x=rig({throwLoad:true});assert.equal(await x.controller.ensureVisual(),false);assert.strictEqual(x.floor.render.material,x.original);});
test("F05 deactivating before callback prevents late visual apply",async()=>{
  const x=rig();const p=x.controller.ensureVisual();await flush();x.controller.deactivate();x.finish();assert.equal(await p,false);assert.strictEqual(x.floor.render.material,x.original);
  x.root.enabled=true;assert.equal(await x.controller.ensureVisual(),true);assert.equal(x.calls.length,1);
});
test("F06 destroying while pending cannot recreate or reactivate the room",async()=>{
  const x=rig();const p=x.controller.ensureVisual();await flush();x.destroy();x.finish();assert.equal(await p,false);
  assert.equal(await x.controller.ensureVisual(),false);assert.strictEqual(x.floor.render.material,x.original);
});
test("F07 concurrent ensures deduplicate request and create one material",async()=>{
  const x=rig();const p=x.controller.ensureVisual();const q=x.controller.ensureVisual();await flush();assert.equal(x.calls.length,1);x.finish();assert.equal(await p,false);assert.equal(await q,true);
  const mat=x.floor.render.material;assert.equal(await x.controller.ensureVisual(),true);assert.strictEqual(x.floor.render.material,mat);assert.equal(x.calls.length,1);
});
test("F08 restore and re-entry reuse material; destroying leaves original",async()=>{
  const x=rig();const p=x.controller.ensureVisual();await flush();x.finish();assert.equal(await p,true);const mat=x.floor.render.material;
  for(let i=0;i<20;i++){x.controller.deactivate();assert.strictEqual(x.floor.render.material,x.original);assert.equal(await x.controller.ensureVisual(),true);assert.strictEqual(x.floor.render.material,mat);}
  assert.equal(x.calls.length,1);x.destroy();assert.strictEqual(x.floor.render.material,x.original);assert.equal(mat.destroyed,true);
});
test("F09 hidden room returns safely and never paints before next entry",async()=>{
  const x=rig();const p=x.controller.ensureVisual();await flush();x.root.enabled=false;x.finish();assert.equal(await p,false);assert.strictEqual(x.floor.render.material,x.original);
  x.controller.deactivate();x.root.enabled=true;assert.equal(await x.controller.ensureVisual(),true);assert.equal(x.calls.length,1);
});
test("F10 synchronous cache callback does not duplicate or race",async()=>{
  const x=rig({synchronous:true});const p=x.controller.ensureVisual();const q=x.controller.ensureVisual();assert.equal(await q,true);assert.equal(await p,false);assert.equal(x.calls.length,1);
});
test("F11 repeated destroy is harmless and OFF never mutates shared original",async()=>{
  const x=rig({enabled:false});x.controller.destroy();x.destroy();assert.strictEqual(x.floor.render.material,x.original);assert.equal(x.original.name,"original-b99168");
});
