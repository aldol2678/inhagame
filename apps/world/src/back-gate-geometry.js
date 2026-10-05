import { BACK_GATE_FRAME as gate, BACK_GATE_BOXES, BACK_SEGMENTS, BACK_TREES } from './back-gate-layout.js';
import { roadSurface } from './campus-road-geometry.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';

const stone='#c7c5bb',trim='#dedcd1',glass='#48666a',metal='#505b5b',yellow='#d8b453';
const point=(f,u,v,y)=>{const p=f.at(u,v);return [p.x,y,p.z];};
const box=(b,f,c,u,v,y,w,h,d)=>b.box(c,point(f,u,v,y),[w,h,d],f.yaw||0);
export function fillBackGatePaving(b){
  for(const s of BACK_SEGMENTS){const f=s.frame,h=s.road.width/2;
    roadSurface(b,'#b4b4a8',f,-.08,f.length+.08,-h-.35,h+.35,G.UNDERLAY);
    roadSurface(b,'#747d7b',f,-.06,f.length+.06,-h,h,G.SURFACE);
    if(s.road.osmWayId===1223158575){
      for(const v of [-h+.14,h-.14])roadSurface(b,yellow,f,0,f.length,v-.035,v+.035,G.PAINT);
      roadSurface(b,yellow,f,0,f.length,-.035,.035,G.PAINT);
      roadSurface(b,'#b4b4a8',f,0,f.length,-h-1.4,-h-.1,G.EDGE);
      roadSurface(b,'#b4b4a8',f,0,f.length,h+.1,h+1.4,G.EDGE);
    }
  }
  // Broad, level entrance pavement; the main opening stays free of planting.
  roadSurface(b,'#aaa99e',gate,-11,5.5,-4,2.3,G.SURFACE);
  for(let u=-10.5;u<5.5;u+=1)roadSurface(b,'#bcbbae',gate,u,u+.035,-4,2.3,G.PAINT);
  for(let v=-4;v<2.3;v+=1)roadSurface(b,'#bcbbae',gate,-11,5.5,v,v+.035,G.PAINT);
  // Crosswalk immediately west of the gate, spanning Inha-ro. Paint is flat.
  for(let u=-11.5;u<-7;u+=.7)roadSurface(b,trim,gate,u,u+.40,3.1,10.1,G.DETAIL);
  return b;
}
export function fillBackGateStructure(b){
  for(const q of BACK_GATE_BOXES)box(b,gate,stone,q.u,q.v,(q.minY+q.maxY)/2,q.w,q.maxY-q.minY,q.d);
  for(const u of [-10,-3,4]){
    for(const y of [2.94,3.05])box(b,gate,trim,u,0,y,1.12,.09,1.1);
    box(b,gate,metal,u,.46,1.0,.20,.9,.025);
  }
  // Pale stone joints, dark security-booth windows and its overhanging flat cap.
  for(const u of [-10,-3,4])for(let y=.4;y<2.9;y+=.4)box(b,gate,'#a9aaa4',u,.456,y,.89,.015,.012);
  box(b,gate,trim,7.1,-.6,1.77,2.8,.14,2.4);
  box(b,gate,glass,7.1,.415,1.05,1.95,.65,.03);
  box(b,gate,glass,5.885,-.6,1.05,.03,.65,1.55);
  box(b,gate,metal,7.1,.44,1.05,.04,.65,.04);
  box(b,gate,metal,-3,.47,2.34,.42,.48,.04);
  // Low bollards mark the edge; no crossbar closes either pedestrian opening.
  for(const u of [-9,-7.5,-5,-1,1.5,3]){
    b.tube(metal,point(gate,u,1.25,0),point(gate,u,1.25,.43),.055,6);
    b.tube(yellow,point(gate,u,1.25,.31),point(gate,u,1.25,.36),.058,6);
  }
  for(const p of BACK_TREES){
    b.tube('#6c5942',[p.x,0,p.z],[p.x,2.8,p.z],.14,6);
    b.crown('#527447',[p.x,3.1,p.z],[2.8,2.5,2.8]);
  }
  return b;
}
