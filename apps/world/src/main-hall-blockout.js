import { BUILDINGS,HALL_FRONT,LIBRARY_ROOF_PARTS } from './basic-campus.js';
import { surface,box,polygon } from './campus-render-kit.js';
import { buildLibraryWest } from './roadview-details.js';
import { buildLibraryApproaches } from './library-approaches.js';
import { MAIN_HALL_APPROACH } from './roadview-layout.js';
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { fillPhotoMainHallFacade,fillPhotoLibraryFront,fillPhotoLibraryRoof } from './photo-hall-library-geometry.js';
import { fillMainHallCandidate } from './main-hall-candidate-geometry.js';

// Photo-based simplified facade. Heights and details are estimates; body footprints are source geometry.
export function buildMainHallBlockout(root,ids,tier='BASE',{mainHallDetail='existing'}={}) {
  if(!['existing','candidate'].includes(mainHallDetail))throw Error('Unsupported main hall detail variant');
  const stone=surface('#d5d2c6'),trim=surface('#eeece2'),glass=surface('#548d99'),roof=surface('#627279');
  const glassHex='#548d99';
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
        // The observed central curtain wall replaces the regular panes only
        // within its existing span; unobserved flanking bays keep their rhythm.
        if(building.id==='bldg_jungseok'&&i===6&&Math.abs((t-.5)*len)<7.2)continue;
        windows.box(glassHex,[a.x+dx*t+nx*.045,1.6+floor*2.25,a.z+dz*t+nz*.045],[Math.min(1.8,len/count-.5),1.1,.1],yaw);
      }
    }
    windows.finish(root,building.id+'_windows');
  }
  if(ids.includes('bldg_01')){
  const {a,b,along,inward,length}=HALL_FRONT,yaw=-Math.atan2(along.z,along.x)*180/Math.PI;
  const front=(u,v,y)=>[(a.x+b.x)/2+along.x*u+inward.x*v,y,(a.z+b.z)/2+along.z*u+inward.z*v];
  if(tier==='BASE'){
    if(mainHallDetail==='candidate'){
      const facade=new FacilityMeshBatch();fillMainHallCandidate(facade,tier);facade.finish(root,'hall_candidate_base');
    }else{
    box(root,'hall_front_entablature',front(0,-.3,10.3),[length+1,.8,1.4],trim,yaw);
    for(let i=0;i<9;i++)box(root,'hall_front_column_'+i,front((i/8-.5)*(length-1),-.18,5.1),[.65,9.7,.6],trim,yaw);
    box(root,'hall_roof_coping',front(0,-.15,10.86),[length+1.25,.22,1.65],trim,yaw);
    }
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
    if(mainHallDetail==='candidate')fillMainHallCandidate(facade,tier);
    else fillPhotoMainHallFacade(facade,tier);
    facade.finish(root,'hall_facade');
  }
  if(tier==='NEAR'){
    if(mainHallDetail==='candidate'){
      const entry=new FacilityMeshBatch();fillMainHallCandidate(entry,tier);entry.finish(root,'hall_candidate_entry');
    }else{
    box(root,'hall_entry_glass',front(0,-.065,1.5),[3.4,2.6,.12],glass,yaw);
    for(const u of [-1.65,-.55,.55,1.65])box(root,'hall_entry_frame_'+u,front(u,-.15,1.5),[.06,2.6,.06],trim,yaw);
    }
  }
  }
  if(!ids.includes('bldg_jungseok'))return;
  if(tier==='BASE')buildLibraryApproaches(root);
  if(tier==='BASE'||tier==='DETAIL')buildLibraryWest(root,tier);
  const libraryDetails=new FacilityMeshBatch();
  fillPhotoLibraryFront(libraryDetails,tier);
  for(const part of LIBRARY_ROOF_PARTS){
    if(tier==='BASE'&&part.id==='library_upper_pavilion')polygon(root,part.id,part.vertices,glass,{height:part.height,y:part.y-part.height/2});
    else fillPhotoLibraryRoof(libraryDetails,part,tier);
  }
  if(tier==='BASE'||tier==='DETAIL')libraryDetails.finish(root,'library_photo_'+tier.toLowerCase());
}
