// Ephemeral practice only. No personal-room client, inventory, UUID generation or persistence.
import { FURNITURE_BY_ID, furnitureBox, validateFurniture, positionOnSurface, firstFurniturePosition } from '../rooms/furniture-layout.js';
import { PERSONAL_ROOM_BASIC_OBSTACLES, PERSONAL_ROOM_BASIC_SPAWN } from '../rooms/personal-room-layout.js';
import { personalRoomSeatAnchors, roomSeatPointIsClear } from '../rooms/personal-room-seats.js';

export const SAMPLE_ROOM_ID = '00000000-0000-4000-8000-000000000001'; // Local geometry namespace, never sent to a server.
export const SAMPLE_ROOM_ITEMS = Object.freeze([
  'furniture.dorm_single_sofa', 'furniture.dorm_side_table_low',
  'furniture.dorm_bookshelf_slim', 'furniture.dorm_plant_medium', 'furniture.study_books_set'
].map((itemId, index) => Object.freeze({ itemId, quantity: 1, id: `00000000-0000-4000-8000-${String(index + 11).padStart(12, '0')}` })));
const copy = rows => rows.map(row => ({ ...row }));
const initial = () => SAMPLE_ROOM_ITEMS.map((item, index) => ({ id: item.id, itemId: item.itemId,
  surface: index === 4 ? 'desk' : 'floor',
  ...[{ x: 3, z: -.25, yaw: 0 }, { x: 2, z: .75, yaw: 0 }, { x: -1.75, z: 2.75, yaw: 0 },
    { x: 4, z: .75, yaw: 0 }, { x: 2.5, z: 1.75, yaw: 0 }][index] }));
const obstaclesOf = objects => [...PERSONAL_ROOM_BASIC_OBSTACLES,
  ...objects.filter(row => row.surface === 'floor' && FURNITURE_BY_ID.get(row.itemId)?.solid).map(furnitureBox)];

// A cardinal .125 grid with segment sampling makes a route conservative at player width.
// Objective checks use the same H2 collision geometry as the actual room and seating code.
export function sampleRoomRoute(objects, target) {
  if (!target) return false;
  const obstacles = obstaclesOf(objects), step = .125;
  const clear = p => roomSeatPointIsClear(p, obstacles);
  const segment = (a, b) => {
    const n = Math.max(1, Math.ceil(Math.hypot(a.x-b.x, a.z-b.z) / .05));
    for (let i = 0; i <= n; i++) if (!clear({ x: a.x+(b.x-a.x)*i/n, z: a.z+(b.z-a.z)*i/n })) return false;
    return true;
  };
  const origin = PERSONAL_ROOM_BASIC_SPAWN.position;
  const start = { x: Math.round(origin.x/step), z: Math.round(origin.z/step) };
  const point = p => ({x:p.x*step,z:p.z*step});
  if (!segment(origin, point(start)) || !clear(target)) return false;
  const queue = [start], seen = new Set([`${start.x},${start.z}`]);
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index], p = point(node);
    if (Math.hypot(p.x-target.x,p.z-target.z) <= step*1.5 && segment(p,target)) return true;
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const next={x:node.x+dx,z:node.z+dz}, key=`${next.x},${next.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (segment(p,point(next))) queue.push(next);
    }
  }
  return false;
}
export function evaluateSampleRoom(objects, booksStored = false) {
  const validation = validateFurniture(objects, SAMPLE_ROOM_ITEMS);
  const allowed = Array.isArray(objects) && objects.every(row => SAMPLE_ROOM_ITEMS.some(item => item.id === row?.id && item.itemId === row?.itemId));
  if (validation || !allowed) return { valid: false, error: validation ?? 'INVALID_LAYOUT', route: false, seat: false, storage: false, complete: false };
  const anchor = personalRoomSeatAnchors({ roomId: SAMPLE_ROOM_ID, objects }).find(row => row.interactableId === 'fixed-chair');
  const seat = !!anchor;
  const route = seat && sampleRoomRoute(objects, anchor.standPoint);
  const shelf = objects.find(row => row.itemId === 'furniture.dorm_bookshelf_slim');
  const storage = !!shelf && booksStored && !objects.some(row => row.itemId === 'furniture.study_books_set')
    && Math.hypot(shelf.x-2.95,shelf.z-1.7) <= 3;
  return { valid: true, error: null, route, seat, storage, complete: route && seat && storage };
}
export function createSampleRoomTrial() {
  let active = false, accountId = null, objects = [], booksStored = false, checked = false, generation = 0, evaluation = null;
  const snapshot = () => ({ active, accountId, objects: copy(objects), booksStored, checked, generation,
    reward: null, result: active ? { ...(evaluation ??= evaluateSampleRoom(objects,booksStored)) } : null });
  const eligible = (account, token) => active && account === accountId && token === generation;
  return {
    state: snapshot,
    open(account) { if (typeof account !== 'string' || !account.trim()) return false; accountId=account; active=true; objects=initial(); booksStored=false; checked=false; evaluation=null; generation++; return true; },
    close() { active=false; accountId=null; objects=[]; booksStored=false; checked=false; evaluation=null; generation++; },
    reset(account, token) { if (!eligible(account,token)) return false; objects=initial(); booksStored=false; checked=false; evaluation=null; generation++; return true; },
    edit(next, account, token) {
      if (!eligible(account,token) || !Array.isArray(next) || next.length > SAMPLE_ROOM_ITEMS.length) return false;
      const ids=new Set();
      // Invalid geometry remains an editable preview, but foreign/duplicate items never enter this session.
      if (next.some(row => !SAMPLE_ROOM_ITEMS.some(item => item.id===row?.id && item.itemId===row?.itemId)
        || Object.keys(row).sort().join() !== 'id,itemId,surface,x,yaw,z'
        || !FURNITURE_BY_ID.get(row.itemId)?.surfaces.includes(row.surface) || ids.has(row.id) || !ids.add(row.id) || ![row.x,row.z,row.yaw].every(Number.isFinite))) return false;
      objects=copy(next); if (objects.some(row => row.itemId==='furniture.study_books_set')) booksStored=false;
      if (!objects.some(row => row.itemId==='furniture.dorm_bookshelf_slim')) booksStored=false;
      checked=false; evaluation=null; return true;
    },
    add(itemId, account, token) {
      if (!eligible(account,token)) return false;
      const item=SAMPLE_ROOM_ITEMS.find(row=>row.itemId===itemId);
      if (!item || objects.some(row=>row.id===item.id)) return false;
      const surface=FURNITURE_BY_ID.get(itemId).surfaces[0];
      const position=firstFurniturePosition(itemId,surface,objects,SAMPLE_ROOM_ITEMS,{id:item.id});
      if (!position) return false;
      return this.edit([...objects,position],account,token);
    },
    move(id, patch, account, token) {
      if (!eligible(account,token)) return false;
      const object=objects.find(row=>row.id===id); if (!object) return false;
      return this.edit(objects.map(row=>row.id===id ? {...row,...positionOnSurface(row.surface,patch.x??row.x,patch.z??row.z,patch.yaw??row.yaw)} : row),account,token);
    },
    storeBooks(account, token) {
      if (!eligible(account,token) || !objects.some(row=>row.itemId==='furniture.dorm_bookshelf_slim')) return false;
      objects=objects.filter(row=>row.itemId!=='furniture.study_books_set'); booksStored=true; checked=false; evaluation=null; return true;
    },
    check(account, token) { if (!eligible(account,token)) return false; checked=true; return snapshot().result; }
  };
}
