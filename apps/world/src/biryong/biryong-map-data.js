// Biryong is the same player/world with a different local coordinate frame.
// Read only the existing runtime geometry and public, implemented destinations.
import { MAP_SURFACE, createMapPoiRegistry } from '../minimap/minimap-poi-registry.js';
import { BIRYONG_REALM_REGION_ID, BIRYONG_STATION_BUILDING, BIRYONG_STATION_SURFACES, BIRYONG_STATION_SPAWN, BIRYONG_STATION_RETURN_STOP } from './biryong-realm-layout.js';
import { BIRYONG_REALM_P0_BOUNDS, BIRYONG_REALM_PLACE_ZONES, BIRYONG_VILLAGE_BUILDINGS, BIRYONG_VILLAGE_ROADS, BIRYONG_VILLAGE_WATER_CHANNELS } from './biryong-village-layout.js';
import { BIRYONG_VILLAGE_NPC_DESTINATIONS } from './biryong-village-npc-contract.js';

const point = p => Object.freeze({x:p.x,z:p.z});
const ring = points => Object.freeze(points.map(point));
export function biryongMapRectangle({x,z,width,depth}) {
  return ring([{x:x-width/2,z:z-depth/2},{x:x+width/2,z:z-depth/2},{x:x+width/2,z:z+depth/2},{x:x-width/2,z:z+depth/2}]);
}
const geometryRecord = (id,kind,source,points) => Object.freeze({id,kind,source,style:'biryong',rings:Object.freeze([ring(points)])});
function strips(item,kind,source) {
  return item.points.slice(1).map((b,i) => {
    const a=item.points[i],length=Math.hypot(b.x-a.x,b.z-a.z);
    const nx=-(b.z-a.z)/length*item.width/2,nz=(b.x-a.x)/length*item.width/2;
    return geometryRecord(`${item.id}.${i}`,kind,source,[
      {x:a.x+nx,z:a.z+nz},{x:b.x+nx,z:b.z+nz},
      {x:b.x-nx,z:b.z-nz},{x:a.x-nx,z:a.z-nz}
    ]);
  });
}
const destination = (key,zoneId,position,iconKey='landmark',title=null) => Object.freeze({
  poiId:`poi.biryong-realm.${key}`,
  title:title ?? BIRYONG_REALM_PLACE_ZONES.find(zone=>zone.id===zoneId).displayName,
  placeZoneId:zoneId,position:point(position),iconKey
});
const destinations=BIRYONG_VILLAGE_NPC_DESTINATIONS;
export const BIRYONG_MAP_DESTINATIONS=Object.freeze([
  destination('station','BR_STATION',BIRYONG_STATION_SPAWN,'gate'),
  destination('market','BR_MARKET',destinations.MARKET_CENTER.position),
  destination('workshop','BR_WORKSHOP',destinations.WORKSHOP_FRONT.position),
  destination('inn','BR_INN',destinations.INN_FRONT.position,'housing'),
  destination('council','BR_COUNCIL',destinations.COUNCIL_FRONT.position,'main-hall'),
  destination('residential','BR_RESIDENTIAL',destinations.RESIDENTIAL_WEST.position,'housing'),
  destination('return','BR_STATION',BIRYONG_STATION_RETURN_STOP,'exit','귀환 · F1 인하대후문행')
]);
const bounds=BIRYONG_REALM_P0_BOUNDS;
const geometry=Object.freeze([
  geometryRecord('biryong.realm.floor','GROUND','BIRYONG_REALM_P0_BOUNDS',biryongMapRectangle({
    x:(bounds.minX+bounds.maxX)/2,z:(bounds.minZ+bounds.maxZ)/2,width:bounds.maxX-bounds.minX,depth:bounds.maxZ-bounds.minZ
  })),
  ...BIRYONG_STATION_SURFACES.map(shape=>geometryRecord(shape.id,shape.kind,'BIRYONG_STATION_SURFACES',biryongMapRectangle(shape))),
  ...BIRYONG_VILLAGE_ROADS.flatMap(road=>strips(road,'ROAD','BIRYONG_VILLAGE_ROADS')),
  ...BIRYONG_VILLAGE_WATER_CHANNELS.flatMap(channel=>strips(channel,'WATER','BIRYONG_VILLAGE_WATER_CHANNELS')),
  geometryRecord(BIRYONG_STATION_BUILDING.id,'BUILDING','BIRYONG_STATION_BUILDING',biryongMapRectangle(BIRYONG_STATION_BUILDING)),
  ...BIRYONG_VILLAGE_BUILDINGS.map(building=>geometryRecord(building.id,'BUILDING','BIRYONG_VILLAGE_BUILDINGS',building.polygon))
]);

export function createBiryongMapDataSource() {
  const byId=new Map(BIRYONG_MAP_DESTINATIONS.map(value=>[value.poiId,value]));
  const registry=createMapPoiRegistry({
    definitions:BIRYONG_MAP_DESTINATIONS.map((value,index)=>({
      ...value,kind:value.iconKey==='exit'?'EXIT':'LANDMARK',
      sourceRef:{type:'BIRYONG_RUNTIME_DESTINATION',id:value.poiId},
      priority:value.iconKey==='exit'?120:100-index,labelMode:'FULL_MAP',surfaces:[MAP_SURFACE.MINIMAP,MAP_SURFACE.FULL_MAP]
    })),
    resolvePosition:sourceRef=>byId.get(sourceRef.id)?.position
  });
  return Object.freeze({
    id:BIRYONG_REALM_REGION_ID,label:'비룡역 · 비룡마을 지도',indoor:false,bounds,
    geometry:()=>geometry,poiRegistry:()=>registry,
    refreshState:context=>registry.list({surface:MAP_SURFACE.MINIMAP,context}),
    status:()=>Object.freeze({regionId:BIRYONG_REALM_REGION_ID,geometryCount:geometry.length,poiCount:registry.size})
  });
}
