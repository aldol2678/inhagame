import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPUS_ROADS, ROAD_SEGMENTS, ROAD_CROSSWALKS, roadTreeClear, forestRoadTrees } from '../src/campus-road-layout.js';
import { fillCampusRoadBatch } from '../src/campus-road-geometry.js';
import { FLAT_GROUND_Y, FLAT_GROUND_MAX_Y } from '../src/flat-ground-surface.js';
import { geoToWorld } from '../src/geo-coordinates.js';
import { BUILDINGS, SITE_FEATURES } from '../src/basic-campus.js';
import { FACILITY_COLLIDERS, FACILITIES } from '../src/campus-facilities.js';
import { polygonOverlap } from '../src/polygon-collision.js';
const quads=[];
fillCampusRoadBatch({quad(color,...vertices){quads.push({color,vertices});}});
test('new roads preserve source centerlines and never duplicate existing paths or tunnels',()=>{
  assert.equal(CAMPUS_ROADS.length,13);
  for(const r of CAMPUS_ROADS){
    assert.equal(r.tags.highway,'service');assert.notEqual(r.tags.tunnel,'yes');
    assert.ok(!SITE_FEATURES.some(f=>f.id===`site_${r.osmWayId}`));
    assert.deepEqual(r.vertices,r.line.slice(0,r.vertices.length).map(ll=>geoToWorld(...ll)));
  }
});
test('road surfaces and markings are planar, upward-facing and clear of building interiors',()=>{
  const obstacles=[...FACILITY_COLLIDERS.filter(o=>o.minY===0),...BUILDINGS.map(b=>({id:b.id,polygon:b.vertices})),
    ...FACILITIES.filter(f=>['stadium','basketball','tennis','court'].includes(f.style)).map(f=>({id:f.id,polygon:f.rings[0]}))];
  for(const q of quads){
    const [a,b,c]=q.vertices;
    assert.ok(q.vertices.every(p=>p.every(Number.isFinite)&&p[1]===a[1]&&p[1]>=FLAT_GROUND_Y.UNDERLAY&&p[1]<=FLAT_GROUND_MAX_Y));
    assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0);
    // Sample the entire long apron/road, not just its corners.
    const d=q.vertices[3],n=Math.ceil(Math.hypot(d[0]-a[0],d[2]-a[2])*2);
    for(let i=0;i<=n;i++)for(let j=0;j<=4;j++){
      // Bilinear sampling also covers the tapered join quads, without testing
      // an extrapolated parallelogram that is not part of the pavement.
      const u=i/n,v=j/4;
      const x=(a[0]*(1-u)+d[0]*u)*(1-v)+(b[0]*(1-u)+c[0]*u)*v,z=(a[2]*(1-u)+d[2]*u)*(1-v)+(b[2]*(1-u)+c[2]*u)*v;
      for(const o of obstacles)assert.ok(!polygonOverlap(x,z,o.polygon),`pavement inside ${o.id} at ${x},${z}`);
    }
  }
  assert.ok(new Set(quads.map(q=>q.color)).size<=7,'batched material budget');
});
test('crosswalks remain on road segments and road corridor excludes lawn tree crowns',()=>{
  for(const c of ROAD_CROSSWALKS){assert.ok(c.u-c.width/2>0&&c.u+c.width/2<c.segment.frame.length);}
  for(const s of ROAD_SEGMENTS)assert.equal(roadTreeClear(s.frame.at(s.frame.length/2)),false);
  for(const p of forestRoadTrees(FACILITIES.find(f=>f.style==='forest').center))assert.ok(roadTreeClear(p,2.5));
});
