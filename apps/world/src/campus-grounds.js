import * as pc from 'playcanvas';
import { SITE_FEATURES } from './basic-campus.js';
import { polygon,segment,surface,box } from './campus-render-kit.js';
import { pondWaterMaterial } from './pond-water.js';
import { CAMPUS_PATH_WIDTHS, roadFrame } from './campus-road-layout.js';
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { roadSurface } from './campus-road-geometry.js';
import { MAIN_GATE_CAMPUS_LINK_IDS, MAIN_GATE_CAMPUS_LINK_LEVELS as L, MAIN_GATE_CENTRAL_POOL_ID, gateCentralPoolRimFaces } from './main-gate-terrain-layout.js';

import { gateGroundOverlaps, fillLegacyGateGround } from './main-gate-surface-ownership.js';
import { MAIN_HALL_WALKWAY_SOURCE_IDS } from './main-hall-walkway-layout.js';

export function buildCampusGrounds(root) {
  const gateBatch=new FacilityMeshBatch();
  for(const feature of SITE_FEATURES) {
    const points=feature.vertices;
    if(feature.kind==='path') {
      for(let i=1;i<points.length;i++) {
        // Width is a presentation estimate; the source centreline is retained.
        const width=CAMPUS_PATH_WIDTHS[feature.id]||3.5;
        const frame=roadFrame(points[i-1],points[i]);
        const strip=w=>[frame.at(0,-w/2),frame.at(frame.length,-w/2),frame.at(frame.length,w/2),frame.at(0,w/2)];
        if(gateGroundOverlaps(strip(width+2.1))){
          fillLegacyGateGround(gateBatch,'#b4b4a8',strip(width+2.1),L.edge);
          fillLegacyGateGround(gateBatch,'#747d7b',strip(width),L.road);
          continue;
        }
        if((i===1&&MAIN_GATE_CAMPUS_LINK_IDS.includes(feature.id))||MAIN_HALL_WALKWAY_SOURCE_IDS.includes(feature.id)){
          // Only the connected pool avenues/hall cross-lane join the shared
          // flat-ground band. Their source widths and centre lines stay intact.
          const f=roadFrame(points[i-1],points[i]);
          roadSurface(gateBatch,'#b4b4a8',f,0,f.length,-(width+2.1)/2,(width+2.1)/2,L.edge);
          roadSurface(gateBatch,'#747d7b',f,0,f.length,-width/2,width/2,L.road);
          continue;
        }
        segment(root,`${feature.id}_sidewalk_${i}`,points[i-1],points[i],width+2.1,surface('#b4b4a8'),.035);
        segment(root,`${feature.id}_${i}`,points[i-1],points[i],width,surface('#747d7b'),.055);
      }
    } else if(feature.kind==='reflecting_pool') {
      polygon(root,feature.id,points,pondWaterMaterial(pc.Application.getApplication().graphicsDevice),{y:.025});
      if(feature.id===MAIN_GATE_CENTRAL_POOL_ID){
        for(const face of gateCentralPoolRimFaces(points))gateBatch.quad('#c8c7b4',...face);
      }else for(let i=0;i<points.length;i++)segment(root,`${feature.id}_rim_${i}`,points[i],points[(i+1)%points.length],.3,surface('#c8c7b4'),.04,.08);
    } else {
      polygon(root,feature.id,points,surface('#729451'),{y:.018});
    }
  }
  gateBatch.finish(root,'main_gate_campus_ground_links',{castShadows:false});
}

export function buildCampusTrees(root,trees) {
  for(const {id,x,z,index} of trees){
    box(root,`${id}_trunk`,[x,1.2,z],[.28,2.4,.28],surface('#776750'));
    box(root,`${id}_crown`,[x,2.9,z],[3.8,2.5,3.8],surface(index%2?'#64854a':'#527745'),0,'sphere');
  }
}
