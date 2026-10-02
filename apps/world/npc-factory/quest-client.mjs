import { QUEST_ID, QUEST_OBJECTIVES, questEventForNpc, questReply } from './quest-contract.mjs';
import { MAIN_NPC_ID, QUEST_NPC_ID } from './npc-presence.mjs';
import { isQuestRewardResult } from './quest-reward-shape.mjs';
import { TOUR_STOPS } from '../src/campus-layout.js';
import { POND_RING } from '../src/roadview-layout.js';

const hall = TOUR_STOPS.find(stop => stop.id === 'main');
const pond = { x: POND_RING.reduce((sum, point) => sum + point.x, 0) / POND_RING.length,
  z: POND_RING.reduce((sum, point) => sum + point.z, 0) / POND_RING.length };

// onReward(reward): P1c. Called once with the server Reward result carried by the call that completed
// the walk, only while the same account is still signed in. The client never computes EXP or items.
export function createQuestClient({ enabled, endpoint, getSession, getNpcPosition = () => null, hud, tour, fetcher = fetch,
  onReward = () => {} }) {
  let signedIn = false, stage = 0, generation = 0, pending = null, retryAfter = 0;
  let statusReady = false;
  const listeners = new Set();
  const objective = hud?.querySelector('#npc-quest-objective');
  function publish() {
    const visible = enabled && signedIn && statusReady && stage >= 0 && stage < 5;
    if (hud) hud.hidden = !visible;
    if (tour) tour.hidden = Boolean(enabled && signedIn && statusReady);
    if (objective && visible) objective.textContent = QUEST_OBJECTIVES[stage];
    for (const listener of listeners) listener(stage);
  }
  async function send(event) {
    if (!enabled || !signedIn || pending) return null;
    const claim = {};
    pending = claim;
    const requestGeneration = generation;
    try {
      const token = await getSession();
      if (!token || requestGeneration !== generation) return null;
      const response = await fetcher(endpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ event }) });
      if (!response.ok) throw Error('QUEST_UNAVAILABLE');
      const result = await response.json();
      if (result?.quest_id !== QUEST_ID || !Number.isInteger(result.stage) ||
          result.stage < 0 || result.stage > 5) throw Error('QUEST_UNAVAILABLE');
      const reward = result.reward ?? null;
      if (reward !== null && !(event === 'talk_001' && result.stage === 5 && isQuestRewardResult(reward)))
        throw Error('QUEST_UNAVAILABLE');
      if (requestGeneration !== generation) return null;
      stage = result.stage;
      statusReady = true;
      retryAfter = 0;
      publish();
      if (reward) {
        try { onReward(reward); } catch { /* presentation only; progress already stored */ }
      }
      return result;
    } finally { if (pending === claim) pending = null; }
  }
  return {
    get stage() { return stage; },
    status() {
      return {
        enabled: Boolean(enabled),
        signedIn,
        ready: statusReady,
        stage,
        active: Boolean(enabled && signedIn && statusReady && stage > 0 && stage < 5),
        complete: stage === 5,
        objective: QUEST_OBJECTIVES[stage] ?? null
      };
    },
    mapTarget() {
      if (!enabled || !signedIn || !statusReady || stage >= 5) return null;
      if (stage === 0) {
        const position = getNpcPosition(MAIN_NPC_ID);
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
        return Object.freeze({ x: position.x, z: position.z, kind: 'quest-npc', npcId: MAIN_NPC_ID, stage, label: QUEST_OBJECTIVES[stage] });
      }
      if (stage === 1) return Object.freeze({ x: hall.x, z: hall.z, kind: 'destination', stage, label: QUEST_OBJECTIVES[stage] });
      if (stage === 2) return Object.freeze({ x: pond.x, z: pond.z, kind: 'destination', stage, label: QUEST_OBJECTIVES[stage] });
      const npcId = stage === 3 ? QUEST_NPC_ID : stage === 4 ? MAIN_NPC_ID : null;
      const position = npcId ? getNpcPosition(npcId) : null;
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
      return Object.freeze({ x: position.x, z: position.z, kind: 'quest-npc', npcId, stage, label: QUEST_OBJECTIVES[stage] });
    },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setSignedIn(value) {
      generation++;
      pending = null;
      signedIn = Boolean(value);
      stage = 0;
      statusReady = false;
      publish();
      if (!signedIn) return Promise.resolve(null);
      const requestGeneration = generation;
      return send('status').catch(() => {
        if (requestGeneration === generation) {
          statusReady = false;
          publish();
        }
        return null;
      });
    },
    eventForNpc(id) { return signedIn && enabled ? questEventForNpc(stage, id) : null; },
    async advanceNpc(id) {
      const event = signedIn && enabled ? questEventForNpc(stage, id) : null;
      if (!event) return null;
      const result = await send(event);
      return result ? { ...result, line: questReply(event) } : null;
    },
    observePlace(placeId, position) {
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return;
      const event = stage === 1 && placeId === hall.placeZoneId &&
        Math.hypot(position.x - hall.x, position.z - hall.z) <= hall.radius ? 'visit_main_hall' :
        stage === 2 && placeId === 'AREA_INKYUNG_STUDENT_CENTER' &&
        Math.hypot(position.x - pond.x, position.z - pond.z) <= 38 ? 'visit_inkyung' : null;
      if (!event || pending || Date.now() < retryAfter) return;
      retryAfter = Date.now() + 5000;
      void send(event).catch(() => {});
    }
  };
}
