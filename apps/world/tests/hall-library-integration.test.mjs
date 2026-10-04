import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HALL_FRONT} from '../src/basic-campus.js';
import {fillMainHallCandidate} from '../src/main-hall-candidate-geometry.js';
import {fillPhotoMainHallFacade} from '../src/photo-hall-library-geometry.js';

const capture=(fill,tier)=>{const faces=[];fill({quad:(color,...points)=>faces.push({color,points}),box(){}},tier);return faces;};
const local=([x,y,z])=>{const dx=x-(HALL_FRONT.a.x+HALL_FRONT.b.x)/2,dz=z-(HALL_FRONT.a.z+HALL_FRONT.b.z)/2;return[dx*HALL_FRONT.along.x+dz*HALL_FRONT.along.z,y,dx*HALL_FRONT.inward.x+dz*HALL_FRONT.inward.z];};

test('added first-row reveals and sills leave the entrance glazing unobstructed',()=>{
  const inherited=capture(fillPhotoMainHallFacade,'DETAIL').length;
  for(const face of capture(fillMainHallCandidate,'DETAIL').slice(inherited)){
    const points=face.points.map(local),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    if(Math.min(...ys)>=2.85)continue;
    assert.ok(Math.max(...xs)<=-1.75+1e-7||Math.min(...xs)>=1.75-1e-7,
      `extra detail crosses the entry opening: ${JSON.stringify(points)}`);
  }
});

test('combined NEAR and DETAIL contain no positive-area coplanar intersections',()=>{
  const planes=new Map(),overlaps=[];
  for(const tier of ['NEAR','DETAIL'])for(const [index,face]of capture(fillMainHallCandidate,tier).entries()){
    const points=face.points.map(local);
    const axis=[0,1,2].find(i=>points.every(p=>Math.abs(p[i]-points[0][i])<1e-7));
    assert.notEqual(axis,undefined);
    const uv=[0,1,2].filter(i=>i!==axis),rect=uv.map(i=>[Math.min(...points.map(p=>p[i])),Math.max(...points.map(p=>p[i]))]);
    assert.ok(rect.every(([a,b])=>b-a>1e-7));
    const key=`${axis}:${points[0][axis].toFixed(6)}`;
    for(const other of planes.get(key)||[])if(rect.every(([a,b],i)=>Math.min(b,other.rect[i][1])-Math.max(a,other.rect[i][0])>1e-7))overlaps.push(`${other.tier}:${other.index}/${tier}:${index}`);
    if(!planes.has(key))planes.set(key,[]);
    planes.get(key).push({rect,tier,index});
  }
  assert.deepEqual(overlaps,[]);
});

test('campus and place previews use the same explicit landmark selection before fade collection',()=>{
  const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
  const campus=read('campus-chunk-renderer.js'),preview=read('preview/place-scene-preview.js');
  for(const source of [campus,preview]){
    assert.match(source,/import\s*\{\s*buildCampusLandmarks\s*\}\s*from/);
    assert.doesNotMatch(source,/buildMainHallBlockout/,'legacy owner cannot also render selected IDs');
  }
  assert.match(campus,/buildCampusLandmarks\(base,chunk\.buildings,'BASE'\)/);
  assert.match(campus,/buildCampusLandmarks\(root,handle\.chunk\.buildings,tier\)/);
  assert.ok(campus.indexOf('buildCampusLandmarks(root')<campus.indexOf('const copies=new Map()'));
  assert.match(preview,/buildCampusLandmarks\(root, chunk\.buildings, tier\)/);
});
