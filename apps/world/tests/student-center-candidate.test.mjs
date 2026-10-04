import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {FACILITIES,FACILITY_COLLIDERS} from '../src/campus-facilities.js';
import {STUDENT_TERRACES} from '../src/roadview-layout.js';
import {studentCenterFrontPoint} from '../src/student-center-front.js';
const url=new URL('../src/student-center-candidate.js',import.meta.url);
const m=existsSync(url)?await import(url.href):{};
const f=FACILITIES.find(f=>f.id==='bldg_07');
test('combined candidate exposes a bounded, opt-in existing-batch adapter',()=>{
 assert.equal(typeof m.fillStudentCenterCandidate,'function');
 assert.equal(m.STUDENT_CANDIDATE?.status,'ISOLATED_CANDIDATE_NOT_PRODUCTION');
});
test('source-derived massing has six stepped levels, rounded core and sixteen exterior stairs',()=>{
 const data=m.STUDENT_CANDIDATE?.primitives||[];
 for(const [name,p,size] of [['SC3_Shell',[-2,12.3,-15],[45,3.9,21]],['SC4_Shell',[2,16,-17],[37,3.4,17]],['SC5_Shell',[5,19,-18.5],[29,2.6,14]],['SC6_Shell',[7,21.5,-19.5],[23,2.1,11]]]){
  const v=data.find(v=>v.name===name);assert.ok(v,name);assert.deepEqual(v.position,p);assert.deepEqual(v.size,size);
 }
 assert.equal(data.filter(v=>/^ExtStep\d+$/.test(v.name)).length,16);
 assert.equal(data.find(v=>v.name==='RoundedCoreTower')?.radius,4.6);
 assert.equal(data.filter(v=>v.section==='interior1').length>50,true);
 assert.equal(data.filter(v=>v.section==='interior2').length>60,true);
});
test('mapping uses current anchor and scale, is right-handed and round-trips without baking render reflection',()=>{
 assert.equal(typeof m.studentCandidateFrame,'function');const a=m.studentCandidateFrame(f);
 assert.deepEqual(a.toWorld([0,0,0]),[f.center.x,0,f.center.z]);
 assert.ok(Math.abs(a.determinant-1)<1e-10);
 for(const p of [[0,4,11],[-30,8,-10],[27.8,9,-5.8]])a.toLocal(a.toWorld(p)).forEach((v,i)=>assert.ok(Math.abs(v-p[i])<1e-9));
 const p=a.toWorld([0,0,2]),edge=STUDENT_TERRACES[0].frame,base=edge.at(0,0),normal=edge.at(0,1);
 assert.ok(Math.abs(p[0]-f.center.x-(normal.x-base.x))<1e-10);
 assert.ok(Math.abs(p[2]-f.center.z-(normal.z-base.z))<1e-10);
 assert.equal(a.toWorld([0,4,0])[1],2);
});
test('candidate has finite bounded BASE/NEAR/DETAIL geometry and source-photo colors',()=>{
 assert.equal(typeof m.fillStudentCenterCandidate,'function');
 const counts={};
 for(const tier of ['BASE','NEAR','DETAIL']){
 const commands=[];const batch={box:(...a)=>commands.push(['box',...a]),tube:(...a)=>commands.push(['tube',...a]),quad:(...a)=>commands.push(['quad',...a]),triangle:(...a)=>commands.push(['triangle',...a])};
 m.fillStudentCenterCandidate(batch,tier,{space:'local'});counts[tier]=commands.length;
 for(const c of commands){const flat=c.flat(Infinity);assert.ok(flat.filter(v=>typeof v==='number').every(Number.isFinite));}
 assert.ok(commands.length<600);
 }
 assert.ok(counts.BASE>10);assert.ok(counts.NEAR>10);assert.equal(counts.DETAIL,0);
});
test('historical walk model climbs and descends sixteen exterior steps and supports the terrace',()=>{
 assert.equal(typeof m.stepStudentCandidateWalk,'function');let s={level:0,elevation:0};
 for(let z=30;z>=3;z-=.2){s=m.stepStudentCandidateWalk(s,0,z);assert.equal(s.blocked,false,`outside stair z=${z}`);}
 assert.equal(s.level,4);assert.equal(s.elevation,4);
 for(let z=3;z<=30;z+=.2)s=m.stepStudentCandidateWalk(s,0,z);
 assert.equal(s.level,0);assert.equal(s.elevation,0);
});
test('historical walk model climbs Core A, separates floors and blocks walls/upper rails',()=>{
 assert.equal(typeof m.stepStudentCandidateWalk,'function');let s={level:0,elevation:0};
 for(let z=0;z>=-16;z-=.2){s=m.stepStudentCandidateWalk(s,-24,z);assert.equal(s.blocked,false);}
 assert.equal(s.level,4);assert.equal(s.elevation,4);
 assert.equal(m.stepStudentCandidateWalk({level:4,elevation:4},20,12).blocked,true);
 assert.equal(m.stepStudentCandidateWalk({level:0,elevation:0},20,12).blocked,false);
 assert.equal(m.stepStudentCandidateWalk({level:0,elevation:0},-3.25,0).blocked,true);
 assert.equal(m.stepStudentCandidateWalk({level:4,elevation:4},-3.25,0).blocked,false);
});
test('candidate never mutates canonical facilities, terrace/shop anchors or production factory',()=>{
 const before=JSON.stringify({FACILITIES,FACILITY_COLLIDERS,terraces:STUDENT_TERRACES.map(t=>({id:t.id,height:t.height,steps:t.steps})),front:studentCenterFrontPoint()});
 if(m.fillStudentCenterCandidate)m.fillStudentCenterCandidate({box(){},tube(){},quad(){},triangle(){}},'BASE');
 assert.equal(JSON.stringify({FACILITIES,FACILITY_COLLIDERS,terraces:STUDENT_TERRACES.map(t=>({id:t.id,height:t.height,steps:t.steps})),front:studentCenterFrontPoint()}),before);
 assert.doesNotMatch(readFileSync(new URL('../src/facility-blockout.js',import.meta.url),'utf8'),/student-center-candidate/);
});

test('source photo identities stay red-left/glass-right after production reflection',()=>{
 const a=m.studentCandidateFrame(f),n=a.toWorld([0,0,2]),center=a.toWorld([0,0,0]),tangent=a.toWorld([2,0,0]);
 // View toward the front. Apply production reflection to scene and camera once.
 const front=[n[0]-center[0],n[2]-center[2]];
 const screenX=(local,sign)=>{const p=a.toWorld(local),right=[front[1]*sign,-front[0]];return (p[0]-center[0])*right[0]+(p[2]-center[2])*sign*right[1];};
 assert.ok(screenX([27.8,9,-5.8],-1)<0,'red core screen-left');
 assert.ok(screenX([-30,8.4,-10],-1)>0,'rounded core screen-right');
 assert.ok(screenX([27.8,9,-5.8],1)>0,'control reverses once');
 assert.ok(screenX([-30,8.4,-10],1)<0);
 assert.ok(Math.abs(Math.hypot(tangent[0]-center[0],tangent[2]-center[2])-1)<1e-9);
});
test('unchanged candidate is explicitly not safe to bind to existing production envelope',()=>{
 assert.match(m.STUDENT_CANDIDATE.status,/NOT_PRODUCTION/);
 assert.equal(f.height,13);
 const h=Math.max(...m.STUDENT_CANDIDATE.primitives.filter(p=>p.section==='exterior').map(p=>p.position[1]+(p.size?.[1]||p.height)/2));
 assert.equal(h,22.55);assert.notEqual(h/2,f.height);
 assert.equal(STUDENT_TERRACES[0].height,.6);assert.notEqual(4/2,STUDENT_TERRACES[0].height);
});
test('photo core surfaces face outward and rounded panels stay outside source core facets',()=>{
 const quads=[];m.fillStudentCenterCandidate({box(){},tube(){},quad:(color,...points)=>quads.push({color,points})},'NEAR',{space:'local'});
 const normal=([a,b,c])=>{const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
 const red=quads.filter(q=>q.points.every(p=>p[0]>20));assert.equal(red.length,6);
 for(const q of red){const n=normal(q.points);assert.ok(n[0]>0||n[2]>0,'red parapets face outward');for(const [x,,z] of q.points){assert.ok(x>=27.17&&x<=28.43&&z>=-7.93&&z<=-3.67,'parapets attached to source red slab');}}
 const rounded=quads.filter(q=>q.color==='#355d62');assert.ok(rounded.length>20);
 for(const q of rounded){const [a,b]=q.points,mid=[(a[0]+b[0])/2,(a[2]+b[2])/2];assert.ok(Math.hypot(mid[0]+30,mid[1]+10)>4.6,'pane midpoint outside core radius at any facet rotation');const n=normal(q.points);assert.ok(n[0]*(mid[0]+30)+n[2]*(mid[1]+10)>0);}
});
test('rounded pane chords remain outside the core after world-frame rotation',()=>{
 const q=[];m.fillStudentCenterCandidate({box(){},tube(){},quad:(color,...v)=>{if(color==='#355d62')q.push(v)}},'NEAR',{space:'world'});
 const center=m.studentCandidateFrame().toWorld([-30,0,-10]);assert.ok(q.length>20);
 for(const [a,b] of q)assert.ok(Math.hypot((a[0]+b[0])/2-center[0],(a[2]+b[2])/2-center[2])>2.3);
});
test('isolated walk support rejects inherited phantom upper floor and wide stair support',()=>{
 assert.equal(m.stepStudentCandidateWalk({level:4,elevation:4},-30,-27).blocked,true,'no floor outside real terrace/cafe/core slabs');
 const outside=m.stepStudentCandidateWalk({level:0,elevation:0},7.5,16);assert.ok(outside.blocked||outside.elevation===0,'no floating beside twelve-meter stair');
 assert.equal(m.stepStudentCandidateWalk({level:0,elevation:0},6.5,19).blocked,true,'solid exterior stair cheek');
});
