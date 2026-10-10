import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldResumeStore, validateResumeRecord, WORLD_RESUME_VERSION, worldResumeStorageKey } from '../src/lobby/world-resume.js';
import { WORLD_REGION_ID } from '../src/regions/world-region-registry.js';
import { createSpawnRegistry, SPAWN_ID } from '../src/lobby/spawn-registry.js';

const pose = (x = 0, z = 75) => ({ version: WORLD_RESUME_VERSION, regionId: WORLD_REGION_ID.BIRYONG_REALM,
  x, y: 1.15, z, yawDeg: 47, cameraYaw: .8, savedAt: 10_000 });
const memoryStorage = () => { const data = new Map(); return { data, getItem: k => data.get(k) ?? null,
  setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; };
const save = (store, extra = {}) => store.maybeSave({ position: pose(), regionId: WORLD_REGION_ID.BIRYONG_REALM,
  place: { id: 'BR_MARKET', displayName: 'untrusted name' }, grounded: true, yawDeg: 47, cameraYaw: .8, ...extra });

test('Biryong resume resolves its own ground, collision and place contract', () => {
  const result = validateResumeRecord(pose());
  assert.equal(result.state, 'VALID');
  assert.equal(result.record.regionId, WORLD_REGION_ID.BIRYONG_REALM);
  assert.equal(result.record.zoneId, 'BR_MARKET');
  assert.equal(result.record.displayName, '중앙시장 · 창고거리');
  assert.equal(result.record.cameraYaw, .8);
  assert.equal(validateResumeRecord(pose(), { expectedRegionId: WORLD_REGION_ID.CAMPUS }).state, 'INVALID');
});

for (const [name, override] of Object.entries({
  building: { x: -24, z: 58 }, outOfBounds: { x: 71 }, airborne: { y: 5 },
  neutralApproach: { z: 51 }, futureRegion: { z: 136 }, unknownRegion: { regionId: 'FUTURE' },
  nonnumeric: { x: 'bad' }, missingX: { x: null }, booleanZ: { z: false }
})) test(`Biryong resume rejects ${name}`, () => {
  assert.equal(validateResumeRecord({ ...pose(), ...override }).state, 'INVALID');
});

test('Biryong resume persists per account without making the station a permanent spawn', () => {
  const storage = memoryStorage();
  const store = createWorldResumeStore({ storage, scope: 'A', clock: { now: () => 10_000 }, saveIntervalMs: 0 });
  assert.equal(save(store), true);
  assert.equal(store.read().record.zoneId, 'BR_MARKET');
  const before = storage.getItem(worldResumeStorageKey('A'));
  store.setScope('B');
  assert.equal(store.read().state, 'MISSING');
  store.setScope('guest');
  assert.equal(store.read().state, 'MISSING');
  store.setScope('A');
  assert.equal(store.read().record.regionId, WORLD_REGION_ID.BIRYONG_REALM);
  assert.equal(storage.getItem(worldResumeStorageKey('A')), before);
  const station = createSpawnRegistry().get(SPAWN_ID.BIRYONG_STATION);
  assert.equal(station.visible, false);
  assert.equal(station.canStart, false);
  assert.equal(station.allowResume, false);
});

for (const extra of [{ grounded: false }, { mounted: true }, { insideRoom: true }, { enabled: false },
  { transitioning: true }, { inCombat: true }]) test(`Biryong save excludes ${JSON.stringify(extra)}`, () => {
  const storage = memoryStorage();
  const store = createWorldResumeStore({ storage, clock: { now: () => 10_000 }, saveIntervalMs: 0 });
  assert.equal(save(store, extra), false);
  assert.equal(storage.data.size, 0);
});
