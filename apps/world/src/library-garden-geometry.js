// Neutral procedural presentation of the public layout/navigation contracts.
// No source photos, surveyed furniture or image-derived dressing are used.
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { buildPolygonMeshGeometry } from './reality-adapter.js';
import { roadFrame } from './campus-road-layout.js';
import { FLAT_GROUND_Y } from './flat-ground-surface.js';
import {
  LIBRARY_GREENS, GARDEN_FLOOR, GARDEN_FRAME, GARDEN_WALLS,
  GARDEN_BEDS, GARDEN_BENCHES, GARDEN_SEAT, GARDEN_TREES,
  GARDEN_COLLIDERS, GARDEN_ENTRANCES, GARDEN_LIBRARY_PATHS,
  gardenEntryHeight
} from './library-garden-layout.js';

const colors={stone:'#aaa99d',path:'#b5b2a4',wood:'#776750',soil:'#8b7962',leaves:'#718458'};
const colliders=new Map(GARDEN_COLLIDERS.map(q=>[q.id,q]));
const rect=(frame,u0,u1,v0,v1)=>[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>frame.at(u,v));

function slab(batch,color,ring,minY,maxY){
  const data=buildPolygonMeshGeometry(ring,{yBase:minY,height:maxY-minY});
  for(let i=0;i<data.indices.length;i+=3){
    batch.triangle(color,...data.indices.slice(i,i+3).map(index=>data.positions.slice(index*3,index*3+3)));
  }
}
function top(batch,color,ring,heights){
  const points=ring.map((p,i)=>[p.x,Array.isArray(heights)?heights[i]:heights,p.z]);
  const [a,b,c]=points;
  if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<0)points.reverse();
  batch.quad(color,...points);
}
function entrance(batch,entry){
  const ring=(v0,v1)=>rect(entry.frame,entry.u-entry.width/2,entry.u+entry.width/2,v0,v1);
  if(entry.steps){
    for(let i=0;i<entry.steps;i++){
      const v0=i*entry.run/entry.steps,v1=(i+1)*entry.run/entry.steps;
      // The existing function starts level with the rim, then descends. Sampling
      // the middle of each tread avoids advancing the first step by one riser.
      slab(batch,colors.path,ring(v0,v1),GARDEN_FLOOR,gardenEntryHeight(entry,(v0+v1)/2));
    }
    return;
  }
  const ramp=ring(0,entry.run),high=gardenEntryHeight(entry,0),low=gardenEntryHeight(entry,entry.run);
  top(batch,colors.path,ramp,[high,high,low,low]);
  // Close the two sides down to the existing floor without adding another cap.
  // Derive the outward winding from the footprint, as entry frames can reflect.
  const clockwise=(ramp[1].z-ramp[0].z)*(ramp[2].x-ramp[0].x)-(ramp[1].x-ramp[0].x)*(ramp[2].z-ramp[0].z)>0;
  for(const [i,j] of [[1,2],[3,0]]){
    const at=k=>[ramp[k].x,k<2?high:low,ramp[k].z];
    const a=at(i),b=at(j),points=[[a[0],GARDEN_FLOOR,a[2]],[b[0],GARDEN_FLOOR,b[2]],b,a];
    if(!clockwise)points.reverse();
    batch.quad(colors.path,...points);
  }
}

// Compatibility export only: campus-terrain.js is the sole foundation owner.
export function buildGardenCampusTerrain(..._args) { return undefined; }

export function buildLibraryGardenBase(root){
  const batch=new FacilityMeshBatch();
  for(const q of [...GARDEN_WALLS,...GARDEN_BEDS]){
    const bounds=colliders.get(q.id);
    slab(batch,GARDEN_WALLS.includes(q)?colors.stone:colors.soil,q.polygon,bounds.minY,bounds.maxY);
  }
  for(const q of GARDEN_BENCHES){
    const bounds=colliders.get(q.id);
    const seatBottom=GARDEN_FLOOR+GARDEN_SEAT.centerY-GARDEN_SEAT.slatHeight/2;
    const seatTop=seatBottom+GARDEN_SEAT.slatHeight;
    slab(batch,colors.wood,q.polygon,seatBottom,seatTop);
    slab(batch,colors.wood,rect(q.frame,-.6,.6,-.26,-.20),seatTop,bounds.maxY);
    for(const u of [-.46,.46])slab(batch,colors.stone,rect(q.frame,u-.06,u+.06,-.20,.20),bounds.minY,seatBottom);
  }
  for(const tree of GARDEN_TREES){
    const bounds=colliders.get(tree.id);
    slab(batch,colors.wood,bounds.polygon,bounds.minY,bounds.maxY);
    // The coarse silhouette is persistent along with its trunk collider. Only
    // the small bed/seat accents below participate in chunk detail fading.
    batch.crown(colors.leaves,[tree.x,bounds.maxY-1,tree.z],[1.8,2,1.8]);
  }
  for(const entry of GARDEN_ENTRANCES)entrance(batch,entry);
  for(const path of GARDEN_LIBRARY_PATHS)for(let i=1;i<path.length;i++){
    const frame=roadFrame(path[i-1],path[i]);
    // Width is a neutral presentation estimate; source centrelines do not move.
    top(batch,colors.path,rect(frame,0,frame.length,-.6,.6),FLAT_GROUND_Y.SURFACE);
  }
  batch.finish(root,'library_garden_base');
}

export function buildLibraryGardenDetail(root,ids=[]){
  if(!ids.includes(LIBRARY_GREENS[0].id))return;
  const batch=new FacilityMeshBatch();
  for(const q of GARDEN_BEDS){
    const [u0,u1,v0,v1]=q.bounds;
    top(batch,colors.leaves,rect(GARDEN_FRAME,u0+.10,u1-.10,v0+.10,v1-.10),colliders.get(q.id).maxY+.002);
  }
  const seatTop=GARDEN_FLOOR+GARDEN_SEAT.centerY+GARDEN_SEAT.slatHeight/2;
  for(const q of GARDEN_BENCHES)for(const v of [-.08,.08]){
    top(batch,colors.soil,rect(q.frame,-.58,.58,v-.008,v+.008),seatTop+.002);
  }
  batch.finish(root,'library_garden_detail',{castShadows:false});
}
