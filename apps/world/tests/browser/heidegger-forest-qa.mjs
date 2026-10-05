import { FACILITIES } from '../../src/campus-facilities.js';
import { forestRoadTrees, roadSegment } from '../../src/campus-road-layout.js';
// The candidate runtime is shared. Only the grove recipe and its soil material
// differ, so adding the relocated matching tree cannot contaminate this A/B.
export function forestBaselinePlan(changed){
 const forest=['facility-blockout.js','campus-material-profile.js','heidegger-forest-geometry.js'].map(p=>'apps/world/src/'+p);
 const matching=['seat-anchors.js','matching-tree-layout.js','matching-tree-geometry.js'].map(p=>'apps/world/src/'+p);
 matching.push('apps/world/data/reality/campus-facilities.json');
 const equals=expected=>JSON.stringify([...changed].sort())===JSON.stringify([...expected].sort());
 if(!equals(forest)&&!equals([...forest,...matching]))throw Error('Forest comparison runtime scope differs from the approved forest and matching-tree slices');
 return {replace:['apps/world/src/campus-material-profile.js'],adapter:'apps/world/src/heidegger-forest-geometry.js',
  shared:['apps/world/src/facility-blockout.js',...(equals(forest)?[]:matching)]};
}
export function forestBaselineAdapter(source){
 const helper="function tree(batch,x,z,scale=1,color='#527447') {\n  batch.tube('#6c5942',[x,0,z],[x,3.2*scale,z],.24*scale);\n  batch.crown(color,[x,4.1*scale,z],[4*scale,3.4*scale,4*scale]);\n}";
 const body="    forestRoadTrees(f.center).forEach((p,i)=>tree(batch,p.x,p.z,1.25,i%2?'#567f48':'#41694b'));";
 const branch="  if(f.style==='forest'){\n"+body+"\n    return;\n  }";
 const unique=text=>source.split(text).length===2;
 if(!unique(helper)||!unique(branch)||!unique("import { forestRoadTrees } from './campus-road-layout.js';"))throw Error('Unexpected previous-main forest source shape');
 return "import { forestRoadTrees } from './campus-road-layout.js';\n"+helper+"\nexport function fillHeideggerForest(batch,center){\n const f={center};\n"+body+"\n}\n";
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
