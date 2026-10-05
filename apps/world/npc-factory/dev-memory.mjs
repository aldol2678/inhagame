import { PERIODS } from './vocabulary.mjs';

const LIMIT = 9999;
export const memoryKey = hash => `inha-npc-test-a-r1-memory-v1:${hash}`;

// A meeting starts with the first conversation and ends after leaving the NPC's local area.
export function createEncounterTracker() {
  const metNearby = new Set();
  return {
    begin(id) {
      if (metNearby.has(id)) return false;
      metNearby.add(id);
      return true;
    },
    retain(nearbyIds) {
      const nearby = new Set(nearbyIds);
      for (const id of metNearby) if (!nearby.has(id)) metNearby.delete(id);
    },
    clear() { metNearby.clear(); }
  };
}

export function createNpcMemory(batch, hash, storage) {
  const npcs = new Map(batch.npcs.map(npc => [npc.npc_id, npc]));
  const key = memoryKey(hash);
  let records = {};
  let persistent = Boolean(storage);
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    if (saved?.version === 1 && saved.records && typeof saved.records === 'object' && !Array.isArray(saved.records)) {
      for (const [id, value] of Object.entries(saved.records)) {
        const npc = npcs.get(id);
        if (!npc || !value || !Number.isInteger(value.encounters) || value.encounters < 0 || value.encounters > LIMIT ||
            !PERIODS.includes(value.lastPeriod) ||
            (value.topic !== null && !npc.interests.includes(value.topic))) continue;
        records[id] = { encounters: value.encounters, lastPeriod: value.lastPeriod, topic: value.topic };
      }
    }
  } catch { persistent = false; }
  function save() {
    if (!storage) { persistent = false; return; }
    try { storage.setItem(key, JSON.stringify({ version: 1, records })); persistent = true; }
    catch { persistent = false; }
  }
  function read(id) {
    if (!npcs.has(id)) throw new Error('Unknown NPC');
    return records[id] ? { ...records[id] } : { encounters: 0, lastPeriod: null, topic: null };
  }
  function encounter(id, period) {
    if (!PERIODS.includes(period)) throw new Error('Unknown period');
    const before = read(id);
    records[id] = { encounters: Math.min(LIMIT, before.encounters + 1), lastPeriod: period, topic: before.topic };
    save();
    return { before, after: read(id) };
  }
  function rememberTopic(id, topic) {
    if (!npcs.get(id)?.interests.includes(topic)) throw new Error('Unknown NPC topic');
    records[id] = { ...read(id), topic };
    save();
    return read(id);
  }
  function clear() {
    if (storage) {
      try { storage.removeItem(key); }
      catch { return false; }
    }
    records = {};
    return true;
  }
  return { read, encounter, rememberTopic, clear, get persistent() { return persistent; } };
}
