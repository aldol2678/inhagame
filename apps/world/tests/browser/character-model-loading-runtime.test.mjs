// Pinned PlayCanvas with real local GLBs and real entities/components. Null device only:
// this verifies parsing, ownership and pose behavior, not pixels or WebGL/WebGPU rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as pc from './node_modules/playcanvas/build/playcanvas.mjs';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'playcanvas'
    ? { url: pathToFileURL(realpathSync(new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url))).href, shortCircuit: true }
    : nextResolve(specifier, context);
} });
const { createCharacter } = await import('../../src/character-model.js');
hook.deregister();
const { createAssetAuthorityCanary } = await import('../../src/asset-authority-canary.js');
const { ASSET_OPTIMIZATION_SHADOW_STATUS } = await import('../../src/asset-optimization-shadow.js');
const URLS = { duck: '/assets/induck-v3.glb', dragon: '/assets/annyongi-flight-v1.glb' };
const flush = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, { canary = false, optimizedWait = null } = {}) {
  assert.equal(pc.version, '2.22.4');
  const canvas = { id: t.name, width: 16, height: 16, style: {}, addEventListener() {}, removeEventListener() {} };
  const app = new pc.AppBase(canvas), options = new pc.AppOptions();
  options.graphicsDevice = new pc.NullGraphicsDevice(canvas);
  options.componentSystems = [pc.RenderComponentSystem,pc.LightComponentSystem];
  options.resourceHandlers = [pc.ContainerHandler, pc.TextureHandler];
  app.init(options);
  t.after(() => app.destroy());
  const assets = {}, instances = [], pending = new Map();
  for (const kind of ['duck', 'dragon', ...(canary ? ['optimized'] : [])]) {
    const url = kind === 'optimized' ? '/test-only/optimized-duck.glb' : URLS[kind];
    // A separate canonical-byte clone is sufficient to exercise canary ownership, not
    // optimization equivalence. No production asset endpoint or online API is contacted.
    const bytes = readFileSync(new URL(`../../assets/${kind === 'dragon' ? 'annyongi-flight-v1' : 'induck-v3'}.glb`, import.meta.url));
    const asset = new pc.Asset(kind, 'container', { url, filename: url.split('/').at(-1),
      contents: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    app.assets.add(asset);
    assets[kind] = await new Promise((resolve, reject) => app.assets.loadFromUrl(url, 'container', (error, result) => error ? reject(error) : resolve(result)));
    const instantiate = asset.resource.instantiateRenderEntity.bind(asset.resource);
    asset.resource.instantiateRenderEntity = opts => {
      const entity = instantiate(opts), record = { entity, destroys: 0, kind };
      const destroy = entity.destroy.bind(entity);
      entity.destroy = () => { record.destroys += 1; destroy(); };
      instances.push(record); return entity;
    };
  }
  app.assets.loadFromUrl = (url, _kind, callback) => pending.set(url, callback);
  const player = new pc.Entity('RuntimePlayer'); app.root.addChild(player);
  const owner = canary ? createAssetAuthorityCanary({ app, enabled: true, percentage: 100,
    shadow: { optimizedUrlFor: () => '/test-only/optimized-duck.glb', observeResource: async () => ({ status: ASSET_OPTIMIZATION_SHADOW_STATUS.MATCH }) },
    optimizedLoader: async () => { if (optimizedWait) await optimizedWait; return assets.optimized; }
  }) : null;
  const character = createCharacter(app, player, { assetCanary: owner, assetCanarySubjectKey: 'null-runtime-test' });
  return { app, player, character, instances, assets,
    success(kind) { pending.get(URLS[kind])(null, assets[kind]); },
    fail(kind) { pending.get(URLS[kind])(new Error(`injected ${kind} failure`)); }
  };
}
function checkReleased(f) {
  assert.equal(f.player.children.length, 0);
  for (const record of f.instances) {
    assert.equal(record.destroys, 1, `${record.kind} destroyed exactly once`);
    assert.equal(record.entity.parent, null); assert.equal(record.entity.findComponents('render').length, 0);
  }
}
for (const failed of ['duck', 'dragon']) {
  test(`real GLBs: ${failed} failure preserves its sibling and releases every instance on player destruction`, async t => {
    const f = await fixture(t), good = failed === 'duck' ? 'dragon' : 'duck';
    f.fail(failed); await flush(); f.success(good); await f.character.ready;
    const loaded = f.player.findByName(good === 'duck' ? 'Induck_GLB_Visual' : 'Annyongi_GLB_Visual');
    assert.ok(loaded); assert.ok(loaded.findComponents('render').length > 0);
    f.character.setMounted(true); f.character.update(.1, { mounted: true, moving: true, grounded: false });
    assert.equal(loaded.enabled, true);
    if (good === 'dragon') assert.notEqual(loaded.getLocalPosition().y, 0);
    f.character.setCameraOccluded(true); assert.equal(loaded.enabled, false);
    f.character.setCameraOccluded(false); assert.equal(loaded.enabled, true);
    f.player.destroy(); checkReleased(f);
    assert.ok(f.assets[good].resource, 'shared container stays loaded');
  });
}
test('real GLB bad pivot is released without taking down the other model', async t => {
  const f = await fixture(t);
  const instantiate = f.assets.duck.resource.instantiateRenderEntity;
  f.assets.duck.resource.instantiateRenderEntity = options => {
    const entity = instantiate(options); entity.findByName('DuckLeg_L').name = 'invalid-test-pivot'; return entity;
  };
  f.success('dragon'); f.success('duck'); await f.character.ready;
  assert.equal(f.character.modelState, 'fallback'); assert.equal(f.character.dragonModelState, 'glb');
  assert.equal(f.instances.find(x => x.kind === 'duck').destroys, 1);
  f.player.destroy(); checkReleased(f);
});
test('real player disposal blocks pending load instances and attachment', async t => {
  const f = await fixture(t); f.player.destroy(); f.success('duck'); f.success('dragon');
  await f.character.ready; assert.equal(f.instances.length, 0); checkReleased(f);
});

test('real shared container instances survive another player being destroyed', async t => {
  const f = await fixture(t);
  f.success('duck'); f.success('dragon'); await f.character.ready;
  const other = new pc.Entity('OtherPlayer'); f.app.root.addChild(other);
  const character = createCharacter(f.app, other);
  f.success('duck'); f.success('dragon'); await character.ready;
  f.player.destroy();
  assert.equal(f.instances.length, 4);
  assert.ok(f.instances.slice(0, 2).every(record => record.destroys === 1));
  assert.ok(f.instances.slice(2).every(record => record.destroys === 0 && record.entity.parent === other));
  assert.ok(f.assets.duck.resource && f.assets.dragon.resource);
  character.setMounted(true); character.update(.1, { mounted: true, moving: true, grounded: false });
  assert.ok(other.findByName('Induck_GLB_Visual').findComponents('render').length > 0);
  assert.ok(other.findByName('Annyongi_GLB_Visual').findComponents('render').length > 0);
  other.destroy(); checkReleased(f);
});
test('real canary rollback after carrier failure keeps one canonical visual and no orphan clone', async t => {
  const f = await fixture(t, { canary: true }); f.fail('dragon'); f.success('duck'); await f.character.ready;
  assert.equal(f.character.assetCanary.authority, 'OPTIMIZED_CANARY');
  assert.equal(f.character.rollbackAssetCanary('NULL_RUNTIME').authority, 'CANONICAL');
  f.character.rollbackAssetCanary('REPEAT');
  assert.equal(f.player.children.filter(e => e.name === 'Induck_GLB_Visual').length, 1);
  f.character.update(.1, { mounted: false, moving: true, grounded: true });
  f.player.destroy(); checkReleased(f);
});
test('real canary disposal during asynchronous preparation releases both resulting clones', async t => {
  let release; const optimizedWait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { canary: true, optimizedWait });
  f.success('duck'); f.fail('dragon'); await flush(); f.player.destroy();
  assert.equal(f.instances[0].destroys, 1, 'pending canonical released before preparation resumes'); release();
  await f.character.ready; assert.equal(f.instances.length, 2); checkReleased(f);
  f.character.rollbackAssetCanary('AFTER_DESTROY'); checkReleased(f);
});


test('authored Annyongi anchor follows hover and bounded lean, with deployed rounded flight fans', async t => {
  const f=await fixture(t);f.success('duck');f.success('dragon');await f.character.ready;
  f.player.mountKind='annyongi';f.character.setMounted(true);
  const carrier=f.player.findByName('Annyongi_GLB_Visual'),duck=f.player.findByName('Induck_GLB_Visual');
  const anchor=carrier.findByName('RiderAnchor');assert.ok(anchor);
  for (const moving of [false,true]) {
    f.character.update(.19,{mounted:true,moving,grounded:false});
    const position=carrier.getWorldTransform().transformPoint(anchor.getLocalPosition());
    // Duck asset floor after the common HUMAN_HEIGHT normalization.
    const feetPoint=duck.getWorldTransform().transformPoint(new pc.Vec3(0,-1.195,0));
    const feet=feetPoint.y;
    assert.ok(Math.abs(feet-position.y)<1e-6,'rider floor follows authored anchor');
    assert.ok(Math.abs(feetPoint.z-position.z)<1e-6,'rider follows pitch in Z');
    assert.ok(Math.abs(carrier.getLocalEulerAngles().x)<=58.001);
    for(const name of ['DragonWing_L','DragonWing_R']) {
      const pivot=carrier.findByName(name);assert.equal(pivot.findComponents('render').length,1);
      assert.ok(pivot.getLocalEulerAngles().length()>1,'visible flight articulation');
    }
  }
  for(let i=0;i<60;i++)f.character.update(.05,{mounted:true,moving:false,grounded:true});
  assert.ok(Math.abs(carrier.getLocalPosition().y)<1e-6,'settled ground position');
  assert.ok(carrier.getLocalEulerAngles().length()<1e-5);
  f.character.setFirstPerson(true);assert.equal(carrier.enabled,false);assert.equal(duck.enabled,false);
  f.character.setFirstPerson(false);assert.equal(carrier.enabled,true);
  f.character.setMounted(false);f.character.update(.1,{mounted:false,moving:false,grounded:true});
  assert.equal(carrier.enabled,false);assert.ok(duck.enabled);
});

test('flight V2 exposes distinct hover/ascent/forward/descent, rejects teleport spikes and folds on ground', async t => {
  const f=await fixture(t);f.success('duck');f.success('dragon');await f.character.ready;
  f.player.mountKind='annyongi';f.character.setMounted(true);
  const carrier=f.player.findByName('Annyongi_GLB_Visual'),wing=carrier.findByName('DragonWing_R');
  function step({dy=0,dz=0,moving=false,grounded=false}={}) {
    const p=f.player.getLocalPosition();f.player.setLocalPosition(p.x,p.y+dy,p.z+dz);
    f.character.update(.05,{mounted:true,moving,grounded});
    assertHeadClear();
  }
  for(let i=0;i<30;i++)step();
  assert.equal(f.character.flightVisualState.mode,'hover');assert.ok(Math.abs(f.character.flightVisualState.deployment-.70)<.001);
  function assertHeadClear() {
    const inverse=carrier.findByName('FlightHeadPivot').getWorldTransform().clone().invert();
    const rider=f.player.findByName('Induck_GLB_Visual');let minimum=Infinity;
    for(const c of rider.findComponents('render'))for(const mi of c.meshInstances){
      const v=[];mi.mesh.getPositions(v);const matrix=new pc.Mat4().mul2(inverse,mi.node.getWorldTransform());
      for(let i=0;i<v.length;i+=3){const p=matrix.transformPoint(new pc.Vec3(v[i],v[i+1],v[i+2]));minimum=Math.min(minimum,(p.x/.69)**2+((p.y-.37)/.63)**2+((p.z-.07)/.52)**2);}
    }
    assert.ok(minimum>=1,`${f.character.flightVisualState.mode}: rider intersects head (${minimum})`);
  }
  assertHeadClear();
  const hover=[];for(let i=0;i<30;i++){step();hover.push(wing.getLocalEulerAngles().z);}
  assert.ok(Math.max(...hover)-Math.min(...hover)>20,'hover is visibly articulated');
  const ascent=[];for(let i=0;i<30;i++){step({dy:.4});ascent.push(wing.getLocalEulerAngles().z);}
  assert.equal(f.character.flightVisualState.mode,'ascend');assert.ok(Math.max(...ascent)-Math.min(...ascent)>55);
  assert.ok(f.character.flightVisualState.pitch < -31);assertHeadClear();
  for(let i=0;i<30;i++)step({dz:.3,moving:true});
  assert.equal(f.character.flightVisualState.mode,'forward');assert.ok(f.character.flightVisualState.pitch>57);assertHeadClear();
  for(let i=0;i<30;i++)step({dy:-.4});
  assert.equal(f.character.flightVisualState.mode,'descend');assert.ok(f.character.flightVisualState.pitch > 23);assertHeadClear();
  step({dy:100});assert.equal(f.character.flightVisualState.mode,'hover','teleport must not fake ascent');
  for(let i=0;i<30;i++)step({grounded:true});
  assert.equal(f.character.flightVisualState.mode,'ground');assert.ok(wing.getLocalScale().x<.25);
  assert.ok(Math.abs(f.character.flightVisualState.pitch)<.005);
  assert.ok(Math.abs(carrier.getLocalPosition().y)<.001);
});

test('night fill retains vertex palette and owns clones without changing source/world materials', async t => {
  const f=await fixture(t);f.success('duck');f.success('dragon');await f.character.ready;
  f.player.mountKind='annyongi';f.character.setMounted(true);
  const carrier=f.player.findByName('Annyongi_GLB_Visual');
  const material=carrier.findComponents('render')[0].meshInstances[0].material;
  const original=f.assets.dragon.resource.materials[0];
  assert.notEqual(material,original,'never mutate container/shared material');
  const fill=f.app.root.findByName('Annyongi_ReadabilityFill');assert.ok(fill);
  assert.equal(fill.findComponents('light').length,2);
  for(const light of fill.findComponents('light')){assert.equal(light.mask,256);assert.equal(light.castShadows,false);}
  assert.ok(carrier.findComponents('render').every(c=>c.meshInstances.every(mi=>(mi.mask&256)!==0)));
  assert.ok(f.player.findByName('Induck_GLB_Visual').findComponents('render').every(c=>c.meshInstances.every(mi=>(mi.mask&256)===0)));
  const old=original.emissiveIntensity;
  f.app.scene.ambientLight.set(.075,.095,.16);
  f.character.update(.05,{mounted:true,moving:false,grounded:false});
  assert.equal(material.emissiveMapVertexColor,true);assert.ok(material.emissiveIntensity>.065 && material.emissiveIntensity<=.07);
  assert.equal(original.emissiveIntensity,old);
  assert.equal(f.app.scene.ambientLight.r,.075,'world lighting unchanged');
  f.app.scene.ambientLight.set(.48,.54,.61);
  f.character.update(.05,{mounted:true,moving:false,grounded:false});
  assert.equal(material.emissiveIntensity,.045);assert.equal(material.diffuse.r,1);
  for(const light of fill.findComponents('light'))assert.equal(light.intensity,0);
  f.player.destroy();assert.equal(f.app.root.findByName('Annyongi_ReadabilityFill'),null,'last owner releases private lights');
});


test('tail morph geometry extends, glides and recurls continuously; instances own their weights', async t => {
 const f=await fixture(t);f.success('duck');f.success('dragon');await f.character.ready;
 f.player.mountKind='annyongi';f.character.setMounted(true);
 const carrier=f.player.findByName('Annyongi_GLB_Visual');
 const tails=['Tail','TailCloud'].map(n=>carrier.findByName(n).render.meshInstances[0]);
 const step=(mode,dt=1/60,clearance=Infinity)=>{
  const p=f.player.getLocalPosition();f.player.setLocalPosition(0,p.y+(mode==='ascend'?5*dt:mode==='descend'||mode==='landing'?-5*dt:0),p.z+(mode==='forward'?6*dt:0));
  const previous=f.character.flightVisualState;
  f.character.update(dt,{mounted:true,moving:mode==='forward',grounded:mode==='ground',flightClearance:clearance});
  const next=f.character.flightVisualState;
  assert.ok(Math.abs(next.pitch-previous.pitch)<9,'no body snap');
  next.tail.forEach((w,i)=>assert.ok(Math.abs(w-previous.tail[i])<.10,'no tail snap'));
  return next;
 };
 for(const mode of ['hover','ascend','forward','descend','landing','ground','hover']) {
  let pose;for(let i=0;i<180;i++)pose=step(mode,1/60,mode==='landing'?.1:Infinity);
  assert.equal(pose.mode,mode);
  for(const mi of tails) {
   assert.deepEqual(mi.morphInstance.morph.targets.map(t=>t.name),['TailAscend','TailForward','TailGlide']);
   pose.tail.forEach((w,i)=>assert.ok(Math.abs(mi.morphInstance.getWeight(i)-w)<1e-6));
  }
  if(mode==='forward') {
   assert.ok(pose.tail[1]>.999);assert.ok(pose.pitch>57);
   const mi=tails[1],base=[];mi.mesh.getPositions(base);
   const delta=mi.morphInstance.morph.targets[1].deltaPositions;
   // Vertex order is not a tail-tip contract after a mesh rebuild.
   // Transform the complete morphed cloud through its real world matrix,
   // then measure behind the player, independent of player translation/rotation.
   const transform=new pc.Mat4().mul2(f.player.getWorldTransform().clone().invert(),mi.node.getWorldTransform());
   let tipZ=Infinity;
   for(let i=0;i<base.length;i+=3) {
    const point=new pc.Vec3(base[i]+delta[i],base[i+1]+delta[i+1],base[i+2]+delta[i+2]);
    transform.transformPoint(point,point);tipZ=Math.min(tipZ,point.z);
   }
   assert.ok(tipZ < -3,'cloud tip genuinely extends behind the body');
   assert.ok(Math.abs(pose.pitch+pose.headPitch-12)<.01,'face remains forward, not nose-down');
  }
  if(mode==='hover'||mode==='ground')assert.ok(pose.tail.every(w=>w<.001),'curled source restored');
 }
 const other=f.assets.dragon.resource.instantiateRenderEntity();
 assert.ok(other.findByName('Tail').render.meshInstances[0].morphInstance.getWeight(1)===0,'shared asset weights untouched');other.destroy();
});
