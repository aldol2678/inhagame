import { MAIN2_QUEST_ID, MAIN2_QUEST_OBJECTIVES } from './main2-quest-contract.mjs';
import { MAIN2_GUIDE_NPC } from './main2-guide-contract.mjs';
import { BACK_GATE_SPAWN } from '../src/campus-spawn.js';
import { FIVE_SOUTH_ENTRY_APPROACH } from '../src/north-campus-layout.js';
import { isQuestRewardResult } from './quest-reward-shape.mjs';

const BUILDING_5_POI = 'poi.building-5';
const BACK_GATE_POI = 'poi.back-gate';
const targetId = poiId => `poi:${poiId}`;

// onReward(reward): P1d. Called once with the server Reward result carried by the call that completed
// Main 2, only while the same account is still signed in. The client never computes coins or EXP.
export function createMain2QuestClient({ enabled, endpoint, getSession, hud, fetcher = fetch, onReward = () => {} }) {
  let signedIn = false, stage = 0, available = false, pending = null, generation = 0, retryAfter = 0;
  let deferredAutoMoveDestinationId = null, refreshDeferred = false, statusReady = false;
  const listeners = new Set();
  const objective = hud?.querySelector?.('#main2-quest-objective');

  function publish() {
    const visible = enabled && signedIn && statusReady && available && stage >= 0 && stage < 9;
    if (hud) hud.hidden = !visible;
    if (objective && visible) objective.textContent = MAIN2_QUEST_OBJECTIVES[stage];
    for (const listener of listeners) listener(status());
  }

  function status() {
    return Object.freeze({
      questId: MAIN2_QUEST_ID,
      enabled: Boolean(enabled),
      signedIn,
      ready: statusReady,
      available: Boolean(available),
      stage,
      active: Boolean(enabled && signedIn && statusReady && available && stage > 0 && stage < 9),
      complete: stage === 9,
      objective: MAIN2_QUEST_OBJECTIVES[stage] ?? null
    });
  }

  async function send(event) {
    if (!enabled || !signedIn || pending) return null;
    const claim = {};
    pending = claim;
    const requestGeneration = generation;
    try {
      const token = await getSession();
      if (!token || requestGeneration !== generation) return null;
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ quest_id: MAIN2_QUEST_ID, event })
      });
      if (!response.ok) throw Error('QUEST_UNAVAILABLE');
      const result = await response.json();
      if (result?.quest_id !== MAIN2_QUEST_ID || !Number.isInteger(result.stage) ||
          result.stage < 0 || result.stage > 9 || typeof result.available !== 'boolean')
        throw Error('QUEST_UNAVAILABLE');
      const reward = result.reward ?? null;
      if (reward !== null && !(event === 'visit_back_gate' && result.stage === 9 && isQuestRewardResult(reward)))
        throw Error('QUEST_UNAVAILABLE');
      if (requestGeneration !== generation) return null;
      stage = result.stage;
      available = result.available;
      statusReady = true;
      retryAfter = 0;
      publish();
      if (reward) {
        try { onReward(reward); } catch { /* presentation only; progress already stored */ }
      }
      return result;
    } finally {
      if (pending === claim) pending = null;
      if (refreshDeferred && !pending) {
        refreshDeferred = false;
        void send('status').catch(() => {});
      }
      flushDeferredAutoMove();
    }
  }

  function flushDeferredAutoMove() {
    const id = deferredAutoMoveDestinationId;
    if (!id || pending) return false;
    if (stage === 2 && id === targetId(BUILDING_5_POI)) {
      deferredAutoMoveDestinationId = null;
      return advanceObserved('start_auto_building5');
    }
    if (stage === 7 && id === targetId(BACK_GATE_POI)) {
      deferredAutoMoveDestinationId = null;
      return advanceObserved('start_auto_back_gate');
    }
    return false;
  }

  function advanceObserved(event) {
    if (pending || Date.now() < retryAfter) return false;
    retryAfter = Date.now() + 1200;
    void send(event).catch(() => {});
    return true;
  }

  return Object.freeze({
    get stage() { return stage; },
    status,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh() {
      if (!enabled || !signedIn) return Promise.resolve(null);
      if (pending) { refreshDeferred = true; return Promise.resolve(null); }
      return send('status');
    },
    startFromGuide() {
      if (!enabled || !signedIn || !available || stage !== 0) return Promise.resolve(null);
      return send('start');
    },
    setSignedIn(value) {
      generation += 1;
      pending = null;
      signedIn = Boolean(value);
      stage = 0;
      available = false;
      statusReady = false;
      deferredAutoMoveDestinationId = null;
      refreshDeferred = false;
      publish();
      return signedIn ? send('status').catch(() => null) : Promise.resolve(null);
    },
    mapTarget() {
      if (!enabled || !signedIn || !available || stage >= 9) return null;
      if (stage === 0) return Object.freeze({
        x: MAIN2_GUIDE_NPC.position.x, z: MAIN2_GUIDE_NPC.position.z,
        kind: 'quest-npc', stage, label: MAIN2_GUIDE_NPC.name + '과 대화'
      });
      if (stage <= 5) return Object.freeze({
        x: FIVE_SOUTH_ENTRY_APPROACH.x, z: FIVE_SOUTH_ENTRY_APPROACH.z, kind: 'destination', stage,
        label: MAIN2_QUEST_OBJECTIVES[stage]
      });
      return Object.freeze({
        x: BACK_GATE_SPAWN.x, z: BACK_GATE_SPAWN.z, kind: 'destination', stage,
        label: MAIN2_QUEST_OBJECTIVES[stage]
      });
    },
    observePlace(placeId, position) {
      if (!available || !position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return false;
      if (stage === 5 && placeId === 'AREA_BUILDING_5_WEST' &&
          Math.hypot(position.x - FIVE_SOUTH_ENTRY_APPROACH.x, position.z - FIVE_SOUTH_ENTRY_APPROACH.z) <= 18)
        return advanceObserved('visit_building5');
      if (stage === 8 && placeId === 'AREA_BACK_GATE' &&
          Math.hypot(position.x - BACK_GATE_SPAWN.x, position.z - BACK_GATE_SPAWN.z) <= 28)
        return advanceObserved('visit_back_gate');
      return false;
    },
    observeNavigation(snapshot) {
      const poiId = snapshot?.destination?.poiId;
      if (stage === 1 && snapshot?.active && poiId === BUILDING_5_POI)
        return advanceObserved('set_building5_destination');
      if (stage === 6 && snapshot?.active && poiId === BACK_GATE_POI)
        return advanceObserved('set_back_gate_destination');
      return false;
    },
    observeAutoMove(state, event) {
      const id = state?.destinationId;
      if (!id) return false;
      if (event === 'pause' && stage === 3 && id === targetId(BUILDING_5_POI))
        return advanceObserved('pause_auto_building5');
      if (event === 'resume' && stage === 4 && id === targetId(BUILDING_5_POI))
        return advanceObserved('resume_auto_building5');
      // Main 2 progress persists across reloads, while Auto Move session state does not. If stage 4
      // survives a reconnect, starting the same Building 5 route is the recoverable form of resume.
      if (event === 'ready' && state?.active && stage === 4 && id === targetId(BUILDING_5_POI))
        return advanceObserved('resume_auto_building5');
      if (event !== 'ready' || !state?.active) return false;
      if ((stage === 1 || stage === 2) && id === targetId(BUILDING_5_POI)) {
        if (stage === 1 || pending) {
          deferredAutoMoveDestinationId = id;
          return true;
        }
        return advanceObserved('start_auto_building5');
      }
      if ((stage === 6 || stage === 7) && id === targetId(BACK_GATE_POI)) {
        if (stage === 6 || pending) {
          deferredAutoMoveDestinationId = id;
          return true;
        }
        return advanceObserved('start_auto_back_gate');
      }
      return false;
    }
  });
}

