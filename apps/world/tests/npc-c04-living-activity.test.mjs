import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeCampusPopulation } from '../npc-factory/npc-campus-expansion.mjs';
import { applyCampusLifeSchedule } from '../npc-factory/npc-campus-life-policy.mjs';
import { createPurposefulRoster } from '../npc-factory/purposeful-roster.mjs';
import { createNpcNavigator } from '../npc-factory/dev-navigation.mjs';
import { purposefulPhotoHeading, c04BenchRenderPosition } from '../npc-factory/purposeful-activity-motion.mjs';
import { INKYUNG_PHOTO_POINT } from '../src/photo/inkyung-photo-point.js';
import { bindSharedSchedule } from '../npc-factory/npc-shared-schedule.mjs';
import { NPC_WORLD_EPOCH_MS as E, NPC_WORLD_PERIOD_MS as P } from '../npc-factory/npc-world-time-contract.mjs';
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
    // The authored quest NPC 001 already sits at lunch; do not count it as a
    // newly assigned living-activity visitor or mutate its protected schedule.
    assert.deepEqual(batch.npcs.filter(member =>
      member.npc_id !== 'INKYUNG-NPC-001' &&
      member.npc_id !== 'INKYUNG-NPC-002' &&
      member.schedule.lunch.activity === 'sit'
    ).map(member => member.npc_id), ['INKYUNG-NPC-010']);
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
  // Use the real campus obstacle/navigation contract instead of a stub with
  // missing walkable(). All NPC destinations must be physically traversable.
  const navigator = createNpcNavigator(expanded);
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
  assert.equal(navigator.walkable(approach), true, 'existing bench approach must be walkable');
  assert.equal(navigator.walkable(photoPoint), true, 'photo anchor must be walkable');
  const from = sitter.destinations[sitter.schedule[1].destination].position;
  const path = navigator.networkRoute(from, approach) ?? navigator.route(from, approach);
  assert.ok(path?.length, 'bench must be reachable from the previous scheduled destination');
  assert.equal(findSeat(approach, { range: 2 })?.id, seat.id,
    'NPC should visibly sit on the actual seat instead of a symbolic bench point');
});

test('C04 photograph faces the pond without mutating shared schedule movement', () => {
  const navigator = createNpcNavigator(expanded);
  const roster = bindSharedSchedule(createPurposefulRoster(expanded, navigator), navigator, () => E + 2*P + 799000);
  const controller = roster.get('INKYUNG-NPC-009').controller;
  const before = controller.status();
  const position = Object.freeze({ ...before.position });
  const target = INKYUNG_PHOTO_POINT.lookAt;
  const heading = purposefulPhotoHeading(before.activity, { position, target, heading: before.heading });
  const radians = heading * Math.PI / 180;
  const dx = target.x-position.x, dz = target.z-position.z;
  const alignment = (Math.sin(radians)*dx + Math.cos(radians)*dz) / Math.hypot(dx,dz);
  assert.ok(alignment > .999999, 'rendered human +Z faces the lake, not its last route segment');
  assert.deepEqual(controller.status(), before, 'render-only direction cannot mutate shared authority');
  for (const activity of ['RESTING', 'PHONE', 'READING', null])
    assert.equal(purposefulPhotoHeading(activity, { position, target, heading: 37 }), 37);
  assert.equal(purposefulPhotoHeading('PHOTO', { position, target: position, heading: 37 }), 37);
  assert.equal(purposefulPhotoHeading('PHOTO', { position, target: { x: NaN, z: 0 }, heading: 37 }), 37);
});


test('C04 bench projection supports the real capsule silhouette without changing seat or route',()=>{
  const seat=SEAT_ANCHORS.find(a=>a.id==='SEAT_INKYUNG_TREE_1_A'),before=JSON.stringify(seat),scale=.35;
  const position=c04BenchRenderPosition(seat,scale,0,.53);
  assert.ok(Math.abs(position.y+(1.27-.69)*scale-.53)<1e-12);
  assert.ok(Math.abs(position.x-seat.position.x-.10)<1e-12);
  assert.equal(position.z,seat.position.z);assert.equal(JSON.stringify(seat),before);
});
