import * as pc from 'playcanvas';
import { SITE_FEATURES } from './basic-campus.js';
import { polygon,segment,surface } from './campus-render-kit.js';
import { CENTRAL_LAWN_CANOPY_COLORS, CENTRAL_LAWN_SHRUB_COLOR } from './campus-material-profile.js';
import { pondWaterMaterial } from './pond-water.js';
import { CAMPUS_PATH_WIDTHS, roadFrame } from './campus-road-layout.js';
import { campusReliefHeight, forEachReliefTriangle } from './campus-relief.js';
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

export function buildCampusLandforms(root){
  // All relief vertices are interior to the corresponding receiver. Draw only
  // triangles with a raised corner. Each boundary meets its existing flat base.
  const relief=new FacilityMeshBatch();
  forEachReliefTriangle((way,...tri)=>{
    const lawn=lawnColors['site_'+way], baseY=lawn ? .018 : 0;
    relief.triangle(lawn??'#8b9274',...tri.map(([x,y,z])=>[x,y+baseY,z]));
  });
  relief.finish(root,'campus_landform',{castShadows:false});
}

// Rounded broadleaf silhouettes built in the same chunk batches as the trunks.
function addCanopy(batch, color, x, y, z, width, height, depth, phase) {
  const profiles = [[-.72, .66], [-.2, .98], [.43, .91], [.8, .6]];
  const rings = profiles.map(([level, radius], layer) => Array.from({ length: 8 }, (_, i) => {
    const angle = i * Math.PI / 4 + phase + (layer % 2) * .16;
    const lobe = radius * (1 + .075 * Math.cos(3 * angle + phase));
    return [x + width * lobe * Math.cos(angle), y + level * height,
      z + depth * lobe * Math.sin(angle)];
  }));
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    batch.triangle(color, [x, y - height, z], rings[0][i], rings[0][j]);
    for (let layer = 1; layer < rings.length; layer++) {
      const low = rings[layer - 1], high = rings[layer];
      batch.quad(color, low[i], high[i], high[j], low[j]);
    }
    batch.triangle(color, [x, y + height, z], rings[3][j], rings[3][i]);
  }
}

export function buildCampusTrees(root, trees) {
  const batch = new FacilityMeshBatch();
  for (const { x, z, index, bankRow } of trees) {
    const scale = .93 + .11 * Math.sin(x * .7 + z);
    const baseY=campusReliefHeight(x,z);
    const leaf = CENTRAL_LAWN_CANOPY_COLORS[index % CENTRAL_LAWN_CANOPY_COLORS.length];
    const lean = index % 2 ? .46 : -.46;
    batch.tube('#756650', [x, baseY, z], [x, baseY + 2.6 * scale, z], .14, 6);
    addCanopy(batch, leaf, x + lean * .3, baseY + 3.12 * scale, z,
      1.84 * scale, 1.57 * scale, 1.7 * scale, index * .61);
    if (!bankRow && index % 2 === 0) {
      batch.crown(CENTRAL_LAWN_SHRUB_COLOR, [x + .76, campusReliefHeight(x+.76,z-.45)+.24, z - .45], [1.6, .64, 1.18]);
      batch.crown(CENTRAL_LAWN_SHRUB_COLOR, [x + 1.2, campusReliefHeight(x+1.2,z-.16)+.17, z - .16], [1, .46, .94]);
    }
  }
  batch.finish(root, 'central_lawn_planting');
}
