// The public package carries no private human review or approval evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateDevRoster } from './dev-appearance.mjs';
const bytes=readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json',import.meta.url));
const fixture=JSON.parse(readFileSync(new URL('./data/fixtures/public-fixture.json',import.meta.url)));
const roster=JSON.parse(readFileSync(new URL('./data/fixtures/public-roster.json',import.meta.url)));
const hash=createHash('sha256').update(bytes).digest('hex');
assert.equal(fixture.kind,'SYNTHETIC_PUBLIC_QA');
assert.equal(fixture.human_approval,false);
assert.equal(fixture.candidate_sha256,hash);
assert.equal(fixture.npc_count,20);
assert.match(roster.provenance,/SYNTHETIC_PUBLIC_QA/);
assert.equal(validateDevRoster(JSON.parse(bytes),roster,hash).npcs.length,20);
assert.throws(()=>validateDevRoster(JSON.parse(bytes),roster,'changed'));
assert.equal(new Set(roster.npcs.map(n=>n.npc_id)).size,20);
assert.ok(roster.npcs.filter(n=>n.student_number).every(n=>n.student_number.startsWith('SIM-')));
console.log('Synthetic public NPC fixture: integrity, coverage, no human approval claim PASS');
