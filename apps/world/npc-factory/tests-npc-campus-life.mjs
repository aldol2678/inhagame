import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEPARTMENT_CAMPUS_LIFE,
  NPC_CAMPUS_LIFE_LOCATIONS,
  applyCampusLifeSchedule,
  campusLifeScheduleFor,
  departmentCampusLifeFor
} from './npc-campus-life-policy.mjs';
import { validateDevCandidate, positionAt } from './dev-runtime-state.mjs';
import { createNpcNavigator } from './dev-navigation.mjs';
import { mergeCampusPopulation } from './npc-campus-expansion.mjs';
import { createPurposefulRoster } from './purposeful-roster.mjs';

const batch = JSON.parse(readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url), 'utf8'));
const roster = JSON.parse(readFileSync(new URL('./data/fixtures/public-roster.json', import.meta.url), 'utf8'));
const expansion = JSON.parse(readFileSync(new URL('./data/expansion/CAMPUS-28-P2A.json', import.meta.url), 'utf8'));
const rosterById = new Map(roster.npcs.map(entry => [entry.npc_id, entry]));

for (const npc of batch.npcs) {
  const entry = rosterById.get(npc.npc_id);
  if (!entry?.department) continue;
  assert.ok(departmentCampusLifeFor(entry.department, entry.department_type),
    `missing campus-life policy for ${entry.department}`);
}

assert.deepEqual(departmentCampusLifeFor('컴퓨터공학과').primary, ['class_hitech']);
assert.deepEqual(departmentCampusLifeFor('기계공학과').primary, ['class_building_2', 'class_building_4']);
assert.deepEqual(departmentCampusLifeFor('사회학과').primary, ['class_building_9']);
assert.deepEqual(departmentCampusLifeFor('국어국문학과').primary, ['class_building_5']);
assert.equal(departmentCampusLifeFor('컴퓨터공학과').scope, 'NORTH_EAST');
assert.equal(departmentCampusLifeFor('사회학과').scope, 'CENTRAL');
assert.ok(DEPARTMENT_CAMPUS_LIFE['문화콘텐츠문화경영학과']);
assert.ok(Object.values(NPC_CAMPUS_LIFE_LOCATIONS).includes('life_back_market_67'));
assert.ok(Object.values(NPC_CAMPUS_LIFE_LOCATIONS).includes('life_dorm_1'));

const runtimeBatch = validateDevCandidate(applyCampusLifeSchedule(batch, roster));
const byId = new Map(runtimeBatch.npcs.map(npc => [npc.npc_id, npc]));

assert.equal(campusLifeScheduleFor(byId.get('INKYUNG-NPC-019'), rosterById.get('INKYUNG-NPC-019')).primaryClassLocation, 'class_hitech');
assert.equal(campusLifeScheduleFor(byId.get('INKYUNG-NPC-011'), rosterById.get('INKYUNG-NPC-011')).primaryClassLocation, 'class_building_4');
assert.equal(campusLifeScheduleFor(byId.get('INKYUNG-NPC-009'), rosterById.get('INKYUNG-NPC-009')).primaryClassLocation, 'class_building_5');
assert.equal(byId.get('INKYUNG-NPC-006').schedule.morning.location, 'life_dorm_1');
assert.equal(byId.get('INKYUNG-NPC-006').schedule.evening.location, 'life_dorm_1');
assert.equal(byId.get('INKYUNG-NPC-019').schedule.evening.location, 'life_dorm_2');

const academic = runtimeBatch.npcs.filter(npc => {
  if (['INKYUNG-NPC-001', 'INKYUNG-NPC-002'].includes(npc.npc_id)) return false;
  const entry = rosterById.get(npc.npc_id);
  return entry?.department && ['student', 'club_member', 'teaching_assistant', 'faculty'].includes(npc.archetype);
});
const backMarketLunch = academic.filter(npc => npc.schedule.lunch.location.startsWith('life_back_market_'));
assert.ok(backMarketLunch.length >= 4,
  `department-life schedule should send several NPCs to the rear-gate market, got ${backMarketLunch.length}`);
const dormResidents = roster.npcs.filter(entry => entry.residence === 'dorm_1' || entry.residence === 'dorm_2');
assert.equal(dormResidents.length, 6);

for (const npc of academic) {
  const entry = rosterById.get(npc.npc_id);
  const life = campusLifeScheduleFor(npc, entry);
  assert.ok(life?.movementScope);
  for (const [period, slot] of Object.entries(life.schedule)) {
    const point = positionAt(slot.location, Number(npc.npc_id.slice(-3)) % 9);
    assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.z),
      `${npc.npc_id}/${period} needs a real campus anchor for ${slot.location}`);
    assert.ok(npc.dialogue_hooks[period].some(line =>
      !/인경호|호수|벤치|사진 포인트/.test(line)),
      `${npc.npc_id}/${period} dialogue should match expanded campus life`);
  }
}

const navigator = createNpcNavigator(runtimeBatch);
for (const npc of academic.filter(npc => ['student', 'club_member'].includes(npc.archetype))) {
  const locations = ['morning', 'class_time', 'lunch', 'evening']
    .map(period => npc.schedule[period].location);
  const points = locations.map((location, index) => positionAt(location, index));
  for (let i = 0; i < points.length; i++) {
    assert.ok(points[i] && Number.isFinite(points[i].x) && Number.isFinite(points[i].z),
      `${npc.npc_id}/${locations[i]} needs a finite campus-life anchor`);
    if (locations[i] !== 'life_dorm_2') assert.ok(navigator.walkable(points[i]),
      `${npc.npc_id}/${locations[i]} campus-life anchor must be walkable`);
  }
  for (let i = 0; i < points.length - 1; i++) {
    if (locations[i] === 'life_dorm_2' || locations[i + 1] === 'life_dorm_2') continue;
    assert.ok(navigator.route(points[i], points[i + 1]),
      `${npc.npc_id} needs a navigable route ${locations[i]} -> ${locations[i + 1]}`);
  }
}

console.log('NPC campus life: department buildings, rear market and dorm routes PASS');

const merged = mergeCampusPopulation(batch, roster, expansion);
const campus48 = validateDevCandidate(merged.batch);
assert.equal(campus48.npc_count, 48);
assert.equal(campus48.npcs.length, 48);
assert.equal(merged.roster.npcs.length, 48);
assert.deepEqual(campus48.npcs.map(npc => npc.npc_id).slice(-3), [
  'INKYUNG-NPC-046', 'INKYUNG-NPC-047', 'INKYUNG-NPC-048'
]);

const departmentCounts = {};
for (const entry of merged.roster.npcs) {
  if (!entry.department) continue;
  departmentCounts[entry.department] = (departmentCounts[entry.department] ?? 0) + 1;
}
const departmentsWithPairs = Object.entries(departmentCounts).filter(([, count]) => count >= 2);
assert.ok(departmentsWithPairs.length >= 21,
  `P2-A should establish at least 21 department communities with 2+ NPCs: ${JSON.stringify(departmentCounts)}`);
for (const department of [
  '컴퓨터공학과', '문화콘텐츠문화경영학과', '경영학과', '경제학과',
  '정치외교학과', '미디어커뮤니케이션학과', '신소재공학과', '스마트모빌리티공학과'
]) {
  assert.ok((departmentCounts[department] ?? 0) >= 2, `${department} needs at least two NPCs`);
}

const expandedNavigator = createNpcNavigator(campus48);
const purposeful48 = createPurposefulRoster(campus48, expandedNavigator, { duration: 1, speed: 8 });
assert.equal(purposeful48.size, 46, '48 total NPCs minus protected 001/002 should produce 46 purposeful controllers');

const mergedDorm1Residents = merged.roster.npcs.filter(entry => entry.residence === 'dorm_1');
const morningDorm1Residents = campus48.npcs.filter(npc => npc.schedule.morning.location === 'life_dorm_1');
assert.ok(morningDorm1Residents.length > 0 &&
  morningDorm1Residents.length < mergedDorm1Residents.length,
  `dorm 1 morning departures must be staggered instead of parking all residents at the entrance: ${morningDorm1Residents.length}/${mergedDorm1Residents.length}`);
assert.notEqual(campus48.npcs.find(npc => npc.npc_id === 'INKYUNG-NPC-031').schedule.morning.location, 'life_dorm_1',
  'odd-numbered dorm resident 031 should already have departed in the morning band');
assert.notEqual(campus48.npcs.find(npc => npc.npc_id === 'INKYUNG-NPC-035').schedule.morning.location, 'life_dorm_1',
  'odd-numbered dorm resident 035 should already have departed in the morning band');

const dorm1Positions = mergedDorm1Residents
  .map(entry => {
    const purposeful = purposeful48.get(entry.npc_id);
    const eveningEntry = purposeful?.schedule[3];
    const position = eveningEntry ? purposeful.destinations[eveningEntry.destination]?.position : null;
    assert.ok(position && expandedNavigator.walkable(position),
      `${entry.npc_id} needs a walkable spread dorm 1 anchor`);
    return { id: entry.npc_id, position };
  });
for (let a = 0; a < dorm1Positions.length; a++) {
  for (let b = a + 1; b < dorm1Positions.length; b++) {
    const first = dorm1Positions[a], second = dorm1Positions[b];
    const separation = Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z);
    assert.ok(separation >= 1.5,
      `dorm 1 anchors must stay separated: ${first.id}/${second.id} = ${separation.toFixed(2)}m`);
  }
}
const dorm2Purposeful = purposeful48.get('INKYUNG-NPC-008');
assert.equal(dorm2Purposeful.schedule[0].remote, true, 'Dorm 2 is an explicit remote residence transition');
assert.equal(dorm2Purposeful.controller.status().failures, 0);
const dorm2ToClass = dorm2Purposeful.controller.setScheduleIndex(1);
assert.equal(dorm2ToClass.failures, 0, 'Dorm 2 transfer re-enters the connected campus without route fabrication');
assert.equal(dorm2ToClass.phase, 'ACTING');
for (const npc of campus48.npcs.slice(20)) {
  const entry = merged.roster.npcs.find(row => row.npc_id === npc.npc_id);
  assert.ok(entry?.department && entry?.student_number && entry?.residence);
  assert.ok(npc.schedule.class_time.sink ? npc.schedule.class_time.location.startsWith('class_') :
    ['read','eat_snack','walk_to_club','use_phone','walk'].includes(npc.schedule.class_time.activity));
  assert.ok(expandedNavigator.walkable(positionAt(npc.schedule.class_time.location, Number(npc.npc_id.slice(-3)) % 9)));
}

const expandedBackMarket = campus48.npcs.filter(npc =>
  npc.schedule.lunch.location.startsWith('life_back_market_')).length;
const expandedDormEvening = campus48.npcs.filter(npc =>
  npc.schedule.evening.location.startsWith('life_dorm_')).length;
assert.ok(expandedBackMarket >= 8, `48-NPC population should use rear market at lunch: ${expandedBackMarket}`);
assert.ok(expandedDormEvening >= 12, `48-NPC population should include dorm residents: ${expandedDormEvening}`);

console.log('NPC P2-A population: 48 NPCs, 21+ department communities, campus/rear-market/dorm life PASS');
