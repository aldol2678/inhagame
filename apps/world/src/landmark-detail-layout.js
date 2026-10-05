import { FACILITIES } from './campus-facilities.js';
import { polygonOverlap } from './polygon-collision.js';
import { getCanonicalLandmark, projectPolygon } from './reality-adapter.js';

// Satellite/photo alignment, not a surveyed bearing. Logical +z is north.
export const AIRCRAFT_YAW = -158;
const angle=AIRCRAFT_YAW*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
export function aircraftPoint(center,x,y,z){return [center.x+x*c+z*s,y,center.z-x*s+z*c];}
export function aircraftLocal(center,p){const x=p.x-center.x,z=p.z-center.z;return {x:x*c-z*s,z:x*s+z*c};}
export function aircraftTreeClear(center,p){
  const q=aircraftLocal(center,p);
  return Math.hypot(Math.max(-6.6-q.x,0,q.x-6.6),Math.max(-5.6-q.z,0,q.z-6.2))>=2.9;
}

// Elevated volumes preserve the space beneath the wings and fuselage. Landing
// gear is separate, so the whole display never becomes a solid ground-level box.
function aircraftCollider(center,id,pos,size,yaw=0){
  const a=yaw*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const polygon=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>{
    const p=aircraftPoint(center,pos[0]+x*size[0]/2*c+z*size[2]/2*s,0,pos[2]-x*size[0]/2*s+z*size[2]/2*c);
    return {x:p[0],z:p[2]};
  });
  return {id:`aircraft_${id}`,polygon,minY:pos[1]-size[1]/2,maxY:pos[1]+size[1]/2};
}
export const AIRCRAFT_COLLIDERS=FACILITIES.filter(f=>f.style==='aircraft').flatMap(f=>{
  const box=(id,pos,size,yaw=0)=>aircraftCollider(f.center,id,pos,size,yaw);
  return [
    box('fuselage',[0,1.8,0],[1.2,1.2,10]),
    box('nose',[0,1.8,5.4],[1.2,1.2,1.2]),
    box('wings',[0,1.7,0],[13,.16,2.3],8),
    box('tailplane',[0,2,-4],[4.7,.15,1.2]),
    box('tailfin',[0,2.9,-4.2],[.15,2,1.4]),
    box('tailwheel',[0,.18,-4.3],[.2,.36,.36]),
    box('tailstrut',[0,.94,-4.3],[.11,1.52,.11]),
    ...[-1,1].flatMap(side=>[
      box(`engine_${side}`,[side*2.3,1.7,1.25],[.74,.74,1.5]),
      box(`propeller_${side}`,[side*2.3,1.7,2.1],[.12,2,.12]),
      box(`wheel_${side}`,[side*2.3,.34,.6],[.32,.68,.68]),
      box(`strut_${side}`,[side*2.3,.97,.6],[.15,1.26,.15])
    ])
  ];
});

const center=FACILITIES.find(f=>f.id==='lmk_pond_gazebo').center;
export const GAZEBO={center,radius:2.5,height:.42,entryEdge:3,entryStart:-4.2,entryEnd:-2.5*Math.cos(Math.PI/8),entryHalfWidth:.92};
GAZEBO.ring=Array.from({length:8},(_,i)=>({x:center.x+Math.cos(Math.PI/8+i*Math.PI/4)*GAZEBO.radius,z:center.z+Math.sin(Math.PI/8+i*Math.PI/4)*GAZEBO.radius}));
const pond=projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon);
const entry=(x,z)=>x>=center.x+GAZEBO.entryStart&&x<=center.x+GAZEBO.entryEnd+.05&&Math.abs(z-center.z)<=GAZEBO.entryHalfWidth;
export function gazeboGroundHeight(x,z){
  if(polygonOverlap(x,z,GAZEBO.ring))return GAZEBO.height;
  return entry(x,z)?GAZEBO.height*(x-center.x-GAZEBO.entryStart)/(GAZEBO.entryEnd-GAZEBO.entryStart):0;
}
export function overPondWater(x,z){
  return polygonOverlap(x,z,pond,.3)&&!polygonOverlap(x,z,GAZEBO.ring)&&!entry(x,z);
}
// Sample the whole movement, including large dt/sprints, not just its endpoint.
export function constrainPondWalk(from,to){
  const count=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.15));let safe={x:from.x,z:from.z};
  for(let i=1;i<=count;i++){
    const p={x:from.x+(to.x-from.x)*i/count,z:from.z+(to.z-from.z)*i/count};
    if(overPondWater(p.x,p.z))return safe;
    safe=p;
  }
  return safe;
}
export const GAZEBO_COLLIDERS=GAZEBO.ring.flatMap((a,i)=>{
  if(i===GAZEBO.entryEdge)return [];
  const b=GAZEBO.ring[(i+1)%8],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),nx=dz/len*.09,nz=-dx/len*.09;
  return [{id:`gazebo_rail_${i}`,polygon:[{x:a.x+nx,z:a.z+nz},{x:b.x+nx,z:b.z+nz},{x:b.x-nx,z:b.z-nz},{x:a.x-nx,z:a.z-nz}],minY:.42,maxY:1.25}];
});
GAZEBO_COLLIDERS.push({id:'gazebo_roof',polygon:GAZEBO.ring.map(p=>({x:center.x+(p.x-center.x)*1.25,z:center.z+(p.z-center.z)*1.25})),minY:3.4,maxY:4.5});
