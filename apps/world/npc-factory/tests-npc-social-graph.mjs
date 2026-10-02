import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeCampusPopulation } from './npc-campus-expansion.mjs';
import { createPersistentNpcSocialGraph } from './npc-social-graph.mjs';

const baseBatch = JSON.parse(readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url), 'utf8'));
const baseRoster = JSON.parse(readFileSync(new URL('./data/fixtures/public-roster.json', import.meta.url), 'utf8'));
const expansion = JSON.parse(readFileSync(new URL('./data/expansion/CAMPUS-28-P2A.json', import.meta.url), 'utf8'));
const { batch, roster } = mergeCampusPopulation(baseBatch, baseRoster, expansion);

const backing = new Map();
const storage = {
  getItem: key => backing.has(key) ? backing.get(key) : null,
  setItem: (key, value) => backing.set(key, String(value)),
  removeItem: key => backing.delete(key)
};

const graph = createPersistentNpcSocialGraph(batch, roster, 'p2b-fixture-hash', storage);
assert.equal(batch.npcs.length, 48, 'P2-B must cover the full 48-NPC P2-A population');
assert.equal(graph.status().storedPairs, 0, 'persistent graph starts sparse');

const sameDepartment = graph.describePair('INKYUNG-NPC-034', 'INKYUNG-NPC-035');
assert.ok(sameDepartment.reasons.includes('SAME_DEPARTMENT'),
  'same-department NPCs receive structural relationship context');
assert.ok(sameDepartment.structuralAffinity >= 4);

const sameDorm = graph.describePair('INKYUNG-NPC-022', 'INKYUNG-NPC-026');
assert.ok(sameDorm.reasons.includes('SAME_RESIDENCE'),
  'same-dorm NPCs receive structural relationship context');

const unrelated = graph.describePair('INKYUNG-NPC-021', 'INKYUNG-NPC-046');
assert.ok(sameDepartment.seedAffinity > unrelated.seedAffinity,
  'department/community context changes initial relationship strength');

const before = graph.seedAffinity('INKYUNG-NPC-034', 'INKYUNG-NPC-035');
assert.equal(graph.recordMeeting(
  'npc-group-p2b',
  ['INKYUNG-NPC-034', 'INKYUNG-NPC-035', 'INKYUNG-NPC-043'],
  'COMPLETED',
  240
), true);
const after = graph.describePair('INKYUNG-NPC-034', 'INKYUNG-NPC-035');
assert.equal(after.persistentBond, 2, 'completed regular meetup creates a durable +2 bond');
assert.equal(after.meetingCount, 1);
assert.equal(after.lastMeetingTick, 240);
assert.equal(after.lastGroupId, 'npc-group-p2b');
assert.equal(after.seedAffinity, before + 2);

assert.equal(graph.recordMeeting(
  'npc-group-p2b',
  ['INKYUNG-NPC-034', 'INKYUNG-NPC-035'],
  'POSTPONED_ROUTE',
  360
), false, 'missed meetups do not create punitive relationship decay');
assert.equal(graph.describePair('INKYUNG-NPC-034', 'INKYUNG-NPC-035').persistentBond, 2);

const reloaded = createPersistentNpcSocialGraph(batch, roster, 'p2b-fixture-hash', storage);
assert.equal(reloaded.describePair('INKYUNG-NPC-034', 'INKYUNG-NPC-035').persistentBond, 2,
  'durable bonds survive a graph reload');
assert.equal(reloaded.status().persistent, true);
assert.ok(reloaded.status().storedPairs >= 3,
  'three-person completed meetup persists all pair relationships');

assert.equal(reloaded.clear(), true);
const cleared = createPersistentNpcSocialGraph(batch, roster, 'p2b-fixture-hash', storage);
assert.equal(cleared.describePair('INKYUNG-NPC-034', 'INKYUNG-NPC-035').persistentBond, 0,
  'local relationship graph can be reset without mutating the population source');

console.log('NPC Social Graph P2-B: structural ties, completed-meeting reinforcement and local persistence PASS');
