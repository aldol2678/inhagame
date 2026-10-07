// Fresh procedural dressing from field-photo observations. Photos establish only
// the visible rhythm and palette; the public frames and roof bounds remain authority.
import {BUILDINGS,HALL_FRONT,LIBRARY_FRONT} from './basic-campus.js';

export const PHOTO_HALL_LIBRARY_COLORS=Object.freeze({
  trim:'#eeece2',glass:'#548d99',darkGlass:'#3d626b',litGlass:'#c8c8a4',
  joint:'#bcbcb2',mullion:'#abc1bd',soffit:'#bba98a',soffitJoint:'#867e6d'
});
const libraryPoint=(u,y,v)=>{const p=LIBRARY_FRONT.at(u,v);return [p.x,y,p.z];};

export const LIBRARY_WEST=(()=>{
  const building=BUILDINGS.find(item=>item.id==='bldg_jungseok'),pts=building.vertices;
  const rawA=pts[0],rawB=pts[1];
  const area=pts.reduce((sum,p,i)=>sum+p.x*pts[(i+1)%pts.length].z-pts[(i+1)%pts.length].x*p.z,0);
  // Orient the local U axis so vertical x U winding always faces away from the footprint.
  const a=area>0?rawA:rawB,b=area>0?rawB:rawA,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
  const along=Object.freeze({x:dx/length,z:dz/length});
  const outward=Object.freeze({x:along.z,z:-along.x});
  const center=Object.freeze({x:(a.x+b.x)/2,z:(a.z+b.z)/2});
  return Object.freeze({a,b,length,along,outward,center,at:(u,v)=>({x:center.x+along.x*u+outward.x*v,z:center.z+along.z*u+outward.z*v})});
})();

const libraryWestPoint=(u,y,v)=>{const p=LIBRARY_WEST.at(u,v);return [p.x,y,p.z];};

export function fillPhotoMainHallFacade(batch,tier='DETAIL'){
  if(tier!=='DETAIL')return batch;
  const c=PHOTO_HALL_LIBRARY_COLORS,{a,b,along,inward,length}=HALL_FRONT;
  const point=(u,y,v)=>[(a.x+b.x)/2+along.x*u+inward.x*v,y,(a.z+b.z)/2+along.z*u+inward.z*v];
  const panel=(color,u0,u1,y0,y1,v)=>batch.quad(color,point(u0,y0,v),point(u0,y1,v),point(u1,y1,v),point(u1,y0,v));
  const window=(u,y,width,height,columns,rows,seed,v)=>{
    const x0=u-width/2,y0=y-height/2,dx=width/columns,dy=height/rows;
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
      const left=x0+col*dx+(col?.025:0),right=x0+(col+1)*dx-(col<columns-1?.025:0);
      const bottom=y0+row*dy+(row?.022:0),top=y0+(row+1)*dy-(row<rows-1?.022:0);
      const index=seed+row*7+col*3;
      const color=index%17===0?c.litGlass:index%5===0?c.darkGlass:c.glass;
      panel(color,left,right,bottom,top,v);
      if(row<rows-1)panel(c.trim,left,right,y0+(row+1)*dy-.022,y0+(row+1)*dy+.022,v);
    }
    for(let col=1;col<columns;col++)panel(c.trim,x0+col*dx-.025,x0+col*dx+.025,y0,y0+height,v);
  };
  // Retain the original six four-storey bays and two tall strips. Colored panes
  // replace individual glass tiles, rather than layering luminous planes or lights.
  const bayWidth=(length-1)/8-.9;
  for(let bay=1;bay<7;bay++){
    const u=((bay+.5)/8-.5)*(length-1);
    for(let floor=0;floor<4;floor++)window(u,1.55+floor*2.25,bayWidth,1.3,3,1,bay*11+floor*5,-.082);
    for(const y of [2.70,4.95,7.20,9.45]){
      panel(c.joint,u-bayWidth/2,u+bayWidth/2,y-.009,y+.009,-.012);
      panel(c.joint,u-.009,u+.009,y-.44,y-.009,-.012);
      panel(c.joint,u-.009,u+.009,y+.009,y+.44,-.012);
    }
  }
  for(const side of [-1,1]){
    const u=side*(length-1)*7/16,left=u-bayWidth/2,right=u+bayWidth/2;
    window(u,5.1,bayWidth,9.1,3,9,side===1?7:13,-.14);
    panel(c.trim,left-.12,left,.45,9.8,-.15);
    panel(c.trim,right,right+.12,.45,9.8,-.15);
    panel(c.trim,left,right,.45,.55,-.15);
    panel(c.trim,left,right,9.65,9.8,-.15);
  }
  // Fine joints sit just outside the existing piers. Their mass, tops and spacing
  // remain in the unchanged BASE renderer; no second pale wall is added here.
  for(let pier=0;pier<9;pier++){
    const u=(pier/8-.5)*(length-1);
    for(let row=0;row<18;row++){
      const y=.58+row*.53;
      panel(c.joint,u-.325,u+.325,y-.009,y+.009,-.486);
    }
  }
  return batch;
}

function librarySlab(batch,color,u0,u1,v0,v1,bottom,top,{openBottom=false}={}){
  const p=(u,y,v)=>libraryPoint(u,y,v);
  batch.quad(color,p(u0,top,v0),p(u0,top,v1),p(u1,top,v1),p(u1,top,v0));
  if(!openBottom)batch.quad(color,p(u0,bottom,v0),p(u1,bottom,v0),p(u1,bottom,v1),p(u0,bottom,v1));
  batch.quad(color,p(u0,bottom,v0),p(u0,top,v0),p(u1,top,v0),p(u1,bottom,v0));
  batch.quad(color,p(u0,bottom,v1),p(u1,bottom,v1),p(u1,top,v1),p(u0,top,v1));
  batch.quad(color,p(u0,bottom,v0),p(u0,bottom,v1),p(u0,top,v1),p(u0,top,v0));
  batch.quad(color,p(u1,bottom,v0),p(u1,top,v0),p(u1,top,v1),p(u1,bottom,v1));
}

export function fillPhotoLibraryFront(batch,tier='BASE'){
  if(tier!=='BASE'&&tier!=='DETAIL')return batch;
  const c=PHOTO_HALL_LIBRARY_COLORS;
  for(let bay=0;bay<7;bay++){
    const u=(bay-3)*1.8,bulge=.1+.45*(1-(u/6.4)**2),left=u-.89,right=u+.89;
    if(tier==='BASE'){
      librarySlab(batch,c.glass,left,right,bulge-.06,bulge+.06,1,15);
      continue;
    }
    const panel=(u0,u1,y0,y1)=>batch.quad(c.mullion,
      libraryPoint(u0,y0,bulge+.067),libraryPoint(u1,y0,bulge+.067),
      libraryPoint(u1,y1,bulge+.067),libraryPoint(u0,y1,bulge+.067));
    // Three narrow lights across each existing bay, fourteen courses vertically.
    // Horizontal strips stop at vertical strips to avoid coplanar self-overlap.
    const splits=[left,left+(right-left)/3,left+2*(right-left)/3,right];
    for(let col=1;col<3;col++)panel(splits[col]-.022,splits[col]+.022,1,15);
    for(let row=1;row<14;row++)for(let col=0;col<3;col++){
      panel(splits[col]+(col?.022:0),splits[col+1]-(col<2?.022:0),1+row-.025,1+row+.025);
    }
  }
  return batch;
}

export function fillPhotoLibraryWest(batch,tier='BASE'){
  if(tier!=='BASE'&&tier!=='DETAIL')return batch;
  const c=PHOTO_HALL_LIBRARY_COLORS,p=libraryWestPoint,half=LIBRARY_WEST.length/2;
  const panel=(color,u0,u1,y0,y1,v)=>batch.quad(color,p(u0,y0,v),p(u0,y1,v),p(u1,y1,v),p(u1,y0,v));
  const centerHalf=LIBRARY_WEST.length*.12,edge=.8,wingGap=.5;
  const wings=[[-half+edge,-centerHalf-wingGap],[centerHalf+wingGap,half-edge]];
  const floors=[1.15,3.55,5.95,8.35,10.75,13.15];
  if(tier==='BASE'){
    // Stadium-facing west elevation: preserve the source shell, but restore the
    // observed horizontal window rhythm, darker central slot and strong top shadow.
    panel(c.darkGlass,-centerHalf,centerHalf,.9,15.2,.055);
    for(const [u0,u1] of wings)for(const y of floors)panel(c.glass,u0,u1,y,y+1.15,.06);
    for(const side of [-1,1]){
      const u=side*LIBRARY_WEST.length*.34,w=LIBRARY_WEST.length*.038;
      panel(c.darkGlass,u-w,u+w,1.0,15.45,.075);
    }
    panel(c.soffitJoint,-half+.45,half-.45,15.55,16.25,.085);
    return batch;
  }
  // DETAIL only adds structure over BASE surfaces, avoiding duplicate coplanar glass.
  for(const [u0,u1] of wings){
    const width=u1-u0,columns=Math.max(4,Math.floor(width/2.15));
    for(let col=1;col<columns;col++){
      const u=u0+width*col/columns;
      for(const y of floors)panel(c.mullion,u-.025,u+.025,y,y+1.15,.082);
    }
    for(const y of floors)panel(c.joint,u0,u1,y+1.15,y+1.20,.079);
  }
  for(const side of [-1,1]){
    const u=side*centerHalf;
    panel(c.trim,u-.07,u+.07,.9,15.2,.09);
  }
  // Sparse stone-panel joints keep the large rear wall from reading as one smooth slab.
  for(let y=2.55;y<15.3;y+=2.4){
    panel(c.joint,-half+.45,-centerHalf-wingGap,y-.018,y+.018,.078);
    panel(c.joint,centerHalf+wingGap,half-.45,y-.018,y+.018,.078);
  }
  return batch;
}

export function fillPhotoLibraryRoof(batch,part,tier='BASE'){
  if(tier!=='BASE')return batch;
  const c=PHOTO_HALL_LIBRARY_COLORS;
  const u0=part.u-part.width/2,u1=part.u+part.width/2,v0=part.v-part.depth/2,v1=part.v+part.depth/2;
  const minY=part.y-part.height/2,maxY=part.y+part.height/2,p=libraryPoint;
  if(part.id==='library_overhanging_roof'){
    // A shallow two-ended upturn is fitted entirely inside the pre-existing roof
    // volume. This replaces the flat roof shell, not its authoritative collider.
    const segments=12,thickness=part.height*.375,rise=part.height-thickness;
    const top=u=>minY+thickness+rise*((u-part.u)/(part.width/2))**2;
    for(let i=0;i<segments;i++){
      const left=u0+(u1-u0)*i/segments,right=u0+(u1-u0)*(i+1)/segments;
      const lt=top(left),rt=top(right),lb=lt-thickness,rb=rt-thickness;
      batch.quad(c.trim,p(left,lt,v0),p(left,lt,v1),p(right,rt,v1),p(right,rt,v0));
      batch.quad(c.trim,p(left,lb,v0),p(right,rb,v0),p(right,rb,v1),p(left,lb,v1));
      batch.quad(c.trim,p(left,lb,v0),p(left,lt,v0),p(right,rt,v0),p(right,rb,v0));
      batch.quad(c.trim,p(left,lb,v1),p(right,rb,v1),p(right,rt,v1),p(left,lt,v1));
    }
    batch.quad(c.trim,p(u0,maxY-thickness,v0),p(u0,maxY-thickness,v1),p(u0,maxY,v1),p(u0,maxY,v0));
    batch.quad(c.trim,p(u1,maxY-thickness,v0),p(u1,maxY,v0),p(u1,maxY,v1),p(u1,maxY-thickness,v1));
  }else if(part.id==='library_entry_canopy'){
    librarySlab(batch,c.trim,u0,u1,v0,v1,minY,maxY,{openBottom:true});
    // Only the already-established front canopy receives the photographed warm
    // soffit. Alternating joint/panel intervals tile one surface without overlays.
    const cuts=(start,end,count)=>{
      const result=[start];
      for(let i=1;i<count;i++)result.push(start+(end-start)*i/count-.012,start+(end-start)*i/count+.012);
      return [...result,end];
    };
    const us=cuts(u0,u1,8),vs=cuts(v0,v1,3);
    for(let i=0;i<us.length-1;i++)for(let j=0;j<vs.length-1;j++){
      const color=i%2||j%2?c.soffitJoint:c.soffit;
      batch.quad(color,p(us[i],minY,vs[j]),p(us[i+1],minY,vs[j]),p(us[i+1],minY,vs[j+1]),p(us[i],minY,vs[j+1]));
    }
  }
  return batch;
}
