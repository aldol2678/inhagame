import test from 'node:test';
import assert from 'node:assert/strict';
import {indexWalkwayPavingGroup,indexWalkwayPavingGroups} from '../src/north-walkway-indexing.js';
import {fillWalkwayPaving} from '../src/north-walkway-geometry.js';
const quad=()=>({positions:[0,0,0,1,0,0,1,0,1,0,0,0,1,0,1,0,0,1],normals:[0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0],indices:[0,1,2,3,4,5]});
const bits=value=>new Uint32Array(new Float32Array([value]).buffer)[0];
const expanded=g=>g.indices.flatMap(i=>[...g.positions.slice(i*3,i*3+3),...g.normals.slice(i*3,i*3+3)].map(bits));
const capture=()=>{
 const groups=new Map();
 fillWalkwayPaving({triangle(color,a,b,c){
  let g=groups.get(color);if(!g){g={positions:[],normals:[],indices:[]};groups.set(color,g);}
  const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);if(len<1e-9)return;
  const offset=g.positions.length/3;g.positions.push(...a,...b,...c);
  for(let i=0;i<3;i++)g.normals.push(...n.map(x=>x/len));
  g.indices.push(offset,offset+1,offset+2);
 }});return groups;
};
test('indexed paving reuses exact vertices without triangle order or winding changes',()=>{
 const source=quad(),snapshot=structuredClone(source),indexed=indexWalkwayPavingGroup(source);
 assert.equal(indexed.positions.length/3,4);assert.deepEqual(indexed.indices,[0,1,2,0,2,3]);assert.deepEqual(expanded(indexed),expanded(source));assert.deepEqual(source,snapshot);
 for(const key of ['positions','normals','indices'])assert.notEqual(indexed[key],source[key]);
 const reversed=structuredClone(indexed);[reversed.indices[1],reversed.indices[2]]=[reversed.indices[2],reversed.indices[1]];
 assert.notDeepEqual(expanded(reversed),expanded(source));assert.deepEqual(indexWalkwayPavingGroup(source),indexed);
});
test('float32-equal attributes share a vertex while signed zero remains distinct',()=>{
 const source=quad();source.positions[9]=2**-150;
 const indexed=indexWalkwayPavingGroup(source);assert.equal(indexed.indices[0],indexed.indices[3]);assert.deepEqual(expanded(indexed),expanded(source));
 source.positions[9]=-0;const signed=indexWalkwayPavingGroup(source);
 assert.notEqual(signed.indices[0],signed.indices[3]);assert.ok(Object.is(signed.positions[signed.indices[3]*3],-0));assert.deepEqual(expanded(signed),expanded(source));
 source.positions[9]=0;source.normals[9]=-0;const normalSigned=indexWalkwayPavingGroup(source);
 assert.notEqual(normalSigned.indices[0],normalSigned.indices[3]);assert.deepEqual(expanded(normalSigned),expanded(source));
});
test('normal discontinuities duplicate triangles and unused distinct vertices remain',()=>{
 const source=quad();source.normals[10]=-1;const indexed=indexWalkwayPavingGroup(source);
 assert.notEqual(indexed.indices[0],indexed.indices[3]);assert.deepEqual(expanded(indexed),expanded(source));
 const repeated=quad();repeated.indices.push(0,1,2);const result=indexWalkwayPavingGroup(repeated);
 assert.equal(result.indices.length,9);assert.deepEqual(expanded(result),expanded(repeated));
 const unused=quad();unused.positions.push(20,30,40);unused.normals.push(0,1,0);const preserved=indexWalkwayPavingGroup(unused);
 assert.deepEqual(preserved.positions.slice(-3),[20,30,40]);assert.deepEqual(expanded(preserved),expanded(unused));
});
test('typed arrays use the same deterministic bitwise representation',()=>{
 const source=quad(),typed={positions:new Float64Array(source.positions),normals:new Float32Array(source.normals),indices:new Uint16Array(source.indices)};
 assert.deepEqual(indexWalkwayPavingGroup(typed),indexWalkwayPavingGroup(source));
});
test('invalid and non-finite attributes fail closed',()=>{
 for(const value of [NaN,Infinity,-Infinity,1e100])for(const key of ['positions','normals']){const source=quad();source[key][0]=value;assert.throws(()=>indexWalkwayPavingGroup(source),/finite float32/);}
 for(const index of [-1,.5,6,NaN,Infinity]){const source=quad();source.indices[0]=index;assert.throws(()=>indexWalkwayPavingGroup(source),/Invalid paving index/);}
 for(const mutate of [g=>g.positions.pop(),g=>g.normals.pop(),g=>g.indices.pop(),g=>{g.positions=[];g.normals=[];g.indices=[];},g=>{g.positions=null;}]){const source=quad();mutate(source);assert.throws(()=>indexWalkwayPavingGroup(source),/Malformed/);}
 assert.throws(()=>indexWalkwayPavingGroup({...quad(),colors:[]}),/Expected only/);assert.throws(()=>indexWalkwayPavingGroup(null),/Expected only/);
});
test('actual paving keeps five independent color groups and exact expanded triangle bits',()=>{
 const source=capture(),snapshot=structuredClone(source),indexed=indexWalkwayPavingGroups(source);
 assert.equal(source.size,5);assert.equal(indexed.size,5);assert.deepEqual([...indexed.keys()],[...source.keys()]);
 let before=0,after=0,triangles=0;
 for(const [color,g]of source){const compact=indexed.get(color);assert.deepEqual(expanded(compact),expanded(g),color);assert.equal(compact.indices.length,g.indices.length,color);assert.ok(compact.positions.length<=g.positions.length,color);before+=g.positions.length/3;after+=compact.positions.length/3;triangles+=g.indices.length/3;}
 assert.ok(after<before);assert.equal(triangles,379);assert.deepEqual(source,snapshot);assert.deepEqual(indexWalkwayPavingGroups(source),indexed);assert.equal(new Set([...indexed.values()].map(g=>g.positions)).size,5);
});
test('group admission rejects missing unknown colors without source mutation',()=>{
 const source=capture(),snapshot=structuredClone(source);assert.throws(()=>indexWalkwayPavingGroups({}),/five reviewed/);
 const missing=new Map(source);missing.delete('#777f80');assert.throws(()=>indexWalkwayPavingGroups(missing),/five reviewed/);
 missing.set('#000000',quad());assert.throws(()=>indexWalkwayPavingGroups(missing),/five reviewed/);assert.deepEqual(source,snapshot);
});
