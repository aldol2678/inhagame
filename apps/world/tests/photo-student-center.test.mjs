import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {FACILITIES,FACILITY_COLLIDERS} from '../src/campus-facilities.js';
import {fillNeutralCampusBuilding} from '../src/neutral-campus-buildings.js';
import {photoLandmarkView} from './browser/photo-landmarks-views.js';
const url=new URL('../src/photo-student-center.js',import.meta.url);
const mod=existsSync(url)?await import(url.href):{};
const f=FACILITIES.find(f=>f.id==='bldg_07');
const capture=(tier)=>{const faces=[];mod.fillPhotoStudentCenter?.({quad:(color,...vertices)=>faces.push({color,vertices}),triangle:(color,...vertices)=>faces.push({color,vertices})},f,tier);return faces;};
const normal=([a,b,c])=>{const u=b.map((v,i)=>v-a[i]),v=c.map((w,i)=>w-a[i]);return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
const edgeIndex=vertices=>f.rings[0].findIndex((a,i)=>{const b=f.rings[0][(i+1)%f.rings[0].length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);return vertices.every(([x,,z])=>Math.abs((x-a.x)*dz-(z-a.z)*dx)<1e-6*len&&(x-a.x)*dx+(z-a.z)*dz>=-1e-6&&(x-b.x)*dx+(z-b.z)*dz<=1e-6);});

test('student photo refinement has an explicit bounded rendering entry point',()=>{assert.equal(typeof mod.fillPhotoStudentCenter,'function');assert.equal(typeof mod.PHOTO_STUDENT_COLORS,'object');});
test('student retains every source wall and roof with its existing height and footprint',()=>{
 const before=JSON.stringify({FACILITIES,FACILITY_COLLIDERS}),faces=capture('BASE'),baseline=[];
 fillNeutralCampusBuilding({quad:(color,...vertices)=>baseline.push(vertices),triangle:(color,...vertices)=>baseline.push(vertices)},f,'BASE');
 assert.ok(faces.length>0);assert.deepEqual(faces.map(face=>face.vertices),baseline);
 assert.equal(new Set(faces.map(f=>f.color)).size,2);
 assert.equal(JSON.stringify({FACILITIES,FACILITY_COLLIDERS}),before);
});
test('opposite student end markers are asymmetric on the existing photographed edge chain',()=>{
 const c=mod.PHOTO_STUDENT_COLORS||{},faces=capture('NEAR');
 const red=faces.filter(f=>f.color===c.stairRed),glass=faces.filter(f=>f.color===c.glass);
 assert.ok(red.length>0,'muted red stair end');assert.ok(red.every(f=>[0,1].includes(edgeIndex(f.vertices))));
 assert.ok(glass.some(face=>[6,7,8].includes(edgeIndex(face.vertices))&&Math.max(...face.vertices.map(p=>p[1]))-Math.min(...face.vertices.map(p=>p[1]))>f.height*.5),'opposite rounded bay has vertical glazing');
 const zigzags=faces.filter(f=>f.color===c.trim&&[0,1].includes(edgeIndex(f.vertices)));
 assert.ok(zigzags.some(f=>Math.abs(f.vertices[0][1]-f.vertices.at(-1)[1])>.4),'white zigzag changes height along red stair end');
});
test('two upper ribbons, dark terrace recesses and selective warm panes are represented',()=>{
 const c=mod.PHOTO_STUDENT_COLORS||{},faces=capture('NEAR');
 for(const edge of [2,3,4,5]){
   const ribbons=faces.filter(face=>face.color===c.glass&&edgeIndex(face.vertices)===edge&&Math.min(...face.vertices.map(p=>p[1]))>f.height*.6);
   assert.equal(ribbons.length,2,`edge ${edge}: two continuous upper ribbon bands`);
 }
 assert.ok(faces.some(f=>f.color===c.recess),'terrace shadow band');
 const warm=faces.filter(f=>f.color===c.warmWindow);assert.ok(warm.length>0&&warm.length<20,'selective window accents, not all emissive');
});
test('photo surfaces have finite outward winding, bounded height and no added volumes or tiers',()=>{
 const faces=capture('NEAR');assert.ok(faces.length>0);assert.ok(faces.length<550,'bounded near faces');
 assert.ok(new Set(faces.map(f=>f.color)).size<=6,'shared near materials');
 const signed=f.rings[0].reduce((s,a,i)=>{const b=f.rings[0][(i+1)%f.rings[0].length];return s+a.x*b.z-b.x*a.z;},0);
 for(const face of faces){
   const edge=edgeIndex(face.vertices);assert.ok(edge>=0,'exact footprint boundary');
   const a=f.rings[0][edge],b=f.rings[0][(edge+1)%f.rings[0].length],n=normal(face.vertices),out=signed>0?[b.z-a.z,-(b.x-a.x)]:[-(b.z-a.z),b.x-a.x];
   assert.ok(n[0]*out[0]+n[2]*out[1]>0,'front faces outward');
   for(const p of face.vertices){assert.ok(p.every(Number.isFinite));assert.ok(p[1]>=0&&p[1]<=f.height);}
   const reflected=normal(face.vertices.map(([x,y,z])=>[x,y,-z]));assert.ok(reflected[0]*out[0]+reflected[2]*-out[1]<0,'negative-Z root reverses winding exactly once');
 }
 assert.deepEqual(capture('DETAIL'),[]);assert.deepEqual(capture('FAR'),[]);
});
test('runtime branches to the photo renderer only for student center after manifest validation',()=>{
 const source=readFileSync(new URL('../src/facility-blockout.js',import.meta.url),'utf8');
 assert.match(source,/fillPhotoStudentCenter/);
 assert.match(source,/f\.id\s*===\s*['"]bldg_07['"]/);
 assert.ok(source.indexOf('resolveWorldForgeBuilding(f)')<source.indexOf('fillPhotoStudentCenter(envelope'));
});

test('production negative-Z view keeps the photographed red end left and rounded glass end right',()=>{
 const c=mod.PHOTO_STUDENT_COLORS,faces=capture('NEAR');
 const red=faces.filter(face=>face.color===c.stairRed).flatMap(face=>face.vertices);
 const rounded=faces.filter(face=>face.color===c.glass&&[6,7,8].includes(edgeIndex(face.vertices))).flatMap(face=>face.vertices);
 const mean=points=>points.reduce((sum,p)=>sum.map((v,i)=>v+p[i]/points.length),[0,0,0]);
 for(const aspect of [390/844,844/390,1280/720]){
  const {position,target}=photoLandmarkView('bldg_07',aspect);
  const screenX=(point,sign)=>{const right=[-(target[2]-position[2])*sign,0,target[0]-position[0]];return (point[0]-target[0])*right[0]+(point[2]-target[2])*sign*right[2];};
  assert.ok(screenX(mean(red),-1)<0);assert.ok(screenX(mean(rounded),-1)>0);
  assert.ok(screenX(mean(red),1)>0);assert.ok(screenX(mean(rounded),1)<0,'control flips exactly once');
 }
});
