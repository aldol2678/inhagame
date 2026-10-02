import { BACK_ROADSIDE_ASSETS } from './back-roadside-layout.js';
import { roadSurface } from './campus-road-geometry.js';
const bark='#6c5942',metal='#93998f',dark='#505b5b',leaf='#527447';
const point=(q,u,v,y)=>{const p=q.frame.at(u,v);return[p.x,y,p.z];};
const box=(b,q,c,u,v,y,w,h,d)=>b.box(c,point(q,u,v,y),[w,h,d],q.frame.yaw);
export function fillBackRoadside(b){
  for(const q of BACK_ROADSIDE_ASSETS){
    if(q.kind==='tree'){
      roadSurface(b,'#b4b4a8',q.frame,-.52,.52,-.52,.52,.13);
      roadSurface(b,bark,q.frame,-.43,.43,-.43,.43,.135);
      b.tube(bark,point(q,0,0,.13),point(q,0,0,3.4),.14,7);
      // Pruned branching street-tree silhouette visible in the April panorama.
      for(const side of [-1,1]){
        b.tube(bark,point(q,0,0,2.15),point(q,side*.85,.12,3.5),.075,6);
        b.crown(leaf,point(q,side*.65,.12,3.9),[1.7,1.4,2.15]);
      }
      b.crown('#66866b',point(q,0,-.1,4.4),[1.8,1.3,1.9]);
    }else{
      const h=q.height,dir=-q.side,utility=q.kind==='utility';
      b.tube(metal,point(q,0,0,.12),point(q,0,0,h),q.radius,8);
      box(b,q,dark,0,0,.24,.22,.25,.22);
      // Angled double-braced arm and flattened LED head; no dynamic light cost.
      b.tube(metal,point(q,0,0,h-.38),point(q,0,dir*.85,h+.12),.035,6);
      b.tube(metal,point(q,0,0,h-.65),point(q,0,dir*.65,h+.03),.022,5);
      box(b,q,dark,0,dir*.93,h+.10,.22,.07,.43);
      box(b,q,'#dedcd1',0,dir*.93,h+.06,.18,.016,.34);
      if(utility){
        for(const y of [.45,.75])b.tube('#d8b453',point(q,0,0,y),point(q,0,0,y+.12),.074,6);
        box(b,q,dark,0,.08,2.2,.2,.32,.13);
      }else{
        b.tube(metal,point(q,0,0,2.3),point(q,0,q.side*.45,2.5),.03,6);
        box(b,q,dark,0,q.side*.48,2.48,.16,.065,.27);
      }
    }
  }
  return b;
}
