import * as pc from 'playcanvas';
import { mainGateProductionStructure } from './editor/main-gate-production.js';
import { buildGateRoadview } from './roadview-details.js';
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { fillCampusBike, setCampusBikePropRoot } from './mounts/campus-bike-world.js';
import { buildMainGateDetail } from './main-gate-detail.js';

export function buildGateBlockout(root) {
  buildGateRoadview(root);
  const holder = new pc.Entity('main_gate_campus_bike_root');
  root.addChild(holder);
  const bike = new FacilityMeshBatch();
  fillCampusBike(bike);
  bike.finish(holder, 'main_gate_campus_bike');
  setCampusBikePropRoot(holder);
  const walls = new FacilityMeshBatch();
  for(const id of ['gate_wall_-1','gate_wall_-1_cap','gate_wall_1','gate_wall_1_cap']) {
    const wall=mainGateProductionStructure(id);
    walls.box(wall.color,wall.position,wall.size,wall.yaw);
  }
  walls.finish(root,'main_gate_editor_walls');
  // Road, sidewalks and zebra crossings are owned by main-gate-road-geometry.js.
  // Do not add legacy box/segment overlays here: even thin boxes can occlude avatar feet.
  buildMainGateDetail(root);
}
