// Run only in a disposable local QA tab: await (await import('/qa-library-runtime.mjs')).run()
import { LIBRARY_APPROACHES,roadviewGroundHeight } from './src/roadview-layout.js';
import { viewDistancePreset } from './src/view-distance.js';
export function run(){
  const d=window.__INHAGAME_P0__,report=[];
  try{
    for(const preset of ['SHORT','NORMAL','FAR','MAX']){
      d.streaming.setPolicy(viewDistancePreset(preset));
      for(const t of LIBRARY_APPROACHES){
        const u=t.frame.length/2,start=t.frame.at(u,t.landing+t.run+1);
        d.player.setLocalPosition(start.x,1.15,start.z);
        d.controller.mounted=false;d.controller.velocityY=0;d.controller.grounded=true;d.orbit.yaw=0;
        for(const out of [t.landing*.8,t.landing+t.run+1]){
          const target=t.frame.at(u,out);let arrived=false;
          for(let i=0;i<600;i++){
            const p=d.player.getLocalPosition(),dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);
            if(len<.01){arrived=true;break;}
            d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(1/60,len/7));
            const n=d.player.getLocalPosition();
            if(Math.abs(n.y-1.15-roadviewGroundHeight(n.x,n.z))>.01)throw Error(`Height mismatch: ${t.id}`);
          }
          if(!arrived)throw Error(`Blocked: ${t.id} ${preset}`);
        }
        const meshes=d.app.root.findByName('CampusBase').children.filter(e=>e.name.startsWith('library_approaches_'));
        if(!meshes.length||meshes.some(e=>!e.enabled))throw Error('Library approaches missing');
        report.push({preset,approach:t.id,stairs:'PASS',meshes:meshes.length});
      }
    }
    return {renderer:d.getStatus().renderer,report,baseBuilds:d.getStatus().streamingMetrics.baseBuilds};
  }finally{d.controller.touchVector={x:0,y:0};d.streaming.setPolicy(d.viewSettings.current);}
}
