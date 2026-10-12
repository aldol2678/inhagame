// Render the existing game approach contract. No recovered photo mesh, new route,
// terrain height or collider is introduced. One batch owns both canonical stairs.
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { LIBRARY_APPROACHES, librarySideRailStart } from './roadview-layout.js';

export function fillLibraryApproaches(batch, approaches = LIBRARY_APPROACHES) {
  for (const t of approaches) {
    const stone='#d5d3c7', rail='#aeb8b4';
    const box=(color,u,out,y,w,d,h)=>{const p=t.frame.at(u,out);batch.box(color,[p.x,y,p.z],[w,h,d],t.frame.yaw);};
    const width=t.frame.length-2*t.inset,center=t.frame.length/2;
    box(stone,center,t.landing/2,t.height/2,width,t.landing,t.height);
    // Outward tread i agrees exactly with libraryStairHeight's floor() intervals.
    const run=t.run/t.steps;
    for(let i=0;i<t.steps;i++){
      const top=t.height*(1-i/t.steps);
      box(stone,center,t.landing+(i+.5)*run,top/2,width,run,top);
    }
    for(const side of [0,1]){
      const u=side?t.frame.length-t.inset/2:t.inset/2;
      box(stone,u,(t.landing+t.run)/2,t.height/2,t.inset,t.landing+t.run,t.height);
      const begin=librarySideRailStart(t,side),end=t.landing+t.run;
      const innerU=side?t.frame.length-t.inset+.06:t.inset-.06;
      const p=(out,y)=>{const p=t.frame.at(innerU,out);return [p.x,y,p.z];};
      for(const y of [t.height+.22,t.height+.43])batch.tube(rail,p(begin,y),p(end,y),.025,6);
      const count=Math.ceil((end-begin)/1.1);
      for(let i=0;i<=count;i++){
        const out=begin+(end-begin)*i/count;
        batch.tube(rail,p(out,t.height),p(out,t.height+.45),.025,6);
      }
    }
  }
  return batch;
}

export function buildLibraryApproaches(root) {
  const batch=new FacilityMeshBatch();
  fillLibraryApproaches(batch);
  batch.finish(root,'library_canonical_approaches');
}
