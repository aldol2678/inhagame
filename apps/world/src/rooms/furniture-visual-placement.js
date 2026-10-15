// Local visual compatibility only. Saved geometry/UUID/ownership/revision authority is unchanged.
import { FURNITURE_BY_ID, furnitureBox, validateFurniture } from './furniture-layout.js';
import { PERSONAL_ROOM_BASIC_FURNITURE, PERSONAL_ROOM_BASIC_OBSTACLES, PERSONAL_ROOM_PLACEMENT_ENVELOPE } from './personal-room-layout.js';
import { personalRoomSeatAnchors } from './personal-room-seats.js';
import { visiblePersonalRoomDecor, personalRoomDecorBox } from './personal-room-decor-layout.js';
const EPSILON=1e-6;
const overlaps=(a,b)=>['X','Y','Z'].every(axis=>a[`min${axis}`]<b[`max${axis}`]-EPSILON&&a[`max${axis}`]>b[`min${axis}`]+EPSILON);
export function furnitureVisualBox(object, visual) {
  const base=furnitureBox(object);
  if(!base||!visual?.min||!visual?.max)return null;
  const rad=(object.yaw+(visual.transform?.yaw??0))*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
  const scale=visual.transform?.scale??[1,1,1];
  const box={id:object.id,minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
  for(const x of [visual.min[0],visual.max[0]])for(const y of [visual.min[1],visual.max[1]])for(const z of [visual.min[2],visual.max[2]]){
    const p={X:object.x+cos*x*scale[0]+sin*z*scale[2],Y:base.minY+y*scale[1],Z:object.z-sin*x*scale[0]+cos*z*scale[2]};
    for(const axis of ['X','Y','Z']){box[`min${axis}`]=Math.min(box[`min${axis}`],p[axis]);box[`max${axis}`]=Math.max(box[`max${axis}`],p[axis]);}
  }
  return Object.freeze(box);
}
export function planFurnitureVisualPlacements(objects,{visualForItem=()=>null,modelMode='glb'}={}) {
  const plan=new Map();
  if(!Array.isArray(objects))return plan;
  const invalid=validateFurniture(objects);
  if(invalid) {
    // This is not a replacement persistence parser. Malformed data never acquires a
    // larger model; the existing authoritative reader retains its fail-closed result.
    for(const object of objects) {
      if(!object||!FURNITURE_BY_ID.has(object.itemId))continue;
      const visual=visualForItem(object.itemId);
      if(visual?.geometryPolicy==='character-r1')plan.set(object.id,Object.freeze({id:object.id,eligible:false,reason:'LEGACY_LAYOUT',box:furnitureBox(object),visual,notice:null}));
    }
    return plan;
  }
  const legacy=objects.map(object=>({object,box:furnitureBox(object),item:FURNITURE_BY_ID.get(object.itemId)}));
  const fixedChair=PERSONAL_ROOM_BASIC_FURNITURE.find(item=>item.id==='chair');
  const fixed=[...PERSONAL_ROOM_BASIC_OBSTACLES,
    {id:'personal_chair',minX:fixedChair.at[0]-fixedChair.size[0]/2,maxX:fixedChair.at[0]+fixedChair.size[0]/2,
      minY:fixedChair.at[1],maxY:fixedChair.at[1]+fixedChair.size[1],minZ:fixedChair.at[2]-fixedChair.size[2]/2,maxZ:fixedChair.at[2]+fixedChair.size[2]/2},
    ...visiblePersonalRoomDecor(objects).map(personalRoomDecorBox)];
  const selected=[];
  // Every expanded candidate must clear every legacy fallback first. UUID ordering then
  // resolves expanded-vs-expanded conflicts deterministically, independent of snapshot order.
  for(const {object,box:legacyBox} of [...legacy].sort((a,b)=>String(a.object.id).localeCompare(String(b.object.id)))){
    const visual=visualForItem(object.itemId);
    if(visual?.geometryPolicy!=='character-r1')continue;
    let reason=null;const box=furnitureVisualBox(object,visual),floor=PERSONAL_ROOM_PLACEMENT_ENVELOPE.floor;
    if(modelMode==='procedural'||visual.enabled!==true)reason='DISABLED';
    else if(invalid||object.surface!=='floor')reason='LEGACY_LAYOUT';
    else if(box.minX<floor.minX-EPSILON||box.maxX>floor.maxX+EPSILON||box.minZ<floor.minZ-EPSILON||box.maxZ>floor.maxZ+EPSILON)reason='ROOM_BOUNDS';
    else if(overlaps(box,{...PERSONAL_ROOM_PLACEMENT_ENVELOPE.exit,minY:0,maxY:Infinity}))reason='EXIT_BLOCKED';
    else if(fixed.some(other=>overlaps(box,other)))reason='FIXTURE_OVERLAP';
    else if(legacy.some(other=>other.object.id!==object.id&&other.box&&!(other.object.surface==='floor'&&other.item?.flat)&&overlaps(box,other.box)))reason='FURNITURE_OVERLAP';
    else if(selected.some(other=>overlaps(box,other)))reason='EXPANDED_OVERLAP';
    const eligible=reason===null;
    if(eligible)selected.push(box);
    plan.set(object.id,Object.freeze({id:object.id,eligible,reason,box:eligible?box:legacyBox,visual,
      notice:eligible||reason==='DISABLED'?null:'새 가구가 주변과 겹쳐 기존 외형을 유지해요. 꾸미기에서 여유 공간으로 옮겨 주세요.'}));
  }
  // Keep a usable local landing for each enlarged chair. Falling back only shrinks
  // these pinned silhouettes, so rejected landings cannot create new obstructions.
  const geometry=new Map([...plan].filter(([,entry])=>entry.eligible).map(([id,entry])=>[id,
    {box:entry.box,seatPosition:entry.visual.seat?.position,sourceKey:entry.visual.sha256}]));
  const blockers=[...fixed,...legacy.filter(row=>row.object.surface==='floor'&&row.item?.solid)
    .map(row=>geometry.get(row.object.id)?.box??row.box)];
  const seats=new Set(personalRoomSeatAnchors({roomId:'00000000-0000-4000-8000-000000000000',objects,obstacles:blockers,placementGeometry:geometry}).map(anchor=>anchor.interactableId));
  for(const [id,entry] of plan)if(entry.eligible&&entry.visual.seat&&!seats.has(id)){
    plan.set(id,Object.freeze({...entry,eligible:false,reason:'SEAT_EXIT_BLOCKED',box:legacy.find(row=>row.object.id===id).box,
      notice:'의자 앞에 안전하게 설 공간이 없어 기존 외형을 유지해요. 꾸미기에서 앞쪽 공간을 비워 주세요.'}));
  }
  return plan;
}
