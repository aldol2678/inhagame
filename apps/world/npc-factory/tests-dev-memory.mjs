import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNpcMemory, createEncounterTracker, memoryKey } from './dev-memory.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const batch = JSON.parse(readFileSync(join(root, 'data/repaired/INKYUNG-20-A-R1.json'), 'utf8'));
const frozen = JSON.stringify(batch);
const id = batch.npcs[0].npc_id;
const hash = 'local-test-hash';
const values = new Map();
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key)
};

const first = createNpcMemory(batch, hash, storage);
assert.deepEqual(first.read(id), { encounters: 0, lastPeriod: null, topic: null });
assert.deepEqual(first.encounter(id, 'morning').before, { encounters: 0, lastPeriod: null, topic: null });
assert.equal(first.rememberTopic(id, 'sketching').topic, 'sketching');
assert.throws(() => first.rememberTopic(id, 'unknown'), /Unknown NPC topic/);
const restored = createNpcMemory(batch, hash, storage);
assert.deepEqual(restored.read(id), { encounters: 1, lastPeriod: 'morning', topic: 'sketching' });
assert.deepEqual(restored.encounter(id, 'lunch').before, { encounters: 1, lastPeriod: 'morning', topic: 'sketching' });
assert.equal(restored.read(id).encounters, 2);
assert.equal(createNpcMemory(batch, 'another-candidate', storage).read(id).encounters, 0);
assert.equal(restored.clear(), true);
assert.equal(values.has(memoryKey(hash)), false);
assert.equal(createNpcMemory(batch, hash, storage).read(id).encounters, 0);

values.set(memoryKey(hash), JSON.stringify({ version: 1, records: { [id]: { encounters: 5, lastPeriod: 'morning', topic: 'unapproved' } } }));
assert.equal(createNpcMemory(batch, hash, storage).read(id).encounters, 0);
const blocked = createNpcMemory(batch, hash, { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
assert.equal(blocked.encounter(id, 'evening').after.encounters, 1);
assert.equal(blocked.persistent, false);
assert.equal(blocked.clear(), false);

const visitMemory = createNpcMemory(batch, 'visit-count-test', storage);
const visits = createEncounterTracker();
function talk() {
  if (visits.begin(id)) visitMemory.encounter(id, 'morning');
  return visitMemory.read(id).encounters;
}
assert.equal(talk(), 1);
assert.equal(talk(), 1, 'closing and reopening nearby is the same meeting');
visits.retain([id]);
assert.equal(talk(), 1, 'remaining nearby does not start another meeting');
visits.retain([]);
assert.equal(talk(), 2, 'leaving the area and returning starts a new meeting');
visits.clear();
assert.equal(talk(), 3, 'a new period starts a new meeting');
visits.clear();
assert.equal(visitMemory.clear(), true);
assert.equal(talk(), 1, 'clearing test memory resets the count');
assert.equal(JSON.stringify(batch), frozen);
console.log('Local NPC memory, same-meeting dedup, return visits, reload, isolation, storage fallback and frozen candidate: PASS');
