import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectGlb} from './check_equipment.mjs';
for(const [name,pivots] of [['induck-v3.glb',['DuckWing_L','DuckWing_R','DuckLeg_L','DuckLeg_R']],['annyongi-flight-v1.glb',['DragonWing_L','DragonWing_R']]]){
 const {gltf}=inspectGlb(readFileSync(new URL(name,import.meta.url)),name);
 assert.equal(gltf.asset.generator,'INHAGAME independent QA cuboids v1');
 for(const pivot of pivots)assert.ok(gltf.nodes.some(n=>n.name===pivot));
 assert.ok(gltf.meshes.every(m=>m.name.startsWith('qa_')));
}
console.log('Independent character QA asset structure PASS');
