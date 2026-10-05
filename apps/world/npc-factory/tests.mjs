import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateJson} from './validate.mjs';
import {ACTIVITIES, BEHAVIOR_TAGS, DISTRIBUTION, LOCATIONS, PERIODS, RELATIONSHIP_TYPES, SOCIAL_MODES} from './vocabulary.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'contract.schema.json'), 'utf8'));
const npc = schema.$defs.npc.properties;
const same = (actual, expected) => assert.deepEqual([...actual].sort(), [...expected].sort());
same(schema.properties.batch_id.enum, ['INKYUNG-20-A', 'INKYUNG-20-B', 'INKYUNG-20-C']);
same(npc.archetype.enum, Object.keys(DISTRIBUTION));
same(Object.keys(npc.schedule.properties), PERIODS);
same(schema.$defs.slot.properties.location.enum, LOCATIONS);
same(schema.$defs.slot.properties.activity.enum, ACTIVITIES);
same(schema.$defs.slot.properties.social_mode.enum, SOCIAL_MODES);
same(schema.$defs.relationship.properties.type.enum, RELATIONSHIP_TYPES);
same(npc.behavior_tags.items.enum, BEHAVIOR_TAGS);
const fixtures = [
  ['unknown_location', 'UNKNOWN_LOCATION'], ['unknown_activity', 'UNKNOWN_ACTIVITY'],
  ['missing_target', 'RELATIONSHIP_TARGET_UNKNOWN'], ['self_relationship', 'SELF_RELATIONSHIP'],
  ['twenty_one_npcs', 'too many items'], ['archetype_distribution', 'ARCHETYPE_DISTRIBUTION'],
  ['missing_evening', 'required'], ['crowd_seven', 'CROWD_LIMIT'],
  ['world_change', 'FORBIDDEN_CAPABILITY:can_change_world_state'], ['quest_capability', 'FORBIDDEN_CAPABILITY:can_start_quest'],
  ['duplicate_id', 'DUPLICATE_NPC_ID'], ['bad_version', 'expected "0.1"'],
  ['forbidden_dialogue', 'FORBIDDEN_DIALOGUE'], ['unknown_tag', 'UNKNOWN_BEHAVIOR_TAG']
];
for (let run = 1; run <= 2; run++) {
  for (const letter of ['A', 'B', 'C']) {
    const file = path.join(root, `data/validated/INKYUNG-20-${letter}.json`);
    const result = validateJson(fs.readFileSync(file, 'utf8'));
    assert.equal(result.status, 'PASS', `${file}: ${result.errors.join(', ')}`);
  }
  for (const [name, expected] of fixtures) {
    const file = path.join(root, `data/fixtures/invalid/${name}.json`);
    const result = validateJson(fs.readFileSync(file, 'utf8'));
    assert.equal(result.status, 'FAIL', `${name} unexpectedly passed`);
    assert.ok(result.errors.some(error => error.includes(expected)), `${name}: missing ${expected}; got ${result.errors.join(', ')}`);
  }
  assert.equal(validateJson('{bad json').status, 'FAIL');
  console.log(`Regression run ${run}: 3 valid PASS; ${fixtures.length} invalid FAIL as expected; malformed JSON FAIL`);
}
console.log('Adversarial suite: PASS (14/14 expected rejections)');
