import { geoToWorld } from './geo-coordinates.js';

const stopUrl=new URL('../data/reality/evidence/transit/back-gate-511-stop.json',import.meta.url);
const roadsUrl=new URL('../data/reality/evidence/roads/back-approaches.json',import.meta.url);
const readJson=async url=>url.protocol==='file:'
  ? JSON.parse((await import('node:fs')).readFileSync(url,'utf8'))
  : await (async()=>{const r=await fetch(url);if(!r.ok)throw Error(`Transit source load failed: ${r.status}`);return r.json();})();
const [stopSource,roadsSource]=await Promise.all([readJson(stopUrl),readJson(roadsUrl)]);

const sourceRoad=roadsSource.roads.find(r=>r.id==='inha_west_extension');
if(!sourceRoad)throw Error('inha_west_extension source road missing');
const vertices=sourceRoad.line.map(ll=>geoToWorld(...ll));
const anchor=geoToWorld(stopSource.stop.lat,stopSource.stop.lon);

function segmentFrame(a,b){
  const length=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  return {length,tx,tz,at:(u,v=0)=>({x:a.x+tx*u-tz*v,z:a.z+tz*u+tx*v})};
}
function project(frame,p){
  const a=frame.at(0),dx=p.x-a.x,dz=p.z-a.z;
  const u=Math.max(0,Math.min(frame.length,dx*frame.tx+dz*frame.tz));
  const q=frame.at(u);
  const v=(p.x-q.x)*(-frame.tz)+(p.z-q.z)*frame.tx;
  return {u,v,distance:Math.abs(v),q};
}
const projections=vertices.slice(1).map((b,i)=>{
  const frame=segmentFrame(vertices[i],b);
  return {i,frame,...project(frame,anchor)};
});
const nearest=projections.reduce((a,b)=>a.distance<=b.distance?a:b);
const side=Math.sign(nearest.v)||-1;
const roadHalf=sourceRoad.width/2;
const busV=side*Math.min(roadHalf-.85,2.35);
const waitV=nearest.v+side*.8;
const previewU=Math.max(0,nearest.u-1.3),previewV=waitV+side*.8;
const yaw=-Math.atan2(nearest.frame.tz,nearest.frame.tx)*180/Math.PI;
const localFrame=Object.freeze({
  yaw,
  at:(u=0,v=0)=>nearest.frame.at(nearest.u+u,nearest.v+v)
});

export const BACK_GATE_511_STOP=Object.freeze({
  id:'TRANSIT_BACK_GATE_511',
  name:stopSource.stop.name,
  mobileId:stopSource.stop.mobileId,
  stationId:stopSource.stop.stationId,
  address:stopSource.stop.address,
  lat:stopSource.stop.lat,
  lon:stopSource.stop.lon,
  realRoutes:Object.freeze([...stopSource.stop.realRoutes]),
  x:anchor.x,
  z:anchor.z
});

export const BACK_GATE_511_ROAD=Object.freeze({
  roadId:sourceRoad.id,
  segmentIndex:nearest.i,
  width:sourceRoad.width,
  u:nearest.u,
  v:nearest.v,
  yaw
});

export const BACK_GATE_511_STOP_FRAME=localFrame;
export const BACK_GATE_511_BUS_BERTH=Object.freeze({
  ...nearest.frame.at(nearest.u,busV),
  yaw,
  length:5.5,
  width:1.35,
  routeId:'transit.frontier_bus.f1'
});
export const BACK_GATE_511_WAIT=Object.freeze({
  ...nearest.frame.at(nearest.u,waitV),
  yaw,
  radius:.9
});
export const BACK_GATE_511_INTERACTION=Object.freeze({
  center:BACK_GATE_511_WAIT,
  radius:2,
  state:'COMING_SOON',
  actionId:'TRANSIT_FRONTIER_F1'
});
export const BACK_GATE_511_PREVIEW_SPAWN=Object.freeze({
  ...nearest.frame.at(previewU,previewV),
  yaw:-yaw*Math.PI/180
});
export const BACK_GATE_511_TRANSIT=Object.freeze({
  realRoute:Object.freeze({routeId:'511',presentationOnly:true}),
  gameRoute:Object.freeze({
    mobilityId:'transit.frontier_bus.f1',
    category:'TRANSIT',
    domains:Object.freeze(['GROUND']),
    physicsProfile:'BUS',
    inputProfile:'AUTOPILOT',
    ownershipRequired:false,
    state:'COMING_SOON'
  })
});

const r=.10;
export const BACK_GATE_511_COLLIDER=Object.freeze({
  id:'back_gate_511_stop_pole',
  minY:0,
  maxY:2.45,
  polygon:Object.freeze([[-r,-r],[r,-r],[r,r],[-r,r]].map(([u,v])=>localFrame.at(u,v)))
});
