// Public lobby + account-bound inner lobby/B1 flow. These scenes are local, not authoritative
// server rooms. Server RPCs own eligibility/economy; the normal client enforces its scene boundary.
import { ROOM_CONTEXT_PRIORITY } from "../rooms/room-transition.js";
import { CAMPUS_SPACE } from "../rooms/room-registry.js";
import { JEONGSEOK_GATE, nearJeongseokGate } from "./gate-layout.js";
import { JEONGSEOK_ENTRY_MODE } from "./entry-policy.js";
import { JEONGSEOK_ENTRANCE, JEONGSEOK_LAYOUTS, JEONGSEOK_LOBBY_ROOM_ID, isJeongseokRoomId } from "./interior-rooms.js";
import { JEONGSEOK_PUBLIC_RETURN, JEONGSEOK_INNER_BOUNDARY_Z, isJeongseokProtectedPosition } from "./lobby-layout.js";

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const JEONGSEOK_TEXT = Object.freeze({
  previewDoor: "정석학술정보관 들어가기 · 미리보기",
  closed: "정석학술정보관 실내는 아직 열리지 않았어요.",
  mounted: "탑승 중에는 정석학술정보관에 들어갈 수 없어요.",
  busy: "지금은 이동할 수 없어요. 잠시 후 다시 시도해 주세요.",
  revoked: "출입 권한을 다시 확인해야 해 공개 로비로 이동했어요.",
  account: "계정이 바뀌어 공개 로비로 이동했어요."
});

export function createJeongseokInterior({ rooms, policy, layouts = JEONGSEOK_LAYOUTS, entrance = JEONGSEOK_ENTRANCE,
  scenes = null, getPosition = () => null, placePublic = () => false, onRecoveryError = () => {}, onStatus = () => {} }) {
  if (!rooms || !policy) throw new Error("Jeongseok interior requires rooms and an entry policy");
  let accountGeneration = 0, entering = false, forcing = false;
  let lastSpace = rooms.currentSpace;
  const stats = { entries: 0, refused: 0, forcedExits: 0, released: 0, portalUses: 0, protectedEntries: 0 };
  const inside = () => isJeongseokRoomId(rooms.currentSpace);
  const protectedSpace = () => inside() && (rooms.currentSpace !== JEONGSEOK_LOBBY_ROOM_ID || isJeongseokProtectedPosition(getPosition()));
  // Lobby stays public; nested/sibling/direct B1 routes all need the protected session.
  const accessPredicate = (doorway, room) => room?.id === JEONGSEOK_LOBBY_ROOM_ID
    ? policy.allowsLobby() && (!doorway || entering)
    : !doorway && isJeongseokRoomId(room?.id) && protectedSpace() && policy.allowsProtectedRoom();
  // Keep the shared collision current at the policy change, including a cached lobby while
  // B1 is active. Waiting for the next scene frame leaves a completed return with an open gate.
  const syncGateAccess = () => scenes?.setGateAccess?.(policy.allowsStay());
  const endSession = reason => { policy.endSession(reason); syncGateAccess(); };

  function forcePublic(message) {
    if (!inside()) return false;
    endSession("RETURNED_TO_PUBLIC");
    stats.forcedExits += 1;
    if (message) onStatus(message);
    if (rooms.currentSpace !== JEONGSEOK_LOBBY_ROOM_ID) {
      // All normal B1 return anchors are public, including sibling-room switching. A failed
      // required departure keeps Room Transition's SYSTEM_LOCK instead of restoring free input.
      forcing = true;
      const accepted = rooms.exit({ force: true });
      if (!accepted) forcing = false;
      return accepted;
    }
    if (rooms.status().busy) return false;
    try {
      if (placePublic(JEONGSEOK_PUBLIC_RETURN) !== true) throw new Error("Public lobby recovery failed");
      forcing = false;
      return true;
    } catch (error) { forcing = true; onRecoveryError(error); return false; }
  }

  function enter({ mounted = false } = {}) {
    if (rooms.currentSpace !== CAMPUS_SPACE) return { status: "NOT_ON_CAMPUS" };
    if (mounted) { stats.refused += 1; onStatus(JEONGSEOK_TEXT.mounted); return { status: "MOUNTED" }; }
    if (!policy.allowsLobby()) { stats.refused += 1; return { status: "CLOSED" }; }
    const generation = accountGeneration;
    entering = true;
    let ok = false;
    try { ok = rooms.enter(JEONGSEOK_LOBBY_ROOM_ID, { entranceId: entrance.id, isValid: () => generation === accountGeneration }); }
    finally { entering = false; }
    if (!ok) { onStatus(JEONGSEOK_TEXT.busy); return { status: "BUSY" }; }
    return { status: "ENTERING" };
  }

  // Called only after the inner reader rechecks server eligibility and live proximity.
  function enterFromServerGrant(snapshot, { mounted = false } = {}) {
    if (mounted) return { status: "MOUNTED" };
    if (rooms.currentSpace !== JEONGSEOK_LOBBY_ROOM_ID || rooms.status().busy ||
        nearJeongseokGate(getPosition(), JEONGSEOK_GATE) === null || isJeongseokProtectedPosition(getPosition()) || policy.mode !== JEONGSEOK_ENTRY_MODE.SERVER_GRANT ||
        !policy.acceptServerGrant(snapshot) || !policy.commitEntry()) {
      policy.discardGrant(); syncGateAccess(); stats.refused += 1; return { status: "REFUSED" };
    }
    syncGateAccess();
    stats.protectedEntries += 1;
    return { status: "INNER_ACCESS_GRANTED" };
  }

  function usePortal(portal) {
    const from = rooms.currentSpace;
    if (!layouts[from]?.portals.includes(portal) || !policy.allowsProtectedRoom()) return false;
    const position = getPosition();
    if (!position || flat(position, portal.position) > portal.radius) return false;
    const generation = accountGeneration;
    const isValid = () => generation === accountGeneration && policy.allowsStay();
    let ok = false;
    if (portal.kind === "nested") {
      ok = rooms.enterNested(portal.target, { fromRoomId: from, returnPosition: JEONGSEOK_PUBLIC_RETURN.position,
        returnYaw: JEONGSEOK_PUBLIC_RETURN.yaw, metadata: { jeongseokPortal: portal.id }, isValid });
    } else if (portal.kind === "switch") {
      ok = rooms.switchNested(portal.target, { fromRoomId: from, arrival: portal.arrival,
        returnPosition: JEONGSEOK_PUBLIC_RETURN.position, returnYaw: JEONGSEOK_PUBLIC_RETURN.yaw, isValid });
    }
    if (ok) stats.portalUses += 1;
    else onStatus(JEONGSEOK_TEXT.busy);
    return ok;
  }

  function contextAction({ position, grounded = true, mounted = false } = {}) {
    if (!position || !grounded || rooms.status().busy) return null;
    const space = rooms.currentSpace;
    if (space === CAMPUS_SPACE) {
      if (mounted || !policy.allowsLobby() || !rooms.status().ready) return null;
      const distance = flat(position, entrance.position);
      if (distance > entrance.radius) return null;
      const preview = policy.mode === JEONGSEOK_ENTRY_MODE.VISUAL_PREVIEW;
      return { id: "jeongseok-door", icon: "📚", label: preview ? JEONGSEOK_TEXT.previewDoor : "정석 공개 로비 들어가기",
        priority: ROOM_CONTEXT_PRIORITY, distance, pressed: false, trigger: () => enter({ mounted }).status === "ENTERING" };
    }
    const layout = layouts[space];
    if (!layout || !rooms.status().ready || !policy.allowsProtectedRoom()) return null;
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
    const was = lastSpace; lastSpace = state.space;
    if (event === "enter" && state.space === JEONGSEOK_LOBBY_ROOM_ID && was === CAMPUS_SPACE) stats.entries += 1;
    if (state.space === JEONGSEOK_LOBBY_ROOM_ID && was !== CAMPUS_SPACE && was !== state.space) {
      forcing = false; endSession("RETURNED_TO_PUBLIC");
    }
    if (state.space === CAMPUS_SPACE && isJeongseokRoomId(was)) {
      forcing = false; endSession("LEFT");
      if (scenes?.releaseAll) { scenes.releaseAll(); stats.released += 1; }
    }
    if (!isJeongseokRoomId(state.space)) forcing = false;
  });

  return {
    contextAction, enter, enterFromServerGrant, usePortal, accessPredicate,
    update() {
      syncGateAccess();
      if (!inside() || forcing || rooms.status().busy) return false;
      const position = getPosition();
      if (policy.allowsStay()) {
        if (protectedSpace()) policy.confirmCrossing();
        else if (policy.status().crossed && position?.z < JEONGSEOK_INNER_BOUNDARY_Z - 0.5) endSession("LEFT_INNER_AREA");
        return false;
      }
      return protectedSpace() ? forcePublic(JEONGSEOK_TEXT.revoked) : false;
    },
    revalidate(snapshot) {
      const allowed = !policy.status().session || policy.revalidate(snapshot);
      syncGateAccess();
      if (allowed) return true;
      if (protectedSpace()) forcePublic(JEONGSEOK_TEXT.revoked);
      return false;
    },
    // Background/resume never trusts the old client stay. Re-entry performs a new server read.
    suspend() {
      if (policy.status().session) { endSession("SUSPENDED"); if (protectedSpace()) forcePublic(JEONGSEOK_TEXT.revoked); }
      else syncGateAccess();
    },
    setAccount(accountId) {
      const changed = policy.setAccount(accountId);
      syncGateAccess();
      if (!changed) return false;
      accountGeneration += 1;
      if (protectedSpace()) forcePublic(JEONGSEOK_TEXT.account);
      return true;
    },
    status: () => Object.freeze({ space: rooms.currentSpace, inside: inside(), protected: protectedSpace(), policy: policy.status(), stats: { ...stats },
      accountGeneration, forcing }),
    destroy() { unsubscribe(); }
  };
}
