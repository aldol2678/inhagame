// Disposable local browser QA: await (await import('/qa-north-campus-runtime.mjs')).run()
import { NORTH_APPROACHES } from './src/north-campus-layout.js';
import { roadviewGroundHeight } from './src/roadview-layout.js';
import { viewDistancePreset } from './src/view-distance.js';
export function run(){
  const d=window.__INHAGAME_P0__,report=[];
  try{
    for(const preset of ['SHORT','NORMAL','FAR','MAX']){
      d.streaming.setPolicy(viewDistancePreset(preset));
      for(const t of NORTH_APPROACHES){
        const start=t.frame.at(t.u,t.landing+t.run+1);
        d.player.setLocalPosition(start.x,1.15,start.z);
        d.controller.mounted=false;d.controller.velocityY=0;d.controller.grounded=true;d.orbit.yaw=0;
        for(const out of [t.landing*.95,t.landing+t.run+1]){
          const target=t.frame.at(t.u,out);let arrived=false;
          for(let i=0;i<600;i++){
            const p=d.player.getLocalPosition(),dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);
            if(len<.01){arrived=true;break;}
            d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(1/60,len/7));
            const n=d.player.getLocalPosition();
            if(Math.abs(n.y-1.15-roadviewGroundHeight(n.x,n.z))>.01)throw Error(`Height mismatch: ${t.id}`);
          }
          if(!arrived)throw Error(`Blocked: ${t.id} ${preset}`);
        }
        const root=d.app.root.findByName(t.owner);
        const meshes=root.findComponents('render').flatMap(c=>c.meshInstances);
        if(!meshes.length)throw Error('Missing north building');
        for(const mi of meshes){const positions=[];mi.mesh.getPositions(positions);if(!positions.every(Number.isFinite))throw Error('Non-finite GPU mesh');}
        report.push({preset,approach:t.id,stairs:'PASS',meshes:meshes.length});
      }
    }
    return {renderer:d.getStatus().renderer,report,baseBuilds:d.getStatus().streamingMetrics.baseBuilds};
  }finally{d.controller.touchVector={x:0,y:0};d.streaming.setPolicy(d.viewSettings.current);}
}
