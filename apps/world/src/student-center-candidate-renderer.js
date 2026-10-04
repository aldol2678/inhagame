import * as pc from 'playcanvas';
import {FacilityMeshBatch} from './facility-mesh-batch.js';
import {surface} from './campus-render-kit.js';
import {photoLandmarkSurface} from './photo-landmark-materials.js';
import {fillStudentCenterCandidate} from './student-center-candidate.js';

// Opt-in preview root owned by the caller. Uses the exact static mesh batching,
// shared source material and entity/mesh disposal contracts of campus facilities.
export function buildStudentCenterCandidate(root,tier='BASE',options={}){
 const batch=new FacilityMeshBatch();fillStudentCenterCandidate(batch,tier,options);
 const group=new pc.Entity(`bldg_07_candidate_${tier}`);root.addChild(group);
 batch.finish(group,`student_candidate_${tier}`,{castShadows:tier==='BASE',materialForColor:tier==='NEAR'?photoLandmarkSurface:surface});
 return group;
}
