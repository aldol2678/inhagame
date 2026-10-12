// JSL-B · Jeongseok interior flow (engine-free; main.js supplies rooms, policy and scenes).
//
//   campus ─(door, policy)→ 1F lobby ─(temporary transfer)→ B1 Second Reading Room
//                                     └(temporary transfer)→ B1 Creative Space
//   B1 Reading ⇄ B1 Creative (temporary B1 link, the lobby stays the return parent)
//   B1 ─(room exit)→ lobby ─(room exit)→ campus return anchor
// Every transfer is GAME_ADAPTATION: it does not claim a real stair, elevator or corridor.
// Entry is owned by the entry policy; an account change, expiry or failed re-read during a stay
// forces a direct exit to the campus return anchor (rollback-safe Room Transition).

import { ROOM_CONTEXT_PRIORITY } from "../rooms/room-transition.js";
import { CAMPUS_SPACE } from "../rooms/room-registry.js";
import { JEONGSEOK_ENTRY_MODE } from "./entry-policy.js";
import { JEONGSEOK_ENTRANCE, JEONGSEOK_LAYOUTS, JEONGSEOK_LOBBY_ROOM_ID, isJeongseokRoomId } from "./interior-rooms.js";

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const JEONGSEOK_TEXT = Object.freeze({
  previewDoor: "정석학술정보관 들어가기 · 미리보기",
  closed: "정석학술정보관 실내는 아직 열리지 않았어요.",
  mounted: "탑승 중에는 정석학술정보관에 들어갈 수 없어요.",
  busy: "지금은 이동할 수 없어요. 잠시 후 다시 시도해 주세요.",
  revoked: "출입 권한을 다시 확인할 수 없어 캠퍼스로 나왔어요.",
  account: "계정이 바뀌어 정석학술정보관에서 나왔어요."
});

export function createJeongseokInterior({ rooms, policy, layouts = JEONGSEOK_LAYOUTS, entrance = JEONGSEOK_ENTRANCE,
  scenes = null, onStatus = () => {} }) {
  if (!rooms || !policy) throw new Error("Jeongseok interior requires rooms and an entry policy");
  let accountGeneration = 0;
  let entering = false;
  let forcing = false;
  let lastSpace = rooms.currentSpace;
  const stats = { entries: 0, refused: 0, forcedExits: 0, released: 0, portalUses: 0 };

  const inside = () => isJeongseokRoomId(rooms.currentSpace);
  const lobbyPortalFor = roomId => layouts[JEONGSEOK_LOBBY_ROOM_ID].portals.find(portal => portal.target === roomId) ?? null;

  /** Access predicate registered with the Room Transition under the "jeongseok-policy" key. */
  const accessPredicate = (doorway, room) => doorway ? entering && policy.allowsEntry() : policy.allowsStay(doorway, room);

  function forceOut(message) {
    if (!inside()) return false;
    forcing = true;
    stats.forcedExits += 1;
    if (message) onStatus(message);
    return rooms.exit({ force: true, toCampus: true });
  }

  function enter({ mounted = false } = {}) {
    if (rooms.currentSpace !== CAMPUS_SPACE) return { status: "NOT_ON_CAMPUS" };
    if (mounted) { stats.refused += 1; onStatus(JEONGSEOK_TEXT.mounted); return { status: "MOUNTED" }; }
    if (!policy.allowsEntry()) { stats.refused += 1; return { status: "CLOSED" }; }
    const generation = accountGeneration;
    entering = true;
    let ok = false;
    try {
      ok = rooms.enter(JEONGSEOK_LOBBY_ROOM_ID, { entranceId: entrance.id, isValid: () => generation === accountGeneration });
    } finally { entering = false; }
    if (!ok) { onStatus(JEONGSEOK_TEXT.busy); return { status: "BUSY" }; }
    return { status: "ENTERING" };
  }

  /** JSL-A gate hand-off (PR #358 `onEnter`): only a fresh server GRANTED snapshot opens one entry. */
  function enterFromServerGrant(snapshot, { mounted = false } = {}) {
    if (policy.mode !== JEONGSEOK_ENTRY_MODE.SERVER_GRANT || !policy.acceptServerGrant(snapshot)) {
      stats.refused += 1;
      return { status: "REFUSED" };
    }
    const result = enter({ mounted });
    if (result.status !== "ENTERING") policy.discardGrant();
    return result;
  }

  function usePortal(portal) {
    const from = rooms.currentSpace;
    const generation = accountGeneration;
    const isValid = () => generation === accountGeneration && policy.allowsStay();
    let ok = false;
    if (portal.kind === "nested") {
      ok = rooms.enterNested(portal.target, { fromRoomId: from, returnPosition: portal.returnAnchor.position,
        returnYaw: portal.returnAnchor.yaw, metadata: { jeongseokPortal: portal.id }, isValid });
    } else if (portal.kind === "switch") {
      const lobbyPortal = lobbyPortalFor(portal.target);
      ok = rooms.switchNested(portal.target, { fromRoomId: from, arrival: portal.arrival,
        returnPosition: lobbyPortal?.returnAnchor.position ?? null, returnYaw: lobbyPortal?.returnAnchor.yaw ?? null, isValid });
    }
    if (ok) stats.portalUses += 1;
    else onStatus(JEONGSEOK_TEXT.busy);
    return ok;
  }

  function contextAction({ position, grounded = true, mounted = false } = {}) {
    if (!position || !grounded || rooms.status().busy) return null;
    const space = rooms.currentSpace;
    if (space === CAMPUS_SPACE) {
      if (mounted || !policy.allowsEntry() || !rooms.status().ready) return null;
      const distance = flat(position, entrance.position);
      if (distance > entrance.radius) return null;
      const preview = policy.mode === JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW;
      return { id: "jeongseok-door", icon: "📚", label: preview ? JEONGSEOK_TEXT.previewDoor : "정석학술정보관 들어가기",
        priority: ROOM_CONTEXT_PRIORITY, distance, pressed: false, trigger: () => enter({ mounted }).status === "ENTERING" };
    }
    const layout = layouts[space];
    if (!layout || !rooms.status().ready) return null;
    let best = null;
    for (const portal of layout.portals) {
      const distance = flat(position, portal.position);
      if (distance <= portal.radius && (!best || distance < best.distance)) best = { portal, distance };
    }
    if (!best) return null;
    return { id: "jeongseok-portal", icon: best.portal.icon, label: best.portal.label, priority: ROOM_CONTEXT_PRIORITY,
      distance: best.distance, pressed: false, trigger: () => usePortal(best.portal) };
  }

  const unsubscribe = rooms.onChange((state, event) => {
    const was = lastSpace;
    lastSpace = state.space;
    if (event === "enter" && state.space === JEONGSEOK_LOBBY_ROOM_ID && was === CAMPUS_SPACE) {
      stats.entries += 1;
      policy.commitEntry();
    }
    if (state.space === CAMPUS_SPACE && isJeongseokRoomId(was)) {
      forcing = false;
      policy.endSession("LEFT");
      if (scenes?.releaseAll) { scenes.releaseAll(); stats.released += 1; }
    }
    if (!isJeongseokRoomId(state.space)) forcing = false;
  });

  return {
    contextAction,
    enter,
    enterFromServerGrant,
    usePortal,
    accessPredicate,
    /** Per frame: a stay that is no longer allowed leaves directly to the campus anchor. */
    update() {
      if (!inside() || forcing || rooms.status().busy) return false;
      if (policy.allowsStay()) return false;
      return forceOut(JEONGSEOK_TEXT.revoked);
    },
    /** Fresh server read while inside (SERVER_GRANT only). */
    revalidate(snapshot) {
      if (!inside() || policy.revalidate(snapshot)) return true;
      forceOut(JEONGSEOK_TEXT.revoked);
      return false;
    },
    setAccount(accountId) {
      if (!policy.setAccount(accountId)) return false;
      accountGeneration += 1;
      if (inside()) forceOut(JEONGSEOK_TEXT.account);
      return true;
    },
    status: () => Object.freeze({ space: rooms.currentSpace, inside: inside(), policy: policy.status(), stats: { ...stats },
      accountGeneration, forcing }),
    destroy() { unsubscribe(); }
  };
}
