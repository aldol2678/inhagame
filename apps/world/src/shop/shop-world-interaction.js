// Student Center Shop world entry (P0). A pure proximity controller in front of 학생회관: it only
// publishes a candidate for the shared interaction slot. The World's F key and the mobile
// #context-action button both run that action's trigger, which opens the existing shop panel.
// No DOM, no Shop / Wallet RPC: being near the shop never reads the shop.
import { studentCenterFrontPoint } from "../student-center-front.js";
import { metersToWorld } from "../world-scale.js";
import { SHOP_STUDENT_CENTER } from "./shop-client.js";

// Interaction slot order (higher wins): event/minigame 305–310 > NPC talk 300 > seated 280 >
// seat 260 > guestbook 255 > Biryong 245–250 > mechanical duck 240 > Follow stop 200 >
// **shop entry 190** > room doors 150 > event info 140. The shop never hides a conversation, a
// seat, an event or an explicit Follow stop; it only wins over doors and passive info.
export const STUDENT_CENTER_SHOP_CONTEXT_PRIORITY = 190;
export const STUDENT_CENTER_SHOP_PLACE_ZONE_ID = "AREA_INKYUNG_STUDENT_CENTER";

const front = studentCenterFrontPoint();
export const STUDENT_CENTER_SHOP_ENTRY = Object.freeze({
  id: "student_center_shop",
  shopId: SHOP_STUDENT_CENTER,
  x: front.x,
  z: front.z,
  placeZoneId: STUDENT_CENTER_SHOP_PLACE_ZONE_ID,
  // About the terrace foot and its first steps; not the pond promenade beyond it.
  interactionRadius: metersToWorld(3.5)
});

export function distance2D(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z));
}

/**
 * @param {{ anchor?: {x:number,z:number,placeZoneId?:string}, radius?: number,
 *   getAvailable?: () => boolean, openPanel?: () => unknown, priority?: number }} options
 *   getAvailable: a signed-in member account is bound (no RPC). openPanel: the existing panel open.
 */
export function createShopWorldInteraction({
  anchor = STUDENT_CENTER_SHOP_ENTRY,
  radius = anchor?.interactionRadius,
  getAvailable = () => false,
  openPanel = () => false,
  onEnter = () => {},
  priority = STUDENT_CENTER_SHOP_CONTEXT_PRIORITY
} = {}) {
  if (!anchor || !Number.isFinite(radius) || radius <= 0) throw new Error("Shop world interaction anchor/radius required");

  let nearby = false;
  let distance = Number.POSITIVE_INFINITY;
  let blocked = false;

  function open() {
    if (!nearby || blocked || getAvailable() !== true) return false;
    if (openPanel() === false) return false;
    // Optional quest observation must never block the shop, including an unavailable quest API.
    try { Promise.resolve(onEnter()).catch(() => {}); } catch { /* independent subsystem */ }
    return true;
  }

  /**
   * state.blocked: inside a room, mounted, shop already open, lobby shell / transition.
   * state.placeZoneId: the current campus Place Zone; any other zone never offers the shop.
   */
  function observe(position, state = {}) {
    const wrongZone = anchor.placeZoneId && state.placeZoneId !== undefined && state.placeZoneId !== anchor.placeZoneId;
    blocked = state.blocked === true || wrongZone;
    distance = distance2D(position, anchor);
    nearby = !blocked && distance <= radius;
    if (!nearby) return null;

    const available = getAvailable() === true;
    return {
      id: "student-center-shop",
      icon: available ? "🛍" : "🔒",
      label: available ? "학생회관 상점" : "로그인 후 상점",
      shortcut: "F",
      priority,
      distance,
      pressed: false,
      disabled: !available,
      trigger: open
    };
  }

  return {
    observe,
    open,
    get nearby() { return nearby; },
    get distance() { return distance; },
    get blocked() { return blocked; },
    status() {
      return { nearby, blocked, distance: Number.isFinite(distance) ? Number(distance.toFixed(3)) : null };
    }
  };
}
