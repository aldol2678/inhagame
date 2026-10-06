import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedNpcAuthorityConsumerP0 } from '../npc-factory/npc-shared-authority-consumer-p0.mjs';
import { SHARED_NPC_AUTHORITY_REVISION } from '../npc-factory/npc-shared-authority-p0.mjs';

const jsonResponse = (body, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  async json() { return body; }
});

function snapshot({ zone, revision, npcs = [] }) {
  return {
    authorityRevision: SHARED_NPC_AUTHORITY_REVISION,
    sourceRevision: 'ng2-campus-life-v3',
    revision,
    authoritativeTimeMs: 1760000000000 + revision * 250,
    period: 'morning',
    scheduleSlot: 1,
    scheduleIndex: 0,
    placeZoneId: zone,
    lodCounts: { ACTIVE: npcs.length, COARSE: 0, SLEEP: 2 - npcs.length },
    npcs: npcs.map(npc => ({
      id: npc.id,
      revision,
      placeZoneId: zone,
      phase: 'ACTING',
      position: npc.position,
      heading: npc.heading ?? 0,
      visible: true,
      moving: false,
      activity: 'RESTING',
      destination: 'c04.inkyung_waterfront.' + npc.id,
      scheduleIndex: 0,
      slot: 1,
      transfer: false,
      meetingId: null,
      meetingLocation: null,
      meetingPhase: null
    }))
  };
}

test('consumer exposes only the server snapshot for pilot NPCs and hides missing authority records', async () => {
  let zone = 'AREA_INKYUNG_STUDENT_CENTER';
  const calls = [];
  const consumer = createSharedNpcAuthorityConsumerP0({
    enabled: true,
    getPlaceZoneId: () => zone,
    now: () => 1000,
    fetcher: async url => {
      calls.push(url);
      return jsonResponse(snapshot({
        zone,
        revision: 7,
        npcs: [{ id: 'INKYUNG-NPC-003', position: { x: 12, z: 34 }, heading: 90 }]
      }));
    }
  });

  assert.deepEqual(consumer.stateFor('INKYUNG-NPC-003'),
    { authoritative: true, ready: false, visible: false, id: 'INKYUNG-NPC-003' });
  assert.equal(await consumer.sync({ force: true }), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /placeZoneId=AREA_INKYUNG_STUDENT_CENTER/);

  const three = consumer.stateFor('INKYUNG-NPC-003');
  assert.equal(three.ready, true);
  assert.equal(three.visible, true);
  assert.deepEqual(three.position, { x: 12, z: 34 });
  const twelve = consumer.stateFor('INKYUNG-NPC-012');
  assert.equal(twelve.ready, true);
  assert.equal(twelve.visible, false);
  assert.equal(consumer.stateFor('INKYUNG-NPC-021'), null);
});

test('zone change clears the old replica until a fresh snapshot arrives', async () => {
  let zone = 'AREA_MAIN_GATE';
  let revision = 10;
  const consumer = createSharedNpcAuthorityConsumerP0({
    enabled: true,
    getPlaceZoneId: () => zone,
    now: () => revision * 1000,
    fetcher: async () => jsonResponse(snapshot({
      zone,
      revision,
      npcs: [{ id: 'INKYUNG-NPC-012', position: { x: revision, z: 1 } }]
    }))
  });

  await consumer.sync({ force: true });
  assert.equal(consumer.stateFor('INKYUNG-NPC-012').visible, true);
  zone = 'AREA_INKYUNG_STUDENT_CENTER';
  revision += 1;
  assert.equal(consumer.stateFor('INKYUNG-NPC-012').ready, false);
  assert.equal(consumer.status().revision, -1);
  await consumer.sync({ force: true });
  assert.equal(consumer.stateFor('INKYUNG-NPC-012').placeZoneId, zone);
});

test('404 disables authority consumer so the existing local runtime can resume', async () => {
  const consumer = createSharedNpcAuthorityConsumerP0({
    enabled: true,
    getPlaceZoneId: () => 'AREA_MAIN_GATE',
    now: () => 1000,
    fetcher: async () => jsonResponse({}, 404)
  });
  assert.equal(await consumer.sync({ force: true }), false);
  assert.equal(consumer.status().enabled, false);
  assert.equal(consumer.status().lastError, 'DISABLED');
  assert.equal(consumer.stateFor('INKYUNG-NPC-003'), null);
});
