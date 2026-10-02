import { BACK_APPROACH_ROADS, BACK_APPROACH_SEGMENTS, backApproachFootprintClear } from './back-approach-layout.js';
import { BACK_ALLEY_BLOCKS, BACK_ALLEY_COLLIDERS } from './back-alley-layout.js';
import { BACK_STREET_BLOCKS, BACK_STREET_COLLIDERS } from './back-street-layout.js';
import { BACK_WEST_BUILDINGS, BACK_WEST_COLLIDERS } from './back-west-layout.js';
import { CULTURE_COLLIDERS, cultureRectangle, culturePolygonsOverlap } from './culture-street-layout.js';
import { polygonOverlap } from './polygon-collision.js';
import { facadeSign } from './street-sign-layout.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { BUILDINGS } from './basic-campus.js';
import { interiorReservationClear } from './market-interior-plan.js';

// Existing OSM centerlines/footprints remain fixed. Infill widths, heights and
// generic businesses are illustrative exterior estimates, not tenancy records.
const routes=new Map(BACK_APPROACH_ROADS.map(road=>{
  let length=0;
  const segments=BACK_APPROACH_SEGMENTS.filter(s=>s.road===road).map(s=>{const start=length;length+=s.frame.length;return {...s,start,end:length};});
  return [road.id,{road,segments,length}];
}));
export function marketRoadFrame(id,station) {
  const route=routes.get(id),s=route.segments.find(s=>station<=s.end)||route.segments.at(-1);
  return {at:(u,v=0)=>s.frame.at(station-s.start+u,v)};
}
function frontFrame(roadId,station,side,setback) {
  const road=marketRoadFrame(roadId,station),at=(u,v=0)=>road.at(side*u,side*(setback+v)),a=at(0),c=at(1);
  return {at,yaw:-Math.atan2(c.z-a.z,c.x-a.x)*180/Math.PI};
}
const occupied=[...CULTURE_COLLIDERS,...BACK_ALLEY_COLLIDERS,...BACK_STREET_COLLIDERS,...BACK_WEST_COLLIDERS,...FACILITY_COLLIDERS,...BUILDINGS.map(q=>({polygon:q.vertices}))].map(q=>q.polygon);
const clear=ring=>backApproachFootprintClear(ring)&&occupied.every(p=>!culturePolygonsOverlap(ring,p));
const districtFor=id=>id.includes('67')?'67':id.includes('91')?'91':id.includes('47')?'47':id==='inha_east_extension'?'avenue':'cross';
const profiles={
  '67':[['stone','#c9c5b8','#657f70','한식'],['brick','#9e7160','#b85d55','분식'],['panel','#d6d1bf','#455e69','커피'],['brick','#7f6660','#c6a447','도시락']],
  '91':[['brick','#9e7160','#343b40','CAFE'],['dark','#555c5d','#b85d55','식당'],['stone','#c1c2bb','#455e69','스튜디오']],
  '47':[['brick','#a87d6a','#657f70','카페'],['stone','#c1c2bb','#455e69','세탁'],['panel','#d6d1bf','#b85d55','식당']],
  'avenue':[['panel','#d6d1bf','#b85d55','분식'],['stone','#c1c2bb','#657f70','편의점'],['brick','#9e7160','#455e69','카페']],
  'cross':[['brick','#7f6660','#b85d55','치킨'],['panel','#adae9e','#455e69','노래방'],['cafe','#d6d1bf','#c6a447','COFFEE'],['stone','#c1c2bb','#657f70','식당']]
};
const additions=[];
// Geonmulju event venue: April 2026 street-view reference, game-side blockout only.
// 10.7 m mapped frontage ~= 5.35 WU (1 WU ~= 2 m). The doorway trigger is a
// road-side gameplay approach, not a surveyed physical threshold.
const venueStation=40.44, venueRoad='culture_67_link', venueSide=1;
const venueFrame=frontFrame(venueRoad,venueStation,venueSide,2.5/2+.72);
const venueWidth=5.35,venueDepth=4.5;
const venuePolygon=cultureRectangle(venueFrame,0,venueDepth/2,venueWidth,venueDepth);
const venueBounds=cultureRectangle(venueFrame,0,venueDepth/2-.30,venueWidth+.45,venueDepth+1.05);
if(!clear(venuePolygon)||!interiorReservationClear(venueBounds))
  throw Error('Geonmulju venue footprint overlaps an existing street or building');
export const GEONMULJU_BUILDING=Object.freeze({
  id:'back_market_geonmulju',roadId:venueRoad,district:'67',index:-1,
  station:venueStation,side:venueSide,frame:venueFrame,w:venueWidth,d:venueDepth,h:6.3,
  style:'geonmulju',color:'#66524a',sign:'#212024',label:'건물酒',
  polygon:venuePolygon,bounds:venueBounds,center:venueFrame.at(0,venueDepth/2),
  door:venueFrame.at(venueWidth/2-.85,-.77)
});
additions.push(GEONMULJU_BUILDING);occupied.push(venuePolygon);
const infillRoutes=['culture_cross_west','culture_cross_east','culture_67_north','culture_67_link','culture_47_junction','inha_91_bend','inha_east_extension','inha_67_entrance','inha_91_entrance'];
for(const roadId of infillRoutes) {
  const {road,length}=routes.get(roadId),district=districtFor(roadId),palette=profiles[district];
  // Inha-ro runs east/southeast here; +v is the commercial (north) side.
  for(const side of road.style==='avenue'?[1]:[1,-1])for(let station=4.4,index=0;station<length-2.7;station+=5.7,index++) {
    const frame=frontFrame(roadId,station,side,road.width/2+(road.style==='avenue'?2.9:.72));
    const w=[4.6,4.9,5.0][index%3],d=[3.5,4.1,3.8][index%3],h=district==='47'?[4.8,6.1,5.4][index%3]:[5.1,6.5,4.7,7.4][index%4];
    const polygon=cultureRectangle(frame,0,d/2,w,d);
    // The facade envelope also yields to neighboring buildings and street corners.
    const bounds=cultureRectangle(frame,0,d/2-.30,w+.45,d+1.05);
    if(!clear(polygon)||!interiorReservationClear(bounds)||occupied.some(p=>culturePolygonsOverlap(bounds,p)))continue;
    const [style,color,sign,label]=palette[(index+(side>0?0:1))%palette.length];
    const q={id:`back_market_${roadId}_${side}_${index}`,roadId,district,index,station,side,frame,w,d,h,style,color,sign,label,polygon,bounds,center:frame.at(0,d/2)};
    additions.push(q);occupied.push(polygon);
  }
}
export const MARKET_BUILDINGS=additions;
export const MARKET_COLLIDERS=additions.map(q=>({id:q.id,polygon:q.polygon,minY:0,maxY:q.h+.18}));

// Dressing adapters keep the old geometry/collision owners, rather than placing
// duplicate buildings on top of the pre-existing rows or OSM west footprints.
const localFrame=(source,u0,v0,direction=1)=>{
  const at=(u,v=0)=>source.at(u0+direction*u,v0+direction*v),a=at(0),c=at(1);
  return {at,yaw:-Math.atan2(c.z-a.z,c.x-a.x)*180/Math.PI};
};
export const MARKET_EXISTING_SHOPS=[
  ...BACK_ALLEY_BLOCKS.map(q=>({...q,district:districtFor(q.id),kind:'alley',frame:localFrame(q.frame,0,0),signY:1.87,signZ:-.232})),
  ...BACK_STREET_BLOCKS.map(q=>({...q,district:'avenue',kind:'frontage',frame:localFrame(q.frame,0,q.front),signY:1.88,signZ:-.219})),
  ...BACK_WEST_BUILDINGS.filter(q=>q.front&&q.style!=='residential').map(q=>({...q,kind:'west',district:'47',frame:localFrame(q.front,q.front.length/2,0,-1),w:q.front.length,h:q.height,signY:1.87,signZ:-.255,sign:q.style==='cafe'?'#555c5d':q.style==='commercial'?'#426b70':'#66866b'}))
].map(q=>({...q,label:profiles[q.district][q.index%profiles[q.district].length][3],treatment:['awning','tile','shutter','wood'][q.index%4]}));
export const MARKET_SIGNS=[
  ...additions.map(q=>facadeSign(q)),
  ...MARKET_EXISTING_SHOPS.map(q=>facadeSign(q,{v:q.signZ,width:Math.min(q.w-.65,5.5),bottom:q.signY-.14,top:q.signY+.14}))
];
export const MARKET_MAP_BUILDINGS=[...additions,...BACK_ALLEY_BLOCKS,...BACK_WEST_BUILDINGS,
  ...BACK_STREET_BLOCKS.map(q=>({...q,polygon:BACK_STREET_COLLIDERS.find(c=>c.id===q.id).polygon}))];
export const MARKET_BOUNDS=(()=>{const points=additions.flatMap(q=>q.bounds);return {minX:Math.min(...points.map(p=>p.x))-3,maxX:Math.max(...points.map(p=>p.x))+3,minZ:Math.min(...points.map(p=>p.z))-3,maxZ:Math.max(...points.map(p=>p.z))+3};})();
export const marketTreeClear=(p,radius=1.9)=>MARKET_COLLIDERS.every(q=>!polygonOverlap(p.x,p.z,q.polygon,radius));

export const MARKET_PREVIEWS=Object.fromEntries([
  ['market-67','inha_67_entrance',11],['market-91','inha_91_entrance',8],
  ['market-cross','culture_cross_east',8],['market-north','culture_47_junction',12],['market-west','west_47_lane',10]
].map(([id,roadId,station])=>{const f=marketRoadFrame(roadId,station),p=f.at(0),target=f.at(8);return [id,{...p,yaw:-Math.atan2(target.x-p.x,target.z-p.z)}];}));
