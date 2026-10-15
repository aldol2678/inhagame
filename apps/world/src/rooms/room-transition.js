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
// A room with a string `access` other than "open"/"closed" is entered only when `accessPolicies`
// has a predicate for that key and it returns true (fail closed when the policy is missing).
// Public actions still return a boolean acceptance result; only onChange signals success.

import { CAMPUS_SPACE, RETURN_ANCHORS, ROOMS, ROOM_ENTRANCES, isRoomId } from "./room-registry.js";

// Context Action (#140): NPC 300 > seat 260–280 > Follow stop 200 > room door > mount 100–120.
export const ROOM_CONTEXT_PRIORITY = 150;
// After arriving on either side the door action waits this long (no double-tap bounce).
export const ROOM_TRANSITION_COOLDOWN_MS = 800;
// Safety deadlines, not asset performance acceptance targets. Layout work keeps
// its old 15-second bound. Visuals allow bounded processing after byte transfer.
export const ROOM_PREPARATION_STAGE_TIMEOUT_MS = 15000;
export const ROOM_PREPARATION_VISUAL_INACTIVITY_MS = 45000;
export const ROOM_PREPARATION_OVERALL_TIMEOUT_MS = 210000;

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createRoomTransition({
  world, clock = { now: () => Date.now() }, fade = (run) => run(),
  rooms = ROOMS, entrances = ROOM_ENTRANCES, anchors = RETURN_ANCHORS,
  canEnter = () => true, accessPolicies = {},
  onBusyChange = () => {}, onError = () => {},
  prepareRoom = null, onPreparationChange = () => {}, preparationTimeoutMs = ROOM_PREPARATION_STAGE_TIMEOUT_MS,
  preparationVisualTimeoutMs = ROOM_PREPARATION_VISUAL_INACTIVITY_MS,
  preparationOverallTimeoutMs = ROOM_PREPARATION_OVERALL_TIMEOUT_MS,
  setTimer = setTimeout, clearTimer = clearTimeout
}) {
  let space = CAMPUS_SPACE;
  let busy = false;
  let cooldownUntil = 0;
  let returnContext = null;
  let nestedReturn = null;
  let forcedExitFrom = null;
  let cancelPending = null;
  let preparationPending = false;
  const listeners = new Set();
  const stats = { enters: 0, exits: 0, nestedEnters: 0, nestedExits: 0, directNestedEnters: 0, nestedSwitches: 0 };
  const accessAllowed = (entrance, room) => {
    if (!room || room.access === "closed") return false;
    if (typeof room.access === "string" && room.access !== "open") {
      const policy = accessPolicies[room.access];
      if (typeof policy !== "function") return false;
      try { return policy(entrance, room) === true; } catch { return false; }
    }
    return true;
  };

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
    if (source?.space === space && !busy) exit({ force: true, toCampus: source.toCampus });
  };

  function transition({ roomId, steps, commit, event, counter, isValid = () => true, prepare = () => {}, requireDeparture = false, metadata = null }) {
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
    const controller = new AbortController();
    let preparationTimer = null;
    let lease = null;
    let preparing = false;
    let preparationStage = null;
    let deadlineGeneration = 0;
    let preparationOverallAt = null;
    const receivedBytes = new Map();
    const notifyPreparation = state => {
      try { onPreparationChange(state); } catch { /* feedback cannot block recovery */ }
    };
    const stopPreparation = committed => {
      clearTimer(preparationTimer);
      deadlineGeneration++;
      preparationTimer = null;
      if (!committed) {
        try { controller.abort(); lease?.cancel?.(); }
        catch (error) { recoveryError ??= error; }
      }
      if (preparing) notifyPreparation({ active: false, committed });
      preparing = false;
      preparationPending = false;
      cancelPending = null;
    };

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
      if (!failure) {
        try { lease?.commit?.(); }
        catch (error) { fail(error); return; }
      }
      settled = true;
      stopPreparation(!failure);
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
      const done = error => { recoveryError ??= error ?? null; recoveryDone = true; finish(); };
      try {
        if (touchedWorld && !restore) throw new Error("Room transition rollback unavailable");
        const result = touchedWorld ? restore() : undefined;
        if (result?.then) return Promise.resolve(result).then(() => done(), error => done(error || new Error("Room restoration rejected")));
        done();
      } catch (error) { done(error || new Error("Room restoration failed")); }
    };
    const fail = error => {
      failure ??= error || new Error("Room transition failed");
      controller.abort();
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
    const armPreparationDeadline = () => {
      clearTimer(preparationTimer);
      preparationOverallAt ??= clock.now() + preparationOverallTimeoutMs;
      const inactivityMs = preparationStage === 'visuals' ? preparationVisualTimeoutMs : preparationTimeoutMs;
      const generation = ++deadlineGeneration;
      preparationTimer = setTimer(() => {
        if (settled || !preparationPending || generation !== deadlineGeneration) return;
        fadeDone = true;
        fail(new Error(clock.now() >= preparationOverallAt ? 'Room preparation overall timed out' : 'Room preparation stage timed out'));
      }, Math.max(0, Math.min(inactivityMs, preparationOverallAt - clock.now())));
    };
    const beginSwitch = () => {
      preparationPending = false;
      if (settled || failure) return;
      if (!isValid()) { fadeDone = true; fail(cancelled); return; }
      restore = world.createCheckpoint?.() ?? null;
      prepare();
      const result = fade(run, { roomId, prepared: preparing });
      if (result?.then) {
        void Promise.resolve(result).then(
          () => { fadeDone = true; finish(); },
          error => { fadeDone = true; return fail(error); }
        );
      } else { fadeDone = true; finish(); }
    };
    cancelPending = () => {
      if (settled) return false;
      // Preparation never mutates the active world. It can release immediately, even when
      // network/engine callbacks ignore abort; their generation guard owns late cleanup.
      if (!started) fadeDone = true;
      fail(cancelled);
      return true;
    };
    try {
      const preparation = prepareRoom?.({ roomId, metadata, signal: controller.signal,
        isValid: () => !controller.signal.aborted && isValid(),
        onCleanupError: error => { recoveryError ??= error; },
        onProgress: progress => {
          if (settled || controller.signal.aborted || preparationStage !== 'visuals') return;
          const { sourceKey, loadedBytes, totalBytes } = progress ?? {};
          if (typeof sourceKey !== 'string' || !sourceKey || !Number.isSafeInteger(loadedBytes)
            || !Number.isSafeInteger(totalBytes) || totalBytes <= 0 || loadedBytes < 0 || loadedBytes > totalBytes) return;
          const previous = receivedBytes.get(sourceKey);
          if (previous && (totalBytes !== previous.totalBytes || loadedBytes <= previous.loadedBytes)) return;
          receivedBytes.set(sourceKey, { loadedBytes, totalBytes });
          if (loadedBytes > (previous?.loadedBytes ?? 0) && preparationPending) armPreparationDeadline();
          const values = [...receivedBytes.values()];
          notifyPreparation({ active: true, text: 'visuals', progress: {
            loadedBytes: values.reduce((sum, value) => sum + value.loadedBytes, 0),
            totalBytes: values.reduce((sum, value) => sum + value.totalBytes, 0)
          } });
        },
        stage: text => {
          if (settled || controller.signal.aborted) return;
          const changed = text !== preparationStage;
          preparationStage = text;
          if (preparing && changed) armPreparationDeadline();
          notifyPreparation({ active: true, text });
        }
      });
      if (preparation?.then) {
        preparing = true;
        preparationPending = true;
        notifyPreparation({ active: true });
        armPreparationDeadline();
        void Promise.resolve(preparation).then(value => {
          if (settled || failure) {
            try { value?.cancel?.(); } catch (error) { report({ error, recoveryError: error, recovered: false, phase: "cleanup" }); }
            return;
          }
          lease = value;
          clearTimer(preparationTimer);
          preparationTimer = null;
          try { beginSwitch(); } catch (error) { fadeDone = true; fail(error); }
        }, error => { if (!settled) { fadeDone = true; fail(error); } });
      } else { lease = preparation; beginSwitch(); }
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

  function enter(roomId, { entranceId = null, isValid = () => true } = {}) {
    if (space !== CAMPUS_SPACE || !isRoomId(roomId) || !ready()) return false;
    const room = rooms[roomId];
    const entrance = entrances.find((e) => e.id === (entranceId ?? room.entranceId)) ?? null;
    if (!entrance || !accessAllowed(entrance, room) || !canEnter(entrance, room)) return false;
    let context;
    return transition({ roomId, event: "enter", counter: "enters", isValid,
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
    if (!accessAllowed(null, room)) return false;
    const target = nestedContext(space, returnPosition, returnYaw, metadata);
    return transition({ roomId, event: "enter-nested", counter: "nestedEnters", isValid, metadata,
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
    if (!accessAllowed(null, room) || !accessAllowed(null, rooms[parentRoomId])) return false;
    const entrance = entrances.find((e) => e.id === rooms[parentRoomId].entranceId) ?? null;
    if (!entrance || !anchors[entrance.returnAnchor]) return false;
    let context;
    const target = nestedContext(parentRoomId, returnPosition, returnYaw, metadata);
    return transition({ roomId, event: "enter-nested", counter: "directNestedEnters", isValid, metadata,
      prepare: () => { context = campusContext(entrance); },
      steps: [() => world.leaveCampus(room), () => world.showRoom(room),
        () => world.placePlayer(room.spawn.position, room.spawn.yaw)],
      commit: () => { returnContext = context; nestedReturn = target; space = roomId; }
    });
  }

  // Move between two rooms that share the same parent (e.g. two B1 spaces under one lobby). The
  // parent return target survives; `returnPosition` may retarget it to the new room's doorway.
  function switchNested(roomId, {
    fromRoomId = null, arrival = null, returnPosition = null, returnYaw = null, isValid = () => true
  } = {}) {
    if (space === CAMPUS_SPACE || !nestedReturn || !isRoomId(roomId) || roomId === space || roomId === nestedReturn.roomId || !ready()) return false;
    if (fromRoomId && fromRoomId !== space) return false;
    const room = rooms[roomId];
    if (!accessAllowed(null, room)) return false;
    const spawn = arrival ?? room.spawn;
    if (!spawn?.position || !Number.isFinite(spawn.position.x) || !Number.isFinite(spawn.position.z)) return false;
    if (returnPosition && (!Number.isFinite(returnPosition.x) || !Number.isFinite(returnPosition.z))) return false;
    const target = returnPosition
      ? nestedContext(nestedReturn.roomId, returnPosition, returnYaw ?? nestedReturn.yaw, nestedReturn.metadata)
      : nestedReturn;
    return transition({ roomId, event: "switch-nested", counter: "nestedSwitches", isValid,
      steps: [() => world.showRoom(room), () => world.placePlayer(spawn.position, spawn.yaw ?? 0)],
      commit: () => { nestedReturn = target; space = roomId; }
    });
  }

  // `toCampus` (forced exits only need it) leaves a nested room straight to the campus return
  // anchor of the outermost room instead of stopping in the parent room.
  function exit({ force = false, toCampus = false } = {}) {
    // Forced access-loss exits bypass only cooldown, never an in-flight switch or recovery.
    if (busy && preparationPending && cancelPending) {
      if (force && space !== CAMPUS_SPACE) forcedExitFrom = { space, toCampus: toCampus || forcedExitFrom?.toCampus === true };
      cancelPending();
      return false;
    }
    if (space === CAMPUS_SPACE) return false;
    if (busy) {
      if (force) forcedExitFrom = { space, toCampus: toCampus || forcedExitFrom?.toCampus === true };
      return false;
    }
    if (!force && !ready()) return false;
    const room = rooms[space];
    if (nestedReturn && !(toCampus && returnContext)) {
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
      commit: () => { space = CAMPUS_SPACE; nestedReturn = null; }
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
      if (!accessAllowed(near.entrance, room) || !canEnter(near.entrance, room)) return null;
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
    cancelPending: () => cancelPending?.() ?? false,
    enter,
    enterNested,
    enterNestedFromCampus,
    switchNested,
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

