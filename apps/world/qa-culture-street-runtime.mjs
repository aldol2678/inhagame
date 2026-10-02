// Browser QA: invoke run(window.__INHAGAME_P0__) after the local campus loads.
import { CULTURE_GATE, CULTURE_GATE_STATION, CULTURE_SEGMENTS, CULTURE_LENGTH, culturePoint } from './src/culture-street-layout.js';
import { viewDistancePreset } from './src/view-distance.js';

export function pose(d, view='front') {
  const station=view==='north'?CULTURE_LENGTH-7:CULTURE_GATE_STATION+(view==='rear'?10:-11);
  const p=culturePoint(station),target=culturePoint(view==='north'?CULTURE_LENGTH:CULTURE_GATE_STATION);
  d.player.setLocalPosition(p.x,1.15,p.z);
  d.controller.velocityY=0;d.controller.grounded=true;d.controller.mounted=false;d.controller.touchVector={x:0,y:0};
  d.orbit.yaw=-Math.atan2(target.x-p.x,target.z-p.z);d.orbit.pitch=.12;d.app.fire('update',.016);
}

export async function run(d=window.__INHAGAME_P0__) {
  const report=[],base=d.app.root.findByName('CampusBase'),guid=base.getGuid();
  const position=p=>{d.player.setLocalPosition(p.x,1.15,p.z);d.controller.velocityY=0;d.controller.grounded=true;d.controller.mounted=false;d.orbit.yaw=0;};
  const walk=async target=>{
    for(let i=0;i<2000;i++) {
      const p=d.player.getLocalPosition(),dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz);
      if(len<.005)return;
      d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(1/60,len/7));
      if(Math.abs(d.player.getLocalPosition().y-1.15)>.001)throw Error('Culture ground height changed');
      // Let streaming uploads/disposal and the browser render between batches.
      if(i%12===11){d.controller.touchVector={x:0,y:0};await new Promise(requestAnimationFrame);}
    }
    throw Error('Culture route blocked');
  };
  try {
    for(const preset of ['SHORT','NORMAL','FAR','MAX']) {
      d.streaming.setPolicy(viewDistancePreset(preset));
      for(const s of CULTURE_SEGMENTS) {position(s.frame.at(0));await walk(s.frame.at(s.frame.length));await walk(s.frame.at(0));}
      for(const u of [-.6,0,.6]) {position(CULTURE_GATE.frame.at(u,-4));await walk(CULTURE_GATE.frame.at(u,4));await walk(CULTURE_GATE.frame.at(u,-4));}
      d.places.update(culturePoint(CULTURE_LENGTH));
      if(d.getCurrentPlaceZone()?.id!=='AREA_CULTURE_STREET')throw Error('Culture place label missing');
      if(base.getGuid()!==guid)throw Error('Persistent streetscape rebuilt');
      const signs=base.findByName('culture_street_lettering');
      if(!signs?.render?.meshInstances.length)throw Error('Street lettering missing');
      const uv=[];signs.render.meshInstances[0].mesh.getUvs(0,uv);
      if(uv.length!==16||uv[1]<=uv[5])throw Error('Lettering atlas is upside down or missing reverse face');
      report.push({preset,segments:CULTURE_SEGMENTS.length,crossings:3,status:'PASS'});
    }
    return {renderer:d.getStatus().renderer,report};
  } finally {d.streaming.setPolicy(d.viewSettings.current);pose(d);}
}
