import * as pc from 'playcanvas';
import {buildMainHallBlockout} from './main-hall-blockout.js';

// Caller-owned, opt-in tier adapter. The caller selects this OR the legacy
// bldg_01 path for each tier; never append it over an already-rendered building.
// Coordinates, batches, shared materials and disposal stay with the same owner.
const roots=new WeakMap();
export function buildMainHallCandidate(root,tier='BASE'){
 if(!['BASE','NEAR','DETAIL'].includes(tier))throw Error('Unsupported main hall candidate tier');
 let entries=roots.get(root);if(!entries){entries=new Map();roots.set(root,entries);}
 const previous=entries.get(tier);
 if(previous?.parent===root)return previous;
 // A detached but live tier can be remounted without allocating duplicate
 // meshes. An externally reparented tier belongs to that other caller now.
 if(previous&&!previous.parent){root.addChild(previous);return previous;}
 const group=new pc.Entity(`bldg_01_candidate_${tier}`);root.addChild(group);
 try{buildMainHallBlockout(group,['bldg_01'],tier,{mainHallDetail:'candidate'});}catch(error){group.destroy();throw error;}
 entries.set(tier,group);group.once('destroy',()=>{if(entries.get(tier)===group)entries.delete(tier);});
 return group;
}
