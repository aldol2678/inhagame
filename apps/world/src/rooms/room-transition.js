// Campus ⇄ room transitions (Club Room P0). Engine-free: the world adapter does the scene work,
// so Node tests drive this with fakes.
//
// World adapter contract:
//   leaveCampus(room)            end Follow/seat/emote, pause campus online, hide the campus scene
//   showRoom(room)               enable the room scene, its lights, collision and indoor camera
//   showCampus(room)             disable the room scene, restore campus scene, collision, camera
//   resumeCampus()               rejoin campus online for the Place Zone we are now standing in
//   placePlayer(position, yaw)   put the player at an anchor with a clean movement state
//   getPlaceZoneId()             current campus Place Zone (for the return context)
// `fade(run)` wraps the switch in a short visual transition; the default switches at once.

import { CAMPUS_SPACE, RETURN_ANCHORS, ROOMS, ROOM_ENTRANCES, isRoomId } from "./room-registry.js";

// Context Action (#140): NPC 300 > seat 260–280 > Follow stop 200 > room door > mount 100–120.
export const ROOM_CONTEXT_PRIORITY = 150;
// After arriving on either side the door action waits this long (no double-tap bounce).
export const ROOM_TRANSITION_COOLDOWN_MS = 800;

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createRoomTransition({
  world, clock = { now: () => Date.now() }, fade = (run) => run(),
  rooms = ROOMS, entrances = ROOM_ENTRANCES, anchors = RETURN_ANCHORS,
  canEnter = () => true,
  onBusyChange = () => {}
}) {
  let space = CAMPUS_SPACE;
  let busy = false;
  let cooldownUntil = 0;
  let returnContext = null;
  let nestedReturn = null;
  const listeners = new Set();
  const stats = { enters: 0, exits: 0, nestedEnters: 0, nestedExits: 0, directNestedEnters: 0 };

  const setBusy = (next) => {
    const value = Boolean(next);
    if (busy === value) return false;
    busy = value;
    onBusyChange(busy);
    return true;
  };

  const status = () => ({
    space, insideRoom: space !== CAMPUS_SPACE, roomId: space === CAMPUS_SPACE ? null : space, busy,
    returnContext: returnContext ? { ...returnContext } : null,
    ready: ready(),
    parentRoomId: nestedReturn?.roomId ?? null,
    metadata: nestedReturn?.metadata ? { ...nestedReturn.metadata } : null
  });
  const emit = (event) => {
    for (const listener of listeners) {
      try { listener(status(), event); } catch { /* a broken listener never blocks a transition */ }
    }
  };
  const ready = () => !busy && clock.now() >= cooldownUntil;

  function nearestEntrance(position) {
    let best = null;
    for (const entrance of entrances) {
      const distance = flat(position, entrance.position);
      if (distance <= entrance.radius && (!best || distance < best.distance)) best = { entrance, distance };
    }
    return best;
  }

  function enter(roomId, { entranceId = null } = {}) {
    if (space !== CAMPUS_SPACE || !isRoomId(roomId) || !ready()) return false;
    const room = rooms[roomId];
    const entrance = entrances.find((e) => e.id === (entranceId ?? room.entranceId)) ?? null;
    if (!entrance || !canEnter(entrance, room)) return false;
    setBusy(true);
    returnContext = {
      sourceSpace: CAMPUS_SPACE, placeZoneId: world.getPlaceZoneId?.() ?? null,
      entranceId: entrance.id, returnAnchor: entrance.returnAnchor
    };
    fade(() => {
      world.leaveCampus(room);
      world.showRoom(room);
      world.placePlayer(room.spawn.position, room.spawn.yaw);
      space = roomId;
      setBusy(false);
      cooldownUntil = clock.now() + ROOM_TRANSITION_COOLDOWN_MS;
      stats.enters += 1;
      emit("enter");
    });
    return true;
  }

  function enterNested(roomId, {
    fromRoomId = null, returnPosition = null, returnYaw = 0, metadata = null, isValid = () => true
  } = {}) {
    if (space === CAMPUS_SPACE || !isRoomId(roomId) || roomId === space || !ready()) return false;
    if (fromRoomId && fromRoomId !== space) return false;
    if (!returnPosition || !Number.isFinite(returnPosition.x) || !Number.isFinite(returnPosition.z)) return false;
    const room = rooms[roomId];
    setBusy(true);
    nestedReturn = {
      roomId: space,
      position: { ...returnPosition },
      yaw: Number(returnYaw) || 0,
      metadata: metadata && typeof metadata === "object" ? { ...metadata } : null
    };
    fade(() => {
      if (!isValid()) { nestedReturn = null; setBusy(false); return; }
      world.showRoom(room);
      world.placePlayer(room.spawn.position, room.spawn.yaw);
      space = roomId;
      setBusy(false);
      cooldownUntil = clock.now() + ROOM_TRANSITION_COOLDOWN_MS;
      stats.nestedEnters += 1;
      emit("enter-nested");
    });
    return true;
  }

  // Social S1-D2 friend visit from the campus: straight into a nested room whose parent (the Dorm
  // Lobby) is where leaving lands, exactly as if the player had walked in through the lobby. The
  // parent's own entrance supplies the campus return anchor for the lobby's exit afterwards.
  function enterNestedFromCampus(roomId, {
    parentRoomId = null, returnPosition = null, returnYaw = 0, metadata = null, isValid = () => true
  } = {}) {
    if (space !== CAMPUS_SPACE || !isRoomId(roomId) || !isRoomId(parentRoomId) || roomId === parentRoomId || !ready()) return false;
    if (!returnPosition || !Number.isFinite(returnPosition.x) || !Number.isFinite(returnPosition.z)) return false;
    const room = rooms[roomId];
    const entrance = entrances.find((e) => e.id === rooms[parentRoomId].entranceId) ?? null;
    if (!entrance || !anchors[entrance.returnAnchor]) return false;
    setBusy(true);
    returnContext = {
      sourceSpace: CAMPUS_SPACE, placeZoneId: world.getPlaceZoneId?.() ?? null,
      entranceId: entrance.id, returnAnchor: entrance.returnAnchor
    };
    nestedReturn = {
      roomId: parentRoomId,
      position: { ...returnPosition },
      yaw: Number(returnYaw) || 0,
      metadata: metadata && typeof metadata === "object" ? { ...metadata } : null
    };
    fade(() => {
      if (!isValid()) { returnContext = null; nestedReturn = null; setBusy(false); return; }
      world.leaveCampus(room);
      world.showRoom(room);
      world.placePlayer(room.spawn.position, room.spawn.yaw);
      space = roomId;
      setBusy(false);
      cooldownUntil = clock.now() + ROOM_TRANSITION_COOLDOWN_MS;
      stats.directNestedEnters += 1;
      emit("enter-nested");
    });
    return true;
  }

  function exit({ force = false } = {}) {
    if (space === CAMPUS_SPACE || (!force && !ready())) return false;
    const room = rooms[space];

    if (nestedReturn) {
      const parent = rooms[nestedReturn.roomId];
      if (!parent) return false;
      const target = nestedReturn;
      setBusy(true);
      fade(() => {
        world.showRoom(parent);
        world.placePlayer(target.position, target.yaw);
        space = parent.id;
        nestedReturn = null;
        setBusy(false);
        cooldownUntil = clock.now() + ROOM_TRANSITION_COOLDOWN_MS;
        stats.nestedExits += 1;
        emit("exit-nested");
      });
      return true;
    }

    const anchor = anchors[returnContext?.returnAnchor] ?? anchors[entrances.find((e) => e.id === room.entranceId)?.returnAnchor];
    if (!anchor) return false;
    setBusy(true);
    fade(() => {
      world.showCampus(room);
      world.placePlayer(anchor.position, anchor.yaw);
      space = CAMPUS_SPACE;
      world.resumeCampus();
      setBusy(false);
      cooldownUntil = clock.now() + ROOM_TRANSITION_COOLDOWN_MS;
      stats.exits += 1;
      emit("exit");
    });
    return true;
  }

  // The door action for the shared Context Action slot, or null.
  function contextAction({ position, grounded = true, mounted = false }) {
    if (!ready() || !position) return null;
    if (space === CAMPUS_SPACE) {
      if (mounted || !grounded) return null;
      const near = nearestEntrance(position);
      if (!near) return null;
      const room = rooms[near.entrance.roomId];
      if (!canEnter(near.entrance, room)) return null;
      return { id: "room-door", icon: "🚪", label: room.enterLabel ?? `${room.label} 들어가기`, priority: ROOM_CONTEXT_PRIORITY,
        distance: near.distance, pressed: false, trigger: () => enter(room.id, { entranceId: near.entrance.id }) };
    }
    const room = rooms[space];
    if (!grounded) return null;
    const distance = flat(position, room.exit.position);
    if (distance > room.exit.radius) return null;
    return { id: "room-door", icon: "🚪", label: room.exitLabel ?? "나가기", priority: ROOM_CONTEXT_PRIORITY,
      distance, pressed: false, trigger: () => exit() };
  }

  return {
    enter,
    enterNested,
    enterNestedFromCampus,
    exit,
    contextAction,
    status,
    get currentSpace() { return space; },
    get insideRoom() { return space !== CAMPUS_SPACE; },
    get room() { return space === CAMPUS_SPACE ? null : rooms[space]; },
    get stats() { return { ...stats }; },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

