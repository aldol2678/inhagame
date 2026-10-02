import * as pc from 'playcanvas';
import { FACILITIES, towerParts } from './campus-facilities.js';
import { polygon,surface } from './campus-render-kit.js';
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { fillSports } from './sports-detail-geometry.js';
import { SPORTS_FLOOR, LOWERED_SPORTS_IDS } from './stadium-stands-layout.js';
import { forestRoadTrees } from './campus-road-layout.js';
import { AGORA } from './roadview-layout.js';
import { GAZEBO } from './landmark-detail-layout.js';
import { fillAircraft, fillGazebo } from './landmark-detail-geometry.js';
import { buildAgoraStructure, buildAgoraNear, buildStudentTerraces, buildPondFurniture, fillStudentFront } from './roadview-details.js';

import { fillFiveFacade, fillAnniversaryFacade, fillNorthEntrances, fillNorthFurniture, fillFiveGardenPaths } from './north-campus-geometry.js';
import { buildDorm1EntranceDetail, fillDorm1Facade } from './dorm1-detail-geometry.js';
import { DORM_1_NAME_SIGN } from './gate-dorm-exterior-layout.js';
import { buildStreetSigns } from './street-sign-renderer.js';
import { fillBiryongTower } from './biryong/biryong-geometry.js';

const stone='#d7d3c7',trim='#ece9df',glass='#396773',darkGlass='#304d65',roof='#6f7775';
function facade(batch,f,ring,h,style) {
  const area=ring.reduce((s,p,i)=>s+p.x*ring[(i+1)%ring.length].z-ring[(i+1)%ring.length].x*p.z,0);
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
    if(len<1.3)continue;
    const nx=(area>0?dz:-dz)/len,nz=(area>0?-dx:dx)/len,yaw=-Math.atan2(dz,dx)*180/Math.PI;
    const at=(u,y,out=.08)=>[a.x+dx*u+nx*out,y,a.z+dz*u+nz*out];
    const floors=f.floors||4,step=(h-1.4)/floors;
    if(style==='arches') {
      const count=Math.max(1,Math.floor(len/3.8)),width=len/count*.70,r=width/2,top=h-1.1-r;
      for(let j=0;j<count;j++){
        const u=(j+.5)/count;
        batch.box(darkGlass,at(u,(top+1)/2),[width,top-1,.10],yaw);
        const left=at(u-width/len/2,top,.14),right=at(u+width/len/2,top,.14),center=at(u,top,.14);
        let prev=right;
        for(let k=1;k<=10;k++){
          const angle=k/10*Math.PI,point=at(u+Math.cos(angle)*r/len,top+Math.sin(angle)*r,.14);
          batch.triangle(darkGlass,center,point,prev);batch.triangle(darkGlass,center,prev,point);
          batch.tube(trim,prev,point,.09,4);prev=point;
        }
        batch.tube(trim,[...left.slice(0,1),1,left[2]],left,.09,4);batch.tube(trim,[right[0],1,right[2]],right,.09,4);
        for(let k=1;k<floors;k++)batch.box(trim,at(u,1+k*step,.19),[width,.08,.08],yaw);
        batch.box(trim,at(u,top/2,.19),[.08,top,.08],yaw);
      }
    } else if(['glass','anniversary','hitech','vertical'].includes(style)) {
      batch.box(glass,at(.5,h/2),[len-.5,h-1.1,.1],yaw);
      const count=Math.max(1,Math.floor(len/2.3));
      for(let j=0;j<=count;j++)batch.box(trim,at(j/count,h/2,.15),[style==='vertical'?.35:.08,h,.1],yaw);
      for(let j=1;j<floors;j++)batch.box(trim,at(.5,j*step,.16),[len,.09,.12],yaw);
    } else {
      for(let j=0;j<floors;j++){
        const y=1.3+j*step;
        batch.box(glass,at(.5,y),[len-.7,Math.min(1.1,step*.6),.1],yaw);
        if(style==='student')batch.box(trim,at(.5,y-.7,.24),[len,.22,.6],yaw);
        const count=Math.max(1,Math.floor(len/2.8));
        for(let k=1;k<count;k++)batch.box(stone,at(k/count,y,.16),[.35,1.25,.13],yaw);
      }
    }
    batch.box(trim,at(.5,h-.12,.06),[len,.24,.35],yaw);
  }
}
function tree(batch,x,z,scale=1,color='#527447') {
  batch.tube('#6c5942',[x,0,z],[x,3.2*scale,z],.24*scale);
  batch.crown(color,[x,4.1*scale,z],[4*scale,3.4*scale,4*scale]);
}
function court(root,batch,f) {
  const grass=f.style==='park'||f.style==='stadium',color=grass?'#607c48':f.style==='agora'?'#758b89':f.style==='parking'?'#737b79':f.style==='tennis'?'#bc9571':'#6c9290';
  polygon(root,f.id+'_surface',f.rings[0],surface(color),{y:f.style==='agora'?AGORA.height+.02:.035});
  if(f.style==='agora'){
    // Public QA uses a single neutral platform without the withheld cross-path design.
    buildAgoraStructure(root,batch);
    return;
  }
  if(f.style==='park'){
    const {x,z}=f.center;
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2,r=1.8+(i%3)*.65;const end=[x+Math.cos(a)*r+1,5+(i%4)*.8,z+Math.sin(a)*r];batch.tube('#a7bbc1',[x+Math.cos(a)*r,.1,z+Math.sin(a)*r],end,.16);batch.crown('#b5c6ca',[x+Math.cos(a)*r,.4,z+Math.sin(a)*r],[.8,.6,.8]);}
    return;
  }
  // Court/track detail is illustrative and inset; the source perimeter is never reshaped.
  const p=f.rings[0],edges=p.map((a,i)=>({a,b:p[(i+1)%p.length],len:Math.hypot(p[(i+1)%p.length].x-a.x,p[(i+1)%p.length].z-a.z)})).sort((a,b)=>b.len-a.len);
  const e=edges[0],tx=(e.b.x-e.a.x)/e.len,tz=(e.b.z-e.a.z)/e.len;
  const us=p.map(q=>(q.x-f.center.x)*tx+(q.z-f.center.z)*tz),vs=p.map(q=>-(q.x-f.center.x)*tz+(q.z-f.center.z)*tx);
  const w=(Math.max(...us)-Math.min(...us))*.72,d=(Math.max(...vs)-Math.min(...vs))*.65;
  const point=(u,v)=>({x:f.center.x+u*tx-v*tz,z:f.center.z+u*tz+v*tx});
  if(f.style==='parking'){
    for(let i=-w/2;i<w/2;i+=2.8){const a=point(i,-d/2),b=point(i,d/2);batch.tube('#e8e3cf',[a.x,.08,a.z],[b.x,.08,b.z],.07,4);}return;
  }
  fillSports(batch,f);
}
function landmark(root,batch,f) {
  const {x,z}=f.center;const p=(u,y,v)=>[x+u,y,z+v];
  if(f.style==='forest'){
    forestRoadTrees(f.center).forEach((p,i)=>tree(batch,p.x,p.z,1.25,i%2?'#567f48':'#41694b'));
    return;
  }
  if(f.style==='tree'){
    batch.tube('#685443',p(-2,0,0),p(-1,1.2,0),.4);batch.tube('#685443',p(-1,1.2,0),p(1.5,1.2,0),.4);batch.tube('#685443',p(1.5,1.2,0),p(2.2,4,0),.35);
    batch.tube('#685443',p(-1,1.2,0),p(-2.8,4.2,0),.3);batch.crown('#65894b',p(-2,5,0),[5,3,5]);batch.crown('#5c8144',p(2,5,0),[5,3,5]);return;
  }
  if(f.style==='aircraft'){
    fillAircraft(batch,f.center);return;
  }
  if(f.style==='gazebo'){
    polygon(root,f.id+'_deck',GAZEBO.ring,surface('#93765e'),{height:GAZEBO.height});
    fillGazebo(batch);
  }
}
export function buildCampusFacilities(root,ids,tier='BASE') {
  for(const f of FACILITIES.filter(f=>ids.includes(f.id))){
    const batch=new FacilityMeshBatch();
    const group=new pc.Entity(tier==='BASE'?f.id:f.id+'_'+tier);root.addChild(group);
    if(LOWERED_SPORTS_IDS.includes(f.id))group.setLocalPosition(0,SPORTS_FLOOR,0);
    if(f.id==='fac_agora_courtyard'&&tier==='NEAR')buildAgoraNear(group);
    if(f.id==='bldg_07'&&tier==='BASE')buildStudentTerraces(group);
    if(f.id==='bldg_07'&&tier==='NEAR')buildPondFurniture(group);
    if(f.kind==='building'){
      if(['bldg_05','bldg_60th'].includes(f.id)){
        if(tier==='BASE'){fillNorthEntrances(batch,f.id);if(f.id==='bldg_05')fillFiveGardenPaths(batch);}
        if(tier==='NEAR')fillNorthFurniture(batch,f.id);
      }
      if(tier==='BASE')for(const [i,part] of f.parts.entries()){
        polygon(group,f.id+'_body_'+i,part,surface(f.style==='dorm'?'#e7e6dd':f.style==='student'?'#cbbda1':stone),{height:f.height});
        polygon(group,f.id+'_roof_'+i,part,surface(f.id==='bldg_dorm1'?'#6f9b87':roof),{y:f.height+.02});
      }
      for(const t of towerParts(f)){
        if(tier==='BASE')polygon(group,t.id,t.vertices,surface(f.style==='anniversary'?glass:stone),{height:t.height-f.height,y:f.height});
        if(tier==='DETAIL')facade(batch,{...f,floors:12},t.vertices,t.height,f.style==='anniversary'?'anniversary':'bands');
      }
      if(f.id==='bldg_dorm1'&&tier==='NEAR'){
        buildDorm1EntranceDetail(batch,'NEAR');
        buildStreetSigns(group,[DORM_1_NAME_SIGN],'dorm1_entrance_name');
      }
      if(tier==='DETAIL'){
        if(f.id==='bldg_dorm1')buildDorm1EntranceDetail(batch,'DETAIL');
        if(f.id==='bldg_05')fillFiveFacade(batch);
        else if(f.id==='bldg_60th')fillAnniversaryFacade(batch);
        else if(f.id==='bldg_dorm1')fillDorm1Facade(batch,f);
        else for(const ring of f.rings)facade(batch,f,ring,f.height,f.style);
      }
      if(tier==='NEAR')for(const ring of f.rings)for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b.x-a.x,b.z-a.z);
        batch.box(trim,[(a.x+b.x)/2,f.height-.4,(a.z+b.z)/2],[len,.2,.5],-Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI);
      }
      if(f.style==='student'&&tier==='NEAR'){
        // Source outline's rounded western stair bay and photographed red stairwell.
        batch.tube('#cbbda1',[137.4,0,16.1],[137.4,13.2,16.1],1.05,12);
        batch.box('#ad7465',[137.0,5.8,12.8],[.2,9,2]);
        for(let i=0;i<4;i++)batch.box(trim,[136.8,2+i*2.3,12.8],[.35,.2,2.2]);
        fillStudentFront(batch,f);
      }
    }else if(tier==='BASE'&&f.kind==='ground')court(group,batch,f);
    else if(tier==='NEAR'&&['stadium','basketball','tennis','court'].includes(f.style))fillSports(batch,f,'NEAR');
    else if(f.style==='dragon')fillBiryongTower(batch,tier);
    else if(tier==='BASE')landmark(group,batch,f);
    batch.finish(group,f.id+'_details',{castShadows:f.kind==='landmark'});

  }
}

