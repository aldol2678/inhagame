import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PERIODS} from './vocabulary.mjs';
import {validateBatch} from './validate.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'data/quality-report.json'), 'utf8'));
const sourcePath = path.join(root, 'data/validated/INKYUNG-20-A.json');
const rawPath = path.join(root, 'data/raw/INKYUNG-20-A.json');
const sourceBytes = fs.readFileSync(sourcePath);
assert.equal(sha(sourceBytes), baseline.batches[0].validated_sha256, 'A baseline hash changed');
assert.ok(sourceBytes.equals(fs.readFileSync(rawPath)), 'A RAW and VALIDATED diverged');
const source = JSON.parse(sourceBytes);
const replacement = JSON.parse(fs.readFileSync(path.join(root, 'data/repair-a-r1-dialogue.json'), 'utf8'));
const candidate = structuredClone(source);
assert.deepEqual(Object.keys(replacement).sort(), source.npcs.map(n => n.npc_id).sort(), 'replacement must cover exact A NPC IDs');
const changes = [];
for (const npc of candidate.npcs) {
  const proposed = replacement[npc.npc_id];
  assert.deepEqual(Object.keys(proposed).sort(), [...PERIODS].sort());
  for (const period of PERIODS) {
    assert.equal(proposed[period].length, 2, 'exact two hooks per period');
    for (let i = 0; i < 2; i++) {
      const before = npc.dialogue_hooks[period][i];
      const after = proposed[period][i];
      assert.notEqual(after, before, `${npc.npc_id}/${period}/${i} unchanged`);
      npc.dialogue_hooks[period][i] = after;
      changes.push({path: `npcs/${npc.npc_id}/dialogue_hooks/${period}/${i}`,before,after});
    }
  }
}
assert.equal(changes.length, 160);
const validation = validateBatch(candidate);
assert.equal(validation.status, 'PASS', validation.errors.join('\n'));
const hooks = batch => batch.npcs.flatMap(n => PERIODS.flatMap(p => n.dialogue_hooks[p]));
const originalHooks = hooks(source), repairedHooks = hooks(candidate);
const otherHooks = new Set(['B', 'C'].flatMap(letter => hooks(JSON.parse(fs.readFileSync(path.join(root, `data/validated/INKYUNG-20-${letter}.json`), 'utf8')))));
const originalOverlap = originalHooks.filter(h => otherHooks.has(h)).length;
const repairedOverlap = repairedHooks.filter(h => otherHooks.has(h)).length;
const originalInternalRepeats = originalHooks.length - new Set(originalHooks).size;
const repairedInternalRepeats = repairedHooks.length - new Set(repairedHooks).size;
assert.equal(repairedInternalRepeats, 0, 'A candidate still repeats an A hook');
assert.equal(repairedOverlap, 0, 'A candidate still repeats a B/C hook');

// Only dialogue may differ. No ID, identity, schedule, relationship, or capability repair is implied.
const stripped = value => value.npcs.map(n => { const copy = structuredClone(n); delete copy.dialogue_hooks; return copy; });
assert.deepEqual(stripped(candidate), stripped(source));
assert.equal(candidate.batch_id, source.batch_id);
const outputBytes = Buffer.from(JSON.stringify(candidate, null, 2) + '\n');
const outputPath = path.join(root, 'data/repaired/INKYUNG-20-A-R1.json');
fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, outputBytes, {flag: 'wx'});
const report = {
  status: 'CANDIDATE · HUMAN REVIEW NOT RUN',
  source: 'data/validated/INKYUNG-20-A.json', source_sha256: sha(sourceBytes),
  repaired: 'data/repaired/INKYUNG-20-A-R1.json', repaired_sha256: sha(outputBytes),
  changed_field_count: changes.length, changed_field_scope: 'dialogue_hooks only',
  deterministic_validator: validation.status,
  original_A_internal_duplicate_occurrences: originalInternalRepeats,
  repaired_A_internal_duplicate_occurrences: repairedInternalRepeats,
  original_A_hooks_also_in_B_or_C: originalOverlap,
  repaired_A_hooks_also_in_B_or_C: repairedOverlap,
  human_review: 'NOT RUN', human_edit_rate: null,
  findings: [
    'All 160 A dialogue hooks were rewritten. Exact equality reduction does not prove naturalness or distinctiveness.',
    'Schedule and archetype plausibility remain outside this dialogue-only repair. Human review should examine IDs 003, 005, 012, 014 and 018 for role/activity fit.',
    'Original A/B/C Phase A files and hashes remain unchanged. Phase B baseline remains the original validated A/B/C unless a later authority explicitly selects this candidate.'
  ]
};
fs.writeFileSync(path.join(root, 'data/repair-a-r1-report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
fs.writeFileSync(path.join(root, 'data/repair-a-r1-change-log.json'), JSON.stringify(changes, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(report, null, 2));
