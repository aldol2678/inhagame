// Engine-free Campus <-> Biryong Realm transition state.
// The world adapter owns scene roots, presence and movement space.
import { WORLD_REGION_ID } from "../regions/world-region-registry.js";
import { validateResumeRecord } from "../lobby/world-resume.js";
import { BIRYONG_STATION_SPAWN } from "./biryong-realm-layout.js";

export const BIRYONG_REGION_TRANSITION_COOLDOWN_MS = 800;

export function createBiryongRealmTransition({
  world,
  campusReturnAnchor,
  clock = { now: () => Date.now() },
  fade = run => run(),
  onBusyChange = () => {},
  onError = () => {}
} = {}) {
  if (!world || !campusReturnAnchor) throw new TypeError("Biryong realm transition dependencies required");

  let regionId = WORLD_REGION_ID.CAMPUS;
  let busy = false;
  let disposed = false;
  let generation = 0;
  let cancelPending = null;
  let cancelResume = null;
  let cooldownUntil = 0;
  const listeners = new Set();
  const stats = { enters: 0, exits: 0 };

  const ready = () => !disposed && !busy && clock.now() >= cooldownUntil;
  const setBusy = next => {
    const value = Boolean(next);
    if (value === busy) return false;
    busy = value;
    onBusyChange(value);
    return true;
  };
  const status = () => Object.freeze({
    regionId,
    inCampus: regionId === WORLD_REGION_ID.CAMPUS,
    inBiryong: regionId === WORLD_REGION_ID.BIRYONG_REALM,
    busy,
    ready: ready(),
    stats: Object.freeze({ ...stats })
  });
  const emit = event => {
    const snapshot = status();
    for (const listener of listeners) {
      try { listener(snapshot, event); } catch { /* observer failure never blocks travel */ }
    }
  };

  // World adapter operations are synchronous. The shared fade can defer the
  // switch and settle asynchronously. Region identity follows the switched frame;
  // success events, counters and input release wait until fade cleanup completes.
  function travel({ target, event, counter, run, isCurrent = () => true, onComplete = null, resumable = false }) {
    const current = ++generation;
    const sourceRegion = regionId;
    let restore = null;
    let touched = false;
    let switched = false;
    let fadeDone = false;
    let started = false;
    let settled = false;
    let failure = null;
    let recoveryError = null;
    let cancelled = false;
    const active = () => !disposed && current === generation;
    const report = (info = {}) => {
      if (cancelled && !recoveryError) return;
      try { onError({ error: failure, recoveryError, recovered: !recoveryError, ...info }); }
      catch { /* feedback cannot strand a recovered player */ }
    };
    const release = () => {
      try { setBusy(false); return null; }
      catch (error) {
        // A focus subscriber can throw after releasing its token. Keep scene
        // ownership committed and reassert SYSTEM_LOCK instead of rolling back.
        busy = true;
        try { onBusyChange(true); } catch { /* remain fail-closed */ }
        return error || new Error("Biryong input release failed");
      }
    };
    const settle = () => {
      if (!active() || settled || !fadeDone || (!switched && !failure)) return;
      if (!failure && !isCurrent()) { cancel(); return; }
      settled = true;
      cancelPending = null;
      cancelResume = null;
      if (failure) {
        if (!recoveryError) recoveryError = release();
        report();
        return;
      }
      regionId = target;
      if (counter) stats[counter] += 1;
      cooldownUntil = clock.now() + BIRYONG_REGION_TRANSITION_COOLDOWN_MS;
      const inputError = release();
      emit(event);
      if (inputError) report({ error: inputError, recoveryError: inputError, recovered: false, phase: "input" });
      else if (isCurrent()) {
        try { onComplete?.(); }
        catch (error) {
          // Scene ownership has committed and observers were notified. A lobby
          // cleanup failure must never roll back that published frame or escape
          // as an unhandled async rejection. Freeze gameplay and require reload.
          busy = true;
          try { onBusyChange(true); } catch { /* remain fail-closed */ }
          const completionError = error || new Error("Resume lobby completion failed");
          report({ error: completionError, recoveryError: completionError, recovered: false, phase: "completion" });
        }
      }
    };
    const fail = error => {
      if (!active() || failure) return;
      failure = error || new Error("Biryong region transition failed");
      regionId = sourceRegion;
      if (touched) {
        try {
          if (!restore) throw new Error("Biryong region rollback unavailable");
          restore();
        } catch (error) { recoveryError = error || new Error("Biryong region restoration failed"); }
      }
      settle();
    };
    const cancel = () => {
      if (!active() || settled) return false;
      cancelled = true;
      fail(new Error("Resume cancelled"));
      return true;
    };
    try { setBusy(true); }
    catch (error) {
      // claim() may have inserted a lock without returning its token. Do not
      // mutate the world or pretend that an unknown input claim was released.
      settled = true;
      report({ error, recoveryError: error || new Error("Biryong input acquisition failed"), recovered: false, phase: "input" });
      return true;
    }
    try {
      restore = world.createCheckpoint?.() ?? null;
      cancelPending = () => { if (touched && !failure) { restore?.(); regionId = sourceRegion; } };
      if (resumable) cancelResume = cancel;
      const result = fade(() => {
        if (!active() || started || failure) return;
        if (!isCurrent()) { cancel(); return; }
        started = true;
        try { touched = true; run(); regionId = target; switched = true; }
        catch (error) { fail(error); }
        settle();
      });
      if (result?.then) {
        Promise.resolve(result).then(() => { fadeDone = true; settle(); }, error => {
          fadeDone = true; fail(error); settle();
        });
      } else { fadeDone = true; settle(); }
    } catch (error) { fadeDone = true; fail(error); settle(); }
    return true;
  }

  function enter() {
    if (regionId !== WORLD_REGION_ID.CAMPUS || !ready()) return false;
    return travel({ target: WORLD_REGION_ID.BIRYONG_REALM, event: "enter", counter: "enters", run: () => {
      world.leaveCampus();
      world.showBiryong();
      world.placePlayer(BIRYONG_STATION_SPAWN, BIRYONG_STATION_SPAWN.yaw);
    } });
  }

  // Resume is a one-session handoff, never a permanent spawn unlock or an F1 reward.
  function resume(raw, { isCurrent = () => true, onComplete = null } = {}) {
    if (regionId !== WORLD_REGION_ID.CAMPUS || !ready() || !isCurrent()) return false;
    const checked = validateResumeRecord(raw, { expectedRegionId: WORLD_REGION_ID.BIRYONG_REALM });
    if (checked.state !== "VALID") return false;
    const record = checked.record;
    return travel({ target: WORLD_REGION_ID.BIRYONG_REALM, event: "resume", resumable: true, isCurrent, onComplete,
      run: () => {
        world.leaveCampus();
        world.showBiryong();
        world.placePlayer(record, record.yawDeg, record.cameraYaw);
      }
    });
  }

  function returnToCampus() {
    if (regionId !== WORLD_REGION_ID.BIRYONG_REALM || !ready()) return false;
    return travel({ target: WORLD_REGION_ID.CAMPUS, event: "exit", counter: "exits", run: () => {
      world.showCampus();
      world.placePlayer(campusReturnAnchor, campusReturnAnchor.yaw ?? 0);
      world.resumeCampus();
    } });
  }

  return {
    enter,
    resume,
    cancelResume: () => cancelResume?.() ?? false,
    returnToCampus,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      try { cancelPending?.(); }
      finally {
        cancelPending = null;
        cancelResume = null;
        world.dispose?.();
        listeners.clear();
        setBusy(false);
      }
    },
    status,
    get regionId() { return regionId; },
    get inCampus() { return regionId === WORLD_REGION_ID.CAMPUS; },
    get inBiryong() { return regionId === WORLD_REGION_ID.BIRYONG_REALM; },
    get busy() { return busy; },
    onChange(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
