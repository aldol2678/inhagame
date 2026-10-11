// New, explicit shop assignments for existing roster people. Identity/appearance still
// comes from the NPC population; this contract does not grant trade to a role.
import { studentConnectedFrame } from '../student-center-frame.js';
import { createStudentConnectedWalk } from '../student-center-connected.js';
import { WALK_SHAPE } from '../player-dimensions.js';
import { routesForNpc } from './shop-routes.js';

const frame = studentConnectedFrame();
export const STUDENT_CENTER_VENDORS = Object.freeze([
  ['INKYUNG-NPC-003', '나수현', 'vendor.student_center_souvenir', 'shop.student_center', '기념품', 10.2],
  ['INKYUNG-NPC-012', '가지안', 'vendor.student_center_fashion', 'shop.student_center_fashion', '패션', 22.4]
].map(([npcId, name, vendorId, shopId, label, x]) => {
  const local = Object.freeze([x, .08, -2]);
  const p = frame.toWorld(local);
  return Object.freeze({ npcId, name, vendorId, shopId, label, local,
    position: Object.freeze({ x: p[0], y: p[1], z: p[2] }), heading: 0,
    interactionRadius: 1.1, placeZoneId: 'AREA_INKYUNG_STUDENT_CENTER' });
}));
export function studentCenterVendor(npcId) {
  return STUDENT_CENTER_VENDORS.find(vendor => vendor.npcId === npcId) ?? null;
}

// One existing visual is pinned by the NPC runtime before schedule/server movement.
// Returns false for every other NPC, including quest NPCs and generic shop workers.
export function applyStudentVendorPlacement(visual, actor, vendor) {
  if (!vendor || actor?.id !== vendor.npcId) return false;
  actor.position = { x: vendor.position.x, z: vendor.position.z };
  actor.location = 'student_center_shop';
  actor.activity = 'SHOP_SERVICE';
  visual.actor = actor;
  visual.seat = null;
  Object.assign(visual.motion, { position: { ...actor.position }, route: [], moving: false,
    heading: vendor.heading, sharedMeeting: false });
  visual.avatar.setLocalPosition?.(vendor.position.x, vendor.position.y, vendor.position.z);
  visual.avatar.setLocalEulerAngles?.(0, vendor.heading, 0);
  visual.avatar.enabled = true;
  return true;
}

export function createStudentVendorInteraction({ getMode = () => 'split', getAvailable = () => false,
  getBlocked = () => true, getPosition = () => null, getNpcReady = () => false,
  openShop = () => false } = {}) {
  const walk = createStudentConnectedWalk({ space: 'world' });
  let current = null;
  function eligible(vendor, position, ignoreInputGate = false) {
    if (getMode() !== 'split' || !position || ![position.x, position.y, position.z].every(Number.isFinite) ||
        (!ignoreInputGate && getBlocked() !== false) || getNpcReady(vendor.npcId) !== true) return false;
    const feet = position.y - WALK_SHAPE.footOffset;
    if (Math.abs(feet - vendor.position.y) > .16 ||
        Math.hypot(position.x - vendor.position.x, position.z - vendor.position.z) > vendor.interactionRadius) return false;
    // The same body sweep as indoor walking prevents buying through shelves/walls.
    const from = { x: position.x, z: position.z, elevation: vendor.position.y };
    const check = walk.inspect(from.x, from.z, from.elevation);
    if (!check.supported || !check.clear) return false;
    return !walk.step(from, vendor.position.x, vendor.position.z).blocked;
  }
  function open(candidate = current) {
    const vendor = studentCenterVendor(candidate?.npcId);
    if (!vendor || !eligible(vendor, getPosition()) || getAvailable() !== true ||
        !routesForNpc(vendor.npcId, STUDENT_CENTER_VENDORS).some(route => route.shopId === vendor.shopId)) return false;
    return openShop(vendor.shopId) !== false;
  }
  function observe() {
    const position = getPosition();
    current = STUDENT_CENTER_VENDORS.filter(vendor => eligible(vendor, position))
      .sort((a, b) => Math.hypot(position.x-a.position.x, position.z-a.position.z) -
        Math.hypot(position.x-b.position.x, position.z-b.position.z))[0] ?? null;
    if (!current) return null;
    const vendor = current, available = getAvailable() === true;
    return { id: `npc-shop-${vendor.npcId}`, icon: available ? '🛍' : '🔒',
      label: available ? `${vendor.name} · ${vendor.label}` : `${vendor.name} · 로그인 후 상점`,
      shortcut: 'F', priority: 300, distance: Math.hypot(position.x-vendor.position.x, position.z-vendor.position.z),
      pressed: false, disabled: !available, trigger: () => open(vendor) };
  }
  const canAccess = shopId => vendorsForShop(shopId).some(vendor => eligible(vendor, getPosition(), true));
  return { observe, open, canAccess, status: () => ({ npcId: current?.npcId ?? null, shopId: current?.shopId ?? null }) };
}

function vendorsForShop(shopId) { return STUDENT_CENTER_VENDORS.filter(vendor => vendor.shopId === shopId); }
