import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FISHING_SPOTS } from '../src/activity/fishing-spots.js';
import { fishingWaterTarget } from '../src/activity/fishing-visuals.js';
const module = await import('../src/activity/fishing-renderer.js').catch(() => null);
test('PlayCanvas fishing render adapter exists', () => assert.ok(module));
class Vec3 { constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); } set(x,y,z){Object.assign(this,{x,y,z});return this;} copy(v){return this.set(v.x,v.y,v.z);} }
class Material {
  constructor() { this.emissive = new Vec3(); this.diffuse = new Vec3(); this.emissiveMapTiling = new Vec3();
    this.opacityMapTiling = new Vec3(); this.emissiveMapOffset = new Vec3(); this.opacityMapOffset = new Vec3(); }
  clone() { return new Material(); } update() {} destroy() { this.destroyed = true; }
}
class Entity {
  constructor(name) { Object.assign(this,{name, children:[],enabled:true,position:new Vec3(),scale:new Vec3(1,1,1),euler:new Vec3()}); }
  addChild(c){c.parent=this;this.children.push(c);} removeChild(c){this.children=this.children.filter(x=>x!==c);c.parent=null;}
  setLocalPosition(x,y,z){if(typeof x==='object')this.position.copy(x);else this.position.set(x,y,z);}
  setLocalScale(x,y,z){this.scale.set(x,y,z);} setLocalEulerAngles(x,y,z){this.euler.set(x,y,z);} setLocalRotation(){}
  getLocalEulerAngles(){return this.euler;} getPosition(){return this.position;} getLocalPosition(){return this.position;}
  getWorldTransform(){return {transformPoint:(v,out)=>out.copy(v)};} lookAt(){}
  addComponent(type, options){this[type]={...options, meshInstances:[{material:new Material()}]};}
  findByName(name){return this.name===name?this:this.children.map(c=>c.findByName(name)).find(Boolean);}
  findComponents(type){return [...(this[type]?[this[type]]:[]),...this.children.flatMap(c=>c.findComponents(type))];}
  destroy(){this.destroyed=true;this.parent?.removeChild(this);for(const c of [...this.children])c.destroy();}
}
class Quat { setFromMat4(){return this;} }
class Mat4 { mul2(){return this;} setFromEulerAngles(){return this;} copy(){return this;} invert(){return this;} transformPoint(v,out){return out.copy(v);} }
const pc={ Entity, Vec3, Mat4, Quat, Color:Vec3, StandardMaterial:Material, BLEND_NORMAL:2, CULLFACE_NONE:0,
  ADDRESS_CLAMP_TO_EDGE:1, FILTER_LINEAR:1 };
function harness() {
  const parent=new Entity('Campus'), player=new Entity('Player'), frame=new Entity('Equipment_Frame');
  parent.addChild(player);player.addChild(frame);
  const modelRequests=[], textureRequests=[], sharedMaterials=[], lines=[];
  const app={assets:{loadFromUrl(url,type,cb){textureRequests.push({url,type,cb});}},drawLine(...args){lines.push(args);}};
  const loader=id=>new Promise((resolve,reject)=>modelRequests.push({id,resolve,reject}));
  const view=module.createFishingRenderView({pc,app,parent,player,frame,camera:new Entity('Camera'),loadModel:loader});
  const scene={phase:'WAITING',spot:FISHING_SPOTS[0],target:fishingWaterTarget(FISHING_SPOTS[0]),showFish:false,
    castProgress:1,reelProgress:0,rippleFrame:3,splashFrame:null,floatOffset:0};
  function settle() {
    for(const q of modelRequests){const e=new Entity(q.id);e.addComponent('render',{});const material=e.render.meshInstances[0].material;
      sharedMaterials.push(material);const socket=new Entity(q.id==='rod'?'Line_Tip':q.id==='float'?'Line_Attach':'Catch_Line');
      socket.setLocalPosition(0,0,q.id==='fish'?.137:0);e.addChild(socket);q.entity=e;q.resolve(e);}
    for(const q of textureRequests){q.texture={};q.cb(null,{resource:q.texture});}
  }
  return {parent,player,frame,view,scene,modelRequests,textureRequests,sharedMaterials,lines,settle};
}
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
if(module) {
  test('owns a separate activity grip, converts metres exactly once and reuses each loaded model',async()=>{
    const r=harness();await flush();r.settle();await flush();r.view.render(r.scene);
    assert.deepEqual(r.modelRequests.map(q=>q.id),['rod','float','fish']);
    const grip=r.frame.findByName('Activity_Grip_R');assert.ok(grip);assert.deepEqual(Object.values(grip.scale),[1,1,1]);
    for(const q of r.modelRequests)assert.deepEqual(Object.values(q.entity.scale),[.5,.5,.5]);
    for(let i=0;i<50;i++)r.view.render(r.scene);assert.equal(r.modelRequests.length,3);
    assert.equal(r.modelRequests[2].entity.enabled,false);assert.ok(r.lines.length>0);
    assert.equal(r.frame.children.length,1);
  });
  test('enables COLOR_0 only on owned material clones and owns no registry resources',async()=>{
    const r=harness();await flush();r.settle();await flush();r.view.render(r.scene);
    const clones=r.modelRequests.map(q=>q.entity.render.meshInstances[0].material);
    clones.forEach((material,i)=>{assert.notEqual(material,r.sharedMaterials[i]);assert.equal(material.diffuseVertexColor,true);});
    r.view.destroy();r.view.destroy();assert.ok(clones.every(m=>m.destroyed));
    assert.ok(r.sharedMaterials.every(m=>!m.destroyed));assert.ok(r.textureRequests.every(q=>!q.texture.destroyed));
    assert.equal(r.frame.children.length,0);
  });
  test('late model and texture responses after close/account/dispose cannot reattach or leak',async()=>{
    const r=harness();await flush();r.view.destroy();r.settle();await flush();
    assert.ok(r.modelRequests.every(q=>q.entity.destroyed));assert.equal(r.frame.children.length,0);
    assert.equal(r.parent.children.length,1);r.view.render(r.scene);assert.equal(r.lines.length,0);
  });
  test('atlas animation uses inset top-left row-major UVs, straight alpha, depth test and no depth write',async()=>{
    const r=harness();await flush();r.settle();await flush();r.view.render({...r.scene,rippleFrame:4,splashFrame:2});
    const ripple=r.parent.findByName('Fishing_Ripple');const m=ripple.render.material;
    assert.equal(m.depthWrite,false);assert.equal(m.depthTest,true);assert.equal(m.blendType,pc.BLEND_NORMAL);
    assert.ok(m.emissiveMapOffset.x>0&&m.emissiveMapOffset.x<.01);
    assert.ok(m.emissiveMapOffset.y>0&&m.emissiveMapOffset.y<.01);
    assert.ok(m.emissiveMapTiling.x<.25);assert.ok(m.emissiveMapTiling.y<.5);
    assert.equal(ripple.enabled,true);
    r.view.render({...r.scene,splashFrame:null});assert.equal(r.parent.findByName('Fishing_Splash').enabled,false);
    r.textureRequests.forEach(q=>{assert.equal(q.texture.mipmaps,false);assert.equal(q.texture.srgb,true);});
  });
  test('a model failure is cosmetic and destroys only the activity subtree',async()=>{
    const r=harness();await flush();r.modelRequests[0].reject(new Error('missing'));await flush();
    r.view.render(r.scene);r.view.destroy();assert.equal(r.frame.destroyed,undefined);assert.equal(r.player.destroyed,undefined);
  });
  test('main wiring observes existing fishing state and browser/scene/character lifecycle',()=>{
    const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
    assert.match(main,/createFishingRenderer\(/);assert.match(main,/fishingVisuals\.setOpen\(open\)/);
    assert.match(main,/fishingVisuals\.destroy\(\)/);assert.match(main,/fishingVisuals\.setSuppressed/);
  });
}

test('partial model material setup destroys the rejected instance and only its partial clones', async () => {
  const r=harness();await flush();r.settle();
  r.modelRequests[0].entity.render.meshInstances.push({ material:new Material() });
  const clone=Material.prototype.clone, made=[];let count=0;
  Material.prototype.clone=function(){if(++count===2)throw new Error('clone failed');const m=new Material();made.push(m);return m;};
  try { await flush(); } finally { Material.prototype.clone=clone; }
  assert.equal(r.modelRequests[0].entity.destroyed,true);
  assert.equal(made[0].destroyed,true);
  assert.ok(!r.view.status().loaded.includes('rod'));
  assert.ok(r.sharedMaterials.every(m=>!m.destroyed));r.view.destroy();
});

test('synchronous texture setup failure rolls back both roots and cancels unstarted model loads', async () => {
  const parent=new Entity('Campus'),player=new Entity('Player'),frame=new Entity('Equipment_Frame');
  parent.addChild(player);player.addChild(frame);let loads=0;
  assert.throws(()=>module.createFishingRenderView({pc,parent,player,frame,camera:new Entity('Camera'),
    app:{ assets:{ loadFromUrl(){throw new Error('texture setup failed');} } },
    loadModel(){loads++;return Promise.resolve(new Entity('model'));}
  }),/texture setup failed/);
  await flush();assert.equal(loads,0);assert.equal(frame.children.length,0);assert.equal(parent.children.length,1);
});
