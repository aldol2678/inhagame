import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeCampusPopulation } from '../npc-factory/npc-campus-expansion.mjs';
import { applyCampusLifeSchedule } from '../npc-factory/npc-campus-life-policy.mjs';
import { createPurposefulRoster } from '../npc-factory/purposeful-roster.mjs';
import { SEAT_ANCHORS, findSeat } from '../src/seat-anchors.js';

const read = path => JSON.parse(readFileSync(new URL('../npc-factory/data/' + path, import.meta.url)));
const source = read('repaired/INKYUNG-20-A-R1.json');
const profiles = read('fixtures/public-roster.json');
const expanded = mergeCampusPopulation(source, profiles, read('expansion/CAMPUS-28-P2A.json')).batch;
const fallback = applyCampusLifeSchedule(source, profiles);

test('C04 lunch adds exactly one photographer and one bench visitor in both rosters', () => {
  for (const batch of [fallback, expanded]) {
    const npc = id => batch.npcs.find(member => member.npc_id === id);
    assert.deepEqual(npc('INKYUNG-NPC-009').schedule.lunch, {
      location: 'inkyung_photo_point', activity: 'take_photo', social_mode: 'low'
    });
    assert.deepEqual(npc('INKYUNG-NPC-010').schedule.lunch, {
      location: 'inkyung_bench_east', activity: 'sit', social_mode: 'low'
    });
    assert.deepEqual(npc('INKYUNG-NPC-001'), source.npcs[0], 'main quest NPC unchanged');
    assert.deepEqual(npc('INKYUNG-NPC-002'), source.npcs[1], 'photo guide quest NPC unchanged');
    assert.deepEqual(batch.npcs.filter(member => member.schedule.lunch.activity === 'take_photo')
      .map(member => member.npc_id), ['INKYUNG-NPC-009']);
    assert.deepEqual(batch.npcs.filter(member => member.schedule.lunch.activity === 'sit')
      .map(member => member.npc_id), ['INKYUNG-NPC-010']);
    for (const id of ['INKYUNG-NPC-009', 'INKYUNG-NPC-010']) {
      const current = npc(id);
      const original = source.npcs.find(member => member.npc_id === id);
      for (const period of ['morning', 'class_time', 'evening'])
        assert.ok(current.schedule[period] && original.schedule[period], id + '/' + period);
    }
  }
  assert.equal(source.npcs[8].schedule.lunch.activity === 'take_photo', false,
    'reviewed source fixture must not be rewritten');
});

test('C04 seated NPC arrives at an existing physical tree bench', () => {
  const navigator = { route: (_from, to) => [{ ...to }] };
  const roster = createPurposefulRoster(expanded, navigator);
  const photo = roster.get('INKYUNG-NPC-009');
  const sitter = roster.get('INKYUNG-NPC-010');
  assert.equal(photo.schedule[2].activity, 'PHOTO');
  assert.equal(sitter.schedule[2].activity, 'RESTING');
  const photoPoint = photo.destinations[photo.schedule[2].destination].position;
  assert.ok(Number.isFinite(photoPoint.x) && Number.isFinite(photoPoint.z));
  const seat = SEAT_ANCHORS.find(anchor => anchor.id === 'SEAT_INKYUNG_TREE_1_A');
  assert.ok(seat, 'the world must still have its rendered pond tree bench');
  const approach = sitter.destinations[sitter.schedule[2].destination].position;
  assert.deepEqual(approach, { x: seat.standPoint.x, z: seat.standPoint.z });
  assert.equal(findSeat(approach, { range: 2 })?.id, seat.id,
    'NPC should visibly sit on the actual seat instead of a symbolic bench point');
});
