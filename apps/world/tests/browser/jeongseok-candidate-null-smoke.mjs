import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';

const engineUrl=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engineUrl:specifier,context);}});
const pc=await import('playcanvas');
const api=await import('../../src/jeongseok-candidate-renderer.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const {buildMainHallBlockout}=await import('../../src/main-hall-blockout.js');
const {BUILDINGS,LIBRARY_ROOF_PARTS}=await import('../../src/basic-campus.js');
const {ROADVIEW_OBSTACLES,LIBRARY_APPROACHES}=await import('../../src/roadview-layout.js');
const ready=typeof api.buildJeongseokCandidate==='function';
const canvas={id:'jeongseok-candidate-test',width:64,height:64};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem];app.init(options);
const sourceBefore=JSON.stringify({BUILDINGS,LIBRARY_ROOF_PARTS,ROADVIEW_OBSTACLES,LIBRARY_APPROACHES});
const root=name=>{const e=new pc.Entity(name);app.root.addChild(e);return e;};
const instances=e=>e.findComponents('render').flatMap(r=>r.meshInstances);
const signature=e=>instances(e).map(m=>{
  const positions=[],normals=[],indices=[];m.mesh.getPositions(positions);m.mesh.getNormals(normals);m.mesh.getIndices(indices);
  return {name:m.node.name,positions,normals,indices,position:m.node.getLocalPosition().toArray(),scale:m.node.getLocalScale().toArray(),rotation:m.node.getLocalRotation().toArray(),material:m.material.id};
});

test('Jeongseok exposes a dedicated opt-in candidate without replacing the recovered geometry',()=>{
  assert.equal(typeof api.buildJeongseokCandidate,'function');
  assert.equal(api.JEONGSEOK_CANDIDATE.buildingId,'bldg_jungseok');
  assert.deepEqual(api.JEONGSEOK_CANDIDATE.tiers,['BASE','NEAR','DETAIL']);
  assert.equal(api.JEONGSEOK_CANDIDATE.coordinateSpace,'CANONICAL_CAMPUS_WORLD_UNITS');
  assert.equal(api.JEONGSEOK_CANDIDATE.collisionAuthority,'UNCHANGED_CANONICAL_SOURCE');
  assert.ok(Object.isFrozen(api.JEONGSEOK_CANDIDATE));
  assert.ok(Object.isFrozen(api.JEONGSEOK_CANDIDATE.tiers));
});

test('each LOD is mesh-for-mesh identical to the recovered #108 Jeongseok renderer',{skip:!ready},()=>{
  for(const tier of api.JEONGSEOK_CANDIDATE.tiers){
    const previous=root('Existing'),candidate=root('Candidate');
    buildMainHallBlockout(previous,['bldg_jungseok'],tier);
    const group=api.buildJeongseokCandidate(candidate,tier);
    assert.deepEqual(signature(group),signature(previous),tier);
    assert.deepEqual(group.getLocalPosition().toArray(),[0,0,0]);
    assert.deepEqual(group.getLocalScale().toArray(),[1,1,1]);
    assert.deepEqual(group.getLocalRotation().toArray(),[0,0,0,1]);
    previous.destroy();candidate.destroy();
  }
});

test('repeated activation owns exactly one group per parent and tier',{skip:!ready},()=>{
  const parent=root('Repeated');
  for(const tier of api.JEONGSEOK_CANDIDATE.tiers){
    const first=api.buildJeongseokCandidate(parent,tier),before=instances(parent).length;
    assert.equal(api.buildJeongseokCandidate(parent,tier),first);
    assert.equal(instances(parent).length,before,'no duplicate renders');
  }
  assert.equal(parent.children.length,3);parent.destroy();
});

test('destroy and rebuild release owned meshes while preserving shared materials',{skip:!ready},()=>{
  const parent=root('Recreate');let previous=null,materials=null,counts=null;
  for(let cycle=0;cycle<3;cycle++){
    const group=api.buildJeongseokCandidate(parent,'BASE'),meshes=instances(group);
    assert.notEqual(group,previous);
    const ids=meshes.map(m=>m.material.id);if(materials)assert.deepEqual(ids,materials);else materials=ids;
    const vertices=meshes.map(m=>m.mesh.vertexBuffer.numVertices);if(counts)assert.deepEqual(vertices,counts);else counts=vertices;
    const owned=meshes.filter(m=>m.node.render.type==='asset').map(m=>m.mesh);
    group.destroy();assert.equal(parent.children.length,0);
    for(const mesh of owned)assert.equal(mesh.vertexBuffer,null,'custom mesh is disposed');
    previous=group;
  }
  parent.destroy();
});

test('exclusive presentation test harness keeps one selected building during mode switches',{skip:!ready},()=>{
  const parent=root('SelectedPresentation');let active=null;
  const select=candidate=>{active?.destroy();active=new pc.Entity(candidate?'Candidate':'Legacy');parent.addChild(active);
    for(const tier of api.JEONGSEOK_CANDIDATE.tiers){if(candidate)api.buildJeongseokCandidate(active,tier);else buildMainHallBlockout(active,['bldg_jungseok'],tier);}
  };
  select(false);const expected=instances(parent).length;
  for(const mode of [true,false,true]){select(mode);assert.equal(parent.children.length,1);assert.equal(instances(parent).length,expected);}
  parent.destroy();
});

test('production reflected parent is applied once and canonical bounds are retained',{skip:!ready},()=>{
  for(const sign of [-1,1]){
    const parent=root('CoordinateFrame');parent.setLocalScale(1,1,sign);
    const group=api.buildJeongseokCandidate(parent,'BASE');assert.equal(group.worldScaleSign,sign);
    for(const mesh of instances(group)){
      const min=mesh.aabb.getMin(),max=mesh.aabb.getMax();
      assert.ok([...min.toArray(),...max.toArray()].every(Number.isFinite));
      assert.ok(min.y>=-1e-6&&max.y<=19.5+1e-5);
    }
    parent.destroy();
  }
  assert.equal(JSON.stringify({BUILDINGS,LIBRARY_ROOF_PARTS,ROADVIEW_OBSTACLES,LIBRARY_APPROACHES}),sourceBefore);
});

test('invalid tiers fail before adding an empty or duplicate scene root',{skip:!ready},()=>{
  const parent=root('Invalid');
  for(const tier of ['FAR','',null,1])assert.throws(()=>api.buildJeongseokCandidate(parent,tier),/tier/i);
  assert.equal(parent.children.length,0);parent.destroy();
});

test('new adapter stays out of production bootstrap and creates no new collider or light',{skip:!ready},()=>{
  for(const entry of ['main.js','campus-chunk-renderer.js']){
    assert.doesNotMatch(readFileSync(new URL('../../src/'+entry,import.meta.url),'utf8'),/jeongseok-candidate-renderer/);
  }
  const parent=root('Scope');for(const tier of api.JEONGSEOK_CANDIDATE.tiers)api.buildJeongseokCandidate(parent,tier);
  assert.equal(parent.findComponents('collision').length,0);assert.equal(parent.findComponents('light').length,0);
  assert.ok(!parent.findByName('bldg_01'),'main hall is not rendered by the Jeongseok adapter');parent.destroy();
});

test.after(()=>app.destroy());
