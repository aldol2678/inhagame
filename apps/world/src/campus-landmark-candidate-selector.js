import * as pc from 'playcanvas';
import {buildMainHallBlockout} from './main-hall-blockout.js';
import {buildMainHallCandidate} from './main-hall-candidate-renderer.js';
import {buildJeongseokCandidate} from './jeongseok-candidate-renderer.js';

const builders=new Map([['bldg_01',buildMainHallCandidate],['bldg_jungseok',buildJeongseokCandidate]]);
const owners=new WeakMap();

// Explicit presentation seam. Route each selected building/tier through
// this function once; do not also pass that ID to the legacy campus builder.
// It uses one identity-transform owner for either presentation, never both.
// Normal campus and place previews use the bounded router below.
export function selectCampusLandmark(root,buildingId,tier='BASE',{mode='existing'}={}){
 if(!builders.has(buildingId))throw new RangeError('Unsupported landmark building');
 if(!['BASE','NEAR','DETAIL'].includes(tier))throw new RangeError('Unsupported landmark tier');
 if(!['existing','candidate'].includes(mode))throw new RangeError('Unsupported landmark presentation');
 let slots=owners.get(root);if(!slots){slots=new Map();owners.set(root,slots);}
 const key=`${buildingId}:${tier}`,previous=slots.get(key);
 if(previous?.mode===mode){
  if(previous.group.parent===root)return previous.group;
  if(!previous.group.parent){root.addChild(previous.group);return previous.group;}
 }
 // Prepare off-tree. A construction failure leaves the active old tier alone;
 // successful replacement destroys it before the new tier becomes visible.
 const group=new pc.Entity(`${buildingId}_presentation_${tier}`);group.enabled=false;
 try{
  if(mode==='candidate')builders.get(buildingId)(group,tier);
  else buildMainHallBlockout(group,[buildingId],tier);
 }catch(error){group.destroy();throw error;}
 if(previous&&(previous.group.parent===root||!previous.group.parent))previous.group.destroy();
 root.addChild(group);group.enabled=true;
 slots.set(key,{mode,group});group.once('destroy',()=>{if(slots.get(key)?.group===group)slots.delete(key);});
 return group;
}

// Activate only the two approved landmarks. Preserve the existing builder for
// any other building IDs, without ever sending selected IDs to both owners.
// Call before the parent tier gathers its fade-material clones.
export function buildCampusLandmarks(root,ids,tier='BASE'){
 if(!Array.isArray(ids))throw new TypeError('Landmark building IDs must be an array');
 if(!['BASE','NEAR','DETAIL'].includes(tier))throw new RangeError('Unsupported landmark tier');
 const unique=[...new Set(ids)],legacy=unique.filter(id=>!builders.has(id));
 if(legacy.length)buildMainHallBlockout(root,legacy,tier);
 for(const id of unique)if(builders.has(id))selectCampusLandmark(root,id,tier,{mode:'candidate'});
}
