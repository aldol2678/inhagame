import { BUILDINGS,HALL_FRONT,LIBRARY_ROOF_PARTS } from './basic-campus.js';
import { surface,box,polygon } from './campus-render-kit.js';
import { buildLibraryWest } from './roadview-details.js';
import { buildLibraryApproaches } from './library-approaches.js';
import { MAIN_HALL_APPROACH } from './roadview-layout.js';
import { FacilityMeshBatch } from './facility-mesh-batch.js';

// Photo-based simplified facade. Heights and details are estimates; body footprints are source geometry.
export function buildMainHallBlockout(root,ids,tier='BASE') {
  const stone=surface('#d5d2c6'),trim=surface('#eeece2'),glass=surface('#548d99'),roof=surface('#627279');
  const trimHex='#eeece2',glassHex='#548d99';
  for(const building of BUILDINGS.filter(b=>ids.includes(b.id))) {
    if(tier==='BASE'){
      polygon(root,building.id,building.vertices,stone,{height:building.height});
      polygon(root,building.id+'_roof',building.vertices,roof,{y:building.height+.01});
    }
    if(tier!=='DETAIL')continue;
    // These static windows used to create one render entity per pane. Keep a
    // separate batch per building so chunk residency and culling stay local.
    const windows=new FacilityMeshBatch();
    const pts=building.vertices;
    const area=pts.reduce((s,p,i)=>s+p.x*pts[(i+1)%pts.length].z-pts[(i+1)%pts.length].x*p.z,0);
    for(let i=0;i<pts.length;i++) {
      if(building.id==='bldg_jungseok'&&i===0)continue; // Observed west facade has its own layout.
      if(building.id==='bldg_01'&&i===5)continue; // Front glazing follows the column bays below.
      const a=pts[i],b=pts[(i+1)%pts.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
      if(len<3)continue;
      const nx=(area>0?dz:-dz)/len,nz=(area>0?-dx:dx)/len,yaw=-Math.atan2(dz,dx)*180/Math.PI;
      const count=Math.floor(len/2.8),floors=building.id==='bldg_01'?4:6;
      for(let col=0;col<count;col++)for(let floor=0;floor<floors;floor++) {
        const t=(col+.5)/count;
        windows.box(glassHex,[a.x+dx*t+nx*.045,1.6+floor*2.25,a.z+dz*t+nz*.045],[Math.min(1.8,len/count-.5),1.1,.1],yaw);
      }
    }
    windows.finish(root,building.id+'_windows');
  }
  if(ids.includes('bldg_01')){
  const {a,b,along,inward,length}=HALL_FRONT,yaw=-Math.atan2(along.z,along.x)*180/Math.PI;
  const front=(u,v,y)=>[(a.x+b.x)/2+along.x*u+inward.x*v,y,(a.z+b.z)/2+along.z*u+inward.z*v];
  if(tier==='BASE'){
    box(root,'hall_front_entablature',front(0,-.3,10.3),[length+1,.8,1.4],trim,yaw);
    for(let i=0;i<9;i++)box(root,'hall_front_column_'+i,front((i/8-.5)*(length-1),-.18,5.1),[.65,9.7,.6],trim,yaw);
    box(root,'hall_roof_coping',front(0,-.15,10.86),[length+1.25,.22,1.65],trim,yaw);
  }
  if(tier==='BASE') {
    polygon(root,'hall_entrance_apron',[-length/2,length/2].flatMap((u,i)=>(i?[0,-5.5]:[-5.5,0]).map(v=>{const p=front(u,v,0);return {x:p[0],z:p[2]}})),surface('#b5b4a5'),{y:.03});
    const t=MAIN_HALL_APPROACH;
    box(root,'hall_entry_landing',front(0,-t.landing/2,t.height/2),[length,t.height,t.landing],stone,yaw);
    for(let i=1;i<=t.steps;i++){
      const depth=t.run/t.steps,top=i*t.height/t.steps;
      box(root,'hall_entrance_step_'+i,front(0,-t.landing-t.run+(i-.5)*depth,top/2),[length,top,depth],stone,yaw);
    }
  }
  if(tier==='DETAIL'){
    const facade=new FacilityMeshBatch();
    for(let bay=1;bay<7;bay++){
      const u=((bay+.5)/8-.5)*(length-1),w=(length-1)/8-.9;
      for(let floor=0;floor<4;floor++){
        facade.box(glassHex,front(u,-.035,1.55+floor*2.25),[w,1.3,.09],yaw);
        for(const offset of [-w/4,w/4])facade.box(trimHex,front(u+offset,-.095,1.55+floor*2.25),[.055,1.32,.045],yaw);
      }
    }
    for(const side of [-1,1]){
      const u=side*(length-1)*7/16,w=(length-1)/8-.9;
      facade.box(glassHex,front(u,-.06,5.1),[w,9.1,.1],yaw);
      for(let y=1.1;y<10;y+=1.1)facade.box(trimHex,front(u,-.12,y),[w,.055,.04],yaw);
      facade.box(trimHex,front(u,-.12,5.1),[.055,9.1,.04],yaw);
    }
    facade.finish(root,'hall_facade');
  }
  if(tier==='NEAR'){
    box(root,'hall_entry_glass',front(0,-.065,1.5),[3.4,2.6,.12],glass,yaw);
    for(const u of [-1.65,-.55,.55,1.65])box(root,'hall_entry_frame_'+u,front(u,-.15,1.5),[.06,2.6,.06],trim,yaw);
  }
  }
  if(!ids.includes('bldg_jungseok'))return;
  if(tier==='BASE')buildLibraryApproaches(root);
  if(tier==='DETAIL')buildLibraryWest(root);
  // Library's glazed front and oversailing roof, corroborated by user-supplied photographs.
  const library=BUILDINGS[1],p=library.vertices[6],q=library.vertices[7];
  const dx=q.x-p.x,dz=q.z-p.z,len=Math.hypot(dx,dz),tx=dx/len,tz=dz/len;
  const nx=-tz,nz=tx,angle=-Math.atan2(tz,tx)*180/Math.PI;
  const at=(u,v,y)=>[(p.x+q.x)/2+u*tx+v*nx,y,(p.z+q.z)/2+u*tz+v*nz];
  const rails=tier==='DETAIL'?new FacilityMeshBatch():null;
  for(let i=0;i<7;i++) {
    const u=(i-3)*1.8,bulge=.1+.45*(1-(u/6.4)**2);
    if(tier==='BASE')box(root,'library_glass_bay_'+i,at(u,bulge,8),[1.78,14,.12],glass,angle);
    if(rails)for(let j=0;j<7;j++)rails.box(trimHex,at(u,bulge+.08,2+j*2),[1.8,.07,.08],angle);
  }
  rails?.finish(root,'library_glass_rails');
  if(tier==='BASE')for(const part of LIBRARY_ROOF_PARTS)polygon(root,part.id,part.vertices,part.id==='library_upper_pavilion'?glass:trim,{height:part.height,y:part.y-part.height/2});
}
