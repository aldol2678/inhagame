// Actual engine integration for a single presentation owner per building/tier.
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const engineUrl=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engineUrl:specifier,context);}});
const pc=await import('playcanvas');
const {selectCampusLandmark}=await import('../../src/campus-landmark-candidate-selector.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
assert.equal(typeof selectCampusLandmark,'function','a working shared selector binds both candidates');
const canvas={id:'campus-landmark-selection-null',width:512,height:512},app=new pc.AppBase(canvas),options=new pc.AppOptions();options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem];app.init(options);
const ids=['bldg_01','bldg_jungseok'],tiers=['BASE','NEAR','DETAIL'];
const fingerprint=group=>group.findComponents('render').flatMap(r=>r.meshInstances).map(m=>createHash('sha256').update(new Uint8Array(m.mesh.vertexBuffer.storage)).digest('hex'));
const counts={},sources=new Set();
for(let cycle=0;cycle<3;cycle++){
 const root=new pc.Entity('LandmarkSelection');app.root.addChild(root);root.setLocalScale(1,1,-1);
 for(const id of ids)for(const tier of tiers){
  const existing=selectCampusLandmark(root,id,tier),original=fingerprint(existing);assert.equal(existing.parent,root);
  assert.ok(selectCampusLandmark(root,id,tier,{mode:'existing'})===existing);
  const candidate=selectCampusLandmark(root,id,tier,{mode:'candidate'});assert.ok(candidate!==existing&&candidate.parent===root);
  assert.ok(!root.children.includes(existing),'old variant is no longer attached');
  assert.equal(root.children.filter(c=>c.name===`${id}_presentation_${tier}`).length,1,'one presentation owner per tier');
  assert.ok(selectCampusLandmark(root,id,tier,{mode:'candidate'})===candidate,'repeat does not duplicate');
  root.removeChild(candidate);assert.equal(candidate.parent,null);assert.ok(selectCampusLandmark(root,id,tier,{mode:'candidate'}).parent===root,'detached selection remounts');
  const restored=selectCampusLandmark(root,id,tier,{mode:'existing'});assert.deepEqual(fingerprint(restored),original,'candidate → legacy exactly restores original geometry');
  const selected=selectCampusLandmark(root,id,tier,{mode:'candidate'}),meshes=selected.findComponents('render').flatMap(r=>r.meshInstances);
  counts[`${id}:${tier}`]={meshes:meshes.length,vertices:meshes.reduce((s,m)=>s+m.mesh.vertexBuffer.numVertices,0)};
  for(const m of meshes){if(!cycle)sources.add(m.material);else assert.ok(sources.has(m.material),'source materials shared across presentation swaps');}
  if(id==='bldg_jungseok')assert.deepEqual(fingerprint(selected),original,'Jeongseok adapter reuses existing complete model');
  // Per-tier destroy/recreate cannot return an already-destroyed root.
  selected.destroy();const recreated=selectCampusLandmark(root,id,tier,{mode:'candidate'});assert.ok(recreated!==selected&&recreated.parent===root);
 }
 assert.equal(root.children.length,6,'two buildings, three tiers, each selected once');
 for(const[id,tier,mode]of [['bad','BASE','candidate'],['bldg_01','FAR','candidate'],['bldg_01','BASE','both']])assert.throws(()=>selectCampusLandmark(root,id,tier,{mode}),/Unsupported/);
 assert.equal(root.children.length,6,'invalid input preserves existing scene');
 const base=root.findByName('bldg_01_presentation_BASE'),names=base.findComponents('render').map(r=>r.entity.name);assert.ok(!names.includes('hall_front_entablature'));assert.equal(names.filter(n=>n.startsWith('hall_candidate_base_')).length,1);
 root.destroy();
}
console.log(JSON.stringify({engine:pc.version,device:'NullGraphicsDevice (no pixels)',cycles:3,buildingTierCases:6,counts,exclusiveSelection:true,legacyRestore:true,detachRecreate:true,sourceMaterialReuse:true}));app.destroy();
