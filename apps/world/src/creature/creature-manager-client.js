// INHA WORLD · Creature Manager P1 client.
// Persistent Creature ownership and party membership remain server-authoritative.
// This client only reads the caller's server snapshot and requests a self-only party mutation.

export const CREATURE_CORE_RPC = "get_my_creature_core_v1";
export const CREATURE_PARTY_SET_RPC = "set_my_creature_party_v1";

export const CREATURE_MANAGER_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SPECIES_ID = /^creature\.species\.[a-z][a-z0-9_]*$/;
const FORM_ID = /^creature\.form\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const MEMORY_TAG = /^memory\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){0,3}$/;

const finiteInt = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const text = (value, pattern = null) =>
  typeof value === "string" && value.length > 0 && (!pattern || pattern.test(value));

export function parseCreature(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!text(raw.creatureId, UUID) || !text(raw.speciesId, SPECIES_ID) || !text(raw.currentFormId, FORM_ID)) return null;
  if (!finiteInt(raw.formRevision, 1) || !finiteInt(raw.totalXp) || !finiteInt(raw.version, 1)) return null;
  if (typeof raw.bondEntitled !== "boolean" || !text(raw.acquiredAt) || !text(raw.updatedAt)) return null;
  return Object.freeze({
    creatureId: raw.creatureId,
    speciesId: raw.speciesId,
    currentFormId: raw.currentFormId,
    formRevision: raw.formRevision,
    totalXp: raw.totalXp,
    bondEntitled: raw.bondEntitled,
    version: raw.version,
    acquiredAt: raw.acquiredAt,
    updatedAt: raw.updatedAt
  });
}

export function parseCreatureMemory(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!text(raw.creatureId, UUID) || !text(raw.memoryTag, MEMORY_TAG) || !finiteInt(raw.memoryCount, 1)) return null;
  if (!text(raw.firstRememberedAt) || !text(raw.lastRememberedAt) || !finiteInt(raw.version, 1)) return null;
  return Object.freeze({
    creatureId: raw.creatureId,
    memoryTag: raw.memoryTag,
    memoryCount: raw.memoryCount,
    firstRememberedAt: raw.firstRememberedAt,
    lastRememberedAt: raw.lastRememberedAt,
    version: raw.version
  });
}

export function parseCreatureParty(raw) {
  if (!raw || typeof raw !== "object" || !finiteInt(raw.revision)) return null;
  const active = raw.activeCreatureId ?? null;
  if (active !== null && !text(active, UUID)) return null;
  if (!Array.isArray(raw.reserveCreatureIds) || raw.reserveCreatureIds.length > 2) return null;
  const reserves = [];
  for (const id of raw.reserveCreatureIds) {
    if (!text(id, UUID)) return null;
    reserves.push(id);
  }
  const ids = [active, ...reserves].filter(Boolean);
  if (new Set(ids).size !== ids.length) return null;
  if (active === null && reserves.length) return null;
  return Object.freeze({
    revision: raw.revision,
    activeCreatureId: active,
    reserveCreatureIds: Object.freeze(reserves)
  });
}

export function parseCreatureCoreSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.creatures) || !Array.isArray(raw.memories)) return null;
  const party = parseCreatureParty(raw.party);
  if (!party) return null;

  const creatures = [];
  const ids = new Set();
  for (const entry of raw.creatures) {
    const creature = parseCreature(entry);
    if (!creature || ids.has(creature.creatureId)) return null;
    ids.add(creature.creatureId);
    creatures.push(creature);
  }
  if ([party.activeCreatureId, ...party.reserveCreatureIds].filter(Boolean).some(id => !ids.has(id))) return null;

  const memories = [];
  for (const entry of raw.memories) {
    const memory = parseCreatureMemory(entry);
    if (!memory || !ids.has(memory.creatureId)) return null;
    memories.push(memory);
  }

  return Object.freeze({
    party,
    creatures: Object.freeze(creatures),
    memories: Object.freeze(memories)
  });
}

export function nextPartyWithActive(snapshot, creatureId) {
  const party = snapshot?.party;
  if (!party || !snapshot.creatures.some(creature => creature.creatureId === creatureId)) {
    return Object.freeze({ ok: false, reason: "NOT_OWNED" });
  }
  if (party.activeCreatureId === creatureId) {
    return Object.freeze({ ok: false, reason: "ALREADY_ACTIVE" });
  }

  const reserves = [...party.reserveCreatureIds];
  const reserveIndex = reserves.indexOf(creatureId);
  const oldActive = party.activeCreatureId;

  if (reserveIndex >= 0) {
    if (oldActive) reserves[reserveIndex] = oldActive;
    else reserves.splice(reserveIndex, 1);
    return Object.freeze({
      ok: true,
      activeCreatureId: creatureId,
      reserveCreatureIds: Object.freeze(reserves)
    });
  }

  if (!oldActive) {
    return Object.freeze({
      ok: true,
      activeCreatureId: creatureId,
      reserveCreatureIds: Object.freeze(reserves)
    });
  }

  if (reserves.length >= 2) return Object.freeze({ ok: false, reason: "PARTY_FULL" });
  reserves.unshift(oldActive);
  return Object.freeze({
    ok: true,
    activeCreatureId: creatureId,
    reserveCreatureIds: Object.freeze(reserves)
  });
}

export function createCreatureManagerClient({
  getClient,
  mutationKeyFactory = () => globalThis.crypto?.randomUUID?.() ?? null
} = {}) {
  if (typeof getClient !== "function") throw new Error("Creature manager requires getClient");

  let accountId = null;
  let generation = 0;
  let state = CREATURE_MANAGER_STATE.SIGNED_OUT;
  let snapshot = null;
  let inFlight = null;
  let rerun = false;
  let mutating = false;
  const listeners = new Set();

  function emit(reason) {
    const change = { state, snapshot, accountId, mutating, reason };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Creature manager listener failed:", error); }
    }
  }

  function set(nextState, nextSnapshot, reason) {
    state = nextState;
    snapshot = nextSnapshot;
    emit(reason);
  }

  async function fetchOnce(reason) {
    const gen = generation;
    const account = accountId;
    const client = getClient();
    if (!account || !client?.rpc) {
      if (gen === generation) set(CREATURE_MANAGER_STATE.SIGNED_OUT, null, reason);
      return false;
    }

    let next = null;
    try {
      const { data, error } = await client.rpc(CREATURE_CORE_RPC);
      if (error) throw error;
      next = parseCreatureCoreSnapshot(data);
    } catch (error) {
      console.warn("Creature core unavailable:", error?.message ?? error);
    }
    if (gen !== generation || account !== accountId) return false;
    if (next) set(CREATURE_MANAGER_STATE.READY, next, reason);
    else set(CREATURE_MANAGER_STATE.UNAVAILABLE, null, reason);
    return Boolean(next);
  }

  function refresh(reason = "refresh") {
    if (!accountId) return Promise.resolve(false);
    if (inFlight) { rerun = true; return inFlight; }
    const gen = generation;
    const run = (async () => {
      try {
        do {
          rerun = false;
          await fetchOnce(reason);
        } while (rerun && gen === generation);
      } finally {
        if (inFlight === run) inFlight = null;
      }
      return gen === generation && state === CREATURE_MANAGER_STATE.READY;
    })();
    inFlight = run;
    return run;
  }

  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === CREATURE_MANAGER_STATE.READY);
    generation += 1;
    accountId = next;
    rerun = false;
    inFlight = null;
    mutating = false;
    if (!next) {
      set(CREATURE_MANAGER_STATE.SIGNED_OUT, null, "account");
      return Promise.resolve(false);
    }
    set(CREATURE_MANAGER_STATE.LOADING, null, "account");
    return refresh("account");
  }

  async function setActive(creatureId) {
    if (mutating) return { outcome: "REFUSED", reason: "PENDING" };
    if (state !== CREATURE_MANAGER_STATE.READY || !snapshot) return { outcome: "REFUSED", reason: "UNAVAILABLE" };

    const next = nextPartyWithActive(snapshot, creatureId);
    if (!next.ok) return { outcome: "REFUSED", reason: next.reason };

    const key = mutationKeyFactory?.();
    if (!key) return { outcome: "REFUSED", reason: "UNAVAILABLE" };
    const client = getClient();
    if (!client?.rpc) return { outcome: "REFUSED", reason: "UNAVAILABLE" };

    mutating = true;
    emit("party-pending");
    try {
      const reserves = [...next.reserveCreatureIds, null, null];
      const { data, error } = await client.rpc(CREATURE_PARTY_SET_RPC, {
        p_active_creature_id: next.activeCreatureId,
        p_reserve1_creature_id: reserves[0],
        p_reserve2_creature_id: reserves[1],
        p_expected_revision: snapshot.party.revision,
        p_mutation_key: `creature-party:${String(key)}`
      });
      if (error) {
        const message = String(error.message ?? "");
        if (message.includes("CREATURE_PARTY_REVISION_CONFLICT")) {
          await refresh("party-conflict");
          return { outcome: "REFUSED", reason: "REVISION_CONFLICT" };
        }
        throw error;
      }
      const party = parseCreatureParty(data?.party);
      if (!party) throw new Error("Invalid Creature party response");
      snapshot = Object.freeze({ ...snapshot, party });
      emit("party");
      void refresh("party-confirm");
      return { outcome: "CHANGED", party };
    } catch (error) {
      console.warn("Creature party change failed:", error?.message ?? error);
      return { outcome: "REFUSED", reason: "UNAVAILABLE" };
    } finally {
      mutating = false;
      emit("party-settled");
    }
  }

  return Object.freeze({
    setAccount,
    refresh,
    setActive,
    get state() { return state; },
    get snapshot() { return snapshot; },
    get accountId() { return accountId; },
    get mutating() { return mutating; },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return {
        state,
        accountBound: accountId !== null,
        creatureCount: snapshot?.creatures.length ?? 0,
        partyRevision: snapshot?.party.revision ?? null,
        mutating
      };
    }
  });
}
