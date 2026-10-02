import * as pc from 'playcanvas';
import { SITE_FEATURES } from './basic-campus.js';
import { polygon,segment,surface,box } from './campus-render-kit.js';
import { pondWaterMaterial } from './pond-water.js';
import { CAMPUS_PATH_WIDTHS } from './campus-road-layout.js';

export function buildCampusGrounds(root) {
  for(const feature of SITE_FEATURES) {
    const points=feature.vertices;
    if(feature.kind==='path') {
      for(let i=1;i<points.length;i++) {
        // Width is a presentation estimate; the source centreline is retained.
        const width=CAMPUS_PATH_WIDTHS[feature.id]||3.5;
        segment(root,`${feature.id}_sidewalk_${i}`,points[i-1],points[i],width+2.1,surface('#b4b4a8'),.035);
        segment(root,`${feature.id}_${i}`,points[i-1],points[i],width,surface('#747d7b'),.055);
      }
    } else if(feature.kind==='reflecting_pool') {
      polygon(root,feature.id,points,pondWaterMaterial(pc.Application.getApplication().graphicsDevice),{y:.025});
      for(let i=0;i<points.length;i++)segment(root,`${feature.id}_rim_${i}`,points[i],points[(i+1)%points.length],.3,surface('#c8c7b4'),.04,.08);
    } else {
      polygon(root,feature.id,points,surface('#729451'),{y:.018});
    }
  }
}

export function buildCampusTrees(root,trees) {
  for(const {id,x,z,index} of trees){
    box(root,`${id}_trunk`,[x,1.2,z],[.28,2.4,.28],surface('#776750'));
    box(root,`${id}_crown`,[x,2.9,z],[3.8,2.5,3.8],surface(index%2?'#64854a':'#527745'),0,'sphere');
  }
}
