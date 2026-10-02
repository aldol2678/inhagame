import { FACILITIES } from './campus-facilities.js';
import { BUILDINGS, MAIN_ENTRANCE } from './basic-campus.js';
import { getCanonicalLandmark, projectPolygon } from './reality-adapter.js';
import { polygonOverlap } from './polygon-collision.js';
import { BACK_GATE } from './back-gate-layout.js';
import { CULTURE_GATE, CULTURE_LENGTH, culturePoint } from './culture-street-layout.js';
import { MARKET_PREVIEWS, marketRoadFrame } from './back-market-layout.js';
import { EXTERIOR_WORLD_BOUNDS } from './world-exterior-bounds.js';

// Game semantic regions, not surveyed property boundaries. No renderer imports.
const definitions = [
  ['AREA_CULTURE_STREET','인하문화의 거리','C03_CENTRAL',[],[CULTURE_GATE.frame.at(0),culturePoint(CULTURE_LENGTH),MARKET_PREVIEWS['market-cross']].map(p=>[p.x,p.z])],
  ['AREA_BACK_MARKET_67','후문·67번길 상권','C03_CENTRAL',[],[MARKET_PREVIEWS['market-67'],marketRoadFrame('culture_67_north',16).at(0)].map(p=>[p.x,p.z])],
  ['AREA_BACK_MARKET_91','후문·91번길 상권','C03_CENTRAL',[],[[MARKET_PREVIEWS['market-91'].x,MARKET_PREVIEWS['market-91'].z]]],
  ['AREA_BACK_MARKET_WEST','후문·서쪽 골목','C03_CENTRAL',[],[[MARKET_PREVIEWS['market-west'].x,MARKET_PREVIEWS['market-west'].z]]],
  ['AREA_BACK_MARKET_NORTH','후문·47번길 연결상권','C03_CENTRAL',[],[[MARKET_PREVIEWS['market-north'].x,MARKET_PREVIEWS['market-north'].z]]],
  ['AREA_BACK_GATE','후문·인하로 진입부','C03_CENTRAL',[],[[BACK_GATE.x,BACK_GATE.z]]],
  ['AREA_MAIN_GATE','정문·남쪽 진입로','C01_GATE',['bldg_continuing'],[[0,-98],[0,-76]]],
  ['AREA_MAIN_HALL','본관·우남호','C02_MAIN_HALL',['bldg_01','lmk_woonam_aircraft'],[[MAIN_ENTRANCE.x,MAIN_ENTRANCE.z]]],
  ['AREA_CENTRAL_LAWN','중앙 잔디광장','C02_MAIN_HALL',['lmk_matching_tree'],[[26,-45],[38,-78],[-8,-50]]],
  ['AREA_JUNGSEOK_WOONAM','정석·하와이-인하 공원','C02_MAIN_HALL',['bldg_jungseok','lmk_hawaii_park'],[]],
  ['AREA_SPORTS','대운동장·체육시설','C02_MAIN_HALL',['fac_stadium','fac_basketball','fac_tennis','fac_south_court','fac_biryong_parking','bldg_rotc'],[]],
  ['AREA_BUILDING_5_WEST','5호관·서호관·60주년기념관','C02_MAIN_HALL',['bldg_05','bldg_seoho','bldg_nabille','bldg_60th'],[]],
  ['AREA_BUILDING_2_4','2·4호관','C02_MAIN_HALL',['bldg_02_south','bldg_02_north','bldg_04'],[]],
  ['AREA_INKYUNG_STUDENT_CENTER','인경호·학생회관','C03_CENTRAL',['lmk_inkyung_pond','bldg_07','bldg_c','lmk_pond_gazebo','lmk_biryong_tower'],[]],
  ['AREA_AGORA_6_9','아고라·6·9호관','C01_GATE',['bldg_06','bldg_09','fac_agora_courtyard','lmk_heidegger_forest'],[]],
  ['AREA_HITECH','하이테크센터','C03_CENTRAL',['bldg_hitech'],[]],
  ['AREA_EAST_SUPPORT','인하드림센터·하와이교포기념관','C03_CENTRAL',['bldg_dream1','bldg_hawaii'],[]],
  ['AREA_EAST_ANNEX','인하드림센터 2·3관','C03_CENTRAL',['bldg_dream2','bldg_dream3'],[]],
  ['AREA_LAWSCHOOL','로스쿨관','C01_GATE',['bldg_lawschool'],[]],
  ['AREA_DORM_SOUTH','제1생활관','C01_GATE',['bldg_dorm1'],[]],
  ['AREA_DORM_EAST','제2생활관','C01_GATE',['bldg_dorm2'],[]]
];
const pond = getCanonicalLandmark('lmk_inkyung_pond');
const features = new Map([...FACILITIES, ...BUILDINGS.map(f=>({...f,rings:[f.vertices]})),
  {id:pond.id,rings:[projectPolygon(pond.polygon)]}].map(f=>{
    const p=f.rings?.[0];
    return [f.id,{...f,center:f.center||{x:p.reduce((s,q)=>s+q.x,0)/p.length,z:p.reduce((s,q)=>s+q.z,0)/p.length}}];
  }));
export const PLACE_ZONES = Object.freeze(definitions.map(([id,displayName,legacyZoneId,members,seeds])=>Object.freeze({
  id, displayName, legacyZoneId, discoveryId:id, futureRealtimeChannelKey:`world:campus:${id}`,
  resolver:'member-footprint-then-nearest-anchor-v1', members:Object.freeze(members),
  anchors:Object.freeze([...members.map(id=>features.get(id).center),...seeds.map(([x,z])=>({x,z}))]),
  polygons:Object.freeze(members.flatMap(id=>features.get(id).rings?.length?[features.get(id).rings[0]]:[]))
})));

export class PlaceZoneRegistry {
  constructor(zones=PLACE_ZONES,bounds=EXTERIOR_WORLD_BOUNDS) { this.zones=zones;this.bounds=bounds;this.current=null;this.listeners=new Set(); }
  getPlaceZoneAt(position) {
    const {x,z}=position,b=this.bounds;
    if(!Number.isFinite(x)||!Number.isFinite(z)||x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ)return null;
    // Full member footprints win over open-space anchor regions; wings stay together.
    const containing=this.zones.filter(zone=>zone.polygons.some(p=>polygonOverlap(x,z,p,0)));
    const candidates=containing.length?containing:this.zones;
    let result=null,best=Infinity;
    for(const zone of candidates){
      const distance=Math.min(...zone.anchors.map(p=>Math.hypot(p.x-x,p.z-z)));
      if(distance<best){best=distance;result=zone;}
    }
    return result;
  }
  getCurrentPlaceZone() { return this.current; }
  onPlaceZoneChanged(listener) { this.listeners.add(listener);return ()=>this.listeners.delete(listener); }
  update(position) {
    const next=this.getPlaceZoneAt(position),previous=this.current;
    if(next?.id!==previous?.id){this.current=next;for(const listener of this.listeners)listener(previous,next);}
    return this.current;
  }
}

const defaultRegistry=new PlaceZoneRegistry();
export const getPlaceZoneAt=position=>defaultRegistry.getPlaceZoneAt(position);

