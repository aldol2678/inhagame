import { roadviewGroundHeight } from "../roadview-layout.js";
import { getCanonicalLandmark, projectPolygon } from "../reality-adapter.js";
import { polygonOverlap } from "../polygon-collision.js";
import { overPondWater } from "../landmark-detail-layout.js";
// Same elevation as buildPolygonSurfaceGeometry / central-blockout.
export const INKYUNG_WATER_Y=0.025;
export const INKYUNG_WATER_POLYGON=Object.freeze(projectPolygon(getCanonicalLandmark("lmk_inkyung_pond").polygon));
const a=INKYUNG_WATER_POLYGON[3],b=INKYUNG_WATER_POLYGON[4];
const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
const inward={x:dz/len,z:-dx/len},mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
// Authored P0 south-bank dock anchor derived from canonical shoreline edge, not a surveyed facility.
export const INKYUNG_DOCK=Object.freeze({
 id:"INKYUNG_DOCK",
 shore:Object.freeze({x:mid.x-inward.x*1.4,z:mid.z-inward.z*1.4}),
 spawn:Object.freeze({x:mid.x+inward.x*2.2,y:INKYUNG_WATER_Y,z:mid.z+inward.z*2.2,yaw:Math.atan2(inward.x,inward.z)*180/Math.PI})
});
export function fitsInkyungWater(x,z,radius=1.3) {
 if(!Number.isFinite(x+z+radius) || radius<=0 || !polygonOverlap(x,z,INKYUNG_WATER_POLYGON) || !overPondWater(x,z))return false;
 // Exact minimum distance to every shoreline segment keeps the whole circle inside the polygon.
 for(let i=0;i<INKYUNG_WATER_POLYGON.length;i++){
  const a=INKYUNG_WATER_POLYGON[i],b=INKYUNG_WATER_POLYGON[(i+1)%INKYUNG_WATER_POLYGON.length];
  const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
  if(Math.hypot(x-a.x-t*dx,z-a.z-t*dz)<radius)return false;
 }
 for(let i=0;i<16;i++)if(!overPondWater(x+Math.sin(i*Math.PI/8)*radius,z+Math.cos(i*Math.PI/8)*radius))return false;
 return true;
}
export function findDuckBoatSummonPose({definition,origin,spaceId,mounted,grounded,canOccupyAt,bounds}={}) {
 if(definition?.summonPolicy!=="WATER_SPAWN" || definition.spawnDomain!=="WATER_SURFACE" ||
 definition.spawnAnchorPolicy!=="INKYUNG_DOCK" || !definition.summonEnabled || spaceId!=="campus" ||
 mounted || !grounded || !origin || ![origin.x,origin.y,origin.z].every(Number.isFinite) || typeof canOccupyAt!=="function" ||
 Math.hypot(origin.x-INKYUNG_DOCK.shore.x,origin.z-INKYUNG_DOCK.shore.z)>4 || overPondWater(origin.x,origin.z))return null;
 if(Math.abs(origin.y-1.15-roadviewGroundHeight(origin.x,origin.z))>.15)return null;
 const p=INKYUNG_DOCK.spawn,{radius,height}=definition.summonClearance;
 if(!bounds || p.x-radius<bounds.minX || p.x+radius>bounds.maxX || p.z-radius<bounds.minZ || p.z+radius>bounds.maxZ ||
 !fitsInkyungWater(p.x,p.z,radius) || !canOccupyAt({x:p.x,y:p.y+1.15,z:p.z},{radius,footOffset:1.15,headOffset:height-1.15}))return null;
 return {...p};
}
export function stepDuckBoat(state,{throttle=0,steer=0}={},dt) {
 if(!Number.isFinite(dt)||dt<=0)return {...state};dt=Math.min(dt,.1);
 const target=Math.max(-1,Math.min(1,throttle))*(throttle<0?1:3);
 const speed=state.speed+Math.max(-1.5*dt,Math.min(1.5*dt,target-state.speed));
 const yaw=state.yaw+Math.max(-1,Math.min(1,steer))*28*dt;
 return {speed,yaw,vx:Math.sin(yaw*Math.PI/180)*speed,vz:Math.cos(yaw*Math.PI/180)*speed};
}
export function constrainDuckBoat(from,to,radius=1.3) {
 const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.1));let safe={x:from.x,z:from.z};
 for(let i=1;i<=steps;i++){const p={x:from.x+(to.x-from.x)*i/steps,z:from.z+(to.z-from.z)*i/steps};
 if(!fitsInkyungWater(p.x,p.z,radius))break;safe=p;}
 return safe;
}
