import assert from 'node:assert/strict';
import { createLocalQuestStore } from './quest-store.mjs';
import { QUEST_ID } from './quest-contract.mjs';
import {
  MAIN2_QUEST_ID,
  MAIN2_QUEST_OBJECTIVES,
  nextMain2QuestStage
} from './main2-quest-contract.mjs';
import { createMain2QuestClient } from './main2-quest-client.mjs';
import { BACK_GATE_SPAWN } from '../src/campus-spawn.js';
import { FIVE, FIVE_SOUTH_ENTRY_APPROACH } from '../src/north-campus-layout.js';

assert.equal(nextMain2QuestStage(0, 'start', { available: false }), 0);
assert.equal(nextMain2QuestStage(0, 'start', { available: true }), 1);
assert.equal(nextMain2QuestStage(1, 'set_building5_destination'), 2);
assert.equal(nextMain2QuestStage(2, 'start_auto_building5'), 3);
assert.equal(nextMain2QuestStage(3, 'pause_auto_building5'), 4);
assert.equal(nextMain2QuestStage(4, 'resume_auto_building5'), 5);
assert.equal(nextMain2QuestStage(5, 'visit_building5'), 6);
assert.equal(nextMain2QuestStage(6, 'set_back_gate_destination'), 7);
assert.equal(nextMain2QuestStage(7, 'start_auto_back_gate'), 8);
assert.equal(nextMain2QuestStage(8, 'visit_back_gate'), 9);
assert.equal(MAIN2_QUEST_OBJECTIVES[9], '길찾기 익히기 완료');

const store = createLocalQuestStore();
let main2 = await store('player-a', 'status', MAIN2_QUEST_ID);
assert.deepEqual(main2, { quest_id: MAIN2_QUEST_ID, stage: 0, available: false });
assert.equal((await store('player-a', 'start', MAIN2_QUEST_ID)).stage, 0);

for (const event of ['start','visit_main_hall','visit_inkyung','talk_002','talk_001'])
  await store('player-a', event, QUEST_ID);
main2 = await store('player-a', 'status', MAIN2_QUEST_ID);
assert.equal(main2.available, true);
assert.equal(main2.stage, 0);

const refreshStore = createLocalQuestStore();
const refreshClient = createMain2QuestClient({
  enabled: true,
  endpoint: '/npc-quest',
  getSession: async () => 'token',
  fetcher: async (_url, options) => {
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => refreshStore('player-refresh', body.event, body.quest_id) };
  }
});
await refreshClient.setSignedIn(true);
assert.equal(refreshClient.status().available, false);
for (const event of ['start','visit_main_hall','visit_inkyung','talk_002','talk_001'])
  await refreshStore('player-refresh', event, QUEST_ID);
await refreshClient.refresh();
assert.equal(refreshClient.status().available, true, 'Main 2 availability refreshes after Main 1 completion');

const hudObjective = { textContent: '' };
const hud = { hidden: true, querySelector: () => hudObjective };
const client = createMain2QuestClient({
  enabled: true,
  endpoint: '/npc-quest',
  getSession: async () => 'token',
  hud,
  fetcher: async (_url, options) => {
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => store('player-a', body.event, body.quest_id) };
  }
});

await client.setSignedIn(true);
assert.equal(client.status().available, true);
assert.equal(client.stage, 0);
assert.equal(hud.hidden, false, 'Main 2 HUD is visible before the guide starts it');
assert.equal(hudObjective.textContent, '후문 안내 학생과 대화');
assert.equal(client.mapTarget()?.kind, 'quest-npc');
assert.match(client.mapTarget()?.label ?? '', /안내 학생/);

client.observePlace('AREA_BACK_GATE', { x: BACK_GATE_SPAWN.x, z: BACK_GATE_SPAWN.z });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(client.stage, 0, 'back-gate proximity no longer starts Main 2 silently');
assert.equal((await client.startFromGuide()).stage, 1);
assert.equal(hud.hidden, false);
assert.equal(hudObjective.textContent, '지도에서 5호관을 목적지로 설정');

client.observeNavigation({ active: true, destination: { poiId: 'poi.building-5' } });
client.observeAutoMove({ active: true, destinationId: 'poi:poi.building-5' }, 'ready');
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(client.stage, 3, 'same-click destination + auto-move is queued in order');

client.observeAutoMove({ active: false, destinationId: 'poi:poi.building-5' }, 'pause');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(client.stage, 4, 'manual pause is taught before arrival');
client.observeAutoMove({ active: true, destinationId: 'poi:poi.building-5' }, 'resume');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(client.stage, 5, 'resume is taught before arrival');

const five = client.mapTarget();
assert.deepEqual(
  { x: five.x, z: five.z },
  { x: FIVE_SOUTH_ENTRY_APPROACH.x, z: FIVE_SOUTH_ENTRY_APPROACH.z },
  'Main 2 points at the walkable 5th-building entrance'
);
assert.ok(Math.hypot(five.x - FIVE.center.x, five.z - FIVE.center.z) > 1,
  'Main 2 never asks the player to enter the solid building footprint');
client.observePlace('AREA_BUILDING_5_WEST', { x: five.x, z: five.z });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(client.stage, 6);

client.observeNavigation({ active: true, destination: { poiId: 'poi.back-gate' } });
client.observeAutoMove({ active: true, destinationId: 'poi:poi.back-gate' }, 'ready');
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(client.stage, 8, 'same-click return destination + auto-move is queued before arrival');

const gate = client.mapTarget();
client.observePlace('AREA_BACK_GATE', { x: gate.x, z: gate.z });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(client.stage, 9);
assert.equal(client.status().complete, true);
assert.equal(hud.hidden, true);

const recoveryStore = createLocalQuestStore();
for (const event of ['start','visit_main_hall','visit_inkyung','talk_002','talk_001'])
  await recoveryStore('player-recovery', event, QUEST_ID);
for (const event of ['start','set_building5_destination','start_auto_building5','pause_auto_building5'])
  await recoveryStore('player-recovery', event, MAIN2_QUEST_ID);
const recoveryClient = createMain2QuestClient({
  enabled: true,
  endpoint: '/npc-quest',
  getSession: async () => 'token',
  fetcher: async (_url, options) => {
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => recoveryStore('player-recovery', body.event, body.quest_id) };
  }
});
await recoveryClient.setSignedIn(true);
assert.equal(recoveryClient.stage, 4, 'persisted pause stage survives reconnect while Auto Move session does not');
recoveryClient.observeAutoMove({ active: true, destinationId: 'poi:poi.building-5' }, 'ready');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(recoveryClient.stage, 5,
  'starting the same Building 5 route after reconnect recovers the persisted resume step');


console.log('World Main 2 navigation + auto-move quest: PASS');
