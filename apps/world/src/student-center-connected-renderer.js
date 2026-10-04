import * as pc from 'playcanvas';
import {FacilityMeshBatch} from './facility-mesh-batch.js';
import {surface} from './campus-render-kit.js';
import {photoLandmarkSurface} from './photo-landmark-materials.js';
import {fillStudentCenterConnected} from './student-center-connected-geometry.js';
export {fillStudentCenterConnected};
export function buildStudentCenterConnected(root,tier='BASE',options={}){const batch=new FacilityMeshBatch();fillStudentCenterConnected(batch,tier,options);const group=new pc.Entity(`bldg_07_connected_${tier}`);root.addChild(group);batch.finish(group,`student_connected_${tier}`,{castShadows:tier==='BASE',materialForColor:tier==='NEAR'?photoLandmarkSurface:surface});return group;}
