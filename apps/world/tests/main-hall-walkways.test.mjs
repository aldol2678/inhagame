import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { SITE_FEATURES } from '../src/basic-campus.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { campusNavPolylines, campusNavGraphData } from '../src/navigation/campus-navigation.js';
import { buildRoadNetworkAudit } from '../tools/road-network-audit.mjs';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { canOccupy } from '../src/world-collision.js';
import { createMiniMapDataSource } from '../src/minimap/minimap-data.js';

const gpu=`export class Entity {} export class StandardMaterial{update(){}} export class Color{constructor(r,g,b){Object.assign(this,{r,g,b})}}`;
registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:'data:text/javascript,'+encodeURIComponent(gpu),shortCircuit:true}:next(s,c)}});
const url=new URL('../src/main-hall-walkway-layout.js',import.meta.url),layout=existsSync(url)?await import(url):{};
const geometryUrl=new URL('../src/main-hall-walkway-geometry.js',import.meta.url),geometry=existsSync(geometryUrl)?await import(geometryUrl):{};
const { FacilityMeshBatch }=await import('../src/facility-mesh-batch.js');
const ids=['main_hall_walkway_west','main_hall_walkway_east'];

test('two evidenced approaches derive from existing avenue ends and the hall transverse path',()=>{
  assert.equal(layout.MAIN_HALL_WALKWAYS?.length,2,'shared approach layout is missing');
  const starts=[[36.760794,-12.202418],[48.104099,-17.656533]],ends=[[40.743362,-5.102493],[51.698945,-11.247820]];
  for(const [i,line] of layout.MAIN_HALL_WALKWAYS.entries()){
    assert.equal(line.id,ids[i]);assert.equal(line.width,3.5);
    for(const [j,p] of line.points.entries()){
      assert.ok(Math.hypot(p.x-[starts,ends][j][i][0],p.z-[starts,ends][j][i][1])<.000002);
      assert.equal(roadviewGroundHeight(p.x,p.z),0);
    }
  }
});

test('navigation consumes the same approaches instead of recreating virtual shortcuts',()=>{
  const lines=campusNavPolylines();for(const id of ids)assert.ok(lines.some(l=>l.id===id),'missing authored navigation approach '+id);
  const audit=buildRoadNetworkAudit();assert.equal(audit.nav.virtualJunctionCount,9);assert.equal(audit.nav.droppedLineIds.length,0);
  assert.equal(audit.nav.nodeCount,186);assert.equal(audit.nav.edgeCount,211);
  assert.ok(!audit.nav.virtualJunctions.some(j=>['junction.site_481241657','junction.site_258995842'].includes(j.lineId)));
  assert.ok(campusNavGraphData().edges.some(e=>e.lineId===ids[0]));
});

test('both map surfaces derive the same approach endpoints and width',()=>{
  const maps=createMiniMapDataSource().geometry();
  for(const line of layout.MAIN_HALL_WALKWAYS){
    const record=maps.find(q=>q.id===`mappath.${line.id}.0`);
    assert.ok(record,'map is missing '+line.id);assert.equal(record.source,'MAIN_HALL_WALKWAYS');
    const [a,,,b]=record.rings[0];assert.ok(Math.abs(Math.hypot(a.x-b.x,a.z-b.z)-line.width)<1e-8);
    const center=record.rings[0].reduce((p,q)=>({x:p.x+q.x/4,z:p.z+q.z/4}),{x:0,z:0});
    assert.ok(Math.hypot(center.x-(line.points[0].x+line.points[1].x)/2,center.z-(line.points[0].z+line.points[1].z)/2)<1e-8);
  }
});

test('visible approach surfaces cover both route midpoints and stay clear of lawns and the pool',()=>{
  assert.equal(typeof geometry.fillMainHallWalkways,'function','approach surface renderer is missing');
  const b=new FacilityMeshBatch();geometry.fillMainHallWalkways(b);
  const triangles=[...b.groups.values()].flatMap(g=>Array.from({length:g.indices.length/3},(_,i)=>g.indices.slice(i*3,i*3+3).map(n=>g.positions.slice(n*3,n*3+3))));
  assert.ok(triangles.length>0&&triangles.length<=16);
  const protectedRings=SITE_FEATURES.filter(f=>f.kind!=='path').map(f=>f.vertices);
  for(const [a,c,d] of triangles){
    assert.ok((c[2]-a[2])*(d[0]-a[0])-(c[0]-a[0])*(d[2]-a[2])>0);
    for(let i=0;i<=10;i++)for(let j=0;j<=10-i;j++){
      const u=i/10,v=j/10,w=1-u-v,p={x:a[0]*u+c[0]*v+d[0]*w,z:a[2]*u+c[2]*v+d[2]*w};
      assert.ok(!protectedRings.some(r=>polygonOverlap(p.x,p.z,r)),'approach avoids source planting/pool polygons');
      assert.ok(canOccupy({...p,y:1.15}));
    }
    assert.ok([a,c,d].every(p=>p[1]>=.020&&p[1]<=.030));
  }
  for(const line of layout.MAIN_HALL_WALKWAYS){const [a,c]=line.points,p={x:(a.x+c.x)/2,z:(a.z+c.z)/2};
    assert.ok(triangles.some(v=>polygonOverlap(p.x,p.z,v.map(t=>({x:t[0],z:t[2]})))),'navigation midpoint receives visible paving');
  }
});

test('approach paving has no positive-area overlap with the existing receiving lane or avenue',()=>{
  const batch=new FacilityMeshBatch();geometry.fillMainHallWalkways(batch);
  const triangles=[...batch.groups.values()].flatMap(g=>Array.from({length:g.indices.length/3},(_,i)=>g.indices.slice(i*3,i*3+3).map(n=>({x:g.positions[n*3],z:g.positions[n*3+2]}))));
  const across=SITE_FEATURES.find(f=>f.id==='site_481241692').vertices;
  const dx=across[1].x-across[0].x,dz=across[1].z-across[0].z,length=Math.hypot(dx,dz);
  for(const triangle of triangles){
    // The lane's original 3.1 WU surface plus 2.1 WU shoulder owns this area.
    for(const p of triangle)assert.ok(Math.abs(dx*(p.z-across[0].z)-dz*(p.x-across[0].x))/length>=2.6-1e-8,'new paving overlaps receiving-lane shoulder/asphalt');
    const center=triangle.reduce((a,p)=>({x:a.x+p.x/3,z:a.z+p.z/3}),{x:0,z:0});
    const line=layout.MAIN_HALL_WALKWAYS.reduce((a,b)=>Math.hypot(center.x-a.points[0].x,center.z-a.points[0].z)<Math.hypot(center.x-b.points[0].x,center.z-b.points[0].z)?a:b);
    const vertices=SITE_FEATURES.find(f=>f.id===line.sourceId).vertices,[a,b]=vertices.slice(-2),tx=b.x-a.x,tz=b.z-a.z;
    for(const p of triangle)assert.ok((p.x-b.x)*tx+(p.z-b.z)*tz>=-1e-8,'new paving overlaps incoming avenue');
    assert.ok(triangle.some(p=>Math.abs((p.x-b.x)*tx+(p.z-b.z)*tz)<1e-8),'donor seam reaches its exact terminal plane');
  }
});
