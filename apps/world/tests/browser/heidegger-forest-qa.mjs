import { FACILITIES } from '../../src/campus-facilities.js';
import { forestRoadTrees, roadSegment } from '../../src/campus-road-layout.js';
export function forestBaselinePlan(changed){
 const replace=['apps/world/src/facility-blockout.js','apps/world/src/campus-material-profile.js'];
 const added=['apps/world/src/heidegger-forest-geometry.js'];
 if(JSON.stringify([...changed].sort())!==JSON.stringify([...replace,...added].sort()))throw Error('Forest comparison runtime scope differs from the approved three-file slice');
 return {replace,added};
}
export function forestViews(){
 const frame=roadSegment(481241661,2).frame,trees=forestRoadTrees(FACILITIES.find(f=>f.id==='lmk_heidegger_forest').center);
 const p=trees.slice(2,6).reduce((s,p)=>({x:s.x+p.x/4,z:s.z+p.z/4}),{x:0,z:0}),eye=frame.at(-1,3.1),ahead=frame.at(14,8.5),close=frame.at(17,1);
 return [
  {id:'brick-walk-eye',from:[eye.x,2.1,eye.z],target:[ahead.x,3.8,ahead.z]},
  {id:'soil-and-canopy',from:[close.x,11,close.z],target:[p.x,3.0,p.z]},
  {id:'far-silhouette',from:[p.x+27,22,p.z+30],target:[p.x+4,4,p.z+6]}
 ];
}
export function forestPixelDelta(current,previous){
 if(!previous||previous.length!==current.length)return Infinity;
 let changed=0;for(let i=0;i<current.length;i+=4)if(Math.abs(current[i]-previous[i])+Math.abs(current[i+1]-previous[i+1])+Math.abs(current[i+2]-previous[i+2])>12)changed++;
 return changed;
}
export function forestCamera(view,aspect){
 const scale=view.id==='soil-and-canopy'?Math.max(1,.84/aspect):1;
 return {...view,from:view.from.map((v,i)=>view.target[i]+(v-view.target[i])*scale)};
}
