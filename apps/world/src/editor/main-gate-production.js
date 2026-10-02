import { GATE_FRAME } from '../main-gate-frame.js';

const url=new URL('../../data/editor/main-gate.world.json',import.meta.url);
export const MAIN_GATE_EDITOR_WORLD=typeof window==='undefined'
  ? JSON.parse((await import('node:fs')).readFileSync(url,'utf8'))
  : await (async()=>{const r=await fetch(url);if(!r.ok)throw Error(`Main gate editor world load failed: ${r.status}`);return r.json();})();

if(MAIN_GATE_EDITOR_WORLD.metadata?.productionAdapter!=='main-gate-v1')
  throw Error('E_MAIN_GATE_EDITOR_ADAPTER_MISMATCH');

const METERS_PER_WORLD_UNIT=MAIN_GATE_EDITOR_WORLD.metadata.metersPerWorldUnit||2;

function rotateByQuaternion(point,q){
  const [x,y,z]=point,[qx,qy,qz,qw]=q;
  const ix= qw*x+qy*z-qz*y, iy=qw*y+qz*x-qx*z, iz=qw*z+qx*y-qy*x, iw=-qx*x-qy*y-qz*z;
  return [
    ix*qw+iw*-qx+iy*-qz-iz*-qy,
    iy*qw+iw*-qy+iz*-qx-ix*-qz,
    iz*qw+iw*-qz+ix*-qy-iy*-qx
  ];
}
function transformedMeterPoints(entity){
  const t=entity.transform,path=entity.components['world.path'];
  return path.points.map(point=>{
    const scaled=point.map((value,index)=>value*t.scale[index]);
    const rotated=rotateByQuaternion(scaled,t.rotation);
    return rotated.map((value,index)=>value+t.position[index]);
  });
}
function toWorld(point){
  const p=GATE_FRAME.at(point[0]/METERS_PER_WORLD_UNIT,point[2]/METERS_PER_WORLD_UNIT);
  return {x:p.x,y:point[1]/METERS_PER_WORLD_UNIT,z:p.z};
}

const productionEntities=MAIN_GATE_EDITOR_WORLD.entities.filter(entity=>entity.enabled&&entity.metadata?.production?.owner==='main-gate');
const byProductionId=new Map(productionEntities.map(entity=>[entity.metadata.production.id,entity]));

export function mainGateEditorEntity(productionId){
  const entity=byProductionId.get(productionId);
  if(!entity)throw Error(`E_MAIN_GATE_EDITOR_ENTITY_MISSING:${productionId}`);
  return entity;
}
export function mainGateProductionPath(productionId){
  const entity=mainGateEditorEntity(productionId),data=entity.components['world.path'],meta=entity.metadata.production;
  if(!data)throw Error(`E_MAIN_GATE_EDITOR_PATH_MISSING:${productionId}`);
  return Object.freeze({
    id:meta.id,name:entity.name,kind:meta.kind,role:meta.role,
    vertices:transformedMeterPoints(entity).map(toWorld),
    width:data.widthMeters/METERS_PER_WORLD_UNIT,
    side:Number.isFinite(meta.side)?meta.side:null,
    editorEntityId:entity.id
  });
}
function yawDegrees([x,y,z,w]){
  if(Math.abs(x)>1e-6||Math.abs(z)>1e-6)throw Error('E_MAIN_GATE_STRUCTURE_TILT_UNSUPPORTED');
  return Math.atan2(2*(w*y+x*z),1-2*(y*y+z*z))*180/Math.PI;
}
export function mainGateProductionStructure(productionId){
  const entity=mainGateEditorEntity(productionId),data=entity.components['world.structure'],meta=entity.metadata.production;
  if(!data)throw Error(`E_MAIN_GATE_EDITOR_STRUCTURE_MISSING:${productionId}`);
  const position=toWorld(entity.transform.position);
  const half=[data.sizeMeters[0]/2,0,data.sizeMeters[2]/2];
  const footprint=[[-half[0],0,-half[2]],[half[0],0,-half[2]],[half[0],0,half[2]],[-half[0],0,half[2]]]
    .map(point=>{
      const scaled=point.map((value,index)=>value*entity.transform.scale[index]);
      const rotated=rotateByQuaternion(scaled,entity.transform.rotation);
      const meter=rotated.map((value,index)=>value+entity.transform.position[index]);
      const world=toWorld(meter);
      return Object.freeze({x:world.x,z:world.z});
    });
  const size=Object.freeze(data.sizeMeters.map((value,index)=>value*entity.transform.scale[index]/METERS_PER_WORLD_UNIT));
  const collisionMaxY=Number.isFinite(meta.collisionHeightMeters)
    ? meta.collisionHeightMeters/METERS_PER_WORLD_UNIT
    : position.y+size[1]/2;
  return Object.freeze({
    id:meta.id,name:entity.name,kind:meta.kind,role:meta.role,
    position:Object.freeze([position.x,position.y,position.z]),
    size,
    footprint:Object.freeze(footprint),
    collisionMaxY,
    yaw:GATE_FRAME.yaw+yawDegrees(entity.transform.rotation),
    color:data.color||'#b8b8ad',
    editorEntityId:entity.id
  });
}
export const MAIN_GATE_EDITOR_PRODUCTION_IDS=Object.freeze([...byProductionId.keys()]);
