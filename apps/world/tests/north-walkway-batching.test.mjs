import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupWalkwayPavingByProfile,walkwayLinearColor } from '../src/north-walkway-batching.js';
import { fillWalkwayPaving } from '../src/north-walkway-geometry.js';
import { inferCampusMaterialProfile } from '../src/campus-material-profile.js';
const capture=()=>{const groups=new Map();fillWalkwayPaving({triangle(c,...p){let g=groups.get(c);if(!g){g={positions:[],normals:[],indices:[]};groups.set(c,g);}const start=g.positions.length/3;g.positions.push(...p.flat());g.normals.push(0,1,0,0,1,0,0,1,0);g.indices.push(start,start+1,start+2);}});return groups;};
test('north paving batches five colors into three identical material profiles without deleting any triangle',()=>{
 const source=capture(),merged=groupWalkwayPavingByProfile(source);assert.equal(source.size,5);assert.equal(merged.length,3);
 assert.deepEqual(merged.map(g=>g.profile).sort(),['brick','concrete','metal']);
 let vertices=0,triangles=0;
 for(const g of merged){
  const originals=[...source].filter(([c])=>inferCampusMaterialProfile(c)===g.profile);
  assert.deepEqual(g.positions,originals.flatMap(([,s])=>s.positions));assert.deepEqual(g.normals,originals.flatMap(([,s])=>s.normals));
  let offset=0;const indices=[];for(const [,s]of originals){indices.push(...s.indices.map(i=>i+offset));offset+=s.positions.length/3;}
  assert.deepEqual(g.indices,indices);assert.equal(g.colors.length,g.positions.length/3*4);
  let i=0;for(const [color,s]of originals)for(let j=0;j<s.positions.length/3;j++,i++)assert.deepEqual(g.colors.slice(i*4,i*4+4),walkwayLinearColor(color));
  vertices+=g.positions.length/3;triangles+=g.indices.length/3;
 }
 assert.equal(vertices,[...source.values()].reduce((n,g)=>n+g.positions.length/3,0));
 assert.equal(triangles,[...source.values()].reduce((n,g)=>n+g.indices.length/3,0));
});
test('float vertex colors use exactly the pinned engine diffuse-uniform transfer, not byte RGB',()=>{
 assert.deepEqual(walkwayLinearColor('#000000'),[0,0,0,1]);assert.deepEqual(walkwayLinearColor('#ffffff'),[1,1,1,1]);
 assert.deepEqual(walkwayLinearColor('#808080'),[Math.fround((128/255)**2.2),Math.fround((128/255)**2.2),Math.fround((128/255)**2.2),1]);
 assert.notEqual(walkwayLinearColor('#808080')[0],128/255);assert.throws(()=>walkwayLinearColor('gray'));
 const source=capture();source.set('#548d99',source.values().next().value);assert.throws(()=>groupWalkwayPavingByProfile(source),/Unreviewed/);
});
test('production paving restores five shared per-color material owners without profile clones',()=>{
 const renderer=readFileSync(new URL('../src/north-walkway-renderer.js',import.meta.url),'utf8');
 assert.ok(renderer.includes("fillNorthRoads(new FacilityMeshBatch()).finish(root,'north_campus_roads',{castShadows:false})"));
 for(const forbidden of ['groupWalkwayPavingByProfile','mesh.setColors','surface(','material.clone','new pc.Mesh'])assert.ok(!renderer.includes(forbidden),forbidden);
 const wiring=readFileSync(new URL('../src/campus-road-blockout.js',import.meta.url),'utf8');assert.ok(wiring.includes('buildNorthWalkwayRoads(root)'));
});

test('added exact-pixel gate runs independently after the unchanged performance comparison',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/north-walkway-browser.yml',import.meta.url),'utf8');
 assert.ok(workflow.indexOf('Performance regression gate')<workflow.indexOf('Exact original-versus-batched paving pixel parity'));
 assert.ok(workflow.includes('north-walkway-pixel-parity.mjs test-results/north-walkway/after/report.json'));
 const parity=readFileSync(new URL('./browser/north-walkway-pixel-parity.mjs',import.meta.url),'utf8');
 for(const contract of ['assert.equal(measured.head,head','optimized.length!==5','length!==5','v.changedPixels===0&&v.unstablePixels===0','assert.equal(report.views.length,24)','castShadows:false'])assert.ok(parity.includes(contract),contract);
 assert.ok(!parity.includes('continue-on-error'));assert.ok(!workflow.includes('continue-on-error'));
});

test('pixel evidence retains real A/B/difference captures and A/A plus reversed B/A controls',()=>{
 const p=readFileSync(new URL('./browser/north-walkway-pixel-parity.mjs',import.meta.url),'utf8');
 for(const s of ['production:png(before)','reference:png(legacy)','difference:png(delta)','v.controlPixels===0','v.reversePixels===0','coordinates'])assert.ok(p.includes(s),s);
});

test('heap diagnostics are supplemental after timed views and cannot change comparator budgets',()=>{
 const smoke=readFileSync(new URL('./browser/north-walkway-smoke.mjs',import.meta.url),'utf8');
 assert.ok(smoke.indexOf('HeapProfiler.collectGarbage')>smoke.indexOf('report.views.push'));
 assert.ok(smoke.includes('OBSERVED_NOT_LEAK_PROOF'));
 const compare=readFileSync(new URL('./browser/north-walkway-compare.mjs',import.meta.url),'utf8');
 assert.ok(!compare.includes('heapDiagnostics'));assert.ok(compare.includes('heapRatio:1.15'));assert.ok(compare.includes('p95Ratio:1.15,p95SlackMs:2'));
});
