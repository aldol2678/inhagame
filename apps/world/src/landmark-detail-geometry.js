import { GAZEBO, AIRCRAFT_YAW, aircraftPoint } from './landmark-detail-layout.js';

export function fillAircraft(batch,center){
  const p=(x,y,z)=>aircraftPoint(center,x,y,z),box=(color,pos,size,yaw=0)=>batch.box(color,p(...pos),size,AIRCRAFT_YAW+yaw);
  batch.tube('#e1e3df',p(0,1.8,-5),p(0,1.8,5),.6,12);
  batch.crown('#e1e3df',p(0,1.8,5.4),[1.2,1.2,1.2]);
  box('#e8e8df',[0,1.7,0],[13,.16,2.3],8);
  box('#e8e8df',[0,2,-4],[4.7,.15,1.2]);box('#e8e8df',[0,2.9,-4.2],[.15,2,1.4]);
  for(const side of [-1,1]){
    batch.tube('#d5d9d9',p(side*2.3,1.7,.5),p(side*2.3,1.7,2),.37);
    box('#354d61',[side*2.3,1.7,2.1],[.12,2,.12]);
    batch.tube('#858b86',p(side*2.3,1.6,.6),p(side*2.3,.34,.6),.075,6);
    batch.tube('#303735',p(side*2.3-.16,.34,.6),p(side*2.3+.16,.34,.6),.34,12);
    box('#a6aaa0',[side*2.3,.04,.6],[.9,.08,1]);
    box('#447599',[side*.58,1.85,0],[.035,.14,7.7]);
    for(let z=-2.8;z<3.1;z+=.85)box('#486271',[side*.57,2.06,z],[.06,.25,.32]);
  }
  batch.tube('#858b86',p(0,1.7,-4.3),p(0,.18,-4.3),.055,6);
  batch.tube('#303735',p(-.1,.18,-4.3),p(.1,.18,-4.3),.18,10);
  box('#426574',[0,2.22,4.45],[.82,.2,.8]);
}
export function fillGazebo(batch){
  const {ring,center,height,entryStart,entryEnd,entryHalfWidth}=GAZEBO;
  for(let i=1;i<=4;i++){
    const depth=(entryEnd-entryStart)/4,top=height*i/4;
    batch.box('#b8b4a5',[center.x+entryStart+(i-.5)*depth,top/2,center.z],[depth+.01,top,entryHalfWidth*2]);
  }
  for(const q of ring)batch.tube('#8c4c3f',[q.x,height,q.z],[q.x,3.4,q.z],.13,8);
  for(let i=0;i<8;i++){
    const a=ring[i],b=ring[(i+1)%8];
    if(i!==GAZEBO.entryEdge){
      for(const y of [.67,1.25])batch.tube('#9d5944',[a.x,y,a.z],[b.x,y,b.z],.07,6);
      for(let j=1;j<6;j++){const t=j/6,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;batch.tube('#718a74',[x,.67,z],[x,1.25,z],.035,4);}
    }
    const at=(q,r,y)=>[center.x+(q.x-center.x)*r,y,center.z+(q.z-center.z)*r];
    batch.triangle('#42514e',[center.x,4.5,center.z],at(b,.58,3.68),at(a,.58,3.68));
    batch.quad('#42514e',at(a,.58,3.68),at(b,.58,3.68),at(b,1.25,3.4),at(a,1.25,3.4));
    batch.tube('#6e7974',at(a,1.25,3.4),at(b,1.25,3.4),.065,6);
    batch.tube('#78917b',[a.x,3.28,a.z],[b.x,3.28,b.z],.1,6);
  }
}
