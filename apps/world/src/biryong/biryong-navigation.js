// Adapter over the existing region-local walk planner. No Campus graph fallback,
// no new position authority, no teleport/spawn, and no production NPC cutover.
import { moveAroundPolygons } from '../polygon-collision.js';
import { PLAYER_ORIGIN_Y, WALK_SHAPE } from '../player-dimensions.js';
import { NAV_DESTINATION_SOURCE } from '../navigation/navigation-state.js';
import { polylineLength } from '../navigation/route-solver.js';
import { BIRYONG_REALM_REGION_ID, BIRYONG_STATION_BUILDING, BIRYONG_STATION_SURFACES } from './biryong-realm-layout.js';
import { BIRYONG_REALM_P0_OBSTACLES, BIRYONG_VILLAGE_ROADS, getBiryongRealmPlaceZone } from './biryong-village-layout.js';
import { createBiryongVillageNpcNavigator } from './biryong-village-npc-navigation.js';
import { BIRYONG_MAP_DESTINATIONS, biryongMapRectangle } from './biryong-map-data.js';

export function createBiryongNavigation() {
  // The station mesh predates the collision list. Guidance walks around its visible
  // footprint; this does not add/alter PlayerController or NPC collision geometry.
  const obstacles=[...BIRYONG_REALM_P0_OBSTACLES, {
    polygon:biryongMapRectangle(BIRYONG_STATION_BUILDING),minY:0,maxY:BIRYONG_STATION_BUILDING.height
  }];
  const navigator=createBiryongVillageNpcNavigator({
    clearance:WALK_SHAPE.radius,obstacles,
    // Reuse the player's continuous rounded-capsule sweep rather than relying on
    // the NPC planner's coarse point samples at a narrow building corner.
    segmentValidator:(from,to)=>{
      const reached=moveAroundPolygons({...from,y:PLAYER_ORIGIN_Y},to.x-from.x,to.z-from.z,obstacles,WALK_SHAPE);
      return Math.hypot(reached.x-to.x,reached.z-to.z)<1e-7;
    }
  });
  const byId=new Map(BIRYONG_MAP_DESTINATIONS.map(value=>[value.poiId,value]));
  const point=value=>Object.freeze({x:value.x,z:value.z});
  const stationRoad = BIRYONG_STATION_SURFACES.find(shape => shape.kind === 'ROAD');
  const roads = [...BIRYONG_VILLAGE_ROADS, {
    width: stationRoad.width,
    points: [{x:stationRoad.x,z:stationRoad.z-stationRoad.depth/2}, {x:stationRoad.x,z:stationRoad.z+stationRoad.depth/2}]
  }];
  const distanceToSegment = (p,a,b) => {
    const dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));
    return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);
  };
  const roadDistances = position => roads.flatMap(road => road.points.slice(1).map((b,index) => ({
    distance:distanceToSegment(position,road.points[index],b),halfWidth:road.width/2
  })));

  const target=(id,title,position,source,poiId=null)=>Object.freeze({
    id,title,poiId,source,mapSourceId:BIRYONG_REALM_REGION_ID,
    ...point(position),approach:point(position),arrivalRadius:1.5
  });
  const solve=(from,to)=>{
    let path;
    try { path=navigator.route(from,to); } catch { path=null; }
    if (!path) return Object.freeze({ok:false,reason:'BLOCKED',points:Object.freeze([]),distance:null});
    const points=Object.freeze([point(from),...path.map(point)]);
    return Object.freeze({ok:true,mode:'NETWORK',reason:null,points,distance:polylineLength(points)});
  };
  return Object.freeze({
    spaceId:BIRYONG_REALM_REGION_ID,solver:Object.freeze({solve,segmentSafe:navigator.segmentSafe}),
    walkable:navigator.walkable,segmentSafe:navigator.segmentSafe,
    poiTarget(poi,mapSourceId=BIRYONG_REALM_REGION_ID) {
      const canonical=byId.get(poi?.poiId);
      if(mapSourceId!==BIRYONG_REALM_REGION_ID||!canonical) return null;
      return target(`poi:${canonical.poiId}`,canonical.title,canonical.position,NAV_DESTINATION_SOURCE.POI,canonical.poiId);
    },
    mapPointTarget(position,mapSourceId=BIRYONG_REALM_REGION_ID) {
      if(mapSourceId!==BIRYONG_REALM_REGION_ID) return Object.freeze({supported:false,reason:'INVALID'});
      if(!navigator.walkable(position)) return Object.freeze({supported:false,reason:'BLOCKED'});
      const distances=roadDistances(position);
      // Walkable preview fields/lab/outer sinks are not implemented destinations.
      if (!getBiryongRealmPlaceZone(position) && !distances.some(value=>value.distance<=value.halfWidth)) {
        return Object.freeze({supported:false,reason:'OFF_NETWORK'});
      }
      return Object.freeze({supported:true,reason:null,walkwayDistance:Math.min(...distances.map(value=>value.distance)),
        target:target(`point:biryong-realm:${position.x.toFixed(1)},${position.z.toFixed(1)}`,'비룡 지도에서 고른 위치',position,NAV_DESTINATION_SOURCE.MAP_POINT)});
    }
  });
}
