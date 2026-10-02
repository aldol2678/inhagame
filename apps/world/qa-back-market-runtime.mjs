// Run through a local QA page after the campus has loaded.
import { MARKET_PREVIEWS, marketRoadFrame } from './src/back-market-layout.js';
import { viewDistancePreset } from './src/view-distance.js';

export function pose(d, name='market-cross') {
  const p=MARKET_PREVIEWS[name];
  d.player.setLocalPosition(p.x,1.15,p.z);
  d.controller.velocityY=0;d.controller.grounded=true;d.controller.mounted=false;d.controller.touchVector={x:0,y:0};
  d.orbit.yaw=p.yaw;d.orbit.pitch=.12;d.app.fire('update',.016);
}
export async function run(d=window.__INHAGAME_P0__) {
  const report=[],base=d.app.root.findByName('CampusBase'),guid=base.getGuid();
  const routes=['inha_67_entrance','inha_91_entrance','culture_cross_east','culture_47_junction','west_47_lane'];
  const walk=async target=>{
    for(let i=0;i<1500;i++) {
      const p=d.player.getLocalPosition(),dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);
      if(len<.005)return;
      d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(1/60,len/7));
      if(Math.abs(d.player.getLocalPosition().y-1.15)>.001)throw Error('Market ground height changed');
      if(i%12===11){d.controller.touchVector={x:0,y:0};await new Promise(requestAnimationFrame);}
    }
    throw Error('Market route blocked');
  };
  try {
    for(const preset of ['SHORT','NORMAL','FAR','MAX']) {
      d.streaming.setPolicy(viewDistancePreset(preset));
      for(const id of routes) {
        const f=marketRoadFrame(id,5),p=f.at(0);
        d.player.setLocalPosition(p.x,1.15,p.z);d.controller.velocityY=0;d.controller.grounded=true;d.controller.mounted=false;d.orbit.yaw=0;
        await walk(f.at(8));await walk(p);
      }
      if(base.getGuid()!==guid)throw Error('Persistent market geometry rebuilt');
      report.push({preset,routes:routes.length,directions:2,status:'PASS'});
    }
    return {renderer:d.getStatus().renderer,report};
  } finally {d.streaming.setPolicy(d.viewSettings.current);pose(d);}
}
