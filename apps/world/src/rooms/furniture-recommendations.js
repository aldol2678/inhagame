// Pure, deterministic suggestions. Inventory is read-only; the existing validator is authoritative.
import { ROOM_FURNITURE, FURNITURE_LIMIT, positionOnSurface, furnitureBox, furniturePlacementsOverlap, FURNITURE_SURFACE_BOUNDS, validateFurniture } from './furniture-layout.js';
import { PERSONAL_ROOM_PLACEMENT_ENVELOPE as ENVELOPE } from './personal-room-layout.js';

export const FURNITURE_STYLES = Object.freeze([
  { id: 'study', name: '공부 중심', description: '책상 위 소품과 오른쪽 공부 공간을 먼저 꾸며요.' },
  { id: 'relax', name: '휴식 중심', description: '침대 위 쿠션과 왼쪽 휴식 공간을 먼저 꾸며요.' },
  { id: 'open', name: '중앙 비우기', description: '가구를 가장자리로 모으고 중앙과 출입 동선을 비워요.' }
]);
const overlaps = (a,b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const priority = (item, style) => {
  const id = item.itemId;
  if (style === 'study') return /monitor|books|lamp|chair/.test(id) ? 0 : 1;
  if (style === 'relax') return /sofa|cushion|side_table|plant|rug/.test(id) ? 0 : 1;
  return item.surfaces.includes('floor') ? 1 : 0;
};
// Bounded catalog-only cache, independent of inventory/account/layout. Floor samples
// use .5-unit spacing; desktop/bed props retain .25 precision on their small surfaces.
// Opposing yaw values have the same collision footprint, so enumerate only four.
const pointCache = new Map();
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000000';
function points(item, surface, style) {
  const cacheKey = `${item.itemId}:${surface}:${style}`;
  if (pointCache.has(cacheKey)) return pointCache.get(cacheKey);
  const floor = ENVELOPE.floor, wall = ENVELOPE.wall, result = [];
  const bounds = FURNITURE_SURFACE_BOUNDS[surface] ?? {minX:-wall.maxX,maxX:wall.maxX,minZ:-wall.maxZ,maxZ:wall.maxZ};
  const step = surface === 'floor' ? .5 : .25;
  const minX = Math.ceil(bounds.minX / step) * step, maxX = bounds.maxX;
  const minZ = Math.ceil(bounds.minZ / step) * step, maxZ = bounds.maxZ;
  for (let x = minX; x <= maxX; x += step) {
    for (let z = minZ; z <= maxZ; z += step) {
      if (['north','south'].includes(surface) && z !== minZ) continue;
      if (['east','west'].includes(surface) && x !== minX) continue;
      for (const yaw of surface === 'floor' ? [0,90,45,135] : [0]) {
        const candidate = {id:CANDIDATE_ID,itemId:item.itemId,surface,...positionOnSurface(surface,x,z,yaw)};
        const box = furnitureBox(candidate);
        if (surface === 'floor') {
          if (overlaps(box,{minX:-.65,maxX:.65,minZ:floor.minZ,maxZ:.5})) continue;
          if (style === 'open' && overlaps(box,{minX:-2,maxX:2,minZ:-2.25,maxZ:2.25})) continue;
        }
        // Check fixed facilities/bounds once, not for every owned copy and its
        // entire accumulated layout. This cache contains no user-dependent data.
        if (validateFurniture([candidate])) continue;
        const targetX = style === 'study' ? 2.9 : -2.8;
        const targetZ = style === 'study' ? .1 : -.6;
        const score = style === 'open'
          ? Math.min(x-floor.minX,floor.maxX-x,z-floor.minZ,floor.maxZ-z)
          : Math.hypot(x-targetX,z-targetZ);
        result.push({candidate,score});
      }
    }
  }
  result.sort((a,b)=>a.score-b.score || a.candidate.yaw-b.candidate.yaw || a.candidate.z-b.candidate.z || a.candidate.x-b.candidate.x);
  pointCache.set(cacheKey,result);
  return result;
}
export function recommendFurniture(style, owned, current = []) {
  if (!FURNITURE_STYLES.some(row=>row.id===style) || !Array.isArray(owned) ||
      owned.some(row=>!row || typeof row.itemId !== 'string' || !Number.isSafeInteger(row.quantity) || row.quantity < 0) ||
      new Set(owned.map(row=>row.itemId)).size !== owned.length) {
    return {objects:[],unplaced:[],error:'INVALID_INVENTORY'};
  }
  const objects = [], unplaced = [], used = new Set();
  let serial = 1;
  const items = [...ROOM_FURNITURE].sort((a,b)=>priority(a,style)-priority(b,style) || a.itemId.localeCompare(b.itemId));
  for (const item of items) {
    const quantity = owned.find(row=>row.itemId===item.itemId)?.quantity ?? 0;
    if (!quantity) continue;
    const surfaces = [...item.surfaces].sort((a,b)=>{
      const rank = key => key === 'bed' ? (style === 'relax' ? -2 : -1) : key === 'desk' ? -1 : 0;
      return rank(a)-rank(b);
    });
    const candidates = new Map();
    for (let copy = 0; copy < quantity; copy++) {
      if (objects.length >= FURNITURE_LIMIT) {unplaced.push({itemId:item.itemId,quantity:quantity-copy,reason:'한 방에 최대 32개까지 배치할 수 있어요.'});break;}
      let id = current.filter(row=>row.itemId===item.itemId).sort((a,b)=>a.id.localeCompare(b.id))[copy]?.id;
      if (!id || used.has(id)) do {id=`00000000-0000-4000-8001-${String(serial++).padStart(12,'0')}`;} while (used.has(id) || current.some(row=>row.id===id));
      let position = null;
      for (const surface of surfaces) {
        if (!candidates.has(surface)) candidates.set(surface,points(item,surface,style));
        for (const {candidate: point} of candidates.get(surface)) {
          if (objects.some(prior => furniturePlacementsOverlap(point, prior))) continue;
          const candidate = {...point,id};
          if (!validateFurniture([...objects,candidate],owned)) {position=candidate;break;}
        }
        if (position) break;
      }
      if (!position) {unplaced.push({itemId:item.itemId,quantity:quantity-copy,reason:'고정 시설·출입 동선·스타일 여백을 지킬 공간이 부족해요.'});break;}
      objects.push(position);used.add(id);
    }
  }
  // Fail closed if the runtime/persistence geometry contract rejects the final candidate.
  const error = validateFurniture(objects,owned);
  return error ? {objects:[],unplaced:[],error} : {objects,unplaced,error:null};
}
