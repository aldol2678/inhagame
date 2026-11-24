import * as pc from 'playcanvas';
import { SITE_FEATURES } from './basic-campus.js';
import { polygon,segment,surface } from './campus-render-kit.js';
import { pondWaterMaterial } from './pond-water.js';
import { CAMPUS_PATH_WIDTHS, roadFrame } from './campus-road-layout.js';
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { roadSurface } from './campus-road-geometry.js';
import { MAIN_GATE_CAMPUS_LINK_IDS, MAIN_GATE_CAMPUS_LINK_LEVELS as L, MAIN_GATE_CENTRAL_POOL_ID, gateCentralPoolRimFaces } from './main-gate-terrain-layout.js';

import { gateGroundOverlaps, fillLegacyGateGround } from './main-gate-surface-ownership.js';
import { MAIN_HALL_WALKWAY_SOURCE_IDS } from './main-hall-walkway-layout.js';

// Muted variations keep the four mapped lawn outlines readable from ground level.
const lawnColors = {
  site_218215618: '#86995b', site_218220046: '#829558',
  site_218221011: '#78915a', site_258995412: '#869b64'
};

function addPoolRim(batch, points) {
  for (const face of gateCentralPoolRimFaces(points)) batch.quad('#c8c7b4', ...face);
  for (let i = 0; i < points.length; i++) {
    const frame = roadFrame(points[i], points[(i + 1) % points.length]);
    const count = Math.round(frame.length / 1.7);
    for (let j = 1; j < count; j++) {
      roadSurface(batch, '#928e7d', frame, j * frame.length/count - .028,
        j * frame.length/count + .028, -.146, .146, .085);
    }
  }
}

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
        addPoolRim(gateBatch, points);
      }else for(let i=0;i<points.length;i++)segment(root,`${feature.id}_rim_${i}`,points[i],points[(i+1)%points.length],.3,surface('#c8c7b4'),.04,.08);
    } else {
      polygon(root,feature.id,points,surface(lawnColors[feature.id] ?? '#729451'),{y:.018});
    }
  }
  gateBatch.finish(root,'main_gate_campus_ground_links',{castShadows:false});
}

export function buildCampusTrees(root, trees) {
  const batch = new FacilityMeshBatch();
  const greens = ['#617d4b', '#75894f', '#698653', '#8a935b'];
  for (const { x, z, index, bankRow } of trees) {
    const scale = .93 + .11 * Math.sin(x * .7 + z);
    const leaf = greens[index % greens.length];
    const lean = index % 2 ? .46 : -.46;
    batch.tube('#756650', [x, 0, z], [x, 2.6 * scale, z], .14, 6);
    batch.crown(leaf, [x, 2.95 * scale, z], [3.45 * scale, 3.1 * scale, 3.25 * scale]);
    batch.crown(leaf, [x + lean, 3.48 * scale, z + .24], [2.5 * scale, 2.3 * scale, 2.6 * scale]);
    if (!bankRow && index % 2 === 0) {
      batch.crown('#70874b', [x + .76, .24, z - .45], [1.6, .64, 1.18]);
      batch.crown('#70874b', [x + 1.2, .17, z - .16], [1, .46, .94]);
    }
  }
  batch.finish(root, 'central_lawn_planting');
}
