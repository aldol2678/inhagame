// Integrated exterior variant, not a second building/floor-plan authority.
// Qualitative photo cues: pale end cores, deep window reveals, framed entry.
// All counts/depths remain illustrative. Existing four rows and nine piers are
// retained for source compatibility; they are not a measured real-world floor count.
import {HALL_FRONT} from './basic-campus.js';
import {PHOTO_HALL_LIBRARY_COLORS as C,fillPhotoMainHallFacade} from './photo-hall-library-geometry.js';

export const MAIN_HALL_CANDIDATE=Object.freeze({
 buildingId:'bldg_01',status:'INTEGRATED_EXTERIOR_VARIANT',interior:false,
 windowRows:'inherited-four-row-estimate',piers:'inherited-nine-pier-estimate',
 footprint:'existing-authority',height:'existing-envelope',collision:'unchanged'
});
const {a,b,along,inward,length}=HALL_FRONT;
const point=(u,y,v)=>[(a.x+b.x)/2+along.x*u+inward.x*v,y,(a.z+b.z)/2+along.z*u+inward.z*v];
const yaw=-Math.atan2(along.z,along.x)*180/Math.PI;
const bayWidth=(length-1)/8-.9;

export function fillMainHallCandidate(batch,tier='BASE'){
 if(!['BASE','NEAR','DETAIL'].includes(tier))throw Error('Unsupported main hall candidate tier');
 const face=(color,u0,u1,y0,y1,v)=>batch.quad(color,point(u0,y0,v),point(u0,y1,v),point(u1,y1,v),point(u1,y0,v));
 // Four cavity surfaces face into each window recess. The original photo pane
 // remains the backing; no second pane or luminous/glass overlay is introduced.
 const reveal=(u0,u1,y0,y1,back,front,color=C.trim)=>{
  batch.quad(color,point(u0,y0,front),point(u0,y1,front),point(u0,y1,back),point(u0,y0,back));
  batch.quad(color,point(u1,y0,back),point(u1,y1,back),point(u1,y1,front),point(u1,y0,front));
  batch.quad(color,point(u0,y0,back),point(u1,y0,back),point(u1,y0,front),point(u0,y0,front));
  batch.quad(color,point(u0,y1,front),point(u1,y1,front),point(u1,y1,back),point(u0,y1,back));
 };
 if(tier==='BASE'){
  // Same nine collision-bearing piers, now emitted through the shared batch.
  for(let i=0;i<9;i++)batch.box(C.trim,point((i/8-.5)*(length-1),5.1,-.18),[.65,9.7,.6],yaw);
  const cores=[-1,1].map(side=>({u:side*(length-1)*7/16,width:bayWidth+.72}));
  const ends=[-length/2-.625,...cores.flatMap(c=>[c.u-c.width/2,c.u+c.width/2]),length/2+.625];
  for(let i=0;i<ends.length-1;i++){
   const core=i===1||i===3,left=ends[i],right=ends[i+1];
   // Two subtle raised core heads fit the pre-existing coping's 10.97 maximum.
   // The continuous body/roof below remains owned by the original renderer.
   const bottom=9.9,top=core?10.97:10.65;
   batch.box(C.trim,point((left+right)/2,(bottom+top)/2,-.15),[right-left,top-bottom,1.65],yaw);
  }
  return batch;
 }
 if(tier==='DETAIL'){
  fillPhotoMainHallFacade(batch,tier);
  for(let bay=1;bay<7;bay++){
   const u=((bay+.5)/8-.5)*(length-1),left=u-bayWidth/2,right=u+bayWidth/2;
   for(let row=0;row<4;row++){
    const y=1.55+row*2.25,bottom=y-.65,top=y+.65;
    // The inherited first-row windows sit behind the separate entry glazing.
    // Their new projecting reveals/sills must stop outside the existing entry
    // frame; otherwise the sill cuts visibly through the door and its mullions.
    const spans=row===0
     ? [[left,Math.min(right,-1.75)],[Math.max(left,1.75),right]].filter(([l,r])=>r-l>1e-7)
     : [[left,right]];
    for(const [l,r] of spans){
     reveal(l,r,bottom,top,-.082,-.23);
     face(C.trim,l,r,bottom-.055,bottom,-.23);
    }
   }
  }
  for(const side of [-1,1]){
   const u=side*(length-1)*7/16,left=u-bayWidth/2,right=u+bayWidth/2;
   reveal(left,right,.55,9.65,-.14,-.46);
   // Wide pale collars and their fine joints express the observed end cores
   // without widening the silhouette or changing source roof/collider heights.
   face(C.trim,left-.28,left,.45,9.9,-.46);
   face(C.trim,right,right+.28,.45,9.9,-.46);
   face(C.trim,left,right,9.65,9.9,-.46);
   face(C.trim,left,right,.45,.55,-.46);
   for(let row=0;row<18;row++){
    const y=.58+row*.53;
    face(C.joint,left-.28,left,y-.009,y+.009,-.462);
    face(C.joint,right,right+.28,y-.009,y+.009,-.462);
   }
  }
  return batch;
 }
 // The existing entrance dimensions stay exact. Only its exterior frame gets
 // modeled depth; the opaque campus body is deliberately not cut open.
 face(C.glass,-1.7,1.7,.2,2.8,-.126);
 reveal(-1.7,1.7,.2,2.8,-.126,-.23);
 for(const u of [-1.65,-.55,.55,1.65]){
  face(C.trim,u-.03,u+.03,.2,2.8,-.23);
  batch.quad(C.trim,point(u-.03,.2,-.126),point(u-.03,2.8,-.126),point(u-.03,2.8,-.23),point(u-.03,.2,-.23));
  batch.quad(C.trim,point(u+.03,.2,-.23),point(u+.03,2.8,-.23),point(u+.03,2.8,-.126),point(u+.03,.2,-.126));
 }
 face(C.trim,-1.7,1.7,2.8,2.85,-.23);
 return batch;
}
