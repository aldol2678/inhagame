import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PERIODS} from './vocabulary.mjs';
import {validateBatch} from './validate.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const countExtras = values => values.length - new Set(values).size;
const key = values => [...values].sort().join('|');
const records = [];
const batches = [];
let validationMs = 0;
for (const letter of ['A', 'B', 'C']) {
  const raw = fs.readFileSync(path.join(root, `data/raw/INKYUNG-20-${letter}.json`));
  const validated = fs.readFileSync(path.join(root, `data/validated/INKYUNG-20-${letter}.json`));
  if (!raw.equals(validated)) throw new Error(`${letter}: RAW/VALIDATED bytes differ; record repair provenance before proceeding`);
  const batch = JSON.parse(validated);
  const start = performance.now(); const result = validateBatch(batch); validationMs += performance.now() - start;
  if (result.status !== 'PASS') throw new Error(`${letter}: ${result.errors.join(', ')}`);
  batches.push({batch_id: batch.batch_id, npc_count: batch.npcs.length, raw_sha256: sha(raw), validated_sha256: sha(validated), validator_status: result.status});
  records.push(...batch.npcs.map(npc => ({batch_id: batch.batch_id, npc})));
}
const all = records.map(r => r.npc);
const hooks = all.flatMap(n => PERIODS.flatMap(p => n.dialogue_hooks[p]));
const schedules = all.map(n => PERIODS.map(p => `${n.schedule[p].location}:${n.schedule[p].activity}:${n.schedule[p].social_mode}`).join('|'));
const traitSets = all.map(n => key(n.personality.traits));
const interestSets = all.map(n => key(n.interests));
const byArchetype = Object.fromEntries([...new Set(all.map(n => n.archetype))].map(type => [type, {
  npc_count: all.filter(n => n.archetype === type).length,
  distinct_schedule_signatures: new Set(all.filter(n => n.archetype === type).map(n => PERIODS.map(p => `${n.schedule[p].location}:${n.schedule[p].activity}`).join('|'))).size,
  distinct_trait_combinations: new Set(all.filter(n => n.archetype === type).map(n => key(n.personality.traits))).size
}]));
const suspiciousRelationship = records.filter(({npc}) => npc.relationships.length && !PERIODS.some(p => npc.schedule[p].activity === 'talk_with_friend')).map(({batch_id, npc}) => `${batch_id}/${npc.npc_id}`);
const metrics = {
  batch_success_rate: 1, json_parse_rate: 1, schema_pass_rate: 1,
  npc_count: all.length, dialogue_hook_count: hooks.length,
  critical_contract_violation_count: 0, invalid_location_count: 0, invalid_activity_count: 0, broken_relationship_count: 0,
  exact_duplicate_dialogue_count: countExtras(hooks), duplicate_dialogue_rate: countExtras(hooks) / hooks.length,
  repeated_trait_combinations: countExtras(traitSets), repeated_interest_combinations: countExtras(interestSets),
  repeated_schedule_signatures: countExtras(schedules), duplicate_schedule_rate: countExtras(schedules) / schedules.length,
  duplicate_name_count: countExtras(all.map(n => n.identity.name)),
  schedule_contradiction_rate: 0, dialogue_contradiction_rate: 0,
  validator_time_ms_total: Number(validationMs.toFixed(2)),
  generation_time_ms: null, human_edit_rate: null, manual_baseline_time: null,
  review_artifact_status: 'PREPARED · HUMAN REVIEW NOT RUN', runtime_import_status: 'SEE RUNTIME SPIKE', jev_gate_status: 'BLOCKED · MCP NOT CONNECTED'
};
const findings = [
  {code: 'HEURISTIC_LIMIT', detail: 'Dialogue contradictions are checked by bounded keywords and location anchors. Semantic naturalness, stereotype risk, and undisclosed real-person resemblance require human review.'},
  {code: 'RELATIONSHIP_SOCIAL_ACTIVITY', count: suspiciousRelationship.length, sample: suspiciousRelationship.slice(0, 10), detail: 'NPCs with relationship candidates but no talk_with_friend activity. A relationship need not imply same-day conversation; review only.'}
];
if (metrics.exact_duplicate_dialogue_count) findings.push({code: 'DUPLICATE_DIALOGUE', count: metrics.exact_duplicate_dialogue_count});
if (metrics.repeated_schedule_signatures) findings.push({code: 'DUPLICATE_SCHEDULE', count: metrics.repeated_schedule_signatures});
if (metrics.duplicate_name_count) findings.push({code: 'DUPLICATE_NAME', count: metrics.duplicate_name_count});
const report = {source: 'RAW byte-identical to VALIDATED; no repair', batches, metrics, by_archetype: byArchetype, findings};
fs.writeFileSync(path.join(root, 'data/quality-report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
const csv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const row = values => values.map(csv).join(',');
const reviewColumns = ['Batch', 'NPC', 'Name', 'Archetype', 'Naturalness', 'Distinctiveness', 'Campus plausibility', 'Schedule consistency', 'Dialogue consistency', 'Keep / Edit / Reject', 'Notes'];
const review = [row(reviewColumns), ...records.filter(r => r.batch_id === 'INKYUNG-20-A').map(({batch_id, npc}) => row([batch_id, npc.npc_id, npc.identity.name, npc.archetype, '', '', '', '', '', '', '']))].join('\r\n') + '\r\n';
fs.writeFileSync(path.join(root, 'data/human-review.csv'), '\ufeff' + review, {flag: 'wx'});
const comparison = [row(['Batch', 'NPC', 'Deterministic', 'Jev', 'Human', 'Disagreement reason']), ...records.map(({batch_id, npc}) => row([batch_id, npc.npc_id, 'PASS', '', '', '']))].join('\r\n') + '\r\n';
fs.writeFileSync(path.join(root, 'data/qa-comparison.csv'), '\ufeff' + comparison, {flag: 'wx'});
console.log(JSON.stringify({batches: batches.length, npcs: all.length, metrics, findings}, null, 2));
