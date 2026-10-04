// Newly authored procedural interpretation of photographed architecture.
// Source photos/brands/textures are never embedded. See the provenance record.
import {FIVE,ANNIVERSARY,exteriorFrame,NORTH_APPROACHES} from './north-campus-layout.js';
import {FACILITIES,towerParts} from './campus-facilities.js';
export const NORTH_PHOTO_COLORS=Object.freeze({stone:'#e4e2d8',trim:'#f0eee4',glass:'#467e89',
 darkGlass:'#29494f',metal:'#777f80',ribbon:'#727674',joint:'#aeb8b4'});
const point=(f,u,y,out=.09)=>{const p=f.at(u,out);return [p.x,y,p.z];};
const box=(b,f,c,u,y,w,h,out=.10,d=.10)=>b.box(c,point(f,u,y,out),[w,h,d],f.yaw);

function archedBays(b,ring,indices,height,{hole=false,fullGlass=false,tier='NEAR'}={}){
 const c=NORTH_PHOTO_COLORS;
 for(const i of indices){
  const f=exteriorFrame(ring,i,hole);if(f.length<2)continue;
  const count=Math.max(1,Math.floor(f.length/3.7)),pitch=f.length/count,width=pitch*.76;
  const radius=width/2,spring=height-.65-radius;
  for(let bay=0;bay<count;bay++){
   const u=(bay+.5)*pitch;
   if(tier==='NEAR'){
    // Arches frame the whole glazed bay; pale floor spandrels distinguish 5호관
    // from the uninterrupted tall glazing photographed around Agora.
    box(b,f,c.darkGlass,u,(spring+.5)/2,width,spring-.5);
    let previous=point(f,u+radius,spring,.105),center=point(f,u,spring,.105);
    for(let j=1;j<=6;j++){
     const angle=j*Math.PI/6,p=point(f,u+radius*Math.cos(angle),spring+radius*Math.sin(angle),.105);
     b.triangle(c.glass,center,p,previous);b.triangle(c.glass,center,previous,p);
     b.tube(c.stone,previous,p,.065,4);previous=p;
    }
    for(let floor=0;floor<4;floor++){
     const y=1.2+floor*(height-2.6)/4;
     box(b,f,c.glass,u,y,width,fullGlass?1.8:1.12,.13,.08);
     if(!fullGlass)box(b,f,c.stone,u,y+.87,width,.6,.17,.10);
    }
    for(const side of [-1,1])box(b,f,c.trim,u+side*(radius+.08),spring/2,.14,spring,.16,.15);
   }else if(tier==='DETAIL'){
    // Thin window divisions only: main bay silhouette survives DETAIL unload.
    for(const offset of [-width/3,0,width/3])box(b,f,c.joint,u+offset,spring/2,.035,spring-.4,.20,.035);
    for(let y=1;y<spring;y+=1.05)box(b,f,c.joint,u,y,width,.035,.205,.035);
   }
  }
  if(tier==='NEAR')box(b,f,c.trim,f.length/2,height-.14,f.length,.22,.10,.24);
 }
 return b;
}
export function fillFivePhotoFacade(b,tier='NEAR'){
 const ring=FIVE.rings[0],south=[2,6,7],east=[13,14],c=NORTH_PHOTO_COLORS;
 archedBays(b,ring,south,FIVE.height,{tier});
 // The inspected lane photo shows rectangular horizontal bands on the east
 // side facing the 60th hall. It does not justify arches on courtyard/rear walls.
 if(tier==='NEAR')for(let i=0;i<ring.length;i++){
  if(south.includes(i))continue;
  const f=exteriorFrame(ring,i);if(f.length<2)continue;
  if(east.includes(i)){
   for(let floor=0;floor<5;floor++){
    const y=1.15+floor*2.2;box(b,f,c.glass,f.length/2,y,f.length-.7,1.15);
    for(let u=1.5;u<f.length-1;u+=3.7)box(b,f,c.stone,u,y,.20,1.25,.18,.10);
   }
  }else box(b,f,'#d9eeee',f.length/2,FIVE.height/2,Math.min(f.length-1,2),1,.015,.02);
 }
 return b;
}
export function fillAgoraEnclosingFacade(b,id,tier='NEAR'){
 const f=FACILITIES.find(f=>f.id===id);if(!f)return b;
 const indices=id==='bldg_06'?[0]:id==='bldg_09'?[6,7]:[];
 return archedBays(b,f.rings[0],indices,f.height,{fullGlass:true,tier});
}
export function fillAnniversaryPhotoFacade(b,tier='NEAR'){
 const c=NORTH_PHOTO_COLORS,ring=ANNIVERSARY.rings[0];
 for(let i=0;i<ring.length;i++){
  const f=exteriorFrame(ring,i),len=f.length;
  if(tier==='NEAR'){
   box(b,f,c.glass,len/2,8.0,len-.16,9.7,.095,.12);
   box(b,f,c.darkGlass,len/2,1.58,len-.16,3.16,.095,.12);
   for(let u=.5;u<len-.3;u+=1.35)box(b,f,c.metal,u,6.4,.045,12.6,.18,.045);
   for(let y=.8;y<13;y+=.78)box(b,f,c.metal,len/2,y,len-.15,.045,.18,.045);
   // The observed S-shaped dark/silver ribbon is a facade frame, not a
   // surveyed roof section. Keep the existing podium envelope and roof.
   if([0,2,3].includes(i)){
    const reverse=i===0;
    const profile=[[.01,12.55],[.46,12.55],[.49,12.48],[.515,12.20],[.54,11.55],
      [.575,8.0],[.60,5.05],[.625,4.40],[.65,4.20],[.98,4.20]];
    for(let j=1;j<profile.length;j++){
     const a=profile[j-1],p=profile[j],u=q=>(reverse?1-q:q)*len;
     b.tube(c.ribbon,point(f,u(a[0]),a[1],.26),point(f,u(p[0]),p[1],.26),.20,6);
    }
   }
  }else if(tier==='DETAIL'){
   for(let u=1.8;u<len-1;u+=5.4)for(const y of [4.1,7.2,10.3])box(b,f,c.darkGlass,u,y,.7,.26,.22,.035);
  }
 }
 return b;
}
export function fillNorthPhotoTower(b,f,tier='NEAR'){
 const c=NORTH_PHOTO_COLORS;
 if(f.id==='bldg_05'&&tier==='NEAR'){
  const front=exteriorFrame(f.rings[0],7);
  // Continue the attached dark stair glazing down the existing south wall.
  // This is a thin face on the already-solid building, not a second ground body.
  box(b,front,c.stone,2.6,f.height/2,4.02,f.height,.225,.10);
  box(b,front,c.darkGlass,2.6,(f.height+.45)/2,2.16,f.height-.45,.29,.04);
  for(let y=1;y<f.height;y+=1.0)box(b,front,c.joint,2.6,y,2.16,.035,.325,.025);
 }
 for(const tower of towerParts(f)){
  const ring=tower.vertices;
  for(let i=0;i<ring.length;i++){
   const edge=exteriorFrame(ring,i),len=edge.length;
   if(f.id==='bldg_60th'){
    if(tier==='NEAR'){
     if(len<8){
      for(const side of [-1,1])box(b,edge,c.ribbon,len*(.5+side*.34),(tower.height+f.height)/2,len*.30,tower.height-f.height,.10,.10);
     }else{
      for(const u of [.27,len-.27])box(b,edge,c.ribbon,u,(tower.height+f.height)/2,.55,tower.height-f.height,.11,.12);
     }
     box(b,edge,c.ribbon,len/2,tower.height-.22,len,.44,.11,.12);
     for(let u=.75;u<len-.4;u+=.8)box(b,edge,c.metal,u,(tower.height+f.height)/2,.035,tower.height-f.height-.6,.18,.04);
     for(let y=f.height+.6;y<tower.height-.5;y+=.85)box(b,edge,c.metal,len/2,y,len-.4,.035,.18,.04);
    }
   }else if(tier==='NEAR'){
    // Pale attached clock core with dark recessed vertical glazing on observed
    // south/east faces. Rear elevations are intentionally undecorated.
    if(i===0||i===1)box(b,edge,c.darkGlass,len/2,(f.height+21.1)/2,len*.54,21.1-f.height,.10,.06);
    if(i===0){
     for(let tick=0;tick<12;tick++){
      const angle=tick*Math.PI/6,u=len/2+Math.sin(angle)*.72,y=22.15+Math.cos(angle)*.72;
      b.tube(c.darkGlass,point(edge,u,y,.16),point(edge,len/2+Math.sin(angle)*.58,22.15+Math.cos(angle)*.58,.16),.035,4);
     }
     b.tube(c.darkGlass,point(edge,len/2,22.15,.17),point(edge,len/2-.43,22.50,.17),.04,4);
     b.tube(c.darkGlass,point(edge,len/2,22.15,.17),point(edge,len/2+.50,22.56,.17),.03,4);
    }
   }
  }
 }
 return b;
}
export function fillFivePhotoEntry(b){
 const e=NORTH_APPROACHES.find(e=>e.owner===FIVE.id),c=NORTH_PHOTO_COLORS;
 // Existing landing and opening remain authoritative. Thin canopy is above the
 // standing/jumping player envelope; columns hug existing wall footprint.
 box(b,e.frame,c.trim,e.u,3.50,e.width+1,.18,.62,1.45);
 box(b,e.frame,c.darkGlass,e.u,1.35,e.width*.66,2.1,.09,.10);
 for(const side of [-1,1])box(b,e.frame,c.trim,e.u+side*(e.width/2+.25),1.7,.18,3.4,.12,.20);
 return b;
}
