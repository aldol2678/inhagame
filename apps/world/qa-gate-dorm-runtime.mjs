import { DORM_1_FRAME } from './src/dorm1-layout.js';
import { GATE_FRAME } from './src/roadview-layout.js';
import { viewDistancePreset } from './src/view-distance.js';
import { GATE_DORM_WALK_ROUTE } from './src/main-gate-road-layout.js';
export async function run(d) {
  const report=[],base=d.app.root.findByName('CampusBase'),guid=base.getGuid();
  try {
    for(const preset of ['SHORT','NORMAL','FAR','MAX']) {
      d.streaming.setPolicy(viewDistancePreset(preset));
      for(const [name,points] of [['gate',[GATE_FRAME.at(0,-20),GATE_FRAME.at(0,13)]],['dorm1',GATE_DORM_WALK_ROUTE]]) {
        const a=points[0];d.player.setLocalPosition(a.x,1.15,a.z);
        d.controller.mounted=false;d.controller.velocityY=0;d.controller.grounded=true;d.orbit.yaw=0;
        for(const target of [...points.slice(1),...points.slice(0,-1).reverse()]) {
          let arrived=false;
          for(let i=0;i<900;i++) {
            const p=d.player.getLocalPosition(),dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);
            if(len<.01){arrived=true;break;}
            d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(1/60,len/7));
            if(i%12===11){d.controller.touchVector={x:0,y:0};await new Promise(requestAnimationFrame);}
          }
          if(!arrived)throw Error(`${preset} ${name} route blocked`);
        }
        d.streaming.update(1,d.player.getLocalPosition());
        if(!d.app.root.findByName(name==='gate'?'main_gate_names':'dorm1_entrance_name'))throw Error(`${name} sign missing`);
        report.push({preset,name,directions:2,status:'PASS'});
      }
      if(base.getGuid()!==guid)throw Error('Persistent campus rebuilt');
    }
    return {renderer:d.getStatus().renderer,report};
  } finally {d.controller.touchVector={x:0,y:0};d.streaming.setPolicy(d.viewSettings.current);}
}
