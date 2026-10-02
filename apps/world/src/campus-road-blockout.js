import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { fillCampusRoadBatch } from './campus-road-geometry.js';

import { fillNorthRoads } from './north-campus-geometry.js';
import { fillBackGatePaving, fillBackGateStructure } from './back-gate-geometry.js';
import { fillBackStreetBase, fillBackStreetSignals, fillBackStreetNear, fillBackStreetDetail } from './back-street-geometry.js';
import { fillBackApproaches } from './back-approach-geometry.js';
import { fillBackAlleyBase, fillBackAlleyNear, fillBackAlleyDetail } from './back-alley-geometry.js';
import { fillBackWestBase, fillBackWestNear, fillBackWestDetail } from './back-west-geometry.js';
import { fillNorthSideGate } from './north-side-gate-geometry.js';
import { fillBackFurnitureBase, fillBackFurnitureDetail } from './back-furniture-geometry.js';
import { fillBackRoadside } from './back-roadside-geometry.js';
import { fillCulturePaving, fillCultureBase, fillCultureNear, fillCultureDetail } from './culture-street-geometry.js';
import { buildCultureSigns } from './culture-street-signs.js';
import { fillMarketBase, fillMarketNear, fillMarketDetail } from './back-market-geometry.js';
import { MARKET_SIGNS } from './back-market-layout.js';
import { fillInteriorBase, fillInteriorNear, fillInteriorDetail } from './market-interior-geometry.js';
import { buildStreetSigns } from './street-sign-renderer.js';
import { fillMainGateRoads } from './main-gate-road-geometry.js';

export function buildCampusRoads(root) {
  fillMainGateRoads(new FacilityMeshBatch()).finish(root,'main_gate_dorm1_roads',{castShadows:false});
  fillCampusRoadBatch(new FacilityMeshBatch()).finish(root,'campus_roads',{castShadows:false});
  fillNorthRoads(new FacilityMeshBatch()).finish(root,'north_campus_roads',{castShadows:false});
  fillBackGatePaving(new FacilityMeshBatch()).finish(root,'back_gate_roads',{castShadows:false});
  fillBackGateStructure(new FacilityMeshBatch()).finish(root,'back_gate_structure');
  fillBackStreetBase(new FacilityMeshBatch()).finish(root,'back_street_base');
  fillBackStreetSignals(new FacilityMeshBatch()).finish(root,'back_street_signals');
  fillBackApproaches(new FacilityMeshBatch()).finish(root,'back_street_approaches',{castShadows:false});
  fillCulturePaving(new FacilityMeshBatch()).finish(root,'culture_street_paving',{castShadows:false});
  fillCultureBase(new FacilityMeshBatch()).finish(root,'culture_street_base');
  buildCultureSigns(root,[],{canopy:true});
  fillMarketBase(new FacilityMeshBatch()).finish(root,'back_market_base');
  fillInteriorBase(new FacilityMeshBatch()).finish(root,'market_interior_base');
  fillBackAlleyBase(new FacilityMeshBatch()).finish(root,'back_alley_base');
  fillBackWestBase(new FacilityMeshBatch()).finish(root,'back_west_base');
  fillNorthSideGate(new FacilityMeshBatch()).finish(root,'north_side_gate');
  fillBackFurnitureBase(new FacilityMeshBatch()).finish(root,'back_furniture');
  fillBackRoadside(new FacilityMeshBatch()).finish(root,'back_roadside');
}

export function buildBackStreetDetails(root,ids=[],tier){
  if(!ids.length)return;
  (tier==='NEAR'?fillInteriorNear:fillInteriorDetail)(new FacilityMeshBatch(),ids).finish(root,`market_interior_${tier.toLowerCase()}`);
  (tier==='NEAR'?fillMarketNear:fillMarketDetail)(new FacilityMeshBatch(),ids).finish(root,`back_market_${tier.toLowerCase()}`);
  if(tier==='NEAR')buildStreetSigns(root,MARKET_SIGNS.filter(q=>ids.includes(q.id)),'back_market_signs');
  (tier==='NEAR'?fillCultureNear:fillCultureDetail)(new FacilityMeshBatch(),ids).finish(root,`culture_street_${tier.toLowerCase()}`);
  if(tier==='NEAR')buildCultureSigns(root,ids);
  const fill=tier==='NEAR'?fillBackStreetNear:fillBackStreetDetail;
  fill(new FacilityMeshBatch(),ids).finish(root,`back_street_${tier.toLowerCase()}`);
  const alley=tier==='NEAR'?fillBackAlleyNear:fillBackAlleyDetail;
  alley(new FacilityMeshBatch(),ids).finish(root,`back_alley_${tier.toLowerCase()}`);
  const west=tier==='NEAR'?fillBackWestNear:fillBackWestDetail;
  west(new FacilityMeshBatch(),ids).finish(root,`back_west_${tier.toLowerCase()}`);
  if(tier==='DETAIL')fillBackFurnitureDetail(new FacilityMeshBatch(),ids).finish(root,'back_furniture_detail');
}

