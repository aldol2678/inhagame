import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BUILDINGS,HALL_FRONT,MAIN_ENTRANCE} from '../src/basic-campus.js';
import {OBSTACLES} from '../src/campus-layout.js';
import {MAIN_HALL_APPROACH} from '../src/roadview-layout.js';
import {fillPhotoMainHallFacade} from '../src/photo-hall-library-geometry.js';

const api=await import('../src/main-hall-candidate-geometry.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const ready=typeof api.fillMainHallCandidate==='function';
const capture=(fill,tier)=>{const result=[];fill({quad:(color,...points)=>result.push({kind:'quad',color,points}),box:(color,position,size,yaw)=>result.push({kind:'box',color,position,size,yaw})},tier);return result;};
const local=([x,y,z])=>{const dx=x-(HALL_FRONT.a.x+HALL_FRONT.b.x)/2,dz=z-(HALL_FRONT.a.z+HALL_FRONT.b.z)/2;return[dx*HALL_FRONT.along.x+dz*HALL_FRONT.along.z,y,dx*HALL_FRONT.inward.x+dz*HALL_FRONT.inward.z];};
const before=JSON.stringify({BUILDINGS,HALL_FRONT,MAIN_ENTRANCE,OBSTACLES,MAIN_HALL_APPROACH});
const normal=face=>{const[a,b,c]=face.points.map(local),u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);return[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};

test('main hall candidate is a pure bounded variant of the existing owner',()=>{
 assert.equal(typeof api.fillMainHallCandidate,'function');
 assert.equal(api.MAIN_HALL_CANDIDATE.buildingId,'bldg_01');
 assert.equal(api.MAIN_HALL_CANDIDATE.status,'ISOLATED_EXTERIOR_CANDIDATE');
 assert.equal(api.MAIN_HALL_CANDIDATE.interior,false);
 assert.equal(api.MAIN_HALL_CANDIDATE.windowRows,'inherited-four-row-estimate');
 assert.ok(Object.isFrozen(api.MAIN_HALL_CANDIDATE));
});
test('DETAIL includes each inherited #108 quad exactly once before physical depth cues',{skip:!ready},()=>{
 const inherited=capture(fillPhotoMainHallFacade,'DETAIL'),detail=capture(api.fillMainHallCandidate,'DETAIL');
 assert.deepEqual(detail.slice(0,inherited.length),inherited);
 assert.ok(detail.length>inherited.length+90&&detail.length<inherited.length+230,'bounded reveals and core collars');
 for(const old of inherited)assert.equal(detail.filter(face=>JSON.stringify(face)===JSON.stringify(old)).length,1,'no duplicated inherited pane');
});
test('candidate BASE keeps nine source piers and old full facade envelope',{skip:!ready},()=>{
 const base=capture(api.fillMainHallCandidate,'BASE'),piers=base.filter(p=>p.kind==='box'&&p.size[0]===.65&&p.size[1]===9.7);
 assert.equal(piers.length,9);
 for(const p of piers){assert.ok(Math.abs(local(p.position)[2]+.18)<1e-7);assert.equal(p.size[2],.6);}
 for(const p of base){assert.equal(p.kind,'box');const[u,y,v]=local(p.position);assert.ok(Math.abs(u)+p.size[0]/2<=HALL_FRONT.length/2+.625+1e-7);assert.ok(y-p.size[1]/2>=.25-1e-7&&y+p.size[1]/2<=10.97+1e-7);assert.ok(v-p.size[2]/2>=-1.0-1e-7&&v+p.size[2]/2<=.7+1e-7);}
 const high=base.filter(p=>Math.abs(p.position[1]+p.size[1]/2-10.97)<1e-7);
 assert.equal(high.length,2,'two raised end-core caps inside the old coping maximum');
});
test('DETAIL/NEAR projections fit inside original columns and never create an interior',{skip:!ready},()=>{
 for(const tier of ['DETAIL','NEAR'])for(const p of capture(api.fillMainHallCandidate,tier)){
  assert.equal(p.kind,'quad');for(const point of p.points){assert.ok(point.every(Number.isFinite));const[u,y,v]=local(point);assert.ok(Math.abs(u)<=HALL_FRONT.length/2+1e-7);assert.ok(y>=.2-1e-7&&y<=9.9+1e-7);assert.ok(v>=-.5-1e-7&&v<=-.01+1e-7);}
 }
 const near=capture(api.fillMainHallCandidate,'NEAR');assert.ok(near.length>12&&near.length<40);
 for(const q of near)for(const p of q.points){const[u,y]=local(p);assert.ok(Math.abs(u)<=1.75+1e-7&&y<=2.85+1e-7);}
});
test('candidate geometry is deterministic, explicit-tier only, and source authority is immutable',{skip:!ready},()=>{
 for(const tier of ['BASE','NEAR','DETAIL'])assert.deepEqual(capture(api.fillMainHallCandidate,tier),capture(api.fillMainHallCandidate,tier));
 assert.throws(()=>capture(api.fillMainHallCandidate,'UNKNOWN'),/tier/i);
 assert.equal(JSON.stringify({BUILDINGS,HALL_FRONT,MAIN_ENTRANCE,OBSTACLES,MAIN_HALL_APPROACH}),before);
});
test('window reveal normals face into each recess',{skip:!ready},()=>{
 const inherited=capture(fillPhotoMainHallFacade,'DETAIL').length;
 const first=capture(api.fillMainHallCandidate,'DETAIL').slice(inherited,inherited+4);
 for(const [i,axis,sign]of [[0,0,1],[1,0,-1],[2,1,1],[3,1,-1]])assert.ok(normal(first[i])[axis]*sign>0,`reveal ${i} faces its cavity`);
});
test('existing building owner has mutually exclusive opt-in base/detail/entry paths',()=>{
 const source=readFileSync(new URL('../src/main-hall-blockout.js',import.meta.url),'utf8');
 assert.match(source,/mainHallDetail\s*=\s*'existing'/);
 assert.match(source,/mainHallDetail==='candidate'/);
 assert.match(source,/fillMainHallCandidate\(/);
 const entrySource=readFileSync(new URL('../src/campus-chunk-renderer.js',import.meta.url),'utf8');
 assert.doesNotMatch(entrySource,/buildMainHallCandidate|mainHallDetail\s*:\s*'candidate'/,'no default campus activation');
});
