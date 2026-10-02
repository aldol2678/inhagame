import { BUILDINGS, SITE_FEATURES } from './basic-campus.js';
import { exteriorFrame } from './north-campus-layout.js';
import { roadSegment } from './campus-road-layout.js';
import { GARDEN_FRAME } from './library-garden-layout.js';
import { polygonOverlap } from './polygon-collision.js';

// Existing library entrance level; relative route grades are presentation estimates.
export const LIBRARY_ENTRY_HEIGHT=1.65;
const ring=BUILDINGS.find(b=>b.id==='bldg_jungseok').vertices;
const frames=[3,4,5,6].map(i=>exteriorFrame(ring,i));
const node=(p,y)=>({...p,y});
function corner(a,b,out){
  const p=a.at(a.length,out),q=b.at(0,out),t=a.at(a.length+1,out),s=b.at(1,out);
  const ax=t.x-p.x,az=t.z-p.z,bx=s.x-q.x,bz=s.z-q.z;
  const u=((q.x-p.x)*bz-(q.z-p.z)*bx)/(ax*bz-az*bx);
  return {x:p.x+ax*u,z:p.z+az*u};
}
const front=frames[3],road=roadSegment(481241685,2).frame;
export const LIBRARY_FRONT_STAIR={inset:1.8,landing:1.4,run:6.6};
const northStart=frames[0].at(5,.7);
const upper=[node(northStart,0),...frames.slice(0,-1).map((f,i)=>node(corner(f,frames[i+1],.7),LIBRARY_ENTRY_HEIGHT)),
  node(front.at(front.length/2,1.05),LIBRARY_ENTRY_HEIGHT)];
const foot=front.at(front.length/2,8),apron=front.at(front.length/2,11.5);
const ra=road.at(0),rt=road.at(1),roadU=(apron.x-ra.x)*(rt.x-ra.x)+(apron.z-ra.z)*(rt.z-ra.z);
const cross=SITE_FEATURES.find(p=>p.id==='site_481241690').vertices;
const mainWalk=SITE_FEATURES.find(p=>p.id==='site_481241657').vertices;
const gateLink=SITE_FEATURES.find(p=>p.id==='site_481241689').vertices;
export const LIBRARY_ROUTE_LINES=[
  {id:'garden_library_spur',width:1.2,nodes:[node(GARDEN_FRAME.at(14,-2),0),node(northStart,0)]},
  {id:'library_upper_walk',width:1.2,nodes:upper,rails:true},
  {id:'library_front_link',width:1.3,nodes:[foot,apron,road.at(roadU,-2.5)].map(p=>node(p,0))},
  {id:'library_gate_corner',width:1.3,nodes:[road.at(43,-2.5),road.at(road.length,-2.5),cross[0]].map(p=>node(p,0))},
  // Existing source walks continue cross[0] -> cross[1] == mainWalk[2] -> mainWalk[1].
  {id:'main_gate_walk_link',width:1.8,nodes:[mainWalk[1],gateLink[0]].map(p=>node(p,0))}
];
// Shared mitered ribbon geometry prevents gaps at bends. Physics samples the same triangles.
export const LIBRARY_ROUTE_CELLS=LIBRARY_ROUTE_LINES.flatMap(line=>{
  const pts=line.nodes,offsets=pts.map((p,i)=>{
    const normal=(a,b)=>{const length=Math.hypot(b.x-a.x,b.z-a.z);return {x:-(b.z-a.z)/length,z:(b.x-a.x)/length};};
    const a=normal(pts[Math.max(0,i-1)],pts[i===0?1:i]);
    const b=normal(pts[i===pts.length-1?i-1:i],pts[Math.min(pts.length-1,i+1)]);
    const length=Math.hypot(a.x+b.x,a.z+b.z),nx=(a.x+b.x)/length,nz=(a.z+b.z)/length;
    const d=Math.min(line.width*2,line.width/2/(nx*a.x+nz*a.z));
    return {x:nx*d,z:nz*d};
  });
  const side=(i,s)=>({x:pts[i].x+offsets[i].x*s,z:pts[i].z+offsets[i].z*s,y:pts[i].y});
  return pts.slice(1).map((_,i)=>({id:`${line.id}_${i}`,line:line.id,
    polygon:[side(i,-1),side(i+1,-1),side(i+1,1),side(i,1)],
    rails:line.rails&&i<pts.length-2}));
});
// The library-side planted ground rises from the road to the upper walk.
// Keep the road level and leave the front stairs and building footprint clear.
const bankInnerV=u=>-10.4-3.1*Math.max(0,Math.min(1,(u-15)/5));
const bankPoint=(u,t)=>{
  const v=-3.7+(bankInnerV(u)+3.7)*t;
  const north=Math.max(0,Math.min(1,(u-7.5)/2.5));
  const south=Math.max(0,Math.min(1,(42.5-u)/7));
  return {...road.at(u,v),y:LIBRARY_ENTRY_HEIGHT*north*south*t};
};
const bankBlocked=p=>{
  if(polygonOverlap(p.x,p.z,ring))return true;
  const q=front.local(p);
  if(q.u>=LIBRARY_FRONT_STAIR.inset-.25&&q.u<=front.length-LIBRARY_FRONT_STAIR.inset+.25&&
    q.out>=-.25&&q.out<=LIBRARY_FRONT_STAIR.landing+LIBRARY_FRONT_STAIR.run+.25)return true;
  return LIBRARY_ROUTE_CELLS.some(cell=>cell.line==='library_front_link'&&polygonOverlap(p.x,p.z,cell.polygon,.12));
};
export const LIBRARY_BANK_CELLS=[];
for(let u=7.5;u<42.5;u+=1)for(let i=0;i<10;i++){
  const a=bankPoint(u,i/10),b=bankPoint(Math.min(u+1,42.5),i/10);
  const c=bankPoint(Math.min(u+1,42.5),(i+1)/10),d=bankPoint(u,(i+1)/10);
  if([a,b,c,d].some(bankBlocked)||bankBlocked({x:(a.x+c.x)/2,z:(a.z+c.z)/2}))continue;
  LIBRARY_BANK_CELLS.push({polygon:[a,b,c,d]});
}
function triangleHeight(p,a,b,c){
  const d=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
  if(Math.abs(d)<1e-9)return null;
  const u=((b.z-c.z)*(p.x-c.x)+(c.x-b.x)*(p.z-c.z))/d;
  const v=((c.z-a.z)*(p.x-c.x)+(a.x-c.x)*(p.z-c.z))/d,w=1-u-v;
  return Math.min(u,v,w)>=-1e-8?u*a.y+v*b.y+w*c.y:null;
}
export function libraryRouteGroundHeight(x,z){
  for(const q of [...LIBRARY_ROUTE_CELLS,...LIBRARY_BANK_CELLS]){
    const [a,b,c,d]=q.polygon;
    const height=triangleHeight({x,z},a,b,c)??triangleHeight({x,z},a,c,d);
    if(height!==null)return height;
  }
  return null;
}
export const LIBRARY_ROUTE_GUARDS=LIBRARY_ROUTE_CELLS.filter(q=>q.rails).flatMap(q=>[[0,1],[3,2]].flatMap(([i,j],side)=>{
  const a=q.polygon[i],b=q.polygon[j],count=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z));
  const at=t=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,y:a.y+(b.y-a.y)*t});
  // Leave the ramp foot open where the garden spur joins from the side.
  const start=q.id==='library_upper_walk_0'?2:0;
  return Array.from({length:count-start},(_,index)=>{
    const k=index+start;
    const p=at(k/count),r=at((k+1)/count),dx=r.x-p.x,dz=r.z-p.z,len=Math.hypot(dx,dz),nx=-dz/len*.035,nz=dx/len*.035;
    return {id:`${q.id}_guard_${side}_${k}`,a:p,b:r,polygon:[{x:p.x+nx,z:p.z+nz},{x:r.x+nx,z:r.z+nz},{x:r.x-nx,z:r.z-nz},{x:p.x-nx,z:p.z-nz}],minY:0,maxY:Math.max(p.y,r.y)+.5};
  });
}));
export const libraryRouteTreeClear=p=>[...LIBRARY_ROUTE_CELLS,...LIBRARY_BANK_CELLS].every(q=>!polygonOverlap(p.x,p.z,q.polygon,1.5));
