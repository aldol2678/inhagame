import { BACK_FURNITURE, BACK_FURNITURE_WALLS, BACK_BENCH_SEAT } from './back-furniture-layout.js';
import { roadSurface } from './campus-road-geometry.js';
const stone='#b4b4a8',wood='#8d6848',dark='#505b5b',soil='#6c5942',green='#527447';
const point=(q,u,v,y)=>{const p=q.frame.at(u,v);return[p.x,y,p.z];};
const box=(b,q,c,u,v,y,w,h,d)=>b.box(c,point(q,u,v,y),[w,h,d],q.frame.yaw);
export function fillBackFurnitureBase(b){
  for(const q of BACK_FURNITURE_WALLS){
    if(q.kind==='hedge'){
      box(b,q,stone,0,0,.10,q.w,.20,.60);
      box(b,q,green,0,0,.32,q.w,.32,.56);
    }else if(q.kind==='solid'){
      box(b,q,'#a7aaa2',0,0,.62,q.w,1.24,.24);
      box(b,q,stone,0,0,1.29,q.w,.12,.30);
      box(b,q,'#93998f',-q.w/2+.05,0,.64,.10,1.28,.28);
    }else{
      box(b,q,stone,0,0,.17,q.w,.34,.26);
      box(b,q,stone,0,0,.855,q.w,.09,.30);
      for(let u=-q.w/2+.10;u<q.w/2;u+=.32)box(b,q,stone,u,0,.59,.10,.5,.18);
    }
  }
  for(const q of BACK_FURNITURE){
    if(q.kind==='tree'){
      roadSurface(b,stone,q.frame,-.65,.65,-.65,.65,.10);
      roadSurface(b,soil,q.frame,-.52,.52,-.52,.52,.105);
      b.tube(soil,point(q,0,0,.10),point(q,0,0,3.25),.13,7);
      for(const side of [-1,1]){
        b.tube(soil,point(q,0,0,2.05),point(q,side*.72,.1,3.3),.065,6);
        b.crown(green,point(q,side*.55,.1,3.7),[1.8,1.45,2.15]);
      }
      b.crown('#66866b',point(q,.1,-.1,4.1),[1.8,1.4,1.8]);
    }else if(q.kind==='bench'){
      // A level recess behind the through sidewalk; seat faces the street.
      roadSurface(b,stone,q.frame,-.85,.85,-.55,1.65,.10);
      for(const u of [-.38,.38]){
        box(b,q,dark,u,0,.2,.065,.22,.36);
        box(b,q,dark,u,-.18,.43,.045,.37,.05);
      }
      for(let v=-.15;v<=.15;v+=.1)box(b,q,wood,0,v,BACK_BENCH_SEAT.centerY,1.1,BACK_BENCH_SEAT.slatHeight,.08);
      for(const y of [.46,.57])box(b,q,wood,0,-.20,y,1.1,.075,.05);
      for(const u of [-.51,.51])box(b,q,dark,u,0,.46,.035,.035,.4);
    }else{
      box(b,q,stone,0,0,.24,1.1,.28,.55);
      box(b,q,soil,0,0,.385,.94,.025,.40);
      for(const u of [-.34,0,.34])b.crown(green,point(q,u,0,.46),[.39,.20,.36]);
    }
  }
  return b;
}
export function fillBackFurnitureDetail(b,ids){
  for(const q of BACK_FURNITURE.filter(q=>ids.includes(q.id))){
    if(q.kind==='tree'){
      for(const u of [-.32,.32]){
        b.tube(wood,point(q,u,0,.1),point(q,u,0,1.25),.025,5);
        b.tube(dark,point(q,u,0,1.15),point(q,0,0,1.25),.014,4);
      }
      for(const v of [-.56,.56])for(let u=-.5;u<.6;u+=.25)box(b,q,'#90958d',u,v,.112,.012,.01,.12);
    }else if(q.kind==='bench'){
      for(const u of [-.38,.38])for(const y of [.46,.57])box(b,q,dark,u,-.23,y,.025,.025,.015);
      for(let u=-.8;u<.9;u+=.4)roadSurface(b,'#929992',q.frame,u,u+.014,-.55,1.65,.105);
    }else{
      for(let i=0;i<5;i++)b.crown(i%2?'#d2bf81':'#b98088',point(q,-.4+i*.2,.04,.57),[.09,.07,.09]);
    }
  }
  return b;
}
