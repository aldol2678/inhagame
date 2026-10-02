import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCanonicalLandmark, projectPolygon } from '../src/reality-adapter.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { FACILITY_COLLIDERS } from '../src/campus-facilities.js';
import { OBSTACLES } from '../src/campus-layout.js';
import { PERIODS, PULSE_PERIODS, PERIOD_SECONDS, CYCLE_SECONDS, periodAt, snapshotForPeriod, validateDevCandidate, inspectionPointFor } from './dev-runtime-state.mjs';
import { appearanceFor, validateDevRoster } from './dev-appearance.mjs';
import { npcNameplateOffset, npcSeatAnchorHeight, npcStandingHeight, npcWorldScale } from './npc-dimensions.mjs';
import { validateBatch } from './validate.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const bytes = readFileSync(join(root, 'data/repaired/INKYUNG-20-A-R1.json'));
const decision = JSON.parse(readFileSync(join(root, 'data/fixtures/public-fixture.json'), 'utf8'));
const hash = createHash('sha256').update(bytes).digest('hex');
assert.equal(hash, decision.candidate_sha256);
assert.equal(decision.npc_count, 20);
const batch = validateDevCandidate(JSON.parse(bytes.toString('utf8')));
assert.equal(validateBatch(batch).status, 'PASS');
const roster = validateDevRoster(batch, JSON.parse(readFileSync(join(root, 'data/fixtures/public-roster.json'), 'utf8')), hash);
const appearances = roster.npcs.map(appearanceFor);
for (const npc of batch.npcs) {
  assert.equal(Object.hasOwn(npc.identity, 'gender'), false);
  assert.equal(Object.hasOwn(npc.identity, 'student_number'), false);
  assert.equal(Object.hasOwn(npc.identity, 'department'), false);
}
assert.equal(appearances.filter(item => item.presentation === 'male').length, 10);
assert.equal(appearances.filter(item => item.presentation === 'female').length, 10);
assert.equal(roster.npcs.filter(entry => entry.student_number).length, 13);
assert.ok(appearances.every(item => item.label && item.height > 0 && item.outfit_color));
assert.ok(Math.abs(npcStandingHeight(1) - 0.875) < 1e-9);
assert.ok(Math.abs(npcStandingHeight(.94) - 0.8225) < 1e-9);
assert.ok(Math.abs(npcStandingHeight(1.06) - 0.9275) < 1e-9);
assert.ok(npcWorldScale(1) > .36 && npcWorldScale(1) < .38);
assert.ok(npcNameplateOffset(1) > npcStandingHeight(1));
assert.ok(npcSeatAnchorHeight(1) > 0 && npcSeatAnchorHeight(1) < npcStandingHeight(1));
assert.throws(() => validateDevRoster(batch, roster, 'invalid-hash'));
assert.throws(() => validateDevRoster(batch, { ...roster, npcs: [...roster.npcs.slice(0, 19), roster.npcs[0]] }, hash));
const pond = projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon);
const original = JSON.parse(readFileSync(join(root, 'data/validated/INKYUNG-20-A.json'), 'utf8'));
assert.notDeepEqual(batch.npcs[0].dialogue_hooks, original.npcs[0].dialogue_hooks);

const expectedVisible = { morning: 12, class_time: 11, lunch: 14, evening: 9, night: 5 };
const presentByPeriod = new Map();
assert.equal(PERIOD_SECONDS, 900);
assert.equal(CYCLE_SECONDS, 4500);
assert.equal(periodAt(PERIOD_SECONDS - 1), 'morning');
assert.equal(periodAt(CYCLE_SECONDS - 1), 'night');
for (const [index, period] of PULSE_PERIODS.entries()) {
  assert.equal(periodAt(index * PERIOD_SECONDS), period);
  const snapshot = snapshotForPeriod(batch, period);
  assert.equal(snapshot.actors.length, 20);
  assert.equal(snapshot.localCount + snapshot.offZoneCount, 20);
  assert.equal(snapshot.localCount, expectedVisible[period]);
  assert.ok(snapshot.largestCrowd <= 6);
  const main = snapshot.actors.find(actor => actor.id === 'INKYUNG-NPC-001');
  assert.equal(main.location, 'main_gate');
  assert.ok(main.position);
  assert.equal(main.activity, 'wait');
  const guide = snapshot.actors.find(actor => actor.id === 'INKYUNG-NPC-002');
  assert.equal(guide.location, 'inkyung_photo_point');
  assert.ok(guide.position);
  assert.ok(Math.hypot(main.position.x, main.position.z + 98) < 12);
  assert.equal(OBSTACLES.some(obstacle => obstacle.minY < 2.5 && obstacle.maxY > 0 &&
    (obstacle.polygon ? polygonOverlap(main.position.x, main.position.z, obstacle.polygon, .6) :
      main.position.x >= obstacle.minX - .6 && main.position.x <= obstacle.maxX + .6 &&
      main.position.z >= obstacle.minZ - .6 && main.position.z <= obstacle.maxZ + .6)), false);
  presentByPeriod.set(period, snapshot.actors.filter(actor => actor.position).map(actor => actor.id));
  for (const actor of snapshot.actors) {
    if (actor.location === 'off_zone') {
      assert.equal(actor.position, null);
      assert.equal(actor.activity, 'leave_zone');
      assert.equal(inspectionPointFor(actor), null);
      continue;
    }
    assert.ok(actor.position && Number.isFinite(actor.position.x) && Number.isFinite(actor.position.z));
    assert.equal(polygonOverlap(actor.position.x, actor.position.z, pond, .4), false,
      `${period}/${actor.id} lies in the pond`);
    assert.equal(FACILITY_COLLIDERS.some(c => polygonOverlap(actor.position.x, actor.position.z, c.polygon, .4)), false,
      `${period}/${actor.id} lies in a facility collider`);
    assert.ok(actor.dialogue.length >= 2);
    const inspect = inspectionPointFor(actor);
    assert.equal(polygonOverlap(inspect.x, inspect.z, pond, .6), false);
    assert.equal(FACILITY_COLLIDERS.some(c => polygonOverlap(inspect.x, inspect.z, c.polygon, .6)), false);
  }
  console.log(`${period}: ${snapshot.localCount} visible, ${snapshot.offZoneCount} off-zone, max crowd ${snapshot.largestCrowd}`);
}
assert.notDeepEqual(presentByPeriod.get('morning'), presentByPeriod.get('class_time'));
assert.notDeepEqual(presentByPeriod.get('lunch'), presentByPeriod.get('evening'));
assert.ok(presentByPeriod.get('night').length < presentByPeriod.get('evening').length);
assert.deepEqual(PERIODS, ['morning', 'class_time', 'lunch', 'evening']);
assert.equal(periodAt(CYCLE_SECONDS), 'morning');
console.log('A-R1 dev runtime data, hash, five pulse bands, dialogue and placement: PASS');
