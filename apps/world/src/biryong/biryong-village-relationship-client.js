// Biryong Village relationship read adapter.
// Database/RPC is the only authority. This client has deliberately NO mutation method.
export const BIRYONG_RELATIONSHIPS_RPC = "get_my_biryong_npc_relationships_v1";

export const BIRYONG_RELATIONSHIP_CLIENT_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

const NPC_ID = /^BR_NPC_00[1-8]$/;
const FACT_ID = /^biryong\.relationship\.br_npc_00[1-8]\.s[23]\.[a-z][a-z0-9_]{1,80}$/;
const TOPIC_ID = /^[a-z][a-z0-9_]{1,40}$/;
const STAGE_STATE = new Map([
  [1, "ACQUAINTED"],
  [2, "TRUSTED"],
  [3, "SHARED_RESPONSIBILITY"]
]);

const clipped = (value, max) =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
const timestampOrNull = value => value === null || typeof value === "string" ? value : null;

export function parseBiryongRelationshipFact(raw, expectedNpcId, stage) {
  if (!raw || typeof raw !== "object") return null;
  const factId = clipped(raw.factId, 140);
  const npcId = clipped(raw.npcId, 20);
  const unlockStage = raw.unlockStage;
  const topicId = clipped(raw.topicId, 42);
  const topicLabel = clipped(raw.topicLabel, 40);
  const factText = clipped(raw.factText, 500);
  const dialogueLine = clipped(raw.dialogueLine, 500);
  const definitionVersion = raw.definitionVersion;
  if (!factId || !FACT_ID.test(factId) || npcId !== expectedNpcId ||
      !Number.isInteger(unlockStage) || ![2,3].includes(unlockStage) || unlockStage > stage ||
      !topicId || !TOPIC_ID.test(topicId) || !topicLabel || !factText || !dialogueLine ||
      typeof raw.generativeSafe !== "boolean" ||
      !Number.isInteger(definitionVersion) || definitionVersion < 1) return null;
  return Object.freeze({
    factId, npcId, unlockStage, topicId, topicLabel, factText, dialogueLine,
    generativeSafe: raw.generativeSafe,
    definitionVersion
  });
}

export function parseBiryongRelationshipSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const npcId = clipped(raw.npcId, 20);
  const stage = raw.stage;
  const revision = raw.revision;
  if (!npcId || !NPC_ID.test(npcId) || !Number.isInteger(stage) || stage < 1 || stage > 3 ||
      raw.stageState !== STAGE_STATE.get(stage) ||
      !Number.isSafeInteger(revision) || revision < 0) return null;
  const expectedNext = stage < 3 ? stage + 1 : null;
  if (raw.nextStage !== expectedNext) return null;
  if (stage === 1 && revision !== 0) return null;
  if (stage >= 2 && revision < 1) return null;
  const facts = [];
  for (const rawFact of Array.isArray(raw.unlockedFacts) ? raw.unlockedFacts : []) {
    const fact = parseBiryongRelationshipFact(rawFact, npcId, stage);
    if (!fact || facts.some(item => item.factId === fact.factId)) return null;
    facts.push(fact);
  }
  return Object.freeze({
    npcId,
    stage,
    stageState: raw.stageState,
    nextStage: expectedNext,
    revision,
    stage2UnlockedAt: timestampOrNull(raw.stage2UnlockedAt),
    stage3UnlockedAt: timestampOrNull(raw.stage3UnlockedAt),
    updatedAt: timestampOrNull(raw.updatedAt),
    unlockedFacts: Object.freeze(facts)
  });
}

export function parseBiryongRelationshipList(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.relationships)) return null;
  const map = new Map();
  for (const entry of raw.relationships) {
    const parsed = parseBiryongRelationshipSnapshot(entry);
    if (!parsed || map.has(parsed.npcId)) return null;
    map.set(parsed.npcId, parsed);
  }
  return map.size === 8 ? map : null;
}

export function createBiryongRelationshipClient({
  getClient = () => null,
  getUserId = () => null
} = {}) {
  let accountId = null;
  let generation = 0;
  let state = BIRYONG_RELATIONSHIP_CLIENT_STATE.SIGNED_OUT;
  let relationships = new Map();
  let lastError = null;
  let inFlight = null;
  const listeners = new Set();

  const publish = () => {
    const snapshot = status();
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* UI observers never break relationship reads. */ }
    }
  };

  function clear(nextState) {
    relationships = new Map();
    state = nextState;
    lastError = null;
    publish();
  }

  async function refresh(reason = "refresh") {
    const userId = accountId;
    const gen = generation;
    if (!userId || getUserId?.() !== userId) {
      clear(BIRYONG_RELATIONSHIP_CLIENT_STATE.SIGNED_OUT);
      return false;
    }
    if (inFlight) return inFlight;
    state = BIRYONG_RELATIONSHIP_CLIENT_STATE.LOADING;
    publish();
    const run = (async () => {
      try {
        const client = getClient?.();
        if (!client?.rpc) throw new Error("RELATIONSHIP_RPC_UNAVAILABLE");
        const { data, error } = await client.rpc(BIRYONG_RELATIONSHIPS_RPC);
        if (error) throw error;
        const parsed = parseBiryongRelationshipList(data);
        if (!parsed) throw new Error("RELATIONSHIP_SNAPSHOT_INVALID");
        if (gen !== generation || accountId !== userId || getUserId?.() !== userId) return false;
        relationships = parsed;
        state = BIRYONG_RELATIONSHIP_CLIENT_STATE.READY;
        lastError = null;
        publish();
        return true;
      } catch (error) {
        if (gen !== generation || accountId !== userId) return false;
        relationships = new Map();
        state = BIRYONG_RELATIONSHIP_CLIENT_STATE.UNAVAILABLE;
        lastError = String(error?.message ?? error);
        publish();
        return false;
      } finally {
        if (inFlight === run) inFlight = null;
      }
    })();
    inFlight = run;
    return run;
  }

  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return next ? refresh("same-account") : Promise.resolve(false);
    generation += 1;
    accountId = next;
    inFlight = null;
    clear(next ? BIRYONG_RELATIONSHIP_CLIENT_STATE.LOADING : BIRYONG_RELATIONSHIP_CLIENT_STATE.SIGNED_OUT);
    return next ? refresh("account") : Promise.resolve(false);
  }

  function relationship(npcId) {
    return relationships.get(npcId) ?? null;
  }

  function stage(npcId) {
    return relationship(npcId)?.stage ?? 1;
  }

  function facts(npcId) {
    return relationship(npcId)?.unlockedFacts ?? Object.freeze([]);
  }

  function status() {
    return Object.freeze({
      state,
      accountBound: accountId !== null,
      stageByNpc: Object.freeze(Object.fromEntries(
        [...relationships].map(([npcId, value]) => [npcId, value.stage])
      )),
      unlockedFactCount: [...relationships.values()].reduce(
        (sum, value) => sum + value.unlockedFacts.length, 0
      ),
      lastError
    });
  }

  return Object.freeze({
    setAccount,
    refresh,
    relationship,
    stage,
    facts,
    status,
    onChange(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}
