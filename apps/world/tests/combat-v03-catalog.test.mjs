import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_ACTION_SLOTS,
  COMBAT_GEAR_SLOTS,
  COMBAT_JOB_CATALOG,
  COMBAT_SET_CATALOG,
  COMBAT_V03_PROTOTYPE,
  combatV03Summary
} from '../src/combat/combat-v03-catalog.js';

test('Combat v0.3 preserves the v9.22 six-action loadout contract', () => {
  assert.deepEqual(COMBAT_ACTION_SLOTS, [
    'basic', 'active_1', 'active_2', 'active_3', 'dodge', 'ultimate'
  ]);
  assert.equal(COMBAT_V03_PROTOTYPE.activeLoadoutSize, 3);
  assert.equal(COMBAT_V03_PROTOTYPE.ultimateLoadoutSize, 1);
});

test('Combat v0.3 preserves four jobs with 8 active skills, 2 ultimates and 3x5 trait trees each', () => {
  for (const [jobId, entry] of Object.entries(COMBAT_JOB_CATALOG)) {
    assert.equal(entry.id, jobId);
    assert.equal(entry.activeSkills.length, 8, `${jobId} active skill count`);
    assert.equal(new Set(entry.activeSkills).size, 8, `${jobId} active skill ids unique`);
    assert.equal(entry.ultimates.length, 2, `${jobId} ultimate count`);
    assert.equal(new Set(entry.ultimates).size, 2, `${jobId} ultimate ids unique`);
    assert.equal(entry.traitLines.length, 3, `${jobId} trait line count`);
    for (const line of entry.traitLines) {
      assert.equal(line.nodes.length, 5, `${jobId}/${line.id} node count`);
      assert.equal(new Set(line.nodes).size, 5, `${jobId}/${line.id} node ids unique`);
    }
  }
  assert.equal(COMBAT_V03_PROTOTYPE.traitPointCap, 8);
});

test('Combat v0.3 gear catalog preserves 8 slots and four 2/3/4-piece set families', () => {
  assert.deepEqual(COMBAT_GEAR_SLOTS, [
    'weapon', 'helmet', 'armor', 'gloves', 'boots', 'accessory', 'core', 'module'
  ]);
  for (const entry of Object.values(COMBAT_SET_CATALOG)) {
    assert.equal(entry.pieces.length, 4);
    assert.deepEqual(entry.breakpoints, [2, 3, 4]);
  }
  assert.equal(COMBAT_V03_PROTOTYPE.enhancementCap, 20);
});

test('Combat v0.3 catalog summary matches the v9.22 prototype evidence', () => {
  assert.deepEqual(combatV03Summary(), {
    jobs: 4,
    activeSkills: 32,
    ultimates: 8,
    traitLines: 12,
    traitNodes: 60,
    gearSlots: 8,
    gearSets: 4
  });
});

test('Combat v0.3 prototype provenance is immutable and pinned by SHA-256', () => {
  assert.match(COMBAT_V03_PROTOTYPE.sha256, /^[0-9a-f]{64}$/);
  assert.equal(COMBAT_V03_PROTOTYPE.filename, 'inha_world_combat_v9_22_opus_combat_polish.html');
  assert.ok(Object.isFrozen(COMBAT_V03_PROTOTYPE));
  assert.ok(Object.isFrozen(COMBAT_JOB_CATALOG));
  assert.ok(Object.isFrozen(COMBAT_GEAR_SLOTS));
  assert.ok(Object.isFrozen(COMBAT_SET_CATALOG));
});
