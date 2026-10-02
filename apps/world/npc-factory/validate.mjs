import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ACTIVITIES, BEHAVIOR_TAGS, DISTRIBUTION, FORBIDDEN_CAPABILITIES, LOCATIONS, PERIODS, RELATIONSHIP_TYPES, SOCIAL_MODES} from './vocabulary.mjs';

const schema = JSON.parse(fs.readFileSync(new URL('./contract.schema.json', import.meta.url), 'utf8'));
const reciprocalTypes = new Set(['friend', 'clubmate', 'coworker']);
const forbiddenWords = /퀘스트|미션을\s*받|보상\s*받|축제|공식\s*행사|세계가\s*바뀌|연인|가족|quest|reward|festival|canon(?:ical)?\s*change/i;
const anchor = {
  inkyung_spawn: /인경호|입구/, inkyung_bench_east: /벤치|동쪽/, inkyung_bench_west: /벤치|서쪽/,
  inkyung_walkway: /산책로|길/, inkyung_waterfront: /물가|호수|인경호/,
  inkyung_photo_point: /사진|포인트/, transit_to_main_hall: /본관|이동/,
  transit_to_student_center: /학생회관|이동/, transit_to_building: /건물|이동/,
  off_zone: /밖|자리|떠나|나중/
};

function schemaCheck(value, rule, path, errors) {
  if (rule.$ref) return schemaCheck(value, schema.$defs[rule.$ref.split('/').at(-1)], path, errors);
  const types = rule.type ? (Array.isArray(rule.type) ? rule.type : [rule.type]) : [];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  if (types.length && !types.some(type => type === actual || (type === 'number' && actual === 'integer'))) {
    errors.push(`${path}: type ${actual}, expected ${types.join('|')}`); return;
  }
  if ('const' in rule && value !== rule.const) errors.push(`${path}: expected ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${path}: value outside enum`);
  if (typeof value === 'string') {
    if (rule.minLength != null && value.trim().length < rule.minLength) errors.push(`${path}: too short`);
    if (rule.maxLength != null && value.length > rule.maxLength) errors.push(`${path}: too long`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${path}: invalid format`);
  }
  if (typeof value === 'number') {
    if (rule.minimum != null && value < rule.minimum) errors.push(`${path}: below minimum`);
    if (rule.maximum != null && value > rule.maximum) errors.push(`${path}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems != null && value.length < rule.minItems) errors.push(`${path}: too few items`);
    if (rule.maxItems != null && value.length > rule.maxItems) errors.push(`${path}: too many items`);
    if (rule.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${path}: duplicate items`);
    value.forEach((item, i) => rule.items && schemaCheck(item, rule.items, `${path}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of rule.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    if (rule.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (rule.properties ?? {}))) errors.push(`${path}.${key}: extra property`);
    for (const [key, child] of Object.entries(rule.properties ?? {})) if (key in value) schemaCheck(value[key], child, `${path}.${key}`, errors);
  }
}

export function validateBatch(batch) {
  const errors = [];
  schemaCheck(batch, schema, '$', errors);
  if (!batch || !Array.isArray(batch.npcs)) return {status: 'FAIL', errors};
  if (batch.npc_count !== batch.npcs.length) errors.push('NPC_COUNT_MISMATCH');
  const ids = batch.npcs.map(n => n?.npc_id);
  if (new Set(ids).size !== ids.length) errors.push('DUPLICATE_NPC_ID');
  const byId = new Map(batch.npcs.map(n => [n?.npc_id, n]));
  for (const [type, expected] of Object.entries(DISTRIBUTION)) {
    if (batch.npcs.filter(n => n?.archetype === type).length !== expected) errors.push(`ARCHETYPE_DISTRIBUTION:${type}`);
  }
  const movement = new Set();
  for (const [i, npc] of batch.npcs.entries()) {
    if (!npc || typeof npc !== 'object') continue;
    const label = `NPC[${i}]`;
    for (const key of FORBIDDEN_CAPABILITIES) if (npc.constraints?.[key] !== false) errors.push(`${label}:FORBIDDEN_CAPABILITY:${key}`);
    if (npc.archetype === 'student' || npc.archetype === 'club_member') {
      if (!Number.isInteger(npc.identity?.year_level)) errors.push(`${label}:YEAR_LEVEL_REQUIRED`);
    } else if (npc.identity?.year_level !== null) errors.push(`${label}:YEAR_LEVEL_MUST_BE_NULL`);
    const rels = npc.relationships;
    if (Array.isArray(rels)) {
      const keys = new Set();
      for (const rel of rels) {
        if (!rel || typeof rel !== 'object') continue;
        if (!byId.has(rel.target_id)) errors.push(`${label}:RELATIONSHIP_TARGET_UNKNOWN`);
        if (rel.target_id === npc.npc_id) errors.push(`${label}:SELF_RELATIONSHIP`);
        if (!RELATIONSHIP_TYPES.includes(rel.type)) errors.push(`${label}:RELATIONSHIP_TYPE_UNKNOWN`);
        const key = `${rel.target_id}:${rel.type}`;
        if (keys.has(key)) errors.push(`${label}:DUPLICATE_RELATIONSHIP`);
        keys.add(key);
        if (reciprocalTypes.has(rel.type) && byId.has(rel.target_id) && rel.target_id !== npc.npc_id) {
          const reverse = byId.get(rel.target_id)?.relationships;
          if (!Array.isArray(reverse) || !reverse.some(r => r?.target_id === npc.npc_id && r?.type === rel.type)) errors.push(`${label}:RECIPROCAL_RELATIONSHIP_MISSING`);
        }
      }
    }
    for (const period of PERIODS) {
      const slot = npc.schedule?.[period];
      if (!slot || typeof slot !== 'object') continue;
      if (!LOCATIONS.includes(slot.location)) errors.push(`${label}:${period}:UNKNOWN_LOCATION`);
      if (!ACTIVITIES.includes(slot.activity)) errors.push(`${label}:${period}:UNKNOWN_ACTIVITY`);
      if (!SOCIAL_MODES.includes(slot.social_mode)) errors.push(`${label}:${period}:UNKNOWN_SOCIAL_MODE`);
      if (slot.location === 'off_zone' && slot.activity !== 'leave_zone') errors.push(`${label}:${period}:OFF_ZONE_ACTIVITY`);
      if (slot.location?.startsWith('transit_') && !['walk', 'walk_to_class', 'walk_to_club', 'leave_zone'].includes(slot.activity)) errors.push(`${label}:${period}:TRANSIT_ACTIVITY`);
      if (slot.activity === 'sit' && !slot.location?.includes('bench')) errors.push(`${label}:${period}:SIT_LOCATION`);
      if (slot.activity === 'take_photo' && !['inkyung_photo_point', 'inkyung_waterfront'].includes(slot.location)) errors.push(`${label}:${period}:PHOTO_LOCATION`);
      if (slot.social_mode === 'high' && npc.personality?.social_energy < 0.3) errors.push(`${label}:${period}:SOCIAL_ENERGY_CONTRADICTION`);
      if (slot.location === 'off_zone' || slot.location?.startsWith('transit_')) movement.add(npc.npc_id);
      const hooks = npc.dialogue_hooks?.[period];
      if (!Array.isArray(hooks)) continue;
      for (const hook of hooks) {
        if (typeof hook !== 'string') continue;
        if (forbiddenWords.test(hook)) errors.push(`${label}:${period}:FORBIDDEN_DIALOGUE`);
      }
      if (hooks.length >= 2 && hooks.every(h => typeof h === 'string') && anchor[slot.location] && !hooks.some(h => anchor[slot.location].test(h))) errors.push(`${label}:${period}:LOCATION_DIALOGUE_MISMATCH`);
      if (slot.location === 'off_zone' && hooks.some(h => typeof h === 'string' && /벤치|물가|호수|사진\s*포인트|산책로/.test(h))) errors.push(`${label}:${period}:OFF_ZONE_DIALOGUE_MISMATCH`);
    }
    for (const tag of npc.behavior_tags ?? []) if (!BEHAVIOR_TAGS.includes(tag)) errors.push(`${label}:UNKNOWN_BEHAVIOR_TAG`);
  }
  for (const period of PERIODS) {
    const counts = new Map(); let high = 0;
    for (const npc of batch.npcs) {
      const slot = npc?.schedule?.[period];
      if (!slot) continue;
      if (slot.location !== 'off_zone') counts.set(slot.location, (counts.get(slot.location) ?? 0) + 1);
      if (slot.social_mode === 'high') high++;
    }
    for (const [location, count] of counts) if (count > 6) errors.push(`CROWD_LIMIT:${period}:${location}:${count}`);
    if (high > 6) errors.push(`HIGH_SOCIAL_MODE_BIAS:${period}:${high}`);
  }
  if (movement.size < 4) errors.push('POPULATION_FLOW_TOO_STATIC');
  if (batch.npcs.filter(n => n?.schedule?.evening?.location === 'off_zone').length < 2) errors.push('EVENING_EXIT_TOO_LOW');
  return {status: errors.length ? 'FAIL' : 'PASS', errors};
}

export function validateJson(text) {
  try { return validateBatch(JSON.parse(text)); }
  catch (error) { return {status: 'FAIL', errors: [`JSON_PARSE:${error.message}`]}; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('Usage: node validate.mjs <batch.json> [...]'); process.exitCode = 2; }
  for (const file of files) {
    const result = validateJson(fs.readFileSync(file, 'utf8'));
    console.log(`${file}: ${result.status}${result.errors.length ? `\n  ${result.errors.join('\n  ')}` : ''}`);
    if (result.status !== 'PASS') process.exitCode = 1;
  }
}
