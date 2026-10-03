import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeCampusPopulation } from '../npc-factory/npc-campus-expansion.mjs';
import { campusLifeSeed, applyCampusLifeSchedule } from '../npc-factory/npc-campus-life-policy.mjs';
import { createPurposefulRoster } from '../npc-factory/purposeful-roster.mjs';
import { bindSharedSchedule, createSharedScheduleController } from '../npc-factory/npc-shared-schedule.mjs';
import { createSharedMeetings } from '../npc-factory/npc-shared-meetings.mjs';
import { positionAt } from '../npc-factory/dev-runtime-state.mjs';
import { NPC_WORLD_EPOCH_MS as E, NPC_WORLD_PERIOD_MS as P } from '../npc-factory/npc-world-time-contract.mjs';

const read = file => JSON.parse(readFileSync(new URL('../npc-factory/data/'+file, import.meta.url)));
const source = read('repaired/INKYUNG-20-A-R1.json');
const baseProfiles = read('fixtures/public-roster.json');
const expansion = read('expansion/CAMPUS-28-P2A.json');
const { batch, roster: profiles } = mergeCampusPopulation(source, baseProfiles, expansion);
// Straight-line fixture checks timeline contracts; the shared-campus test uses real collision routes.
const navigator = { walkable: () => true, route: (_from, to) => [{ ...to }] };

test('real population mixes class/free activities, preserves quest NPCs and is independent of input order', () => {
  const reversed = applyCampusLifeSchedule({ ...batch, npcs: [...batch.npcs].reverse() },
    { ...profiles, npcs: [...profiles.npcs].reverse() });
  for (const npc of batch.npcs) assert.deepEqual(reversed.npcs.find(n => n.npc_id === npc.npc_id), npc);
  for (const id of ['INKYUNG-NPC-001', 'INKYUNG-NPC-002'])
    assert.deepEqual(batch.npcs.find(n => n.npc_id === id), source.npcs.find(n => n.npc_id === id));
  const academic = batch.npcs.slice(2).filter(n => n.schedule.class_time.departureSeconds !== undefined);
  const classes = academic.filter(n => n.schedule.class_time.sink);
  assert.ok(classes.length / academic.length >= .4 && classes.length / academic.length <= .55);
  assert.deepEqual(new Set(academic.map(n => n.schedule.class_time.activity)),
    new Set(['walk_to_class','read','eat_snack','walk_to_club','use_phone','walk']));
  assert.ok(new Set(academic.map(n => n.schedule.class_time.departureSeconds)).size > 10);
  for (const npc of academic.filter(n => !n.schedule.class_time.sink))
    assert.ok(npc.dialogue_hooks.class_time.some(line => line.includes('수업이 없는 시간')));
  const npc = { ...academic[0], relationships: [{ target_id: 'A', type: 'friend' }, { target_id: 'B', type: 'clubmate' }] };
  const entry = profiles.npcs.find(p => p.npc_id === npc.npc_id);
  assert.equal(campusLifeSeed(npc, entry), campusLifeSeed({ ...npc, relationships: [...npc.relationships].reverse() }, entry));
  assert.notEqual(campusLifeSeed(npc, entry), campusLifeSeed({ ...npc, identity: { ...npc.identity, year_level: 9 } }, entry));
  assert.notEqual(campusLifeSeed(npc, entry), campusLifeSeed(npc, { ...entry, residence: 'different' }));
  assert.notEqual(campusLifeSeed(npc, entry), campusLifeSeed({ ...npc, relationships: [] }, entry));
});

test('classes sink at their own building and emerge on the next leg across two cycles and reload', () => {
  const a = bindSharedSchedule(createPurposefulRoster(batch, navigator), navigator, () => E);
  const b = bindSharedSchedule(createPurposefulRoster(batch, navigator), navigator, () => E);
  const attendees = [...a].filter(([, m]) => m.schedule[1].sink && m.schedule[1].activity === 'ACADEMIC');
  assert.ok(attendees.length > 10);
  for (let cycle = 0; cycle < 2; cycle++) for (const [id, member] of attendees) {
    const at = E + (cycle*5+1)*P + 899_000;
    const s = member.controller.sample(at);
    assert.equal(s.visible, false, id);
    assert.equal(s.activity, 'ACADEMIC');
    assert.ok(member.destinations[s.destination].label !== '구역 경계');
    assert.deepEqual(s, b.get(id).controller.sample(at));
    assert.equal(member.controller.sample(E+(cycle*5+2)*P).visible, true, id+' emerges at class exit');
  }
});

test('staggered departure keeps the previous sink hidden; walk excursions return continuously before the next band', () => {
  const destinations = Object.fromEntries([0,1,2,3,4].map(i => ['d'+i, { position: { x: i*10, z: 0 } }]));
  const schedule = [0,1,2,3,4].map(i => ({ destination:'d'+i, activity:'WALK_BREAK' }));
  schedule[0].sink = true;
  schedule[1] = { ...schedule[1], departureSeconds:5, walkDestination:'d2' };
  const make = () => createSharedScheduleController({id:'fixture',schedule,destinations,navigator,speed:1,now:()=>E});
  const a = make();
  assert.equal(a.sample(E+P+4999).visible, false);
  assert.equal(a.sample(E+P+5000).visible, true);
  assert.deepEqual(a.sample(E+P+16_000).position, {x:11,z:0});
  assert.deepEqual(a.sample(E+P+46_000).position, {x:19,z:0});
  for (const seconds of [5,15,25,45,55,75,855,899.999]) {
    const ms=E+P+seconds*1000, s=a.sample(ms), next=a.sample(ms+1);
    assert.ok(Math.hypot(s.position.x-next.position.x,s.position.z-next.position.z)<=.00101);
    assert.deepEqual(s,make().sample(ms));
  }
  assert.deepEqual(a.sample(E+P+899_000).position, {x:10,z:0});
  assert.deepEqual(a.sample(E+2*P).position, {x:10,z:0});
  schedule[1].departureSeconds = -1;
  assert.throws(()=>make().sample(E+P),/Invalid shared NPC departure/);
  schedule[1].departureSeconds = 5;
  schedule[0].remote = true;
  assert.equal(make().sample(E+P+1000).moving, true, 'remote re-entry still permits the outdoor excursion');
});

test('class-time meetings admit free NPCs while excluding class attendees and continuous walks', () => {
  const roster = bindSharedSchedule(createPurposefulRoster(batch,navigator),navigator,()=>E+P+300_000);
  const free = [...roster].filter(([,m]) => !m.schedule[1].sink && !m.schedule[1].walkDestination &&
    !m.controller.sample(E+P+420_000).transfer && !m.controller.sample(E+P+420_000).moving &&
    m.destinations[m.schedule[1].destination].label === '학생회관');
  assert.ok(free.length >= 2);
  const classId = [...roster].find(([,m])=>m.schedule[1].sink && m.schedule[1].activity==='ACADEMIC')[0];
  const ids = [free[0][0],free[1][0],classId];
  const center = free[0][1].destinations[free[0][1].schedule[1].destination].position;
  const meetings = createSharedMeetings({batch,profiles,roster,navigator,now:()=>E+P+300_000,
    // Isolate permission/lifecycle from the real campus crowd's available meetup capacity.
    positionAtFn: () => ({x:center.x+12,z:center.z}),
    groups:[{groupId:'fixture',status:'ACTIVE',meetingPlaceRef:'life_student_center',memberNpcIds:ids,cohesion:20}]});
  const plans = meetings.plans(1);
  assert.ok(plans.length > 0, 'free-time peers can meet during the class band');
  for (const p of plans) {
    assert.ok(p.members.length >= 2);
    assert.ok(!p.members.some(m=>m.id===classId));
  }
});

test('teaching-area dwell reservations spread in two dimensions without slot wraparound', () => {
  const points = Array.from({length:12},(_,i)=>positionAt('class_building_5',i));
  for(let i=0;i<points.length;i++) for(let j=i+1;j<points.length;j++)
    assert.ok(Math.hypot(points[i].x-points[j].x,points[i].z-points[j].z)>=1.6);
  const [a,b,c] = points;
  assert.ok(Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))>.5, 'dwell points do not collapse onto one centerline');
});
