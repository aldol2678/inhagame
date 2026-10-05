import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { FISHING_SPOTS, FISHING_SPOT_RADIUS } from '../src/activity/fishing-spots.js';
import { createFishingService, createFishingRpc } from '../server/fishing-service.mjs';

test('server spot geometry matches the actual canonical world shore points', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261005021000_world_fishing_f3_trusted_presence.sql', import.meta.url), 'utf8');
  const seeded = [...sql.matchAll(/\('(fishing\.inkyung\.[^']+)',([\d.-]+),([\d.-]+),(\d+),(-?\d+),(\d+)\)/g)];
  assert.equal(seeded.length, FISHING_SPOTS.length);
  for (const [, source, x, z, radius, minY, maxY] of seeded) {
    const spot = FISHING_SPOTS.find(value => value.sourceRef === source);
    assert.ok(spot);
    assert.equal(Number(x), spot.position.x);
    assert.equal(Number(z), spot.position.z);
    assert.equal(Number(radius), FISHING_SPOT_RADIUS);
    assert.ok(Number(minY) <= 0 && Number(maxY) >= 0, 'standing shore height fits the server range');
  }
});

test('the player API cannot publish or supply authoritative position evidence', async () => {
  const service = createFishingService({ verifyUser: () => randomUUID(), rpc: () => assert.fail('RPC must not run') });
  const start = { op: 'start', activityId: 'activity.fishing.inkyung', sourceRef: FISHING_SPOTS[0].sourceRef, clientAttemptKey: randomUUID() };
  for (const body of [{ op: 'observe_position' }, ...['position', 'x', 'y', 'z', 'sessionId', 'revision', 'observedAt', 'mode', 'space'].map(field => ({ ...start, [field]: 0 }))]) {
    await assert.rejects(service('Bearer verified', body), error => error.status === 400 && error.message === 'INVALID_REQUEST');
  }
});

test('position and occupancy failures expose safe retryable errors', async () => {
  for (const message of ['FISHING_POSITION_UNAVAILABLE', 'FISHING_POSITION_STALE', 'FISHING_POSITION_INELIGIBLE',
    'FISHING_OUT_OF_RANGE', 'FISHING_SPOT_OCCUPIED', 'FISHING_LEASE_LOST', 'FISHING_SESSION_CHANGED']) {
    const rpc = createFishingRpc({ url: 'https://configured.example', serviceKey: 'server-secret',
      fetcher: async () => ({ ok: false, json: async () => ({ message, details: 'private coordinates and server-secret' }) }) });
    await assert.rejects(rpc('world_fishing_start_v1', {}), error => error.status === 409 && error.message === message);
  }
});
