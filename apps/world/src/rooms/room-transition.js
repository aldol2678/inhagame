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
//   createCheckpoint()           return a rollback closure for scene/player/presence state
// `fade(run)` may return a Promise and must await run() before completing its cleanup.
// Public actions still return a boolean acceptance result; only onChange signals success.

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
  onBusyChange = () => {}, onError = () => {}
}) {
  let space = CAMPUS_SPACE;
  let busy = false;
  let cooldownUntil = 0;
  let returnContext = null;
  let nestedReturn = null;
  let forcedExitFrom = null;
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

  // Keep synchronous adapters synchronous, but never advance past an unfinished async step.
  const sequence = (steps, index = 0) => {
    for (let i = index; i < steps.length; i += 1) {
      const result = steps[i]();
      if (result?.then) return Promise.resolve(result).then(() => sequence(steps, i + 1));
    }
  };
  const cancelled = Symbol("room transition cancelled");

  const drainForcedExit = () => {
    const source = forcedExitFrom;
    forcedExitFrom = null;
    if (source === space && !busy) exit({ force: true });
  };

  function transition({ roomId, steps, commit, event, counter, isValid = () => true, prepare = () => {}, requireDeparture = false }) {
    const fromSpace = space;
    let restore = null;
    let touchedWorld = false;
    let started = false;
    let pending = false;
    let switchDone = false;
    let fadeDone = false;
    let failure = null;
    let recovering = false;
    let recoveryDone = false;
    let recoveryError = null;
    let settled = false;

    const report = info => {
      try { onError({ fromSpace, roomId, ...info }); }
      catch { /* feedback failure cannot strand a recovered player */ }
    };
    const release = () => {
      try { setBusy(false); return null; }
      catch (error) {
        // A focus subscriber may throw after releasing its claim. Reassert SYSTEM_LOCK without
        // rolling a committed scene back, then require a reload because input state is uncertain.
        busy = true;
        try { onBusyChange(true); } catch { /* remain fail-closed */ }
        return error;
      }
    };
    const finish = () => {
      if (settled || !fadeDone || (failure ? !recoveryDone : !switchDone)) return;
      if (!failure) {
        try { if (!isValid()) { fail(cancelled); return; } }
        catch (error) { fail(error); return; }
      }
      settled = true;
      if (failure) {
        // Forced exits follow lost access/identity. A restored private source is no longer an
        // authorized playable fallback, so keep it locked instead of reopening that room.
        if (requireDeparture) recoveryError ??= new Error("Required room departure failed");
        if (!recoveryError) recoveryError = release();
        // A failed rollback must remain locked: never enable movement in a half-switched scene.
        if (failure !== cancelled || recoveryError) {
          report({ error: failure, recoveryError, recovered: !recoveryError });
        }
        if (!recoveryError) drainForcedExit();
        return;
      }
      commit();
      cooldownUntil = clock.now() + ROOM_TRANSITION_COOLDOWN_MS;
      stats[counter] += 1;
      const inputError = release();
      emit(event);
      if (inputError) report({ error: inputError, recoveryError: inputError, recovered: false, phase: "input" });
      else drainForcedExit();
    };
    const recover = () => {
      if (recovering) return;
      recovering = true;
      const done = error => { recoveryError = error ?? null; recoveryDone = true; finish(); };
      try {
        if (touchedWorld && !restore) throw new Error("Room transition rollback unavailable");
        const result = touchedWorld ? restore() : undefined;
        if (result?.then) return Promise.resolve(result).then(() => done(), error => done(error || new Error("Room restoration rejected")));
        done();
      } catch (error) { done(error || new Error("Room restoration failed")); }
    };
    const fail = error => {
      failure ??= error || new Error("Room transition failed");
      // A fade can reject while a world step is in flight. Wait for it to settle before restoring;
      // each subsequent step sees failure and cannot write over the restored scene later.
      if (!pending) return recover();
    };
    const run = () => {
      if (started || failure || settled) return;
      started = true;
      try {
        const result = sequence(steps.map(step => () => {
          if (failure) throw failure;
          if (!isValid()) throw cancelled;
          touchedWorld = true;
          return step();
        }));
        const complete = () => {
          pending = false;
          if (failure) return recover();
          if (!isValid()) return fail(cancelled);
          switchDone = true;
          finish();
        };
        if (result?.then) {
          pending = true;
          return Promise.resolve(result).then(complete, error => { pending = false; return fail(error); });
        }
        return complete();
      } catch (error) { return fail(error); }
    };
    try { setBusy(true); }
    catch (error) {
      // claim() may have inserted a lock before a subscriber threw, without returning its token.
      // Its ownership is unknown: do not start world work or claim that an unlock succeeded.
      settled = true;
      report({ error, recoveryError: error, recovered: false, phase: "input" });
      return true;
    }
    try {
      restore = world.createCheckpoint?.() ?? null;
      prepare();
      const result = fade(run);
      if (result?.then) {
        void Promise.resolve(result).then(
          () => { fadeDone = true; finish(); },
          error => { fadeDone = true; return fail(error); }
        );
      } else { fadeDone = true; finish(); }
    } catch (error) { fadeDone = true; fail(error); }
    return true;
  }

  const campusContext = entrance => ({
    sourceSpace: CAMPUS_SPACE, placeZoneId: world.getPlaceZoneId?.() ?? null,
    entranceId: entrance.id, returnAnchor: entrance.returnAnchor
  });
  const nestedContext = (roomId, position, yaw, metadata) => ({
    roomId, position: { ...position }, yaw: Number(yaw) || 0,
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : null
  });

  function enter(roomId, { entranceId = null } = {}) {
    if (space !== CAMPUS_SPACE || !isRoomId(roomId) || !ready()) return false;
    const room = rooms[roomId];
    const entrance = entrances.find((e) => e.id === (entranceId ?? room.entranceId)) ?? null;
    if (!entrance || !canEnter(entrance, room)) return false;
    let context;
    return transition({ roomId, event: "enter", counter: "enters",
      prepare: () => { context = campusContext(entrance); },
      steps: [() => world.leaveCampus(room), () => world.showRoom(room),
        () => world.placePlayer(room.spawn.position, room.spawn.yaw)],
      commit: () => { returnContext = context; space = roomId; }
    });
  }

  function enterNested(roomId, {
    fromRoomId = null, returnPosition = null, returnYaw = 0, metadata = null, isValid = () => true
  } = {}) {
    if (space === CAMPUS_SPACE || !isRoomId(roomId) || roomId === space || !ready()) return false;
    if (fromRoomId && fromRoomId !== space) return false;
    if (!returnPosition || !Number.isFinite(returnPosition.x) || !Number.isFinite(returnPosition.z)) return false;
    const room = rooms[roomId];
    const target = nestedContext(space, returnPosition, returnYaw, metadata);
    return transition({ roomId, event: "enter-nested", counter: "nestedEnters", isValid,
      steps: [() => world.showRoom(room), () => world.placePlayer(room.spawn.position, room.spawn.yaw)],
      commit: () => { nestedReturn = target; space = roomId; }
    });
  }

  // A direct friend visit still returns through the Dorm Lobby, then its campus entrance.
  function enterNestedFromCampus(roomId, {
    parentRoomId = null, returnPosition = null, returnYaw = 0, metadata = null, isValid = () => true
  } = {}) {
    if (space !== CAMPUS_SPACE || !isRoomId(roomId) || !isRoomId(parentRoomId) || roomId === parentRoomId || !ready()) return false;
    if (!returnPosition || !Number.isFinite(returnPosition.x) || !Number.isFinite(returnPosition.z)) return false;
    const room = rooms[roomId];
    const entrance = entrances.find((e) => e.id === rooms[parentRoomId].entranceId) ?? null;
    if (!entrance || !anchors[entrance.returnAnchor]) return false;
    let context;
    const target = nestedContext(parentRoomId, returnPosition, returnYaw, metadata);
    return transition({ roomId, event: "enter-nested", counter: "directNestedEnters", isValid,
      prepare: () => { context = campusContext(entrance); },
      steps: [() => world.leaveCampus(room), () => world.showRoom(room),
        () => world.placePlayer(room.spawn.position, room.spawn.yaw)],
      commit: () => { returnContext = context; nestedReturn = target; space = roomId; }
    });
  }

  function exit({ force = false } = {}) {
    // Forced access-loss exits bypass only cooldown, never an in-flight switch or recovery.
    if (space === CAMPUS_SPACE) return false;
    if (busy) {
      if (force) forcedExitFrom = space;
      return false;
    }
    if (!force && !ready()) return false;
    const room = rooms[space];
    if (nestedReturn) {
      const parent = rooms[nestedReturn.roomId];
      if (!parent) return false;
      const target = nestedReturn;
      return transition({ roomId: parent.id, event: "exit-nested", counter: "nestedExits", requireDeparture: force,
        steps: [() => world.showRoom(parent), () => world.placePlayer(target.position, target.yaw)],
        commit: () => { space = parent.id; nestedReturn = null; }
      });
    }
    const anchor = anchors[returnContext?.returnAnchor] ?? anchors[entrances.find((e) => e.id === room.entranceId)?.returnAnchor];
    if (!anchor) return false;
    return transition({ roomId: CAMPUS_SPACE, event: "exit", counter: "exits", requireDeparture: force,
      steps: [() => world.showCampus(room), () => world.placePlayer(anchor.position, anchor.yaw), () => world.resumeCampus()],
      commit: () => { space = CAMPUS_SPACE; }
    });
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

