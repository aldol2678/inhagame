import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BUILDINGS,HALL_FRONT,LIBRARY_FRONT,LIBRARY_ROOF_PARTS} from '../src/basic-campus.js';
import {ROADVIEW_OBSTACLES,LIBRARY_APPROACHES,MAIN_HALL_APPROACH} from '../src/roadview-layout.js';

const api=await import('../src/photo-hall-library-geometry.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const ready=typeof api.fillPhotoMainHallFacade==='function';
const before=JSON.stringify({BUILDINGS,HALL_FRONT,LIBRARY_ROOF_PARTS,ROADVIEW_OBSTACLES,LIBRARY_APPROACHES,MAIN_HALL_APPROACH});
const capture=run=>{const faces=[];run({quad:(color,...vertices)=>faces.push({color,vertices})});return faces;};
const normal=([a,b,c])=>{
  const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
  return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
};
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-7,`${message}: ${a} != ${b}`);
const hallLocal=([x,y,z])=>{
  const dx=x-(HALL_FRONT.a.x+HALL_FRONT.b.x)/2,dz=z-(HALL_FRONT.a.z+HALL_FRONT.b.z)/2;
  return [dx*HALL_FRONT.along.x+dz*HALL_FRONT.along.z,y,dx*HALL_FRONT.inward.x+dz*HALL_FRONT.inward.z];
};
const origin=LIBRARY_FRONT.at(0,0),unit=LIBRARY_FRONT.at(1,0),tx=unit.x-origin.x,tz=unit.z-origin.z;
const libraryLocal=([x,y,z])=>[(x-origin.x)*tx+(z-origin.z)*tz,y,-(x-origin.x)*tz+(z-origin.z)*tx];
const glassColors=()=>new Set([api.PHOTO_HALL_LIBRARY_COLORS.glass,api.PHOTO_HALL_LIBRARY_COLORS.darkGlass,api.PHOTO_HALL_LIBRARY_COLORS.litGlass]);

test('photo refinement exposes pure batched hall, curtain-wall and roof builders',()=>{
  for(const name of ['fillPhotoMainHallFacade','fillPhotoLibraryFront','fillPhotoLibraryRoof'])assert.equal(typeof api[name],'function',name);
  assert.ok(Object.isFrozen(api.PHOTO_HALL_LIBRARY_COLORS));
});

test('hall refinement stays in DETAIL and preserves the existing front envelope', {skip:!ready},()=>{
  for(const tier of ['BASE','NEAR','UNKNOWN'])assert.deepEqual(capture(b=>api.fillPhotoMainHallFacade(b,tier)),[]);
  const faces=capture(b=>api.fillPhotoMainHallFacade(b,'DETAIL'));
  assert.ok(faces.length>150&&faces.length<600,'bounded pane/joint detail');
  for(const face of faces){
    for(const p of face.vertices){
      assert.ok(p.every(Number.isFinite));
      const [u,y,v]=hallLocal(p);
      assert.ok(Math.abs(u)<=HALL_FRONT.length/2+1e-7);
      assert.ok(y>=.25&&y<=10.01);
      assert.ok(v>=-.5&&v<0,'front dressing stays inside existing pier projection');
    }
    const n=normal(face.vertices);
    assert.ok(n[0]*-HALL_FRONT.inward.x+n[2]*-HALL_FRONT.inward.z>0,'front is outward-facing');
  }
  assert.deepEqual(capture(b=>api.fillPhotoMainHallFacade(b,'DETAIL')),faces,'deterministic');
});

test('hall uses selective color panes and two framed tall glass strips', {skip:!ready},()=>{
  const faces=capture(b=>api.fillPhotoMainHallFacade(b,'DETAIL')),colors=api.PHOTO_HALL_LIBRARY_COLORS;
  const glass=faces.filter(f=>glassColors().has(f.color)),lit=glass.filter(f=>f.color===colors.litGlass);
  assert.ok(lit.length>0&&lit.length<glass.length*.18,'sparse lit accents');
  assert.ok(glass.some(f=>f.color===colors.darkGlass),'unlit panes');
  for(const side of [-1,1]){
    const strip=glass.filter(f=>f.vertices.every(p=>hallLocal(p)[0]*side>HALL_FRONT.length*.35));
    assert.ok(strip.length>=24,'fine tall-strip pane grid');
    close(Math.min(...strip.flatMap(f=>f.vertices.map(p=>p[1]))),.55,'existing glass bottom');
    close(Math.max(...strip.flatMap(f=>f.vertices.map(p=>p[1]))),9.65,'existing glass top');
  }
  assert.ok(faces.filter(f=>f.color===colors.joint).length>=100,'pale pier cladding has fine horizontal joints');
});

test('hall pane, mullion and cladding rectangles do not overlap on the same plane', {skip:!ready},()=>{
  const rectangles=capture(b=>api.fillPhotoMainHallFacade(b,'DETAIL')).map(face=>{
    const points=face.vertices.map(hallLocal);
    return {u0:Math.min(...points.map(p=>p[0])),u1:Math.max(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),y1:Math.max(...points.map(p=>p[1])),v:points[0][2]};
  });
  for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
    const a=rectangles[i],b=rectangles[j];
    if(Math.abs(a.v-b.v)>1e-7)continue;
    const width=Math.min(a.u1,b.u1)-Math.max(a.u0,b.u0),height=Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0);
    assert.ok(width<1e-7||height<1e-7,`coincident facade area ${i}/${j}`);
  }
});

test('library curtain glass and denser mullions remain in their existing tier and bounds', {skip:!ready},()=>{
  const base=capture(b=>api.fillPhotoLibraryFront(b,'BASE'));
  const detail=capture(b=>api.fillPhotoLibraryFront(b,'DETAIL'));
  assert.deepEqual(capture(b=>api.fillPhotoLibraryFront(b,'NEAR')),[]);
  assert.equal(base.length,7*6,'seven existing closed glass bays');
  // Horizontal seams are split at vertical mullions, avoiding overlapping quads.
  assert.ok(detail.length>=100&&detail.length<320,'fine curtain-wall grid');
  assert.ok(detail.every(f=>f.color===api.PHOTO_HALL_LIBRARY_COLORS.mullion));
  for(const face of [...base,...detail])for(const p of face.vertices){
    const [u,y,v]=libraryLocal(p);
    assert.ok(Math.abs(u)<=6.3+1e-7&&y>=1-1e-7&&y<=15+1e-7&&v>=0&&v<.64);
  }
  for(const face of detail){const n=normal(face.vertices);assert.ok(-n[0]*tz+n[2]*tx>0,'mullions face the observed front');}
});

test('curved library roof replaces its box within the exact source roof volume', {skip:!ready},()=>{
  const part=LIBRARY_ROOF_PARTS.find(p=>p.id==='library_overhanging_roof');
  const faces=capture(b=>api.fillPhotoLibraryRoof(b,part,'BASE'));
  assert.ok(faces.length>=40&&faces.length<=60,'bounded closed segmented cap');
  const vertices=faces.flatMap(f=>f.vertices).map(libraryLocal),ys=vertices.map(p=>p[1]);
  for(const [u,y,v] of vertices){
    assert.ok(u>=part.u-part.width/2-1e-7&&u<=part.u+part.width/2+1e-7);
    assert.ok(v>=part.v-part.depth/2-1e-7&&v<=part.v+part.depth/2+1e-7);
    assert.ok(y>=part.y-part.height/2-1e-7&&y<=part.y+part.height/2+1e-7);
  }
  close(Math.min(...ys),part.y-part.height/2,'same roof minimum');
  close(Math.max(...ys),part.y+part.height/2,'same roof maximum');
  const tops=faces.filter(f=>normal(f.vertices)[1]>1e-8),bottoms=faces.filter(f=>normal(f.vertices)[1]<-1e-8);
  assert.equal(tops.length,12);assert.equal(bottoms.length,12);
  const topPoints=tops.flatMap(f=>f.vertices).map(libraryLocal);
  const center=Math.max(...topPoints.filter(p=>Math.abs(p[0]-part.u)<1e-7).map(p=>p[1]));
  const tip=Math.max(...topPoints.filter(p=>Math.abs(p[0]-part.u)>part.width/2-.01).map(p=>p[1]));
  assert.ok(tip-center>.2,'both ends turn up visibly within the existing height budget');
  const areaSum=faces.reduce((sum,f)=>normal(f.vertices).map((v,i)=>sum[i]+v),[0,0,0]);
  for(const n of areaSum)close(n,0,'closed outward-wound roof');
  for(const tier of ['NEAR','DETAIL'])assert.deepEqual(capture(b=>api.fillPhotoLibraryRoof(b,part,tier)),[]);
});

test('warm canopy soffit is a tiled replacement inside the existing canopy, not an inferred side', {skip:!ready},()=>{
  const part=LIBRARY_ROOF_PARTS.find(p=>p.id==='library_entry_canopy');
  const faces=capture(b=>api.fillPhotoLibraryRoof(b,part,'BASE'));
  const underside=faces.filter(f=>normal(f.vertices)[1]<-1e-8);
  assert.ok(underside.length>=16,'warm panel grid');
  assert.ok(underside.some(f=>f.color===api.PHOTO_HALL_LIBRARY_COLORS.soffit));
  assert.ok(underside.some(f=>f.color===api.PHOTO_HALL_LIBRARY_COLORS.soffitJoint));
  close(underside.reduce((s,f)=>s-normal(f.vertices)[1],0),part.width*part.depth,'soffit has no overlapping panels or gaps');
  for(const face of faces)for(const p of face.vertices){
    const [u,y,v]=libraryLocal(p);
    assert.ok(Math.abs(u-part.u)<=part.width/2+1e-7&&Math.abs(v-part.v)<=part.depth/2+1e-7);
    assert.ok(y>=part.y-part.height/2-1e-7&&y<=part.y+part.height/2+1e-7);
  }
  assert.deepEqual(capture(b=>api.fillPhotoLibraryRoof(b,LIBRARY_ROOF_PARTS[0],'BASE')),[],'pavilion renderer stays untouched');
});

test('procedural refinement does not mutate shared source or gameplay geometry', {skip:!ready},()=>{
  for(const tier of ['BASE','NEAR','DETAIL']){
    capture(b=>api.fillPhotoMainHallFacade(b,tier));capture(b=>api.fillPhotoLibraryFront(b,tier));
    for(const part of LIBRARY_ROOF_PARTS)capture(b=>api.fillPhotoLibraryRoof(b,part,tier));
  }
  assert.equal(JSON.stringify({BUILDINGS,HALL_FRONT,LIBRARY_ROOF_PARTS,ROADVIEW_OBSTACLES,LIBRARY_APPROACHES,MAIN_HALL_APPROACH}),before);
});

test('winding remains outward with the production negative-Z parent determinant compensation', {skip:!ready},()=>{
  const faces=capture(b=>api.fillPhotoMainHallFacade(b,'DETAIL'));
  for(const f of faces){
    const reflected=f.vertices.map(([x,y,z])=>[x,y,-z]).reverse();
    const n=normal(reflected);
    assert.ok(n[0]*-HALL_FRONT.inward.x+n[2]*HALL_FRONT.inward.z>0);
  }
  for(const part of LIBRARY_ROOF_PARTS.slice(1))for(const f of capture(b=>api.fillPhotoLibraryRoof(b,part,'BASE'))){
    const old=normal(f.vertices),next=normal(f.vertices.map(([x,y,z])=>[x,y,-z]).reverse());
    assert.ok(old[0]*next[0]+old[1]*next[1]-old[2]*next[2]>0,'render-parent reflection preserves exposed face');
  }
});

test('renderer replaces only observed front details and roof parts without extra lights or collider edits',()=>{
  const source=readFileSync(new URL('../src/main-hall-blockout.js',import.meta.url),'utf8');
  assert.match(source,/fillPhotoMainHallFacade\(facade,tier\)/);
  assert.match(source,/fillPhotoLibraryFront\(libraryDetails,tier\)/);
  assert.match(source,/fillPhotoLibraryRoof\(libraryDetails,part,tier\)/);
  assert.doesNotMatch(source,/library_glass_bay_|library_glass_rails/,'retired detail is not layered underneath');
  assert.match(source,/'hall_entry_glass'/,'existing entry doors remain');
  assert.match(source,/buildLibraryWest\(root\)/,'ordinary nonfront hook remains');
  assert.doesNotMatch(source,/addComponent\(['"](?:light|collision|rigidbody)/);
});
