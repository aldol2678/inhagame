import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/npc-shared-state.js';
import { createCampusSharedNpcAuthorityP0, SHARED_NPC_P0_IDS } from '../npc-factory/npc-shared-authority-server.mjs';
import {
  SHARED_NPC_AUTHORITY_REVISION,
  SHARED_NPC_LOD
} from '../npc-factory/npc-shared-authority-p0.mjs';
import { createSharedNpcReplicaP0 } from '../npc-factory/npc-shared-replica-p0.mjs';
import {
  NPC_WORLD_EPOCH_MS as E,
  NPC_WORLD_PERIOD_MS as P
} from '../npc-factory/npc-world-time-contract.mjs';

function fakeResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

test('P0 authority quantizes canonical time and two replicas converge on the same shared snapshot', () => {
  const authority = createCampusSharedNpcAuthorityP0();
  assert.deepEqual(authority.ids, SHARED_NPC_P0_IDS);

  let observed = null;
  for (let seconds = 0; seconds < 5 * P / 1000 && !observed; seconds += 30) {
    const inspection = authority.evaluate({ serverNowMs: E + seconds * 1000 });
    observed = inspection.records.find(record => record.placeZoneId && record.state.visible);
  }
  assert.ok(observed, 'pilot NPC must be visible in at least one canonical period');

  const raw = E + 123_500;
  const a = authority.snapshot({ placeZoneId: observed.placeZoneId, serverNowMs: raw + 1 });
  const b = authority.snapshot({ placeZoneId: observed.placeZoneId, serverNowMs: raw + 249 });
  assert.deepEqual(a, b, '250ms authority tick removes request-time browser drift');
  assert.equal(a.authorityRevision, SHARED_NPC_AUTHORITY_REVISION);

  const first = createSharedNpcReplicaP0();
  const second = createSharedNpcReplicaP0();
  assert.equal(first.applySnapshot(a), true);
  assert.equal(second.applySnapshot(a), true);
  assert.deepEqual(first.status(), second.status());
});

test('P0 server owns ACTIVE / COARSE / SLEEP and interest snapshots expose only ACTIVE NPCs', () => {
  const authority = createCampusSharedNpcAuthorityP0();
  let activeCase = null, coarseCase = null, sleepCase = null;

  for (let seconds = 0; seconds < 5 * P / 1000 && (!activeCase || !coarseCase || !sleepCase); seconds += 15) {
    const at = E + seconds * 1000;
    const none = authority.evaluate({ serverNowMs: at });
    coarseCase ??= none.records.find(record => record.lod === SHARED_NPC_LOD.COARSE);
    sleepCase ??= none.records.find(record => record.lod === SHARED_NPC_LOD.SLEEP);
    const visible = none.records.find(record => record.placeZoneId && record.state.visible);
    if (visible) {
      const observed = authority.evaluate({ placeZoneId: visible.placeZoneId, serverNowMs: at });
      const record = observed.records.find(item => item.id === visible.id);
      if (record?.lod === SHARED_NPC_LOD.ACTIVE)
        activeCase = { at, zone: visible.placeZoneId, id: visible.id };
    }
  }

  assert.ok(activeCase, 'observer zone must promote a visible NPC to ACTIVE');
  assert.ok(coarseCase, 'moving/shared continuity must produce COARSE without an observer');
  assert.ok(sleepCase, 'resting non-observed NPC must enter SLEEP');

  const snapshot = authority.snapshot({ placeZoneId: activeCase.zone, serverNowMs: activeCase.at });
  assert.ok(snapshot.npcs.some(npc => npc.id === activeCase.id));
  assert.ok(snapshot.npcs.every(npc => npc.placeZoneId === activeCase.zone));
  assert.equal(snapshot.npcs.some(npc => 'dialogue' in npc || 'memory' in npc || 'reward' in npc), false);
  assert.equal(snapshot.lodCounts.ACTIVE + snapshot.lodCounts.COARSE + snapshot.lodCounts.SLEEP, SHARED_NPC_P0_IDS.length);
});

test('replica rejects stale/duplicate revisions and reconnect reset accepts a fresh authoritative snapshot', () => {
  const authority = createCampusSharedNpcAuthorityP0();
  const inspection = authority.evaluate({ serverNowMs: E + 120_000 });
  const zone = inspection.records.find(record => record.placeZoneId)?.placeZoneId;
  assert.ok(zone);

  const older = authority.snapshot({ placeZoneId: zone, serverNowMs: E + 120_000 });
  const newer = authority.snapshot({ placeZoneId: zone, serverNowMs: E + 121_000 });
  assert.ok(newer.revision > older.revision);

  const replica = createSharedNpcReplicaP0();
  assert.equal(replica.applySnapshot(older), true);
  assert.equal(replica.applySnapshot(older), false);
  assert.equal(replica.applySnapshot(newer), true);
  assert.equal(replica.applySnapshot(older), false);
  assert.equal(replica.status().revision, newer.revision);

  replica.reset();
  assert.equal(replica.status().revision, -1);
  assert.equal(replica.applySnapshot(newer), true);
  assert.equal(replica.status().revision, newer.revision);
});

test('feature-gated read-only API rejects invalid requests and returns the authoritative snapshot when enabled', async () => {
  const previous = process.env.NPC_SHARED_AUTHORITY_P0;
  try {
    delete process.env.NPC_SHARED_AUTHORITY_P0;
    let res = fakeResponse();
    await handler({ method: 'GET', query: { placeZoneId: 'AREA_MAIN_GATE' } }, res);
    assert.equal(res.statusCode, 404);

    process.env.NPC_SHARED_AUTHORITY_P0 = '1';
    res = fakeResponse();
    await handler({ method: 'POST', query: { placeZoneId: 'AREA_MAIN_GATE' } }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'GET');

    res = fakeResponse();
    await handler({ method: 'GET', query: { placeZoneId: 'bad-zone' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'INVALID_SHARED_NPC_PLACE_ZONE');

    res = fakeResponse();
    await handler({ method: 'GET', query: { placeZoneId: 'AREA_INKYUNG_STUDENT_CENTER' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.authorityRevision, SHARED_NPC_AUTHORITY_REVISION);
    assert.equal(res.body.placeZoneId, 'AREA_INKYUNG_STUDENT_CENTER');
    assert.ok(Array.isArray(res.body.npcs));
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  } finally {
    if (previous === undefined) delete process.env.NPC_SHARED_AUTHORITY_P0;
    else process.env.NPC_SHARED_AUTHORITY_P0 = previous;
  }
});
