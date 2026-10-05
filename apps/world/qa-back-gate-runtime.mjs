// Disposable local browser QA using the live controller, renderer and streaming.
import { BACK_GATE, BACK_GATE_FRAME as gate, BACK_SEGMENTS } from './src/back-gate-layout.js';
import { viewDistancePreset } from './src/view-distance.js';
export function run(){
  const d=window.__INHAGAME_P0__,report=[];
  const base=d.app.root.findByName('CampusBase'),guid=base.getGuid();
  const pose=p=>{d.player.setLocalPosition(p.x,1.15,p.z);d.controller.velocityY=0;d.controller.grounded=true;d.controller.mounted=false;d.orbit.yaw=0;d.app.fire('update',.016);};
  const walk=target=>{
    for(let i=0;i<2000;i++){
      const p=d.player.getLocalPosition(),dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);
      if(len<.005)return;
      d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(1/60,len/7));
      if(Math.abs(d.player.getLocalPosition().y-1.15)>.001)throw Error('Back gate ground height');
    }throw Error('Back gate route blocked');
  };
  try{
    for(const preset of ['SHORT','NORMAL','FAR','MAX']){
      d.streaming.setPolicy(viewDistancePreset(preset));
      for(const u of [-6.5,.5]){pose(gate.at(u,2.4));walk(gate.at(u,-4.5));walk(gate.at(u,2.4));}
      for(const s of BACK_SEGMENTS)for(const v of s.road.osmWayId===1223158575?[-1.7,1.7]:[0]){
        pose(s.frame.at(0,v));walk(s.frame.at(s.frame.length,v));walk(s.frame.at(0,v));
      }
      pose(BACK_GATE);d.places.update(BACK_GATE);
      if(d.getCurrentPlaceZone()?.id!=='AREA_BACK_GATE')throw Error('Back gate place label');
      const meshes=base.findComponents('render').filter(c=>c.entity.name.startsWith('back_gate_')).flatMap(c=>c.meshInstances);
      if(meshes.length<5)throw Error('Back gate geometry missing');
      for(const mi of meshes){const p=[];mi.mesh.getPositions(p);if(!p.every(Number.isFinite))throw Error('Invalid back gate GPU mesh');}
      if(base.getGuid()!==guid)throw Error('Persistent gate rebuilt');
      report.push({preset,roadSegments:BACK_SEGMENTS.length,openings:2,meshes:meshes.length,status:'PASS'});
    }
    return {renderer:d.getStatus().renderer,report};
  }finally{d.controller.touchVector={x:0,y:0};d.streaming.setPolicy(d.viewSettings.current);pose(gate.at(.5,2.4));}
}
