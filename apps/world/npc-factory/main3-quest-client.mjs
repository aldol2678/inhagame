import { MAIN3_QUEST_ID, MAIN3_QUEST_OBJECTIVES } from './main3-quest-contract.mjs';
import { MAIN2_GUIDE_NPC } from './main2-guide-contract.mjs';
import { STUDENT_CENTER_SHOP_ENTRY } from '../src/shop/shop-world-interaction.js';

// Only the server response owns progress. Entry observes the existing world interaction, never a
// menu-open or purchase toast. Purchase/loadout/reward reconciliation is deliberately a later slice.
export function createMain3QuestClient({
  enabled, endpoint, getSession, fetcher = fetch,
  setTimer = setTimeout, clearTimer = clearTimeout, statusRetryDelays = [1000, 3000, 8000]
}) {
  let signedIn = false, stage = 0, available = false, ready = false, generation = 0;
  let pending = null, retryTimer = null, retryAttempt = 0;
  const listeners = new Set();
  const status = () => Object.freeze({
    questId: MAIN3_QUEST_ID, enabled: Boolean(enabled), signedIn, stage, available, ready,
    active: Boolean(enabled && signedIn && ready && available && stage > 0 && stage < 4),
    complete: ready && stage === 4,
    objective: ready ? MAIN3_QUEST_OBJECTIVES[stage] : null,
    statusState: !signedIn ? 'SIGNED_OUT' : ready ? 'READY' : retryTimer !== null ? 'RETRY' : 'UNAVAILABLE'
  });
  const publish = () => { for (const listener of listeners) listener(status()); };
  function cancelRetry() {
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
  }
  function scheduleRetry(scope) {
    const delay = statusRetryDelays[retryAttempt];
    if (retryTimer !== null || !Number.isFinite(delay) || delay < 0) return;
    retryAttempt++;
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (scope === generation && signedIn && enabled) void send('status').catch(() => {});
    }, delay);
  }
  function send(event) {
    if (!enabled || !signedIn) return Promise.resolve(null);
    if (pending) return pending.event === event ? pending.promise : Promise.resolve(null);
    const scope = generation;
    const claim = { event, promise: null };
    pending = claim;
    claim.promise = (async () => {
      try {
        const token = await getSession();
        if (scope !== generation) return null;
        if (!token) throw Error('QUEST_UNAVAILABLE');
        const response = await fetcher(endpoint, {
          method: 'POST', signal: AbortSignal.timeout(8000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ quest_id: MAIN3_QUEST_ID, event })
        });
        if (!response.ok) throw Error('QUEST_UNAVAILABLE');
        const result = await response.json();
        if (scope !== generation) return null;
        if (result?.quest_id !== MAIN3_QUEST_ID || !Number.isInteger(result.stage) ||
            result.stage < 0 || result.stage > 4 || typeof result.available !== 'boolean' || result.reward != null)
          throw Error('QUEST_UNAVAILABLE');
        stage = result.stage;
        available = result.available;
        ready = true;
        cancelRetry(); retryAttempt = 0;
        publish();
        return result;
      } catch (error) {
        if (scope !== generation) return null;
        if (event === 'status') {
          ready = false; available = false;
          scheduleRetry(scope);
          publish();
        }
        throw error;
      } finally {
        if (pending === claim) pending = null;
      }
    })();
    return claim.promise;
  }
  async function refresh() {
    const scope = generation;
    while (pending) {
      await pending.promise.catch(() => null);
      if (scope !== generation) return null;
    }
    return send('status');
  }
  function setSignedIn(value) {
    generation++;
    cancelRetry(); retryAttempt = 0;
    pending = null;
    signedIn = Boolean(value); stage = 0; available = false; ready = false;
    publish();
    return signedIn ? send('status').catch(() => null) : Promise.resolve(null);
  }
  return Object.freeze({
    get stage() { return stage; }, status, refresh, setSignedIn,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setEnabled(value) {
      if (Boolean(enabled) === Boolean(value)) return Promise.resolve(null);
      enabled = Boolean(value);
      return setSignedIn(signedIn);
    },
    async startFromGuide() {
      const scope = generation;
      while (pending) {
        await pending.promise.catch(() => null);
        if (scope !== generation) return null;
      }
      if (!ready || !available || stage !== 0) return Promise.resolve(null);
      return send('start');
    },
    async visitStudentCenter() {
      const scope = generation;
      while (pending) {
        await pending.promise.catch(() => null);
        if (scope !== generation) return null;
      }
      if (scope !== generation) return null;
      if (!ready && enabled && signedIn) await refresh();
      if (scope !== generation || !ready || !available || stage !== 1) return null;
      return send('visit_student_center');
    },
    mapTarget() {
      if (!enabled || !signedIn || !ready || !available || stage >= 3) return null;
      const target = stage === 0 ? MAIN2_GUIDE_NPC.position : STUDENT_CENTER_SHOP_ENTRY;
      return Object.freeze({ x: target.x, z: target.z, stage,
        kind: stage === 0 ? 'quest-npc' : 'destination', label: MAIN3_QUEST_OBJECTIVES[stage] });
    }
  });
}
