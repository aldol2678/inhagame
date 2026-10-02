import { FORBIDDEN_CAPABILITIES } from './vocabulary.mjs';
import { applyCampusLifeSchedule, departmentCampusLifeFor } from './npc-campus-life-policy.mjs';

const HAIR = ['long','bob','ponytail','bun','short','sidepart','curly','medium'];
const OUTFIT = ['cardigan','jacket','shirt','coat','hoodie','sweater'];
const ACCESSORY = ['sketchbook','glasses','badge','backpack','headphones','book','messenger','scarf'];
const HAIR_COLORS = ['#242129','#35252c','#473126','#5a4038','#2a2630','#49362c','#302b37','#634130'];
const OUTFIT_COLORS = [
  '#4a89b8','#865d9e','#3f8d87','#d06f4f','#7d9d6d','#b85c60','#566b81',
  '#795ca3','#507fb4','#5a9bb9','#8b75af','#927653','#446481','#b96972'
];
const ACCENT_COLORS = ['#f0bd55','#aee4d2','#f3b36b','#f2d16b','#f3cfaa','#bfe4f2','#e8ba72','#b5e6dc','#a9d7ca','#ebad73','#edc98e','#d8e6a9','#efb1aa','#d8c2ef'];
const allowedDepartmentTypes = new Set(['humanities','social_sciences','engineering','natural_sciences','arts']);
const allowedResidence = new Set(['commuter','dorm_1','dorm_2']);
const idNumber = id => Number(String(id).slice(-3));

function visualFor(spec) {
  const n = idNumber(spec.npc_id);
  return {
    hair_style: HAIR[n % HAIR.length],
    hair_color: HAIR_COLORS[(n * 3) % HAIR_COLORS.length],
    skin_tone: n % 4,
    outfit_style: OUTFIT[(n * 5) % OUTFIT.length],
    outfit_color: OUTFIT_COLORS[n % OUTFIT_COLORS.length],
    accent_color: ACCENT_COLORS[(n * 7) % ACCENT_COLORS.length],
    accessory: ACCESSORY[(n * 5 + 1) % ACCESSORY.length],
    height: Math.round((.94 + (n % 9) * .015) * 100) / 100
  };
}

function behaviorTagsFor(spec) {
  const tags = [];
  if (spec.residence === 'commuter') tags.push('commuter');
  else tags.push('routine_oriented');
  if (spec.interests.includes('reading')) tags.push('reader');
  else if (spec.interests.includes('photography')) tags.push('photographer');
  else if (spec.interests.includes('music')) tags.push('music_fan');
  else tags.push(idNumber(spec.npc_id) % 2 ? 'observant' : 'helpful');
  if (spec.archetype === 'club_member') tags.push('club_goer');
  return [...new Set(tags)].slice(0, 3);
}

function buildNpc(spec) {
  const n = idNumber(spec.npc_id);
  const energy = Math.round((.36 + (n % 10) * .055) * 100) / 100;
  const talk = Math.round((.3 + ((n * 3) % 11) * .05) * 100) / 100;
  const routine = Math.round((.32 + ((n * 7) % 10) * .055) * 100) / 100;
  const constraints = Object.fromEntries(FORBIDDEN_CAPABILITIES.map(key => [key, false]));
  return {
    npc_id: spec.npc_id,
    archetype: spec.archetype,
    identity: {
      name: spec.name,
      age_band: spec.year_level >= 3 ? 'mid_20s' : 'early_20s',
      department_type: spec.department_type,
      year_level: spec.year_level
    },
    personality: {
      traits: [...spec.traits],
      social_energy: Math.min(.9, energy),
      talkativeness: Math.min(.9, talk),
      routine_preference: Math.min(.9, routine)
    },
    speech: {
      tone: energy > .68 ? 'casual_polite' : n % 2 ? 'reserved' : 'warm',
      tempo: energy > .75 ? 'quick' : 'normal',
      quirks: n % 3 === 0 ? ['precise_words'] : []
    },
    interests: [...spec.interests],
    home_zone: 'CAMPUS',
    schedule: {
      morning: { location: 'transit_to_building', activity: 'walk_to_class', social_mode: 'low' },
      class_time: { location: 'transit_to_building', activity: 'walk_to_class', social_mode: 'medium' },
      lunch: { location: 'transit_to_student_center', activity: 'walk', social_mode: 'medium' },
      evening: { location: 'off_zone', activity: 'leave_zone', social_mode: 'low' }
    },
    relationships: [],
    dialogue_hooks: {
      morning: ['첫 일정으로 이동하고 있어요.', '오늘 동선을 확인하는 중이에요.'],
      class_time: ['수업에 맞춰 이동하고 있어요.', '다음 강의 장소를 확인했어요.'],
      lunch: ['점심 시간을 보내고 있어요.', '다음 일정 전까지 잠깐 쉬어요.'],
      evening: ['오늘 일정을 마무리하고 있어요.', '이제 다음 장소로 이동해요.']
    },
    behavior_tags: behaviorTagsFor(spec),
    constraints
  };
}

function buildRosterEntry(spec) {
  return {
    npc_id: spec.npc_id,
    gender: spec.gender,
    student_number: `SIM-${2027 - spec.year_level}-${spec.npc_id.slice(-3)}`,
    department: spec.department,
    department_type: spec.department_type,
    residence: spec.residence,
    visual: visualFor(spec)
  };
}

export function validateCampusExpansionManifest(manifest) {
  if (manifest?.expansion_id !== 'CAMPUS-28-P2A' || manifest?.schema_version !== '0.1' ||
      manifest?.status !== 'FICTIONAL_POPULATION' || manifest?.npc_count !== 28 ||
      manifest?.npcs?.length !== 28) throw new Error('Invalid CAMPUS-28-P2A manifest');
  const ids = new Set(), names = new Set(), studentNumbers = new Set();
  for (let i = 0; i < manifest.npcs.length; i++) {
    const spec = manifest.npcs[i];
    const expectedId = `INKYUNG-NPC-${String(i + 21).padStart(3, '0')}`;
    if (spec.npc_id !== expectedId || ids.has(spec.npc_id)) throw new Error(`Invalid expansion NPC id: ${spec.npc_id}`);
    if (!spec.name || names.has(spec.name)) throw new Error(`Invalid expansion NPC name: ${spec.npc_id}`);
    if (!departmentCampusLifeFor(spec.department, spec.department_type))
      throw new Error(`Missing department life policy: ${spec.department}`);
    if (!allowedDepartmentTypes.has(spec.department_type) || !allowedResidence.has(spec.residence) ||
        !Number.isInteger(spec.year_level) || spec.year_level < 1 || spec.year_level > 4 ||
        !['male','female'].includes(spec.gender) || !['student','club_member'].includes(spec.archetype) ||
        !Array.isArray(spec.interests) || spec.interests.length < 2 ||
        !Array.isArray(spec.traits) || spec.traits.length < 2) {
      throw new Error(`Invalid expansion NPC spec: ${spec.npc_id}`);
    }
    ids.add(spec.npc_id);
    names.add(spec.name);
    const number = `SIM-${2027 - spec.year_level}-${spec.npc_id.slice(-3)}`;
    if (studentNumbers.has(number)) throw new Error(`Duplicate simulated student number: ${number}`);
    studentNumbers.add(number);
  }
  return manifest;
}

export function buildCampusExpansion(manifest) {
  validateCampusExpansionManifest(manifest);
  const npcs = manifest.npcs.map(buildNpc);
  const roster = manifest.npcs.map(buildRosterEntry);
  return {
    batch: {
      batch_id: 'CAMPUS-28-P2A',
      schema_version: '0.1',
      zone: 'CAMPUS',
      npc_count: npcs.length,
      npcs
    },
    roster: {
      roster_id: 'CAMPUS-28-P2A-RUNTIME-ROSTER',
      status: 'FICTIONAL_POPULATION',
      npcs: roster
    }
  };
}

export function mergeCampusPopulation(baseBatch, baseRoster, expansionManifest) {
  const expansion = buildCampusExpansion(expansionManifest);
  const ids = new Set(baseBatch.npcs.map(npc => npc.npc_id));
  if (expansion.batch.npcs.some(npc => ids.has(npc.npc_id))) throw new Error('Campus expansion collides with base NPC ids');
  const combinedRoster = {
    roster_id: 'INKYUNG-48-P2A-RUNTIME-ROSTER',
    status: 'RUNTIME_COMPOSITE',
    npcs: [...baseRoster.npcs, ...expansion.roster.npcs]
  };
  const combinedBatch = {
    batch_id: 'INKYUNG-48-P2A',
    schema_version: '0.2',
    zone: 'CAMPUS',
    npc_count: baseBatch.npcs.length + expansion.batch.npcs.length,
    npcs: [...baseBatch.npcs, ...expansion.batch.npcs]
  };
  return {
    batch: applyCampusLifeSchedule(combinedBatch, combinedRoster),
    roster: combinedRoster
  };
}
