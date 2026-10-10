// Pinned engine geometry and layer lifecycle verification. This is not a pixel/browser test.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const engine = new URL("./node_modules/playcanvas/build/playcanvas.mjs", import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier === "playcanvas" ? engine : specifier,context);}});
globalThis.window = { addEventListener(){}, removeEventListener(){} };
globalThis.document = { addEventListener(){}, removeEventListener(){}, createElement(){ return {getContext(){return null;}}; } };
const pc = await import("playcanvas");
const { createFurnitureLayer } = await import("../../src/rooms/furniture-renderer.js");
const canvas = {id:"trophy-null",width:360,height:740,addEventListener(){}};
const app = new pc.AppBase(canvas), options = new pc.AppOptions();
options.graphicsDevice = new pc.NullGraphicsDevice(canvas);options.componentSystems = [pc.RenderComponentSystem];app.init(options);
try {
  const root = new pc.Entity("test-room");app.root.addChild(root);
  const layer = createFurnitureLayer(app,root);
  const shelf = {id:"shelf",itemId:"furniture.dorm_trophy_shelf",surface:"floor",x:0,z:0,yaw:45};
  const names = () => {const walk=e=>[e.name,...e.children.flatMap(walk)];return walk(layer.root);};
  const count = () => layer.root.findComponents("render").length;
  layer.setObjects([shelf]);const empty = count();assert.equal(empty,6);assert.ok(!names().includes("trophy_cup"));
  // The room decor layer augments this shared array after setObjects; changing only a display must preserve it.
  layer.obstacles.push({id:"synthetic_decor_obstacle",minX:4,maxX:5,minZ:0,maxZ:1});
  const obstacles = JSON.stringify(layer.obstacles);
  for(let repeat=0;repeat<3;repeat++) {
    layer.setDisplays([{objectId:"shelf",itemId:"badge.main_gate",category:"BADGE",name:"정문 첫걸음 배지"}]);
    assert.ok(names().includes("owned_badge"));assert.ok(names().includes("owned_item_nameplate"));assert.equal(count(),empty+4);
    layer.setDisplays([{objectId:"shelf",itemId:"memorabilia.mcm_2026_wristband",category:"MEMORABILIA",name:"일일호프 기념 팔찌"}]);
    assert.equal(names().includes("owned_badge"),false);assert.ok(names().includes("owned_wristband_side"));assert.equal(count(),empty+6);
    assert.equal(JSON.stringify(layer.obstacles),obstacles);
    layer.setDisplays([]);assert.equal(count(),empty);assert.equal(names().includes("owned_item_nameplate"),false);
  }
  layer.setObjects([]);assert.equal(layer.root.children.length,0);root.destroy();
  console.log(`PASS: PlayCanvas ${pc.version} NullGraphicsDevice; empty shelf, 3 repeated badge/wristband/clear cycles, stable colliders and teardown. No browser/pixel claim.`);
} finally { app.destroy(); }
