// Source horizontal geometry; heights, widths and facade dressing are presentation estimates.
import { geoToWorld } from './geo-coordinates.js';
import { projectPolygon } from './reality-adapter.js';

async function read(name) {
  const url = new URL(`../data/reality/${name}.json`, import.meta.url);
  if (url.protocol !== 'file:') {
    const response = await fetch(url);
    if (!response.ok) throw Error(`Campus geometry load failed: ${name} ${response.status}`);
    return response.json();
  }
  const { readFileSync } = await import('node:fs');
  return JSON.parse(readFileSync(url, 'utf8'));
}
const [buildings, site] = await Promise.all([read('campus-buildings'), read('campus-site')]);
export const BUILDINGS = ['bldg_01', 'bldg_jungseok'].map(id => {
  const b = buildings.buildings.find(b => b.id === id);
  return { id, sourceId:b.provenance.polygon.sourceId, vertices:projectPolygon(b.polygon), height:id === 'bldg_01' ? 10.5 : 17 };
});
export const SITE_FEATURES = site.features.map(f => ({ ...f,
  vertices:f.kind === 'path' ? f.line.map(([lat,lon]) => geoToWorld(lat,lon)) : projectPolygon(f.polygon)
}));
// The long southwest-facing front edge in the source footprint, also visible in the supplied facade photo.
const hall = BUILDINGS[0].vertices, a = hall[5], b = hall[6];
const length = Math.hypot(b.x-a.x,b.z-a.z);
export const HALL_FRONT = { a,b,length, along:{x:(b.x-a.x)/length,z:(b.z-a.z)/length}, inward:{x:-(b.z-a.z)/length,z:(b.x-a.x)/length} };
export const MAIN_ENTRANCE = { x:(a.x+b.x)/2-HALL_FRONT.inward.x*5, z:(a.z+b.z)/2-HALL_FRONT.inward.z*5, inward:HALL_FRONT.inward };
export const LIBRARY_FRONT = (() => {
  const [p,q] = [BUILDINGS[1].vertices[6],BUILDINGS[1].vertices[7]];
  const length=Math.hypot(q.x-p.x,q.z-p.z),tx=(q.x-p.x)/length,tz=(q.z-p.z)/length;
  return { yaw:-Math.atan2(tz,tx)*180/Math.PI, at:(u,v)=>({x:(p.x+q.x)/2+u*tx-v*tz,z:(p.z+q.z)/2+u*tz+v*tx}) };
})();
export const LIBRARY_ROOF_PARTS = [
  {id:'library_upper_pavilion',u:0,v:-4,y:18,width:12,height:2,depth:8},
  {id:'library_overhanging_roof',u:0,v:-3.2,y:19.3,width:16,height:.4,depth:11},
  {id:'library_entry_canopy',u:0,v:1.1,y:4.4,width:8,height:.2,depth:2.5}
].map(p=>({...p,vertices:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>LIBRARY_FRONT.at(p.u+x*p.width/2,p.v+z*p.depth/2))}));
// Main-gate side walls moved to the editor-authoritative main-gate WorldDocument.
