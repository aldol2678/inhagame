// Real pinned PlayCanvas geometry/lifecycle test. Not browser pixels or a real account.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,next){return next(s==='playcanvas'?engine:s,c);}});
globalThis.window={addEventListener(){},removeEventListener(){}};
globalThis.document={addEventListener(){},removeEventListener(){},createElement(){return{getContext(){return null;}};}};
const pc=await import('playcanvas');
const {createFurnitureLayer}=await import('../../src/rooms/furniture-renderer.js');
const {campusMaterialCacheStatus}=await import('../../src/campus-render-kit.js');
const canvas={id:'plant-null',width:360,height:740,addEventListener(){}};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem];app.init(options);
try{
 const root=new pc.Entity('plant-room');app.root.addChild(root);const layer=createFurnitureLayer(app,root);
 const object={id:'planter',itemId:'furniture.indoor_planter',surface:'floor',x:0,z:0,yaw:45};layer.setObjects([object]);
 const walk=e=>[e.name,...e.children.flatMap(walk)],names=()=>walk(layer.root),count=()=>layer.root.findComponents('render').length;
 assert.equal(count(),2);layer.obstacles.push({id:'optional-decor'});const colliders=JSON.stringify(layer.obstacles);let materials;
 for(let n=0;n<12;n++){
  for(const [stage,expected]of[['SPROUT',5],['BUD',6],['BLOOM',14]]){
   layer.setPlants([{objectId:'planter',plantId:'plant.room_flower',stage}]);assert.equal(count(),expected);assert.equal(layer.root.children.length,1);
   assert.equal(JSON.stringify(layer.obstacles),colliders);assert.equal(names().includes('grow_flower_center'),stage==='BLOOM');
  }
  if(n===0)materials=campusMaterialCacheStatus().materialCount;else assert.equal(campusMaterialCacheStatus().materialCount,materials);
  layer.setPlants([]);assert.equal(count(),2);
 }
 layer.setObjects([{...object,id:'static',itemId:'furniture.dorm_plant_medium'}]);assert.ok(names().includes('leaf'));assert.ok(!names().includes('grow_flower_center'));
 layer.setObjects([]);assert.equal(layer.root.children.length,0);root.destroy();
 console.log(`PASS: PlayCanvas ${pc.version}, 12 sprout/bud/bloom/clear cycles, stable shared material count and obstacle identity, unchanged STATIC plant, teardown. Browser/pixels UNKNOWN.`);
}finally{app.destroy();}
