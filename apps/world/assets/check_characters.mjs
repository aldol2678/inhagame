import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inspectGlb} from './check_equipment.mjs';
const duck=inspectGlb(readFileSync(new URL('induck-v3.glb',import.meta.url)),'induck-v3.glb').gltf;
assert.equal(duck.asset.generator,'INHAGAME independent QA cuboids v1');
for(const pivot of ['DuckWing_L','DuckWing_R','DuckLeg_L','DuckLeg_R'])assert.ok(duck.nodes.some(n=>n.name===pivot));
assert.ok(duck.meshes.every(m=>m.name.startsWith('qa_')));
export function checkAnnyongi(bytes) {
 const {gltf,bounds}=inspectGlb(bytes,'Annyongi');
 assert.equal(gltf.asset.generator,'INHAGAME Annyongi procedural flight reconstruction v2.3');
 assert.equal(gltf.nodes[gltf.scenes[gltf.scene].nodes[0]].name,'Annyongi_Root');
 const names=['Body','Head','Horn_L','Horn_R','Ear_L','Ear_R','Eye_L','Eye_R','Cheek_L','Cheek_R','Mouth','Fang_L','Fang_R','Forelock','Belly','BellyBands','Arm_L','Arm_R','Leg_L','Leg_R','Tail','TailCloud','CloudWing_L','CloudWing_R','FlightWing_L','FlightWing_R'];
 for(const name of names)assert.ok(gltf.nodes.some(n=>n.name===name && Number.isInteger(n.mesh)),name);
 for(const name of ['DragonWing_L','DragonWing_R','RiderAnchor']) {
  const node=gltf.nodes.find(n=>n.name===name);assert.ok(node,name);assert.equal(node.mesh,undefined);if(name==='RiderAnchor')assert.ok(!node.children?.length);
  else assert.ok(node.children?.some(i=>gltf.nodes[i].name===name.replace('Dragon','Flight')),`${name}: animated fan`);
 }
 const head=gltf.nodes.find(n=>n.name==='FlightHeadPivot');assert.ok(head?.children.some(i=>gltf.nodes[i].name==='Head'));
 for(const name of ['Tail','TailCloud']) {
  const mesh=gltf.meshes[gltf.nodes.find(n=>n.name===name).mesh];
  assert.deepEqual(mesh.extras.targetNames,['TailAscend','TailForward','TailGlide']);
  assert.deepEqual(mesh.weights,[0,0,0]);
  const primitive=mesh.primitives[0];assert.equal(primitive.targets.length,3);
  for(const target of primitive.targets)for(const key of ['POSITION','NORMAL'])assert.equal(gltf.accessors[target[key]].count,gltf.accessors[primitive.attributes[key]].count);
  assert.ok(gltf.accessors[primitive.targets[1].POSITION].min[1]<-1.7,'forward tail genuinely extends');
 }
 assert.equal(gltf.materials.length,1);assert.equal(gltf.materials[0].pbrMetallicRoughness.metallicFactor,0);
 assert.ok(gltf.materials[0].pbrMetallicRoughness.roughnessFactor>=.8);
 const triangles=gltf.meshes.reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+gltf.accessors[p.indices].count/3,0),0);
 assert.ok(triangles>=4000 && triangles<=13000,`triangle budget: ${triangles}`);
 assert.ok(bytes.length<450000,'byte budget');assert.ok(bounds.min[1]>=-1.17,'feet bound');
 for(const m of gltf.meshes)for(const p of m.primitives){
  assert.ok(p.attributes.COLOR_0!==undefined,`${m.name}: palette`);
  const normal=gltf.accessors[p.attributes.NORMAL],view=gltf.bufferViews[normal.bufferView],bin=28+bytes.readUInt32LE(12);
  for(let i=0;i<normal.count;i++){
   const length=Math.hypot(...[0,1,2].map(k=>bytes.readFloatLE(bin+view.byteOffset+i*12+k*4)));
   assert.ok(Number.isFinite(length)&&Math.abs(length-1)<1e-5,`${m.name}: unit normal`);
  }
 }
 return {gltf,bounds,triangles};
}
const bytes=readFileSync(new URL('annyongi-flight-v1.glb',import.meta.url));
const result=checkAnnyongi(bytes);
const manifest=JSON.parse(readFileSync(new URL('../../../ASSET_PROVENANCE.json',import.meta.url)));
const provenance=manifest.assets.find(a=>a.path==='apps/world/assets/annyongi-flight-v1.glb');
assert.equal(provenance.sha256,createHash('sha256').update(bytes).digest('hex'));
assert.equal(provenance.textureUsage,'none');assert.equal(provenance.approvalStatus,'design-review-pending');
console.log(`Character assets PASS; Annyongi ${result.triangles} triangles, 1 material, no textures`);
