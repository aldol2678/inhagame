import { northRoadTreeClear } from './north-campus-layout.js';
import { backRoadTreeClear } from './back-gate-layout.js';
import { BACK_STREET_BLOCKS } from './back-street-layout.js';
import { BACK_ALLEY_BLOCKS } from './back-alley-layout.js';
import { BACK_WEST_BUILDINGS } from './back-west-layout.js';
import { BACK_FURNITURE, backFurnitureTreeClear } from './back-furniture-layout.js';
import { backRoadsideTreeClear } from './back-roadside-layout.js';
import { sideGateTreeClear } from './north-side-gate-layout.js';
import { backApproachClear } from './back-approach-layout.js';
import { FACILITIES } from './campus-facilities.js';
import { BUILDINGS, SITE_FEATURES } from './basic-campus.js';
import { lawnTreePositions } from './facility-ground-layout.js';
import { roadTreeClear, forestRoadTrees } from './campus-road-layout.js';
import { POND_RING, pondBankTrees } from './roadview-layout.js';
import { LIBRARY_GREENS, libraryGardenTreeClear } from './library-garden-layout.js';
import { libraryRouteTreeClear } from './library-route-layout.js';
import { CULTURE_STREAM_ITEMS, cultureTreeClear } from './culture-street-layout.js';
import { MARKET_BUILDINGS, marketTreeClear } from './back-market-layout.js';
import { INTERIOR_BUILDINGS, interiorTreeClear } from './market-interior-layout.js';
import { DORM_1_EXTERIOR_BOUNDS } from './gate-dorm-exterior-layout.js';
import { gateDormRoadTreeClear } from './main-gate-road-layout.js';

// Grid ownership is purely technical; bounding boxes expand to contain whole assets.
export const CHUNK_SIZE=64;
export const chunkIdAt=({x,z})=>`RC_${Math.floor(x/CHUNK_SIZE)}_${Math.floor(z/CHUNK_SIZE)}`;
export const distanceToChunkBounds=(p,b)=>Math.hypot(Math.max(b.minX-p.x,0,p.x-b.maxX),Math.max(b.minZ-p.z,0,p.z-b.maxZ));
const center=vertices=>({x:vertices.reduce((s,p)=>s+p.x,0)/vertices.length,z:vertices.reduce((s,p)=>s+p.z,0)/vertices.length});
const chunks=new Map();
function add(kind,item,position,vertices,pad=0) {
  const id=chunkIdAt(position);
  if(!chunks.has(id)){
    const x=Math.floor(position.x/CHUNK_SIZE)*CHUNK_SIZE,z=Math.floor(position.z/CHUNK_SIZE)*CHUNK_SIZE;
    chunks.set(id,{id,bounds:{minX:x,maxX:x+CHUNK_SIZE,minZ:z,maxZ:z+CHUNK_SIZE},facilities:[],buildings:[],trees:[],streetscape:[]});
  }
  const chunk=chunks.get(id);chunk[kind].push(item);
  for(const p of vertices){chunk.bounds.minX=Math.min(chunk.bounds.minX,p.x-pad);chunk.bounds.maxX=Math.max(chunk.bounds.maxX,p.x+pad);
    chunk.bounds.minZ=Math.min(chunk.bounds.minZ,p.z-pad);chunk.bounds.maxZ=Math.max(chunk.bounds.maxZ,p.z+pad);}
}
for(const f of FACILITIES)add('facilities',f.id,f.center,f.id==='bldg_dorm1'?[...f.rings[0],...DORM_1_EXTERIOR_BOUNDS]:f.style==='forest'?forestRoadTrees(f.center):f.id==='bldg_07'?[...f.rings[0],...POND_RING,...pondBankTrees()]:f.rings[0]||[f.center],
  f.id==='bldg_07'?20:f.id==='bldg_05'?12:f.id==='bldg_60th'?4:f.id==='fac_agora_courtyard'?6:f.kind==='landmark'?12:1);
for(const f of BUILDINGS)add('buildings',f.id,center(f.vertices),f.vertices,12);
for(const q of BACK_STREET_BLOCKS)add('streetscape',q.id,q.center,q.bounds,1);
for(const q of BACK_ALLEY_BLOCKS)add('streetscape',q.id,q.center,q.bounds,1);
for(const q of CULTURE_STREAM_ITEMS)add('streetscape',q.id,q.center,q.bounds,1);
for(const q of MARKET_BUILDINGS)add('streetscape',q.id,q.center,q.bounds,1);
for(const q of INTERIOR_BUILDINGS)add('streetscape',q.id,q.center,q.bounds,1);
for(const q of BACK_WEST_BUILDINGS)add('streetscape',q.id,q.center,q.bounds,1);
for(const q of BACK_FURNITURE)add('streetscape',q.id,q.center,[q.center],2);
for(const q of LIBRARY_GREENS)add('streetscape',q.id,center(q.polygon),q.polygon,3);
const aircraft=FACILITIES.filter(f=>f.style==='aircraft').map(f=>f.center);
for(const f of SITE_FEATURES.filter(f=>f.kind==='lawn')){
  lawnTreePositions(f.vertices,aircraft).filter(p=>gateDormRoadTreeClear(p)&&interiorTreeClear(p)&&marketTreeClear(p)&&cultureTreeClear(p)&&libraryRouteTreeClear(p)&&libraryGardenTreeClear(p)&&roadTreeClear(p)&&northRoadTreeClear(p)&&backRoadTreeClear(p)&&backApproachClear(p,1.9)&&sideGateTreeClear(p)&&backFurnitureTreeClear(p)&&backRoadsideTreeClear(p)).forEach((p,i)=>add('trees',{...p,id:`${f.id}_tree_${i}`,index:i},p,[p],2));
}
export const RENDER_CHUNKS=[...chunks.values()];
export class RenderChunkRegistry {
  constructor(records=RENDER_CHUNKS) { this.chunks=records;this.byId=new Map(records.map(c=>[c.id,c])); }
  get(id) { return this.byId.get(id); }
  distance(position,chunk) { return distanceToChunkBounds(position,chunk.bounds); }
}

