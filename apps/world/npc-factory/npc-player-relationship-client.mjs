import { NPC_RELATIONSHIP_REGISTRY } from './npc-player-relationship-registry.mjs';

export const NPC_RELATIONSHIP_DIALOGUE_EVENT = Object.freeze({
  OPEN: 'OPEN',
  TOPIC: 'TOPIC'
});

const allowedResponseStatus = new Set(['APPLIED','ALREADY_PROCESSED','ALREADY_MET']);

export function createNpcPlayerRelationshipClient({
  enabled = false,
  endpoint = '/api/npc-relationship',
  getSession = async () => null,
  fetcher = fetch
} = {}) {
  let signedIn = false;
  let generation = 0;
  const inFlight = new Map();
  const sentOpen = new Set();
  const sentTopic = new Set();

  function setSignedIn(value) {
    generation += 1;
    signedIn = Boolean(value);
    inFlight.clear();
    sentOpen.clear();
    sentTopic.clear();
  }

  function setEnabled(value) {
    enabled = Boolean(value);
  }

  async function send(npcId, event) {
    if (!enabled || !signedIn || !NPC_RELATIONSHIP_REGISTRY.has(npcId)) return null;
    if (!Object.values(NPC_RELATIONSHIP_DIALOGUE_EVENT).includes(event))
      throw new TypeError('Unknown NPC relationship dialogue event');
    const key = `${npcId}:${event}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const requestGeneration = generation;
    const request = (async () => {
      const token = await getSession();
      if (!token || requestGeneration !== generation || !signedIn || !enabled) return null;
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ npcId, event })
      });
      if (!response.ok) throw Error('NPC_RELATIONSHIP_UNAVAILABLE');
      const result = await response.json();
      if (!allowedResponseStatus.has(result?.status) ||
          result?.relationship?.npcId !== npcId ||
          !Number.isInteger(result?.relationship?.affinity) ||
          result.relationship.affinity < 0 || result.relationship.affinity > 100 ||
          typeof result.relationship.tier !== 'string')
        throw Error('NPC_RELATIONSHIP_UNAVAILABLE');
      if (requestGeneration !== generation) return null;
      return result;
    })();
    inFlight.set(key, request);
    try { return await request; }
    finally { if (inFlight.get(key) === request) inFlight.delete(key); }
  }

  async function recordConversationOpen(npcId) {
    if (!enabled || !signedIn || !NPC_RELATIONSHIP_REGISTRY.has(npcId) || sentOpen.has(npcId)) return null;
    sentOpen.add(npcId);
    try {
      const result = await send(npcId, NPC_RELATIONSHIP_DIALOGUE_EVENT.OPEN);
      if (result === null) sentOpen.delete(npcId);
      return result;
    } catch (error) { sentOpen.delete(npcId); throw error; }
  }

  async function recordMeaningfulDialogue(npcId) {
    if (!enabled || !signedIn || !NPC_RELATIONSHIP_REGISTRY.has(npcId) || sentTopic.has(npcId)) return null;
    sentTopic.add(npcId);
    try {
      const result = await send(npcId, NPC_RELATIONSHIP_DIALOGUE_EVENT.TOPIC);
      if (result === null) sentTopic.delete(npcId);
      return result;
    } catch (error) { sentTopic.delete(npcId); throw error; }
  }

  return Object.freeze({
    setSignedIn,
    setEnabled,
    recordConversationOpen,
    recordMeaningfulDialogue,
    status: () => Object.freeze({
      enabled: Boolean(enabled),
      signedIn,
      inFlight: inFlight.size,
      heroCount: NPC_RELATIONSHIP_REGISTRY.size,
      openSentCount: sentOpen.size,
      topicSentCount: sentTopic.size
    })
  });
}
