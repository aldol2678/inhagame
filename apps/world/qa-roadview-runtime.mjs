// Disposable local QA tab: await (await import('/qa-roadview-runtime.mjs')).run()
import { AGORA, roadviewGroundHeight } from './src/roadview-layout.js';
import { viewDistancePreset } from './src/view-distance.js';
export function run(){
  const d=window.__INHAGAME_P0__,report=[];
  const u=(AGORA.stairStart+AGORA.stairEnd)/2;
  try{
    for(const preset of ['SHORT','NORMAL','FAR','MAX']){
      d.streaming.setPolicy(viewDistancePreset(preset));
      const start=AGORA.frame.at(u,6);
      d.player.setLocalPosition(start.x,1.15,start.z);
      d.controller.mounted=false;d.controller.velocityY=0;d.controller.grounded=true;d.orbit.yaw=0;
      for(const out of [-2,6]){
        const target=AGORA.frame.at(u,out);let arrived=false;
        for(let i=0;i<600;i++){
          const p=d.player.getLocalPosition(),dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);
          if(len<.01){arrived=true;break;}
          d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(1/60,len/7));
          const n=d.player.getLocalPosition();
          if(Math.abs(n.y-1.15-roadviewGroundHeight(n.x,n.z))>.01)throw Error('height mismatch '+preset);
        }
        if(!arrived)throw Error('blocked '+preset);
      }
      d.streaming.update(1,d.player.getLocalPosition());
      if(!d.app.root.findByName('fac_agora_courtyard_platform_body')?.render)throw Error('platform missing');
      report.push({preset,stairs:'PASS',y:d.player.getLocalPosition().y});
    }
    return {renderer:d.getStatus().renderer,report,baseBuilds:d.getStatus().streamingMetrics.baseBuilds};
  }finally{
    d.controller.touchVector={x:0,y:0};d.streaming.setPolicy(d.viewSettings.current);
  }
}
