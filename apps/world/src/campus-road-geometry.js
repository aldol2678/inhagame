import { gateClippedRoadBatch } from './main-gate-surface-ownership.js';
import { ROAD_SEGMENTS, ROAD_CROSSWALKS, roadSegment } from './campus-road-layout.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
import { fillCampusRoadMicroDetails } from './campus-road-micro-details.js';

// All pavement/paint is horizontal: no tilted boxes or raised track geometry.
export function roadSurface(batch,color,frame,u0,u1,v0,v1,y) {
  const p=(u,v)=>{const q=frame.at(u,v);return[q.x,y,q.z];};
  batch.quad(color,p(u0,v0),p(u0,v1),p(u1,v1),p(u1,v0));
}
export function fillCampusRoadBatch(target) {
  const batch=gateClippedRoadBatch(target);
  const white='#e6e4d3',yellow='#d8b453',asphalt='#747d7b';
  for(const s of ROAD_SEGMENTS){
    const {frame:f,road:r}=s,h=r.width/2;
    roadSurface(batch,'#b4b4a8',f,-.15,f.length+.15,-h-r.shoulder,h+r.shoulder,G.UNDERLAY);
    roadSurface(batch,asphalt,f,-.12,f.length+.12,-h,h,G.SURFACE);
    // Small overlaps cover bends; edges stop short of junctions.
    for(const side of [-1,1])roadSurface(batch,white,f,.6,Math.max(.61,f.length-.6),side*(h-.16)-.035,side*(h-.16)+.035,G.PAINT);
  }
  // Fill the inside of each bend with a flat join. This removes triangular
  // grass slivers without broad circular pads protruding into adjacent plots.
  for(const s of ROAD_SEGMENTS){
    const next=ROAD_SEGMENTS.find(t=>t.road===s.road&&t.id===s.id.replace(/_(\d+)$/,(_,n)=>`_${Number(n)+1}`));
    if(!next)continue;
    const center=s.frame.at(s.frame.length);
    for(const side of [-1,1]){
      const a=s.frame.at(s.frame.length,side*s.road.width/2),b=next.frame.at(0,side*next.road.width/2);
      const vertices=[[center.x,G.EDGE,center.z],[a.x,G.EDGE,a.z],[b.x,G.EDGE,b.z]];
      const [p,q,r]=vertices,up=(q[2]-p[2])*(r[0]-p[0])-(q[0]-p[0])*(r[2]-p[2]);
      if(Math.abs(up)<1e-7)continue;
      if(up<0)vertices.reverse();
      // A nondegenerate quad halves the join triangle for the shared batch API.
      const [v0,v1,v2]=vertices,mid=v1.map((x,i)=>(x+v2[i])/2);
      batch.quad(asphalt,v0,v1,mid,v2);
    }
  }
  const west=roadSegment(481241681,2),f=west.frame;
  for(let u=2;u<f.length-2;u+=3.5)roadSurface(batch,yellow,f,u,Math.min(u+1.6,f.length-2),-.045,.045,G.PAINT);
  // Parking apron beside the library facade, with green EV bays at its north end.
  for(const side of [-1,1]){
    const v0=side>0?1.75:-4.25,v1=side>0?4.25:-1.75;
    roadSurface(batch,asphalt,f,24,53,v0,v1,G.SURFACE);
    for(let i=0;i<20;i++){
      const u=24+i*1.45;
      if(side>0&&i<3)roadSurface(batch,'#528b78',f,u+.06,u+1.39,v0+.08,v1-.08,G.EDGE);
      roadSurface(batch,white,f,u,u+.035,v0,v1,G.PAINT);
    }
    roadSurface(batch,white,f,24,53,v0,v0+.04,G.PAINT);
    roadSurface(batch,white,f,24,53,v1-.04,v1,G.PAINT);
  }
  // Painted speed table; deliberately no bump collision or change to movement speed.
  for(let i=0;i<10;i++)roadSurface(batch,i%2?white:yellow,f,58,59.5,-1.65+i*.33,-1.32+i*.33,G.DETAIL);
  for(const {segment:s,u,width} of ROAD_CROSSWALKS){
    for(let v=-1.55;v<1.5;v+=.52)roadSurface(batch,white,s.frame,u-width/2,u+width/2,v,v+.28,G.DETAIL);
  }
  roadSurface(batch,'#b4b4a8',roadSegment(481241661,2).frame,7.5,10.65,-7.05,-1.75,G.SURFACE);
  // Forest-side brick promenade visible beside 6/9 halls. Positive v is west here.
  for(const s of ROAD_SEGMENTS.filter(s=>s.road.osmWayId===481241661)){
    roadSurface(batch,'#ac7965',s.frame,0,s.frame.length,2.1,3.5,G.SURFACE);
    for(let u=0;u<s.frame.length;u+=2)roadSurface(batch,'#c7b29a',s.frame,u,Math.min(u+.08,s.frame.length),2.1,3.5,G.EDGE);
  }
  fillCampusRoadMicroDetails(batch);
  return target;
}
