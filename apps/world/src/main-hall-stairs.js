import { stairTreadHeight } from './stair-profile.js';
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { MAIN_HALL_APPROACH as t, hallApproachHeight } from './main-hall-approach.js';

export function fillHallStairs(batch) {
  const p=(u,out,y)=>{const a=t.frame.at(t.frame.length/2+u,out);return [a.x,y,a.z];};
  // In the facade coordinate system increasing out points towards the square.
  const top=(color,a,b,c,d)=>{
    if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<0)batch.quad(color,d,c,b,a);
    else batch.quad(color,a,b,c,d);
  };
  const half=t.width/2, foot=t.landing+t.run, depth=t.run/t.steps;
  const tread='#d2cfc2', face='#9e9b90', curb='#bcb7a7', grass='#84905e';
  const strip=(color,l,r,near,far,y)=>top(color,p(l,near,y),p(r,near,y),p(r,far,y),p(l,far,y));
  strip(tread,-half,half,0,t.landing,t.height);
  for(let i=0;i<t.steps;i++){
    const near=t.landing+i*depth, far=near+depth, y=stairTreadHeight(t,(near+far)/2);
    const low=t.height*(t.steps-i-1)/t.steps;
    strip(tread,-half,half,near,far,y);
    batch.quad(face,p(-half,far,low),p(-half,far,y),p(half,far,y),p(half,far,low));
    // Close the two thin triangular ends where the sloping cheeks meet the treads.
    for(const side of [-1,1]){
      const u=side*half, v=[p(u,near,y),p(u,far,y),p(u,far,low)];
      batch.triangle(face,...(side>0?v:v.reverse()));
    }
  }
  for(const sign of [-1,1]){
    const inner=sign*half, stone=sign*(half+.42), upper=sign*(t.bankExtent-t.bankBevel), lower=sign*t.bankExtent;
    for(const [color,l,r] of [[curb,inner,stone],[grass,stone,upper]]){
      strip(color,l,r,0,t.landing,t.height);
      top(color,p(l,t.landing,t.height),p(r,t.landing,t.height),p(r,foot,0),p(l,foot,0));
    }
    top(grass,p(upper,0,t.height),p(upper,t.landing,t.height),p(lower,t.landing,0),p(lower,0,0));
    // The diagonal ridge separates the fore-slope from the lateral bevel.
    const ridge=[p(upper,t.landing,t.height),p(upper,foot,0),p(lower,foot,0)];
    const flank=[p(upper,t.landing,t.height),p(lower,foot,0),p(lower,t.landing,0)];
    for(const tri of [ridge,flank])batch.triangle(grass,...(sign>0?tri.reverse():tri));
    // Low exposed stone courses and shrubs flank the central flight in the field photos.
    for(let j=0;j<5;j++){
      const u=sign*(half+1.45+j*1.18), out=1.5+(j%3)*.75;
      const a=t.frame.at(t.frame.length/2+u,out), y=hallApproachHeight(a.x,a.z);
      batch.crown(j%2?'#637748':'#70804e',[a.x,y+.22,a.z],[1.5,.64,1.18]);
    }
    for(let j=0;j<4;j++){
      const u=stone+sign*(.8+j*1.38),out=foot-.62-(j%2)*.20;
      const a=t.frame.at(t.frame.length/2+u,out),y=hallApproachHeight(a.x,a.z);
      batch.crown(j%2?'#a69e88':'#928b77',[a.x,y+.035,a.z],[1.05,.28,.7]);
    }
  }
  return batch;
}
export function buildHallStairs(root){
  fillHallStairs(new FacilityMeshBatch()).finish(root,'hall_grand_stair');
}
