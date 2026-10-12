// Real pinned PlayCanvas GLB parser/lifecycle. Null device is NOT pixel/GPU proof.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,n){return n(s==='playcanvas'?engine:s,c);}});
const pc=await import('playcanvas');
const {createFurnitureLayer}=await import('../../src/rooms/furniture-renderer.js');
const {furnitureAssetStatus}=await import('../../src/rooms/furniture-glb-visual.js');
const {furnitureBox}=await import('../../src/rooms/furniture-layout.js');
const {SOFA_VISUAL}=await import('../../src/rooms/furniture-visual-assets.js');
const bytes=readFileSync(new URL('../../assets/furniture/dorm-single-sofa-v1.glb',import.meta.url));
const previousFetch=globalThis.fetch;globalThis.fetch=async url=>{assert.equal(url,SOFA_VISUAL.url);return new Response(bytes,{headers:{'content-length':String(bytes.length)}});};
const app=new pc.AppBase({id:'sofa-null',width:100,height:100}),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(app.graphicsDevice?.canvas??{id:'sofa-null',width:100,height:100});
options.componentSystems=[pc.RenderComponentSystem];options.resourceHandlers=[pc.ContainerHandler];app.init(options);
const load=app.assets.load.bind(app.assets);let loads=0;
app.assets.load=asset=>{if(asset.file?.url===SOFA_VISUAL.url){loads++;}return load(asset);};
const object=(id,x=0,yaw=0)=>({id,itemId:SOFA_VISUAL.itemId,surface:'floor',x,z:0,yaw});
const frame=async()=>{await new Promise(r=>setTimeout(r,25));app.fire('postrender');};
const meshes=e=>e.findComponents('render').flatMap(c=>c.meshInstances).map(mi=>mi.mesh);
try{
 const root=new pc.Entity('room');app.root.addChild(root);const layer=createFurnitureLayer(app,root);
 const a=object('a'),b=object('b',2,90);layer.setObjects([a,b]);const originalBoxes=JSON.stringify(layer.obstacles);
 for(let i=0;i<80&&layer.visualStatus().objects.some(o=>o.state==='LOADING');i++)await frame();
 assert.deepEqual(layer.visualStatus().objects.map(o=>o.state),['GLB','GLB']);assert.equal(loads,1);assert.equal(furnitureAssetStatus(app)[0].refs,2);
 const ma=layer.root.findByName('placed_a').findByName('sofa_glb_visual'),mb=layer.root.findByName('placed_b').findByName('sofa_glb_visual');assert.notStrictEqual(ma,mb);assert.deepEqual(meshes(ma),meshes(mb));
 assert.equal(JSON.stringify(layer.obstacles),originalBoxes);assert.deepEqual(furnitureBox(a),{id:'a',minX:-.55,maxX:.55,minZ:-.39,maxZ:.39,minY:.025,maxY:.745});
 const resourceMeshes=meshes(ma);layer.setObjects([b]);await frame();assert.equal(loads,1,'synchronous rebuild shares retained source');await layer.whenVisualsReady();assert.ok(resourceMeshes.every(m=>m.vertexBuffer));
 layer.deactivate();await frame();assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(layer.root.findByName('sofa_procedural_fallback').enabled,true);
 assert.ok(resourceMeshes.every(m=>!m.vertexBuffer),'GLB buffers freed after final release');
 layer.activate();for(let i=0;i<80&&layer.visualStatus().objects.some(o=>o.state==='LOADING');i++)await frame();assert.equal(loads,2);assert.equal(layer.visualStatus().objects[0].state,'GLB');
 root.destroy();await frame();assert.deepEqual(furnitureAssetStatus(app),[]);
 // In-flight remove/account-clear and immediate replacement must not reinsert old hierarchy.
 const root2=new pc.Entity('next-account');app.root.addChild(root2);const next=createFurnitureLayer(app,root2);next.setObjects([a]);next.setObjects([]);for(let i=0;i<4;i++)await frame();assert.equal(next.root.children.length,0);assert.deepEqual(furnitureAssetStatus(app),[]);root2.destroy();
 for (const response of [()=>new Response('missing',{status:404}),()=>new Response('invalid glb')]) {
  globalThis.fetch=async()=>response();const failRoot=new pc.Entity('failed-room');app.root.addChild(failRoot);const failLayer=createFurnitureLayer(app,failRoot);failLayer.setObjects([a]);
  for(let i=0;i<30&&failLayer.visualStatus().objects[0].state==='LOADING';i++)await frame();
  assert.equal(failLayer.visualStatus().objects[0].state,'FALLBACK');assert.equal(failLayer.root.findByName('sofa_procedural_fallback').enabled,true);failRoot.destroy();await frame();assert.deepEqual(furnitureAssetStatus(app),[]);
 }
 console.log(JSON.stringify({status:'PASS',device:'NullGraphicsDevice',visualOrPerformancePass:false,engine:pc.version,loads,checks:['real GLB parser','two independent instances shared geometry','unchanged placement boxes','rotate/remove','deactivate frees buffers','reenter reload','late completion ignored']},null,2));
}finally{app.destroy();globalThis.fetch=previousFetch;}
